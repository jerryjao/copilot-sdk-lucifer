#!/usr/bin/env node
/**
 * 完整的 Google Drive 工具測試腳本
 * 測試四個 gdrive 工具的實際功能：
 * - gdrive_read_document: 讀取 Google Docs 文字內容
 * - gdrive_read_slides: 讀取 Google Slides 每頁文字
 * - gdrive_read_spreadsheet: 讀取 Google Sheets（tab 分隔）
 * - gdrive_get_image: 下載 Google Drive 圖片供 AI 分析
 *
 * 執行方式:
 *   node scripts/test-gdrive-tools.mjs [docId] [slideId] [sheetId] [imageId]
 *
 * 範例（需要替換為真實 ID）:
 *   node scripts/test-gdrive-tools.mjs YOUR_DOC_ID YOUR_SLIDE_ID YOUR_SHEET_ID YOUR_IMAGE_ID
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 手動載入 .env
const envPath = resolve(__dirname, '../.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
  console.log('✅ .env 載入完成\n');
} catch (err) {
  console.error('❌ 無法載入 .env:', err.message);
  process.exit(1);
}

// 驗證環境變數
const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ 缺少環境變數: ${missing.join(', ')}`);
  process.exit(1);
}

// 動態導入編譯後的 utils
const utils = await import('../dist/utils.js');

const {
  fetchGoogleDocContent,
  fetchGoogleSlidesContent,
  fetchGoogleSheetsContent,
  fetchGoogleDriveImageBuffer,
  extractGoogleFileInfo,
} = utils;

// ============================================================================
// 預設測試案例
// ============================================================================

const defaultTestCases = {
  docId: '1q18UbtG2GdkIE1QCMTknVuQxXIzbvN5BtJsMiN1MUR8',
  slideId: '1ZtY8bd2I6OrN1OyT7VSpr7bw2wy5DPHlu99xr1kGe4E',
  sheetId: '1Nv3VeXoNnDL-TjmyeKb-XxY4SK25ieIVCNy-_UW0lmE',
};

// ============================================================================
// 取得參數
// ============================================================================

const args = process.argv.slice(2);

// 判斷是否使用預設案例或自訂參數
let docId = args[0];
let slideId = args[1];
let sheetId = args[2];
let imageId = args[3];

const useDefaults = args.length === 0 || args[0] === '--default';
if (useDefaults) {
  docId = defaultTestCases.docId;
  slideId = defaultTestCases.slideId;
  sheetId = defaultTestCases.sheetId;
}

console.log('📋 Google Drive 工具測試程序');
console.log('═'.repeat(50));
console.log('');

if (useDefaults) {
  console.log('🔧 使用預設測試案例');
  console.log('   📄 Document: document 測試檔');
  console.log('   🎨 Slides: slider 測試檔');
  console.log('   📊 Sheets: calculate 測試檔');
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log('使用方式:');
  console.log('  node scripts/test-gdrive-tools.mjs              # 使用預設測試案例');
  console.log('  node scripts/test-gdrive-tools.mjs --default    # 明確使用預設案例');
  console.log('  node scripts/test-gdrive-tools.mjs [docId] [slideId] [sheetId] [imageId]');
  console.log('');
  console.log('參數說明:');
  console.log('  docId     - Google Docs 文件 ID');
  console.log('  slideId   - Google Slides 簡報 ID');
  console.log('  sheetId   - Google Sheets 試算表 ID');
  console.log('  imageId   - Google Drive 圖片文件 ID');
  console.log('');
  console.log('範例:');
  console.log('  node scripts/test-gdrive-tools.mjs                                    # 預設案例');
  console.log('  node scripts/test-gdrive-tools.mjs 1xAbCdEf                          # 單一文件');
  console.log('  node scripts/test-gdrive-tools.mjs 1xAbCdEf 2yBcDeFg 3zCdEfGh        # 多個文件');
  console.log('');
  process.exit(0);
}

if (!docId && !slideId && !sheetId && !imageId) {
  console.log('❌ 需要至少提供一個文件 ID');
  console.log('');
  console.log('提示: 執行 `node scripts/test-gdrive-tools.mjs --help` 查看說明');
  console.log('     或執行 `node scripts/test-gdrive-tools.mjs` 使用預設測試案例');
  console.log('');
  process.exit(1);
}

console.log('🧪 開始測試 Google Drive 工具...\n');

// ============================================================================
// 測試 1: Google Docs
// ============================================================================

if (docId) {
  console.log('📄 測試 1: Google Docs (gdrive_read_document)');
  console.log('─'.repeat(50));
  try {
    console.log(`   文件 ID: ${docId}`);
    console.log('⏳ 正在讀取...');
    const content = await fetchGoogleDocContent(docId);
    const lines = content.split('\n');
    const preview = lines.slice(0, 5).join('\n');
    console.log(`✅ 成功! (${content.length} 字元，${lines.length} 行)`);
    console.log('\n   📋 前 5 行預覽:');
    console.log('   ' + preview.split('\n').join('\n   '));
  } catch (err) {
    console.error(`❌ 失敗: ${err.message}`);
  }
  console.log('');
}

// ============================================================================
// 測試 2: Google Slides
// ============================================================================

if (slideId) {
  console.log('🎨 測試 2: Google Slides (gdrive_read_slides)');
  console.log('─'.repeat(50));
  try {
    console.log(`   簡報 ID: ${slideId}`);
    console.log('⏳ 正在讀取...');
    const content = await fetchGoogleSlidesContent(slideId);
    const lines = content.split('\n');
    const preview = lines.slice(0, 5).join('\n');
    console.log(`✅ 成功! (${content.length} 字元，${lines.length} 行)`);
    console.log('\n   📋 前 5 行預覽:');
    console.log('   ' + preview.split('\n').join('\n   '));
  } catch (err) {
    console.error(`❌ 失敗: ${err.message}`);
  }
  console.log('');
}

// ============================================================================
// 測試 3: Google Sheets
// ============================================================================

if (sheetId) {
  console.log('📊 測試 3: Google Sheets (gdrive_read_spreadsheet)');
  console.log('─'.repeat(50));
  try {
    console.log(`   試算表 ID: ${sheetId}`);
    console.log('⏳ 正在讀取...');
    const content = await fetchGoogleSheetsContent(sheetId);
    const lines = content.split('\n');
    const preview = lines.slice(0, 5).join('\n');
    console.log(`✅ 成功! (${content.length} 字元，${lines.length} 行)`);
    console.log('\n   📋 前 5 行預覽:');
    console.log('   ' + preview.split('\n').join('\n   '));
  } catch (err) {
    console.error(`❌ 失敗: ${err.message}`);
  }
  console.log('');
}

// ============================================================================
// 測試 4: Google Drive Image
// ============================================================================

if (imageId) {
  console.log('🖼️  測試 4: Google Drive Image (gdrive_get_image)');
  console.log('─'.repeat(50));
  try {
    console.log(`   圖片 ID: ${imageId}`);
    console.log('⏳ 正在下載...');
    const buffer = await fetchGoogleDriveImageBuffer(imageId);
    console.log(`✅ 成功! (${buffer.length} 位元組)`);
    console.log(`   MIME Type: image`);
  } catch (err) {
    console.error(`❌ 失敗: ${err.message}`);
  }
  console.log('');
}

// ============================================================================
// 測試 URL 解析
// ============================================================================

console.log('🔍 額外測試: URL 解析 (extractGoogleFileInfo)');
console.log('─'.repeat(50));

const testUrls = [
  'https://docs.google.com/document/d/1xAbCdEf/edit',
  'https://docs.google.com/presentation/d/2xAbCdEf/edit',
  'https://docs.google.com/spreadsheets/d/3xAbCdEf/edit',
  'https://drive.google.com/file/d/4xAbCdEf/view',
];

for (const url of testUrls) {
  const info = extractGoogleFileInfo(url);
  if (info) {
    console.log(`✅ ${info.type.padEnd(6)} | ID: ${info.id}`);
  } else {
    console.log(`❌ 無法解析: ${url}`);
  }
}

console.log('');
console.log('🏁 測試完成');
