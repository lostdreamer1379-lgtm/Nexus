"""
Ingestion pipeline for RAG documents.

Called after a document is uploaded and stored on disk. Steps:
  1. Extract text from the file (PDF / DOCX / TXT / MD).
  2. Split into overlapping chunks.
  3. Embed each chunk via the knowledge base's configured embedding endpoint.
  4. Persist KBChunk rows (with embeddings as base64 blobs) to the DB.
  5. Update the document status to "ready" (or "error" on failure).

This runs asynchronously (called with asyncio via FastAPI's BackgroundTasks)
so it doesn't block the HTTP response to the client. The frontend polls
document status until it sees "ready" or "error".
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import KBChunk, KBDocument, KnowledgeBase
from app.rag.chunker import split_text
from app.rag.embeddings import EmbeddingError, embed_texts, vec_to_blob
from app.rag.extraction import extract_text
from app.security import decrypt_secret

logger = logging.getLogger(__name__)


async def ingest_document(document_id: str, db: Session) -> None:
    """
    Full ingestion pipeline for one KBDocument. Safe to call from a
    BackgroundTask — all exceptions are caught and recorded on the document.
    """
    doc = db.get(KBDocument, document_id)
    if not doc:
        return

    kb: KnowledgeBase = doc.knowledge_base

    doc.status = "processing"
    db.add(doc)
    db.commit()

    try:
        # 1. Extract text
        raw_text = extract_text(doc.file_path)
        if not raw_text.strip():
            raise ValueError("No text could be extracted from this file — it may be empty, image-only (scanned PDF), or in an unsupported format.")

        # 2. Chunk
        chunks = split_text(raw_text, chunk_size=kb.chunk_size, chunk_overlap=kb.chunk_overlap)
        if not chunks:
            raise ValueError("Document produced no chunks after splitting.")

        # 3. Embed — resolve the embedding connection
        conn = kb.embedding_connection
        if not conn or not conn.credential:
            raise ValueError(
                "This knowledge base has no embedding connection configured. "
                "Edit the knowledge base and pick a provider connection that supports embeddings."
            )
        api_key = decrypt_secret(conn.credential.encrypted_secret)
        base_url = conn.base_url or _default_base_url(conn.provider_type)

        texts = [c.content for c in chunks]
        vectors = await embed_texts(texts, api_key=api_key, base_url=base_url, model_id=kb.embedding_model_id)

        if len(vectors) != len(chunks):
            raise ValueError(f"Embedding count mismatch: {len(vectors)} vectors for {len(chunks)} chunks.")

        # Update the KB's embedding dimension (needed for future query embedding).
        if kb.embedding_dim is None and vectors:
            kb.embedding_dim = len(vectors[0])
            db.add(kb)

        # 4. Delete any old chunks from a previous ingestion of this document
        db.query(KBChunk).filter(KBChunk.document_id == doc.id).delete()

        # 5. Persist new chunks
        for chunk, vec in zip(chunks, vectors):
            db.add(
                KBChunk(
                    document_id=doc.id,
                    kb_id=kb.id,
                    chunk_index=chunk.index,
                    content=chunk.content,
                    embedding=vec_to_blob(vec),
                )
            )

        doc.status = "ready"
        doc.chunk_count = len(chunks)
        doc.error = None

    except (ValueError, EmbeddingError, ImportError) as exc:
        logger.warning("Ingestion failed for document %s: %s", document_id, exc)
        doc.status = "error"
        doc.error = str(exc)
    except Exception as exc:
        logger.exception("Unexpected error ingesting document %s", document_id)
        doc.status = "error"
        doc.error = "An unexpected error occurred during ingestion."

    doc.updated_at = datetime.now(timezone.utc)
    db.add(doc)
    db.commit()


def _default_base_url(provider_type: str) -> str:
    """Fallback base URLs for embedding calls when the connection has no explicit base_url."""
    defaults = {
        "openai": "https://api.openai.com/v1",
        "openrouter": "https://openrouter.ai/api/v1",
        "nvidia": "https://integrate.api.nvidia.com/v1",
    }
    return defaults.get(provider_type, "https://api.openai.com/v1")
