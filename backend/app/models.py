import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    account_status: Mapped[str] = mapped_column(String, default="active")  # active | disabled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    provider_connections: Mapped[list["ProviderConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    models: Mapped[list["UserModel"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    preferences: Mapped["UserPreference"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class ProviderConnection(Base):
    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider_type: Mapped[str] = mapped_column(String)  # openrouter | nvidia | openai | gemini | anthropic | custom
    connection_name: Mapped[str] = mapped_column(String)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    connection_status: Mapped[str] = mapped_column(String, default="unverified")
    # unverified | connected | invalid_key | auth_failed | rate_limited | provider_unavailable | needs_revalidation
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship(back_populates="provider_connections")
    credential: Mapped["EncryptedCredential"] = relationship(
        back_populates="connection", cascade="all, delete-orphan", uselist=False
    )
    discovered_models: Mapped[list["UserModel"]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("user_id", "connection_name", name="uq_user_connection_name"),)


class EncryptedCredential(Base):
    __tablename__ = "encrypted_credentials"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("provider_connections.id", ondelete="CASCADE"), unique=True, index=True
    )
    encrypted_secret: Mapped[str] = mapped_column(Text)  # Fernet token (base64 ciphertext), never plaintext
    encryption_key_version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    connection: Mapped["ProviderConnection"] = relationship(back_populates="credential")


class UserModel(Base):
    """A model a user has registered/selected for use, tied to one of their provider connections."""

    __tablename__ = "user_models"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("provider_connections.id", ondelete="CASCADE"), index=True
    )
    provider_model_id: Mapped[str] = mapped_column(String)  # the ID the provider API expects
    display_name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_length: Mapped[int | None] = mapped_column(nullable=True)
    pricing_tier: Mapped[str] = mapped_column(String, default="unknown")  # free | paid | unknown
    input_price_per_million: Mapped[float | None] = mapped_column(nullable=True)
    output_price_per_million: Mapped[float | None] = mapped_column(nullable=True)
    supports_vision: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    supports_tools: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    discovery_source: Mapped[str] = mapped_column(String, default="manual")  # discovered | manual
    last_discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship(back_populates="models")
    connection: Mapped["ProviderConnection"] = relationship(back_populates="discovered_models")

    __table_args__ = (
        UniqueConstraint("connection_id", "provider_model_id", name="uq_connection_model"),
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String)  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(String, ForeignKey("user_models.id", ondelete="SET NULL"), nullable=True)
    model_display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    provider_connection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    theme: Mapped[str] = mapped_column(String, default="dark")
    default_model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    interface_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship(back_populates="preferences")


class UserMemory(Base):
    __tablename__ = "user_memories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String, default="fact")
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | approved | archived
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    source_conversation_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    last_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# ─────────────────────────── RAG ───────────────────────────

class KnowledgeBase(Base):
    """A named collection of documents belonging to one user."""
    __tablename__ = "knowledge_bases"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The connection + model used to create embeddings for this KB.
    # Can be any OpenAI-compatible embedding endpoint.
    embedding_connection_id: Mapped[str | None] = mapped_column(String, ForeignKey("provider_connections.id", ondelete="SET NULL"), nullable=True)
    embedding_model_id: Mapped[str] = mapped_column(String, default="text-embedding-3-small")
    embedding_dim: Mapped[int | None] = mapped_column(Integer, nullable=True)  # filled on first embed
    chunk_size: Mapped[int] = mapped_column(Integer, default=512)
    chunk_overlap: Mapped[int] = mapped_column(Integer, default=64)
    # top-k chunks to inject per query
    retrieval_k: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    user: Mapped["User"] = relationship()
    documents: Mapped[list["KBDocument"]] = relationship(back_populates="knowledge_base", cascade="all, delete-orphan")
    embedding_connection: Mapped["ProviderConnection"] = relationship(foreign_keys=[embedding_connection_id])

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_user_kb_name"),)


class KBDocument(Base):
    """One uploaded file inside a KnowledgeBase."""
    __tablename__ = "kb_documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String)
    # where the raw file lives on disk relative to the RAG upload root
    file_path: Mapped[str] = mapped_column(String)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String, default="text/plain")
    status: Mapped[str] = mapped_column(String, default="pending")
    # pending | processing | ready | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    knowledge_base: Mapped["KnowledgeBase"] = relationship(back_populates="documents")
    chunks: Mapped[list["KBChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class KBChunk(Base):
    """One text chunk from a document, with its embedding stored as a binary blob."""
    __tablename__ = "kb_chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(String, ForeignKey("kb_documents.id", ondelete="CASCADE"), index=True)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    # numpy float32 array serialised as raw bytes; loaded with np.frombuffer
    embedding: Mapped[bytes | None] = mapped_column(Text, nullable=True)  # base64-encoded float32 bytes

    document: Mapped["KBDocument"] = relationship(back_populates="chunks")


class DocumentComparison(Base):
    __tablename__ = "document_comparisons"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    document_a_id: Mapped[str] = mapped_column(String, ForeignKey("kb_documents.id", ondelete="CASCADE"))
    document_b_id: Mapped[str] = mapped_column(String, ForeignKey("kb_documents.id", ondelete="CASCADE"))
    model_id: Mapped[str] = mapped_column(String, ForeignKey("user_models.id", ondelete="SET NULL"), nullable=True)
    report: Mapped[str] = mapped_column(Text)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="ready")  # ready | stale
    document_a_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    document_b_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class KnowledgeGraphNode(Base):
    __tablename__ = "knowledge_graph_nodes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String)
    node_type: Mapped[str] = mapped_column(String, default="concept")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_document_id: Mapped[str | None] = mapped_column(String, ForeignKey("kb_documents.id", ondelete="SET NULL"), nullable=True)


class KnowledgeGraphEdge(Base):
    __tablename__ = "knowledge_graph_edges"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    source_node_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"))
    target_node_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_graph_nodes.id", ondelete="CASCADE"))
    relationship: Mapped[str] = mapped_column(String)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)


class KBFact(Base):
    __tablename__ = "kb_facts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kb_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String)
    predicate: Mapped[str] = mapped_column(String)
    object: Mapped[str] = mapped_column(String)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active | conflict | stale | dismissed
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    source_document_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("kb_documents.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# Add RAG relationships to User (extend without touching the existing class body)
User.knowledge_bases = relationship("KnowledgeBase", back_populates="user", cascade="all, delete-orphan", foreign_keys=[KnowledgeBase.user_id])
