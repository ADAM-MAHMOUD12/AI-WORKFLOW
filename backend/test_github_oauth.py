import os

import pytest
from fastapi.testclient import TestClient

import database
import main


class FakeResponse:
    def __init__(self, status_code, body, headers=None):
        self.status_code = status_code
        self.is_success = 200 <= status_code < 300
        self._body = body
        self.headers = headers or {}

    def json(self):
        return self._body


class FakeGithubClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, data=None, headers=None):
        if url == main.GITHUB_OAUTH_DEVICE_URL:
            return FakeResponse(200, {
                "device_code": "private-device-code",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 600,
                "interval": 1,
            })
        if url == main.GITHUB_OAUTH_TOKEN_URL:
            return FakeResponse(200, {
                "access_token": "private-github-access-token",
                "scope": "read:user",
            })
        raise AssertionError(f"Unexpected GitHub POST URL: {url}")

    async def get(self, url, headers=None, params=None):
        if url == main.GITHUB_API_USER_URL:
            return FakeResponse(
                200,
                {"id": 987654321, "login": "taskflow-test"},
                {"X-OAuth-Scopes": "read:user"},
            )
        if url == f"{main.GITHUB_API_BASE_URL}/user/repos":
            assert headers["Authorization"] == "Bearer private-github-access-token"
            assert params["affiliation"] == "owner,collaborator,organization_member"
            return FakeResponse(200, [{
                "full_name": "taskflow-test/sample",
                "private": True,
                "description": "A test repository",
                "permissions": {"pull": True, "push": True},
            }])
        if url == f"{main.GITHUB_API_BASE_URL}/repos/taskflow-test/sample":
            assert headers["Authorization"] == "Bearer private-github-access-token"
            return FakeResponse(200, {
                "full_name": "taskflow-test/sample",
                "permissions": {"pull": True, "push": True},
            })
        raise AssertionError(f"Unexpected GitHub GET URL: {url}")


@pytest.fixture
def github_test_database(tmp_path, monkeypatch):
    database_path = tmp_path / "github-oauth.db"
    monkeypatch.setenv("TASKFLOW_DATABASE", os.fspath(database_path))
    monkeypatch.setattr(main, "GITHUB_OAUTH_CLIENT_ID", "test-client-id")
    database.initialize_database()
    with database.db_connection() as db:
        db.execute("UPDATE auth_settings SET value = '0' WHERE key = 'local_only'")
    return database_path


def test_github_device_login_creates_session_and_links_encrypted_account(
    github_test_database,
    monkeypatch,
):
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeGithubClient)

    with TestClient(main.app) as client:
        start = client.post("/api/auth/github/device/start", json={"mode": "login"})
        assert start.status_code == 200
        flow = start.json()
        assert flow["user_code"] == "ABCD-EFGH"

        completed = client.post(
            "/api/auth/github/device/poll",
            json={"flow_id": flow["flow_id"]},
        )
        assert completed.status_code == 200
        login = completed.json()
        assert login["status"] == "authenticated"
        assert login["user"]["username"] == "taskflow-test"
        auth = {"Authorization": f"Bearer {login['access_token']}"}
        assert client.get("/api/auth/me", headers=auth).status_code == 200

        link_start = client.post(
            "/api/auth/github/device/start",
            json={"mode": "link"},
            headers=auth,
        )
        assert link_start.status_code == 200
        linked = client.post(
            "/api/auth/github/device/poll",
            json={"flow_id": link_start.json()["flow_id"]},
            headers=auth,
        )
        assert linked.status_code == 200
        assert linked.json() == {"status": "connected", "github_login": "taskflow-test"}

        account = client.get("/api/github/account", headers=auth)
        assert account.status_code == 200
        assert account.json()["connected"] is True
        assert account.json()["github_login"] == "taskflow-test"
        assert "private-github-access-token" not in account.text

        repositories = client.get("/api/github/repositories", headers=auth)
        assert repositories.status_code == 200
        assert repositories.json()["repositories"] == [{
            "full_name": "taskflow-test/sample",
            "private": True,
            "description": "A test repository",
            "can_push": True,
        }]
        assert "private-github-access-token" not in repositories.text

        monkeypatch.setattr(main, "request_is_loopback", lambda request: True)
        monkeypatch.setattr(
            main,
            "clone_github_repository_workspace",
            lambda owner_id, project_id, repository_full_name, access_token: {
                "project_id": project_id,
                "name": repository_full_name,
                "working_directory": "/tmp/test-workspace",
            },
        )
        clone = client.post(
            "/api/github/repositories/clone",
            headers=auth,
            json={
                "full_name": "taskflow-test/sample",
                "project_id": "0123456789abcdef0123456789abcdef",
            },
        )
        assert clone.status_code == 200
        assert clone.json() == {
            "project_id": "0123456789abcdef0123456789abcdef",
            "name": "taskflow-test/sample",
            "working_directory": "/tmp/test-workspace",
        }
        assert "private-github-access-token" not in clone.text

    with database.db_connection() as db:
        stored = db.execute(
            "SELECT encrypted_access_token FROM github_accounts"
        ).fetchone()
    assert stored is not None
    assert "private-github-access-token" not in stored["encrypted_access_token"]
