from pathlib import Path
import re
import secrets


env_file = Path(__file__).resolve().parents[1] / "backend" / ".env"
if not env_file.exists():
    from cryptography.fernet import Fernet

    fernet_key = Fernet.generate_key().decode("ascii")
    env_file.write_text(
        "TASKFLOW_ENV=development\n"
        f"TASKFLOW_ENCRYPTION_KEY={fernet_key}\n"
        f"TASKFLOW_LOCAL_AGENT_SECRET={secrets.token_urlsafe(48)}\n"
        "TASKFLOW_DATABASE=./data/taskflow.db\n"
        "TASKFLOW_GITHUB_CLIENT_ID=\n",
        encoding="utf-8",
    )
else:
    current = env_file.read_text(encoding="utf-8")
    secret_line = re.search(r"(?m)^TASKFLOW_LOCAL_AGENT_SECRET=(.*)$", current)
    if secret_line is None:
        current = current.rstrip() + f"\nTASKFLOW_LOCAL_AGENT_SECRET={secrets.token_urlsafe(48)}\n"
        env_file.write_text(current, encoding="utf-8")
    elif len(secret_line.group(1).strip()) < 32 or "GENERATE_RANDOM" in secret_line.group(1):
        current = current[:secret_line.start(1)] + secrets.token_urlsafe(48) + current[secret_line.end(1):]
        env_file.write_text(current, encoding="utf-8")
