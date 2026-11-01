from unittest.mock import AsyncMock, patch


def _register(client, email, password="correct-horse-battery"):
    resp = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201


def _add_connection(client):
    with patch("app.routers.providers.build_adapter") as mock_build:
        mock_adapter = AsyncMock()
        mock_adapter.test_connection.return_value = True
        mock_build.return_value = mock_adapter
        resp = client.post(
            "/api/v1/providers/connections",
            json={"provider_type": "openrouter", "connection_name": "My OpenRouter", "api_key": "sk-fake-key"},
        )
    assert resp.status_code == 201
    return resp.json()


def test_user_cannot_see_another_users_connections(client):
    _register(client, "alice@example.com")
    conn = _add_connection(client)
    client.post("/api/v1/auth/logout")

    _register(client, "mallory@example.com")
    resp = client.get(f"/api/v1/providers/connections/{conn['id']}")
    assert resp.status_code == 404

    listing = client.get("/api/v1/providers/connections")
    assert listing.json() == []


def test_user_cannot_delete_another_users_connection(client):
    _register(client, "alice2@example.com")
    conn = _add_connection(client)
    client.post("/api/v1/auth/logout")

    _register(client, "mallory2@example.com")
    resp = client.delete(f"/api/v1/providers/connections/{conn['id']}")
    assert resp.status_code == 404


def test_credentials_never_appear_in_connection_response(client):
    _register(client, "alice3@example.com")
    conn = _add_connection(client)
    assert "api_key" not in conn
    assert "encrypted_secret" not in conn
    assert "sk-fake-key" not in str(conn)


def test_user_cannot_access_another_users_conversation(client):
    _register(client, "alice4@example.com")
    convo = client.post("/api/v1/conversations", json={}).json()
    client.post("/api/v1/auth/logout")

    _register(client, "mallory4@example.com")
    resp = client.get(f"/api/v1/conversations/{convo['id']}")
    assert resp.status_code == 404


def test_user_cannot_chat_with_another_users_model(client):
    _register(client, "alice5@example.com")
    conn = _add_connection(client)
    model = client.post(
        "/api/v1/models", json={"connection_id": conn["id"], "provider_model_id": "some/model", "display_name": "Some Model"}
    ).json()
    client.post("/api/v1/auth/logout")

    _register(client, "mallory5@example.com")
    resp = client.post("/api/v1/chat/completions", json={"model_id": model["id"], "message": "hi"})
    assert resp.status_code == 404
