"""
Embedding service for RAG.

Calls any OpenAI-compatible /embeddings endpoint using the API key from one
of the user's stored provider connections. Embeddings are serialised as
base64-encoded raw float32 bytes so they can be stored in a TEXT column
(SQLite and PostgreSQL both handle this fine at RAG scale; at very large scale
a dedicated vector store is the right move, but for a BYOK multi-user app
serving tens-of-thousands of chunks this approach is plenty).

Similarity search is cosine distance on numpy arrays, computed in Python.
For the number of chunks typical in a personal knowledge base (< 100 k) this
is fast enough that no FAISS or pgvector dependency is needed.
"""
from __future__ import annotations

import base64
import math
from typing import Sequence

import httpx
import numpy as np

from app.providers.openai_compatible import REQUEST_TIMEOUT

BATCH_SIZE = 256  # OpenAI and most compatible providers allow up to 2048; 256 is a safe default
GEMINI_BATCH_SIZE = 100


class EmbeddingError(Exception):
    pass


async def embed_texts(
    texts: list[str],
    api_key: str,
    base_url: str,
    model_id: str,
    provider_type: str = "openai",
) -> list[np.ndarray]:
    """
    Return one float32 unit-norm embedding per input text.
    Makes batched requests to stay within provider limits.
    """
    if not texts:
        return []

    all_embeddings: list[np.ndarray] = []

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        batch_size = GEMINI_BATCH_SIZE if provider_type == "gemini" else BATCH_SIZE
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            try:
                if provider_type == "gemini":
                    gemini_model = "gemini-embedding-001" if model_id.startswith("text-embedding-") else model_id
                    url = f"{base_url.rstrip('/')}/models/{gemini_model}:batchEmbedContents?key={api_key}"
                    payload = {
                        "requests": [
                            {
                                "model": f"models/{gemini_model}",
                                "content": {"parts": [{"text": text}]},
                            }
                            for text in batch
                        ]
                    }
                    resp = await client.post(url, json=payload)
                else:
                    url = base_url.rstrip("/") + "/embeddings"
                    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    payload = {"model": model_id, "input": batch}
                    resp = await client.post(url, headers=headers, json=payload)
            except httpx.RequestError as exc:
                raise EmbeddingError(f"Could not reach embedding endpoint: {exc}") from exc

            if resp.status_code != 200:
                try:
                    body = resp.json()
                    detail = body.get("error", {}).get("message", "") if isinstance(body, dict) else ""
                except Exception:
                    detail = ""
                if resp.status_code == 404:
                    detail = detail or (
                        f"The {provider_type} embedding model '{model_id}' or embedding endpoint "
                        "was not found. Check the provider connection and embedding model ID."
                    )
                raise EmbeddingError(
                    f"Embedding API returned HTTP {resp.status_code}"
                    + (f": {detail}" if detail else "")
                )

            body = resp.json()
            if provider_type == "gemini":
                embeddings = [item.get("values", []) for item in body.get("embeddings", [])]
            else:
                data = body.get("data", [])
                data.sort(key=lambda x: x["index"])
                embeddings = [item.get("embedding", []) for item in data]
            for embedding in embeddings:
                vec = np.array(embedding, dtype=np.float32)
                all_embeddings.append(_normalize(vec))

    return all_embeddings


def _normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def vec_to_blob(vec: np.ndarray) -> str:
    """Serialise a float32 numpy vector to a base64 string for TEXT storage."""
    return base64.b64encode(vec.astype(np.float32).tobytes()).decode()


def blob_to_vec(blob: str) -> np.ndarray:
    """Deserialise a base64 string back to a float32 numpy vector."""
    return np.frombuffer(base64.b64decode(blob), dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Both vectors are already unit-norm, so dot product == cosine similarity."""
    return float(np.dot(a, b))


def top_k_chunks(
    query_vec: np.ndarray,
    chunk_ids: list[str],
    chunk_blobs: list[str],
    k: int,
) -> list[tuple[str, float]]:
    """
    Return (chunk_id, score) pairs for the top-k most similar chunks.
    chunk_blobs are base64-encoded float32 byte strings (from the DB).
    """
    scored: list[tuple[str, float]] = []
    for cid, blob in zip(chunk_ids, chunk_blobs):
        if not blob:
            continue
        vec = blob_to_vec(blob)
        score = cosine_similarity(query_vec, vec)
        scored.append((cid, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
