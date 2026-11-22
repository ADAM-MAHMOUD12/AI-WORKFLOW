import asyncio

import pytest
from fastapi import HTTPException

import main


class FakeCopilotResponse:
    data = type("ResponseData", (), {"content": "Copilot response"})()


class FakeCopilotSession:
    def __init__(self):
        self.prompt = None
        self.attachments = None

    async def send_and_wait(self, prompt, attachments=None):
        self.prompt = prompt
        self.attachments = attachments
        return FakeCopilotResponse()


class FakeCopilotClient:
    def __init__(self, **options):
        self.options = options
        self.session = FakeCopilotSession()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def create_session(self, *, model, system_message):
        self.model = model
        self.system_message = system_message
        return self.session


class FakeRuntimeConnection:
    @staticmethod
    def for_inprocess(*, base_directory):
        return {"base_directory": base_directory}


def test_github_copilot_request_uses_linked_token_and_disables_tools(monkeypatch):
    client = FakeCopilotClient()
    monkeypatch.setattr(main, "github_linked_access_token", lambda _user_id: "gho-test-token")
    monkeypatch.setattr(main, "CopilotClient", lambda **options: _copy_client(client, options))
    monkeypatch.setattr(main, "RuntimeConnection", FakeRuntimeConnection)

    reply, usage = asyncio.run(main.github_copilot_request(
        {"id": "user-1"},
        "Current message",
        "Stay concise.",
        [{"role": "user", "content": "Earlier question"}],
    ))

    assert reply == "Copilot response"
    assert usage is None
    assert client.options["mode"] == "empty"
    assert client.options["github"] == {"token": "gho-test-token", "use_logged_in_user": False}
    assert client.model == "auto"
    assert client.system_message == {"mode": "replace", "content": "Stay concise."}
    assert "Earlier question" in client.session.prompt
    assert "Current message" in client.session.prompt
    assert client.session.attachments is None


def test_github_copilot_request_passes_valid_image_attachments(monkeypatch):
    client = FakeCopilotClient()
    monkeypatch.setattr(main, "github_linked_access_token", lambda _user_id: "gho-test-token")
    monkeypatch.setattr(main, "CopilotClient", lambda **options: _copy_client(client, options))
    monkeypatch.setattr(main, "RuntimeConnection", FakeRuntimeConnection)

    asyncio.run(main.github_copilot_request(
        {"id": "user-1"},
        "Describe the attached image.",
        images=["data:image/png;base64,aGVsbG8="],
    ))

    assert client.session.attachments == [{
        "data": "aGVsbG8=",
        "mimeType": "image/png",
        "displayName": "image-1.png",
    }]


def test_github_copilot_request_rejects_malformed_image_before_sdk_call(monkeypatch):
    monkeypatch.setattr(main, "github_linked_access_token", lambda _user_id: "gho-test-token")
    monkeypatch.setattr(main, "CopilotClient", lambda **_options: pytest.fail("SDK must not start"))
    monkeypatch.setattr(main, "RuntimeConnection", FakeRuntimeConnection)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main.github_copilot_request(
            {"id": "user-1"},
            "Describe this.",
            images=["data:image/png;base64,not base64"],
        ))

    assert error.value.status_code == 422


def _copy_client(client, options):
    client.options = options
    return client
