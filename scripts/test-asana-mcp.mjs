/**
 * Asana REST API 連線測試腳本
 * 執行方式: node scripts/test-asana-mcp.mjs
 */
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

const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN;
const BASE = 'https://app.asana.com/api/1.0';

if (!ASANA_ACCESS_TOKEN) {
  console.error('❌ ASANA_ACCESS_TOKEN 未設定');
  process.exit(1);
}

console.log('🔑 Asana Token 載入完成');
console.log(`   Token: ${ASANA_ACCESS_TOKEN.slice(0, 20)}...`);
console.log('');

async function asanaGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${ASANA_ACCESS_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data;
}

// 1. 驗證 Token（取得使用者資訊）
console.log('⏳ 測試 1: 驗證 Token（GET /users/me）...');
try {
  const me = await asanaGet('/users/me');
  console.log(`✅ Token 有效！使用者: ${me.name} (${me.email})`);
} catch (err) {
  console.error(`❌ Token 驗證失敗: ${err.message}`);
  process.exit(1);
}
console.log('');

// 2. 列出工作區
console.log('⏳ 測試 2: 列出工作區（GET /workspaces）...');
let workspaces = [];
try {
  workspaces = await asanaGet('/workspaces');
  if (workspaces.length === 0) {
    console.log('⚠️  沒有找到任何工作區');
  } else {
    console.log(`✅ 找到 ${workspaces.length} 個工作區:`);
    for (const ws of workspaces) {
      console.log(`   - ${ws.name}  [${ws.gid}]`);
    }
  }
} catch (err) {
  console.error(`❌ 列出工作區失敗: ${err.message}`);
}
console.log('');

if (workspaces.length === 0) {
  console.log('🏁 無工作區，跳過後續測試');
  process.exit(0);
}

const wsGid = workspaces[0].gid;

// 3. 列出前 5 個專案
console.log(`⏳ 測試 3: 列出工作區 "${workspaces[0].name}" 的前 5 個專案...`);
try {
  const projects = await asanaGet(`/workspaces/${wsGid}/projects?limit=5`);
  if (projects.length === 0) {
    console.log('⚠️  工作區中無專案');
  } else {
    console.log(`✅ 找到 ${projects.length} 個專案:`);
    for (const p of projects) {
      console.log(`   - ${p.name}  [${p.gid}]`);
    }
  }
} catch (err) {
  console.error(`❌ 列出專案失敗: ${err.message}`);
}
console.log('');

// 4. 檢查是否有「AFA 開發」專案
console.log('⏳ 測試 4: 搜尋「AFA 開發」專案（typeahead）...');
try {
  const results = await asanaGet(`/workspaces/${wsGid}/typeahead?resource_type=project&query=AFA 開發`);
  const afa = results.find(p => p.name === 'AFA 開發');
  if (afa) {
    console.log(`✅ 找到「AFA 開發」專案！ [${afa.gid}]`);
  } else {
    console.log('⚠️  未找到名為「AFA 開發」的專案');
    if (results.length > 0) {
      console.log('   相似結果:');
      for (const r of results) {
        console.log(`   - ${r.name}  [${r.gid}]`);
      }
    }
  }
} catch (err) {
  console.error(`❌ 搜尋專案失敗: ${err.message}`);
}
console.log('');

// 5. 搜尋指派給自己的任務
console.log(`⏳ 測試 5: 搜尋指派給自己的前 5 個任務...`);
try {
  const tasks = await asanaGet(`/workspaces/${wsGid}/tasks/search?assignee.any=me&limit=5`);
  if (tasks.length === 0) {
    console.log('⚠️  沒有找到指派給自己的任務');
  } else {
    console.log(`✅ 找到 ${tasks.length} 個任務:`);
    for (const t of tasks) {
      console.log(`   - ${t.name}  [${t.gid}]`);
    }
  }
} catch (err) {
  console.error(`❌ 搜尋任務失敗: ${err.message}`);
}
console.log('');

console.log('🏁 Asana 連線測試完成');
