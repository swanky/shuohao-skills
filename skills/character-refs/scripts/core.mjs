// 角色參考圖的確定性核心：檢視與檔位、提示詞拼裝、輸入校驗、版本與過期、檢查門。
// 不呼叫任何模型——生圖在 models.mjs，命令列在 character-refs.mjs。

import { createHash } from 'node:crypto';
import { decode, pngInfo, isPng, withText } from './png.mjs';
import { BUILTIN, LANG_RE, fmt, uiFor, uiMissing } from './i18n.mjs';
import { DEFAULT_LOOK } from './looks.mjs';

export { DEFAULT_LOOK };

/* ------------------------------------------------------------------ */
/* 檢視與檔位                                                            */
/* ------------------------------------------------------------------ */
/*
 * 一組圖只有一個根：正面全身（錨點），純文生圖。其餘每一張都只參考錨點
 * （臉、頭髮、領口的細節額外參考正臉大頭照），彼此不互相參考——
 * 一致性來自「同一張錨點」，不來自「同一個模型」，所以派生圖可以換模型。
 *
 * 檔位按需往上加，不返工：
 *   1 正面全身（錨點）            預設只出這一檔
 *   2 正臉大頭照 + 90° 側面 + 背面   大頭照最有用（影片測試裡唯一看得出收益的一張）
 *   3 四張細節                    頭髮 / 領口 / 袖口 / 鞋，都是實測通過的部位
 *   4 45° 大頭照                  預設不出
 */
export const VIEWS = {
  'front-full': { tier: 1, ratio: '2:3', kind: 'full', label: '正面全身（錨點）', refs: [] },
  'face-front': { tier: 2, ratio: '4:5', kind: 'face', label: '正臉大頭照', refs: ['front-full'] },
  'side-full': { tier: 2, ratio: '2:3', kind: 'full', label: '側面 90°（面朝右）', refs: ['front-full'] },
  'back-full': { tier: 2, ratio: '2:3', kind: 'full', label: '背面', refs: ['front-full'] },
  'face-45': { tier: 4, ratio: '4:5', kind: 'face', label: '45° 大頭照（面朝左）', refs: ['front-full'] },
};
export const ANCHOR = 'front-full';
/** 預設出到第二檔：錨點 + 正臉大頭照 + 90° 側面 + 背面（影片測試裡大頭照對保臉最有用，使用者定預設就出齊）。 */
export const DEFAULT_TIER = 2;
export const RATIOS = { '2:3': 2 / 3, '4:5': 4 / 5, '1:1': 1 };

/** 細節槽位：預設四個，都是兩個測試角色上實測通過的部位。 */
export const DETAIL_SLOTS = {
  hair: { label: '頭髮 / 髮飾', part: 'hair' },
  neck: { label: '領口', part: 'neck' },
  sleeve: { label: '袖口', part: 'body' },
  feet: { label: '鞋', part: 'feet' },
};
/**
 * 自定義細節的部位：模型只寫「畫什麼」，取景由腳本按部位加（和預設槽位一樣）。
 * 預設四個槽位是實測穩定的；自定義部位沒有實測，確認表和報告裡標「未實測」。
 */
// 沒有 face：臉上的特徵（眼鏡、疤、痣）正臉大頭照裡已經看得清；Qwen 實測 3 種寫法 × 2 種子，全部畫成整張大頭照
export const DETAIL_PARTS = ['hair', 'neck', 'hands', 'waist', 'body', 'feet'];
export const MAX_DETAILS = 8;
/** 這些部位的細節額外掛正臉大頭照當參考（臉部畫素更多）；其餘只掛錨點。 */
const FACE_PARTS = new Set(['hair', 'face', 'neck']);

export function detailViews(outfit) {
  const out = {};
  for (const d of outfit?.details ?? []) {
    const part = d.slot === 'custom' ? d.part : DETAIL_SLOTS[d.slot]?.part;
    out[`detail-${d.slot === 'custom' ? d.id : d.slot}`] = {
      tier: 3, ratio: '1:1', kind: 'detail', part, detail: d, tested: d.slot !== 'custom',
      label: d.slot === 'custom' ? (human(d) || d.id) : DETAIL_SLOTS[d.slot].label,
      refs: FACE_PARTS.has(part) ? ['front-full', 'face-front'] : ['front-full'],
    };
  }
  return out;
}

export const allViews = (outfit) => ({ ...VIEWS, ...detailViews(outfit) });
export const viewsOfTier = (outfit, tier) => Object.entries(allViews(outfit)).filter(([, v]) => v.tier === tier).map(([k]) => k);

/* ------------------------------------------------------------------ */
/* 畫風層（按專案存；出錨點時整份快照進 frozen）                            */
/* ------------------------------------------------------------------ */
// 預設表在 looks.mjs；這裡只用預設的那一個當預設值。
const BASE_NEG = 'text, watermark, border, multiple people, extra limbs, deformed hands, props, scenery, colored background, oversaturated colors';
const FACE_NEG = BASE_NEG + ', waist, torso, arms, hands, full body, legs, feet, wide shot, medium shot';

/* ------------------------------------------------------------------ */
/* 小工具                                                                */
/* ------------------------------------------------------------------ */
export const CJK = /[㐀-鿿぀-ヿ가-힯]/;
export const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const sentence = (s) => {
  const t = String(s ?? '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : t + '.';
};
const clause = (s) => String(s ?? '').trim().replace(/[.。;；]+$/, '');
/** 去掉句末標點與開頭冠詞，好接在 the same / her 後面。 */
const bare = (s) => clause(s).replace(/^(a|an|the)\s+/i, '');
/** 句首大寫的普通詞放進句中要小寫（One thick braid → one thick braid）；專有名詞（第二個字母也大寫的縮寫等）不動。 */
const lowerFirst = (s) => { const t = clause(s); return /^[A-Z][a-z]/.test(t) && !/^(I|Chinese|Japanese|Korean)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t; };
const en = (field) => clause(field?.en ?? field);
/** 給人看的那段描述：新欄位 text，舊輸入的 zh 照樣認。 */
export const human = (field) => String(field?.text ?? field?.zh ?? '').trim();

export function pronouns(gender) {
  return gender === 'male' ? { s: 'he', o: 'him', p: 'his' } : { s: 'she', o: 'her', p: 'her' };
}
export function nounOf(age, gender) {
  const f = gender !== 'male';
  if (age >= 60) return f ? 'old woman' : 'old man';
  if (age < 30) return f ? 'young woman' : 'young man';
  return f ? 'woman' : 'man';
}

/** 皮膚預設按年齡給——皮膚粗糙程度是角色屬性，不是畫風。 */
/** 預設皮膚按年齡分三檔；給人看的文字按語言從文案表取（skinBand）。 */
export const skinBand = (age) => (age < 25 ? 'young' : age < 50 ? 'adult' : 'old');
export function defaultSkin(age) {
  if (age < 25) return { en: 'Young skin with faint pores on the nose and cheeks and a slightly uneven natural tone, no makeup', zh: '年輕皮膚，鼻翼臉頰有細微毛孔，膚色自然略不勻，素顏' };
  if (age < 50) return { en: 'Natural adult skin with visible pores and a slightly uneven tone', zh: '成年人的自然皮膚，可見毛孔，膚色略不勻' };
  return { en: 'Aged, weathered skin with visible pores, age spots and wrinkles that follow the expression lines', zh: '上了年紀的皮膚，風吹日曬，有老年斑，皺紋順表情肌走' };
}

/** 背面描述預設：背面才看得到的東西——頭髮從後面看、衣服背面、腳跟。 */
export function defaultBackCue(c, outfit) {
  const { p } = pronouns(c.identity.gender);
  return {
    en: `the back of ${p} head with ${p} hair as seen from behind (${lowerFirst(en(c.hair))}), the back of ${p} ${bare(en(outfit.top))} and of ${p} ${bare(en(outfit.bottom))}, and ${p} heels`,
    zh: '從後面看到的髮型、上衣與下裝的背面、腳跟',
  };
}

/** 角色 + 造型合併出實際參與拼提示詞的各層（overrides 覆蓋角色層，預設值在這裡補上）。 */
export function resolveLayers(asset, outfitId = 'default') {
  const outfit = asset.outfits?.[outfitId];
  if (!outfit) throw new Error(`沒有造型 ${outfitId}`);
  const c = { ...asset.layers, ...(outfit.overrides ?? {}) };
  return {
    identity: c.identity, face: c.face, hair: c.hair, build: c.build ?? null,
    skin: c.skin ?? { ...defaultSkin(c.identity.age), source: 'default', auto: 'skin' },
    top: outfit.top, bottom: outfit.bottom, details: outfit.details ?? [],
    backCue: outfit.backCue ?? c.backCue ?? { ...defaultBackCue(c, outfit), source: 'default', auto: 'back' },
  };
}

/** 文字層指紋：只算參與生圖的英文。改了它，照舊文字出的圖就過期。 */
/**
 * 某一張圖的文字指紋：人本身的描述（身份、臉、頭髮、身形、皮膚、上下裝、背面）+ 細節圖自己那一條細節。
 * 細節只決定「拍哪些特寫」，不算進其他檢視——加一個細節只多出一張圖，不會讓整組過期；
 * 改某條細節的文字，只有那張細節圖過期。要改角色本身的樣子，改外貌和服裝欄位。
 */
export function viewLayersHash(L, spec) {
  const base = [L.identity.age, L.identity.gender, en(L.identity), en(L.face), en(L.hair), en(L.build), en(L.skin),
    en(L.top), en(L.bottom), en(L.backCue)];
  const d = spec?.detail;
  return sha256(JSON.stringify(d ? [...base, [d.slot, d.id ?? null, d.part ?? null, en(d)]] : base)).slice(0, 16);
}

// medium 只在 drawn 時計入，老資產（寫實、沒有 medium 欄位）的指紋不變
export const lookHash = (look) => sha256(JSON.stringify([look.style, look.clean, look.neg, ...(look.medium === 'drawn' ? ['drawn'] : [])])).slice(0, 16);

/* ------------------------------------------------------------------ */
/* 提示詞                                                                */
/* ------------------------------------------------------------------ */
/*
 * 逐字沿用實測通過的寫法（Qwen 兩個角色 × 多個種子達標，同一套在 GPT 上也一次跑通）：
 *  - 改圖模型只有第一句明確要求時才改構圖：大頭照以 「Zoom in to an extreme close-up head-and-shoulders
 *    portrait, passport-photo framing」 開頭，並寫可量化的取景（頭頂貼上邊、下巴在正中、下邊切鎖骨）；
 *  - 背面用 「Rotate the camera 180 degrees around …」 + 只有背面看得到的特徵；
 *  - 細節圖第一句 「Zoom in to an extreme close-up of only …」，一致性只寫一句，**不列整套服裝**——
 *    列了整套，模型就把整個人畫出來（第一輪細節圖 8/8 失敗的原因）。
 */
export function buildPrompt(asset, outfitId, viewId, lookArg = null) {
  const outfit = asset.outfits[outfitId];
  const look = lookArg ?? outfit.look ?? DEFAULT_LOOK;   // 不傳就用這個造型自己的畫風快照
  const L = resolveLayers(asset, outfitId);
  const v = allViews(outfit)[viewId];
  if (!v) throw new Error(`沒有檢視 ${viewId}（可用：${Object.keys(allViews(outfit)).join(' / ')}）`);
  const { s, o, p } = pronouns(L.identity.gender);
  const who = `this same ${nounOf(L.identity.age, L.identity.gender)}`;
  const S = s[0].toUpperCase() + s.slice(1);
  const details = L.details.map((d) => en(d));
  // 畫出來的畫風（動漫等）不寫皮膚層：毛孔、雀斑這類照片質感會把畫面往寫實拽
  const drawn = look.medium === 'drawn';
  const look_ = [sentence(en(L.identity)), sentence(en(L.face)), sentence(en(L.hair)), L.build ? sentence(en(L.build)) : '',
    sentence(`${S} wears ${en(L.top)}; ${en(L.bottom)}`), ...details.map(sentence), drawn ? '' : sentence(en(L.skin))].filter(Boolean).join(' ');
  // 一致性清單要短，並按檢視取層（實測）：大頭照只保留臉、頭髮、上裝——寫了下裝和鞋，模型就拉遠鏡頭去畫；
  // 細節只在錨點裡寫一次，派生圖從錨點裡看得到，不再重複（列多了同樣把鏡頭往全身帶）。
  const same = (x) => `the same ${bare(en(x))}`;
  const keepList = (items) => `Keep ${o} exactly the same person as in the reference image: ${items.join(', ')}. ${look.style} ${look.clean}`;
  const keepFace = keepList(['same face, eyes and eyebrows', lowerFirst(en(L.hair)), same(L.top)]);
  const keep = keepList(['same face, eyes and eyebrows', lowerFirst(en(L.hair)), same(L.top), same(L.bottom)]);
  const tight = `Framing: the top of ${p} head is just below the top edge of the image, ${p} chin sits at the vertical middle of the image, ` +
    `and the bottom edge of the image cuts across ${p} collarbones.`;
  const reframe = `Framing reminder: the bottom edge of the image cuts across ${p} collarbones, so ${p} arms, sleeves and cuffs are out of frame.`;
  const neg = BASE_NEG + ', ' + look.neg;
  const faceNeg = FACE_NEG + ', ' + look.neg;

  let text, negative;
  switch (viewId) {
    case 'front-full':
      // 正面要寫成幾何：只寫 facing the camera，動漫畫風會按「官方角色圖」的習慣畫成微側身，
      // 派生圖照著錨點改，大頭照也跟著側過去（實測）。
      text = `Full-body front view: ${s} stands straight and faces the camera squarely, shoulders, hips and feet square to the camera, ` +
        `${p} face pointing straight at the camera with ${p} nose on the vertical centre line of ${p} face and both ears equally visible, ` +
        `arms relaxed at ${p} sides, the whole figure from head to feet visible and centered, with margin above the head and below the feet. ` +
        `${look_} ${look.style} ${look.clean}`;
      negative = neg + ', cropped feet, cropped head, three-quarter view, turned body, head turned to the side, contrapposto, dynamic pose';
      break;
    case 'face-front':
      // 取景在前、幾何在後、結尾再重申一次取景：正面的幾何描述寫長了會沖淡開頭的「拉近」，鏡頭又退回半身（實測）
      text = `Zoom in to an extreme close-up head-and-shoulders portrait, passport-photo framing, of ${who} facing the camera squarely. ` +
        `${tight} ${S} faces straight at the camera: ${p} nose is on the vertical centre line of the image and both ears are equally visible. ` +
        `${keepFace} ${reframe}`;
      negative = faceNeg + ', three-quarter view, head turned to the side, profile, tilted head';
      break;
    case 'face-45':
      text = `Zoom in to an extreme close-up head-and-shoulders portrait, passport-photo framing, of ${who}, and turn ${p} head and ` +
        `shoulders about 45 degrees toward the left side of the image: a three-quarter view with ${p} nose pointing toward the left edge ` +
        `of the image, ${p} left ear visible and ${p} right ear hidden. ${tight} ${keepFace}`;
      negative = faceNeg + ', frontal face, looking at camera, symmetrical face';
      break;
    case 'side-full':
      text = `Full-body side profile of ${who}: ${p} whole body and ${p} head both face the right edge of the image, looking straight ` +
        `ahead to the right, not at the camera. Only the right side of ${p} face is visible. Head to feet in frame. ${keep}`;
      negative = neg + ', looking at camera, front view, three-quarter view, both eyes visible, cropped feet';
      break;
    case 'back-full':
      text = `Rotate the camera 180 degrees around ${o}: a full-body back view. ${S} stands with ${p} back to the camera and ${p} face is ` +
        `completely hidden. We see ${en(L.backCue)}. Head to feet in frame. ${keep}`;
      negative = neg + ', face, eyes, nose, front view, buttons, pockets, looking at camera';
      break;
    default: {
      const d = v.detail;
      const age = L.identity.age;
      const skin = `Any visible skin is the skin of a ${age}-year-old.`;
      const byKey = {
        hair: `Zoom in to an extreme close-up ${drawn ? 'view' : 'macro photo'} of only ${en(d)}. It fills the entire frame and ${p} face is not visible; individual hair strands and fine texture are sharp.`,
        neck: `Zoom in to an extreme close-up of only ${p} neckline: ${en(d)} fill the entire frame. The frame is cropped below ${p} chin, so ${p} face is not visible. ${skin}`,
        sleeve: `Zoom in to an extreme close-up of only one sleeve cuff at the wrist: ${en(d)}. The cuff fills the entire frame; no face and no full body. ${skin}`,
        feet: `Zoom in to an extreme close-up of only ${p} feet and ankles: ${en(d)}, on a plain white floor. Only the feet and ankles are visible; no face and no upper body. ${skin}`,
        // 以下是自定義部位的取景（未實測的寫法同樣守「第一句只寫這個部位、寫清畫面邊界」）
        hands: `Zoom in to an extreme close-up of only ${p} hand: ${en(d)}. The hand fills the entire frame; no face and no full body. ${skin}`,
        waist: `Zoom in to an extreme close-up of only ${p} waist: ${en(d)}. It fills the entire frame; no face, no head and no legs.`,
        body: `Zoom in to an extreme close-up of only ${en(d)}. It fills the entire frame; no face and no full body. ${skin}`,
      };
      // 預設槽位按槽位取景；自定義按部位；老輸入裡自己寫了整句（以 Zoom in 開頭）的原樣使用
      const legacy = d.slot === 'custom' && /^Zoom in to /.test(String(d.en ?? ''));
      const frame = legacy ? sentence(en(d)) : byKey[d.slot === 'custom' ? d.part : d.slot];
      const two = v.refs.length > 1;
      text = `${frame} Same person, same clothing and materials as in the reference image${two ? 's' : ''}. ${look.style} ` +
        'Plain white background wherever any background shows. No text, no watermark.';
      negative = neg + (v.part === 'face' ? ', full body, wide shot, whole face' : ', face, head, portrait, full body, standing figure, wide shot, medium shot');
    }
  }
  return { view: viewId, text, negative, ratio: v.ratio, refs: v.refs };
}

/* ------------------------------------------------------------------ */
/* 一次性輸入：模型分類補全 → 這裡校驗 → 確認表                             */
/* ------------------------------------------------------------------ */
export const SOURCES = { stated: '原話', inferred: '推斷', default: '預設' };
const STYLE_WORDS = /\b(photo-?realistic|hyper-?realistic|anime|manga|cartoon|illustration|3d render|oil painting|watercolou?r|ghibli|cinematic|film still)\b/i;

export function intakeProblems(x) {
  const p = [];
  const need = (f, label) => {
    if (!f || typeof f !== 'object') { p.push(`缺 ${label}`); return; }
    if (!String(f.en ?? '').trim()) p.push(`${label} 缺英文（en）——生圖用英文`);
    if (!human(f)) p.push(`${label} 缺給人看的描述（text，用 lang 指定的語言）——確認表和報告要用`);
    if (f.source && !SOURCES[f.source]) p.push(`${label} 的 source 只能是 ${Object.keys(SOURCES).join(' / ')}`);
    if (CJK.test(String(f.en ?? ''))) p.push(`${label} 的英文裡混了中日韓字元`);
    if (STYLE_WORDS.test(String(f.en ?? ''))) p.push(`${label} 寫了畫風詞（${String(f.en).match(STYLE_WORDS)[0]}）——畫風由專案畫風層統一加，角色描述裡不寫`);
    if (x?.name && String(f.en ?? '').includes(x.name)) p.push(`${label} 的英文裡出現了角色名——生圖提示詞禁人名`);
    if (/\((inferred|推斷)\)/i.test(String(f.en ?? ''))) p.push(`${label} 的英文裡寫了推斷標記——標記只進確認表，寫進提示詞會被畫出來`);
  };
  if (!String(x?.name ?? '').trim()) p.push('缺 name（角色名）');
  const lang = x?.lang ?? 'zh';
  if (!LANG_RE.test(String(lang))) p.push(`lang 要寫語言程式碼（zh / en / ja / fr …），現在是 ${lang}`);
  else if (!BUILTIN.includes(lang)) {
    const miss = uiMissing(x?.ui);
    if (miss.length) p.push(`lang ${lang} 不是內建語言（${BUILTIN.join(' / ')}），要帶完整的 ui（執行 ui-template ${lang} 翻譯後放進 ui 欄位）；缺 ${miss.length} 項，如 ${miss.slice(0, 3).join('、')}`);
  }
  const id = x?.identity;
  need(id, 'identity 身份');
  if (id) {
    if (!Number.isInteger(id.age) || id.age < 1 || id.age > 110) p.push('identity.age 必須是整數歲');
    if (!['female', 'male'].includes(id.gender)) p.push('identity.gender 只能是 female / male');
    if (id.source === 'default') p.push('身份（年齡、性別、年代）不能用預設值——推不出來就問使用者，這三樣錯了整組圖都錯');
  }
  need(x?.face, 'face 臉型五官');
  need(x?.hair, 'hair 髮型');
  for (const k of ['build', 'skin', 'backCue']) if (x?.[k]) need(x[k], k);
  const o = x?.outfit;
  if (!o) p.push('缺 outfit（造型）');
  else {
    need(o.top, 'outfit.top 上裝');
    need(o.bottom, 'outfit.bottom 下裝');
    const seen = new Set();
    if ((o.details ?? []).length > MAX_DETAILS) p.push(`細節最多 ${MAX_DETAILS} 個（現在 ${o.details.length} 個）——挑最能認出這個角色的`);
    for (const [i, d] of (o.details ?? []).entries()) {
      const label = `outfit.details[${i}]`;
      if (d.slot !== 'custom' && !DETAIL_SLOTS[d.slot]) p.push(`${label} 的 slot 只能是 ${Object.keys(DETAIL_SLOTS).join(' / ')} / custom`);
      const key = d.slot === 'custom' ? `custom:${d.id}` : d.slot;
      if (seen.has(key)) p.push(`${label} 的槽位 ${key} 重複`);
      seen.add(key);
      if (d.slot === 'custom') {
        if (!/^[a-z0-9-]+$/.test(String(d.id ?? ''))) p.push(`${label} 自定義細節要有 id（小寫字母、數字、連字元）`);
        if (d.part === 'face') p.push(`${label} 臉上的特徵（眼鏡、疤、痣）不單獨出細節圖：正臉大頭照裡已經看得清，Qwen 實測也只會畫成整張大頭照——寫進 face 欄位就夠了`);
        else if (!DETAIL_PARTS.includes(d.part)) p.push(`${label} 自定義細節要寫 part：${DETAIL_PARTS.join(' / ')}`);
        if (DETAIL_SLOTS[d.id]) p.push(`${label} 的 id 不能和預設槽位同名（${d.id}）`);
      }
      const e = String(d.en ?? '');
      if (!/^Zoom in to /.test(e) && /\b(close-?up|zoom|macro|extreme)\b/i.test(e)) p.push(`${label} 只寫部位本身，不寫 close-up / zoom 這類取景詞——取景由腳本按部位加`);
      need(d, label);
    }
  }
  return p;
}

/** 終端顯示寬度：中日韓與全形算 2 格，其餘（含 °）算 1 格。 */
export const displayWidth = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0);
export const padDisplay = (s, w) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));

/** 確認表：給人看，按 lang 出，每項標來源。預設值也列出來，標「預設」。 */
export function confirmTable(x) {
  const ui = uiFor(x.lang ?? 'zh', x.ui);
  const tag = (f) => (f?.source && f.source !== 'stated' ? `  〔${ui.sources[f.source]}〕` : '') + (f?.slot === 'custom' ? `  〔${ui.untested}〕` : '');
  const id = x.identity;
  const skin = x.skin ?? { text: ui.defaultSkin[skinBand(id.age)], source: 'default' };
  const back = x.backCue ?? { text: ui.defaultBack, source: 'default' };
  const F = ui.fields;
  const rows = [
    [F.identity, fmt(ui.identityLine, { text: human(id), age: id.age, gender: ui[id.gender] ?? id.gender }), id],
    [F.face, human(x.face), x.face], [F.hair, human(x.hair), x.hair],
    ...(x.build ? [[F.build, human(x.build), x.build]] : []),
    [F.top, human(x.outfit.top), x.outfit.top], [F.bottom, human(x.outfit.bottom), x.outfit.bottom],
    [F.skin, human(skin), skin], [F.backCue, human(back), back],
    ...(x.outfit.details ?? []).map((d) => [fmt(F.detail, { x: d.slot === 'custom' ? d.id : ui.slots[d.slot] }), human(d), d]),
  ];
  const w = Math.max(...rows.map(([k]) => displayWidth(k)));
  return [fmt(ui.confirmTitle, { name: x.name, outfit: x.outfit.label ?? ui.outfitDefault }),
    ...rows.map(([k, v, f]) => `  ${padDisplay(k, w)}  ${v}${tag(f)}`)].join('\n');
}

/** 由確認過的輸入建角色資產。 */
export function assetFromIntake(intake, look = DEFAULT_LOOK) {
  const x = structuredClone(intake);   // 資產不和輸入共用物件，改資產不會改到輸入
  look = structuredClone(look);
  const id = x.outfit.id ?? 'default';
  const layers = { identity: x.identity, face: x.face, hair: x.hair };
  for (const k of ['build', 'skin', 'backCue']) if (x[k]) layers[k] = x[k];
  return {
    name: x.name,
    ...(x.source ? { source: x.source } : {}),
    lang: x.lang ?? 'zh',                   // 確認表與報告的語言；提示詞永遠英文
    ...(x.ui ? { ui: x.ui } : {}),          // 非內建語言的自譯文案
    layers,
    outfits: {
      [id]: {
        label: x.outfit.label ?? uiFor(x.lang ?? 'zh', x.ui).outfitDefault,
        top: x.outfit.top, bottom: x.outfit.bottom, details: x.outfit.details ?? [],
        overrides: x.outfit.overrides ?? {},
        look: { ...look },                  // 畫風快照：之後專案改畫風，不影響這組圖
        views: {},
        upgrades: [],
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 版本與過期                                                            */
/* ------------------------------------------------------------------ */
/*
 * 過期不存標記，每次現算：看這張圖記下的「文字指紋、畫風指紋、參考圖版本與檔案指紋」
 * 和現在是否一致。於是——
 *   重出錨點 → 其餘全部過期（它們的 refs 指向舊錨點）
 *   重出大頭照 → 只有掛了大頭照的那幾張細節過期
 *   改了文字描述 → 全部過期（錨點也是）
 * 過期只標記，不刪除；要不要重出由人決定。
 */
export const current = (outfit, viewId) => {
  const v = outfit.views?.[viewId];
  return v ? v.versions.find((x) => x.v === v.current) ?? null : null;
};

/** 過期原因（結構化，報告按語言翻譯）：{code: layers | look | ref-missing | ref-changed, view?, v?} */
export function staleCodes(asset, outfitId, viewId) {
  const outfit = asset.outfits[outfitId];
  const cur = current(outfit, viewId);
  if (!cur) return [];
  const why = [];
  const L = resolveLayers(asset, outfitId);
  if (cur.layersHash !== viewLayersHash(L, allViews(outfit)[viewId])) why.push({ code: 'layers' });
  if (cur.lookHash !== lookHash(outfit.look)) why.push({ code: 'look' });
  for (const r of cur.refs ?? []) {
    const now = current(outfit, r.view);
    if (!now) why.push({ code: 'ref-missing', view: r.view });
    else if (now.v !== r.v || now.sha256 !== r.sha256) why.push({ code: 'ref-changed', view: r.view, v: now.v });
  }
  return why;
}
const STALE_KEY = { layers: 'layers', look: 'look', 'ref-missing': 'refMissing', 'ref-changed': 'refChanged' };
export const staleText = (c, ui) => fmt(ui.stale[STALE_KEY[c.code]], c);

/** 過期原因的文字（命令列用中文；報告用 staleCodes + staleText 按語言出）。 */
export const staleReasons = (asset, outfitId, viewId, ui = uiFor('zh')) => staleCodes(asset, outfitId, viewId).map((c) => staleText(c, ui));

/** 錨點是否可以用來派生：確認過（true）或配置為自動確認（'auto'），且沒過期。 */
export function anchorUsable(asset, outfitId) {
  const a = current(asset.outfits[outfitId], ANCHOR);
  if (!a) return { ok: false, why: '還沒有錨點（正面全身），先出第一檔' };
  if (!a.confirmed) return { ok: false, why: '錨點還沒確認——看過圖後執行 confirm；不想每次確認，在配置裡關掉 confirmAnchor' };
  const s = staleReasons(asset, outfitId, ANCHOR);
  if (s.length) return { ok: false, why: `錨點已過期：${s.join('；')}——先重出錨點` };
  return { ok: true };
}

/**
 * 解析一張圖該掛哪些參考圖：永遠取「當前有效」的那一版，不看它是哪個模型出的。
 * 大頭照缺失或過期時退回只掛錨點，不阻塞——記錄裡能看出少了一張。
 */
export function resolveRefs(asset, outfitId, prompt) {
  const outfit = asset.outfits[outfitId];
  const refs = [];
  const notes = [];
  for (const rv of prompt.refs) {
    const cur = current(outfit, rv);
    if (!cur || staleReasons(asset, outfitId, rv).length) {
      if (rv === ANCHOR) throw new Error('錨點不可用');
      notes.push(`${rv} 缺失或已過期，這張只掛錨點`);
      continue;
    }
    refs.push({ view: rv, v: cur.v, sha256: cur.sha256, file: cur.file });
  }
  return { refs, notes };
}

/* ------------------------------------------------------------------ */
/* 檢查門（全部程式碼判斷）                                                 */
/* ------------------------------------------------------------------ */
// 三家影片模型（H3 / Wan / Seedance）對參考圖要求的交集：單邊 300–5760、寬高比 0.4–2.5、≤ 20MB
export const LIMITS = { minSide: 300, maxSide: 5760, minRatio: 0.4, maxRatio: 2.5, maxBytes: 20 * 2 ** 20, ratioTol: 0.02, white: 0.95 };

function borderWhite(img, upperOnly) {
  const { width: w, height: h, bpp, px } = img;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  let white = 0, n = 0;
  for (let y = 0; y < (upperOnly ? h / 2 : h); y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * bpp;
      n++;
      const g = bpp < 3;
      const transparent = (bpp === 2 || bpp === 4) && px[i + bpp - 1] < 128;   // 透明的邊按白算（落盤前本來也會鋪白）
      if (transparent || (px[i] >= 235 && (g || (px[i + 1] >= 235 && px[i + 2] >= 235)))) white++;
    }
  }
  return white / n;
}

/**
 * @returns [{id, label, ok, detail}] —— 跳過的門也列出來並寫明原因，不靜默。
 */
export function gates(buf, ratio, kind) {
  const out = [];
  const add = (id, label, ok, detail = '') => out.push({ id, label, ok, detail });
  if (!isPng(buf)) {
    add('format', '檔案是 PNG', false, '不是 PNG，尺寸與背景無法檢查');
    return out;
  }
  const { width: w, height: h } = pngInfo(buf);
  const r = w / h;
  add('size', `單邊 ${LIMITS.minSide}–${LIMITS.maxSide} 畫素`, Math.min(w, h) >= LIMITS.minSide && Math.max(w, h) <= LIMITS.maxSide, `${w}×${h}`);
  add('ratio-range', `寬高比 ${LIMITS.minRatio}–${LIMITS.maxRatio}`, r >= LIMITS.minRatio && r <= LIMITS.maxRatio, r.toFixed(3));
  add('ratio-target', `比例為 ${ratio}`, Math.abs(r - RATIOS[ratio]) <= LIMITS.ratioTol, r.toFixed(3));
  add('bytes', '檔案 ≤ 20MB', buf.length <= LIMITS.maxBytes, `${(buf.length / 2 ** 20).toFixed(1)}MB`);
  if (kind === 'detail') {
    add('white', '背景夠白', true, '細節圖畫面多是衣物，不查背景（跳過）');
  } else {
    const img = decode(buf);
    if (!img) add('white', '背景夠白', true, '非 8 位 PNG，無法解畫素（跳過）');
    else {
      const wr = borderWhite(img, kind === 'face');
      add('white', kind === 'face' ? '上邊與兩側上半夠白' : '四邊夠白', wr >= LIMITS.white, `${Math.round(wr * 100)}% 近白`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 落一版圖（真實生圖與自測共用）                                           */
/* ------------------------------------------------------------------ */
/**
 * 把一張新出的圖記成這個檢視的新版本：打 iTXt 標識、算指紋、跑門、記下參考圖的版本與指紋。
 * 舊版本不刪——重出只是多一版，要退回就把 current 改回去。
 * @param confirmMode 僅錨點：'wait'（等人確認）| 'auto'（配置為不確認）
 * @returns {{version, buf}} buf 是打過標識、應寫盤的位元組
 */
export function recordVersion(asset, oid, view, { buf, model, seed = null, prompt, refs = [], notes = [], confirmMode = 'wait', now = new Date() }) {
  const outfit = asset.outfits[oid];
  const spec = allViews(outfit)[view];
  const slot = (outfit.views[view] ??= { current: 0, versions: [] });
  const v = Math.max(0, ...slot.versions.map((x) => x.v)) + 1;
  const id = `${asset.name}/${oid}/${view}/v${v}`;
  const out = isPng(buf) ? withText(buf, { 'shuohao:id': id, 'shuohao:model': model, 'shuohao:refs': refs.map((r) => `${r.view}/v${r.v}`).join(',') }) : buf;
  const g = gates(out, spec.ratio, spec.kind);
  const version = {
    v, id, file: `${oid}/${view}.v${v}.png`, sha256: sha256(out), model, seed,
    prompt: prompt.text, negative: prompt.negative,
    refs: refs.map(({ view: rv, v: rvv, sha256: rs }) => ({ view: rv, v: rvv, sha256: rs })), notes,
    layersHash: viewLayersHash(resolveLayers(asset, oid), spec), lookHash: lookHash(outfit.look),
    gates: g, createdAt: now.toISOString(),
    // 配置為自動確認時，也只放行過了門的錨點：沒過門的錨點要人看過再 confirm，或者重出
    ...(view === ANCHOR ? { confirmed: confirmMode === 'auto' && g.every((x) => x.ok) ? 'auto' : false } : {}),
  };
  slot.versions.push(version);
  slot.current = v;
  return { version, buf: out };
}
