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


class MemoryUpdate(BaseModel):
    status: str


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
    if payload.status not in {"pending", "approved", "archived"}:
        raise HTTPException(status_code=400, detail="Invalid memory status")
    row = db.query(UserMemory).filter(UserMemory.id == memory_id, UserMemory.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    row.status = payload.status
    if payload.status == "approved":
        row.last_confirmed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _out(row)


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
