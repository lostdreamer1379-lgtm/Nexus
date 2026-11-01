"""
RAG retrieval service.

Given a user query and a knowledge base, returns a formatted context string
ready to be prepended as a system message before the user's query. Also
returns the raw chunks so the frontend can optionally show them as citations.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import KBChunk, KnowledgeBase
from app.rag.embeddings import EmbeddingError, embed_texts, top_k_chunks
from app.security import decrypt_secret

logger = logging.getLogger(__name__)

CONTEXT_PREAMBLE = """\
The following excerpts have been retrieved from the user's knowledge base "{kb_name}"
and are relevant to their question. Use them to inform your answer.
Cite the source document where helpful (document name shown above each excerpt).
If the excerpts don't contain enough information, say so rather than guessing.

---
"""

CONTEXT_CHUNK_TEMPLATE = '[Document: "{filename}" | excerpt {n}]\n{content}\n'

CONTEXT_SUFFIX = "\n---\n\nUsing the excerpts above (and your own knowledge where the excerpts don't cover it), answer the user's question.\n"


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    filename: str
    content: str
    score: float


@dataclass
class RetrievalResult:
    context_message: str          # the full system-prompt context string
    chunks: list[RetrievedChunk]  # for the client to show as citations
    kb_name: str


async def retrieve(query: str, kb_id: str, user_id: str, db: Session) -> RetrievalResult | None:
    """
    Returns a RetrievalResult, or None if the KB is empty or has no embeddings.
    Raises EmbeddingError if the embedding call fails.
    """
    kb: KnowledgeBase | None = db.get(KnowledgeBase, kb_id)
    if not kb or kb.user_id != user_id:
        return None

    # Fetch all chunks that have embeddings
    rows = (
        db.query(KBChunk)
        .filter(KBChunk.kb_id == kb_id, KBChunk.embedding.isnot(None))
        .all()
    )
    if not rows:
        return None

    # Embed the query with the same model/connection used for ingestion
    conn = kb.embedding_connection
    if not conn or not conn.credential:
        return None

    api_key = decrypt_secret(conn.credential.encrypted_secret)
    from app.rag.ingestion import _default_base_url
    base_url = conn.base_url or _default_base_url(conn.provider_type)

    query_vecs = await embed_texts(
        [query], api_key=api_key, base_url=base_url, model_id=kb.embedding_model_id
    )
    if not query_vecs:
        return None

    query_vec = query_vecs[0]

    # Score and rank
    chunk_ids = [r.id for r in rows]
    chunk_blobs = [r.embedding for r in rows]
    top = top_k_chunks(query_vec, chunk_ids, chunk_blobs, k=kb.retrieval_k)

    if not top:
        return None

    # Build a lookup so we can join filenames without N+1 queries
    chunk_by_id = {r.id: r for r in rows}
    # Pre-load document filenames
    doc_ids = {chunk_by_id[cid].document_id for cid, _ in top}
    from app.models import KBDocument
    docs = {d.id: d for d in db.query(KBDocument).filter(KBDocument.id.in_(doc_ids)).all()}

    retrieved: list[RetrievedChunk] = []
    for cid, score in top:
        chunk = chunk_by_id[cid]
        doc = docs.get(chunk.document_id)
        retrieved.append(
            RetrievedChunk(
                chunk_id=cid,
                document_id=chunk.document_id,
                filename=doc.filename if doc else "unknown",
                content=chunk.content,
                score=score,
            )
        )

    # Build the context string
    parts = [CONTEXT_PREAMBLE.format(kb_name=kb.name)]
    for i, r in enumerate(retrieved, 1):
        parts.append(CONTEXT_CHUNK_TEMPLATE.format(filename=r.filename, n=i, content=r.content))
    parts.append(CONTEXT_SUFFIX)
    context_message = "".join(parts)

    return RetrievalResult(
        context_message=context_message,
        chunks=retrieved,
        kb_name=kb.name,
    )
