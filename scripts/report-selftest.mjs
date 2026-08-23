#!/usr/bin/env node
// 自測：覆蓋 report.mjs 裡所有確定性邏輯。
// 不呼叫任何模型、不起瀏覽器、不跑各 skill 的 render——純字串進出。
//   node scripts/report-selftest.mjs

import assert from 'node:assert/strict';
import {
  PANES,
  makePane,
  rebaseAssets,
  renderShell,
  scopeCss,
  scopeHtml,
  scopeJs,
  splitDoc,
} from './report.mjs';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, `${msg} — 期望 ${b}，實際 ${a}`); passed += 1; }

/* ---------------- 面板定義 ---------------- */

eq(PANES.length, 5, '五段流水線各一個面板');
eq(PANES[0].id, 'outline', '大綱排第一——順序照流程圖');
eq(PANES.at(-1).id, 'storyboard', '分鏡排最後');
ok(new Set(PANES.map((p) => p.id)).size === PANES.length, '面板 id 不重複');
ok(new Set(PANES.map((p) => p.flag)).size === PANES.length, '參數名不重複');
ok(PANES.find((p) => p.id === 'storyboard').needs.includes('--script'), '分鏡宣告瞭它對劇本的硬依賴');
ok(PANES.find((p) => p.id === 'outline').needs.length === 0, '大綱是起點，不吃上游');
for (const p of PANES) {
  ok(p.label && p.labelEn && p.hint && p.hintEn, `${p.id} 的中英文案齊全`);
  ok(p.needs.every((n) => PANES.some((x) => x.flag === n)), `${p.id} 依賴的都是已定義的參數`);
}

/* ---------------- splitDoc ---------------- */

const DOC = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>渡口 · 角色設定集</title>
<style>:root{--a:1}.card{color:red}</style></head>
<body>
<header class="hd">標題</header>
<script type="application/json" id="cast-data">{"source":"渡口","n":1}<\/script>
<script>document.querySelector('.expo').addEventListener('click',()=>{});<\/script>
</body></html>`;

{
  const d = splitDoc(DOC);
  eq(d.title, '渡口 · 角色設定集', '取到標題');
  ok(d.style.includes('.card{color:red}'), '取到樣式');
  eq(d.scripts.length, 1, '只取一段真正的 JavaScript');
  ok(d.scripts[0].includes('addEventListener'), '取到的是腳本正文');

  // 這一條是被真實 bug 逼出來的：各報告用 <script type="application/json"> 內嵌
  // 自己那份源 JSON 給匯出按鈕讀。當成腳本摳出來執行，瀏覽器直接甩
  // `Unexpected token ':'`，而且五個面板一起廢。
  ok(d.body.includes('id="cast-data"'), '資料區塊留在正文裡，不當腳本處理');
  ok(!d.scripts.some((s) => s.includes('"source"')), '資料區塊沒有被當成腳本摳走');
  ok(!d.body.includes('addEventListener'), '真正的腳本從正文裡剝掉了');
}

{
  // 帶 src 的外鏈腳本不收（這個儲存庫不產出，但別在這裡靜默吞掉）
  const d = splitDoc('<body><script src="x.js"><\/script><script>var a=1;<\/script></body>');
  eq(d.scripts.length, 1, '外鏈腳本不當成內聯腳本');
  ok(d.body.includes('src="x.js"'), '外鏈腳本標籤留在正文裡');
}

/* ---------------- scopeCss ---------------- */

{
  const css = scopeCss('.card{color:red}.a,.b{margin:0}', '#p');
  ok(css.includes('#p .card{'), '普通類加字首');
  ok(css.includes('#p .a,#p .b{'), '逗號分隔的每一支各自加字首');
}

{
  // :root / html / body 換成作用域本身：自定義屬性掛到面板上，面板內部照常繼承
  const css = scopeCss(':root{--seal:#8a3324}body{font:14px sans-serif}html{margin:0}', '#p');
  ok(css.includes('#p{--seal:#8a3324}'), ':root 換成作用域');
  ok(css.includes('#p{font:14px sans-serif}'), 'body 換成作用域');
  ok(!/(^|[^-\w])(:root|html|body)\s*\{/.test(css), '沒有頁面級選擇器漏出去');
}

{
  // @media 遞迴進去，@ 行本身不動
  const css = scopeCss('@media (max-width:900px){.card{display:none}}', '#p');
  ok(css.includes('@media (max-width:900px){'), '@media 條件原樣保留');
  ok(css.includes('#p .card{display:none}'), '@media 內部的選擇器也加字首');
}

{
  // @keyframes 整塊原樣：裡面的 0% / from / to 不是選擇器，加字首會直接廢掉動畫
  const css = scopeCss('@keyframes fade{from{opacity:0}to{opacity:1}}', '#p');
  ok(css.includes('@keyframes fade{'), '@keyframes 保留');
  ok(!css.includes('#p from'), 'from 沒有被當成選擇器');
  ok(!css.includes('#p to'), 'to 沒有被當成選擇器');
}

{
  // 註釋：規則之間的註釋會被當成下一條選擇器的一部分，而註釋裡的逗號會把選擇器
  // 切斷。實測就是這麼讓 18 條規則漏掉作用域的，所以專門釘一條。
  const css = scopeCss('/* episode overview: first three cards, then clip */\n.eps{gap:8px}', '#p');
  ok(css.includes('#p .eps{'), '註釋後面的規則照常加字首');
  ok(!css.includes('episode overview'), '註釋被剝掉');
  ok(!css.includes('#p /*'), '註釋沒有粘進選擇器');
}

{
  // 宣告塊裡的註釋不影響解析
  const css = scopeCss('.a{color:red/* 說明 */}', '#p');
  ok(css.includes('#p .a{'), '宣告塊裡的註釋不影響');
}

/* ---------------- scopeHtml ---------------- */

{
  const h = scopeHtml('<section id="sec-gates"><a href="#sec-gates">去</a><b data-pane="tp-1"></b></section>', 'outline--');
  ok(h.includes('id="outline--sec-gates"'), 'id 加字首');
  ok(h.includes('href="#outline--sec-gates"'), '頁內錨點跟著改');
  ok(h.includes('data-pane="outline--tp-1"'), 'data-pane 跟著改——大綱的圖表切換靠它跟 id 比對');
  // 跨報告重複的 id 實測有 9 個（#ep-1…#ep-6、#sec-gates、#sec-scenes、#sec-rhythm），
  // 不加字首頁內錨點會跳到別的面板去
  eq(scopeHtml('<i id="ep-1"></i>', 'script--'), '<i id="script--ep-1"></i>', '不同面板的同名 id 分得開');
}

{
  const h = scopeHtml('<a href="https://x.com/#frag">外鏈</a>', 'p--');
  ok(h.includes('href="https://x.com/#frag"'), '外鏈不動');
}

/* ---------------- rebaseAssets ---------------- */

{
  const b = rebaseAssets('<img src="images/a.png">', '/demo/characters', '/demo');
  ok(b.includes('src="characters/images/a.png"'), '相對圖片按輸出位置重算');
}
{
  const b = rebaseAssets('<b style="background-image:url(\'images/a.png\')"></b>', '/demo/characters', '/demo');
  // 這條也是實測踩出來的：角色報告的縮圖走內聯 background-image，
  // 只查 src 屬性會漏掉，表現是大圖正常縮圖 404，很難排查
  ok(b.includes("url('characters/images/a.png')"), 'CSS 的 url() 也重算');
}
{
  const b = rebaseAssets('<img src="data:image/png;base64,AA"><img src="https://x/a.png"><img src="/abs.png">', '/demo/x', '/demo');
  ok(b.includes('src="data:image/png;base64,AA"'), 'data: 不動');
  ok(b.includes('src="https://x/a.png"'), '絕對地址不動');
  ok(b.includes('src="/abs.png"'), '根路徑不動');
}
{
  const b = rebaseAssets('<img data-src="E01-01/f1.png" data-img="E01-01/f1.png">', '/demo/storyboard', '/demo');
  eq((b.match(/storyboard\/E01-01\/f1\.png/g) ?? []).length, 2, 'data-src 與 data-img 都重算');
}

/* ---------------- scopeJs ---------------- */

{
  const js = scopeJs("document.querySelector('.expo').click();", 'pane-outline', 'outline--');
  ok(js.startsWith('(function(){'), '包在 IIFE 裡——五份腳本有重名的頂層 const');
  ok(js.includes('__root'), '拿到自己的面板根');
  ok(js.includes('new Proxy'), '用代理接管 document');
  ok(js.includes("document.querySelector('.expo')"), '原腳本正文原樣保留，不做字串改寫');
  // 語法必須成立，否則整段腳本在瀏覽器裡直接報錯
  assert.doesNotThrow(() => new Function(js), '包裝之後仍是合法 JavaScript');
  passed += 1;
}

{
  // 面板不存在時安靜退出，不是拋異常——某一段沒渲染出來時其餘面板要照常工作
  const js = scopeJs('boom();', 'pane-x', 'x--');
  ok(js.includes('if(!__root)return;'), '面板不在就直接返回');
  ok(js.includes('catch'), '腳本自己炸掉不連累別的面板');
}

/* ---------------- makePane ---------------- */

{
  const pane = makePane(DOC, { id: 'characters', fromDir: '/demo/characters', outDir: '/demo' });
  eq(pane.id, 'characters', '面板 id');
  eq(pane.paneId, 'pane-characters', '面板容器 id');
  eq(pane.title, '渡口 · 角色設定集', '帶上原報告的標題');
  ok(pane.css.includes('#pane-characters .card{'), '樣式已加作用域');
  ok(pane.css.includes('#pane-characters{--a:1}'), ':root 落到面板上');
  ok(pane.html.includes('id="characters--cast-data"'), '正文 id 已加字首');
  ok(pane.js.includes('__root'), '腳本已加作用域');
  ok(!pane.html.includes('<script>'), '正文裡沒有留下裸腳本');
}

/* ---------------- renderShell ---------------- */

{
  const mk = (id) => {
    const p = makePane(DOC.replace('渡口 · 角色設定集', `渡口 · ${id}`), { id });
    p.meta = PANES.find((x) => x.id === id);
    return p;
  };
  const html = renderShell([mk('outline'), mk('characters')], { title: '渡口', lang: 'zh' });

  ok(html.startsWith('<!doctype html>'), '產出是一份完整文件');
  eq((html.match(/<section class="rp-pane/g) ?? []).length, 2, '給了幾段就出幾個面板');
  ok(html.includes('id="pane-outline"') && html.includes('id="pane-characters"'), '兩個面板都在');
  ok(html.includes('class="rp-pane rp-on" id="pane-outline"'), '第一個面板預設顯示');

  // 外殼自己的類名全部帶 rp- 字首。報告正文裡出現同名類（.pane .on .main 這些
  // 都很常見）會讓外殼的顯示/隱藏錯亂——實測就撞過一次。
  for (const c of ['app', 'rail', 'nv', 'main', 'pane', 'allbtn']) {
    ok(html.includes(`.rp-${c}`) || html.includes(`class="rp-${c}`), `外殼的 .${c} 帶了 rp- 字首`);
  }
  const shellJs = html.slice(html.lastIndexOf('<main'), html.indexOf('__root'));
  ok(!/querySelectorAll\('\.(pane|nv|rail|main)[ '"]/.test(shellJs), '外殼腳本查的也是帶字首的類名');

  // 每個面板的腳本各成一塊，互不干擾
  eq((html.match(/__root=window\.document\.getElementById/g) ?? []).length, 2, '每個面板一段作用域腳本');
  ok(html.includes('rp-allbtn'), '有平鋪開關——分欄之後 Cmd+F 只搜得到當前面板，得留一條退路');

  // 深鏈
  ok(html.includes("location.hash"), '支援 #pane-xxx 深鏈');
  // 數字鍵
  ok(html.includes('keydown'), '支援數字鍵切面板');
}

{
  const p = makePane(DOC, { id: 'script' });
  p.meta = PANES.find((x) => x.id === 'script');
  const en = renderShell([p], { title: 'Ferry', lang: 'en' });
  ok(en.includes('<html lang="en">'), '英文介面的 html lang');
  ok(en.includes('Screenplay'), '導航用英文標籤');
  ok(en.includes('Show all'), '平鋪按鈕也是英文');
  ok(!en.includes('平鋪全部'), '英文介面不殘留中文外殼文案');
}

{
  // 單面板也要成立：只跑了角色那一段的人照樣能出這一頁
  const p = makePane(DOC, { id: 'characters' });
  p.meta = PANES.find((x) => x.id === 'characters');
  const one = renderShell([p], { title: '渡口' });
  eq((one.match(/<section class="rp-pane/g) ?? []).length, 1, '一個面板也能出頁');
  ok(one.includes('rp-on'), '唯一的面板預設就是顯示的');
}

{
  // XSS：標題是使用者給的，必須轉義
  const p = makePane(DOC, { id: 'art' });
  p.meta = PANES.find((x) => x.id === 'art');
  const html = renderShell([p], { title: '<img src=x onerror=alert(1)>' });
  ok(!html.includes('<img src=x onerror'), '標題裡的標籤被轉義');
  ok(html.includes('&lt;img'), '轉義成實體');
}

{
  // 零外部依賴：不許有任何外鏈資源
  const p = makePane(DOC, { id: 'outline' });
  p.meta = PANES.find((x) => x.id === 'outline');
  const html = renderShell([p], { title: '渡口' });
  ok(!/<link\b/i.test(html), '沒有外鏈樣式表');
  ok(!/<script[^>]+\bsrc=/i.test(html), '沒有外鏈腳本');
  ok(!/https?:\/\/(?!x\.com)/.test(html.replace(/https:\/\/json-schema\.org[^"']*/g, '')), '沒有外部請求');
}

console.log(`✓ ${passed} 項自測全部透過`);
