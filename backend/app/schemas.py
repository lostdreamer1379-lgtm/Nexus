from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

ProviderType = Literal["openrouter", "nvidia", "openai", "gemini", "anthropic", "custom"]


# ---------- Auth ----------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Provider connections ----------
class ProviderConnectionCreate(BaseModel):
    provider_type: ProviderType
    connection_name: str = Field(min_length=1, max_length=100)
    api_key: str = Field(min_length=1)
    base_url: str | None = None  # required for "custom"

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v, info):
        if info.data.get("provider_type") == "custom" and not v:
            raise ValueError("base_url is required for custom providers")
        return v


class ProviderConnectionUpdate(BaseModel):
    connection_name: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class ProviderConnectionOut(BaseModel):
    id: str
    provider_type: str
    connection_name: str
    base_url: str | None
    connection_status: str
    last_error: str | None
    last_verified_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Models ----------
class UserModelOut(BaseModel):
    id: str
    connection_id: str
    provider_model_id: str
    display_name: str
    description: str | None
    context_length: int | None
    pricing_tier: str
    input_price_per_million: float | None
    output_price_per_million: float | None
    supports_vision: bool | None
    supports_tools: bool | None
    supports_streaming: bool
    enabled: bool
    discovery_source: str
    last_discovered_at: datetime | None

    class Config:
        from_attributes = True


class UserModelCreate(BaseModel):
    connection_id: str
    provider_model_id: str
    display_name: str | None = None


class UserModelUpdate(BaseModel):
    display_name: str | None = None
    enabled: bool | None = None


# ---------- Conversations ----------
class ConversationCreate(BaseModel):
    title: str | None = None


class ConversationUpdate(BaseModel):
    title: str


class ConversationOut(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    model_display_name: str | None
    error: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut] = []


# ---------- Chat ----------
class ChatCompletionRequest(BaseModel):
    conversation_id: str | None = None  # None => create a new conversation
    model_id: str  # UserModel.id
    message: str = Field(min_length=1)
    # RAG: optional knowledge base to ground this message against
    kb_id: str | None = None
    web_search: bool = False
    agent_workflow: bool = False


# ---------- Settings ----------
class UserPreferenceOut(BaseModel):
    theme: str
    default_model_id: str | None
    interface_preferences: dict[str, Any]

    class Config:
        from_attributes = True


class UserPreferenceUpdate(BaseModel):
    theme: str | None = None
    default_model_id: str | None = None
    interface_preferences: dict[str, Any] | None = None
