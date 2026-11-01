from app.providers.base import DiscoveredModel
from app.providers.openai_compatible import OpenAICompatibleAdapter

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterAdapter(OpenAICompatibleAdapter):
    """
    OpenRouter. Base URL: https://openrouter.ai/api/v1
    OpenRouter's /models response includes real per-token pricing, which lets us
    classify free vs. paid reliably — many OpenRouter model IDs end in ':free'.
    """

    provider_label = "OpenRouter"

    def __init__(self, api_key: str, base_url: str | None = None):
        super().__init__(api_key, base_url or OPENROUTER_BASE_URL)

    def _parse_model(self, raw: dict) -> DiscoveredModel:
        model_id = raw.get("id", "")
        pricing = raw.get("pricing", {}) or {}

        def _to_float(x):
            try:
                return float(x)
            except (TypeError, ValueError):
                return None

        prompt_price = _to_float(pricing.get("prompt"))  # USD per token, per OpenRouter docs
        completion_price = _to_float(pricing.get("completion"))

        is_free_id = model_id.endswith(":free")
        is_zero_cost = prompt_price == 0 and completion_price == 0
        if is_free_id or is_zero_cost:
            tier = "free"
        elif prompt_price is not None and completion_price is not None:
            tier = "paid"
        else:
            tier = "unknown"

        top_provider = raw.get("top_provider", {}) or {}
        architecture = raw.get("architecture", {}) or {}
        modality = architecture.get("input_modalities") or architecture.get("modality") or []

        return DiscoveredModel(
            provider_model_id=model_id,
            display_name=raw.get("name") or model_id,
            description=raw.get("description"),
            context_length=raw.get("context_length") or top_provider.get("context_length"),
            pricing_tier=tier,
            input_price_per_million=(prompt_price * 1_000_000) if prompt_price is not None else None,
            output_price_per_million=(completion_price * 1_000_000) if completion_price is not None else None,
            supports_vision="image" in modality if isinstance(modality, list) else None,
            supports_tools=bool(raw.get("supported_parameters") and "tools" in raw.get("supported_parameters", [])),
            supports_streaming=True,
        )
