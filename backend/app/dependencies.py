from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.security import decode_access_token

settings = get_settings()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """
    Derives identity from the signed session cookie — never from any
    user-supplied ID in the request body or query string. This is the one
    and only source of truth for "who is making this request".
    """
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

    user = db.get(User, user_id)
    if not user or user.account_status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not available")

    return user
