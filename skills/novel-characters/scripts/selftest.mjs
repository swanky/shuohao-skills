#!/usr/bin/env node
// 自測：覆蓋 novel-characters.mjs 裡所有確定性邏輯。
// 不呼叫任何模型，不花額度，跑一次 < 1 秒。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHUNK_SIZE,
  MAX_CHUNKS,
  SUPPORTED_UI_LANGS,
  applyMerges,
  assembleCast,
  buildGraph,
  chunkText,
  mergeCandidates,
  mergeRoster,
  renderHtml,
  renderMarkdown,
  seedFromOutline,
  TIER_TO_IMPORTANCE,
  STYLE_PRESETS,
  SUPPORTED_STYLES,
  needsUiTranslation,
  DEFAULT_LANG,
  isChinese,
  isTraditionalChinese,
  slug,
  stylePreset,
  strings,
  uiTemplate,
  validateCast,
} from './novel-characters.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '..', 'examples');
// 正規化換行：Windows 上 git 會把樣例 checkout 成 CRLF，而 chunkText 內部
// 已經把 \r\n 換成 \n。不在這裡對齊，斷言就會拿 CRLF 原文去比對 LF 的塊，
// 在 Windows 全線報錯，在 macOS／Linux 卻看不出來。
const SOURCE = readFileSync(join(examples, '渡口.txt'), 'utf8').replace(/\r\n/g, '\n');
const CAST = JSON.parse(readFileSync(join(examples, '渡口-cast.json'), 'utf8')).characters;

let passed = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  passed += 1;
}
function eq(actual, expected, label) {
  assert.equal(actual, expected, `${label} — 期望 ${expected}，實際 ${actual}`);
  passed += 1;
}
function throws(fn, re, label) {
  assert.throws(fn, re, label);
  passed += 1;
}

/* ---------------- chunkText ---------------- */

eq(chunkText('').length, 0, '空文字不產生塊');
eq(chunkText('   \n  ').length, 0, '純空白不產生塊');
eq(chunkText(SOURCE).length, 1, '短故事只有一塊');

const long = SOURCE.repeat(150);
const chunks = chunkText(long);
ok(chunks.length > 1, '長文字會切成多塊');
ok(chunks.every((c) => c.length <= CHUNK_SIZE), `沒有塊超過 CHUNK_SIZE(${CHUNK_SIZE})`);
ok(long.includes(chunks[0].slice(0, 200)), '塊內容來自原文');
// 相鄰塊必須重疊，否則卡在切口上的角色會兩邊都漏
ok(chunks[1].includes(chunks[0].slice(-100).slice(0, 40)), '相鄰塊有重疊');
// 覆蓋率：把所有塊拼起來（去重疊後）應該蓋住絕大部分原文
const covered = chunks.reduce((sum, c) => sum + c.length, 0);
ok(covered >= long.length, '所有塊加起來覆蓋全文（含重疊）');

const huge = SOURCE.repeat(1500);
ok(chunkText(huge).length <= MAX_CHUNKS, `超長文字被 MAX_CHUNKS(${MAX_CHUNKS}) 截斷而不是無限切`);

/* ---------------- mergeRoster ---------------- */

// 跨塊用不同稱呼發現同一個人，必須收斂成一條
const merged = mergeRoster([
  [{ name: '陸行遠', aliases: ['陸'], note: '瘦，顴骨高。', quotes: ['他的臉很瘦，顴骨很高'] }],
  [{ name: '陸', aliases: [], note: '眉骨有疤。', quotes: ['右邊眉骨上有一道兩寸長的舊疤。', '他的臉很瘦，顴骨很高'] }],
  [{ name: '沈知微', aliases: ['姑娘'], note: '兩條辮子。', quotes: [] }],
]);
eq(merged.length, 2, '別名跨塊歸併');
const lu = merged.find((c) => c.name === '陸行遠');
ok(lu, '保留出現次數最多的規範名');
eq(lu.notes.length, 2, 'notes 累加');
ok(lu.aliases.includes('陸'), '別名被記錄');
eq(lu.quotes.length, 2, 'quotes 合併且去重');

// 先看到別名、後看到本名，也要能合併
const reverse = mergeRoster([
  [{ name: '姑娘', aliases: [], note: 'a', quotes: [] }],
  [{ name: '沈知微', aliases: ['姑娘'], note: 'b', quotes: [] }],
]);
eq(reverse.length, 1, '別名先出現也能歸併');
eq(reverse[0].notes.length, 2, '歸併後兩條 note 都在');

eq(
  mergeRoster([[{ name: 'Ishmael', aliases: [], note: 'a', quotes: [] }], [{ name: 'ishmael', aliases: [], note: 'b', quotes: [] }]]).length,
  1,
  '拉丁名大小寫不敏感',
);

// 出現的塊數越多排越前 —— 這是戲份權重的唯一依據
const ranked = mergeRoster([
  [{ name: '甲', aliases: [], note: '1', quotes: [] }, { name: '乙', aliases: [], note: '1', quotes: [] }],
  [{ name: '乙', aliases: [], note: '2', quotes: [] }],
  [{ name: '乙', aliases: [], note: '3', quotes: [] }],
]);
eq(ranked[0].name, '乙', '按出現塊數降序排列');

// 髒資料不能讓整個流程崩掉
eq(mergeRoster([[]]).length, 0, '空批次不報錯');
eq(mergeRoster([[{ name: '甲' }]]).length, 1, '缺 aliases/notes/quotes 欄位也能處理');
eq(mergeRoster([[{ note: '沒名字' }]]).length, 0, '沒有 name 的條目被丟棄');

/* ---------------- mergeCandidates / applyMerges ---------------- */

// 精確匹配的盲區：兩塊用了不同稱呼、沒有共同鍵，機械歸併留成兩個人
const twoLu = mergeRoster([
  [{ name: '陸行遠', aliases: [], note: '瘦，顴骨高。', quotes: ['q1'] }],
  [{ name: '陸', aliases: [], note: '眉骨有疤。', quotes: ['q2'] }],
  [{ name: '沈知微', aliases: [], note: '兩條辮子。', quotes: [] }],
]);
eq(twoLu.length, 3, '沒有共同鍵歸併不了——這就是候選機制要兜的洞');
const cands = mergeCandidates(twoLu);
eq(cands.length, 1, '名字包含關係被標成候選');
ok(cands[0].reason.includes('⊂'), '候選帶理由');
ok(
  [cands[0].a, cands[0].b].includes('陸行遠') && [cands[0].a, cands[0].b].includes('陸'),
  '候選指向正確的兩個人',
);

// 別名也參與候選
eq(
  mergeCandidates([
    { name: '老周', aliases: ['擺渡人'], notes: [], quotes: [] },
    { name: '渡口的擺渡人', aliases: [], notes: [], quotes: [] },
  ]).length,
  1,
  '別名的包含關係也算候選',
);

// 拉丁文字短側要 3 個字元起，否則噪音太多；CJK 單字就有資訊量
eq(
  mergeCandidates([
    { name: 'Al', aliases: [], notes: [], quotes: [] },
    { name: 'Alexander', aliases: [], notes: [], quotes: [] },
  ]).length,
  0,
  '拉丁兩字元不算候選',
);
eq(
  mergeCandidates([
    { name: 'Ish', aliases: [], notes: [], quotes: [] },
    { name: 'ishmael', aliases: [], notes: [], quotes: [] },
  ]).length,
  1,
  '拉丁三字元起算候選，大小寫不敏感',
);
eq(mergeCandidates([twoLu[0]]).length, 0, '單人不產生候選');

// 複核結果落地
const applied = applyMerges(twoLu, [{ keep: '陸行遠', absorb: ['陸'] }]);
eq(applied.length, 2, '合併後少一個人');
const luMerged = applied.find((c) => c.name === '陸行遠');
ok(luMerged.aliases.includes('陸'), '被吸收的名字變成別名');
eq(luMerged.notes.length, 2, '被吸收的 notes 併入');
eq(luMerged.quotes.length, 2, '被吸收的 quotes 併入');
eq(mergeCandidates(applied).length, 0, '合併後候選清空');

// keep 用別名定位也行
const viaAlias = applyMerges(
  [
    { name: '老周', aliases: ['老伯'], notes: ['a'], quotes: [] },
    { name: '擺渡人', aliases: [], notes: ['b'], quotes: [] },
  ],
  [{ keep: '老伯', absorb: ['擺渡人'] }],
);
eq(viaAlias.length, 1, 'keep 用別名定位');
eq(viaAlias[0].name, '老周', '規範名不變');
eq(viaAlias[0].notes.length, 2, '兩邊 notes 都在');

// 找不到的人必須報錯——靜默跳過會讓呼叫方以為合併成功了
throws(() => applyMerges(twoLu, [{ keep: '不存在', absorb: ['陸'] }]), /找不到/, 'keep 找不到要報錯');
throws(() => applyMerges(twoLu, [{ keep: '陸行遠', absorb: ['不存在'] }]), /找不到/, 'absorb 找不到要報錯');
// 拋錯前不許汙染入參：部分合併成功、後面才發現找不到的人，入參也要原樣
const pristine = JSON.stringify(twoLu);
throws(
  () => applyMerges(twoLu, [{ keep: '陸行遠', absorb: ['陸'] }, { keep: '不存在', absorb: ['沈知微'] }]),
  /找不到/,
  '部分成功再失敗也要報錯',
);
eq(JSON.stringify(twoLu), pristine, '拋錯後入參沒有被改動');
eq(JSON.stringify(mergeRoster([[{ name: '甲', aliases: [], note: 'a', quotes: [] }]])),
  JSON.stringify(applyMerges(mergeRoster([[{ name: '甲', aliases: [], note: 'a', quotes: [] }]]), [])),
  '空 merges 是無操作');
// absorb 指向 keep 自己不算錯——兩個鍵早就是同一個人
eq(
  applyMerges([{ name: '甲', aliases: ['小甲'], notes: [], quotes: [] }], [{ keep: '甲', absorb: ['小甲'] }]).length,
  1,
  'absorb 已經是同一個人時不報錯',
);

/* ---------------- seedFromOutline（大綱是角色的上游） ---------------- */

{
  // 拿真實的 outline 樣例當夾具。這個函式的契約就是「吃 novel-outline 的產出」，
  // 手捏一份假 outline 測不到真實的欄位形狀。novel-art 與 novel-script 的自測
  // 讀的是同一份檔案，同儲存庫上游樣例共享是既有做法。
  const outlinePath = join(here, '..', '..', 'novel-outline', 'examples', '渡口-outline.json');
  const outline = JSON.parse(readFileSync(outlinePath, 'utf8'));
  const seeded = seedFromOutline(outline);

  ok(seeded.characters.length === outline.characters.length, 'seed 出的角色數跟大綱一致');
  ok(seeded.source === outline.source, 'source 從大綱繼承');
  ok(seeded.style === 'realistic', '畫風取預設值，大綱裡沒有這個資訊');
  ok(seeded.summary === '', 'summary 留空——那是讀完原文才寫得出來的');

  // 分檔對映：大綱拍板的輕重，這一層不推翻
  ok(TIER_TO_IMPORTANCE.lead === 'protagonist', 'lead → protagonist');
  ok(TIER_TO_IMPORTANCE.support === 'supporting', 'support → supporting');
  ok(TIER_TO_IMPORTANCE.functional === 'minor', 'functional → minor');
  for (const c of seeded.characters) {
    const src = outline.characters.find((x) => x.id === c.id);
    ok(c.importance === TIER_TO_IMPORTANCE[src.tier], `${c.name} 的分檔照大綱對映`);
  }

  // 搬事實
  const first = seeded.characters[0];
  ok(first.id === outline.characters[0].id, '角色碼從大綱搬過來');
  ok(first.name === outline.characters[0].name, '名字從大綱搬過來');
  ok(first.persona.arc === outline.characters[0].arc, '人物弧光大綱已經寫了，直接用');
  ok(first.seedNote.includes(outline.characters[0].role), 'seedNote 帶上大綱定位，供模型細分主角組');
  ok(first.seedNote.includes('C01'), 'seedNote 帶上角色碼');

  // 留設計
  ok(first.aliases.length === 0, '別名留空——大綱裡沒有，要讀原文才知道');
  ok(first.oneLiner === '', '一句話留空');
  ok(first.image.prompt === '' && first.voice.prompt === '', '形象與音色提示詞留空');
  ok(first.persona.appearance === '' && first.persona.evidence.length === 0, '外貌與引文留空');

  // 骨架不是成品：直接校驗必然報欄位缺失，這是預期行為，跟 art / script 的 seed 一致
  const problems = validateCast(seeded.characters, null);
  ok(problems.length > 0, 'seed 產出是骨架不是成品，直接 validate 會報缺欄位');

  // 空大綱不炸
  ok(seedFromOutline({}).characters.length === 0, '空大綱返回空角色表，不拋異常');
  ok(seedFromOutline(null).source === '', 'null 也不炸');
  // tier 缺失或不認識時給一個安全的中間檔，不是崩掉
  ok(seedFromOutline({ characters: [{ name: '張三' }] }).characters[0].importance === 'supporting',
    'tier 缺失時退到 supporting，不拋異常也不給最高檔');
}

/* ---------------- assembleCast ---------------- */

const asm = assembleCast(
  [
    { name: 'A', importance: 'supporting' },
    { name: 'B', importance: 'protagonist' },
    { name: 'C', importance: 'major' },
    { name: 'D', importance: 'major' },
  ],
  { source: '書', lang: 'zh', style: 'ghibli', summary: '摘要' },
);
eq(asm.source, '書', 'assemble 帶書名');
eq(asm.lang, 'zh', 'assemble 帶語言');
eq(asm.style, 'ghibli', 'assemble 帶畫風');
eq(asm.summary, '摘要', 'assemble 帶摘要');
eq(asm.characters.map((c) => c.name).join(''), 'BCDA', '按 importance 排序，同檔保持傳入順序');
ok(!('ui' in asm), '沒有 ui 就不寫這個鍵');

// 同檔要按戲份序——CLI 按檔名讀卡是 slug 字典序，order 就是用來糾正它的
const byFilename = [
  { name: '老周', importance: 'major' },      // 檔名序在前
  { name: '沈知微', importance: 'protagonist' },
  { name: '陸行遠', importance: 'major' },     // 但戲份比老周重
];
const ordered = assembleCast(byFilename, { source: 'x', order: ['沈知微', '陸行遠', '老周'] });
eq(ordered.characters.map((c) => c.name).join('→'), '沈知微→陸行遠→老周', '同檔按 order 的戲份順序');
eq(
  assembleCast(byFilename, { source: 'x' }).characters.map((c) => c.name).join('→'),
  '沈知微→老周→陸行遠',
  '不給 order 才退回傳入順序——這正是要修的檔名序',
);
// order 裡沒有的名字排同檔末尾，不報錯
eq(
  assembleCast(byFilename, { source: 'x', order: ['沈知微', '陸行遠'] }).characters.map((c) => c.name).join('→'),
  '沈知微→陸行遠→老周',
  'order 缺名字的排同檔末尾',
);
ok('ui' in assembleCast([{ name: 'A' }], { source: 'x', ui: { copy: 'Copier' } }), '有 ui 翻譯就帶上');
eq(
  assembleCast([{ name: 'X', importance: 'sidekick' }, { name: 'B', importance: 'protagonist' }], { source: 'x' })
    .characters[0].name,
  'B',
  'importance 越界的排最後而不是崩掉',
);

/* ---------------- slug ---------------- */

eq(slug('胡二爺'), '胡二爺', '中文名原樣保留');
eq(slug('a/b:c*d'), 'a-b-c-d', '路徑危險字元被替換');
eq(slug('  x  '), 'x', '兩端空白被去掉');
eq(slug(''), 'character', '空名有兜底');

/* ---------------- validateCast ---------------- */

eq(validateCast(CAST, SOURCE).length, 0, '自帶樣例透過全部校驗');
ok(validateCast([], SOURCE).length > 0, '空 cast 報錯');

const clone = () => JSON.parse(JSON.stringify(CAST));
const hits = (cast, keyword) => validateCast(cast, SOURCE).filter((p) => p.includes(keyword)).length;

// 這四類是模型真實犯過的錯，每一類都必須抓住
let bad = clone();
bad[0].persona.evidence[0] = 'She was nineteen years old.';
ok(hits(bad, '逐字片段') > 0, '抓住意譯的引文');

bad = clone();
bad[0].image.prompt = `${bad[0].name}, ${bad[0].image.prompt}`;
ok(hits(bad, '人名') > 0, '抓住生圖提示詞裡的人名');

bad = clone();
bad[0].image.promptLocal = `${bad[0].aliases[0]}的設定圖`;
ok(hits(bad, '人名') > 0, '抓住本地語言生圖提示詞裡的別名');

bad = clone();
bad[0].image.sheet = `${bad[0].name}, a model sheet`;
ok(hits(bad, '人名') > 0, '抓住設定圖提示詞裡的人名');

bad = clone();
bad[0].voice.timbre = 'warm husky alto';
ok(hits(bad, '應為中文') > 0, '抓住該中文卻寫成英文的欄位');

bad = clone();
bad[0].image.sheet = '中文設定圖描述';
ok(hits(bad, '必須英文') > 0, '抓住該英文卻含中文的欄位');

bad = clone();
bad[0].importance = 'sidekick';
ok(hits(bad, 'importance') > 0, '抓住 importance 列舉越界');

bad = clone();
delete bad[0].image.sheet;
ok(hits(bad, 'image.sheet') > 0, '抓住缺失的設定圖提示詞');

bad = clone();
delete bad[0].persona;
ok(hits(bad, 'persona') > 0, '抓住缺失的 persona');

// 沒有原文時應該跳過逐字校驗而不是全判失敗
eq(validateCast(CAST, null).length, 0, '不給原文時跳過引文校驗');

/* ---------------- render ---------------- */

const md = renderMarkdown(CAST, '渡口');
ok(md.includes('# 渡口 — 角色表'), 'Markdown 有標題');
for (const c of CAST) ok(md.includes(`## ${c.name}`), `Markdown 包含 ${c.name}`);
// 預設語言是 zh-TW，所以不傳 lang 時介面文案該是正體
ok(md.includes('角色設定圖提示詞'), 'Markdown 預設用正體介面文案');
ok(
  renderMarkdown(CAST, '渡口', '', 'zh').includes('角色设定图提示词'),
  'Markdown 顯式指定 zh 時用簡體介面文案',
);
ok(renderMarkdown(CAST, 'Ferry', '', 'en').includes('# Ferry — Cast'), 'Markdown 跟隨語言參數');

const html = renderHtml(CAST, '渡口');
ok(html.startsWith('<!doctype html>'), 'HTML 是完整文件');
// 三欄工作臺：頂欄 + 左欄角色列表 + 主區一次一個角色
eq((html.match(/class="char[ "]/g) || []).length, CAST.length, `主區有 ${CAST.length} 個角色`);
eq((html.match(/class="rost[ "]/g) || []).length, CAST.length, `左欄列出 ${CAST.length} 個角色`);
eq((html.match(/class="char on"/g) || []).length, 1, '預設只展開第一個角色');
eq((html.match(/class="rost on"/g) || []).length, 1, '左欄預設選中第一個');
// 音色提示詞要緊湊不要散文——voice design 引擎吃的是參數密度，
// 散文會把參數稀釋掉（生產裡實測對比過 500 字散文 vs 230 字參數串，後者明顯更好）
{
  ok(CAST.every((c) => c.voice.prompt.length <= 400), '樣例的音色提示詞都在 400 字元以內');
  const wordy = clone();
  wordy[0].voice.prompt = 'A young female voice, nineteen years old. '.repeat(12);
  ok(
    validateCast(wordy, SOURCE).some((x) => x.includes('超過 400')),
    '寫成散文的音色提示詞被攔',
  );
  const edge = clone();
  edge[0].voice.prompt = 'x'.repeat(400);
  ok(
    !validateCast(edge, SOURCE).some((x) => x.includes('超過 400')),
    '正好 400 字元不攔——上限是含等於',
  );
}

// 音色提示詞裡不許出現引號臺詞——模型寫過「殺意藏在『規矩就是規矩』這類客套話裡」，
// 臺詞一進去，有些 TTS 引擎會把它當成要朗讀的內容（製作時踩過）
{
  for (const q of ['「規矩就是規矩」', '『規矩就是規矩』', '"rules are rules"', '“rules are rules”']) {
    const bad = clone();
    bad[0].voice.prompt += ` menace hidden inside ${q}`;
    ok(
      validateCast(bad, SOURCE).some((x) => x.includes('引號臺詞')),
      `音色提示詞裡的引號臺詞被攔（${q.slice(0, 2)}）`,
    );
  }
  const ok1 = clone();
  ok1[0].voice.prompt += ' Consonants land softly, vowels stay open.';
  eq(validateCast(ok1, SOURCE).length, 0, '正常的音色描述不誤攔');
  const ok2 = clone();
  ok2[0].voice.prompt += ' A dry "k" sound.';
  eq(validateCast(ok2, SOURCE).length, 0, '引號裡只有一兩個字元不算臺詞');
}

// 音色只保留餵引擎的那一條：給人讀的六項已經是結構化中文欄位，
// 再給一段中文散文，使用者會複製錯——這是這次修復的根因
{
  const html = renderHtml(CAST, { source: '渡口' });
  ok(!html.includes('音色提示詞（中文'), '報告裡不再有中文音色提示詞');
  ok(html.includes('音色提示詞 · 餵 TTS 引擎用這條'), '音色提示詞的標籤寫明用途');
  ok(html.includes('生圖提示詞 · 餵生圖模型用這條'), '生圖提示詞的標籤寫明用途');
  const iEn = html.indexOf('生圖提示詞 · 餵生圖模型用這條');
  const iLocal = html.indexOf('生圖提示詞（中文對照）');
  ok(iEn >= 0 && iLocal >= 0 && iEn < iLocal, '生圖那一組機器欄位排在中文對照前面');
  ok(CAST.every((c) => !('promptLocal' in (c.voice ?? {}))), '樣例的 voice 裡沒有 promptLocal');
}

// 每人 6 個複製按鈕：生圖 EN/設定圖/負向/中文對照 + 音色（只有餵引擎的那一條）+ 整份 JSON
// 音色刻意只留一條：給人讀的六個結構化中文欄位已經在上面的卡片裡，
// 再放一段中文散文只會讓人複製錯——製作時真的踩過（使用者把中文對照餵進了 TTS）
// 用 class="copy 字首匹配——整份 JSON 那個是 class="copy wide"
eq((html.match(/class="copy[ "]/g) || []).length, CAST.length * 6, '每段提示詞都有複製按鈕');
eq((html.match(/class="copy wide"/g) || []).length, CAST.length, '每個角色有整份 JSON 按鈕');
ok(html.includes('id="q"'), '頂欄有搜尋框');
// 搜尋靠 data-hay，裡面必須包含名字、別名、身份、特質——標籤上是這麼寫的
for (const c of CAST) {
  const m = html.match(new RegExp(`data-hay="([^"]*)"[^>]*>[\\s\\S]{0,400}?${c.name}`));
  ok(html.includes(`data-hay=`), 'roster 帶搜尋索引');
}
const hay = [...html.matchAll(/data-hay="([^"]*)"/g)].map((m) => m[1]).join(' ');
for (const c of CAST) {
  ok(hay.includes(c.name), `搜尋索引含 ${c.name}`);
  if (c.persona.identity) ok(hay.includes(c.persona.identity.slice(0, 6)), `搜尋索引含 ${c.name} 的身份`);
  for (const tr of c.persona.personality) ok(hay.includes(tr), `搜尋索引含特質「${tr}」`);
}
ok(html.includes('<blockquote>'), '原文依據用 blockquote');
// 四種寫法都要認：半形/全形 × 推斷/inferred
for (const marker of ['（推斷）', '(inferred)', '（inferred）', '(推斷)']) {
  const t = clone();
  t[0].persona.appearance = '身形單薄' + marker + '。';
  ok(renderHtml(t, 'x').includes('class="inf"'), `推斷標記 ${marker} 被高亮`);
}
ok(html.includes('prefers-reduced-motion'), '尊重減少動效');
ok(html.includes('@media print'), '可列印');
// 自包含：不能有任何外部請求
ok(!/<script\s+src=/.test(html), 'HTML 不引用外部腳本');
ok(!/<link\s/.test(html), 'HTML 不引用外部樣式');
// 反向驗證：上面兩條正則本身要真的能抓到東西，否則是永遠為真的假測試
ok(/<script\s+src=/.test('<script src="x.js">'), '外部腳本檢測正則有效');
ok(/<link\s/.test('<link rel="stylesheet">'), '外部樣式檢測正則有效');
ok(!/@import|url\(https?:/.test(html), 'CSS 不拉外部資源');

// 沒有三檢視時要有佔位而不是空白
ok(renderHtml(CAST, 'x').includes('plate-empty'), '缺圖時顯示佔位');
const withShot = clone();
withShot[0].sheetImage = 'images/x.png';
const shotHtml = renderHtml(withShot, 'x');
ok(shotHtml.includes('<img src="images/x.png"'), '主區嵌入設定圖');
ok(shotHtml.includes("background-image:url('images/x.png')"), '左欄縮圖用同一張圖的切片');

// XSS：角色資料是模型生成的，不能直接拼進 HTML
const evil = clone();
evil[0].name = '<img src=x onerror=alert(1)>';
const evilHtml = renderHtml(evil, 'x');
ok(!evilHtml.includes('<img src=x onerror'), '角色欄位裡的 HTML 被轉義');

// 故事摘要
const DOC = JSON.parse(readFileSync(join(examples, '渡口-cast.json'), 'utf8'));
ok(DOC.summary && DOC.summary.trim(), '樣例帶故事摘要');
ok(renderHtml(CAST, '渡口', DOC.summary).includes('class="synopsis'), 'HTML 頂部渲染摘要');
ok(!renderHtml(CAST, '渡口', '').includes('class="synopsis'), '沒有摘要時不留空殼');
ok(renderMarkdown(CAST, '渡口', DOC.summary).includes('## 故事摘要'), 'Markdown 也帶摘要');
ok(renderHtml(CAST, '渡口', '<b>x</b>').includes('&lt;b&gt;'), '摘要裡的 HTML 被轉義');
// 摘要預設三行 + 漸隱，點一下展開
const synHtml = renderHtml(CAST, '渡口', DOC.summary);
ok(synHtml.includes('class="synopsis syn-clamp"'), '摘要預設是摺疊態');
ok(/\.syn-clamp p\{[^}]*-webkit-line-clamp:3/.test(synHtml), '摘要最多三行');
ok(/\.syn-clamp p\{[^}]*mask-image:linear-gradient/.test(synHtml), '折起來的摘要底部漸隱');
ok(synHtml.includes('class="syn-more"'), '有展開入口');
ok(/syn\.classList\.remove\('syn-clamp'\)/.test(synHtml), '點一下展開全部');
ok(/scrollHeight <= body\.clientHeight/.test(synHtml), '摘要短到不用摺疊就不顯示展開入口');

/* ---------------- 匯出 JSON ---------------- */

// 匯出的形狀就是 cast.json，編輯完要能直接餵回 render
const expHtml = renderHtml(CAST, '渡口', DOC.summary, 'zh', null, 'ghibli');
ok(expHtml.includes('class="expo"'), '頂欄有匯出按鈕');
ok(expHtml.includes('<script type="application/json" id="cast-data">'), '資料內嵌在報告裡');
ok(expHtml.includes('data-name="渡口-cast.json"'), '下載檔名跟著書名走');

const embedded = expHtml.match(/<script type="application\/json" id="cast-data">([\s\S]*?)<\/script>/)[1];
const round = JSON.parse(embedded.replace(/\\u003c/g, '<'));
eq(round.source, '渡口', '匯出帶書名');
eq(round.lang, 'zh', '匯出帶語言');
eq(round.style, 'ghibli', '匯出帶畫風');
eq(round.summary, DOC.summary, '匯出帶故事摘要');
eq(round.characters.length, CAST.length, '匯出帶全部角色');
eq(JSON.stringify(round.characters), JSON.stringify(CAST), '角色卡原樣匯出，沒有丟欄位');
eq(validateCast(round.characters, SOURCE, 'zh', 'realistic').length, 0, '匯出的資料能直接餵回 validate 並透過');
ok(validateCast(round.characters, SOURCE, 'zh', 'ghibli').length > 0, '餵回去的確實是真資料——畫風說反了照樣報錯');

// ⚠️ 正文裡一個 </script 就能把資料區塊提前截斷
const xss = clone();
xss[0].persona.appearance = '他說</script><script>alert(1)</script>';
const xssHtml = renderHtml(xss, 'x', '');
const xssData = xssHtml.match(/<script type="application\/json" id="cast-data">([\s\S]*?)<\/script>/)[1];
ok(!xssData.includes('</script'), '資料區塊裡的 </script 被轉義，截不斷');
ok(JSON.parse(xssData.replace(/\\u003c/g, '<')).characters[0].persona.appearance.includes('</script>'), '轉義了但內容沒丟');

// 沒有 ui 就不寫這個鍵，免得匯出裡多一個空欄位
ok(!('ui' in JSON.parse(renderHtml(CAST, 'x', '').match(/id="cast-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'))), '沒有 ui 翻譯就不寫這個鍵');
ok('ui' in JSON.parse(renderHtml(CAST, 'x', '', 'fr', { copy: 'Copier' }).match(/id="cast-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<')), '有 ui 翻譯就帶上');

/* ---------------- 關係圖譜 ---------------- */

// 別名要能連上（老周被叫「老伯」），同一對人只連一條邊，指向沒畫像的人算 dangling
const G = buildGraph([
  { name: 'A', aliases: [], persona: { relationships: [{ name: 'B的綽號', relation: 'r1' }] } },
  { name: 'B', aliases: ['B的綽號'], persona: { relationships: [{ name: 'A', relation: 'r2' }] } },
  { name: 'C', aliases: [], persona: { relationships: [{ name: '沒這個人', relation: 'r3' }] } },
]);
eq(G.edges.length, 1, '同一對人只連一條邊');
eq(G.edges[0].notes.length, 2, '兩個方向的說法都留著');
eq(G.dangling, 1, '指向沒做畫像的角色算 dangling');
eq(
  buildGraph([{ name: 'A', aliases: [], persona: { relationships: [{ name: 'A', relation: 'x' }] } }]).edges.length,
  0,
  '不給自己連邊',
);
ok(buildGraph([{ name: 'A', aliases: [], persona: {} }]).edges.length === 0, '沒有 relationships 也不炸');

const graphHtml = renderHtml(CAST, '渡口');
ok(graphHtml.includes('class="graph'), '有關係圖譜檢視');
ok(graphHtml.includes('class="gtoggle"'), '左欄有圖譜入口');
// 頂欄的搜尋圖示也是 svg，所以要卡到 .graph-canvas 裡面那張，否則測了個寂寞
const canvas = graphHtml.match(/<div class="graph-canvas">\s*<svg viewBox="0 0 (\d+) (\d+)"/);
ok(canvas, '圖譜是內聯 SVG，不引庫');
eq(canvas[1], canvas[2], '畫布是正方形');
ok(Number(canvas[1]) >= 480, '畫布夠大，名字放得下');
eq((graphHtml.match(/class="gnode[ "]/g) || []).length, CAST.length, `圖譜有 ${CAST.length} 個節點`);
const CAST_EDGES = buildGraph(CAST).edges;
ok(CAST_EDGES.length > 0, '樣例裡能連出關係');
eq((graphHtml.match(/class="gedge"/g) || []).length, CAST_EDGES.length, '弦數和邊數一致');
eq((graphHtml.match(/class="grow"/g) || []).length, CAST_EDGES.length, '關係表和邊數一致');
ok(CAST_EDGES.every((e) => e.a <= e.b), '邊的端點排過序，方向不影響去重');
// 節點點了要能跳到對應角色，靠的是和 .rost 同一套 data-target
for (const c of CAST) ok(graphHtml.includes(`data-node="${c.name}" data-target="p-${slug(c.name)}"`), `${c.name} 的節點能跳轉`);
ok(graphHtml.includes('.main.gmode .char{display:none}'), '圖譜和角色詳情互斥');
// 弦上的關係文字
eq((graphHtml.match(/class="glabel"/g) || []).length, CAST_EDGES.length, '每條弦上都有關係文字');
ok(graphHtml.includes('class="glabtoggle'), '關係文字有總開關');
ok(/class="graph labels"/.test(graphHtml), `${CAST_EDGES.length} 條邊，預設把關係文字標出來`);
ok(/<text class="glabel"[^>]*>[^<]+<title>/.test(graphHtml), '短標籤在弦上，全文進 title');
ok(graphHtml.includes('.glabel{display:none'), '關掉時關係文字不畫');
ok(graphHtml.includes('.glabel.hot{display:block'), '關掉了，懸停那條也要顯示');
ok(/\.glabel\{[^}]*pointer-events:none/.test(graphHtml), '關係文字不擋節點的滑鼠');
ok(/\.glabel\{[^}]*paint-order:stroke/.test(graphHtml), '關係文字有底襯，壓在弦上也讀得清');
// 長關係要截斷，否則一條弦上糊一整句
const longRel = clone();
longRel[0].persona.relationships = [{ name: longRel[1].name, relation: '一二三四五六七八九十甲乙丙丁戊己庚辛' }];
// 對手方也清空，否則這條邊上會有兩種說法，標籤取的是更短的那條
longRel[1].persona.relationships = [];
const longHtml = renderHtml(longRel, 'x');
ok(longHtml.includes('一二三四五六…'), '超過 6 字截斷');
ok(longHtml.includes('<title>一二三四五六七八九十甲乙丙丁戊己庚辛') || longHtml.includes('丙丁戊己庚辛</title>'), '截斷了但全文還在 title 裡');
// 邊多了預設收起來
const many = Array.from({ length: 8 }, (_, i) => {
  const c = clone()[0];
  c.name = `角色${i}`;
  c.aliases = [];
  c.persona = { ...c.persona, relationships: Array.from({ length: 8 }, (_, j) => ({ name: `角色${j}`, relation: 'r' })) };
  return c;
});
ok(!/class="graph labels"/.test(renderHtml(many, 'x')), '邊多了預設不標關係文字');
ok(/@media print\{[\s\S]*\.graph\{display:block!important/.test(graphHtml), '列印時圖譜也出');
// 主角節點要看得出來
eq((graphHtml.match(/class="gnode lead"/g) || []).length, CAST.filter((c) => c.importance === 'protagonist').length, '主角節點單獨標出');

// 佈局骨架
const css = renderHtml(CAST, 'x');
ok(/\.shell\{[^}]*grid-template-columns:var\(--side-w\)/.test(css), '左欄 + 主區兩欄骨架');
ok(/\.upper\{[^}]*grid-template-columns:minmax\(0,1fr\) 500px/.test(css), '主區內是內容 + 資訊卡兩欄');
ok(/\.prompts\{[^}]*grid-template-columns:1fr 1fr/.test(css), '提示詞分左右兩組');
ok(css.includes('.char{display:none}'), '預設只顯示選中的角色');
ok(/\.main\{[^}]*max-width:1500px/.test(css), '主區最大寬度 1500px');
// 縮圖用精靈圖裁設定圖左欄——設定圖 16:9、左欄約 34%，放大 1/0.34≈294% 左上對齊
ok(/\.rost-thumb\{[^}]*background-size:294% auto/.test(css), '縮圖按 294% 裁左欄');
ok(/\.rost-thumb\{[^}]*no-repeat left top/.test(css), '縮圖左上對齊');
ok(!/\.rost-thumb img/.test(css), '縮圖不再用 img 拉伸');
// 螢幕上一次一個，列印時必須全展開，否則打出來只有一個角色
ok(/@media print\{[\s\S]*\.char\{display:block!important/.test(css), '列印時展開全部角色');
ok(/@media print\{[\s\S]*\.pr p\{display:block!important/.test(css), '列印時展開全部提示詞');

/* ---------------- 多語言 ---------------- */

const zh = renderHtml(CAST, '渡口', DOC.summary, 'zh');
const en = renderHtml(CAST, 'Ferry', 'A misty river crossing.', 'en');

ok(zh.includes('lang="zh"'), 'zh 報告的 html lang 正確');
ok(en.includes('lang="en"'), 'en 報告的 html lang 正確');
ok(zh.includes('故事摘要') && !zh.includes('>Synopsis<'), 'zh 介面用中文');
ok(en.includes('Synopsis') && !en.includes('故事摘要'), 'en 介面用英文');
ok(en.includes('>Voice<'), 'en 的聲音卡標題翻譯了');
ok(en.includes('Search characters'), 'en 的搜尋框佔位翻譯了');
ok(en.includes('Cast · by prominence'), 'en 的角色列表標題翻譯了');
ok(/Appearance|Temperament/.test(en), 'en 的畫像小節標題翻譯了');
ok(en.includes('>Lead<'), 'en 的 importance 標籤翻譯了');
ok(en.includes('>Copy<'), 'en 的複製按鈕翻譯了');
// 未知語言碼退回英文骨架，而不是崩掉或露出中文
const fr = renderHtml(CAST, 'Bac', '', 'fr');
ok(fr.includes('lang="fr"'), '未知語言碼仍寫進 html lang');
ok(fr.includes('Synopsis') || !fr.includes('故事摘要'), '未知語言碼用英文介面骨架');
eq(strings('zh').synopsis, '故事摘要', 'strings(zh)');
eq(strings('nope').synopsis, strings('en').synopsis, 'strings 未知碼退回 en');
for (const l of ['zh-TW', 'zh', 'en', 'ja']) ok(SUPPORTED_UI_LANGS.includes(l), `內建 ${l} 介面`);

// 台灣正體內建
const tw = renderHtml(CAST, '渡口', DOC.summary, 'zh-TW');
ok(tw.includes('lang="zh-TW"'), 'zh-TW 報告的 html lang 正確');
ok(tw.includes('角色設定集') && !tw.includes('角色设定集'), 'zh-TW 介面用正體字');
ok(tw.includes('搜尋角色'), 'zh-TW 介面用搜尋，不是簡體那套的搜索');
ok(tw.includes('負向提示詞'), 'zh-TW 介面用負向提示詞，不是簡體那套的反向提示词');
ok(tw.includes('尚未生圖') || tw.includes('生圖提示詞'), 'zh-TW 介面用生圖，不是簡體那套的出图');
ok(tw.includes('依戲份排序'), 'zh-TW 用「依戲份排序」');
// 字型要跟著換，Songti SC 那串在台灣機器上多半沒裝
ok(tw.includes('Songti TC') && !tw.includes('Songti SC'), 'zh-TW 挑 TC 字型');
ok(zh.includes('Songti SC') && !zh.includes('Songti TC'), 'zh 仍挑 SC 字型');
ok(en.includes('Songti SC'), '非中文沿用原字型棧');
// 地區變體都算正體，但只有 zh-TW 有內建文案
ok(isTraditionalChinese('zh-HK') && isTraditionalChinese('zh-Hant'), 'zh-HK／zh-Hant 算正體');
ok(!isTraditionalChinese('zh') && !isTraditionalChinese('ja'), 'zh／ja 不算正體');
ok(isChinese('zh-TW') && isChinese('zh') && !isChinese('ja'), 'isChinese 認地區變體');
eq(DEFAULT_LANG, 'zh-TW', '預設語言是台灣正體');
eq(strings('zh-TW').synopsis, '故事摘要', 'strings(zh-TW)');
// zh 的各地區變體走同一條中文校驗，不該因為語言碼帶地區就報錯
eq(validateCast(CAST, SOURCE, 'zh-TW').length, 0, 'zh-TW 校驗透過');

// 日語內建
const ja = renderHtml(CAST, '渡し場', 'あらすじの本文', 'ja');
ok(ja.includes('lang="ja"'), 'ja 報告的 html lang 正確');
ok(ja.includes('あらすじ') && ja.includes('>主役<'), 'ja 介面用日文');
ok(ja.includes('登場人物 · 出番順'), 'ja 的角色列表標題翻譯了');
ok(ja.includes('検索'), 'ja 的搜尋框佔位翻譯了');

// 任意語言：ui 覆蓋機制
ok(needsUiTranslation('fr'), 'fr 需要 ui 翻譯');
ok(!needsUiTranslation('ja'), 'ja 內建，不需要 ui 翻譯');
const frUi = { synopsis: 'Résumé', groups: { voice: 'Voix' }, copy: 'Copier' };
const frHtml = renderHtml(CAST, 'Bac', 'Un matin de brume.', 'fr', frUi);
ok(frHtml.includes('Résumé'), 'ui 覆蓋生效');
ok(frHtml.includes('Voix'), 'ui 巢狀鍵覆蓋生效');
ok(frHtml.includes('>Copier<'), 'ui 覆蓋按鈕文案');
eq(strings('fr', frUi).groups.persona, 'Profile', '沒覆蓋的鍵退回英文兜底');
eq(strings('fr', frUi).persona.gender, 'Gender', '沒覆蓋的巢狀鍵也兜底');
// 髒 ui 不能把渲染帶崩
for (const junk of [null, 'x', 42, [], { groups: 'not-an-object' }, { docTitle: 'nope' }]) {
  ok(renderHtml(CAST, 'x', '', 'fr', junk).startsWith('<!doctype html>'), `髒 ui ${JSON.stringify(junk)} 不崩`);
}
// 模板要能覆蓋所有可翻譯的鍵
const tpl = uiTemplate();
for (const k of ['kicker', 'synopsis', 'groups', 'persona', 'image', 'voice', 'importance', 'copy']) {
  ok(k in tpl, `ui-template 含 ${k}`);
}
ok(!('docTitle' in tpl), 'ui-template 不含函式模板');

// 校驗的語言規則跟著 lang 走
const enCast = clone();
for (const c of enCast) {
  c.voice.timbre = 'warm husky alto';
  c.voice.pitch = 'low';
  c.voice.pace = 'slow and deliberate';
  c.voice.accent = 'neutral';
  c.voice.emotion = 'weary';
  c.voice.referenceHint = 'like a night-shift radio host';
}
ok(
  validateCast(enCast, SOURCE, 'en').filter((p) => p.includes('應為')).length === 0,
  'lang=en 時英文 voice 欄位合法',
);
ok(
  validateCast(enCast, SOURCE, 'zh').filter((p) => p.includes('應為中文')).length > 0,
  'lang=zh 時英文 voice 欄位違規',
);
ok(
  validateCast(CAST, SOURCE, 'en').filter((p) => p.includes('應為英文')).length > 0,
  'lang=en 時中文 voice 欄位違規',
);
// 機器欄位不受 lang 影響，永遠必須英文
const cjkMachine = clone();
cjkMachine[0].image.prompt = '中文生圖提示詞';
for (const l of ['zh', 'en', 'fr']) {
  ok(
    validateCast(cjkMachine, SOURCE, l).filter((p) => p.includes('必須英文')).length > 0,
    `lang=${l} 時 image.prompt 仍必須英文`,
  );
}

/* ---------------- 角色設定圖（左半身像 + 右三檢視，一張） ---------------- */

ok(CAST.every((c) => c.image.sheet && c.image.sheet.trim()), '樣例每個角色都有設定圖提示詞');
// 左右分欄和比例必須寫死在提示詞裡，否則模型會自由發揮
ok(CAST.every((c) => /LEFT ZONE/.test(c.image.sheet)), '提示詞劃出左欄');

ok(CAST.every((c) => /about 34% of the canvas width/.test(c.image.sheet)), '左欄比例寫死 34%');
// 16:9 和三區版面
ok(CAST.every((c) => /16:9/.test(c.image.sheet)), '畫布寫死 16:9');
ok(CAST.every((c) => /RIGHT-TOP ZONE/.test(c.image.sheet)), '右上是三檢視區');
ok(CAST.every((c) => /RIGHT-BOTTOM ZONE/.test(c.image.sheet)), '右下是細節區');
ok(CAST.every((c) => /thin hairline rules/.test(c.image.sheet)), '三區之間有細線分隔');
// 比例是這個版面最容易崩的地方——為了塞下細節而壓扁人物
ok(CAST.every((c) => /PROPORTIONS ARE CRITICAL/.test(c.image.sheet)), '強調比例');
ok(
  CAST.every((c) => /no stretching, squashing or foreshortening/.test(c.image.sheet)),
  '禁止拉伸壓扁人物',
);
ok(
  CAST.every((c) => /the detail studies give way, not the figures/.test(c.image.sheet)),
  '空間不夠時讓細節讓位，不動人物',
);
ok(
  CAST.every((c) => /continue them in a narrow vertical column down the right-hand edge/.test(c.image.sheet)),
  '細節放不下可延伸到右側',
);

/* ---------------- 畫風預設 ---------------- */

for (const id of ['realistic', 'ghibli', 'photoreal']) {
  ok(SUPPORTED_STYLES.includes(id), `內建 ${id} 預設`);
}
eq(stylePreset('nope').render, STYLE_PRESETS.realistic.render, '未知風格退回預設');
// 每個預設都要五塊齊全，缺一塊就會跟另一個預設混搭出四不像
for (const [id, p] of Object.entries(STYLE_PRESETS)) {
  for (const k of ['render', 'surface', 'lighting', 'negative', 'tags']) {
    ok(p[k] && p[k].length, `${id} 預設有 ${k}`);
  }
  // 內建幾套介面文案，標籤就得給幾套，否則那個語言的報告會露出別的語言
  for (const l of SUPPORTED_UI_LANGS) ok(p.label[l], `${id} 預設有 ${l} 標籤`);
}
// 這是整件事最容易搞反的地方：兩個預設的負向提示詞幾乎相反
ok(!/photorealistic|3d render/i.test(STYLE_PRESETS.realistic.negative), 'realistic 不禁寫實');
ok(/photorealistic/i.test(STYLE_PRESETS.ghibli.negative), 'ghibli 必須禁寫實');
// 寫實的表面細節在吉卜力裡是反效果，兩邊不能是同一段
ok(/visible pores/i.test(STYLE_PRESETS.realistic.surface), 'realistic 要毛孔');
ok(/no pores/i.test(STYLE_PRESETS.ghibli.surface), 'ghibli 明確不要毛孔');
ok(STYLE_PRESETS.realistic.surface !== STYLE_PRESETS.ghibli.surface, '兩個預設的表面處理不同');

// photoreal 跟 realistic 站同一邊（都要真實感），但禁的東西相反：
// realistic 仍是畫出來的，photoreal 恰恰要禁「畫出來的」
ok(!/photorealistic|3d render/i.test(STYLE_PRESETS.photoreal.negative), 'photoreal 不禁寫實');
ok(
  /illustration/i.test(STYLE_PRESETS.photoreal.negative) &&
    /painting/i.test(STYLE_PRESETS.photoreal.negative) &&
    /anime/i.test(STYLE_PRESETS.photoreal.negative),
  'photoreal 必須禁 illustration／painting／anime',
);
ok(!/illustration/i.test(STYLE_PRESETS.realistic.negative), 'realistic 不禁 illustration——它本來就是畫');
ok(/visible pores/i.test(STYLE_PRESETS.photoreal.surface), 'photoreal 要毛孔');
ok(
  STYLE_PRESETS.photoreal.render !== STYLE_PRESETS.realistic.render &&
    STYLE_PRESETS.photoreal.surface !== STYLE_PRESETS.realistic.surface,
  'photoreal 與 realistic 是兩套，不是同一套',
);
// 版面規則不隨風格變：三個預設都得分割槽打光
for (const id of SUPPORTED_STYLES) {
  const p = STYLE_PRESETS[id];
  const zoned = /LEFT ZONE/.test(p.lighting) && /RIGHT ZONE/.test(p.lighting);
  const flat = /whole sheet/.test(p.lighting);
  ok(zoned || flat, `${id} 的打光要麼分割槽要麼明確全圖平光`);
}

// 校驗器要能抓住風格與負向提示詞搞反
const wrongStyle = clone();
ok(
  validateCast(wrongStyle, SOURCE, 'zh', 'ghibli').some((x) => x.includes('必須禁 photorealistic')),
  '樣例是 realistic，按 ghibli 校驗會報錯',
);
const ghibliish = clone();
for (const c of ghibliish) c.image.negativePrompt = STYLE_PRESETS.ghibli.negative;
ok(
  validateCast(ghibliish, SOURCE, 'zh', 'realistic').some((x) => x.includes('自相矛盾')),
  'realistic 卻禁 photorealistic 會報錯',
);
eq(validateCast(CAST, SOURCE, 'zh', 'realistic').length, 0, '樣例按 realistic 校驗透過');

// 同劇角色畫風必須一致——模型曾按各自服裝/年齡寫出四套畫風，同框像四個畫師
// 樣例已統一，應透過；故意改掉一個角色的 image.style 必須報錯；僅空白差異不算不一致
eq(validateCast(CAST, SOURCE, 'zh', 'realistic').length, 0, '樣例四個角色畫風統一，校驗透過');
{
  const split = clone();
  split[1].image.style = '吉卜力動畫風，明快平塗';
  ok(
    validateCast(split, SOURCE, 'zh', 'realistic').some((x) => x.includes('畫風不一致')),
    '同劇角色 image.style 不一致會報錯',
  );
}
{
  const ws = clone();
  ws[0].image.style = '  半寫實厚塗插畫，冷調低飽和民國配色，晨霧柔光  ';
  eq(validateCast(ws, SOURCE, 'zh', 'realistic').length, 0, 'image.style 僅空白差異不算不一致');
}

// 同批角色的提示詞不許雷同——模型套同一個模板，兩個年齡性別接近的角色會出成同一個人（issue #9）
eq(validateCast(CAST, SOURCE, 'zh', 'realistic').length, 0, '樣例四個角色的提示詞差異夠大，不誤攔');
{
  const dup = clone();
  dup[1].image.prompt = dup[0].image.prompt;
  ok(
    validateCast(dup, SOURCE, 'zh', 'realistic').some((x) => x.includes('生圖提示詞雷同')),
    '兩個角色的生圖提示詞完全相同會報錯',
  );
}
{
  // 只改年齡與衣服顏色 —— 這正是實際踩到的形態：個體描述太短，剩下全是樣板
  const near = clone();
  near[1].image.prompt = near[0].image.prompt
    .replace(/nineteen-year-old/g, 'twenty-two-year-old')
    .replace(/navy-blue/g, 'dark green');
  ok(
    validateCast(near, SOURCE, 'zh', 'realistic').some((x) => x.includes('生圖提示詞雷同')),
    '只改幾個詞的生圖提示詞照樣被攔',
  );
}
{
  const dupVoice = clone();
  dupVoice[1].voice.prompt = dupVoice[0].voice.prompt;
  ok(
    validateCast(dupVoice, SOURCE, 'zh', 'realistic').some((x) => x.includes('音色提示詞雷同')),
    '兩個角色的音色提示詞相同也會報錯',
  );
}
{
  // image.sheet 刻意不查：三分割槽排版規範是大段固定文字，真實角色之間本來就 63% 重合
  const dupSheet = clone();
  dupSheet[1].image.sheet = dupSheet[0].image.sheet;
  ok(
    !validateCast(dupSheet, SOURCE, 'zh', 'realistic').some((x) => x.includes('雷同')),
    'image.sheet 相同不報錯——它的固定排版文字佔比太高，設門必然誤攔',
  );
}
{
  // 極短提示詞不參與判定，否則空欄位之間會互相假命中
  const tiny = clone();
  tiny[0].image.prompt = 'a man';
  tiny[1].image.prompt = 'a man';
  ok(
    !validateCast(tiny, SOURCE, 'zh', 'realistic').some((x) => x.includes('生圖提示詞雷同')),
    '詞數太少的提示詞不參與雷同判定',
  );
}

// photoreal：負向提示詞漏了「畫出來的」那幾個詞要報錯，否則模型交插畫
const photorealCast = clone();
for (const c of photorealCast) {
  c.image.negativePrompt = STYLE_PRESETS.photoreal.negative;
  c.image.sheet = `${STYLE_PRESETS.photoreal.render}. ${c.image.sheet}`;
}
eq(validateCast(photorealCast, SOURCE, 'zh-TW', 'photoreal').length, 0, 'photoreal 角色卡校驗透過');
ok(
  validateCast(clone(), SOURCE, 'zh', 'photoreal').some((x) => x.includes('必須禁 illustration')),
  '樣例的負向提示詞沒禁 illustration，按 photoreal 校驗會報錯',
);
// photoreal 的 sheet 裡必須帶自己的渲染句，否則畫風會飄回插畫
const photorealNoRender = clone();
for (const c of photorealNoRender) c.image.negativePrompt = STYLE_PRESETS.photoreal.negative;
ok(
  validateCast(photorealNoRender, SOURCE, 'zh', 'photoreal').some((x) => x.includes('沒有 style=photoreal')),
  'photoreal 的 sheet 缺渲染句會報錯',
);

/* ---------------- 真實感 ---------------- */

// 一邊要真實感一邊在負向提示詞裡禁真實感，是自相矛盾的
ok(
  CAST.every((c) => !/photorealistic|3d render/i.test(c.image.negativePrompt)),
  'negativePrompt 不再禁 photorealistic / 3d render',
);
ok(
  CAST.every((c) => /plastic or waxy skin|poreless doll face/i.test(c.image.negativePrompt)),
  'negativePrompt 改禁「假」而不是禁「真」',
);
// 「扁平向量卡通」跟寫實擰巴，會導致同一批角色畫風飄
ok(
  CAST.every((c) => !/flat vector cartoon/i.test(c.image.sheet + c.image.prompt)),
  '不再用扁平向量卡通',
);
ok(
  CAST.every((c) => /Semi-realistic character illustration, painterly rendering/.test(c.image.sheet)),
  '畫風統一到半寫實厚塗',
);
// 真實感來自不完美
for (const [k, label] of [
  [/visible pores/i, '可見毛孔'],
  [/wet specular highlight/i, '眼睛溼潤高光'],
  [/asymmetric/i, '左右不對稱'],
  [/flyaway hair strands/i, '碎髮破輪廓'],
  [/visible weave/i, '布料織紋'],
  [/self-shadow/i, '褶皺自陰影'],
]) {
  ok(CAST.every((c) => k.test(c.image.sheet)), `設定圖提示詞含${label}`);
}
// 分割槽光照：左欄要體積，右側要平光——合併成一句全域光照就廢了
ok(
  CAST.every((c) => /LIGHTING IN THE LEFT ZONE ONLY/.test(c.image.sheet)),
  '左欄單獨打方向光',
);
ok(
  CAST.every((c) => /LIGHTING IN THE RIGHT ZONES: flat even orthographic/.test(c.image.sheet)),
  '右側保持平光正交',
);
ok(
  CAST.every((c) => /ambient occlusion/i.test(c.image.sheet)),
  '左欄有環境遮蔽',
);
ok(CAST.every((c) => /bust portrait/i.test(c.image.sheet)), '左欄是半身像');
// 模型預設會把肩膀裁掉、底邊做成圓角漸隱，必須顯式禁掉
ok(
  CAST.every((c) => /BOTH SHOULDERS ARE FULLY VISIBLE/.test(c.image.sheet)),
  '左欄要求肩膀完整',
);
ok(
  CAST.every((c) => /do not fade, vignette or round off the bottom edge/.test(c.image.sheet)),
  '左欄禁止底邊圓角漸隱',
);
ok(CAST.every((c) => /three FULL-BODY views/i.test(c.image.sheet)), '右上是三檢視');
// 兩欄的臉必須畫成同一個人，否則一張圖裡出現兩個長相
ok(
  CAST.every((c) => /must match the bust portrait/i.test(c.image.sheet)),
  '三檢視的臉要求與半身像一致',
);
// 「留空臉」是上一版的做法，已廢棄——提示詞裡不該再出現
ok(
  CAST.every((c) => !/left completely blank|NO eyes|NO facial features/i.test(c.image.sheet)),
  '提示詞裡沒有殘留的留空臉要求',
);

const withSheet = clone();
withSheet[0].sheetImage = 'images/x-sheet.png';
const sheetHtml = renderHtml(withSheet, 'x');
ok(sheetHtml.includes('images/x-sheet.png'), '設定圖被嵌入');
eq((sheetHtml.match(/class="plate zoom"/g) || []).length, 1, '一個角色只有一個印張');
// 點圖彈層 + 右下角一鍵複製圖片
ok(sheetHtml.includes('class="lightbox"'), '有圖片彈層');
ok(/data-src="images\/x-sheet\.png"/.test(sheetHtml), '彈層拿到圖片地址');
ok(/class="copy-img" data-img="images\/x-sheet\.png"/.test(sheetHtml), '圖上有複製按鈕');
ok(sheetHtml.includes('ClipboardItem'), '複製的是圖片本身而不是路徑');
ok(/blob\.type !== 'image\/png'/.test(sheetHtml), '非 PNG 先轉碼——Safari 只認 image/png');

console.log(`✓ ${passed} 項自測全部透過`);
