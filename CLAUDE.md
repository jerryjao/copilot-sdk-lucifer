# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript source, with the bot entry point in `src/index.ts` and shared helpers in `src/utils.ts`. `tests/` holds Jest unit tests. `dist/` is the compiled output from `npm run build` and should not be edited by hand. Configuration defaults live in `directories.json`, while local secrets belong in `.env`.

## Build, Test, and Development Commands
```sh
npm install            # install dependencies
npm run build          # compile TypeScript to dist/
npm run dev            # run from src with ts-node (ESM)
npm start              # build then run dist/index.js
npm test               # run Jest test suite
npm run test:coverage  # run tests with coverage report
```
Node.js 18+ is required (see `package.json`).

## Coding Style & Naming Conventions
The codebase uses TypeScript with `strict` enabled in `tsconfig.json` and ESM imports/exports. Indentation is 2 spaces, and strings use single quotes in source files. Use camelCase for variables and functions, PascalCase for types/interfaces, and keep filenames simple and descriptive (e.g., `utils.ts`). Test files should be named `*.test.ts` under `tests/`.

## Testing Guidelines
Jest + ts-jest are configured in `jest.config.js`. Add or update unit tests whenever changing command parsing, session lifecycle handling, or utility helpers. Keep tests focused and mock Telegram/Copilot integrations where possible to avoid external dependencies.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits with optional scopes, such as `feat: ...`, `fix(bot): ...`, `docs(README): ...`, and `test: ...`. For PRs, include a short summary, list tests run (or explain why not), and call out any new environment variables or config changes. For user-facing behavior, include a short example of bot output or a screenshot of the chat flow.

## Agent-Specific Instructions
Use this prompt when asking an AI to write code for this repo:
```
你是本專案的協作 AI。每次完成任何程式碼變更並準備提交時，請以繁體中文撰寫詳細的提交訊息與變更記錄，並遵循 Conventional Commits 1.0.0 格式。提交訊息需包含 `type(scope): subject`，接著空一行，列出變更原因、行為影響與測試結果（若未執行請說明原因）。請只輸出建議的提交訊息內容，不要直接執行 git commit。
```

## Security & Configuration Tips
以下環境變數皆存放於 `.env`，不得提交至版本控制：
- `TELEGRAM_BOT_TOKEN`：Telegram BotFather 取得
- `COPILOT_GITHUB_TOKEN`：**必須**使用 `gho_` 開頭的 OAuth token（見下方說明）
- `DIRECTORY_PATTERNS`、`COPILOT_MODEL`：Bot 運行設定
- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN`：Google Drive 整合

Ensure the Copilot CLI is installed and available on `PATH` before running locally.

### COPILOT_GITHUB_TOKEN（關鍵）
`COPILOT_GITHUB_TOKEN` **絕對不能**使用 fine-grained PAT（`github_pat_`），此類 token 不支援 Copilot API，會導致所有 `session.send()` 回傳 401 Authorization error，且錯誤訊息容易被誤判為 Google Drive 問題。

正確設定方式：
```bash
gh auth login --scopes copilot   # 首次設定，確保有 copilot scope
gh auth token                     # 取得 gho_... token，貼到 .env
```

`gho_` token 會定期過期，出現 401 時重新執行 `gh auth token` 更新即可。

### Google Drive 連線
GCP 專案需啟用 Drive / Docs / Sheets / Slides 四個 API。連線測試腳本：`node scripts/test-gdrive-connection.mjs`。

## Troubleshooting
詳細的連線問題排查、錯誤對照表與新電腦設定 Checklist 請參考 [docs/copilot-sdk-auth-and-gdrive.md](docs/copilot-sdk-auth-and-gdrive.md)。
