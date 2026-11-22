// 畫風預設表。畫風層只管「怎麼畫」（介質、線條、光、背景），不管「畫誰」——長相、服裝在角色層。
// 建角色時整份快照進造型（outfit.look），之後改這裡不影響已有角色；要換就 restyle，換完全組標過期。
//
// 每個預設：
//   id       穩定的英文 id，寫進資產
//   names    命令列認的名字（中英日都行，不分大小寫）
//   label    給人看的名字 { zh, en, ja }
//   medium   'photo'（照片：角色的皮膚層進提示詞）| 'drawn'（畫出來的：不寫毛孔、顆粒這類照片質感）
//   style / clean / neg   拼進提示詞的三段英文
//
// 加新預設：照下面的格式加一項，再用真模型把四檔跑一遍、看過圖再合併——沒實測過的預設不要放進來。

// 寫實（方案四）：使用者確認過的基線（2026-09-26）。只寫相機、光、介質；皮膚粗糙到什麼程度是角色屬性，不寫在這裡——
// 統一寫「泛紅、小瑕疵」會把 19 歲的角色畫成病容（實測）。不寫 photorealistic：它會把畫面往 CG 渲染帶。
const REALISTIC = {
  id: 'realistic-photo',
  // 使用者輸入簡繁都收；実写是日文。 zh-tw-lint: allow
  names: ['realistic-photo', 'realistic', 'photo', '寫實', '寫實照片', '写实', '写实照片', '真人', '実写'], // zh-tw-lint: allow
  label: { zh: '寫實照片', en: 'Realistic photo', ja: '寫実寫真' },
  medium: 'photo',
  style: 'A real photograph, not a render: shot on a full-frame digital camera with an 85mm portrait lens at f/5.6, natural true-to-life ' +
    "colors and white balance. Natural skin texture with the pores and fine lines the person's age calls for, a no-makeup look, " +
    'no retouching, no beauty filter. Real fabric with natural creases. Subtle film grain.',
  clean: 'White seamless paper backdrop lit to pure white. A soft directional key light from the front-left with a weaker fill, so the face ' +
    'and clothes have gentle natural shadows and volume. Exactly one person, empty hands, no props, no text, no watermark.',
  neg: 'CGI, 3D render, digital painting, illustration, anime, airbrushed skin, smooth plastic skin, waxy skin, doll face, ' +
    'beauty filter, overly symmetrical face, oversharpened, HDR, glossy, over-saturated, flat lighting, porcelain skin, big anime eyes',
};

// 動漫：日式電視動畫的角色設定稿質感。不寫 model sheet / turnaround——寫了模型會在一張圖裡畫多個檢視。
const ANIME = {
  id: 'anime',
  names: ['anime', 'cartoon', '動漫', '动漫', '卡通', '二次元', 'アニメ'], // zh-tw-lint: allow
  label: { zh: '動漫', en: 'Anime', ja: 'アニメ' },
  medium: 'drawn',
  style: 'A clean 2D Japanese anime illustration, like official character art for a TV anime: crisp confident line art of even weight, ' +
    'cel shading with one soft shadow tone and a few sharp highlights, flat clean colors, anime-style eyes with clear highlights, ' +
    'a small simplified nose and mouth, hair drawn in smooth clumps with glossy highlight bands. Fabric folds drawn as simple lines.',
  clean: 'Plain pure white background, evenly lit, with at most a faint soft shadow under the feet. Exactly one character, empty hands, ' +
    'no props, no text, no watermark.',
  neg: 'photograph, photorealistic, realistic skin texture, pores, film grain, 3D render, CGI, semi-realistic, painterly, watercolor, ' +
    'sketch, rough lines, messy lines, heavy shading, gradient background, character sheet, multiple views, chibi, super deformed',
};

export const LOOKS = [REALISTIC, ANIME];
// 預設動漫（使用者 2026-09-26 定）；寫實用 --look 寫實
export const DEFAULT_LOOK_ID = 'anime';

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** 按名字找預設（中英日都認）；找不到返回 null。 */
export function findLook(name) {
  const n = norm(name);
  return LOOKS.find((l) => l.id === n || l.names.some((x) => norm(x) === n)) ?? null;
}

/** 寫進資產的快照：去掉命令列才用的 names，其餘原樣。 */
export function lookSnapshot(preset) {
  const { names, ...rest } = preset;
  return structuredClone(rest);
}

export const DEFAULT_LOOK = lookSnapshot(findLook(DEFAULT_LOOK_ID));

/** 畫風層的名字：預設按語言取，自定義畫風取它自己的 label（字串或 {zh,en,…}）。 */
export function lookName(look, lang = 'zh') {
  const l = look?.label;
  if (!l) return look?.id ?? '';
  if (typeof l === 'string') return l;
  return l[lang] ?? l.en ?? l.zh ?? Object.values(l)[0] ?? look.id;
}

/** 自定義畫風檔案的問題清單。 */
export function lookProblems(look) {
  const p = [];
  for (const k of ['style', 'clean', 'neg']) if (!String(look?.[k] ?? '').trim()) p.push(`畫風層缺 ${k}`);
  if (look?.medium && !['photo', 'drawn'].includes(look.medium)) p.push('medium 只能是 photo / drawn');
  if (!/white/i.test(String(look?.clean ?? ''))) p.push('clean 裡要寫白色背景（white background）——檢查門查背景白度，影片模型也要乾淨的參考圖');
  return p;
}
