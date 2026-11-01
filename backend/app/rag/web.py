"""Small, keyless web retrieval layer for web-connected RAG."""
from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx

from app.providers.openai_compatible import REQUEST_TIMEOUT


@dataclass
class WebResult:
    title: str
    url: str
    content: str


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip:
            text = " ".join(data.split())
            if text:
                self.parts.append(text)


def _page_text(html: str) -> str:
    parser = _TextParser()
    parser.feed(html)
    return " ".join(parser.parts)


def _search_urls(html: str) -> list[tuple[str, str]]:
    parser = _SearchParser()
    parser.feed(html)
    return parser.results


class _SearchParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[tuple[str, str]] = []
        self._title = ""
        self._href = ""
        self._in_result = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "a" and "result__a" in (attrs_dict.get("class") or ""):
            self._in_result = True
            self._title = ""
            self._href = attrs_dict.get("href") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_result:
            url = self._href
            if url.startswith("//duckduckgo.com/l/?"):
                url = unquote(parse_qs(urlparse(url).query).get("uddg", [""])[0])
            if url.startswith("http") and self._title:
                self.results.append((self._title, url))
            self._in_result = False

    def handle_data(self, data: str) -> None:
        if self._in_result:
            self._title += " ".join(data.split())


async def search_web(query: str, limit: int = 3) -> list[WebResult]:
    headers = {"User-Agent": "NexusAI/1.0 (+web-rag)"}
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True, headers=headers) as client:
        response = await client.get(search_url)
        response.raise_for_status()
        candidates = _search_urls(response.text)[:limit]
        results: list[WebResult] = []
        for title, url in candidates:
            try:
                page = await client.get(url)
                page.raise_for_status()
                content = _page_text(page.text)[:6000]
                if content:
                    results.append(WebResult(title=title, url=url, content=content))
            except httpx.HTTPError:
                continue
    return results
