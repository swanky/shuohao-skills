#!/usr/bin/env node
/**
 * report.mjs —— 把 novel 系列各 skill 的報告合成一張單頁，左側導航切換。
 *
 * 定位：**組裝器，不是第六個 skill**。它不 import 任何 skill 的程式碼，而是調各自的
 * `render --html` 拿產物再拼裝。三條好處：
 *
 *   1. 六個 skill 一行不改，各自仍然獨立可跑、可以單獨拷走
 *   2. 各 skill 的載入邏輯（圖存在才掛、ctx 組裝、語言優先順序）只有一份，不在這裡重寫
 *   3. 某個 skill 改了渲染，這裡自動跟上，不會漂
 *
 * 合併要解決三件事，都在這個檔案裡做，不侵入 skill：
 *
 *   - **樣式串味**：五份報告共用 57 個類名，其中 13 個同名不同定義（`.copy` `.kpis`
 *     `.badge` `.chip` …）。做法是給每份樣式的每條選擇器加作用域字首。
 *     已量過：五份報告的 CSS 裡**沒有任何 `#id` 選擇器**，所以只處理類與元素選擇器。
 *   - **腳本串味**：各報告的腳本都是 `document.querySelector('.expo')` 這種全域查詢。
 *     合成一頁後只會命中第一個——五個匯出按鈕會全廢。做法是給每份腳本套一層
 *     作用域代理，把查詢限制在自己的 pane 內。
 *   - **圖片路徑**：各報告的圖相對自己那份 json 的目錄（`images/…`、`E01-01/f1.png`）。
 *     合成後要按輸出檔案的位置重算。
 *
 * 用法見 USAGE。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, '..', 'skills');

/* ------------------------------------------------------------------ */
/* 面板定義                                                            */
/* ------------------------------------------------------------------ */

/**
 * 順序照流程圖：大綱 → （角色 · 美術 · 劇本）→ 分鏡。
 *
 * `needs` 是這份報告渲染時要一併餵進去的上游——合併器手上有全部路徑，
 * 順手傳給各自的 render，使用者不用自己拼一長串參數。分鏡的 `--script`
 * 是硬前提（沒有劇本它會直接報錯），其餘都是可選增強。
 *
 * `dir` 是端到端 demo 工作目錄約定裡對應的子目錄名，`--from` 自動發現時用。
 */
export const PANES = [
  {
    id: 'outline',
    skill: 'novel-outline',
    flag: '--outline',
    dir: 'outline',
    label: '大綱',
    labelEn: 'Outline',
    hint: '改編結構與分集',
    hintEn: 'Adaptation & episodes',
    needs: [],
  },
  {
    id: 'characters',
    skill: 'novel-characters',
    flag: '--cast',
    dir: 'characters',
    label: '角色',
    labelEn: 'Characters',
    hint: '畫像與設定圖',
    hintEn: 'Profiles & sheets',
    needs: [],
  },
  {
    id: 'art',
    skill: 'novel-art',
    flag: '--art',
    dir: 'art',
    label: '美術',
    labelEn: 'Art',
    hint: '場景與道具',
    hintEn: 'Scenes & props',
    needs: ['--cast'],
  },
  {
    id: 'script',
    skill: 'novel-script',
    flag: '--script',
    dir: 'script',
    label: '劇本',
    labelEn: 'Screenplay',
    hint: '場次、節拍、臺詞',
    hintEn: 'Scenes, beats, lines',
    needs: ['--outline', '--art', '--cast'],
  },
  {
    id: 'storyboard',
    skill: 'novel-storyboard',
    flag: '--storyboard',
    dir: 'storyboard',
    label: '分鏡',
    labelEn: 'Storyboard',
    hint: '段、分鏡、首幀',
    hintEn: 'Segments, cuts, frames',
    needs: ['--script', '--outline', '--art', '--cast'],
  },
];

/* ------------------------------------------------------------------ */
/* 拆文件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把一份完整 HTML 文件拆成 { style, body, scripts, title }。
 *
 * 各報告都是 `<!doctype html><html><head><style>…</style></head><body>…</body></html>`
 * 這個固定形狀，所以正則夠用——不引入 DOM 解析器，這個儲存庫零依賴。
 */
export function splitDoc(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

  // **只摳真正的 JavaScript**。各報告都用 `<script type="application/json" id="…-data">`
  // 內嵌自己那份源 JSON 給匯出按鈕讀——那是資料不是腳本，必須原樣留在正文裡。
  // 摳錯了會被當成程式碼執行，瀏覽器直接甩 `Unexpected token ':'`。
  const isJs = (attrs) => {
    if (/\bsrc=/.test(attrs)) return false;
    const type = (attrs.match(/\btype="([^"]*)"/) ?? [])[1];
    return !type || /^(text\/javascript|module|application\/javascript)$/i.test(type);
  };
  const SCRIPT_RE = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...html.matchAll(SCRIPT_RE)].filter((m) => isJs(m[1])).map((m) => m[2]);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  let body = bodyMatch ? bodyMatch[1] : html;
  // 正文裡把 JS 剝掉（它們要單獨套作用域），資料區塊留下
  body = body.replace(SCRIPT_RE, (whole, attrs) => (isJs(attrs) ? '' : whole));
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? '';
  return { style: styles.join('\n'), body, scripts, title };
}

/* ------------------------------------------------------------------ */
/* 樣式加作用域                                                        */
/* ------------------------------------------------------------------ */

/**
 * 給一份樣式表的每條選擇器加上作用域字首。
 *
 * 四種要特殊對待的：
 *   - `:root` / `html` / `body` → 直接換成作用域本身（自定義屬性掛在 pane 上，
 *     pane 內部照常繼承）
 *   - `@keyframes` → **整塊原樣保留**，裡面的 `0%` `from` `to` 不是選擇器
 *   - `@media` / `@supports` → 遞迴處理內部，`@` 行本身不動
 *   - 逗號分隔的選擇器組 → 每一支各自加字首
 */
export function scopeCss(css, scope) {
  // 先剝註釋。規則之間的註釋會被當成下一條選擇器的一部分，而註釋裡的逗號會把
  // 選擇器切斷——實測 `/* episode overview: first three cards, … */` 就是這麼
  // 變成一條選擇器的。剝掉是最省事的解，合併產物裡也不需要這些註釋。
  const css2 = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;

  const readBlock = (from) => {
    // 從 `{` 開始配對到對應的 `}`，返回結束位置（指向 `}` 之後）
    let depth = 0;
    for (let k = from; k < css2.length; k += 1) {
      if (css2[k] === '{') depth += 1;
      else if (css2[k] === '}') {
        depth -= 1;
        if (depth === 0) return k + 1;
      }
    }
    return css2.length;
  };

  while (i < css2.length) {
    const brace = css2.indexOf('{', i);
    if (brace < 0) { out.push(css2.slice(i)); break; }
    const head = css2.slice(i, brace).trim();
    const end = readBlock(brace);
    const inner = css2.slice(brace + 1, end - 1);

    if (/^@(keyframes|font-face|counter-style|property)/i.test(head)) {
      // 動畫關鍵幀與字型宣告整塊原樣搬，內部不是選擇器
      out.push(`${head}{${inner}}`);
    } else if (/^@(media|supports|layer|container)/i.test(head)) {
      out.push(`${head}{${scopeCss(inner, scope)}}`);
    } else if (head.startsWith('@')) {
      out.push(`${head}{${inner}}`);
    } else {
      const scoped = head
        .split(',')
        .map((sel) => {
          const s = sel.trim();
          if (!s) return '';
          // 頁面級選擇器換成作用域本身：自定義屬性與基礎排版落在 pane 上
          if (/^(:root|html|body)$/.test(s)) return scope;
          if (/^(:root|html|body)\b/.test(s)) return s.replace(/^(:root|html|body)\b/, scope);
          // `*` 單獨一支時不加空格，避免選中 pane 自己以外的東西時語義漂移
          return `${scope} ${s}`;
        })
        .filter(Boolean)
        .join(',');
      out.push(`${scoped}{${inner}}`);
    }
    i = end;
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* 正文加作用域                                                        */
/* ------------------------------------------------------------------ */

/**
 * 給正文裡的 id 加字首，並同步改掉引用它的地方。
 *
 * 已量過：五份報告跨文件重複的 id 有 9 個（`#ep-1`…`#ep-6`、`#sec-gates`、
 * `#sec-scenes`、`#sec-rhythm`）。不改的話頁內錨點會跳到別的面板去。
 *
 * 一併改的引用點：`href="#…"`、`data-pane="…"`（大綱的圖表/表格切換靠它跟
 * `p.id` 比對）、`aria-controls`、`for`。**腳本裡的 id 字串不用改**——
 * 作用域代理會在 `getElementById` 裡自動補字首。
 */
export function scopeHtml(body, prefix) {
  return body
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/\bhref="#([^"]+)"/g, (_, id) => `href="#${prefix}${id}"`)
    .replace(/\bdata-pane="([^"]+)"/g, (_, id) => `data-pane="${prefix}${id}"`)
    .replace(/\baria-controls="([^"]+)"/g, (_, id) => `aria-controls="${prefix}${id}"`)
    .replace(/\bfor="([^"]+)"/g, (_, id) => `for="${prefix}${id}"`);
}

/**
 * 把相對圖片路徑按輸出檔案的位置重算。
 *
 * 各報告的圖相對各自 json 所在目錄（角色是 `images/…`，分鏡是 `E01-01/f1.png`）。
 * 合成一頁之後，瀏覽器按合併檔案的位置解析，不重算就全是斷圖。
 * `data:` 與絕對地址原樣不動。
 */
export function rebaseAssets(text, fromDir, outDir) {
  const fix = (p) => {
    if (!p || /^(data:|https?:|file:|\/|#)/i.test(p)) return p;
    const rel = relative(outDir, resolve(fromDir, p)).split('\\').join('/');
    return rel || p;
  };
  return text
    .replace(/\b(src|data-img|data-src|poster)="([^"]*)"/g, (m, attr, val) => `${attr}="${fix(val)}"`)
    // 內聯樣式與樣式表裡的 `url(...)`。角色報告的縮圖就走這條
    // （`style="background-image:url('images/…')"`），只查屬性會漏掉它，
    // 表現是縮圖 404 但大圖正常——很不好排查，所以兩條路都覆蓋。
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, val) => `url(${q}${fix(val)}${q})`);
}

/* ------------------------------------------------------------------ */
/* 腳本加作用域                                                        */
/* ------------------------------------------------------------------ */

/**
 * 給一份報告的腳本套上作用域。
 *
 * 各報告的腳本都寫成 `document.querySelector('.expo')` 這種全域查詢——合成一頁
 * 之後只會命中第一個面板的那個，其餘四個匯出按鈕直接失效。這裡用一個 Proxy 把
 * `document` 換掉：查詢類方法限制在自己的 pane 內，`getElementById` 順手補上
 * id 字首（所以腳本裡的 id 字串一個都不用改），其餘屬性與方法原樣透傳給真的
 * document（`createElement` 這些還要用）。
 *
 * 整段包在 IIFE 裡，順帶隔離各報告的頂層 `const`——五份腳本里有重名的。
 */
export function scopeJs(js, paneId, prefix) {
  return `(function(){
var __root=window.document.getElementById(${JSON.stringify(paneId)});
if(!__root)return;
var __doc=window.document;
var document=new Proxy(__doc,{get:function(t,k){
  if(k==='querySelector')return function(s){return __root.querySelector(s);};
  if(k==='querySelectorAll')return function(s){return __root.querySelectorAll(s);};
  if(k==='getElementById')return function(id){
    return __root.querySelector('#'+(window.CSS&&CSS.escape?CSS.escape(${JSON.stringify(prefix)}+id):${JSON.stringify(prefix)}+id));
  };
  var v=t[k];
  return typeof v==='function'?v.bind(t):v;
}});
try{
${js}
}catch(e){console.error(${JSON.stringify(paneId)},e);}
})();`;
}

/* ------------------------------------------------------------------ */
/* 組裝一個面板                                                        */
/* ------------------------------------------------------------------ */

/**
 * 把一份完整報告文件變成一個可以塞進外殼的面板。
 * 純函式，不碰檔案系統——自測直接餵 HTML 字串就能驗。
 */
export function makePane(html, { id, fromDir = '.', outDir = '.' } = {}) {
  const { style, body, scripts, title } = splitDoc(html);
  const paneId = `pane-${id}`;
  const prefix = `${id}--`;
  const scoped = rebaseAssets(scopeHtml(body, prefix), fromDir, outDir);
  return {
    id,
    paneId,
    title,
    css: rebaseAssets(scopeCss(style, `#${paneId}`), fromDir, outDir),
    html: scoped,
    js: scripts.filter((s) => s.trim()).map((s) => scopeJs(s, paneId, prefix)).join('\n'),
  };
}

/* ------------------------------------------------------------------ */
/* 外殼                                                                */
/* ------------------------------------------------------------------ */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SHELL_I18N = {
  zh: {
    kicker: '短劇製作報告',
    nav: '流水線',
    expandAll: '平鋪全部',
    expandHint: '平鋪之後 Cmd+F 能搜到所有面板',
    collapse: '回到分欄',
    empty: '沒有任何一段的產出——至少要給一份 json',
    htmlLang: 'zh',
  },
  en: {
    kicker: 'Short-drama production report',
    nav: 'Pipeline',
    expandAll: 'Show all',
    expandHint: 'Showing all panes makes Cmd+F reach every section',
    collapse: 'Back to panes',
    empty: 'No stage produced anything — pass at least one json',
    htmlLang: 'en',
  },
};

/**
 * 外殼佈局：左側固定導航 + 右側內容區。
 *
 * 只有當前面板顯示，所以 Cmd+F 預設只搜得到當前這一份——這跟各報告「全部平鋪
 * 可 Cmd+F」的設計主張是衝突的。所以留了「平鋪全部」開關：按下之後所有面板同時
 * 顯示，搜尋恢復全域。預設分欄，因為五份加起來將近六十萬字元，一次全渲染很沉。
 */
export function renderShell(panes, { title = '', lang = 'zh', subtitle = '' } = {}) {
  const t = SHELL_I18N[lang] ?? SHELL_I18N.zh;
  const nav = panes
    .map(
      (p, i) => `<button class="rp-nv${i === 0 ? ' rp-on' : ''}" data-pane="${esc(p.paneId)}" type="button">
  <span class="rp-nv-i">${String(i + 1)}</span>
  <span class="rp-nv-t"><b>${esc(lang === 'en' ? p.meta.labelEn : p.meta.label)}</b><small>${esc(lang === 'en' ? p.meta.hintEn : p.meta.hint)}</small></span>
</button>`,
    )
    .join('\n');

  const body = panes
    .map((p, i) => `<section class="rp-pane${i === 0 ? ' rp-on' : ''}" id="${esc(p.paneId)}">${p.html}</section>`)
    .join('\n');

  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(t.kicker)}</title>
<style>
/* ---- 外殼。視覺語言跟各報告同一套：冷灰印張 + 鐵鏽紅印記 ---- */
:root{
  --paper:#f6f6f4; --panel:#fff; --ink:#1a1a18; --ink-2:#44443f; --ink-3:#77776f;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-soft:#8a332412;
  --rail:248px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper); color:var(--ink);
  font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.rp-app{display:flex;align-items:flex-start;min-height:100vh}

/* ---- 左側導航 ---- */
.rp-rail{
  position:sticky;top:0;flex:0 0 var(--rail);width:var(--rail);height:100vh;
  background:var(--panel);border-right:1px solid var(--rule);
  display:flex;flex-direction:column;padding:22px 14px 16px;
}
.rp-brand{padding:0 8px 16px;border-bottom:1px solid var(--rule);margin-bottom:14px}
.rp-brand h1{margin:0;font-size:19px;font-weight:650;letter-spacing:.02em;line-height:1.3}
.rp-brand p{margin:5px 0 0;font-size:11.5px;color:var(--ink-3);letter-spacing:.06em}
.rp-brand .rp-sub{margin-top:8px;font-size:11.5px;color:var(--ink-2);line-height:1.5}
.rp-navlab{padding:0 8px 8px;font-size:10.5px;letter-spacing:.14em;color:var(--ink-3);text-transform:uppercase}
.rp-nv{
  display:flex;align-items:center;gap:10px;width:100%;padding:9px 8px;margin-bottom:2px;
  border:0;border-radius:7px;background:transparent;cursor:pointer;text-align:left;
  color:var(--ink-2);font:inherit;transition:background .12s,color .12s;
}
.rp-nv:hover{background:#0000000a}
.rp-nv .rp-nv-i{
  flex:0 0 22px;height:22px;border-radius:5px;border:1px solid var(--rule-2);
  display:grid;place-items:center;font-size:11px;color:var(--ink-3);background:var(--paper);
}
.rp-nv .rp-nv-t{display:flex;flex-direction:column;min-width:0}
.rp-nv .rp-nv-t b{font-weight:600;font-size:13.5px;color:var(--ink)}
.rp-nv .rp-nv-t small{font-size:11px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-nv.rp-on{background:var(--seal-soft)}
.rp-nv.rp-on .rp-nv-i{background:var(--seal);border-color:var(--seal);color:#fff}
.rp-nv.rp-on .rp-nv-t b{color:var(--seal)}
.rp-railfoot{margin-top:auto;padding:12px 8px 0;border-top:1px solid var(--rule)}
.rp-allbtn{
  width:100%;padding:7px 10px;border:1px solid var(--rule-2);border-radius:7px;
  background:var(--panel);color:var(--ink-2);font:inherit;font-size:12px;cursor:pointer;
}
.rp-allbtn:hover{border-color:var(--seal);color:var(--seal)}
.rp-allbtn:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.rp-railfoot p{margin:8px 2px 0;font-size:10.5px;color:var(--ink-3);line-height:1.5}

/* ---- 內容區 ---- */
.rp-main{flex:1 1 auto;min-width:0}
.rp-pane{display:none}
.rp-pane.rp-on{display:block}
.rp-app.rp-all .rp-pane{display:block;border-bottom:1px solid var(--rule)}
.rp-app.rp-all .rp-rail .rp-nv{opacity:.55}

/* 各報告原本自己撐滿視口，塞進 pane 之後交給內容區控制寬度 */
.rp-pane{max-width:100%;overflow-x:auto}

@media (max-width:900px){
  .rp-app{display:block}
  .rp-rail{position:static;width:auto;height:auto;flex:none;border-right:0;border-bottom:1px solid var(--rule)}
  .rp-railfoot{margin-top:12px}
}
@media print{
  .rp-rail{display:none}
  .rp-pane{display:block!important;break-after:page}
}

/* ---- 各面板自己的樣式，已加作用域字首 ---- */
${panes.map((p) => `/* ===== ${p.id} ===== */\n${p.css}`).join('\n')}
</style>
</head>
<body>
<div class="rp-app" id="rp-app">
  <nav class="rp-rail">
    <div class="rp-brand">
      <h1>${esc(title)}</h1>
      <p>${esc(t.kicker)}</p>
      ${subtitle ? `<div class="rp-sub">${esc(subtitle)}</div>` : ''}
    </div>
    <div class="rp-navlab">${esc(t.nav)}</div>
    ${nav}
    <div class="rp-railfoot">
      <button class="rp-allbtn" id="rp-allbtn" type="button">${esc(t.expandAll)}</button>
      <p>${esc(t.expandHint)}</p>
    </div>
  </nav>
  <main class="rp-main">
${body}
  </main>
</div>
<script>
(function(){
  var app=document.getElementById('rp-app');
  var navs=[].slice.call(document.querySelectorAll('.rp-rail .rp-nv'));
  var panes=[].slice.call(document.querySelectorAll('.rp-main .rp-pane'));
  function show(id){
    navs.forEach(function(n){n.classList.toggle('rp-on',n.dataset.pane===id);});
    panes.forEach(function(p){p.classList.toggle('rp-on',p.id===id);});
    if(history.replaceState)history.replaceState(null,'','#'+id);
    window.scrollTo(0,0);
  }
  navs.forEach(function(n){n.addEventListener('click',function(){app.classList.remove('rp-all');show(n.dataset.pane);});});
  // 數字鍵 1–9 直接切面板
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    var tag=(e.target&&e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea')return;
    var i=parseInt(e.key,10);
    if(i>=1&&i<=navs.length){app.classList.remove('rp-all');show(navs[i-1].dataset.pane);}
  });
  // 平鋪：所有面板同時顯示，Cmd+F 恢復全域
  var all=document.getElementById('rp-allbtn');
  var LBL={on:${JSON.stringify(t.collapse)},off:${JSON.stringify(t.expandAll)}};
  all.addEventListener('click',function(){
    var on=app.classList.toggle('rp-all');
    all.textContent=on?LBL.on:LBL.off;
  });
  // 深鏈：#pane-script 直接落到那一屏
  var h=(location.hash||'').replace(/^#/,'');
  if(h&&document.getElementById(h))show(h);
})();
</script>
${panes.map((p) => (p.js ? `<script>\n${p.js}\n</script>` : '')).filter(Boolean).join('\n')}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `report.mjs —— 把 novel 系列各 skill 的報告合成一張單頁

  node scripts/report.mjs --from <demo目錄> [--out report.html] [--lang zh|en]
  node scripts/report.mjs --outline o.json --cast c.json … [--out report.html]

  --from <目錄>      按端到端 demo 工作目錄約定自動發現：
                     outline/ characters/ art/ script/ storyboard/ 各取一份 json
  --outline <f>      單獨指定某一段的 json，可與 --from 混用（顯式的優先）
  --cast <f>
  --art <f>
  --script <f>
  --storyboard <f>
  --out <f>          輸出路徑，預設 report.html
  --lang zh|en       外殼與各報告的介面語言，預設 zh
  --title <s>        左上角標題，預設取第一份 json 的 source

  **給了哪幾段就出哪幾個面板**——只有角色就只有一個面板，五段齊全就是五個。
  各 skill 的 render 一行不改，仍然可以單獨出各自的報告。`;

function flag(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

/** 在一個目錄裡找唯一一份看著像該段產出的 json（排掉報告與清單類檔案）。 */
function findJson(dir, skill) {
  if (!existsSync(dir)) return null;
  const kind = skill.replace('novel-', '');
  const stem = kind === 'characters' ? 'cast' : kind;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !/manifest|\.gates/i.test(f))
    .filter((f) => f.toLowerCase().includes(stem));
  return files.length ? join(dir, files[0]) : null;
}

function main(argv) {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const from = flag(argv, '--from');
  const outPath = resolve(flag(argv, '--out', 'report.html'));
  const outDir = dirname(outPath);
  const lang = flag(argv, '--lang', 'zh');

  // 路徑來源：顯式參數優先，其次從 --from 目錄自動發現
  const paths = {};
  for (const p of PANES) {
    const explicit = flag(argv, p.flag);
    paths[p.flag] = explicit ? resolve(explicit) : from ? findJson(resolve(from, p.dir), p.skill) : null;
  }

  const chosen = PANES.filter((p) => paths[p.flag]);
  if (!chosen.length) throw new Error(`沒有找到任何一段的產出。\n\n${USAGE}`);

  const panes = [];
  for (const p of chosen) {
    const jsonPath = paths[p.flag];
    const cli = join(skillsDir, p.skill, 'scripts', `${p.skill}.mjs`);
    const args = ['render', jsonPath, '--html', '--lang', lang];
    for (const need of p.needs) {
      // 上游有就帶上；沒有就不帶，各 skill 自己會說明跳過了什麼
      if (paths[need]) args.push(need, paths[need]);
    }
    let html;
    try {
      // cwd 定在 json 所在目錄：各 skill 的圖存在檢查是相對那裡做的
      html = execFileSync(process.execPath, [cli, ...args], {
        cwd: dirname(jsonPath),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '' },
      });
    } catch (e) {
      const why = (e.stderr || e.message || '').trim().split('\n')[0];
      console.error(`⚠️ ${p.skill} 這一段沒渲染出來，跳過：${why}`);
      continue;
    }
    const pane = makePane(html, { id: p.id, fromDir: dirname(jsonPath), outDir });
    pane.meta = p;
    panes.push(pane);
  }

  if (!panes.length) throw new Error('每一段都沒渲染成功，沒有可合成的內容');

  const titleFlag = flag(argv, '--title');
  let title = titleFlag;
  if (!title) {
    const first = paths[chosen[0].flag];
    try {
      title = JSON.parse(readFileSync(first, 'utf8')).source ?? '';
    } catch { /* 讀不出來就退回檔名 */ }
    if (!title) title = basename(first).replace(/[-_](cast|outline|art|script|storyboard)\.json$/i, '').replace(/\.json$/i, '');
  }

  const sub = panes.map((p) => (lang === 'en' ? p.meta.labelEn : p.meta.label)).join(lang === 'en' ? ' · ' : ' · ');
  writeFileSync(outPath, renderShell(panes, { title, lang, subtitle: sub }));
  console.log(`✓ ${panes.length} 個面板 → ${relative(process.cwd(), outPath) || outPath}`);
  for (const p of panes) console.log(`    ${lang === 'en' ? p.meta.labelEn : p.meta.label}  ${p.title || ''}`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
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
