"""
RAG tests. No real embedding API calls — embeddings are mocked throughout.
No real file parsing needed for most tests — text content is injected directly.
"""
import base64
import io
import pathlib
import tempfile
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest


# ──────────────────────────────────────────────
# Chunker
# ──────────────────────────────────────────────

def test_chunker_basic():
    from app.rag.chunker import split_text

    text = "Hello world. " * 60  # 780 chars
    chunks = split_text(text, chunk_size=200, chunk_overlap=40)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c.content) <= 210  # small tolerance for split boundaries
    assert chunks[0].index == 0


def test_chunker_empty_text():
    from app.rag.chunker import split_text

    assert split_text("") == []
    assert split_text("   \n  ") == []


def test_chunker_short_text_is_one_chunk():
    from app.rag.chunker import split_text

    text = "Short text."
    chunks = split_text(text, chunk_size=512, chunk_overlap=64)
    assert len(chunks) == 1
    assert chunks[0].content == "Short text."


def test_chunker_overlap_carries_context():
    from app.rag.chunker import split_text

    # Make a text long enough to produce multiple chunks
    text = ("Alpha beta gamma delta epsilon. " * 30)
    chunks = split_text(text, chunk_size=100, chunk_overlap=30)
    assert len(chunks) >= 2
    # Each chunk after the first should share some tail of the previous
    for i in range(1, len(chunks)):
        prev_tail = chunks[i - 1].content[-30:]
        assert any(word in chunks[i].content for word in prev_tail.split())


# ──────────────────────────────────────────────
# Text extraction
# ──────────────────────────────────────────────

def test_extraction_txt(tmp_path):
    from app.rag.extraction import extract_text

    f = tmp_path / "test.txt"
    f.write_text("Hello from a text file.", encoding="utf-8")
    assert extract_text(f) == "Hello from a text file."


def test_extraction_md(tmp_path):
    from app.rag.extraction import extract_text

    f = tmp_path / "test.md"
    f.write_text("# Heading\n\nParagraph text.", encoding="utf-8")
    result = extract_text(f)
    assert "Heading" in result
    assert "Paragraph text" in result


def test_extraction_unsupported_type(tmp_path):
    from app.rag.extraction import extract_text

    f = tmp_path / "test.xyz"
    f.write_text("data")
    with pytest.raises(ValueError, match="Unsupported"):
        extract_text(f)


def test_extraction_image_uses_local_ocr(tmp_path):
    from unittest.mock import patch
    from app.rag.extraction import extract_text

    image = tmp_path / "diagram.png"
    image.write_bytes(b"fake image bytes")
    with patch("app.rag.extraction._ocr_image_bytes", return_value="Architecture API -> Database") as ocr:
        assert extract_text(image) == "Architecture API -> Database"
        ocr.assert_called_once_with(b"fake image bytes")


# ──────────────────────────────────────────────
# Web retrieval helpers
# ──────────────────────────────────────────────

def test_web_search_parser_accepts_result_links_and_redirects():
    from app.rag.web import _search_urls

    html = """
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">One</a>
    <a class="result__url" href="https://example.com/two">Two</a>
    """
    results = _search_urls(html)
    assert results == [
        ("One", "https://example.com/one"),
        ("Two", "https://example.com/two"),
    ]


# ──────────────────────────────────────────────
# Embeddings helpers
# ──────────────────────────────────────────────

def test_vec_roundtrip():
    from app.rag.embeddings import blob_to_vec, vec_to_blob

    vec = np.random.randn(1536).astype(np.float32)
    assert np.allclose(blob_to_vec(vec_to_blob(vec)), vec)


def test_cosine_similarity_identical():
    from app.rag.embeddings import cosine_similarity

    v = np.ones(128, dtype=np.float32)
    v /= np.linalg.norm(v)
    assert abs(cosine_similarity(v, v) - 1.0) < 1e-5


def test_cosine_similarity_orthogonal():
    from app.rag.embeddings import cosine_similarity

    a = np.array([1.0, 0.0], dtype=np.float32)
    b = np.array([0.0, 1.0], dtype=np.float32)
    assert abs(cosine_similarity(a, b)) < 1e-5


def test_top_k_chunks_ordering():
    from app.rag.embeddings import top_k_chunks, vec_to_blob

    query = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    high = np.array([0.99, 0.1, 0.0], dtype=np.float32)
    high /= np.linalg.norm(high)
    low  = np.array([0.1, 0.99, 0.0], dtype=np.float32)
    low  /= np.linalg.norm(low)

    results = top_k_chunks(query, ["c-high", "c-low"], [vec_to_blob(high), vec_to_blob(low)], k=2)
    assert results[0][0] == "c-high"
    assert results[1][0] == "c-low"
    assert results[0][1] > results[1][1]


# ──────────────────────────────────────────────
# Ingestion pipeline (mocked embeddings + file)
# ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingestion_happy_path(tmp_path, client, registered_user):
    """
    Creates a KB + document row, writes a real text file, mocks the embedding
    call, and verifies the document ends up 'ready' with chunks persisted.
    """
    from unittest.mock import AsyncMock, MagicMock, patch
    from app.rag.ingestion import ingest_document
    from app.database import SessionLocal
    from app.models import KnowledgeBase, KBDocument

    db = SessionLocal()
    try:
        # Pull the user id from the registered session
        me = client.get("/api/v1/auth/me").json()
        user_id = me["id"]

        # Create a fake provider connection placeholder (embedding needs one)
        from app.models import ProviderConnection, EncryptedCredential
        from app.security import encrypt_secret

        conn = ProviderConnection(
            user_id=user_id, provider_type="openai",
            connection_name="embed-conn", connection_status="connected",
        )
        db.add(conn)
        db.flush()
        db.add(EncryptedCredential(connection_id=conn.id, encrypted_secret=encrypt_secret("sk-fake")))

        kb = KnowledgeBase(
            user_id=user_id,
            name="Test KB",
            embedding_connection_id=conn.id,
            embedding_model_id="text-embedding-3-small",
            chunk_size=100,
            chunk_overlap=10,
            retrieval_k=3,
        )
        db.add(kb)
        db.flush()

        # Write a real text file
        doc_file = tmp_path / "test.txt"
        doc_file.write_text("The quick brown fox jumps over the lazy dog. " * 20)

        doc = KBDocument(
            kb_id=kb.id,
            filename="test.txt",
            file_path=str(doc_file),
            file_size_bytes=doc_file.stat().st_size,
            mime_type="text/plain",
            status="pending",
        )
        db.add(doc)
        db.commit()

        # Mock the embedding API call — return fake unit-norm vectors
        fake_vec = np.ones(1536, dtype=np.float32)
        fake_vec /= np.linalg.norm(fake_vec)

        with patch("app.rag.ingestion.embed_texts", new=AsyncMock(return_value=[fake_vec, fake_vec, fake_vec])):
            await ingest_document(doc.id, db)

        db.refresh(doc)
        assert doc.status == "ready", f"Expected 'ready', got '{doc.status}': {doc.error}"
        assert doc.chunk_count > 0

        from app.models import KBChunk
        chunks = db.query(KBChunk).filter(KBChunk.document_id == doc.id).all()
        assert len(chunks) == doc.chunk_count
        for c in chunks:
            assert c.embedding is not None

    finally:
        db.close()


# ──────────────────────────────────────────────
# RAG API endpoints
# ──────────────────────────────────────────────

def test_create_and_list_knowledge_base(client, registered_user):
    resp = client.post(
        "/api/v1/rag/knowledge-bases",
        json={"name": "My KB", "description": "Test", "embedding_model_id": "text-embedding-3-small"},
    )
    assert resp.status_code == 201
    kb = resp.json()
    assert kb["name"] == "My KB"

    listing = client.get("/api/v1/rag/knowledge-bases")
    assert listing.status_code == 200
    assert any(k["id"] == kb["id"] for k in listing.json())


def test_kb_not_visible_to_other_user(client):
    # User A creates a KB
    client.post("/api/v1/auth/register", json={"email": "alice-rag@example.com", "password": "password123"})
    kb = client.post(
        "/api/v1/rag/knowledge-bases",
        json={"name": "Alice KB", "embedding_model_id": "text-embedding-3-small"},
    ).json()
    client.post("/api/v1/auth/logout")

    # User B should not see it
    client.post("/api/v1/auth/register", json={"email": "mallory-rag@example.com", "password": "password123"})
    resp = client.get(f"/api/v1/rag/knowledge-bases/{kb['id']}")
    assert resp.status_code == 404

    listing = client.get("/api/v1/rag/knowledge-bases").json()
    assert not any(k["id"] == kb["id"] for k in listing)


def test_delete_kb(client, registered_user):
    kb = client.post(
        "/api/v1/rag/knowledge-bases",
        json={"name": "Temp KB", "embedding_model_id": "text-embedding-3-small"},
    ).json()
    del_resp = client.delete(f"/api/v1/rag/knowledge-bases/{kb['id']}")
    assert del_resp.status_code == 204
    assert client.get(f"/api/v1/rag/knowledge-bases/{kb['id']}").status_code == 404
