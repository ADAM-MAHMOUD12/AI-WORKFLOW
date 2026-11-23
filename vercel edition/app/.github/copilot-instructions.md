# AI TaskFlow contribution instructions

## Architecture

- The React/Vite application lives in `src/` and communicates with the FastAPI backend under `backend/`.
- Account-scoped records, providers, app data, and GitHub/Telegram links must remain isolated by the authenticated user.
- TF CODE actions are JSON in `taskflow-actions` envelopes. Supported workspace actions are validated in `src/aiActions.ts` and `vscode-extension/extension.js`.
- Terminal commands are not sandboxed and run with the VS Code user's permissions. Never propose destructive commands or commands that access data outside the active workspace.

## Account management

- Preserve existing sessions and provider credentials when switching accounts.
- Do not store passwords or provider API keys in browser app data or local source files.
- Account removal means removing a saved browser session. Permanent account deletion must call `/api/auth/account` and remove server-owned data.
- Saved account sessions are local convenience state only; every backend request must still validate the active bearer token.

## TF CODE and VS Code

- Review mode is the default for file and terminal actions.
- Automatic mode may execute generated actions without a separate approval per action, but deletion and sensitive commands remain guarded.
- On Windows, prefer `powershell` for Python/test commands. Accept `bash` only for Bash-specific commands, and preserve `cmd` support.
- Terminal output and exit codes must be shown in the chat timeline. The VS Code extension must include a fallback capture path when shell integration is unavailable.
- Never claim a file edit or test succeeded until VS Code returns a result or a terminal exit code.

## Documentation and validation

- Update `README.md` and `backend/README.md` whenever account, TF CODE, provider, or terminal behavior changes.
- Run `npm run build` and the focused ESLint/pytest/Node test commands that cover changed behavior.
- Do not commit API keys, passwords, session tokens, `.env` files, generated release archives, or user-specific local database files.
