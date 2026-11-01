from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import auth, chat, conversations, models, providers, settings as settings_router
from app.routers import rag as rag_router
from app.routers import memories as memories_router

settings = get_settings()

app = FastAPI(title="Nexus AI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,  # required for the session cookie to be sent cross-origin
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # Dev convenience: create tables if they don't exist. In production, use
    # Alembic migrations instead (see backend/alembic/) and remove/guard this.
    if not settings.is_production:
        Base.metadata.create_all(bind=engine)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}


app.include_router(auth.router)
app.include_router(providers.router)
app.include_router(models.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(settings_router.router)
app.include_router(rag_router.router)
app.include_router(memories_router.router)
