from unittest.mock import AsyncMock, patch

from app.providers.base import ChatChunk


async def _fake_stream(model_id, messages):
    yield ChatChunk(delta="Hello")
    yield ChatChunk(delta=", world")
    yield ChatChunk(done=True)


def _register_and_setup_model(client):
    client.post("/api/v1/auth/register", json={"email": "chatuser@example.com", "password": "correct-horse-battery"})

    with patch("app.routers.providers.build_adapter") as mock_build:
        mock_adapter = AsyncMock()
        mock_adapter.test_connection.return_value = True
        mock_build.return_value = mock_adapter
        conn = client.post(
            "/api/v1/providers/connections",
            json={"provider_type": "openrouter", "connection_name": "Conn", "api_key": "sk-fake"},
        ).json()

    model = client.post(
        "/api/v1/models",
        json={"connection_id": conn["id"], "provider_model_id": "test/model", "display_name": "Test Model"},
    ).json()
    return model


def test_chat_completion_streams_and_persists(client):
    model = _register_and_setup_model(client)

    with patch("app.routers.chat.build_adapter") as mock_build:
        mock_adapter = AsyncMock()
        mock_adapter.stream_chat = _fake_stream
        mock_build.return_value = mock_adapter

        resp = client.post("/api/v1/chat/completions", json={"model_id": model["id"], "message": "hi there"})
        assert resp.status_code == 200
        body = resp.text
        assert "Hello" in body
        assert "world" in body

    conversations = client.get("/api/v1/conversations").json()
    assert len(conversations) == 1
    detail = client.get(f"/api/v1/conversations/{conversations[0]['id']}").json()
    roles = [m["role"] for m in detail["messages"]]
    assert roles == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "Hello, world"


def test_chat_with_disabled_model_rejected(client):
    model = _register_and_setup_model(client)
    client.patch(f"/api/v1/models/{model['id']}", json={"enabled": False})
    resp = client.post("/api/v1/chat/completions", json={"model_id": model["id"], "message": "hi"})
    assert resp.status_code == 400


def test_chat_with_invalid_model_id_rejected(client, registered_user):
    resp = client.post("/api/v1/chat/completions", json={"model_id": "nonexistent-id", "message": "hi"})
    assert resp.status_code == 404
