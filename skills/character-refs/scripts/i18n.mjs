// 給人看的文案：報告介面與確認表。內建中文、英文、日文；其他語言由模型照 ui-template 現場翻一份，
// 寫進 intake 的 ui 欄位（或 render --ui 傳檔案）。命令列的提示資訊是給 agent 看的，不在這裡。
//
// 模板裡的 {n} {v} {name} 之類佔位符由 fmt() 填。

export const UI = {
  zh: {
    htmlLang: 'zh-TW',
    title: '角色參考圖',
    lead: '一張確認過的正面全身照（錨點）為根，其餘每張都只參考它。',
    staleLegend: '紅框 = 已過期：錨點、參考圖或文字描述變了，這張要重出。滑鼠移到圖上可以看原因。',
    layout: '版面', without: '無細節圖', with: '有細節圖',
    views: {
      'front-full': '正面全身（錨點）', 'face-front': '正臉大頭照', 'side-full': '側面 90°（面朝右）',
      'back-full': '背面', 'face-45': '45° 大頭照（面朝左）',
    },
    slots: { hair: '頭髮 / 髮飾', neck: '領口', sleeve: '袖口', feet: '鞋' },
    fields: {
      identity: '身份', face: '臉型五官', hair: '髮型', build: '身形', top: '上裝', bottom: '下裝',
      skin: '皮膚', backCue: '背面', detail: '細節 · {x}',
    },
    sources: { stated: '原話', inferred: '推斷', default: '預設' }, untested: '未實測',
    identityLine: '{text}（{age} 歲 · {gender}）', female: '女', male: '男',
    outfitDefault: '常態',
    confirmTitle: '{name} · {outfit} · 待確認',
    descSummary: '角色描述（確認表）',
    notGenerated: '未生成 · 第 {n} 檔',
    noAnchor: '還沒有錨點', anchorConfirmed: '錨點已確認', anchorAuto: '錨點未經人工確認（配置為自動）', anchorPending: '錨點待確認',
    tier1Only: '第一檔 · 只有錨點', tierN: '第 {n} 檔', look: '畫風：{x}',
    looks: { 'realistic-photo': '寫實照片', anime: '動漫' },
    face45Extra: '45° 大頭照（第四檔，不進版面）',
    mixed: '這組圖混用了 {x}：一致性來自同一張錨點，可以混用，請多看一眼質感是否銜接。',
    allViews: '全部檢視',
    th: { view: '檢視', tier: '檔', version: '版本', model: '模型', seed: '種子', id: '標識', state: '狀態' },
    stNone: '未生成', stStale: '已過期', stGate: '門未過',
    stale: { layers: '文字描述改過了', look: '畫風快照變了', refMissing: '參考圖 {view} 不見了', refChanged: '參考圖 {view} 已換成 v{v}' },
    gates: {
      format: '檔案是 PNG', size: '單邊 300–5760 畫素', 'ratio-range': '寬高比 0.4–2.5', 'ratio-target': '比例為 {x}',
      bytes: '檔案 ≤ 20MB', whiteFull: '四邊夠白', whiteFace: '上邊與兩側上半夠白', white: '背景夠白',
    },
    defaultSkin: {
      young: '年輕皮膚，鼻翼臉頰有細微毛孔，膚色自然略不勻，素顏',
      adult: '成年人的自然皮膚，可見毛孔，膚色略不勻',
      old: '上了年紀的皮膚，風吹日曬，有老年斑，皺紋順表情肌走',
    },
    defaultBack: '從後面看到的髮型、上衣與下裝的背面、腳跟',
  },
  en: {
    htmlLang: 'en',
    title: 'Character references',
    lead: 'One confirmed front full-body image (the anchor) is the root; every other image references only it.',
    staleLegend: 'Red outline = stale: the anchor, a reference image or the text description changed, so this image needs regenerating. Hover over it to see why.',
    layout: 'Layout', without: 'Without details', with: 'With details',
    views: {
      'front-full': 'Front full body (anchor)', 'face-front': 'Front headshot', 'side-full': '90° profile (facing right)',
      'back-full': 'Back', 'face-45': '45° headshot (facing left)',
    },
    slots: { hair: 'Hair / accessory', neck: 'Neckline', sleeve: 'Cuff', feet: 'Shoes' },
    fields: {
      identity: 'Identity', face: 'Face', hair: 'Hair', build: 'Build', top: 'Top', bottom: 'Bottom',
      skin: 'Skin', backCue: 'Back', detail: 'Detail · {x}',
    },
    sources: { stated: 'stated', inferred: 'inferred', default: 'default' }, untested: 'untested',
    identityLine: '{text} ({age} · {gender})', female: 'female', male: 'male',
    outfitDefault: 'Everyday',
    confirmTitle: '{name} · {outfit} · to confirm',
    descSummary: 'Character description (confirmation table)',
    notGenerated: 'Not generated · tier {n}',
    noAnchor: 'No anchor yet', anchorConfirmed: 'Anchor confirmed', anchorAuto: 'Anchor not reviewed by a person (auto-confirm)', anchorPending: 'Anchor awaiting confirmation',
    tier1Only: 'Tier 1 · anchor only', tierN: 'Tier {n}', look: 'Style: {x}',
    looks: { 'realistic-photo': 'Realistic photo', anime: 'Anime' },
    face45Extra: '45° headshot (tier 4, outside the sheet)',
    mixed: 'This set mixes {x}. Consistency comes from sharing one anchor, so mixing is fine — just check the images still match in texture.',
    allViews: 'All views',
    th: { view: 'View', tier: 'Tier', version: 'Version', model: 'Model', seed: 'Seed', id: 'Label', state: 'Status' },
    stNone: 'Not generated', stStale: 'Stale', stGate: 'Failed checks',
    stale: { layers: 'text description changed', look: 'style snapshot changed', refMissing: 'reference {view} is missing', refChanged: 'reference {view} is now v{v}' },
    gates: {
      format: 'File is a PNG', size: 'Each side 300–5760 px', 'ratio-range': 'Aspect ratio 0.4–2.5', 'ratio-target': 'Ratio is {x}',
      bytes: 'File ≤ 20 MB', whiteFull: 'All four edges white', whiteFace: 'Top and upper sides white', white: 'Background white',
    },
    defaultSkin: {
      young: 'Young skin with faint pores on the nose and cheeks and a slightly uneven natural tone, no makeup',
      adult: 'Natural adult skin with visible pores and a slightly uneven tone',
      old: 'Aged, weathered skin with visible pores, age spots and wrinkles that follow the expression lines',
    },
    defaultBack: 'The hair seen from behind, the back of the top and bottom, and the heels',
  },
  ja: {
    htmlLang: 'ja',
    title: 'キャラクター参照画像',
    lead: '確認済みの正面全身画像（アンカー）を起点に、他の画像はすべてそれだけを参照します。',
    staleLegend: '赤枠 = 期限切れ：アンカー・参照画像・テキスト記述が変更されたため、作り直しが必要です。画像にカーソルを合わせると理由が表示されます。',
    layout: 'レイアウト', without: 'ディテールなし', with: 'ディテールあり',
    views: {
      'front-full': '正面全身（アンカー）', 'face-front': '正面バストアップ', 'side-full': '真横 90°（右向き）',
      'back-full': '背面', 'face-45': '45° バストアップ（左向き）',
    },
    slots: { hair: '髪 / 髪飾り', neck: '襟元', sleeve: '袖口', feet: '靴' },
    fields: {
      identity: '人物', face: '顔立ち', hair: '髪型', build: '体格', top: 'トップス', bottom: 'ボトムス',
      skin: '肌', backCue: '背面', detail: 'ディテール · {x}',
    },
    sources: { stated: '原文', inferred: '推定', default: '既定' }, untested: '未検証',
    identityLine: '{text}（{age} 歳 · {gender}）', female: '女性', male: '男性',
    outfitDefault: '普段着',
    confirmTitle: '{name} · {outfit} · 確認待ち',
    descSummary: 'キャラクター記述（確認表）',
    notGenerated: '未生成 · 第 {n} 段階',
    noAnchor: 'アンカー未生成', anchorConfirmed: 'アンカー確認済み', anchorAuto: 'アンカーは人の確認なし（自動確認の設定）', anchorPending: 'アンカー確認待ち',
    tier1Only: '第 1 段階 · アンカーのみ', tierN: '第 {n} 段階', look: '画風：{x}',
    looks: { 'realistic-photo': '写実写真', anime: 'アニメ' },
    face45Extra: '45° バストアップ（第 4 段階、シート外）',
    mixed: 'このセットは {x} を混用しています。一貫性は同じアンカーから来るので混用は可能ですが、質感がつながっているか確認してください。',
    allViews: '全ビュー',
    th: { view: 'ビュー', tier: '段階', version: '版', model: 'モデル', seed: 'シード', id: '識別子', state: '状態' },
    stNone: '未生成', stStale: '期限切れ', stGate: 'チェック不合格',
    stale: { layers: 'テキスト記述が変更された', look: '画風スナップショットが変わった', refMissing: '参照画像 {view} がない', refChanged: '参照画像 {view} が v{v} に更新された' },
    gates: {
      format: 'PNG ファイル', size: '各辺 300–5760 px', 'ratio-range': 'アスペクト比 0.4–2.5', 'ratio-target': '比率 {x}',
      bytes: 'ファイル ≤ 20MB', whiteFull: '四辺が白い', whiteFace: '上辺と両側上半分が白い', white: '背景が白い',
    },
    defaultSkin: {
      young: '若い肌、小鼻と頬にかすかな毛穴、自然でわずかにむらのある肌色、すっぴん',
      adult: '大人の自然な肌、毛穴が見え、肌色にわずかなむら',
      old: '年を重ねた日焼けした肌、毛穴、シミ、表情に沿ったしわ',
    },
    defaultBack: '後ろから見た髪型、トップスとボトムスの背面、かかと',
  },
};

export const BUILTIN = Object.keys(UI);
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

/** 把 base 的每個葉子鍵列出來（a.b.c），用來檢查自譯的 ui 是否齊全。 */
function leaves(o, pre = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`]));
}
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    if (k.startsWith('_')) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}

/** 自譯 ui 缺了哪些鍵（非內建語言必須齊全，否則報告半中半英）。 */
export function uiMissing(ui) {
  return leaves(UI.en).filter((p) => typeof get(ui ?? {}, p) !== 'string' || !get(ui, p).trim());
}

/**
 * 取某語言的文案。內建語言可以只覆蓋一部分；其他語言必須給齊全的 ui，否則拋錯。
 * @param lang 語言程式碼，預設 zh
 * @param custom intake / asset 裡的 ui，或 render --ui 讀進來的
 */
export function uiFor(lang = 'zh', custom = null) {
  if (UI[lang]) return custom ? merge(UI[lang], custom) : UI[lang];
  const miss = uiMissing(custom);
  if (miss.length) throw new Error(`語言 ${lang} 不是內建語言（${BUILTIN.join(' / ')}），要給一份完整的 ui（ui-template ${lang}）；缺 ${miss.length} 項，如 ${miss.slice(0, 4).join('、')}`);
  return merge(UI.en, custom);
}

/** 填佔位符 {x}。 */
export const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** 給模型翻譯用的骨架：英文原文 + 說明。 */
export function uiTemplate(lang) {
  return {
    _說明: [
      `把每個值翻譯成 ${lang}，保留 {n} {x} {name} 這類佔位符原樣不動；鍵名不要改。`,
      '翻好後整塊放進 intake.json 頂層的 ui 欄位（同時寫 "lang": "' + lang + '"），或存成檔案用 render --ui 傳入。',
    ],
    ...structuredClone(UI.en),
    htmlLang: lang,
  };
}
