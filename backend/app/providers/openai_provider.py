from app.providers.base import DiscoveredModel
from app.providers.openai_compatible import OpenAICompatibleAdapter

OPENAI_BASE_URL = "https://api.openai.com/v1"

# OpenAI's /models endpoint lists every model the account can see but does not
# return pricing or capability metadata, so those stay "unknown" here too —
# users can check OpenAI's published pricing page themselves, and we don't
# want to hardcode numbers that go stale.
_KNOWN_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt-")


class OpenAIAdapter(OpenAICompatibleAdapter):
    provider_label = "OpenAI"

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or OPENAI_BASE_URL)

    async def discover_models(self):
        models = await super().discover_models()
        # OpenAI's /models includes embeddings, TTS, moderation, etc. — filter to
        # plausible chat-capable models so the picker isn't cluttered. This is a
        # heuristic on the ID string, not a hardcoded catalogue: new gpt-* / o*
        # model families show up automatically without a code change.
        return [m for m in models if m.provider_model_id.startswith(_KNOWN_CHAT_PREFIXES)]

    def _parse_model(self, raw: dict) -> DiscoveredModel:
        model_id = raw.get("id", "")
        return DiscoveredModel(
            provider_model_id=model_id,
            display_name=model_id,
            pricing_tier="unknown",
            supports_streaming=True,
        )
