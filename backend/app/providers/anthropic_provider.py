"""
Anthropic. Uses the Messages API: x-api-key header (not Bearer), a top-level
"system" field instead of a system role inside messages, SSE streaming with
named event types (content_block_delta, message_stop, etc.), and no public,
unauthenticated model-list endpoint — so discovery falls back to manual
registration with a short list of well-known current model ID *hints* shown
in the frontend copy, not hardcoded as a catalogue here.
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
from app.providers.openai_compatible import REQUEST_TIMEOUT

ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"


class AnthropicAdapter(ProviderAdapter):
    provider_label = "Anthropic"
    supports_model_discovery = True  # Anthropic does expose GET /v1/models; handled below

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or ANTHROPIC_BASE_URL)

    def _headers(self) -> dict:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    @staticmethod
    def _map_http_error(resp: httpx.Response) -> ProviderError:
        if resp.status_code == 401:
            return ProviderError("Invalid API key.", status="invalid_key")
        if resp.status_code == 403:
            return ProviderError("Authentication failed for this key.", status="auth_failed")
        if resp.status_code == 429:
            return ProviderError("Rate limited by Anthropic. Try again shortly.", status="rate_limited")
        if resp.status_code >= 500:
            return ProviderError("Anthropic is currently unavailable.", status="provider_unavailable")
        return ProviderError(f"Anthropic returned HTTP {resp.status_code}.", status="provider_unavailable")

    async def test_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(f"{self.base_url}/models", headers=self._headers())
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error("Anthropic", exc), status="provider_unavailable") from exc
        if resp.status_code != 200:
            raise self._map_http_error(resp)
        return True

    async def discover_models(self) -> list[DiscoveredModel]:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(f"{self.base_url}/models", headers=self._headers())
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error("Anthropic", exc), status="provider_unavailable") from exc
        if resp.status_code != 200:
            raise self._map_http_error(resp)

        data = resp.json()
        out = []
        for m in data.get("data", []):
            model_id = m.get("id", "")
            out.append(
                DiscoveredModel(
                    provider_model_id=model_id,
                    display_name=m.get("display_name") or model_id,
                    pricing_tier="unknown",
                    supports_vision=None,
                    supports_tools=True,
                    supports_streaming=True,
                )
            )
        return out

    async def stream_chat(
        self, model_id: str, messages: list[ChatMessage]
    ) -> AsyncGenerator[ChatChunk, None]:
        system_text = "\n".join(m.content for m in messages if m.role == "system") or None
        chat_messages = [
            {"role": m.role, "content": m.content} for m in messages if m.role in ("user", "assistant")
        ]
        payload = {
            "model": model_id,
            "max_tokens": 4096,
            "messages": chat_messages,
            "stream": True,
        }
        if system_text:
            payload["system"] = system_text

        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/messages", headers=self._headers(), json=payload
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        try:
                            detail = json.loads(body).get("error", {}).get("message")
                        except Exception:
                            detail = None
                        err = self._map_http_error(resp)
                        yield ChatChunk(error=detail or err.message, done=True)
                        return

                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[len("data:"):].strip()
                        if not data_str:
                            continue
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        etype = event.get("type")
                        if etype == "content_block_delta":
                            text = event.get("delta", {}).get("text", "")
                            if text:
                                yield ChatChunk(delta=text)
                        elif etype == "message_stop":
                            yield ChatChunk(done=True)
                            return
                    yield ChatChunk(done=True)
        except httpx.RequestError as exc:
            yield ChatChunk(error=format_request_error("Anthropic", exc), done=True)
