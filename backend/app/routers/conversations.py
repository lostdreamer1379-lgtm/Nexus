from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Conversation, User
from app.schemas import ConversationCreate, ConversationDetailOut, ConversationOut, ConversationUpdate

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


def _get_owned_conversation(db: Session, conversation_id: str, user: User) -> Conversation:
    convo = db.get(Conversation, conversation_id)
    if not convo or convo.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return convo


@router.get("", response_model=list[ConversationOut])
def list_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Conversation)
        .filter(Conversation.user_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convo = Conversation(user_id=current_user.id, title=payload.title or "New conversation")
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


@router.get("/{conversation_id}", response_model=ConversationDetailOut)
def get_conversation(conversation_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convo = (
        db.query(Conversation)
        .options(joinedload(Conversation.messages))
        .filter(Conversation.id == conversation_id)
        .first()
    )
    if not convo or convo.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return convo


@router.patch("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(conversation_id: str, payload: ConversationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convo = _get_owned_conversation(db, conversation_id, current_user)
    convo.title = payload.title
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convo = _get_owned_conversation(db, conversation_id, current_user)
    db.delete(convo)
    db.commit()
    return None
