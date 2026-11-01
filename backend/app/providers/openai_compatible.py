"""
Shared logic for any provider that speaks the OpenAI Chat Completions API
shape: POST {base_url}/chat/completions with SSE streaming, and
GET {base_url}/models for discovery. OpenRouter, NVIDIA NIM, OpenAI itself,
and user-defined custom endpoints are all (close enough to) this shape.
Provider-specific quirks are handled by overriding methods in subclasses.
"""
from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx

from app.providers.base import (
    ChatChunk,
    ChatMessage,
    DiscoveredModel,
    ProviderAdapter,
    ProviderError,
    format_request_error,
)

REQUEST_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
STREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=180.0, write=10.0, pool=10.0)


def _new_stream_text(previous: str, received: str) -> str:
    """Convert cumulative or overlapping provider chunks into new text only."""
    if not received:
        return ""
    if not previous:
        return received
    if received.startswith(previous):
        return received[len(previous):]
    # Short chunks are commonly valid text on their own (for example the
    # second zero in "₹2,000"). Never drop them just because they match the
    # end of the accumulated response.
    if len(received) >= 4 and previous.endswith(received):
        return ""

    max_overlap = min(len(previous), len(received))
    for size in range(max_overlap, 0, -1):
        # Only remove a substantial overlap. Smaller overlaps can be normal
        # token boundaries and removing them corrupts words and numbers.
        if size >= 4 and size * 2 >= len(received) and previous.endswith(received[:size]):
            return received[size:]
    return received


class OpenAICompatibleAdapter(ProviderAdapter):
    provider_label = "OpenAI-compatible"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _models_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/models"

    def _chat_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"

    @staticmethod
    def _map_http_error(resp: httpx.Response) -> ProviderError:
        if resp.status_code == 401:
            return ProviderError("Invalid API key.", status="invalid_key")
        if resp.status_code == 403:
            return ProviderError("Authentication failed for this key.", status="auth_failed")
        if resp.status_code == 429:
            return ProviderError("Rate limited by the provider. Try again shortly.", status="rate_limited")
        if resp.status_code >= 500:
            return ProviderError("The provider is currently unavailable.", status="provider_unavailable")
        return ProviderError(f"Provider returned HTTP {resp.status_code}.", status="provider_unavailable")

    @staticmethod
    def _response_detail(resp: httpx.Response) -> str | None:
        try:
            data = resp.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        error = data.get("error")
        if isinstance(error, dict):
            return error.get("message") or error.get("detail")
        return data.get("detail") or data.get("message")

    async def test_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(self._models_url(), headers=self._headers())
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error(self.provider_label, exc), status="provider_unavailable") from exc

        if resp.status_code == 200:
            return True
        if resp.status_code in (401, 403, 404):
            # Some OpenAI-compatible providers 404 /models but still accept chat requests.
            # Treat 404 here as "discovery unsupported", not "key invalid".
            if resp.status_code == 404:
                return True
            raise self._map_http_error(resp)
        raise self._map_http_error(resp)

    async def discover_models(self) -> list[DiscoveredModel]:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(self._models_url(), headers=self._headers())
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error(self.provider_label, exc), status="provider_unavailable") from exc

        if resp.status_code == 404:
            return []  # discovery not supported by this endpoint; caller falls back to manual registration
        if resp.status_code != 200:
            raise self._map_http_error(resp)

        data = resp.json()
        raw_models = data.get("data", data if isinstance(data, list) else [])
        return [self._parse_model(m) for m in raw_models]

    def _parse_model(self, raw: dict) -> DiscoveredModel:
        """Default OpenAI-shape parser. Subclasses override for provider-specific metadata."""
        model_id = raw.get("id", "")
        return DiscoveredModel(
            provider_model_id=model_id,
            display_name=raw.get("name") or model_id,
            description=raw.get("description"),
            context_length=raw.get("context_length"),
            pricing_tier="unknown",
            supports_streaming=True,
        )

    async def stream_chat(
        self, model_id: str, messages: list[ChatMessage]
    ) -> AsyncGenerator[ChatChunk, None]:
        payload = {
            "model": model_id,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
        }
        try:
            async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
                async with client.stream(
                    "POST", self._chat_url(), headers=self._headers(), json=payload
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        try:
                            detail = json.loads(body).get("error", {}).get("message")
                        except (TypeError, ValueError, AttributeError):
                            detail = None
                        err = self._map_http_error(resp)
                        detail = detail or self._response_detail(resp)
                        if (
                            self.provider_label == "NVIDIA NIM"
                            and resp.status_code == 404
                            and detail
                            and "function" in detail.lower()
                            and "not found for account" in detail.lower()
                        ):
                            detail = (
                                "NVIDIA denied access to this model for the current account. "
                                "Enable Public API Endpoints or request access to the model in the "
                                "NVIDIA Developer portal, then refresh the provider connection."
                            )
                        if resp.status_code == 404:
                            detail = (
                                detail
                                or f"Endpoint or model was not found at {self._chat_url()}. "
                                "Check the provider base URL and exact model ID."
                            )
                        yield ChatChunk(error=detail or err.message, done=True)
                        return

                    assembled = ""
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[len("data:"):].strip()
                        if data_str == "[DONE]":
                            yield ChatChunk(done=True)
                            return
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {}).get("content", "")
                        new_text = _new_stream_text(assembled, delta)
                        if new_text:
                            assembled += new_text
                            yield ChatChunk(delta=new_text)
                    yield ChatChunk(done=True)
        except httpx.RequestError as exc:
            yield ChatChunk(error=format_request_error(self.provider_label, exc), done=True)
