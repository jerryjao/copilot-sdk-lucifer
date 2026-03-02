# Plan: Google Drive Tools for Copilot SDK Agent（TDD 方式）

## Context
讓 Copilot SDK Agent 在推理過程中能**主動呼叫 Google Drive 工具**讀取 Docs / Slides / Sheets 及圖片。
工具透過 `createSession({ tools: [...] })` 注入，Agent 自主決定何時讀取哪個檔案。

認證：OAuth2（`google-drive-tool/client_secret_*.json` + Refresh Token）
觸發：Agent 推理時自主呼叫工具（而非 Bot 預先抓取內容注入 prompt）

> 📁 `google-drive-tool/` 資料夾整合所有 Google Drive 相關檔案（憑證 + 授權腳本），整包加入 `.gitignore` 不 commit。

---

## 架構說明

```
使用者 → Telegram Bot → session.send({ prompt })
                              ↓
                        Copilot Agent 推理
                              ↓
                    Agent 決定呼叫 gdrive 工具
                              ↓
              gdrive_read_document / gdrive_read_slides /
              gdrive_read_spreadsheet / gdrive_get_image
                              ↓
                    handler 呼叫 Google API
                              ↓
                    工具結果回傳給 Agent
                              ↓
                      Agent 完成推理、回應
```

---

## 支援的工具（Tool Definitions）

| 工具名稱 | 說明 | 回傳 |
|---------|------|------|
| `gdrive_read_document` | 讀取 Google Docs 文字 | 純文字（含標題/標題層級） |
| `gdrive_read_slides` | 讀取 Google Slides 文字 | 各頁文字（附頁碼） |
| `gdrive_read_spreadsheet` | 讀取 Google Sheets 資料 | Tab 分隔表格文字 |
| `gdrive_get_image` | 下載 Google Drive 圖片 | ToolResultObject with binaryResultsForLlm |

所有工具的參數都可以接受**完整 URL 或直接 ID**。

---

## Critical Files

- `src/utils.ts` — Google Drive API 函式（純函式，可測試）
- `src/tools.ts` — **新建**：工具定義（`defineTool` from Copilot SDK）
- `src/index.ts` — 更新 `startSession()` 加入 tools，無需修改 ChatState
- `google-drive-tool/google-auth.ts` — **新建**：一次性 OAuth2 授權腳本（與憑證放在同一資料夾）
- `tests/googleUtils.test.ts` — **新建**：mock googleapis 的 Google API 函式測試
- `tests/tools.test.ts` — **新建**：工具 handler 邏輯測試
- `tests/utils.test.ts` — 新增 URL 解析函式測試
- `package.json` — 加入 `googleapis` 依賴

---

## OAuth2 設定（實作後的一次性執行流程）

```sh
# 1. 設定憑證路徑（google-drive-tool/ 已有 client_secret_*.json）
echo "GOOGLE_CLIENT_SECRET_PATH=./google-drive-tool/client_secret_*.json" >> .env

# 2. 執行授權（申請 drive.readonly）
npm run google-auth
# → 複製網址到瀏覽器 → Google 帳號登入授權 → 複製授權碼貼回

# 3. 將 Refresh Token 加入 .env
echo "GOOGLE_REFRESH_TOKEN=<token>" >> .env
```

---

## 不需要修改的部分

- `ChatState` 介面 — 無需加任何欄位
- `bot.on('message')` — 無需偵測 URL 或預先抓取
- Session event handlers — 無需修改（SDK 自動處理工具呼叫）
