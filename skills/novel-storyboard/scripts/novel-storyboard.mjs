#!/usr/bin/env node
// novel-storyboard — deterministic helpers for the novel-storyboard skill (分鏡).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */
/*
 * AI 短劇的前提刻在骨子裡，三層結構也由此而來：
 *
 *   段（segment）＝ 一次影片生成呼叫，上限就是模型單段時長（預設 15 秒）
 *   分鏡（cut）  ＝ 段內的一次切鏡，2–5 秒——短劇觀眾的注意力節奏
 *   分鏡圖       ＝ 每個分鏡一張關鍵幀：第 1 個分鏡的是主分鏡圖（釘在
 *                  0.00 秒），其餘是子分鏡圖（各釘在自己的切點時刻）
 *
 * 一段的畫面由這串分鏡圖 + 一條 H3 提示詞共同控制：多圖對齊指令
 * 把每張圖釘在對應秒數上，[Shot k] 的切點時刻和分鏡秒數逐一對賬。
 * 多切一刀的成本幾乎為零，所以不心疼分鏡數量，只守節奏。
 */

export const DEFAULT_PARAMS = {
  maxSegmentSeconds: 15, // 影片模型單段生成上限（秒）
  minCutSeconds: 2,      // 單個分鏡下限
  maxCutSeconds: 5,      // 單個分鏡上限——3 秒左右是短劇的呼吸
  maxOnScreen: 3,        // 單個分鏡同框人數上限，超了必須帶拆解說明
  tolerance: 0.15,       // 每集總時長對劇本目標的容差
};

export function paramsOf(doc) {
  return { ...DEFAULT_PARAMS, ...(doc?.params ?? {}) };
}

/** 景別列舉：中文詞必須出現在該分鏡的分鏡圖提示詞裡（分鏡圖提示詞是中文）。 */
export const SHOT_SIZES = {
  'extreme-wide': { zh: '大遠景', phrase: 'extreme wide shot' },
  wide: { zh: '全景', phrase: 'wide shot' },
  medium: { zh: '中景', phrase: 'medium shot' },
  close: { zh: '特寫', phrase: 'close-up' },
  'extreme-close': { zh: '大特寫', phrase: 'extreme close-up' },
};

/** 運鏡列舉：直接用 H3 官方詞表，原樣寫進該分鏡的 [Shot k] 段落。 */
export const CAMERA_MOVES = {
  'Static Shot': '固定',
  'Push In': '推',
  'Pull Out': '拉',
  'Zoom In': '變焦推',
  'Zoom Out': '變焦拉',
  'Pan Left': '左搖',
  'Pan Right': '右搖',
  'Truck Left': '左移',
  'Truck Right': '右移',
  'Tilt Up': '仰搖',
  'Tilt Down': '俯搖',
  'Pedestal Up': '升',
  'Pedestal Down': '降',
  'Arc Shot': '環繞',
  'Tracking Shot': '跟拍',
  'Shake Slightly': '輕微晃動',
  'Shake Strongly': '強烈晃動',
  'POV': '主觀視角',
  'Roll Clockwise': '順旋',
  'Roll Counterclockwise': '逆旋',
};

/** 穩定性列舉：跟運鏡是兩件事——固定機位也可以微晃。 */
export const STABILITY = { stable: '穩定', 'slight-shake': '微晃', handheld: '手持' };

/**
 * 構圖量化欄位（每鏡必填）。純參考圖出片時沒有分鏡圖替正文說清
 * 「多近、誰在哪、眼睛看哪」，這些資訊要麼寫成字，要麼就地消失。
 */
export const COMPOSITION_FIELDS = ['lens', 'cameraPosition', 'composition', 'eyeline', 'focus', 'stability'];

const CJK = /[㐀-鿿぀-ヿ가-힯]/;
const r1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* H3 提示詞的確定性骨架                                                 */
/* ------------------------------------------------------------------ */
/*
 * 結構由 H3 官方規範（h3-prompt-writing skill）定死，而且對齊指令和
 * 切點時刻都能從分鏡結構推匯出來——所以逐字設門，一個字元都不許漂。
 */

export const H3_I2VA_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
export const H3_FIELDS = ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'];

/** 骨架 token 按語言取：預設英文（官方規範口徑）；'zh' 整條中文（只保留 <d>[Chinese] 和 (S1) 兩個模型級 token）。 */
export const H3_TOKENS = {
  zh: {
    i2va: '目標影片在 0.00 秒處完全參照圖 1（來自鏡頭 1）。',
    alignHead: '參考圖與目標影片的對齊——',
    alignItem: (k, t) => `圖 ${k}（來自鏡頭 ${k}）對齊目標影片 ${t} 秒處`,
    alignTail: '。',
    fields: ['整體視聽描述：', '整體音景：', '非敘事配樂：'],
    shot: (k) => `[鏡頭 ${k}]`,
    cutMark: (k, time) => `[鏡頭 ${k}] 於 ${time}，`,
  },
  en: {
    i2va: H3_I2VA_LINE,
    alignHead: 'How the reference pictures align with the target video — ',
    alignItem: (k, t) => `Picture ${k} (from Shot ${k}) aligns with the ${t}-second mark of the target video`,
    alignTail: '.',
    fields: H3_FIELDS,
    shot: (k) => `[Shot ${k}]`,
    cutMark: (k, time) => `[Shot ${k}] At ${time},`,
  },
};

/** 段內切點時刻表：[0, c1, c1+c2, …]（不含結尾）。 */
export function cutStarts(cuts) {
  const starts = [];
  let t = 0;
  for (const c of cuts ?? []) {
    starts.push(r1(t));
    t += c?.seconds ?? 0;
  }
  return starts;
}

/** [Shot k] 的切點時刻格式：00:03.000（分:秒.毫秒）。 */
export function h3CutTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * 首行對齊指令：單分鏡的段用 I2VA 固定句式；多分鏡的段把每張分鏡圖
 * 釘在自己的切點秒數上。整行由分鏡結構推導，validate 逐字對賬。
 */
export function h3AlignmentLine(cuts, lang = 'en') {
  const tk = H3_TOKENS[lang] ?? H3_TOKENS.zh;
  if (!cuts || cuts.length <= 1) return tk.i2va;
  const starts = cutStarts(cuts);
  const parts = cuts.map((c, i) => tk.alignItem(i + 1, starts[i].toFixed(2)));
  return `${tk.alignHead}${parts.join(lang === 'en' ? '; ' : '；')}${tk.alignTail}`;
}

/** 臺詞/畫面文字之外的部分——H3 要求它全英文，人名也只許出現在 <d> 裡。 */
export function h3Remainder(prompt) {
  return String(prompt ?? '')
    .replace(/<d>[\s\S]*?<\/d>/g, ' ')
    .replace(/"[^"\n]*"/g, ' ');
}

/** 把 h3Prompt 的描述正文按 [鏡頭 k] / [Shot k] 切成每個分鏡自己的段落。 */
export function h3CutSlices(prompt, cutCount, lang = 'en') {
  const tk = H3_TOKENS[lang] ?? H3_TOKENS.zh;
  const h3 = String(prompt ?? '');
  const bodyStart = h3.indexOf(tk.fields[0]);
  const bodyEnd = h3.indexOf(tk.fields[1]);
  if (bodyStart < 0) return [];
  const body = h3.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
  const slices = [];
  for (let k = 1; k <= cutCount; k++) {
    const a = body.indexOf(tk.shot(k));
    if (a < 0) {
      slices.push(null);
      continue;
    }
    const b = body.indexOf(tk.shot(k + 1));
    slices.push(body.slice(a, b < 0 ? undefined : b));
  }
  return slices;
}

/* ------------------------------------------------------------------ */
/* Seedance 提示詞：程式按官方結構拼                                       */
/* ------------------------------------------------------------------ */
/*
 * 寫法見 references/seedance-prompt.md。模型只寫每一切的鏡頭正文（cut.shot），
 * 其餘全由這裡拼：參考圖宣告、段級走位、逐鏡量化欄位、臺詞 {}、音效 <>、
 * 配樂（）、編號約束。時間層用鏡頭順序表達，不寫秒數——官方說精確時間不穩定。
 * 畫風層（視覺風格）不在這裡：它由呼叫方在提交時附加。
 */

// 運鏡行用完整的中文說法；詞表裡本來就完整的原樣用
const SEEDANCE_CAMERA = { 'Static Shot': '固定鏡頭', 'Push In': '推鏡', 'Pull Out': '拉鏡' };
export const seedanceCamera = (camera) => SEEDANCE_CAMERA[camera] ?? CAMERA_MOVES[camera] ?? '';

/** 鏡頭正文裡不許出現的東西：這些由程式按真實結構加，正文寫了就會重複或錯位。 */
export const SEEDANCE_FORBIDDEN = [
  [/\d+(?:\.\d+)?\s*(?:[–\-~至到]\s*\d+(?:\.\d+)?\s*)?秒|\d{1,2}:\d{2}/, '時間'],
  [/【鏡頭|鏡頭\s*\d/, '鏡頭編號'],
  [/@\s*\[?圖片|<Picture|\[Shot|<\/?d>/i, '圖片引用或 H3 標記'],
  [/[{}<>（）]/, '協議符號（臺詞 {} 從劇本取，音效 <> 與配樂（）由程式套）'],
];

export const SEEDANCE_NO_SUBTITLES = '保持無字幕，避免生成任何文字或字幕';
export const SEEDANCE_NO_TWINS = '影片全程禁止出現外形、著裝、配飾完全一致的人物';

/**
 * 附件兩條路：這一段每切都有分鏡圖 → 分鏡路徑，只掛分鏡圖；否則 → 參考圖路徑，
 * 掛場景、人物、道具的設定圖，已有的分鏡圖接在後面並在對應鏡頭註明構圖參考。
 * 越需要精準參考的越靠前：場景 → 人物 → 道具 → 分鏡圖。
 *
 * @param scene  expandScript 展開後的那一場（取臺詞原文）；沒有劇本時臺詞行寫 {}
 * @param names  { scene(id), char(id), prop(id) } → 顯示名
 * @param image  (kind, rel) → src|null，與報告同一個定位函式，判斷分鏡圖在不在
 * @param constraints 呼叫方的全域性約束，逐條拼進【約束】
 * @returns {{ prompt: string, refs: {kind, label, file}[] }}
 */
export function seedancePrompt(seg, { scene = null, names = {}, image = null, constraints = [] } = {}) {
  const nm = {
    scene: names.scene ?? ((id) => id),
    char: names.char ?? ((id) => id),
    prop: names.prop ?? ((id) => id),
  };
  const cuts = seg?.cuts ?? [];
  const frames = cuts.map((_, ci) => (image ? image('frame', `${seg.id}/f${ci + 1}.png`) : null));
  const refs = [];
  if (!cuts.length || !frames.every(Boolean)) {
    const sheet = (label) => ({ kind: 'sheet', label, file: `${slug(label)}-sheet.png` });
    if (scene?.sceneId) refs.push(sheet(nm.scene(scene.sceneId)));
    for (const id of new Set(cuts.flatMap((c) => c?.characters ?? []))) if (id !== 'VO') refs.push(sheet(nm.char(id)));
    for (const id of new Set(cuts.flatMap((c) => c?.props ?? []))) refs.push(sheet(nm.prop(id)));
  }
  const frameRef = new Map();
  frames.forEach((src, ci) => {
    if (!src) return;
    refs.push({ kind: 'frame', label: `分鏡圖 #${ci + 1}`, file: `${seg.id}/f${ci + 1}.png` });
    frameRef.set(ci, refs.length);
  });

  const out = refs.map((r, i) => `@[圖片${i + 1}] = ${r.label}`);
  if (out.length) out.push('');
  const blocking = String(seg?.blocking ?? '').trim();
  if (blocking) out.push('【人物關係與構圖邏輯】', blocking, '');

  cuts.forEach((cut, ci) => {
    // 每一行只在有內容時出現；臺詞行例外——沒有臺詞也寫 {}，告訴模型這一鏡不說話
    const line = (k, v) => {
      const text = String(v ?? '').trim();
      if (text) out.push(`${k}：${text}`);
    };
    out.push(`【鏡頭${ci + 1}】`);
    line('焦距', cut?.lens);
    line('機位', cut?.cameraPosition);
    line('構圖', cut?.composition);
    line('運鏡', seedanceCamera(cut?.camera));
    line('景別', SHOT_SIZES[cut?.size]?.zh);
    const ref = frameRef.get(ci);
    const shot = String(cut?.shot ?? '').trim();
    if (shot) out.push(`畫面：${shot}${ref ? `（構圖參考 @圖片${ref}）` : ''}`);
    line('光影', cut?.lighting);
    const [from, to] = cut?.beats ?? [];
    const spoken = scene && Number.isInteger(from) && Number.isInteger(to)
      ? scene.beats.slice(from - 1, to).filter((b) => b.kind === 'line')
      : [];
    // 臺詞逐字進 {}；身份與語氣由鏡頭正文交代，畫外音按官方寫法標在 {} 外面
    out.push(`臺詞：${spoken.length ? spoken.map((b) => `${b.speaker === 'VO' ? '以畫外音說' : ''}{${b.text}}`).join(' ') : '{}'}`);
    line('視線落點', cut?.eyeline);
    line('焦點', cut?.focus);
    line('穩定性', STABILITY[cut?.stability] ?? cut?.stability);
    line('音效', cut?.sfx);
    out.push('');
  });

  const soundscape = String(seg?.soundscape ?? '').trim();
  const music = String(seg?.music ?? '').trim();
  if (soundscape) out.push(`<${soundscape}>`);
  if (music) out.push(`（${music}）`);
  if (soundscape || music) out.push('');

  // 本管線不要字幕；同段多人同框時禁雙胞胎——官方已知坑，放進約束末尾
  const rules = [...constraints.map((c) => String(c).trim()).filter(Boolean)];
  if (!rules.includes(SEEDANCE_NO_SUBTITLES)) rules.push(SEEDANCE_NO_SUBTITLES);
  const crowded = cuts.some((c) => (c?.characters ?? []).filter((id) => id !== 'VO').length >= 2);
  if (crowded && !rules.includes(SEEDANCE_NO_TWINS)) rules.push(SEEDANCE_NO_TWINS);
  out.push('【約束】', ...rules.map((r, i) => `${i + 1}. ${r}`));
  return { prompt: out.join('\n'), refs };
}

/* ------------------------------------------------------------------ */
/* 劇本節拍展開                                                          */
/* ------------------------------------------------------------------ */
/*
 * 與 novel-script 相同的計秒規則，這裡刻意重新實現而不是跨目錄
 * import——每個 skill 必須自包含、可以單獨拷走。參數從 script.json
 * 的 params 裡讀，兩邊天然一致。
 */

const SCRIPT_DEFAULTS = { charsPerSecond: 4.5, actionSeconds: 2.5 };
const lineChars = (line) => String(line ?? '').replace(/\s+/g, '').length;

/** 把 script.json 展開成分鏡要認領的節拍清單：ep → scenes → beats。 */
export function expandScript(script) {
  const p = { ...SCRIPT_DEFAULTS, ...(script?.params ?? {}) };
  const eps = new Map();
  for (const ep of script?.episodes ?? []) {
    const scenes = (ep?.scenes ?? []).map((sc, i) => ({
      sceneIndex: i + 1,
      sceneId: sc.sceneId,
      lighting: sc.lighting ?? '',
      characters: sc.characters ?? [],
      props: sc.props ?? [],
      beats: (sc.flow ?? []).map((b, j) => {
        const isLine = typeof b?.line === 'string';
        return {
          n: j + 1,
          kind: isLine ? 'line' : 'action',
          seconds: r1(isLine ? lineChars(b.line) / p.charsPerSecond : p.actionSeconds),
          speaker: isLine ? b.speaker : undefined,
          delivery: isLine ? (b.delivery ?? '') : undefined,
          text: isLine ? b.line : b.action,
        };
      }),
    }));
    eps.set(ep.ep, { ep: ep.ep, targetSeconds: ep.targetSeconds, scenes });
  }
  return eps;
}

export const segSeconds = (segment) => r1((segment?.cuts ?? []).reduce((n, c) => n + (c?.seconds ?? 0), 0));

/* ------------------------------------------------------------------ */
/* 鏡頭配方卡庫（可選掛載）                                               */
/* ------------------------------------------------------------------ */
/*
 * shot-recipes 是可選掛載的卡庫：給了 --shots <卡片目錄> 才有 shot-recipe
 * 這道門。兩個 skill 必須各自獨立、誰沒有誰都能跑，所以這裡刻意不
 * import shot-recipes.mjs，自己寫一份受限 frontmatter 解析——與
 * expandScript 同一個先例（跨目錄 import 會讓 skill 拷不走）。
 *
 * 只取門要用的機器欄位，正文一概不讀；語法受限到只認 `key: 標量` 與
 * `key: [a, b, c]` 行內陣列——受限就沒有歧義，25 行足夠。卡片格式的合法性
 * 由 shot-recipes 自己的 lint 負責，這邊只管讀得懂的部分。
 */

const RECIPE_FIELDS = new Set(['id', 'name', 'name_en', 'cuts', 'must_phrases', 'sizes', 'cameras']);
const unquote = (s) => String(s).replace(/^['"](.*)['"]$/, '$1').trim();

/** 受限 frontmatter 解析：只回機器欄位，沒有 id 就當不是卡片。 */
export function parseCardFields(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!m) return null;
  const card = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv || !RECIPE_FIELDS.has(kv[1])) continue;
    const v = kv[2].trim();
    if (v.startsWith('[')) {
      const inner = v.replace(/^\[/, '').replace(/\]$/, '').trim();
      card[kv[1]] = inner
        ? inner.split(',').map(unquote).filter((x) => x !== '').map((x) => (/^-?\d+$/.test(x) ? Number(x) : x))
        : [];
    } else {
      card[kv[1]] = unquote(v);
    }
  }
  return card.id ? card : null;
}

/** 讀卡片目錄 → Map<id, 機器欄位>。只吃頂層 .md（en/ 是正文翻譯，機器欄位只有一份）。 */
export function loadRecipes(dir) {
  const root = resolve(dir);
  const cards = new Map();
  if (!existsSync(root)) return cards;
  for (const f of readdirSync(root).filter((x) => x.endsWith('.md')).sort()) {
    const card = parseCardFields(readFileSync(join(root, f), 'utf8'));
    if (card) cards.set(card.id, card);
  }
  return cards;
}

/*
 * 建議景別 / 運鏡**刻意不設門**，只在報告裡提示偏離，理由三條：
 *   1. 配方是語彙不是法條——同一張卡在豎屏與橫屏、兩人與三人、有臺詞
 *      與無臺詞的情況下，景別會合理偏移（卡庫那邊把它們存成集合而不是
 *      序列，就是從結構上杜絕升級成硬門）
 *   2. 可選掛載的東西一旦變嚴就沒人掛——掛了反而被攔，下次就不掛了
 *   3. 儲存庫已有明文判例：誤攔的門比沒有門更糟，門的信用比數量重要
 */
export function recipeDrift(cut, card) {
  const sizes = Array.isArray(card?.sizes) ? card.sizes : [];
  const cameras = Array.isArray(card?.cameras) ? card.cameras : [];
  return {
    sizes: sizes.length && !sizes.includes(cut?.size) ? sizes : [],
    cameras: cameras.length && !cameras.includes(cut?.camera) ? cameras : [],
  };
}

/* ------------------------------------------------------------------ */
/* 門失敗累積                                                           */
/* ------------------------------------------------------------------ */
/*
 * 每次 validate / checkup 的結果本來跑完就沒了，於是「模型最常違反哪條規則」
 * 只能靠印象。這裡把每次執行與每條失敗追加到工作目錄的 .gates.jsonl，
 * stats 子命令再讀回來，回答三個問題：
 *   哪道門最常響   → 那條規則模型最常無視，措辭該改
 *   哪道門從沒響過 → 可能是死門，或者規則已經被模型內化了
 *   失敗詳情長什麼樣 → 反覆出現卻沒有門的那類問題，只能靠人看這些自由文字
 *
 * 刻意做成純函式 + CLI 負責 IO：自測不落盤也能驗。
 * 寫不進去就靜默跳過——日誌是附加價值，不能讓它擋住主流程。
 */

export const GATE_LOG = '.gates.jsonl';

/** 一次執行產生的日誌行（物件陣列，CLI 負責序列化落盤）。 */
export function gateLogEntries(gates, { doc = '', at = '' } = {}) {
  const list = Array.isArray(gates) ? gates : [];
  if (!list.length) return [];
  const failed = list.filter((g) => !g.ok);
  const rows = [{ kind: 'run', at, doc, gates: list.length, failed: failed.length }];
  for (const g of failed) {
    rows.push({ kind: 'fail', at, doc, gate: g.id, label: g.label, detail: g.detail ?? '' });
  }
  return rows;
}

/** 彙總日誌行。allGates 給全量門 id，用來找出「從沒響過」的那些。 */
export function summarizeGateLog(entries, allGates = []) {
  const rows = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  const runs = rows.filter((e) => e.kind === 'run');
  const fails = rows.filter((e) => e.kind === 'fail');
  const byGate = new Map();
  for (const f of fails) {
    if (!byGate.has(f.gate)) byGate.set(f.gate, { gate: f.gate, label: f.label ?? f.gate, count: 0, samples: [] });
    const rec = byGate.get(f.gate);
    rec.count += 1;
    if (rec.samples.length < 3 && f.detail) rec.samples.push(f.detail);
  }
  const ranked = [...byGate.values()].sort((a, b) => b.count - a.count || a.gate.localeCompare(b.gate));
  const silent = allGates.filter((id) => !byGate.has(id));
  return {
    runs: runs.length,
    cleanRuns: runs.filter((r) => !r.failed).length,
    fails: fails.length,
    ranked,
    silent,
  };
}

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */

/** 報告與品質門共用的確定性統計。script 是硬前提——分鏡離開劇本沒有意義。 */
export function computeStats(board, script) {
  const params = paramsOf(board);
  const expanded = expandScript(script);
  const episodes = [];
  const batches = new Map(); // sceneId|lighting → 生成批次
  const dialogue = [];       // 配音對齊單：段 × 分鏡 × 說話人 × 臺詞

  for (const ep of board?.episodes ?? []) {
    const sEp = expanded.get(ep.ep);
    let total = 0;
    let cutCount = 0;
    let withLines = 0;
    for (const seg of ep?.segments ?? []) {
      const scene = sEp?.scenes?.[seg.sceneIndex - 1];
      const secs = segSeconds(seg);
      total += secs;
      let segHasLine = false;
      (seg?.cuts ?? []).forEach((cut, ci) => {
        cutCount++;
        if (!scene) return;
        const [from, to] = cut.beats ?? [];
        for (const b of scene.beats.slice((from ?? 1) - 1, to ?? 0)) {
          if (b.kind !== 'line') continue;
          segHasLine = true;
          dialogue.push({ segment: seg.id, cut: ci + 1, ep: ep.ep, speaker: b.speaker, line: b.text, seconds: b.seconds });
        }
      });
      if (segHasLine) withLines++;
      if (scene) {
        const key = `${scene.sceneId}|${scene.lighting}`;
        if (!batches.has(key)) {
          batches.set(key, { sceneId: scene.sceneId, lighting: scene.lighting, segments: [], characters: new Set(), props: new Set() });
        }
        const batch = batches.get(key);
        batch.segments.push(seg.id);
        for (const cut of seg?.cuts ?? []) {
          for (const c of cut.characters ?? []) batch.characters.add(c);
          for (const pr of cut.props ?? []) batch.props.add(pr);
        }
      }
    }
    episodes.push({
      ep: ep.ep,
      target: sEp?.targetSeconds ?? 0,
      segments: (ep?.segments ?? []).length,
      cuts: cutCount,
      totalSeconds: r1(total),
      avgCutSeconds: cutCount ? r1(total / cutCount) : 0,
      withLines,
    });
  }

  const totals = {
    segments: episodes.reduce((n, e) => n + e.segments, 0),
    cuts: episodes.reduce((n, e) => n + e.cuts, 0),
    seconds: r1(episodes.reduce((n, e) => n + e.totalSeconds, 0)),
    targetSeconds: episodes.reduce((n, e) => n + e.target, 0),
    withLines: episodes.reduce((n, e) => n + e.withLines, 0),
    avgCutSeconds: 0,
  };
  totals.avgCutSeconds = totals.cuts ? r1(totals.seconds / totals.cuts) : 0;

  return {
    params,
    episodes,
    totals,
    dialogue,
    batches: [...batches.values()].map((b) => ({
      sceneId: b.sceneId, lighting: b.lighting, segments: b.segments,
      characters: [...b.characters], props: [...b.props],
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 品質門                                                               */
/* ------------------------------------------------------------------ */

export function gateReport(board, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const params = paramsOf(board);
  const script = ctx.script ?? null;
  const expanded = script ? expandScript(script) : null;
  const eps = Array.isArray(board?.episodes) ? board.episodes : [];
  const bad = {
    coverage: [], segCap: [], cutLen: [], fit: [], duration: [], crowd: [],
    id: [], size: [], camera: [], frame: [], names: [], refs: [],
    h3s: [], h3d: [], h3e: [], recipe: [], comp: [], sd: [],
  };
  // 配方卡庫是可選掛載：ctx.recipes 為空就整門跳過（不是「沒有 cut 帶 recipe」就跳過）
  const recipes = ctx.recipes ?? null;
  let recipeRefs = 0;
  // 提示詞語言：預設英文——官方規範的口徑（臺詞仍在 <d> 裡保留原文）；'zh' 可切整條中文
  const promptLang = board?.promptLang ?? 'en';

  // 影片提示詞禁人名：outline 的名字 + cast 的名字與別名。這是 H3 與 Seedance 官方規範的要求，
  // 不跟著語言變；分鏡圖提示詞反過來直呼其名——名字指向掛上去的那張設定圖
  const banned = [];
  for (const c of ctx.outline?.characters ?? []) if (c?.name) banned.push(c.name);
  for (const c of ctx.cast?.characters ?? []) {
    if (c?.name) banned.push(c.name);
    for (const a of c?.aliases ?? []) banned.push(a);
  }

  for (const ep of eps) {
    const label = `E${String(ep?.ep).padStart(2, '0')}`;
    const sEp = expanded?.get(ep?.ep);
    if (expanded && !sEp) bad.refs.push(`${label} 在劇本里不存在`);

    // 段號紀律：格式、集號一致、連號
    (ep?.segments ?? []).forEach((seg, i) => {
      const want = `${label}-${String(i + 1).padStart(2, '0')}`;
      if (seg?.id !== want) bad.id.push(`第 ${i + 1} 段應為 ${want}，實際「${seg?.id}」`);
    });

    let prevSceneIndex = 0;
    for (const seg of ep?.segments ?? []) {
      const sid = seg?.id ?? '?';
      const cuts = seg?.cuts ?? [];
      const total = segSeconds(seg);

      if (!(total > 0) || total > params.maxSegmentSeconds) {
        bad.segCap.push(`${sid} 共 ${total} 秒`);
      }

      const h3 = String(seg?.h3Prompt ?? '');
      // H3 結構：首行對齊指令逐字對賬（由分鏡結構按 promptLang 推導），三欄位按序，切點時刻逐個對
      const tk = H3_TOKENS[promptLang] ?? H3_TOKENS.zh;
      const wantLine = h3AlignmentLine(cuts, promptLang);
      if (!h3.trimStart().startsWith(wantLine)) {
        bad.h3s.push(`${sid} 首行對齊指令和分鏡結構對不上（promptLang=${promptLang}）`);
      } else {
        const idx = tk.fields.map((f) => h3.indexOf(f));
        if (idx.some((i) => i < 0) || !(idx[0] < idx[1] && idx[1] < idx[2])) {
          bad.h3s.push(`${sid} 三個核心欄位缺失或順序不對`);
        } else {
          const starts = cutStarts(cuts);
          if (h3.indexOf(tk.shot(1), idx[0]) < 0) bad.h3s.push(`${sid} 描述正文缺 ${tk.shot(1)}`);
          for (let k = 2; k <= cuts.length; k++) {
            const mark = tk.cutMark(k, h3CutTime(starts[k - 1]));
            if (h3.indexOf(mark, idx[0]) < 0) bad.h3s.push(`${sid} 缺「${mark}」——切點時刻必須等於前面分鏡秒數的累計`);
          }
        }
      }
      const rest = h3Remainder(h3);
      if (promptLang === 'en') {
        if (CJK.test(rest)) bad.h3e.push(`${sid} 的 h3Prompt 設定英文卻在 <d> 臺詞之外混入了中文`);
      } else if (!CJK.test(rest)) {
        bad.h3e.push(`${sid} 設定中文提示詞（promptLang=${promptLang}），正文卻寫成了英文`);
      }
      for (const name of banned) {
        if (rest.includes(name)) bad.names.push(`${sid} 的 h3Prompt 在臺詞之外出現角色名「${name}」`);
      }

      // 段級：走位是整段的空間地基；Seedance 的音效與配樂由程式套符號，欄位裡不許自帶
      if (!String(seg?.blocking ?? '').trim()) bad.comp.push(`${sid} 缺 blocking（人物關係與構圖邏輯）`);
      if (/[<>]/.test(String(seg?.soundscape ?? ''))) bad.sd.push(`${sid} 的 soundscape 自帶了 <>——程式會套`);
      if (/[（）()]/.test(String(seg?.music ?? ''))) bad.sd.push(`${sid} 的 music 自帶了括號——程式會套（）`);

      const slices = h3CutSlices(h3, cuts.length, promptLang);
      const scene = sEp ? sEp.scenes[seg?.sceneIndex - 1] : null;
      if (sEp && !scene) bad.refs.push(`${sid} 的 sceneIndex ${seg?.sceneIndex} 在劇本第 ${ep.ep} 集裡不存在`);
      if (scene) {
        if (seg.sceneIndex < prevSceneIndex) bad.coverage.push(`${sid} 場次順序倒退`);
        prevSceneIndex = Math.max(prevSceneIndex, seg.sceneIndex);
      }

      cuts.forEach((cut, ci) => {
        const cid = `${sid}#${ci + 1}`;

        if (!(cut?.seconds >= params.minCutSeconds) || cut.seconds > params.maxCutSeconds) {
          bad.cutLen.push(`${cid} ${cut?.seconds ?? '?'} 秒`);
        }
        if ((cut?.characters ?? []).length > params.maxOnScreen && !String(cut?.note ?? seg?.note ?? '').trim()) {
          bad.crowd.push(`${cid} 同框 ${cut.characters.length} 人且沒有拆解說明`);
        }
        if (!SHOT_SIZES[cut?.size]) {
          bad.size.push(`${cid} 景別「${cut?.size}」不在列舉裡`);
        } else if (!String(cut?.frame ?? '').includes(SHOT_SIZES[cut.size].zh)) {
          bad.size.push(`${cid} 分鏡圖提示詞缺景別詞「${SHOT_SIZES[cut.size].zh}」`);
        }
        if (!CAMERA_MOVES[cut?.camera]) {
          bad.camera.push(`${cid} 運鏡「${cut?.camera}」不在 H3 詞表裡`);
        } else {
          const slice = slices[ci];
          const term = promptLang === 'en' ? String(cut.camera).toLowerCase() : CAMERA_MOVES[cut.camera];
          if (slice == null) {
            bad.camera.push(`${cid} 在 h3Prompt 裡找不到對應的 [Shot ${ci + 1}] 段落`);
          } else if (!(promptLang === 'en' ? slice.toLowerCase() : slice).includes(term)) {
            bad.camera.push(`${cid} 的 [Shot ${ci + 1}] 段落缺運鏡詞「${term}」`);
          }
        }
        const frame = String(cut?.frame ?? '');
        if (!frame.trim()) bad.frame.push(`${cid} 的分鏡圖提示詞為空`);
        else if (!CJK.test(frame)) bad.frame.push(`${cid} 的分鏡圖提示詞不是中文`);

        // 構圖量化欄位：每鏡六項齊全，穩定性在列舉裡
        const missing = COMPOSITION_FIELDS.filter((f) => !String(cut?.[f] ?? '').trim());
        if (missing.length) bad.comp.push(`${cid} 缺 ${missing.join(' / ')}`);
        else if (!STABILITY[cut.stability]) bad.comp.push(`${cid} 的 stability「${cut.stability}」不在列舉裡（${Object.keys(STABILITY).join(' / ')}）`);

        // Seedance 鏡頭正文：中文、非空、通用身份，不寫程式會加的東西
        const shot = String(cut?.shot ?? '');
        if (!shot.trim()) bad.sd.push(`${cid} 缺 shot（Seedance 鏡頭正文）`);
        else {
          if (!CJK.test(shot)) bad.sd.push(`${cid} 的 shot 不是中文`);
          for (const [re, what] of SEEDANCE_FORBIDDEN) {
            if (re.test(shot)) bad.sd.push(`${cid} 的 shot 寫了${what}`);
          }
          for (const name of banned) {
            if (shot.includes(name)) bad.names.push(`${cid} 的 Seedance 鏡頭正文出現角色名「${name}」`);
          }
        }

        // 鏡頭配方：id 在卡庫裡 + 每條必備短語進了本切的 frame
        // 判定與 shot-recipes 的 checkRecipes 完全一致：兩邊小寫化後 includes，逐條全中才算過
        if (recipes && typeof cut?.recipe === 'string' && cut.recipe) {
          recipeRefs += 1;
          const card = recipes.get(cut.recipe);
          if (!card) {
            bad.recipe.push(`${cid} 引用的配方「${cut.recipe}」不在配方庫裡`);
          } else {
            const lower = frame.toLowerCase();
            for (const ph of card.must_phrases ?? []) {
              if (!lower.includes(String(ph).toLowerCase())) {
                bad.recipe.push(`${cid} 的分鏡圖提示詞缺配方「${card.name}」的必備短語「${ph}」`);
              }
            }
          }
        }

        // 引用對賬 + 臺詞裝得下 + 臺詞逐字進 <d>
        if (scene) {
          const cast = new Set(scene.characters);
          for (const c of cut?.characters ?? []) {
            if (!cast.has(c)) bad.refs.push(`${cid} 的 ${c} 不在劇本該場人物裡`);
          }
          const propSet = new Set(scene.props);
          for (const pr of cut?.props ?? []) {
            if (!propSet.has(pr)) bad.refs.push(`${cid} 的 ${pr} 不在劇本該場道具裡`);
          }
          const [from, to] = cut?.beats ?? [];
          if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= scene.beats.length && from <= to) {
            let dlg = 0;
            for (const b of scene.beats.slice(from - 1, to)) {
              if (b.kind !== 'line') continue;
              dlg += b.seconds;
              const re = new RegExp(`<d>\\[[^\\]]+\\]\\s*${b.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</d>`);
              if (!re.test(h3)) bad.h3d.push(`${sid} 的 h3Prompt 缺臺詞「${b.text.slice(0, 12)}…」的 <d> 塊`);
            }
            if (dlg > cut.seconds) bad.fit.push(`${cid} 臺詞 ${r1(dlg)} 秒裝不進 ${cut.seconds} 秒`);
          }
        }
      });

      // 多格配方靠「連續同 id 的 run」表達（不引入新結構）：卡片 cuts 下限 ≥ 2 時，
      // 連續段的長度不得小於該下限——單獨掛一格的兩格配方是沒兌現的配方
      if (recipes) {
        for (let i = 0; i < cuts.length; ) {
          const rid = cuts[i]?.recipe;
          if (typeof rid !== 'string' || !rid) {
            i += 1;
            continue;
          }
          let j = i;
          while (j + 1 < cuts.length && cuts[j + 1]?.recipe === rid) j += 1;
          const card = recipes.get(rid);
          const min = Array.isArray(card?.cuts) ? card.cuts[0] : 0;
          const run = j - i + 1;
          if (min >= 2 && run < min) {
            bad.recipe.push(`${sid}#${i + 1} 的配方「${card.name}」要 ${min} 格連排，這裡只有 ${run} 格——多格配方靠連續同 recipe 的分鏡表達`);
          }
          i = j + 1;
        }
      }
    }

    // 節拍全覆蓋：每場的節拍被恰好一次、按順序、連續認領（分鏡級）
    if (sEp) {
      for (const scene of sEp.scenes) {
        const claims = [];
        for (const seg of ep?.segments ?? []) {
          if (seg?.sceneIndex !== scene.sceneIndex) continue;
          (seg?.cuts ?? []).forEach((cut, ci) => {
            const [from, to] = cut?.beats ?? [];
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > scene.beats.length || from > to) {
              bad.coverage.push(`${seg.id}#${ci + 1} 的節拍區間 [${from}, ${to}] 不合法（該場共 ${scene.beats.length} 拍）`);
              return;
            }
            claims.push([from, to, `${seg.id}#${ci + 1}`]);
          });
        }
        let cursor = 1;
        for (const [from, to, id] of claims) {
          if (from !== cursor) {
            bad.coverage.push(`${label} 第 ${scene.sceneIndex} 場第 ${cursor} 拍${from > cursor ? '沒人認領' : `被 ${id} 重複認領`}`);
          }
          cursor = Math.max(cursor, to + 1);
        }
        if (claims.length && cursor <= scene.beats.length) {
          bad.coverage.push(`${label} 第 ${scene.sceneIndex} 場第 ${cursor}–${scene.beats.length} 拍沒人認領`);
        }
        if (!claims.length && scene.beats.length) {
          bad.coverage.push(`${label} 第 ${scene.sceneIndex} 場整場沒有分鏡`);
        }
      }

      // 每集總時長對齊劇本目標
      if (sEp.targetSeconds > 0) {
        const total = (ep?.segments ?? []).reduce((n, s) => n + segSeconds(s), 0);
        const lo = sEp.targetSeconds * (1 - params.tolerance);
        const hi = sEp.targetSeconds * (1 + params.tolerance);
        if (total < lo) bad.duration.push(`${label} 欠 ${r1(lo - total)} 秒（${r1(total)}s / 目標 ${sEp.targetSeconds}s）`);
        if (total > hi) bad.duration.push(`${label} 超 ${r1(total - hi)} 秒（${r1(total)}s / 目標 ${sEp.targetSeconds}s）`);
      }
    }
  }

  const SKIP_SCRIPT = '未提供 script.json，本門跳過（視為通過）';
  const SKIP_NAMES = '未提供 outline/cast，本門跳過（視為通過）';
  const SKIP_SHOTS = '未掛載配方卡庫（--shots <卡片目錄>），本門跳過（視為通過）';
  const NO_RECIPE = '本批分鏡沒有引用配方';

  add('coverage', '劇本節拍被恰好一次、按順序、連續認領（分鏡級）', bad.coverage.length === 0, script ? bad.coverage.join('；') : SKIP_SCRIPT);
  add('segment-cap', `每段 0 < 總秒數 ≤ ${params.maxSegmentSeconds}（一次生成的上限）`, eps.length > 0 && bad.segCap.length === 0, bad.segCap.join('；'));
  add('cut-length', `每個分鏡 ${params.minCutSeconds}–${params.maxCutSeconds} 秒——短劇的注意力節奏`, eps.length > 0 && bad.cutLen.length === 0, bad.cutLen.join('；'));
  add('dialogue-fit', '認領節拍的臺詞裝得進分鏡秒數', bad.fit.length === 0, script ? bad.fit.join('；') : SKIP_SCRIPT);
  add('ep-duration', `每集總時長在劇本目標 ±${Math.round(params.tolerance * 100)}% 內`, bad.duration.length === 0, script ? bad.duration.join('；') : SKIP_SCRIPT);
  add('crowd', `單個分鏡同框 ≤ ${params.maxOnScreen} 人，超了必須帶拆解說明`, bad.crowd.length === 0, bad.crowd.join('；'));
  add('segment-id', '段號 E01-01 格式、按順序連號', bad.id.length === 0, bad.id.join('；'));
  add('size-phrase', '景別中文詞寫進分鏡圖提示詞', bad.size.length === 0, bad.size.join('；'));
  add('camera-phrase', '運鏡用 H3 官方詞表，且出現在自己的 [Shot k] 段落裡', bad.camera.length === 0, bad.camera.join('；'));
  add('h3-structure', 'H3 首行對齊指令由分鏡結構推導逐字對賬，切點時刻逐個對', eps.length > 0 && bad.h3s.length === 0, bad.h3s.join('；'));
  add('h3-dialogue', '認領節拍的臺詞逐字進 H3 提示詞的 <d> 塊', bad.h3d.length === 0, script ? bad.h3d.join('；') : SKIP_SCRIPT);
  add('h3-lang', `H3 提示詞語言與設定一致（promptLang=${promptLang}，正文${promptLang === 'en' ? '全英文' : '中文'}、骨架 token 官方英文格式）`, bad.h3e.length === 0, bad.h3e.join('；'));
  add('frame-prompt', '分鏡圖提示詞中文且非空', bad.frame.length === 0, bad.frame.join('；'));
  add('prompt-no-names', '影片提示詞不含角色名（H3 正文與 Seedance 鏡頭正文；分鏡圖提示詞直呼其名放行）', bad.names.length === 0, banned.length ? bad.names.join('；') : SKIP_NAMES);
  add('composition', '構圖量化欄位齊全（每段 blocking；每鏡焦距／機位／構圖／視線落點／焦點／穩定性）', eps.length > 0 && bad.comp.length === 0, bad.comp.join('；'));
  add('seedance-shot', 'Seedance 鏡頭正文中文非空，不寫時間、鏡頭編號、圖片引用和協議符號', eps.length > 0 && bad.sd.length === 0, bad.sd.join('；'));
  add('refs', '場次／人物／道具對賬劇本', bad.refs.length === 0, script ? bad.refs.join('；') : SKIP_SCRIPT);
  // 可選掛載的門放最後：沒給 --shots 就跳過；給了但全篇沒引用配方也算透過，但要明說，不靜默
  add(
    'shot-recipe',
    '引用的配方存在、必備短語進了分鏡圖提示詞、多格配方連排夠格數',
    bad.recipe.length === 0,
    recipes ? (bad.recipe.length ? bad.recipe.join('；') : recipeRefs ? '' : NO_RECIPE) : SKIP_SHOTS,
  );

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateStoryboard(board, ctx = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!board || typeof board !== 'object') return ['storyboard.json 不是物件'];

  if (!String(board.source ?? '').trim()) p('缺少 source（劇名）');
  if (board.aspectRatio != null && !ASPECT_RATIOS.has(board.aspectRatio)) {
    p(`aspectRatio 只能是 16:9 或 9:16，實際是「${board.aspectRatio}」`);
  }
  const eps = board.episodes;
  if (!Array.isArray(eps) || eps.length === 0) {
    p('episodes 為空');
    return problems;
  }
  const seen = new Set();
  for (const ep of eps) {
    const label = `第 ${ep?.ep ?? '?'} 集`;
    if (!Number.isInteger(ep?.ep) || ep.ep < 1) p(`${label}的 ep 必須是正整數`);
    if (seen.has(ep?.ep)) p(`集號 ${ep.ep} 重複`);
    seen.add(ep?.ep);
    if (!Array.isArray(ep?.segments) || ep.segments.length === 0) {
      p(`${label}沒有段`);
      continue;
    }
    for (const seg of ep.segments) {
      const sid = seg?.id ?? '?';
      if (typeof seg?.id !== 'string') p(`${label}有段缺 id`);
      if (!Number.isInteger(seg?.sceneIndex) || seg.sceneIndex < 1) p(`${sid} 缺 sceneIndex（劇本里第幾場）`);
      if (typeof seg?.h3Prompt !== 'string') p(`${sid} 缺 h3Prompt（H3 影片提示詞，寫法見 references/h3-prompt.md）`);
      if (!Array.isArray(seg?.cuts) || seg.cuts.length === 0) {
        p(`${sid} 沒有分鏡`);
        continue;
      }
      seg.cuts.forEach((cut, ci) => {
        const cid = `${sid}#${ci + 1}`;
        if (!Array.isArray(cut?.beats) || cut.beats.length !== 2) p(`${cid} 的 beats 必須是 [起, 止] 兩個數`);
        if (typeof cut?.seconds !== 'number') p(`${cid} 缺 seconds`);
        if (!Array.isArray(cut?.characters)) p(`${cid} 缺 characters（空鏡給空陣列）`);
        if (typeof cut?.frame !== 'string') p(`${cid} 缺 frame（分鏡圖提示詞，中文）`);
      });
    }
  }

  for (const g of gateReport(board, ctx)) {
    if (!g.ok) p(`品質門未過：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* seed — 從 script.json 確定性預填                                      */
/* ------------------------------------------------------------------ */

export function seedFromScript(script, epRange = null, aspectRatio = '16:9') {
  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(`aspectRatio 只能是 16:9 或 9:16，實際是「${aspectRatio}」`);
  }
  const expanded = expandScript(script);
  const inRange = (n) => !epRange || (n >= epRange[0] && n <= epRange[1]);
  const episodes = [];
  for (const [epNo, sEp] of expanded) {
    if (!inRange(epNo)) continue;
    episodes.push({
      ep: epNo,
      segments: [],
      seedScenes: sEp.scenes.map((sc) => ({
        sceneIndex: sc.sceneIndex,
        sceneId: sc.sceneId,
        lighting: sc.lighting,
        characters: sc.characters,
        props: sc.props,
        beats: sc.beats.map((b) => ({
          n: b.n,
          kind: b.kind,
          seconds: b.seconds,
          ...(b.speaker ? { speaker: b.speaker } : {}),
          text: b.text,
        })),
      })),
    });
  }
  return { source: script?.source ?? '', aspectRatio, episodes };
}

/* ------------------------------------------------------------------ */
/* export — 投產包（H3 / Seedance 二選一）                                */
/* ------------------------------------------------------------------ */
/*
 * 固定投產結構：每段一個資料夾，提示詞就躺在圖旁邊，整個資料夾就是一次生成。
 *
 * - H3：E01-01/f1.png … fN.png + prompt.md（h3Prompt 原樣），根部 manifest.json
 *   按 Picture 序列出該段要掛的分鏡圖、秒數、缺圖示註
 * - Seedance：E01-01/seedance.md（程式拼的提示詞）+ 附件，根部 seedance-manifest.json
 *   按 @圖片 編號列出每個附件——分鏡圖就是包裡的 f<k>.png，設定圖拷成 ref-<n>.png
 *
 * 純函式返回檔案清單與要拷的設定圖，落盤在 CLI 層——可測性。
 *
 * @param opts.protocol     'h3'（預設）| 'seedance'
 * @param opts.imageExists  包內相對路徑 → 是否已有（分鏡圖）
 * @param opts.sheetExists  設定圖檔名 → 是否找得到（Seedance 參考圖路徑用）
 * @param opts.names        { scene, char, prop } → 顯示名；opts.constraints 全域性約束
 */
export function exportPack(
  board,
  script,
  { imageExists = () => false, sheetExists = () => false, dir = '.', protocol = 'h3', names = {}, constraints = [] } = {},
) {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const expanded = expandScript(script);
  const files = [];
  const manifest = [];
  const copies = [];
  let missingTotal = 0;
  for (const ep of board?.episodes ?? []) {
    for (const seg of ep?.segments ?? []) {
      if (protocol === 'seedance') {
        const scene = expanded.get(ep.ep)?.scenes?.[seg.sceneIndex - 1] ?? null;
        const image = (kind, rel) => (kind === 'frame' && imageExists(`${prefix}${rel}`) ? rel : null);
        const { prompt, refs } = seedancePrompt(seg, { scene, names, image, constraints });
        const attachments = refs.map((r, i) => {
          const path = r.kind === 'frame' ? `${prefix}${r.file}` : `${prefix}${seg.id}/ref-${i + 1}.png`;
          const present = r.kind === 'frame' ? imageExists(path) : sheetExists(r.file);
          if (r.kind === 'sheet' && present) copies.push({ file: r.file, to: path });
          return { ref: `@圖片${i + 1}`, label: r.label, kind: r.kind, path, source: r.file, present };
        });
        const missing = attachments.filter((a) => !a.present).map((a) => a.path);
        missingTotal += missing.length;
        const head = attachments.length
          ? attachments.map((a) => `- ${a.ref} = ${a.label} → ${a.path.slice(prefix.length + seg.id.length + 1)}${a.present ? '' : '（缺）'}`).join('\n')
          : '- （無附件）';
        const md = `# ${seg.id} · Seedance 提示詞\n\n附件按 @圖片 編號依次上傳：\n\n${head}\n\n視覺風格（畫風層）在提交時附加，本文不含。總時長由介面引數控制，正文不寫秒數。\n\n---\n\n${prompt}\n`;
        files.push({ path: `${prefix}${seg.id}/seedance.md`, content: md });
        manifest.push({ segment: seg.id, seconds: segSeconds(seg), cuts: (seg.cuts ?? []).length, prompt: `${prefix}${seg.id}/seedance.md`, attachments, missing });
        continue;
      }
      // prompt.md 頭部先說清哪個檔案是首幀、每張圖釘在第幾秒——
      // 分隔線以下是 h3Prompt 原樣，整段複製就能用
      const starts = cutStarts(seg.cuts);
      const mapping = (seg.cuts ?? [])
        .map((_, i) => `- Picture ${i + 1} = f${i + 1}.png${i === 0 ? '（**首幀**，釘 0.00 秒）' : `（釘 ${starts[i].toFixed(2)} 秒）`}`)
        .join('\n');
      const promptMd = `# ${seg.id} · H3 提示詞\n\n首幀 = **f1.png**。圖片按 Picture 序號掛載：\n\n${mapping}\n\n---\n\n${seg.h3Prompt ?? ''}\n`;
      files.push({ path: `${prefix}${seg.id}/prompt.md`, content: promptMd });
      const pictures = (seg.cuts ?? []).map((_, i) => `${prefix}${seg.id}/f${i + 1}.png`);
      const missing = pictures.filter((rel) => !imageExists(rel));
      missingTotal += missing.length;
      manifest.push({
        segment: seg.id,
        seconds: segSeconds(seg),
        cuts: (seg.cuts ?? []).length,
        cutStarts: cutStarts(seg.cuts),
        prompt: `${prefix}${seg.id}/prompt.md`,
        pictures,
        missing,
      });
    }
  }
  const manifestName = protocol === 'seedance' ? 'seedance-manifest.json' : 'manifest.json';
  files.push({ path: `${prefix}${manifestName}`, content: JSON.stringify(manifest, null, 2) + '\n' });
  return { files, manifest, missingTotal, copies };
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'storyboard';
}

/* ------------------------------------------------------------------ */
/* render — 介面文案                                                    */
/* ------------------------------------------------------------------ */

/*
 * 介面文案表：內建 zh / en 兩套。語言優先順序 --lang > JSON 頂層 lang 欄位 > 'zh'，
 * 經 ctx.lang 傳給渲染器。只管報告介面標籤——與 promptLang（H3 提示詞語言）
 * 互相獨立：介面切英文不改提示詞，提示詞切中文不改介面。
 * 資料（H3 提示詞、畫面摘要、臺詞、品質門 detail）不在此表，原樣透傳。
 */
/* 門標籤與「跳過」提示的英文對映：品質門面板是報告的一部分，出英文報告時
 * 這裡做展示層翻譯——gateReport 的邏輯與中文診斷文案一行不動（CLI 仍是中文）。
 * 動態閾值由門自己算，對映裡只寫固定語義；未命中的 id 回落到原標籤。 */
const GATE_LABELS_EN = {
  'coverage': 'Every script beat claimed exactly once, in order, contiguous (cut level)',
  'segment-cap': 'Each segment 0 < total ≤ {1}s (the single-generation cap)',
  'cut-length': 'Every cut {0}–{1}s — the short-drama attention rhythm',
  'dialogue-fit': 'Dialogue of the claimed beats fits within the cut duration',
  'ep-duration': 'Episode total within ±{0}% of the script\'s target',
  'crowd': 'At most {0} characters on screen per cut; more requires a breakdown note',
  'segment-id': 'Segment IDs in E01-01 format, sequential',
  'size-phrase': 'Chinese shot-size word present in the frame prompt',
  'camera-phrase': 'Camera move from the official H3 vocabulary, inside its own [Shot k] passage',
  'h3-structure': 'H3 alignment line derived from the cut structure, audited verbatim; cut times match',
  'h3-dialogue': 'Claimed dialogue appears verbatim inside the H3 <d> blocks',
  'h3-lang': 'Prompt language matches the promptLang setting',
  'frame-prompt': 'Frame prompts are Chinese and non-empty',
  'prompt-no-names': 'Video prompts carry no character names (H3 body and Seedance shot text; frame prompts name characters on purpose)',
  'composition': 'Composition fields complete (blocking per segment; lens / camera position / composition / eyeline / focus / stability per cut)',
  'seedance-shot': 'Seedance shot text is Chinese and non-empty, with no timings, shot numbers, image references or protocol symbols',
  'refs': 'Scenes / characters / props audited against the script',
  'shot-recipe': 'Referenced recipes exist, their must-phrases are in the frame prompt, multi-cut recipes run long enough',
};
const GATE_SKIPS_EN = {
    '未提供 outline.json，本門跳過（視為通過）': 'outline.json not provided — gate skipped (treated as passing)',
    '未提供 art.json，本門跳過（視為通過）': 'art.json not provided — gate skipped (treated as passing)',
    '未提供 script.json，本門跳過（視為通過）': 'script.json not provided — gate skipped (treated as passing)',
    '未提供 outline/cast，本門跳過（視為通過）': 'outline/cast not provided — gate skipped (treated as passing)',
    '未提供 cast.json，本門跳過（視為通過）': 'cast.json not provided — gate skipped (treated as passing)',
    '未掛載配方卡庫（--shots <卡片目錄>），本門跳過（視為通過）': 'no recipe card library mounted (--shots <cards dir>) — gate skipped (treated as passing)',
    '本批分鏡沒有引用配方': 'no cut in this batch references a recipe',
};
/** 報告裡的門文案：英文介面取對映，未命中或中文介面回落原文。 */
const gateText = (g, lang) => {
  if (lang !== 'en') return { label: g.label, detail: g.detail };
  const en = GATE_LABELS_EN[g.id];
  // 閾值仍由門自己算：把中文標籤裡出現的數字按序填進 {0} {1}
  const nums = String(g.label).match(/\d+(?:\.\d+)?/g) ?? [];
  const label = en ? en.replace(/\{(\d)\}/g, (m, i) => nums[Number(i)] ?? m) : g.label;
  return { label, detail: GATE_SKIPS_EN[g.detail] ?? g.detail };
};

const I18N = {
  zh: {
    langCode: 'zh',
    kicker: '分鏡',
    docTitle: (s, a, b) => `${s} · 分鏡${a === b ? `（第 ${a} 集）` : `（第 ${a}–${b} 集）`}`,
    epRange: (a, b) => (a === b ? `第 ${a} 集` : `第 ${a}–${b} 集`),
    exportJson: '匯出 JSON',
    gatesPass: '全部通過',
    gatesFail: (n) => `${n} 項未過`,
    gatePill: (okN, total) => `品質門 ${okN} / ${total}`,
    kpi: {
      segments: '生成段', segmentsSub: (cap) => `一段一次呼叫，上限 ${cap} 秒`,
      cuts: '分鏡', cutsSub: (avg) => `平均 ${avg} 秒一切`,
      time: '預估總時長', timeSub: (t) => `目標 ${t}`,
      batches: '生成批次', batchesSub: '同場景同光照共用環境參考圖',
      lines: '臺詞段', linesSub: '其餘是純畫面段',
    },
    secRhythm: '分鏡節奏帶',
    secSegments: '分集分鏡表',
    secBatches: '生成批次單',
    secDialogue: '配音對齊單',
    secGates: '品質門',
    rhythmNote: '粗分隔 = 生成段邊界 · 段寬 = 分鏡時長佔比 · 顏色越深景別越近',
    segmentsNote: '一段 = 一次生成：主分鏡圖釘 0.00 秒，子分鏡圖釘各自切點',
    batchesNote: '自動彙總 · 同批段共用同一張環境參考圖',
    dialogueNote: '自動彙總 · TTS 音訊對到哪一段的第幾切',
    epHead: (nSeg, nCut, total, target) => `${nSeg} 段 ${nCut} 切 · 共 ${total} 秒 / 目標 ${target} 秒`,
    segHead: (total, n) => `${total} 秒 · ${n} 個分鏡`,
    secBadge: (secs, n) => `${secs}s · ${n} 切`,
    rhythmVal: (nSeg, nCut, secs) => `${nSeg} 段 ${nCut} 切 · ${secs}s`,
    beatsLabel: (s, from, to) => `第 ${s} 場 ${from === to ? `第 ${from} 拍` : `第 ${from}–${to} 拍`}`,
    masterLabel: '主分鏡圖',
    subLabel: (i) => `子分鏡 ${i}`,
    frameMissing: (i) => `#${i} 未生成`,
    framePrompt: '分鏡圖提示詞',
    h3Prompt: 'H3 提示詞',
    h3Section: 'H3 影片提示詞',
    seedancePrompt: 'Seedance 提示詞',
    seedanceSection: 'Seedance 影片提示詞',
    blockingLabel: '走位',
    compLine: (c) => [c.lens, c.cameraPosition, c.composition, c.eyeline && `視線 ${c.eyeline}`, c.focus && `焦點 ${c.focus}`, STABILITY[c.stability] ?? c.stability].filter(Boolean).join(' · '),
    showSegs: '▾ 展開全部段',
    hideSegs: '▴ 收起',
    copy: '複製', copied: '已複製', copyFailed: '複製失敗',
    dialogueCols: ['段 · 切', '說話人', '臺詞', '臺詞秒數'],
    cutCols: ['切', '起點', '秒', '景別', '運鏡', '配方', '畫面', '人物'],
    batchCols: ['場景', '光照', '段', '需要的角色', '道具'],
    atSec: (t) => `${t.toFixed(2)}s 起`,
    batchLabel: (num) => `批次 ${num}`,
    batchNeed: (chars, props) => `需要：${chars.length ? chars.join('、') + ' 的角色設定圖' : '無角色（空鏡）'}${props.length ? ' · ' + props.join('、') : ''}`,
    voiceOver: '畫外音',
    listSep: '、',
    sizeName: (size) => SHOT_SIZES[size]?.zh ?? size,
    cameraLabel: (camera) => `${camera}（${CAMERA_MOVES[camera] ?? '?'}）`,
    recipeNone: '—',
    recipeName: (card, id) => card?.name ?? id,
    recipeDrift: (sizes, cameras) =>
      `配方建議${[sizes.length ? `景別 ${sizes.join(' / ')}` : '', cameras.length ? `運鏡 ${cameras.join(' / ')}` : ''].filter(Boolean).join(' · ')}——只提示不設門`,
    recipeHint: (n) => `ℹ️ ${n} 處分鏡的景別／運鏡偏離了配方建議——配方是語彙不是法條，只提示不設門（報告的「配方」列有 ≠ 標記）`,
    speakerLine: (name, text) => `${name}：「${text}」`,
    withLighting: (name, lighting) => (lighting ? `${name}（${lighting}）` : name),
    fmtMin: (sec) => `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`,
    unitSeg: '段',
    unitCut: '切',
    colophon: '分鏡由模型依據劇本切分：段 = 一次生成（≤15 秒），分鏡 = 段內 2–5 秒的切鏡，每個分鏡一張關鍵幀圖。對齊指令、切點時刻、臺詞、提示詞紀律全部由腳本確定性對賬。分鏡圖生圖走 codex，環境與角色設定圖當參考圖。',
  },
  en: {
    langCode: 'en',
    kicker: 'Storyboard',
    docTitle: (s, a, b) => `${s} · Storyboard (${a === b ? `Episode ${a}` : `Episodes ${a}–${b}`})`,
    epRange: (a, b) => (a === b ? `Episode ${a}` : `Episodes ${a}–${b}`),
    exportJson: 'Export JSON',
    gatesPass: 'All passed',
    gatesFail: (n) => `${n} failed`,
    gatePill: (okN, total) => `Quality gates ${okN} / ${total}`,
    kpi: {
      segments: 'Segments', segmentsSub: (cap) => `one generation call each, capped at ${cap}s`,
      cuts: 'Cuts', cutsSub: (avg) => `${avg}s per cut on average`,
      time: 'Estimated total', timeSub: (t) => `target ${t}`,
      batches: 'Generation batches', batchesSub: 'same scene + lighting share one environment reference',
      lines: 'Dialogue segments', linesSub: 'the rest are picture-only',
    },
    secRhythm: 'Cut rhythm strip',
    secSegments: 'Segment cards',
    secBatches: 'Generation batches',
    secDialogue: 'Audio alignment',
    secGates: 'Quality gates',
    rhythmNote: 'thick separators = segment boundaries · slice width = cut duration share · darker = closer shot size',
    segmentsNote: 'one segment = one generation: the master frame pins 0.00s, sub-frames pin their own cut marks',
    batchesNote: 'auto-computed · segments in a batch share one environment reference image',
    dialogueNote: 'auto-computed · which segment and cut each TTS clip lands on',
    epHead: (nSeg, nCut, total, target) => `${nSeg} segments ${nCut} cuts · ${total}s total / ${target}s target`,
    segHead: (total, n) => `${total}s · ${n} cuts`,
    secBadge: (secs, n) => `${secs}s · ${n} cuts`,
    rhythmVal: (nSeg, nCut, secs) => `${nSeg} seg ${nCut} cuts · ${secs}s`,
    beatsLabel: (s, from, to) => `Scene ${s} · ${from === to ? `beat ${from}` : `beats ${from}–${to}`}`,
    masterLabel: 'master frame',
    subLabel: (i) => `sub-frame ${i}`,
    frameMissing: (i) => `#${i} not generated`,
    framePrompt: 'Frame prompt',
    h3Prompt: 'H3 prompt',
    h3Section: 'H3 video prompt',
    seedancePrompt: 'Seedance prompt',
    seedanceSection: 'Seedance video prompt',
    blockingLabel: 'Blocking',
    compLine: (c) => [c.lens, c.cameraPosition, c.composition, c.eyeline && `eyeline ${c.eyeline}`, c.focus && `focus ${c.focus}`, ({ stable: 'stable', 'slight-shake': 'slight shake', handheld: 'handheld' })[c.stability] ?? c.stability].filter(Boolean).join(' · '),
    showSegs: '▾ Show all segments',
    hideSegs: '▴ Collapse',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
    dialogueCols: ['Segment · cut', 'Speaker', 'Line', 'Seconds'],
    cutCols: ['Cut', 'Start', 'Sec', 'Size', 'Camera', 'Recipe', 'Picture', 'Characters'],
    batchCols: ['Scene', 'Lighting', 'Segments', 'Characters needed', 'Props'],
    atSec: (t) => `from ${t.toFixed(2)}s`,
    batchLabel: (num) => `Batch ${num}`,
    batchNeed: (chars, props) => `Needs: ${chars.length ? `character sheets for ${chars.join(', ')}` : 'no characters (empty shot)'}${props.length ? ' · ' + props.join(', ') : ''}`,
    voiceOver: 'Voice-over',
    listSep: ', ',
    sizeName: (size) => SHOT_SIZES[size]?.phrase ?? size,
    cameraLabel: (camera) => camera,
    recipeNone: '—',
    recipeName: (card, id) => card?.name_en ?? card?.name ?? id,
    recipeDrift: (sizes, cameras) =>
      `Recipe suggests ${[sizes.length ? `size ${sizes.join(' / ')}` : '', cameras.length ? `camera ${cameras.join(' / ')}` : ''].filter(Boolean).join(' · ')} — advisory, not gated`,
    recipeHint: (n) => `ℹ️ ${n} cut(s) deviate from their recipe's suggested size / camera — a recipe is vocabulary, not law: advisory only (see the ≠ marks in the Recipe column)`,
    speakerLine: (name, text) => `${name}: “${text}”`,
    withLighting: (name, lighting) => (lighting ? `${name} (${lighting})` : name),
    fmtMin: (sec) => `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`,
    unitSeg: 'seg',
    unitCut: 'cuts',
    colophon: 'Cut by the model from the script: a segment = one generation call (≤15s), a cut = a 2–5s edit inside it, one keyframe per cut. Alignment lines, cut marks, dialogue and prompt discipline are all audited deterministically by the script. Frames are generated through codex with the scene and character sheets as references.',
  },
};

const tOf = (lang) => {
  if (lang && !I18N[lang]) throw new Error('報告介面語言目前內建 zh / en');
  return I18N[lang ?? 'zh'];
};

/* ------------------------------------------------------------------ */
/* render 公共                                                          */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function namer(ctx = {}, t = I18N.zh) {
  const charName = new Map((ctx.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const sceneName = new Map((ctx.art?.scenes ?? []).map((s) => [s.id, s.name]));
  const propName = new Map((ctx.art?.props ?? []).map((p) => [p.id, p.name]));
  return {
    char: (id) => (id === 'VO' ? t.voiceOver : charName.get(id) ?? id),
    scene: (id) => sceneName.get(id) ?? id,
    prop: (id) => propName.get(id) ?? id,
  };
}

/**
 * cut 的「配方」列：卡名 + 偏離建議景別／運鏡時的 ≠ 標記。
 * 偏離只提示不設門——配方是語彙不是法條（理由見 recipeDrift 上方註釋）。
 */
function cutRecipe(cut, recipes, t) {
  const id = typeof cut?.recipe === 'string' ? cut.recipe : '';
  if (!id) return null;
  const card = recipes?.get(id) ?? null;
  const off = recipeDrift(cut, card);
  return {
    name: t.recipeName(card, id),
    drift: off.sizes.length || off.cameras.length ? t.recipeDrift(off.sizes, off.cameras) : '',
  };
}

/** 分鏡認領的節拍 → 畫面摘要（動作原文 + 臺詞行），模型不重寫。 */
function cutBeats(cut, scene) {
  if (!scene) return [];
  const [from, to] = cut.beats ?? [];
  return scene.beats.slice((from ?? 1) - 1, to ?? 0);
}

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

const mdRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
const mdHead = (cols) => [mdRow(cols), mdRow(cols.map(() => '---'))].join('\n');

export function renderMarkdown(board, ctx = {}) {
  const t = tOf(ctx.lang ?? board?.lang);
  const n = namer(ctx, t);
  const expanded = expandScript(ctx.script);
  const stats = computeStats(board, ctx.script);
  const eps = board.episodes;
  const out = [`# ${t.docTitle(board.source, eps[0]?.ep, eps[eps.length - 1]?.ep)}`, ''];

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    const sEp = expanded.get(ep.ep);
    out.push(`## E${String(ep.ep).padStart(2, '0')}`, '', `> ${t.epHead(st.segments, st.cuts, st.totalSeconds, st.target)}`, '');
    for (const seg of ep.segments) {
      const scene = sEp?.scenes?.[seg.sceneIndex - 1];
      out.push(`### ${seg.id} · ${scene ? t.withLighting(n.scene(scene.sceneId), scene.lighting) : '?'} · ${t.segHead(segSeconds(seg), seg.cuts.length)}`, '');
      if (seg.blocking) out.push(`> ${t.blockingLabel}：${seg.blocking}`, '');
      out.push(mdHead(t.cutCols));
      const starts = cutStarts(seg.cuts);
      seg.cuts.forEach((cut, ci) => {
        const summary = cutBeats(cut, scene)
          .map((b) => (b.kind === 'line' ? t.speakerLine(n.char(b.speaker), b.text) : b.text))
          .join(' ');
        // md 沒有 title 屬性，偏離的建議值直接寫在格子裡
        const rc = cutRecipe(cut, ctx.recipes, t);
        out.push(mdRow([
          `#${ci + 1}`, `${starts[ci].toFixed(2)}s`, cut.seconds,
          t.sizeName(cut.size), t.cameraLabel(cut.camera),
          rc ? `${rc.name}${rc.drift ? ` ≠（${rc.drift}）` : ''}` : t.recipeNone,
          summary, (cut.characters ?? []).map(n.char).join(t.listSep),
        ]));
      });
      const sd = seedancePrompt(seg, { scene, names: n, image: ctx.image ?? null, constraints: ctx.constraints ?? [] });
      out.push('', `**${t.h3Section}**`, '', '```text', seg.h3Prompt ?? '', '```', '');
      out.push(`**${t.seedanceSection}**`, '', '```text', sd.prompt, '```', '');
    }
  }

  out.push(`## ${t.secBatches}`, '', mdHead(t.batchCols));
  for (const b of stats.batches) {
    out.push(mdRow([`${b.sceneId} ${n.scene(b.sceneId)}`, b.lighting, b.segments.join(t.listSep), b.characters.map(n.char).join(t.listSep), b.props.map(n.prop).join(t.listSep)]));
  }
  out.push('', `## ${t.secDialogue}`, '', mdHead(t.dialogueCols));
  for (const d of stats.dialogue) out.push(mdRow([`${d.segment}#${d.cut}`, n.char(d.speaker), d.line, d.seconds]));
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 與另外四份報告同一套視覺語言。設計約定見 references/report-style.md。
 * 圖片是使用者在下游出好的素材，位置由 CLI 注入的 ctx.image(kind, rel) 決定：
 * kind 是 'frame'（<段號>/f<切序>.png）或 'sheet'（<場景 slug>-sheet.png），
 * 返回 src 或 null。有就內嵌顯示 + 點選放大，沒有就顯示佔位——不猜、不騙。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

/*
 * 分鏡圖位的畫幅。正式合同是 storyboard.json 頂層的 aspectRatio（9:16 / 16:9，見
 * references/schema.md 與 references/frame.md）；圖位要是寫死 16:9，豎圖就被 object-fit:cover
 * 裁成一條橫帶——看報告的人會以為構圖出了問題。認的順序：
 *   1. 頂層 `aspectRatio`——skill 自己的正式欄位，最權威；
 *   2. 頂層 `_meta.orientation`——舊版下游應用寫入的資料，只作相容；
 *   3. 每切 frame 末尾的畫幅標籤，數多的那個——沒有後設資料的舊分鏡仍然可以識別；
 *   4. 都認不出就是 16:9。
 * 只管分鏡圖：批次卡里的場景設定圖（`.bimg`）一律按 16:9 出，不跟劇的畫幅走。
 */
const ASPECT_RATIOS = new Set(['16:9', '9:16']);

const ORIENTATION_TAG = {
  portrait: '9:16', vertical: '9:16', v: '9:16', 豎: '9:16', 豎屏: '9:16', '9:16': '9:16',
  landscape: '16:9', horizontal: '16:9', h: '16:9', 橫: '16:9', 橫屏: '16:9', '16:9': '16:9',
};

function boardAspect(board) {
  if (ASPECT_RATIOS.has(board?.aspectRatio)) return board.aspectRatio;
  const declared = ORIENTATION_TAG[String(board?._meta?.orientation ?? '').trim().toLowerCase()];
  if (declared) return declared;
  let portrait = 0;
  let landscape = 0;
  for (const ep of board?.episodes ?? []) {
    for (const seg of ep.segments ?? []) {
      for (const cut of seg.cuts ?? []) {
        const f = String(cut.frame ?? '');
        if (/(^|[\s,])9:16\s*$/.test(f)) portrait++;
        else if (/(^|[\s,])16:9\s*$/.test(f)) landscape++;
      }
    }
  }
  return portrait > landscape ? '9:16' : '16:9';
}

// 豎屏才追加；橫屏一個位元組都不多，報告與改動前逐位元組一致。主圖收窄居中——
// 整卡寬的 9:16 一張就有一屏多高，子分鏡條四格豎縮圖照舊鋪滿
const PORTRAIT_FRAME_CSS = `
/* 豎屏 9:16：分鏡圖位跟著畫幅改豎（場景設定圖 .bimg 仍是 16:9） */
.frame,.subf{aspect-ratio:9/16}
img.frame{width:min(100%,300px);margin:0 auto}`;

export function renderHtml(board, ctx = {}) {
  const lang = ctx.lang ?? board?.lang ?? 'zh';
  const t = tOf(lang);
  const n = namer(ctx, t);
  const expanded = expandScript(ctx.script);
  const stats = computeStats(board, ctx.script);
  const gates = gateReport(board, ctx);
  const failed = gates.filter((g) => !g.ok);
  const eps = board.episodes;
  const params = stats.params;
  const fmtMin = t.fmtMin;
  // 分鏡圖位跟著這部劇的畫幅走（見 boardAspect）；橫屏不插任何東西
  const frameAspectCss = boardAspect(board) === '9:16' ? PORTRAIT_FRAME_CSS : '';

  const SIZE_ALPHA = { 'extreme-wide': 0.25, wide: 0.4, medium: 0.58, close: 0.78, 'extreme-close': 1 };

  // ---- 01 分鏡節奏帶：段是粗分隔的組，組內每個分鏡一段色塊 ----
  const rhythmRows = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const groups = ep.segments
        .map((seg) => {
          const segs = seg.cuts
            .map((cut, ci) => {
              const w = st.totalSeconds ? (cut.seconds / st.totalSeconds) * 100 : 0;
              const alpha = SIZE_ALPHA[cut.size] ?? 0.5;
              return `<a class="seg" href="#seg-${esc(seg.id)}" style="width:${r1(w)}%;background:rgba(138,51,36,${alpha})" title="${esc(`${seg.id}#${ci + 1} · ${cut.seconds}s · ${t.sizeName(cut.size)} · ${cut.camera}`)}"></a>`;
            })
            .join('');
          const gw = st.totalSeconds ? (segSeconds(seg) / st.totalSeconds) * 100 : 0;
          return `<span class="rseg" style="width:${r1(gw)}%">${segs}</span>`;
        })
        .join('');
      return `<div class="rrow"><span class="rep">E${String(ep.ep).padStart(2, '0')}</span><div class="rtrack">${groups}</div><span class="rval">${esc(t.rhythmVal(st.segments, st.cuts, st.totalSeconds))}</span></div>`;
    })
    .join('\n');
  const rhythmLegend = Object.keys(SHOT_SIZES)
    .map((k) => `<i><span class="sw" style="background:rgba(138,51,36,${SIZE_ALPHA[k]})"></span>${esc(t.sizeName(k))}</i>`)
    .join('');

  // ---- 02 分集分鏡表：段卡（主分鏡圖 + 子分鏡條 + 分鏡行） ----
  const epBlocks = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const sEp = expanded.get(ep.ep);
      const cards = ep.segments
        .map((seg) => {
          const scene = sEp?.scenes?.[seg.sceneIndex - 1];
          const starts = cutStarts(seg.cuts);
          const frame = (ci) => (ctx.image ? ctx.image('frame', `${seg.id}/f${ci + 1}.png`) : null);
          const has = (ci) => frame(ci) != null;

          // 主分鏡圖區：圖出全的段保留原 master+subs 層級；有缺圖的段每切一格——
          // 有圖的格顯示原圖，無圖的格顯示整寬提示詞卡 + 複製按鈕（混合情況按格判斷）
          const hasAll = seg.cuts.every((_, ci) => has(ci));
          let master, subs;
          if (hasAll) {
            master = `<img class="frame" src="${esc(frame(0))}" alt="${esc(`${seg.id}#1`)}" loading="lazy">`;
            subs = seg.cuts.length > 1
              ? `<div class="subs">${seg.cuts
                  .slice(1)
                  .map((cut, ci) => `<img class="subf" src="${esc(frame(ci + 1))}" alt="${esc(`${seg.id}#${ci + 2}`)}" loading="lazy">`)
                  .join('')}</div>`
              : '';
          } else {
            master = `<div class="fquad">${seg.cuts
              .map((cut, ci) => {
                const label = ci === 0 ? t.masterLabel : t.subLabel(ci + 1);
                const body = has(ci)
                  ? `<img class="frame" src="${esc(frame(ci))}" alt="${esc(`${seg.id}#${ci + 1}`)}" loading="lazy">`
                  : `<div class="frame ph fcell"><div class="fcell-h"><b>${esc(`${label} · ${t.frameMissing(ci + 1)}`)}</b><button class="copy mini" data-copy="${esc(cut.frame ?? '')}">${esc(t.copy)}</button></div><span class="fprompt">${esc(cut.frame ?? '')}</span></div>`;
                return body;
              })
              .join('\n')}</div>`;
            subs = '';
          }

          const cutRows = seg.cuts
            .map((cut, ci) => {
              const beats = cutBeats(cut, scene);
              const summary = beats
                .map((b) =>
                  b.kind === 'line'
                    ? `<p class="sline"><b>${esc(n.char(b.speaker))}</b>${esc(b.text)}</p>`
                    : `<p class="sact">${esc(b.text)}</p>`,
                )
                .join('');
              // 「配方」列：偏離建議景別／運鏡的加 ≠ 上標，建議值寫進 title——提示而已，不是門
              const rc = cutRecipe(cut, ctx.recipes, t);
              return `<li class="cut">
  <div class="cut-h">
    <b>#${ci + 1}</b>
    <span class="cut-t">${esc(t.atSec(starts[ci]))} · ${cut.seconds}s</span>
    <span class="cut-sc">${esc(t.sizeName(cut.size))} · ${esc(cut.camera)}</span>
    ${rc ? `<span class="cut-rc">${esc(rc.name)}${rc.drift ? `<sup title="${esc(rc.drift)}">≠</sup>` : ''}</span>` : ''}
    ${(cut.characters ?? []).map((id) => `<span class="chip">${esc(n.char(id))}</span>`).join('')}
    ${(cut.props ?? []).map((id) => `<span class="chip prop">${esc(n.prop(id))}</span>`).join('')}
    <button class="copy mini" data-copy="${esc(cut.frame ?? '')}">${esc(t.framePrompt)}</button>
  </div>
  ${t.compLine(cut) ? `<p class="scomp">${esc(t.compLine(cut))}</p>` : ''}
  ${summary}
</li>`;
            })
            .join('\n');

          return `<article class="segcard" id="seg-${esc(seg.id)}">
  <header class="seg-h">
    <b>${esc(seg.id)}</b>
    <span class="sec-badge">${esc(t.secBadge(segSeconds(seg), seg.cuts.length))}</span>
    <span class="chip">${esc(scene ? `${scene.sceneId} ${n.scene(scene.sceneId)}` : '?')}</span>
    ${scene?.lighting ? `<span class="chip lite">${esc(scene.lighting)}</span>` : ''}
    <span class="beatsref">${esc(t.beatsLabel(seg.sceneIndex, seg.cuts[0]?.beats?.[0], seg.cuts[seg.cuts.length - 1]?.beats?.[1]))}</span>
  </header>
  ${master}
  ${subs}
  ${seg.blocking ? `<p class="seg-block"><b>${esc(t.blockingLabel)}</b>${esc(seg.blocking)}</p>` : ''}
  <div class="duo">
    <ol class="cuts">
${cutRows}
    </ol>
    <div class="ppanel">
      <div class="pp-h">
        <span class="ptabs"><button class="ptab on" data-i="0">${esc(t.h3Prompt)}</button><button class="ptab" data-i="1">${esc(t.seedancePrompt)}</button></span>
        <button class="copy" data-copy="${esc(seg.h3Prompt ?? '')}">${esc(t.copy)}</button>
      </div>
      <pre class="pp on">${esc(seg.h3Prompt ?? '')}</pre>
      <pre class="pp">${esc(seedancePrompt(seg, { scene, names: n, image: ctx.image ?? null, constraints: ctx.constraints ?? [] }).prompt)}</pre>
    </div>
  </div>
  ${seg.note ? `<p class="seg-note">${esc(seg.note)}</p>` : ''}
</article>`;
        })
        .join('\n');
      return `<section class="ep" id="ep-${ep.ep}">
  <header class="ep-h">
    <span class="ep-n">E${String(ep.ep).padStart(2, '0')}</span>
    <span class="ep-est">${esc(t.epHead(st.segments, st.cuts, st.totalSeconds, st.target))}</span>
  </header>
  <div class="shots clip">
    <div class="seggrid">
${cards}
    </div>
  </div>
  <button class="shmore">${esc(t.showSegs)}</button>
</section>`;
    })
    .join('\n');

  // ---- 03 生成批次單 ----
  const batchCards = stats.batches
    .map((b, i) => {
      const sheet = ctx.image ? ctx.image('sheet', `${slug(n.scene(b.sceneId))}-sheet.png`) : null;
      const hasSheet = sheet != null;
      return `<article class="batch">
  ${hasSheet ? `<img class="bimg" src="${esc(sheet)}" alt="${esc(n.scene(b.sceneId))}" loading="lazy">` : ''}
  <header class="batch-h"><b>${esc(t.batchLabel(String(i + 1).padStart(2, '0')))}</b><span class="chip">${esc(`${b.sceneId} ${n.scene(b.sceneId)}`)}</span>${b.lighting ? `<span class="chip lite">${esc(b.lighting)}</span>` : ''}</header>
  <div class="batch-shots">${b.segments.map((s) => `<a class="chip mono" href="#seg-${esc(s)}">${esc(s)}</a>`).join('')}</div>
  <p class="batch-need">${esc(t.batchNeed(b.characters.map(n.char), b.props.map(n.prop)))}</p>
</article>`;
    })
    .join('\n');

  // ---- 04 配音對齊單 ----
  const dlgRows = stats.dialogue
    .map((d) => `<tr><td><a href="#seg-${esc(d.segment)}">${esc(d.segment)}</a> #${d.cut}</td><td>${esc(n.char(d.speaker))}</td><td class="serif">${esc(d.line)}</td><td>${d.seconds}</td></tr>`)
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      // 透過的門只有跳過說明與「沒有引用配方」這類備註帶 detail——都要顯示出來，不靜默
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(gateText(g, t.langCode).label)}${
        g.detail ? `<small>${esc(gateText(g, t.langCode).detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="${esc(lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(board.source, eps[0]?.ep, eps[eps.length - 1]?.ep))}</title>
<style>
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e; --seal-soft:#8a332412; --ok:#3d6b4f;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:1600px;margin:0 auto;padding:24px 32px 90px}
h1,h2,h3{margin:0;font-weight:400}

.hd{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:12px}
.hd h1{font:400 28px/1.1 var(--serif);letter-spacing:.06em}
.hd .sub{font-size:13px;color:var(--ink-2)}
.hd .right{margin-left:auto;display:flex;align-items:center;gap:10px}
.gatepill{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--sans);border-radius:99px;padding:6px 12px}
.gatepill.pass{color:var(--ok);border:1px solid var(--ok)}
.gatepill.fail{color:var(--seal);border:1px solid var(--seal);background:var(--seal-soft)}
.expo{font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:7px 11px;cursor:pointer;transition:.15s}
.expo:hover{border-color:var(--seal);color:var(--seal)}
.expo:focus-visible{outline:2px solid var(--seal);outline-offset:2px}

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .v small{font:400 14px var(--serif);color:var(--ink-2)}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi.accent{border-top:2px solid var(--seal)}
.galert{margin:14px 0 0;border:1px solid var(--seal);background:var(--seal-soft);border-radius:2px;
  padding:10px 14px;font-size:13px}
.galert b{color:var(--seal)}
.galert span{display:block;font-size:12px;color:var(--ink-2)}

section.top-sec{margin-top:34px}
.sec-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px;margin-bottom:16px}
.sec-h .no{font:500 12px/1 var(--mono);color:var(--seal)}
.sec-h h2{font:400 20px/1.2 var(--serif);letter-spacing:.05em}
.sec-h .note{margin-left:auto;font-size:12px;color:var(--ink-3)}

/* 01 cut rhythm strip */
.rhythm{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:16px 20px 10px}
.rrow{display:grid;grid-template-columns:44px minmax(0,1fr) 150px;gap:12px;align-items:center;padding:5px 0}
.rep{font:500 12px/1 var(--mono);color:var(--ink-2)}
.rtrack{display:flex;height:22px;border:1px solid var(--rule);border-radius:2px;overflow:hidden;background:var(--paper)}
.rseg{display:flex;border-right:2px solid var(--ink-2)}
.rseg:last-child{border-right:0}
.seg{display:block;border-right:1px solid var(--panel)}
.rseg .seg:last-child{border-right:0}
.seg:hover{outline:2px solid var(--ink);outline-offset:-2px}
.rval{font:500 12px/1.5 var(--sans);color:var(--ink-2)}
.legend{display:flex;gap:16px;font-size:12px;color:var(--ink-2);margin:8px 0 2px;flex-wrap:wrap}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px}

/* 02 segment cards */
.ep{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 22px;margin-bottom:16px}
.ep-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px;margin-bottom:14px}
.ep-n{font:400 22px/1 var(--serif);letter-spacing:.04em;color:var(--seal)}
.ep-est{font-size:12.5px;color:var(--ink-2)}
.shots{position:relative}
.shots.clip{max-height:760px;overflow:hidden}
.shots.clip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:80px;
  background:linear-gradient(180deg,transparent,var(--panel));pointer-events:none}
.shmore{display:block;width:100%;margin-top:8px;font:500 11.5px/1 var(--sans);letter-spacing:.06em;
  color:var(--ink-2);background:var(--paper);border:1px solid var(--rule-2);border-radius:2px;
  padding:7px 0;cursor:pointer;transition:.15s}
.shmore:hover{border-color:var(--seal);color:var(--seal)}
.shmore:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.seggrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.seggrid{grid-template-columns:minmax(0,1fr)}}
.segcard{background:var(--paper);border:1px solid var(--rule);border-radius:2px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.seg-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.seg-h b{font:500 14px/1 var(--mono);color:var(--seal)}
.sec-badge{font:500 11px/1 var(--mono);border:1px solid var(--seal);color:var(--seal);border-radius:99px;padding:2px 8px}
.beatsref{margin-left:auto;font-size:10.5px;color:var(--ink-3)}
.frame{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;background:var(--side)}
.frame.ph{display:flex;flex-direction:column;gap:6px;padding:10px 12px;cursor:default;overflow:hidden}
.frame.ph b{font:500 10px/1 var(--sans);letter-spacing:.14em;color:var(--ink-3)}
.frame.ph span{font:400 10.5px/1.55 var(--mono);color:var(--ink-2);overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:5;-webkit-box-orient:vertical}
.subs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.fquad{display:grid;grid-template-columns:1fr;gap:10px;margin:10px 0}
.fquad .frame.ph{aspect-ratio:auto}
.fquad .fcell{margin:0;min-height:0}
.fcell-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}
.fcell-h .copy.mini{margin:0;flex:none}
.frame.ph .fprompt{font:400 10.5px/1.4 var(--mono);color:var(--ink-2);white-space:pre-wrap;word-break:break-word;display:block;
  -webkit-line-clamp:none;-webkit-box-orient:vertical;overflow:visible}
.subf{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;background:var(--side)}
.subf.ph{display:flex;align-items:center;justify-content:center;cursor:default;
  font:500 10px/1 var(--sans);color:var(--ink-3);letter-spacing:.08em}
.duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start;border-top:1px solid var(--rule);padding-top:4px}
@media(max-width:900px){.duo{grid-template-columns:minmax(0,1fr)}}
.ppanel{border:1px solid var(--rule);border-radius:2px;background:var(--panel);margin-top:7px}
.pp-h{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--rule)}
.pp{display:none;margin:0;padding:9px 12px;font:400 12px/1.8 var(--sans);color:var(--ink);
  white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.pp.on{display:block}
.pp::-webkit-scrollbar{width:6px}
.pp::-webkit-scrollbar-thumb{background:var(--rule-2);border-radius:3px}
.cuts{margin:0;padding:0;list-style:none}
.cut{padding:7px 0;border-bottom:1px solid var(--rule)}
.cut:first-child{padding-top:11px}
.cut:last-child{border-bottom:0}
.cut-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.cut-h b{font:500 12px/1 var(--mono);color:var(--seal)}
.cut-t{font:500 10.5px/1.6 var(--mono);color:var(--ink-3)}
.cut-sc{font-size:11.5px;color:var(--ink-2)}
.cut-rc{font:400 10.5px/1.6 var(--mono);border:1px dashed var(--rule-2);border-radius:2px;padding:0 6px;color:var(--ink-2)}
.cut-rc sup{color:var(--seal-2);font-weight:700;cursor:help;margin-left:2px}
.cut-h .copy{margin-left:auto;opacity:0;transition:.15s}
.cut:hover .copy{opacity:1}
.cut p{margin:3px 0 0;font-size:12px;line-height:1.6}
.sact{color:var(--ink-2)}
.sline{font-family:var(--serif)}
.sline b{font-weight:500;margin-right:6px;color:var(--seal)}
.chip{font:400 10.5px/1.6 var(--mono);border:1px solid var(--rule-2);border-radius:2px;
  padding:0 6px;background:var(--panel);color:var(--ink-2);text-decoration:none}
.chip.lite{border-color:var(--seal-2);color:var(--seal-2)}
.chip.prop{border-color:var(--seal);color:var(--seal)}
.chip.mono{font-family:var(--mono)}
a.chip:hover{border-color:var(--seal);color:var(--seal)}
.prompts{display:flex;gap:6px}
.seg-note{margin:0;font-size:11px;color:var(--ink-3)}
.seg-block{margin:0;font-size:11.5px;line-height:1.7;color:var(--ink-2)}
.seg-block b{font:500 10.5px/1 var(--sans);letter-spacing:.08em;color:var(--seal);margin-right:8px}
.cut p.scomp{font:400 10.5px/1.6 var(--sans);color:var(--ink-3)}
.ptabs{display:flex;gap:2px;margin-right:auto}
.ptab{font:500 11px/1 var(--sans);letter-spacing:.08em;color:var(--ink-3);background:none;border:0;
  border-bottom:1.5px solid transparent;padding:4px 6px;cursor:pointer}
.ptab.on{color:var(--ink);border-bottom-color:var(--seal)}
.ptab:focus-visible{outline:2px solid var(--seal);outline-offset:2px}${frameAspectCss}

/* 03 generation batches */
.batches{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.batches{grid-template-columns:minmax(0,1fr)}}
.batch{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:14px 18px}
.bimg{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;margin-bottom:10px}
.batch-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.batch-h b{font:500 13px var(--serif);letter-spacing:.06em}
.batch-shots{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.batch-need{margin:8px 0 0;font-size:12px;color:var(--ink-2)}

/* 04 audio alignment */
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;white-space:nowrap}
td a{color:var(--seal);text-decoration:none}
td.serif{font-family:var(--serif)}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:5px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.mini{padding:3px 7px;font-size:10px}
.copy.h3{border-color:var(--seal-2);color:var(--seal-2);width:100%}
.copy.h3:hover,.copy.h3[data-done]{border-color:var(--seal);color:var(--seal)}

.gate{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}
@media(max-width:900px){.gate{grid-template-columns:1fr}}
.gate li{display:flex;gap:8px;padding:5px 0;font-size:12.5px;line-height:1.55}
.gate .m{flex:none;font-weight:700}
.gate li.ok .m{color:var(--ok)}
.gate li.bad .m{color:var(--seal)}
.gate li.bad{background:var(--seal-soft);border-radius:2px;padding-left:6px}
.gate small{display:block;color:var(--ink-3)}
.gsum{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.gsum b{color:var(--seal)}

.lightbox{position:fixed;inset:0;background:rgba(20,22,24,.88);display:none;align-items:center;
  justify-content:center;z-index:9;cursor:zoom-out;padding:32px}
.lightbox.on{display:flex}
.lightbox img{max-width:96%;max-height:96%;border:1px solid #555;border-radius:2px}

.foot{margin-top:40px;font-size:11px;color:var(--ink-3);border-top:1px solid var(--rule);padding-top:14px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .expo,.copy,.shmore{display:none!important}
  .pp{max-height:none;overflow:visible}
  .duo{grid-template-columns:minmax(0,1fr)}
  .shots.clip{max-height:none}
  .shots.clip::after{display:none}
  .seggrid,.batches{grid-template-columns:minmax(0,1fr)}
  .page{max-width:none;padding:0}
  section.top-sec,.segcard,.batch{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(board.source)}</h1>
  <span class="sub">${esc(t.kicker)} · ${esc(t.epRange(eps[0]?.ep, eps[eps.length - 1]?.ep))}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(board.source))}-storyboard.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.segments)}</div><div class="v">${stats.totals.segments} <small>${esc(t.unitSeg)}</small></div><div class="d">${esc(t.kpi.segmentsSub(params.maxSegmentSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.cuts)}</div><div class="v">${stats.totals.cuts} <small>${esc(t.unitCut)}</small></div><div class="d">${esc(t.kpi.cutsSub(stats.totals.avgCutSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.time)}</div><div class="v">${esc(fmtMin(stats.totals.seconds))}</div><div class="d">${esc(t.kpi.timeSub(fmtMin(stats.totals.targetSeconds)))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.batches)}</div><div class="v">${stats.batches.length}</div><div class="d">${esc(t.kpi.batchesSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lines)}</div><div class="v">${stats.totals.withLines} <small>${esc(t.unitSeg)}</small></div><div class="d">${esc(t.kpi.linesSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(gateText(g, t.langCode).label)}${g.detail ? ` — ${esc(gateText(g, t.langCode).detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-rhythm">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secRhythm)}</h2><span class="note">${esc(t.rhythmNote)}</span></div>
  <div class="rhythm">
    <div class="legend">${rhythmLegend}</div>
${rhythmRows}
  </div>
</section>

<section class="top-sec" id="sec-segments">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secSegments)}</h2><span class="note">${esc(t.segmentsNote)}</span></div>
${epBlocks}
</section>

<section class="top-sec" id="sec-batches">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secBatches)}</h2><span class="note">${esc(t.batchesNote)}</span></div>
  <div class="batches">
${batchCards}
  </div>
</section>

<section class="top-sec" id="sec-dialogue">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secDialogue)}</h2><span class="note">${esc(t.dialogueNote)}</span></div>
  <table><thead><tr>${t.dialogueCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>
${dlgRows}
  </tbody></table>
</section>

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">05</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<div class="lightbox" id="lightbox"><img alt=""></div>

<script type="application/json" id="storyboard-data">${embedDoc(board)}</script>
<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed, show: t.showSegs, hide: t.hideSegs })};

// 分集分鏡表：段卡區預設最多 760px。不超高的集直接放開；超高的集點開/收起
document.querySelectorAll('.shmore').forEach((btn) => {
  const zone = btn.previousElementSibling;
  if (zone.scrollHeight <= 780) {
    zone.classList.remove('clip');
    btn.remove();
    return;
  }
  btn.addEventListener('click', () => {
    const clipped = zone.classList.toggle('clip');
    btn.textContent = clipped ? L.show : L.hide;
    if (clipped) zone.closest('.ep').scrollIntoView({ block: 'nearest' });
  });
});

// 點圖放大（主分鏡圖 / 子分鏡圖 / 批次場景圖）
const lb = document.getElementById('lightbox');
document.addEventListener('click', (e) => {
  const img = e.target.closest('img.frame, img.subf, img.bimg');
  if (img) {
    lb.querySelector('img').src = img.src;
    lb.classList.add('on');
    return;
  }
  if (e.target.closest('#lightbox')) lb.classList.remove('on');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lb.classList.remove('on');
});

// 提示詞面板：H3 / Seedance 頁籤，複製鍵複製當前啟用的那一份
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.ptab');
  if (!tab) return;
  const panel = tab.closest('.ppanel');
  const i = Number(tab.dataset.i);
  panel.querySelectorAll('.ptab').forEach((b, k) => b.classList.toggle('on', k === i));
  panel.querySelectorAll('.pp').forEach((pre, k) => pre.classList.toggle('on', k === i));
  panel.querySelector('.pp-h .copy').dataset.copy = panel.querySelectorAll('.pp')[i].textContent;
});

// 複製提示詞
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  e.preventDefault();
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.textContent = L.copied;
    btn.dataset.done = '1';
  } catch {
    btn.textContent = L.failed;
  }
  setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1600);
});

// 匯出：報告自己帶著完整的 storyboard.json，下載的是它原樣
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('storyboard-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // 別立刻回收——Safari 會搶在下載讀完之前撤掉 blob
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-storyboard.mjs — novel-storyboard skill 的確定性工具（分鏡）

  seed <script.json> [--eps 1-3]              從劇本預填節拍工作底稿（列印到 stdout）
         [--aspect 16:9|9:16]                 正式畫幅欄位（預設 16:9）
  validate <sb.json> --script <script.json>   校驗；有違規逐條列印並 exit 1
           [--outline] [--cast] [--art]       outline/cast 查提示詞人名；art 只管顯示名字
           [--shots <卡片目錄>]                掛載鏡頭配方卡庫，開 shot-recipe 門（不給就跳過）
  checkup <sb.json> --script <script.json>    只列印品質門 ✓/✗，有未過項 exit 1
          [--shots <卡片目錄>]
  render <sb.json> --script <script.json>     渲染報告到 stdout（預設 --md）
         [--html|--md] [--outline] [--art]
         [--frames <dir>]                     分鏡圖目錄，找 <dir>/<段號>/f<切序>.png（預設當前目錄）
         [--images <dir>]                     場景設定圖目錄，找 <dir>/<場景 slug>-sheet.png（預設 ./images）
                                              兩個目錄都可以是任意路徑；報告裡的圖片路徑按「報告寫在當前目錄」計算
         [--lang zh|en]                       報告介面語言（預設 zh；未指定時讀取 JSON 頂層 lang 欄位）
         [--shots <卡片目錄>]                  報告的「配方」列顯示卡名並標註建議景別／運鏡的偏離
         [--constraints <file>]               Seedance 全域性約束，一行一條（程式補上無字幕、多人禁雙胞胎）
  export <sb.json> --script <script.json>     匯出投產包，每段一個資料夾
         [--protocol h3|seedance]             h3（預設）：<段號>/prompt.md + f1..fN.png，根部 manifest.json
                                              seedance：<段號>/seedance.md + 附件，根部 seedance-manifest.json
         [--out .]                            輸出目錄
         [--frames <dir>]                     從這裡把 <段號>/f<切序>.png 拷進投產包；不給就只認包裡現成的圖
         [--images <dir>]                     Seedance 參考圖路徑的設定圖目錄（預設 ./images），找到就拷進包
         [--outline] [--art] [--constraints]  名字與全域性約束，同 render
  stats                                       讀當前目錄的 .gates.jsonl，彙總哪道門最常響、
                                              哪道門從沒響過（validate/checkup 會自動累積）
  slug <name>                                 劇名轉安全檔名

validate 與 checkup 每次都會把門的結果追加到當前目錄的 .gates.jsonl。
積累幾十次之後跑 stats，就知道模型最常違反哪條規則——那條規則的措辭該改。
不想記就加 --no-log；寫不進去會靜默跳過，不影響校驗本身。`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

/*
 * --shots 只接受卡片目錄，不接受匯出的 shots.json：中間產物必然會漂，
 * 卡片 .md 才是唯一來源。目錄裡讀不到卡片就直接報錯——掛了卻沒生效
 * 比沒掛更壞。
 */
function loadShots(dir) {
  if (/\.json$/i.test(dir)) {
    throw new Error('--shots 只接受卡片目錄（shot-recipes/references/cards），不接受匯出的 shots.json——中間產物必然會漂');
  }
  const cards = loadRecipes(dir);
  if (!cards.size) throw new Error(`--shots ${dir} 裡沒讀到卡片（.md）——請指向 shot-recipes/references/cards`);
  return cards;
}

function loadCtx(rest) {
  const get = (name) => {
    const path = flag(rest, name);
    return path ? readJson(path) : null;
  };
  const shots = flag(rest, '--shots');
  // Seedance 的全域性約束：一行一條，行首編號可有可無（程式會重新編號）
  const cons = flag(rest, '--constraints');
  const constraints = cons
    ? readFileSync(resolve(cons), 'utf8').split('\n').map((l) => l.trim().replace(/^\d+\s*[.、)）]\s*/, '')).filter(Boolean)
    : [];
  return {
    script: get('--script'), outline: get('--outline'), cast: get('--cast'), art: get('--art'),
    recipes: shots ? loadShots(shots) : null,
    constraints,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'seed') {
    const [path] = rest;
    if (!path) throw new Error('使用方法：seed <script.json> [--eps 1-3] [--aspect 16:9|9:16]');
    const range = flag(rest, '--eps');
    const aspectRatio = flag(rest, '--aspect', '16:9');
    let epRange = null;
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/) ?? String(range).match(/^(\d+)$/);
      if (!m) throw new Error('--eps 形如 3 或 1-6');
      epRange = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])];
    }
    console.log(JSON.stringify(seedFromScript(readJson(path), epRange, aspectRatio), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const [path] = rest;
    if (!path) throw new Error(`用法：${cmd} <storyboard.json> --script <script.json> [--outline] [--cast]`);
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分鏡離開劇本沒有意義——必須給 --script <script.json>');
    if (!ctx.outline && !ctx.cast) console.error('⚠️ 沒給 --outline / --cast，跳過提示詞人名檢查');

    // 門的結果追加到 .gates.jsonl——validate 與 checkup 都記，
    // 這樣「跑過多少次」這個分母才是全的
    const logGates = (gates) => {
      if (rest.includes('--no-log')) return;
      try {
        const rows = gateLogEntries(gates, { doc: basename(path), at: new Date().toISOString() });
        if (rows.length) appendFileSync(GATE_LOG, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      } catch { /* 寫不進去就算了，日誌不能擋住主流程 */ }
    };

    if (cmd === 'checkup') {
      const gates = gateReport(board, ctx);
      logGates(gates);
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${g.detail ? ` — ${g.detail}` : ''}`);
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(failedN ? `\n✗ ${failedN} 項未過` : '\n✓ 全部通過');
      // 建議景別／運鏡的偏離只在這裡提示，不進門——配方是語彙不是法條，
      // 而且可選掛載的東西一旦變嚴就沒人掛了
      if (ctx.recipes) {
        const drifted = [];
        for (const ep of board?.episodes ?? []) {
          for (const seg of ep?.segments ?? []) {
            (seg?.cuts ?? []).forEach((cut, ci) => {
              const card = typeof cut?.recipe === 'string' ? ctx.recipes.get(cut.recipe) : null;
              if (!card) return;
              const d = recipeDrift(cut, card);
              if (d.sizes.length || d.cameras.length) {
                drifted.push(`  ${seg.id}#${ci + 1}「${card.name}」${I18N.zh.recipeDrift(d.sizes, d.cameras)}`);
              }
            });
          }
        }
        if (drifted.length) console.error(`\n${I18N.zh.recipeHint(drifted.length)}\n${drifted.join('\n')}`);
      }
      if (failedN) process.exit(1);
      return;
    }

    logGates(gateReport(board, ctx));
    const problems = validateStoryboard(board, ctx);
    if (problems.length) {
      console.error(`✗ ${problems.length} 處違規：\n`);
      for (const x of problems) console.error('  ' + x);
      process.exit(1);
    }
    const st = computeStats(board, ctx.script);
    console.log(`✓ ${st.episodes.length} 集 / ${st.totals.segments} 段 / ${st.totals.cuts} 個分鏡全部通過校驗（共 ${st.totals.seconds}s / 目標 ${st.totals.targetSeconds}s / ${st.batches.length} 個生成批次）`);
    return;
  }

  if (cmd === 'render') {
    const [path] = rest;
    if (!path) throw new Error('用法：render <storyboard.json> --script <script.json> [--html|--md] [--lang zh|en] [--outline] [--art]');
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分鏡離開劇本沒有意義——必須給 --script <script.json>');
    // 介面語言：--lang > JSON 頂層 lang 欄位 > 'zh'（後兩級在渲染器裡兜底）
    const langFlag = flag(rest, '--lang');
    if (langFlag) ctx.lang = langFlag;
    // 圖放哪由使用者定；src 寫成相對當前目錄的路徑（報告預設就寫在這裡）
    const framesDir = resolve(flag(rest, '--frames', '.'));
    const sheetsDir = resolve(flag(rest, '--images', 'images'));
    ctx.image = (kind, rel) => {
      const abs = join(kind === 'sheet' ? sheetsDir : framesDir, rel);
      return existsSync(abs) ? relative(process.cwd(), abs).split(sep).join('/') : null;
    };
    process.stdout.write((rest.includes('--html') ? renderHtml(board, ctx) : renderMarkdown(board, ctx)) + '\n');
    return;
  }

  if (cmd === 'export') {
    const [path] = rest;
    if (!path) throw new Error('用法：export <storyboard.json> --script <script.json> [--protocol h3|seedance] [--out h3] [--frames <dir>] [--images <dir>]');
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分鏡離開劇本沒有意義——必須給 --script <script.json>');
    const dir = flag(rest, '--out', '.');
    const protocol = flag(rest, '--protocol', 'h3');
    if (!['h3', 'seedance'].includes(protocol)) throw new Error(`--protocol 只能是 h3 或 seedance，實際是 ${protocol}`);
    // 分鏡圖在哪由使用者指定：給了 --frames 就把找得到的拷進包裡，不要求使用者先手動放進去
    const framesFlag = flag(rest, '--frames');
    let copied = 0;
    if (framesFlag) {
      const from = resolve(framesFlag);
      for (const ep of board?.episodes ?? []) {
        for (const seg of ep?.segments ?? []) {
          (seg.cuts ?? []).forEach((_, i) => {
            const src = join(from, seg.id, `f${i + 1}.png`);
            const dst = resolve(dir, seg.id, `f${i + 1}.png`);
            if (!existsSync(src) || src === dst) return;
            mkdirSync(resolve(dst, '..'), { recursive: true });
            copyFileSync(src, dst);
            copied += 1;
          });
        }
      }
    }
    // Seedance 參考圖路徑要掛設定圖：從 --images 指定的目錄找，找到就拷進包裡
    const sheetsDir = resolve(flag(rest, '--images', 'images'));
    const pack = exportPack(board, ctx.script, {
      imageExists: (rel) => existsSync(resolve(rel)),
      sheetExists: (file) => existsSync(join(sheetsDir, file)),
      dir,
      protocol,
      names: namer(ctx),
      constraints: ctx.constraints,
    });
    for (const f of pack.files) {
      mkdirSync(resolve(f.path, '..'), { recursive: true });
      writeFileSync(resolve(f.path), f.content, 'utf8');
    }
    for (const c of pack.copies) copyFileSync(join(sheetsDir, c.file), resolve(c.to));
    const segN = pack.manifest.length;
    if (protocol === 'seedance') {
      console.log(`✓ ${segN} 段 Seedance 投產包 → ${resolve(dir)}/（每段一個資料夾：seedance.md + 附件；根部 seedance-manifest.json）`);
      if (pack.copies.length) console.log(`  從 ${sheetsDir} 拷入 ${pack.copies.length} 張設定圖`);
      if (framesFlag) console.log(`  從 ${resolve(framesFlag)} 拷入 ${copied} 張分鏡圖`);
      if (pack.missingTotal) console.log(`⚠️ 缺 ${pack.missingTotal} 個附件，已在 seedance-manifest.json 的 missing 裡標註——提交前先補齊`);
      console.log('  視覺風格（畫風層）不在包裡，提交時附加');
      return;
    }
    console.log(`✓ ${segN} 段投產包 → ${resolve(dir)}/（每段一個資料夾：分鏡圖 + prompt.md；根部 manifest.json）`);
    if (framesFlag) console.log(`  從 ${resolve(framesFlag)} 拷入 ${copied} 張分鏡圖`);
    if (pack.missingTotal) console.log(`⚠️ 缺 ${pack.missingTotal} 張分鏡圖，已在 manifest 的 missing 裡標註——餵 H3 前先補齊`);
    return;
  }

  if (cmd === 'stats') {
    let entries = [];
    try {
      entries = readFileSync(GATE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch {
      console.log(`還沒有 ${GATE_LOG}——先在這個目錄裡跑幾次 validate 或 checkup，門的失敗會累積到這裡。`);
      return;
    }
    const allGates = gateReport({ episodes: [] }, {}).map((g) => g.id);
    const s = summarizeGateLog(entries, allGates);
    console.log(`跑過 ${s.runs} 次，其中 ${s.cleanRuns} 次全過 · 累計 ${s.fails} 條失敗\n`);
    if (s.ranked.length) {
      console.log('最常響的門（那條規則模型最常無視，措辭該改）：');
      for (const r of s.ranked) {
        console.log(`  ${String(r.count).padStart(3)} 次  ${r.gate.padEnd(16)} ${r.label}`);
        for (const x of r.samples) console.log(`         ${x.length > 90 ? x.slice(0, 90) + '…' : x}`);
      }
      console.log();
    }
    if (s.silent.length) {
      console.log(`從沒響過的門（${s.silent.length} / ${allGates.length}）——可能是死門，也可能規則已經被模型內化：`);
      console.log('  ' + s.silent.join(' / '));
    }
    return;
  }

  if (cmd === 'slug') {
    if (!rest[0]) throw new Error('用法：slug <name>');
    console.log(slug(rest[0]));
    return;
  }

  throw new Error(`未知命令 ${cmd}\n\n${USAGE}`);
}

// 軟鏈安裝時 argv[1] 是連結路徑，兩邊都取 realpath 才能比得上
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // `render ... | head` 這類管道提前關閉時安靜退出，別甩 EPIPE 堆疊
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
