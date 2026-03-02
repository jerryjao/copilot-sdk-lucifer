/**
 * 真實 Google Drive 連線測試腳本
 * 執行方式: node scripts/test-gdrive-connection.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 手動載入 .env
const envPath = resolve(__dirname, '../.env');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=\s]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const { google } = await import('googleapis');

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

if (!GOOGLE_REFRESH_TOKEN) {
  console.error('❌ GOOGLE_REFRESH_TOKEN 未設定');
  process.exit(1);
}

console.log('🔑 憑證載入完成');
console.log(`   CLIENT_ID: ${GOOGLE_CLIENT_ID?.slice(0, 20)}...`);
console.log(`   REFRESH_TOKEN: ${GOOGLE_REFRESH_TOKEN?.slice(0, 20)}...`);
console.log('');

const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

// 1. 取得 Access Token
console.log('⏳ 測試 1: 取得 Access Token...');
try {
  const { token } = await auth.getAccessToken();
  console.log(`✅ Access Token 取得成功（前 20 字元）: ${token?.slice(0, 20)}...`);
} catch (err) {
  console.error(`❌ 取得 Access Token 失敗: ${err.message}`);
  process.exit(1);
}
console.log('');

// 2. Google Drive: 列出最近 5 個檔案
console.log('⏳ 測試 2: 列出 Google Drive 最近 5 個檔案...');
try {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    pageSize: 5,
    fields: 'files(id, name, mimeType)',
    orderBy: 'modifiedTime desc',
  });
  const files = res.data.files ?? [];
  if (files.length === 0) {
    console.log('⚠️  Drive 中無檔案');
  } else {
    console.log(`✅ Drive 連線成功，最近 ${files.length} 個檔案:`);
    for (const f of files) {
      console.log(`   - ${f.name}  [${f.mimeType}]`);
    }
  }
} catch (err) {
  console.error(`❌ Google Drive 連線失敗: ${err.message}`);
}
console.log('');

// 3. Google Docs API 可用性測試
console.log('⏳ 測試 3: Google Docs API 可用性...');
try {
  const docs = google.docs({ version: 'v1', auth });
  // 嘗試存取一個不存在的文件，預期得到 404（代表 API 正常回應）
  await docs.documents.get({ documentId: 'test-nonexistent-id-123' });
} catch (err) {
  const status = err?.response?.status ?? err?.status ?? err?.code;
  if (status === 404) {
    console.log('✅ Docs API 回應正常（404 預期）');
  } else if (status === 401 || status === 403) {
    console.error(`❌ Docs API 認證錯誤 (${status}): ${err.message}`);
  } else {
    console.log(`⚠️  Docs API 回應: ${status ?? err.message}`);
  }
}
console.log('');

// 4. Google Sheets API 可用性測試
console.log('⏳ 測試 4: Google Sheets API 可用性...');
try {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.get({ spreadsheetId: 'test-nonexistent-id-123' });
} catch (err) {
  const status = err?.response?.status ?? err?.status ?? err?.code;
  if (status === 404) {
    console.log('✅ Sheets API 回應正常（404 預期）');
  } else if (status === 401 || status === 403) {
    console.error(`❌ Sheets API 認證錯誤 (${status}): ${err.message}`);
  } else {
    console.log(`⚠️  Sheets API 回應: ${status ?? err.message}`);
  }
}
console.log('');

// 5. Google Slides API 可用性測試
console.log('⏳ 測試 5: Google Slides API 可用性...');
try {
  const slides = google.slides({ version: 'v1', auth });
  await slides.presentations.get({ presentationId: 'test-nonexistent-id-123' });
} catch (err) {
  const status = err?.response?.status ?? err?.status ?? err?.code;
  if (status === 404) {
    console.log('✅ Slides API 回應正常（404 預期）');
  } else if (status === 401 || status === 403) {
    console.error(`❌ Slides API 認證錯誤 (${status}): ${err.message}`);
  } else {
    console.log(`⚠️  Slides API 回應: ${status ?? err.message}`);
  }
}
console.log('');

console.log('🏁 連線測試完成');
