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

Microphone transcription uses a local multilingual Whisper base model (CPU int8), downloaded on demand into `backend/data/speech-models` from a pinned [Systran model revision](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66). Its complete pinned download is approximately 148 MB. Audio recordings are sent only to this local backend for transcription and are deleted after processing.

Florence-2, Whisper, and Piper downloads expose their actual transferred bytes, total bytes, and remaining bytes through the local `/api/downloads/{download_id}` status endpoint; the interface polls this endpoint while each download is active.

W2M's Design Studio can download a pinned, quantized [Florence-2-base-ft ONNX model](https://huggingface.co/onnx-community/Florence-2-base-ft/tree/e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f) on demand. The selected graphs are capped at 500 MB and stored under `backend/data/w2m-models`; inference uses ONNX Runtime CPU with one serialized request, disabled CPU memory arenas, and at most two CPU threads. Images are limited to 4 MB and 2048×2048 pixels. After the download, inference and post-render image analysis are local and work offline. These settings target low memory use, but actual RAM depends on the device and is not hard-capped by the process. Florence-2 is a general vision model, not a guarantee of exact OCR or design quality; detected layout defects use measurable SVG bounds and text overlap, with at most two provider correction attempts.

## Programming workspace

The Programming page keeps project source files in the browser's local storage. AI suggestions are presented for review before the user applies them. Suggested shell commands never run automatically: each run prompts for explicit confirmation in the interface, and the backend accepts command requests only from a loopback connection. In multi-user mode only the host administrator can run commands. Commands run without elevation as the backend's current operating-system account, from an owner-scoped project directory, with a 60-second timeout and bounded output. The working directory is **not** an operating-system sandbox: a shell command may still read or change other files accessible to that account. Run only commands you understand and trust. The endpoint is not suitable for an internet-facing deployment or an untrusted multi-user host.

The project preview runs HTML in a sandboxed iframe and renders Markdown locally. Other languages require an installed runtime and a user-approved local command. Open-source tool cards link to their upstream repositories and only prepare an install command for review; they do not install dependencies without approval.

## Accounts and data isolation

Registration, login, logout, current-user, account deletion, administrator settings, and account approval are exposed under `/api/auth`. The first registered account becomes the host administrator. Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes; random session tokens are only stored as hashes. New accounts can remain pending until the administrator approves them. Administrators can block non-admin accounts with a note shown at sign-in, revoke their sessions, unblock them, or permanently delete them. Account deletion removes account-scoped data and credentials. The last administrator cannot delete their own account while other accounts remain.

When multi-user mode is enabled, app-data rows and AI providers are scoped to the authenticated user. Clients cannot select another user's ID. Existing pre-account records and provider entries are preserved for host administrator access after migration. SQLite is the default database at `backend/data/taskflow.db`; PostgreSQL can be selected with `TASKFLOW_DATABASE_URL`.

The default `local_only` setting blocks requests from non-loopback clients. For trusted LAN access, the administrator disables this option in the app settings and restarts `start-all.bat`; the launcher binds the local services to the network interfaces and prints the host IP. Do not expose these development services to the public internet.

The 2D and 3D editor services do not implement public multi-tenant authentication. Use LAN mode only on a trusted network; account separation applies to TaskFlow backend records and provider credentials.

## GitHub sign-in and account linking

GitHub sign-in uses the OAuth device flow so the desktop/local app never embeds or asks end users for an OAuth client secret. Register one GitHub OAuth App for the TaskFlow host, enable **Device Flow** in its settings, then set `TASKFLOW_GITHUB_CLIENT_ID` in `backend/.env` and restart the backend. The Client ID is public; no client secret is needed for this flow.

Users can then choose **Continue with GitHub** on the TaskFlow sign-in screen. New GitHub identities create TaskFlow accounts subject to the host's account and approval settings. GitHub identities are never automatically attached to an existing TaskFlow account by matching email; sign in to that account and link GitHub once in TaskFlow settings. TF CODE uses that saved link to list accessible repositories and clone a selected repository into its own local workspace. The Source Control panel shows live Git status, lets users stage or unstage selected files, create commits with a configurable title, description, author and email, and push commits to GitHub. Push requires confirmation and GitHub write permission. Login requests `read:user`; account linking requests `repo read:user` to prepare repository access. The `repo` scope can modify repositories, so review GitHub's consent screen before approving. The encrypted GitHub access token is stored server-side and is never returned to the browser or written into the cloned repository's remote URL.

## API areas

- `GET /api/auth/status`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/github/device/start`, `POST /api/auth/github/device/poll`, `GET /api/github/account`, `GET /api/github/repositories`, `POST /api/github/repositories/clone`, `GET /api/github/repositories/{project_id}/git-status`, `POST /api/github/repositories/{project_id}/git-stage`, `POST /api/github/repositories/{project_id}/git-commit`, `POST /api/github/repositories/{project_id}/git-push`
- `DELETE /api/auth/account`, `GET /api/auth/admin/users`, `POST /api/auth/admin/users/{id}/approve`, `POST /api/auth/admin/users/{id}/reject`, `POST /api/auth/admin/users/{id}/block`, `POST /api/auth/admin/users/{id}/unblock`, `DELETE /api/auth/admin/users/{id}`, `PUT /api/auth/admin/settings`
- `GET/PUT/DELETE /api/data`
- `GET /api/skills/library/popular`, `GET /api/skills/library/search`, `GET /api/skills/library/content` for the public skills.sh library; results are proxied through the authenticated backend and checked against public GitHub SKILL.md files.
- `GET/POST/PATCH/DELETE /api/providers`
- `POST /api/chat`, `POST /api/chat/stream`, `POST /api/search`
- `GET /api/w2m/vision/status`, `POST /api/w2m/vision/download`, `POST /api/w2m/vision/analyze`
- `GET /api/downloads/{download_id}` for local model download progress
- `POST /api/programming/run` for user-approved local CMD/PowerShell commands
- Motion Graphics/OpenFilm and architectural editor integration routes

AI provider keys are encrypted at rest; provider-list responses do not expose the key. Requests to external AI services use the endpoint and credentials configured by the account owner. Keep `.env` private, use only trusted provider URLs, and do not configure public-facing custom endpoints without SSRF/network controls and proper authentication.

## Shared AI skills

The public `AI-TASKFLO-SKILLS` catalog is shared by the TaskFlow web app and TF CODE. Adding one of these skills from either interface saves it to the signed-in account's `skills` app-data record; TF CODE also installs it under `.agents/skills/` in the open workspace. Account skills added in the web app can be copied into an IDE workspace from the same library panel. AI Chat includes saved skill instructions in requests to the account's selected provider.

The separate skills.sh directory supplies current popular and searchable community skills. The authenticated backend proxies its public search API and fetches a selected skill only from the public GitHub repository named by the result. Repository owners, skill IDs, tree paths, file size, and SKILL.md front matter are validated before the content is returned. Users choose each skill before importing it.

## Telegram bot integration

Each signed-in account can configure its own BotFather token from **Settings → Telegram bot**. The token is encrypted with `TASKFLOW_ENCRYPTION_KEY`; it is never returned to the browser. The backend verifies the bot with Telegram, applies its name, description, profile photo, and command menu, then receives messages through long polling while the backend is running. No inbound webhook or public Telegram callback URL is required.

The account owner creates a one-time Telegram pairing link in settings. Only the linked Telegram user in a private chat can use the bot. Pairing codes expire after ten minutes. Bot commands use only the owner's selected provider and account-scoped active workspace. `/tasks` and `/projects` list data; `/task` and `/project` can create or update records. The bot does not delete records. Use the bot's command editor to customize command descriptions and the system instructions field to personalize its responses. Telegram and the selected AI provider may apply their own terms or usage charges.

Bot configuration endpoints require a signed-in TaskFlow account: `GET/PUT/DELETE /api/telegram-bot`, `POST /api/telegram-bot/link-code`, and `POST /api/telegram-bot/photo`.
