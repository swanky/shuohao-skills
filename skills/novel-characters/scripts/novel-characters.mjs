#!/usr/bin/env node
// novel-characters — deterministic helpers for the novel-characters skill.
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* chunk                                                               */
/* ------------------------------------------------------------------ */

// 塊大小的權衡：塊越大，單塊閱讀越重；塊越小，塊數越多，跨塊歸併
// （全管線語義最難的一步）的接縫就越多。現在的模型讀 4 萬字元毫無壓力，
// 所以往大取——接縫少三倍，漏歸併的機會也少三倍。
// 上限 24 塊，扣掉 23 段重疊淨覆蓋約 93 萬字元。
export const CHUNK_SIZE = 40_000;
export const CHUNK_OVERLAP = 1_200;
export const MAX_CHUNKS = 24;

/**
 * Split source text on paragraph boundaries into overlapping chunks.
 * Overlap keeps a character introduced at a chunk seam visible to both sides.
 */
export function chunkText(text) {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];

  const chunks = [];
  let cursor = 0;

  while (cursor < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(cursor + CHUNK_SIZE, clean.length);

    if (end < clean.length) {
      // Prefer a paragraph break, then a sentence end, inside the last 20%.
      const windowStart = cursor + Math.floor(CHUNK_SIZE * 0.8);
      const window = clean.slice(windowStart, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      );
      const offset = para >= 0 ? para : sentence;
      if (offset >= 0) end = windowStart + offset + 1;
    }

    chunks.push(clean.slice(cursor, end).trim());
    if (end >= clean.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
}

/* ------------------------------------------------------------------ */
/* merge                                                               */
/* ------------------------------------------------------------------ */

/**
 * Merge per-chunk rosters into one cast, keyed by name AND alias so that
 * 陸行遠 / 陸 / 姑娘 collapse onto the same person regardless of which
 * chunk saw which form first.
 */
export function mergeRoster(batches) {
  const byKey = new Map();
  const keyOf = (s) => String(s).trim().toLowerCase();

  for (const batch of batches) {
    for (const entry of batch ?? []) {
      if (!entry?.name) continue;
      const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      const candidates = [entry.name, ...aliases].map(keyOf).filter(Boolean);
      const existingKey = candidates.find((c) => byKey.has(c));
      const target = existingKey
        ? byKey.get(existingKey)
        : { name: String(entry.name).trim(), aliases: [], notes: [], quotes: [] };

      for (const alias of [entry.name, ...aliases]) {
        const trimmed = String(alias).trim();
        if (trimmed && trimmed !== target.name && !target.aliases.includes(trimmed)) {
          target.aliases.push(trimmed);
        }
      }
      if (entry.note && String(entry.note).trim()) target.notes.push(String(entry.note).trim());
      for (const quote of entry.quotes ?? []) {
        const trimmed = String(quote).trim();
        if (trimmed && !target.quotes.includes(trimmed)) target.quotes.push(trimmed);
      }

      for (const c of candidates) byKey.set(c, target);
    }
  }

  // Collapse the alias-keyed index back to one entry per character.
  const unique = new Map();
  for (const value of byKey.values()) unique.set(keyOf(value.name), value);
  // More chunks mentioning a character == more screen time.
  return [...unique.values()].sort((a, b) => b.notes.length - a.notes.length);
}

/**
 * 疑似同人候選。跨塊身份消解是語義問題，確定性程式碼只能做廉價的那一半：
 * 名字包含（「陸」⊂「陸行遠」）是很強的合併訊號，精確匹配卻收斂不了它——
 * 除非某塊恰好把「陸」列成了「陸行遠」的別名。「陸先生」和「行遠」是不是
 * 同一個人則連包含都測不出，所以候選只是嫌疑名單，判斷留給模型，
 * 複核結果寫成 merges.json 再用 --apply 確定性落地。
 */
export function mergeCandidates(cast) {
  const keysOf = (c) => [c.name, ...(c.aliases ?? [])].map((s) => String(s).trim()).filter(Boolean);
  const candidates = [];
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      let reason = null;
      for (const a of keysOf(cast[i])) {
        for (const b of keysOf(cast[j])) {
          const [short, long] = a.length <= b.length ? [a, b] : [b, a];
          if (short.toLowerCase() === long.toLowerCase()) continue; // 相等的鍵 mergeRoster 已經收斂了
          // 拉丁文字短側至少 3 個字元，否則「Al」⊂「Alex」這類噪音太多；CJK 單字就有資訊量
          const min = CJK.test(short) ? 1 : 3;
          if (short.length >= min && long.toLowerCase().includes(short.toLowerCase())) {
            reason = `「${short}」⊂「${long}」`;
            break;
          }
        }
        if (reason) break;
      }
      if (reason) candidates.push({ a: cast[i].name, b: cast[j].name, reason });
    }
  }
  return candidates;
}

/**
 * 把模型複核後的合併決定落地。merges: [{ keep, absorb: [...] }]，
 * keep / absorb 用 name 或任一 alias 定位都行。找不到就整體報錯——
 * 靜默跳過會讓呼叫方以為合併成功了。
 * 不改動傳入的 cast：全程在副本上操作，拋錯後入參照常可用。
 */
export function applyMerges(cast, merges) {
  cast = cast.map((c) => ({ ...c, aliases: [...c.aliases], notes: [...c.notes], quotes: [...c.quotes] }));
  const keyOf = (s) => String(s).trim().toLowerCase();
  const index = new Map();
  for (const c of cast) for (const k of [c.name, ...c.aliases]) index.set(keyOf(k), c);

  const removed = new Set();
  const problems = [];
  for (const m of merges ?? []) {
    const target = index.get(keyOf(m?.keep ?? ''));
    if (!target) {
      problems.push(`keep「${m?.keep}」在歸併結果裡找不到`);
      continue;
    }
    for (const name of m?.absorb ?? []) {
      const victim = index.get(keyOf(name));
      if (!victim) {
        problems.push(`absorb「${name}」在歸併結果裡找不到`);
        continue;
      }
      if (victim === target) continue; // 本來就是同一個人，不算錯
      for (const alias of [victim.name, ...victim.aliases]) {
        if (alias !== target.name && !target.aliases.includes(alias)) target.aliases.push(alias);
      }
      target.notes.push(...victim.notes);
      for (const q of victim.quotes) if (!target.quotes.includes(q)) target.quotes.push(q);
      for (const k of [victim.name, ...victim.aliases]) index.set(keyOf(k), target);
      removed.add(victim);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return cast.filter((c) => !removed.has(c)).sort((a, b) => b.notes.length - a.notes.length);
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

/** Filesystem-safe stem for a character name, CJK preserved. */
export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'character';
}

/* ------------------------------------------------------------------ */
/* i18n                                                                */
/* ------------------------------------------------------------------ */
/*
 * 報告語言。預設 zh-TW（台灣正體）。
 * 內建 zh-TW / zh / en / ja 四套介面文案；給了其他語言碼就用 en 的介面骨架，
 * 但角色內容仍按那個語言生成——介面詞沒翻譯總比整篇亂掉強。
 */

export const DEFAULT_LANG = 'zh-TW';

/** 中文語言碼（含各地區變體），決定人類可讀欄位該不該是漢字。 */
export const isChinese = (lang) => typeof lang === 'string' && /^zh(-|$)/i.test(lang);

/** 正體／繁體中文——隻影響字型挑選，用詞差異由生成階段負責。 */
export const isTraditionalChinese = (lang) =>
  typeof lang === 'string' && /^zh-(tw|hk|mo|hant)/i.test(lang);

/* ------------------------------------------------------------------ */
/* 畫風預設                                                             */
/* ------------------------------------------------------------------ */
/*
 * 換風格是整套換，不是隻換一句「畫風」。
 *
 * 最容易踩的坑：各預設的 negativePrompt 立場是相反的。寫實那套剛把
 * photorealistic 從反向詞裡刪掉，吉卜力恰恰要禁它。毛孔、皮下散射、
 * 順表情肌的皺紋在寫實裡是加分項，在吉卜力裡是反效果。
 * photoreal 又反過來：它跟 realistic 一樣絕不能禁 photorealistic，
 * 但必須禁 illustration / painting / anime——它要的是照片，不是畫。
 *
 * 所以每個預設自帶五塊：render / surface / lighting / negative / tags，
 * 生成角色卡時整塊取用，不要混搭。
 */

export const DEFAULT_STYLE = 'realistic';

export const STYLE_PRESETS = {
  realistic: {
    label: { zh: '半写实厚涂', 'zh-TW': '半寫實厚塗', en: 'Semi-realistic painterly', ja: '半写実・厚塗り' },
    render:
      'Semi-realistic character illustration, painterly rendering with soft blended edges and visible brush texture, anatomically grounded',
    surface:
      'Skin with visible pores and uneven tone, faint capillaries at the nostrils and ear rims, subtle subsurface scattering; eyes with a wet specular highlight, moist lower lid, visible iris fibres and a limbal ring; eyelids and eyebrows slightly asymmetric — no two sides identical; individual flyaway hair strands breaking the silhouette. Fabric with a visible weave, wear and shine at elbows, cuffs and knees, cloth falling with real weight and self-shadowing in the folds',
    // 設定表要平光才好摳圖，寫實要方向光才有體積——分割槽解決
    lighting:
      'LIGHTING IN THE LEFT ZONE ONLY: a soft directional key light from the upper left with gentle falloff, subtle ambient occlusion under the chin, in the eye sockets and where the collar meets the neck, giving the head real volume. LIGHTING IN THE RIGHT ZONES: flat even orthographic lighting with no directional key and no cast shadows, so the figures stay measurable and cleanly cut out',
    // 注意：這裡絕不能禁 photorealistic
    negative:
      'plastic or waxy skin, over-smoothed airbrushed complexion, poreless doll face, perfectly symmetrical face, dead flat eyes without specular highlight, helmet-like hair with no loose strands, flat untextured fabric with no weave or wear, stiff mannequin posing, extra fingers, malformed hands, text, watermark, signature, busy or patterned background, harsh cast shadows on the backdrop',
    tags: ['semi-realistic', 'painterly', 'character sheet', 'subsurface skin', 'directional key light'],
  },

  ghibli: {
    label: { zh: '吉卜力动画', 'zh-TW': '吉卜力動畫', en: 'Ghibli-like animation', ja: 'ジブリ風アニメ' },
    render:
      'Hand-painted anime cel illustration in the manner of classic Studio Ghibli feature animation: clean confident ink linework of even weight, simple flat cel shading with a single soft shadow tone, gentle rounded forms, warm naturalistic palette, watercolour-like softness',
    // 寫實那套的表面細節在這裡全是反效果，整塊換掉
    surface:
      'Skin as clean flat tone with one soft shadow shape and a warm blush at the cheeks and nose — no pores, no skin texture, no subsurface detail; large clear expressive eyes with a simple round highlight and flat iris colour; hair drawn as grouped strands and clumps with clean silhouettes rather than individual hairs; clothing in simple flat colour with a few decisive fold lines, no fabric weave and no micro-texture',
    // 平光就是這個風格本身的一部分，不需要分割槽
    lighting:
      'Even, gentle daylight across the whole sheet with a single soft shadow tone; no dramatic key light, no ambient occlusion, no cast shadows — the flat lighting is part of the style and keeps the figures cleanly cut out',
    // 這裡反過來，必須禁寫實
    negative:
      'photorealistic, 3d render, hyperrealistic skin texture, visible pores, subsurface scattering, harsh contrast, heavy painterly rendering, muddy or desaturated colours, gritty texture overlay, extra fingers, malformed hands, text, watermark, signature, busy or patterned background',
    tags: ['ghibli-like', 'cel shading', 'hand-painted', 'character sheet', 'flat daylight'],
  },

  /*
   * 擬真實拍。跟 realistic 的差別不是「更寫實一點」，是根本不同的東西：
   * realistic 仍是畫出來的（painterly、筆觸、厚塗），photoreal 要的是
   * 「劇組試裝定妝照」——真人、真相機、真鏡頭、真布料。
   *
   * 所以 negative 的重點從「別畫得太塑膠」變成「別畫」：illustration /
   * painting / anime / CGI 全禁。但跟 realistic 一樣，photorealistic 與
   * 3d render 裡的 photorealistic 絕不能禁——那是這個預設要的東西本身。
   *
   * 版面不變：16:9 三區、左半身像右三檢視，照樣分割槽打光。
   */
  photoreal: {
    label: { zh: '拟真实拍', 'zh-TW': '擬真實拍', en: 'Live-action photography', ja: '実写風' },
    render:
      'Live-action photography, not illustration: a real wardrobe camera-test photograph of a real human being on a film production, shot on a full-frame cinema camera with a 50-85mm lens at a moderate aperture against a neutral warm-gray seamless studio backdrop, the finish and honesty of a costume-department test still',
    surface:
      'True photographic skin: real visible pores, fine vellus hair, uneven natural tone, faint capillaries at the nostrils and ear rims, genuine subsurface scattering, moles and freckles left in place, no beauty retouching and no skin smoothing; eyes with a real catchlight from the key light, moist lower lid, resolvable iris fibres and a limbal ring; eyebrows and eyelids honestly asymmetric; loose individual hair strands catching the light and breaking the silhouette. Real garments with true cloth weight, visible weave, stitched seams and hems, natural drape, self-shadowing folds and honest wear at cuffs, elbows and knees',
    // 跟 realistic 同一套分割槽邏輯：左欄要體積，右側要能量比例、好摳圖
    lighting:
      'LIGHTING IN THE LEFT ZONE ONLY: a large soft-box key from the upper left with a gentle bounce fill on the shadow side, real ambient occlusion under the chin, in the eye sockets and where the collar meets the neck, so the head reads as an actually photographed head with volume. LIGHTING IN THE RIGHT ZONES: flat even frontal studio light with no directional key and no cast shadows on the backdrop, so the figures stay measurable and cleanly cut out',
    // 這裡禁的是「畫出來的」，不是「真實的」——photorealistic 絕不能進這一串
    negative:
      'illustration, painting, drawing, sketch, anime, manga, cartoon, cel shading, digital painting brush strokes, CGI, 3d game render, plastic or waxy skin, doll skin, beauty-filter retouching, poreless airbrushed complexion, perfectly symmetrical face, dead flat eyes without a catchlight, wig-like helmet hair with no loose strands, flat untextured costume fabric, cheap cosplay-shop garment, stiff mannequin posing, extra fingers, malformed hands, text, watermark, signature, busy or patterned background, harsh cast shadows on the backdrop',
    tags: ['live-action', 'photographic', 'wardrobe camera test', 'character sheet', 'real skin texture', '85mm lens'],
  },
};

export const SUPPORTED_STYLES = Object.keys(STYLE_PRESETS);
export const stylePreset = (id) => STYLE_PRESETS[id] ?? STYLE_PRESETS[DEFAULT_STYLE];

const STRINGS = {
  zh: {
    kicker: '角色设定集',
    titleTail: ' · 角色',
    docTitle: (s) => `${s} · 角色设定集`,
    counts: (n, shots) => `${n} 位角色${shots ? ` · ${shots} 张设定图` : ''} · 按戏份排序`,
    synopsis: '故事摘要',
    indexLabel: '角色索引',
    aka: '又称',
    groups: { persona: '画像', image: '形象', voice: '声音' },
    persona: {
      gender: '性别', ageRange: '年龄', identity: '身份',
      appearance: '外貌', temperament: '性情', motivation: '动机',
      arc: '人物弧光', relationships: '关系', evidence: '原文依据',
    },
    image: {
      style: '画风',
      prompt: '出图提示词 · 喂出图模型用这条', promptLocal: '出图提示词（中文对照）',
      negative: '反向提示词', sheet: '角色设定图提示词 EN',
    },
    voice: {
      timbre: '音色', pitch: '音高', pace: '语速', accent: '口音',
      emotion: '情绪', referenceHint: '类比',
      prompt: '音色提示词 · 喂 TTS 引擎用这条',
    },
    importance: { protagonist: '主角', major: '主要角色', supporting: '配角', minor: '龙套' },
    graphTitle: '关系图谱',
    graphHint: '悬停看关系，点击进角色',
    graphCounts: (n, e) => `${n} 位角色 · ${e} 组关系`,
    exportJson: '导出 JSON',
    graphLabels: '关系文字',
    graphEmpty: '这批角色之间没有互相指认的关系',
    graphDangling: (n) => `另有 ${n} 条关系指向没做画像的角色，图里不画`,
    relationsAll: '全部关系',
    copy: '复制', copied: '已复制', copyFailed: '复制失败', copyJson: '复制整份角色 JSON',
    sheetCaption: '左：半身像　右：全身三视图',
    noImage: '尚未出图',
    noImageHint: '用下方提示词生成',
    colophonA: '画像与提示词由模型依据原文生成，',
    colophonB: '标记处为原文未明说、为可用性补全的内容。',
    mdTitle: (s) => `# ${s} — 角色表`,
    mdCast: (n, names) => `共 ${n} 位角色：${names}`,
    mdSynopsis: '## 故事摘要',
    searchPlaceholder: '搜索角色、特质、身份',
    rosterTitle: '角色 · 按戏份排序',
    footnote: '标注（推断）的条目为原文未明写、依据文本推演。',
    noMatch: '没有匹配的角色',
    voiceTag: 'VOICE',
    expandAll: '全部展开',
    zoomImage: '放大查看',
    copyImage: '复制图片',
    closeImage: '关闭',
  },
  // 台湾正体。跟 zh 的差别不只在字形——用词也照台湾习惯换过：
  // 「生圖」不是「出图」、「負向提示詞」不是「反向提示词」、「搜尋」不是「搜索」。
  // 只换字形不换用词，读起来还是像翻译腔的简体。
  'zh-TW': {
    kicker: '角色設定集',
    titleTail: ' · 角色',
    docTitle: (s) => `${s} · 角色設定集`,
    counts: (n, shots) => `${n} 位角色${shots ? ` · ${shots} 張設定圖` : ''} · 依戲份排序`,
    synopsis: '故事摘要',
    indexLabel: '角色索引',
    aka: '又稱',
    groups: { persona: '人物側寫', image: '造型', voice: '聲音' },
    persona: {
      gender: '性別', ageRange: '年齡', identity: '身分',
      appearance: '外貌', temperament: '性情', motivation: '動機',
      arc: '角色弧線', relationships: '人物關係', evidence: '原文依據',
    },
    image: {
      style: '畫風', copyTags: '複製標籤',
      prompt: '生圖提示詞 · 餵生圖模型用這條', promptLocal: '生圖提示詞（中文對照）',
      negative: '負向提示詞', sheet: '角色設定圖提示詞 EN',
    },
    voice: {
      timbre: '音色', pitch: '音高', pace: '語速', accent: '口音',
      emotion: '情緒', referenceHint: '類比',
      prompt: '音色提示詞 · 餵 TTS 引擎用這條',
    },
    importance: { protagonist: '主角', major: '主要角色', supporting: '配角', minor: '跑龍套' },
    graphTitle: '人物關係圖譜',
    graphHint: '游標停留檢視關係，點選進入角色',
    graphCounts: (n, e) => `${n} 位角色 · ${e} 組關係`,
    exportJson: '匯出 JSON',
    graphLabels: '關係文字',
    graphEmpty: '這批角色之間沒有互相指認的關係',
    graphDangling: (n) => `另有 ${n} 條關係指向尚未建立人物側寫的角色，因此未繪入圖中`,
    relationsAll: '全部關係',
    copy: '複製', copied: '已複製', copyFailed: '複製失敗', copyJson: '複製整份角色 JSON',
    sheetCaption: '左：半身像　右：全身三檢視',
    noImage: '尚未生圖',
    noImageHint: '用下方提示詞生成',
    colophonA: '人物側寫與提示詞由模型依據原文生成，',
    colophonB: '標記處為原文未明說、為了實用而補上的內容。',
    mdTitle: (s) => `# ${s} — 角色表`,
    mdCast: (n, names) => `共 ${n} 位角色：${names}`,
    mdSynopsis: '## 故事摘要',
    searchPlaceholder: '搜尋角色、特質、身分',
    rosterTitle: '角色 · 依戲份排序',
    footnote: '標註（推斷）的條目為原文未明寫、依據文字推演而來。',
    noMatch: '沒有符合的角色',
    voiceTag: 'VOICE',
    expandAll: '全部展開',
    zoomImage: '放大檢視',
    copyImage: '複製圖片',
    closeImage: '關閉',
  },
  en: {
    kicker: 'CHARACTER BIBLE',
    titleTail: ' · Cast',
    docTitle: (s) => `${s} · Character Bible`,
    counts: (n, shots) =>
      `${n} character${n === 1 ? '' : 's'}${shots ? ` · ${shots} sheet${shots === 1 ? '' : 's'}` : ''} · ordered by prominence`,
    synopsis: 'Synopsis',
    indexLabel: 'Cast index',
    aka: 'a.k.a.',
    groups: { persona: 'Profile', image: 'Design', voice: 'Voice' },
    persona: {
      gender: 'Gender', ageRange: 'Age', identity: 'Standing',
      appearance: 'Appearance', temperament: 'Temperament', motivation: 'Motivation',
      arc: 'Arc', relationships: 'Relationships', evidence: 'From the text',
    },
    image: {
      style: 'Style',
      prompt: 'Image prompt · feed this to the image model', promptLocal: 'Image prompt (local translation)',
      negative: 'Negative prompt', sheet: 'Model sheet prompt',
    },
    voice: {
      timbre: 'Timbre', pitch: 'Pitch', pace: 'Pace', accent: 'Accent',
      emotion: 'Emotion', referenceHint: 'Sounds like',
      prompt: 'Voice prompt · feed this to the TTS engine',
    },
    importance: { protagonist: 'Lead', major: 'Major', supporting: 'Supporting', minor: 'Minor' },
    graphTitle: 'Relationship map',
    graphHint: 'Hover to trace, click to open',
    graphCounts: (n, e) => `${n} character${n === 1 ? '' : 's'} · ${e} link${e === 1 ? '' : 's'}`,
    exportJson: 'Export JSON',
    graphLabels: 'Link labels',
    graphEmpty: 'No one in this cast names anyone else',
    graphDangling: (n) => `${n} more link${n === 1 ? '' : 's'} point to characters without a profile and are not drawn`,
    relationsAll: 'All links',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Failed', copyJson: 'Copy full JSON',
    sheetCaption: 'Left: bust　Right: full-body turnaround',
    noImage: 'Not generated yet',
    noImageHint: 'use the prompts below',
    colophonA: 'Profiles and prompts are model-generated from the source text; ',
    colophonB: 'marks what the text does not state and was filled in for usability.',
    mdTitle: (s) => `# ${s} — Cast`,
    mdCast: (n, names) => `${n} characters: ${names}`,
    mdSynopsis: '## Synopsis',
    searchPlaceholder: 'Search characters, traits, roles',
    rosterTitle: 'Cast · by prominence',
    footnote: 'Anything marked (inferred) is not stated in the text and was reasoned from it.',
    noMatch: 'No matching character',
    voiceTag: 'VOICE',
    expandAll: 'Expand all',
    zoomImage: 'View larger',
    copyImage: 'Copy image',
    closeImage: 'Close',
  },
  ja: {
    kicker: 'キャラクター設定集',
    titleTail: ' · 登場人物',
    docTitle: (s) => `${s} · キャラクター設定集`,
    counts: (n, shots) => `${n}人${shots ? ` · 設定画 ${shots}枚` : ''} · 出番順`,
    synopsis: 'あらすじ',
    indexLabel: '登場人物一覧',
    aka: '別名',
    groups: { persona: '人物像', image: 'ビジュアル', voice: '声' },
    persona: {
      gender: '性別', ageRange: '年齢', identity: '立場',
      appearance: '外見', temperament: '性格', motivation: '動機',
      arc: '人物の変化', relationships: '関係', evidence: '原文の根拠',
    },
    image: {
      style: '画風',
      prompt: '画像プロンプト · 画像モデルにはこれを', promptLocal: '画像プロンプト（対訳）',
      negative: 'ネガティブプロンプト', sheet: 'キャラ設定画プロンプト EN',
    },
    voice: {
      timbre: '声質', pitch: '音域', pace: '話速', accent: '訛り',
      emotion: '感情', referenceHint: 'たとえるなら',
      prompt: '音声プロンプト · TTS にはこれを',
    },
    importance: { protagonist: '主役', major: '主要人物', supporting: '脇役', minor: '端役' },
    graphTitle: '相関図',
    graphHint: 'ホバーで関係、クリックで詳細',
    graphCounts: (n, e) => `${n}人 · ${e}組の関係`,
    exportJson: 'JSON を書き出す',
    graphLabels: '関係ラベル',
    graphEmpty: 'この登場人物どうしを結ぶ関係はありません',
    graphDangling: (n) => `他に${n}件、設定を作っていない人物への関係があります（図には出ません）`,
    relationsAll: '関係一覧',
    copy: 'コピー', copied: 'コピー済み', copyFailed: '失敗', copyJson: 'JSON をコピー',
    sheetCaption: '左：バストアップ　右：三面図',
    noImage: '未生成',
    noImageHint: '下のプロンプトで生成',
    colophonA: '人物像とプロンプトは原文をもとにモデルが生成したものです。',
    colophonB: 'の箇所は原文に明記がなく、実用のために補ったものです。',
    mdTitle: (s) => `# ${s} — 登場人物`,
    mdCast: (n, names) => `全${n}人：${names}`,
    mdSynopsis: '## あらすじ',
    searchPlaceholder: 'キャラクター・特徴・立場を検索',
    rosterTitle: '登場人物 · 出番順',
    footnote: '（推断）の箇所は原文に明記がなく、本文から推し量ったものです。',
    noMatch: '該当するキャラクターがいません',
    voiceTag: 'VOICE',
    expandAll: 'すべて展開',
    zoomImage: '拡大表示',
    copyImage: '画像をコピー',
    closeImage: '閉じる',
  },
};

/**
 * 取介面文案。
 *
 * 兩層：內建表覆蓋常用語言；其他語言由 skill 在生成時翻譯一份塞進
 * cast.json 的 `ui`，這裡合並進來。這樣支援的語言不受內建表限制。
 *
 * @param lang      語言碼
 * @param overrides cast.json 的 `ui`，可以只覆蓋一部分鍵
 */
export function strings(lang = DEFAULT_LANG, overrides = null) {
  const base = STRINGS[lang] ?? STRINGS.en;
  if (!overrides || typeof overrides !== 'object') return base;

  // 只合兩層——STRINGS 的巢狀就兩層深，夠用且不會被髒資料帶偏。
  const merged = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof base[k] === 'function') continue; // 函式模板不接受覆蓋
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      merged[k] = { ...base[k], ...v };
    } else if (typeof v === 'string') {
      merged[k] = v;
    }
  }
  return merged;
}

export const SUPPORTED_UI_LANGS = Object.keys(STRINGS);

/** 需要 skill 補一份 `ui` 翻譯的語言（內建表裡沒有的）。 */
export const needsUiTranslation = (lang) => !SUPPORTED_UI_LANGS.includes(lang);

/** `ui` 裡可覆蓋的鍵——供 ui-template 子命令生成骨架。 */
export function uiTemplate() {
  const en = STRINGS.en;
  const out = {};
  for (const [k, v] of Object.entries(en)) {
    if (typeof v === 'function') continue;
    out[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* seed — 從大綱預填角色表骨架                                          */
/* ------------------------------------------------------------------ */

/**
 * outline 的 tier 對映成 cast 的 importance。
 *
 * 注意兩邊粒度不一樣：outline 的 `lead` 是「主角組」，男女主與主反派都在裡面，
 * 對應 cast 的 protagonist 與 major 兩檔。這裡一律給 protagonist，由模型照
 * seedNote 裡的 role（女主 / 男主 / 反派）把主角之外的改成 major——**分檔本身
 * 不推翻，只在主角組內部細分**。
 */
export const TIER_TO_IMPORTANCE = { lead: 'protagonist', support: 'supporting', functional: 'minor' };

/**
 * 從 outline.json 預填 cast.json 骨架。
 *
 * 大綱是角色設定的上游：誰進誰不進、誰是主角組，在改編階段就拍板了，這一層
 * 不再判斷一遍。搬過來的是**大綱已經定死的事實**（角色碼、名字、分檔、人物線、
 * 由原著的誰合併而來），留空的是**這一層才該做的設計**（別名、畫像、形象提示詞、
 * 音色提示詞）——別名要讀原文才知道，大綱裡沒有。
 *
 * 與 novel-art / novel-script 的 seedFromOutline 同一個形狀：搬事實、留設計、
 * 附一條 seedNote 帶上下文。產出是骨架不是成品，直接跑 validate 會報一堆
 * 欄位缺失，那是預期的。
 */
export function seedFromOutline(outline) {
  const characters = (outline?.characters ?? []).map((c) => {
    const note = [
      c?.id ? `角色碼 ${c.id}` : null,
      c?.role ? `大綱定位：${c.role}` : null,
      c?.tier ? `大綱分檔：${c.tier}` : null,
      (c?.from ?? []).length ? `合併自：${(c.from ?? []).join('、')}` : null,
    ].filter(Boolean).join('　');
    return {
      // 從大綱搬來的事實，不用再想
      ...(c?.id ? { id: c.id } : {}),
      name: c?.name ?? '',
      importance: TIER_TO_IMPORTANCE[c?.tier] ?? 'supporting',
      // 這一層才該做的設計，先佔位
      aliases: [],
      oneLiner: '',
      persona: {
        gender: '', ageRange: '', identity: '', appearance: '',
        personality: [], temperament: '', motivation: '',
        // 人物弧光大綱已經寫了，直接用；覺得不對回去改大綱，別在這裡改一個不一樣的
        arc: c?.arc ?? '',
        relationships: [], evidence: [],
      },
      image: { style: '', prompt: '', promptLocal: '', negativePrompt: '', tags: [], sheet: '' },
      voice: { timbre: '', pitch: '', pace: '', accent: '', emotion: '', prompt: '', referenceHint: '' },
      ...(note ? { seedNote: note } : {}),
    };
  });
  return {
    source: outline?.source ?? '',
    lang: outline?.lang ?? DEFAULT_LANG,
    style: DEFAULT_STYLE,
    summary: '',
    characters,
  };
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

const IMPORTANCE = ['protagonist', 'major', 'supporting', 'minor'];
/** 中日韓表意文字與假名、諺文——影像/TTS 提示詞裡出現就說明串語言了。 */
const CJK = /[㐀-鿿぀-ヿ가-힯]/;
/** 假名單獨一條：用來把日文和中文區分開。 */
const KANA = /[぀-ヿ]/;

const PERSONA_STRINGS = ['gender', 'ageRange', 'identity', 'appearance', 'temperament', 'motivation', 'arc'];
/** 機器輸入，永遠英文——影像和 TTS 引擎都吃英文最穩，跟報告語言無關。 */
const MACHINE_FIELDS = { image: ['prompt', 'negativePrompt', 'sheet'], voice: ['prompt'] };
/** 給人讀的，跟隨報告語言。 */
const HUMAN_VOICE_FIELDS = ['timbre', 'pitch', 'pace', 'accent', 'emotion', 'referenceHint'];

const normalise = (s) => String(s).replace(/\s+/g, '');

/**
 * @param characters 角色卡陣列
 * @param sourceText 原文；null 則跳過逐字引文校驗
 * @param lang       報告語言，決定人類可讀欄位該是什麼語言
 */
export function validateCast(characters, sourceText, lang = DEFAULT_LANG, style = DEFAULT_STYLE) {
  const problems = [];
  const flatSource = sourceText === null ? null : normalise(sourceText);
  const at = (name, msg) => problems.push(`[${name}] ${msg}`);

  if (!Array.isArray(characters) || characters.length === 0) {
    return ['cast 為空或不是陣列'];
  }

  // --- 同劇角色畫風必須一致 ---
  // 這是整批圖"像不像同一部片"的底線。每個角色的 image.style 給人讀的畫風
  // 一句話，模型在第二趟出卡時可能按各自服裝/年齡自由發揮（藏青/冷灰/大地色
  // 各寫一套），導致同框時像四個畫師畫的。預設只約束大類別（realistic/ghibli），
  // 管不到劇內統一，所以用確定性檢查兜底：歸一化後多於一種值就報錯，並點名
  // 哪些角色用了不同畫風。單角色（或未寫 image.style 的角色）不觸發。
  const styleByChar = [];
  for (const c of characters) {
    const name = c?.name ?? '(無名)';
    const style = c?.image?.style;
    if (typeof style === 'string' && style.trim()) styleByChar.push([name, normalise(style)]);
  }
  if (styleByChar.length > 1) {
    const seen = new Map();
    for (const [name, norm] of styleByChar) {
      if (!seen.has(norm)) seen.set(norm, []);
      seen.get(norm).push(name);
    }
    if (seen.size > 1) {
      const groups = [...seen.values()].map((names) => names.join('、')).join('  vs  ');
      problems.push(`同劇角色畫風不一致（image.style 必須統一）：${groups}`);
    }
  }

  // --- 同批角色的提示詞不許雷同 ---
  /*
   * profile-pass.md 早就寫著「同一批角色之間要能區分開，別把長相和聲線做成一個樣」，
   * 但沒有門。模型第二趟出卡時容易套同一個模板：個體描述寫得短，剩下全是真實感樣板
   * 與固定的構圖光照尾巴——兩個年齡性別接近的角色出來就是同一個人（issue #9）。
   *
   * 判定：按詞集合算 Jaccard 相似度，超閾值就點名那一對。
   * 閾值取 0.75，是量出來的不是拍的——自帶樣例四個角色兩兩最高 39%，
   * 而「只改年齡與衣服顏色」的雷同用例是 98%，中間餘量極大。
   *
   * image.sheet 刻意不查：三分割槽排版規範是大段固定文字，真實角色之間本來就有 63%
   * 重合，設門必然誤攔——誤攔的門比沒有門更糟。
   */
  const promptSim = (a, b) => {
    const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
    const A = words(a); const B = words(b);
    if (A.size < 8 || B.size < 8) return 0;
    const inter = [...A].filter((w) => B.has(w)).length;
    return inter / new Set([...A, ...B]).size;
  };
  const SIM_MAX = 0.75;
  for (const [field, label] of [['prompt', '生圖提示詞'], ['voice', '音色提示詞']]) {
    const get = (c) => (field === 'prompt' ? c?.image?.prompt : c?.voice?.prompt);
    for (let i = 0; i < characters.length; i += 1) {
      for (let j = i + 1; j < characters.length; j += 1) {
        const sim = promptSim(get(characters[i]), get(characters[j]));
        if (sim >= SIM_MAX) {
          const pct = Math.round(sim * 100);
          problems.push(
            `${characters[i]?.name ?? '(無名)'} 與 ${characters[j]?.name ?? '(無名)'} 的${label}雷同 ${pct}%`
            + `（上限 ${Math.round(SIM_MAX * 100)}%）——同一批角色要能區分開，別套同一個模板`,
          );
        }
      }
    }
  }

  for (const c of characters) {
    const name = c?.name ?? '(無名)';

    // --- 結構 ---
    if (typeof c?.name !== 'string' || !c.name.trim()) at(name, '缺少 name');
    if (!Array.isArray(c?.aliases)) at(name, 'aliases 必須是陣列');
    if (!IMPORTANCE.includes(c?.importance)) {
      at(name, `importance 必須是 ${IMPORTANCE.join('/')}，實際是 ${JSON.stringify(c?.importance)}`);
    }
    if (typeof c?.oneLiner !== 'string' || !c.oneLiner.trim()) at(name, '缺少 oneLiner');

    const persona = c?.persona;
    if (!persona || typeof persona !== 'object') {
      at(name, '缺少 persona');
    } else {
      for (const f of PERSONA_STRINGS) {
        if (typeof persona[f] !== 'string' || !persona[f].trim()) at(name, `persona.${f} 缺失或為空`);
      }
      if (!Array.isArray(persona.personality)) at(name, 'persona.personality 必須是陣列');
      if (!Array.isArray(persona.relationships)) at(name, 'persona.relationships 必須是陣列');
      if (!Array.isArray(persona.evidence)) at(name, 'persona.evidence 必須是陣列');
    }

    const image = c?.image;
    if (!image || typeof image !== 'object') {
      at(name, '缺少 image');
    } else {
      for (const f of ['style', 'prompt', 'negativePrompt']) {
        if (typeof image[f] !== 'string' || !image[f].trim()) at(name, `image.${f} 缺失或為空`);
      }
      if (typeof image.sheet !== 'string' || !image.sheet.trim()) {
        at(name, 'image.sheet 缺失或為空（角色設定圖提示詞）');
      }
      if (!Array.isArray(image.tags)) at(name, 'image.tags 必須是陣列');
    }

    const voice = c?.voice;
    if (!voice || typeof voice !== 'object') {
      at(name, '缺少 voice');
    } else {
      for (const f of [...HUMAN_VOICE_FIELDS, 'prompt']) {
        if (typeof voice[f] !== 'string' || !voice[f].trim()) at(name, `voice.${f} 缺失或為空`);
      }
      /*
       * 音色提示詞裡不許出現引號包起來的臺詞。
       * profile-pass.md 第 7 條寫著「描述樂器本身，不是某一句臺詞的演繹」，
       * 但模型會寫出「殺意藏在『規矩就是規矩』這類客套話裡」這種句子——
       * 臺詞一進去，有些 TTS 引擎會把它當成要朗讀的內容（製作時踩過）。
       * 只查成對的引號，判定乾淨：正常的音色描述不需要引任何一句話。
       */
      /*
       * 音色提示詞要緊湊，不要散文。
       * voice design 引擎（Qwen3-TTS Voice Design / ElevenLabs / MiniMax）吃的是
       * 參數密度：年齡性別、音色、音區、共鳴、動態、音量、語速、語調、口音、預設情緒。
       * 寫成流暢的英文散文會把這些參數稀釋掉——生產裡實測對比過，緊湊版明顯更好。
       *
       * 上限 400 字元是量出來的：自帶樣例四個角色 218–245，而被實測判為過冗餘的
       * 散文版是 490–514，中間餘量很大。它攔的是「寫成小作文」，不是「寫得細」。
       */
      if (typeof voice.prompt === 'string' && voice.prompt.length > 400) {
        at(name, `voice.prompt ${voice.prompt.length} 字元，超過 400——音色提示詞要緊湊的參數串，不是散文；參數寫全但別鋪陳`);
      }
      if (typeof voice.prompt === 'string') {
        const quoted = voice.prompt.match(/[「『"“][^」』"”]{2,}[」』"”]/);
        if (quoted) {
          at(name, `voice.prompt 裡出現了引號臺詞「${quoted[0].slice(0, 24)}」——音色提示詞描述的是嗓子本身，不是某一句臺詞的演繹`);
        }
      }
    }

    // --- 引文必須逐字 ---
    if (flatSource && Array.isArray(persona?.evidence)) {
      for (const quote of persona.evidence) {
        if (typeof quote !== 'string') {
          at(name, 'persona.evidence 裡有非字串');
        } else if (!flatSource.includes(normalise(quote))) {
          at(name, `引文不是原文逐字片段：${quote}`);
        }
      }
    }

    // --- 生圖提示詞不許出現人名 ---
    if (image) {
      const names = [c?.name, ...(Array.isArray(c?.aliases) ? c.aliases : [])].filter(
        (n) => typeof n === 'string' && n.trim(),
      );
      for (const field of ['prompt', 'promptLocal', 'sheet']) {
        const value = image[field];
        if (typeof value !== 'string') continue;
        for (const n of names) {
          if (value.includes(n)) at(name, `image.${field} 裡出現了人名「${n}」`);
        }
      }
    }

    // --- 語言分工 ---
    // 機器欄位永遠英文；人類欄位跟隨報告語言。
    // 只有 zh / en 能可靠自動判別，其他語言不猜、跳過。
    for (const [group, fields] of Object.entries(MACHINE_FIELDS)) {
      const obj = c?.[group];
      if (!obj) continue;
      for (const f of fields) {
        if (typeof obj[f] === 'string' && CJK.test(obj[f])) {
          at(name, `${group}.${f} 是餵給模型的，必須英文，但含中日韓字元`);
        }
      }
    }
    if (Array.isArray(image?.tags)) {
      for (const t of image.tags) {
        if (typeof t === 'string' && CJK.test(t)) at(name, `image.tags 必須英文，但「${t}」含中日韓字元`);
      }
    }
    // --- 風格與提示詞必須匹配 ---
    // 兩個預設的負向提示詞幾乎是相反的，搞反了整批圖都毀。
    if (image && SUPPORTED_STYLES.includes(style)) {
      const neg = typeof image.negativePrompt === 'string' ? image.negativePrompt : '';
      const bansRealism = /photorealistic|3d render/i.test(neg);
      const preset = stylePreset(style);
      // 拿預設自己的立場當基準，新增預設不用回來改這裡
      const presetBansRealism = /photorealistic|3d render/i.test(preset.negative);
      if (!presetBansRealism && bansRealism) {
        at(name, `style=${style} 卻在 negativePrompt 裡禁 photorealistic／3d render——自相矛盾`);
      }
      if (presetBansRealism && !bansRealism) {
        at(name, `style=${style} 的 negativePrompt 必須禁 photorealistic／3d render`);
      }
      // 擬真實拍反過來要禁「畫出來的」，漏了模型很容易交一張插畫
      if (style === 'photoreal' && !/illustration|painting|anime|cartoon/i.test(neg)) {
        at(name, 'style=photoreal 的 negativePrompt 必須禁 illustration／painting／anime／cartoon');
      }
      if (typeof image.sheet === 'string' && !image.sheet.includes(preset.render)) {
        at(name, `image.sheet 裡沒有 style=${style} 的渲染句，畫風會飄`);
      }
    }

    // 只有這三種能可靠自動判別，其他語言不猜、跳過——誤報比漏報更煩人。
    if (voice) {
      for (const f of HUMAN_VOICE_FIELDS) {
        const v = voice[f];
        if (typeof v !== 'string' || !v.trim()) continue;
        if (lang === 'en' && CJK.test(v)) at(name, `voice.${f} 應為英文，但含中日韓字元`);
        // zh 的各地區變體（zh-TW / zh-HK…）走同一條中文檢查；
        // 簡繁之分自動判不可靠，交給生成階段的用語約束管。
        if (isChinese(lang) && !CJK.test(v)) at(name, `voice.${f} 應為中文，實際是「${v}」`);
        if (isChinese(lang) && KANA.test(v)) at(name, `voice.${f} 應為中文，但含日文假名`);
        if (lang === 'ja' && !KANA.test(v) && !CJK.test(v)) {
          at(name, `voice.${f} 應為日文，實際是「${v}」`);
        }
      }
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* assemble                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把第二趟的角色卡合成 cast.json 的頂層結構。純機械活——之前留給模型
 * 手拼，手拼會丟欄位、寫錯頂層鍵。
 *
 * 排序：importance 分檔，同檔按 order（merge 輸出的名字順序，即戲份
 * 順序）。不給 order 就保持傳入順序——CLI 按檔名讀卡，那是 slug
 * 字典序不是戲份序，所以報告要「按戲份排序」就必須給 order。
 */
export function assembleCast(cards, { source, lang = DEFAULT_LANG, style = DEFAULT_STYLE, summary = '', ui = null, order = null } = {}) {
  const rank = (c) => {
    const i = IMPORTANCE.indexOf(c?.importance);
    return i < 0 ? IMPORTANCE.length : i; // 越界的排最後，讓 validate 去報，這裡不崩
  };
  const orderIndex = new Map((order ?? []).map((name, i) => [String(name).trim().toLowerCase(), i]));
  // 不在 order 裡的排到同檔末尾（保持傳入順序），不報錯——卡是從 merge 結果生成的，正常對得上
  const byOrder = (c) => orderIndex.get(String(c?.name ?? '').trim().toLowerCase()) ?? orderIndex.size;
  const characters = cards
    .map((card, i) => [card, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || byOrder(a[0]) - byOrder(b[0]) || a[1] - b[1])
    .map(([card]) => card);
  const cast = { source, lang, style };
  if (ui) cast.ui = ui;
  cast.summary = summary;
  cast.characters = characters;
  return cast;
}

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

export function renderMarkdown(characters, source, summary = '', lang = DEFAULT_LANG, ui = null) {
  const t = strings(lang, ui);
  const out = [t.mdTitle(source), '', t.mdCast(characters.length, characters.map((c) => c.name).join('、')), ''];
  if (summary) out.push(t.mdSynopsis, '', summary, '');

  for (const c of characters) {
    const { persona, image, voice } = c;
    out.push('---', '');
    out.push(`## ${c.name}${c.aliases.length ? `（${c.aliases.join('、')}）` : ''}`, '');
    out.push(`> ${t.importance[c.importance] ?? c.importance} · ${c.oneLiner}`, '');

    if (c.sheetImage) out.push(`![${c.name} ${t.sheetCaption}](${c.sheetImage})`, '');

    out.push(`### ${t.groups.persona}`, '');
    out.push(`- **${t.persona.gender}**：${persona.gender}`);
    out.push(`- **${t.persona.ageRange}**：${persona.ageRange}`);
    out.push(`- **${t.persona.identity}**：${persona.identity}`);
    if (persona.personality.length) out.push(`- ${persona.personality.join(' / ')}`);
    out.push('');
    out.push(`**${t.persona.appearance}**　${persona.appearance}`, '');
    out.push(`**${t.persona.temperament}**　${persona.temperament}`, '');
    out.push(`**${t.persona.motivation}**　${persona.motivation}`, '');
    out.push(`**${t.persona.arc}**　${persona.arc}`, '');

    if (persona.relationships.length) {
      out.push(`**${t.persona.relationships}**`, '');
      for (const r of persona.relationships) out.push(`- ${r.name} — ${r.relation}`);
      out.push('');
    }
    if (persona.evidence.length) {
      out.push(`**${t.persona.evidence}**`, '');
      for (const q of persona.evidence) out.push(`> ${q}`, '');
    }

    out.push(`### ${t.groups.image}`, '');
    out.push(`**${t.image.style}**　${image.style}`, '');
    if (image.tags.length) out.push(`\`${image.tags.join('`, `')}\``, '');
    out.push(`**${t.image.prompt}**`, '', '```text', image.prompt, '```', '');
    if (image.promptLocal) out.push(`${image.promptLocal}`, '');
    out.push(`**${t.image.negative}**`, '', '```text', image.negativePrompt, '```', '');
    out.push(`**${t.image.sheet}**`, '', '```text', image.sheet, '```', '');

    out.push(`### ${t.groups.voice}`, '');
    for (const f of HUMAN_VOICE_FIELDS) out.push(`- **${t.voice[f]}**：${voice[f]}`);
    out.push('');
    out.push(`**${t.voice.prompt}**`, '', '```text', voice.prompt, '```', '');
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 三欄工作臺。設計約定見 references/report-style.md。不能破的：
 *   1. 雙字域：襯線=敘事與原文，無襯線=分析，等寬=餵給機器的提示詞
 *   2. 「（推斷）」自動高亮，讓讀者一眼分清有據和補全
 *   3. 一次只看一個角色，靠左欄切換 + 頂欄搜尋找人
 *   4. 列印時全部展開——螢幕上一次一個，紙上要是完整的一份
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 推斷標記：半形/全形 × 中英四種寫法都要認，模型不挑食地亂產。 */
const INFERRED = /（\s*(?:推斷|inferred)[^）]*）|\(\s*(?:推斷|inferred)[^)]*\)/gi;
const marked = (s) => esc(s).replace(INFERRED, (m) => `<span class="inf">${m}</span>`);

const IMPORTANCE_ORDER = ['protagonist', 'major', 'supporting', 'minor'];

/** 左欄的一條角色。縮圖取設定圖的左半邊——那裡正好是半身像。 */
function renderRosterItem(c, index, t) {
  const meta = [c.persona?.gender, c.persona?.ageRange].filter(Boolean).join(' · ');
  const hay = [
    c.name,
    ...(c.aliases ?? []),
    c.persona?.identity,
    c.persona?.gender,
    c.persona?.ageRange,
    ...(c.persona?.personality ?? []),
    c.oneLiner,
  ]
    .filter(Boolean)
    .join(' ');

  return `<button class="rost${index === 0 ? ' on' : ''}" data-target="p-${slug(c.name)}" data-hay="${esc(hay)}">
  <span class="rost-thumb"${
    c.sheetImage ? ` style="background-image:url('${esc(c.sheetImage)}')"` : ''
  }></span>
  <span class="rost-body">
    <span class="rost-top">
      <em class="rost-n">${String(index + 1).padStart(2, '0')}</em>
      <b class="rost-name">${esc(c.name)}</b>
      <span class="badge">${esc(t.importance[c.importance] ?? c.importance)}</span>
      ${meta ? `<span class="rost-meta">${esc(meta)}</span>` : ''}
    </span>
    <span class="rost-one">${esc(c.oneLiner)}</span>
    ${
      c.persona?.personality?.length
        ? `<span class="rost-chips">${c.persona.personality.map((x) => `<i>${esc(x)}</i>`).join('')}</span>`
        : ''
    }
  </span>
</button>`;
}

function renderCharacter(c, index, t) {
  const { persona, image, voice } = c;

  const promptRow = (label, value) =>
    !value
      ? ''
      : `<details class="pr">
  <summary><span>${esc(label)}</span><button class="copy" data-copy="${esc(value)}">${esc(t.copy)}</button></summary>
  <p>${esc(value)}</p>
</details>`;

  const kv = (label, value) =>
    !value ? '' : `<div class="kv"><dt>${esc(label)}</dt><dd>${marked(value)}</dd></div>`;

  const block = (label, body) =>
    !body ? '' : `<section class="blk"><h3>${esc(label)}</h3><p>${marked(body)}</p></section>`;

  const plate = c.sheetImage
    ? `<figure class="plate-wrap">
         <button class="plate zoom" data-src="${esc(c.sheetImage)}" aria-label="${esc(t.zoomImage)}">
           <img src="${esc(c.sheetImage)}" alt="${esc(c.name)} ${esc(t.sheetCaption)}" loading="lazy">
         </button>
         <button class="copy-img" data-img="${esc(c.sheetImage)}" title="${esc(t.copyImage)}">${esc(t.copyImage)}</button>
       </figure>
       <p class="plate-c">${esc(t.sheetCaption)}</p>`
    : `<div class="plate plate-empty">
         <span>${esc(c.name)} · ${esc(t.noImage)}<br><em>${esc(t.noImageHint)}</em></span>
       </div>`;

  return `<article class="char${index === 0 ? ' on' : ''}" id="p-${slug(c.name)}">
  <header class="char-h">
    <span class="char-n">${String(index + 1).padStart(2, '0')}</span>
    <h2>${esc(c.name)}</h2>
    <span class="badge">${esc(t.importance[c.importance] ?? c.importance)}</span>
    ${c.aliases.length ? `<span class="aka">${esc(t.aka)}　${esc(c.aliases.join(' · '))}</span>` : ''}
    <span class="char-one">${marked(c.oneLiner)}</span>
  </header>

  <div class="upper">
    <div class="stage">
      ${plate}

      <div class="grid2">
        ${block(t.persona.appearance, persona.appearance)}
        ${block(t.persona.temperament, persona.temperament)}
        ${block(t.persona.motivation, persona.motivation)}
        ${block(t.persona.arc, persona.arc)}
      </div>

      ${
        persona.evidence.length
          ? `<section class="blk source"><h3>${esc(t.persona.evidence)}</h3>
               <div class="quotes">${persona.evidence.map((q) => `<blockquote>${esc(q)}</blockquote>`).join('')}</div>
             </section>`
          : ''
      }
    </div>

    <aside class="side-cards">
      <div class="card">
        <dl>${kv(t.persona.gender, persona.gender)}${kv(t.persona.ageRange, persona.ageRange)}${kv(t.persona.identity, persona.identity)}</dl>
      </div>

      ${
        persona.relationships.length
          ? `<div class="card"><h4>${esc(t.persona.relationships)}</h4>
               <dl>${persona.relationships.map((r) => `<div class="kv"><dt class="rel-n">${esc(r.name)}</dt><dd>${marked(r.relation)}</dd></div>`).join('')}</dl>
             </div>`
          : ''
      }

      <div class="card">
        <h4>${esc(t.groups.voice)}<i class="tag-en">${esc(t.voiceTag)}</i></h4>
        <dl>${HUMAN_VOICE_FIELDS.map((f) => kv(t.voice[f], voice[f])).join('')}</dl>
      </div>

      <div class="card">
        <h4>${esc(t.image.style)}</h4>
        <p class="style">${esc(image.style)}</p>
        ${image.tags.length ? `<ul class="tags">${image.tags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
    </aside>
  </div>

  <div class="prompts">
    <div class="pgroup">
      ${promptRow(t.image.prompt, image.prompt)}
      ${promptRow(t.image.sheet, image.sheet)}
      ${promptRow(t.image.negative, image.negativePrompt)}
      ${promptRow(t.image.promptLocal, image.promptLocal)}
    </div>
    <div class="pgroup">
      ${promptRow(t.voice.prompt, voice.prompt)}
      <div class="pgroup-f">
        <button class="copy wide" data-copy="${esc(JSON.stringify(c, null, 2))}">${esc(t.copyJson)}</button>
      </div>
    </div>
  </div>
</article>`;
}

/* ------------------------------------------------------------------ */
/* render — 關係圖譜                                                    */
/* ------------------------------------------------------------------ */
/*
 * 圓環佈局 + 向心貝塞爾。位置在 Node 裡算好直接寫進內聯 SVG，
 * 瀏覽器端只管高亮和跳轉——報告要能離線雙擊開啟，不許引任何庫。
 */

/** 節點大小按戲份分檔，一眼能看出誰是主角。 */
const NODE_R = { protagonist: 11, major: 9, supporting: 7, minor: 5.5 };
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * 把 persona.relationships 解析成無向邊。
 *
 * 按**名字 + 別名**建索引：老周的關係裡寫「老伯」也要連到同一個節點，
 * 只按 name 匹配會把一半的邊漏掉。同一對人的兩條單向記述合併成一條邊，
 * 兩個方向的說法都留著。指向沒做畫像的人算 dangling——不畫，但要報數。
 */
export function buildGraph(characters) {
  const key = (s) => String(s).trim().toLowerCase();
  const index = new Map();
  for (const c of characters) {
    index.set(key(c.name), c.name);
    for (const a of c.aliases ?? []) index.set(key(a), c.name);
  }

  const edges = new Map();
  let dangling = 0;
  for (const c of characters) {
    for (const r of c.persona?.relationships ?? []) {
      if (!r || typeof r.name !== 'string') continue;
      const target = index.get(key(r.name));
      if (!target || target === c.name) {
        dangling++;
        continue;
      }
      const [a, b] = [c.name, target].sort();
      const k = `${a} ${b}`;
      if (!edges.has(k)) edges.set(k, { a, b, notes: [] });
      edges.get(k).notes.push({ from: c.name, text: String(r.relation ?? '') });
    }
  }
  return { edges: [...edges.values()], dangling };
}

function renderGraph(ordered, t) {
  const { edges, dangling } = buildGraph(ordered);
  const n = ordered.length;
  // 半徑跟人數走，四個人不必撐滿一整張畫布；兩側留 110 給名字
  const R = Math.max(130, Math.min(260, 40 + n * 14));
  const side = Math.round((R + 110) * 2);
  const c0 = side / 2;

  const pos = new Map();
  ordered.forEach((c, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    pos.set(c.name, { x: c0 + R * Math.cos(a), y: c0 + R * Math.sin(a), cos: Math.cos(a), sin: Math.sin(a) });
  });

  // 控制點往圓心拉，弦是彎的——直線在人多時會糊成一團網
  const arcs = edges.map((e, i) => {
    const p = pos.get(e.a);
    const q = pos.get(e.b);
    const cxq = c0 + ((p.x + q.x) / 2 - c0) * 0.35;
    const cyq = c0 + ((p.y + q.y) / 2 - c0) * 0.35;
    // 標籤沿弦錯位排：正對面的兩條弦中點都在圓心，全放 t=0.5 會疊成一坨
    const t = 0.5 + ((i % 3) - 1) * 0.14;
    const u = 1 - t;
    return {
      e,
      d: `M${r1(p.x)} ${r1(p.y)} Q${r1(cxq)} ${r1(cyq)} ${r1(q.x)} ${r1(q.y)}`,
      lx: u * u * p.x + 2 * u * t * cxq + t * t * q.x,
      ly: u * u * p.y + 2 * u * t * cyq + t * t * q.y,
    };
  });

  const paths = arcs
    .map((a) => `<path class="gedge" data-a="${esc(a.e.a)}" data-b="${esc(a.e.b)}" d="${a.d}"></path>`)
    .join('');

  // 弦上的關係文字：取最短的一條說法截斷，全文進 <title> 當原生 tooltip
  const labels = arcs
    .map((a) => {
      const notes = a.e.notes.filter((x) => x.text.trim());
      if (!notes.length) return '';
      const pick = notes.reduce((s, x) => ([...x.text].length < [...s.text].length ? x : s), notes[0]);
      // 六個字。再長就壓到隔壁那條弦上去了——全文在 title 和右側關係表裡
      const chars = [...pick.text.trim()];
      const text = chars.length > 6 ? `${chars.slice(0, 6).join('')}…` : chars.join('');
      const full = notes.map((x) => `${x.from} · ${x.text}`).join('\n');
      return `<text class="glabel" data-a="${esc(a.e.a)}" data-b="${esc(a.e.b)}" x="${r1(a.lx)}" y="${r1(a.ly)}" text-anchor="middle" dominant-baseline="middle">${esc(text)}<title>${esc(full)}</title></text>`;
    })
    .join('');

  const dots = ordered
    .map((c) => {
      const p = pos.get(c.name);
      // 圓頂和圓底的名字居中放，兩側的往外甩，免得壓在節點上
      const flat = Math.abs(p.cos) < 0.25;
      const anchor = flat ? 'middle' : p.cos < 0 ? 'end' : 'start';
      const lx = c0 + (R + 15) * p.cos;
      const ly = c0 + (R + 15) * p.sin + (flat ? (p.sin < 0 ? -6 : 14) : 4.5);
      return `<g class="gnode${c.importance === 'protagonist' ? ' lead' : ''}" data-node="${esc(c.name)}" data-target="p-${slug(c.name)}" tabindex="0" role="button" aria-label="${esc(c.name)}">
  <circle class="ghit" cx="${r1(p.x)}" cy="${r1(p.y)}" r="24"></circle>
  <circle class="gdot" cx="${r1(p.x)}" cy="${r1(p.y)}" r="${NODE_R[c.importance] ?? 7}"></circle>
  <text x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchor}">${esc(c.name)}</text>
</g>`;
    })
    .join('');

  const rows = edges
    .map(
      (e) => `<button class="grow" data-a="${esc(e.a)}" data-b="${esc(e.b)}" data-target="p-${slug(e.a)}">
  <b>${esc(e.a)}</b><i>—</i><b>${esc(e.b)}</b>
  ${e.notes.map((x) => `<span><em>${esc(x.from)}</em> ${marked(x.text)}</span>`).join('')}
</button>`,
    )
    .join('');

  // 邊少就直接把關係文字標上；邊一多就糊成一團，預設收起來，開關留給使用者
  const labelsOn = edges.length <= 14;

  return `<section class="graph${labelsOn ? ' labels' : ''}" id="graph">
  <header class="graph-h">
    <h2>${esc(t.graphTitle)}</h2>
    <span class="badge">${esc(t.graphCounts(n, edges.length))}</span>
    <button class="glabtoggle${labelsOn ? ' on' : ''}" aria-pressed="${labelsOn}">${esc(t.graphLabels)}</button>
    <span class="hint">${esc(t.graphHint)}</span>
  </header>
  <div class="graph-body">
    <div class="graph-canvas">
      <svg viewBox="0 0 ${side} ${side}" role="img" aria-label="${esc(t.graphTitle)}">
        <g class="gedges">${paths}</g>
        <g class="gnodes">${dots}</g>
        <g class="glabels">${labels}</g>
      </svg>
      ${edges.length ? '' : `<p class="graph-empty">${esc(t.graphEmpty)}</p>`}
    </div>
    <aside class="grel">
      <h4>${esc(t.relationsAll)}</h4>
      <div class="grel-list">${rows}</div>
      ${dangling ? `<p class="grel-foot">${esc(t.graphDangling(dangling))}</p>` : ''}
    </aside>
  </div>
</section>`;
}

/*
 * 報告裡內嵌的那份資料，形狀**就是 cast.json**——編輯完能直接餵回
 * `render` 重新出報告，不另立一套匯出格式。
 *
 * `<` 轉成 <：JSON 裡 `<` 只可能出現在字串值中，整體替換是安全的，
 * 而不轉的話正文裡一個 `</script` 就能把這個資料區塊提前截斷。
 */
function embedCast(characters, source, summary, lang, ui, style) {
  const data = { source, lang, style, summary, ...(ui ? { ui } : {}), characters };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function renderHtml(
  characters,
  source,
  summary = '',
  lang = DEFAULT_LANG,
  ui = null,
  style = DEFAULT_STYLE,
) {
  const t = strings(lang, ui);
  // 正體中文要挑 TC 字型：Songti SC 那一串在台灣機器上多半沒裝，
  // 掉回系統預設會跟內文的正體字形不搭。
  const isHant = isTraditionalChinese(lang);
  const shots = characters.filter((c) => c.sheetImage).length;
  const ordered = [...characters].sort(
    (a, b) => IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance),
  );

  return `<!doctype html>
<html lang="${esc(lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(source))}</title>
<style>
/* 冷灰印張 + 鐵鏽紅印記。紅色只用在與原文有關的地方和當前選中態。 */
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-soft:#8a332412;
  --serif:${isHant ? '"Songti TC","PMingLiU","Source Han Serif TC","Noto Serif CJK TC"' : '"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC"'},Georgia,"Iowan Old Style",serif;
  --sans:${isHant ? '"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC"' : '"PingFang SC","Hiragino Sans GB","Microsoft YaHei"'},system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --top:60px; --side-w:400px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);
  -webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-weight:400}
button{font-family:inherit}

/* ---------- 頂欄 ---------- */
.top{position:sticky;top:0;z-index:20;height:var(--top);display:flex;align-items:center;gap:24px;
  padding:0 20px;background:var(--panel);border-bottom:1px solid var(--rule-2)}
.brand{display:flex;align-items:baseline;gap:10px;flex:none}
.brand h1{font:400 22px/1 var(--serif);letter-spacing:.04em}
.brand em{font:italic 12px/1 var(--serif);color:var(--ink-3)}
.search{flex:1;max-width:720px;position:relative}
.search input{width:100%;height:34px;padding:0 12px 0 32px;border:1px solid var(--rule-2);
  border-radius:3px;background:var(--paper);color:var(--ink);font:14px/1 var(--sans);outline:none}
.search input:focus{border-color:var(--seal)}
.search svg{position:absolute;left:10px;top:9px;width:14px;height:14px;stroke:var(--ink-3);fill:none}
.topmeta{margin-left:auto;font-size:12px;color:var(--ink-3);display:flex;align-items:center;
  gap:10px;flex:none}
.topmeta i{font-style:normal;color:var(--rule-2)}
/* 匯出：下載的就是內嵌的那份 cast.json，編輯完能直接餵回 render */
.expo{margin-left:4px;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:6px 10px;cursor:pointer;transition:.15s}
.expo:hover{border-color:var(--seal);color:var(--seal)}
.expo:focus-visible{outline:2px solid var(--seal);outline-offset:2px}

/* ---------- 骨架 ---------- */
.shell{display:grid;grid-template-columns:var(--side-w) minmax(0,1fr);align-items:start}
@media(max-width:1080px){:root{--side-w:100%}.shell{grid-template-columns:1fr}}

/* ---------- 左欄 ---------- */
.side{position:sticky;top:var(--top);height:calc(100vh - var(--top));overflow-y:auto;
  background:var(--side);border-right:1px solid var(--rule-2)}
@media(max-width:1080px){.side{position:static;height:auto}}
.synopsis{padding:18px 20px;border-bottom:1px solid var(--rule)}
.lbl{font:500 10px/1 var(--sans);letter-spacing:.24em;text-transform:uppercase;color:var(--ink-3)}
.synopsis p{margin:10px 0 0;font:400 14px/1.95 var(--serif)}
/* 摘要預設三行，底部漸隱——左欄第一屏要留給角色列表。點一下展開，之後不再收起 */
.syn-clamp{cursor:pointer}
.syn-clamp p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 58%,transparent);
  mask-image:linear-gradient(180deg,#000 58%,transparent)}
.syn-more{display:none;margin-top:7px;padding:0;background:none;border:0;cursor:pointer;
  font:500 11px/1 var(--sans);letter-spacing:.06em;color:var(--seal)}
.syn-clamp .syn-more{display:block}
.syn-more:hover{text-decoration:underline}
.syn-more:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.roster-h{padding:14px 20px 8px}
.roster{display:block}
.rost{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;width:100%;text-align:left;
  padding:12px 20px;background:none;border:0;border-bottom:1px solid var(--rule);
  border-left:2px solid transparent;cursor:pointer;color:inherit}
.rost:hover{background:#00000006}
.rost.on{background:var(--panel);border-left-color:var(--seal)}
.rost:focus-visible{outline:2px solid var(--seal);outline-offset:-2px}
/* 縮圖 = 設定圖的左欄切片。設定圖固定 16:9、左欄佔約 34%，
   所以把整圖按 1/0.34 ≈ 294% 放大再左上對齊，裁出來正好是半身像。
   比 <img> + object-position 可控：不依賴瀏覽器怎麼 cover。 */
.rost-thumb{display:block;width:76px;height:76px;border:1px solid var(--rule-2);border-radius:6px;
  background:#fff no-repeat left top;background-size:294% auto}
.rost-body{min-width:0}
.rost-top{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
.rost-n{font:500 10px/1 var(--mono);color:var(--ink-3);font-style:normal}
.rost-name{font:400 17px/1.2 var(--serif);letter-spacing:.03em}
.rost-meta{font-size:11px;color:var(--ink-3)}
.rost-one{display:block;margin-top:5px;font-size:12.5px;line-height:1.65;color:var(--ink-2)}
.rost-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.rost-chips i{font-style:normal;font-size:11px;padding:1px 6px;border:1px solid var(--rule-2);
  border-radius:2px;color:var(--ink-2);background:var(--paper)}
.side-foot{padding:14px 20px 28px;font-size:11px;line-height:1.7;color:var(--ink-3)}
.badge{font-size:11px;padding:1px 7px;border:1px solid var(--rule-2);border-radius:2px;color:var(--ink-2)}
.rost.on .badge,.char-h .badge{border-color:var(--seal);color:var(--seal)}

/* ---------- 主區 ---------- */
.main{padding:26px 28px 72px;min-width:0;max-width:1500px}
.char{display:none}
.char.on{display:block}
.char-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:1px solid var(--rule-2)}
.char-n{font:500 13px/1 var(--mono);color:var(--seal)}
.char-h h2{font:400 clamp(24px,2.4vw,30px)/1.1 var(--serif);letter-spacing:.05em}
.aka{font-size:12px;color:var(--ink-3)}
.char-one{margin-left:auto;font:400 14px/1.7 var(--serif);color:var(--ink-2);text-align:right;max-width:44ch}
@media(max-width:900px){.char-one{margin-left:0;text-align:left}}

.upper{display:grid;grid-template-columns:minmax(0,1fr) 500px;gap:26px;align-items:start;margin-top:20px}
@media(max-width:1240px){.upper{grid-template-columns:1fr}}

/* 設定圖是白底印張 */
.plate-wrap{position:relative;margin:0}
.plate{display:block;width:100%;padding:0;background:#fff;border:1px solid var(--rule-2);
  border-radius:2px;overflow:hidden;cursor:zoom-in}
.plate img{display:block;width:100%;height:auto}
.plate:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
/* 右下角浮在圖上，hover 才明顯——別擋住畫面 */
.copy-img{position:absolute;right:10px;bottom:10px;font:500 11px/1 var(--sans);color:var(--ink-2);
  background:var(--paper);border:1px solid var(--rule-2);border-radius:3px;padding:6px 10px;
  cursor:pointer;opacity:.55;transition:.15s}
.plate-wrap:hover .copy-img{opacity:1}
.copy-img:hover{border-color:var(--seal);color:var(--seal)}
.copy-img:focus-visible{opacity:1;outline:2px solid var(--seal);outline-offset:2px}
.copy-img[data-done]{border-color:var(--seal);color:var(--seal);opacity:1}

/* 彈層 */
.lightbox{position:fixed;inset:0;z-index:50;display:none;place-items:center;
  background:#191d21e6;padding:32px;cursor:zoom-out}
.lightbox.on{display:grid}
.lightbox img{max-width:100%;max-height:100%;background:#fff;border-radius:2px;
  box-shadow:0 8px 40px #0006}
.lightbox-x{position:absolute;top:18px;right:22px;font:500 13px/1 var(--sans);color:#fff;
  background:none;border:1px solid #fff6;border-radius:3px;padding:8px 12px;cursor:pointer}
.lightbox-x:hover{border-color:#fff}
.plate-empty{display:grid;place-items:center;min-height:220px;text-align:center;
  border:1px dashed var(--rule-2);background:var(--panel);color:var(--ink-3);font-size:13px}
.plate-empty em{font-style:normal;font-size:12px;opacity:.8}
.plate-c{margin:7px 0 0;font-size:11px;letter-spacing:.1em;color:var(--ink-3)}

.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 30px;margin-top:24px}
@media(max-width:700px){.grid2{grid-template-columns:1fr}}
.blk{margin-bottom:20px}
.blk h3{font:500 11px/1 var(--sans);letter-spacing:.2em;color:var(--seal);margin-bottom:7px}
.blk p{margin:0;font-size:13.5px;line-height:1.85}

/* 原文：襯線體，鐵鏽紅邊欄。這裡是書自己在說話 */
.source .quotes{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px}
@media(max-width:700px){.source .quotes{grid-template-columns:1fr}}
.source blockquote{margin:0;padding-left:13px;border-left:2px solid var(--seal);
  font:400 13.5px/1.85 var(--serif)}

/* ---------- 右側資訊卡 ---------- */
.side-cards{display:flex;flex-direction:column;gap:14px}
.card{border:1px solid var(--rule);border-radius:2px;background:var(--panel);padding:14px 16px}
.card h4{font:500 11px/1 var(--sans);letter-spacing:.2em;color:var(--ink-3);margin-bottom:10px;
  display:flex;align-items:center;gap:8px}
.tag-en{font:500 9px/1 var(--mono);letter-spacing:.22em;color:var(--rule-2);font-style:normal}
.card dl{margin:0}
.kv{display:flex;gap:12px;padding:2.5px 0;font-size:13px}
.kv dt{color:var(--ink-3);flex:none;width:46px}
.kv dd{margin:0;min-width:0}
.rel-n{color:var(--ink)!important;width:auto!important;min-width:46px}
.style{margin:0;font-size:12.5px;line-height:1.7;color:var(--ink-2)}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 0;padding:0;list-style:none}
.tags li{font:400 11px/1.5 var(--mono);color:var(--ink-2);border:1px solid var(--rule-2);
  background:var(--paper);border-radius:2px;padding:1px 6px}

/* ---------- 提示詞 ---------- */
.prompts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px}
@media(max-width:900px){.prompts{grid-template-columns:1fr}}
.pgroup{border:1px solid var(--rule);border-radius:2px;background:var(--panel);padding:6px 14px 10px}
.pr{border-bottom:1px solid var(--rule)}
.pgroup .pr:last-of-type{border-bottom:0}
.pr summary{display:flex;align-items:center;gap:10px;padding:11px 0;cursor:pointer;list-style:none;
  font:500 12px/1 var(--sans);letter-spacing:.04em}
.pr summary::-webkit-details-marker{display:none}
.pr summary::before{content:"▸";color:var(--seal);font-size:11px;transition:transform .15s}
.pr[open] summary::before{transform:rotate(90deg)}
.pr summary span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr p{margin:0 0 12px;padding:11px 12px;background:var(--paper);border:1px solid var(--rule);
  border-radius:2px;font:400 12px/1.75 var(--mono);white-space:pre-wrap;word-break:break-word}
.pgroup-f{padding:12px 0 4px}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.wide{width:100%;padding:9px}

/* ---------- 關係圖譜 ---------- */
/* 佈局在 Node 裡算好寫進 SVG，這裡只管高亮。紅色仍然只給選中態 */
.gtoggle{display:flex;align-items:center;gap:9px;width:100%;padding:13px 20px;text-align:left;
  background:none;border:0;border-bottom:1px solid var(--rule);border-left:2px solid transparent;
  cursor:pointer;color:var(--ink-2);font:500 12px/1 var(--sans);letter-spacing:.1em}
.gtoggle:hover{background:#00000006}
.gtoggle.on{background:var(--panel);border-left-color:var(--seal);color:var(--seal)}
.gtoggle:focus-visible{outline:2px solid var(--seal);outline-offset:-2px}
.gtoggle svg{width:15px;height:15px;flex:none;stroke:currentColor;fill:none;stroke-width:1.3}
.graph{display:none}
.graph.on{display:block}
.main.gmode .char{display:none}
.graph-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:1px solid var(--rule-2)}
.graph-h h2{font:400 clamp(22px,2.2vw,28px)/1.1 var(--serif);letter-spacing:.05em}
.graph-h .hint{margin-left:auto;font-size:12px;color:var(--ink-3)}
.graph-body{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:26px;
  align-items:start;margin-top:20px}
@media(max-width:1100px){.graph-body{grid-template-columns:1fr}}
.graph-canvas{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:10px}
.graph-canvas svg{display:block;width:100%;height:auto}
.graph-empty{margin:0 0 8px;text-align:center;font-size:12.5px;color:var(--ink-3)}
.gedge{fill:none;stroke:var(--rule-2);stroke-width:1.1;transition:.15s}
.gedge.hot{stroke:var(--seal);stroke-width:2}
.gedge.dim{opacity:.15}
.gnode{cursor:pointer;transition:.15s}
.gnode .gdot{fill:var(--paper);stroke:var(--ink-2);stroke-width:1.5}
/* 看不見的命中區：節點本身才十來個畫素，游標很難壓準。
   單獨一個類，免得被下面 .lead / .hot 的規則一起染色 */
.gnode .ghit{fill:none;stroke:none;pointer-events:all}
.gnode text{font:400 13px var(--serif);fill:var(--ink)}
.gnode.lead .gdot{fill:var(--seal);stroke:var(--seal)}
.gnode.hot .gdot{stroke:var(--seal);stroke-width:2.5}
.gnode.hot text{fill:var(--seal)}
.gnode.dim{opacity:.22}
.gnode:focus-visible{outline:2px solid var(--seal)}
/* 弦上的關係文字。預設按邊數決定開不開，懸停的那條永遠顯示。
   paint-order + 同色描邊 = 給字加一圈底襯，壓在弦上也讀得清 */
.glabel{display:none;font:400 9px var(--sans);fill:var(--ink-3);pointer-events:none;
  paint-order:stroke;stroke:var(--panel);stroke-width:3px;stroke-linejoin:round}
.graph.labels .glabel{display:block}
.glabel.dim{opacity:.15}
.glabel.hot{display:block;fill:var(--seal);font-weight:500}
.glabtoggle{font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.glabtoggle:hover{border-color:var(--seal);color:var(--seal)}
.glabtoggle.on{border-color:var(--seal);color:var(--seal);background:var(--seal-soft)}
.glabtoggle:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.grel{border:1px solid var(--rule);border-radius:2px;background:var(--panel)}
.grel h4{font:500 11px/1 var(--sans);letter-spacing:.2em;color:var(--ink-3);padding:14px 16px 11px}
.grel-list{max-height:56vh;overflow-y:auto;border-top:1px solid var(--rule)}
.grow{display:block;width:100%;text-align:left;padding:11px 16px;background:none;border:0;
  border-bottom:1px solid var(--rule);cursor:pointer;color:inherit;transition:.15s}
.grow:last-child{border-bottom:0}
.grow:hover,.grow.hot{background:var(--seal-soft)}
.grow.dim{opacity:.3}
.grow:focus-visible{outline:2px solid var(--seal);outline-offset:-2px}
.grow b{font:400 14px/1.4 var(--serif);letter-spacing:.03em}
.grow i{font-style:normal;color:var(--ink-3);padding:0 6px}
.grow span{display:block;margin-top:4px;font-size:12.5px;line-height:1.65;color:var(--ink-2)}
.grow em{font-style:normal;color:var(--ink-3)}
.grel-foot{margin:0;padding:11px 16px;border-top:1px solid var(--rule);
  font-size:11px;line-height:1.6;color:var(--ink-3)}

/* 簽名：推斷標記 */
.inf{color:var(--ink-3);font-size:.88em;background:var(--seal-soft);padding:0 3px;border-radius:2px}

.nomatch{display:none;padding:20px;font-size:13px;color:var(--ink-3)}
.nomatch.on{display:block}

@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

/* 螢幕上一次一個角色，紙上要完整 */
@media print{
  .top,.side,.copy{display:none!important}
  .shell{display:block}
  .main{padding:0}
  .graph{display:block!important;page-break-after:always}
  .char{display:block!important;page-break-after:always}
  .pr p{display:block!important}
  .pr summary::before{content:""}
  body{background:#fff}
}
</style></head><body>

<header class="top">
  <div class="brand"><h1>${esc(source)}</h1></div>
  <div class="search">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke-width="1.5"/><path d="M11 11l4 4" stroke-width="1.5"/></svg>
    <input id="q" type="search" placeholder="${esc(t.searchPlaceholder)}" aria-label="${esc(t.searchPlaceholder)}" autocomplete="off">
  </div>
  <div class="topmeta">
    <span>${esc(t.kicker)}</span><i>·</i>
    <span>${esc(t.counts(characters.length, shots))}</span>
    <button class="expo" data-name="${esc(slug(source))}-cast.json">${esc(t.exportJson)}</button>
  </div>
</header>

<div class="shell">
  <aside class="side">
    ${summary ? `<section class="synopsis syn-clamp"><div class="lbl">${esc(t.synopsis)}</div><p>${marked(summary)}</p><button class="syn-more">${esc(t.expandAll)}</button></section>` : ''}
    <button class="gtoggle" aria-controls="graph">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.2" cy="4" r="1.9"/><circle cx="12.8" cy="6.2" r="1.9"/><circle cx="7.2" cy="13" r="1.9"/><path d="M5 4.6l6 1.2M4 5.9l2.5 5.4M11.7 7.9l-3.3 3.7"/></svg>
      <span>${esc(t.graphTitle)}</span>
    </button>
    <div class="roster-h lbl">${esc(t.rosterTitle)}</div>
    <nav class="roster" aria-label="${esc(t.indexLabel)}">
      ${ordered.map((c, i) => renderRosterItem(c, i, t)).join('\n')}
    </nav>
    <p class="nomatch">${esc(t.noMatch)}</p>
    <p class="side-foot">${esc(t.footnote)}</p>
  </aside>

  <main class="main">
    ${renderGraph(ordered, t)}
    ${ordered.map((c, i) => renderCharacter(c, i, t)).join('\n')}
  </main>
</div>

<div class="lightbox" role="dialog" aria-modal="true">
  <button class="lightbox-x" aria-label="${esc(t.closeImage)}">${esc(t.closeImage)}</button>
  <img alt="">
</div>

<script type="application/json" id="cast-data">${embedCast(characters, source, summary, lang, ui, style)}</script>

<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed })};

// 匯出：報告自己就帶著完整的 cast.json，下載的是它原樣
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('cast-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // 別在 click 之後立刻回收——Safari 上會搶在下載讀完之前把 blob 撤掉，存出來是空檔案
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// 左欄切換：一次只顯示一個角色
document.querySelector('.roster').addEventListener('click', (e) => {
  const btn = e.target.closest('.rost');
  if (!btn) return;
  document.querySelectorAll('.rost').forEach((b) => b.classList.toggle('on', b === btn));
  document.querySelectorAll('.char').forEach((a) => a.classList.toggle('on', a.id === btn.dataset.target));
  showGraph(false);
  document.querySelector('.main').scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// 關係圖譜：一張全景檢視，跟角色詳情互斥
const gv = document.querySelector('.graph');
const gbtn = document.querySelector('.gtoggle');
function showGraph(on) {
  gv.classList.toggle('on', on);
  gbtn.classList.toggle('on', on);
  document.querySelector('.main').classList.toggle('gmode', on);
}
gbtn.addEventListener('click', () => {
  showGraph(true);
  document.querySelector('.main').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
{
  // 弦和絃上的文字共用 data-a/data-b，高亮邏輯完全一樣，放一個陣列裡
  const edges = [...gv.querySelectorAll('.gedge, .glabel')];
  const nodes = [...gv.querySelectorAll('.gnode')];
  const rows = [...gv.querySelectorAll('.grow')];
  const clear = () => [...edges, ...nodes, ...rows].forEach((el) => el.classList.remove('hot', 'dim'));

  // 懸停一個人：他的關係線亮起來，沒關係的壓到背景裡
  const byNode = (name) => {
    const near = new Set([name]);
    for (const e of edges) {
      if (e.dataset.a === name) near.add(e.dataset.b);
      if (e.dataset.b === name) near.add(e.dataset.a);
    }
    for (const e of edges) {
      const hot = e.dataset.a === name || e.dataset.b === name;
      e.classList.toggle('hot', hot);
      e.classList.toggle('dim', !hot);
    }
    for (const nd of nodes) {
      nd.classList.toggle('hot', nd.dataset.node === name);
      nd.classList.toggle('dim', !near.has(nd.dataset.node));
    }
    for (const r of rows) {
      const hot = r.dataset.a === name || r.dataset.b === name;
      r.classList.toggle('hot', hot);
      r.classList.toggle('dim', !hot);
    }
  };

  // 懸停關係表的一行：只亮那一條弦
  const byEdge = (a, b) => {
    for (const e of edges) {
      const hot = e.dataset.a === a && e.dataset.b === b;
      e.classList.toggle('hot', hot);
      e.classList.toggle('dim', !hot);
    }
    for (const nd of nodes) {
      const hot = nd.dataset.node === a || nd.dataset.node === b;
      nd.classList.toggle('hot', hot);
      nd.classList.toggle('dim', !hot);
    }
    for (const r of rows) {
      const hot = r.dataset.a === a && r.dataset.b === b;
      r.classList.toggle('hot', hot);
      r.classList.toggle('dim', !hot);
    }
  };

  const jump = (el) => {
    const item = document.querySelector('.rost[data-target="' + el.dataset.target + '"]');
    if (item) item.click();
  };

  // 關係文字的總開關：人多的時候標籤會蓋住圖，一鍵收起
  const glab = gv.querySelector('.glabtoggle');
  glab.addEventListener('click', () => {
    const on = !gv.classList.contains('labels');
    gv.classList.toggle('labels', on);
    glab.classList.toggle('on', on);
    glab.setAttribute('aria-pressed', String(on));
  });

  gv.addEventListener('mouseover', (e) => {
    const nd = e.target.closest('.gnode');
    const row = e.target.closest('.grow');
    if (nd) byNode(nd.dataset.node);
    else if (row) byEdge(row.dataset.a, row.dataset.b);
    else clear();
  });
  gv.addEventListener('mouseleave', clear);
  gv.addEventListener('focusin', (e) => {
    const nd = e.target.closest('.gnode');
    if (nd) byNode(nd.dataset.node);
  });
  gv.addEventListener('click', (e) => {
    const hit = e.target.closest('.gnode, .grow');
    if (hit) jump(hit);
  });
  // SVG 的 <g> 不是原生按鈕，回車/空格要自己接
  gv.addEventListener('keydown', (e) => {
    const nd = e.target.closest('.gnode');
    if (!nd || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    jump(nd);
  });
}

// 搜尋：過濾左欄；結果只剩一個就直接切過去
document.getElementById('q').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  let hits = [];
  document.querySelectorAll('.rost').forEach((b) => {
    const hit = !q || b.dataset.hay.toLowerCase().includes(q);
    b.style.display = hit ? '' : 'none';
    if (hit) hits.push(b);
  });
  document.querySelector('.nomatch').classList.toggle('on', hits.length === 0);
  if (q && hits.length === 1) hits[0].click();
});

// 摘要預設三行，點一下展開全部；短到不需要摺疊的就直接去掉摺疊態
const syn = document.querySelector('.synopsis');
if (syn) {
  const body = syn.querySelector('p');
  if (body.scrollHeight <= body.clientHeight + 1) syn.classList.remove('syn-clamp');
  syn.addEventListener('click', () => syn.classList.remove('syn-clamp'));
}

// 圖片彈層
const lb = document.querySelector('.lightbox');
const lbImg = lb.querySelector('img');
function closeLb() { lb.classList.remove('on'); lbImg.removeAttribute('src'); }
document.addEventListener('click', (e) => {
  const z = e.target.closest('.zoom');
  if (z) { lbImg.src = z.dataset.src; lb.classList.add('on'); return; }
  if (e.target.closest('.lightbox')) closeLb();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

// 複製圖片本身到剪貼簿（不是路徑）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-img');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const label = btn.textContent;
  try {
    const blob = await (await fetch(btn.dataset.img)).blob();
    // Safari 只認 image/png，其它格式先過一遍 canvas
    let png = blob;
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const cv = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      cv.getContext('2d').drawImage(bmp, 0, 0);
      png = await new Promise((r) => cv.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    btn.textContent = L.copied;
    btn.dataset.done = '1';
  } catch {
    btn.textContent = L.failed;
  }
  setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1600);
});

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
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-characters.mjs — novel-characters skill 的確定性工具

  seed <outline.json>              從大綱預填角色表骨架（列印到 stdout，畫像與提示詞留空待填）
  chunk <book.txt> <workdir>       段落感知重疊切塊，寫 chunk-NN.txt，列印塊數
  merge <workdir>                  歸併 roster-*.json，列印 {characters, mergeCandidates}
        [--apply merges.json]      落地複核後的合併決定：{"merges":[{"keep":…,"absorb":[…]}]}
  assemble <workdir> --source <書名>
        [--lang] [--style] [--out] 把 card-*.json + summary.txt（+ ui.json）合成 cast.json
        [--order merged.json]      同檔角色的戲份順序（預設自動找 <workdir>/merged.json）
  validate <cast.json> <book.txt>  校驗；有違規逐條列印並 exit 1
  render <cast.json> [--html|--md] 渲染報告到 stdout（預設 --md）
  slug <name>                      角色名轉安全檔名
  ui-template [lang]               列印介面文案骨架，供翻譯成內建表沒有的語言
  styles [id]                      列印畫風預設的完整內容

通用選項：
  --lang <code>     報告語言，預設取 cast.json 的 lang，再預設 ${DEFAULT_LANG}
                    內建介面文案：${SUPPORTED_UI_LANGS.join(' / ')}；其他語言碼用英文介面骨架

render 選項：
  --source <name>   報告標題用的書名（預設取 cast.json 的 source 或檔名）
  --images <dir>    圖片目錄名，預設 images
                    會去找 <dir>/<slug>-sheet.png`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

/** 取 --flag 的值，沒有就返回 fallback。 */
function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

/** cast.json 可以是 {source, lang, summary, characters}，也可以是裸陣列（舊格式）。 */
function loadCast(path) {
  const raw = readJson(path);
  const characters = Array.isArray(raw) ? raw : raw.characters;
  if (!Array.isArray(characters)) throw new Error(`${path} 裡沒有 characters 陣列`);
  return {
    characters,
    source: Array.isArray(raw) ? null : raw.source,
    summary: Array.isArray(raw) ? '' : (raw.summary ?? ''),
    lang: Array.isArray(raw) ? DEFAULT_LANG : (raw.lang ?? DEFAULT_LANG),
    ui: Array.isArray(raw) ? null : (raw.ui ?? null),
    style: Array.isArray(raw) ? DEFAULT_STYLE : (raw.style ?? DEFAULT_STYLE),
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
    if (!path) throw new Error('用法：seed <outline.json>');
    console.log(JSON.stringify(seedFromOutline(readJson(path)), null, 2));
    return;
  }

  if (cmd === 'chunk') {
    const [book, workdir] = rest;
    if (!book || !workdir) throw new Error('用法：chunk <book.txt> <workdir>');
    const text = readFileSync(resolve(book), 'utf8');
    const chunks = chunkText(text);
    mkdirSync(resolve(workdir), { recursive: true });
    chunks.forEach((c, i) => {
      writeFileSync(join(resolve(workdir), `chunk-${String(i).padStart(2, '0')}.txt`), c, 'utf8');
    });
    const truncated = chunks.length >= MAX_CHUNKS && text.length > CHUNK_SIZE * MAX_CHUNKS;
    console.log(
      JSON.stringify(
        { chunks: chunks.length, chars: text.length, workdir: resolve(workdir), truncated },
        null,
        2,
      ),
    );
    if (truncated) console.error(`⚠️ 文字超過 ${MAX_CHUNKS} 塊上限，尾部未掃描`);
    return;
  }

  if (cmd === 'merge') {
    const [workdir] = rest;
    if (!workdir || workdir.startsWith('--')) throw new Error('用法：merge <workdir> [--apply merges.json]');
    const dir = resolve(workdir);
    const files = readdirSync(dir).filter((f) => /^roster-.*\.json$/.test(f)).sort();
    if (!files.length) throw new Error(`${dir} 裡沒有 roster-*.json`);
    const batches = files.map((f) => {
      const raw = readJson(join(dir, f));
      return Array.isArray(raw) ? raw : (raw.characters ?? []);
    });
    let cast = mergeRoster(batches);
    const applyPath = flag(rest, '--apply');
    if (applyPath) {
      const raw = readJson(applyPath);
      cast = applyMerges(cast, Array.isArray(raw) ? raw : (raw.merges ?? []));
    }
    // mergeCandidates 是嫌疑名單不是判決：由呼叫方複核後寫 merges.json 再 --apply
    console.log(JSON.stringify({ characters: cast, mergeCandidates: mergeCandidates(cast) }, null, 2));
    return;
  }

  if (cmd === 'assemble') {
    const [workdir] = rest;
    if (!workdir || workdir.startsWith('--')) {
      throw new Error('用法：assemble <workdir> --source <書名> [--lang zh] [--style realistic] [--out cast.json]');
    }
    const dir = resolve(workdir);
    const sourceName = flag(rest, '--source');
    if (!sourceName) throw new Error('assemble 需要 --source <書名>');
    const lang = flag(rest, '--lang', DEFAULT_LANG);
    const style = flag(rest, '--style', DEFAULT_STYLE);

    const files = readdirSync(dir).filter((f) => /^card-.*\.json$/.test(f)).sort();
    if (!files.length) throw new Error(`${dir} 裡沒有 card-*.json`);

    // 寬容解析：一份壞卡不廢整批——逐個點名，重跑壞的那個角色就行
    const problems = [];
    const cards = [];
    const seen = new Map();
    for (const f of files) {
      let card;
      try {
        card = readJson(join(dir, f));
      } catch (error) {
        problems.push(`${f} 不是合法 JSON（${error.message}）——重跑這個角色即可`);
        continue;
      }
      if (!card || typeof card !== 'object' || Array.isArray(card) || !card.name) {
        problems.push(`${f} 不是單張角色卡（缺 name）——重跑這個角色即可`);
        continue;
      }
      if (seen.has(card.name)) {
        problems.push(`「${card.name}」有兩份卡（${seen.get(card.name)} 和 ${f}），刪掉多餘的那份`);
        continue;
      }
      seen.set(card.name, f);
      cards.push(card);
    }

    const summaryPath = join(dir, 'summary.txt');
    const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8').trim() : '';
    if (!summary) problems.push(`缺 ${summaryPath}（故事摘要）——用報告語言寫 3–5 句進去`);

    const uiPath = join(dir, 'ui.json');
    const ui = existsSync(uiPath) ? readJson(uiPath) : null;
    if (needsUiTranslation(lang) && !ui) {
      problems.push(`lang=${lang} 不在內建介面語言裡，缺 ${uiPath}——用 ui-template 生成骨架翻譯後放進去`);
    }

    // 同檔角色的戲份順序來自 merge 的輸出——卡按檔名讀入是 slug 字典序，
    // 不給順序的話「按戲份排序」就名存實亡
    const orderPath = flag(rest, '--order', existsSync(join(dir, 'merged.json')) ? join(dir, 'merged.json') : null);
    let order = null;
    if (orderPath) {
      const raw = readJson(orderPath);
      const list = Array.isArray(raw) ? raw : (raw.characters ?? []);
      order = list.map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
    } else {
      console.error(`⚠️ 沒有 --order 也沒有 ${join(dir, 'merged.json')}，同檔角色將按檔名序而不是戲份序`);
    }

    if (problems.length) {
      console.error(`✗ ${problems.length} 處問題：\n`);
      for (const p of problems) console.error('  ' + p);
      process.exit(1);
    }

    const cast = assembleCast(cards, { source: sourceName, lang, style, summary, ui, order });
    const json = JSON.stringify(cast, null, 2) + '\n';
    const out = flag(rest, '--out');
    if (out) {
      writeFileSync(resolve(out), json, 'utf8');
      console.log(`✓ ${cast.characters.length} 個角色 → ${resolve(out)}`);
    } else {
      process.stdout.write(json);
    }
    return;
  }

  if (cmd === 'validate') {
    const [castPath, bookPath] = rest;
    if (!castPath) throw new Error('用法：validate <cast.json> <book.txt>');
    const { characters, summary, lang: castLang, ui, style: castStyle } = loadCast(castPath);
    const lang = flag(rest, '--lang', castLang);
    const style = flag(rest, '--style', castStyle);
    const source = bookPath ? readFileSync(resolve(bookPath), 'utf8') : null;
    if (!bookPath) console.error('⚠️ 沒給原文，跳過逐字引文校驗');
    const problems = validateCast(characters, source, lang, style);
    if (!SUPPORTED_STYLES.includes(style)) {
      problems.unshift(`頂層 style=${style} 不是已知預設（${SUPPORTED_STYLES.join('/')}）`);
    }
    // 頂層的故事摘要——報告要用，缺了就沒法在頂部交代背景
    if (typeof summary !== 'string' || !summary.trim()) {
      problems.unshift('頂層缺少 summary（故事摘要），報告頂部會空著');
    }
    // 內建表沒有這個語言，又沒給 ui 翻譯 —— 報告介面會露出英文
    if (needsUiTranslation(lang) && !ui) {
      problems.unshift(
        `lang=${lang} 不在內建介面語言（${SUPPORTED_UI_LANGS.join('/')}）裡，` +
          '頂層需要一份 ui 翻譯，否則介面文案會是英文。' +
          '用 `ui-template` 生成骨架後翻譯填進去。',
      );
    }
    if (problems.length) {
      console.error(`✗ ${problems.length} 處違規：\n`);
      for (const p of problems) console.error('  ' + p);
      process.exit(1);
    }
    console.log(`✓ ${characters.length} 個角色全部透過校驗（lang=${lang}, style=${style}）`);
    return;
  }

  if (cmd === 'render') {
    const [castPath] = rest;
    if (!castPath) throw new Error('用法：render <cast.json> [--html|--md]');
    const html = rest.includes('--html');
    const imagesDir = flag(rest, '--images', 'images');
    const sourceFlag = flag(rest, '--source');

    const { characters, source, summary, lang: castLang, ui, style } = loadCast(castPath);
    const lang = flag(rest, '--lang', castLang);
    const title = sourceFlag ?? source ?? basename(castPath).replace(/\.[^.]+$/, '');

    // 圖存在才掛上去；沒有就渲染成佔位，不影響其餘內容。
    const outDir = resolve(castPath, '..');
    for (const c of characters) {
      const stem = `${imagesDir}/${slug(c.name)}`;
      if (existsSync(join(outDir, `${stem}-sheet.png`))) c.sheetImage = `${stem}-sheet.png`;
    }

    process.stdout.write(
      (html
        ? renderHtml(characters, title, summary, lang, ui, style)
        : renderMarkdown(characters, title, summary, lang, ui)) + '\n',
    );
    return;
  }

  if (cmd === 'ui-template') {
    const lang = rest[0] ?? '<lang>';
    console.log(
      JSON.stringify(
        { note: `把下面每個值翻譯成 ${lang}，整塊放進 cast.json 的頂層 "ui"`, ui: uiTemplate() },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'styles') {
    const only = rest[0];
    if (only && !SUPPORTED_STYLES.includes(only)) {
      throw new Error(`未知風格 ${only}（可用：${SUPPORTED_STYLES.join('/')}）`);
    }
    const ids = only ? [only] : SUPPORTED_STYLES;
    console.log(
      JSON.stringify(
        {
          default: DEFAULT_STYLE,
          note: '整塊取用，不要混搭；各預設的 negative 立場相反，realistic／photoreal 絕不能禁 photorealistic，ghibli 必須禁，photoreal 另外要禁 illustration／painting／anime',
          presets: Object.fromEntries(ids.map((id) => [id, STYLE_PRESETS[id]])),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'slug') {
    if (!rest[0]) throw new Error('用法：slug <name>');
    console.log(slug(rest[0]));
    return;
  }

  throw new Error(`未知命令 ${cmd}\n\n${USAGE}`);
}

// 只有直接執行才跑 CLI —— selftest.mjs 需要 import 這些函式。
// 兩邊都取 realpath：軟鏈安裝時 argv[1] 是連結路徑，而 import.meta.url
// 已被 Node 解析成真實路徑，不歸一化就永遠不相等。
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
