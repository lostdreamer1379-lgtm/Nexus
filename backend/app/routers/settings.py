from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, UserPreference
from app.schemas import UserPreferenceOut, UserPreferenceUpdate

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def _get_or_create_preferences(db: Session, user: User) -> UserPreference:
    prefs = db.query(UserPreference).filter(UserPreference.user_id == user.id).first()
    if not prefs:
        prefs = UserPreference(user_id=user.id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


@router.get("", response_model=UserPreferenceOut)
def get_settings_endpoint(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_or_create_preferences(db, current_user)


@router.patch("", response_model=UserPreferenceOut)
def update_settings(payload: UserPreferenceUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    prefs = _get_or_create_preferences(db, current_user)
    if payload.theme is not None:
        prefs.theme = payload.theme
    if payload.default_model_id is not None:
        prefs.default_model_id = payload.default_model_id
    if payload.interface_preferences is not None:
        prefs.interface_preferences = payload.interface_preferences
    db.add(prefs)
    db.commit()
    db.refresh(prefs)
    return prefs
