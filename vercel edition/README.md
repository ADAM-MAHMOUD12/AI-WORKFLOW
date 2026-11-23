# AI TaskFlow Vercel edition

This is a self-contained copy of the application. The original project files in the parent directory are not used by this edition. Vercel must use **`vercel edition`** as the project's Root Directory; its `vercel.json` builds the frontend from `app` and the API from `app/backend`.

## What runs where

- Vercel hosts the frontend and API. Accounts, provider credentials, conversations, and normal application data are stored in the configured PostgreSQL database.
- Each user's local assistant runs only on `127.0.0.1:17411`, starts this edition's local TaskFlow launcher when necessary, and forwards an allowlisted set of device APIs to that user's local backend.
- The browser and assistant pair with a one-time code. The assistant verifies the signed-in cloud account on every request and sends a signed identity to the local backend. Cloud session tokens are not saved by the assistant.
- Programming workspace files, model downloads/inference, speech processing, motion projects, and local editor APIs execute on the user's computer. The 2D and 3D editors use local loopback ports. For hosted TF CODE, the VS Code extension initiates an outbound HTTPS relay; the hosted browser never connects to localhost. VS Code actions execute in the open workspace, with separate confirmation required for Git pull and push.
- Telegram bots use Telegram webhooks to reach the hosted API; they do not depend on a permanently running polling process on Vercel.
- The assistant never listens on a LAN or public interface. Do not tunnel, port-forward, or expose its port.

## Deploy to Vercel

1. In Vercel, import the repository and set **Root Directory** to `vercel edition`. Do not deploy from the repository root.
2. The connected Prisma Postgres database supplies `DATABASE_URL` in production, preview, and development. The backend accepts this PostgreSQL URL directly; SQLite is not persistent on Vercel.
3. Configure these variables on the `backend` service:
   - `TASKFLOW_ENCRYPTION_KEY`: persistent Fernet key; keep it unchanged between deployments.
   - `TASKFLOW_INITIAL_ADMIN_KEY`: temporary high-entropy key required to register the first administrator. Keep it secret; registration stays protected by this key until the first account is created.
   - `TASKFLOW_GITHUB_CLIENT_ID`: optional, if GitHub sign-in is enabled.
4. Vercel's `VERCEL_PROJECT_PRODUCTION_URL` supplies the stable origin used by Telegram webhooks. Optionally set `TASKFLOW_PUBLIC_URL` to your public HTTPS custom domain, without a path.
5. Open the hosted site, choose **Create a new account**, and enter the initial administrator setup key along with the username and password. Only that key can claim the first administrator account.
6. Install the TF CODE VS Code extension from the hosted Programming page on each computer used for coding. For additional device features, install and start the local assistant separately. Features requiring a device will not run until that computer's user has paired the relevant extension or assistant.

The app and backend services are public only through the `/` and `/api/*` rewrites respectively. No service binding is needed: the browser's same-origin `/api` requests are routed to the backend by Vercel.

## Start the local assistant

1. To use local engines and device features, run `vercel edition\app\start-all.bat` once to install/check dependencies, then close any duplicate TaskFlow processes.
2. To connect the separate local assistant, run `vercel edition\start-local-assistant.bat` and keep its console open. It prints a temporary pairing code valid for ten minutes; enter it in **Programming → Local TaskFlow assistant**.
3. To use hosted TF CODE, install `vercel edition\app\public\downloads\TF-CODE-Agent-Bridge.vsix` using VS Code's **Install from VSIX**, then reload VS Code.
4. Open the project folder in VS Code and choose **TF CODE: Connect to TaskFlow** from the Command Palette or the TF CODE connection panel. Enter the hosted HTTPS URL. The extension opens the site and displays a one-time code.
5. Sign in to TaskFlow, open **Programming → TF CODE**, enter that code, and select **Connect extension over HTTPS**. Keep VS Code online with the same project folder open. No browser local-network permission is needed for this connection.
6. TF CODE runs Git pull/push through VS Code's Git integration and always asks for confirmation inside VS Code. Git uses the credentials configured on that computer.

Use the assistant only for an account and computer you control. The local terminal runs as your Windows user and is not an operating-system sandbox. Review actions before execution; do not enable automatic execution on a shared or untrusted computer.

## Local development and tests

The original project remains available from the repository root and is independent of this copy. To run this edition locally, use `vercel edition\app\start-all.bat`; the assistant is optional unless connecting this local browser to a hosted site.

Run the assistant and backend tests from the repository root after installing the app's local backend dependencies:

```powershell
.\vercel edition\app\backend\.venv\Scripts\python.exe -m pytest ".\vercel edition\test_local_assistant.py" ".\vercel edition\app\backend\test_account_management.py"
```

The hosted web app uses device-dependent features only while the matching local assistant, engine, or VS Code extension is connected. Cloud-only operations remain on Vercel.
