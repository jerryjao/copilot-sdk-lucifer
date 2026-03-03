# Copilot SDK 授權與 Google Drive 連線指南

## 1. Copilot SDK 授權問題（重要）

### 症狀

Bot 啟動後，送出任何 prompt 都會收到：

```
session.error: Authorization error, you may need to run /login
```

錯誤詳情：

```json
{
  "errorType": "authorization",
  "message": "Authorization error, you may need to run /login",
  "statusCode": 401
}
```

注意：即使 `getAuthStatus()` 回傳 `isAuthenticated: true`，`session.send()` 仍可能 401。

### 根因

`.env` 中的 `COPILOT_GITHUB_TOKEN` 使用了 **fine-grained PAT**（`github_pat_...`），此類 token 不支援 Copilot API。Copilot SDK 需要帶有 `copilot` scope 的 **OAuth token**（`gho_...`）。

| Token 類型 | 前綴 | 支援 Copilot SDK |
|---|---|---|
| Fine-grained PAT | `github_pat_` | 不支援 |
| Classic PAT | `ghp_` | 需手動加 `copilot` scope |
| GitHub CLI OAuth | `gho_` | 支援（需含 `copilot` scope） |

### 修復步驟

1. 確認 `gh` CLI 已登入且有 `copilot` scope：

```bash
gh auth status
# 確認 Token scopes 包含 'copilot'
```

2. 如果沒有 `copilot` scope，重新登入：

```bash
gh auth login --scopes copilot
```

3. 取得正確的 OAuth token：

```bash
gh auth token
# 輸出 gho_... 格式的 token
```

4. 更新 `.env`：

```
COPILOT_GITHUB_TOKEN=gho_xxxxxxxxxxxxxxxx
```

5. 重新啟動 bot。

### 注意事項

- `gho_` token 會定期過期，如果再次出現 401，重複步驟 3-5 即可。
- 在新電腦上首次設定時，務必先執行 `gh auth login --scopes copilot`。
- `getAuthStatus()` 檢查的是 token 格式有效性，不代表 Copilot API 可用，真正的驗證發生在 `session.send()` 時。

### 快速驗證腳本

```bash
node --input-type=module << 'EOF'
import dotenv from 'dotenv';
dotenv.config();
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient();
await client.start();
const session = await client.createSession({ model: 'gpt-5-mini' });

let ok = true;
session.on((event) => {
  if (event.type === 'session.error') { console.log('Token 無效:', event.data?.message); ok = false; }
  if (event.type === 'session.idle' && ok) console.log('Token 有效，Copilot SDK 正常運作');
});
await session.send({ prompt: '說 hello' });
await new Promise(r => setTimeout(r, 10000));
await client.stop();
EOF
```

---

## 2. Google Drive 連線設定

### 必要環境變數

```
GOOGLE_CLIENT_ID=<GCP OAuth 2.0 Client ID>
GOOGLE_CLIENT_SECRET=<GCP OAuth 2.0 Client Secret>
GOOGLE_REFRESH_TOKEN=<OAuth2 Refresh Token>
```

取得 refresh token：`npm run google-auth`

### GCP 專案需啟用的 API

Google Drive tools 使用 4 個 API，必須在 Google Cloud Console 手動啟用：

| API | 用途 | 啟用連結 |
|---|---|---|
| Google Drive API | 列出檔案、下載圖片 | `console.cloud.google.com/apis/api/drive.googleapis.com` |
| Google Docs API | 讀取文件內容 | `console.cloud.google.com/apis/api/docs.googleapis.com` |
| Google Sheets API | 讀取試算表 | `console.cloud.google.com/apis/api/sheets.googleapis.com` |
| Google Slides API | 讀取簡報 | `console.cloud.google.com/apis/api/slides.googleapis.com` |

如果 API 未啟用，會收到 403 錯誤：

```
Google Sheets API has not been used in project XXXXX before or it is disabled.
```

### Google Drive 連線測試腳本

#### 1. 基礎連線測試（`test-gdrive-mcp.mjs`）

驗證 OAuth2 認證與 API 可用性：

```bash
node scripts/test-gdrive-mcp.mjs
```

此腳本會依序測試：
1. OAuth2 Access Token 取得
2. Google Drive API（列出最近 5 個檔案）
3. Google Docs API（探測連線狀態）
4. Google Sheets API（探測連線狀態）
5. Google Slides API（探測連線狀態）

#### 2. 工具功能實際測試（`test-gdrive-tools.mjs`）

測試四個 Google Drive 工具的實際讀取功能。此腳本包含預設測試案例（無需提供參數）：

```bash
# 使用預設測試案例
node scripts/test-gdrive-tools.mjs

# 或查看說明
node scripts/test-gdrive-tools.mjs --help

# 或提供自訂的 Google 文件 ID
node scripts/test-gdrive-tools.mjs [docId] [slideId] [sheetId] [imageId]
```

此腳本會測試：
- ✅ `gdrive_read_document` — 讀取 Google Docs 文字內容（含標題層級）
- ✅ `gdrive_read_slides` — 讀取 Google Slides 所有頁面內容
- ✅ `gdrive_read_spreadsheet` — 讀取 Google Sheets（tab 分隔格式）
- ✅ `gdrive_get_image` — 下載 Google Drive 圖片檔案

每個測試會顯示：
- 執行結果（成功/失敗）
- 資料統計（字元數、行數、位元組數）
- 內容預覽（前 5 行）

### 工具清單

| Tool 名稱 | 功能 | 來源 |
|---|---|---|
| `gdrive_read_document` | 讀取 Google Docs 文字內容 | `fetchGoogleDocContent()` |
| `gdrive_read_slides` | 讀取 Google Slides 每頁文字 | `fetchGoogleSlidesContent()` |
| `gdrive_read_spreadsheet` | 讀取 Google Sheets（tab 分隔） | `fetchGoogleSheetsContent()` |
| `gdrive_get_image` | 下載 Google Drive 圖片供 AI 分析 | `fetchGoogleDriveImageBuffer()` |

**實作位置**：`src/utils.ts`（第 313～470 行）

---

## 3. 新電腦設定 Checklist

1. 安裝 Node.js 18+
2. `npm install`
3. 安裝 GitHub CLI：`brew install gh`
4. 登入 GitHub（含 copilot scope）：`gh auth login --scopes copilot`
5. 設定 `.env`：
   - `TELEGRAM_BOT_TOKEN`：從 BotFather 取得
   - `COPILOT_GITHUB_TOKEN`：執行 `gh auth token` 取得（必須是 `gho_` 開頭）
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：從 GCP Console 取得
   - `GOOGLE_REFRESH_TOKEN`：執行 `npm run google-auth` 取得
6. 確認 GCP 專案已啟用 Drive / Docs / Sheets / Slides 四個 API（詳見「GCP 專案需啟用的 API」段落）
7. 驗證連線：
   - 執行 `node scripts/test-gdrive-mcp.mjs` 驗證基礎認證
   - 執行 `node scripts/test-gdrive-tools.mjs` 驗證工具功能（使用預設測試案例）
8. 執行 `npm start` 啟動 bot
