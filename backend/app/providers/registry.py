"""
Factory mapping a stored provider_type string to its adapter class, and a
helper that builds a ready-to-use adapter for a given ProviderConnection by
decrypting its credential. This is the ONLY place a credential is decrypted —
the decrypted value lives only in the local variable here and inside the
adapter instance for the duration of one request, never persisted or logged.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ProviderConnection
from app.providers.anthropic_provider import AnthropicAdapter
from app.providers.base import ProviderAdapter, ProviderError
from app.providers.custom import CustomProviderAdapter
from app.providers.gemini import GeminiAdapter
from app.providers.nvidia import NvidiaAdapter
from app.providers.openai_provider import OpenAIAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.security import decrypt_secret

_ADAPTER_CLASSES: dict[str, type[ProviderAdapter]] = {
    "openrouter": OpenRouterAdapter,
    "nvidia": NvidiaAdapter,
    "openai": OpenAIAdapter,
    "gemini": GeminiAdapter,
    "anthropic": AnthropicAdapter,
    "custom": CustomProviderAdapter,
}

SUPPORTED_PROVIDER_TYPES = list(_ADAPTER_CLASSES.keys())


def get_adapter_class(provider_type: str) -> type[ProviderAdapter]:
    cls = _ADAPTER_CLASSES.get(provider_type)
    if not cls:
        raise ValueError(f"Unsupported provider_type: {provider_type}")
    return cls


def build_adapter(connection: ProviderConnection) -> ProviderAdapter:
    """Decrypts the connection's stored credential and returns a ready adapter instance."""
    if not connection.credential:
        raise ProviderError("This connection has no stored credential.", status="invalid_key")
    adapter_cls = get_adapter_class(connection.provider_type)
    api_key = decrypt_secret(connection.credential.encrypted_secret)
    return adapter_cls(api_key=api_key, base_url=connection.base_url)


def build_adapter_from_key(provider_type: str, api_key: str, base_url: str | None) -> ProviderAdapter:
    """Used when validating a brand-new connection before it's saved."""
    adapter_cls = get_adapter_class(provider_type)
    return adapter_cls(api_key=api_key, base_url=base_url)
