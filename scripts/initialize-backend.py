from pathlib import Path


env_file = Path(__file__).resolve().parents[1] / "backend" / ".env"
if not env_file.exists():
    from cryptography.fernet import Fernet

    fernet_key = Fernet.generate_key().decode("ascii")
    env_file.write_text(
        "TASKFLOW_ENV=development\n"
        f"TASKFLOW_ENCRYPTION_KEY={fernet_key}\n"
        "TASKFLOW_DATABASE=./data/taskflow.db\n"
        "TASKFLOW_GITHUB_CLIENT_ID=\n",
        encoding="utf-8",
    )
