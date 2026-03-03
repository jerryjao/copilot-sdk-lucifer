/**
 * Asana tool definitions for the Copilot SDK Agent.
 * Tools are injected via createSession({ tools: [...buildAsanaTools()] }).
 * If ASANA_ACCESS_TOKEN is not set, an empty array is returned and the
 * tools are silently disabled.
 */
import { defineTool } from '@github/copilot-sdk';
import { asanaGet, asanaPost, asanaPut } from './asana-utils.js';

export function buildAsanaTools() {
  if (!process.env.ASANA_ACCESS_TOKEN) return [];

  return [
    // 1. List workspaces
    defineTool('asana_list_workspaces', {
      description: '列出所有 Asana 工作區。',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        try {
          const result = await asanaGet('/workspaces');
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 2. Search/list projects in a workspace
    defineTool('asana_search_projects', {
      description: '搜尋或列出指定工作區中的專案。',
      parameters: {
        type: 'object',
        properties: {
          workspace_gid: { type: 'string', description: '工作區 GID' },
          archived: { type: 'boolean', description: '是否包含已封存專案（預設 false）' },
          limit: { type: 'number', description: '回傳數量上限（預設 20）' },
        },
        required: ['workspace_gid'],
      },
      handler: async ({ workspace_gid, archived, limit }: { workspace_gid: string; archived?: boolean; limit?: number }) => {
        try {
          const params: Record<string, string> = {};
          if (archived !== undefined) params.archived = String(archived);
          if (limit !== undefined) params.limit = String(limit);
          const result = await asanaGet(`/workspaces/${workspace_gid}/projects`, params);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 3. Get project details
    defineTool('asana_get_project', {
      description: '取得 Asana 專案的詳細資訊。',
      parameters: {
        type: 'object',
        properties: {
          project_gid: { type: 'string', description: '專案 GID' },
        },
        required: ['project_gid'],
      },
      handler: async ({ project_gid }: { project_gid: string }) => {
        try {
          const result = await asanaGet(`/projects/${project_gid}`);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 4. Create project
    defineTool('asana_create_project', {
      description: '在指定工作區中建立新專案。',
      parameters: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: '工作區 GID' },
          name: { type: 'string', description: '專案名稱' },
          notes: { type: 'string', description: '專案描述' },
          team: { type: 'string', description: '團隊 GID（組織工作區必須提供）' },
        },
        required: ['workspace', 'name'],
      },
      handler: async ({ workspace, name, notes, team }: { workspace: string; name: string; notes?: string; team?: string }) => {
        try {
          const body: Record<string, any> = { workspace, name };
          if (notes) body.notes = notes;
          if (team) body.team = team;
          const result = await asanaPost('/projects', body);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 5. Get project sections
    defineTool('asana_get_project_sections', {
      description: '列出專案中的所有區段（section）。',
      parameters: {
        type: 'object',
        properties: {
          project_gid: { type: 'string', description: '專案 GID' },
        },
        required: ['project_gid'],
      },
      handler: async ({ project_gid }: { project_gid: string }) => {
        try {
          const result = await asanaGet(`/projects/${project_gid}/sections`);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 6. Search tasks
    defineTool('asana_search_tasks', {
      description: '搜尋工作區中的任務，可依文字、指派人、到期日等條件篩選。',
      parameters: {
        type: 'object',
        properties: {
          workspace_gid: { type: 'string', description: '工作區 GID' },
          text: { type: 'string', description: '搜尋文字' },
          assignee: { type: 'string', description: '指派人（GID 或 "me"）' },
          completed: { type: 'boolean', description: '是否已完成' },
          due_on_before: { type: 'string', description: '到期日之前（YYYY-MM-DD）' },
          due_on_after: { type: 'string', description: '到期日之後（YYYY-MM-DD）' },
          limit: { type: 'number', description: '回傳數量上限（預設 20）' },
        },
        required: ['workspace_gid'],
      },
      handler: async (p: {
        workspace_gid: string; text?: string; assignee?: string;
        completed?: boolean; due_on_before?: string; due_on_after?: string; limit?: number;
      }) => {
        try {
          const params: Record<string, string> = {};
          if (p.text) params['text'] = p.text;
          if (p.assignee) params['assignee.any'] = p.assignee;
          if (p.completed !== undefined) params['completed'] = String(p.completed);
          if (p.due_on_before) params['due_on.before'] = p.due_on_before;
          if (p.due_on_after) params['due_on.after'] = p.due_on_after;
          if (p.limit !== undefined) params['limit'] = String(p.limit);
          const result = await asanaGet(`/workspaces/${p.workspace_gid}/tasks/search`, params);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 7. Get task details
    defineTool('asana_get_task', {
      description: '取得任務的完整詳細資訊。',
      parameters: {
        type: 'object',
        properties: {
          task_gid: { type: 'string', description: '任務 GID' },
        },
        required: ['task_gid'],
      },
      handler: async ({ task_gid }: { task_gid: string }) => {
        try {
          const result = await asanaGet(`/tasks/${task_gid}`);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 8. Create task
    defineTool('asana_create_task', {
      description: '建立新任務。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '任務名稱' },
          notes: { type: 'string', description: '任務描述' },
          assignee: { type: 'string', description: '指派人（GID 或 "me"）' },
          due_on: { type: 'string', description: '到期日（YYYY-MM-DD）' },
          projects: {
            type: 'array',
            items: { type: 'string' },
            description: '加入的專案 GID 列表',
          },
          workspace: { type: 'string', description: '工作區 GID（若未指定 projects 則必填）' },
        },
        required: ['name'],
      },
      handler: async (p: {
        name: string; notes?: string; assignee?: string;
        due_on?: string; projects?: string[]; workspace?: string;
      }) => {
        try {
          const body: Record<string, any> = { name: p.name };
          if (p.notes) body.notes = p.notes;
          if (p.assignee) body.assignee = p.assignee;
          if (p.due_on) body.due_on = p.due_on;
          if (p.projects) body.projects = p.projects;
          if (p.workspace) body.workspace = p.workspace;
          const result = await asanaPost('/tasks', body);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 9. Update task
    defineTool('asana_update_task', {
      description: '更新現有任務的屬性（名稱、指派人、到期日、完成狀態等）。',
      parameters: {
        type: 'object',
        properties: {
          task_gid: { type: 'string', description: '任務 GID' },
          name: { type: 'string', description: '新任務名稱' },
          notes: { type: 'string', description: '新任務描述' },
          assignee: { type: 'string', description: '新指派人（GID 或 "me"）' },
          due_on: { type: 'string', description: '新到期日（YYYY-MM-DD）' },
          completed: { type: 'boolean', description: '是否標記為完成' },
        },
        required: ['task_gid'],
      },
      handler: async (p: {
        task_gid: string; name?: string; notes?: string;
        assignee?: string; due_on?: string; completed?: boolean;
      }) => {
        try {
          const body: Record<string, any> = {};
          if (p.name !== undefined) body.name = p.name;
          if (p.notes !== undefined) body.notes = p.notes;
          if (p.assignee !== undefined) body.assignee = p.assignee;
          if (p.due_on !== undefined) body.due_on = p.due_on;
          if (p.completed !== undefined) body.completed = p.completed;
          const result = await asanaPut(`/tasks/${p.task_gid}`, body);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 10. Create task comment
    defineTool('asana_create_task_comment', {
      description: '在任務上新增評論。',
      parameters: {
        type: 'object',
        properties: {
          task_gid: { type: 'string', description: '任務 GID' },
          text: { type: 'string', description: '評論內容' },
        },
        required: ['task_gid', 'text'],
      },
      handler: async ({ task_gid, text }: { task_gid: string; text: string }) => {
        try {
          const result = await asanaPost(`/tasks/${task_gid}/stories`, { text });
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 11. Get task stories (activity/comments)
    defineTool('asana_get_task_stories', {
      description: '取得任務的活動記錄與評論。',
      parameters: {
        type: 'object',
        properties: {
          task_gid: { type: 'string', description: '任務 GID' },
        },
        required: ['task_gid'],
      },
      handler: async ({ task_gid }: { task_gid: string }) => {
        try {
          const result = await asanaGet(`/tasks/${task_gid}/stories`);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 12. Find project by name (searches all workspaces)
    defineTool('asana_find_project_by_name', {
      description: '用專案名稱搜尋所有工作區，回傳匹配的專案 GID 與名稱。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '專案名稱（支援部分匹配）' },
        },
        required: ['name'],
      },
      handler: async ({ name }: { name: string }) => {
        try {
          const workspaces = await asanaGet<Array<{ gid: string; name: string }>>('/workspaces');
          const results: Array<{ gid: string; name: string; workspace: string }> = [];
          for (const ws of workspaces) {
            const matches = await asanaGet<Array<{ gid: string; name: string }>>(
              `/workspaces/${ws.gid}/typeahead`,
              { resource_type: 'project', query: name, count: '10' },
            );
            for (const m of matches) {
              results.push({ gid: m.gid, name: m.name, workspace: ws.name });
            }
          }
          if (results.length === 0) {
            return { resultType: 'success' as const, textResultForLlm: `找不到名稱包含「${name}」的專案。` };
          }
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(results, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    // 13. Typeahead search
    defineTool('asana_typeahead_search', {
      description: '在工作區中快速搜尋各類物件（專案、任務、使用者、標籤等）。',
      parameters: {
        type: 'object',
        properties: {
          workspace_gid: { type: 'string', description: '工作區 GID' },
          resource_type: {
            type: 'string',
            description: '搜尋的資源類型（task, project, user, tag）',
          },
          query: { type: 'string', description: '搜尋關鍵字' },
          count: { type: 'number', description: '回傳數量上限（預設 10）' },
        },
        required: ['workspace_gid', 'resource_type', 'query'],
      },
      handler: async (p: { workspace_gid: string; resource_type: string; query: string; count?: number }) => {
        try {
          const params: Record<string, string> = {
            resource_type: p.resource_type,
            query: p.query,
          };
          if (p.count !== undefined) params.count = String(p.count);
          const result = await asanaGet(`/workspaces/${p.workspace_gid}/typeahead`, params);
          return { resultType: 'success' as const, textResultForLlm: JSON.stringify(result, null, 2) };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),
  ];
}
