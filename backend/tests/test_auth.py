def test_register_and_me(client):
    resp = client.post("/api/v1/auth/register", json={"email": "bob@example.com", "password": "correct-horse-battery"})
    assert resp.status_code == 201
    assert resp.json()["email"] == "bob@example.com"

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "bob@example.com"


def test_register_duplicate_email_rejected(client, registered_user):
    resp = client.post("/api/v1/auth/register", json={"email": "alice@example.com", "password": "another-password"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client, registered_user):
    client.post("/api/v1/auth/logout")
    resp = client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "wrong-password"})
    assert resp.status_code == 401


def test_login_success(client, registered_user):
    client.post("/api/v1/auth/logout")
    resp = client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "correct-horse-battery"})
    assert resp.status_code == 200


def test_me_requires_auth(client):
    client.cookies.clear()
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_logout_clears_session(client, registered_user):
    resp = client.post("/api/v1/auth/logout")
    assert resp.status_code == 204
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 401
