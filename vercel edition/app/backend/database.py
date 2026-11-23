from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

DATABASE_URL = (
    os.getenv("TASKFLOW_DATABASE_URL", "").strip()
    or os.getenv("DATABASE_URL", "").strip()
)
USING_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))


class Row(dict[str, Any]):
    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return tuple(super().values())[key]
        return super().__getitem__(key)


def _sqlite_placeholders(sql: str) -> str:
    return sql


@contextmanager
def db_connection() -> Iterator[Any]:
    if USING_POSTGRES:
        import psycopg
        from psycopg.rows import dict_row

        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        try:
            yield PostgresConnection(connection)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return

    database_path = Path(os.getenv("TASKFLOW_DATABASE", "./data/taskflow.db"))
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class PostgresConnection:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    def execute(self, sql: str, parameters: Any = ()) -> Any:
        sql = sql.replace("?", "%s")
        return self.connection.execute(sql, parameters)


def initialize_database() -> None:
    if USING_POSTGRES:
        with db_connection() as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS providers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    model TEXT NOT NULL,
                    encrypted_api_key TEXT NOT NULL DEFAULT '',
                    is_default SMALLINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS providers_single_default ON providers ((1)) WHERE is_default = 1"
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS app_data (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("ALTER TABLE providers ADD COLUMN IF NOT EXISTS user_id TEXT")
            db.execute("ALTER TABLE app_data ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT ''")
            db.execute("ALTER TABLE app_data DROP CONSTRAINT IF EXISTS app_data_pkey")
            db.execute("ALTER TABLE app_data ADD CONSTRAINT app_data_pkey PRIMARY KEY (key, user_id)")
            db.execute("DROP INDEX IF EXISTS providers_single_default")
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS providers_legacy_single_default "
                "ON providers ((1)) WHERE is_default = 1 AND user_id IS NULL"
            )
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS providers_user_single_default "
                "ON providers (user_id) WHERE is_default = 1 AND user_id IS NOT NULL"
            )
            db.execute("CREATE INDEX IF NOT EXISTS providers_user_id ON providers (user_id)")
            db.execute("CREATE INDEX IF NOT EXISTS app_data_user_id ON app_data (user_id)")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                    status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'rejected')),
                    is_blocked SMALLINT NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
                    block_note TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked SMALLINT NOT NULL DEFAULT 0")
            db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS block_note TEXT NOT NULL DEFAULT ''")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS github_accounts (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    github_user_id TEXT NOT NULL UNIQUE,
                    github_login TEXT NOT NULL,
                    encrypted_access_token TEXT NOT NULL,
                    scopes TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS github_oauth_flows (
                    flow_token_hash TEXT PRIMARY KEY,
                    mode TEXT NOT NULL CHECK (mode IN ('login', 'link')),
                    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                    encrypted_device_code TEXT NOT NULL,
                    client_id TEXT NOT NULL DEFAULT '',
                    interval_seconds INTEGER NOT NULL,
                    last_polled_at TIMESTAMPTZ,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("ALTER TABLE github_oauth_flows ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT ''")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS vscode_bridge_pairings (
                    pair_id_hash TEXT PRIMARY KEY,
                    code_hash TEXT UNIQUE,
                    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL,
                    encrypted_credentials TEXT NOT NULL DEFAULT '',
                    bridge_token_hash TEXT NOT NULL DEFAULT '',
                    workspace_directory TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    expires_at TEXT NOT NULL,
                    last_seen_at TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS vscode_bridge_commands (
                    id TEXT PRIMARY KEY,
                    pair_id_hash TEXT NOT NULL REFERENCES vscode_bridge_pairings(pair_id_hash) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    command_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    result_json TEXT NOT NULL DEFAULT '',
                    progress_text TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'queued',
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("CREATE INDEX IF NOT EXISTS vscode_bridge_user_project ON vscode_bridge_pairings (user_id, project_id)")
            db.execute("CREATE INDEX IF NOT EXISTS vscode_bridge_commands_queue ON vscode_bridge_commands (pair_id_hash, status, created_at)")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_bots (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    encrypted_token TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT '',
                    bot_name TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    system_prompt TEXT NOT NULL DEFAULT '',
                    enabled_sections TEXT NOT NULL DEFAULT '["chat","tasks","projects"]',
                    command_descriptions TEXT NOT NULL DEFAULT '{}',
                    enabled SMALLINT NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
                    bot_username TEXT NOT NULL DEFAULT '',
                    linked_user_id TEXT,
                    linked_chat_id TEXT,
                    linked_username TEXT NOT NULL DEFAULT '',
                    pairing_code_hash TEXT,
                    pairing_expires_at TIMESTAMPTZ,
                    update_offset BIGINT NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions (user_id)")
            db.execute("CREATE INDEX IF NOT EXISTS github_oauth_flows_expires_at ON github_oauth_flows (expires_at)")
            db.execute(
                "INSERT INTO auth_settings (key, value) VALUES "
                "('multi_user_enabled', '0'), ('approval_required', '0'), ('local_only', '1'), "
                "('engine_2d_enabled', '1'), ('engine_3d_enabled', '1'), ('engine_openfilm_enabled', '1'), "
                "('github_oauth_client_id', '') "
                "ON CONFLICT (key) DO NOTHING"
            )
        return

    with db_connection() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                encrypted_api_key TEXT NOT NULL DEFAULT '',
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        provider_columns = {row["name"] for row in db.execute("PRAGMA table_info(providers)").fetchall()}
        if "user_id" not in provider_columns:
            db.execute("ALTER TABLE providers ADD COLUMN user_id TEXT")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS app_data (
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                user_id TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (key, user_id)
            )
            """
        )
        app_data_columns = {row["name"] for row in db.execute("PRAGMA table_info(app_data)").fetchall()}
        if "user_id" not in app_data_columns:
            db.execute(
                """
                CREATE TABLE app_data_v2 (
                    key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    user_id TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (key, user_id)
                )
                """
            )
            db.execute(
                "INSERT INTO app_data_v2 (key, value_json, updated_at, user_id) "
                "SELECT key, value_json, updated_at, '' FROM app_data"
            )
            db.execute("DROP TABLE app_data")
            db.execute("ALTER TABLE app_data_v2 RENAME TO app_data")
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS providers_legacy_single_default "
            "ON providers ((1)) WHERE is_default = 1 AND user_id IS NULL"
        )
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS providers_user_single_default "
            "ON providers (user_id) WHERE is_default = 1 AND user_id IS NOT NULL"
        )
        db.execute("CREATE INDEX IF NOT EXISTS providers_user_id ON providers (user_id)")
        db.execute("CREATE INDEX IF NOT EXISTS app_data_user_id ON app_data (user_id)")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'rejected')),
                is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
                block_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        user_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
        if "is_blocked" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0")
        if "block_note" not in user_columns:
            db.execute("ALTER TABLE users ADD COLUMN block_note TEXT NOT NULL DEFAULT ''")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS github_accounts (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                github_user_id TEXT NOT NULL UNIQUE,
                github_login TEXT NOT NULL,
                encrypted_access_token TEXT NOT NULL,
                scopes TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS github_oauth_flows (
                flow_token_hash TEXT PRIMARY KEY,
                mode TEXT NOT NULL CHECK (mode IN ('login', 'link')),
                user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                encrypted_device_code TEXT NOT NULL,
                client_id TEXT NOT NULL DEFAULT '',
                interval_seconds INTEGER NOT NULL,
                last_polled_at TEXT,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS vscode_bridge_pairings (
                pair_id_hash TEXT PRIMARY KEY,
                code_hash TEXT UNIQUE,
                user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                encrypted_credentials TEXT NOT NULL DEFAULT '',
                bridge_token_hash TEXT NOT NULL DEFAULT '',
                workspace_directory TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT NOT NULL,
                last_seen_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS vscode_bridge_commands (
                id TEXT PRIMARY KEY,
                pair_id_hash TEXT NOT NULL REFERENCES vscode_bridge_pairings(pair_id_hash) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                command_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json TEXT NOT NULL DEFAULT '',
                progress_text TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'queued',
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS vscode_bridge_user_project ON vscode_bridge_pairings (user_id, project_id)")
        db.execute("CREATE INDEX IF NOT EXISTS vscode_bridge_commands_queue ON vscode_bridge_commands (pair_id_hash, status, created_at)")
        github_flow_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(github_oauth_flows)").fetchall()
        }
        if "client_id" not in github_flow_columns:
            db.execute("ALTER TABLE github_oauth_flows ADD COLUMN client_id TEXT NOT NULL DEFAULT ''")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS telegram_bots (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                encrypted_token TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                bot_name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL DEFAULT '',
                enabled_sections TEXT NOT NULL DEFAULT '["chat","tasks","projects"]',
                command_descriptions TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 0,
                bot_username TEXT NOT NULL DEFAULT '',
                linked_user_id TEXT,
                linked_chat_id TEXT,
                linked_username TEXT NOT NULL DEFAULT '',
                pairing_code_hash TEXT,
                pairing_expires_at TEXT,
                update_offset INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions (user_id)")
        db.execute("CREATE INDEX IF NOT EXISTS github_oauth_flows_expires_at ON github_oauth_flows (expires_at)")
        db.execute(
            "INSERT OR IGNORE INTO auth_settings (key, value) VALUES "
            "('multi_user_enabled', '0'), ('approval_required', '0'), ('local_only', '1'), "
            "('engine_2d_enabled', '1'), ('engine_3d_enabled', '1'), ('engine_openfilm_enabled', '1'), "
            "('github_oauth_client_id', '')"
        )
