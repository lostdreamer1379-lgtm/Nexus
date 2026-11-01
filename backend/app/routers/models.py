from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ProviderConnection, User, UserModel
from app.schemas import UserModelCreate, UserModelOut, UserModelUpdate

router = APIRouter(prefix="/api/v1/models", tags=["models"])


@router.get("", response_model=list[UserModelOut])
def list_models(
    enabled_only: bool = Query(False),
    pricing: str | None = Query(None, pattern="^(free|paid|unknown)$"),
    connection_id: str | None = Query(None),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(UserModel).filter(UserModel.user_id == current_user.id)
    if enabled_only:
        q = q.filter(UserModel.enabled.is_(True))
    if pricing:
        q = q.filter(UserModel.pricing_tier == pricing)
    if connection_id:
        q = q.filter(UserModel.connection_id == connection_id)
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(UserModel.display_name.ilike(like))
    return q.order_by(UserModel.display_name).all()


def _get_owned_model(db: Session, model_id: str, user: User) -> UserModel:
    model = db.get(UserModel, model_id)
    if not model or model.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return model


@router.post("", response_model=UserModelOut, status_code=status.HTTP_201_CREATED)
def register_model(payload: UserModelCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.get(ProviderConnection, payload.connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider connection not found")

    existing = (
        db.query(UserModel)
        .filter(UserModel.connection_id == conn.id, UserModel.provider_model_id == payload.provider_model_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This model is already registered for this connection")

    model = UserModel(
        user_id=current_user.id,
        connection_id=conn.id,
        provider_model_id=payload.provider_model_id,
        display_name=payload.display_name or payload.provider_model_id,
        pricing_tier="unknown",
        discovery_source="manual",
        enabled=True,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.patch("/{model_id}", response_model=UserModelOut)
def update_model(model_id: str, payload: UserModelUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model = _get_owned_model(db, model_id, current_user)
    if payload.display_name is not None:
        model.display_name = payload.display_name
    if payload.enabled is not None:
        model.enabled = payload.enabled
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model = _get_owned_model(db, model_id, current_user)
    # Deleting a model selection never touches the provider connection itself —
    # these are intentionally separate operations (spec section 8).
    db.delete(model)
    db.commit()
    return None
