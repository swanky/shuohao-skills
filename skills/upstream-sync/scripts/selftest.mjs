#!/usr/bin/env node
// 自測：覆蓋 check-zh-tw.mjs 的全部確定性邏輯。
// 不呼叫任何模型，不花額度，跑一次 < 1 秒。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST,
  SIMPLIFIED_CHARS,
  TERM_RULES,
  allowlistFor,
  collectFiles,
  isSkipped,
  isTextPath,
  scanText,
} from './check-zh-tw.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim();

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, `${msg} — 期望 ${expected}，實際 ${actual}`);
  passed++;
}

// ── 字表本身 ────────────────────────────────────────────────
// zh-tw-lint: off
{
  ok(SIMPLIFIED_CHARS.size > 300, '簡體字表至少收了三百個字');
  for (const ch of '发干里松丑面只复系表板准') {
    ok(!SIMPLIFIED_CHARS.has(ch), `一簡對多繁的「${ch}」不進字表，交給語境判斷`);
  }
  for (const ch of '说这时国实图门车马红结长业') {
    ok(SIMPLIFIED_CHARS.has(ch), `「${ch}」是簡體專用字，必須進字表`);
  }
  for (const ch of '說這時國實圖門車馬紅結長業') {
    ok(!SIMPLIFIED_CHARS.has(ch), `正體的「${ch}」不該被當成簡體`);
  }
  ok(TERM_RULES.every((r) => r.level === 'error' || r.level === 'warn'), '每條用詞規則都標了級別');
  ok(TERM_RULES.some((r) => r.bad === '軟件' && r.level === 'error'), '「軟件」是 error 級');
  ok(TERM_RULES.some((r) => r.bad === '支持' && r.level === 'warn'), '「支持」是 warn 級，語境上偶爾成立');
}

// ── 掃描：抓得到 ────────────────────────────────────────────
{
  const hits = scanText('docs/x.md', '这个角色的设定很完整。');
  eq(hits.length, 1, '一行簡體只回報一項，不逐字灌水');
  eq(hits[0].level, 'error', '簡體字是 error 級');
  eq(hits[0].kind, 'simplified', '命中種類是 simplified');
  eq(hits[0].line, 1, '行號從 1 起算');
  ok(hits[0].found.includes('这') && hits[0].found.includes('设'), '把命中的字列出來');

  const term = scanText('docs/x.md', '這套軟件的視頻質量不錯。');
  eq(term.length, 3, '三個大陸用詞各回報一項');
  ok(term.every((h) => h.kind === 'term' && h.level === 'error'), '定案用詞都是 error 級');
  ok(term.some((h) => h.hint.includes('軟體')), '提示直接給出正確用詞');

  const warn = scanText('docs/x.md', '這個功能支持自訂搜索條件。');
  ok(warn.length === 2 && warn.every((h) => h.level === 'warn'), '待確認用詞是 warn 級');

  // 「通过」誤譯成「透過」是這個 repository 最常犯的一種，用正則規則抓。
  ok(TERM_RULES.some((r) => r.pattern), '有正則形式的規則');
  for (const bad of ['品質門全部透過', '樣例透過校驗', '自測全部透過', '沒寫照常透過', '頁首徽章透過態']) {
    const hit = scanText('docs/x.md', bad);
    ok(hit.length === 1 && hit[0].level === 'error', `「${bad}」是誤譯，抓得到`);
  }
  for (const good of ['品質門全部通過', '樣例通過校驗', '透過管道打聽', '透過女婿引薦', '經由這個介面透過驗證流程']) {
    eq(scanText('docs/x.md', good).length, 0, `「${good}」用法正確，不誤判`);
  }

  const multi = scanText('docs/x.md', '第一行乾淨\n第二行有个简体\n第三行也乾淨');
  eq(multi.length, 1, '只有出問題的那一行被回報');
  eq(multi[0].line, 2, '回報的行號對得上原檔');
}

// ── 掃描：不誤判 ────────────────────────────────────────────
{
  eq(scanText('docs/x.md', '這一整段都是台灣正體，用詞也照規範：軟體、影片、預設、螢幕。').length, 0,
    '合規的正體文字零命中');
  eq(scanText('docs/x.md', 'const style = "photoreal"; // pure English line').length, 0,
    '純英文的程式碼零命中');
  eq(scanText('docs/x.md', '水準之上、計畫通過、負向提示詞齊備').length, 0,
    '正確用詞不會被它自己的反例規則掃到');
}

// ── 豁免標記 ────────────────────────────────────────────────
// 標記在這裡用組合的方式生成：直接寫字面值的話，這幾行會把自測檔案
// 自己的豁免區塊關掉。
{
  const md = (word) => `<!-- zh-tw-lint: ${word} -->`;
  const js = (word) => `// zh-tw-lint: ${word}`;

  eq(scanText('docs/x.md', `${md('off')}
这行是反例
${md('on')}`).length, 0,
    'off／on 之間整段豁免');
  eq(scanText('docs/x.md', `${md('off')}
这行是反例
${md('on')}
这行沒豁免`).length, 1,
    'on 之後恢復檢查');
  eq(scanText('docs/x.md', `这行是反例 ${md('allow')}`).length, 0,
    '單行 allow 只豁免自己');
  eq(scanText('docs/x.md', `这行是反例 ${md('allow')}
这行沒標記`).length, 1,
    'allow 不會外溢到下一行');
  eq(scanText('scripts/x.mjs', `${js('off')}
const bad = "简体";
${js('on')}`).length, 0,
    '程式碼註解形式的標記同樣有效');
}

// ── 白名單 ──────────────────────────────────────────────────
{
  const NC = 'skills/novel-characters/scripts/novel-characters.mjs';
  ok(allowlistFor(NC).length >= 3, 'novel-characters 主腳本有專屬白名單');
  ok(allowlistFor('docs/x.md').length === ALLOWLIST.filter((r) => r.path === '**').length,
    '一般檔案只吃得到通用白名單');

  const zhBlock = ['  zh: {', "    kicker: '角色设定集',", '  },', "  en: {", "    kicker: 'CAST',"].join('\n');
  eq(scanText(NC, zhBlock).length, 0, 'STRINGS.zh 語系表整塊豁免——那是 --lang zh 這個功能本身');

  const jaBlock = ['  ja: {', "    kicker: '登場人物',", "    groups: { voice: '声' },", '  },', '};'].join('\n');
  eq(scanText(NC, jaBlock).length, 0, 'ja 語系表整塊豁免——日文新字體與簡體字形重疊');

  const afterZh = ['  zh: {', "    kicker: '角色设定集',", '  },', "  'zh-TW': {", "    kicker: '角色设定集',"].join('\n');
  eq(scanText(NC, afterZh).length, 1, "zh 區塊在 'zh-TW' 那行就結束，之後照常檢查");

  eq(scanText(NC, "    label: { zh: '半写实厚涂', 'zh-TW': '半寫實厚塗' },").length, 0,
    '行內的 zh 語系字串豁免');
  eq(scanText('skills/novel-characters/scripts/selftest.mjs',
    "ok(tw.includes('角色設定集') && !tw.includes('角色设定集'), 'zh-TW 介面用正體字');").length, 0,
    '自測裡驗證簡體語系的斷言豁免');
  eq(scanText('skills/novel-characters/scripts/selftest.mjs', "ok(md.includes('设定'), '不相干的斷言');").length, 1,
    '同一支自測裡沒掛語系關鍵字的行照常檢查');
}
// zh-tw-lint: on

// ── 整份跳過的路徑 ──────────────────────────────────────────
{
  ok(isSkipped('testdata/corpora/classic-chinese-novels/紅樓夢.txt'),
    '原始語料整份跳過——原典什麼字形就是什麼字形');
  ok(isSkipped('testdata/benchmarks/novel-characters/classic-chinese-novels/紅樓夢-主要角色/紅樓夢-主要角色-cast.json'),
    '品質基準整份跳過——引文與別名以原文為準');
  ok(!isSkipped('testdata/README.md'), 'testdata 的說明文件照常檢查');
  ok(!isSkipped('skills/novel-outline/README.md'), 'skill 文件照常檢查');
  // zh-tw-lint: off
  eq(scanText('testdata/corpora/x.txt', '这是简体原文').length, 0, '跳過的檔案零命中');
  eq(scanText('testdata/README.md', '这是简体原文').length, 1, '沒跳過的照常抓');
  // zh-tw-lint: on
}

// ── 檔案清單 ────────────────────────────────────────────────
{
  ok(isTextPath('a/b.md') && isTextPath('a/b.mjs') && isTextPath('a/b.json'), '文字副檔名收進來');
  ok(!isTextPath('a/b.webp') && !isTextPath('a/b.png'), '二進位檔案排除在外');

  const all = collectFiles({ root });
  ok(all.length > 50, '全 repository 掃得到五十個以上的文字檔');
  ok(all.every(isTextPath), '清單裡不會混進二進位檔案');
  ok(!all.some((f) => f.endsWith('.webp')), '封面圖不在清單裡');

  // git 預設會把非 ASCII 路徑轉義成 ä¸­ 這種形式，那樣的路徑 stat 不到，
  // 中文檔名的檔案會被靜默跳過。這條盯著 -z 別被改回去。
  ok(all.some((f) => /[一-鿿]/.test(f)), '中文檔名的檔案有進清單');
  ok(all.some((f) => f.endsWith('渡口-cast.json')), '範例資料掃得到');
  ok(all.every((f) => !/\\[0-7]{3}/.test(f)), '路徑沒有被 git 轉義');

  const scoped = collectFiles({ root, paths: ['skills/upstream-sync'] });
  ok(scoped.length >= 2 && scoped.every((f) => f.startsWith('skills/upstream-sync/')),
    '指定路徑時只掃該路徑底下的檔案');
}

// ── 端到端：這個 repository 自己要是乾淨的 ──────────────────
// 這條等於一道品質門：合併上游之後只要還有漏改，這裡就會紅。
{
  const errors = collectFiles({ root })
    .flatMap((rel) => {
      const abs = join(root, rel);
      if (!existsSync(abs)) return [];
      return scanText(rel, readFileSync(abs, 'utf8'));
    })
    .filter((h) => h.level === 'error');
  ok(errors.length === 0,
    `整個 repository 沒有簡體字與大陸用詞漏改${errors.length ? `：${errors.map((h) => `${h.file}:${h.line} ${h.found}`).join('、')}` : ''}`);
}

console.log(`✓ ${passed} 項自測全部通過`);
