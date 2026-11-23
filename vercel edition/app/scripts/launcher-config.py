import os
import sqlite3
from pathlib import Path
from dotenv import dotenv_values


project_root = Path(__file__).resolve().parents[1]
backend_dir = project_root / "backend"
database_value = os.environ.get("TASKFLOW_DATABASE") or dotenv_values(backend_dir / ".env").get("TASKFLOW_DATABASE")
database = Path(database_value) if database_value else backend_dir / "data" / "taskflow.db"
if not database.is_absolute():
    database = backend_dir / database
settings = {
    "local_only": "1",
    "engine_2d_enabled": "1",
    "engine_3d_enabled": "1",
    "engine_openfilm_enabled": "1",
}

if database.exists():
    with sqlite3.connect(database) as connection:
        has_settings = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_settings'"
        ).fetchone()
        rows = connection.execute("SELECT key, value FROM auth_settings").fetchall() if has_settings else []
    settings.update(dict(rows))

print("|".join((
    "1" if settings["local_only"] == "1" else "0",
    "1" if settings["engine_2d_enabled"] == "1" else "0",
    "1" if settings["engine_3d_enabled"] == "1" else "0",
    "1" if settings["engine_openfilm_enabled"] == "1" else "0",
)))
