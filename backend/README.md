# AI TaskFlow Backend

FastAPI service for application data, AI provider credentials and calls, account sessions, local editor integrations, and search.

## Windows startup

Use the repository-level `start-all.bat`. It creates `backend/.venv`, installs `requirements.txt`, creates `backend/.env` with a fresh Fernet key when missing, and starts the enabled services. Python 3.10+ is required. The environment file and `backend/data` are local and must not be committed or included in release source.

For manual development:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print('TASKFLOW_ENCRYPTION_KEY=' + Fernet.generate_key().decode())" >> .env
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/health` for the health check and `/docs` for the API schema. Preserve the Fernet key: changing or losing it makes previously stored API keys unreadable.

The speaking trainer uses the local Piper TTS engine. English and Arabic voice models are downloaded on demand into `backend/data/speaking-voices`; each model download is pinned and checksum-verified. The selected voice datasets have their own licensing terms—review the linked model cards before commercial use: [Arabic Kareem](https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium) and [British English Alan](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alan/medium). Piper is GPL-3.0; see [Piper's license](https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING).

Microphone transcription uses a local multilingual Whisper base model (CPU int8), downloaded on demand into `backend/data/speech-models` from a pinned [Systran model revision](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66). The download is approximately 145 MB. Audio recordings are sent only to this local backend for transcription and are deleted after processing.

## Accounts and data isolation

Registration, login, logout, current-user, administrator settings, and account approval are exposed under `/api/auth`. The first registered account becomes the host administrator. Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes; random session tokens are only stored as hashes. New accounts can remain pending until the administrator approves them.

When multi-user mode is enabled, app-data rows and AI providers are scoped to the authenticated user. Clients cannot select another user's ID. Existing pre-account records and provider entries are preserved for host administrator access after migration. SQLite is the default database at `backend/data/taskflow.db`; PostgreSQL can be selected with `TASKFLOW_DATABASE_URL`.

The default `local_only` setting blocks requests from non-loopback clients. For trusted LAN access, the administrator disables this option in the app settings and restarts `start-all.bat`; the launcher binds the local services to the network interfaces and prints the host IP. Do not expose these development services to the public internet.

The 2D and 3D editor services do not implement public multi-tenant authentication. Use LAN mode only on a trusted network; account separation applies to TaskFlow backend records and provider credentials.

## API areas

- `GET /api/auth/status`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/auth/admin/users`, `POST /api/auth/admin/users/{id}/approve`, `POST /api/auth/admin/users/{id}/reject`, `PUT /api/auth/admin/settings`
- `GET/PUT/DELETE /api/data`
- `GET/POST/PATCH/DELETE /api/providers`
- `POST /api/chat`, `POST /api/chat/stream`, `POST /api/search`
- Motion Graphics/OpenFilm and architectural editor integration routes

AI provider keys are encrypted at rest; provider-list responses do not expose the key. Requests to external AI services use the endpoint and credentials configured by the account owner. Keep `.env` private, use only trusted provider URLs, and do not configure public-facing custom endpoints without SSRF/network controls and proper authentication.

## Telegram bot integration

Each signed-in account can configure its own BotFather token from **Settings → Telegram bot**. The token is encrypted with `TASKFLOW_ENCRYPTION_KEY`; it is never returned to the browser. The backend verifies the bot with Telegram, applies its name, description, profile photo, and command menu, then receives messages through long polling while the backend is running. No inbound webhook or public Telegram callback URL is required.

The account owner creates a one-time Telegram pairing link in settings. Only the linked Telegram user in a private chat can use the bot. Pairing codes expire after ten minutes. Bot commands use only the owner's selected provider and account-scoped active workspace. `/tasks` and `/projects` list data; `/task` and `/project` can create or update records. The bot does not delete records. Use the bot's command editor to customize command descriptions and the system instructions field to personalize its responses. Telegram and the selected AI provider may apply their own terms or usage charges.

Bot configuration endpoints require a signed-in TaskFlow account: `GET/PUT/DELETE /api/telegram-bot`, `POST /api/telegram-bot/link-code`, and `POST /api/telegram-bot/photo`.
