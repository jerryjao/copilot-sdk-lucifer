/**
 * Unit tests for @willh/telegram-copilot-bot utility functions.
 */
import {
  isDisposedConnectionError,
  expandPatterns,
  loadDirectoryPatterns,
  pickSessionEmoji,
  parseModelIndex,
  parseDirectoryIndex,
  formatChatTarget,
  splitLongMessage,
  formatToolResults,
  availableModels,
  sessionEmojis,
  defaultModel,
} from '../src/utils.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('isDisposedConnectionError', () => {
  it('should return false for null/undefined', () => {
    expect(isDisposedConnectionError(null)).toBe(false);
    expect(isDisposedConnectionError(undefined)).toBe(false);
  });

  it('should return true for error with code -32097', () => {
    const err = { code: -32097, message: 'some error' };
    expect(isDisposedConnectionError(err)).toBe(true);
  });

  it('should return true for error message containing "pending response rejected since connection got disposed"', () => {
    const err = { message: 'pending response rejected since connection got disposed' };
    expect(isDisposedConnectionError(err)).toBe(true);
  });

  it('should return true for error message containing "connection got disposed"', () => {
    const err = { message: 'The connection got disposed unexpectedly' };
    expect(isDisposedConnectionError(err)).toBe(true);
  });

  it('should return false for unrelated errors', () => {
    const err = { code: 123, message: 'Some other error' };
    expect(isDisposedConnectionError(err)).toBe(false);
  });

  it('should handle string error', () => {
    expect(isDisposedConnectionError('connection got disposed')).toBe(true);
    expect(isDisposedConnectionError('random error')).toBe(false);
  });
});

describe('expandPatterns', () => {
  let tempDir: string;
  let tempDirGlob: string; // forward-slash version for glob

  beforeAll(() => {
    // Create a temporary directory structure for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-expand-'));
    // Convert to forward slashes for glob compatibility on Windows
    tempDirGlob = tempDir.replace(/\\/g, '/');
    fs.mkdirSync(path.join(tempDir, 'project1'));
    fs.mkdirSync(path.join(tempDir, 'project2'));
    fs.mkdirSync(path.join(tempDir, 'project3'));
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'test');
  });

  afterAll(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return empty array for empty patterns', () => {
    expect(expandPatterns([])).toEqual([]);
  });

  it('should expand wildcard patterns', () => {
    const result = expandPatterns([`${tempDirGlob}/*`]);
    expect(result.length).toBe(3); // 3 directories, file excluded
    expect(result.every(r => r.includes('project'))).toBe(true);
  });

  it('should handle specific directory path', () => {
    const result = expandPatterns([`${tempDirGlob}/project1`]);
    expect(result.length).toBe(1);
    expect(result[0]).toContain('project1');
  });

  it('should exclude non-directory matches', () => {
    const result = expandPatterns([`${tempDirGlob}/*`]);
    expect(result.every(r => !r.includes('file.txt'))).toBe(true);
  });

  it('should return unique directories', () => {
    const result = expandPatterns([
      `${tempDirGlob}/project1`,
      `${tempDirGlob}/project1`,
    ]);
    expect(result.length).toBe(1);
  });

  it('should ignore non-existent patterns', () => {
    const result = expandPatterns(['/nonexistent/path/that/does/not/exist']);
    expect(result).toEqual([]);
  });
});

describe('loadDirectoryPatterns', () => {
  const originalEnv = process.env.DIRECTORY_PATTERNS;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-load-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.DIRECTORY_PATTERNS = originalEnv;
    } else {
      delete process.env.DIRECTORY_PATTERNS;
    }
  });

  it('should load patterns from environment variable', () => {
    process.env.DIRECTORY_PATTERNS = '/path/a,/path/b,/path/c';
    const result = loadDirectoryPatterns(tempDir);
    expect(result).toEqual(['/path/a', '/path/b', '/path/c']);
  });

  it('should trim whitespace from patterns', () => {
    process.env.DIRECTORY_PATTERNS = '  /path/a  ,  /path/b  ';
    const result = loadDirectoryPatterns(tempDir);
    expect(result).toEqual(['/path/a', '/path/b']);
  });

  it('should filter empty patterns', () => {
    process.env.DIRECTORY_PATTERNS = '/path/a,,/path/b,  ,/path/c';
    const result = loadDirectoryPatterns(tempDir);
    expect(result).toEqual(['/path/a', '/path/b', '/path/c']);
  });

  it('should return empty array if env is empty and no directories.json', () => {
    delete process.env.DIRECTORY_PATTERNS;
    const result = loadDirectoryPatterns(tempDir);
    expect(result).toEqual([]);
  });

  it('should load from directories.json if env not set', () => {
    delete process.env.DIRECTORY_PATTERNS;
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'directories.json'),
      JSON.stringify(['/json/path1', '/json/path2'])
    );
    const result = loadDirectoryPatterns(srcDir);
    expect(result).toEqual(['/json/path1', '/json/path2']);
  });

  it('should return empty array when directories.json is invalid JSON', () => {
    delete process.env.DIRECTORY_PATTERNS;
    const srcDir = path.join(tempDir, 'src-invalid');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'directories.json'), 'not-json');
    const result = loadDirectoryPatterns(srcDir);
    expect(result).toEqual([]);
  });
});

describe('pickSessionEmoji', () => {
  it('should return first available emoji when none are used', () => {
    const result = pickSessionEmoji(new Set(), sessionEmojis);
    expect(result).toBe('🔵');
  });

  it('should skip used emojis', () => {
    const used = new Set(['🔵', '🟢']);
    const result = pickSessionEmoji(used, sessionEmojis);
    expect(result).toBe('🔴');
  });

  it('should return random emoji when all are used', () => {
    const used = new Set(sessionEmojis);
    const result = pickSessionEmoji(used, sessionEmojis);
    expect(sessionEmojis).toContain(result);
  });
});

describe('parseModelIndex', () => {
  it('should return -1 for undefined input', () => {
    expect(parseModelIndex(undefined, 10)).toBe(-1);
  });

  it('should return -1 for empty string', () => {
    expect(parseModelIndex('', 10)).toBe(-1);
  });

  it('should return -1 for invalid number', () => {
    expect(parseModelIndex('abc', 10)).toBe(-1);
  });

  it('should return -1 for out of range (too low)', () => {
    expect(parseModelIndex('0', 10)).toBe(-1);
  });

  it('should return -1 for out of range (too high)', () => {
    expect(parseModelIndex('11', 10)).toBe(-1);
  });

  it('should return correct zero-based index for valid input', () => {
    expect(parseModelIndex('1', 10)).toBe(0);
    expect(parseModelIndex('5', 10)).toBe(4);
    expect(parseModelIndex('10', 10)).toBe(9);
  });
});

describe('parseDirectoryIndex', () => {
  it('should return -1 for undefined input', () => {
    expect(parseDirectoryIndex(undefined, 5)).toBe(-1);
  });

  it('should return correct zero-based index for valid input', () => {
    expect(parseDirectoryIndex('1', 5)).toBe(0);
    expect(parseDirectoryIndex('3', 5)).toBe(2);
  });

  it('should return -1 for out of range', () => {
    expect(parseDirectoryIndex('6', 5)).toBe(-1);
  });
});

describe('formatChatTarget', () => {
  it('should format private chat with full name', () => {
    const msg = {
      chat: { id: 123, type: 'private' },
      from: { first_name: 'John', last_name: 'Doe' },
    };
    expect(formatChatTarget(msg)).toBe('John Doe');
  });

  it('should format private chat with only first name', () => {
    const msg = {
      chat: { id: 123, type: 'private' },
      from: { first_name: 'John' },
    };
    expect(formatChatTarget(msg)).toBe('John');
  });

  it('should format private chat with username if no name', () => {
    const msg = {
      chat: { id: 123, type: 'private' },
      from: { username: 'johndoe' },
    };
    expect(formatChatTarget(msg)).toBe('@johndoe');
  });

  it('should return "未知" for private chat with no user info', () => {
    const msg = {
      chat: { id: 123, type: 'private' },
    };
    expect(formatChatTarget(msg)).toBe('未知');
  });

  it('should format group chat with title', () => {
    const msg = {
      chat: { id: 123, type: 'group', title: 'Test Group' },
    };
    expect(formatChatTarget(msg)).toBe('Test Group');
  });

  it('should format with chat username if no title', () => {
    const msg = {
      chat: { id: 123, type: 'channel', username: 'testchannel' },
    };
    expect(formatChatTarget(msg)).toBe('@testchannel');
  });

  it('should return chatId as fallback', () => {
    const msg = {
      chat: { id: 456, type: 'supergroup' },
    };
    expect(formatChatTarget(msg)).toBe('chatId: 456');
  });
});

describe('splitLongMessage', () => {
  it('should return single chunk for short message', () => {
    const result = splitLongMessage('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('should split long message at newline boundary', () => {
    const line = 'A'.repeat(3500);
    const text = `${line}\n${'B'.repeat(1000)}`;
    const result = splitLongMessage(text);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(`${line}\n`);
    expect(result[1]).toBe('B'.repeat(1000));
  });

  it('should handle message exactly at max length', () => {
    const text = 'A'.repeat(4096);
    const result = splitLongMessage(text);
    expect(result.length).toBe(1);
    expect(result[0].length).toBe(4096);
  });

  it('should force split if no good newline boundary', () => {
    const text = 'A'.repeat(5000);
    const result = splitLongMessage(text);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(4096);
    expect(result[1].length).toBe(904);
  });

  it('should handle empty string', () => {
    const result = splitLongMessage('');
    expect(result).toEqual([]);
  });

  it('should respect custom maxLen', () => {
    const result = splitLongMessage('Hello world', 5);
    expect(result).toEqual(['Hello', ' worl', 'd']);
  });
});

describe('formatToolResults', () => {
  it('should return undefined for null/undefined', () => {
    expect(formatToolResults(null)).toBeUndefined();
    expect(formatToolResults(undefined)).toBeUndefined();
  });

  it('should parse and pretty print JSON string', () => {
    const jsonStr = '{"key":"value"}';
    const result = formatToolResults(jsonStr);
    expect(result).toBe('{\n  "key": "value"\n}');
  });

  it('should return raw string if not valid JSON', () => {
    const rawStr = 'This is plain text output';
    expect(formatToolResults(rawStr)).toBe(rawStr);
  });

  it('should pretty print object', () => {
    const obj = { foo: 'bar', num: 42 };
    const result = formatToolResults(obj);
    expect(result).toBe('{\n  "foo": "bar",\n  "num": 42\n}');
  });

  it('should pretty print array', () => {
    const arr = [1, 2, 3];
    const result = formatToolResults(arr);
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('should handle nested objects', () => {
    const obj = { outer: { inner: 'value' } };
    const result = formatToolResults(obj);
    expect(result).toContain('"inner": "value"');
  });
});

describe('constants', () => {
  describe('availableModels', () => {
    it('should contain expected models', () => {
      expect(availableModels).toContain('gpt-5-mini');
      expect(availableModels).toContain('claude-sonnet-4');
      expect(availableModels).toContain('gemini-3-pro-preview');
    });

    it('should have correct number of models', () => {
      expect(availableModels.length).toBe(14);
    });
  });

  describe('sessionEmojis', () => {
    it('should contain expected emojis', () => {
      expect(sessionEmojis).toContain('🔵');
      expect(sessionEmojis).toContain('🟢');
      expect(sessionEmojis).toContain('🚀');
    });

    it('should have correct number of emojis', () => {
      expect(sessionEmojis.length).toBe(18);
    });
  });

  describe('defaultModel', () => {
    it('should be gpt-5-mini', () => {
      expect(defaultModel).toBe('gpt-5-mini');
    });
  });
});
