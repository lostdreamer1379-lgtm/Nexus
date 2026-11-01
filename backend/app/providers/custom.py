"""
User-defined, self-hosted or third-party OpenAI-compatible endpoints
(local inference servers, other hosted gateways, etc.).

Because the user supplies the base_url themselves, this is the one adapter
that must defend against SSRF: a malicious or careless URL pointing at
internal infrastructure (localhost, private IP ranges, link-local/cloud
metadata addresses like 169.254.169.254) must be rejected before any
request is made.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from app.providers.base import ProviderError
from app.providers.openai_compatible import OpenAICompatibleAdapter

_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}


def validate_custom_base_url(raw_url: str) -> str:
    """Raises ValueError if the URL is unsafe. Returns the normalized URL otherwise."""
    parsed = urlparse(raw_url)

    if parsed.scheme not in ("https", "http"):
        raise ValueError("Base URL must start with http:// or https://")
    if not parsed.hostname:
        raise ValueError("Base URL must include a host")

    hostname = parsed.hostname.lower()
    if hostname in _BLOCKED_HOSTNAMES:
        raise ValueError("This host is not allowed for custom provider endpoints")

    # Resolve and reject private/loopback/link-local/reserved/cloud-metadata ranges.
    try:
        resolved_ips = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve host: {hostname}") from exc

    for ip_str in resolved_ips:
        ip = ipaddress.ip_address(ip_str)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip_str == "169.254.169.254"  # cloud metadata, belt-and-suspenders
        ):
            raise ValueError(
                "This address resolves to a private, local, or reserved network range, "
                "which is not allowed for custom provider endpoints"
            )

    if parsed.scheme == "http":
        # Loopback/private addresses are already rejected above, so any remaining http://
        # target is a public host — still require https for credentials-in-transit safety.
        raise ValueError("Custom endpoints must use HTTPS")

    return raw_url.rstrip("/")


class CustomProviderAdapter(OpenAICompatibleAdapter):
    provider_label = "Custom endpoint"

    def __init__(self, api_key: str, base_url: str | None = None):
        if not base_url:
            raise ProviderError("A base URL is required for custom providers.", status="invalid_key")
        super().__init__(api_key, base_url)
