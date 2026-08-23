#!/usr/bin/env node
// novel-script 自測：不調模型、不花額度，只驗確定性邏輯。
// 原則與儲存庫裡其他 skill 一致：每道品質門都要有擊穿用例——
// 證明它真的會攔，不是一個永遠為真的假測試。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PARAMS,
  computeStats,
  gateReport,
  lineChars,
  paramsOf,
  renderHtml,
  renderMarkdown,
  sceneSeconds,
  seedFromOutline,
  slug,
  validateScript,
} from './novel-script.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../examples/渡口-script.json'), 'utf8'));
const OUTLINE = JSON.parse(readFileSync(join(here, '../../novel-outline/examples/渡口-outline.json'), 'utf8'));
const ART = JSON.parse(readFileSync(join(here, '../../novel-art/examples/渡口-art.json'), 'utf8'));
const CAST = JSON.parse(readFileSync(join(here, '../../novel-characters/examples/渡口-cast.json'), 'utf8'));
const CTX = { outline: OUTLINE, art: ART };

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed += 1;
}
function eq(actual, expected, label) {
  assert.equal(actual, expected, `${label} — 期望 ${expected}，實際 ${actual}`);
  passed += 1;
}
const clone = (x) => structuredClone(x);
const gate = (doc, id, ctx = {}) => gateReport(doc, ctx).find((g) => g.id === id);

/* ---------------- 時長引擎 ---------------- */

eq(lineChars('你好，世界。'), 6, '標點算時間——停頓也是時間');
eq(lineChars('  你 好  '), 2, '空白不算字元');
eq(lineChars(''), 0, '空串為零');
eq(lineChars(null), 0, 'null 不崩');

const sc = {
  flow: [
    { action: '霧漫上來。' },
    { speaker: 'C01', line: '一二三四五六七八九' }, // 9 字 → 2 秒
    { action: '船離岸。' },
  ],
};
const sec = sceneSeconds(sc);
eq(sec.action, 5, '兩個動作節拍 × 2.5 秒');
eq(sec.dialogue, 2, '9 字 ÷ 4.5 字每秒 = 2 秒');
eq(sec.total, 7, '總時長 = 臺詞 + 動作');
eq(sceneSeconds({ flow: [] }).total, 0, '空節拍流為零秒');

eq(paramsOf({}).charsPerSecond, DEFAULT_PARAMS.charsPerSecond, '預設參數生效');
eq(paramsOf({ params: { charsPerSecond: 6 } }).charsPerSecond, 6, 'params 可覆蓋語速');
eq(paramsOf({ params: { charsPerSecond: 6 } }).tolerance, DEFAULT_PARAMS.tolerance, '只覆蓋給出的鍵');
eq(sceneSeconds(sc, { ...DEFAULT_PARAMS, charsPerSecond: 9 }).dialogue, 1, '語速參數參與計算');

/* ---------------- computeStats ---------------- */

const stats = computeStats(FIXTURE);
eq(stats.totals.episodes, 6, '樣例全六集');
eq(stats.totals.scenes, 9, '樣例九場');
eq(stats.totals.lines, 123, '樣例臺詞句數');
ok(stats.totals.estSeconds > 600 && stats.totals.estSeconds < 750, '預估總時長在目標帶附近');
eq(stats.totals.targetSeconds, 720, '目標秒數彙總');
ok(stats.episodes.every((e) => e.est >= 102 && e.est <= 138), '每一集都落在 ±15% 容差帶內');
ok(stats.episodes[0].dialogueSeconds > 0 && stats.episodes[0].actionSeconds > 0, '臺詞與動作分開計秒');
eq(stats.sceneTable.length, 9, '場次總表九行');
eq(stats.sceneTable[0].sceneId, 'S02', '場次總表按出場順序');
ok(stats.sceneTable[0].lineCount > 0, '場次錶帶臺詞句數');
eq(stats.castLines.length, 6, '臺詞本六個說話人（含畫外音，含第 6 集才開口的更夫）');
ok(stats.castLines[0].count >= stats.castLines[stats.castLines.length - 1].count, '臺詞本按句數降序');
const voEntry = stats.castLines.find((c) => c.id === 'VO');
ok(voEntry, '畫外音單獨成組');
eq(voEntry.lines[0].ep, 1, '臺詞條目帶集號');
ok(voEntry.lines[0].sceneId === 'S01', '臺詞條目帶場景');

/* ---------------- 品質門：全綠基線 ---------------- */

ok(gateReport(FIXTURE, CTX).every((g) => g.ok), '樣例帶上游全部門透過');
ok(gateReport(FIXTURE).every((g) => g.ok), '不帶上游也全部透過（對賬門跳過）');
eq(gateReport(FIXTURE).length, 10, '十道門');

/* ---------------- 品質門：逐門擊穿 ---------------- */

// duration — 寫超
{
  const doc = clone(FIXTURE);
  for (let i = 0; i < 30; i++) doc.episodes[0].scenes[0].flow.push({ action: `加戲第 ${i} 拍。` });
  const g = gate(doc, 'duration');
  ok(!g.ok, '寫超時長被攔');
  ok(g.detail.includes('超'), '超時報得出秒數');
}
// duration — 寫欠
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes = [doc.episodes[0].scenes[0]];
  const g = gate(doc, 'duration');
  ok(!g.ok, '寫欠時長被攔');
  ok(g.detail.includes('欠'), '欠時報得出秒數');
}
// duration — 容差可配
{
  const doc = clone(FIXTURE);
  doc.params = { tolerance: 0.01 };
  ok(!gate(doc, 'duration').ok, '容差收緊到 1% 後原樣例不再達標');
}
// line-length
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ speaker: 'C03', line: '這句臺詞故意寫得非常非常長，長到一口氣根本讀不完，純粹為了擊穿單句上限這道門而存在。' });
  const g = gate(doc, 'line-length');
  ok(!g.ok, '超長臺詞被攔');
  ok(g.detail.includes('字'), '報出字數');
}
// speaker
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ speaker: 'C99', line: '我不在這場裡。' });
  ok(!gate(doc, 'speaker').ok, '不在本場的說話人被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ speaker: 'VO', line: '畫外音不受本場人物限制。' });
  ok(gate(doc, 'speaker').ok, 'VO 合法');
}
// hook-cliff
{
  const doc = clone(FIXTURE);
  doc.episodes[0].hook = ' ';
  ok(!gate(doc, 'hook-cliff').ok, '空鉤子被攔');
}
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].cliff;
  ok(!gate(doc, 'hook-cliff').ok, '缺結尾懸念被攔');
}
// hook-open — 鉤子必須在全集前 3 拍內兌現（認領機制）
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].hookBeat;
  const g = gate(doc, 'hook-open');
  ok(!g.ok, '缺 hookBeat 被攔');
  ok(g.detail.includes('hookBeat'), '報出缺的欄位');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].hookBeat = [2, 1]; // 第 2 場第 1 拍 = 全集第 14 拍
  const g = gate(doc, 'hook-open');
  ok(!g.ok, '鉤子落在第 14 拍被攔——冷開場是門不是建議');
  ok(g.detail.includes('第 14 拍'), '報出實際位置');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].hookBeat = [9, 9];
  ok(gate(doc, 'hook-open').detail.includes('不存在'), '指向不存在的節拍被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].hookBeat = [2, 1];
  doc.params = { hookWindow: 20 };
  ok(gate(doc, 'hook-open').ok, '鉤子視窗可按需放寬');
}
// has-action
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow = doc.episodes[0].scenes[0].flow.filter((b) => typeof b.line === 'string');
  const g = gate(doc, 'has-action');
  ok(!g.ok, '純對白的場（廣播劇）被攔');
  ok(g.detail.includes('S02'), '點名到場');
}
// action-prose
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ action: '老周說「坐穩了」，隨即撐篙。' });
  ok(!gate(doc, 'action-prose').ok, '動作裡混臺詞引號被攔');
}
// beats-claimed
{
  const doc = clone(FIXTURE);
  doc.episodes[0].beatsClaimed = [];
  ok(!gate(doc, 'beats-claimed', CTX).ok, '大綱爽點沒認領被攔');
  ok(gate(doc, 'beats-claimed').ok, '沒給大綱時本門跳過');
  ok(gate(doc, 'beats-claimed').detail.includes('跳過'), '跳過要明說，不靜默');
}
// refs-characters
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].characters.push('C99');
  ok(!gate(doc, 'refs-characters', CTX).ok, '大綱裡沒有的角色被攔');
  ok(gate(doc, 'refs-characters').ok, '沒給大綱時本門跳過');
}
// refs-scenes：場景 / 光照 / 道具三個方向都要攔
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].sceneId = 'S99';
  ok(!gate(doc, 'refs-scenes', CTX).ok, '不存在的場景被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].lighting = '正午烈日';
  const g = gate(doc, 'refs-scenes', CTX);
  ok(!g.ok, '沒登記過的光照狀態被攔');
  ok(g.detail.includes('正午烈日'), '光照違規點得出名');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].props.push('P99');
  ok(!gate(doc, 'refs-scenes', CTX).ok, '不存在的道具被攔');
  ok(gate(doc, 'refs-scenes').ok, '沒給美術設定時本門跳過');
}

/* ---------------- validateScript 結構檢查 ---------------- */

eq(validateScript(FIXTURE, CTX).length, 0, '樣例零違規');
ok(validateScript(null).length > 0, 'null 不崩');
ok(validateScript({}).some((p) => p.includes('source')), '缺 source 報出來');
ok(validateScript({ source: 'x', episodes: [] }).some((p) => p.includes('episodes')), '空 episodes 報出來');
{
  const doc = clone(FIXTURE);
  doc.episodes.push(clone(doc.episodes[0]));
  ok(validateScript(doc).some((p) => p.includes('重複')), '重複集號報出來');
}
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].targetSeconds;
  ok(validateScript(doc).some((p) => p.includes('targetSeconds')), '缺目標秒數報出來');
}
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].beatsClaimed;
  ok(validateScript(doc).some((p) => p.includes('beatsClaimed')), '缺爽點認領欄位報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].sceneId = '船艙';
  ok(validateScript(doc).some((p) => p.includes('S01 這種格式')), 'sceneId 格式報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow = [];
  ok(validateScript(doc).some((p) => p.includes('節拍流為空')), '空節拍流報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ action: '動作', line: '臺詞', speaker: 'C01' });
  ok(validateScript(doc).some((p) => p.includes('二選一')), '節拍不許既是動作又是臺詞');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ delivery: '只有語氣' });
  ok(validateScript(doc).some((p) => p.includes('二選一')), '兩頭都不是也攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ speaker: 'C03', line: '   ' });
  ok(validateScript(doc).some((p) => p.includes('空臺詞')), '空臺詞報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ line: '沒有說話人。' });
  ok(validateScript(doc).some((p) => p.includes('speaker')), '臺詞缺說話人報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].scenes[0].flow.push({ action: '  ' });
  ok(validateScript(doc).some((p) => p.includes('空動作')), '空動作節拍報出來');
}
ok(validateScript(clone(FIXTURE)).length === 0, '不帶上游校驗也透過');

/* ---------------- seed ---------------- */

const seeded = seedFromOutline(OUTLINE);
eq(seeded.source, '渡口', 'seed 帶書名');
eq(seeded.episodes.length, 6, 'seed 全六集');
eq(seeded.episodes[0].targetSeconds, 120, '目標秒數 = 每集分鐘 × 60');
eq(seeded.episodes[0].hook, OUTLINE.episodes[0].hook, '鉤子從大綱搬');
eq(seeded.episodes[0].cliff, OUTLINE.episodes[0].suspense, '懸念從大綱搬');
eq(seeded.episodes[0].beatsClaimed.join(','), '懸念鉤', '第 1 集預填懸念鉤');
eq(seeded.episodes[2].beatsClaimed.join(','), '身份揭破', '第 3 集預填身份揭破');
eq(seeded.episodes[1].beatsClaimed.length, 0, '沒有爽點的集為空陣列');
eq(seeded.episodes[0].scenes.length, 0, 'scenes 留空給模型寫戲');
ok(seeded.episodes[0].seedNote.includes('S01'), 'seedNote 帶候選場景');
ok(seeded.episodes[0].seedNote.includes(OUTLINE.episodes[0].synopsis.slice(0, 10)), 'seedNote 帶梗概');
eq(seedFromOutline(OUTLINE, [3, 5]).episodes.map((e) => e.ep).join(','), '3,4,5', '--eps 區間過濾');
eq(seedFromOutline(OUTLINE, [2, 2]).episodes.length, 1, '單集區間');
eq(seedFromOutline({}).episodes.length, 0, '空大綱不崩');
eq(seedFromOutline({ params: {} }).episodes.length, 0, '缺分鐘數用預設值不崩');

/* ---------------- slug ---------------- */

eq(slug('渡口'), '渡口', '中文原樣');
eq(slug('a b/c'), 'a-b-c', '空格斜槓轉短橫');
eq(slug('  '), 'script', '空名兜底');

/* ---------------- render markdown ---------------- */

const md = renderMarkdown(FIXTURE, CTX);
ok(md.includes('# 渡口 · 劇本（第 1–6 集）'), 'md 標題帶集數區間');
ok(md.includes('第 1 場 · 渡口棧橋（濃霧清晨）'), 'md 場頭顯示場景名與光照');
ok(md.includes('**老周**'), 'md 說話人顯示名字不是 ID');
ok(md.includes('**畫外音**'), 'md 裡 VO 顯示成畫外音');
ok(md.includes('場次總表'), 'md 帶場次總表');
ok(md.includes('臺詞本'), 'md 帶臺詞本');
ok(md.includes('第 1 場第 1 拍兌現'), 'md 鉤子行帶認領位置');
const mdBare = renderMarkdown(FIXTURE);
ok(mdBare.includes('**C03**'), '不給上游時退回裸 ID');
ok(mdBare.includes('S02'), '場景同樣退回 ID');

/* ---------------- render html ---------------- */

const html = renderHtml(FIXTURE, CTX);
ok(html.includes('<!doctype html>'), 'html 完整文件');
ok(!/src="http|href="http|@import|url\(http/.test(html), '零外部資源');
ok(html.includes('時長儀表'), '01 時長儀表');
ok(html.includes('分集劇本'), '02 分集劇本');
ok(html.includes('場次總表'), '03 場次總表');
ok(html.includes('臺詞本'), '04 臺詞本');
ok(html.includes('品質門'), '05 品質門');
ok(html.includes('✓ 品質門 10 / 10'), '頁首徽章全綠');
ok(html.includes('class="band"'), '時長條帶目標區間');
ok(html.includes('匯出 JSON'), '匯出按鈕在');
ok(html.includes('id="script-data"'), '資料內嵌');
ok(html.includes('渡口-script.json'), '匯出檔名');
ok(html.includes('data-copy'), '複製按鈕在');
ok(html.includes('複製全部臺詞'), '臺詞本整組複製');
ok(html.includes('@media print'), '列印樣式在');
ok(html.includes('prefers-reduced-motion'), '動效可關');
ok(html.includes('class="eps"'), '分集劇本一排兩集網格');
ok(html.includes('class="scenes clip"'), '場次區預設最多 300px 截斷');
ok(html.includes('展開全部場次'), '每集自帶展開與收起按鈕');
ok(html.includes('class="casts"'), '臺詞本一排兩個網格');
ok(html.includes('max-height:186px'), '臺詞列表六行高，縱向滾動');
{
  const solo = renderHtml({ source: '渡口', episodes: [clone(FIXTURE.episodes[0])] }, CTX);
  ok(solo.includes('eps solo'), '單集單列，不留空半欄');
  ok(solo.includes('劇本（第 1 集）'), '單集標題不帶區間');
}
ok(html.includes('老周'), 'html 裡 ID 換成名字');
ok(html.includes('晨霧'), '光照 chips 在');
ok(html.includes('第 1 場第 1 拍兌現'), '鉤子行帶認領徽章');
ok(html.includes('act-line hooked'), '認領的節拍在正文裡高亮');
ok(!html.includes('音色提示詞'), '不給 --cast 就沒有音色按鈕——不猜');
{
  const withCast = renderHtml(FIXTURE, { ...CTX, cast: CAST });
  ok(withCast.includes('音色提示詞'), '給了 --cast 臺詞本帶音色提示詞按鈕');
  // 從 cast 裡取，別硬編樣例內容——樣例的音色提示詞改過形態，
  // 寫死字串的斷言會跟著掛，而且它驗的本來就不是「內容長什麼樣」
  const anyPrompt = CAST.characters.find((c) => c?.voice?.prompt)?.voice?.prompt ?? '';
  ok(anyPrompt.length > 0, '樣例 cast 裡有音色提示詞');
  // html 裡字元是轉義過的，取一段不含特殊字元的片段來比對
  const frag = anyPrompt.split(',')[0].trim();
  ok(frag.length > 5 && withCast.includes(frag), '音色提示詞是 cast 的 voice.prompt 原文');
}
ok(html.includes('lang="zh"'), '預設報告 html lang 是 zh');

/* ---------------- render — 英文介面 ---------------- */

{
  const en = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(en.includes('lang="en"'), 'en 報告的 html lang 屬性正確');
  ok(en.includes('Export JSON'), 'en 匯出按鈕標籤');
  ok(en.includes('Quality gates 10 / 10'), 'en 頁首徽章全綠');
  ok(en.includes('Line book'), 'en 臺詞本標題');
  ok(en.includes('Duration gauge'), 'en 時長儀表標題');
  ok(!en.includes('匯出 JSON'), 'en 報告不含中文匯出標籤');
  ok(!en.includes('品質門'), 'en 報告不含中文品質門標籤');
  ok(!en.includes('臺詞本'), 'en 報告不含中文臺詞本標籤');
}
{
  const mdEn = renderMarkdown(FIXTURE, { ...CTX, lang: 'en' });
  ok(mdEn.includes('## Episode 1'), 'en md 分集標題是英文');
  ok(mdEn.includes('## Line book'), 'en md 臺詞本標題是英文');
}
{
  const doc = clone(FIXTURE);
  doc.lang = 'en';
  ok(renderMarkdown(doc, CTX).includes('## Episode 1'), 'script.json 頂層 lang 欄位生效');
  ok(renderMarkdown(doc, { ...CTX, lang: 'zh' }).includes('## 第 1 集'), '--lang 優先於 JSON 的 lang 欄位');
}
{
  let threw = false;
  try { renderHtml(FIXTURE, { ...CTX, lang: 'fr' }); } catch { threw = true; }
  ok(threw, '非內建語言直接拋錯，不靜默回退');
}

// 病灶橫幅
{
  const doc = clone(FIXTURE);
  doc.episodes[1].hook = ''; // 擊穿 hook-cliff 門
  const h = renderHtml(doc, CTX);
  ok(h.includes('class="galert"'), '有門未過時頁頂掛病灶橫幅');
  ok(h.includes('gatepill fail'), '徽章翻紅');
}

// XSS：模型資料全部過 esc
{
  const doc = clone(FIXTURE);
  doc.source = '<script>alert(1)</script>';
  doc.episodes[0].scenes[0].flow.push({ speaker: 'C03', line: '<img src=x onerror=alert(1)>' });
  const h = renderHtml(doc);
  ok(!h.includes('<script>alert(1)</script>'), '標題被轉義');
  ok(!h.includes('<img src=x'), '臺詞被轉義');
  ok(h.includes('\\u003c'), '內嵌 JSON 的 < 轉成 \\u003c，防 </script 截斷');
}

// 品質門面板是報告的一部分：英文介面下門標籤也要翻譯（閾值由門自己算，原樣保留）
{
  const gateEn = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(gateEn.includes('Episode duration within'), 'EN 報告的品質門標籤翻譯且閾值原樣保留');
  ok(!gateEn.includes('每集時長在目標'), 'EN 報告不再出現中文門標籤');
}
console.log(`✓ ${passed} 項自測全部透過`);
