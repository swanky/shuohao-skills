#!/usr/bin/env node
// novel-storyboard 自測：不調模型、不花額度，只驗確定性邏輯。
// 原則與儲存庫裡其他 skill 一致：每道品質門都要有擊穿用例——
// 證明它真的會攔，不是一個永遠為真的假測試。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMERA_MOVES,
  DEFAULT_PARAMS,
  exportPack,
  H3_I2VA_LINE,
  SHOT_SIZES,
  computeStats,
  cutStarts,
  expandScript,
  GATE_LOG,
  gateLogEntries,
  gateReport,
  summarizeGateLog,
  h3AlignmentLine,
  h3CutSlices,
  h3CutTime,
  h3Remainder,
  loadRecipes,
  parseCardFields,
  paramsOf,
  recipeDrift,
  renderHtml,
  renderMarkdown,
  SEEDANCE_NO_SUBTITLES,
  SEEDANCE_NO_TWINS,
  seedancePrompt,
  seedFromScript,
  segSeconds,
  slug,
  validateStoryboard,
} from './novel-storyboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../examples/渡口-storyboard.json'), 'utf8'));
const SCRIPT = JSON.parse(readFileSync(join(here, '../references/test-fixtures/upstream/渡口-script.json'), 'utf8'));
const OUTLINE = JSON.parse(readFileSync(join(here, '../references/test-fixtures/upstream/渡口-outline.json'), 'utf8'));
const CAST = JSON.parse(readFileSync(join(here, '../references/test-fixtures/upstream/渡口-cast.json'), 'utf8'));
const ART = JSON.parse(readFileSync(join(here, '../references/test-fixtures/upstream/渡口-art.json'), 'utf8'));
const CTX = { script: SCRIPT, outline: OUTLINE, cast: CAST, art: ART };

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
const gate = (doc, id, ctx = CTX) => gateReport(doc, ctx).find((g) => g.id === id);

/* ---------------- expandScript ---------------- */

const expanded = expandScript(SCRIPT);
eq(expanded.size, 6, '劇本六集全部展開');
const e1 = expanded.get(1);
eq(e1.scenes.length, 2, '第 1 集兩場');
eq(e1.scenes[0].beats.length, 13, '第 1 場 13 拍');
eq(e1.scenes[1].beats.length, 22, '第 2 場 22 拍');
eq(e1.scenes[0].beats[0].kind, 'action', '第 1 拍是動作');
eq(e1.scenes[0].beats[0].seconds, 2.5, '動作按 2.5 秒計');
eq(e1.scenes[0].beats[2].speaker, 'C03', '臺詞帶說話人');
eq(e1.targetSeconds, 120, '目標秒數帶出來');
eq(expandScript(null).size, 0, '空劇本不崩');

/* ---------------- H3 骨架推導 ---------------- */

eq(h3CutTime(3), '00:03.000', '切點時刻格式 分:秒.毫秒');
eq(h3CutTime(6.5), '00:06.500', '半秒切點');
eq(h3CutTime(65), '01:05.000', '過分鐘進位');
eq(cutStarts([{ seconds: 3 }, { seconds: 4 }, { seconds: 3 }]).join(','), '0,3,7', '切點 = 前面分鏡秒數累計');
eq(h3AlignmentLine([{ seconds: 5 }]), H3_I2VA_LINE, '預設英文：單分鏡的段用官方 I2VA 固定句式');
eq(h3AlignmentLine([{ seconds: 5 }], 'zh'), '目標影片在 0.00 秒處完全參照圖 1（來自鏡頭 1）。', 'zh 模式有中文 I2VA 句式');
{
  const line = h3AlignmentLine([{ seconds: 3 }, { seconds: 4 }]);
  ok(line.startsWith('How the reference pictures align with the target video — '), '預設英文：多分鏡用官方對齊句式');
  ok(line.includes('Picture 1 (from Shot 1) aligns with the 0.00-second mark'), '主分鏡圖釘 0.00 秒');
  ok(line.includes('Picture 2 (from Shot 2) aligns with the 3.00-second mark'), '子分鏡圖釘自己的切點');
  ok(h3AlignmentLine([{ seconds: 3 }, { seconds: 4 }], 'zh').includes('圖 2（來自鏡頭 2）對齊目標影片 3.00 秒處'), 'zh 模式對齊句式可用');
}
{
  const slices = h3CutSlices('integrated_multimodal_description:\n[Shot 1] aa\n[Shot 2] bb\n\noverall_soundscape: x', 2);
  ok(slices[0].includes('aa') && !slices[0].includes('bb'), '[Shot k] 切片互不越界');
  ok(slices[1].includes('bb') && !slices[1].includes('x'), '切片不吃到聲景欄位');
  const zh = h3CutSlices('整體視聽描述：\n[鏡頭 1] aa\n[鏡頭 2] bb\n\n整體音景：x', 2, 'zh');
  ok(zh[0].includes('aa') && zh[1].includes('bb'), 'zh 模式按 [鏡頭 k] 切片');
}
eq(segSeconds({ cuts: [{ seconds: 3 }, { seconds: 4.5 }] }), 7.5, '段秒數 = 分鏡求和');

/* ---------------- computeStats ---------------- */

const stats = computeStats(FIXTURE, SCRIPT);
eq(stats.totals.segments, 10, '樣例十段');
eq(stats.totals.cuts, 34, '樣例三十四個分鏡');
eq(stats.totals.seconds, 119, '總秒數');
eq(stats.totals.targetSeconds, 120, '目標秒數');
ok(stats.totals.avgCutSeconds >= 3 && stats.totals.avgCutSeconds <= 4, '平均一切 3 秒左右——短劇節奏');
eq(stats.batches.length, 2, '兩個生成批次（S02 濃霧清晨 / S01 晨霧）');
ok(stats.batches[0].segments.length + stats.batches[1].segments.length === 10, '批次覆蓋全部段');
eq(stats.dialogue.length, 19, '第 1 集 19 句臺詞全部對到段和切');
ok(stats.dialogue.every((d) => /^E01-\d{2}$/.test(d.segment) && d.cut >= 1), '對齊單帶段號和切序');
eq(stats.episodes[0].withLines, 10, '臺詞段計數——本樣例每段都帶臺詞，純畫面收在分鏡級');
eq(paramsOf({}).maxSegmentSeconds, DEFAULT_PARAMS.maxSegmentSeconds, '預設段上限 15 秒');
eq(paramsOf({}).maxCutSeconds, 5, '預設分鏡上限 5 秒');
eq(paramsOf({ params: { maxCutSeconds: 4 } }).maxCutSeconds, 4, '分鏡上限可調');

/* ---------------- 品質門：全綠基線 ---------------- */

ok(gateReport(FIXTURE, CTX).every((g) => g.ok), '樣例帶全部上游全部門通過');
eq(gateReport(FIXTURE, CTX).length, 18, '十八道門');
{
  const gates = gateReport(FIXTURE, {});
  ok(gates.every((g) => g.ok), '不帶上游也透過（對賬門跳過）');
  ok(gates.find((g) => g.id === 'coverage').detail.includes('跳過'), '跳過要明說，不靜默');
}

/* ---------------- 品質門：逐門擊穿 ---------------- */

// coverage — 沒人認領 / 重複認領 / 區間不合法 / 整場沒分鏡 / 順序倒退
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[3].beats = [5, 5]; // 第 4 拍失去認領
  const g = gate(doc, 'coverage');
  ok(!g.ok, '有節拍沒人認領被攔');
  ok(g.detail.includes('沒人認領'), '點名到拍');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[3].beats = [3, 5]; // 第 3 拍被兩切認領
  ok(gate(doc, 'coverage').detail.includes('重複認領'), '重複認領點得出切號');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].beats = [1, 99];
  ok(!gate(doc, 'coverage').ok, '節拍區間越界被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments = doc.episodes[0].segments.filter((s) => s.sceneIndex !== 1);
  ok(gate(doc, 'coverage').detail.includes('整場沒有分鏡'), '整場空白被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[1].sceneIndex = 2; // E01-03 變成場次倒退
  ok(!gate(doc, 'coverage').ok, '場次順序穿插被攔');
}
// segment-cap
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 15; // 段總秒數 27
  const g = gate(doc, 'segment-cap');
  ok(!g.ok, '段超 15 秒被攔');
  ok(g.detail.includes('E01-01'), '點名到段');
}
// cut-length
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 1;
  ok(!gate(doc, 'cut-length').ok, '分鏡短於 2 秒被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 6;
  const g = gate(doc, 'cut-length');
  ok(!g.ok, '分鏡超 5 秒被攔——3 秒節奏是硬門');
  ok(g.detail.includes('E01-01#1'), '點名到切');
}
{
  const doc = clone(FIXTURE);
  doc.params = { maxCutSeconds: 3 };
  ok(!gate(doc, 'cut-length').ok, '上限收緊到 3 秒後原樣例不再達標');
}
// dialogue-fit
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments.find((s) => s.id === 'E01-05');
  seg.cuts[0].seconds = 4; // 臺詞 4.4 秒
  const g = gate(doc, 'dialogue-fit');
  ok(!g.ok, '臺詞裝不進分鏡被攔');
  ok(g.detail.includes('E01-05#1'), '點名到切');
}
// ep-duration
{
  const doc = clone(FIXTURE);
  for (const s of doc.episodes[0].segments) for (const c of s.cuts) c.seconds = Math.min(5, c.seconds + 2);
  ok(gate(doc, 'ep-duration').detail.includes('超'), '寫超總時長被攔');
}
{
  const doc = clone(FIXTURE);
  for (const s of doc.episodes[0].segments) for (const c of s.cuts) c.seconds = Math.max(2, c.seconds - 2);
  ok(gate(doc, 'ep-duration').detail.includes('欠'), '寫欠總時長被攔');
}
// crowd
{
  const doc = clone(FIXTURE);
  const cut = doc.episodes[0].segments.find((s) => s.id === 'E01-09').cuts[2];
  cut.characters = ['C01', 'C02', 'C03', 'C04'];
  ok(!gate(doc, 'crowd').ok, '四人同框無拆解說明被攔');
  cut.note = '全景交代後立刻切正反打';
  ok(gate(doc, 'crowd').ok, '帶拆解說明就放行');
}
// segment-id
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[3].id = 'E01-99';
  const g = gate(doc, 'segment-id');
  ok(!g.ok, '斷號被攔');
  ok(g.detail.includes('E01-04'), '報出應有的段號');
}
// size-phrase
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = '濃霧清晨的河岸土路，沈知微抱著舊皮箱';
  ok(!gate(doc, 'size-phrase').ok, '分鏡圖提示詞缺景別詞被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].size = '大遠景';
  ok(!gate(doc, 'size-phrase').ok, '景別不在列舉裡被攔');
}
// camera-phrase
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].camera = '推';
  ok(!gate(doc, 'camera-phrase').ok, '運鏡不在 H3 詞表裡被攔');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('a tracking shot follows her', 'the camera follows her');
  const g = gate(doc, 'camera-phrase');
  ok(!g.ok, '運鏡詞沒寫進自己的 [Shot k] 段落被攔');
  ok(g.detail.includes('E01-01#1'), '點名到切');
}
// h3-structure — 對齊指令由分鏡結構推導，逐字對賬
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 4; // 時長改了、提示詞沒跟著改
  ok(gate(doc, 'h3-structure').detail.includes('對不上'), '分鏡秒數一改，舊對齊指令立刻對不上');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('[Shot 2] At 00:03.000,', '[Shot 2] At 00:03.500,');
  const g = gate(doc, 'h3-structure');
  ok(!g.ok, '切點時刻和分鏡秒數累計不一致被攔');
  ok(g.detail.includes('切點時刻'), '報出哪一處時刻錯了');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('overall_soundscape:', 'ambient_sound:');
  ok(gate(doc, 'h3-structure').detail.includes('核心欄位'), '三欄位缺失被攔');
}
// h3-dialogue
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('上船嘍——過河的抓緊，霧要變天。', 'the ferryman calls out.');
  const g = gate(doc, 'h3-dialogue');
  ok(!g.ok, '臺詞沒進 <d> 塊被攔');
  ok(gate(doc, 'h3-dialogue', {}).detail.includes('跳過'), '沒給劇本時本門跳過並明說');
}
// h3-lang — 語言與設定雙向對賬（預設英文 = 官方口徑）
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].h3Prompt += ' 濃霧瀰漫。';
  ok(!gate(doc, 'h3-lang').ok, '英文提示詞在 <d> 臺詞之外混中文被攔');
}
{
  const doc = clone(FIXTURE);
  doc.promptLang = 'zh';
  ok(!gate(doc, 'h3-lang').ok, '設定中文、正文卻是英文被攔——語言開關雙向都管');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].h3Prompt = doc.episodes[0].segments[0].h3Prompt.replace('the old ferryman squatting', '老周 squatting');
  ok(!gate(doc, 'prompt-no-names').ok, '英文模式下 H3 提示詞裡的人名被攔');
}
{
  const doc = clone(FIXTURE);
  doc.promptLang = 'zh';
  doc.episodes[0].segments[0].h3Prompt += ' 老周站在船頭。';
  ok(!gate(doc, 'prompt-no-names').ok, '中文模式 H3 提示詞同樣禁人名——官方規範，不跟著語言變');
}
eq(h3Remainder('a <d>[Chinese] 你好</d> b "營業中" c'), 'a   b   c', 'h3Remainder 剔除 <d> 塊與畫面文字');
// frame-prompt
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = 'medium shot of a young woman running through fog';
  ok(!gate(doc, 'frame-prompt').ok, '分鏡圖提示詞寫成英文被攔——它是中文');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = '  ';
  ok(!gate(doc, 'frame-prompt').ok, '空分鏡圖提示詞被攔');
}
// prompt-no-names：分鏡圖直呼其名，影片正文禁名
ok(FIXTURE.episodes[0].segments[0].cuts[0].frame.includes('沈知微'), '樣例的分鏡圖提示詞直呼其名');
ok(gate(FIXTURE, 'prompt-no-names').ok, '分鏡圖提示詞裡的名字放行——它指向掛上去的那張設定圖');
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].shot += '，沈知微回頭看了一眼';
  const g = gate(doc, 'prompt-no-names');
  ok(!g.ok, 'Seedance 鏡頭正文出現角色名被攔');
  ok(g.detail.includes('E01-01#1'), '點名到切');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[1].shot += '，老伯蹲著'; // cast 裡的別名
  ok(!gate(doc, 'prompt-no-names').ok, '角色別名也攔');
}
// composition
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].segments[2].blocking;
  const g = gate(doc, 'composition');
  ok(!g.ok, '段缺 blocking 被攔——純參考圖出片時它是唯一說清人在哪的地方');
  ok(g.detail.includes('E01-03'), '點名到段');
}
{
  const doc = clone(FIXTURE);
  delete doc.episodes[0].segments[0].cuts[2].lens;
  delete doc.episodes[0].segments[0].cuts[2].eyeline;
  const g = gate(doc, 'composition');
  ok(!g.ok && g.detail.includes('E01-01#3') && g.detail.includes('lens / eyeline'), '缺哪幾項逐項點名');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].stability = '晃';
  ok(!gate(doc, 'composition').ok, 'stability 不在列舉裡被攔');
}
// seedance-shot
for (const [bad, why] of [
  ['', '缺鏡頭正文'],
  ['A young woman runs through the fog.', '英文'],
  ['年輕女子跑了 3 秒', '寫了秒數'],
  ['00:03 年輕女子停下', '寫了時間碼'],
  ['【鏡頭1】年輕女子停下', '寫了鏡頭編號'],
  ['年輕女子停下（構圖參考 @圖片2）', '寫了圖片引用'],
  ['[Shot 2] 年輕女子停下', '寫了 H3 標記'],
  ['年輕女子說{不勞煩}', '臺詞自己寫了 {}'],
]) {
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].shot = bad;
  ok(!gate(doc, 'seedance-shot').ok, `Seedance 鏡頭正文${why}被攔`);
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].soundscape = '<腳步聲>';
  doc.episodes[0].segments[0].music = '（低音絃樂）';
  const g = gate(doc, 'seedance-shot');
  ok(!g.ok && g.detail.includes('soundscape') && g.detail.includes('music'), '聲景與配樂自帶符號被攔——程式會套');
}
// refs
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].characters = ['C05'];
  ok(!gate(doc, 'refs').ok, '不在該場的人物被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].props = ['P02'];
  ok(!gate(doc, 'refs').ok, '不在該場的道具被攔');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].sceneIndex = 9;
  ok(!gate(doc, 'refs').ok, '不存在的場次被攔');
}

/* ---------------- 鏡頭配方卡庫（可選掛載） ---------------- */
/*
 * 受限 frontmatter 解析是本 skill 自己寫的（刻意不 import shot-recipes.mjs，
 * 兩個 skill 誰沒有誰都能跑），所以解析器、載入器、門三層都要有斷言。
 */

{
  const card = parseCardFields(`---
id: demo-card
name: 演示卡
name_en: Demo Card
category: dialogue
cuts: [2, 3]
sizes: [medium, close]
cameras: [Static Shot, Push In]
must_phrases: [over-the-shoulder, blurred foreground shoulder]
---

## 意圖

正文一概不讀。
`);
  eq(card.id, 'demo-card', '受限解析取到 id');
  eq(card.name_en, 'Demo Card', '英文卡名也是機器欄位');
  eq(card.cuts.join(','), '2,3', '行內陣列裡的整數轉成數字');
  eq(card.must_phrases.length, 2, '必備短語按逗號切開');
  eq(card.category, undefined, '門用不到的欄位一概不收');
  eq(parseCardFields('沒有 frontmatter'), null, '沒有 frontmatter 就不是卡片');
  eq(parseCardFields('---\nname: 無 id\n---\n'), null, '沒有 id 就不是卡片');
}

const CARDS = loadRecipes(join(here, '../references/test-fixtures/shot-recipes'));

/* ---------------- 提示詞規範的分層 ---------------- */

// 鏡頭正文的內容規則只在 shot-writing.md 寫一遍；兩份協議規範都以它為前提。
// 以前 H3 那份有「常見動作原則」而 Seedance 那份沒有——兩份副本必然發生的事。
{
  const refs = join(here, '../references');
  const common = readFileSync(join(refs, 'shot-writing.md'), 'utf8');
  const h3 = readFileSync(join(refs, 'h3-prompt.md'), 'utf8');
  const seedance = readFileSync(join(refs, 'seedance-prompt.md'), 'utf8');
  ok(common.includes('常見動作原則'), '共同層寫了常見動作原則');
  ok(h3.includes('shot-writing.md') && seedance.includes('shot-writing.md'), '兩份協議規範都指向共同層');
  // 畫風由呼叫方在出片時附加；寫死在結構示例裡，模型會照抄
  ok(!/cold gray-green|冷灰綠|Cinematic, live-action/.test(h3), 'H3 規範的示例裡不再寫死畫風');
  // Seedance 的時間軸與編號由程式拼，正文裡出現就會重複或錯位
  // 規範裡會點名那些不許出現的標記；把帶禁止詞的行整行去掉後，剩下的正文不該再有它們
  const seedanceTaught = seedance.split('\n').filter((line) => !/不寫|不加|不用|不要|禁/.test(line)).join('\n');
  ok(!/\[Shot \d|<Picture|<d>/.test(seedanceTaught), 'Seedance 規範不教 H3 語法（禁止列舉除外）');
  // 官方符號規範：臺詞 {}、音效 <>、音樂（）。中文引號是我們以前自己編的
  ok(/臺詞[^\n]*`\{\}`/.test(seedance), 'Seedance 規範採用官方的 {} 臺詞符號');
  ok(/音效[^\n]*`<>`/.test(seedance) && /音樂[^\n]*`（）`/.test(seedance), 'Seedance 規範採用官方的 <> 與（）符號');
  // 官方明說精確秒數不穩定，時間層用鏡頭順序
  ok(/不寫[^\n]*0–3 秒/.test(seedance), 'Seedance 規範禁止正文寫秒數');
  ok(/一個鏡頭只指定一種運鏡/.test(seedance), 'Seedance 規範要求單一運鏡');
  ok(/不用三檢視/.test(seedance), 'Seedance 規範禁用多檢視參考');
  // 動作四條住在共同層，兩邊共用
  ok(/情緒外化/.test(common) && /肢體細化/.test(common), '共同層併入了官方的動作寫法');
}
eq(CARDS.size, 3, '最小卡片夾具三張全讀出');
ok(CARDS.get('ots-shot-reverse').must_phrases.includes('over-the-shoulder'), '真實卡片的必備短語讀得出來');
eq(CARDS.get('ots-shot-reverse').cuts[0], 2, '真實卡片的格數下限讀得出來');
eq(loadRecipes(join(here, '../不存在的目錄')).size, 0, '目錄不存在不崩');

const SHOTS = { ...CTX, recipes: CARDS };
// 合規引用：兩格連排的過肩正反打，必備短語逐條進 frame
const withRecipe = () => {
  const doc = clone(FIXTURE);
  const cuts = doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts;
  for (const i of [0, 1]) {
    cuts[i].recipe = 'ots-shot-reverse';
    cuts[i].frame += ', over-the-shoulder framing with a blurred foreground shoulder';
  }
  return doc;
};

// 跳過條件是「沒給 --shots」，不是「沒有 cut 帶 recipe」
{
  const g = gate(FIXTURE, 'shot-recipe');
  ok(g.ok, '沒掛卡庫本門通過');
  ok(g.detail.includes('跳過'), '跳過要明說，不靜默');
}
{
  // 夾具本身有兩處真實引用（E01-06#1 hands-tell / E01-09#1 insert-beat），
  // 所以「全篇沒引用」這一條要拿剝掉 recipe 的副本來試
  const bare = JSON.parse(JSON.stringify(FIXTURE));
  for (const s of bare.episodes.flatMap((e) => e.segments)) for (const c of s.cuts) delete c.recipe;
  const g = gate(bare, 'shot-recipe', SHOTS);
  ok(g.ok, '掛了卡庫但全篇沒引用配方也算透過');
  eq(g.detail, '本批分鏡沒有引用配方', '沒引用同樣明說，不靜默');
}
{
  // 樣例即規範：夾具裡真的掛了配方，而且掛了之後這道門是過的
  const refs = FIXTURE.episodes.flatMap((e) => e.segments).flatMap((s) => s.cuts).filter((c) => c.recipe);
  eq(refs.length, 2, '夾具有兩處真實配方引用');
  const g = gate(FIXTURE, 'shot-recipe', SHOTS);
  ok(g.ok, '夾具的配方引用全過');
  eq(g.detail, '', '全過不留備註');
}
{
  const g = gate(withRecipe(), 'shot-recipe', SHOTS);
  ok(g.ok, '合規引用全過');
  eq(g.detail, '', '全過不留備註');
}
// 擊穿一：id 不在卡庫
{
  const doc = withRecipe();
  doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts[0].recipe = 'no-such-card';
  const g = gate(doc, 'shot-recipe', SHOTS);
  ok(!g.ok, '引用不存在的配方被攔');
  ok(g.detail.includes('E01-05#1') && g.detail.includes('不在配方庫裡'), '點名到段號#切序');
}
// 擊穿二：必備短語沒進 frame
{
  const doc = withRecipe();
  const cuts = doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts;
  cuts[1].frame = cuts[1].frame.replace('blurred foreground shoulder', 'soft foreground');
  const g = gate(doc, 'shot-recipe', SHOTS);
  ok(!g.ok, '必備短語沒進分鏡圖提示詞被攔');
  ok(g.detail.includes('E01-05#2'), '點名到切');
  ok(g.detail.includes('過肩正反打') && g.detail.includes('blurred foreground shoulder'), '配方名 + 缺的短語原文——與 shot-recipes 的 check 措辭一致');
}
{
  const doc = withRecipe();
  const cuts = doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts;
  cuts[0].frame = cuts[0].frame.replace('over-the-shoulder', 'Over-The-Shoulder');
  ok(gate(doc, 'shot-recipe', SHOTS).ok, '短語判定兩邊小寫化，大小寫不影響');
}
// 擊穿三：多格配方的連排長度不夠
{
  const doc = withRecipe();
  delete doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts[1].recipe;
  const g = gate(doc, 'shot-recipe', SHOTS);
  ok(!g.ok, '兩格配方只掛一格被攔');
  ok(g.detail.includes('E01-05#1') && g.detail.includes('要 2 格連排'), '多格配方靠連續同 recipe 的分鏡表達');
}
// 建議景別／運鏡不設門，只在報告裡提示偏離
{
  const doc = withRecipe();
  const cut = doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts[0];
  cut.size = 'extreme-wide';
  ok(gate(doc, 'shot-recipe', SHOTS).ok, '建議景別偏離不設門——配方是語彙不是法條');
  const d = recipeDrift(cut, CARDS.get('ots-shot-reverse'));
  eq(d.sizes.join(' / '), 'medium / close', '偏離時報出建議景別');
  eq(d.cameras.length, 0, '運鏡沒偏離就不報');
  eq(recipeDrift(cut, null).sizes.length, 0, '沒有卡片就沒有偏離可言');
}
// recipe 不進結構檢查——照 note 這個可選欄位的先例辦
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].recipe = 'no-such-card';
  eq(validateStoryboard(doc, CTX).length, 0, '不掛卡庫時 recipe 不進結構檢查');
}

/* ---------------- 門失敗累積 ---------------- */

// 每次 validate 的結果本來跑完就沒了，「模型最常違反哪條規則」只能靠印象。
// 純函式 + CLI 負責 IO，所以這裡不落盤也能驗。
{
  const gates = [
    { id: 'cut-length', label: '每個分鏡 2–5 秒', ok: false, detail: 'E01-01#1 9 秒' },
    { id: 'coverage', label: '節拍全覆蓋', ok: true, detail: '' },
    { id: 'segment-cap', label: '每段 ≤ 15 秒', ok: false, detail: 'E01-01 共 21 秒' },
  ];
  const rows = gateLogEntries(gates, { doc: 'x.json', at: 'T0' });
  eq(rows.length, 3, '一次執行記一條 run + 每條失敗一行');
  eq(rows[0].kind, 'run', '第一行是執行記錄');
  eq(rows[0].gates, 3, 'run 記下這次跑了幾道門');
  eq(rows[0].failed, 2, 'run 記下這次掛了幾道');
  ok(rows.slice(1).every((r) => r.kind === 'fail'), '其餘都是失敗記錄');
  ok(rows.every((r) => r.at === 'T0' && r.doc === 'x.json'), '時間與文件名逐行帶上');
  eq(gateLogEntries([], {}).length, 0, '沒有門就不寫任何東西');

  const all = ['cut-length', 'coverage', 'segment-cap', 'refs'];
  const sum = summarizeGateLog([...rows, ...gateLogEntries(gates, { doc: 'y.json', at: 'T1' })], all);
  eq(sum.runs, 2, '統計跑過幾次');
  eq(sum.cleanRuns, 0, '統計全過幾次');
  eq(sum.fails, 4, '統計累計失敗條數');
  eq(sum.ranked[0].gate, 'cut-length', '按失敗次數排序，最常響的在前');
  eq(sum.ranked[0].count, 2, '同一道門跨執行累加');
  ok(sum.ranked[0].samples.length >= 1, '帶上 detail 樣本，供人看有沒有該設而沒設的門');
  eq(sum.silent.join(','), 'coverage,refs', '從沒響過的門列出來——可能是死門，也可能規則已被內化');
  eq(summarizeGateLog([], all).silent.length, 4, '零日誌時所有門都算沒響過');
  eq(summarizeGateLog([null, 'x', { kind: 'run', failed: 0 }], all).runs, 1, '壞行跳過不炸');
}
eq(GATE_LOG, '.gates.jsonl', '日誌檔名固定');

/* ---------------- Seedance 提示詞（程式拼） ---------------- */

{
  const names = {
    char: (id) => new Map(OUTLINE.characters.map((c) => [c.id, c.name])).get(id) ?? id,
    scene: (id) => new Map(ART.scenes.map((x) => [x.id, x.name])).get(id) ?? id,
    prop: (id) => new Map(ART.props.map((x) => [x.id, x.name])).get(id) ?? id,
  };
  const ep1 = expandScript(SCRIPT).get(1);
  const segOf = (id) => FIXTURE.episodes[0].segments.find((x) => x.id === id);
  const sceneOf = (seg) => ep1.scenes[seg.sceneIndex - 1];
  const build = (id, extra = {}) => {
    const seg = segOf(id);
    return seedancePrompt(seg, { scene: sceneOf(seg), names, ...extra });
  };

  // 參考圖路徑（沒有分鏡圖）：場景 → 人物 → 道具，名字就是附件標籤
  const e06 = build('E01-06');
  eq(e06.refs.map((r) => r.label).join(','), '渡船船艙,沈知微,胡二爺,老周,舊皮箱', '附件順序：場景 → 人物（首次出場序）→ 道具');
  ok(e06.prompt.startsWith('@[圖片1] = 渡船船艙\n@[圖片2] = 沈知微'), '先宣告參考圖，編號按附件順序');
  ok(e06.refs.every((r) => r.kind === 'sheet' && r.file.endsWith('-sheet.png')), '參考圖路徑掛的是設定圖');
  ok(e06.prompt.includes(`【人物關係與構圖邏輯】\n${segOf('E01-06').blocking}`), '段級走位原樣進');
  eq((e06.prompt.match(/【鏡頭\d+】/g) ?? []).length, 4, '每切一個【鏡頭k】，編號由程式加');
  ok(!/\d+(\.\d+)?\s*秒|\d{2}:\d{2}/.test(e06.prompt), '全文不寫秒數——時間層用鏡頭順序表達');
  ok(e06.prompt.includes('運鏡：固定鏡頭\n景別：特寫'), '運鏡與景別用中文詞');
  ok(e06.prompt.includes('臺詞：{船上有個規矩——不問來路，不碰行李。}'), '認領的臺詞逐字進 {}');
  ok(e06.prompt.includes('【鏡頭1】') && e06.prompt.split('【鏡頭2】')[0].includes('臺詞：{}'), '不說話的鏡頭寫 {}');
  ok(e06.prompt.includes('音效：手掌拍在皮面上的一聲悶響'), '鏡級音效有才出');
  eq((e06.prompt.match(/^音效：/gm) ?? []).length, 1, '沒填 sfx 的鏡頭沒有音效行');
  ok(e06.prompt.includes('穩定性：穩定'), '穩定性列舉轉中文');
  ok(e06.prompt.includes(`<${segOf('E01-06').soundscape}>`), '段級聲景套 <>');
  ok(!/^（/m.test(e06.prompt), '沒有配樂就沒有配樂行');
  ok(e06.prompt.endsWith(`【約束】\n1. ${SEEDANCE_NO_SUBTITLES}\n2. ${SEEDANCE_NO_TWINS}`), '約束編號：無字幕；多人同框加禁雙胞胎');
  ok(!/視覺風格|畫風|cinematic/i.test(e06.prompt), '不寫畫風——視覺風格由呼叫方附加');

  // 畫外音：{} 外面標「以畫外音說」
  ok(build('E01-10').prompt.includes('臺詞：以畫外音說{誰都別碰它。到了縣城，它就是我全部的話。}'), '畫外音按官方寫法標在 {} 外');
  // 配樂套（）
  ok(build('E01-09').prompt.includes(`（${segOf('E01-09').music}）`), '段級配樂套（）');
  // 單人段不加禁雙胞胎；呼叫方約束排在前面、不重複
  {
    const e10 = build('E01-10', { constraints: ['畫面比例 16:9', SEEDANCE_NO_SUBTITLES] });
    ok(e10.prompt.endsWith(`【約束】\n1. 畫面比例 16:9\n2. ${SEEDANCE_NO_SUBTITLES}`), '呼叫方約束在前、預設約束不重複、單人段不加禁雙胞胎');
  }
  // 光影：鏡級有才出
  ok(build('E01-10').prompt.includes('光影：遠處一點暖黃燈光熄滅後只剩銅釦的冷光'), '鏡級光影有才出');

  // 分鏡路徑：這一段每切都有分鏡圖 → 只掛分鏡圖，並在畫面行註明構圖參考
  {
    const all = build('E01-10', { image: (kind, rel) => (kind === 'frame' ? rel : null) });
    eq(all.refs.map((r) => r.file).join(','), 'E01-10/f1.png,E01-10/f2.png', '分鏡路徑只掛分鏡圖');
    ok(all.prompt.includes('（構圖參考 @圖片1）') && all.prompt.includes('（構圖參考 @圖片2）'), '每鏡註明構圖參考哪張');
  }
  {
    const part = build('E01-10', { image: (kind, rel) => (rel === 'E01-10/f2.png' ? rel : null) });
    eq(part.refs.map((r) => r.kind).join(','), 'sheet,sheet,sheet,frame', '分鏡圖不全：設定圖在前，已有的分鏡圖接在後面');
    ok(part.prompt.includes('（構圖參考 @圖片4）') && !part.prompt.split('【鏡頭2】')[0].includes('構圖參考'), '只有有圖的那一鏡註明構圖參考');
  }
  // 名字只出現在附件宣告與走位裡，鏡頭正文不出現
  {
    const body = e06.prompt.split('【鏡頭1】')[1];
    ok(!['沈知微', '胡二爺', '老周'].some((n) => body.includes(n)), '逐鏡正文不含角色名');
  }
}

/* ---------------- exportPack（H3 投產包） ---------------- */

{
  const pack = exportPack(FIXTURE, SCRIPT, { imageExists: () => false });
  eq(pack.files.length, 11, '十段 prompt.md + 一份 manifest');
  ok(pack.files.some((f) => f.path === 'E01-01/prompt.md'), '每段一個資料夾裡的 prompt.md');
  const p01 = pack.files.find((f) => f.path === 'E01-01/prompt.md');
  ok(p01.content.startsWith('# E01-01 · H3 提示詞'), 'prompt.md 帶標題');
  ok(p01.content.includes('Picture 1 = f1.png（**首幀**，釘 0.00 秒）'), '明確指定哪個檔案是首幀');
  ok(p01.content.includes('Picture 4 = f4.png（釘 10.00 秒）'), '每張圖的切點秒數寫明');
  ok(p01.content.includes('---\n\nHow the reference pictures align'), '分隔線以下是 h3Prompt 原樣（官方英文口徑）');
  ok(!JSON.stringify(pack).includes('recipe'), '配方是創作期語彙，H3 投產包裡沒有它的位置');
  const m = pack.manifest.find((x) => x.segment === 'E01-01');
  eq(m.pictures.join(','), 'E01-01/f1.png,E01-01/f2.png,E01-01/f3.png,E01-01/f4.png', 'Picture 序 = 資料夾裡的 f1..fn');
  eq(m.cutStarts.join(','), '0,3,6,10', 'manifest 帶切點時刻表');
  eq(m.missing.length, 4, '缺圖逐張標註');
  ok(pack.missingTotal > 0, '缺圖總數上報');
}
{
  const pack = exportPack(FIXTURE, SCRIPT, { imageExists: () => true, dir: 'out' });
  eq(pack.missingTotal, 0, '圖齊了就沒有缺圖示註');
  ok(pack.files.some((f) => f.path === 'out/manifest.json'), '--out 改匯出目錄');
  ok(pack.files.some((f) => f.path === 'out/E01-01/prompt.md'), '段資料夾跟著 --out 走');
}

/* ---------------- exportPack（Seedance 投產包） ---------------- */

{
  const names = { char: (id) => new Map(OUTLINE.characters.map((c) => [c.id, c.name])).get(id) ?? id };
  const pack = exportPack(FIXTURE, SCRIPT, { protocol: 'seedance', names, sheetExists: (f) => f === '沈知微-sheet.png', dir: 'sd' });
  eq(pack.files.length, 11, '十段 seedance.md + 一份 seedance-manifest.json');
  ok(pack.files.some((f) => f.path === 'sd/seedance-manifest.json'), 'Seedance 的 manifest 另起名字，不跟 H3 撞');
  ok(!pack.files.some((f) => f.path.endsWith('prompt.md')), 'Seedance 包裡沒有 H3 的 prompt.md');
  const md = pack.files.find((f) => f.path === 'sd/E01-06/seedance.md').content;
  ok(md.startsWith('# E01-06 · Seedance 提示詞'), 'seedance.md 帶標題');
  ok(md.includes('- @圖片2 = 沈知微 → ref-2.png'), '頭部列出每個附件對應的包內檔案');
  ok(md.includes('- @圖片3 = 胡二爺 → ref-3.png（缺）'), '找不到的附件標「缺」');
  ok(md.includes('視覺風格（畫風層）在提交時附加'), '明說畫風不在包裡');
  ok(md.includes('---\n\n@[圖片1] = S01'), '分隔線以下是程式拼的提示詞，不給 art 時場景退回 ID');
  const m = pack.manifest.find((x) => x.segment === 'E01-06');
  eq(m.attachments.length, 5, '附件逐個列出');
  eq(m.attachments[1].path, 'sd/E01-06/ref-2.png', '設定圖拷成 ref-<n>.png');
  eq(m.missing.length, 4, '缺的附件逐個標註');
  ok(pack.copies.some((c) => c.file === '沈知微-sheet.png' && c.to === 'sd/E01-06/ref-2.png'), '找得到的設定圖交給 CLI 拷進包');
  ok(!JSON.stringify(pack).includes('recipe'), '配方同樣不進 Seedance 包');
}
{
  // 分鏡圖齊了走分鏡路徑：附件就是包裡的 f<k>.png，不再掛設定圖
  const pack = exportPack(FIXTURE, SCRIPT, { protocol: 'seedance', imageExists: () => true });
  const m = pack.manifest.find((x) => x.segment === 'E01-01');
  eq(m.attachments.map((a) => a.path).join(','), 'E01-01/f1.png,E01-01/f2.png,E01-01/f3.png,E01-01/f4.png', '分鏡路徑的附件就是分鏡圖');
  eq(pack.missingTotal, 0, '圖齊了沒有缺件');
  eq(pack.copies.length, 0, '分鏡路徑不拷設定圖');
}

/* ---------------- validateStoryboard 結構檢查 ---------------- */

eq(validateStoryboard(FIXTURE, CTX).length, 0, '樣例零違規');
ok(validateStoryboard(null).length > 0, 'null 不崩');
ok(validateStoryboard({}).some((p) => p.includes('source')), '缺 source 報出來');
ok(validateStoryboard({ source: 'x', episodes: [] }).some((p) => p.includes('episodes')), '空 episodes 報出來');
{
  const doc = clone(FIXTURE);
  doc.aspectRatio = '1:1';
  ok(validateStoryboard(doc, CTX).some((p) => p.includes('aspectRatio')), '正式畫幅只接受 16:9 或 9:16');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0] = { id: 'E01-01' };
  const problems = validateStoryboard(doc, CTX);
  ok(problems.some((p) => p.includes('sceneIndex')), '缺 sceneIndex 報出來');
  ok(problems.some((p) => p.includes('h3Prompt')), '缺 H3 提示詞報出來');
  ok(problems.some((p) => p.includes('沒有分鏡')), '缺 cuts 報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0] = { beats: [1, 1] };
  const problems = validateStoryboard(doc, CTX);
  ok(problems.some((p) => p.includes('seconds')), '分鏡缺秒數報出來');
  ok(problems.some((p) => p.includes('frame')), '分鏡缺分鏡圖提示詞報出來');
}
{
  const doc = clone(FIXTURE);
  doc.episodes.push(clone(doc.episodes[0]));
  ok(validateStoryboard(doc, CTX).some((p) => p.includes('重複')), '重複集號報出來');
}

/* ---------------- seed ---------------- */

const seeded = seedFromScript(SCRIPT);
eq(seeded.source, '渡口', 'seed 帶劇名');
eq(seeded.aspectRatio, '16:9', 'seed 預設寫入正式橫屏畫幅');
eq(seeded.episodes.length, 6, 'seed 全六集');
eq(seeded.episodes[0].segments.length, 0, 'segments 留空給模型切');
eq(seeded.episodes[0].seedScenes.length, 2, '工作底稿帶兩場');
eq(seeded.episodes[0].seedScenes[0].beats.length, 13, '底稿帶全部節拍');
ok(seeded.episodes[0].seedScenes[0].beats[0].seconds > 0, '每拍帶秒數');
eq(seedFromScript(SCRIPT, [2, 3]).episodes.map((e) => e.ep).join(','), '2,3', '--eps 區間過濾');
eq(seedFromScript(SCRIPT, null, '9:16').aspectRatio, '9:16', '--aspect 寫入正式豎屏畫幅');
ok((() => { try { seedFromScript(SCRIPT, null, '1:1'); return false; } catch (e) { return /aspectRatio/.test(e.message); } })(), 'seed 拒絕不支援的畫幅');
eq(seedFromScript({}).episodes.length, 0, '空劇本不崩');

/* ---------------- slug / 列舉 ---------------- */

eq(slug('渡口'), '渡口', '中文原樣');
eq(slug('  '), 'storyboard', '空名兜底');
ok(Object.values(SHOT_SIZES).every((s) => s.zh && s.phrase), '景別列舉帶中文名與英文短語');
ok(Object.keys(CAMERA_MOVES).length >= 18, '運鏡詞表覆蓋 H3 全部動作型別');
ok(CAMERA_MOVES['Static Shot'] === '固定' && CAMERA_MOVES['Push In'] === '推', '運鏡詞表中英對照');

/* ---------------- render markdown ---------------- */

const md = renderMarkdown(FIXTURE, CTX);
ok(md.includes('# 渡口 · 分鏡（第 1 集）'), 'md 標題');
ok(md.includes('### E01-01 · 渡口棧橋（濃霧清晨）'), 'md 段頭帶場景名與光照');
ok(md.includes('H3 影片提示詞'), 'md 帶逐段 H3 提示詞');
ok(md.includes('How the reference pictures align'), '多分鏡段的對齊指令完整可複製');
ok(md.includes('[Shot 2] At 00:03.000,'), '切點時刻原樣進 md');
ok(md.includes('老周'), 'md 說話人顯示名字');
eq((md.match(/\*\*Seedance 影片提示詞\*\*/g) ?? []).length, 10, 'md 每段附 Seedance 提示詞');
ok(md.includes(`> 走位：${FIXTURE.episodes[0].segments[0].blocking}`), 'md 每段帶走位');
ok(md.includes('生成批次單') && md.includes('配音對齊單'), 'md 帶兩張工單');
ok(renderMarkdown(FIXTURE, { script: SCRIPT }).includes('C03'), '不給 outline 退回裸 ID');

/* ---------------- render html ---------------- */

const html = renderHtml(FIXTURE, CTX);
ok(html.includes('<!doctype html>'), 'html 完整文件');
ok(!/src="http|href="http|@import|url\(http/.test(html), '零外部資源');
ok(html.includes('分鏡節奏帶'), '01 分鏡節奏帶');
ok(html.includes('分集分鏡表'), '02 分集分鏡表');
ok(html.includes('生成批次單'), '03 生成批次單');
ok(html.includes('配音對齊單'), '04 配音對齊單');
ok(html.includes('✓ 品質門 18 / 18'), '頁首徽章全綠');
// 提示詞面板：H3 與 Seedance 兩個頁籤並列，預設 H3；複製鍵跟著當前頁籤（前端切換時改 data-copy）
eq((html.match(/<button class="ptab on" data-i="0">H3 提示詞<\/button><button class="ptab" data-i="1">Seedance 提示詞<\/button>/g) ?? []).length, 10, '每段都有 H3 / Seedance 兩個頁籤');
eq((html.match(/<pre class="pp">@\[圖片1\] = /g) ?? []).length, 10, '每段都有程式拼好的 Seedance 提示詞');
ok(html.includes("panel.querySelector('.pp-h .copy').dataset.copy"), '切頁籤時複製鍵換成當前那一份');
ok(html.includes(`<p class="seg-block"><b>走位</b>${FIXTURE.episodes[0].segments[0].blocking}</p>`), '段卡顯示走位');
ok(html.includes('<p class="scomp">35mm 廣角，中景深 · 年輕女子 + 背後平視跟隨 · 中心構圖 · 視線 前方霧中 · 焦點 鎖定年輕女子背影與懷中皮箱 · 微晃</p>'), '切行顯示構圖量化欄位');
ok(html.includes('class="rseg"'), '節奏帶按段分組（粗分隔）');
ok(html.includes('#seg-E01-01'), '節奏帶段可跳轉');
ok(html.includes('主分鏡圖 · #1 未生成'), '主分鏡圖缺圖時顯示佔位不裝有');
ok(html.includes('#2 未生成'), '子分鏡圖缺圖有小佔位');
// 主分鏡圖區：無圖時每切各佔一整行提示詞卡 + 複製按鈕（PR 核心目標）
{
  const nCuts = FIXTURE.episodes.reduce((n, e) => n + e.segments.reduce((m, s) => m + s.cuts.length, 0), 0);
  ok((html.match(/class="frame ph fcell"/g) ?? []).length === nCuts, '無圖時每切都是整寬提示詞卡');
  const c0 = FIXTURE.episodes[0].segments[0].cuts;
  ok(html.includes(`data-copy="${c0[0].frame}"`), '主分鏡格複製按鈕帶該切 frame 原文');
  ok(html.includes(`data-copy="${c0[1].frame}"`), '子分鏡格複製按鈕同樣帶 frame 原文');
}
ok(html.includes('class="shots clip"'), '段卡區預設截斷');
ok(html.includes('展開全部段'), '每集自帶展開按鈕');
ok(html.includes('H3 提示詞'), '段卡帶 H3 提示詞面板');
ok(html.includes('class="duo"'), '分鏡列表與提示詞面板五五分欄');
ok(html.includes('static shot'), '英文提示詞正文進面板');
ok(html.includes('integrated_multimodal_description'), '官方骨架欄位進面板');
ok(html.includes('[Shot 2] At'), '逐鏡換行的結構化正文進面板');
ok(html.includes('分鏡圖提示詞'), '每個分鏡帶分鏡圖提示詞複製按鈕');
ok(html.includes('id="lightbox"'), '點圖放大');
ok(html.includes('渡口-storyboard.json'), '匯出檔名');
ok(html.includes('批次 01'), '批次卡編號');
ok(html.includes('@media print'), '列印樣式');
ok(html.includes('老周'), 'html 裡 ID 換成名字');
{
  const withImg = renderHtml(FIXTURE, { ...CTX, image: (kind, rel) => rel });
  ok(withImg.includes('"E01-01/f1.png"'), '主分鏡圖從段資料夾讀');
  ok(withImg.includes('"E01-01/f2.png"'), '子分鏡圖同樣從段資料夾讀');
  ok(!withImg.includes('未生成'), '有圖時不再顯示佔位');
  ok(!withImg.includes('class="frame ph fcell"'), '圖出全時不再走整寬提示詞卡');
  ok(withImg.includes('class="subs"'), '圖出全時保留子分鏡條');
  ok(withImg.includes('class="subf"'), '子分鏡條用小縮圖');
}
// 分鏡圖位跟著正式畫幅走；舊 _meta 和 frame 尾綴只保留為相容路徑
{
  const styleOf = (h) => h.match(/<style>[\s\S]*?<\/style>/)[0];
  ok(html.includes('.frame{width:100%;aspect-ratio:16/9;') && !html.includes('aspect-ratio:9/16'), '預設橫屏：分鏡圖位 16:9，不插豎屏樣式');
  const defaulted = clone(FIXTURE);
  delete defaulted.aspectRatio;
  ok(styleOf(renderHtml(defaulted, CTX)) === styleOf(html), '省略正式畫幅時預設 16:9，樣式逐位元組不變');
  const port = clone(FIXTURE);
  port.aspectRatio = '9:16';
  const ph = renderHtml(port, { ...CTX, image: (kind, rel) => rel });
  ok(ph.includes('.frame,.subf{aspect-ratio:9/16}'), 'aspectRatio=9:16：主圖與子分鏡條圖位改 9:16');
  ok(ph.includes('img.frame{width:min(100%,300px)'), '豎屏主圖收窄，不撐成一屏多高');
  ok(ph.includes('.bimg{width:100%;aspect-ratio:16/9;'), '場景設定圖仍是 16:9，不跟劇的畫幅走');
  port._meta = { orientation: 'landscape' };
  ok(renderHtml(port, CTX).includes('aspect-ratio:9/16'), '正式 aspectRatio 比舊 _meta.orientation 優先');
  const legacy = clone(FIXTURE);
  delete legacy.aspectRatio;
  legacy._meta = { orientation: 'V' };
  ok(renderHtml(legacy, CTX).includes('aspect-ratio:9/16'), '舊 _meta.orientation 的簡寫 v 仍相容為豎屏');
  // 樣例的 frame 本身不帶畫幅標籤（畫幅由下游定），這裡照下游應用的寫法在末尾貼 `, 9:16`
  const tail = clone(FIXTURE);
  delete tail.aspectRatio;
  for (const ep of tail.episodes) for (const s of ep.segments) for (const c of s.cuts) c.frame = `${c.frame ?? ''}, 9:16`;
  ok(renderHtml(tail, CTX).includes('aspect-ratio:9/16'), '沒記 _meta 時按 frame 末尾的 9:16 標籤認豎屏');
  tail._meta = { orientation: 'landscape' };
  ok(!renderHtml(tail, CTX).includes('aspect-ratio:9/16'), '_meta.orientation 比 frame 標籤優先');
}
// 病灶橫幅
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 6;
  const h = renderHtml(doc, CTX);
  ok(h.includes('class="galert"'), '有門未過時頁頂掛病灶橫幅');
  ok(h.includes('gatepill fail'), '徽章翻紅');
}
// XSS：模型資料全部過 esc
{
  const doc = clone(FIXTURE);
  doc.source = '<script>alert(1)</script>';
  doc.episodes[0].segments[0].note = '<img src=x onerror=alert(1)>';
  const h = renderHtml(doc, { script: SCRIPT });
  ok(!h.includes('<script>alert(1)</script>'), '標題被轉義');
  ok(!h.includes('<img src=x'), 'note 被轉義');
  ok(h.includes('\\u003c'), '內嵌 JSON 的 < 轉成 \\u003c，防 </script 截斷');
}

/* ---------------- 報告介面語言（--lang，與 promptLang 獨立） ---------------- */

{
  const en = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(en.includes('<html lang="en">'), 'en 報告的 html lang 屬性跟著語言走');
  ok(en.includes('Export JSON'), 'en 介面：匯出按鈕英文');
  ok(en.includes('Quality gates 18 / 18'), 'en 介面：頁首徽章英文');
  ok(en.includes('>Seedance prompt</button>') && en.includes('<b>Blocking</b>') && en.includes('· slight shake</p>'), 'en 介面：頁籤、走位、穩定性都有英文標籤');
  ok(en.includes('Cut rhythm strip'), 'en 介面：節奏帶節標題英文');
  ok(en.includes('Segment cards'), 'en 介面：分鏡表節標題英文');
  ok(en.includes('Generation batches'), 'en 介面：批次節標題英文');
  ok(en.includes('Audio alignment'), 'en 介面：配音對齊節標題英文');
  ok(en.includes('master frame'), 'en 介面：主分鏡圖佔位標籤英文');
  ok(!en.includes('匯出 JSON'), 'en 介面不殘留中文匯出按鈕');
  ok(!en.includes('生成批次單'), 'en 介面不殘留中文批次標題');
  ok(!en.includes('配音對齊單'), 'en 介面不殘留中文對齊標題');
  ok(en.includes('How the reference pictures align'), 'en 介面下 H3 提示詞資料原樣不動');
  ok(en.includes('[Shot 2] At 00:03.000,'), 'en 介面下切點時刻資料原樣不動');
}
{
  const enMd = renderMarkdown(FIXTURE, { ...CTX, lang: 'en' });
  ok(enMd.includes('# 渡口 · Storyboard (Episode 1)') && enMd.includes('Audio alignment'), 'en markdown 標題與節標題英文');
}
{
  const zhAgain = renderHtml(FIXTURE, CTX);
  ok(zhAgain.includes('<html lang="zh">') && zhAgain.includes('匯出 JSON'), '預設仍是中文介面');
}
{
  const doc = clone(FIXTURE);
  doc.lang = 'en';
  ok(renderHtml(doc, CTX).includes('Export JSON'), 'JSON 頂層 lang 欄位可選定介面語言');
  ok(renderHtml(doc, { ...CTX, lang: 'zh' }).includes('匯出 JSON'), 'ctx.lang（--lang）優先於 JSON 的 lang 欄位');
}
{
  let threw = false;
  try {
    renderHtml(FIXTURE, { ...CTX, lang: 'ja' });
  } catch (e) {
    threw = /zh \/ en/.test(e.message);
  }
  ok(threw, '非法介面語言拋錯並點名內建 zh / en');
}

// 品質門面板是報告的一部分：英文介面下門標籤也要翻譯（閾值由門自己算，原樣保留）
{
  const gateEn = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(gateEn.includes('Every cut 2–5s'), 'EN 報告的品質門標籤翻譯且閾值原樣保留');
  ok(!gateEn.includes('每個分鏡 2–5 秒'), 'EN 報告不再出現中文門標籤');
  ok(gateEn.includes('no recipe card library mounted'), 'EN 報告的跳過說明也翻譯');
}

/* ---------------- 報告裡的「配方」列（偏離只提示，不設門） ---------------- */

{
  const doc = withRecipe();
  const rmd = renderMarkdown(doc, SHOTS);
  ok(rmd.includes('| 配方 |'), 'md 分鏡表有配方列');
  ok(rmd.includes('| 過肩正反打 |'), 'md 顯示卡名，沒偏離就不帶 ≠');
  ok(renderMarkdown(doc, { ...SHOTS, lang: 'en' }).includes('| Recipe |'), 'en md 的配方列表頭英文');
  const rhtml = renderHtml(doc, SHOTS);
  ok(rhtml.includes('class="cut-rc">過肩正反打</span>'), 'html 分鏡行有配方標籤');
  ok(!rhtml.includes('≠'), '沒偏離就不出 ≠ 上標');
}
{
  const doc = withRecipe();
  doc.episodes[0].segments.find((s) => s.id === 'E01-05').cuts[0].size = 'extreme-wide';
  const rhtml = renderHtml(doc, SHOTS);
  ok(rhtml.includes('<sup title="配方建議景別 medium / close——只提示不設門">≠</sup>'), '偏離加 ≠ 上標，建議值寫進 title');
  ok(renderMarkdown(doc, SHOTS).includes('過肩正反打 ≠（配方建議景別 medium / close——只提示不設門）'), 'md 沒有 title，建議值直接寫進格子');
  ok(renderHtml(doc, { ...SHOTS, lang: 'en' }).includes('Recipe suggests size medium / close — advisory, not gated'), 'en 報告的偏離提示英文');
  ok(gate(doc, 'shot-recipe', SHOTS).ok, '偏離在報告裡提示，但門照過——門的信用比數量重要');
}
{
  const doc = withRecipe();
  ok(renderMarkdown(doc, CTX).includes('| ots-shot-reverse |'), '不掛卡庫時配方列退回裸 id');
  ok(renderMarkdown(FIXTURE, CTX).includes('| — |'), '沒引用配方的切在配方列寫 —');
}
console.log(`✓ ${passed} 項自測全部通過`);
