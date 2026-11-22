#!/usr/bin/env node
// 自測：覆蓋所有確定性邏輯。不呼叫任何真實模型、不花額度——
// Qwen 與 GPT Image 用本地假伺服器校驗請求形狀，完整流程用自定義命令模板造白底圖。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chunks, crc32, decode, flattenAlpha, pngInfo, readText, solidPng, withText } from './png.mjs';
import { deflateSync } from 'node:zlib';
import {
  ANCHOR, DEFAULT_LOOK, allViews, anchorUsable, assetFromIntake, buildPrompt, confirmTable, current, defaultSkin, gates,
  intakeProblems, nounOf, resolveLayers, pronouns, recordVersion, resolveRefs, staleReasons, viewsOfTier,
} from './core.mjs';
import {
  QWEN_SIZES, codexStdin, configMissing, fillTemplate, loadConfig, maskConfig, modelKind, openaiGenerate, openaiRequest,
  parseEnv, quoteShellArg, qwenEndpoint, qwenGenerate, qwenWorkflow,
} from './models.mjs';
import { renderHtml, safeName } from './character-refs.mjs';
import { BUILTIN, UI, fmt, uiFor, uiMissing, uiTemplate } from './i18n.mjs';
import { LOOKS, findLook, lookName, lookProblems, lookSnapshot } from './looks.mjs';
import { lookHash } from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'character-refs.mjs');
const INTAKE = JSON.parse(readFileSync(join(here, '..', 'examples', '阿禾-intake.json'), 'utf8'));
const clone = (x) => structuredClone(x);
const REAL = lookSnapshot(findLook('寫實'));
const A0 = () => assetFromIntake(INTAKE, REAL);
let passed = 0;
const ok = (c, label) => { assert.ok(c, label); passed++; };
const eq = (a, b, label) => { assert.equal(a, b, `${label} — 期望 ${b}，實際 ${a}`); passed++; };
const TMP = mkdtempSync(join(tmpdir(), 'character-refs-selftest-'));

/* ---------------- PNG ---------------- */
{
  const png = solidPng(40, 60, [255, 255, 255]);
  const info = pngInfo(png);
  ok(info.width === 40 && info.height === 60 && info.depth === 8, '讀得出尺寸與位深');
  const tagged = withText(png, { 'shuohao:id': '阿禾/default/front-full/v1', 'shuohao:model': 'qwen' });
  eq(readText(tagged)['shuohao:id'], '阿禾/default/front-full/v1', 'iTXt 標識寫入後讀回（含中文）');
  eq(readText(tagged)['shuohao:model'], 'qwen', '多個標識都在');
  const again = withText(tagged, { 'shuohao:id': '阿禾/default/front-full/v2' });
  eq(readText(again)['shuohao:id'], '阿禾/default/front-full/v2', '同名標識替換而不是重複');
  eq(chunks(again).filter((c) => c.type === 'iTXt').length, 2, '替換後標識塊數量不變');
  ok(chunks(again).every((c) => c.type === 'IEND' || again.readUInt32BE(c.end - 4) === crc32(again.subarray(c.start + 4, c.end - 4))), '每一塊的 CRC 都對');
  eq(chunks(again).at(-1).type, 'IEND', 'IEND 仍在最後');
  const px = decode(tagged);
  ok(px && px.px[0] === 255 && px.px.length === 40 * 60 * 3, '打標識後畫素不變、能解');
}

/* ---------------- 透明背景 ---------------- */
// 手搓一張 RGBA：四周透明（畫素是透明的黑，和 codex 出的一樣），中間一塊不透明的藍
function rgbaPng(w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    const inside = x > w / 4 && x < (w * 3) / 4 && y > h / 4 && y < (h * 3) / 4;
    raw.set(inside ? [30, 60, 160, 255] : [0, 0, 0, 0], o);
  }
  const ck = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ck('IHDR', ihdr), ck('IDAT', deflateSync(raw)), ck('IEND', Buffer.alloc(0))]);
}
{
  const t = rgbaPng(400, 600);
  ok(Object.fromEntries(gates(t, '2:3', 'full').map((x) => [x.id, x])).white.ok, '透明背景的邊按白算，不誤判成 0%');
  const f = flattenAlpha(t);
  ok(f.changed && pngInfo(f.buf).colorType === 2, '透明 PNG 鋪白後存成不透明的 RGB');
  const d = decode(f.buf);
  ok(d.px[0] === 255 && d.px[1] === 255 && d.px[2] === 255, '透明的黑鋪成純白');
  const mid = (300 * 400 + 200) * 3;
  ok(d.px[mid] === 30 && d.px[mid + 2] === 160, '不透明的部分顏色不變');
  eq(flattenAlpha(solidPng(10, 10)).changed, false, '本來不透明的圖原樣返回');
  {
    const opaque = decode(rgbaPng(40, 60));
    for (let i = 3; i < opaque.px.length; i += 4) opaque.px[i] = 255;
    const raw = Buffer.alloc(60 * (40 * 4 + 1));
    for (let y = 0; y < 60; y++) opaque.px.copy(raw, y * 161 + 1, y * 160, (y + 1) * 160);
    const t = rgbaPng(40, 60);
    const idat = chunks(t).find((c) => c.type === 'IDAT');
    const ck = (d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from('IDAT'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
    const opq = Buffer.concat([t.subarray(0, idat.start), ck(deflateSync(raw)), t.subarray(idat.end)]);
    eq(flattenAlpha(opq).changed, false, '帶透明度通道但全是不透明（Qwen 出的就是）：原樣保留、不留注');
  }
}

/* ---------------- 檢查門 ---------------- */
const g = (buf, ratio, kind) => Object.fromEntries(gates(buf, ratio, kind).map((x) => [x.id, x]));
{
  const white = solidPng(400, 600);
  ok(Object.values(g(white, '2:3', 'full')).every((x) => x.ok), '白底 2:3 全身圖全過');
  const framed = solidPng(400, 600, null, (x, y) => (x < 20 ? [40, 40, 40] : [255, 255, 255]));
  ok(!g(framed, '2:3', 'full').white.ok, '左邊一條深色：全身圖四邊不夠白被攔');
  const bust = solidPng(400, 500, null, (x, y) => (y > 300 ? [20, 20, 60] : [255, 255, 255]));
  ok(g(bust, '4:5', 'face').white.ok, '大頭照身體頂到下邊：只查上邊與兩側上半，不誤攔');
  ok(!g(bust, '4:5', 'full').white.ok, '同一張圖按全身圖查就會被攔——大頭照必須分開寫');
  const det = g(solidPng(400, 400, [20, 20, 60]), '1:1', 'detail').white;
  ok(det.ok && det.detail.includes('跳過'), '細節圖不查背景，且明說跳過');
  ok(!g(solidPng(400, 400), '2:3', 'full')['ratio-target'].ok, '比例不對被攔');
  ok(!g(solidPng(200, 300), '2:3', 'full').size.ok, '單邊小於 300 被攔');
  ok(!g(solidPng(100, 400), '2:3', 'full')['ratio-range'].ok, '寬高比出了 0.4–2.5 被攔');
  ok(!g(Buffer.from('not a png'), '2:3', 'full').format.ok, '不是 PNG 明說無法檢查');
}

/* ---------------- 一次性輸入 ---------------- */
eq(intakeProblems(INTAKE).length, 0, '樣例輸入零問題');
const bad = (mut, word, label) => {
  const x = clone(INTAKE);
  mut(x);
  ok(intakeProblems(x).some((p) => p.includes(word)), label);
};
bad((x) => delete x.face, 'face', '缺臉型五官被攔');
bad((x) => { x.hair.en = '一條粗辮'; }, '中日韓', '英文欄位混中文被攔');
bad((x) => { x.face.en += ', anime style'; }, '畫風詞', '角色描述裡寫畫風被攔——畫風由畫風層統一加');
bad((x) => { x.face.en += ' like 阿禾'; }, '角色名', '英文裡出現角色名被攔');
bad((x) => { x.identity.source = 'default'; }, '不能用預設值', '身份用預設值被攔——推不出來就問');
bad((x) => { x.identity.age = '十六'; }, 'age', '年齡不是整數被攔');
bad((x) => { x.identity.gender = 'girl'; }, 'gender', '性別只收 female / male');
bad((x) => { x.outfit.details.push({ ...x.outfit.details[0] }); }, '重複', '同一細節槽位寫兩次被攔');
bad((x) => { x.outfit.details.push({ slot: 'custom', id: 'pen', part: 'body', en: 'a close-up of the fountain pen', text: '鋼筆' }); }, '取景詞', '自定義細節寫了 close-up 被攔——取景由腳本加');
bad((x) => { x.outfit.details.push({ slot: 'custom', id: 'pen', part: 'chest', en: 'the fountain pen', text: '鋼筆' }); }, 'part', '部位不在列表裡被攔');
bad((x) => { x.outfit.details.push({ slot: 'custom', id: 'glasses', part: 'face', en: 'his round glasses', text: '眼鏡' }); }, '正臉大頭照', '臉部細節被攔，並說明大頭照已經看得清');
bad((x) => { x.outfit.details.push({ slot: 'custom', id: 'hair', part: 'hair', en: 'a hairpin', text: '髮簪' }); }, '同名', '自定義 id 和預設槽位同名被攔');
bad((x) => { for (let i = 0; i < 5; i++) x.outfit.details.push({ slot: 'custom', id: `c${i}`, part: 'body', en: 'a patch', text: '補丁' }); }, '最多', '細節超過 8 個被攔');
bad((x) => { x.face.en += ' (inferred)'; }, '推斷標記', '推斷標記寫進英文被攔——會被畫進畫面');
bad((x) => { x.outfit.top.source = 'guess'; }, 'source', 'source 只收三種');
{
  const x = clone(INTAKE);
  x.outfit.details.push({ slot: 'custom', id: 'collar-tag', part: 'neck', en: 'Zoom in to an extreme close-up of only the frayed edge of her collar.', text: '領口磨毛的邊' });
  x.outfit.details.push({ slot: 'custom', id: 'fingertips', part: 'hands', en: 'her fingertips stained green from picking tea', text: '被茶汁染綠的指尖', source: 'stated' });
  eq(intakeProblems(x).length, 0, '自定義細節放行：只寫部位的新寫法，和老輸入的整句寫法');
  const a = assetFromIntake(x);
  const hp = buildPrompt(a, 'default', 'detail-fingertips');
  ok(hp.text.startsWith('Zoom in to an extreme close-up of only her hand: her fingertips stained green') && hp.text.includes('16-year-old'), '自定義「手」：腳本按部位加取景，寫明年齡');
  ok(hp.negative.includes('full body') && hp.refs.join() === 'front-full', '手部細節只掛錨點，反向詞禁全身');
  const mp = buildPrompt(a, 'default', 'detail-collar-tag');
  ok(mp.text.startsWith('Zoom in to an extreme close-up of only the frayed edge of her collar.') && mp.refs.join() === 'front-full,face-front', '老輸入的整句原樣使用；領口細節掛錨點 + 大頭照');
  ok(confirmTable(x).includes('〔未實測〕') && !confirmTable(INTAKE).includes('〔未實測〕'), '確認表給自定義細節標「未實測」，預設槽位不標');
  eq(allViews(a.outfits.default)['detail-fingertips'].tested, false, '檢視記下是否實測過');
}
{
  const x = clone(INTAKE);
  for (const f of [x.identity, x.face, x.hair, x.outfit.top]) { f.zh = f.text; delete f.text; }
  eq(intakeProblems(x).length, 0, '舊輸入寫 zh 而不是 text，照樣認');
  ok(confirmTable(x).includes('十六歲採茶姑娘'), '舊輸入的 zh 進確認表');
}
bad((x) => { delete x.face.text; }, 'text', '缺給人看的描述被攔');
bad((x) => { x.lang = 'Chinese'; }, '語言程式碼', 'lang 不是語言程式碼被攔');
bad((x) => { x.lang = 'fr'; }, 'ui-template fr', '非內建語言沒帶 ui 被攔，並指出怎麼補');
{
  const x = clone(INTAKE);
  x.lang = 'fr';
  x.ui = { ...uiTemplate('fr'), fields: { ...UI.en.fields, identity: 'Identité' } };
  eq(intakeProblems(x).length, 0, '非內建語言帶齊 ui 就放行');
  ok(confirmTable(x).startsWith('阿禾 · 常態 · 採茶裝 · to confirm') && confirmTable(x).includes('Identité'), '確認表用自譯文案');
}
{
  const x = clone(INTAKE);
  x.lang = 'en';
  delete x.skin;
  const t = confirmTable(x);
  ok(t.includes('Identity') && t.includes('(16 · female)') && t.includes('〔inferred〕') && t.includes('〔default〕'), '英文確認表：標籤、身份行、來源都是英文');
  ok(t.includes(UI.en.defaultSkin.young) && t.includes(UI.en.defaultBack), '英文確認表：預設皮膚與背面也是英文');
}
{
  const t = confirmTable(INTAKE);
  ok(t.includes('〔推斷〕') && t.includes('〔預設〕'), '確認表標出推斷與預設');
  ok(t.includes('背面') && t.includes('〔預設〕'), '沒寫背面：按髮型與服裝補，並標預設');
  const x = clone(INTAKE);
  delete x.skin;
  ok(confirmTable(x).includes(defaultSkin(16).zh), '沒寫皮膚：按年齡補');
}

/* ---------------- 介面文案 ---------------- */
for (const l of BUILTIN) eq(uiMissing(UI[l]).length, 0, `內建語言 ${l} 的文案齊全`);
assert.throws(() => uiFor('fr'), /ui-template fr/); passed++;
ok(uiFor('fr', uiTemplate('fr')).htmlLang === 'fr', '自譯文案齊全即可使用');
eq(uiFor('en', { title: 'Cast refs' }).title, 'Cast refs', '內建語言可以只覆蓋幾項');
eq(uiFor('en', { title: 'Cast refs' }).without, UI.en.without, '沒覆蓋的照舊');
eq(fmt('第 {n} 檔 {x}', { n: 2 }), '第 2 檔 {x}', '佔位符只填給了的');
ok(uiTemplate('fr')._說明.join('').includes('佔位符'), '骨架帶翻譯說明');

/* ---------------- 畫風預設 ---------------- */
for (const [name, id] of [['寫實', 'realistic-photo'], ['写实', 'realistic-photo'], ['realistic', 'realistic-photo'], ['REALISTIC', 'realistic-photo'], ['動漫', 'anime'], ['anime', 'anime'], ['动漫', 'anime'], ['アニメ', 'anime']]) { // zh-tw-lint: allow
  eq(findLook(name)?.id, id, `畫風名「${name}」→ ${id}`);
}
eq(findLook('油畫'), null, '沒有的預設返回空');
eq(DEFAULT_LOOK.id, 'anime', '預設動漫');
eq(findLook('卡通')?.id, 'anime', '「卡通」也是動漫');
eq(assetFromIntake(INTAKE).outfits.default.look.id, 'anime', '不指定畫風：建資產用動漫');
ok(LOOKS.every((l) => l.label.zh && l.label.en && l.label.ja && ['photo', 'drawn'].includes(l.medium) && lookProblems(l).length === 0), '每個預設都有中英日名字、介質，且自身合規');
ok(!('names' in lookSnapshot(findLook('anime'))), '快照不帶命令列別名');
{
  const legacy = { id: 'realistic-photo', label: '寫實照片（方案四）', style: REAL.style, clean: REAL.clean, neg: REAL.neg };
  eq(lookHash(legacy), lookHash(REAL), '老資產的寫實快照（沒有 medium）指紋不變，不會平白過期');
  eq(lookName(legacy, 'en'), '寫實照片（方案四）', '老資產的字串名字原樣顯示');
}
eq(lookName(REAL, 'en'), 'Realistic photo', '預設名字按語言取');
eq(lookName({ label: { zh: '水墨' } }, 'fr'), '水墨', '沒有這個語言就退到別的');
ok(lookProblems({ style: 's', clean: 'grey studio', neg: 'n' }).some((x) => x.includes('white')), '自定義畫風沒寫白底被攔');
{
  const a = assetFromIntake(INTAKE, lookSnapshot(findLook('anime')));
  const anchor = buildPrompt(a, 'default', 'front-full', a.outfits.default.look).text;
  ok(anchor.includes('anime illustration') && !anchor.includes('freckles') && !anchor.includes('A real photograph'), '動漫：寫動漫畫風，不寫皮膚層（雀斑、毛孔會把畫面往寫實拽）');
  ok(!buildPrompt(a, 'default', 'detail-hair', a.outfits.default.look).text.includes('macro photo'), '動漫：細節圖不寫 photo');
  ok(buildPrompt(A0(), 'default', 'front-full').text.includes('freckles') && buildPrompt(A0(), 'default', 'detail-hair').text.includes('macro photo'), '寫實：照舊寫皮膚層與 macro photo');
}

/* ---------------- 檢視、檔位、提示詞 ---------------- */
const A = assetFromIntake(INTAKE, REAL);   // 提示詞的寫法以寫實為基線測；動漫的差異在畫風預設一節
const O = 'default';
eq(viewsOfTier(A.outfits[O], 1).join(), 'front-full', '第一檔只有錨點');
eq(viewsOfTier(A.outfits[O], 2).join(), 'face-front,side-full,back-full', '第二檔：大頭照、90° 側面、背面');
eq(viewsOfTier(A.outfits[O], 3).join(), 'detail-hair,detail-neck,detail-sleeve,detail-feet', '第三檔：四個預設細節');
eq(viewsOfTier(A.outfits[O], 4).join(), 'face-45', '45° 大頭照在最後一檔');
eq(A.outfits[O].look.style, REAL.style, '建資產時把畫風層整份快照進造型');
{
  const x = assetFromIntake({ ...clone(INTAKE), outfit: { ...clone(INTAKE.outfit), details: [] } });
  eq(viewsOfTier(x.outfits[O], 3).length, 0, '沒寫細節就沒有第三檔');
}
const P = (v) => buildPrompt(A, O, v, REAL);
ok(P('front-full').text.startsWith('Full-body front view: she stands straight and faces the camera squarely'), '錨點：正面全身，代詞按性別');
ok(P('front-full').text.includes(REAL.style) && P('front-full').text.includes(REAL.clean), '錨點帶畫風層');
eq(P('front-full').refs.length, 0, '錨點純文生圖，不掛參考');
ok(P('face-front').text.startsWith('Zoom in to an extreme close-up head-and-shoulders portrait, passport-photo framing'), '大頭照第一句要求拉近——改圖模型只聽第一句');
ok(P('face-front').text.includes('chin sits at the vertical middle'), '大頭照寫可量化的取景');
ok(P('front-full').text.includes('both ears equally visible') && P('front-full').negative.includes('three-quarter view'), '錨點把「正面」寫成幾何，並禁 3/4 側身——錨點側了，派生的大頭照也會側');
ok(P('face-front').text.includes('nose is on the vertical centre line') && P('face-front').text.endsWith('sleeves and cuffs are out of frame.') && P('face-front').negative.includes('head turned to the side'), '正臉大頭照同樣寫幾何、禁側臉');
ok(!P('face-front').text.includes('trousers') && !P('face-front').text.includes('sandals') && !P('face-45').text.includes('sandals'), '大頭照不寫下裝和鞋——寫了就拉遠鏡頭');
ok(P('face-front').text.includes('the same hand-woven indigo cotton jacket') && P('face-front').text.includes('eyebrows, one thick black braid'), '大頭照保留上裝；冠詞和句首大寫處理乾淨');
ok(P('side-full').text.includes('the same loose black cotton trousers'), '全身檢視保留下裝');
for (const v of ['face-front', 'side-full', 'back-full']) ok(!P(v).text.includes('tea stains') && !P(v).text.includes('knot of her'), `${v} 不重複細節描述——錨點裡有`);
ok(P('side-full').text.includes('face the right edge of the image') && P('side-full').text.includes('not at the camera'), '側面：90°、面朝右、不看鏡頭');
ok(P('back-full').text.startsWith('Rotate the camera 180 degrees around her'), '背面：繞人物轉 180°');
ok(P('face-45').text.includes('toward the left side of the image'), '45° 面朝左（與 90° 側面相反，左右臉都有）');
ok(P('detail-hair').text.startsWith('Zoom in to an extreme close-up macro photo of only the knot'), '細節第一句只寫這個部位');
ok(!P('detail-neck').text.includes('straw sandals') && !P('detail-neck').text.includes('Keep her exactly'), '細節不列整套服裝——列了就畫整個人');
ok(P('detail-neck').text.includes('skin of a 16-year-old'), '露皮膚的細節寫明年齡，免得畫老');
eq(P('detail-hair').refs.join(), 'front-full,face-front', '頭髮 / 領口細節掛錨點 + 大頭照');
eq(P('detail-sleeve').refs.join(), 'front-full', '袖口 / 鞋只掛錨點');
ok(P('detail-sleeve').negative.includes('full body'), '細節反向詞禁全身');
for (const v of Object.keys(allViews(A.outfits[O]))) {
  ok(!/[㐀-鿿]/.test(P(v).text) && !P(v).text.includes('阿禾'), `${v} 提示詞全英文、不含角色名`);
}
eq(pronouns('male').p, 'his', '男性代詞');
eq(nounOf(70, 'male'), 'old man', '七十歲男性叫 old man');
eq(nounOf(16, 'female'), 'young woman', '十六歲女性叫 young woman');
{
  const m = assetFromIntake({ ...clone(INTAKE), name: '老周', identity: { age: 70, gender: 'male', en: 'An elderly ferryman', zh: '老船伕', source: 'stated' } });
  ok(buildPrompt(m, O, 'back-full').text.startsWith('Rotate the camera 180 degrees around him') && buildPrompt(m, O, 'face-front').text.includes('this same old man'), '換成老年男性：代詞與稱呼跟著變');
}

/* ---------------- 版本、確認、過期 ---------------- */
{
  const a = assetFromIntake(INTAKE);
  const png = (w, h) => solidPng(w, h);
  const add = (view, confirmMode = 'wait') => {
    const pr = buildPrompt(a, O, view);
    const { refs } = view === ANCHOR ? { refs: [] } : resolveRefs(a, O, pr);
    const [w, h] = QWEN_SIZES[pr.ratio];
    return recordVersion(a, O, view, { buf: png(w / 8 * 3, h / 8 * 3), model: 'qwen', seed: 1, prompt: pr, refs, confirmMode }).version;
  };
  eq(anchorUsable(a, O).ok, false, '沒有錨點不能派生');
  const v1 = add(ANCHOR);
  eq(v1.id, '阿禾/default/front-full/v1', '標識 = 角色/造型/檢視/版本');
  eq(v1.confirmed, false, '配置要求確認時，新錨點待確認');
  ok(anchorUsable(a, O).why.includes('confirm'), '錨點沒確認就不許派生，並說明怎麼確認');
  v1.confirmed = true;
  ok(anchorUsable(a, O).ok, '確認後可以派生');
  ok(add(ANCHOR, 'auto').confirmed === 'auto', '配置為不確認：記成 auto，報告裡照樣標出');
  {
    const b = assetFromIntake(INTAKE);
    const dark = recordVersion(b, O, ANCHOR, { buf: solidPng(396, 594, [20, 20, 20]), model: 'qwen', prompt: buildPrompt(b, O, ANCHOR), confirmMode: 'auto' }).version;
    eq(dark.confirmed, false, '配置為不確認，但錨點沒過門：自動確認不放行');
    eq(anchorUsable(b, O).ok, false, '沒過門的錨點不能拿來派生');
  }
  current(a.outfits[O], ANCHOR).confirmed = true;
  const face = add('face-front');
  eq(face.refs[0].v, 2, '派生圖記下參考的錨點版本');
  add('side-full'); add('back-full'); add('detail-hair'); add('detail-sleeve');
  eq(current(a.outfits[O], 'detail-hair').refs.map((r) => r.view).join(), 'front-full,face-front', '頭髮細節實際掛了兩張參考');
  ok(['face-front', 'side-full', 'detail-hair', 'detail-sleeve'].every((v) => staleReasons(a, O, v).length === 0), '剛出完全部有效');
  add('face-front');   // 重出大頭照
  ok(staleReasons(a, O, 'detail-hair').some((s) => s.includes('face-front')), '重出大頭照 → 掛了它的細節過期');
  eq(staleReasons(a, O, 'detail-sleeve').length, 0, '重出大頭照 → 只掛錨點的細節不受影響');
  eq(staleReasons(a, O, 'side-full').length, 0, '重出大頭照 → 側面不受影響');
  eq(a.outfits[O].views['face-front'].versions.length, 2, '重出不刪舊版');
  add(ANCHOR);         // 重出錨點
  ok(['face-front', 'side-full', 'back-full', 'detail-sleeve'].every((v) => staleReasons(a, O, v).length), '重出錨點 → 其餘全部過期');
  eq(anchorUsable(a, O).ok, false, '重出的錨點要重新確認');
  current(a.outfits[O], ANCHOR).confirmed = true;
  a.layers.hair.en += ', with a red ribbon';
  ok(staleReasons(a, O, ANCHOR).includes('文字描述改過了'), '改了文字描述 → 錨點也過期');
  a.layers.hair.en = INTAKE.hair.en;
  eq(staleReasons(a, O, ANCHOR).join('/'), '', '改回去就不過期（按指紋比，不按時間）');
  a.outfits[O].details.push({ slot: 'custom', id: 'fingertips', part: 'hands', en: 'her fingertips stained green', text: '染綠的指尖' });
  ok(['front-full', 'side-full', 'back-full', 'detail-sleeve'].every((v) => !staleReasons(a, O, v).includes('文字描述改過了')), '加一個細節：其他圖不過期（細節只決定拍哪些特寫）');
  a.outfits[O].details.pop();
  a.outfits[O].details.find((d) => d.slot === 'sleeve').en += ', frayed';
  ok(staleReasons(a, O, 'detail-sleeve').includes('文字描述改過了') && !staleReasons(a, O, ANCHOR).includes('文字描述改過了'), '改某條細節的文字：只有那張細節圖過期');
  a.outfits[O].details.find((d) => d.slot === 'sleeve').en = INTAKE.outfit.details.find((d) => d.slot === 'sleeve').en;
  delete a.outfits[O].views['face-front'];
  const r = resolveRefs(a, O, buildPrompt(a, O, 'detail-neck'));
  ok(r.refs.length === 1 && r.notes[0].includes('只掛錨點'), '大頭照不在：退回只掛錨點，不阻塞，並留注');
  a.outfits[O].look.style += ' Extra.';
  ok(staleReasons(a, O, ANCHOR).includes('畫風快照變了'), '畫風快照被改 → 過期');
}

/* ---------------- 模型適配（不聯網） ---------------- */
{
  const q = loadConfig(join(TMP, 'none.json')).models.qwen;
  const t2i = qwenWorkflow({ text: 't', negative: 'n', ratio: '2:3', seed: 7 }, [], q);
  ok(t2i.pos.class_type === 'CLIPTextEncode' && !t2i.ref1, '錨點：純文生圖工作流');
  eq(`${t2i.lat.inputs.width}x${t2i.lat.inputs.height}`, '1056x1584', '2:3 尺寸');
  const ed = qwenWorkflow({ text: 't', negative: 'n', ratio: '1:1', seed: 7 }, ['a.png', 'b.png'], q);
  ok(ed.pos.class_type === 'TextEncodeQwenImageEditPlus' && ed.pos.inputs.image2[0] === 'ref2' && !ed.pos.inputs.image3, '派生：兩張參考圖接進編碼器');
  for (const [r, [w, h]] of Object.entries(QWEN_SIZES)) ok(w % 16 === 0 && h % 16 === 0 && w * h >= 655360 && w * h <= 8294400, `${r} 尺寸也滿足 gpt-image-2 的規則`);
  eq(parseEnv('# x\nCOMFY_URL=http://h:1/\nCOMFY_PASS="p w"\n').COMFY_PASS, 'p w', '讀 .env：去引號、跳註釋');
  const envf = join(TMP, '.env');
  writeFileSync(envf, 'COMFY_URL=http://example:8188/\nCOMFY_USER=u\nCOMFY_PASS=secret\n');
  const ep = qwenEndpoint({ ...q, envFile: envf }, {});
  ok(ep.url === 'http://example:8188' && ep.auth === 'Basic ' + Buffer.from('u:secret').toString('base64'), '從 .env 取地址與賬號');
  assert.throws(() => qwenEndpoint(q, {}), /COMFY_URL/); passed++;
  const o = loadConfig(join(TMP, 'none.json')).models.openai;
  const gen = openaiRequest({ text: 'T', negative: 'N', ratio: '2:3', refs: [] }, o);
  ok(gen.path === '/images/generations' && gen.json.size === '1056x1584' && gen.json.model === 'gpt-image-2' && gen.json.prompt.endsWith('Avoid: N.'), 'GPT Image：錨點走 generations，反向詞寫成 Avoid');
  const f1 = join(TMP, 'r1.png'), f2 = join(TMP, 'r2.png');
  writeFileSync(f1, solidPng(10, 10)); writeFileSync(f2, solidPng(10, 10));
  const edit = openaiRequest({ text: 'T', negative: 'N', ratio: '4:5', refs: [f1, f2] }, o);
  ok(edit.path === '/images/edits' && edit.form.getAll('image[]').length === 2 && !edit.form.has('input_fidelity'), 'GPT Image：派生走 edits，兩張參考圖，gpt-image-2 不傳 input_fidelity');
  ok(openaiRequest({ text: 'T', negative: 'N', ratio: '4:5', refs: [f1] }, { ...o, model: 'gpt-image-1' }).form.get('input_fidelity') === 'high', '老模型 gpt-image-1 傳 input_fidelity=high');
  const s = codexStdin({ text: 'T', negative: 'N', ratio: '4:5', refs: ['a', 'b'] });
  ok(s.includes('4:5 aspect ratio') && s.includes('image 2 is a close-up of the face') && s.includes('./out.png'), 'codex：比例寫進提示詞、說明兩張參考圖');
  eq(fillTemplate("tool --p {prompt_file} --r {refs} --o {out} {missing}", { prompt_file: "/t/it's.txt", refs: ['/a b.png', '/c.png'], out: '/o.png' }, 'posix'),
    "tool --p '/t/it'\\''s.txt' --r '/a b.png' '/c.png' --o '/o.png' {missing}", '命令模板：全部加引號，未知佔位符原樣保留');
  eq(fillTemplate('tool --p {prompt_file} --r {refs} --o {out}', { prompt_file: "/t/it's.txt", refs: ['/a b.png', '/c.png'], out: '/o.png' }, 'win32'),
    `tool --p ^"/t/it's.txt^" --r ^"/a^ b.png^" ^"/c.png^" --o ^"/o.png^"`,
    'Windows 命令模板按 cmd.exe 規則引用路徑與空格');
  eq(quoteShellArg('%PATH%\r\n& calc "x"', 'win32'), '^"^%PATH^%^ ^&^ calc^ \\^"x\\^"^"',
    'Windows 引數轉義環境變數、換行、命令分隔符與雙引號，提示詞不能逃出引數邊界');
  assert.throws(() => quoteShellArg('x\0y', 'win32'), /NUL/); passed++;
  assert.throws(() => modelKind('midjourney'), /不認識/); passed++;
  eq(modelKind('custom:mine'), 'custom', '自定義模型');
  const c = loadConfig(join(TMP, 'none.json'));
  eq(configMissing(c).length, 3, '初次執行：模型、派生模型、是否確認三件事都要問');
  eq(maskConfig({ models: { qwen: { pass: 'x' } } }).models.qwen.pass, '（已隱藏）', '展示配置時密碼打碼');
}

/* ---------------- 假伺服器：Qwen / GPT Image ---------------- */
const serve = (handler) => new Promise((ok_) => {
  const srv = createServer(async (req, res) => {
    const body = await new Promise((r) => { const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });
    handler(req, res, body);
  });
  srv.listen(0, '127.0.0.1', () => ok_(srv));
});
{
  const seen = { auth: null, wf: null, uploads: 0 };
  const img = solidPng(1056 / 8, 1584 / 8);
  const srv = await serve((req, res, body) => {
    seen.auth = req.headers.authorization;
    if (req.url === '/upload/image') { seen.uploads++; res.end(JSON.stringify({ name: `up${seen.uploads}.png`, subfolder: 'character-refs' })); }
    else if (req.url === '/prompt') { seen.wf = JSON.parse(body).prompt; res.end(JSON.stringify({ prompt_id: 'p1' })); }
    else if (req.url.startsWith('/history/')) res.end(JSON.stringify({ p1: { status: { status_str: 'success' }, outputs: { save: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } } }));
    else if (req.url.startsWith('/view')) res.end(img);
    else { res.statusCode = 404; res.end(); }
  });
  const cfg = loadConfig(join(TMP, 'none.json'));
  cfg.models.qwen.url = `http://127.0.0.1:${srv.address().port}`;
  const f = join(TMP, 'ref.png');
  writeFileSync(f, solidPng(10, 10));
  process.env.COMFY_USER = 'u'; process.env.COMFY_PASS = 'p';
  const out = await qwenGenerate({ text: 'T', negative: 'N', ratio: '2:3', refs: [f, f], seed: 3 }, cfg);
  delete process.env.COMFY_USER; delete process.env.COMFY_PASS;
  srv.close();
  ok(out.equals(img), 'Qwen：拿回伺服器上的圖');
  eq(seen.uploads, 2, 'Qwen：兩張參考圖都先上傳');
  ok(seen.wf.ref2.inputs.image === 'character-refs/up2.png' && seen.wf.ks.inputs.seed === 3, 'Qwen：工作流引用上傳後的檔名、帶種子');
  ok(seen.auth?.startsWith('Basic '), 'Qwen：帶上賬號');
}
{
  const seen = {};
  const img = solidPng(20, 25);
  const srv = await serve((req, res, body) => {
    seen.path = req.url; seen.auth = req.headers.authorization; seen.body = body.toString('latin1');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ b64_json: img.toString('base64') }] }));
  });
  const cfg = loadConfig(join(TMP, 'none.json'));
  cfg.models.openai.baseUrl = `http://127.0.0.1:${srv.address().port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-test';
  const f = join(TMP, 'ref.png');
  const out = await openaiGenerate({ text: 'T', negative: 'N', ratio: '4:5', refs: [f, f] }, cfg);
  delete process.env.OPENAI_API_KEY;
  srv.close();
  ok(out.equals(img), 'GPT Image：解出 b64_json');
  ok(seen.path === '/v1/images/edits' && seen.auth === 'Bearer sk-test', 'GPT Image：派生走 edits、帶 key');
  eq((seen.body.match(/name="image\[\]"/g) ?? []).length, 2, 'GPT Image：兩張參考圖作為 image[] 上傳');
  ok(seen.body.includes('1152x1440'), 'GPT Image：尺寸按比例給');
}

/* ---------------- 完整流程（自定義命令模板造白底圖） ---------------- */
{
  const mk = join(TMP, 'mk.mjs');
  writeFileSync(mk, `import { writeFileSync } from 'node:fs';\nimport { solidPng } from ${JSON.stringify(pathToFileURL(join(here, 'png.mjs')).href)};\n` +
    `const [w, h, out] = process.argv.slice(2); writeFileSync(out, solidPng(Math.round(w / 3), Math.round(h / 3)));\n`);
  const env = { ...process.env, CHARACTER_REFS_CONFIG: join(TMP, 'config.json') };
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env });
  const cfgRun = run('config', '--model', 'custom:white', '--confirm-anchor', 'yes', '--custom', `white=node ${mk} {width} {height} {out}`);
  ok(cfgRun.stdout.includes('配置完整'), 'config：一條命令設完模型與確認方式');
  const cfg = JSON.parse(readFileSync(join(TMP, 'config.json'), 'utf8'));
  ok(cfg.anchorModel === 'custom:white' && cfg.deriveModel === 'custom:white', '主圖與派生圖預設同一個模型');
  const newRun = run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', TMP);
  const assetPath = join(TMP, safeName('阿禾'), 'asset.json');
  ok(newRun.status === 0 && existsSync(assetPath), 'new：建出 asset.json');
  ok(run('gen', assetPath, '--tier', '2').stderr.includes('還沒有錨點'), '沒有錨點不能出第二檔');
  const g1 = run('gen', assetPath, '--tier', '1');
  ok(g1.status === 0 && g1.stdout.includes('錨點待確認'), '出錨點後提示確認');
  ok(run('gen', assetPath, '--tier', '2').stderr.includes('confirm'), '錨點沒確認，第二檔被拒');
  ok(run('confirm', assetPath).status === 0, 'confirm 通過');
  ok(run('gen', assetPath, '--tier', '2', '--reason', 'E01 有特寫').status === 0, '第二檔出齊');
  ok(run('gen', assetPath, '--tier', '3').status === 0, '第三檔出齊');
  const ck1 = run('check', assetPath);
  ok(ck1.status === 0, '全部有效時 check 通過\n' + ck1.stdout + ck1.stderr);
  ok(run('gen', assetPath, 'face-front', '--model', 'custom:white').status === 0, '單獨重出一張（可指定模型）');
  const ck2 = run('check', assetPath);
  ok(ck2.status === 1 && ck2.stdout.includes('已過期') && ck2.stdout.includes('face-front'), '重出大頭照後 check 標出過期的細節');
  const asset = JSON.parse(readFileSync(assetPath, 'utf8'));
  const cur = current(asset.outfits.default, 'face-front');
  eq(cur.id, '阿禾/default/face-front/v2', '重出的是 v2');
  eq(readText(readFileSync(join(dirname(assetPath), cur.file)))['shuohao:id'], '阿禾/default/face-front/v2', '圖片檔案裡寫著標識');
  ok(existsSync(join(dirname(assetPath), 'default/face-front.v1.png')), '舊版檔案還在');
  eq(asset.outfits.default.upgrades.at(-1).tier, 3, '升檔記錄留下');
  const out = join(TMP, 'report.html');
  ok(run('render', assetPath, '--out', out).status === 0, 'render 寫出報告');
  const html = readFileSync(out, 'utf8');
  ok(html.includes("setL(s||'without')") && html.includes('無細節圖'), '報告預設不顯示細節圖，可切換');
  ok(html.includes('src="阿禾/default/front-full.v1.png"'), '圖片路徑相對報告位置');
  ok(html.includes('class="img stale"'), '過期的圖在報告裡標紅框');
  ok(html.includes('<p class="legend">') && html.includes('紅框 = 已過期'), '有過期的圖時顯示圖例，說明紅框是什麼');
  ok(/class="img stale"[^>]*title="已過期：參考圖 face-front 已換成 v2"/.test(html), '滑鼠移到紅框圖上能看到過期原因');
  ok(html.includes('角色描述（確認表）') && html.includes('推斷'), '報告裡帶確認表與來源');
  ok(!/<link\s|<script\s+src=/.test(html), '報告零外部依賴');
  {
    const a = assetFromIntake(INTAKE);
    const png = solidPng(10, 10);
    for (const v of [ANCHOR, 'face-front', 'face-45']) recordVersion(a, 'default', v, { buf: png, model: 'qwen', prompt: buildPrompt(a, 'default', v), refs: [] });
    const h = renderHtml([{ asset: a, assetDir: TMP }], TMP);
    ok(/<details class="views">(?:(?!<\/details>)[\s\S])*<div class="extra">/.test(h), '45° 大頭照收在「全部檢視」裡，展開才顯示');
  }
  ok(html.includes('<html lang="zh-TW">') && !html.includes('Without details'), '中文資產預設出中文報告');
  const outEn = join(TMP, 'report-en.html');
  ok(run('render', assetPath, '--lang', 'en', '--out', outEn).status === 0, 'render --lang en');
  const en = readFileSync(outEn, 'utf8');
  ok(en.includes('<html lang="en">') && en.includes('Without details') && en.includes('Front headshot') && en.includes('All views'), '英文報告：介面全換');
  ok(en.includes('reference face-front is now v2') && en.includes('Stale'), '英文報告：過期原因也翻譯');
  ok(en.includes('Character description (confirmation table)') && en.includes('inferred') && en.includes('Style: Anime'), '英文報告：確認表標籤、來源、畫風名（預設動漫）');
  ok(!/無細節圖|全部檢視|已過期|角色描述|未生成|錨點已確認/.test(en), '英文報告裡沒有殘留的中文介面文案');
  ok(en.includes('十六歲採茶姑娘'), '資料內容保持原文（角色描述是中文寫的就還是中文）');
  const uiFile = join(TMP, 'ui-fr.json');
  writeFileSync(uiFile, JSON.stringify({ ...uiTemplate('fr'), title: 'Références de personnage' }));
  ok(run('render', assetPath, '--lang', 'fr', '--out', outEn).status !== 0, '非內建語言沒給 ui：render 報錯，不出半中半英的報告');
  ok(run('render', assetPath, '--lang', 'fr', '--ui', uiFile, '--out', outEn).status === 0 && readFileSync(outEn, 'utf8').includes('Références de personnage'), 'render --ui 傳自譯文案');
  ok(JSON.parse(run('ui-template', 'fr').stdout).htmlLang === 'fr', 'ui-template 列印骨架');
  {
    const d = join(TMP, 'def');
    run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', d);
    const ap = join(d, safeName('阿禾'), 'asset.json');
    const g1 = run('gen', ap);
    ok(g1.status === 0 && g1.stdout.includes('front-full/v1') && !g1.stdout.includes('face-front') && g1.stdout.includes('確認後再執行'), '預設 gen：錨點要確認時，只出錨點並提示接著怎麼做');
    run('confirm', ap);
    const g2 = run('gen', ap);
    ok(['face-front', 'side-full', 'back-full'].every((v) => g2.stdout.includes(`${v}/v1`)) && !g2.stdout.includes('detail-'), '確認後再 gen：補齊第二檔，不碰細節圖');
    ok(run('gen', ap).stdout.includes('已經齊了'), '第二檔齊了再 gen：不重出，提示細節圖怎麼出');
    const d2 = join(TMP, 'def2');
    run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', d2);
    const g3 = run('gen', join(d2, safeName('阿禾'), 'asset.json'), '--no-confirm');
    ok(['front-full', 'face-front', 'side-full', 'back-full'].every((v) => g3.stdout.includes(`${v}/v1`)), '--no-confirm：一條命令出齊第二檔');
  }
  const lk = run('looks').stdout;
  ok(lk.includes('寫實照片') && lk.includes('Anime') && lk.includes('* 動漫') && lk.includes('卡通'), 'looks 列出預設，標出預設（動漫）');
  const lookFile = join(TMP, 'my-look.json');
  const tpl = JSON.parse(run('look-template', '動漫').stdout);
  ok(tpl.medium === 'drawn' && tpl.id === 'custom', 'look-template 以預設為底列印可改的骨架');
  writeFileSync(lookFile, JSON.stringify({ ...tpl, style: tpl.style + ' Muted colors.' }));
  const out2 = join(TMP, 'b');
  ok(run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', out2, '--look', '動漫').status === 0, 'new --look 動漫');
  eq(JSON.parse(readFileSync(join(out2, safeName('阿禾'), 'asset.json'), 'utf8')).outfits.default.look.id, 'anime', '資產裡是動漫快照');
  ok(run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', join(TMP, 'c'), '--look', lookFile).status === 0, 'new --look 自定義檔案');
  ok(run('new', join(here, '..', 'examples', '阿禾-intake.json'), '--out', join(TMP, 'd'), '--look', '油畫').stderr.includes('可用預設'), '沒有的畫風名：報錯並列出可用預設');
  const rs = run('restyle', assetPath, '--look', '寫實');
  ok(rs.status === 0 && rs.stdout.includes('動漫 → 寫實照片'), 'restyle 換畫風');
  const ck3 = run('check', assetPath);
  ok(ck3.status === 1 && ck3.stdout.includes('正面全身（錨點）') && ck3.stdout.includes('畫風快照變了'), '換畫風后連錨點一起過期');
  ok(run('render', assetPath, '--lang', 'en', '--out', outEn).status === 0 && readFileSync(outEn, 'utf8').includes('Style: Realistic photo'), '報告裡的畫風名隨語言');
  const legacy = assetFromIntake(INTAKE);
  delete legacy.lang;
  ok(renderHtml([{ asset: legacy, assetDir: TMP }], TMP).includes('<html lang="zh-TW">'), '舊資產沒有 lang：按中文出');
  const enAsset = assetFromIntake({ ...clone(INTAKE), lang: 'en' });
  eq(enAsset.lang, 'en', '資產記下語言');
  ok(renderHtml([{ asset: enAsset, assetDir: TMP }], TMP).includes('No anchor yet'), '資產 lang 為 en：不傳 --lang 也出英文');
  const one = renderHtml([{ asset: assetFromIntake(INTAKE), assetDir: TMP }], TMP);
  ok(!one.includes('<p class="legend">'), '沒有過期的圖就不顯示圖例');
  ok(one.includes('還沒有錨點') && one.includes('第 0 檔'), '一張圖都沒有時也能渲染');
}

rmSync(TMP, { recursive: true, force: true });
console.log(`✓ ${passed} 項自測全部通過`);
