"""
Every provider adapter implements this interface. The rest of the app
(chat routing, model discovery) talks only to this interface, never to a
specific provider's SDK directly — that's what makes adding a new provider
a matter of writing one new adapter file, not touching the chat engine.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncGenerator


class ProviderError(Exception):
    """Raised for any provider-side failure. `status` maps to a connection_status value."""

    def __init__(self, message: str, status: str = "provider_unavailable"):
        super().__init__(message)
        self.message = message
        self.status = status  # invalid_key | auth_failed | rate_limited | provider_unavailable


def format_request_error(provider: str, exc: Exception) -> str:
    detail = str(exc).strip() or type(exc).__name__
    return f"Could not reach {provider}: {detail}"


@dataclass
class DiscoveredModel:
    provider_model_id: str
    display_name: str
    description: str | None = None
    context_length: int | None = None
    pricing_tier: str = "unknown"  # free | paid | unknown
    input_price_per_million: float | None = None
    output_price_per_million: float | None = None
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    supports_streaming: bool = True


@dataclass
class ChatChunk:
    """One piece of a streamed chat response."""

    delta: str = ""
    done: bool = False
    error: str | None = None


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


class ProviderAdapter(ABC):
    """
    Construct with the decrypted API key (and base_url for custom/self-hosted
    endpoints). Adapters must not log the key or include it in any exception
    message that might be surfaced to the client.
    """

    supports_model_discovery: bool = True

    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url

    @abstractmethod
    async def test_connection(self) -> bool:
        """Return True if the credential is valid. Raise ProviderError otherwise."""
        raise NotImplementedError

    @abstractmethod
    async def discover_models(self) -> list[DiscoveredModel]:
        """Return available models. Raise ProviderError on failure.
        If supports_model_discovery is False, return [] — callers fall back to manual registration."""
        raise NotImplementedError

    @abstractmethod
    async def stream_chat(
        self, model_id: str, messages: list[ChatMessage]
    ) -> AsyncGenerator[ChatChunk, None]:
        """Yield ChatChunk pieces as they arrive from the provider."""
        raise NotImplementedError
        yield  # pragma: no cover - makes this an async generator for type-checkers
