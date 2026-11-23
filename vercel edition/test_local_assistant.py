from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_assistant


@pytest.mark.parametrize(
    "path",
    [
        "/api/programming/run",
        "/api/programming/workspace",
        "/api/programming/workspace/0123456789abcdef0123456789abcdef",
        "/api/programming/launch-vscode/0123456789abcdef0123456789abcdef",
        "/api/programming/extensions/install",
        "/api/w2m/vision/analyze",
        "/api/downloads/whisper",
        "/api/speech/transcribe",
        "/api/motion/open-editor",
        "/api/motion/latest-project",
        "/api/aedifex/scenes",
    ],
)
def test_allows_supported_device_routes(path):
    assert local_assistant._is_device_route(path)


@pytest.mark.parametrize(
    "path",
    [
        "/api/providers",
        "/api/chat/stream",
        "/api/data",
        "/api/auth/admin/users",
        "/api/programming/workspace/../other",
        "/api/telegram-bot",
        "/api/github/repositories/clone",
        "/api/programming/run/extra",
    ],
)
def test_rejects_cloud_and_unlisted_routes(path):
    assert not local_assistant._is_device_route(path)


@pytest.mark.parametrize(
    ("origin", "expected"),
    [
        ("https://taskflow.example.com", "https://taskflow.example.com"),
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://127.0.0.1:5173", "http://127.0.0.1:5173"),
    ],
)
def test_accepts_hosted_https_and_loopback_origins(origin, expected):
    assert local_assistant._validate_origin(origin) == expected


@pytest.mark.parametrize(
    "origin",
    [
        "http://taskflow.example.com",
        "https://taskflow.example.com/path",
        "https://user:pass@taskflow.example.com",
        "file:///",
    ],
)
def test_rejects_untrusted_origins(origin):
    with pytest.raises(HTTPException):
        local_assistant._validate_origin(origin)
