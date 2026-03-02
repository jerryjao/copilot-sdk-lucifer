/**
 * Unit tests for Google Drive tool handlers in src/tools.ts.
 * All src/utils.ts Google API functions are mocked.
 */

import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks (must be registered before dynamic import)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetchGoogleDocContent: any = jest.fn();
const mockFetchGoogleSlidesContent: any = jest.fn();
const mockFetchGoogleSheetsContent: any = jest.fn();
const mockFetchGoogleDriveImageBuffer: any = jest.fn();
const mockExtractGoogleFileInfo: any = jest.fn();

jest.unstable_mockModule('../src/utils.js', () => ({
  extractGoogleFileInfo: mockExtractGoogleFileInfo,
  fetchGoogleDocContent: mockFetchGoogleDocContent,
  fetchGoogleSlidesContent: mockFetchGoogleSlidesContent,
  fetchGoogleSheetsContent: mockFetchGoogleSheetsContent,
  fetchGoogleDriveImageBuffer: mockFetchGoogleDriveImageBuffer,
}));

// Mock @github/copilot-sdk so defineTool just stores and returns the definition
jest.unstable_mockModule('@github/copilot-sdk', () => ({
  defineTool: jest.fn((name: string, def: any) => ({ name, ...def })),
}));

// Dynamic import AFTER mocks are registered
let buildGdriveTools: any;

beforeAll(async () => {
  const tools = await import('../src/tools.js');
  buildGdriveTools = tools.buildGdriveTools;
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

describe('buildGdriveTools', () => {
  describe('when GOOGLE_REFRESH_TOKEN is not set', () => {
    it('應回傳空陣列', () => {
      const saved = process.env.GOOGLE_REFRESH_TOKEN;
      delete process.env.GOOGLE_REFRESH_TOKEN;
      const tools = buildGdriveTools();
      expect(tools).toEqual([]);
      if (saved !== undefined) process.env.GOOGLE_REFRESH_TOKEN = saved;
    });
  });

  describe('when GOOGLE_REFRESH_TOKEN is set', () => {
    beforeEach(() => {
      process.env.GOOGLE_REFRESH_TOKEN = 'fake-token';
      mockExtractGoogleFileInfo.mockReset();
      mockFetchGoogleDocContent.mockReset();
      mockFetchGoogleSlidesContent.mockReset();
      mockFetchGoogleSheetsContent.mockReset();
      mockFetchGoogleDriveImageBuffer.mockReset();
    });

    it('應回傳 4 個工具', () => {
      const tools = buildGdriveTools();
      expect(tools).toHaveLength(4);
    });

    // -----------------------------------------------------------------------
    // gdrive_read_document
    // -----------------------------------------------------------------------

    describe('gdrive_read_document handler', () => {
      it('接受完整 URL，提取 ID 後呼叫 fetchGoogleDocContent', async () => {
        mockExtractGoogleFileInfo.mockReturnValue({ type: 'doc', id: 'DOC123' });
        mockFetchGoogleDocContent.mockResolvedValue('文件內容');
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_document');
        const result = await handler({ document_id: 'https://docs.google.com/document/d/DOC123/edit' });
        expect(mockFetchGoogleDocContent).toHaveBeenCalledWith('DOC123');
        expect(result).toContain('文件內容');
      });

      it('接受純 ID（不含 URL）', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleDocContent.mockResolvedValue('直接用 ID');
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_document');
        const result = await handler({ document_id: 'RAWID123' });
        expect(mockFetchGoogleDocContent).toHaveBeenCalledWith('RAWID123');
        expect(result).toContain('直接用 ID');
      });

      it('API 錯誤應回傳 failure 類型的 ToolResultObject', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleDocContent.mockRejectedValue(new Error('403 Access denied'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_document');
        const result = await handler({ document_id: 'BAD' });
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('403');
      });
    });

    // -----------------------------------------------------------------------
    // gdrive_read_slides
    // -----------------------------------------------------------------------

    describe('gdrive_read_slides handler', () => {
      it('接受 Slides URL 並回傳文字', async () => {
        mockExtractGoogleFileInfo.mockReturnValue({ type: 'slide', id: 'SLIDE123' });
        mockFetchGoogleSlidesContent.mockResolvedValue('簡報內容');
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_slides');
        const result = await handler({
          presentation_id: 'https://docs.google.com/presentation/d/SLIDE123/edit',
        });
        expect(mockFetchGoogleSlidesContent).toHaveBeenCalledWith('SLIDE123');
        expect(result).toContain('簡報內容');
      });

      it('API 錯誤應回傳 failure 類型', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleSlidesContent.mockRejectedValue(new Error('403 Forbidden'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_slides');
        const result = await handler({ presentation_id: 'BAD' });
        expect(result.resultType).toBe('failure');
      });
    });

    // -----------------------------------------------------------------------
    // gdrive_read_spreadsheet
    // -----------------------------------------------------------------------

    describe('gdrive_read_spreadsheet handler', () => {
      it('接受 Sheets URL 並回傳表格', async () => {
        mockExtractGoogleFileInfo.mockReturnValue({ type: 'sheet', id: 'SHEET123' });
        mockFetchGoogleSheetsContent.mockResolvedValue('表格資料');
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_spreadsheet');
        const result = await handler({
          spreadsheet_id: 'https://docs.google.com/spreadsheets/d/SHEET123/edit',
        });
        expect(mockFetchGoogleSheetsContent).toHaveBeenCalledWith('SHEET123');
        expect(result).toContain('表格資料');
      });

      it('API 錯誤應回傳 failure 類型', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleSheetsContent.mockRejectedValue(new Error('404 Not Found'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_read_spreadsheet');
        const result = await handler({ spreadsheet_id: 'MISSING' });
        expect(result.resultType).toBe('failure');
      });
    });

    // -----------------------------------------------------------------------
    // gdrive_get_image
    // -----------------------------------------------------------------------

    describe('gdrive_get_image handler', () => {
      it('下載圖片並回傳帶 binaryResultsForLlm 的 ToolResultObject', async () => {
        mockExtractGoogleFileInfo.mockReturnValue({ type: 'drive', id: 'IMG001' });
        mockFetchGoogleDriveImageBuffer.mockResolvedValue(Buffer.from('fake-img'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_get_image');
        const result = await handler({ file_id: 'IMG001' });
        expect(result.resultType).toBe('success');
        expect(result.binaryResultsForLlm).toBeDefined();
        expect(result.binaryResultsForLlm[0].mimeType).toMatch(/^image\//);
        expect(result.binaryResultsForLlm[0].data).toBeDefined();
      });

      it('接受純 ID（不含 URL）', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleDriveImageBuffer.mockResolvedValue(Buffer.from('img-data'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_get_image');
        await handler({ file_id: 'RAWIMGID' });
        expect(mockFetchGoogleDriveImageBuffer).toHaveBeenCalledWith('RAWIMGID');
      });

      it('API 錯誤應回傳 failure 類型', async () => {
        mockExtractGoogleFileInfo.mockReturnValue(null);
        mockFetchGoogleDriveImageBuffer.mockRejectedValue(new Error('不是圖片'));
        const tools = buildGdriveTools();
        const handler = getHandler(tools, 'gdrive_get_image');
        const result = await handler({ file_id: 'BAD' });
        expect(result.resultType).toBe('failure');
        expect(result.error).toContain('不是圖片');
      });
    });
  });
});
