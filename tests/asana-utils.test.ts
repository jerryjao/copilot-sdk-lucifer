/**
 * Unit tests for Asana REST API client in src/asana-utils.ts.
 * Global fetch is mocked to avoid real HTTP calls.
 */

import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

let asanaGet: any;
let asanaPost: any;
let asanaPut: any;
let asanaFetch: any;

beforeAll(async () => {
  const mod = await import('../src/asana-utils.js');
  asanaGet = mod.asanaGet;
  asanaPost = mod.asanaPost;
  asanaPut = mod.asanaPut;
  asanaFetch = mod.asanaFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.ASANA_ACCESS_TOKEN = 'test-token-123';
});

// Helper to create a mock Response
function mockResponse(data: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => ({ data }),
    text: async () => JSON.stringify({ data }),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic',
    url: '',
    clone: () => mockResponse(data, ok, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    bytes: async () => new Uint8Array(),
  } as Response;
}

describe('asanaFetch', () => {
  it('should include Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValue(mockResponse({ gid: '123' }));
    await asanaFetch('/workspaces');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/workspaces',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token-123',
        }),
      }),
    );
  });

  it('should unwrap { data: ... } from response', async () => {
    mockFetch.mockResolvedValue(mockResponse([{ gid: '1', name: 'WS' }]));
    const result = await asanaFetch('/workspaces');
    expect(result).toEqual([{ gid: '1', name: 'WS' }]);
  });

  it('should throw if ASANA_ACCESS_TOKEN is not set', async () => {
    delete process.env.ASANA_ACCESS_TOKEN;
    await expect(asanaFetch('/workspaces')).rejects.toThrow('ASANA_ACCESS_TOKEN is not set');
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue(mockResponse(null, false, 401));
    await expect(asanaFetch('/workspaces')).rejects.toThrow('Asana API error 401');
  });
});

describe('asanaGet', () => {
  it('should append query params to URL', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await asanaGet('/workspaces/123/projects', { limit: '5', archived: 'false' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=5');
    expect(calledUrl).toContain('archived=false');
  });

  it('should use GET method', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await asanaGet('/workspaces');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('asanaPost', () => {
  it('should send POST with JSON body wrapped in { data: ... }', async () => {
    mockFetch.mockResolvedValue(mockResponse({ gid: '999' }));
    await asanaPost('/tasks', { name: 'Test' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { name: 'Test' } }),
      }),
    );
  });
});

describe('asanaPut', () => {
  it('should send PUT with JSON body wrapped in { data: ... }', async () => {
    mockFetch.mockResolvedValue(mockResponse({ gid: '999' }));
    await asanaPut('/tasks/999', { completed: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks/999',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ data: { completed: true } }),
      }),
    );
  });
});
