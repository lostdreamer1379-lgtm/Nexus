from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import EncryptedCredential, ProviderConnection, User, UserModel
from app.providers.base import ProviderError
from app.providers.custom import validate_custom_base_url
from app.providers.registry import SUPPORTED_PROVIDER_TYPES, build_adapter, build_adapter_from_key
from app.schemas import (
    ProviderConnectionCreate,
    ProviderConnectionOut,
    ProviderConnectionUpdate,
    UserModelOut,
)
from app.security import encrypt_secret

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


@router.get("", response_model=list[str])
def list_supported_provider_types():
    """The provider TYPES Nexus AI knows how to talk to (not the user's connections)."""
    return SUPPORTED_PROVIDER_TYPES


def _get_owned_connection(db: Session, connection_id: str, user: User) -> ProviderConnection:
    conn = db.get(ProviderConnection, connection_id)
    # Ownership check: a connection is only visible/usable if it belongs to the
    # authenticated user. Returning 404 (not 403) avoids confirming the ID exists at all.
    if not conn or conn.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provider connection not found")
    return conn


@router.post("/connections", response_model=ProviderConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ProviderConnectionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    base_url = payload.base_url
    if payload.provider_type == "custom":
        try:
            base_url = validate_custom_base_url(payload.base_url)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conn = ProviderConnection(
        user_id=current_user.id,
        provider_type=payload.provider_type,
        connection_name=payload.connection_name,
        base_url=base_url,
        connection_status="unverified",
    )
    db.add(conn)
    db.flush()
    db.add(EncryptedCredential(connection_id=conn.id, encrypted_secret=encrypt_secret(payload.api_key)))
    db.commit()
    db.refresh(conn)

    # Immediately validate so the user gets fast feedback instead of discovering
    # a bad key only when they try to chat.
    await _validate_and_update_status(db, conn)
    db.refresh(conn)
    return conn


async def _validate_and_update_status(db: Session, conn: ProviderConnection) -> None:
    try:
        adapter = build_adapter(conn)
        await adapter.test_connection()
        conn.connection_status = "connected"
        conn.last_error = None
        conn.last_verified_at = datetime.now(timezone.utc)
    except ProviderError as exc:
        conn.connection_status = exc.status
        conn.last_error = exc.message
    except Exception as exc:  # noqa: BLE001 - surfaced as a generic status, never silently swallowed
        conn.connection_status = "provider_unavailable"
        conn.last_error = "Unexpected error while validating this connection."
    db.add(conn)
    db.commit()


@router.get("/connections", response_model=list[ProviderConnectionOut])
def list_connections(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(ProviderConnection)
        .filter(ProviderConnection.user_id == current_user.id)
        .order_by(ProviderConnection.created_at.desc())
        .all()
    )


@router.get("/connections/{connection_id}", response_model=ProviderConnectionOut)
def get_connection(connection_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_owned_connection(db, connection_id, current_user)


@router.patch("/connections/{connection_id}", response_model=ProviderConnectionOut)
async def update_connection(
    connection_id: str,
    payload: ProviderConnectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conn = _get_owned_connection(db, connection_id, current_user)

    if payload.connection_name is not None:
        conn.connection_name = payload.connection_name

    if payload.base_url is not None:
        if conn.provider_type == "custom":
            try:
                conn.base_url = validate_custom_base_url(payload.base_url)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        else:
            conn.base_url = payload.base_url

    revalidate = False
    if payload.api_key is not None:
        conn.credential.encrypted_secret = encrypt_secret(payload.api_key)
        revalidate = True

    conn.connection_status = "needs_revalidation" if revalidate else conn.connection_status
    db.add(conn)
    db.commit()
    db.refresh(conn)

    if revalidate:
        await _validate_and_update_status(db, conn)
        db.refresh(conn)

    return conn


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = _get_owned_connection(db, connection_id, current_user)
    # Cascades delete the credential and any models discovered through this connection
    # (see models.py relationships) but never touches unrelated conversations/messages —
    # messages keep a denormalized model_display_name so history still reads fine afterward.
    db.delete(conn)
    db.commit()
    return None


@router.post("/connections/{connection_id}/test", response_model=ProviderConnectionOut)
async def test_connection(connection_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = _get_owned_connection(db, connection_id, current_user)
    await _validate_and_update_status(db, conn)
    db.refresh(conn)
    return conn


@router.post("/connections/{connection_id}/models/refresh", response_model=list[UserModelOut])
async def refresh_models(connection_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = _get_owned_connection(db, connection_id, current_user)

    try:
        adapter = build_adapter(conn)
        discovered = await adapter.discover_models()
    except ProviderError as exc:
        conn.connection_status = exc.status
        conn.last_error = exc.message
        db.add(conn)
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc

    now = datetime.now(timezone.utc)
    existing_by_pid = {
        m.provider_model_id: m
        for m in db.query(UserModel).filter(UserModel.connection_id == conn.id).all()
    }

    result: list[UserModel] = []
    for dm in discovered:
        existing = existing_by_pid.get(dm.provider_model_id)
        if existing:
            existing.description = dm.description
            existing.context_length = dm.context_length
            existing.pricing_tier = dm.pricing_tier
            existing.input_price_per_million = dm.input_price_per_million
            existing.output_price_per_million = dm.output_price_per_million
            existing.supports_vision = dm.supports_vision
            existing.supports_tools = dm.supports_tools
            existing.supports_streaming = dm.supports_streaming
            existing.discovery_source = "discovered"
            existing.last_discovered_at = now
            result.append(existing)
        else:
            new_model = UserModel(
                user_id=current_user.id,
                connection_id=conn.id,
                provider_model_id=dm.provider_model_id,
                display_name=dm.display_name,
                description=dm.description,
                context_length=dm.context_length,
                pricing_tier=dm.pricing_tier,
                input_price_per_million=dm.input_price_per_million,
                output_price_per_million=dm.output_price_per_million,
                supports_vision=dm.supports_vision,
                supports_tools=dm.supports_tools,
                supports_streaming=dm.supports_streaming,
                enabled=False,  # discovered but not yet selected by the user
                discovery_source="discovered",
                last_discovered_at=now,
            )
            db.add(new_model)
            result.append(new_model)

    conn.connection_status = "connected"
    conn.last_verified_at = now
    db.add(conn)
    db.commit()
    for m in result:
        db.refresh(m)
    return result
