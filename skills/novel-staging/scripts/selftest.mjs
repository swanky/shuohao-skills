#!/usr/bin/env node
// 自測：覆蓋 novel-staging.mjs 裡所有確定性邏輯。
// 不呼叫任何模型，不花額度，跑一次 < 1 秒。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ITEM_RANGE,
  MIN_APART,
  blockingLines,
  defaultFacing,
  gateReport,
  moveTo,
  nearestPlace,
  parseEps,
  placePoint,
  placePoints,
  placeSentence,
  renderHtml,
  renderMarkdown,
  sceneProblems,
  seedFromScript,
  slug,
  stagingBlocking,
  stagingCore,
  validateStaging,
} from './novel-staging.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => JSON.parse(readFileSync(join(here, '..', ...p), 'utf8'));
const FIXTURE = read('examples', '渡口-staging.json');
const SCRIPT = read('references', 'test-fixtures', 'upstream', '渡口-script.json');
const ART = read('references', 'test-fixtures', 'upstream', '渡口-art.json');
const OUTLINE = read('references', 'test-fixtures', 'upstream', '渡口-outline.json');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, `${msg} — 期望 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
  passed++;
}
const clone = () => JSON.parse(JSON.stringify(FIXTURE));
const gate = (d, id, opts = {}) => gateReport(d, opts).find((g) => g.id === id);
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* ---------------- 平面幾何 ---------------- */

const TABLE = { name: '長餐桌', alt: 'long table', plan: [0.3, 0.3, 0.7, 0.6], on: false };
const CHAIR = { name: '主位太師椅', alt: 'armchair', plan: [0.45, 0.1, 0.55, 0.2], on: true };
const ROUND = { name: '紅木圓桌', alt: 'round table', plan: [0.3, 0.3, 0.7, 0.7], on: false };
{
  const n = placePoint(TABLE, 'north', 0);
  ok(near(n.x, 0.3) && near(n.y, 0.26), '北側 along 0 在桌子西北角外一點');
  const e = placePoint(TABLE, 'east', 1);
  ok(near(e.x, 0.74) && near(e.y, 0.6), '東側 along 1 在東南角外一點（東西兩側沿南北排）');
  const s = placePoint(TABLE, 'south', 0.5);
  ok(near(s.x, 0.5) && near(s.y, 0.64), '南側中段在南邊正中外一點');
  const on = placePoint(CHAIR, 'on', 0.3);
  ok(near(on.x, 0.5) && near(on.y, 0.15), '在東西上面：放在它中間，along 不起作用');
  const r = placePoint(ROUND, 'south', 0.5);
  ok(near(r.x, 0.5) && r.y > 0.7, '圓的東西：南側中段在圓周正下方外面');
  const edge = placePoint({ name: '貼牆櫃', plan: [0, 0, 0.1, 0.1], on: false }, 'west', 0.5);
  ok(edge.x === 0, '平面外的點收回到 0–1 裡面');
}
{
  const pts = placePoints([
    { id: 'A', present: true, item: '主位太師椅', side: 'on', along: 0.5 },
    { id: 'B', present: true, item: '主位太師椅', side: 'on', along: 0.5 },
    { id: 'C', present: false, item: null },
    { id: 'D', present: true, item: '不存在的東西', side: 'north', along: 0.5 },
  ], [TABLE, CHAIR]);
  ok(pts.has('A') && pts.has('B') && !pts.has('C') && !pts.has('D'), '只給在場、東西認得出來的人算點');
  ok(pts.get('A').x !== pts.get('B').x, '兩個人在同一件東西上並排，不疊在一點');
}
{
  eq(nearestPlace({ x: 0.5, y: 0.15 }, [TABLE, CHAIR]), { item: '主位太師椅', side: 'on', along: 0.5 }, '鬆在能坐的東西裡面：坐在它上面');
  const t = nearestPlace({ x: 0.75, y: 0.36 }, [TABLE, CHAIR]);
  ok(t.item === '長餐桌' && t.side === 'east' && near(t.along, 0.2), '鬆在桌子東邊：東側，沿南北量出 along');
  const inside = nearestPlace({ x: 0.5, y: 0.32 }, [TABLE]);
  ok(inside.item === '長餐桌' && inside.side === 'north', '鬆在桌面上：落到最近的那條邊');
  const r = nearestPlace({ x: 0.5, y: 0.8 }, [ROUND]);
  ok(r.item === '紅木圓桌' && r.side === 'south' && Math.abs(r.along - 0.5) < 0.01, '圓桌正下方：南側中段');
  eq(nearestPlace({ x: 0.5, y: 0.5 }, []), null, '沒有東西就沒有落點');
}
{
  eq(defaultFacing('east', TABLE), 'west', '在東側面朝西');
  eq(defaultFacing('north', TABLE), 'south', '在北側面朝南');
  eq(defaultFacing('on', { plan: [0, 0.4, 0.1, 0.6] }), 'east', '在靠西牆的東西上面：面朝東（房間）');
  eq(defaultFacing('on', CHAIR), 'south', '在中間的東西上面：面朝南');
}
{
  const absent = { id: 'C01', name: '江小白', present: false, item: null, side: null, along: null, posture: null, facing: null };
  const m = moveTo(absent, { item: '長餐桌', side: 'east', along: 0.333 }, [TABLE]);
  ok(m.present && m.posture === 'stand' && m.facing === 'west' && m.along === 0.33, '從托盤拖進來：在場、站著、面朝那件東西，along 取兩位');
  const sat = moveTo(m, { item: '主位太師椅', side: 'on', along: 0.5 }, [TABLE, CHAIR]);
  ok(sat.posture === 'sit' && sat.along === 0.5, '拖到能坐的東西上：坐下');
  const turned = { ...m, facing: 'north' };
  eq(moveTo(turned, { item: '長餐桌', side: 'east', along: 0.8 }, [TABLE]).facing, 'north', '同一側挪一挪：朝向照舊');
  eq(moveTo(turned, { item: '長餐桌', side: 'west', along: 0.8 }, [TABLE]).facing, 'east', '換了一側：轉過去面朝它');
}

/* ---------------- 走位句 ---------------- */

{
  const p = { id: 'C04', name: '胡二爺', present: true, item: '第三排坐板', side: 'on', along: 0.5, posture: 'sit', facing: 'north' };
  eq(placeSentence(p, 'zh'), '胡二爺坐在第三排坐板上，面朝北', '在東西上面的說法');
  eq(placeSentence(p, 'en', undefined, 'third bench row'), '胡二爺 sits on the third bench row, facing north', '英文說法用另一種語言的名字');
  eq(placeSentence({ ...p, present: false }, 'zh'), null, '不在場的人沒有句子');
  const a = { id: 'A', name: '蕭海龍', present: true, item: '長餐桌', side: 'east', along: 0.1, posture: 'sit', facing: 'west' };
  const b = { id: 'B', name: '蕭初然', present: true, item: '長餐桌', side: 'east', along: 0.2, posture: 'sit', facing: 'west' };
  const s = stagingBlocking({ places: [a, b], extras: 0, extrasWhere: null }, 'zh');
  ok(s.startsWith('蕭海龍坐在長餐桌東側靠北，面朝西；蕭初然坐在長餐桌東側靠北、蕭海龍南側，面朝西'), '同一側落在同一段：說清誰挨著誰');
  ok(s.endsWith('其餘座位空著，沒有其他人。'), '沒有群演：明說沒有別人');
  ok(stagingBlocking({ places: [a], extras: 3, extrasWhere: '長桌西側南端' }, 'zh').includes('另有 3 名群演在長桌西側南端，只作背景'), '有群演：幾個、在哪');
  eq(stagingBlocking({ places: [{ ...a, present: false, item: null }], extras: 0 }, 'zh'), null, '開場沒人在場：沒有走位句');
}
{
  const lines = blockingLines(FIXTURE, 'en');
  ok(lines[0].blocking.includes('earth bank at the shore'), '英文走位句用認圖時寫的 alt');
  eq(lines.length, FIXTURE.scenes.length, '每一場一句');
}

/* ---------------- seed ---------------- */

{
  const d = seedFromScript(SCRIPT, { art: ART, outline: OUTLINE });
  eq(d.locations.map((l) => l.sceneId), ['S02', 'S01', 'S03'], '地點按第一次出現的順序');
  eq(d.locations[0].name, '渡口棧橋', '給了 art.json 地點帶名字');
  eq(d.scenes.length, 9, '九場');
  eq(d.scenes[1].cast.map((c) => c.name), ['沈知微', '陸行遠', '老周', '胡二爺'], '給了 outline.json 人物帶名字');
  ok(d.scenes.every((s) => s.places.length === s.cast.length && s.places.every((p) => p.present === null)), '每個出場人物一條，在不在場留給模型定');
  eq(d.scenes[0].lighting, '濃霧清晨', '劇本的光照時段搬過來');
  eq(seedFromScript(SCRIPT).scenes[0].cast[0].name, 'C01', '沒給 outline.json：先用編號');
  eq(seedFromScript(SCRIPT, { eps: parseEps('5-6') }).scenes.map((s) => s.ep), [5, 5, 6, 6], '--eps 只取這幾集');
  eq([...parseEps('1,3-4')], [1, 3, 4], '集號寫法：逗號和連字元');
  const fresh = seedFromScript(SCRIPT, { art: ART, outline: OUTLINE });
  ok(!gate(fresh, 'items-read').ok && !gate(fresh, 'present-set').ok && !gate(fresh, 'extras').ok, '骨架本身過不了門：認圖、在不在場、群演都還沒定');
}

/* ---------------- 品質門 ---------------- */

{
  const opts = { script: SCRIPT, art: ART };
  const gates = gateReport(FIXTURE, opts);
  eq(gates.length, 8, '八道門');
  ok(gates.every((g) => g.ok), '自帶樣例全部通過（對著樣例劇本和美術）');
  eq(validateStaging(FIXTURE, opts), [], '樣例沒有違規');
  ok(gate(FIXTURE, 'cast-complete').detail.includes('未提供 script.json'), '沒給劇本：明說沒跟劇本核對');
}
{
  const d = clone();
  d.locations[0].items = [];
  ok(!gate(d, 'items-read').ok, '沒認圖：items-read 不過');
  const d2 = clone();
  d2.locations[2].items = d2.locations[2].items.slice(0, ITEM_RANGE[0] - 1);
  ok(!gate(d2, 'items-read').ok, `少於 ${ITEM_RANGE[0]} 件：items-read 不過`);
  const d3 = clone();
  d3.locations[0].readFrom = null;
  ok(!gate(d3, 'items-read').ok, '沒寫 readFrom：算沒認圖');
}
{
  const d = clone();
  d.locations[0].items[1].name = d.locations[0].items[0].name;
  ok(!gate(d, 'item-shape').ok, '名字重複：item-shape 不過');
  const d2 = clone();
  d2.locations[0].items[0].plan = [0.5, 0.2, 0.4, 0.3];
  ok(!gate(d2, 'item-shape').ok, 'plan 右小於左：item-shape 不過');
  const d3 = clone();
  d3.locations[0].readFrom = 'picture';
  ok(!gate(d3, 'item-shape').ok, '按圖認的卻沒有 box：item-shape 不過');
  d3.locations[0].items.forEach((i) => { i.box = [0.1, 0.1, 0.2, 0.2]; });
  ok(gate(d3, 'item-shape').ok, '補上 box 就過');
  const d4 = clone();
  d4.locations[0].items[0].on = 'yes';
  ok(!gate(d4, 'item-shape').ok, 'on 不是布林：item-shape 不過');
}
{
  const d = clone();
  d.scenes[0].sceneId = 'S09';
  ok(!gate(d, 'location-ref').ok, '這一場的地點沒有認圖結果：location-ref 不過');
  const art = JSON.parse(JSON.stringify(ART));
  art.scenes = art.scenes.filter((s) => s.id !== 'S03');
  ok(!gate(FIXTURE, 'location-ref', { art }).ok, '地點不在 art.json 裡：location-ref 不過');
}
{
  const d = clone();
  d.scenes[1].places.pop();
  ok(!gate(d, 'cast-complete').ok, '少一個人：cast-complete 不過');
  const d2 = clone();
  d2.scenes[1].places.push({ ...d2.scenes[1].places[0], id: 'C09', name: '路人' });
  ok(!gate(d2, 'cast-complete').ok, '多一個出場人物表以外的人：cast-complete 不過');
  const d3 = clone();
  d3.scenes[1].places.push({ ...d3.scenes[1].places[1] });
  ok(!gate(d3, 'cast-complete').ok, '同一個人兩條：cast-complete 不過');
  const script = JSON.parse(JSON.stringify(SCRIPT));
  script.episodes[0].scenes[0].characters.push('C02');
  ok(!gate(FIXTURE, 'cast-complete', { script }).ok, '出場人物跟劇本不一致：cast-complete 不過');
}
{
  const d = clone();
  d.scenes[2].places[0].present = null;
  ok(!gate(d, 'present-set').ok, '沒定在不在場：present-set 不過');
  const d2 = clone();
  d2.scenes[2].places = d2.scenes[2].places.map((p) => ({ ...p, present: false, item: null, side: null, along: null }));
  ok(!gate(d2, 'present-set').ok, '開場一個人都不在：present-set 不過');
}
{
  const breakIt = (change) => {
    const d = clone();
    Object.assign(d.scenes[2].places[0], change);
    return gate(d, 'place-valid').ok;
  };
  ok(!breakIt({ item: '屏風' }), '站在認圖裡沒有的東西旁：place-valid 不過');
  ok(!breakIt({ side: 'up' }), 'side 寫錯：place-valid 不過');
  ok(!breakIt({ item: '西側艙壁', side: 'on' }), '寫了在不能坐不能站的東西上：place-valid 不過');
  ok(!breakIt({ item: '西側艙壁', side: 'east', along: 1.5 }), 'along 超出 0–1：place-valid 不過');
  ok(breakIt({ item: '西側艙壁', side: 'east', along: 0.4, posture: 'stand', facing: 'east' }), '站在艙壁東側：合法');
  ok(!breakIt({ posture: 'lie' }), 'posture 寫錯：place-valid 不過');
  ok(!breakIt({ facing: 'up' }), 'facing 寫錯：place-valid 不過');
  const d = clone();
  d.scenes[1].places[0].item = '第一排坐板';
  ok(!gate(d, 'place-valid').ok, '不在場的人寫了 item：place-valid 不過');
}
{
  const d = clone();
  const [a, b] = d.scenes[2].places;
  Object.assign(a, { item: '西側艙壁', side: 'east', along: 0.5, posture: 'stand', facing: 'east' });
  Object.assign(b, { item: '西側艙壁', side: 'east', along: 0.5 + MIN_APART / 2, posture: 'stand', facing: 'east' });
  ok(!gate(d, 'no-overlap').ok, '同一側捱得太近：no-overlap 不過');
  b.along = 0.5 + MIN_APART * 1.5;
  ok(gate(d, 'no-overlap').ok, '拉開就過');
  Object.assign(b, { item: '第一排坐板', side: 'on', along: 0.5 });
  Object.assign(a, { item: '第一排坐板', side: 'on', along: 0.5, posture: 'sit' });
  ok(gate(d, 'no-overlap').ok, '幾個人坐在同一條坐板上不算疊：並排畫開');
}
{
  const d = clone();
  d.scenes[0].extras = null;
  ok(!gate(d, 'extras').ok, '群演人數沒寫：extras 不過');
  const d2 = clone();
  d2.scenes[0].extras = 2;
  ok(!gate(d2, 'extras').ok, '有群演沒寫在哪：extras 不過');
  d2.scenes[0].extrasWhere = '岸端土坡西頭';
  ok(gate(d2, 'extras').ok, '寫了在哪就過');
  const d3 = clone();
  d3.scenes[0].extrasWhere = '岸端土坡';
  ok(!gate(d3, 'extras').ok, '沒有群演卻寫了在哪：extras 不過');
}
{
  const d = clone();
  d.scenes[0].places[0].item = '屏風';
  const problems = validateStaging(d);
  ok(problems.length === 1 && problems[0].startsWith('第 1 集第 1 場：沈知微'), 'validate 每條帶上場次和人');
  const live = sceneProblems(d.scenes[0], d.locations[0], 'en');
  ok(live[0].text.includes('is not one of the things'), '報告頁面上的檢查有英文說法');
}

/* ---------------- 報告 ---------------- */

{
  const md = renderMarkdown(FIXTURE);
  ok(md.startsWith('# 渡口 · 開場站位'), 'markdown 標題');
  ok(md.includes('沈知微站在岸端土坡上，面朝北；老周坐在靠岸的渡船上，面朝南'), 'markdown 帶每場的走位句');
  ok(md.includes('開場不在：胡二爺'), 'markdown 寫明誰開場不在');
  ok(renderMarkdown(FIXTURE, 'en').includes('Opening staging'), 'markdown 英文介面');
}
{
  const html = renderHtml(FIXTURE);
  ok(html.includes('id="staging-data"') && html.includes('function stagingCore()'), '報告帶著資料和同一份演算法');
  ok(html.includes('class="card scene"') && html.includes('class="room"'), '每場一張能拖的平面');
  ok(html.includes('匯出 JSON') && html.includes('還原到檔案裡的版本'), '匯出和還原按鈕');
  ok(html.includes('✓ 品質門 8/8'), '頁首品質門徽章');
  const d = clone();
  d.scenes[0].places[0].name = '</script><b>x';
  const bad = renderHtml(d);
  ok(!bad.includes('</script><b>x'), '資料裡的 </script 被轉義，截不斷腳本');
  ok(renderHtml(FIXTURE, 'en').includes('lang="en"') && renderHtml(FIXTURE, 'en').includes('Opening blocking'), '--lang en 出英文介面');
  let threw = false;
  try { renderHtml(FIXTURE, 'jp'); } catch { threw = true; }
  ok(threw, '非內建語言直接拋錯（目前內建 zh / en）');
  const withPic = clone();
  withPic.locations[1].readFrom = 'picture';
  withPic.locations[1].items.forEach((i) => { i.box = [0.1, 0.2, 0.3, 0.4]; });
  const pic = renderHtml(withPic, 'zh', { S01: 'images/渡船船艙-sheet.png' });
  ok(pic.includes('src="images/渡船船艙-sheet.png"') && pic.includes('class="pbox"'), '有圖就嵌圖，認出來的東西在圖上畫框');
  ok(!renderHtml(FIXTURE).includes('class="pbox"'), '沒圖不畫框，顯示佔位');
}
{
  // 頁面裡那份演算法是 stagingCore 的原始碼原樣嵌進去的：單獨拿原始碼重建一份，結果必須一樣
  const rebuilt = new Function(`${stagingCore.toString()}\nreturn stagingCore();`)();
  eq(rebuilt.nearestPlace({ x: 0.75, y: 0.36 }, [TABLE, CHAIR]), nearestPlace({ x: 0.75, y: 0.36 }, [TABLE, CHAIR]), '嵌進頁面的演算法不依賴外面的東西');
  eq(rebuilt.stagingBlocking(FIXTURE.scenes[3], 'zh'), stagingBlocking(FIXTURE.scenes[3], 'zh'), '頁面上算出的走位句跟命令列一樣');
}
{
  eq(slug('渡口 棧橋/東'), '渡口-棧橋-東', 'slug 去掉空白和斜槓');
  eq(slug('  '), 'scene', '空名字有兜底');
}

/* ---------------- CLI 預設交付格式 ---------------- */
{
  const cli = join(here, 'novel-staging.mjs');
  const fixture = join(here, '..', 'examples', '渡口-staging.json');
  const render = (...args) => spawnSync(process.execPath, [cli, 'render', fixture, ...args], { encoding: 'utf8' });
  const primary = render();
  ok(primary.status === 0 && /^<!doctype html>/i.test(primary.stdout), '不指定格式：預設輸出 HTML 工具報告');
  const legacy = render('--html');
  ok(legacy.status === 0 && /^<!doctype html>/i.test(legacy.stdout), '顯式 --html 繼續輸出 HTML');
  const text = render('--md');
  ok(text.status === 0 && text.stdout.startsWith('# 渡口 · 開場站位'), '顯式 --md 才輸出 Markdown');
  const english = render('--lang', 'en');
  ok(english.status === 0 && /<html lang="en">/.test(english.stdout), '預設 HTML 支援英文介面');
  const conflict = render('--html', '--md');
  ok(conflict.status !== 0 && conflict.stdout === '', '格式衝突時不輸出混合產物');
}

console.log(`✓ ${passed} 項自測全部通過`);
