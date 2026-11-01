from unittest.mock import AsyncMock, patch


def _add_connection(client):
    with patch("app.routers.providers.build_adapter") as mock_build:
        mock_adapter = AsyncMock()
        mock_adapter.test_connection.return_value = True
        mock_build.return_value = mock_adapter
        resp = client.post(
            "/api/v1/providers/connections",
            json={"provider_type": "openrouter", "connection_name": "Conn", "api_key": "sk-fake"},
        )
    return resp.json()


def test_manual_model_registration(client, registered_user):
    conn = _add_connection(client)
    resp = client.post(
        "/api/v1/models",
        json={"connection_id": conn["id"], "provider_model_id": "vendor/model-x", "display_name": "Model X"},
    )
    assert resp.status_code == 201
    assert resp.json()["enabled"] is True
    assert resp.json()["discovery_source"] == "manual"


def test_duplicate_manual_model_rejected(client, registered_user):
    conn = _add_connection(client)
    payload = {"connection_id": conn["id"], "provider_model_id": "vendor/model-x", "display_name": "Model X"}
    first = client.post("/api/v1/models", json=payload)
    assert first.status_code == 201
    second = client.post("/api/v1/models", json=payload)
    assert second.status_code == 409


def test_disable_model_does_not_delete_connection(client, registered_user):
    conn = _add_connection(client)
    model = client.post(
        "/api/v1/models", json={"connection_id": conn["id"], "provider_model_id": "vendor/model-y"}
    ).json()

    client.delete(f"/api/v1/models/{model['id']}")

    conn_check = client.get(f"/api/v1/providers/connections/{conn['id']}")
    assert conn_check.status_code == 200


def test_removing_connection_removes_its_models(client, registered_user):
    conn = _add_connection(client)
    model = client.post(
        "/api/v1/models", json={"connection_id": conn["id"], "provider_model_id": "vendor/model-z"}
    ).json()

    client.delete(f"/api/v1/providers/connections/{conn['id']}")

    models_list = client.get("/api/v1/models").json()
    assert all(m["id"] != model["id"] for m in models_list)


def test_discover_models_refresh(client, registered_user):
    conn = _add_connection(client)
    from app.providers.base import DiscoveredModel

    with patch("app.routers.providers.build_adapter") as mock_build:
        mock_adapter = AsyncMock()
        mock_adapter.discover_models.return_value = [
            DiscoveredModel(provider_model_id="vendor/free-model", display_name="Free Model", pricing_tier="free"),
        ]
        mock_build.return_value = mock_adapter
        resp = client.post(f"/api/v1/providers/connections/{conn['id']}/models/refresh")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["pricing_tier"] == "free"
    assert data[0]["enabled"] is False  # discovered models start disabled until the user selects them
