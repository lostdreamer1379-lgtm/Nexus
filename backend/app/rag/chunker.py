"""
Recursive character text splitter.

Splits text into overlapping chunks by trying progressively smaller
separators: paragraph breaks → single newlines → sentences → words →
characters. This preserves semantic boundaries as much as possible without
requiring any NLP library.

This is the same strategy langchain's RecursiveCharacterTextSplitter uses,
implemented here as ~60 lines of pure Python so we don't need that dependency.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Chunk:
    index: int
    content: str


_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", " ", ""]


def split_text(
    text: str,
    chunk_size: int = 512,
    chunk_overlap: int = 64,
) -> list[Chunk]:
    """
    Split *text* into Chunk objects of at most *chunk_size* characters,
    with *chunk_overlap* characters of context carried into the next chunk.
    """
    if not text or not text.strip():
        return []

    raw = _split_recursive(text.strip(), chunk_size, _SEPARATORS)

    # Merge tiny fragments up to chunk_size, then slide the window with overlap.
    chunks: list[str] = []
    current = ""
    for piece in raw:
        if len(current) + len(piece) + 1 <= chunk_size:
            current = (current + " " + piece).strip() if current else piece
        else:
            if current:
                chunks.append(current)
            # Start the next chunk with overlap from the tail of the previous one.
            if chunk_overlap > 0 and current:
                tail = current[-chunk_overlap:]
                current = (tail + " " + piece).strip()
            else:
                current = piece

    if current:
        chunks.append(current)

    return [Chunk(index=i, content=c) for i, c in enumerate(chunks) if c.strip()]


def _split_recursive(text: str, chunk_size: int, separators: list[str]) -> list[str]:
    if len(text) <= chunk_size:
        return [text]

    sep = ""
    for candidate in separators:
        if candidate and candidate in text:
            sep = candidate
            break

    if not sep:
        # No separator found; hard-split by chunk_size.
        return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]

    parts = text.split(sep)
    result = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if len(part) <= chunk_size:
            result.append(part)
        else:
            # Recurse with the next smaller separator.
            next_seps = separators[separators.index(sep) + 1 :]
            result.extend(_split_recursive(part, chunk_size, next_seps or [""]))
    return result
