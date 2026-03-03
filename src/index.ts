import TelegramBot from 'node-telegram-bot-api';
import { CopilotClient, CopilotSession, SessionEvent } from '@github/copilot-sdk';
import type { GetStatusResponse, GetAuthStatusResponse, ModelInfo } from '@github/copilot-sdk';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { buildGdriveTools } from './tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env if present
dotenv.config();

if (!process.env.GOOGLE_REFRESH_TOKEN) {
  console.log('⚠️  GOOGLE_REFRESH_TOKEN not set — Google Drive tools are disabled.');
  console.log('   Run: npm run google-auth to enable Google Drive access.');
}

/**
 * Verify that COPILOT_GITHUB_TOKEN is valid by creating a real session
 * and sending a minimal prompt. Exits the process if authentication fails.
 */
async function verifyCopilotToken(): Promise<void> {
  const token = process.env.COPILOT_GITHUB_TOKEN;
  if (!token) {
    console.error('❌ COPILOT_GITHUB_TOKEN 未設定。請執行 gh auth token 取得 token 並寫入 .env。');
    process.exit(1);
  }
  if (token.startsWith('github_pat_')) {
    console.error('❌ COPILOT_GITHUB_TOKEN 使用了 fine-grained PAT（github_pat_），此類 token 不支援 Copilot API。');
    console.error('   請改用 gh auth token 取得 gho_ 開頭的 OAuth token。');
    process.exit(1);
  }

  console.log('⏳ 驗證 Copilot Token...');
  const client = new CopilotClient();
  try {
    await client.start();
    const session = await client.createSession({ model: 'gpt-5-mini' });

    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timeout = setTimeout(() => resolve({ ok: false, error: '驗證逾時（15 秒）' }), 15000);
      session.on((event: SessionEvent) => {
        if (event.type === 'session.error') {
          clearTimeout(timeout);
          const data = (event as any).data;
          resolve({ ok: false, error: data?.message ?? 'Unknown error' });
        }
        if (event.type === 'session.idle') {
          clearTimeout(timeout);
          resolve({ ok: true });
        }
      });
      session.send({ prompt: 'hi' }).catch((err: Error) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });
    });

    if (!result.ok) {
      console.error(`❌ Copilot Token 驗證失敗：${result.error}`);
      console.error('   請執行以下指令更新 token：');
      console.error('   gh auth login --scopes copilot');
      console.error('   gh auth token  # 將輸出的 gho_... 貼到 .env 的 COPILOT_GITHUB_TOKEN');
      process.exit(1);
    }

    console.log('✅ Copilot Token 驗證成功');
  } catch (err) {
    console.error(`❌ Copilot Token 驗證失敗：${(err as Error).message}`);
    process.exit(1);
  } finally {
    try { await client.stop(); } catch (_) { /* ignore */ }
  }
}

// Helper to detect the disposed connection error thrown by vscode-jsonrpc
function isDisposedConnectionError(err: any): boolean {
  if (!err) return false;
  const code = typeof err.code === 'number' ? err.code : undefined;
  const message = String(err.message || err);
  return code === -32097 || /pending response rejected since connection got disposed/i.test(message) || /connection got disposed/i.test(message);
}

/**
 * Expand an array of glob patterns into a unique list of absolute directory paths.
 * Patterns may include wildcards. For example:
 *   - "/home/user/projects/*" will match each immediate subdirectory of
 *     /home/user/projects.
 *   - "/home/user/projects/**" will match all subdirectories recursively.
 *   - "/home/user/projects/myapp" will match the specific directory.
 *
 * Non‑existent or non‑directory matches are ignored.
 *
 * @param patterns array of glob patterns
 * @returns list of unique absolute directory paths
 */
function expandPatterns(patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    // glob.sync always returns strings. Mark ensures that directories are
    // terminated with a slash so we can detect them easily.
    const matches = glob.sync(pattern, { mark: true, dot: false, nocase: false });
    for (const match of matches) {
      // remove trailing slash if present
      const dirPath = match.endsWith('/') ? match.slice(0, -1) : match;
      try {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory()) {
          dirs.add(path.resolve(dirPath));
        }
      } catch (_err) {
        // ignore files that no longer exist
      }
    }
  }
  return Array.from(dirs);
}

/**
 * Read directory patterns from environment or fallback to directories.json.
 */
function loadDirectoryPatterns(): string[] {
  const envValue = process.env.DIRECTORY_PATTERNS;
  if (envValue && envValue.trim().length > 0) {
    return envValue.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  }
  // Try reading directories.json from project root
  const jsonPath = path.join(__dirname, '..', 'directories.json');
  try {
    const content = fs.readFileSync(jsonPath, 'utf8');
    const patterns = JSON.parse(content);
    if (Array.isArray(patterns)) {
      return patterns.map((p) => String(p));
    }
  } catch (_err) {
    // ignore if file doesn't exist
  }
  return [];
}

function getAvailableDirectories(): string[] {
  const patterns = loadDirectoryPatterns();
  const dirs = expandPatterns(patterns);
  // Sort for stable numbering
  return dirs.sort();
}

// Telegram bot token must be provided via environment variable
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (!telegramToken) {
  console.error('TELEGRAM_BOT_TOKEN environment variable is not set.');
  process.exit(1);
}

// Optional: Owner chat ID for auto-greeting on startup
const ownerChatId = process.env.OWNER_CHAT_ID ? parseInt(process.env.OWNER_CHAT_ID, 10) : undefined;

// Available Copilot models
const availableModels = [
  'claude-sonnet-4.6',
  'claude-opus-4.6',
  'claude-haiku-4.5',
  'gpt-5.3-codex',
  'gpt-5-mini',
  'gemini-3-pro-preview',
];

// Default model for Copilot sessions. Override with COPILOT_MODEL environment
// variable. See the Copilot SDK README for supported model names.
const defaultModel = process.env.COPILOT_MODEL || 'gpt-5-mini';

// Pool of emojis to assign to sessions. Kept small and distinctive so each
// session can have a recognizable marker in messages.
const sessionEmojis = ['🔵','🟢','🔴','🟣','🟡','🟠','✨','🔥','🌟','🚀','🧠','🔔','🎯','✅','🔚','⚡️','🌈','🍀'];

/**
 * Per‑chat conversation state. Each chat can have its own Copilot session and
 * directory selection. Messages are queued while a prompt is being processed.
 */
interface ChatState {
  client: CopilotClient | null;
  session: CopilotSession | null;
  dir?: string;
  model: string;
  busy: boolean;
  queue: string[];
  resetting: boolean;
  // Attached image URLs stored per-chat to be appended to prompts as reference context.
  images?: string[];
  // Unique emoji assigned to this chat's Copilot session for clearer UX
  emoji?: string;
  // Current prompt being processed
  currentPrompt?: string;
  // Track tool execution start messages by toolCallId for adding reactions on completion
  toolStartMessages?: Map<string, ToolStartMessage>;
  // Track whether the final assistant message is still pending
  awaitingFinal?: boolean;
  // Delay completion notice until after the final assistant message arrives
  pendingCompletion?: boolean;
  // Event queue and processing flag to ensure events are handled sequentially
  eventQueue?: SessionEvent[];
  processingEvents?: boolean;
  // Track the original user message ID for reply_to_message_id
  originalMessageId?: number;
  // Count of turns (prompts sent) in this session
  turnCount?: number;
  // Recent models used (most recent first, no duplicates, max 2)
  recentModels?: string[];
  // Latest directory list shown to the user (used for inline selection)
  availableDirs?: string[];
}

interface ToolStartMessage {
  messageId: number;
  toolCallId: string;
  toolName: string;
  eventId: string;
  resultKey?: string; // Key for storing/retrieving tool results
  paramsText?: string; // Tool parameters text for "顯示參數" button
}

const chatStates = new Map<number, ChatState>();

/**
 * Check if a chat ID is the authorized owner.
 * If OWNER_CHAT_ID is not set, allow all users.
 */
function isOwner(chatId: number): boolean {
  return !ownerChatId || chatId === ownerChatId;
}

/**
 * Send a polite rejection message to non-owner users.
 */
async function sendNotOwnerMessage(chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    '🙇 非常抱歉，此機器人目前僅供主人使用。\n如有需要，請聯繫機器人的管理員。感謝您的理解！'
  );
}

// Storage for full tool results that can be revealed via inline keyboard button
// Key format: `${chatId}:${uniqueId}` where uniqueId is timestamp-based
const fullToolResults = new Map<string, { toolName: string; fullText: string; startMsgId?: number }>();

// Storage for tool parameters that can be revealed via inline keyboard button
const toolParamsStorage = new Map<string, { toolName: string; paramsText: string; startMsgId: number }>();

// Generate a unique key for storing full tool results
function generateToolResultKey(chatId: number): string {
  return `${chatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function pickSessionEmoji(): string {
  const used = new Set<string>();
  for (const s of chatStates.values()) {
    if (s.emoji) used.add(s.emoji);
  }
  for (const e of sessionEmojis) {
    if (!used.has(e)) return e;
  }
  // Fallback to a random emoji if all are used
  return sessionEmojis[Math.floor(Math.random() * sessionEmojis.length)];
}

/**
 * Add a model to the recent models list, keeping only unique entries (max 2).
 * The most recently used model is at index 0. Does not include the current model.
 */
function addToRecentModels(state: ChatState, newModel: string): void {
  const recent = state.recentModels || [];
  // Remove the model if it already exists
  const filtered = recent.filter((m) => m !== newModel);
  // Add to the front
  filtered.unshift(newModel);
  // Keep only the first 2
  state.recentModels = filtered.slice(0, 2);
}

/**
 * Build an inline keyboard row with "切換模型" button followed by recent model quick-switch buttons.
 * @param chatId - The chat ID to get recent models from
 * @param currentModel - The current model (won't show in recent buttons)
 * @returns Array of inline keyboard buttons
 */
function buildModelSwitchRow(chatId: number, currentModel: string | undefined): { text: string; callback_data: string }[] {
  const row: { text: string; callback_data: string }[] = [
    { text: '🧠 切換模型', callback_data: 'cmd_model' },
  ];

  const state = chatStates.get(chatId);
  const recentModels = state?.recentModels || [];

  // Add up to 2 recent models that are not the current model
  const modelsToShow = recentModels.filter((m) => m !== currentModel).slice(0, 2);
  for (const model of modelsToShow) {
    const modelIndex = availableModels.indexOf(model);
    if (modelIndex !== -1) {
      // Use abbreviated model name for button text
      const shortName = model.replace('claude-', '').replace('.', '');
      row.push({ text: `⚡${shortName}`, callback_data: `set_model:${modelIndex}` });
    }
  }

  return row;
}

// All available slash commands for help and logging
const commandDescriptions = [
  '/dirs - 列出可用的工作目錄',
  '/model [編號] - 查看或選擇 AI 模型',
  '/status 或 /st - 查看目前 session 狀態',
  '/reset - 重新啟動目前的 Copilot session',
  '/shutdown - 關閉 Copilot Bot',
  '/help - 顯示歡迎訊息與使用說明',
];

/**
 * Send welcome message with Reply Keyboard to a chat
 * @param includeRestartInfo - If true, includes bot restart time information
 */
async function sendWelcomeMessage(bot: TelegramBot, chatId: number, includeRestartInfo = false) {
  let instructions = '';

  if (includeRestartInfo) {
    const restartTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    // instructions += '🔄 機器人已重新啟動\n';
    instructions += `⏰ 啟動時間：${restartTime}\n\n`;
  }

  instructions += '歡迎使用 Copilot Telegram Bot！\n\n';
  instructions += '📋 可用命令：\n';
  instructions += commandDescriptions.join('\n');
  instructions += '\n\n在選擇工作目錄後，直接輸入提示詞，Copilot 將開始處理並回應。\n';
  instructions += '若目前有任務在進行中，新的提示詞將排入隊列。';

  const state = chatStates.get(chatId);
  const currentModel = state?.model;

  // Send with Inline Keyboard (two buttons per row)
  await bot.sendMessage(chatId, instructions, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, currentModel)],
      ],
    },
  });
}

/**
 * Convert standard Markdown to Telegram MarkdownV2 format.
 * Telegram MarkdownV2 doesn't support headers (###), so we convert them to bold text.
 * Also properly escapes special characters while preserving formatting.
 */
function convertToMarkdownV2(text: string): string {
  // Split by code blocks to preserve them
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);

  return parts.map((part) => {
    // Preserve code blocks
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf('\n');
      if (newlineIdx > -1) {
        const lang = inner.slice(0, newlineIdx);
        const code = inner.slice(newlineIdx + 1);
        // Escape backslashes and backticks inside code blocks for MarkdownV2
        const escapedCode = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
        return '```' + lang + '\n' + escapedCode + '```';
      }
      // Escape backslashes and backticks inside code blocks for MarkdownV2
      const escapedInner = inner.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      return '```' + escapedInner + '```';
    }

    // Preserve inline code - escape backticks inside
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1);
      const escapedInner = inner.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      return '`' + escapedInner + '`';
    }

    // Process normal text
    let result = part;

    // Convert headers to bold (### Header -> **Header**)
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Escape special characters that are NOT part of formatting
    // First, temporarily replace formatting markers
    const boldPattern = /\*\*(.+?)\*\*/g;
    const italicPattern = /__(.+?)__/g;
    const strikePattern = /~~(.+?)~~/g;

    // Store formatting and replace with placeholders
    const formatters: { placeholder: string; replacement: string }[] = [];
    let counter = 0;

    // Handle **bold**
    result = result.replace(boldPattern, (_match, content) => {
      const placeholder = `\x00BOLD${counter++}\x00`;
      formatters.push({ placeholder, replacement: `*${escapeMarkdownV2Inner(content)}*` });
      return placeholder;
    });

    // Handle __italic__ (use _ for italic in MarkdownV2)
    result = result.replace(italicPattern, (_match, content) => {
      const placeholder = `\x00ITALIC${counter++}\x00`;
      formatters.push({ placeholder, replacement: `_${escapeMarkdownV2Inner(content)}_` });
      return placeholder;
    });

    // Handle ~~strikethrough~~
    result = result.replace(strikePattern, (_match, content) => {
      const placeholder = `\x00STRIKE${counter++}\x00`;
      formatters.push({ placeholder, replacement: `~${escapeMarkdownV2Inner(content)}~` });
      return placeholder;
    });

    // Handle *bold* (single asterisk style from Copilot)
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match, content) => {
      const placeholder = `\x00SBOLD${counter++}\x00`;
      formatters.push({ placeholder, replacement: `*${escapeMarkdownV2Inner(content)}*` });
      return placeholder;
    });

    // Handle _italic_ (single underscore)
    result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_match, content) => {
      const placeholder = `\x00SITALIC${counter++}\x00`;
      formatters.push({ placeholder, replacement: `_${escapeMarkdownV2Inner(content)}_` });
      return placeholder;
    });

    // Now escape remaining special characters
    result = escapeMarkdownV2Inner(result);

    // Restore formatters
    for (const { placeholder, replacement } of formatters) {
      result = result.replace(placeholder, replacement);
    }

    return result;
  }).join('');
}

/**
 * Escape special characters for Telegram MarkdownV2 format.
 * Characters that need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function escapeMarkdownV2Inner(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Legacy escape function for backward compatibility
 */
function escapeMarkdownV2(text: string): string {
  return escapeMarkdownV2Inner(text);
}

/**
 * Send a potentially long message by splitting it into chunks acceptable by
 * Telegram. Telegram limits message text to 4096 characters. This helper
 * automatically splits long messages into multiple parts while preserving
 * newline boundaries.
 *
 * @param bot the Telegram bot instance
 * @param chatId target chat id
 * @param text the text to send
 * @param replyToMessageId optional message ID to reply to
 */
async function sendLongMessage(bot: TelegramBot, chatId: number, text: string, replyToMessageId?: number) {
  // Prepend a concise header (emoji + Copilot label) so the sendMessage wrapper
  // recognizes already-formatted messages and avoids double-prefixing when
  // splitting long messages into multiple Telegram chunks.
  const state = chatStates.get(chatId);
  const emoji = state?.emoji ? `${state.emoji} ` : '🤖 ';
  const dirName = state?.dir ? path.basename(state.dir) : '';
  const header = dirName ? `${emoji}Copilot ∙ ${dirName}\n\n` : `${emoji}Copilot\n\n`;
  text = header + text;

  const maxLen = 4096;
  let remaining = text;
  let isFirst = true;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLen);
    // Try to split on newline to avoid breaking words arbitrarily
    if (remaining.length > maxLen) {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.8) {
        chunk = remaining.slice(0, lastNewline + 1);
      }
    }
    // Only reply to the original message on the first chunk
    const options = isFirst && replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined;
    await bot.sendMessage(chatId, chunk, options);
    remaining = remaining.slice(chunk.length);
    isFirst = false;
  }
}

/**
 * Drain and confirm any pending updates before polling starts.
 * This intentionally discards messages sent while the bot was offline.
 *
 * @param bot the Telegram bot instance
 * @returns number of updates dropped
 */
async function clearPendingUpdates(bot: TelegramBot): Promise<number> {
  let lastUpdateId: number | undefined;
  let dropped = 0;

  while (true) {
    const options: TelegramBot.GetUpdatesOptions = { timeout: 0, limit: 100 };
    if (lastUpdateId !== undefined) {
      options.offset = lastUpdateId + 1;
    }
    const updates = await bot.getUpdates(options);
    if (updates.length === 0) {
      break;
    }
    dropped += updates.length;
    lastUpdateId = updates[updates.length - 1].update_id;
  }

  return dropped;
}

// Append stored image URLs to the prompt text to provide image context.
// Images are kept as URLs pointing to Telegram's file endpoint.
function appendImagesToPrompt(prompt: string, images?: string[]): string {
  if (!images || images.length === 0) return prompt;
  const list = images.map((u, i) => `${i + 1}. ${u}`).join('\n');
  return `${prompt}\n\n參考圖片：\n${list}`;
}

// Note: Event ID, Parent ID, Tool Call ID are internal debugging identifiers
// and not meaningful to end users, so we no longer display them in messages.

function findToolStartMessage(state: ChatState, toolCallId?: string, parentId?: string | null): ToolStartMessage | undefined {
  if (!state.toolStartMessages) return undefined;
  if (toolCallId && state.toolStartMessages.has(toolCallId)) {
    return state.toolStartMessages.get(toolCallId);
  }
  if (parentId) {
    for (const entry of state.toolStartMessages.values()) {
      if (entry.eventId === parentId) return entry;
    }
  }
  return undefined;
}

/**
 * Send a status message to the specified chat. This is a reusable helper
 * to display session status after /model, or /status commands.
 */
async function sendStatusMessage(bot: TelegramBot, chatId: number, user?: TelegramBot.User, options?: { replyToMessageId?: number; showCompletion?: boolean }) {
  const state = chatStates.get(chatId);
  if (!state) {
    const sendOptions: TelegramBot.SendMessageOptions = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, defaultModel)],
        ],
      },
    };
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }
    await bot.sendMessage(chatId, `目前沒有任何 chat state，請使用 /dirs 查看並選擇目錄以啟動 session。`, sendOptions);
    return;
  }
  const hasSession = !!state.session;
  const dir = state.dir || '未設定';
  const model = state.model || defaultModel;
  const busy = state.busy ? '是' : '否';
  const queueLen = state.queue ? state.queue.length : 0;

  // Determine the conversation partner (current user's name and chatId)
  let chatTarget = '未知';
  try {
    if (user) {
      const name = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim();
      const displayName = name || (user.username ? `@${user.username}` : '未知');
      chatTarget = `${displayName} (${chatId})`;
    } else {
      chatTarget = `chatId: ${chatId}`;
    }
  } catch (e) {
    chatTarget = '未知';
  }

  // Compose session status message
  const activity = hasSession ? '正在運行' : '未啟動';
  const sessionIdDisplay = state.session ? ((state.session as any).id ?? '未知') : '未啟動';
  const queueMsg = queueLen > 0 ? `等待佇列：${queueLen} 個任務` : '等待佇列：沒有任務';
  const resetMsg = state.resetting ? '是（將在完成後重新啟動 🔄）' : '否';

  // Current task info
  let currentTaskMsg = '';
  if (state.busy && state.currentPrompt) {
    const truncatedPrompt = state.currentPrompt.length > 100
      ? state.currentPrompt.substring(0, 100) + '...'
      : state.currentPrompt;
    currentTaskMsg = `\n\n📝 正在執行的任務：\n${truncatedPrompt}`;
  }

  // Queued tasks preview
  let queuePreview = '';
  if (queueLen > 0) {
    const previewItems = state.queue.slice(0, 3).map((q, i) => {
      const truncated = q.length > 50 ? q.substring(0, 50) + '...' : q;
      return `  ${i + 1}. ${truncated}`;
    });
    queuePreview = `\n\n📋 等待中的任務：\n${previewItems.join('\n')}`;
    if (queueLen > 3) {
      queuePreview += `\n  ...還有 ${queueLen - 3} 個任務`;
    }
  }

  // Completion notice (shown when task just completed)
  const completionNotice = options?.showCompletion ? '🟢 本次回應已完成\n\n' : '';

  const note = state.busy ? '系統目前忙碌，請稍候。' : '系統閒置，歡迎送出新指令！';
  const turnCount = state.turnCount ?? 0;
  const msgText = `${completionNotice}🤖 Copilot Session 狀態報告

我的主人：${chatTarget}
程序狀態：${activity}
工作階段：${sessionIdDisplay}
選用模型：${model}
工作目錄：${dir}
已執行輪次：${turnCount}
工作狀態：${busy}
${queueMsg}
正在重啟：${resetMsg}${currentTaskMsg}${queuePreview}

小提醒：${note}`;

  const inlineRow = state.dir
    ? [...buildModelSwitchRow(chatId, state.model), { text: '🔄 重新開始', callback_data: 'cmd_reset' }]
    : [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, state.model)];
  const sendOptions: TelegramBot.SendMessageOptions = {
    reply_markup: {
      inline_keyboard: [inlineRow],
    },
  };
  if (options?.replyToMessageId) {
    sendOptions.reply_to_message_id = options.replyToMessageId;
  }
  await bot.sendMessage(chatId, msgText, sendOptions);
}

/**
 * Start a new Copilot session for the given chat in the specified directory.
 * Any existing session will be shut down before starting a new one. Changing
 * directories by calling process.chdir affects the working directory for the
 * Copilot CLI. If the session fails to start, the error is sent to the user.
 *
 * @param chatId Telegram chat identifier
 * @param directory absolute path to use as workspace
 * @param model optional model name to use (defaults to state's current model or defaultModel)
 */
async function startSession(chatId: number, directory: string, model?: string) {
  console.log(`[DEBUG] startSession called - chatId: ${chatId}, directory: ${directory}, model: ${model || 'default'}`);

  let state = chatStates.get(chatId);
  if (!state) {
    console.log(`[DEBUG] Creating new chat state for chatId: ${chatId}`);
    state = {
      client: null,
      session: null,
      dir: undefined,
      model: model || defaultModel,
      busy: false,
      queue: [],
      resetting: false,
      images: [],
      emoji: pickSessionEmoji(),
      awaitingFinal: false,
      pendingCompletion: false,
    };
    chatStates.set(chatId, state);
  } else {
    console.log(`[DEBUG] Chat state exists - current model: ${state.model}`);
    if (model) {
      state.model = model;
      console.log(`[DEBUG] Updated model to: ${model}`);
    }
  }

  const modelToUse = state.model;
  console.log(`[DEBUG] Using model: ${modelToUse}`);

  // If a session exists, destroy it first
  if (state.session) {
    console.log(`[DEBUG] Destroying existing session`);
    try {
      await state.session.destroy();
      console.log(`[DEBUG] Session destroyed successfully`);
    } catch (err) {
      if (isDisposedConnectionError(err)) {
        console.log(`[DEBUG] Ignored disposed connection error while destroying session: ${(err as any)?.message || err}`);
      } else {
        console.error(`[DEBUG] Error destroying session:`, err);
      }
    }
    state.session = null;
  }
  if (state.client) {
    console.log(`[DEBUG] Stopping existing client`);
    try {
      await state.client.stop();
      console.log(`[DEBUG] Client stopped successfully`);
    } catch (err) {
      if (isDisposedConnectionError(err)) {
        console.log(`[DEBUG] Ignored disposed connection error while stopping client: ${(err as any)?.message || err}`);
      } else {
        // Ignore other client stop errors during normal operations but log them
        console.error(`[DEBUG] Error stopping client (ignored):`, err);
      }
    }
    state.client = null;
  }
  // Change working directory for the Copilot CLI. This assumes only one session
  // is running at a time across all chats. If multiple users are expected to
  // interact concurrently, spawning separate processes would be required.
  try {
    console.log(`[DEBUG] Changing directory to: ${directory}`);
    process.chdir(directory);
    console.log(`[DEBUG] Directory changed successfully. Current dir: ${process.cwd()}`);
  } catch (err) {
    console.error(`[DEBUG] Failed to change directory:`, err);
    throw new Error(`無法切換到工作目錄 ${directory}: ${(err as Error).message}`);
  }
  // Create a new client and session
  console.log(`[DEBUG] Creating new CopilotClient`);
  const client = new CopilotClient();
  try {
    console.log(`[DEBUG] Starting client...`);
    await client.start();
    console.log(`[DEBUG] Client started successfully`);

    console.log(`[DEBUG] Creating session with model: ${modelToUse}`);
    const session = await client.createSession({ model: modelToUse, tools: buildGdriveTools() });
    console.log(`[DEBUG] Session created successfully`);

    // Register event handler with queue-based sequential processing
    session.on((event: SessionEvent) => enqueueSessionEvent(bot, chatId, event));
    console.log(`[DEBUG] Event handler registered`);

    // Store state
    state.client = client;
    state.session = session;
    state.dir = directory;
    state.busy = false;
    state.queue = [];
    state.resetting = false;
    state.awaitingFinal = false;
    state.pendingCompletion = false;
    state.eventQueue = [];
    state.processingEvents = false;
    // Assign (or refresh) the emoji for this session so the session has a
    // distinct marker when reporting completion.
    state.emoji = pickSessionEmoji();
    console.log(`[DEBUG] State updated successfully`);
  } catch (err) {
    console.error(`[DEBUG] Error during session creation:`, err);
    try {
      await client.stop();
    } catch (stopErr) {
      if (isDisposedConnectionError(stopErr)) {
        console.log(`[DEBUG] Ignored disposed connection error while stopping client after failed session creation: ${(stopErr as any)?.message || stopErr}`);
      } else {
        console.error(`[DEBUG] Error stopping client after failed session creation (ignored):`, stopErr);
      }
    }
    throw err;
  }
}

/**
 * Enqueue a session event and process the queue sequentially.
 * This ensures events are handled in order and each handler completes
 * before the next one starts, preventing race conditions where
 * session.idle fires before tool results are sent.
 */
function enqueueSessionEvent(bot: TelegramBot, chatId: number, event: SessionEvent) {
  const state = chatStates.get(chatId);
  if (!state) {
    console.log(`[DEBUG] enqueueSessionEvent - No state found for chatId: ${chatId}`);
    return;
  }

  // Initialize queue if needed
  if (!state.eventQueue) {
    state.eventQueue = [];
  }

  // Add event to queue
  state.eventQueue.push(event);
  console.log(`[DEBUG] Event enqueued: ${event.type}, queue length: ${state.eventQueue.length}`);

  // Process queue if not already processing
  processEventQueue(bot, chatId);
}

/**
 * Process events from the queue sequentially.
 */
async function processEventQueue(bot: TelegramBot, chatId: number) {
  const state = chatStates.get(chatId);
  if (!state || !state.eventQueue || state.processingEvents) {
    return;
  }

  state.processingEvents = true;

  while (state.eventQueue.length > 0) {
    const event = state.eventQueue.shift()!;
    try {
      await handleSessionEvent(bot, chatId, event);
    } catch (err) {
      console.error(`[DEBUG] Error processing event ${event.type}:`, err);
    }
  }

  state.processingEvents = false;
}

/**
 * Handle events emitted from the Copilot session. Events include assistant
 * messages, tool execution notifications and the idle event. Events are
 * forwarded to the user through Telegram.
 *
 * @param bot Telegram bot instance
 * @param chatId Telegram chat identifier
 * @param event event from the Copilot session
 */
async function handleSessionEvent(bot: TelegramBot, chatId: number, event: SessionEvent) {
  console.log(`[DEBUG] handleSessionEvent - chatId: ${chatId}, eventType: ${event.type}`);

  const state = chatStates.get(chatId);
  if (!state) {
    console.log(`[DEBUG] No state found for chatId: ${chatId}`);
    return;
  }

  switch (event.type) {
    case 'assistant.message':
      // Final assistant response
      console.log(`[DEBUG] Assistant message received, length: ${typeof event.data?.content === 'string' ? event.data.content.length : 0}`);
      if (event.data && typeof event.data.content === 'string' && event.data.content.trim().length > 0) {
        await sendLongMessage(bot, chatId, event.data.content);
      }
      state.awaitingFinal = false;
      if (state.pendingCompletion && state.queue.length === 0) {
        state.pendingCompletion = false;
        // Show status with completion notice, reply to the original user message
        await sendStatusMessage(bot, chatId, undefined, {
          replyToMessageId: state.originalMessageId,
          showCompletion: true,
        });
      }
      break;
    case 'assistant.message_delta':
      // Partial streaming; send incremental text as it arrives
      console.log(`[DEBUG] Assistant message delta received`);
      if (event.data && typeof (event.data as any).deltaContent === 'string') {
        const deltaContent = (event.data as any).deltaContent;
        // Skip empty or whitespace-only delta messages
        if (deltaContent.trim().length > 0) {
          await bot.sendMessage(chatId, deltaContent);
        }
      }
      break;
    case 'tool.execution_start':
      {
        const data = event.data as any;
        const toolName = data?.toolName ?? data?.name ?? 'unknown tool';
        const toolCallId = data?.toolCallId ?? undefined;
        // Try multiple possible property names for tool parameters
        const rawParams = data?.params ?? data?.arguments ?? data?.input ?? data?.parameters;
        console.log(`[DEBUG] Tool execution started: ${toolName}, raw event.data keys: ${data ? Object.keys(data).join(', ') : 'null'}`);
        console.log(`[DEBUG] Tool execution started: full data: ${JSON.stringify(data)?.slice(0, 500)}`);

        let paramsText: string | undefined;
        if (rawParams !== undefined && rawParams !== null) {
          if (typeof rawParams === 'string') {
            paramsText = rawParams;
          } else {
            paramsText = JSON.stringify(rawParams, null, 2);
          }
        }

        // Generate result key for this tool execution (will be used when complete)
        const resultKey = generateToolResultKey(chatId);
        
        // Build inline keyboard buttons
        const inlineButtons: { text: string; callback_data: string }[] = [];
        if (paramsText) {
          inlineButtons.push({ text: '📋 顯示參數', callback_data: `show_params:${resultKey}` });
        }
        inlineButtons.push({ text: '📄 顯示結果', callback_data: `show_result:${resultKey}` });

        const sentMsg = await bot.sendMessage(chatId, `🛠️ 工具開始執行：${toolName}`, {
          reply_markup: {
            inline_keyboard: [inlineButtons],
          },
        });

        // Store params for "顯示參數" button
        if (paramsText) {
          toolParamsStorage.set(resultKey, {
            toolName,
            paramsText,
            startMsgId: sentMsg.message_id,
          });
        }

        // Store message ID for adding reaction on completion
        if (!state.toolStartMessages) {
          state.toolStartMessages = new Map();
        }
        const toolKey = toolCallId || event.id;
        state.toolStartMessages.set(toolKey, {
          messageId: sentMsg.message_id,
          toolCallId: toolCallId || toolKey,
          toolName,
          eventId: event.id,
          resultKey, // Store result key for later use
          paramsText, // Store params for "顯示參數" button
        });
        console.log(`[DEBUG] Stored tool start message: tool=${toolName}, toolCallId=${toolCallId || 'missing'}, eventId=${event.id}, messageId=${sentMsg.message_id}, resultKey=${resultKey}`);
      }
      break;
    case 'tool.execution_complete':
      {
        // Store tool results for later retrieval via "顯示結果" button.
        // Only add emoji reaction to the start message, don't send result message.
        const data = event.data as any;
        const toolCallId = data?.toolCallId ?? undefined;
        const startEntry = findToolStartMessage(state, toolCallId, event.parentId);
        const toolName = startEntry?.toolName ?? data?.toolName ?? data?.name ?? 'tool';
        const rawResults = data?.result?.content ?? data?.results;
        const errorMessage = data?.error?.message;
        let resultsText: string | undefined;
        if (rawResults !== undefined && rawResults !== null) {
          if (typeof rawResults === 'string') {
            try {
              const parsed = JSON.parse(rawResults);
              resultsText = JSON.stringify(parsed, null, 2);
            } catch (_e) {
              // Not JSON — return the raw string as-is so the user sees full output
              resultsText = rawResults;
            }
          } else {
            // Non-string (object/array) — pretty print
            try {
              resultsText = JSON.stringify(rawResults, null, 2);
            } catch (_e) {
              // Fallback to toString()
              resultsText = String(rawResults);
            }
          }
        }

        console.log(`[DEBUG] Tool execution completed: ${toolName}, toolCallId=${toolCallId || 'missing'}, eventId=${event.id}, parentId=${event.parentId || 'none'}, results: ${resultsText ? resultsText.slice(0,200) : 'none'}`);

        // Add reaction to the original tool start message: 👍 for success, 👎 for failure
        const startMsgId = startEntry?.messageId;
        const isError = !!errorMessage;
        const reactionEmoji = isError ? '👎' : '👍';
        console.log(`[DEBUG] Looking for startMsgId for tool: ${toolName}, found: ${startMsgId}, toolCallId: ${toolCallId || 'missing'}, isError: ${isError}`);
        
        // Store results for later retrieval via button click
        if (startEntry?.resultKey) {
          if (errorMessage) {
            fullToolResults.set(startEntry.resultKey, { 
              toolName, 
              fullText: `❗ 執行失敗：\n${errorMessage}`,
              startMsgId,
            });
          } else if (resultsText && resultsText.trim().length > 0) {
            fullToolResults.set(startEntry.resultKey, { 
              toolName, 
              fullText: resultsText,
              startMsgId,
            });
          } else {
            // No results - store empty indicator
            fullToolResults.set(startEntry.resultKey, { 
              toolName, 
              fullText: '（無輸出結果）',
              startMsgId,
            });
          }
          console.log(`[DEBUG] Stored tool result for key: ${startEntry.resultKey}`);
        }

        if (startMsgId) {
          try {
            console.log(`[DEBUG] Attempting to set reaction ${reactionEmoji} on message ${startMsgId} in chat ${chatId}`);
            await bot.setMessageReaction(chatId, startMsgId, { reaction: [{ type: 'emoji', emoji: reactionEmoji }] });
            console.log(`[DEBUG] setMessageReaction succeeded for message ${startMsgId}`);
          } catch (err) {
            console.error(`[DEBUG] Failed to set reaction on message ${startMsgId}:`, err);
          }
          // Don't delete from toolStartMessages yet - keep for result key reference
        } else {
          console.log(`[DEBUG] No startMsgId found for tool: ${toolName}`);
        }
        
        // Clean up toolStartMessages entry (but results are stored in fullToolResults)
        if (startEntry) {
          state.toolStartMessages?.delete(startEntry.toolCallId);
        }
      }
      break;
    case 'session.idle':
      // Session became idle: send next queued prompt if exists
      console.log(`[DEBUG] Session idle - queue length: ${state.queue.length}, resetting: ${state.resetting}`);
      state.busy = false;
      state.currentPrompt = undefined;

      // If no more tasks in queue, show completion message
      if (state.queue.length === 0) {
        console.log(`[DEBUG] Task completed, no queue remaining`);
        if (state.awaitingFinal) {
          state.pendingCompletion = true;
        } else {
          // Show status with completion notice, reply to the original user message
          await sendStatusMessage(bot, chatId, undefined, {
            replyToMessageId: state.originalMessageId,
            showCompletion: true,
          });
        }
      }

      if (state.queue.length > 0) {
        const nextPrompt = state.queue.shift();
        console.log(`[DEBUG] Processing next queued prompt, remaining queue: ${state.queue.length}`);
        if (nextPrompt && state.session) {
          state.busy = true;
          state.currentPrompt = nextPrompt;
          state.awaitingFinal = true;
          state.pendingCompletion = false;
          // Increment turn count for queued prompts
          state.turnCount = (state.turnCount ?? 0) + 1;
          try {
            const promptToSend = appendImagesToPrompt(nextPrompt, state.images);
            await state.session.send({ prompt: promptToSend });
            console.log(`[DEBUG] Prompt sent successfully`);
          } catch (err) {
            console.error(`[DEBUG] Error sending prompt:`, err);
            await bot.sendMessage(chatId, `❗ 執行提示時發生錯誤：${(err as Error).message}`);
            state.busy = false;
            state.currentPrompt = undefined;
            state.awaitingFinal = false;
          }
        }
      }
      break;
    case 'session.error':
      {
        const errData = event.data as any;
        const errMsg = errData?.message ?? errData?.error ?? JSON.stringify(errData) ?? '未知錯誤';
        console.error(`[DEBUG] Session error: ${errMsg}`);
        state.busy = false;
        state.awaitingFinal = false;
        state.pendingCompletion = false;
        state.currentPrompt = undefined;
        await bot.sendMessage(chatId, `❗ Copilot session 發生錯誤：${errMsg}`);
      }
      break;
    default:
      // Unhandled events can be logged for debugging
      console.log(`[DEBUG] Unhandled event type: ${event.type}`);
      break;
  }
}

// Instantiate the Telegram bot
const bot = new TelegramBot(telegramToken, { polling: { autoStart: false } });

// Record bot startup time to ignore old messages
const botStartTime = Math.floor(Date.now() / 1000);
console.log(`[DEBUG] Bot started at ${botStartTime}`);

// Wrap sendMessage to include a concise header showing who is speaking and the
// per-chat session emoji. Cast to any to avoid TypeScript overload conflicts.
// Also set parse_mode to MarkdownV2 for proper formatting.
const originalSendMessage = (bot as any).sendMessage.bind(bot);
(bot as any).sendMessage = async (chatId: number, text: any, options?: any) => {
  const state = chatStates.get(Number(chatId));
  const emoji = state?.emoji ? `${state.emoji} ` : '🤖 ';
  const dirName = state?.dir ? path.basename(state.dir) : '';
  // If the message already appears to be prefixed with the emoji, assume it
  // has been pre-formatted and avoid double-prefixing.
  let fullText: string;
  if (typeof text === 'string' && text.startsWith(emoji)) {
    fullText = text;
  } else {
    const header = dirName ? `${emoji}Copilot ∙ ${dirName}` : `${emoji}Copilot`;
    fullText = `${header}\n\n${text}`;
  }

  // Convert to MarkdownV2 format using the new conversion function
  const formattedText = convertToMarkdownV2(fullText);

  // Try with MarkdownV2 first
  const mergedOptions = { parse_mode: 'MarkdownV2' as const, ...options };
  try {
    return await originalSendMessage(chatId, formattedText, mergedOptions);
  } catch (err) {
    // Fallback without parse_mode if MarkdownV2 parsing fails
    // Strip Markdown formatting to show clean plain text instead of raw syntax
    console.error('[DEBUG] MarkdownV2 parsing failed, falling back to plain text:', (err as Error).message);
    console.error('[DEBUG] Failed text (first 500 chars):', formattedText.slice(0, 500));
    const { parse_mode, ...fallbackOptions } = mergedOptions;
    // Remove common Markdown syntax for clean plain text display
    const plainText = fullText
      .replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3).replace(/^\w+\n/, '')) // Remove code block markers
      .replace(/`([^`]+)`/g, '$1') // Remove inline code markers
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold markers
      .replace(/\*(.+?)\*/g, '$1') // Remove italic markers
      .replace(/__(.+?)__/g, '$1') // Remove underline markers
      .replace(/_(.+?)_/g, '$1') // Remove italic markers
      .replace(/~~(.+?)~~/g, '$1') // Remove strikethrough markers
      .replace(/^#{1,6}\s+/gm, ''); // Remove header markers
    return originalSendMessage(chatId, plainText, fallbackOptions);
  }
};

console.log(`🚀 Telegram Copilot Bot 已啟動`);
const startupDirectories = getAvailableDirectories();
console.log(`📁 載入了 ${startupDirectories.length} 個可用目錄`);
console.log(`🤖 使用預設模型: ${defaultModel}`);
if (startupDirectories.length > 0) {
  console.log(`可用目錄:`);
  startupDirectories.forEach((dir, idx) => {
    console.log(`  ${idx + 1}. ${dir}`);
  });
}
console.log(`📋 可用的斜線命令：`);
commandDescriptions.forEach((desc) => {
  console.log(`  ${desc}`);
});

// Command: /start or /help - show basic instructions
bot.onText(/^\/(start|help)/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`[DEBUG] /start or /help command received from chatId: ${chatId}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /start or /help from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  await sendWelcomeMessage(bot, chatId);
});

// Command: /dirs - list available directories with inline keyboard
bot.onText(/^\/dirs/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`[DEBUG] /dirs command received from chatId: ${chatId}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /dirs from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  const availableDirectories = getAvailableDirectories();
  if (availableDirectories.length === 0) {
    await bot.sendMessage(chatId, '目前沒有設定任何工作目錄。請設定環境變數 DIRECTORY_PATTERNS 或編輯 directories.json。');
    return;
  }

  let state = chatStates.get(chatId);
  if (!state) {
    state = {
      client: null,
      session: null,
      dir: undefined,
      model: defaultModel,
      busy: false,
      queue: [],
      resetting: false,
      images: [],
      awaitingFinal: false,
      pendingCompletion: false,
    };
    chatStates.set(chatId, state);
  }
  state.availableDirs = availableDirectories;

  // Build inline keyboard with directory options (two buttons per row)
  const inlineKeyboard: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < availableDirectories.length; i += 2) {
    const row = [];
    const dir1 = availableDirectories[i];
    row.push({ text: path.basename(dir1), callback_data: `set_dir:${i}` });

    if (i + 1 < availableDirectories.length) {
      const dir2 = availableDirectories[i + 1];
      row.push({ text: path.basename(dir2), callback_data: `set_dir:${i + 1}` });
    }

    inlineKeyboard.push(row);
  }

  await bot.sendMessage(chatId, '請選擇工作目錄：', {
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
});

// Command: /model - list and select AI model
bot.onText(/^\/model(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const indexStr = match?.[1];

  console.log(`[DEBUG] /model command received from chatId: ${chatId}, index: ${indexStr || 'none'}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /model from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  // If no number provided, show list
  if (!indexStr) {
    const state = chatStates.get(chatId);
    const currentModel = state?.model || defaultModel;
    console.log(`[DEBUG] Showing model list, current model: ${currentModel}`);

    const lines = availableModels.map((model, idx) => {
      const marker = model === currentModel ? '✓ ' : '  ';
      return `${marker}${idx + 1}. ${model}`;
    }).join('\n');

    // Build inline keyboard for model selection (two buttons per row)
    const inlineKeyboard: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < availableModels.length; i += 2) {
      const row = [];
      const model1 = availableModels[i];
      const prefix1 = model1 === currentModel ? '✓ ' : '';
      row.push({ text: `${prefix1}${model1}`, callback_data: `set_model:${i}` });

      if (i + 1 < availableModels.length) {
        const model2 = availableModels[i + 1];
        const prefix2 = model2 === currentModel ? '✓ ' : '';
        row.push({ text: `${prefix2}${model2}`, callback_data: `set_model:${i + 1}` });
      }

      inlineKeyboard.push(row);
    }

    await bot.sendMessage(
      chatId,
      `可選擇的 AI 模型：\n${lines}\n\n目前使用：${currentModel}`,
      {
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      }
    );
    return;
  }

  // Select model by index
  const index = parseInt(indexStr, 10) - 1;
  console.log(`[DEBUG] Attempting to select model at index: ${index}`);

  if (isNaN(index) || index < 0 || index >= availableModels.length) {
    console.log(`[DEBUG] Invalid model index: ${index}`);
    await bot.sendMessage(chatId, '無效的模型編號。請使用 /model 查看可用模型。');
    return;
  }

  const selectedModel = availableModels[index];
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  let state = chatStates.get(chatId);
  if (!state) {
    console.log(`[DEBUG] Creating new chat state with model: ${selectedModel}`);
    state = {
      client: null,
      session: null,
      dir: undefined,
      model: selectedModel,
      busy: false,
      queue: [],
      resetting: false,
      images: [],
      awaitingFinal: false,
      pendingCompletion: false,
    };
    chatStates.set(chatId, state);
    await bot.sendMessage(chatId, `✅ 已設定模型為：${selectedModel}\n請使用 /dirs 查看並選擇工作目錄以啟動 session。`);
    // Show status after setting model
    await sendStatusMessage(bot, chatId, msg.from);
  } else {
    const oldModel = state.model;
    // Record the old model to recent models before switching
    if (oldModel && oldModel !== selectedModel) {
      addToRecentModels(state, oldModel);
    }
    state.model = selectedModel;
    console.log(`[DEBUG] Updated model from ${oldModel} to ${selectedModel}`);

    // If a session is active, restart it with the new model
    if (state.session && state.dir) {
      console.log(`[DEBUG] Active session found, restarting with new model`);
      try {
        await startSession(chatId, state.dir, selectedModel);
        await bot.sendMessage(chatId, `✅ 已切換模型為：${selectedModel}\nSession 已重新啟動。`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, selectedModel), { text: '🔄 重新開始', callback_data: 'cmd_reset' }],
            ],
          },
        });
        // Show status after model change with active session
        await sendStatusMessage(bot, chatId, msg.from);
      } catch (err) {
        console.error(`[DEBUG] Error restarting session with new model:`, err);
        await bot.sendMessage(chatId, `❗ 切換模型失敗：${(err as Error).message}`);
      }
    } else {
      await bot.sendMessage(chatId, `✅ 已設定模型為：${selectedModel}`);
      // Show status after setting model
      await sendStatusMessage(bot, chatId, msg.from);
    }
  }
});

// Command: /reset - restart current session
bot.onText(/^\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`[DEBUG] /reset command received from chatId: ${chatId}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /reset from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  const state = chatStates.get(chatId);
  if (!state || !state.session) {
    console.log(`[DEBUG] No active session found for chatId: ${chatId}`);
    await bot.sendMessage(chatId, '目前沒有正在運行的 session。請使用 /dirs 查看並選擇工作目錄。');
    return;
  }

  const currentDir = state.dir;
  const currentModel = state.model;

  console.log(`[DEBUG] Resetting session - dir: ${currentDir}, model: ${currentModel}`);

  // Clear queue and set resetting flag
  state.queue = [];
  state.resetting = true;
  state.busy = false;
  state.currentPrompt = undefined;
  state.awaitingFinal = false;
  state.pendingCompletion = false;
  state.turnCount = 0;

  await bot.sendMessage(chatId, '🔄 正在重新啟動 Copilot session...');

  try {
    // Abort current session if any
    if (state.session) {
      try {
        await state.session.abort();
        console.log(`[DEBUG] Session aborted successfully`);
      } catch (err) {
        console.error(`[DEBUG] Error aborting session:`, err);
      }
    }

    // Start new session immediately
    if (currentDir) {
      await startSession(chatId, currentDir, currentModel);
      console.log(`[DEBUG] Reset completed successfully`);

      // Send success message and instructions with Inline Keyboard (same as /start)
      let instructions = '✅ Copilot session 已重新啟動！\n\n';
      instructions += '歡迎使用 Copilot Telegram Bot！\n';
      instructions += '使用 /dirs 列出可用的工作目錄。\n';
      instructions += '使用 /model 選擇要使用的 AI 模型。\n';
      instructions += '直接輸入提示詞，Copilot 將開始處理並回應。\n';
      instructions += '若目前有任務在進行中,新的提示詞將排入隊列。\n';
      instructions += '使用 /reset 可中止當前的 Copilot session 並重新開始。';

      await bot.sendMessage(chatId, instructions, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, currentModel)],
            [{ text: '🔄 重新開始', callback_data: 'cmd_reset' }],
          ],
        },
      });
    } else {
      console.error(`[DEBUG] No directory found during reset`);
      await bot.sendMessage(chatId, '❗ 重設失敗：找不到工作目錄。請使用 /dirs 重新查看並選擇目錄。');
    }
  } catch (err) {
    console.error(`[DEBUG] Error during reset:`, err);
    await bot.sendMessage(chatId, `❗ 重設失敗：${(err as Error).message}\n\n請使用 /dirs 重新查看並選擇工作目錄。`);
  }
});

// Command: /shutdown - gracefully shutdown the bot
bot.onText(/^\/shutdown/, async (msg) => {
  const chatId = msg.chat.id;
  const messageTime = msg.date || 0;

  // Ignore messages sent before bot startup
  if (messageTime < botStartTime) {
    console.log(`[DEBUG] Ignoring old /shutdown command from chatId: ${chatId} (message time: ${messageTime}, bot start: ${botStartTime})`);
    return;
  }

  console.log(`[DEBUG] /shutdown command received from chatId: ${chatId}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /shutdown from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  await bot.sendMessage(chatId, '🔌 已經關閉 Copilot Bot...');

  // Trigger the same cleanup as SIGINT
  process.emit('SIGINT');
});

// Handle callback queries (Inline Keyboard button clicks)
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  if (!chatId) return;

  // Ignore old callback queries
  const queryTime = query.message?.date || 0;
  if (queryTime < botStartTime) {
    console.log(`[DEBUG] Ignoring old callback query from chatId: ${chatId}`);
    await bot.answerCallbackQuery(query.id);
    return;
  }

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting callback query from non-owner chatId: ${chatId}`);
    await bot.answerCallbackQuery(query.id);
    await sendNotOwnerMessage(chatId);
    return;
  }

  // Handle show full tool result button (legacy - kept for compatibility)
  if (query.data?.startsWith('show_full:')) {
    const resultKey = query.data.slice('show_full:'.length);
    const storedResult = fullToolResults.get(resultKey);
    if (storedResult) {
      await bot.answerCallbackQuery(query.id);
      // Send full content using sendLongMessage for long outputs, reply to start message
      const replyToId = storedResult.startMsgId;
      await sendLongMessage(bot, chatId, `📋 工具結果：${storedResult.toolName}\n\`\`\`\n${storedResult.fullText}\n\`\`\``, replyToId);
      // Clean up stored result after showing
      fullToolResults.delete(resultKey);
    } else {
      await bot.answerCallbackQuery(query.id, { text: '內容已過期或不存在' });
    }
    return;
  }

  // Handle show tool result button (from tool start message)
  if (query.data?.startsWith('show_result:')) {
    const resultKey = query.data.slice('show_result:'.length);
    const storedResult = fullToolResults.get(resultKey);
    if (storedResult) {
      await bot.answerCallbackQuery(query.id);
      // Send result as reply to the tool start message
      const replyToId = storedResult.startMsgId || query.message?.message_id;
      await sendLongMessage(bot, chatId, `📋 工具結果：${storedResult.toolName}\n\`\`\`\n${storedResult.fullText}\n\`\`\``, replyToId);
      // Clean up stored result after showing
      fullToolResults.delete(resultKey);
    } else {
      // Result not yet available (tool still running) or already shown
      await bot.answerCallbackQuery(query.id, { text: '結果尚未就緒或已顯示過' });
    }
    return;
  }

  // Handle show tool params button (from tool start message)
  if (query.data?.startsWith('show_params:')) {
    const resultKey = query.data.slice('show_params:'.length);
    const storedParams = toolParamsStorage.get(resultKey);
    if (storedParams) {
      await bot.answerCallbackQuery(query.id);
      // Send params as reply to the tool start message
      await sendLongMessage(bot, chatId, `📋 工具參數：${storedParams.toolName}\n\`\`\`json\n${storedParams.paramsText}\n\`\`\``, storedParams.startMsgId);
      // Clean up stored params after showing
      toolParamsStorage.delete(resultKey);
    } else {
      await bot.answerCallbackQuery(query.id, { text: '參數已過期或不存在' });
    }
    return;
  }

  if (query.data === 'shutdown') {
    console.log(`[DEBUG] Shutdown button clicked from chatId: ${chatId}`);

    await bot.answerCallbackQuery(query.id, { text: '正在關閉...' });
    await bot.sendMessage(chatId, '🔌 已經關閉 Copilot Bot...');

    // Trigger the same cleanup as SIGINT
    process.emit('SIGINT');
    return;
  }

  // Handle command buttons from inline keyboard
  if (query.data === 'cmd_dirs') {
    await bot.answerCallbackQuery(query.id);
    // Trigger /dirs command logic
    const availableDirectories = getAvailableDirectories();
    if (availableDirectories.length === 0) {
      await bot.sendMessage(chatId, '目前沒有設定任何工作目錄。請設定環境變數 DIRECTORY_PATTERNS 或編輯 directories.json。');
      return;
    }
    let state = chatStates.get(chatId);
    if (!state) {
      state = {
        client: null,
        session: null,
        dir: undefined,
        model: defaultModel,
        busy: false,
        queue: [],
        resetting: false,
        images: [],
        awaitingFinal: false,
        pendingCompletion: false,
      };
      chatStates.set(chatId, state);
    }
    state.availableDirs = availableDirectories;

    const inlineKeyboard: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < availableDirectories.length; i += 2) {
      const row = [];
      const dir1 = availableDirectories[i];
      row.push({ text: path.basename(dir1), callback_data: `set_dir:${i}` });
      if (i + 1 < availableDirectories.length) {
        const dir2 = availableDirectories[i + 1];
        row.push({ text: path.basename(dir2), callback_data: `set_dir:${i + 1}` });
      }
      inlineKeyboard.push(row);
    }
    await bot.sendMessage(chatId, '請選擇工作目錄：', {
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
    return;
  }

  if (query.data === 'cmd_status') {
    await bot.answerCallbackQuery(query.id);
    await sendStatusMessage(bot, chatId, query.from);
    return;
  }

  if (query.data === 'cmd_help') {
    await bot.answerCallbackQuery(query.id);
    await sendWelcomeMessage(bot, chatId);
    return;
  }

  if (query.data === 'cmd_model') {
    await bot.answerCallbackQuery(query.id);
    const state = chatStates.get(chatId);
    const currentModel = state?.model || defaultModel;

    // Build inline keyboard for model selection (two buttons per row)
    const inlineKeyboard: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < availableModels.length; i += 2) {
      const row = [];
      const model1 = availableModels[i];
      const prefix1 = model1 === currentModel ? '✓ ' : '';
      row.push({ text: `${prefix1}${model1}`, callback_data: `set_model:${i}` });

      if (i + 1 < availableModels.length) {
        const model2 = availableModels[i + 1];
        const prefix2 = model2 === currentModel ? '✓ ' : '';
        row.push({ text: `${prefix2}${model2}`, callback_data: `set_model:${i + 1}` });
      }

      inlineKeyboard.push(row);
    }

    await bot.sendMessage(
      chatId,
      `請選擇 AI 模型（目前：${currentModel}）`,
      {
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      }
    );
    return;
  }

  if (query.data === 'cmd_reset') {
    await bot.answerCallbackQuery(query.id);
    const state = chatStates.get(chatId);
    if (!state || !state.session) {
      // Show /start content instead of error message
      await sendWelcomeMessage(bot, chatId);
      return;
    }
    const currentDir = state.dir;
    const currentModel = state.model;

    if (!currentDir) {
      await sendWelcomeMessage(bot, chatId);
      return;
    }

    state.queue = [];
    state.resetting = true;
    state.busy = false;
    state.turnCount = 0;
    await bot.sendMessage(chatId, '⚙️ 正在重新啟動 Copilot session...');
    try {
      await state.session.destroy();
      state.session = null;
      await startSession(chatId, currentDir, currentModel);
      state.resetting = false;
      // Send success message with Inline Keyboard (same as /start)
      await bot.sendMessage(chatId, '✅ Session 已重新啟動。', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, currentModel)],
            [{ text: '🔄 重新開始', callback_data: 'cmd_reset' }],
          ],
        },
      });
    } catch (err) {
      console.error(`[DEBUG] Error during reset:`, err);
      state.resetting = false;
      await bot.sendMessage(chatId, `❗ 重啟失敗：${(err as Error).message}`);
    }
    return;
  }

  // Handle directory selection from inline keyboard
  if (query.data?.startsWith('set_dir:')) {
    const indexStr = query.data.replace('set_dir:', '');
    const index = parseInt(indexStr, 10);
    console.log(`[DEBUG] Directory selection callback from chatId: ${chatId}, index: ${index}`);

    const state = chatStates.get(chatId);
    let availableDirectories = state?.availableDirs;
    if (!availableDirectories || availableDirectories.length === 0) {
      availableDirectories = getAvailableDirectories();
      if (state) {
        state.availableDirs = availableDirectories;
      }
    }

    if (availableDirectories.length === 0) {
      await bot.answerCallbackQuery(query.id, { text: '目前沒有設定任何工作目錄' });
      await bot.sendMessage(chatId, '目前沒有設定任何工作目錄。請設定環境變數 DIRECTORY_PATTERNS 或編輯 directories.json。');
      return;
    }

    if (isNaN(index) || index < 0 || index >= availableDirectories.length) {
      console.log(`[DEBUG] Invalid directory index from callback: ${index}`);
      await bot.answerCallbackQuery(query.id, { text: '無效的目錄編號' });
      return;
    }

    const dir = availableDirectories[index];
    console.log(`[DEBUG] Selected directory via callback: ${dir}`);

    await bot.answerCallbackQuery(query.id, { text: `選擇：${path.basename(dir)}` });

    try {
      await startSession(chatId, dir);
      await bot.sendMessage(chatId, `✅ 已選擇工作目錄：${dir}`);
      // Show status after setting directory
      await sendStatusMessage(bot, chatId, query.from);
    } catch (err) {
      console.error(`[DEBUG] Error starting session from callback:`, err);
      await bot.sendMessage(chatId, `❗ 無法啟動 Copilot session：${(err as Error).message}`);
    }
    return;
  }

  // Handle model selection from inline keyboard
  if (query.data?.startsWith('set_model:')) {
    const indexStr = query.data.replace('set_model:', '');
    const index = parseInt(indexStr, 10);
    console.log(`[DEBUG] Model selection callback from chatId: ${chatId}, index: ${index}`);

    if (isNaN(index) || index < 0 || index >= availableModels.length) {
      console.log(`[DEBUG] Invalid model index from callback: ${index}`);
      await bot.answerCallbackQuery(query.id, { text: '無效的模型編號' });
      return;
    }

    const selectedModel = availableModels[index];
    console.log(`[DEBUG] Selected model via callback: ${selectedModel}`);

    await bot.answerCallbackQuery(query.id, { text: `選擇：${selectedModel}` });

    let state = chatStates.get(chatId);
    if (!state) {
      console.log(`[DEBUG] Creating new chat state with model: ${selectedModel}`);
      state = {
        client: null,
        session: null,
        dir: undefined,
        model: selectedModel,
        busy: false,
        queue: [],
        resetting: false,
        images: [],
        awaitingFinal: false,
        pendingCompletion: false,
      };
      chatStates.set(chatId, state);
      await bot.sendMessage(chatId, `✅ 已設定模型為：${selectedModel}\n請使用 /dirs 選擇工作目錄以啟動 session。`);
      await sendStatusMessage(bot, chatId, query.from);
    } else {
      const oldModel = state.model;
      // Record the old model to recent models before switching
      if (oldModel && oldModel !== selectedModel) {
        addToRecentModels(state, oldModel);
      }
      state.model = selectedModel;
      console.log(`[DEBUG] Updated model from ${oldModel} to ${selectedModel}`);

      // If a session is active, restart it with the new model
      if (state.session && state.dir) {
        console.log(`[DEBUG] Active session found, restarting with new model`);
        try {
          await startSession(chatId, state.dir, selectedModel);
          await bot.sendMessage(chatId, `✅ 已切換模型為：${selectedModel}\nSession 已重新啟動。`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📂 選取專案', callback_data: 'cmd_dirs' }, ...buildModelSwitchRow(chatId, selectedModel), { text: '🔄 重新開始', callback_data: 'cmd_reset' }],
              ],
            },
          });
          await sendStatusMessage(bot, chatId, query.from);
        } catch (err) {
          console.error(`[DEBUG] Error restarting session with new model:`, err);
          await bot.sendMessage(chatId, `❗ 切換模型失敗：${(err as Error).message}`);
        }
      } else {
        await bot.sendMessage(chatId, `✅ 已設定模型為：${selectedModel}`);
        await sendStatusMessage(bot, chatId, query.from);
      }
    }
    return;
  }
});

// Command: /status or /st - show current session status
bot.onText(/^\/(?:status|st)(?:\s|$)/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`[DEBUG] /status command received from chatId: ${chatId}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting /status from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  await sendStatusMessage(bot, chatId, msg.from);
});
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const captionOrText = (msg.text || (msg as any).caption) as string | undefined;
  const hasPhoto = !!(msg.photo && (msg.photo as any[]).length > 0);
  const isImageDocument = !!(msg.document && typeof (msg.document as any).mime_type === 'string' && (msg.document as any).mime_type.startsWith('image/'));

  console.log(`[DEBUG] Message received from chatId: ${chatId}, text/caption length: ${captionOrText?.length || 0}, hasPhoto: ${hasPhoto}, imageDocument: ${isImageDocument}`);

  // Check if the user is the authorized owner
  if (!isOwner(chatId)) {
    console.log(`[DEBUG] Rejecting message from non-owner chatId: ${chatId}`);
    await sendNotOwnerMessage(chatId);
    return;
  }

  // Process image attachments first (store Telegram file URLs in chat state)
  if (hasPhoto || isImageDocument) {
    try {
      let state = chatStates.get(chatId);
      if (!state) {
        state = {
          client: null,
          session: null,
          dir: undefined,
          model: defaultModel,
          busy: false,
          queue: [],
          resetting: false,
          emoji: pickSessionEmoji(),
          images: [],
          awaitingFinal: false,
          pendingCompletion: false,
        } as ChatState;
        chatStates.set(chatId, state);
      }

      const added: string[] = [];
      if (hasPhoto) {
        const photos = msg.photo as any[];
        const best = photos[photos.length - 1];
        const file = await bot.getFile(best.file_id);
        const url = `https://api.telegram.org/file/bot${telegramToken}/${file.file_path}`;
        state.images = state.images || [];
        state.images.push(url);
        added.push(url);
      } else if (isImageDocument && (msg as any).document) {
        const file = await bot.getFile((msg as any).document.file_id);
        const url = `https://api.telegram.org/file/bot${telegramToken}/${file.file_path}`;
        state.images = state.images || [];
        state.images.push(url);
        added.push(url);
      }

      await bot.sendMessage(chatId, `✅ 已將圖片加入參考上下文（共 ${state.images!.length} 張）。`);
    } catch (err) {
      console.error(`[DEBUG] Error handling image attachment:`, err);
      await bot.sendMessage(chatId, '❗ 處理圖片時發生錯誤（已忽略）。');
    }

    // If there is no text/caption, stop here — user only attached images
    if (!captionOrText) {
      return;
    }
  }

  // Commands are handled separately via onText. Ignore messages starting with '/' here.
  if (!captionOrText) {
    console.log(`[DEBUG] No text in message, ignoring`);
    return;
  }
  if (captionOrText.startsWith('/')) {
    console.log(`[DEBUG] Message is a command, ignoring in message handler`);
    return;
  }

  let state = chatStates.get(chatId);
  if (!state || !state.session || !state.dir) {
    console.log(`[DEBUG] No active session for chatId: ${chatId}`);
    await bot.sendMessage(chatId, '請先用 /dirs 查看並選擇工作目錄。');
    return;
  }
  // If reset is requested, ignore new prompts
  if (state.resetting) {
    console.log(`[DEBUG] Session is resetting, rejecting new prompt`);
    await bot.sendMessage(chatId, '⚠️ 正在重新啟動 Copilot session，請稍後再試。');
    return;
  }

  // Compose prompt by appending any stored image URLs for context
  const promptToSend = appendImagesToPrompt(captionOrText, state.images);

  // Enqueue or send prompt
  if (state.busy) {
    console.log(`[DEBUG] Session busy, queueing prompt. Queue length will be: ${state.queue.length + 1}`);
    state.queue.push(captionOrText);
    await bot.sendMessage(chatId, '🕒 任務已加入等待佇列。');
  } else {
    console.log(`[DEBUG] Session idle, sending prompt immediately`);
    state.busy = true;
    state.currentPrompt = captionOrText;
    state.awaitingFinal = true;
    state.pendingCompletion = false;
    // Store the original message ID for reply_to_message_id
    state.originalMessageId = msg.message_id;
    // Increment turn count
    state.turnCount = (state.turnCount ?? 0) + 1;
    try {
      await state.session.send({ prompt: promptToSend });
      console.log(`[DEBUG] Prompt sent successfully`);
    } catch (err) {
      console.error(`[DEBUG] Error sending prompt:`, err);
      await bot.sendMessage(chatId, `❗ 發送提示時發生錯誤：${(err as Error).message}`);
      state.busy = false;
      state.currentPrompt = undefined;
      state.awaitingFinal = false;
    }
  }
});

// Graceful shutdown on process termination
process.on('SIGINT', async () => {
  console.log('[DEBUG] Received SIGINT, shutting down...');

  // Stop Telegram polling to avoid library errors during shutdown
  try {
    console.log('[DEBUG] Stopping Telegram polling');
    bot.stopPolling();
  } catch (err) {
    console.error('[DEBUG] Error stopping Telegram polling (ignored):', err);
  }

  // Create shutdown promises for all cleanup operations
  const cleanupPromises: Promise<void>[] = [];

  for (const [chatId, state] of chatStates) {
    console.log(`[DEBUG] Cleaning up chatId: ${chatId}`);

    const cleanupPromise = (async () => {
      try {
        if (state.session) {
          console.log(`[DEBUG] Destroying session for chatId: ${chatId}`);
          await Promise.race([
            state.session.destroy(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
          ]);
        }
      } catch (err) {
        if (isDisposedConnectionError(err)) {
          console.log(`[DEBUG] Ignored disposed connection error while destroying session for chatId ${chatId}: ${(err as any)?.message || err}`);
        } else {
          console.error(`[DEBUG] Error destroying session for chatId ${chatId}:`, err);
        }
      }

      try {
        if (state.client) {
          console.log(`[DEBUG] Stopping client for chatId: ${chatId}`);
          try {
            await Promise.race([
              state.client.stop(),
              new Promise<void>((resolve) => setTimeout(resolve, 3000)) // 3 second timeout
            ]);
          } catch (err) {
            if (isDisposedConnectionError(err)) {
              console.log(`[DEBUG] Ignored disposed connection error while stopping client for chatId ${chatId}: ${(err as any)?.message || err}`);
            } else {
              console.error(`[DEBUG] Error stopping client for chatId ${chatId} (ignored):`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[DEBUG] Error during cleanup for chatId ${chatId}:`, err);
      }
    })();

    cleanupPromises.push(cleanupPromise);
  }

  // Wait for all cleanup operations with overall timeout
  try {
    await Promise.race([
      Promise.all(cleanupPromises),
      new Promise<void>((resolve) => setTimeout(resolve, 10000)) // 10 second overall timeout
    ]);
  } catch (err) {
    console.error('[DEBUG] Error during cleanup (continuing shutdown):', err);
  }

  console.log('[DEBUG] Shutdown complete');
  process.exit(0);
});

/**
 * Get provider information from Copilot SDK
 */
async function getProviderInfo(): Promise<string> {
  let tempClient: CopilotClient | null = null;
  try {
    tempClient = new CopilotClient();
    await tempClient.start();

    const [statusResp, authResp, models] = await Promise.allSettled([
      tempClient.getStatus(),
      tempClient.getAuthStatus(),
      tempClient.listModels().catch(() => [] as ModelInfo[]),
    ]);

    let info = '📊 Copilot SDK 資訊\n\n';

    // Status info
    if (statusResp.status === 'fulfilled') {
      const status = statusResp.value as GetStatusResponse;
      info += `版本：${status.version}\n`;
      info += `協定版本：${status.protocolVersion}\n\n`;
    }

    // Auth info
    if (authResp.status === 'fulfilled') {
      const auth = authResp.value as GetAuthStatusResponse;
      info += `🔐 驗證狀態\n`;
      info += `已驗證：${auth.isAuthenticated ? '✅ 是' : '❌ 否'}\n`;
      if (auth.authType) {
        info += `驗證類型：${auth.authType}\n`;
      }
      if (auth.host) {
        info += `主機：${auth.host}\n`;
      }
      if (auth.login) {
        info += `使用者：${auth.login}\n`;
      }
      if (auth.statusMessage) {
        info += `狀態訊息：${auth.statusMessage}\n`;
      }
      info += '\n';
    }

    // Models info
    if (models.status === 'fulfilled' && models.value.length > 0) {
      const modelList = models.value as ModelInfo[];
      info += `🤖 可用模型（共 ${modelList.length} 個）\n`;
      
      // Group models by provider (infer from model ID)
      const providers = new Map<string, ModelInfo[]>();
      for (const model of modelList) {
        let provider = 'Other';
        if (model.id.startsWith('gpt-') || model.id.startsWith('o1-')) {
          provider = 'OpenAI';
        } else if (model.id.startsWith('claude-')) {
          provider = 'Anthropic';
        } else if (model.id.startsWith('gemini-')) {
          provider = 'Google';
        }
        if (!providers.has(provider)) {
          providers.set(provider, []);
        }
        providers.get(provider)!.push(model);
      }

      // Display by provider
      for (const [provider, providerModels] of providers) {
        info += `\n${provider}:\n`;
        for (const model of providerModels) {
          const vision = model.capabilities?.supports?.vision ? '👁️' : '';
          info += `  • ${model.id} ${vision}\n`;
        }
      }
    }

    await tempClient.stop();
    tempClient = null;
    return info;
  } catch (err) {
    if (tempClient) {
      try {
        await tempClient.stop();
      } catch (stopErr) {
        // Ignore cleanup errors
      }
    }
    console.error('[DEBUG] Error getting provider info:', err);
    return `❗ 無法取得 Copilot SDK 資訊：${(err as Error).message}`;
  }
}

(async () => {
  // Verify Copilot token before starting the bot
  await verifyCopilotToken();

  try {
    const dropped = await clearPendingUpdates(bot);
    if (dropped > 0) {
      console.log(`[DEBUG] Dropped ${dropped} pending updates on startup`);
    }
  } catch (err) {
    console.error('[DEBUG] Failed to clear pending updates (continuing):', err);
  }

  try {
    await bot.startPolling();
    console.log('開始接聽 Telegram 發來的請求...');

    // Get and display provider information
    console.log('\n⏳ 正在取得 Copilot SDK 資訊...');
    const providerInfo = await getProviderInfo();
    console.log('\n' + providerInfo);

    // Send welcome message to owner if configured
    if (ownerChatId && !isNaN(ownerChatId)) {
      try {
        await sendWelcomeMessage(bot, ownerChatId, true);
        
        // Send provider info to owner
        await bot.sendMessage(ownerChatId, providerInfo);
        
        console.log(`[DEBUG] Welcome message and provider info sent to owner (chatId: ${ownerChatId})`);
      } catch (err) {
        console.error(`[DEBUG] Failed to send welcome message to owner:`, err);
      }
    }
  } catch (err) {
    console.error('[DEBUG] Failed to start polling:', err);
    process.exit(1);
  }
})();
