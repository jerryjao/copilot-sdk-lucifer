/**
 * Unit tests for ChatState management logic.
 */
import {
  pickSessionEmoji,
  parseModelIndex,
  parseDirectoryIndex,
  availableModels,
  sessionEmojis,
  defaultModel,
} from '../src/utils.js';

/**
 * ChatState interface matching the one in index.ts
 */
interface ChatState {
  client: any;
  session: any;
  dir?: string;
  model: string;
  busy: boolean;
  queue: string[];
  resetting: boolean;
  emoji?: string;
}

describe('ChatState Management', () => {
  let chatStates: Map<number, ChatState>;

  beforeEach(() => {
    chatStates = new Map();
  });

  describe('createChatState', () => {
    function createChatState(chatId: number, model?: string): ChatState {
      const usedEmojis = new Set<string>();
      for (const s of chatStates.values()) {
        if (s.emoji) usedEmojis.add(s.emoji);
      }
      const state: ChatState = {
        client: null,
        session: null,
        dir: undefined,
        model: model || defaultModel,
        busy: false,
        queue: [],
        resetting: false,
        emoji: pickSessionEmoji(usedEmojis, sessionEmojis),
      };
      chatStates.set(chatId, state);
      return state;
    }

    it('should create new state with default model', () => {
      const state = createChatState(12345);
      expect(state.model).toBe(defaultModel);
      expect(state.busy).toBe(false);
      expect(state.queue).toEqual([]);
      expect(state.resetting).toBe(false);
      expect(state.emoji).toBeDefined();
    });

    it('should create state with custom model', () => {
      const state = createChatState(12345, 'claude-sonnet-4');
      expect(state.model).toBe('claude-sonnet-4');
    });

    it('should assign different emojis to different chats', () => {
      const state1 = createChatState(111);
      const state2 = createChatState(222);
      const state3 = createChatState(333);
      
      expect(state1.emoji).not.toBe(state2.emoji);
      expect(state2.emoji).not.toBe(state3.emoji);
      expect(state1.emoji).not.toBe(state3.emoji);
    });
  });

  describe('queue management', () => {
    it('should add prompts to queue when busy', () => {
      const state: ChatState = {
        client: null,
        session: { id: 'test' },
        dir: '/test',
        model: defaultModel,
        busy: true,
        queue: [],
        resetting: false,
      };

      state.queue.push('prompt 1');
      state.queue.push('prompt 2');
      
      expect(state.queue.length).toBe(2);
      expect(state.queue[0]).toBe('prompt 1');
    });

    it('should process queue in FIFO order', () => {
      const state: ChatState = {
        client: null,
        session: { id: 'test' },
        dir: '/test',
        model: defaultModel,
        busy: false,
        queue: ['prompt 1', 'prompt 2', 'prompt 3'],
        resetting: false,
      };

      const first = state.queue.shift();
      expect(first).toBe('prompt 1');
      expect(state.queue.length).toBe(2);
      
      const second = state.queue.shift();
      expect(second).toBe('prompt 2');
    });

    it('should clear queue on reset', () => {
      const state: ChatState = {
        client: null,
        session: { id: 'test' },
        dir: '/test',
        model: defaultModel,
        busy: true,
        queue: ['prompt 1', 'prompt 2'],
        resetting: false,
      };

      // Simulate reset
      state.queue = [];
      state.resetting = true;
      state.busy = false;

      expect(state.queue.length).toBe(0);
      expect(state.resetting).toBe(true);
    });
  });

  describe('model selection', () => {
    it('should validate model index correctly', () => {
      expect(parseModelIndex('1', availableModels.length)).toBe(0);
      expect(parseModelIndex('14', availableModels.length)).toBe(13);
      expect(parseModelIndex('15', availableModels.length)).toBe(-1);
      expect(parseModelIndex('0', availableModels.length)).toBe(-1);
    });

    it('should get correct model from index', () => {
      const index = parseModelIndex('1', availableModels.length);
      expect(availableModels[index]).toBe('claude-sonnet-4.5');
      
      const index2 = parseModelIndex('12', availableModels.length);
      expect(availableModels[index2]).toBe('gpt-5-mini');
    });
  });

  describe('state transitions', () => {
    it('should transition from idle to busy when sending prompt', () => {
      const state: ChatState = {
        client: { id: 'client' },
        session: { id: 'session' },
        dir: '/test',
        model: defaultModel,
        busy: false,
        queue: [],
        resetting: false,
      };

      // Simulate sending prompt
      state.busy = true;
      expect(state.busy).toBe(true);
    });

    it('should transition from busy to idle on session.idle event', () => {
      const state: ChatState = {
        client: { id: 'client' },
        session: { id: 'session' },
        dir: '/test',
        model: defaultModel,
        busy: true,
        queue: [],
        resetting: false,
      };

      // Simulate idle event
      state.busy = false;
      expect(state.busy).toBe(false);
    });

    it('should process next queue item when becoming idle', () => {
      const state: ChatState = {
        client: { id: 'client' },
        session: { id: 'session' },
        dir: '/test',
        model: defaultModel,
        busy: true,
        queue: ['next prompt'],
        resetting: false,
      };

      // Simulate idle event with queue processing
      state.busy = false;
      if (state.queue.length > 0) {
        const nextPrompt = state.queue.shift();
        state.busy = true;
        expect(nextPrompt).toBe('next prompt');
        expect(state.busy).toBe(true);
        expect(state.queue.length).toBe(0);
      }
    });
  });

  describe('directory selection', () => {
    it('should validate directory index correctly', () => {
      const dirs = ['/path/a', '/path/b', '/path/c'];
      expect(parseDirectoryIndex('1', dirs.length)).toBe(0);
      expect(parseDirectoryIndex('3', dirs.length)).toBe(2);
      expect(parseDirectoryIndex('4', dirs.length)).toBe(-1);
    });

    it('should update directory when selecting new one', () => {
      const state: ChatState = {
        client: null,
        session: null,
        dir: undefined,
        model: defaultModel,
        busy: false,
        queue: [],
        resetting: false,
      };

      state.dir = '/new/path';
      expect(state.dir).toBe('/new/path');
    });
  });

  describe('multi-chat isolation', () => {
    it('should maintain separate states for different chats', () => {
      chatStates.set(111, {
        client: null,
        session: null,
        dir: '/chat1',
        model: 'gpt-5',
        busy: true,
        queue: ['prompt1'],
        resetting: false,
      });

      chatStates.set(222, {
        client: null,
        session: null,
        dir: '/chat2',
        model: 'claude-sonnet-4',
        busy: false,
        queue: [],
        resetting: false,
      });

      const state1 = chatStates.get(111)!;
      const state2 = chatStates.get(222)!;

      expect(state1.dir).toBe('/chat1');
      expect(state2.dir).toBe('/chat2');
      expect(state1.model).toBe('gpt-5');
      expect(state2.model).toBe('claude-sonnet-4');
      expect(state1.busy).toBe(true);
      expect(state2.busy).toBe(false);
    });

    it('should not affect other chats when modifying one', () => {
      chatStates.set(111, {
        client: null,
        session: null,
        dir: '/chat1',
        model: defaultModel,
        busy: false,
        queue: [],
        resetting: false,
      });

      chatStates.set(222, {
        client: null,
        session: null,
        dir: '/chat2',
        model: defaultModel,
        busy: false,
        queue: [],
        resetting: false,
      });

      // Modify chat 111
      const state1 = chatStates.get(111)!;
      state1.busy = true;
      state1.queue.push('new prompt');

      // Verify chat 222 is unchanged
      const state2 = chatStates.get(222)!;
      expect(state2.busy).toBe(false);
      expect(state2.queue.length).toBe(0);
    });
  });
});

describe('Session Event Handling Logic', () => {
  describe('assistant.message event', () => {
    it('should extract content from event data', () => {
      const event = {
        type: 'assistant.message',
        data: { content: 'Hello from Copilot!' },
      };
      
      expect(event.data.content).toBe('Hello from Copilot!');
    });

    it('should handle missing content gracefully', () => {
      const event = {
        type: 'assistant.message',
        data: {} as { content?: string },
      };
      
      const content = event.data?.content;
      expect(content).toBeUndefined();
    });
  });

  describe('tool.execution_start event', () => {
    it('should extract tool name and params', () => {
      const event = {
        id: 'evt-start-1',
        type: 'tool.execution_start',
        data: {
          toolCallId: 'call-1',
          toolName: 'read_file',
          arguments: { path: '/test/file.ts' },
        },
      };
      
      expect(event.id).toBe('evt-start-1');
      expect(event.data.toolCallId).toBe('call-1');
      expect(event.data.toolName).toBe('read_file');
      expect((event.data as any).arguments.path).toBe('/test/file.ts');
    });
  });

  describe('tool.execution_complete event', () => {
    it('should extract tool call id and results', () => {
      const event = {
        id: 'evt-complete-1',
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-1',
          success: true,
          result: { content: 'file contents' },
        },
      };
      
      expect(event.id).toBe('evt-complete-1');
      expect(event.data.toolCallId).toBe('call-1');
      expect(event.data.result.content).toBe('file contents');
    });
  });

  describe('session.idle event', () => {
    it('should indicate session is ready for next prompt', () => {
      const event = { type: 'session.idle' };
      expect(event.type).toBe('session.idle');
    });
  });
});
