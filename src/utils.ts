/**
 * Utility functions extracted for testability.
 * These functions are used by the main bot but can be tested independently.
 */
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

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

// ---------------------------------------------------------------------------
// Google Drive types
// ---------------------------------------------------------------------------

export type GoogleFileType = 'doc' | 'slide' | 'sheet' | 'drive';

export interface GoogleFileInfo {
  type: GoogleFileType;
  id: string;
}

// ---------------------------------------------------------------------------
// OAuth2 singleton (private)
// ---------------------------------------------------------------------------

let _oauthClient: any = null;

function getGoogleOAuthClient(): any {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GOOGLE_REFRESH_TOKEN is not set. Add GOOGLE_REFRESH_TOKEN to your .env file.');
  }
  if (_oauthClient) return _oauthClient;

  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  _oauthClient = auth;
  return _oauthClient;
}

/**
 * Reset the cached OAuth2 client (used in tests to clear state between cases).
 */
export function _resetGoogleOAuthClient(): void {
  _oauthClient = null;
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

/**
 * Extract the Google file type and ID from a Google URL.
 * Returns null for non-Google URLs or plain IDs.
 */
export function extractGoogleFileInfo(url: string): GoogleFileInfo | null {
  // Must look like a URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

  // Google Docs
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([^/?#]+)/);
  if (docMatch) return { type: 'doc', id: docMatch[1] };

  // Google Slides
  const slideMatch = url.match(/docs\.google\.com\/presentation\/d\/([^/?#]+)/);
  if (slideMatch) return { type: 'slide', id: slideMatch[1] };

  // Google Sheets
  const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/);
  if (sheetMatch) return { type: 'sheet', id: sheetMatch[1] };

  // Google Drive file URL: /file/d/<id>/
  const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (driveFileMatch) return { type: 'drive', id: driveFileMatch[1] };

  // Google Drive open?id= URL
  const driveOpenMatch = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpenMatch) return { type: 'drive', id: driveOpenMatch[1] };

  return null;
}

// ---------------------------------------------------------------------------
// Error handling helper
// ---------------------------------------------------------------------------

function handleGoogleApiError(err: any): never {
  const status = err?.response?.status ?? err?.status;
  if (status === 403) {
    throw new Error(`403 Access denied. Check the file sharing settings.`);
  }
  if (status === 404) {
    throw new Error(`404 File not found. Check the file ID or URL.`);
  }
  if (status === 429) {
    throw new Error(`頻率超限（429） — Rate limit exceeded. Please try again later.`);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// fetchGoogleDocContent
// ---------------------------------------------------------------------------

/**
 * Fetch the full text content of a Google Docs document.
 */
export async function fetchGoogleDocContent(docId: string): Promise<string> {
  const auth = getGoogleOAuthClient();
  const docs = google.docs({ version: 'v1', auth });

  let response: any;
  try {
    response = await docs.documents.get({ documentId: docId });
  } catch (err) {
    handleGoogleApiError(err);
  }

  const doc = response!.data;
  const lines: string[] = [`# ${doc.title ?? ''}`];

  for (const item of doc.body?.content ?? []) {
    if (!item.paragraph) continue;
    const style = item.paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT';
    const text = (item.paragraph.elements ?? [])
      .map((el: any) => el.textRun?.content ?? '')
      .join('')
      .replace(/\n$/, '')
      .trim();
    if (!text) continue;

    if (style === 'HEADING_1') {
      lines.push(`# ${text}`);
    } else if (style === 'HEADING_2') {
      lines.push(`## ${text}`);
    } else if (style === 'HEADING_3') {
      lines.push(`### ${text}`);
    } else {
      lines.push(text);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// fetchGoogleSlidesContent
// ---------------------------------------------------------------------------

/**
 * Fetch the text content of all slides in a Google Slides presentation.
 */
export async function fetchGoogleSlidesContent(presentationId: string): Promise<string> {
  const auth = getGoogleOAuthClient();
  const slides = google.slides({ version: 'v1', auth });

  let response: any;
  try {
    response = await slides.presentations.get({ presentationId });
  } catch (err) {
    handleGoogleApiError(err);
  }

  const presentation = response!.data;
  const lines: string[] = [`# ${presentation.title ?? ''}`];

  for (let i = 0; i < (presentation.slides ?? []).length; i++) {
    const slide = presentation.slides[i];
    lines.push(`\n--- Slide ${i + 1} ---`);

    for (const element of slide.pageElements ?? []) {
      const textContent = element.shape?.text?.textElements ?? [];
      const text = textContent
        .map((te: any) => te.textRun?.content ?? '')
        .join('')
        .replace(/\n$/, '')
        .trim();
      if (text) lines.push(text);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// fetchGoogleSheetsContent
// ---------------------------------------------------------------------------

/**
 * Fetch all sheet data from a Google Sheets spreadsheet as tab-separated text.
 */
export async function fetchGoogleSheetsContent(spreadsheetId: string): Promise<string> {
  const auth = getGoogleOAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  let response: any;
  try {
    response = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: true,
    });
  } catch (err) {
    handleGoogleApiError(err);
  }

  const spreadsheet = response!.data;
  const lines: string[] = [`# ${spreadsheet.properties?.title ?? ''}`];

  for (const sheet of spreadsheet.sheets ?? []) {
    lines.push(`\n## ${sheet.properties?.title ?? ''}`);
    for (const gridData of sheet.data ?? []) {
      for (const row of gridData.rowData ?? []) {
        const cells = (row.values ?? []).map((cell: any) => cell.formattedValue ?? '');
        lines.push(cells.join('\t'));
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// fetchGoogleDriveImageBuffer
// ---------------------------------------------------------------------------

/**
 * Download an image file from Google Drive and return it as a Buffer.
 * Throws if the file is not an image type.
 */
export async function fetchGoogleDriveImageBuffer(fileId: string): Promise<Buffer> {
  const auth = getGoogleOAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // Step 1: Get file metadata to check MIME type
  let metaResponse: any;
  try {
    metaResponse = await drive.files.get({ fileId, fields: 'mimeType' });
  } catch (err) {
    handleGoogleApiError(err);
  }

  const mimeType: string = metaResponse!.data.mimeType ?? '';
  if (!mimeType.startsWith('image/')) {
    throw new Error(`File is 不是圖片 (not an image). MIME type is "${mimeType}". Please provide an image file ID.`);
  }

  // Step 2: Download the file content
  let mediaResponse: any;
  try {
    mediaResponse = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
  } catch (err) {
    handleGoogleApiError(err);
  }

  return Buffer.from(mediaResponse!.data as ArrayBuffer);
}
