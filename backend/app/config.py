"""
Application configuration.

Everything here is INFRASTRUCTURE config — database location, the secret used
to sign sessions, and the key used to encrypt user-supplied provider API
keys at rest. It deliberately does NOT contain any AI provider API key: in
Nexus AI, provider keys belong to individual users, are entered through the
Provider Manager UI once the app is running, and are stored encrypted per-user
in the database (see app/security.py and app/models.py). A single shared
.env cannot hold "the" OpenRouter key or "the" NVIDIA key because there isn't
one — every user brings their own.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Environment ---
    ENVIRONMENT: str = "development"  # "development" | "production"

    # --- Database ---
    # Dev default: SQLite file. Prod: postgresql+psycopg2://user:pass@host:5432/dbname
    DATABASE_URL: str = "sqlite:///./nexus.db"

    # --- Auth / sessions ---
    # Random 64+ char string. Generate with: python -c "import secrets; print(secrets.token_urlsafe(64))"
    SECRET_KEY: str = "CHANGE_ME_DEV_ONLY_INSECURE_SECRET_KEY"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 14  # 14 days
    SESSION_COOKIE_NAME: str = "nexus_session"

    # --- Credential encryption ---
    # 32-byte urlsafe-base64 Fernet key. Generate with:
    # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # In production, this should come from a managed KMS / secret manager, never checked into git.
    ENCRYPTION_KEY: str = "CHANGE_ME__GENERATE_A_REAL_FERNET_KEY__CHANGE_ME="

    # --- CORS ---
    # The exact origin(s) of your deployed frontend, comma separated.
    # Must NOT be "*" because we use cookies (allow_credentials requires an explicit origin).
    CORS_ORIGINS: str = "http://localhost:5173"

    # --- Cookies ---
    # In production (cross-site: Vercel frontend + Render backend) cookies must be
    # SameSite=None; Secure so the browser will send them cross-origin over HTTPS.
    COOKIE_SECURE: bool = False  # set True in production (.env on your host)
    COOKIE_SAMESITE: str = "lax"  # set to "none" in production

    # --- RAG / file uploads ---
    # Where uploaded documents are stored. In production, swap for a mounted
    # persistent volume or an object-storage path (S3, R2, etc.).
    RAG_UPLOAD_DIR: str = "./rag_uploads"
    RAG_MAX_FILE_MB: int = 50  # per-file upload limit in megabytes

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def rag_upload_path(self):
        import pathlib
        p = pathlib.Path(self.RAG_UPLOAD_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
