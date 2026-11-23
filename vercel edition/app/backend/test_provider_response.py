import os
import tempfile
from datetime import datetime, timezone

from cryptography.fernet import Fernet

os.environ.setdefault("TASKFLOW_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault(
    "TASKFLOW_DATABASE",
    os.path.join(tempfile.gettempdir(), "taskflow-provider-response-test.db"),
)

import main


def test_public_provider_serializes_postgres_timestamp_as_iso_string():
    created_at = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)

    provider = main.public_provider({
        "id": "provider-1",
        "name": "Gemini",
        "kind": "openai_compatible",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.5-flash",
        "encrypted_api_key": "encrypted",
        "is_default": True,
        "created_at": created_at,
    })

    assert provider.created_at == "2026-11-23T12:00:00+00:00"
