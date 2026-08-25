#!/usr/bin/env node
// 自測：覆蓋 novel-art.mjs 裡所有確定性邏輯（場景 + 道具）。
// 不呼叫任何模型，不花額度，跑一次 < 1 秒。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANCHOR_RANGE,
  DEFAULT_STYLE,
  SCENE_STYLE_PRESETS,
  SUPPORTED_STYLES,
  castNamesOf,
  gateReport,
  renderHtml,
  renderMarkdown,
  scenePreset,
  seedFromOutline,
  slug,
  PROP_SCALES,
  validateArt,
} from './novel-art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '..', 'examples', '渡口-art.json'), 'utf8'));
const OUTLINE = JSON.parse(
  readFileSync(join(here, '..', '..', 'novel-outline', 'examples', '渡口-outline.json'), 'utf8'),
);
const CAST = JSON.parse(
  readFileSync(join(here, '..', '..', 'novel-characters', 'examples', '渡口-cast.json'), 'utf8'),
);

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, `${msg} — 期望 ${expected}，實際 ${actual}`);
  passed++;
}
const clone = () => JSON.parse(JSON.stringify(FIXTURE));
const gate = (d, id, names = null) => gateReport(d, names).find((g) => g.id === id);

/* ---------------- 畫風預設 ---------------- */

eq(DEFAULT_STYLE, 'realistic', '預設半寫實');
eq(SUPPORTED_STYLES.join(','), 'realistic,ghibli', '兩檔畫風與 novel-characters 同名對齊');
ok(!/photorealistic/.test(SCENE_STYLE_PRESETS.realistic.negative), 'realistic 不禁 photorealistic');
ok(/photorealistic/.test(SCENE_STYLE_PRESETS.ghibli.negative), 'ghibli 必須禁 photorealistic');
ok(/people/.test(SCENE_STYLE_PRESETS.realistic.negative), 'realistic 預設自帶禁人');
ok(/people/.test(SCENE_STYLE_PRESETS.ghibli.negative), 'ghibli 預設自帶禁人');
ok(!/pore|skin|subsurface/i.test(SCENE_STYLE_PRESETS.realistic.surface), '環境預設不帶皮膚毛孔那套——那是角色的');
eq(scenePreset('nope'), SCENE_STYLE_PRESETS.realistic, '未知風格退回預設');

/* ---------------- slug ---------------- */

eq(slug('渡船船艙'), '渡船船艙', '中文場景名保留');
eq(slug('軍區總院·中醫獨立診室'), '軍區總院-中醫獨立診室', '間隔號替換');
eq(slug('a/b:c'), 'a-b-c', '危險字元替換');

/* ---------------- seed ---------------- */

const seeded = seedFromOutline(OUTLINE);
eq(seeded.source, '渡口', 'seed 帶書名');
eq(seeded.style, 'realistic', 'seed 預設畫風');
eq(seeded.scenes.length, 3, 'seed 搬全部場景');
{
  const s01 = seeded.scenes.find((s) => s.id === 'S01');
  eq(s01.usage.episodes.join(','), '1,2,3,4,5,6', 'seed 算出出現集');
  eq(s01.usage.beats.join(','), '懸念鉤,身份揭破,反轉,收束', 'seed 算出承載爽點');
  eq(s01.summary, '', '設計欄位留給模型填');
  const s03 = seeded.scenes.find((s) => s.id === 'S03');
  ok(s03.seedNote?.includes('複用方案'), 'outline 的 reusePlan 變成 seedNote 提示做變體');
  ok(!seeded.scenes.find((s) => s.id === 'S01').seedNote, '沒有複用方案的場景不帶 seedNote');
}
{
  // 道具：大綱從 1.1.0 起帶 props，seed 要吃到
  eq(seeded.props.length, OUTLINE.props.length, 'seed 搬全部道具');
  const p01 = seeded.props.find((pr) => pr.id === 'P01');
  const src = OUTLINE.props.find((pr) => pr.id === 'P01');
  eq(p01.name, src.name, '道具名從大綱搬過來');
  // 兩邊指的是同一件事：這件物件在戲裡幹什麼，不是材質描述
  eq(p01.summary, src.function, '大綱的 function 落成這裡的 summary');
  const epsWithP01 = OUTLINE.episodes.filter((e) => (e.propIds ?? []).includes('P01')).map((e) => e.ep);
  eq(p01.usage.episodes.join(','), epsWithP01.join(','), 'seed 算出道具的出現集');
  // beatIds 是 id，art 這邊要的是爽點型別，seed 負責翻譯
  eq(p01.usage.beats.join(','), src.beatIds.map((id) => OUTLINE.beats.find((b) => b.id === id).type).join(','),
    'beatIds 翻譯成爽點型別');
  // 設計欄位留給模型
  eq(p01.scale, '', '尺度留空——那是美術層的活');
  eq(p01.states.length, 0, '狀態變體留空');
  eq(p01.image.prompt, '', '生圖提示詞留空');
  eq(p01.carriedBy.length, 0, '跟誰走留空');
}

// 舊大綱沒有 props 欄位：返回空陣列，模型照 prop-pass.md 從原文提取，跟以前一樣
{
  const noProps = JSON.parse(JSON.stringify(OUTLINE));
  delete noProps.props;
  const r = seedFromOutline(noProps);
  eq(r.props.length, 0, '舊大綱 seed 出空道具表，不是 undefined');
  ok(Array.isArray(r.props), '空道具表仍然是陣列，呼叫方不用判空');
}

ok(seedFromOutline({}).scenes.length === 0, '空大綱不炸');
ok(seedFromOutline({}).props.length === 0, '空大綱的道具表也是空陣列');

/* ---------------- castNamesOf ---------------- */

const NAMES = castNamesOf(CAST);
ok(NAMES.includes('沈知微') && NAMES.includes('老周'), 'cast 名字提出來了');
ok(NAMES.includes('老伯'), '別名也提出來了');
ok(castNamesOf({ characters: [] }).length === 0, '空 cast 不炸');

/* ---------------- 夾具本身 ---------------- */

eq(validateArt(FIXTURE, NAMES).length, 0, '自帶樣例通過校驗（含角色名檢查）');
ok(gateReport(FIXTURE, NAMES).every((g) => g.ok), '樣例全部品質門通過');
eq(gateReport(FIXTURE).length, 11, '品質門共 11 道（場景 7 + 道具 4）');

/* ---------------- 品質門逐項擊穿 ---------------- */
// 每一道門都要證明它真的會攔——不然就是永遠為真的假測試

// G1 錨點 3–5
eq(ANCHOR_RANGE.join('-'), '3-5', '錨點範圍 3–5');
{
  const d = clone();
  d.scenes[0].anchors = d.scenes[0].anchors.slice(0, 2);
  ok(!gate(d, 'anchors').ok, '錨點只有 2 個被攔');
  ok(gate(d, 'anchors').detail.includes('渡船船艙'), '報錯點名場景');
}
{
  const d = clone();
  d.scenes[0].anchors = Array.from({ length: 6 }, (_, i) => ({ name: `錨${i}`, desc: 'x' }));
  ok(!gate(d, 'anchors').ok, '錨點 6 個也被攔——QC 核對不過來');
}

// G3 光照狀態
{
  const d = clone();
  d.scenes[2].lighting = [];
  ok(!gate(d, 'lighting').ok, '沒有光照狀態被攔——換時段是重新生成不是重新打燈');
}

// G4 空景
{
  const d = clone();
  d.scenes[0].image.negativePrompt = 'plastic CG look, text, watermark';
  ok(!gate(d, 'no-people').ok, '負向提示詞沒禁人被攔——環境參考圖必須空景');
}

// G5 提示詞英文
{
  const d = clone();
  d.scenes[0].image.prompt = '一條老木船的客艙';
  ok(!gate(d, 'english').ok, '主提示詞寫中文被攔');
}
{
  const d = clone();
  d.scenes[0].lighting[0].prompt = '濃霧平光';
  ok(!gate(d, 'english').ok, '光照提示詞寫中文也被攔');
}

// G6 提示詞不含角色名
{
  const d = clone();
  d.scenes[0].image.prompt += ' where 老周 stands';
  ok(!gate(d, 'no-names', NAMES).ok, '提示詞裡出現角色名被攔');
  ok(gate(d, 'no-names', NAMES).detail.includes('老周'), '報錯點名是誰');
  ok(gate(d, 'no-names').ok, '沒給 cast 時這道門跳過（視為通過）');
  ok(gate(d, 'no-names').detail.includes('跳過'), '跳過時明說，不裝作查過');
}
{
  const d = clone();
  d.scenes[1].lighting[0].prompt += ' with 老伯 in frame';
  ok(!gate(d, 'no-names', NAMES).ok, '別名也攔（光照提示詞同樣查）');
}

// G7 變體引用
{
  const d = clone();
  d.scenes[2].variantOf = 'S99';
  ok(!gate(d, 'variants').ok, '指向不存在的母場景被攔');
}
{
  const d = clone();
  d.scenes[2].variantOf = 'S03';
  ok(!gate(d, 'variants').ok, '自己指自己被攔');
}
{
  const d = clone();
  delete d.scenes[2].changes;
  ok(!gate(d, 'variants').ok, '變體缺 changes 被攔——不說改了什麼等於沒說');
}

// G8 風格與反向詞匹配
{
  const d = clone();
  d.scenes[0].image.negativePrompt += ', photorealistic, 3d render';
  ok(!gate(d, 'style-match').ok, 'realistic 禁 photorealistic 被攔——自相矛盾');
}
{
  const d = clone();
  d.style = 'ghibli';
  ok(!gate(d, 'style-match').ok, '切 ghibli 後沒禁 photorealistic 被攔');
}
{
  const d = clone();
  d.scenes[0].image.sheet = 'ONE 16:9 landscape canvas, three zones, no people';
  ok(!gate(d, 'style-match').ok, 'sheet 缺渲染句被攔——畫風會飄');
}

/* ---------------- validate 結構檢查 ---------------- */

ok(validateArt(null).length === 1, 'null 直接報');
ok(validateArt({}).some((x) => x.includes('source')), '缺書名被攔');
ok(validateArt({ source: 'x', style: '水墨' }).some((x) => x.includes('style')), '未知畫風被攔');
{
  const d = clone();
  d.scenes[0].id = 'X1';
  ok(validateArt(d).some((x) => x.includes('S01 這種格式')), '場景 id 格式被攔');
}
{
  const d = clone();
  d.scenes[1].id = 'S01';
  ok(validateArt(d).some((x) => x.includes('重複')), '場景 id 重複被攔');
}
{
  const d = clone();
  d.scenes[0].summary = ' ';
  ok(validateArt(d).some((x) => x.includes('summary')), '缺設計意圖被攔');
}
{
  const d = clone();
  delete d.scenes[0].primary;
  ok(validateArt(d).some((x) => x.includes('primary')), '缺主場景標記被攔');
}
{
  const d = clone();
  d.scenes[0].anchors[0] = { name: '只有名字' };
  ok(validateArt(d).some((x) => x.includes('錨點缺')), '錨點缺描述被攔');
}
{
  const d = clone();
  d.scenes[0].lighting[0] = { state: '夜戲' };
  ok(validateArt(d).some((x) => x.includes('夜戲')), '光照缺提示詞被攔且點名狀態');
}
{
  const d = clone();
  delete d.scenes[0].image.sheet;
  ok(validateArt(d).some((x) => x.includes('image.sheet')), '缺設定圖提示詞被攔');
}
{
  const d = clone();
  d.scenes[0].usage = { episodes: 'not-array', beats: [] };
  ok(validateArt(d).some((x) => x.includes('usage.episodes')), 'usage 結構錯被攔');
}

/* ---------------- render markdown ---------------- */

const md = renderMarkdown(FIXTURE);
ok(md.startsWith('# 渡口 · 美術設定集'), 'MD 標題');
ok(md.includes('## 場景清單'), 'MD 有場景清單');
ok(md.includes('變體 ← S02'), 'MD 清單標出變體來源');
ok(md.includes('## S01 渡船船艙'), 'MD 每場景一節');
ok(md.includes('一致性錨點'), 'MD 有錨點');
ok(md.includes('**補丁船篷**'), 'MD 錨點帶名字');
ok(!md.includes('定機位'), 'MD 不再有定機位庫——AI 生產的空間錨在參考圖不在文字');
ok(md.includes('光照與時段'), 'MD 有光照狀態');
ok(md.includes('```text'), 'MD 提示詞進程式碼塊');

/* ---------------- render html ---------------- */

const html = renderHtml(FIXTURE);
ok(html.startsWith('<!doctype html>'), 'HTML 完整文件');
ok(!/<script\s+src=/.test(html), '不引外部腳本');
ok(!/<link\s/.test(html), '不引外部樣式');
ok(!/@import|url\(https?:/.test(html), 'CSS 不拉外部資源');
ok(/<script\s+src=/.test('<script src="x.js">'), '外部腳本檢測正則有效');

eq((html.match(/class="kpi[ "]/g) || []).length, 4, 'KPI 帶 4 張卡（場景/道具/錨點/光照）');
ok(html.includes('主場景 2 · 變體 1'), 'KPI 場景卡帶分類');
ok(html.includes('敘事道具'), 'KPI 有敘事道具卡');
eq((html.match(/class="scene" /g) || []).length, 5, '5 張設定卡（3 場景 + 2 道具）');
ok(html.includes('>場景清單<') && html.includes('>場景設定卡<') && html.includes('>道具清單<') && html.includes('>道具設定卡<') && html.includes('>品質門<'), '五個區塊都在');
ok(html.indexOf('>場景設定卡<') < html.indexOf('>道具清單<') && html.indexOf('>道具設定卡<') < html.indexOf('>品質門<'), '道具在場景後、品質門前');
ok(html.indexOf('>場景清單<') < html.indexOf('>場景設定卡<'), '清單在卡片前');
eq((html.match(/class="anchors"/g) || []).length, 5, '每張卡有錨點列表（3 場景 + 2 道具）');
ok(html.includes('變體來源：<b>S02</b>'), '變體卡標母場景');
ok(html.includes('plate-empty'), '沒生圖時有佔位');
ok(html.includes('class="cards"'), '設定卡一排兩張的網格');
ok(/\.cards\{[^}]*grid-template-columns:1fr 1fr/.test(html), '兩列布局');
// 點圖彈層
ok(html.includes('class="lightbox"'), '有圖片彈層');
ok(/closeLb\(\)/.test(html), '彈層能關閉');
ok(/e\.key === 'Escape'/.test(html), 'Esc 關閉彈層');
{
  const d = clone();
  d.scenes[0].sheetImage = 'images/x-sheet.png';
  const withImg = renderHtml(d);
  ok(withImg.includes('class="zoom" data-src="images/x-sheet.png"'), '生圖後圖片可點，彈層拿到地址');
  ok(withImg.includes('cursor:zoom-in'), '滑鼠提示可放大');
}
eq((html.match(/<li class="ok">/g) || []).length, 11, '11 道品質門全 ✓');
ok(html.includes('gatepill pass'), '頁首徽章通過態');
ok(html.includes('未提供 cast.json'), '報告如實標註角色名檢查被跳過');

// 品質門失敗也要渲染
{
  const d = clone();
  d.scenes[0].anchors = [];
  const bad = renderHtml(d);
  ok(bad.includes('gatepill fail'), '失敗時頁首徽章變紅');
  ok(bad.includes('class="galert"'), '失敗時彈病灶橫幅');
  ok(bad.includes('<li class="bad">'), '未過的門標 ✗');
}

// 匯出：內嵌的就是 art.json 原樣
ok(html.includes('<script type="application/json" id="art-data">'), '資料內嵌');
ok(html.includes('data-name="渡口-art.json"'), '下載檔名跟書名（art.json）');
{
  const embedded = html.match(/<script type="application\/json" id="art-data">([\s\S]*?)<\/script>/)[1];
  const round = JSON.parse(embedded.replace(/\\u003c/g, '<'));
  eq(JSON.stringify(round), JSON.stringify(FIXTURE), '匯出資料與 art.json 逐位元組一致');
  eq(validateArt(round, NAMES).length, 0, '匯出資料能直接餵回 validate');
}
ok(html.includes('revokeObjectURL(url), 10000'), 'blob 延後回收——Safari 搶跑會存出空檔案');

// XSS：資料是模型生成的，一律轉義
{
  const d = clone();
  d.scenes[0].name = '<img src=x onerror=alert(1)>';
  d.scenes[0].anchors[0].desc = '<b>粗體</b>';
  const evil = renderHtml(d);
  ok(!evil.includes('<img src=x'), '場景名裡的 HTML 被轉義');
  ok(!evil.includes('<b>粗體</b>'), '錨點描述裡的 HTML 被轉義');
}
// </script 會截斷內嵌資料區塊
{
  const d = clone();
  d.scenes[0].summary = '他說</script><script>alert(1)</script>了嗎';
  const x = renderHtml(d).match(/id="art-data">([\s\S]*?)<\/script>/)[1];
  ok(!x.includes('</script'), '資料區塊裡的 </script 被轉義');
  eq(JSON.parse(x.replace(/\\u003c/g, '<')).scenes[0].summary, d.scenes[0].summary, '轉義了但內容沒丟');
}

ok(html.includes('@media print'), '可列印');
ok(html.includes('prefers-reduced-motion'), '尊重減少動效');
ok(/@media print\{[\s\S]*\.pr p\{display:block!important/.test(html), '列印時提示詞全展開');
ok(html.includes('參考圖一律無人'), '頁尾寫明無人原則（道具另加無手白底）');

/* ---------------- 道具（敘事道具層）---------------- */

eq(Object.keys(PROP_SCALES).join(','), '手持級,桌面級,傢俱級', '尺度三檔');
eq(FIXTURE.props.length, 2, '樣例帶兩件敘事道具');

// 道具四道門逐項擊穿
{
  const d = clone();
  d.props[0].states = [];
  ok(!gate(d, 'prop-states').ok, '道具沒有狀態被攔——合上和開啟是兩張參考');
}
{
  const d = clone();
  d.props[0].scale = '巨型';
  ok(!gate(d, 'prop-scale').ok, '未知尺度被攔');
}
{
  const d = clone();
  d.props[0].image.prompt = d.props[0].image.prompt.replace('handheld scale', 'nice size');
  ok(!gate(d, 'prop-scale').ok, '提示詞缺尺度短語被攔——AI 會把手持道具畫成傢俱');
  ok(gate(d, 'prop-scale').detail.includes('handheld scale'), '報錯點名缺哪個短語');
}
{
  const d = clone();
  d.props[1].image.negativePrompt = 'people, plastic CG look, text';
  ok(!gate(d, 'prop-hands').ok, '負向提示詞沒禁手被攔——拿著道具的手是最常見汙染');
}
{
  const d = clone();
  d.props[0].image.sheet = d.props[0].image.sheet.replace(/pure white background/gi, 'soft grey backdrop');
  ok(!gate(d, 'prop-white').ok, '設定圖不是白底被攔——道具圖要能摳');
}
// 共用門也覆蓋道具
{
  const d = clone();
  d.props[0].anchors = d.props[0].anchors.slice(0, 1);
  ok(!gate(d, 'anchors').ok, '道具錨點不足也被錨點門攔');
}
{
  const d = clone();
  d.props[0].states[0].prompt = '合上的皮箱';
  ok(!gate(d, 'english').ok, '道具狀態提示詞寫中文被英文門攔');
}
{
  const d = clone();
  d.props[0].image.prompt += ' carried by 沈知微';
  ok(!gate(d, 'no-names', NAMES).ok, '道具提示詞出現角色名被攔');
}
// 道具沒有光照門的義務
{
  const d = clone();
  ok(gate(d, 'lighting').ok, '道具不查光照——那是場景的門');
}
// 結構檢查
{
  const d = clone();
  d.props[0].id = 'X1';
  ok(validateArt(d).some((x) => x.includes('P01 這種格式')), '道具 id 格式被攔');
}
{
  const d = clone();
  d.props[1].id = 'P01';
  ok(validateArt(d).some((x) => x.includes('道具 id P01 重複')), '道具 id 重複被攔');
}
{
  const d = clone();
  d.props[0].relatedScenes = ['S99'];
  ok(validateArt(d).some((x) => x.includes('S99 不存在')), '道具關聯不存在的場景被攔');
}
{
  const d = clone();
  d.props[0].states[0] = { state: '合上' };
  ok(validateArt(d).some((x) => x.includes('合上')), '狀態缺提示詞被攔且點名');
}
// 無道具的文件：道具門放行、報告不渲染道具區塊
{
  const d = clone();
  delete d.props;
  eq(validateArt(d, NAMES).length, 0, '沒有道具塊也合法——道具是可選層');
  ok(gateReport(d).filter((g) => g.id.startsWith('prop-')).every((g) => g.ok), '無道具時四道道具門放行');
  ok(!renderHtml(d).includes('>道具清單<'), '無道具時報告不渲染道具區塊');
}
// 渲染
{
  ok(md.includes('## 道具清單'), 'MD 有道具清單');
  ok(md.includes('## P01 舊皮箱'), 'MD 每件道具一節');
  ok(md.includes('狀態變體'), 'MD 有狀態變體');
  ok(html.includes('>P01<') || html.includes('P01'), 'HTML 道具卡有 ID');
  ok(html.includes('手持級'), 'HTML 道具卡帶尺度徽章');
  ok(html.includes('關聯場景：<b>S01</b>'), 'HTML 道具卡帶關聯場景');
}

/* ---------------- render 英文介面（--lang en）---------------- */

{
  const en = renderHtml(FIXTURE, 'en');
  ok(en.includes('lang="en"'), '英文報告 <html lang="en">');
  ok(en.includes('Export JSON'), '英文報告有 Export JSON');
  ok(en.includes('>Scene list<'), '英文報告有 Scene list');
  ok(en.includes('>Quality gates<'), '英文報告有 Quality gates 區塊');
  ok(en.includes('Consistency anchors'), '英文報告有 Consistency anchors');
  ok(!en.includes('匯出 JSON'), '英文報告不含「匯出 JSON」');
  ok(!en.includes('場景清單'), '英文報告不含「場景清單」');
  ok(!en.includes('品質門'), '英文報告不含「品質門」（門的中文 label 屬於品質門層，不在介面表裡）');
  ok(html.includes('lang="zh"'), '預設報告仍是 <html lang="zh">');
  ok(renderMarkdown(FIXTURE, 'en').includes('## Scene list'), 'MD 英文介面有 Scene list');
}
{
  const d = clone();
  d.lang = 'en';
  ok(renderHtml(d).includes('lang="en"'), 'art.json 頂層 lang 欄位生效');
  ok(renderHtml(d, 'zh').includes('lang="zh"'), '--lang 優先於 lang 欄位');
}
{
  let threw = false;
  try { renderHtml(FIXTURE, 'jp'); } catch { threw = true; }
  ok(threw, '非內建語言直接拋錯（目前內建 zh / en）');
}

// 品質門面板是報告的一部分：英文介面下門標籤也要翻譯（閾值由門自己算，原樣保留）
{
  const gateEn = renderHtml(FIXTURE, 'en');
  ok(gateEn.includes('Consistency anchors, 3–5'), 'EN 報告的品質門標籤翻譯且閾值原樣保留');
  ok(!gateEn.includes('一致性錨點 3–5 個'), 'EN 報告不再出現中文門標籤');
}
console.log(`✓ ${passed} 項自測全部通過`);
