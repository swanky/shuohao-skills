#!/usr/bin/env node
// novel-art — deterministic helpers for the novel-art skill (場景 + 道具).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 畫風預設（環境版）                                                    */
/* ------------------------------------------------------------------ */
/*
 * 與 novel-characters 的兩檔畫風同名對齊（realistic / ghibli），
 * 但內容是環境的表面處理，不是皮膚毛孔——把角色那套帶進環境是錯的。
 * 換風格是整套換：render / surface / negative / tags 整塊取用，不混搭。
 *
 * 最容易踩的坑與角色 skill 相同：realistic 絕不能禁 photorealistic，
 * ghibli 必須禁。validate 會攔。
 */

export const DEFAULT_STYLE = 'realistic';

export const SCENE_STYLE_PRESETS = {
  realistic: {
    label: '半寫實厚塗',
    render:
      'Semi-realistic environment concept art, painterly rendering with visible brush texture, grounded architectural perspective, cinematic depth',
    surface:
      'Weathered, lived-in materials: chipped paint, water stains, patina on metal, worn wood grain, dust in corners and light shafts; fabric and paper props show creases and age; nothing looks factory-new. Atmospheric depth with haze or volumetric light where the space allows',
    // 這裡絕不能禁 photorealistic——一邊要真實感一邊禁真實感是自相矛盾的
    negative:
      'people, human figures, characters, crowds, silhouettes of people, plastic CG look, oversaturated colours, sterile showroom cleanliness, warped perspective, melted geometry, floating objects, text, watermark, signature',
    tags: ['semi-realistic', 'environment sheet', 'painterly', 'weathered materials', 'cinematic'],
  },

  ghibli: {
    label: '吉卜力動畫',
    render:
      'Hand-painted anime background art in the manner of classic Studio Ghibli films: soft watercolour-and-gouache rendering, clean readable shapes, warm naturalistic palette, gentle painterly edges',
    surface:
      'Simplified but affectionate detail: flat colour planes with soft gradations, foliage and clutter grouped into readable clumps, warm light pooling on surfaces; textures suggested with a few brush strokes rather than rendered out; no photographic micro-detail',
    // 這裡反過來，必須禁寫實
    negative:
      'people, human figures, characters, crowds, photorealistic, 3d render, hyperrealistic texture, harsh contrast, gritty grime, lens effects, text, watermark, signature',
    tags: ['ghibli-like', 'background art', 'watercolour', 'environment sheet', 'warm palette'],
  },
};

export const SUPPORTED_STYLES = Object.keys(SCENE_STYLE_PRESETS);
export const scenePreset = (id) => SCENE_STYLE_PRESETS[id] ?? SCENE_STYLE_PRESETS[DEFAULT_STYLE];

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'scene';
}

/* ------------------------------------------------------------------ */
/* seed — 從 outline.json 確定性預填骨架                                 */
/* ------------------------------------------------------------------ */
/*
 * 場景清單、主場景標記、出現集、承載爽點、複用方案在 outline.json 裡
 * 都是現成的——這些不該讓模型重新想一遍。seed 把它們搬進骨架，
 * 模型只填設計欄位（設計意圖 / 錨點 / 光照 / 提示詞）。
 */

export function seedFromOutline(outline) {
  const eps = Array.isArray(outline?.episodes) ? outline.episodes : [];
  const beats = Array.isArray(outline?.beats) ? outline.beats : [];

  const scenes = (outline?.scenes ?? []).map((s) => {
    const episodes = eps.filter((e) => (e?.sceneIds ?? []).includes(s.id)).map((e) => e.ep);
    const epSet = new Set(episodes);
    const carried = [...new Set(beats.filter((b) => epSet.has(b.episode)).map((b) => b.type))];
    return {
      id: s.id,
      name: s.name,
      primary: !!s.primary,
      // 模型要填的設計欄位，先佔位
      summary: '',
      anchors: [],
      lighting: [],
      image: { prompt: '', negativePrompt: '', sheet: '', tags: [] },
      // 從 outline 搬來的事實，不用再想
      ...(s.reusePlan ? { seedNote: `outline 的複用方案：${s.reusePlan}——考慮做成某個主場景的變體（variantOf + changes）` } : {}),
      usage: { episodes, beats: carried },
    };
  });

  // 道具：大綱從 1.1.0 起帶 props（id / name / function / beatIds），有就預填。
  // 搬過來的是改編階段拍板的事實——哪幾件物件承載劇情、各自承載什麼、托起哪幾個
  // 爽點、在哪幾集出現。留空的是美術層的活：尺度、錨點、狀態變體、白底提示詞。
  // 大綱沒有 props 欄位就返回空陣列，模型照 prop-pass.md 從原文提取，跟以前一樣。
  const beatType = new Map((outline?.beats ?? []).map((b) => [b?.id, b?.type]));
  const props = (outline?.props ?? []).map((pr) => {
    const episodes = eps.filter((e) => (e?.propIds ?? []).includes(pr.id)).map((e) => e.ep);
    return {
      id: pr.id,
      name: pr.name,
      // 大綱的 function 就是這裡的 summary：兩邊都指「它在戲裡幹什麼」，不是材質描述
      summary: pr.function ?? '',
      // 模型要填的設計欄位，先佔位
      scale: '',
      anchors: [],
      states: [],
      relatedScenes: [],
      carriedBy: [],
      image: { prompt: '', negativePrompt: '', sheet: '', tags: [] },
      // 從 outline 搬來的事實，不用再想
      usage: { episodes, beats: (pr.beatIds ?? []).map((id) => beatType.get(id)).filter(Boolean) },
    };
  });

  return { source: outline?.source ?? '', style: DEFAULT_STYLE, scenes, props };
}

/* ------------------------------------------------------------------ */
/* 品質門                                                               */
/* ------------------------------------------------------------------ */
/*
 * 與另外兩個 skill 同一主張：checklist 是程式碼，不是給模型讀的文字。
 * AI 短劇環境資產的硬規則都在這——空景、錨點、光照狀態、
 * 提示詞語言、風格與反向詞匹配、變體引用完整。
 */

const thText = (s) => typeof s === 'string' && s.trim();
/** 中日韓表意文字與假名、諺文——生圖提示詞裡出現就說明串語言了。 */
const CJK = /[㐀-鿿぀-ヿ가-힯]/;
/** 環境參考圖必須空景：負向提示詞裡必須把「人」禁掉。 */
const PEOPLE_BAN = /people|human|figure|character|crowd/i;

export const ANCHOR_RANGE = [3, 5];

/*
 * 道具尺度參照：AI 經常把手持道具畫成傢俱尺寸——實拍不存在的坑。
 * scale 是中文列舉，生圖提示詞裡必須出現對應的英文短語，validate 會對著查。
 */
export const PROP_SCALES = {
  手持級: 'handheld scale',
  桌面級: 'tabletop scale',
  傢俱級: 'furniture scale',
};
/** 道具參考圖不許有手——拿著道具的手是最常見的汙染。 */
const HANDS_BAN = /hand|finger/i;

export function gateReport(doc, castNames = null) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const scenes = Array.isArray(doc?.scenes) ? doc.scenes : [];
  const props = Array.isArray(doc?.props) ? doc.props : [];
  const bad = {
    anchors: [], lighting: [], people: [], english: [], names: [], variant: [], style: [],
    states: [], scale: [], hands: [], whitebg: [],
  };
  const ids = new Set(scenes.map((s) => s?.id));
  const style = doc?.style ?? DEFAULT_STYLE;
  const preset = scenePreset(style);

  // 場景與道具共用的門：錨點 / 空景 / 英文 / 角色名 / 風格匹配
  for (const s of [...scenes, ...props]) {
    const label = s?.name ?? s?.id ?? '(無名)';

    // 錨點 3–5：少了認不出場景，多了 QC 核對不過來
    const anchorN = Array.isArray(s?.anchors) ? s.anchors.length : 0;
    if (anchorN < ANCHOR_RANGE[0] || anchorN > ANCHOR_RANGE[1]) bad.anchors.push(`${label}（${anchorN} 個）`);

    // 光照狀態 ≥1（僅場景）：AI 換時段是重新生成，不是重新打燈
    if (scenes.includes(s) && (!Array.isArray(s?.lighting) || s.lighting.length === 0)) bad.lighting.push(label);

    // 空景：負向提示詞必須禁人
    const neg = s?.image?.negativePrompt ?? '';
    if (!PEOPLE_BAN.test(neg)) bad.people.push(label);

    // 機器欄位永遠英文（場景的光照 + 道具的狀態一起掃）
    const machine = [
      s?.image?.prompt, s?.image?.negativePrompt, s?.image?.sheet,
      ...(s?.lighting ?? []).map((l) => l?.prompt),
      ...(s?.states ?? []).map((st) => st?.prompt),
      ...(s?.image?.tags ?? []),
    ];
    if (machine.some((v) => typeof v === 'string' && CJK.test(v))) bad.english.push(label);

    // 提示詞不許出現角色名（給了 cast 才查）
    if (castNames?.length) {
      const texts = [
        s?.image?.prompt, s?.image?.sheet,
        ...(s?.lighting ?? []).map((l) => l?.prompt),
        ...(s?.states ?? []).map((st) => st?.prompt),
      ];
      for (const n of castNames) {
        if (texts.some((v) => typeof v === 'string' && v.includes(n))) {
          bad.names.push(`${label} 出現「${n}」`);
          break;
        }
      }
    }

    // 變體引用完整
    if (s?.variantOf !== undefined) {
      if (!ids.has(s.variantOf) || s.variantOf === s.id) bad.variant.push(`${label} → ${s.variantOf}`);
      else if (!thText(s?.changes)) bad.variant.push(`${label} 缺 changes`);
    }

    // 風格與反向詞匹配 + sheet 帶渲染句
    const bansRealism = /photorealistic|3d render/i.test(neg);
    if (style === 'realistic' && bansRealism) bad.style.push(`${label} 禁了 photorealistic`);
    if (style === 'ghibli' && !bansRealism) bad.style.push(`${label} 沒禁 photorealistic`);
    if (thText(s?.image?.sheet) && !s.image.sheet.includes(preset.render)) bad.style.push(`${label} 的 sheet 缺渲染句`);
  }

  // 道具專屬的門
  for (const pr of props) {
    const label = pr?.name ?? pr?.id ?? '(無名)';

    // 狀態 ≥1：合上/開啟、藏著/攤開——每個狀態都是一張要單獨生成的參考
    if (!Array.isArray(pr?.states) || pr.states.length === 0) bad.states.push(label);

    // 尺度參照：scale 列舉 + 提示詞裡必須出現對應英文短語
    const scaleEn = PROP_SCALES[pr?.scale];
    if (!scaleEn) {
      bad.scale.push(`${label}（scale 必須是 ${Object.keys(PROP_SCALES).join('/')}）`);
    } else if (![pr?.image?.prompt, pr?.image?.sheet].every((v) => typeof v === 'string' && v.includes(scaleEn))) {
      bad.scale.push(`${label}（提示詞缺「${scaleEn}」）`);
    }

    // 無手：拿著道具的手是最常見的汙染，負向提示詞必須禁
    if (!HANDS_BAN.test(pr?.image?.negativePrompt ?? '')) bad.hands.push(label);

    // 白底：道具參考圖要被貼進各種鏡頭，必須純白背景可摳
    if (!/white background/i.test(pr?.image?.sheet ?? '')) bad.whitebg.push(label);
  }

  add('anchors', `一致性錨點 ${ANCHOR_RANGE[0]}–${ANCHOR_RANGE[1]} 個`, scenes.length + props.length > 0 && bad.anchors.length === 0, bad.anchors.join('；'));
  add('lighting', '光照狀態至少 1 個且落成提示詞', scenes.length > 0 && bad.lighting.length === 0, bad.lighting.join('；'));
  add('no-people', '參考圖無人：負向提示詞禁人（場景與道具都查）', scenes.length + props.length > 0 && bad.people.length === 0, bad.people.join('；'));
  add('english', '生圖提示詞全部英文', scenes.length + props.length > 0 && bad.english.length === 0, bad.english.join('；'));
  add(
    'no-names',
    '提示詞不含角色名',
    bad.names.length === 0,
    castNames?.length ? bad.names.join('；') : '未提供 cast.json，本門跳過（視為通過）',
  );
  add('variants', '變體引用完整（variantOf 存在且帶 changes）', bad.variant.length === 0, bad.variant.join('；'));
  add('style-match', '風格與負向提示詞匹配', bad.style.length === 0, bad.style.join('；'));
  add('prop-states', '道具狀態至少 1 個且落成提示詞', props.length === 0 || bad.states.length === 0, bad.states.join('；'));
  add('prop-scale', '道具尺度參照寫進提示詞', props.length === 0 || bad.scale.length === 0, bad.scale.join('；'));
  add('prop-hands', '道具參考圖無手：負向提示詞禁手', props.length === 0 || bad.hands.length === 0, bad.hands.join('；'));
  add('prop-white', '道具設定圖純白背景可摳', props.length === 0 || bad.whitebg.length === 0, bad.whitebg.join('；'));

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateArt(doc, castNames = null) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!doc || typeof doc !== 'object') return ['art.json 不是物件'];

  if (!thText(doc.source)) p('缺少 source（劇名/書名）');
  if (!SUPPORTED_STYLES.includes(doc.style)) p(`style 必須是 ${SUPPORTED_STYLES.join('/')}，實際是 ${JSON.stringify(doc.style)}`);

  const scenes = doc.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    p('scenes 為空');
    return problems;
  }

  // 道具（可選塊）：給了就逐件查結構
  for (const pr of doc.props ?? []) {
    const label = pr?.name ?? pr?.id ?? '(無名)';
    if (!/^P\d{2,}$/.test(pr?.id ?? '')) p(`[${label}] 道具 id 必須是 P01 這種格式`);
    if (!thText(pr?.name)) p(`[${pr?.id}] 道具缺 name`);
    if (!thText(pr?.summary)) p(`[${label}] 缺 summary（戲劇功能：這件道具承載什麼劇情）`);
    for (const a of pr?.anchors ?? []) {
      if (!thText(a?.name) || !thText(a?.desc)) p(`[${label}] 錨點缺 name 或 desc`);
    }
    for (const st of pr?.states ?? []) {
      if (!thText(st?.state)) p(`[${label}] 狀態缺 state（合上/開啟……）`);
      if (!thText(st?.prompt)) p(`[${label}] 狀態「${st?.state ?? '?'}」缺 prompt（英文）`);
    }
    const img = pr?.image;
    if (!img || typeof img !== 'object') {
      p(`[${label}] 缺 image`);
    } else {
      for (const f of ['prompt', 'negativePrompt', 'sheet']) {
        if (!thText(img[f])) p(`[${label}] image.${f} 缺失或為空`);
      }
      if (!Array.isArray(img.tags)) p(`[${label}] image.tags 必須是陣列`);
    }
    for (const sid of pr?.relatedScenes ?? []) {
      if (!scenes.some((sc) => sc?.id === sid)) p(`[${label}] relatedScenes 裡的 ${sid} 不存在`);
    }
    if (pr?.usage !== undefined) {
      if (!Array.isArray(pr.usage?.episodes)) p(`[${label}] usage.episodes 必須是陣列`);
      if (!Array.isArray(pr.usage?.beats)) p(`[${label}] usage.beats 必須是陣列`);
    }
  }
  {
    const seenP = new Set();
    for (const pr of doc.props ?? []) {
      if (seenP.has(pr?.id)) p(`道具 id ${pr.id} 重複`);
      seenP.add(pr?.id);
    }
  }

  const seen = new Set();
  for (const s of scenes) {
    const label = s?.name ?? s?.id ?? '(無名)';
    if (!/^S\d{2,}$/.test(s?.id ?? '')) p(`[${label}] 場景 id 必須是 S01 這種格式`);
    if (seen.has(s?.id)) p(`場景 id ${s.id} 重複`);
    seen.add(s?.id);
    if (!thText(s?.name)) p(`[${s?.id}] 缺 name`);
    if (typeof s?.primary !== 'boolean') p(`[${label}] 缺 primary（是不是主場景）`);
    if (!thText(s?.summary)) p(`[${label}] 缺 summary（設計意圖：這個空間講什麼故事）`);

    for (const a of s?.anchors ?? []) {
      if (!thText(a?.name) || !thText(a?.desc)) p(`[${label}] 錨點缺 name 或 desc`);
    }
    for (const l of s?.lighting ?? []) {
      if (!thText(l?.state)) p(`[${label}] 光照狀態缺 state（晨霧/夜戲/黃昏……）`);
      if (!thText(l?.prompt)) p(`[${label}] 光照「${l?.state ?? '?'}」缺 prompt（英文）`);
    }

    const img = s?.image;
    if (!img || typeof img !== 'object') {
      p(`[${label}] 缺 image`);
    } else {
      for (const f of ['prompt', 'negativePrompt', 'sheet']) {
        if (!thText(img[f])) p(`[${label}] image.${f} 缺失或為空`);
      }
      if (!Array.isArray(img.tags)) p(`[${label}] image.tags 必須是陣列`);
    }

    if (s?.usage !== undefined) {
      if (!Array.isArray(s.usage?.episodes)) p(`[${label}] usage.episodes 必須是陣列`);
      if (!Array.isArray(s.usage?.beats)) p(`[${label}] usage.beats 必須是陣列`);
    }
  }

  // 品質門失敗併入違規列表
  for (const g of gateReport(doc, castNames)) {
    if (!g.ok) p(`品質門未過：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }

  return problems;
}

/** 從 cast.json 提取名字 + 別名，給「提示詞不含角色名」那道門用。 */
export function castNamesOf(cast) {
  const chars = Array.isArray(cast) ? cast : (cast?.characters ?? []);
  const names = [];
  for (const c of chars) {
    if (thText(c?.name)) names.push(c.name.trim());
    for (const a of c?.aliases ?? []) if (thText(a)) names.push(a.trim());
  }
  return [...new Set(names)];
}

/* ------------------------------------------------------------------ */
/* render — 介面文案                                                    */
/* ------------------------------------------------------------------ */
/*
 * 內建 zh / en 兩套，全部收在這張表裡；zh 是基準，en 術語與 README.en.md 對齊。
 * 只有報告介面走這張表——品質門文案、CLI 輸出、art.json 裡的資料都不在此列。
 */

/* 門標籤與「跳過」提示的英文對映：品質門面板是報告的一部分，出英文報告時
 * 這裡做展示層翻譯——gateReport 的邏輯與中文診斷文案一行不動（CLI 仍是中文）。
 * 動態閾值由門自己算，對映裡只寫固定語義；未命中的 id 回落到原標籤。 */
const GATE_LABELS_EN = {
  'anchors': 'Consistency anchors, {0}–{1} per asset',
  'lighting': 'At least one lighting state, written out as a prompt',
  'no-people': 'No people in plates: negatives ban people (scenes and props)',
  'english': 'All image prompts in English',
  'no-names': 'Prompts carry no character names',
  'variants': 'Variant references complete (variantOf exists and carries changes)',
  'style-match': 'Style matches its negative prompt',
  'prop-states': 'At least one prop state, written out as a prompt',
  'prop-scale': 'Prop scale reference written into the prompt',
  'prop-hands': 'No hands in prop plates: negatives ban hands',
  'prop-white': 'Prop sheets on pure white background, cut-out ready',
};
const GATE_SKIPS_EN = {
    '未提供 outline.json，本門跳過（視為通過）': 'outline.json not provided — gate skipped (treated as passing)',
    '未提供 art.json，本門跳過（視為通過）': 'art.json not provided — gate skipped (treated as passing)',
    '未提供 script.json，本門跳過（視為通過）': 'script.json not provided — gate skipped (treated as passing)',
    '未提供 outline/cast，本門跳過（視為通過）': 'outline/cast not provided — gate skipped (treated as passing)',
    '未提供 cast.json，本門跳過（視為通過）': 'cast.json not provided — gate skipped (treated as passing)',
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
    kicker: '美術設定集',
    docTitle: (s) => `${s} · 美術設定集`,
    styleLine: (id) => `畫風：${scenePreset(id).label}`,
    exportJson: '匯出 JSON',
    gates: '品質門',
    gatesPass: '全部通過',
    gatesFail: (n) => `${n} 項未過`,
    gatePill: (okN, total) => `品質門 ${okN} / ${total}`,
    kpi: {
      scenes: '場景', scenesSub: (p2, v) => `主場景 ${p2}${v ? ` · 變體 ${v}` : ''}`,
      propsK: '敘事道具', propsSub: (st) => `${st} 個狀態變體`,
      anchors: '一致性錨點', anchorsSub: '生成鏡頭的核對表（場景 + 道具）',
      lighting: '光照狀態', lightingSub: '換時段 = 重新生成',
    },
    secList: '場景清單',
    secCards: '場景設定卡',
    secPropList: '道具清單',
    secPropCards: '道具設定卡',
    secGates: '品質門',
    propListCols: ['ID', '道具', '尺度', '狀態', '關聯場景', '出現集', '錨點'],
    statesTitle: '狀態變體',
    scaleLabel: '尺度',
    relatedScenesLabel: '關聯場景',
    carriedByLabel: '關聯角色',
    propSheetCaption: '主視角＋底部與右側細節條 · 純白背景',
    listCols: ['ID', '場景', '型別', '出現集', '錨點', '光照', '變體'],
    primaryScene: '主場景', onceScene: '一次性', variantScene: '變體',
    anchorsTitle: '一致性錨點',
    anchorsHint: '每次生成都必須出現的特徵——認場景靠它，QC 也靠它',
    lightingTitle: '光照與時段',
    usageTitle: '出現集',
    beatsTitle: '承載爽點',
    variantTitle: '變體來源',
    variantChanges: '改動',
    promptsTitle: '生圖提示詞包',
    promptMaster: '主視角 EN',
    promptNegative: '負向提示詞',
    promptSheet: '設定圖 EN',
    copy: '複製', copied: '已複製', copyFailed: '複製失敗', copyJson: '複製整個場景 JSON',
    noImage: '尚未生圖',
    noImageHint: '用下方提示詞生成',
    zoomImage: '放大檢視',
    closeImage: '關閉',
    sheetCaption: '主視角＋底部與右側細節條',
    none: '—',
    listSep: '、',
    pairSep: '　',
    colon: '：',
    colophon: '設定與提示詞由模型依據大綱/原文生成，品質門由腳本確定性檢查。參考圖一律無人——人是另一層資產；道具參考圖另加無手、純白背景。',
  },
  en: {
    langCode: 'en',
    kicker: 'Art Bible',
    docTitle: (s) => `${s} · Art Bible`,
    styleLine: (id) => `Style: ${({ realistic: 'semi-realistic painterly', ghibli: 'Ghibli-style animation' })[id] ?? id}`,
    exportJson: 'Export JSON',
    gates: 'Quality gates',
    gatesPass: 'All passed',
    gatesFail: (n) => `${n} gate${n === 1 ? '' : 's'} failed`,
    gatePill: (okN, total) => `Quality gates ${okN} / ${total}`,
    kpi: {
      scenes: 'Scenes', scenesSub: (p2, v) => `${p2} primary${v ? ` · ${v} variant${v === 1 ? '' : 's'}` : ''}`,
      propsK: 'Narrative props', propsSub: (st) => `${st} state variant${st === 1 ? '' : 's'}`,
      anchors: 'Consistency anchors', anchorsSub: 'The checklist for generated shots (scenes + props)',
      lighting: 'Lighting states', lightingSub: 'A time-of-day change is a regeneration',
    },
    secList: 'Scene list',
    secCards: 'Scene sheets',
    secPropList: 'Prop list',
    secPropCards: 'Prop sheets',
    secGates: 'Quality gates',
    propListCols: ['ID', 'Prop', 'Scale', 'States', 'Related scenes', 'Episodes', 'Anchors'],
    statesTitle: 'Prop states',
    scaleLabel: 'Scale',
    relatedScenesLabel: 'Related scenes',
    carriedByLabel: 'Carried by',
    propSheetCaption: 'Master view + bottom & right detail strips · pure white background',
    listCols: ['ID', 'Scene', 'Type', 'Episodes', 'Anchors', 'Lighting', 'Variant'],
    primaryScene: 'Primary', onceScene: 'One-off', variantScene: 'Variant',
    anchorsTitle: 'Consistency anchors',
    anchorsHint: 'Features that must appear in every generation — viewers recognize the place by them, and QC checks against them',
    lightingTitle: 'Lighting states',
    usageTitle: 'Episodes',
    beatsTitle: 'Beats',
    variantTitle: 'Variant of',
    variantChanges: 'Changes',
    promptsTitle: 'Prompt pack',
    promptMaster: 'Master view (EN)',
    promptNegative: 'Negative prompt',
    promptSheet: 'Sheet (EN)',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed', copyJson: 'Copy full JSON',
    noImage: 'no image yet',
    noImageHint: 'generate with the prompts below',
    zoomImage: 'Click to zoom',
    closeImage: 'Close',
    sheetCaption: 'Master view + bottom & right detail strips',
    none: '—',
    listSep: ', ',
    pairSep: ' · ',
    colon: ': ',
    colophon: 'Designs and prompts are model-generated from the outline/source text; quality gates are checked deterministically by the script. Reference images never contain people — characters are a separate asset layer; prop plates additionally ban hands and sit on a pure white background.',
  },
};

const tOf = (lang) => {
  if (lang && !I18N[lang]) throw new Error('報告介面語言目前內建 zh / en');
  return I18N[lang ?? 'zh'];
};

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const mdRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
const mdHead = (cols) => [mdRow(cols), mdRow(cols.map(() => '---'))].join('\n');

export function renderMarkdown(doc, lang = null) {
  const t = tOf(lang ?? doc?.lang);
  const props = doc.props ?? [];
  const out = [`# ${t.docTitle(doc.source)}`, '', `> ${t.styleLine(doc.style)}`, ''];

  out.push(`## ${t.secList}`, '', mdHead(t.listCols));
  for (const s of doc.scenes) {
    const type = s.variantOf ? `${t.variantScene} ← ${s.variantOf}` : s.primary ? t.primaryScene : t.onceScene;
    out.push(mdRow([
      s.id, s.name, type, s.usage?.episodes?.join(t.listSep) ?? t.none,
      s.anchors.length, s.lighting.map((l) => l.state).join(t.listSep),
      s.changes ?? t.none,
    ]));
  }
  out.push('');

  for (const s of doc.scenes) {
    out.push('---', '', `## ${s.id} ${s.name}`, '', s.summary, '');
    if (s.sheetImage) out.push(`![${s.name} ${t.sheetCaption}](${s.sheetImage})`, '');
    out.push(`### ${t.anchorsTitle}`, '');
    s.anchors.forEach((a, i) => out.push(`${i + 1}. **${a.name}** — ${a.desc}`));
    out.push('', `### ${t.lightingTitle}`, '');
    for (const l of s.lighting) out.push(`- **${l.state}**${t.colon}\`${l.prompt}\``);
    out.push('');
    if (s.variantOf) out.push(`> ${t.variantTitle}${t.colon}${s.variantOf}${t.pairSep}${t.variantChanges}${t.colon}${s.changes}`, '');
    out.push(`### ${t.promptsTitle}`, '');
    out.push(`**${t.promptMaster}**`, '', '```text', s.image.prompt, '```', '');
    out.push(`**${t.promptNegative}**`, '', '```text', s.image.negativePrompt, '```', '');
    out.push(`**${t.promptSheet}**`, '', '```text', s.image.sheet, '```', '');
    if (s.image.tags.length) out.push(`\`${s.image.tags.join('`, `')}\``, '');
  }

  if (props.length) {
    out.push('---', '', `## ${t.secPropList}`, '', mdHead(t.propListCols));
    for (const pr of props) {
      out.push(mdRow([
        pr.id, pr.name, pr.scale, pr.states.map((st) => st.state).join(t.listSep),
        (pr.relatedScenes ?? []).join(t.listSep) || t.none,
        pr.usage?.episodes?.join(t.listSep) ?? t.none, pr.anchors.length,
      ]));
    }
    out.push('');
    for (const pr of props) {
      out.push('---', '', `## ${pr.id} ${pr.name}`, '', pr.summary, '');
      if (pr.sheetImage) out.push(`![${pr.name} ${t.propSheetCaption}](${pr.sheetImage})`, '');
      out.push(`### ${t.anchorsTitle}`, '');
      pr.anchors.forEach((a, i) => out.push(`${i + 1}. **${a.name}** — ${a.desc}`));
      out.push('', `### ${t.statesTitle}`, '');
      for (const st of pr.states) out.push(`- **${st.state}**${t.colon}\`${st.prompt}\``);
      out.push('');
      out.push(`### ${t.promptsTitle}`, '');
      out.push(`**${t.promptMaster}**`, '', '```text', pr.image.prompt, '```', '');
      out.push(`**${t.promptNegative}**`, '', '```text', pr.image.negativePrompt, '```', '');
      out.push(`**${t.promptSheet}**`, '', '```text', pr.image.sheet, '```', '');
    }
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 與另外兩份報告同一套視覺語言：冷灰印張 + 鐵鏽紅印記，1600 寬，
 * 全部平鋪可 Cmd+F，零外部依賴。設計約定見 references/report-style.md。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

export function renderHtml(doc, lang = null) {
  const code = lang ?? doc?.lang ?? 'zh';
  const t = tOf(code);
  const gates = gateReport(doc);
  const failed = gates.filter((g) => !g.ok);
  const scenes = doc.scenes;
  const props = doc.props ?? [];
  const primaryN = scenes.filter((s) => s.primary).length;
  const variantN = scenes.filter((s) => s.variantOf).length;
  const anchorN = [...scenes, ...props].reduce((n, s) => n + s.anchors.length, 0);
  const lightN = scenes.reduce((n, s) => n + s.lighting.length, 0);
  const stateN = props.reduce((n, pr) => n + pr.states.length, 0);

  const table = (cols, rows) =>
    `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`;

  const promptRow = (label, value) =>
    !value
      ? ''
      : `<details class="pr">
  <summary><span>${esc(label)}</span><button class="copy" data-copy="${esc(value)}">${esc(t.copy)}</button></summary>
  <p>${esc(value)}</p>
</details>`;

  const listRows = scenes.map((s) => [
    esc(s.id), esc(s.name),
    esc(s.variantOf ? `${t.variantScene} ← ${s.variantOf}` : s.primary ? t.primaryScene : t.onceScene),
    esc(s.usage?.episodes?.join(t.listSep) ?? t.none),
    String(s.anchors.length),
    esc(s.lighting.map((l) => l.state).join(t.listSep)),
    esc(s.changes ?? t.none),
  ]);

  const propListRows = props.map((pr) => [
    esc(pr.id), esc(pr.name), esc(pr.scale), esc(pr.states.map((st) => st.state).join(t.listSep)),
    esc((pr.relatedScenes ?? []).join(t.listSep) || t.none),
    esc(pr.usage?.episodes?.join(t.listSep) ?? t.none), String(pr.anchors.length),
  ]);

  const propCards = props
    .map((pr) => {
      const plate = pr.sheetImage
        ? `<figure class="plate">
  <button class="zoom" data-src="${esc(pr.sheetImage)}" aria-label="${esc(t.zoomImage)}">
    <img src="${esc(pr.sheetImage)}" alt="${esc(pr.name)} ${esc(t.propSheetCaption)}" loading="lazy">
  </button>
  <figcaption>${esc(t.propSheetCaption)}</figcaption>
</figure>`
        : `<div class="plate plate-empty"><span>${esc(pr.name)} · ${esc(t.noImage)}<br><em>${esc(t.noImageHint)}</em></span></div>`;
      return `<article class="scene" id="pr-${slug(pr.id)}">
  <header class="sc-h">
    <span class="sc-id">${esc(pr.id)}</span>
    <h3>${esc(pr.name)}</h3>
    <span class="badge">${esc(pr.scale)}</span>
    ${pr.usage?.episodes?.length ? `<span class="sc-use">${esc(t.usageTitle)} ${esc(pr.usage.episodes.join(t.listSep))}${pr.usage.beats?.length ? `${esc(t.pairSep)}${esc(t.beatsTitle)} ${esc(pr.usage.beats.join(' · '))}` : ''}</span>` : ''}
  </header>
  <p class="sc-sum">${esc(pr.summary)}</p>
  ${plate}
  ${(pr.relatedScenes ?? []).length || pr.carriedBy ? `<p class="variant">${(pr.relatedScenes ?? []).length ? `${esc(t.relatedScenesLabel)}${esc(t.colon)}<b>${esc(pr.relatedScenes.join(t.listSep))}</b>` : ''}${pr.carriedBy ? `${esc(t.pairSep)}${esc(t.carriedByLabel)}${esc(t.colon)}${esc([].concat(pr.carriedBy).join(t.listSep))}` : ''}</p>` : ''}
  <section class="blk">
    <h4>${esc(t.anchorsTitle)}<small>${esc(t.anchorsHint)}</small></h4>
    <ol class="anchors">${pr.anchors.map((a) => `<li><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></li>`).join('')}</ol>
  </section>
  <section class="blk">
    <h4>${esc(t.statesTitle)}</h4>
    <div class="lights">${pr.states.map((st) => `<div class="light"><i>${esc(st.state)}</i><span class="mono">${esc(st.prompt)}</span><button class="copy mini" data-copy="${esc(st.prompt)}">${esc(t.copy)}</button></div>`).join('')}</div>
  </section>
  <div class="pgroup">
    ${promptRow(t.promptMaster, pr.image.prompt)}
    ${promptRow(t.promptSheet, pr.image.sheet)}
    ${promptRow(t.promptNegative, pr.image.negativePrompt)}
    <div class="pgroup-f"><button class="copy wide" data-copy="${esc(JSON.stringify(pr, null, 2))}">${esc(t.copyJson)}</button></div>
  </div>
</article>`;
    })
    .join('\n');

  const cards = scenes
    .map((s) => {
      const plate = s.sheetImage
        ? `<figure class="plate">
  <button class="zoom" data-src="${esc(s.sheetImage)}" aria-label="${esc(t.zoomImage)}">
    <img src="${esc(s.sheetImage)}" alt="${esc(s.name)} ${esc(t.sheetCaption)}" loading="lazy">
  </button>
  <figcaption>${esc(t.sheetCaption)}</figcaption>
</figure>`
        : `<div class="plate plate-empty"><span>${esc(s.name)} · ${esc(t.noImage)}<br><em>${esc(t.noImageHint)}</em></span></div>`;
      return `<article class="scene" id="sc-${slug(s.id)}">
  <header class="sc-h">
    <span class="sc-id">${esc(s.id)}</span>
    <h3>${esc(s.name)}</h3>
    <span class="badge${s.primary ? '' : ' once'}">${esc(s.variantOf ? t.variantScene : s.primary ? t.primaryScene : t.onceScene)}</span>
    ${s.usage?.episodes?.length ? `<span class="sc-use">${esc(t.usageTitle)} ${esc(s.usage.episodes.join(t.listSep))}${s.usage.beats?.length ? `${esc(t.pairSep)}${esc(t.beatsTitle)} ${esc(s.usage.beats.join(' · '))}` : ''}</span>` : ''}
  </header>
  <p class="sc-sum">${esc(s.summary)}</p>
  ${plate}
  ${s.variantOf ? `<p class="variant">${esc(t.variantTitle)}${esc(t.colon)}<b>${esc(s.variantOf)}</b>${esc(t.pairSep)}${esc(t.variantChanges)}${esc(t.colon)}${esc(s.changes)}</p>` : ''}
  <section class="blk">
    <h4>${esc(t.anchorsTitle)}<small>${esc(t.anchorsHint)}</small></h4>
    <ol class="anchors">${s.anchors.map((a) => `<li><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></li>`).join('')}</ol>
  </section>
  <section class="blk">
    <h4>${esc(t.lightingTitle)}</h4>
    <div class="lights">${s.lighting.map((l) => `<div class="light"><i>${esc(l.state)}</i><span class="mono">${esc(l.prompt)}</span><button class="copy mini" data-copy="${esc(l.prompt)}">${esc(t.copy)}</button></div>`).join('')}</div>
  </section>
  <div class="pgroup">
    ${promptRow(t.promptMaster, s.image.prompt)}
    ${promptRow(t.promptSheet, s.image.sheet)}
    ${promptRow(t.promptNegative, s.image.negativePrompt)}
    <div class="pgroup-f"><button class="copy wide" data-copy="${esc(JSON.stringify(s, null, 2))}">${esc(t.copyJson)}</button></div>
  </div>
</article>`;
    })
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(gateText(g, t.langCode).label)}${
        !g.ok && g.detail ? `<small>${esc(g.detail)}</small>` : g.id === 'no-names' && g.detail ? `<small>${esc(g.detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="${code}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(doc.source))}</title>
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
h1,h2,h3,h4{margin:0;font-weight:400}

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

.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px}
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

table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:nowrap}
.mono{font:400 11.5px/1.7 var(--mono);color:var(--ink-2);word-break:break-word}

/* 場景設定卡：一排兩張（方便截圖宣傳），卡內縱排、設定圖佔滿卡寬 */
.cards{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
@media(max-width:1100px){.cards{grid-template-columns:1fr}}
.scene{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 20px}
.sc-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px}
.sc-id{font:500 12px/1 var(--mono);color:var(--seal)}
.sc-h h3{font:400 20px/1.2 var(--serif);letter-spacing:.04em}
.badge{font:500 10.5px/1 var(--sans);padding:2px 8px;border-radius:99px;border:1px solid var(--seal);color:var(--seal)}
.badge.once{border-color:var(--seal-2);color:var(--seal-2)}
.sc-use{margin-left:auto;font-size:12px;color:var(--ink-2)}
.sc-sum{margin:10px 0 12px;font:400 14.5px/1.9 var(--serif)}
.scene .blk{margin-top:16px}
.scene .pgroup{margin-top:16px}

.plate{margin:0;background:#fff;border:1px solid var(--rule-2);border-radius:2px;overflow:hidden}
.plate .zoom{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}
.plate .zoom:focus-visible{outline:2px solid var(--seal);outline-offset:-2px}
.plate img{display:block;width:100%;height:auto}
/* 圖片彈層 */
.lightbox{position:fixed;inset:0;z-index:50;display:none;place-items:center;
  background:#191d21e6;padding:32px;cursor:zoom-out}
.lightbox.on{display:grid}
.lightbox img{max-width:100%;max-height:100%;background:#fff;border-radius:2px;
  box-shadow:0 8px 40px #0006}
.lightbox-x{position:absolute;top:18px;right:22px;font:500 13px/1 var(--sans);color:#fff;
  background:none;border:1px solid #fff6;border-radius:3px;padding:8px 12px;cursor:pointer}
.lightbox-x:hover{border-color:#fff}
.plate figcaption{font-size:11px;letter-spacing:.08em;color:var(--ink-3);padding:6px 10px;border-top:1px solid var(--rule)}
.plate-empty{display:grid;place-items:center;min-height:180px;text-align:center;
  border:1px dashed var(--rule-2);background:var(--paper);color:var(--ink-3);font-size:13px}
.plate-empty em{font-style:normal;font-size:12px;opacity:.8}
.variant{margin:10px 0 0;font-size:12.5px;color:var(--seal);background:var(--seal-soft);padding:7px 10px;border-radius:2px}
.variant b{font-family:var(--mono);font-weight:500}

.blk{margin-bottom:16px}
.blk h4{font:500 11px/1.6 var(--sans);letter-spacing:.18em;color:var(--seal);margin-bottom:8px}
.blk h4 small{display:block;letter-spacing:0;font-weight:400;color:var(--ink-3);font-size:11px}
.anchors{margin:0;padding:0 0 0 2px;list-style:none;counter-reset:an}
/* ::before 序號也是網格項，desc 必須顯式釘在第二列，否則會掉進 22px 窄列一字一行 */
.anchors li{counter-increment:an;display:grid;grid-template-columns:22px minmax(0,1fr);column-gap:8px;
  padding:6px 0;border-top:1px solid var(--rule);font-size:13px}
.anchors li:first-child{border-top:0}
.anchors li::before{content:counter(an,decimal-leading-zero);grid-column:1;grid-row:1;
  font:500 11px/1.9 var(--mono);color:var(--seal)}
.anchors b{grid-column:2;font-weight:500}
.anchors span{grid-column:2;display:block;font-size:12px;color:var(--ink-2)}
.lights{display:flex;flex-direction:column;gap:6px}
.light{display:flex;align-items:baseline;gap:10px;background:var(--paper);border:1px solid var(--rule);
  border-radius:2px;padding:7px 10px}
.light i{flex:none;font-style:normal;font:500 12px/1.6 var(--sans);color:var(--ink)}
.light .mono{flex:1;min-width:0}

.pgroup{border:1px solid var(--rule);border-radius:2px;background:var(--paper);padding:4px 12px 8px;margin-top:12px}
.pr{border-bottom:1px solid var(--rule)}
.pgroup .pr:last-of-type{border-bottom:0}
.pr summary{display:flex;align-items:center;gap:10px;padding:10px 0;cursor:pointer;list-style:none;
  font:500 12px/1 var(--sans);letter-spacing:.04em}
.pr summary::-webkit-details-marker{display:none}
.pr summary::before{content:"▸";color:var(--seal);font-size:11px;transition:transform .15s}
.pr[open] summary::before{transform:rotate(90deg)}
.pr summary span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr p{margin:0 0 10px;padding:10px 12px;background:var(--panel);border:1px solid var(--rule);
  border-radius:2px;font:400 12px/1.75 var(--mono);white-space:pre-wrap;word-break:break-word}
.pgroup-f{padding:10px 0 4px}
.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.wide{width:100%;padding:9px}
.copy.mini{padding:2px 7px;font-size:10.5px}

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

.foot{margin-top:40px;font-size:11px;color:var(--ink-3);border-top:1px solid var(--rule);padding-top:14px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .expo,.copy{display:none!important}
  .pr p{display:block!important}
  .pr summary::before{content:""}
  .page{max-width:none;padding:0}
  section.top-sec,.scene{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(doc.source)}</h1>
  <span class="sub">${esc(t.kicker)} · ${esc(t.styleLine(doc.style))}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(doc.source))}-art.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.scenes)}</div><div class="v">${scenes.length}</div><div class="d">${esc(t.kpi.scenesSub(primaryN, variantN))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.propsK)}</div><div class="v">${props.length}</div><div class="d">${esc(t.kpi.propsSub(stateN))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.anchors)}</div><div class="v">${anchorN}</div><div class="d">${esc(t.kpi.anchorsSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lighting)}</div><div class="v">${lightN}</div><div class="d">${esc(t.kpi.lightingSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(gateText(g, t.langCode).label)}${g.detail ? ` — ${esc(gateText(g, t.langCode).detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-list">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secList)}</h2></div>
  ${table(t.listCols, listRows)}
</section>

<section class="top-sec" id="sec-cards">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secCards)}</h2></div>
  <div class="cards">
${cards}
  </div>
</section>

${props.length ? `<section class="top-sec" id="sec-prop-list">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secPropList)}</h2></div>
  ${table(t.propListCols, propListRows)}
</section>

<section class="top-sec" id="sec-prop-cards">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secPropCards)}</h2></div>
  <div class="cards">
${propCards}
  </div>
</section>` : ''}

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">${props.length ? '05' : '03'}</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<div class="lightbox" role="dialog" aria-modal="true">
  <button class="lightbox-x" aria-label="${esc(t.closeImage)}">${esc(t.closeImage)}</button>
  <img alt="">
</div>

<script type="application/json" id="art-data">${embedDoc(doc)}</script>
<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed })};

// 圖片彈層：點圖放大，點背景或 Esc 關閉
const lb = document.querySelector('.lightbox');
const lbImg = lb.querySelector('img');
function closeLb() { lb.classList.remove('on'); lbImg.removeAttribute('src'); }
document.addEventListener('click', (e) => {
  const z = e.target.closest('.zoom');
  if (z) { lbImg.src = z.dataset.src; lb.classList.add('on'); return; }
  if (e.target.closest('.lightbox')) closeLb();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

// 複製按鈕
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

// 匯出：報告自己帶著完整的 art.json，下載的是它原樣
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('art-data').textContent], { type: 'application/json' }),
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

const USAGE = `novel-art.mjs — novel-art skill 的確定性工具（場景 + 道具）

  seed <outline.json>                    從大綱預填 art.json 骨架（列印到 stdout，道具留空待提取）
  validate <art.json> [--cast c.json]    校驗；有違規逐條列印並 exit 1
                                         給了 cast.json 才查「提示詞不含角色名」
  checkup <art.json> [--cast c.json]     只列印品質門 ✓/✗，有未過項 exit 1
  render <art.json> [--html|--md] [--lang zh|en]
                                         渲染報告到 stdout（預設 --md）
                                         介面語言優先順序：--lang > art.json 頂層 lang 欄位 > 中文
  styles [id]                            列印畫風預設的完整內容
  slug <name>                            場景名轉安全檔名

render 會自動去 images/<slug>-sheet.png 找圖，找到就嵌進報告。`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
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

  if (cmd === 'validate' || cmd === 'checkup') {
    const [path] = rest;
    if (!path) throw new Error(`用法：${cmd} <art.json> [--cast cast.json]`);
    const doc = readJson(path);
    const castPath = flag(rest, '--cast');
    const names = castPath ? castNamesOf(readJson(castPath)) : null;
    if (!castPath) console.error('⚠️ 沒給 --cast，跳過「提示詞不含角色名」檢查');

    if (cmd === 'checkup') {
      const gates = gateReport(doc, names);
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${!g.ok && g.detail ? ` — ${g.detail}` : ''}`);
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(failedN ? `\n✗ ${failedN} 項未過` : '\n✓ 全部通過');
      if (failedN) process.exit(1);
      return;
    }

    const problems = validateArt(doc, names);
    if (problems.length) {
      console.error(`✗ ${problems.length} 處違規：\n`);
      for (const x of problems) console.error('  ' + x);
      process.exit(1);
    }
    console.log(`✓ ${doc.scenes.length} 個場景${(doc.props ?? []).length ? ` + ${doc.props.length} 件道具` : ''}全部通過校驗（style=${doc.style}）`);
    return;
  }

  if (cmd === 'render') {
    const [path] = rest;
    if (!path) throw new Error('用法：render <art.json> [--html|--md] [--lang zh|en]');
    const doc = readJson(path);
    const lang = flag(rest, '--lang');
    // 圖存在才掛上去；沒有就渲染成佔位，不影響其餘內容
    const outDir = resolve(path, '..');
    for (const item of [...doc.scenes, ...(doc.props ?? [])]) {
      const rel = `images/${slug(item.name)}-sheet.png`;
      if (existsSync(resolve(outDir, rel))) item.sheetImage = rel;
    }
    process.stdout.write((rest.includes('--html') ? renderHtml(doc, lang) : renderMarkdown(doc, lang)) + '\n');
    return;
  }

  if (cmd === 'styles') {
    const only = rest[0];
    if (only && !SUPPORTED_STYLES.includes(only)) {
      throw new Error(`未知風格 ${only}（可用：${SUPPORTED_STYLES.join('/')}）`);
    }
    const ids = only ? [only] : SUPPORTED_STYLES;
    console.log(JSON.stringify({
      default: DEFAULT_STYLE,
      note: '整塊取用不混搭；環境預設與 novel-characters 的角色預設同名對齊但內容不同',
      presets: Object.fromEntries(ids.map((id) => [id, SCENE_STYLE_PRESETS[id]])),
    }, null, 2));
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
