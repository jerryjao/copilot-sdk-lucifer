/**
 * Unit tests for Google Drive API utility functions in src/utils.ts.
 * All googleapis calls are mocked — no real network requests are made.
 */

import { jest, describe, it, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock googleapis (must be registered before dynamic import of utils)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDocumentsGet: any = jest.fn();
const mockPresentationsGet: any = jest.fn();
const mockSpreadsheetsGet: any = jest.fn();
const mockDriveFilesGet: any = jest.fn();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    docs: jest.fn().mockReturnValue({
      documents: { get: mockDocumentsGet },
    }),
    slides: jest.fn().mockReturnValue({
      presentations: { get: mockPresentationsGet },
    }),
    sheets: jest.fn().mockReturnValue({
      spreadsheets: { get: mockSpreadsheetsGet },
    }),
    drive: jest.fn().mockReturnValue({
      files: { get: mockDriveFilesGet },
    }),
  },
}));

// Dynamic import AFTER mocks are registered
let extractGoogleFileInfo: any;
let fetchGoogleDocContent: any;
let fetchGoogleSlidesContent: any;
let fetchGoogleSheetsContent: any;
let fetchGoogleDriveImageBuffer: any;
let _resetGoogleOAuthClient: any;

beforeAll(async () => {
  const utils = await import('../src/utils.js');
  extractGoogleFileInfo = utils.extractGoogleFileInfo;
  fetchGoogleDocContent = utils.fetchGoogleDocContent;
  fetchGoogleSlidesContent = utils.fetchGoogleSlidesContent;
  fetchGoogleSheetsContent = utils.fetchGoogleSheetsContent;
  fetchGoogleDriveImageBuffer = utils.fetchGoogleDriveImageBuffer;
  _resetGoogleOAuthClient = utils._resetGoogleOAuthClient;
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeGaxiosError(status: number): Error {
  const err = new Error(`Request failed with status ${status}`) as any;
  err.response = { status };
  err.status = status;
  return err;
}

// ---------------------------------------------------------------------------
// A. extractGoogleFileInfo
// ---------------------------------------------------------------------------

describe('extractGoogleFileInfo', () => {
  it('應解析 Google Docs 編輯 URL', () => {
    expect(extractGoogleFileInfo('https://docs.google.com/document/d/DOC123/edit'))
      .toEqual({ type: 'doc', id: 'DOC123' });
  });

  it('應解析帶 ?usp=sharing 的 Docs 分享 URL', () => {
    expect(extractGoogleFileInfo('https://docs.google.com/document/d/DOC456/edit?usp=sharing'))
      .toEqual({ type: 'doc', id: 'DOC456' });
  });

  it('應解析 Google Slides URL', () => {
    expect(extractGoogleFileInfo('https://docs.google.com/presentation/d/SLIDE789/edit'))
      .toEqual({ type: 'slide', id: 'SLIDE789' });
  });

  it('應解析 Google Sheets URL', () => {
    expect(extractGoogleFileInfo('https://docs.google.com/spreadsheets/d/SHEET001/edit'))
      .toEqual({ type: 'sheet', id: 'SHEET001' });
  });

  it('應解析 drive.google.com/file/d/ URL', () => {
    expect(extractGoogleFileInfo('https://drive.google.com/file/d/IMG999/view'))
      .toEqual({ type: 'drive', id: 'IMG999' });
  });

  it('應解析 drive.google.com/open?id= URL', () => {
    expect(extractGoogleFileInfo('https://drive.google.com/open?id=ABC123'))
      .toEqual({ type: 'drive', id: 'ABC123' });
  });

  it('非 Google URL 應回傳 null', () => {
    expect(extractGoogleFileInfo('https://github.com/user/repo')).toBeNull();
  });

  it('Sheets URL 不應被解析為 doc', () => {
    const r = extractGoogleFileInfo('https://docs.google.com/spreadsheets/d/X/edit');
    expect(r?.type).toBe('sheet');
  });

  it('純 ID（非 URL）應回傳 null', () => {
    expect(extractGoogleFileInfo('DOC123')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. fetchGoogleDocContent
// ---------------------------------------------------------------------------

describe('fetchGoogleDocContent', () => {
  const originalToken = process.env.GOOGLE_REFRESH_TOKEN;

  beforeEach(() => {
    process.env.GOOGLE_REFRESH_TOKEN = 'fake-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
    _resetGoogleOAuthClient();
    mockDocumentsGet.mockReset();
  });

  afterAll(() => {
    if (originalToken !== undefined) {
      process.env.GOOGLE_REFRESH_TOKEN = originalToken;
    } else {
      delete process.env.GOOGLE_REFRESH_TOKEN;
    }
  });

  it('應回傳文件標題與段落文字', async () => {
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: '測試文件',
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                elements: [{ textRun: { content: '這是段落內容。' } }],
              },
            },
          ],
        },
      },
    });
    const result = await fetchGoogleDocContent('DOC123');
    expect(result).toContain('測試文件');
    expect(result).toContain('這是段落內容。');
  });

  it('HEADING_1 應被標記為 # 前綴', async () => {
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: '文件',
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_1' },
                elements: [{ textRun: { content: '大標題' } }],
              },
            },
          ],
        },
      },
    });
    const result = await fetchGoogleDocContent('DOC123');
    expect(result).toContain('# 大標題');
  });

  it('HEADING_2 應被標記為 ## 前綴', async () => {
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: '文件',
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_2' },
                elements: [{ textRun: { content: '小標題' } }],
              },
            },
          ],
        },
      },
    });
    const result = await fetchGoogleDocContent('DOC123');
    expect(result).toContain('## 小標題');
  });

  it('空段落應略過不輸出', async () => {
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: '文件',
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                elements: [{ textRun: { content: '' } }],
              },
            },
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                elements: [{ textRun: { content: '\n' } }],
              },
            },
          ],
        },
      },
    });
    const result = await fetchGoogleDocContent('DOC123');
    expect(result.split('\n').filter((l: string) => l === '').length).toBeLessThan(3);
  });

  it('403 應拋出含說明的錯誤', async () => {
    mockDocumentsGet.mockRejectedValue(makeGaxiosError(403));
    await expect(fetchGoogleDocContent('DENIED')).rejects.toThrow(/403/);
  });

  it('404 應拋出找不到文件的錯誤', async () => {
    mockDocumentsGet.mockRejectedValue(makeGaxiosError(404));
    await expect(fetchGoogleDocContent('MISSING')).rejects.toThrow(/404/);
  });

  it('429 應拋出頻率超限錯誤', async () => {
    mockDocumentsGet.mockRejectedValue(makeGaxiosError(429));
    await expect(fetchGoogleDocContent('ANY')).rejects.toThrow(/頻率超限/);
  });

  it('未設定 GOOGLE_REFRESH_TOKEN 應拋出錯誤', async () => {
    delete process.env.GOOGLE_REFRESH_TOKEN;
    _resetGoogleOAuthClient();
    await expect(fetchGoogleDocContent('ANY')).rejects.toThrow(/GOOGLE_REFRESH_TOKEN/);
  });
});

// ---------------------------------------------------------------------------
// C. fetchGoogleSlidesContent
// ---------------------------------------------------------------------------

describe('fetchGoogleSlidesContent', () => {
  beforeEach(() => {
    process.env.GOOGLE_REFRESH_TOKEN = 'fake-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
    _resetGoogleOAuthClient();
    mockPresentationsGet.mockReset();
  });

  it('應回傳簡報標題與每頁文字（附頁碼）', async () => {
    mockPresentationsGet.mockResolvedValue({
      data: {
        title: '季度報告',
        slides: [
          {
            pageElements: [
              {
                shape: {
                  text: {
                    textElements: [
                      { textRun: { content: '第一頁標題\n' } },
                      { textRun: { content: '內容說明\n' } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    });
    const result = await fetchGoogleSlidesContent('SLIDE123');
    expect(result).toContain('季度報告');
    expect(result).toContain('Slide 1');
    expect(result).toContain('第一頁標題');
    expect(result).toContain('內容說明');
  });

  it('多頁簡報應包含所有頁面', async () => {
    mockPresentationsGet.mockResolvedValue({
      data: {
        title: '多頁簡報',
        slides: [
          { pageElements: [{ shape: { text: { textElements: [{ textRun: { content: '第1頁\n' } }] } } }] },
          { pageElements: [{ shape: { text: { textElements: [{ textRun: { content: '第2頁\n' } }] } } }] },
          { pageElements: [{ shape: { text: { textElements: [{ textRun: { content: '第3頁\n' } }] } } }] },
        ],
      },
    });
    const result = await fetchGoogleSlidesContent('SLIDE123');
    expect(result).toContain('Slide 3');
  });

  it('空白頁（無 pageElements）應略過不拋出錯誤', async () => {
    mockPresentationsGet.mockResolvedValue({
      data: {
        title: '空白簡報',
        slides: [{}, { pageElements: [] }],
      },
    });
    await expect(fetchGoogleSlidesContent('EMPTY')).resolves.not.toThrow();
  });

  it('403 應拋出含說明的錯誤', async () => {
    mockPresentationsGet.mockRejectedValue(makeGaxiosError(403));
    await expect(fetchGoogleSlidesContent('DENIED')).rejects.toThrow(/403/);
  });
});

// ---------------------------------------------------------------------------
// D. fetchGoogleSheetsContent
// ---------------------------------------------------------------------------

describe('fetchGoogleSheetsContent', () => {
  beforeEach(() => {
    process.env.GOOGLE_REFRESH_TOKEN = 'fake-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
    _resetGoogleOAuthClient();
    mockSpreadsheetsGet.mockReset();
  });

  it('應回傳試算表標題與資料（tab 分隔）', async () => {
    mockSpreadsheetsGet.mockResolvedValue({
      data: {
        properties: { title: '銷售報表' },
        sheets: [
          {
            properties: { title: '工作表1' },
            data: [{
              rowData: [
                { values: [{ formattedValue: '姓名' }, { formattedValue: '金額' }] },
                { values: [{ formattedValue: '王小明' }, { formattedValue: '5000' }] },
              ],
            }],
          },
        ],
      },
    });
    const result = await fetchGoogleSheetsContent('SHEET123');
    expect(result).toContain('銷售報表');
    expect(result).toContain('工作表1');
    expect(result).toContain('姓名\t金額');
    expect(result).toContain('王小明\t5000');
  });

  it('多個工作表應全部包含', async () => {
    mockSpreadsheetsGet.mockResolvedValue({
      data: {
        properties: { title: '多工作表' },
        sheets: [
          { properties: { title: 'Sheet A' }, data: [{ rowData: [] }] },
          { properties: { title: 'Sheet B' }, data: [{ rowData: [] }] },
        ],
      },
    });
    const result = await fetchGoogleSheetsContent('MULTI');
    expect(result).toContain('Sheet A');
    expect(result).toContain('Sheet B');
  });

  it('空工作表不應拋出錯誤', async () => {
    mockSpreadsheetsGet.mockResolvedValue({
      data: {
        properties: { title: '空表' },
        sheets: [{ properties: { title: 'Empty' }, data: [] }],
      },
    });
    await expect(fetchGoogleSheetsContent('EMPTY')).resolves.not.toThrow();
  });

  it('403 應拋出含說明的錯誤', async () => {
    mockSpreadsheetsGet.mockRejectedValue(makeGaxiosError(403));
    await expect(fetchGoogleSheetsContent('DENIED')).rejects.toThrow(/403/);
  });
});

// ---------------------------------------------------------------------------
// E. fetchGoogleDriveImageBuffer
// ---------------------------------------------------------------------------

describe('fetchGoogleDriveImageBuffer', () => {
  beforeEach(() => {
    process.env.GOOGLE_REFRESH_TOKEN = 'fake-refresh-token';
    process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
    _resetGoogleOAuthClient();
    mockDriveFilesGet.mockReset();
  });

  it('image/jpeg 類型應回傳 Buffer', async () => {
    mockDriveFilesGet
      .mockResolvedValueOnce({ data: { mimeType: 'image/jpeg' } })
      .mockResolvedValueOnce({ data: Buffer.from('fake-jpeg-data') });
    const buf = await fetchGoogleDriveImageBuffer('IMG001');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('image/png 類型應回傳 Buffer', async () => {
    mockDriveFilesGet
      .mockResolvedValueOnce({ data: { mimeType: 'image/png' } })
      .mockResolvedValueOnce({ data: Buffer.from('fake-png-data') });
    const buf = await fetchGoogleDriveImageBuffer('PNG001');
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('非圖片（application/pdf）應拋出含類型說明的錯誤', async () => {
    mockDriveFilesGet.mockResolvedValueOnce({ data: { mimeType: 'application/pdf' } });
    await expect(fetchGoogleDriveImageBuffer('PDF001')).rejects.toThrow(/不是圖片/);
  });

  it('未設定 GOOGLE_REFRESH_TOKEN 應拋出錯誤', async () => {
    delete process.env.GOOGLE_REFRESH_TOKEN;
    _resetGoogleOAuthClient();
    await expect(fetchGoogleDriveImageBuffer('ANY')).rejects.toThrow(/GOOGLE_REFRESH_TOKEN/);
  });
});
