import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Conversation, Message, User, UserMemory, UserModel
from app.providers.base import ChatMessage
from app.providers.registry import build_adapter

router = APIRouter(prefix="/api/v1/memories", tags=["memories"])


class RefineRequest(BaseModel):
    model_id: str


class MemorySuggestionRequest(BaseModel):
    model_id: str
    conversation_id: str


class MemoryCreate(BaseModel):
    content: str
    category: str = "fact"
    confidence: float = 0.8
    source_conversation_id: str | None = None


class MemoryUpdate(BaseModel):
    content: str | None = None
    category: str | None = None
    status: str | None = None


def _owned_model(db: Session, model_id: str, user: User) -> UserModel:
    model = db.get(UserModel, model_id)
    if not model or model.user_id != user.id or not model.enabled:
        raise HTTPException(status_code=404, detail="Enabled model not found")
    if not model.connection or model.connection.user_id != user.id:
        raise HTTPException(status_code=404, detail="Provider connection not found")
    return model


@router.get("")
def list_memories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).order_by(UserMemory.updated_at.desc()).all()
    return [_out(row) for row in rows]


@router.post("")
def create_memory(
    payload: MemoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = payload.content.strip()
    if not content or len(content) > 1000:
        raise HTTPException(status_code=400, detail="Memory content must be between 1 and 1000 characters")
    if payload.category not in {"preference", "profile", "workflow", "fact"}:
        raise HTTPException(status_code=400, detail="Invalid memory category")
    duplicate = (
        db.query(UserMemory)
        .filter(UserMemory.user_id == current_user.id, UserMemory.content.ilike(content))
        .first()
    )
    if duplicate:
        duplicate.status = "approved"
        duplicate.last_confirmed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(duplicate)
        return _out(duplicate)
    row = UserMemory(
        user_id=current_user.id,
        content=content,
        category=payload.category,
        confidence=min(max(payload.confidence, 0.0), 1.0),
        status="approved",
        source_conversation_id=payload.source_conversation_id,
        last_confirmed_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.post("/suggest")
async def suggest_memories(
    payload: MemorySuggestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = _owned_model(db, payload.model_id, current_user)
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == payload.conversation_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(6)
        .all()
    )
    if not messages:
        return []
    prompt = (
        "Identify durable, user-specific information from this completed conversation that could "
        "improve future answers. Return ONLY JSON array with at most 3 items in this format: "
        '[{"content":"short fact or preference","category":"preference|profile|workflow|fact","confidence":0.0}]. '
        "Only suggest information explicitly stated by the user or clearly confirmed by them. "
        "Do not suggest one-off tasks, information about other people, secrets, passwords, health, "
        "politics, religion, or sensitive identity traits. If nothing is useful, return [].\n\n"
        + "\n".join(f"{message.role}: {message.content}" for message in reversed(messages))
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
        start, end = text.find("["), text.rfind("]")
        extracted = json.loads(text[start : end + 1]) if start >= 0 and end > start else []
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    suggestions = []
    for item in extracted[:3]:
        content = str(item.get("content", "")).strip()
        category = str(item.get("category", "fact"))
        if content and category in {"preference", "profile", "workflow", "fact"}:
            suggestions.append({
                "content": content[:1000],
                "category": category,
                "confidence": min(max(float(item.get("confidence", 0.7)), 0.0), 1.0),
                "source_conversation_id": conversation.id,
            })
    return suggestions


@router.post("/conversations/{conversation_id}")
def save_conversation_to_memory(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == current_user.id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id, Message.content.isnot(None))
        .order_by(Message.created_at.asc())
        .all()
    )
    created = 0
    now = datetime.now(timezone.utc)
    for message in messages:
        content = message.content.strip()
        if not content:
            continue
        content = content[:1000]
        duplicate = (
            db.query(UserMemory)
            .filter(UserMemory.user_id == current_user.id, UserMemory.content.ilike(content))
            .first()
        )
        if duplicate:
            duplicate.status = "approved"
            duplicate.last_confirmed_at = now
            continue
        db.add(
            UserMemory(
                user_id=current_user.id,
                content=content,
                category="fact",
                confidence=0.8,
                status="approved",
                source_conversation_id=conversation.id,
                last_confirmed_at=now,
            )
        )
        created += 1
    db.commit()
    return {"saved": created, "messages": len(messages)}


@router.post("/refine")
async def refine_memories(
    payload: RefineRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    model = _owned_model(db, payload.model_id, current_user)
    messages = (
        db.query(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .filter(Conversation.user_id == current_user.id, Message.role == "user")
        .order_by(Message.created_at.desc())
        .limit(40)
        .all()
    )
    if not messages:
        raise HTTPException(status_code=400, detail="There is not enough conversation history to refine memories")
    prompt = (
        'Extract only durable user-specific facts or preferences from the messages below. '
        'Return ONLY JSON array: [{"content":"short fact","category":"preference|profile|workflow|fact","confidence":0.0}]. '
        "Do not infer sensitive traits, secrets, passwords, health, politics, religion, or identity. "
        "Ignore one-off requests and facts about other people.\n\n"
        + "\n".join(f"- {message.content}" for message in reversed(messages))
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
        start, end = text.find("["), text.rfind("]")
        extracted = json.loads(text[start : end + 1]) if start >= 0 and end > start else []
    except (TypeError, ValueError, json.JSONDecodeError):
        extracted = []
    created = []
    for item in extracted[:30]:
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        duplicate = (
            db.query(UserMemory)
            .filter(UserMemory.user_id == current_user.id, UserMemory.content.ilike(content))
            .first()
        )
        if duplicate:
            duplicate.confidence = max(duplicate.confidence, min(float(item.get("confidence", 0.5)), 1.0))
            duplicate.last_confirmed_at = datetime.now(timezone.utc)
            if duplicate.status == "archived":
                duplicate.status = "pending"
            continue
        row = UserMemory(
            user_id=current_user.id,
            content=content,
            category=str(item.get("category", "fact")),
            confidence=min(max(float(item.get("confidence", 0.5)), 0.0), 1.0),
            source_conversation_id=messages[0].conversation_id,
        )
        db.add(row)
        created.append(row)
    db.commit()
    return [_out(row) for row in created]


@router.patch("/{memory_id}")
def update_memory(
    memory_id: str,
    payload: MemoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.status is not None and payload.status not in {"pending", "approved", "archived"}:
        raise HTTPException(status_code=400, detail="Invalid memory status")
    row = db.query(UserMemory).filter(UserMemory.id == memory_id, UserMemory.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    if payload.content is not None:
        content = payload.content.strip()
        if not content or len(content) > 1000:
            raise HTTPException(status_code=400, detail="Memory content must be between 1 and 1000 characters")
        row.content = content
    if payload.category is not None:
        if payload.category not in {"preference", "profile", "workflow", "fact"}:
            raise HTTPException(status_code=400, detail="Invalid memory category")
        row.category = payload.category
    if payload.status is not None:
        row.status = payload.status
    if payload.status == "approved":
        row.last_confirmed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserMemory).filter(UserMemory.id == memory_id, UserMemory.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.delete("")
def clear_memories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    deleted = db.query(UserMemory).filter(UserMemory.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


def _out(row: UserMemory):
    return {
        "id": row.id,
        "content": row.content,
        "category": row.category,
        "status": row.status,
        "confidence": row.confidence,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
