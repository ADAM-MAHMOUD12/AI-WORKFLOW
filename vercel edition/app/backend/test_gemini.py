import os
import sqlite3
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

with sqlite3.connect(BACKEND_DIR / "data" / "taskflow.db") as connection:
    provider = connection.execute(
        "SELECT base_url, encrypted_api_key, model FROM providers WHERE is_default = 1"
    ).fetchone()

if provider is None:
    raise SystemExit("No default AI provider is configured.")

api_key = ""
if provider[1]:
    encryption_key = os.getenv("TASKFLOW_ENCRYPTION_KEY")
    if not encryption_key:
        raise SystemExit("TASKFLOW_ENCRYPTION_KEY is not configured.")
    api_key = Fernet(encryption_key.encode()).decrypt(provider[1].encode()).decode()

headers = {"Content-Type": "application/json"}
if api_key:
    headers["Authorization"] = f"Bearer {api_key}"

payload = {
    "model": provider[2],
    "messages": [
        {"role": "user", "content": "Add a wall."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "add_wall",
                        "arguments": '{"start":[0,0],"end":[5,0]}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "name": "add_wall",
            "content": '{"success":true}',
        },
    ],
}

response = httpx.post(
    f"{provider[0].rstrip('/')}/chat/completions",
    headers=headers,
    json=payload,
    timeout=45,
)
print("STATUS:", response.status_code)
print("RESPONSE:", response.text)
