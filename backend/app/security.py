"""
Security primitives:
  - Argon2id password hashing for user accounts.
  - Fernet (AES-128-CBC + HMAC, authenticated encryption) for provider API keys at rest.
  - JWT, delivered as an HttpOnly cookie, for session identity.

None of this ever logs or returns a raw secret. Decrypted provider API keys
exist only transiently inside the request that needs them (see
providers/registry.py) and are never persisted or echoed back to the client.
"""
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

JWT_ALGORITHM = "HS256"


# ---------- Passwords ----------
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


# ---------- Credential encryption ----------
def _fernet() -> Fernet:
    key = settings.ENCRYPTION_KEY.encode()
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a provider API key for storage. Returns a base64 token, safe for a TEXT column."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a stored provider API key. Raises ValueError if the token is invalid/tampered."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Credential could not be decrypted — it may be corrupted or the encryption key changed") from exc


def mask_secret(plaintext_hint_len: int = 4) -> str:
    """Never used on real secrets server-side for responses — the frontend never receives a key at all.
    This exists only for display purposes if ever needed (e.g. 'Last 4: ****1234') and is not currently
    wired to any endpoint, since connections are shown by name/status, not by key fragment."""
    return "•" * 8


# ---------- Session JWTs ----------
def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None
