/**
 * Utility functions extracted for testability.
 * These functions are used by the main bot but can be tested independently.
 */
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper to detect the disposed connection error thrown by vscode-jsonrpc
 */
export function isDisposedConnectionError(err: any): boolean {
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
export function expandPatterns(patterns: string[]): string[] {
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
export function loadDirectoryPatterns(dirname: string): string[] {
  const envValue = process.env.DIRECTORY_PATTERNS;
  if (envValue && envValue.trim().length > 0) {
    return envValue.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  }
  // Try reading directories.json from project root
  const jsonPath = path.join(dirname, '..', 'directories.json');
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

/**
 * Pick a session emoji that is not currently used by other sessions.
 */
export function pickSessionEmoji(usedEmojis: Set<string>, availableEmojis: string[]): string {
  for (const e of availableEmojis) {
    if (!usedEmojis.has(e)) return e;
  }
  // Fallback to a random emoji if all are used
  return availableEmojis[Math.floor(Math.random() * availableEmojis.length)];
}

/**
 * Parse model index from command match result.
 * Returns -1 if the index is invalid.
 */
export function parseModelIndex(indexStr: string | undefined, maxIndex: number): number {
  if (!indexStr) return -1;
  const index = parseInt(indexStr, 10) - 1;
  if (isNaN(index) || index < 0 || index >= maxIndex) {
    return -1;
  }
  return index;
}

/**
 * Parse directory index from command match result.
 * Returns -1 if the index is invalid.
 */
export function parseDirectoryIndex(indexStr: string | undefined, maxIndex: number): number {
  if (!indexStr) return -1;
  const index = parseInt(indexStr, 10) - 1;
  if (isNaN(index) || index < 0 || index >= maxIndex) {
    return -1;
  }
  return index;
}

/**
 * Format chat target name from Telegram message.
 */
export function formatChatTarget(msg: { 
  chat: { 
    id: number; 
    type: string; 
    title?: string; 
    username?: string; 
  }; 
  from?: { 
    first_name?: string; 
    last_name?: string; 
    username?: string; 
  }; 
}): string {
  try {
    if (msg.chat.type === 'private') {
      const user = msg.from;
      if (user) {
        const name = `${user.first_name || ''}${user.last_name ? ' ' + user.last_name : ''}`.trim();
        return name || (user.username ? `@${user.username}` : '未知');
      }
    } else if (msg.chat.title) {
      return msg.chat.title;
    } else if (msg.chat.username) {
      return `@${msg.chat.username}`;
    } else {
      return `chatId: ${msg.chat.id}`;
    }
  } catch (e) {
    // fall through
  }
  return '未知';
}

/**
 * Split a long message into chunks that fit within Telegram's 4096 character limit.
 * Tries to split on newline boundaries when possible.
 */
export function splitLongMessage(text: string, maxLen: number = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLen);
    // Try to split on newline to avoid breaking words arbitrarily
    if (remaining.length > maxLen) {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.8) {
        chunk = remaining.slice(0, lastNewline + 1);
      }
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return chunks;
}

/**
 * Parse JSON results from tool execution, with pretty printing.
 * Returns undefined if rawResults is null/undefined.
 */
export function formatToolResults(rawResults: any): string | undefined {
  if (rawResults === undefined || rawResults === null) {
    return undefined;
  }
  if (typeof rawResults === 'string') {
    try {
      const parsed = JSON.parse(rawResults);
      return JSON.stringify(parsed, null, 2);
    } catch (_e) {
      // Not JSON — return the raw string as-is
      return rawResults;
    }
  } else {
    // Non-string (object/array) — pretty print
    try {
      return JSON.stringify(rawResults, null, 2);
    } catch (_e) {
      return String(rawResults);
    }
  }
}

/**
 * Available Copilot models.
 */
export const availableModels = [
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-opus-4.5',
  'claude-sonnet-4',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-5.1-codex-mini',
  'gpt-5-mini',
  'gpt-4.1',
  'gemini-3-pro-preview',
];

/**
 * Pool of emojis to assign to sessions.
 */
export const sessionEmojis = ['🔵','🟢','🔴','🟣','🟡','🟠','✨','🔥','🌟','🚀','🧠','🔔','🎯','✅','🔚','⚡️','🌈','🍀'];

/**
 * Default model for Copilot sessions.
 */
export const defaultModel = 'gpt-5-mini';
