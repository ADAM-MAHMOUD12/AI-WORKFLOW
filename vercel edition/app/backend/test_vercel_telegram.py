import asyncio
import os
import uuid

import pytest
from fastapi.testclient import TestClient

import database
import main


@pytest.fixture
def telegram_database(tmp_path, monkeypatch):
    database_path = tmp_path / "telegram-webhook.db"
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(database_path))
    database.initialize_database()
    user_id = str(uuid.uuid4())
    with database.db_connection() as db:
        db.execute(
            "INSERT INTO users (id, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)",
            (user_id, f"telegram-{user_id[:8]}", "test-hash", "user", "approved"),
        )
        db.execute(
            """
            INSERT INTO telegram_bots (user_id, encrypted_token, provider_id, enabled)
            VALUES (?, ?, ?, 1)
            """,
            (user_id, main.encrypt_secret("123456:test-token"), "test-provider"),
        )
    return user_id


def test_hosted_telegram_webhook_authenticates_and_deduplicates_updates(
    telegram_database, monkeypatch
):
    user_id = telegram_database
    monkeypatch.setattr(main, "IS_VERCEL", True)
    handled_updates = []

    async def record_update(received_user_id, token, update):
        handled_updates.append((received_user_id, token, update["update_id"]))

    monkeypatch.setattr(main, "handle_telegram_message", record_update)
    token = "123456:test-token"
    secret = main.telegram_webhook_secret(user_id, token)

    with TestClient(main.app) as client:
        rejected = client.post(
            f"/api/telegram-bot/webhook/{user_id}",
            json={"update_id": 12},
            headers={"X-Telegram-Bot-Api-Secret-Token": "invalid"},
        )
        accepted = client.post(
            f"/api/telegram-bot/webhook/{user_id}",
            json={"update_id": 12},
            headers={"X-Telegram-Bot-Api-Secret-Token": secret},
        )
        duplicate = client.post(
            f"/api/telegram-bot/webhook/{user_id}",
            json={"update_id": 12},
            headers={"X-Telegram-Bot-Api-Secret-Token": secret},
        )

    assert rejected.status_code == 403
    assert accepted.status_code == 200
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    assert handled_updates == [(user_id, token, 12)]
    with database.db_connection() as db:
        row = db.execute(
            "SELECT update_offset FROM telegram_bots WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    assert row["update_offset"] == 13


def test_hosted_telegram_settings_use_cloud_authentication(telegram_database, monkeypatch):
    monkeypatch.setattr(main, "IS_VERCEL", True)

    with TestClient(main.app) as client:
        response = client.get("/api/telegram-bot")

    assert response.status_code == 401
    assert response.json()["detail"] == "A valid user session is required."


def test_hosted_telegram_bot_configures_a_secure_public_webhook(
    telegram_database, monkeypatch
):
    user_id = telegram_database
    config = main.telegram_bot_row(user_id)
    monkeypatch.setenv("TASKFLOW_PUBLIC_URL", "https://taskflow.example.com/")
    methods = []

    async def record_api_call(token, method, payload=None):
        methods.append((token, method, payload))

    monkeypatch.setattr(main, "telegram_api", record_api_call)
    monkeypatch.setattr(main, "IS_VERCEL", True)

    asyncio.run(main.configure_telegram_webhook(user_id, config))

    assert len(methods) == 1
    token, method, payload = methods[0]
    assert token == "123456:test-token"
    assert method == "setWebhook"
    assert payload["url"] == f"https://taskflow.example.com/api/telegram-bot/webhook/{user_id}"
    assert payload["secret_token"] == main.telegram_webhook_secret(user_id, token)
    assert payload["allowed_updates"] == ["message"]


@pytest.mark.parametrize(
    "public_url",
    [
        "http://taskflow.example.com",
        "https://taskflow.example.com/path",
        "https://user:pass@taskflow.example.com",
    ],
)
def test_telegram_webhook_requires_a_valid_public_https_origin(
    public_url, monkeypatch
):
    monkeypatch.setenv("TASKFLOW_PUBLIC_URL", public_url)
    with pytest.raises(RuntimeError, match="TASKFLOW_PUBLIC_URL"):
        main.telegram_webhook_url("user-id")
