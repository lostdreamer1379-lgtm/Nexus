"""
Google Gemini. Uses the Generative Language API, which differs from the
OpenAI shape: API key as a query param, "contents" instead of "messages",
roles "user"/"model" instead of "user"/"assistant", and SSE-ish streaming
via the :streamGenerateContent endpoint with ?alt=sse.
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

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiAdapter(ProviderAdapter):
    provider_label = "Google Gemini"

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or GEMINI_BASE_URL)

    def _url(self, path: str) -> str:
        sep = "&" if "?" in path else "?"
        return f"{self.base_url.rstrip('/')}/{path}{sep}key={self.api_key}"

    @staticmethod
    def _map_http_error(resp: httpx.Response) -> ProviderError:
        if resp.status_code in (400, 401, 403):
            return ProviderError("Invalid or unauthorized API key.", status="invalid_key")
        if resp.status_code == 429:
            return ProviderError("Rate limited by Google. Try again shortly.", status="rate_limited")
        if resp.status_code >= 500:
            return ProviderError("Gemini is currently unavailable.", status="provider_unavailable")
        return ProviderError(f"Gemini returned HTTP {resp.status_code}.", status="provider_unavailable")

    async def test_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(self._url("models"))
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error("Gemini", exc), status="provider_unavailable") from exc
        if resp.status_code != 200:
            raise self._map_http_error(resp)
        return True

    async def discover_models(self) -> list[DiscoveredModel]:
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.get(self._url("models"))
        except httpx.RequestError as exc:
            raise ProviderError(format_request_error("Gemini", exc), status="provider_unavailable") from exc
        if resp.status_code != 200:
            raise self._map_http_error(resp)

        data = resp.json()
        out = []
        for m in data.get("models", []):
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" not in methods:
                continue
            name = m.get("name", "").removeprefix("models/")
            out.append(
                DiscoveredModel(
                    provider_model_id=name,
                    display_name=m.get("displayName") or name,
                    description=m.get("description"),
                    context_length=m.get("inputTokenLimit"),
                    pricing_tier="unknown",
                    supports_vision=None,
                    supports_tools=None,
                    supports_streaming=True,
                )
            )
        return out

    async def stream_chat(
        self, model_id: str, messages: list[ChatMessage]
    ) -> AsyncGenerator[ChatChunk, None]:
        # Gemini has no "system" role in contents; fold any system messages into
        # a systemInstruction and map user/assistant -> user/model.
        system_parts = [m.content for m in messages if m.role == "system"]
        contents = [
            {"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]}
            for m in messages
            if m.role != "system"
        ]
        payload: dict = {"contents": contents}
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_parts)}]}

        path = f"models/{model_id}:streamGenerateContent?alt=sse"
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                async with client.stream("POST", self._url(path), json=payload) as resp:
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
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        candidates = chunk.get("candidates", [])
                        if not candidates:
                            continue
                        parts = candidates[0].get("content", {}).get("parts", [])
                        text = "".join(p.get("text", "") for p in parts)
                        if text:
                            yield ChatChunk(delta=text)
                    yield ChatChunk(done=True)
        except httpx.RequestError as exc:
            yield ChatChunk(error=format_request_error("Gemini", exc), done=True)
