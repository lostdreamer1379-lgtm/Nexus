import json
import pathlib
import shutil
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    DocumentComparison, KBChunk, KBDocument, KBFact, KnowledgeBase,
    KnowledgeGraphEdge, KnowledgeGraphNode, ProviderConnection, User, UserModel,
)
from app.providers.base import ChatMessage, ProviderError
from app.providers.registry import build_adapter
from app.rag.extraction import SUPPORTED_EXTENSIONS
from app.rag.ingestion import ingest_document

router = APIRouter(prefix="/api/v1/rag", tags=["rag"])
settings = get_settings()


# ─── Pydantic schemas (kept local to avoid bloating the shared schemas.py) ───

class KBCreate(BaseModel):
    name: str
    description: str | None = None
    embedding_connection_id: str | None = None
    embedding_model_id: str = "text-embedding-3-small"
    chunk_size: int = 512
    chunk_overlap: int = 64
    retrieval_k: int = 5


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    embedding_connection_id: str | None = None
    embedding_model_id: str | None = None
    chunk_size: int | None = None
    chunk_overlap: int | None = None
    retrieval_k: int | None = None


class KBOut(BaseModel):
    id: str
    name: str
    description: str | None
    embedding_connection_id: str | None
    embedding_model_id: str
    chunk_size: int
    chunk_overlap: int
    retrieval_k: int
    embedding_dim: int | None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    id: str
    kb_id: str
    filename: str
    file_size_bytes: int
    mime_type: str
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CompareRequest(BaseModel):
    document_a_id: str
    document_b_id: str
    model_id: str


class CompareOut(BaseModel):
    id: str
    document_a: str
    document_b: str
    report: str
    rating: int | None = None
    feedback: str | None = None
    status: str


class ComparisonFeedback(BaseModel):
    rating: int
    feedback: str | None = None


class GraphRequest(BaseModel):
    model_id: str


class FactRefinementRequest(BaseModel):
    model_id: str


class FactStatusUpdate(BaseModel):
    status: str


@router.get("/knowledge-bases/{kb_id}/facts")
def list_facts(kb_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_kb(db, kb_id, current_user)
    facts = db.query(KBFact).filter(KBFact.kb_id == kb_id).order_by(KBFact.updated_at.desc()).all()
    return [_fact_out(fact) for fact in facts]


@router.post("/knowledge-bases/{kb_id}/facts/refine")
async def refine_facts(
    kb_id: str,
    payload: FactRefinementRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_kb(db, kb_id, current_user)
    model = db.get(UserModel, payload.model_id)
    if not model or model.user_id != current_user.id or not model.enabled or not model.connection:
        raise HTTPException(status_code=404, detail="Enabled model not found")
    documents = db.query(KBDocument).filter(KBDocument.kb_id == kb_id, KBDocument.status == "ready").all()
    if not documents:
        raise HTTPException(status_code=400, detail="The knowledge base has no ready documents")
    from app.rag.extraction import extract_text
    corpus = "\n\n".join(f"DOCUMENT: {doc.filename}\n{extract_text(doc.file_path)[:16000]}" for doc in documents)
    prompt = (
        'Extract explicit, verifiable facts. Return ONLY JSON: '
        '{"facts":[{"subject":"...","predicate":"...","object":"...","evidence":"short quote","confidence":0.0}]}. '
        "Do not infer. Keep max 100 facts.\n\n" + corpus
    )
    adapter = build_adapter(model.connection)
    parts = []
    async for chunk in adapter.stream_chat(model.provider_model_id, [ChatMessage(role="user", content=prompt)]):
        if chunk.error:
            raise HTTPException(status_code=502, detail=chunk.error)
        if chunk.delta:
            parts.append(chunk.delta)
        if chunk.done:
            break
    try:
        text = "".join(parts)
        start, end = text.find("{"), text.rfind("}")
        data = json.loads(text[start : end + 1]) if start >= 0 and end > start else {}
        extracted = data.get("facts", [])[:100]
    except (TypeError, ValueError, json.JSONDecodeError):
        extracted = []
    if not extracted:
        raise HTTPException(status_code=502, detail="The model did not return valid facts")
    existing = db.query(KBFact).filter(KBFact.kb_id == kb_id, KBFact.status.in_(("active", "conflict"))).all()
    for item in extracted:
        subject = str(item.get("subject", "")).strip()
        predicate = str(item.get("predicate", "")).strip()
        object_value = str(item.get("object", "")).strip()
        if not subject or not predicate or not object_value:
            continue
        same = [fact for fact in existing if fact.subject.lower() == subject.lower() and fact.predicate.lower() == predicate.lower()]
        for old in same:
            if old.object.lower() != object_value.lower():
                old.status = "conflict"
        row = KBFact(
            kb_id=kb_id,
            subject=subject,
            predicate=predicate,
            object=object_value,
            evidence=str(item.get("evidence", "")).strip() or None,
            confidence=min(max(float(item.get("confidence", 0.5)), 0.0), 1.0),
            source_document_id=documents[0].id,
        )
        db.add(row)
    db.commit()
    return [_fact_out(fact) for fact in db.query(KBFact).filter(KBFact.kb_id == kb_id).order_by(KBFact.updated_at.desc()).all()]


@router.patch("/knowledge-bases/{kb_id}/facts/{fact_id}")
def update_fact(
    kb_id: str,
    fact_id: str,
    payload: FactStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_kb(db, kb_id, current_user)
    if payload.status not in {"active", "conflict", "stale", "dismissed"}:
        raise HTTPException(status_code=400, detail="Invalid fact status")
    fact = db.query(KBFact).filter(KBFact.id == fact_id, KBFact.kb_id == kb_id).first()
    if not fact:
        raise HTTPException(status_code=404, detail="Fact not found")
    fact.status = payload.status
    db.commit()
    db.refresh(fact)
    return _fact_out(fact)


def _fact_out(fact: KBFact):
    return {
        "id": fact.id,
        "subject": fact.subject,
        "predicate": fact.predicate,
        "object": fact.object,
        "evidence": fact.evidence,
        "status": fact.status,
        "confidence": fact.confidence,
        "source_document_id": fact.source_document_id,
    }


def _parse_graph(text: str):
    import json
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return [], []
    try:
        data = json.loads(text[start : end + 1])
        return data.get("nodes", [])[:100], data.get("edges", [])[:200]
    except (TypeError, ValueError, json.JSONDecodeError):
        return [], []


@router.get("/knowledge-bases/{kb_id}/graph")
def get_graph(kb_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_kb(db, kb_id, current_user)
    nodes = db.query(KnowledgeGraphNode).filter(KnowledgeGraphNode.kb_id == kb_id).all()
    edges = db.query(KnowledgeGraphEdge).filter(KnowledgeGraphEdge.kb_id == kb_id).all()
    return {
        "nodes": [{"id": n.id, "name": n.name, "type": n.node_type, "description": n.description} for n in nodes],
        "edges": [{"id": e.id, "source": e.source_node_id, "target": e.target_node_id, "relationship": e.relationship, "evidence": e.evidence} for e in edges],
    }


@router.post("/knowledge-bases/{kb_id}/graph")
async def build_graph(kb_id: str, payload: GraphRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_kb(db, kb_id, current_user)
    model = db.get(UserModel, payload.model_id)
    if not model or model.user_id != current_user.id or not model.enabled:
        raise HTTPException(status_code=404, detail="Enabled model not found")
    documents = db.query(KBDocument).filter(KBDocument.kb_id == kb_id, KBDocument.status == "ready").all()
    if not documents:
        raise HTTPException(status_code=400, detail="The knowledge base has no ready documents")
    connection = model.connection
    if not connection or connection.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Provider connection not found")

    from app.rag.extraction import extract_text
    corpus = "\n\n".join(f"DOCUMENT: {doc.filename}\n{extract_text(doc.file_path)[:20000]}" for doc in documents)
    prompt = (
        'Extract a compact knowledge graph. Return ONLY JSON: {"nodes":[{"name":"...","type":"person|project|organization|concept|place|technology","description":"..."}],"edges":[{"source":"node name","target":"node name","relationship":"...","evidence":"short quote"}]}. '
        "Use exact repeated names, omit uncertain relationships, max 100 nodes and 200 edges.\n\n" + corpus
    )
    adapter = build_adapter(connection)
    parts = []
    async for chunk in adapter.stream_chat(model.provider_model_id, [ChatMessage(role="user", content=prompt)]):
        if chunk.error:
            raise HTTPException(status_code=502, detail=chunk.error)
        if chunk.delta:
            parts.append(chunk.delta)
        if chunk.done:
            break
    raw_nodes, raw_edges = _parse_graph("".join(parts))
    if not raw_nodes:
        raise HTTPException(status_code=502, detail="The model did not return a valid graph")

    db.query(KnowledgeGraphEdge).filter(KnowledgeGraphEdge.kb_id == kb_id).delete()
    db.query(KnowledgeGraphNode).filter(KnowledgeGraphNode.kb_id == kb_id).delete()
    node_by_name = {}
    for item in raw_nodes:
        name = str(item.get("name", "")).strip()
        if not name or name.lower() in node_by_name:
            continue
        node = KnowledgeGraphNode(kb_id=kb_id, name=name, node_type=str(item.get("type", "concept")), description=item.get("description"))
        db.add(node)
        db.flush()
        node_by_name[name.lower()] = node
    for item in raw_edges:
        source = node_by_name.get(str(item.get("source", "")).strip().lower())
        target = node_by_name.get(str(item.get("target", "")).strip().lower())
        relationship = str(item.get("relationship", "")).strip()
        if source and target and relationship:
            db.add(KnowledgeGraphEdge(kb_id=kb_id, source_node_id=source.id, target_node_id=target.id, relationship=relationship, evidence=item.get("evidence")))
    db.commit()
    return get_graph(kb_id, current_user, db)


# ─── Helpers ───

def _get_owned_kb(db: Session, kb_id: str, user: User) -> KnowledgeBase:
    kb = db.get(KnowledgeBase, kb_id)
    if not kb or kb.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found")
    return kb


@router.post("/knowledge-bases/{kb_id}/compare", response_model=CompareOut)
async def compare_documents(
    kb_id: str,
    payload: CompareRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_kb(db, kb_id, current_user)
    if payload.document_a_id == payload.document_b_id:
        raise HTTPException(status_code=400, detail="Choose two different documents")

    documents = (
        db.query(KBDocument)
        .filter(
            KBDocument.kb_id == kb_id,
            KBDocument.id.in_([payload.document_a_id, payload.document_b_id]),
            KBDocument.status == "ready",
        )
        .all()
    )
    by_id = {doc.id: doc for doc in documents}
    if len(by_id) != 2:
        raise HTTPException(status_code=400, detail="Both documents must exist and be ready")

    model = db.get(UserModel, payload.model_id)
    if not model or model.user_id != current_user.id or not model.enabled:
        raise HTTPException(status_code=404, detail="Enabled model not found")
    connection = model.connection
    if not connection or connection.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Provider connection not found")

    try:
        from app.rag.extraction import extract_text

        doc_a = by_id[payload.document_a_id]
        doc_b = by_id[payload.document_b_id]
        text_a = extract_text(doc_a.file_path)[:60000]
        text_b = extract_text(doc_b.file_path)[:60000]
        adapter = build_adapter(connection)
        prompt = (
            "Compare the two documents below. Produce a useful, evidence-based Markdown report "
            "with sections: Executive summary, Key similarities, Key differences, Detailed comparison "
            "table, and Open questions. Reference document names and quote short evidence where useful. "
            "Do not invent facts; say when information is missing.\n\n"
            f"DOCUMENT A: {doc_a.filename}\n{text_a}\n\n"
            f"DOCUMENT B: {doc_b.filename}\n{text_b}"
        )
        feedback_rows = db.query(DocumentComparison).filter(
            DocumentComparison.kb_id == kb_id,
            DocumentComparison.feedback.isnot(None),
        ).order_by(DocumentComparison.created_at.desc()).limit(5).all()
        if feedback_rows:
            prompt += (
                "\n\nPrior feedback from this knowledge base. Apply it when relevant, but do not "
                "copy prior reports:\n"
                + "\n".join(f"- {row.rating}: {row.feedback}" for row in feedback_rows if row.feedback)
            )
        parts: list[str] = []
        async for chunk in adapter.stream_chat(
            model.provider_model_id,
            [ChatMessage(role="user", content=prompt)],
        ):
            if chunk.error:
                raise ProviderError(chunk.error)
            if chunk.delta:
                parts.append(chunk.delta)
            if chunk.done:
                break
        report = "".join(parts).strip()
    except (ProviderError, ValueError, ImportError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    comparison = DocumentComparison(
        kb_id=kb_id,
        document_a_id=doc_a.id,
        document_b_id=doc_b.id,
        model_id=model.id,
        report=report,
        document_a_updated_at=doc_a.updated_at,
        document_b_updated_at=doc_b.updated_at,
    )
    db.add(comparison)
    db.commit()
    db.refresh(comparison)
    return CompareOut(
        id=comparison.id,
        document_a=doc_a.filename,
        document_b=doc_b.filename,
        report=report,
        status=comparison.status,
    )


@router.get("/knowledge-bases/{kb_id}/comparisons")
def list_comparisons(
    kb_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_kb(db, kb_id, current_user)
    rows = db.query(DocumentComparison).filter(DocumentComparison.kb_id == kb_id).order_by(DocumentComparison.created_at.desc()).limit(20).all()
    names = {doc.id: doc.filename for doc in db.query(KBDocument).filter(KBDocument.kb_id == kb_id).all()}
    return [
        {
            "id": row.id,
            "document_a": names.get(row.document_a_id, "Deleted document"),
            "document_b": names.get(row.document_b_id, "Deleted document"),
            "report": row.report,
            "rating": row.rating,
            "feedback": row.feedback,
            "status": row.status,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.patch("/knowledge-bases/{kb_id}/comparisons/{comparison_id}")
def rate_comparison(
    kb_id: str,
    comparison_id: str,
    payload: ComparisonFeedback,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_kb(db, kb_id, current_user)
    if payload.rating not in (1, -1):
        raise HTTPException(status_code=422, detail="Rating must be 1 or -1")
    row = db.query(DocumentComparison).filter(
        DocumentComparison.id == comparison_id,
        DocumentComparison.kb_id == kb_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Comparison not found")
    row.rating = payload.rating
    row.feedback = payload.feedback
    db.commit()
    return {"id": row.id, "rating": row.rating, "feedback": row.feedback}


# ─── Knowledge base CRUD ───

@router.get("/knowledge-bases", response_model=list[KBOut])
def list_knowledge_bases(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    kbs = db.query(KnowledgeBase).filter(KnowledgeBase.user_id == current_user.id).order_by(KnowledgeBase.created_at.desc()).all()
    result = []
    for kb in kbs:
        doc_count = db.query(KBDocument).filter(KBDocument.kb_id == kb.id).count()
        out = KBOut.model_validate(kb)
        out.document_count = doc_count
        result.append(out)
    return result


@router.post("/knowledge-bases", response_model=KBOut, status_code=status.HTTP_201_CREATED)
def create_knowledge_base(
    payload: KBCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.embedding_connection_id:
        conn = db.get(ProviderConnection, payload.embedding_connection_id)
        if not conn or conn.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Provider connection not found")

    kb = KnowledgeBase(
        user_id=current_user.id,
        **payload.model_dump(),
    )
    db.add(kb)
    db.commit()
    db.refresh(kb)
    out = KBOut.model_validate(kb)
    out.document_count = 0
    return out


@router.get("/knowledge-bases/{kb_id}", response_model=KBOut)
def get_knowledge_base(kb_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    kb = _get_owned_kb(db, kb_id, current_user)
    doc_count = db.query(KBDocument).filter(KBDocument.kb_id == kb.id).count()
    out = KBOut.model_validate(kb)
    out.document_count = doc_count
    return out


@router.patch("/knowledge-bases/{kb_id}", response_model=KBOut)
def update_knowledge_base(
    kb_id: str,
    payload: KBUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    kb = _get_owned_kb(db, kb_id, current_user)

    if payload.embedding_connection_id is not None:
        conn = db.get(ProviderConnection, payload.embedding_connection_id)
        if not conn or conn.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Provider connection not found")
        kb.embedding_connection_id = payload.embedding_connection_id

    for field in ("name", "description", "embedding_model_id", "chunk_size", "chunk_overlap", "retrieval_k"):
        val = getattr(payload, field)
        if val is not None:
            setattr(kb, field, val)

    db.add(kb)
    db.commit()
    db.refresh(kb)
    doc_count = db.query(KBDocument).filter(KBDocument.kb_id == kb.id).count()
    out = KBOut.model_validate(kb)
    out.document_count = doc_count
    return out


@router.delete("/knowledge-bases/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_base(kb_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    kb = _get_owned_kb(db, kb_id, current_user)
    # Delete physical files
    kb_dir = settings.rag_upload_path / current_user.id / kb_id
    if kb_dir.exists():
        shutil.rmtree(kb_dir)
    db.delete(kb)
    db.commit()
    return None


# ─── Documents ───

@router.get("/knowledge-bases/{kb_id}/documents", response_model=list[DocumentOut])
def list_documents(kb_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_kb(db, kb_id, current_user)
    return db.query(KBDocument).filter(KBDocument.kb_id == kb_id).order_by(KBDocument.created_at.desc()).all()


@router.post("/knowledge-bases/{kb_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    kb_id: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    kb = _get_owned_kb(db, kb_id, current_user)

    # Validate extension
    ext = pathlib.Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {ext!r}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    # Size check (stream-read to count bytes without loading all into memory at once)
    max_bytes = settings.RAG_MAX_FILE_MB * 1024 * 1024
    dest_dir = settings.rag_upload_path / current_user.id / kb_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / safe_name

    total = 0
    with dest_path.open("wb") as out:
        while chunk := await file.read(65536):
            total += len(chunk)
            if total > max_bytes:
                dest_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File exceeds the {settings.RAG_MAX_FILE_MB} MB limit.",
                )
            out.write(chunk)

    doc = KBDocument(
        kb_id=kb.id,
        filename=file.filename,
        file_path=str(dest_path),
        file_size_bytes=total,
        mime_type=file.content_type or "application/octet-stream",
        status="pending",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # Kick off ingestion in the background so the HTTP response is immediate
    background_tasks.add_task(ingest_document, doc.id, db)

    return doc


@router.delete("/knowledge-bases/{kb_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(kb_id: str, doc_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _get_owned_kb(db, kb_id, current_user)
    doc = db.get(KBDocument, doc_id)
    if not doc or doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Document not found")
    # Remove the physical file
    pathlib.Path(doc.file_path).unlink(missing_ok=True)
    db.delete(doc)
    db.commit()
    return None


@router.post("/knowledge-bases/{kb_id}/documents/{doc_id}/reprocess", response_model=DocumentOut)
async def reprocess_document(
    kb_id: str,
    doc_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run ingestion on a document that failed or whose KB settings changed."""
    _get_owned_kb(db, kb_id, current_user)
    doc = db.get(KBDocument, doc_id)
    if not doc or doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = "pending"
    doc.error = None
    db.add(doc)
    db.commit()
    db.query(DocumentComparison).filter(
        (DocumentComparison.document_a_id == doc.id) | (DocumentComparison.document_b_id == doc.id),
        DocumentComparison.status == "ready",
    ).update({"status": "stale"}, synchronize_session=False)
    db.commit()
    background_tasks.add_task(ingest_document, doc.id, db)
    db.refresh(doc)
    return doc
