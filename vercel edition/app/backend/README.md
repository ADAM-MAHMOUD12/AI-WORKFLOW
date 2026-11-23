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

## Vercel multi-service deployment

The Vercel edition's `vercel.json` defines two services: the Vite app is public at `/`, and the FastAPI backend is exposed only through `/api/*`. The browser uses that same-origin rewrite when served on the default HTTP(S) port; local development keeps using the configured API port. The backend does not call another Vercel service, so this topology has no service bindings. Vercel installs the smaller `requirements-vercel.txt`; local Windows runs continue to use the full `requirements.txt`.

TF CODE can use the existing VS Code bridge from a hosted TaskFlow origin. Download the bundled VSIX from the hosted Programming page and install it in VS Code with **Install from VSIX**. Then choose **TF CODE: Open Chat → Connect TaskFlow**, enter the HTTPS deployment URL, open the hosted Programming page, and approve the connection in VS Code. The browser calls the loopback-only extension bridge; workspace files and terminal commands stay on that user's computer. The bridge requires HTTPS for remote origins, exact-origin pairing, and explicit VS Code approval. Never expose its loopback server or switch the agent to automatic mode on a shared or untrusted computer.

Vercel cannot run device-local 2D/3D, OpenFilm, speech/model downloads, or persistent programming workspaces itself. The hosted app routes supported device operations through each user's paired loopback-only local assistant; it never shares a host terminal or local file system between users. Telegram bots use authenticated Telegram webhooks on the hosted API rather than a long-running polling task. Vercel mode requires persistent PostgreSQL and enforces account isolation and administrator approval for new accounts.

Configure these Vercel environment variables for the `backend` service before deploying:

- `DATABASE_URL` (from the connected Prisma Postgres resource) or `TASKFLOW_DATABASE_URL`: a managed PostgreSQL connection string. SQLite on the function filesystem is rejected because it is ephemeral.
- `TASKFLOW_ENCRYPTION_KEY`: a persistent Fernet key generated with `cryptography.fernet.Fernet.generate_key()`. Keep the same key across deployments.
- `TASKFLOW_PUBLIC_URL`: optional public HTTPS origin for custom domains; otherwise the backend uses Vercel's stable `VERCEL_PROJECT_PRODUCTION_URL` to register Telegram webhooks.
- `TASKFLOW_API_TOKEN`: optional in Vercel mode because authenticated user sessions are required; set it if another integration needs it.
- `TASKFLOW_GITHUB_CLIENT_ID`: optional, only if GitHub sign-in is enabled.

Vercel mode forces multi-user isolation and administrator approval for new accounts, disables device-local engines, and rejects device-dependent API routes. Use Vercel Deployment Protection while creating the first administrator account: the first registration becomes the administrator. The local Windows launcher and its full device integrations are unchanged.

The speaking trainer uses the local Piper TTS engine. English and Arabic voice models are downloaded on demand into `backend/data/speaking-voices`; each model download is pinned and checksum-verified. The selected voice datasets have their own licensing terms—review the linked model cards before commercial use: [Arabic Kareem](https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium) and [British English Alan](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alan/medium). Piper is GPL-3.0; see [Piper's license](https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING).

Microphone transcription uses a local multilingual Whisper base model (CPU int8), downloaded on demand into `backend/data/speech-models` from a pinned [Systran model revision](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66). Its complete pinned download is approximately 148 MB. Audio recordings are sent only to this local backend for transcription and are deleted after processing.

Florence-2, Whisper, and Piper downloads expose their actual transferred bytes, total bytes, and remaining bytes through the local `/api/downloads/{download_id}` status endpoint; the interface polls this endpoint while each download is active.

W2M's Design Studio can download a pinned, quantized [Florence-2-base-ft ONNX model](https://huggingface.co/onnx-community/Florence-2-base-ft/tree/e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f) on demand. The selected graphs are capped at 500 MB and stored under `backend/data/w2m-models`; inference uses ONNX Runtime CPU with one serialized request, disabled CPU memory arenas, and at most two CPU threads. Images are limited to 4 MB and 2048×2048 pixels. After the download, inference and post-render image analysis are local and work offline. These settings target low memory use, but actual RAM depends on the device and is not hard-capped by the process. Florence-2 is a general vision model, not a guarantee of exact OCR or design quality; detected layout defects use measurable SVG bounds and text overlap, with at most two provider correction attempts.

## Programming workspace

The Programming page keeps project source files in the browser's local storage and opens the project in VS Code. Its chat asks the configured AI provider for a standard `taskflow-actions` JSON block containing supported code actions such as `code.write_file`, `code.open_file`, and `code.run_command`. The web app and VS Code extension validate each action and workspace-relative path before presenting it; review is the default, and automatic execution is an explicit user-selected mode. The provider creates the proposed source files; TaskFlow does not use a custom programming language or compiler.

TF CODE displays each chat's steps inside that message, including discussion, proposed files, commands, live terminal output, exit codes, and final results. Terminal actions accept PowerShell and CMD on Windows, plus Bash for Bash-specific commands. If VS Code shell integration is unavailable, the bridge falls back to a captured process so command output and the exit code remain verifiable.

Terminal commands run without elevation as the VS Code user's operating-system account. The working directory is **not** an operating-system sandbox: a command may still read or change other files accessible to that account. Run only commands you understand and trust. Do not expose the local editor bridge to an internet-facing deployment or an untrusted multi-user host.

The project preview runs HTML in a sandboxed iframe and renders Markdown locally. Other languages require an installed runtime and a user-approved local command. Open-source tool cards link to their upstream repositories and only prepare an install command for review; they do not install dependencies without approval.

## Accounts and data isolation

Registration, login, logout, current-user, account deletion, administrator settings, and account approval are exposed under `/api/auth`. The first registered account becomes the host administrator. Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes; random session tokens are only stored as hashes. New accounts can remain pending until the administrator approves them. Administrators can block non-admin accounts with a note shown at sign-in, revoke their sessions, unblock them, or permanently delete them. Account deletion removes account-scoped data and credentials. The last administrator cannot delete their own account while other accounts remain.

The browser can keep multiple approved account sessions locally and switch the active account through Settings or the sign-in screen. Removing an account removes only the local saved session and does not delete server data. Permanent deletion uses the authenticated account session and removes the account, providers, app data, GitHub and Telegram links, and sessions owned by that account.

When multi-user mode is enabled, app-data rows and AI providers are scoped to the authenticated user. Clients cannot select another user's ID. Existing pre-account records and provider entries are preserved for host administrator access after migration. SQLite is the default database at `backend/data/taskflow.db`; PostgreSQL can be selected with `TASKFLOW_DATABASE_URL`.

The default `local_only` setting blocks requests from non-loopback clients. For trusted LAN access, the administrator disables this option in the app settings and restarts `start-all.bat`; the launcher binds the local services to the network interfaces and prints the host IP. Do not expose these development services to the public internet.

The 2D and 3D editor services do not implement public multi-tenant authentication. Use LAN mode only on a trusted network; account separation applies to TaskFlow backend records and provider credentials.

## GitHub sign-in and account linking

GitHub sign-in uses the OAuth device flow so the desktop/local app never embeds or asks end users for an OAuth client secret. Register one GitHub OAuth App for the TaskFlow host, enable **Device Flow** in its settings, then set `TASKFLOW_GITHUB_CLIENT_ID` in `backend/.env` and restart the backend. The Client ID is public; no client secret is needed for this flow.

Users can then choose **Continue with GitHub** on the TaskFlow sign-in screen. New GitHub identities create TaskFlow accounts subject to the host's account and approval settings. GitHub identities are never automatically attached to an existing TaskFlow account by matching email; sign in to that account and link GitHub once in TaskFlow settings. Programming workspaces are local folders opened by the installed Microsoft VS Code app. GitHub repository list/clone and Git stage/commit/push APIs remain authenticated backend operations; pushes require confirmation and GitHub write permission. Login requests `read:user`; account linking requests `repo read:user` to prepare repository access. The `repo` scope can modify repositories, so review GitHub's consent screen before approving. The encrypted GitHub access token is stored server-side and is never returned to the browser or written into a cloned repository's remote URL.

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
- `POST /api/programming/run` for user-approved local CMD/PowerShell commands; commands execute with the backend process privileges, so review each command before approval.
- Motion Graphics/OpenFilm and architectural editor integration routes

AI provider keys are encrypted at rest; provider-list responses do not expose the key. Requests to external AI services use the endpoint and credentials configured by the account owner. Keep `.env` private, use only trusted provider URLs, and do not configure public-facing custom endpoints without SSRF/network controls and proper authentication.

## Shared AI skills

The public `AI-TASKFLO-SKILLS` catalog is shared by the TaskFlow web app and its TF CODE agent mode. Adding a skill saves it to the signed-in account's `skills` app-data record. AI Chat includes selected skill instructions in requests to the account's chosen provider, including TF CODE agent requests.

![Shared skills flow between AI TaskFlow and TF CODE](https://raw.githubusercontent.com/ADAM-MAHMOUD12/AI-TASKFLO-SKILLS/main/docs/shared-library.svg)

The separate skills.sh directory supplies current popular and searchable community skills. The authenticated backend proxies its public search API and fetches a selected skill only from the public GitHub repository named by the result. Repository owners, skill IDs, tree paths, file size, and SKILL.md front matter are validated before the content is returned. Users choose each skill before importing it.

## Telegram bot integration

Each signed-in account can configure its own BotFather token from **Settings → Telegram bot**. The token is encrypted with `TASKFLOW_ENCRYPTION_KEY`; it is never returned to the browser. The backend verifies the bot with Telegram, applies its name, description, profile photo, and command menu, then receives messages through long polling while the backend is running. No inbound webhook or public Telegram callback URL is required.

The account owner creates a one-time Telegram pairing link in settings. Only the linked Telegram user in a private chat can use the bot. Pairing codes expire after ten minutes. Bot commands use only the owner's selected provider and account-scoped active workspace. `/tasks` and `/projects` list data; `/task` and `/project` can create or update records. The bot does not delete records. Use the bot's command editor to customize command descriptions and the system instructions field to personalize its responses. Telegram and the selected AI provider may apply their own terms or usage charges.

Bot configuration endpoints require a signed-in TaskFlow account: `GET/PUT/DELETE /api/telegram-bot`, `POST /api/telegram-bot/link-code`, and `POST /api/telegram-bot/photo`.
