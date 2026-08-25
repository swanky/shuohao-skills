#!/usr/bin/env node
// 台灣正體用語檢查：掃出簡體字與大陸用詞，供 fork 合併上游之後逐檔收斂。
// 零依賴，只使用 node 標準庫。
//
//   node check-zh-tw.mjs                          檢查全部受版本控制的文字檔
//   node check-zh-tw.mjs README.md docs           只檢查指定路徑
//   node check-zh-tw.mjs --since upstream/main    只檢查與該 ref 有差異的檔案
//   node check-zh-tw.mjs --report                 列出全部命中，一律 exit 0
//   node check-zh-tw.mjs --json                   以 JSON 輸出，供其他腳本取用
//
// exit 1 表示有 error 級命中；warn 級只提示，不影響結束碼。

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// ── 簡體專用字 ──────────────────────────────────────────────
// 只收「台灣正體絕對不會用到」的字。一簡對多繁的字（發髮／乾幹／裡里／
// 鬆松／醜丑／面麵／只隻／復複覆／係系繫／表錶／板闆）不列在這裡——那是
// 語境判斷，交給人和模型，不是腳本能夠決定的。
// zh-tw-lint: off
export const SIMPLIFIED_CHARS = new Set(Array.from(
  '们个为这说讲认识语话词让过还进运达边远连迟选适递谁请谢论试记讯设访许议译证评调诉读课谈详该谋谨谦誉谱' +
  '门问间闲闹闭阅闻阔关铁银错镜锁键钟钱针铜锋链钢饭饮饱馆饰' +
  '贝财购贵费质赛赞贴账贤赚资赏责贯贫货贷赠车轮软转输载较辆辑轨' +
  '马驾骑验骂驱驰鸟鸡鱼鲜鲁鸿鹰鹅鸣凤风飞龙麦齐齿龟' +
  '红级纪约线练组细织终经结绝给统继续维绿缘纸纯缩编绍缓缝纳绕缠纠纬纲纵纷纹纺纽绅绊绑绒绚络绞绢绣绩绪绫绯绳绵绷综绽缀缄缅缆缉缎缔缚缪缴' +
  '时应学觉观见规视览长张业东图团园圆国华单卖买头实宝号员声处备够夺奋妇孙宁尔尝层属岁币师带帮广庆废异弃归当录' +
  '战扫执扩挂换据摆击权树检楼标样桥机杀气汉沟浅测济渐满滨灭热爱独狱猪疗盘监矿码确离种积称稳穷笔简签类粮纤罗' +
  '义习乐书乱争产亲仅从优伤价众传伟体侧俩债倾偿储儿党兰兴养兽冈军农决况冻净减凭刘则刚创剧剑劳势动务励劲' +
  '医区卫厂厅厉压厌县参双变叹听启响哑唤嘱围圣场坏块坚坛垒墙壮壳夹奖妆娱婴宠审宪宽宾对寻导尽岛帐庄库弯' +
  '忆忧怀态总恋恶悬惊惧惨愿拟担拥择挤挥损捡摄携敌断无显晓术条来极构栏档欢欧残毕汇泪洁浓润涨渊渔滤灯灵灾炉烛烦牵状猫献现环亩皱盐础礼祸窃竞筑篮紧网罚罢' +
  '严丰临举么乌乔乡陆陈阶际阵随难隐韩项顺须预领颇颈频颗题颜额飘饥驶骗历厨叙妈'
));
// zh-tw-lint: on

// ── 大陸用詞 ────────────────────────────────────────────────
// 這些詞用的是正體字形，簡體字檢查抓不到，只能逐詞列。
// error：這個 repository 已經定案的用語，出現就是漏改。
// warn：語境上偶爾成立，需要人看過再決定。
// zh-tw-lint: off
export const TERM_RULES = [
  { bad: '軟件', good: '軟體', level: 'error' },
  { bad: '硬件', good: '硬體', level: 'error' },
  { bad: '網絡', good: '網路', level: 'error' },
  { bad: '視頻', good: '影片', level: 'error' },
  { bad: '質量', good: '品質', level: 'error' },
  { bad: '信息', good: '資訊', level: 'error' },
  { bad: '數據', good: '資料', level: 'error' },
  { bad: '默認', good: '預設', level: 'error' },
  { bad: '缺省', good: '預設', level: 'error' },
  { bad: '屏幕', good: '螢幕', level: 'error' },
  { bad: '打印', good: '列印', level: 'error' },
  { bad: '分辨率', good: '解析度', level: 'error' },
  { bad: '水准', good: '水準', level: 'error' },
  { bad: '出圖', good: '生圖', level: 'error' },
  { bad: '反向提示詞', good: '負向提示詞', level: 'error' },
  { bad: '文本', good: '文字', level: 'warn' },
  { bad: '程序', good: '程式', level: 'warn' },
  { bad: '支持', good: '支援', level: 'warn' },
  { bad: '性格', good: '個性', level: 'warn' },
  { bad: '計劃', good: '計畫', level: 'warn' },
  { bad: '搜索', good: '搜尋', level: 'warn' },
  // 「通过」最容易一律換成「透過」。能換成「經由」才是「透過」，
  // 能換成「合格」就是「通過」——品質門、校驗、測試講的都是後者。
  {
    pattern: /(全部|視為|直到|照常|樣例|校驗|測試|品質門)透過|透過(校驗|測試|全部|態|綠)/,
    bad: '透過',
    good: '通過（能換成「合格」就是「通過」）',
    level: 'error',
  },
];
// zh-tw-lint: on

// ── 白名單 ──────────────────────────────────────────────────
// 這個 repository 有兩處簡體是功能本身，不是漏改：
//   1. novel-characters 的 STRINGS.zh 語系表（`--lang zh` 的輸出）
//   2. 自測裡驗證該語系輸出的斷言
// 另外 ja 語系字串用的是日文新字體，與簡體字形重疊，一併排除。
export const ALLOWLIST = [
  // 原始語料是輸入不是產物：原典什麼字形就是什麼字形，改了它引文就不是證據了。
  { path: 'testdata/corpora/**', skip: true },
  // 品質基準是已驗收的產物快照，整份以原文為準：`persona.evidence` 是逐字引文
  // （`validate` 會比對），`aliases` 收的是原文出現過的稱謂形式，歸併靠它比對。
  // 這兩處的字形跟著語料走，不跟著介面語言走。基準本身的用詞由 novel-characters
  // 自己的 validate 把關，不是這支腳本的職責。
  { path: 'testdata/benchmarks/**', skip: true },
  // 分卷摘要是中間產物，裡面的 evidence 是原文逐字引文，字形跟著語料走。
  { path: 'docs/plans/classic-chinese-novels/hongloumeng-60ep/volume-summaries/**', skip: true },
  {
    path: 'skills/novel-characters/scripts/novel-characters.mjs',
    block: { start: /^\s*zh: \{\s*$/, end: /^\s*(('zh-TW')|zh-TW|en|ja): \{\s*$/ },
  },
  {
    path: 'skills/novel-characters/scripts/novel-characters.mjs',
    block: { start: /^\s*ja: \{\s*$/, end: /^\s*(('zh-TW')|zh-TW|en|zh): \{\s*$|^\};\s*$/ },
  },
  { path: 'skills/novel-characters/scripts/novel-characters.mjs', line: /\bzh: '|\bja: '/ },
  { path: 'skills/novel-characters/scripts/selftest.mjs', line: /'zh'|zh-TW/ },
  { path: '**', line: /\bja: '/ },
  // 原文引文永遠保持原文語言——這是 repository 的硬規則，翻了就不是證據。
  // JSON 沒辦法寫註解式的豁免標記，所以直接認欄位名。
  { path: '**', line: /"evidence"\s*:|"quotes"\s*:/ },
];

// 文件裡的反例表格（「別寫這個」那一欄）本來就要寫出簡體與大陸用詞，
// 用標記讓它們豁免：單行寫 `zh-tw-lint: allow`，整段用 off／on 包起來。
// Markdown 寫成 <!-- zh-tw-lint: off -->，程式碼寫成 // zh-tw-lint: off。
const MARK_OFF = /zh-tw-lint:\s*off/;
const MARK_ON = /zh-tw-lint:\s*on/;
const MARK_ALLOW = /zh-tw-lint:\s*allow/;

const TEXT_EXTS = new Set(['.md', '.mjs', '.js', '.json', '.txt', '.html', '.css', '.sh', '.ps1', '.yml', '.yaml', '.svg']);

export function isTextPath(p) {
  return TEXT_EXTS.has(path.extname(p).toLowerCase());
}

/** 取出適用於這個檔案的白名單規則。 */
export function allowlistFor(relPath) {
  const norm = relPath.split(path.sep).join('/');
  return ALLOWLIST.filter((r) => {
    if (r.path === '**') return true;
    if (r.path.endsWith('/**')) return norm.startsWith(r.path.slice(0, -2));
    return r.path === norm;
  });
}

/** 整份跳過的檔案（原始語料這類「輸入不是產物」的東西）。 */
export function isSkipped(relPath) {
  return allowlistFor(relPath).some((r) => r.skip);
}

/** 掃一份文字，回傳命中清單。跨行的白名單區塊在這裡維持狀態。 */
export function scanText(relPath, text) {
  if (isSkipped(relPath)) return [];
  const rules = allowlistFor(relPath);
  const lineRules = rules.filter((r) => r.line);
  const blockRules = rules.filter((r) => r.block);
  const hits = [];
  let inBlock = null;
  let marked = false;

  text.split(/\r?\n/).forEach((line, i) => {
    if (MARK_ON.test(line)) { marked = false; return; }
    if (MARK_OFF.test(line)) { marked = true; return; }
    if (marked || MARK_ALLOW.test(line)) return;

    if (inBlock) {
      if (inBlock.block.end.test(line)) inBlock = null;
      else return;
    }
    const opening = blockRules.find((r) => r.block.start.test(line));
    if (opening) { inBlock = opening; return; }
    if (lineRules.some((r) => r.line.test(line))) return;

    const simplified = [...new Set(Array.from(line).filter((ch) => SIMPLIFIED_CHARS.has(ch)))];
    if (simplified.length) {
      hits.push({ file: relPath, line: i + 1, level: 'error', kind: 'simplified', found: simplified.join(''), hint: '簡體字，改成正體' });
    }
    for (const rule of TERM_RULES) {
      if (rule.pattern ? rule.pattern.test(line) : line.includes(rule.bad)) {
        hits.push({ file: relPath, line: i + 1, level: rule.level, kind: 'term', found: rule.bad, hint: `改成「${rule.good}」` });
      }
    }
  });
  return hits;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// 列路徑一律加 -z：git 預設會把非 ASCII 路徑加引號並轉義成 \344\270\255 這種
// 形式，直接拿來當路徑會 stat 失敗，中文檔名的檔案就被靜默跳過了。
function gitPaths(args, cwd) {
  return execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** 決定要掃哪些檔案：全部受版本控制的文字檔，或與某個 ref 有差異的部分。 */
export function collectFiles({ root, since = null, paths = [] }) {
  // 沒指定 ref 時連未追蹤的新檔案也掃——合併途中新增的檔案同樣要合規。
  const listed = since
    ? gitPaths(['diff', '--name-only', '--diff-filter=ACMR', since], root)
    : gitPaths(['ls-files', '--cached', '--others', '--exclude-standard'], root);
  let files = [...new Set(listed.filter(isTextPath))];
  if (paths.length) {
    const wanted = paths.map((p) => path.relative(root, path.resolve(p)).split(path.sep).join('/'));
    files = files.filter((f) => wanted.some((w) => f === w || f.startsWith(`${w}/`)));
  }
  return files;
}

const USAGE = [
  '台灣正體用語檢查',
  '',
  '  node check-zh-tw.mjs                          檢查全部受版本控制的文字檔',
  '  node check-zh-tw.mjs README.md docs           只檢查指定路徑',
  '  node check-zh-tw.mjs --since upstream/main    只檢查與該 ref 有差異的檔案',
  '  node check-zh-tw.mjs --report                 列出全部命中，一律 exit 0',
  '  node check-zh-tw.mjs --json                   以 JSON 輸出',
].join('\n');

export function main(argv) {
  const paths = [];
  let since = null;
  let report = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--since') { since = argv[i + 1]; i += 1; }
    else if (a === '--report') { report = true; }
    else if (a === '--json') { json = true; }
    else if (a === '-h' || a === '--help') { console.log(USAGE); return 0; }
    else if (a.startsWith('-')) { console.error(`未知選項 ${a}`); return 2; }
    else { paths.push(a); }
  }

  const root = git(['rev-parse', '--show-toplevel'], process.cwd());
  const files = collectFiles({ root, since, paths });
  const hits = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    hits.push(...scanText(rel, readFileSync(abs, 'utf8')));
  }

  const errors = hits.filter((h) => h.level === 'error');
  const warns = hits.filter((h) => h.level === 'warn');

  if (json) {
    console.log(JSON.stringify({ files: files.length, errors: errors.length, warns: warns.length, hits }, null, 2));
    return report || !errors.length ? 0 : 1;
  }

  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  for (const [file, list] of byFile) {
    console.log(`\n${file}`);
    for (const h of list) {
      console.log(`  ${h.level === 'error' ? '✗' : '·'} ${String(h.line).padStart(5)}  ${h.found}  ${h.hint}`);
    }
  }
  console.log(`\n掃描 ${files.length} 個檔案：${errors.length} 項待改、${warns.length} 項待確認`);
  if (!errors.length && !warns.length) console.log('全部符合台灣正體用語規範');
  return report || !errors.length ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('check-zh-tw.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
