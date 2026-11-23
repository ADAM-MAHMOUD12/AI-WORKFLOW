import os

import pytest
from fastapi.testclient import TestClient

import database
import main


@pytest.fixture
def skill_library_database(tmp_path, monkeypatch):
    database_path = tmp_path / "skill-library.db"
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(database_path))
    database.initialize_database()
    with database.db_connection() as db:
        db.execute("UPDATE auth_settings SET value = '0' WHERE key = 'local_only'")
        db.execute("UPDATE auth_settings SET value = '1' WHERE key = 'multi_user_enabled'")


def test_install_public_skill_saves_to_account_without_writing_workspace(skill_library_database, monkeypatch):
    async def fetch_skill(source, skill_id):
        return {
            "content": "---\nname: sample-skill\ndescription: Test skill\n---\nUse this workflow.",
            "skill_id": skill_id,
        }

    def reject_workspace_write(*args, **kwargs):
        raise AssertionError("Skill installation must not write workspace files.")

    monkeypatch.setattr(main, "fetch_public_skill", fetch_skill)
    monkeypatch.setattr(main, "write_project_workspace", reject_workspace_write)
    monkeypatch.setattr(main, "read_project_workspace", reject_workspace_write)

    with TestClient(main.app) as client:
        account = client.post(
            "/api/auth/register",
            json={"username": "skill-user", "password": "secure-test-password"},
        )
        assert account.status_code == 201
        headers = {"Authorization": f"Bearer {account.json()['access_token']}"}

        installed = client.post(
            "/api/skills/library/install",
            json={"source": "example/skills", "skill_id": "sample-skill"},
            headers=headers,
        )

        assert installed.status_code == 200
        assert installed.json()["target"] == "taskflow-account"
        assert installed.json()["skill"]["shortcut"] == "/sample-skill"
        assert "paths" not in installed.json()

        saved = client.get("/api/data/skills", headers=headers)
        assert saved.status_code == 200
        assert saved.json()["value"][0]["id"] == "skills-sh:example/skills/sample-skill"
