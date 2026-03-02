/**
 * Google Drive tool definitions for the Copilot SDK Agent.
 * Tools are injected via createSession({ tools: buildGdriveTools() }).
 * If GOOGLE_REFRESH_TOKEN is not set, an empty array is returned and the
 * tools are silently disabled.
 */
import { defineTool } from '@github/copilot-sdk';
import {
  extractGoogleFileInfo,
  fetchGoogleDocContent,
  fetchGoogleSlidesContent,
  fetchGoogleSheetsContent,
  fetchGoogleDriveImageBuffer,
} from './utils.js';

export function buildGdriveTools() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return [];

  return [
    defineTool('gdrive_read_document', {
      description: '讀取 Google Docs 文件的完整文字內容。接受完整 URL 或文件 ID。',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'Google Docs 文件 ID 或完整 URL',
          },
        },
        required: ['document_id'],
      },
      handler: async ({ document_id }: { document_id: string }) => {
        const info = extractGoogleFileInfo(document_id);
        const id = info?.id ?? document_id;
        try {
          return await fetchGoogleDocContent(id);
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    defineTool('gdrive_read_slides', {
      description: '讀取 Google Slides 簡報的文字內容，包含每頁的文字和頁碼。接受完整 URL 或簡報 ID。',
      parameters: {
        type: 'object',
        properties: {
          presentation_id: {
            type: 'string',
            description: 'Google Slides 簡報 ID 或完整 URL',
          },
        },
        required: ['presentation_id'],
      },
      handler: async ({ presentation_id }: { presentation_id: string }) => {
        const info = extractGoogleFileInfo(presentation_id);
        const id = info?.id ?? presentation_id;
        try {
          return await fetchGoogleSlidesContent(id);
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    defineTool('gdrive_read_spreadsheet', {
      description: '讀取 Google Sheets 試算表的資料，以 Tab 分隔格式回傳。接受完整 URL 或試算表 ID。',
      parameters: {
        type: 'object',
        properties: {
          spreadsheet_id: {
            type: 'string',
            description: 'Google Sheets 試算表 ID 或完整 URL',
          },
        },
        required: ['spreadsheet_id'],
      },
      handler: async ({ spreadsheet_id }: { spreadsheet_id: string }) => {
        const info = extractGoogleFileInfo(spreadsheet_id);
        const id = info?.id ?? spreadsheet_id;
        try {
          return await fetchGoogleSheetsContent(id);
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),

    defineTool('gdrive_get_image', {
      description: 'Download an image file from Google Drive and provide it to the AI for analysis. Accepts a full URL or file ID.',
      parameters: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: 'Google Drive 圖片 ID 或完整 URL',
          },
        },
        required: ['file_id'],
      },
      handler: async ({ file_id }: { file_id: string }) => {
        const info = extractGoogleFileInfo(file_id);
        const id = info?.id ?? file_id;
        try {
          const buffer = await fetchGoogleDriveImageBuffer(id);
          return {
            resultType: 'success' as const,
            textResultForLlm: '圖片已成功下載。',
            binaryResultsForLlm: [{
              mimeType: 'image/jpeg',
              data: buffer.toString('base64'),
            }],
          };
        } catch (err) {
          return { resultType: 'failure' as const, textResultForLlm: '', error: (err as Error).message };
        }
      },
    }),
  ];
}
