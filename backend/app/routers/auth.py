from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    Conversation,
    EncryptedCredential,
    KnowledgeBase,
    ProviderConnection,
    User,
    UserMemory,
    UserModel,
    UserPreference,
)
from app.schemas import LoginRequest, RegisterRequest, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
settings = get_settings()


def _set_session_cookie(response: Response, user_id: str) -> None:
    token = create_access_token(user_id)
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()  # get user.id before commit
    db.add(UserPreference(user_id=user.id))
    db.commit()
    db.refresh(user)

    _set_session_cookie(response, user.id)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    # Deliberately identical error for "no such user" and "wrong password" to avoid
    # leaking which emails are registered.
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if user.account_status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is not active")

    _set_session_cookie(response, user.id)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    return None


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently remove the authenticated user's account and owned data."""
    db.query(UserMemory).filter(UserMemory.user_id == current_user.id).delete(synchronize_session=False)
    db.query(Conversation).filter(Conversation.user_id == current_user.id).delete(synchronize_session=False)
    db.query(KnowledgeBase).filter(KnowledgeBase.user_id == current_user.id).delete(synchronize_session=False)
    db.query(UserModel).filter(UserModel.user_id == current_user.id).delete(synchronize_session=False)

    connection_ids = [
        row[0]
        for row in db.query(ProviderConnection.id)
        .filter(ProviderConnection.user_id == current_user.id)
        .all()
    ]
    if connection_ids:
        db.query(EncryptedCredential).filter(
            EncryptedCredential.connection_id.in_(connection_ids)
        ).delete(synchronize_session=False)
    db.query(ProviderConnection).filter(ProviderConnection.user_id == current_user.id).delete(
        synchronize_session=False
    )
    db.query(UserPreference).filter(UserPreference.user_id == current_user.id).delete(
        synchronize_session=False
    )
    db.delete(current_user)
    db.commit()
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    return None


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
