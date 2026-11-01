from app.providers.base import DiscoveredModel
from app.providers.openai_compatible import OpenAICompatibleAdapter

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"


class NvidiaAdapter(OpenAICompatibleAdapter):
    """
    NVIDIA NIM. Base URL: https://integrate.api.nvidia.com/v1
    NIM's hosted catalog endpoint does not reliably expose per-token pricing or
    capability metadata the way OpenRouter does, so pricing/capabilities are
    left "unknown" rather than guessed — an open-weight model (e.g. a Nemotron
    variant) being free to download does NOT mean hosted inference through NIM
    is free; NVIDIA's own current terms determine that, not this app.
    Model discovery works where NVIDIA exposes it; where it 404s, users can
    register a model ID manually (NVIDIA publishes current model IDs in their
    own docs/catalog — verify there, since IDs change over time).
    """

    provider_label = "NVIDIA NIM"
    supports_model_discovery = True

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or NVIDIA_BASE_URL)

    def _parse_model(self, raw: dict) -> DiscoveredModel:
        model_id = raw.get("id", "")
        return DiscoveredModel(
            provider_model_id=model_id,
            display_name=model_id,
            description=None,
            context_length=None,
            pricing_tier="unknown",
            supports_vision=None,
            supports_tools=None,
            supports_streaming=True,
        )
