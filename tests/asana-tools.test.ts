/**
 * Unit tests for Asana tool definitions in src/asana-tools.ts.
 * All src/asana-utils.ts API functions are mocked.
 */

import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks (must be registered before dynamic import)
// ---------------------------------------------------------------------------

const mockAsanaGet: any = jest.fn();
const mockAsanaPost: any = jest.fn();
const mockAsanaPut: any = jest.fn();

jest.unstable_mockModule('../src/asana-utils.js', () => ({
  asanaGet: mockAsanaGet,
  asanaPost: mockAsanaPost,
  asanaPut: mockAsanaPut,
}));

// Mock @github/copilot-sdk so defineTool just stores and returns the definition
jest.unstable_mockModule('@github/copilot-sdk', () => ({
  defineTool: jest.fn((name: string, def: any) => ({ name, ...def })),
}));

// Dynamic import AFTER mocks are registered
let buildAsanaTools: any;

beforeAll(async () => {
  const tools = await import('../src/asana-tools.js');
  buildAsanaTools = tools.buildAsanaTools;
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getHandler(tools: any[], toolName: string): (params: any) => Promise<any> {
  const tool = tools.find((t: any) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAsanaTools', () => {
  describe('when ASANA_ACCESS_TOKEN is not set', () => {
    it('應回傳空陣列', () => {
      const saved = process.env.ASANA_ACCESS_TOKEN;
      delete process.env.ASANA_ACCESS_TOKEN;
      const tools = buildAsanaTools();
      expect(tools).toEqual([]);
      if (saved !== undefined) process.env.ASANA_ACCESS_TOKEN = saved;
    });
  });

  describe('when ASANA_ACCESS_TOKEN is set', () => {
    beforeEach(() => {
      process.env.ASANA_ACCESS_TOKEN = 'fake-asana-token';
      mockAsanaGet.mockReset();
      mockAsanaPost.mockReset();
      mockAsanaPut.mockReset();
    });

    it('應回傳 13 個工具', () => {
      const tools = buildAsanaTools();
      expect(tools).toHaveLength(13);
    });

    it('所有工具都有正確的名稱', () => {
      const tools = buildAsanaTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toEqual([
        'asana_list_workspaces',
        'asana_search_projects',
        'asana_get_project',
        'asana_create_project',
        'asana_get_project_sections',
        'asana_search_tasks',
        'asana_get_task',
        'asana_create_task',
        'asana_update_task',
        'asana_create_task_comment',
        'asana_get_task_stories',
        'asana_find_project_by_name',
        'asana_typeahead_search',
      ]);
    });

    // -----------------------------------------------------------------------
    // asana_list_workspaces
    // -----------------------------------------------------------------------

    describe('asana_list_workspaces handler', () => {
      it('成功回傳工作區列表', async () => {
        mockAsanaGet.mockResolvedValue([{ gid: '1', name: 'My Workspace' }]);
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_list_workspaces');
        const result = await handler({});
        expect(result.resultType).toBe('success');
        expect(result.textResultForLlm).toContain('My Workspace');
      });

      it('API 錯誤應回傳 failure', async () => {
        mockAsanaGet.mockRejectedValue(new Error('401 Unauthorized'));
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_list_workspaces');
        const result = await handler({});
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('401');
      });
    });

    // -----------------------------------------------------------------------
    // asana_search_projects
    // -----------------------------------------------------------------------

    describe('asana_search_projects handler', () => {
      it('成功搜尋專案', async () => {
        mockAsanaGet.mockResolvedValue([{ gid: '10', name: 'Project A' }]);
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_search_projects');
        const result = await handler({ workspace_gid: 'ws1' });
        expect(result.resultType).toBe('success');
        expect(mockAsanaGet).toHaveBeenCalledWith('/workspaces/ws1/projects', {});
      });
    });

    // -----------------------------------------------------------------------
    // asana_get_task
    // -----------------------------------------------------------------------

    describe('asana_get_task handler', () => {
      it('成功取得任務詳情', async () => {
        mockAsanaGet.mockResolvedValue({ gid: '100', name: 'My Task' });
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_get_task');
        const result = await handler({ task_gid: '100' });
        expect(result.resultType).toBe('success');
        expect(result.textResultForLlm).toContain('My Task');
      });

      it('API 錯誤應回傳 failure', async () => {
        mockAsanaGet.mockRejectedValue(new Error('404 Not Found'));
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_get_task');
        const result = await handler({ task_gid: 'bad' });
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('404');
      });
    });

    // -----------------------------------------------------------------------
    // asana_create_task
    // -----------------------------------------------------------------------

    describe('asana_create_task handler', () => {
      it('成功建立任務', async () => {
        mockAsanaPost.mockResolvedValue({ gid: '200', name: 'New Task' });
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_create_task');
        const result = await handler({ name: 'New Task', workspace: 'ws1' });
        expect(result.resultType).toBe('success');
        expect(mockAsanaPost).toHaveBeenCalledWith('/tasks', { name: 'New Task', workspace: 'ws1' });
      });

      it('API 錯誤應回傳 failure', async () => {
        mockAsanaPost.mockRejectedValue(new Error('400 Bad Request'));
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_create_task');
        const result = await handler({ name: '' });
        expect(result.resultType).toBe('failure');
      });
    });

    // -----------------------------------------------------------------------
    // asana_update_task
    // -----------------------------------------------------------------------

    describe('asana_update_task handler', () => {
      it('成功更新任務', async () => {
        mockAsanaPut.mockResolvedValue({ gid: '100', completed: true });
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_update_task');
        const result = await handler({ task_gid: '100', completed: true });
        expect(result.resultType).toBe('success');
        expect(mockAsanaPut).toHaveBeenCalledWith('/tasks/100', { completed: true });
      });
    });

    // -----------------------------------------------------------------------
    // asana_create_task_comment
    // -----------------------------------------------------------------------

    describe('asana_create_task_comment handler', () => {
      it('成功新增評論', async () => {
        mockAsanaPost.mockResolvedValue({ gid: '300', text: 'Nice!' });
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_create_task_comment');
        const result = await handler({ task_gid: '100', text: 'Nice!' });
        expect(result.resultType).toBe('success');
        expect(mockAsanaPost).toHaveBeenCalledWith('/tasks/100/stories', { text: 'Nice!' });
      });
    });

    // -----------------------------------------------------------------------
    // asana_find_project_by_name
    // -----------------------------------------------------------------------

    describe('asana_find_project_by_name handler', () => {
      it('成功在多個工作區中找到匹配專案', async () => {
        mockAsanaGet
          .mockResolvedValueOnce([{ gid: 'ws1', name: 'Workspace A' }, { gid: 'ws2', name: 'Workspace B' }])
          .mockResolvedValueOnce([{ gid: 'p1', name: 'Marketing Plan' }])
          .mockResolvedValueOnce([{ gid: 'p2', name: 'Marketing Campaign' }]);
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_find_project_by_name');
        const result = await handler({ name: 'Marketing' });
        expect(result.resultType).toBe('success');
        const parsed = JSON.parse(result.textResultForLlm);
        expect(parsed).toHaveLength(2);
        expect(parsed[0]).toEqual({ gid: 'p1', name: 'Marketing Plan', workspace: 'Workspace A' });
        expect(parsed[1]).toEqual({ gid: 'p2', name: 'Marketing Campaign', workspace: 'Workspace B' });
      });

      it('找不到專案時回傳提示訊息', async () => {
        mockAsanaGet
          .mockResolvedValueOnce([{ gid: 'ws1', name: 'Workspace A' }])
          .mockResolvedValueOnce([]);
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_find_project_by_name');
        const result = await handler({ name: 'NonExistent' });
        expect(result.resultType).toBe('success');
        expect(result.textResultForLlm).toContain('找不到');
        expect(result.textResultForLlm).toContain('NonExistent');
      });

      it('API 錯誤應回傳 failure', async () => {
        mockAsanaGet.mockRejectedValue(new Error('500 Internal Server Error'));
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_find_project_by_name');
        const result = await handler({ name: 'Test' });
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('500');
      });
    });

    // -----------------------------------------------------------------------
    // asana_typeahead_search
    // -----------------------------------------------------------------------

    describe('asana_typeahead_search handler', () => {
      it('成功搜尋', async () => {
        mockAsanaGet.mockResolvedValue([{ gid: '50', name: 'Found' }]);
        const tools = buildAsanaTools();
        const handler = getHandler(tools, 'asana_typeahead_search');
        const result = await handler({ workspace_gid: 'ws1', resource_type: 'task', query: 'test' });
        expect(result.resultType).toBe('success');
        expect(mockAsanaGet).toHaveBeenCalledWith('/workspaces/ws1/typeahead', {
          resource_type: 'task',
          query: 'test',
        });
      });
    });
  });
});
