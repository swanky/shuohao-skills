#!/usr/bin/env node
// character-refs —— 角色參考圖：一張確認過的正面全身照為根，按檔位往上加圖。
// 零依賴，node >= 18 直接跑。生圖走 models.mjs 的介面卡；其餘全部確定性。

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANCHOR, DEFAULT_LOOK, DEFAULT_TIER, DETAIL_SLOTS, SOURCES, VIEWS, allViews, anchorUsable, assetFromIntake, buildPrompt, confirmTable, current,
  human, intakeProblems, padDisplay, recordVersion, resolveLayers, resolveRefs, skinBand, staleCodes, staleReasons, staleText, viewsOfTier,
} from './core.mjs';
import { BUILTIN, fmt, uiFor, uiTemplate } from './i18n.mjs';
import { DEFAULT_LOOK_ID, LOOKS, findLook, lookName, lookProblems, lookSnapshot } from './looks.mjs';
import { flattenAlpha } from './png.mjs';
import { CONFIG_PATH, configMissing, generate, loadConfig, maskConfig, modelKind, saveConfig } from './models.mjs';

const readJson = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));

/** --look 的值：先當預設名（寫實 / realistic / 動漫 / anime …），不是預設再當 JSON 檔案路徑。 */
export function resolveLookArg(arg) {
  if (arg == null) return lookSnapshot(findLook(DEFAULT_LOOK_ID));
  const preset = findLook(arg);
  if (preset) return lookSnapshot(preset);
  if (!existsSync(resolve(arg))) throw new Error(`沒有叫「${arg}」的畫風預設，也沒有這個檔案。可用預設：${LOOKS.map((l) => `${l.label.zh} / ${l.id}`).join('，')}`);
  const look = readJson(arg);
  const probs = lookProblems(look);
  if (probs.length) throw new Error(`畫風檔案 ${arg} 有問題：\n${probs.join('\n')}`);
  return { id: look.id ?? 'custom', ...look };
}
const writeJson = (p, x) => writeFileSync(resolve(p), JSON.stringify(x, null, 2) + '\n', 'utf8');
function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : fallback;
}
const posArgs = (rest) => rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--no-confirm'].includes(rest[i - 1])));
export const safeName = (s) => String(s).trim().replace(/[\s/\\:*?"<>|·]+/g, '-').replace(/^-+|-+$/g, '') || 'character';

/* ------------------------------------------------------------------ */
/* 一次性輸入的模板                                                       */
/* ------------------------------------------------------------------ */
export const INTAKE_TEMPLATE = {
  _說明: [
    '使用者一次性描述角色，由你（模型）拆進下面各欄位；缺的自動補，並如實標 source：stated 原話 / inferred 推斷 / default 預設。',
    'lang 是確認表和報告的語言，照使用者說話的語言填（zh / en / ja 內建；其他語言先執行 ui-template <lang> 翻一份放進 ui 欄位）。',
    'en 進生圖提示詞，永遠英文：不寫角色名、不寫畫風詞、不寫 (inferred) 之類標記；text 給人看，用 lang 指定的語言寫。',
    '年齡、性別、年代推不出來就問使用者——只有這三樣不許自己編。',
    'build / skin / backCue 可省：皮膚按年齡給預設，背面按髮型與服裝拼。',
    '細節圖（最多 8 個）怎麼挑：使用者點名的優先（source: stated）；沒點名就挑這個角色最能認出來的地方（配飾、腰間掛的東西、特別的鞋……）；',
    '實在沒有特別的，用預設槽位 hair / neck / sleeve / feet 兜底——這四個是實測穩定的。',
    '預設槽位之外使用 slot: custom，另寫 id（小寫英文）和 part（hair / neck / hands / waist / body / feet）；自定義的會標「未實測」。',
    '臉上的特徵（眼鏡、疤、痣）不出細節圖：寫進 face，正臉大頭照裡就看得清；使用者點名要臉部特寫時照這個說明。',
    '細節只寫這個部位本身（例：the tip of one of her long black braids, tied with faded red string），不寫 close-up、特寫之類取景詞——取景由腳本按部位加。',
    '細節裡的東西必須已經寫在外貌或服裝裡：細節只決定拍哪些特寫，不給角色添新東西。',
    '寫完執行 intake-check，把列印出的確認表給使用者看，確認後再 new。',
  ],
  name: '角色名（只用於檔名與報告，不進提示詞）',
  lang: 'zh',
  source: '出處，可省',
  identity: { age: 19, gender: 'female', en: 'A slender nineteen-year-old Chinese young woman, 1930s Republican-era China', text: '19 歲女學生，民國', source: 'stated' },
  face: { en: 'Oval face with soft rounded cheeks, large dark wary eyes, straight fine eyebrows, thin lips', text: '鵝蛋臉……', source: 'stated' },
  hair: { en: 'Centre-parted black hair in two long braids', text: '中分黑髮，兩條長辮', source: 'stated' },
  outfit: {
    id: 'default', label: '常態',
    top: { en: 'a dark navy cotton student tunic with a plain white collar, slightly faded at the cuffs', text: '藏青棉布學生裝，白領', source: 'inferred' },
    bottom: { en: 'a dark mid-calf pleated skirt, white socks and black cloth shoes', text: '深色及膝百褶裙、白襪、黑布鞋', source: 'inferred' },
    details: [
      { slot: 'hair', en: 'the tip of one of her long black braids, tied with faded red string', text: '辮梢系褪色紅繩', source: 'stated' },
      { slot: 'neck', en: 'the plain white collar and the cloth-knot button of her dark navy cotton tunic', text: '白領口與盤扣', source: 'inferred' },
      { slot: 'sleeve', en: 'the dark navy cotton cuff, faded and slightly frayed at the edge', text: '洗舊的袖口', source: 'inferred' },
      { slot: 'feet', en: 'black cloth shoes with a single strap and white cotton socks', text: '一字帶黑布鞋、白棉襪', source: 'inferred' },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* 生圖                                                                  */
/* ------------------------------------------------------------------ */
async function genViews(assetPath, viewIds, opts) {
  const cfg = loadConfig();
  const miss = configMissing(cfg);
  if (miss.length) throw new Error(`還沒完成初次設定，缺：${miss.join('、')}——先執行 config（見 SKILL.md Step 0）`);
  const dir = dirname(resolve(assetPath));
  const asset = readJson(assetPath);
  const oid = opts.outfit;
  const outfit = asset.outfits[oid];
  if (!outfit) throw new Error(`沒有造型 ${oid}`);
  let failed = 0;
  for (const view of viewIds) {
    const isAnchor = view === ANCHOR;
    const model = opts.model ?? (isAnchor ? cfg.anchorModel : cfg.deriveModel);
    modelKind(model);
    if (!isAnchor) {
      const u = anchorUsable(asset, oid);
      if (!u.ok) throw new Error(u.why);
    }
    const pr = buildPrompt(asset, oid, view, outfit.look);
    const { refs, notes } = isAnchor ? { refs: [], notes: [] } : resolveRefs(asset, oid, pr);
    const seed = modelKind(model) === 'codex' ? null : (opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    const t0 = Date.now();
    let buf;
    try {
      buf = await generate(model, { text: pr.text, negative: pr.negative, ratio: pr.ratio, refs: refs.map((r) => join(dir, r.file)), seed }, cfg);
    } catch (e) {
      failed++;
      console.error(`✗ ${view}：${e.message}`);
      continue;
    }
    const flat = flattenAlpha(buf);
    if (flat.changed) { buf = flat.buf; notes.push('模型給的是透明背景，已鋪成白底'); }
    const { version, buf: out } = recordVersion(asset, oid, view, {
      buf, model, seed, prompt: pr, refs, notes, confirmMode: cfg.confirmAnchor && !opts.noConfirm ? 'wait' : 'auto',
    });
    mkdirSync(join(dir, oid), { recursive: true });
    writeFileSync(join(dir, version.file), out);
    const ident = version.id;
    const g = version.gates;
    writeJson(assetPath, asset);   // 每出一張就落盤：中途斷了也不丟
    const bad = g.filter((x) => !x.ok);
    console.log(`${bad.length ? '△' : '✓'} ${ident}  ${model}  ${Math.round((Date.now() - t0) / 1000)}s${bad.length ? `  門未過：${bad.map((x) => `${x.label}（${x.detail}）`).join('；')}` : ''}${notes.length ? `  注：${notes.join('；')}` : ''}`);
    if (isAnchor && version.confirmed === false && !(cfg.confirmAnchor && !opts.noConfirm)) console.log(`  錨點沒過門，自動確認不放行：看過圖後執行 confirm ${assetPath}，或者重出錨點`);
    if (isAnchor && cfg.confirmAnchor && !opts.noConfirm) console.log(`  錨點待確認：看過圖後執行 confirm ${assetPath}${oid !== 'default' ? ` --outfit ${oid}` : ''}`);
  }
  return failed;
}

/* ------------------------------------------------------------------ */
/* 檢查                                                                  */
/* ------------------------------------------------------------------ */
export function checkReport(asset, oid) {
  const outfit = asset.outfits[oid];
  const lines = [];
  let problems = 0;
  const models = new Set();
  for (const [view, spec] of Object.entries(allViews(outfit))) {
    const cur = current(outfit, view);
    if (!cur) continue;
    models.add(cur.model);
    const bad = (cur.gates ?? []).filter((g) => !g.ok);
    const stale = staleReasons(asset, oid, view);
    problems += bad.length + (stale.length ? 1 : 0);
    const conf = view === ANCHOR ? (cur.confirmed === true ? ' · 已確認' : cur.confirmed === 'auto' ? ' · 自動確認' : ' · 待確認') : '';
    lines.push(`${bad.length || stale.length ? '✗' : '✓'} ${padDisplay(spec.label, 22)} v${cur.v} · ${cur.model}${conf}` +
      (bad.length ? `\n    門未過：${bad.map((g) => `${g.label}（${g.detail}）`).join('；')}` : '') +
      (stale.length ? `\n    已過期：${stale.join('；')}` : ''));
  }
  if (models.size > 1) lines.push(`注：這組圖混用了 ${[...models].join(' / ')}——一致性來自同一張錨點，可以混用，但請多看一眼質感是否銜接`);
  return { text: lines.join('\n') || '（這個造型還沒有圖）', problems };
}

/* ------------------------------------------------------------------ */
/* 報告                                                                  */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rel = (from, abs) => relative(from, abs).split(sep).join('/');

function outfitSection(asset, oid, assetDir, outDir, ui) {
  const outfit = asset.outfits[oid];
  const V = allViews(outfit);
  const label = (view) => (VIEWS[view] ? ui.views[view] : V[view]?.detail?.slot === 'custom' ? V[view].label : ui.slots[V[view]?.detail?.slot] ?? view);
  const src = (view) => {
    const cur = current(outfit, view);
    return cur ? rel(outDir, join(assetDir, cur.file)) : null;
  };
  const img = (view, cls = 'img') => {
    const s = src(view);
    const why = s ? staleCodes(asset, oid, view).map((c) => staleText(c, ui)) : [];
    return s ? `<img class="${cls}${why.length ? ' stale' : ''}" src="${esc(s)}" alt="${esc(label(view))}"${why.length ? ` title="${esc(`${ui.stStale}：${why.join('; ')}`)}"` : ''} loading="lazy">`
      : `<div class="${cls} miss">${esc(fmt(ui.notGenerated, { n: V[view]?.tier ?? '?' }))}</div>`;
  };
  const anchor = current(outfit, ANCHOR);
  const conf = !anchor ? ui.noAnchor : anchor.confirmed === true ? ui.anchorConfirmed : anchor.confirmed === 'auto' ? ui.anchorAuto : ui.anchorPending;
  const has = (t) => viewsOfTier(outfit, t).some((v) => current(outfit, v));
  const tierNow = [4, 3, 2, 1].find(has) ?? 0;
  const L = resolveLayers(asset, oid);
  const F = ui.fields;
  const tag = (f) => (f?.source && f.source !== 'stated' ? `<span class="src">${esc(ui.sources[f.source])}</span>` : '') +
    (f?.slot === 'custom' ? `<span class="src">${esc(ui.untested)}</span>` : '');
  const text = (f) => (f?.auto === 'skin' ? ui.defaultSkin[skinBand(L.identity.age)] : f?.auto === 'back' ? ui.defaultBack : human(f));
  const idLine = fmt(ui.identityLine, { text: human(L.identity), age: L.identity.age, gender: ui[L.identity.gender] ?? L.identity.gender });
  const rows = [[F.identity, L.identity, idLine], [F.face, L.face], [F.hair, L.hair], ...(L.build ? [[F.build, L.build]] : []), [F.top, L.top], [F.bottom, L.bottom],
    [F.skin, L.skin], [F.backCue, L.backCue], ...L.details.map((d) => [fmt(F.detail, { x: d.slot === 'custom' ? d.id : ui.slots[d.slot] }), d])];
  const desc = `<details class="desc"><summary>${esc(ui.descSummary)}</summary><dl>${rows.map(([k, f, t]) => `<dt>${esc(k)}</dt><dd>${esc(t ?? text(f))}${tag(f)}</dd>`).join('')}</dl></details>`;
  const gateLabel = (g, spec) => (g.id === 'white' ? (spec.kind === 'face' ? ui.gates.whiteFace : spec.kind === 'full' ? ui.gates.whiteFull : ui.gates.white)
    : fmt(ui.gates[g.id] ?? g.label, { x: spec.ratio }));
  const table = Object.entries(V).map(([view, spec]) => {
    const cur = current(outfit, view);
    const stale = cur ? staleCodes(asset, oid, view) : [];
    const bad = (cur?.gates ?? []).filter((g) => !g.ok);
    const state = !cur ? `<span class="dim">${esc(ui.stNone)}</span>` : stale.length ? `<span class="bad">${esc(ui.stStale)}</span> ${esc(stale.map((c) => staleText(c, ui)).join('; '))}`
      : bad.length ? `<span class="bad">${esc(ui.stGate)}</span> ${esc(bad.map((g) => gateLabel(g, spec)).join('; '))}` : '<span class="ok">✓</span>';
    return `<tr><td>${esc(label(view))}${spec.tested === false ? ` <span class="src">${esc(ui.untested)}</span>` : ''}</td><td>${spec.tier}</td><td>${cur ? `v${cur.v}` : ''}</td><td>${esc(cur?.model ?? '')}</td><td>${esc(cur?.seed ?? '')}</td><td class="mono">${esc(cur?.id ?? '')}</td><td>${state}</td></tr>`;
  }).join('');
  const models = new Set(Object.keys(V).map((v) => current(outfit, v)?.model).filter(Boolean));
  const notes = [
    anchor && anchor.confirmed !== true ? `<p class="warn">${esc(conf)}</p>` : '',
    models.size > 1 ? `<p class="note">${esc(fmt(ui.mixed, { x: [...models].join(' / ') }))}</p>` : '',
  ].join('');
  const details = viewsOfTier(outfit, 3);
  const look = ui.looks[outfit.look?.id] ?? lookName(outfit.look, ui.htmlLang.split('-')[0]);
  const sheet = tierNow <= 1
    ? `<div class="card1">${img(ANCHOR)}<div class="card1-info"><b>${esc(ui.tier1Only)}</b><p>${esc(conf)}</p>${desc}</div></div>`
    : `<div class="sheet"><div class="bust">${img('face-front')}</div><div class="right">
  <div class="turn">${['front-full', 'side-full', 'back-full'].map((v) => `<div class="full">${img(v)}<em>${esc(label(v))}</em></div>`).join('')}</div>
  <div class="details" style="--n:${Math.max(1, details.length)}">${details.map((v) => `<div class="cell">${img(v)}<em>${esc(label(v))}</em></div>`).join('')}</div>
</div></div>${desc}`;
  const extra = current(outfit, 'face-45') ? `<div class="extra">${img('face-45')}<span>${esc(ui.face45Extra)}</span></div>` : '';
  const T = ui.th;
  return `<section class="set"><h2>${esc(asset.name)} · ${esc(outfit.label)}<span>${esc(fmt(ui.tierN, { n: tierNow }))} · ${esc(conf)} · ${esc(fmt(ui.look, { x: look }))}</span></h2>
${notes}${sheet}
<details class="views"><summary>${esc(ui.allViews)}</summary><div class="vbody"><div class="tbl"><table><thead><tr><th>${esc(T.view)}</th><th>${esc(T.tier)}</th><th>${esc(T.version)}</th><th>${esc(T.model)}</th><th>${esc(T.seed)}</th><th>${esc(T.id)}</th><th>${esc(T.state)}</th></tr></thead><tbody>${table}</tbody></table></div>${extra}</div></details></section>`;
}

/**
 * 報告語言：--lang 優先，否則取第一個角色的 lang，都沒有就中文。
 * 非內建語言要有完整的 ui：--ui 傳入的檔案，或資產裡自帶的。
 */
export function reportUi(items, { lang = null, ui = null } = {}) {
  const l = lang ?? items[0]?.asset.lang ?? 'zh';
  const custom = ui ?? items.find((it) => (it.asset.lang ?? 'zh') === l && it.asset.ui)?.asset.ui ?? null;
  return uiFor(l, custom);
}

export function renderHtml(items, outDir, opts = {}) {
  const ui = reportUi(items, opts);
  // 有過期的圖才顯示圖例：紅框就是「過期」的標記
  const anyStale = items.some(({ asset }) => Object.entries(asset.outfits).some(([oid, o]) => Object.keys(allViews(o)).some((v) => staleCodes(asset, oid, v).length)));
  const body = items.map(({ asset, assetDir }) => Object.keys(asset.outfits).map((oid) => outfitSection(asset, oid, assetDir, outDir, ui)).join('\n')).join('\n');
  return `<!doctype html><html lang="${esc(ui.htmlLang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ui.title)}</title><style>
:root{--bg:#f2f2ef;--ink:#1c1f22;--ink2:#5f666c;--rule:#d4d6d1;--card:#fff;--ok:#2f6b47;--bad:#a3342a;--warn:#9a6a12}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16181a;--ink:#e7e8e6;--ink2:#9ba2a8;--rule:#34383c;--card:#1f2225;--ok:#6fbf8f;--bad:#e7867c;--warn:#e0b25a}}
:root[data-theme=dark]{--bg:#16181a;--ink:#e7e8e6;--ink2:#9ba2a8;--rule:#34383c;--card:#1f2225;--ok:#6fbf8f;--bad:#e7867c;--warn:#e0b25a}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 system-ui,-apple-system,"PingFang SC","Hiragino Sans","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px 56px}
h1{font-size:20px;margin:0 0 4px}.lead{color:var(--ink2);margin:0 0 16px}
.seg{display:inline-flex;border:1px solid var(--rule);border-radius:4px;overflow:hidden;margin:0 0 24px}
.seg button{font:inherit;font-size:13px;padding:6px 14px;border:0;background:var(--card);color:var(--ink2);cursor:pointer}
.seg button.on{background:var(--ink);color:var(--bg)}.seg button:focus-visible{outline:2px solid var(--ok);outline-offset:-2px}
.set{margin:0 0 44px}.set h2{font-size:16px;margin:0 0 10px;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.set h2 span{font-size:12px;font-weight:400;color:var(--ink2)}
.warn{color:var(--warn);font-size:12px;margin:-4px 0 8px}.note{color:var(--ink2);font-size:12px;margin:-4px 0 8px}
.sheet{aspect-ratio:16/9;display:grid;grid-template-columns:34% 1fr;background:#fff;border:1px solid #cfd1cc}
body:not(.with) .sheet{aspect-ratio:16/5.94}body:not(.with) .right{grid-template-rows:100%}body:not(.with) .turn{border-bottom:0}body:not(.with) .details{display:none}
.bust{border-right:1px solid #cfd1cc;overflow:hidden}.bust .img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.right{display:grid;grid-template-rows:66% 34%;min-height:0}
.turn{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #cfd1cc;min-height:0;padding:2% 2% 0}
.full,.cell{position:relative;min-height:0;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
.full .img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.details{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:1.2%;padding:1.2%;min-height:0}
.cell .img{width:100%;height:100%;object-fit:cover;display:block;border-radius:2px}
.full em,.cell em{position:absolute;top:3px;left:6px;font:500 11px/1 system-ui,"PingFang SC",sans-serif;font-style:normal;color:#6f767b;background:#fffd;padding:2px 4px;border-radius:2px}
.miss{display:flex;align-items:center;justify-content:center;color:#8f969a;font-size:12px;width:100%;height:100%;min-height:80px;background:#f6f6f4;border:1px dashed #d9dbd6;border-radius:2px}
.stale{outline:3px solid var(--bad);outline-offset:-3px}
.legend{display:flex;gap:8px;align-items:center;color:var(--bad);font-size:12px;margin:-6px 0 16px}.legend i{flex:none;width:22px;height:14px;background:#fff;outline:3px solid var(--bad);outline-offset:-3px}
.card1{display:grid;grid-template-columns:minmax(0,320px) 1fr;gap:20px;background:var(--card);border:1px solid var(--rule);border-radius:4px;padding:14px}
@media(max-width:700px){.card1{grid-template-columns:1fr}}
.card1 .img{width:100%;display:block;background:#fff;border-radius:2px}.card1-info b{font-size:14px}.card1-info p{color:var(--ink2);margin:4px 0 10px}
.desc,.views{margin-top:10px;background:var(--card);border:1px solid var(--rule);border-radius:4px;padding:8px 12px}
.desc summary,.views summary{cursor:pointer;font-size:13px;color:var(--ink2)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:10px 0 4px}dt{color:var(--ink2)}dd{margin:0}
.src{margin-left:8px;font-size:11px;padding:0 5px;border:1px solid var(--warn);color:var(--warn);border-radius:2px}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
.mono{font-family:ui-monospace,Menlo,monospace}.ok{color:var(--ok)}.bad{color:var(--bad)}.dim{color:var(--ink2)}
.vbody{display:flex;gap:16px;align-items:flex-start}.tbl{flex:1;min-width:0;overflow-x:auto}
.extra{flex:none;margin-top:8px;display:flex;flex-direction:column;gap:4px;align-items:center;max-width:230px;font-size:12px;color:var(--ink2);text-align:center}
.extra .img{height:180px;max-width:100%;object-fit:contain;border:1px solid var(--rule);border-radius:2px;background:#fff}
@media(max-width:700px){.vbody{flex-direction:column}.extra{align-self:center}}
img.img{cursor:zoom-in}.lb{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center}.lb.on{display:flex}.lb img{max-width:94vw;max-height:94vh}
</style></head><body><main>
<h1>${esc(ui.title)}</h1>
<p class="lead">${esc(ui.lead)}</p>
${anyStale ? `<p class="legend"><i></i>${esc(ui.staleLegend)}</p>` : ''}
<div class="seg" role="group" aria-label="${esc(ui.layout)}"><button data-l="without" class="on">${esc(ui.without)}</button><button data-l="with">${esc(ui.with)}</button></div>
${body}
</main><div class="lb" id="lb"><img alt=""></div>
<script>
const K='characterRefsLayout';
function setL(l){document.body.classList.toggle('with',l==='with');document.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('on',b.dataset.l===l));try{localStorage.setItem(K,l)}catch(e){}}
let s=null;try{s=localStorage.getItem(K)}catch(e){}setL(s||'without');
document.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>setL(b.dataset.l)));
const lb=document.getElementById('lb');document.addEventListener('click',e=>{const i=e.target.closest('img.img');if(i){lb.querySelector('img').src=i.src;lb.classList.add('on')}else if(e.target.closest('#lb'))lb.classList.remove('on')});
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on')});
</script></body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                   */
/* ------------------------------------------------------------------ */
const USAGE = `character-refs.mjs —— 角色參考圖

  config [--show]                          初次設定 / 檢視配置（配置存在 skill 目錄的 config.local.json）
         [--model m]                       主圖與派生圖都用 m（qwen / codex / openai / custom:<名字>）
         [--anchor-model m] [--derive-model m]   分開設定
         [--confirm-anchor yes|no]         出完錨點是否停下來等人確認
         [--qwen-env-file 路徑] [--qwen-url 地址] [--codex-bin 路徑]
         [--openai-env-file 路徑] [--openai-base-url 地址] [--openai-model 名字]
         [--custom 名字=命令模板]
  intake-template                          列印一次性輸入的模板（給模型填）
  intake-check <intake.json>               校驗並列印確認表；有問題 exit 1
  new <intake.json> --out <目錄> [--look 畫風]   建角色資產 <目錄>/<角色名>/asset.json
                                           畫風：預設名（寫實 / realistic / 動漫 / anime），或自定義的 look.json；預設寫實
  looks                                    列出畫風預設
  look-template [預設]                     列印一個預設的畫風層，改完存成檔案用 --look 傳入
  restyle <asset.json> --look 畫風 [--outfit id]   給已有角色換畫風；已有的圖全部標過期
  prompt <asset.json> <檢視> [--outfit id]  列印這張圖的提示詞、反向詞、比例、參考圖
  gen <asset.json> [<檢視>... | --tier N]  生圖；不給檢視和檔位 = 補齊預設的第二檔（錨點、大頭照、側面、背面）；
                                           已有的檢視再出一次就是新版本（重出）
      [--outfit id] [--model m] [--seed n] [--reason 文字] [--no-confirm]
  confirm <asset.json> [--outfit id]       確認錨點
  check <asset.json> [--outfit id]         檢查門與過期；有問題 exit 1
  render <asset.json>... [--out report.html] [--lang 程式碼] [--ui ui.json]
                                           出報告（預設不顯示細節圖，頁面上可切換）；語言預設取資產的 lang
  ui-template <語言程式碼>                   非內建語言（zh / en / ja 之外）的介面文案骨架，翻譯後放進 intake 的 ui

檢視：front-full（錨點，第一檔） face-front side-full back-full（第二檔）
      detail-hair detail-neck detail-sleeve detail-feet（第三檔） face-45（第四檔）`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); return; }
  const oid = flag(rest, '--outfit', 'default');

  if (cmd === 'config') {
    const cfg = loadConfig();
    const set = (k, v) => { if (v !== null) cfg[k] = v; };
    const m = flag(rest, '--model');
    if (m) { modelKind(m); cfg.anchorModel = m; cfg.deriveModel = m; }
    for (const [f, k] of [['--anchor-model', 'anchorModel'], ['--derive-model', 'deriveModel']]) {
      const v = flag(rest, f);
      if (v) { modelKind(v); set(k, v); }
    }
    if (cfg.anchorModel && !cfg.deriveModel) cfg.deriveModel = cfg.anchorModel;   // 預設派生與主圖同一個
    const ca = flag(rest, '--confirm-anchor');
    if (ca) {
      if (!['yes', 'no'].includes(ca)) throw new Error('--confirm-anchor 只能是 yes / no');
      cfg.confirmAnchor = ca === 'yes';
    }
    const qe = flag(rest, '--qwen-env-file'); if (qe) cfg.models.qwen.envFile = resolve(qe);
    const qu = flag(rest, '--qwen-url'); if (qu) cfg.models.qwen.url = qu;
    const cb = flag(rest, '--codex-bin'); if (cb) cfg.models.codex.bin = resolve(cb);
    const oe = flag(rest, '--openai-env-file'); if (oe) cfg.models.openai.envFile = resolve(oe);
    const ob = flag(rest, '--openai-base-url'); if (ob) cfg.models.openai.baseUrl = ob;
    const om = flag(rest, '--openai-model'); if (om) cfg.models.openai.model = om;
    const cu = flag(rest, '--custom');
    if (cu) {
      const i = cu.indexOf('=');
      if (i < 1) throw new Error('--custom 寫成 名字=命令模板');
      cfg.models.custom[cu.slice(0, i)] = { cmd: cu.slice(i + 1) };
    }
    if (rest.some((a) => a.startsWith('--') && a !== '--show')) saveConfig(cfg);
    console.log(JSON.stringify(maskConfig(cfg), null, 2));
    const miss = configMissing(cfg);
    console.log(miss.length ? `\n還缺：${miss.join('、')}` : `\n✓ 配置完整（${CONFIG_PATH}）`);
    return;
  }

  if (cmd === 'intake-template') { console.log(JSON.stringify(INTAKE_TEMPLATE, null, 2)); return; }
  if (cmd === 'ui-template') {
    const [lang] = posArgs(rest);
    if (!lang) throw new Error(`用法：ui-template <語言程式碼>（內建 ${BUILTIN.join(' / ')} 不用翻）`);
    console.log(JSON.stringify(uiTemplate(lang), null, 2));
    return;
  }
  if (cmd === 'looks') {
    for (const l of LOOKS) console.log(`${l.id === DEFAULT_LOOK_ID ? '*' : ' '} ${padDisplay(l.label.zh, 10)} ${padDisplay(l.label.en, 18)} --look ${l.names.join(' | ')}`);
    console.log('\n* 為預設。自定義：look-template <預設> > my.json，修改後 --look my.json');
    return;
  }
  if (cmd === 'look-template') {
    const [name] = posArgs(rest);
    const preset = findLook(name ?? DEFAULT_LOOK_ID);
    if (!preset) throw new Error(`沒有叫「${name}」的畫風預設（looks 檢視全部）`);
    console.log(JSON.stringify({ ...lookSnapshot(preset), id: 'custom', label: { zh: '我的畫風', en: 'My style' } }, null, 2));
    return;
  }
  if (cmd === 'restyle') {
    const [p] = posArgs(rest);
    const lookArg = flag(rest, '--look');
    if (!p || !lookArg) throw new Error('用法：restyle <asset.json> --look <預設名或 look.json> [--outfit id]');
    const asset = readJson(p);
    const oid = flag(rest, '--outfit', 'default');
    const outfit = asset.outfits[oid];
    if (!outfit) throw new Error(`沒有造型 ${oid}`);
    const before = lookName(outfit.look);
    outfit.look = resolveLookArg(lookArg);
    writeJson(p, asset);
    const n = Object.keys(outfit.views ?? {}).length;
    console.log(`✓ ${asset.name} · ${oid}：畫風 ${before} → ${lookName(outfit.look)}` +
      (n ? `\n  已有的 ${n} 個檢視全部標成過期（舊圖保留）。從錨點開始重出：gen ${p} front-full` : ''));
    return;
  }

  if (cmd === 'intake-check') {
    const [p] = posArgs(rest);
    if (!p) throw new Error('用法：intake-check <intake.json>');
    const x = readJson(p);
    const probs = intakeProblems(x);
    if (probs.length) {
      console.error(`✗ ${probs.length} 處問題：\n${probs.map((s) => '  ' + s).join('\n')}`);
      process.exit(1);
    }
    console.log(confirmTable(x));
    console.log('\n〔推斷〕〔預設〕是自動補的，請使用者逐條看過；沒問題再執行 new。');
    return;
  }

  if (cmd === 'new') {
    const [p] = posArgs(rest);
    const out = flag(rest, '--out');
    if (!p || !out) throw new Error('用法：new <intake.json> --out <目錄> [--look 預設名或 look.json]');
    const x = readJson(p);
    const probs = intakeProblems(x);
    if (probs.length) throw new Error(`輸入沒過校驗，先跑 intake-check：\n${probs.join('\n')}`);
    const look = resolveLookArg(flag(rest, '--look'));
    const dir = join(resolve(out), safeName(x.name));
    const path = join(dir, 'asset.json');
    if (existsSync(path)) throw new Error(`${path} 已存在——改描述請直接編輯它（照舊描述出的圖會自動標過期），或換個目錄`);
    mkdirSync(dir, { recursive: true });
    writeJson(path, assetFromIntake(x, look));
    console.log(`✓ ${path}（畫風：${lookName(look)}）\n  下一步：gen ${path}（先出錨點，再出大頭照、側面、背面）`);
    return;
  }

  if (cmd === 'prompt') {
    const [p, view] = posArgs(rest);
    if (!p || !view) throw new Error('用法：prompt <asset.json> <檢視> [--outfit id]');
    const asset = readJson(p);
    console.log(JSON.stringify(buildPrompt(asset, oid, view, asset.outfits[oid]?.look ?? DEFAULT_LOOK), null, 2));
    return;
  }

  if (cmd === 'gen') {
    const [p, ...views] = posArgs(rest);
    const tier = flag(rest, '--tier');
    if (!p) throw new Error('用法：gen <asset.json> [<檢視>... | --tier N]');
    const asset = readJson(p);
    const outfit = asset.outfits[oid];
    if (!outfit) throw new Error(`沒有造型 ${oid}`);
    const all = allViews(outfit);
    let list = tier ? viewsOfTier(outfit, Number(tier)) : views;
    if (!tier && !views.length) {
      // 預設：把第一、二檔裡還沒出的、已過期的補齊。錨點要人確認時，出完錨點先停，確認後再跑同一條命令接著出
      const todo = Object.keys(all).filter((v) => all[v].tier <= DEFAULT_TIER && (!current(outfit, v) || staleReasons(asset, oid, v).length));
      if (!todo.length) { console.log(`✓ 預設的第 ${DEFAULT_TIER} 檔已經齊了。要細節圖：gen ${p} --tier 3`); return; }
      const cfg = loadConfig();
      list = todo.includes(ANCHOR) && cfg.confirmAnchor && !rest.includes('--no-confirm') ? [ANCHOR] : todo;
    }
    for (const v of list) if (!all[v]) throw new Error(`沒有檢視 ${v}（可用：${Object.keys(all).join(' / ')}）`);
    if (!list.length) throw new Error(`第 ${tier} 檔沒有可出的檢視${Number(tier) === 3 ? '（造型裡沒寫細節）' : ''}`);
    if (tier && Number(tier) > 1) {
      outfit.upgrades = [...(outfit.upgrades ?? []), { tier: Number(tier), reason: flag(rest, '--reason', '手動升檔'), at: new Date().toISOString() }];
      writeJson(p, asset);
    }
    const seed = flag(rest, '--seed');
    const failed = await genViews(p, list, { outfit: oid, model: flag(rest, '--model'), seed: seed === null ? null : Number(seed), noConfirm: rest.includes('--no-confirm') });
    if (failed) process.exit(1);
    if (!tier && !views.length && list.length === 1 && list[0] === ANCHOR) console.log(`  確認後再執行 gen ${p}，接著出大頭照、側面、背面`);
    return;
  }

  if (cmd === 'confirm') {
    const [p] = posArgs(rest);
    if (!p) throw new Error('用法：confirm <asset.json> [--outfit id]');
    const asset = readJson(p);
    const a = current(asset.outfits[oid] ?? {}, ANCHOR);
    if (!a) throw new Error('還沒有錨點可確認');
    if (staleReasons(asset, oid, ANCHOR).length) throw new Error(`錨點已過期（${staleReasons(asset, oid, ANCHOR).join('；')}），先重出`);
    a.confirmed = true;
    a.confirmedAt = new Date().toISOString();
    writeJson(p, asset);
    console.log(`✓ 已確認 ${a.id}\n  下一步：gen ${p}（出齊預設的第二檔：大頭照、側面、背面）`);
    return;
  }

  if (cmd === 'check') {
    const [p] = posArgs(rest);
    if (!p) throw new Error('用法：check <asset.json> [--outfit id]');
    const asset = readJson(p);
    const outfits = rest.includes('--outfit') ? [oid] : Object.keys(asset.outfits);
    let problems = 0;
    for (const o of outfits) {
      const r = checkReport(asset, o);
      console.log(`== ${asset.name} · ${asset.outfits[o].label}\n${r.text}`);
      problems += r.problems;
    }
    if (problems) process.exit(1);
    return;
  }

  if (cmd === 'render') {
    const paths = posArgs(rest);
    if (!paths.length) throw new Error('用法：render <asset.json>... [--out report.html]');
    const out = flag(rest, '--out');
    const outDir = out ? dirname(resolve(out)) : process.cwd();
    const uiPath = flag(rest, '--ui');
    const html = renderHtml(paths.map((p) => ({ asset: readJson(p), assetDir: dirname(resolve(p)) })), outDir,
      { lang: flag(rest, '--lang'), ui: uiPath ? readJson(uiPath) : null });
    if (out) { writeFileSync(resolve(out), html, 'utf8'); console.log(`✓ ${resolve(out)}`); } else process.stdout.write(html);
    return;
  }

  throw new Error(`未知命令 ${cmd}\n\n${USAGE}`);
}

function isMainModule() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMainModule()) {
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  main(process.argv.slice(2)).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
export { main };
