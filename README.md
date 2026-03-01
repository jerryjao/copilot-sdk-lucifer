# Telegram Copilot Bot

這個專案提供一個 Telegram 機器人，讓您可以直接在聊天裡調用 GitHub Copilot CLI。使用者透過選擇工作目錄並輸入提示詞，便能要求 Copilot 撰寫程式、修改檔案或執行指定操作。機器人會即時顯示 Copilot 產生的訊息與工具執行事件。

## 功能簡介

- **目錄選擇**：啟動後先讀取預先設定的目錄模式，展開成可用的工作目錄列表。使用 `/dirs` 列出可用的工作目錄。
- **提示詞執行**：選擇目錄後，直接輸入文字即可發送到 Copilot。若當前正在處理任務，新的提示詞會排入佇列，等待上一個任務完成後自動執行。
- **事件回饋**：機器人會轉發 Copilot session 中的各種事件，例如 `assistant.message`、`assistant.message_delta`、`tool.execution_start`、`tool.execution_end` 等。這些事件類型在 Copilot SDK 文件中有說明。
- **重啟 session**：使用 `/reset` 可以隨時中止當前 Copilot session 並重新啟動。為避免破壞正在進行中的工作，程式會先停止當前 session，期間忽略新的提示詞，待停止完成後再建立新的 session。

## 系統需求

- **GitHub Copilot CLI**：請先安裝 Copilot CLI，並確保 `copilot` 執行檔可以在 `PATH` 中找到。
- **Node.js 18 以上**：Copilot SDK 需要 Node.js 18 或更新版本。
- **Telegram Bot Token**：透過與 [@BotFather](https://t.me/botfather) 對話建立機器人，取得專屬的 token。

## 安裝與設定

1. **安裝依賴**

   在專案根目錄執行：

   ```sh
   npm install
   npm run build
   ```

2. **設定環境變數**

   在專案根目錄建立 `.env` 檔案，或於 shell 中設定環境變數。

   **完整 `.env` 範例：**

   ```env
   # ===== Required =====
   # Telegram Bot Token (from @BotFather)
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

   # ===== Optional =====
   # Comma-separated directory patterns (container paths)
   DIRECTORY_PATTERNS=/workspace/projects/*,/workspace/libs/**

   # Owner chat ID (numeric)
   OWNER_CHAT_ID=123456789

   # Copilot PAT Token
   COPILOT_GITHUB_TOKEN=your_github_pat_token_here

   # Default model (use Azure deployment name if using Azure OpenAI)
   COPILOT_MODEL=gpt-5-mini

   # ===== Azure OpenAI (optional) =====
   # Azure OpenAI endpoint and key
   AZURE_OPENAI_API_ENDPOINT=https://<resource>.openai.azure.com/
   AZURE_OPENAI_API_KEY=your-azure-openai-key
   AZURE_OPENAI_API_VERSION=2024-10-21

   # ===== OpenAI-compatible provider (optional) =====
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_API_KEY=your-openai-api-key
   ```

   **欄位說明：**

   | 環境變數             | 必填 | 預設值                  | 說明                                                                                                                                            |
   | -------------------- | ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN` | ✅  | —                       | 您從 [@BotFather](https://t.me/botfather) 取得的 Telegram Bot Token。格式為 `數字:英數字串`。                                                   |
   | `DIRECTORY_PATTERNS` | ❌  | `directories.json` 內容 | 用逗號分隔的目錄匹配模式。支援萬用字元：`*` 代表第一層子目錄，`**` 代表遞迴搜尋所有子目錄。例如：`/home/user/projects/*,/home/user/libs/**`。   |
   | `OWNER_CHAT_ID`      | ❌  | —                       | 您的 Telegram Chat ID（數字）。設定後，機器人啟動時會自動發送歡迎訊息到此聊天室。                                                               |
   | `COPILOT_MODEL`      | ❌  | `gpt-5-mini`            | Copilot 預設使用的模型名稱。可用模型包括 `gpt-5`、`gpt-5-mini`、`claude-sonnet-4`、`claude-sonnet-4.5` 等，完整清單請參考下方「可用模型」章節。 |

   若未設定 `DIRECTORY_PATTERNS`，程式會讀取 `directories.json` 中的陣列作為預設目錄模式。

   **如何查詢您的 Chat ID：**

   有幾種方式可以取得您的 Telegram Chat ID：

   1. **使用 @userinfobot**（最簡單）
      - 在 Telegram 搜尋並開啟 [@userinfobot](https://t.me/userinfobot)
      - 發送任意訊息給它
      - Bot 會回覆您的 User ID（即 Chat ID）

   2. **使用 @RawDataBot**
      - 在 Telegram 搜尋並開啟 [@RawDataBot](https://t.me/RawDataBot)
      - 發送任意訊息給它
      - Bot 會回覆包含 `"id"` 欄位的 JSON 資料

   3. **透過瀏覽器開發者工具**（Telegram Web）
      - 登入 [Telegram Web](https://web.telegram.org)
      - 開啟瀏覽器開發者工具（F12）
      - 點擊「與自己的對話」（Saved Messages）
      - 在 Network 標籤中查看請求，URL 中會包含您的 Chat ID

   4. **使用 Telegram Bot API**
      - 先讓您的機器人發送一則訊息給您（或您發送訊息給機器人）
      - 在瀏覽器開啟：`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
      - 在回傳的 JSON 中找到 `"chat":{"id":...}` 欄位

3. **啟動機器人**

   建置完成後可使用下列指令啟動：

   ```sh
   npm start
   ```

   若需要在開發期間以 TypeScript 直接執行，可以使用 `npm run dev`（需安裝 `ts-node`）。

## Docker

建置映像檔：

```sh
docker build -t telegram-copilot-bot .
```

啟動容器：

```sh
docker run --rm \
  -e TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz \
  -e DIRECTORY_PATTERNS=/home/user/project1,/home/user/projects/* \
  -e OWNER_CHAT_ID=123456789 \
  -e COPILOT_MODEL=gpt-5-mini \
  telegram-copilot-bot
```

Docker on Windows

```cmd
docker run --rm -it --env-file .env.docker -v G:\Projects:/workspace/projects telegram-copilot-bot
```

Docker on WSL

```sh
docker run --rm -it --env-file .env.docker -v /mnt/g/Projects:/workspace/projects telegram-copilot-bot
```

## 可用模型

本專案支援以下 Copilot 模型，可透過 `COPILOT_MODEL` 環境變數或 `/model` 指令切換：

| 模型名稱               | 說明                         |
| ---------------------- | ---------------------------- |
| `claude-sonnet-4.5`    | Claude Sonnet 4.5            |
| `claude-haiku-4.5`     | Claude Haiku 4.5（輕量版）   |
| `claude-opus-4.5`      | Claude Opus 4.5（完整版）    |
| `claude-sonnet-4`      | Claude Sonnet 4              |
| `gpt-5.2-codex`        | GPT-5.2 Codex                |
| `gpt-5.1-codex-max`    | GPT-5.1 Codex Max            |
| `gpt-5.1-codex`        | GPT-5.1 Codex                |
| `gpt-5.2`              | GPT-5.2                      |
| `gpt-5.1`              | GPT-5.1                      |
| `gpt-5`                | GPT-5                        |
| `gpt-5.1-codex-mini`   | GPT-5.1 Codex Mini（輕量版） |
| `gpt-5-mini`           | GPT-5 Mini（預設，輕量版）   |
| `gpt-4.1`              | GPT-4.1                      |
| `gemini-3-pro-preview` | Gemini 3 Pro Preview         |

## 使用說明

### 完整指令一覽

| 指令            | 說明                                                        |
| --------------- | ----------------------------------------------------------- |
| `/start`        | 顯示歡迎訊息與使用說明                                      |
| `/help`         | 同 `/start`，顯示歡迎訊息與使用說明                         |
| `/dirs`         | 列出可用的工作目錄，以 Inline Keyboard 方式選擇             |
| `/model [編號]` | 查看可用模型清單，或以編號直接切換模型                      |
| `/status`       | 查看目前 session 狀態（模型、工作目錄、忙碌狀態、佇列長度） |
| `/st`           | `/status` 的簡寫                                            |
| `/reset`        | 重新啟動目前的 Copilot session，並清除等待佇列              |
| `/shutdown`     | 關閉整個 Copilot Bot                                        |

### 基本流程

1. **查看工作目錄**

   在 Telegram 對話中輸入：

   ```
   /dirs
   ```

   機器人會列出目前可用的工作目錄列表，以 Inline Keyboard 方式顯示供點選。

2. **傳送提示詞**

   選擇工作目錄後，直接輸入想要 Copilot 執行的描述。例如：

   ```
   請建立一個簡單的 REST API 伺服器
   ```

   程式會將提示送入 Copilot session，並透過事件回饋將回應內容和工具執行狀態顯示在 Telegram 中。若正在處理其他任務，新的提示會自動排隊等待。

3. **上傳圖片作為參考**

   直接傳送圖片（或圖片檔案）給機器人，圖片會被儲存並附加到後續的提示詞作為參考上下文。也可以在圖片加上說明文字，同時上傳圖片並發送提示。

4. **切換模型**

   ```
   /model
   ```

   機器人會列出所有可用模型，以 Inline Keyboard 方式顯示供點選。也可以直接輸入 `/model 2` 以編號選擇模型。

5. **重新啟動 session**

   隨時可以輸入：

   ```
   /reset
   ```

   這會中止當前 Copilot session 並重新建立一個新的 session。同時會清除等待佇列。為避免干擾正在處理的工作，程式會先等待 session 停止，再啟動新的 session。

6. **結束程式**

   在伺服器上使用 `Ctrl+C` 或發送 `SIGINT` 即可結束程式。程式會自動釋放 Copilot session 與 CLI 進程資源。也可以使用 `/shutdown` 指令遠端關閉機器人。

### 對話與佇列行為

- 同一個聊天會共用同一個 Copilot session。只要沒有重啟 session，連續提示會沿用同一個上下文。
- 當上一個提示仍在處理中時，新的提示會自動加入等待佇列，等到 session 進入 idle 後才會依序執行，不會影響正在執行的任務。
- 觸發 `/reset` 時會清空等待佇列並重啟 session。重啟期間會拒絕新的提示，直到新 session 建立完成。

## 事件說明與範例

本專案會轉發 Copilot SDK 發出的主要事件到 Telegram，以下為各事件的說明與常見範例：

- assistant.message：助理完成回覆，代表本次生成已結束，會傳回最終文字內容。
  範例輸出：一段完整的回覆文字（程式碼或說明）。

- assistant.message_delta：串流回覆的片段，表示模型正在產生回應，可用於即時顯示生成進度。
  範例輸出：部分程式碼片段或逐步生成的文字。

- tool.execution_start：外部工具開始執行的通知，訊息中會包含工具名稱與呼叫參數（通常為 JSON）。
  範例輸出：工具名稱與參數，例如 {"toolName":"run_tests","params":{"suite":"unit"}}。

- tool.execution_complete：工具執行完成，包含執行結果。若結果為 JSON，程式會嘗試以美化（pretty-print）方式顯示。
  範例輸出：{"toolName":"run_tests","results":{"passed":42,"failed":0}}

- session.idle：表示 session 目前空閒，系統會在此時自動檢查並執行等待佇列中的下一個提示（若有）。

### JSON 範例

tool.execution_complete 常見的 event.data 格式：

```json
{
  "toolName": "run_tests",
  "results": {
    "passed": 42,
    "failed": 0,
    "log": "All tests passed"
  }
}
```

### 疑難排解

- 如果看到「無法啟動 Copilot session」：請檢查 `TELEGRAM_BOT_TOKEN` 是否正確、Copilot CLI 是否安裝且可執行、以及 `DIRECTORY_PATTERNS` 或 `directories.json` 中的路徑是否存在且有存取權限。
- 如果工具結果為空或格式異常：查看伺服器日誌（console）以獲取 SDK 回報的錯誤，常見情況包括與 Copilot CLI 的連線中斷或解析 JSON 失敗。
- 使用 `/status` 可檢視目前 session 的狀態、工作目錄與模型，便於排查是否為模型或 session 問題。

### 常用指令範例

- 切換模型：`/model 2`（列出模型後以編號選擇）
- 列出目錄：`/dirs`
- 檢查狀態：`/status` (顯示 session ID、忙碌狀態與等待佇列長度)

## 原理說明

### Copilot SDK

GitHub 提供了適用於 Node.js/TypeScript 的 Copilot SDK，可透過 JSON‑RPC 與 Copilot CLI 溝通。安裝方式如上所示，快速開始範例如下：

```typescript
import { CopilotClient } from "@github/copilot-sdk";

// 建立並啟動客戶端
const client = new CopilotClient();
await client.start();

// 建立一個 session
const session = await client.createSession({ model: "gpt-5" });

// 監聽 session 事件並等待完成
const done = new Promise<void>((resolve) => {
    session.on((event) => {
        if (event.type === "assistant.message") {
            console.log(event.data.content);
        } else if (event.type === "session.idle") {
            resolve();
        }
    });
});

// 發送提示並等待
await session.send({ prompt: "What is 2+2?" });
await done;

// 清理
await session.destroy();
await client.stop();
```

SDK 會發出多種事件，例如 `assistant.message`（助理回覆）、`assistant.message_delta`（串流回覆片段）、`tool.execution_start` 和 `tool.execution_end` 等。本專案透過監聽這些事件並將其轉發到 Telegram，讓使用者可以完整掌握 Copilot 的進度。

### Telegram Bot API

專案使用 `node-telegram-bot-api` 封裝與 Telegram Bot API 的互動。根據官方範例，建立 bot 並啟動輪詢模式僅需幾行程式碼。發送文字訊息時需提供 `chat_id`（目標聊天的唯一識別碼或使用者名稱）與 `text`（訊息內容）等參數；`text` 長度上限為 1-4096 字元。

在本程式中，每個 Telegram 聊天室會維護一個專屬的 Copilot session，包括目前的工作目錄、等待佇列與運行狀態。當有新的訊息到達時，若 session 正忙碌則將訊息加入佇列；當收到 `session.idle` 事件時，程式會自動取出佇列中的下一個提示繼續處理。如此即可實現隨時插入提示詞並排隊執行的功能。

## 專案結構

```txt
telegram-copilot-bot/
├── src/                   # TypeScript 原始碼
│   ├── index.ts           # 機器人主程式入口
│   └── utils.ts           # 共用工具函式
├── tests/                 # Jest 單元測試
├── dist/                  # 編譯後的 JavaScript（npm run build 產生）
├── directories.json       # 預設目錄模式設定
├── package.json           # npm 專案設定與依賴
├── tsconfig.json          # TypeScript 編譯設定
├── jest.config.js         # Jest 測試設定
├── .env                   # 環境變數（不應提交至版本控制）
└── README.md              # 本文件
```

## 開發指令

| 指令                    | 說明                              |
| ----------------------- | --------------------------------- |
| `npm install`           | 安裝依賴套件                      |
| `npm run build`         | 編譯 TypeScript 至 `dist/`        |
| `npm run dev`           | 使用 ts-node 直接執行（開發模式） |
| `npm start`             | 先編譯再執行 `dist/index.js`      |
| `npm test`              | 執行 Jest 測試                    |
| `npm run test:coverage` | 執行測試並產生覆蓋率報告          |

## 自訂與延伸

- **修改目錄列表**：編輯 `directories.json` 或設定 `DIRECTORY_PATTERNS` 環境變數即可變更可選擇的目錄。支援萬用字元 (`*` 和 `**`)，例如 `/home/user/projects/*` 代表第一層子目錄，`/home/user/projects/**` 代表遞回搜尋所有子目錄。
- **調整預設模型**：透過環境變數 `COPILOT_MODEL` 指定 Copilot 模型名稱，例如 `gpt-5`、`claude-sonnet-4.5` 等。
- **Azure OpenAI 整合**：支援使用 Azure OpenAI (BYOK)。
- **處理多聊天室**：目前程式假定同一時間只有一個工作目錄需要與 Copilot CLI 溝通,因此以 `process.chdir` 切換工作目錄。若要同時支援多個聊天室，可考慮在不同的子進程中啟動 Copilot CLI 或於 `cliArgs` 參數中指定自訂執行檔與工作目錄。
