import os
import tempfile

from fastapi.testclient import TestClient
from cryptography.fernet import Fernet

os.environ.setdefault("TASKFLOW_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault(
    "TASKFLOW_DATABASE",
    os.path.join(tempfile.gettempdir(), "taskflow-vscode-bridge-test.db"),
)

import database
import main


def _register_user(client: TestClient):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "bridge-user",
            "password": "secure-test-password",
            "setup_key": "test-initial-admin-key",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_vscode_bridge_pairing_and_command_relay(tmp_path, monkeypatch):
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(tmp_path / "vscode-bridge.db"))
    monkeypatch.setenv("TASKFLOW_INITIAL_ADMIN_KEY", "test-initial-admin-key")
    database.initialize_database()
    with database.db_connection() as db:
        db.execute("UPDATE auth_settings SET value = '1' WHERE key = 'multi_user_enabled'")

    project_id = "a" * 32
    workspace = r"C:\projects\demo"
    with TestClient(main.app, client=("127.0.0.1", 12345)) as client:
        user_headers = _register_user(client)
        pairing = client.post("/api/vscode-bridge/pair/start")
        assert pairing.status_code == 200
        pairing_data = pairing.json()
        assert len(pairing_data["code"]) == 10
        assert "bridge_token" not in pairing_data

        approved = client.post(
            "/api/vscode-bridge/pair/approve",
            headers=user_headers,
            json={
                "code": pairing_data["code"].lower(),
                "project_id": project_id,
                "workspace_directory": workspace,
            },
        )
        assert approved.status_code == 200
        assert approved.json() == {"approved": True}
        reused_code = client.post(
            "/api/vscode-bridge/pair/approve",
            headers=user_headers,
            json={
                "code": pairing_data["code"],
                "project_id": project_id,
                "workspace_directory": workspace,
            },
        )
        assert reused_code.status_code == 404

        credentials = client.get(
            f"/api/vscode-bridge/pair/poll/{pairing_data['pair_id']}"
        ).json()
        assert credentials["status"] == "approved"
        assert credentials["project_id"] == project_id
        extension_headers = {"Authorization": f"Bearer {credentials['bridge_token']}"}

        heartbeat = client.post("/api/vscode-bridge/heartbeat", headers=extension_headers)
        assert heartbeat.status_code == 200
        with database.db_connection() as db:
            db.execute(
                "UPDATE vscode_bridge_pairings SET expires_at = '2000-01-01T00:00:00+00:00' "
                "WHERE user_id = (SELECT id FROM users WHERE username = ?) AND project_id = ?",
                ("bridge-user", project_id),
            )
        assert client.post("/api/vscode-bridge/pair/start").status_code == 200
        status = client.get(
            f"/api/vscode-bridge/status/{project_id}",
            headers=user_headers,
        )
        assert status.status_code == 200
        assert status.json()["paired"] is True
        assert status.json()["workspace_directory"] == workspace

        created = client.post(
            "/api/vscode-bridge/commands",
            headers=user_headers,
            json={
                "project_id": project_id,
                "command_type": "context",
                "payload": {},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["command_id"]
        queued = client.post("/api/vscode-bridge/commands/next", headers=extension_headers)
        assert queued.status_code == 200
        assert queued.json()["command"]["id"] == command_id

        completed = client.post(
            f"/api/vscode-bridge/commands/{command_id}/result",
            headers=extension_headers,
            json={
                "status": "completed",
                "progress": "",
                "result": {
                    "workspace": workspace,
                    "active_file": "main.py",
                    "selection": "",
                    "diagnostics": [],
                },
            },
        )
        assert completed.status_code == 200
        result = client.get(
            f"/api/vscode-bridge/commands/{command_id}",
            params={"project_id": project_id},
            headers=user_headers,
        )
        assert result.status_code == 200
        assert result.json()["status"] == "completed"
        assert result.json()["result"]["active_file"] == "main.py"

        cancellable = client.post(
            "/api/vscode-bridge/commands",
            headers=user_headers,
            json={
                "project_id": project_id,
                "command_type": "context",
                "payload": {},
            },
        )
        command_to_cancel = cancellable.json()["command_id"]
        cancelled = client.delete(
            f"/api/vscode-bridge/commands/{command_to_cancel}",
            params={"project_id": project_id},
            headers=user_headers,
        )
        assert cancelled.status_code == 200
        cancelled_status = client.get(
            f"/api/vscode-bridge/commands/{command_to_cancel}",
            params={"project_id": project_id},
            headers=user_headers,
        )
        assert cancelled_status.json()["status"] == "cancelled"
        assert client.get(
            f"/api/vscode-bridge/device/commands/{command_to_cancel}/state",
            headers=extension_headers,
        ).json()["status"] == "cancelled"

        disconnected = client.post(
            "/api/vscode-bridge/device/disconnect",
            headers=extension_headers,
        )
        assert disconnected.status_code == 200
        assert client.get(
            f"/api/vscode-bridge/status/{project_id}",
            headers=user_headers,
        ).json()["paired"] is False
