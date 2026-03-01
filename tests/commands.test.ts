/**
 * Unit tests for command parsing and message handling logic.
 */
import {
  parseModelIndex,
  parseDirectoryIndex,
  availableModels,
  defaultModel,
} from '../src/utils.js';

describe('Command Parsing', () => {
  describe('/start and /help command', () => {
    it('should match /start command', () => {
      const regex = /\/(start|help)/;
      expect(regex.test('/start')).toBe(true);
      expect(regex.test('/help')).toBe(true);
      expect(regex.test('/other')).toBe(false);
    });
  });

  describe('/dirs command', () => {
    it('should match /dirs command', () => {
      const regex = /\/dirs/;
      expect(regex.test('/dirs')).toBe(true);
      expect(regex.test('/directories')).toBe(false);
    });
  });

  describe('/model command', () => {
    it('should match /model without number', () => {
      const regex = /\/model(?:\s+(\d+))?/;
      const match = '/model'.match(regex);
      expect(match).not.toBeNull();
      expect(match![1]).toBeUndefined();
    });

    it('should match /model with number', () => {
      const regex = /\/model(?:\s+(\d+))?/;
      const match = '/model 5'.match(regex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('5');
    });

    it('should extract model index correctly', () => {
      const regex = /\/model(?:\s+(\d+))?/;
      const match = '/model 12'.match(regex);
      const index = parseModelIndex(match?.[1], availableModels.length);
      expect(index).toBe(11);
    });
  });

  describe('/reset command', () => {
    it('should match /reset command', () => {
      const regex = /\/reset/;
      expect(regex.test('/reset')).toBe(true);
    });
  });

  describe('/status command', () => {
    it('should match /status command', () => {
      const regex = /\/status/;
      expect(regex.test('/status')).toBe(true);
    });
  });
});

describe('Message Handling Logic', () => {
  describe('command detection', () => {
    it('should identify messages starting with /', () => {
      const isCommand = (text: string) => text.startsWith('/');
      expect(isCommand('/start')).toBe(true);
      expect(isCommand('/model 5')).toBe(true);
      expect(isCommand('Hello world')).toBe(false);
      expect(isCommand('What is /start?')).toBe(false);
    });
  });

  describe('prompt validation', () => {
    it('should reject empty messages', () => {
      const isValidPrompt = (text: string | undefined) => {
        return text !== undefined && text.trim().length > 0;
      };
      expect(isValidPrompt('')).toBe(false);
      expect(isValidPrompt('   ')).toBe(false);
      expect(isValidPrompt(undefined)).toBe(false);
      expect(isValidPrompt('Hello')).toBe(true);
    });

    it('should not process command messages as prompts', () => {
      const shouldProcessAsPrompt = (text: string) => {
        return !text.startsWith('/');
      };
      expect(shouldProcessAsPrompt('/start')).toBe(false);
      expect(shouldProcessAsPrompt('Hello copilot')).toBe(true);
    });
  });

  describe('session state validation', () => {
    it('should require active session for prompts', () => {
      const canSendPrompt = (state: { session: any; dir: string | undefined }) => {
        return state.session !== null && state.dir !== undefined;
      };

      expect(canSendPrompt({ session: null, dir: undefined })).toBe(false);
      expect(canSendPrompt({ session: { id: '123' }, dir: undefined })).toBe(false);
      expect(canSendPrompt({ session: null, dir: '/path' })).toBe(false);
      expect(canSendPrompt({ session: { id: '123' }, dir: '/path' })).toBe(true);
    });

    it('should block prompts during reset', () => {
      const canAcceptPrompt = (state: { resetting: boolean }) => {
        return !state.resetting;
      };

      expect(canAcceptPrompt({ resetting: true })).toBe(false);
      expect(canAcceptPrompt({ resetting: false })).toBe(true);
    });
  });
});

describe('Model Selection Logic', () => {
  it('should list all available models with markers', () => {
    const currentModel = 'gpt-5-mini';
    const lines = availableModels.map((model, idx) => {
      const marker = model === currentModel ? '✓ ' : '  ';
      return `${marker}${idx + 1}. ${model}`;
    });

    expect(lines.length).toBe(availableModels.length);
    expect(lines[11]).toContain('✓');
    expect(lines[11]).toContain('gpt-5-mini');
    expect(lines[0]).not.toContain('✓');
  });

  it('should validate model selection range', () => {
    const isValidModelIndex = (input: string) => {
      return parseModelIndex(input, availableModels.length) !== -1;
    };

    expect(isValidModelIndex('1')).toBe(true);
    expect(isValidModelIndex('14')).toBe(true);
    expect(isValidModelIndex('0')).toBe(false);
    expect(isValidModelIndex('15')).toBe(false);
    expect(isValidModelIndex('abc')).toBe(false);
  });
});

describe('Directory Selection Logic', () => {
  const testDirectories = [
    '/home/user/project1',
    '/home/user/project2',
    '/opt/myapp',
  ];

  it('should format directory list correctly', () => {
    const lines = testDirectories.map((dir, idx) => `${idx + 1}. ${dir}`).join('\n');
    expect(lines).toContain('1. /home/user/project1');
    expect(lines).toContain('2. /home/user/project2');
    expect(lines).toContain('3. /opt/myapp');
  });

  it('should validate directory selection range', () => {
    const isValidDirIndex = (input: string) => {
      return parseDirectoryIndex(input, testDirectories.length) !== -1;
    };

    expect(isValidDirIndex('1')).toBe(true);
    expect(isValidDirIndex('3')).toBe(true);
    expect(isValidDirIndex('0')).toBe(false);
    expect(isValidDirIndex('4')).toBe(false);
  });

  it('should handle empty directory list', () => {
    const dirs: string[] = [];
    const isEmpty = dirs.length === 0;
    expect(isEmpty).toBe(true);
    
    const isValidDirIndex = (input: string) => {
      return parseDirectoryIndex(input, dirs.length) !== -1;
    };
    expect(isValidDirIndex('1')).toBe(false);
  });
});

describe('Status Message Formatting', () => {
  interface StatusData {
    hasSession: boolean;
    dir?: string;
    model: string;
    busy: boolean;
    queueLen: number;
    resetting: boolean;
  }

  function formatStatusMessage(data: StatusData): string {
    const activity = data.hasSession ? '正在運行' : '未啟動';
    const dir = data.dir || '未設定';
    const busy = data.busy ? '是' : '否';
    const queueMsg = data.queueLen > 0 
      ? `等待佇列：${data.queueLen} 個任務` 
      : '等待佇列：沒有任務';
    const resetMsg = data.resetting ? '是（將在完成後重新啟動 🔄）' : '否';
    const note = data.busy 
      ? '系統目前忙碌，請稍候。' 
      : '系統閒置，歡迎送出新指令！';

    return `🤖 Copilot Session 狀態報告\n\n狀　　態：${activity}\n工作目錄：${dir}\n模　　型：${data.model}\n忙  碌  中：${busy}\n${queueMsg}\n正在重啟：${resetMsg}\n\n小提醒：${note}`;
  }

  it('should format idle status correctly', () => {
    const msg = formatStatusMessage({
      hasSession: true,
      dir: '/home/user/project',
      model: 'gpt-5-mini',
      busy: false,
      queueLen: 0,
      resetting: false,
    });

    expect(msg).toContain('正在運行');
    expect(msg).toContain('/home/user/project');
    expect(msg).toContain('gpt-5-mini');
    expect(msg).toContain('忙  碌  中：否');
    expect(msg).toContain('沒有任務');
    expect(msg).toContain('歡迎送出新指令');
  });

  it('should format busy status correctly', () => {
    const msg = formatStatusMessage({
      hasSession: true,
      dir: '/home/user/project',
      model: 'claude-sonnet-4',
      busy: true,
      queueLen: 3,
      resetting: false,
    });

    expect(msg).toContain('忙  碌  中：是');
    expect(msg).toContain('3 個任務');
    expect(msg).toContain('請稍候');
  });

  it('should format no session status correctly', () => {
    const msg = formatStatusMessage({
      hasSession: false,
      dir: undefined,
      model: defaultModel,
      busy: false,
      queueLen: 0,
      resetting: false,
    });

    expect(msg).toContain('未啟動');
    expect(msg).toContain('未設定');
  });

  it('should format resetting status correctly', () => {
    const msg = formatStatusMessage({
      hasSession: true,
      dir: '/home/user/project',
      model: 'gpt-5-mini',
      busy: true,
      queueLen: 0,
      resetting: true,
    });

    expect(msg).toContain('是（將在完成後重新啟動 🔄）');
  });
});
