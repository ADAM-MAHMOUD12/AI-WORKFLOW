import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

import database
import main


@pytest.fixture
def account_test_database(tmp_path, monkeypatch):
    database_path = tmp_path / "account-management.db"
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(database_path))
    database.initialize_database()
    with database.db_connection() as db:
        db.execute("UPDATE auth_settings SET value = '0' WHERE key = 'local_only'")
        db.execute("UPDATE auth_settings SET value = '1' WHERE key = 'multi_user_enabled'")
    return database_path


def test_database_initialization_migrates_existing_user_table(tmp_path, monkeypatch):
    database_path = tmp_path / "legacy-users.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, "
            "password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, "
            "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(database_path))

    database.initialize_database()

    with database.db_connection() as db:
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    assert "is_blocked" in columns
    assert "block_note" in columns


def register(client: TestClient, username: str):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "secure-test-password"},
    )
    assert response.status_code == 201
    result = response.json()
    return {"Authorization": f"Bearer {result['access_token']}"}


def test_admin_can_block_with_note_unblock_and_delete_user(account_test_database):
    with TestClient(main.app) as client:
        admin_auth = register(client, "admin-user")
        user_auth = register(client, "regular-user")
        users = client.get("/api/auth/admin/users", headers=admin_auth)
        assert users.status_code == 200
        user = next(account for account in users.json() if account["username"] == "regular-user")
        admin = next(account for account in users.json() if account["username"] == "admin-user")
        assert client.post(
            f"/api/auth/admin/users/{admin['id']}/block",
            json={"note": "Must remain administrator."},
            headers=admin_auth,
        ).status_code == 403
        assert client.delete(
            f"/api/auth/admin/users/{admin['id']}",
            headers=admin_auth,
        ).status_code == 403

        missing_note = client.post(
            f"/api/auth/admin/users/{user['id']}/block",
            json={"note": "   "},
            headers=admin_auth,
        )
        assert missing_note.status_code == 422

        blocked = client.post(
            f"/api/auth/admin/users/{user['id']}/block",
            json={"note": "Please contact the device administrator."},
            headers=admin_auth,
        )
        assert blocked.status_code == 200
        assert blocked.json()["is_blocked"] is True
        assert client.get("/api/auth/me", headers=user_auth).status_code == 401

        denied_login = client.post(
            "/api/auth/login",
            json={"username": "regular-user", "password": "secure-test-password"},
        )
        assert denied_login.status_code == 403
        assert "Please contact the device administrator." in denied_login.json()["detail"]

        unblocked = client.post(
            f"/api/auth/admin/users/{user['id']}/unblock",
            headers=admin_auth,
        )
        assert unblocked.status_code == 200
        assert unblocked.json()["is_blocked"] is False

        relogin = client.post(
            "/api/auth/login",
            json={"username": "regular-user", "password": "secure-test-password"},
        )
        assert relogin.status_code == 200
        user_auth = {"Authorization": f"Bearer {relogin.json()['access_token']}"}

        with database.db_connection() as db:
            db.execute(
                "INSERT INTO app_data (key, value_json, user_id) VALUES (?, ?, ?)",
                ("profile", "{}", user["id"]),
            )
            db.execute(
                "INSERT INTO providers (id, name, kind, base_url, model, encrypted_api_key, user_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("provider-test", "Test", "openai", "https://example.test", "model", "encrypted", user["id"]),
            )

        deleted = client.delete(
            f"/api/auth/admin/users/{user['id']}",
            headers=admin_auth,
        )
        assert deleted.status_code == 204
        assert client.get("/api/auth/me", headers=user_auth).status_code == 401

    with database.db_connection() as db:
        assert db.execute("SELECT COUNT(*) AS count FROM users WHERE id = ?", (user["id"],)).fetchone()["count"] == 0
        assert db.execute("SELECT COUNT(*) AS count FROM app_data WHERE user_id = ?", (user["id"],)).fetchone()["count"] == 0
        assert db.execute("SELECT COUNT(*) AS count FROM providers WHERE user_id = ?", (user["id"],)).fetchone()["count"] == 0


def test_admin_cannot_delete_last_admin_with_other_accounts(account_test_database):
    with TestClient(main.app) as client:
        admin_auth = register(client, "admin-user")
        register(client, "regular-user")
        response = client.delete("/api/auth/account", headers=admin_auth)
        assert response.status_code == 409
        assert client.get("/api/auth/me", headers=admin_auth).status_code == 200


def test_last_admin_can_delete_account_when_no_other_users_remain(account_test_database):
    with TestClient(main.app) as client:
        admin_auth = register(client, "admin-user")
        response = client.delete("/api/auth/account", headers=admin_auth)
        assert response.status_code == 204
        assert client.get("/api/auth/me", headers=admin_auth).status_code == 401
        assert client.get("/api/auth/status").json()["account_count"] == 0
