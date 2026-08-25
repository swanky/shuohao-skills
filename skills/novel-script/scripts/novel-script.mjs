#!/usr/bin/env node
// novel-script — deterministic helpers for the novel-script skill (劇本).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 時長引擎                                                             */
/* ------------------------------------------------------------------ */
/*
 * 劇本層不分鏡頭（分鏡是下一個 skill 的活），但時長預算必須在這層守住：
 * AI 短劇一集就是三分鐘上下，臺詞寫超了後面全盤返工。
 *
 * 估算模型：臺詞秒數 = 非空白字元數 ÷ 語速；動作節拍按固定秒數計。
 * 是估算不是秒錶，所以容差給到 ±15%（可配）——但估算也比不算強得多，
 * 一集寫到五分鐘的劇本在這裡就會被攔下，不會流到生成環節才發現。
 */

export const DEFAULT_PARAMS = {
  charsPerSecond: 4.5, // 中文口語偏快檔
  actionSeconds: 2.5,  // 每個動作節拍的估時
  tolerance: 0.15,     // 時長容差 ±15%
  maxLineChars: 35,    // 單句臺詞上限——一口氣說不完的臺詞也生成不了
  hookWindow: 3,       // 開場鉤子必須在全集前幾拍內兌現——短劇開場 3 秒定生死
};

export function paramsOf(doc) {
  return { ...DEFAULT_PARAMS, ...(doc?.params ?? {}) };
}

/** 臺詞計秒用的字元數：去空白，標點算時間（停頓也是時間）。 */
export const lineChars = (line) => String(line ?? '').replace(/\s+/g, '').length;

const r1 = (n) => Math.round(n * 10) / 10;

/** 一場戲的估秒。flow 裡臺詞按語速折算，動作節拍按固定秒數。 */
export function sceneSeconds(scene, params = DEFAULT_PARAMS) {
  let dlg = 0;
  let act = 0;
  for (const b of scene?.flow ?? []) {
    if (typeof b?.line === 'string') dlg += lineChars(b.line) / params.charsPerSecond;
    else if (typeof b?.action === 'string') act += params.actionSeconds;
  }
  return { dialogue: r1(dlg), action: r1(act), total: r1(dlg + act) };
}

/* ------------------------------------------------------------------ */
/* stats — 報告與品質門共用的確定性統計                                   */
/* ------------------------------------------------------------------ */

export function computeStats(doc) {
  const params = paramsOf(doc);
  const episodes = [];
  const sceneTable = [];
  const byCharacter = new Map(); // C01 → { lines: [...], chars }

  for (const ep of doc?.episodes ?? []) {
    let dlg = 0;
    let act = 0;
    let lines = 0;
    (ep?.scenes ?? []).forEach((sc, idx) => {
      const sec = sceneSeconds(sc, params);
      dlg += sec.dialogue;
      act += sec.action;
      let lineCount = 0;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.line !== 'string') continue;
        lineCount++;
        lines++;
        const key = b.speaker ?? '?';
        if (!byCharacter.has(key)) byCharacter.set(key, { lines: [], chars: 0 });
        const entry = byCharacter.get(key);
        entry.lines.push({ ep: ep.ep, sceneIndex: idx + 1, sceneId: sc.sceneId, line: b.line, delivery: b.delivery ?? '' });
        entry.chars += lineChars(b.line);
      }
      sceneTable.push({
        ep: ep.ep, index: idx + 1, sceneId: sc.sceneId, lighting: sc.lighting ?? '',
        characters: sc.characters ?? [], props: sc.props ?? [],
        lineCount, estSeconds: sec.total,
      });
    });
    episodes.push({
      ep: ep.ep,
      target: ep.targetSeconds,
      est: r1(dlg + act),
      dialogueSeconds: r1(dlg),
      actionSeconds: r1(act),
      lines,
      sceneCount: (ep?.scenes ?? []).length,
    });
  }

  const totals = {
    episodes: episodes.length,
    scenes: sceneTable.length,
    lines: episodes.reduce((n, e) => n + e.lines, 0),
    estSeconds: r1(episodes.reduce((n, e) => n + e.est, 0)),
    targetSeconds: episodes.reduce((n, e) => n + (e.target ?? 0), 0),
    dialogueSeconds: r1(episodes.reduce((n, e) => n + e.dialogueSeconds, 0)),
  };

  const castLines = [...byCharacter.entries()]
    .map(([id, v]) => ({ id, count: v.lines.length, chars: v.chars, lines: v.lines }))
    .sort((a, b) => b.count - a.count);

  return { params, episodes, sceneTable, castLines, totals };
}

/* ------------------------------------------------------------------ */
/* 品質門                                                               */
/* ------------------------------------------------------------------ */
/*
 * 與儲存庫裡其他 skill 同一主張：checklist 是程式碼，不是給模型讀的文字。
 * 需要上游對賬的門（角色 / 場景與光照 / 爽點認領）在沒給上游檔案時
 * 明說跳過——靜默透過和撒謊只差一步。
 */

const thText = (s) => typeof s === 'string' && s.trim();
/** 動作描述必須是敘述體——臺詞只能進 dialogue 欄位，混進 action 就沒法計秒。 */
const QUOTE_RE = /「|」|『|』|“|”/;

export function gateReport(doc, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const eps = Array.isArray(doc?.episodes) ? doc.episodes : [];
  const params = paramsOf(doc);
  const stats = computeStats(doc);
  const bad = { duration: [], lineLen: [], speaker: [], hook: [], hookOpen: [], noAction: [], prose: [], beats: [], chars: [], scenes: [] };

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    const label = `第 ${ep?.ep} 集`;

    // 時長預算：寫超寫欠都在這層攔，別流到生成環節才發現
    if (ep?.targetSeconds > 0) {
      const lo = ep.targetSeconds * (1 - params.tolerance);
      const hi = ep.targetSeconds * (1 + params.tolerance);
      if (st.est < lo) bad.duration.push(`${label}欠 ${r1(lo - st.est)} 秒（估 ${st.est}s / 目標 ${ep.targetSeconds}s）`);
      if (st.est > hi) bad.duration.push(`${label}超 ${r1(st.est - hi)} 秒（估 ${st.est}s / 目標 ${ep.targetSeconds}s）`);
    }

    // 開場鉤子與結尾懸念：說明必須落在紙面
    if (!thText(ep?.hook) || !thText(ep?.cliff)) bad.hook.push(label);

    // 鉤子不是標籤是第一拍：hookBeat 認領具象落在哪一拍，必須在全集前幾拍內。
    // 只有說明沒有認領，就會出現「鉤子說皮箱、開場拍了八拍霧」的銜接斷裂
    {
      const hb = ep?.hookBeat;
      if (!Array.isArray(hb) || hb.length !== 2 || !Number.isInteger(hb[0]) || !Number.isInteger(hb[1])) {
        bad.hookOpen.push(`${label}缺 hookBeat（[場, 拍]，認領鉤子具象的位置）`);
      } else {
        const scene = ep?.scenes?.[hb[0] - 1];
        if (!scene || hb[1] < 1 || hb[1] > (scene.flow ?? []).length) {
          bad.hookOpen.push(`${label}的 hookBeat [${hb[0]}, ${hb[1]}] 指向不存在的節拍`);
        } else {
          let pos = hb[1];
          for (let i = 0; i < hb[0] - 1; i++) pos += (ep.scenes[i]?.flow ?? []).length;
          if (pos > params.hookWindow) {
            bad.hookOpen.push(`${label}的鉤子落在全集第 ${pos} 拍，超出前 ${params.hookWindow} 拍——冷開場先給鉤子的具象`);
          }
        }
      }
    }

    for (const sc of ep?.scenes ?? []) {
      const cast = new Set(sc?.characters ?? []);
      let hasAction = false;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.action === 'string') {
          hasAction = true;
          if (QUOTE_RE.test(b.action)) bad.prose.push(`${label} ${sc?.sceneId ?? '?'}`);
        }
        if (typeof b?.line === 'string') {
          if (lineChars(b.line) > params.maxLineChars) {
            bad.lineLen.push(`${label}「${b.line.slice(0, 12)}…」${lineChars(b.line)} 字`);
          }
          if (b.speaker !== 'VO' && !cast.has(b.speaker)) {
            bad.speaker.push(`${label} ${sc?.sceneId ?? '?'} 的「${b.speaker}」不在本場人物裡`);
          }
        }
      }
      // 純對白無動作的場 = 廣播劇，生成時沒有畫面可寫
      if ((sc?.flow ?? []).length > 0 && !hasAction) bad.noAction.push(`${label} ${sc?.sceneId ?? '?'}`);
    }
  }

  // ---- 需要上游對賬的門 ----
  const outline = ctx.outline ?? null;
  const art = ctx.art ?? null;

  if (outline) {
    const charIds = new Set((outline.characters ?? []).map((c) => c.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        for (const id of sc?.characters ?? []) {
          if (!charIds.has(id)) bad.chars.push(`第 ${ep.ep} 集 ${sc.sceneId ?? '?'} 的 ${id}`);
        }
      }
      // 爽點認領：大綱說這一集有的爆點，劇本必須認領
      const due = [...new Set((outline.beats ?? []).filter((b) => b.episode === ep.ep).map((b) => b.type))];
      const claimed = new Set(ep?.beatsClaimed ?? []);
      for (const t of due) if (!claimed.has(t)) bad.beats.push(`第 ${ep.ep} 集缺「${t}」`);
    }
  }

  if (art) {
    const sceneMap = new Map((art.scenes ?? []).map((s) => [s.id, s]));
    const propIds = new Set((art.props ?? []).map((p) => p.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        const ref = sceneMap.get(sc?.sceneId);
        if (!ref) {
          bad.scenes.push(`第 ${ep.ep} 集引用了不存在的場景 ${sc?.sceneId}`);
        } else if (thText(sc?.lighting) && !(ref.lighting ?? []).some((l) => l.state === sc.lighting)) {
          bad.scenes.push(`第 ${ep.ep} 集 ${sc.sceneId} 的光照「${sc.lighting}」沒在美術設定裡登記`);
        }
        for (const pid of sc?.props ?? []) {
          if (!propIds.has(pid)) bad.scenes.push(`第 ${ep.ep} 集引用了不存在的道具 ${pid}`);
        }
      }
    }
  }

  const SKIP_OUTLINE = '未提供 outline.json，本門跳過（視為通過）';
  const SKIP_ART = '未提供 art.json，本門跳過（視為通過）';

  add('duration', `每集時長在目標 ±${Math.round(params.tolerance * 100)}% 內`, eps.length > 0 && bad.duration.length === 0, bad.duration.join('；'));
  add('line-length', `單句臺詞 ≤ ${params.maxLineChars} 字`, bad.lineLen.length === 0, bad.lineLen.join('；'));
  add('speaker', '說話人在本場人物裡，或明確標畫外音 VO', bad.speaker.length === 0, bad.speaker.join('；'));
  add('hook-cliff', '每集開場鉤子與結尾懸念都落在紙面', eps.length > 0 && bad.hook.length === 0, bad.hook.join('；'));
  add('hook-open', `鉤子的具象在全集前 ${params.hookWindow} 拍內兌現（hookBeat 認領）`, eps.length > 0 && bad.hookOpen.length === 0, bad.hookOpen.join('；'));
  add('has-action', '每場至少一個動作節拍——純對白的場是廣播劇', eps.length > 0 && bad.noAction.length === 0, bad.noAction.join('；'));
  add('action-prose', '動作描述敘述體，臺詞只進 dialogue 欄位', bad.prose.length === 0, bad.prose.join('；'));
  add('beats-claimed', '大綱爽點逐集認領', bad.beats.length === 0, outline ? bad.beats.join('；') : SKIP_OUTLINE);
  add('refs-characters', '角色引用對賬大綱', bad.chars.length === 0, outline ? bad.chars.join('；') : SKIP_OUTLINE);
  add('refs-scenes', '場景／光照／道具對賬美術設定', bad.scenes.length === 0, art ? bad.scenes.join('；') : SKIP_ART);

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateScript(doc, ctx = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!doc || typeof doc !== 'object') return ['script.json 不是物件'];

  if (!thText(doc.source)) p('缺少 source（劇名/書名）');
  const eps = doc.episodes;
  if (!Array.isArray(eps) || eps.length === 0) {
    p('episodes 為空');
    return problems;
  }

  const seen = new Set();
  for (const ep of eps) {
    const label = `第 ${ep?.ep ?? '?'} 集`;
    if (!Number.isInteger(ep?.ep) || ep.ep < 1) p(`${label}的 ep 必須是正整數`);
    if (seen.has(ep?.ep)) p(`集號 ${ep.ep} 重複`);
    seen.add(ep?.ep);
    if (!(ep?.targetSeconds > 0)) p(`${label}缺 targetSeconds（目標秒數，來自大綱的單集時長）`);
    if (!Array.isArray(ep?.beatsClaimed)) p(`${label}缺 beatsClaimed（認領的爽點，可為空陣列）`);
    if (!Array.isArray(ep?.scenes) || ep.scenes.length === 0) {
      p(`${label}沒有場次`);
      continue;
    }
    ep.scenes.forEach((sc, i) => {
      const sLabel = `${label}第 ${i + 1} 場`;
      if (!/^S\d{2,}$/.test(sc?.sceneId ?? '')) p(`${sLabel} sceneId 必須是 S01 這種格式`);
      if (!Array.isArray(sc?.characters)) p(`${sLabel}缺 characters（本場人物，空鏡給空陣列）`);
      if (!Array.isArray(sc?.flow) || sc.flow.length === 0) p(`${sLabel}的節拍流為空`);
      for (const b of sc?.flow ?? []) {
        const isAction = typeof b?.action === 'string';
        const isLine = typeof b?.line === 'string';
        if (isAction === isLine) {
          p(`${sLabel}有節拍既不是動作也不是臺詞（action 與 line 二選一）`);
          continue;
        }
        if (isAction && !b.action.trim()) p(`${sLabel}有空動作節拍`);
        if (isLine) {
          if (!b.line.trim()) p(`${sLabel}有空臺詞`);
          if (!thText(b.speaker)) p(`${sLabel}有臺詞缺 speaker`);
        }
      }
    });
  }

  for (const g of gateReport(doc, ctx)) {
    if (!g.ok) p(`品質門未過：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* seed — 從 outline.json 確定性預填骨架                                 */
/* ------------------------------------------------------------------ */
/*
 * 目標秒數、鉤子、懸念、該集爽點在大綱裡都是現成的——這些事實不讓
 * 模型重新想。scenes 留空給模型寫戲。
 */

export function seedFromOutline(outline, epRange = null) {
  const perEp = (outline?.params?.minutesPerEpisode ?? 3) * 60;
  const inRange = (n) => !epRange || (n >= epRange[0] && n <= epRange[1]);
  const episodes = (outline?.episodes ?? [])
    .filter((e) => inRange(e.ep))
    .map((e) => ({
      ep: e.ep,
      targetSeconds: perEp,
      hook: e.hook ?? '',
      cliff: e.suspense ?? '',
      beatsClaimed: [...new Set((outline.beats ?? []).filter((b) => b.episode === e.ep).map((b) => b.type))],
      scenes: [],
      // 從大綱搬來的參考，寫完刪掉也行
      seedNote: `大綱梗概：${e.synopsis ?? ''}　候選場景：${(e.sceneIds ?? []).join('、')}　人物：${(e.characterIds ?? []).join('、')}`,
    }));
  return { source: outline?.source ?? '', episodes };
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'script';
}

/* ------------------------------------------------------------------ */
/* render — 介面文案                                                    */
/* ------------------------------------------------------------------ */
/*
 * 內建 zh / en 兩套，全部介面文案收在這張表裡。
 * 品質門的 label/detail 是 validate/checkup 的診斷文案，保持中文，不在此列。
 */

/* 門標籤與「跳過」提示的英文對映：品質門面板是報告的一部分，出英文報告時
 * 這裡做展示層翻譯——gateReport 的邏輯與中文診斷文案一行不動（CLI 仍是中文）。
 * 動態閾值由門自己算，對映裡只寫固定語義；未命中的 id 回落到原標籤。 */
const GATE_LABELS_EN = {
  'duration': 'Episode duration within ±{0}% of target',
  'line-length': 'Every line ≤ {0} characters',
  'speaker': 'Speaker is in the scene cast, or explicitly marked V.O.',
  'hook-cliff': 'Hook and cliffhanger on paper for every episode',
  'hook-open': 'The hook\'s concrete image lands within the first {0} beats (claimed by hookBeat)',
  'has-action': 'At least one action beat per scene — a dialogue-only scene is radio drama',
  'action-prose': 'Action in narrative prose; dialogue only in dialogue entries',
  'beats-claimed': 'Outline beats claimed per episode',
  'refs-characters': 'Character references audited against the outline',
  'refs-scenes': 'Scenes / lighting / props audited against the art bible',
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
    kicker: '劇本',
    docTitle: (s, a, b) => `${s} · 劇本${a === b ? `（第 ${a} 集）` : `（第 ${a}–${b} 集）`}`,
    epHead: (n) => `第 ${n} 集`,
    epRange: (a, b) => (a === b ? `第 ${a} 集` : `第 ${a}–${b} 集`),
    exportJson: '匯出 JSON',
    gates: '品質門',
    gatesPass: '全部通過',
    gatesFail: (n) => `${n} 項未過`,
    gatePill: (okN, total) => `品質門 ${okN} / ${total}`,
    kpi: {
      eps: '集數', epsSub: (sc) => `${sc} 場戲`,
      time: '預估總時長', timeSub: (t) => `目標 ${t}`,
      lines: '臺詞', linesSub: (sec) => `約 ${sec} 秒對白`,
      dlgRatio: '臺詞佔比', dlgRatioSub: '其餘是畫面與動作',
      avgScene: '平均每場', avgSceneSub: '換景是統計不是門——AI 換景不要錢',
    },
    secTiming: '時長儀表',
    secScript: '分集劇本',
    secSceneTable: '場次總表',
    secCastLines: '臺詞本',
    secGates: '品質門',
    timingNote: (tol) => `綠帶 = 目標 ±${tol}%；臺詞按語速折算，動作按節拍估時`,
    scriptNote: '一排兩集 · 場次資訊超高自動截斷，點開看全部',
    sceneTableNote: '自動彙總 · 模型不寫',
    castLinesNote: '按角色聚合 · 列表最多顯示 6 行可滾動 · 直接對接 TTS 批次生成',
    hookLabel: '開場鉤子',
    hookAt: (sc, b) => `第 ${sc} 場第 ${b} 拍兌現`,
    voiceBtn: '音色提示詞',
    cliffLabel: '結尾懸念',
    beatsLabel: '認領爽點',
    estLabel: (est, target) => `預估 ${est} 秒 / 目標 ${target} 秒`,
    sceneHead: (i) => `第 ${i} 場`,
    voLabel: '畫外音',
    lightingLabel: '光照',
    showScenes: '▾ 展開全部場次',
    hideScenes: '▴ 收起場次',
    sceneCols: ['集', '場', '場景', '光照', '人物', '臺詞句數', '估秒'],
    castCols: ['角色', '臺詞句數', '字數', '約合秒數'],
    copyAllLines: '複製全部臺詞',
    copy: '複製', copied: '已複製', copyFailed: '複製失敗',
    lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} 第 ${i} 場`,
    dlgSec: (s) => `${s} 秒`,
    fmtMin: (m, s) => `${m} 分 ${s} 秒`,
    overBy: (s) => `超 ${s} 秒`,
    underBy: (s) => `欠 ${s} 秒`,
    legendDlg: '臺詞', legendAct: '動作', legendBand: '目標區間',
    unitLines: '句', unitSec: '秒',
    castMeta: (count, chars, sec) => `${count} 句 · ${chars} 字 · 約 ${sec} 秒`,
    castProps: (c, p) => (p ? `人物：${c}　道具：${p}` : `人物：${c}`),
    sep: '、',
    colon: '：',
    paren: (s) => `（${s}）`,
    colophon: '劇本由模型依據大綱與美術設定生成，時長與引用由腳本確定性檢查。分鏡與首幀提示詞是下一層的事，不在本報告裡。',
  },
  en: {
    langCode: 'en',
    kicker: 'Script',
    docTitle: (s, a, b) => `${s} · Script${a === b ? ` (Episode ${a})` : ` (Episodes ${a}–${b})`}`,
    epHead: (n) => `Episode ${n}`,
    epRange: (a, b) => (a === b ? `Episode ${a}` : `Episodes ${a}–${b}`),
    exportJson: 'Export JSON',
    gates: 'Quality gates',
    gatesPass: 'All passed',
    gatesFail: (n) => `${n} failed`,
    gatePill: (okN, total) => `Quality gates ${okN} / ${total}`,
    kpi: {
      eps: 'Episodes', epsSub: (sc) => `${sc} scenes`,
      time: 'Estimated runtime', timeSub: (t) => `target ${t}`,
      lines: 'Lines', linesSub: (sec) => `~${sec}s of dialogue`,
      dlgRatio: 'Dialogue ratio', dlgRatioSub: 'the rest is picture and action',
      avgScene: 'Avg per scene', avgSceneSub: 'scene changes are a statistic, not a gate — AI scene changes are free',
    },
    secTiming: 'Duration gauge',
    secScript: 'Episode scripts',
    secSceneTable: 'Scene table',
    secCastLines: 'Line book',
    secGates: 'Quality gates',
    timingNote: (tol) => `green band = target ±${tol}%; dialogue at reading speed, action per beat`,
    scriptNote: 'two episodes per row · tall scene areas clip, expand to see all',
    sceneTableNote: 'computed, never hand-written',
    castLinesNote: 'grouped by character · lists show 6 rows and scroll · feeds straight into batch TTS',
    hookLabel: 'Cold open hook',
    hookAt: (sc, b) => `lands at scene ${sc}, beat ${b}`,
    voiceBtn: 'Voice prompt',
    cliffLabel: 'Cliffhanger',
    beatsLabel: 'Beats claimed',
    estLabel: (est, target) => `est. ${est}s / target ${target}s`,
    sceneHead: (i) => `Scene ${i}`,
    voLabel: 'V.O.',
    lightingLabel: 'Lighting',
    showScenes: '▾ Show all scenes',
    hideScenes: '▴ Collapse scenes',
    sceneCols: ['Ep', 'Scene', 'Setting', 'Lighting', 'Cast', 'Lines', 'Est. sec'],
    castCols: ['Character', 'Lines', 'Chars', 'Est. seconds'],
    copyAllLines: 'Copy all lines',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
    lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} scene ${i}`,
    dlgSec: (s) => `${s}s`,
    fmtMin: (m, s) => `${m}m ${s}s`,
    overBy: (s) => `${s}s over`,
    underBy: (s) => `${s}s under`,
    legendDlg: 'Dialogue', legendAct: 'Action', legendBand: 'Target band',
    unitLines: 'lines', unitSec: 's',
    castMeta: (count, chars, sec) => `${count} lines · ${chars} chars · ~${sec}s`,
    castProps: (c, p) => (p ? `Cast: ${c} · Props: ${p}` : `Cast: ${c}`),
    sep: ', ',
    colon: ': ',
    paren: (s) => ` (${s})`,
    colophon: 'Script written by the model against the outline and art bible; durations and references checked deterministically by script. Storyboarding and first-frame prompts belong to the next layer, not this report.',
  },
};

export const tOf = (lang) => {
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

/** 顯示名：給了上游對映就用名字，否則裸 ID。 */
function namer(ctx = {}, t = tOf()) {
  const charName = new Map((ctx.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const sceneName = new Map((ctx.art?.scenes ?? []).map((s) => [s.id, s.name]));
  const propName = new Map((ctx.art?.props ?? []).map((p) => [p.id, p.name]));
  const voiceByName = new Map((ctx.cast?.characters ?? []).map((c) => [c.name, c?.voice?.prompt ?? '']));
  return {
    char: (id) => (id === 'VO' ? t.voLabel : charName.get(id) ?? id),
    scene: (id) => sceneName.get(id) ?? id,
    prop: (id) => propName.get(id) ?? id,
    // 臺詞本對接 TTS：給了 --cast 才有音色提示詞（按 outline 名字對上 cast）
    voice: (id) => voiceByName.get(charName.get(id) ?? '') ?? '',
  };
}

/** 介面語言：--lang > script.json 頂層 lang 欄位 > zh。 */
const langOf = (doc, ctx) => ctx?.lang ?? doc?.lang ?? 'zh';

export function renderMarkdown(doc, ctx = {}) {
  const t = tOf(langOf(doc, ctx));
  const n = namer(ctx, t);
  const stats = computeStats(doc);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const out = [`# ${t.docTitle(doc.source, first, last)}`, ''];

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    out.push(`## ${t.epHead(ep.ep)}`, '');
    out.push(`> ${t.estLabel(st.est, ep.targetSeconds)} · ${t.hookLabel}${t.colon}${ep.hook}${Array.isArray(ep.hookBeat) ? t.paren(t.hookAt(ep.hookBeat[0], ep.hookBeat[1])) : ''} · ${t.cliffLabel}${t.colon}${ep.cliff}`);
    if (ep.beatsClaimed.length) out.push(`> ${t.beatsLabel}${t.colon}${ep.beatsClaimed.join(t.sep)}`);
    out.push('');
    ep.scenes.forEach((sc, idx) => {
      out.push(`### ${t.sceneHead(idx + 1)} · ${n.scene(sc.sceneId)}${sc.lighting ? t.paren(sc.lighting) : ''}`, '');
      if (sc.characters.length) out.push(t.castProps(sc.characters.map(n.char).join(t.sep), sc.props?.length ? sc.props.map(n.prop).join(t.sep) : ''), '');
      for (const b of sc.flow) {
        if (typeof b.action === 'string') out.push(b.action, '');
        else out.push(`**${n.char(b.speaker)}**${b.delivery ? t.paren(b.delivery) : ''}${t.colon}${b.line}`, '');
      }
    });
  }

  out.push('---', '', `## ${t.secSceneTable}`, '', mdHead(t.sceneCols));
  for (const row of stats.sceneTable) {
    out.push(mdRow([row.ep, row.index, n.scene(row.sceneId), row.lighting, row.characters.map(n.char).join(t.sep), row.lineCount, row.estSeconds]));
  }
  out.push('', `## ${t.secCastLines}`, '', mdHead(t.castCols));
  for (const c of stats.castLines) {
    out.push(mdRow([n.char(c.id), c.count, c.chars, r1(c.chars / stats.params.charsPerSecond)]));
  }
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 與另外三份報告同一套視覺語言：冷灰印張 + 鐵鏽紅印記，1600 寬，
 * 零外部依賴。設計約定見 references/report-style.md。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

export function renderHtml(doc, ctx = {}) {
  const lang = langOf(doc, ctx);
  const t = tOf(lang);
  const n = namer(ctx, t);
  const stats = computeStats(doc);
  const gates = gateReport(doc, ctx);
  const failed = gates.filter((g) => !g.ok);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const tolPct = Math.round(stats.params.tolerance * 100);

  const fmtMin = (sec) => t.fmtMin(Math.floor(sec / 60), Math.round(sec % 60));
  const dlgRatio = stats.totals.estSeconds ? Math.round((stats.totals.dialogueSeconds / stats.totals.estSeconds) * 100) : 0;
  const avgScene = stats.totals.scenes ? r1(stats.totals.estSeconds / stats.totals.scenes) : 0;

  // ---- 時長儀表：每集一行，目標區間畫成綠帶，臺詞/動作堆疊 ----
  const scaleMax = Math.max(...stats.episodes.map((e) => Math.max(e.est, (e.target ?? 0) * (1 + stats.params.tolerance)))) * 1.08;
  const timingRows = stats.episodes
    .map((e) => {
      const lo = e.target * (1 - stats.params.tolerance);
      const hi = e.target * (1 + stats.params.tolerance);
      const inBand = e.est >= lo && e.est <= hi;
      const pct = (v) => `${r1((v / scaleMax) * 100)}%`;
      const status = inBand ? '' : ` <b class="over">${esc(e.est > hi ? t.overBy(r1(e.est - hi)) : t.underBy(r1(lo - e.est)))}</b>`;
      return `<div class="trow">
  <span class="tep">E${String(e.ep).padStart(2, '0')}</span>
  <div class="track">
    <span class="band" style="left:${pct(lo)};width:${pct(hi - lo)}"></span>
    <span class="fill dlg" style="width:${pct(e.dialogueSeconds)}"></span>
    <span class="fill act" style="left:${pct(e.dialogueSeconds)};width:${pct(e.actionSeconds)}"></span>
  </div>
  <span class="tval${inBand ? ' okc' : ''}">${e.est}s / ${e.target}s${status}</span>
</div>`;
    })
    .join('\n');

  // ---- 分集劇本 ----
  const epBlocks = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const scenesHtml = ep.scenes
        .map((sc, idx) => {
          const flow = sc.flow
            .map((b, bi) => {
              const hooked = Array.isArray(ep.hookBeat) && ep.hookBeat[0] === idx + 1 && ep.hookBeat[1] === bi + 1;
              const hk = hooked ? ' hooked' : '';
              return typeof b.action === 'string'
                ? `<p class="act-line${hk}"${hooked ? ` title="${esc(t.hookLabel)}"` : ''}>${esc(b.action)}</p>`
                : `<div class="dlg-line${hk}"><span class="who">${esc(n.char(b.speaker))}${b.delivery ? `<i>${esc(b.delivery)}</i>` : ''}</span><span class="said">${esc(b.line)}</span><button class="copy mini" data-copy="${esc(b.line)}">${esc(t.copy)}</button></div>`;
            })
            .join('\n');
          return `<section class="scene-blk">
  <header class="scene-h">
    <b>${esc(t.sceneHead(idx + 1))}</b>
    <span class="chip">${esc(sc.sceneId)} ${esc(n.scene(sc.sceneId))}</span>
    ${sc.lighting ? `<span class="chip lite">${esc(t.lightingLabel)} · ${esc(sc.lighting)}</span>` : ''}
    ${sc.characters.map((id) => `<span class="chip">${esc(n.char(id))}</span>`).join('')}
    ${(sc.props ?? []).map((id) => `<span class="chip prop">${esc(n.prop(id))}</span>`).join('')}
  </header>
  ${flow}
</section>`;
        })
        .join('\n');
      return `<article class="ep" id="ep-${ep.ep}">
  <header class="ep-h">
    <span class="ep-n">E${String(ep.ep).padStart(2, '0')}</span>
    <span class="ep-est">${esc(t.estLabel(st.est, ep.targetSeconds))}</span>
    ${ep.beatsClaimed.map((b) => `<i class="bt">${esc(b)}</i>`).join('')}
  </header>
  <div class="hk"><b>${esc(t.hookLabel)}</b><span>${esc(ep.hook)}${Array.isArray(ep.hookBeat) ? ` <i class="hookat">${esc(t.hookAt(ep.hookBeat[0], ep.hookBeat[1]))}</i>` : ''}</span></div>
  <div class="scenes clip">
  ${scenesHtml}
  </div>
  <button class="scmore">${esc(t.showScenes)}</button>
  <div class="hk cliff"><b>${esc(t.cliffLabel)}</b><span>${esc(ep.cliff)}</span></div>
</article>`;
    })
    .join('\n');

  // ---- 場次總表 / 臺詞本 ----
  const table = (cols, rows) =>
    `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`;

  const sceneRows = stats.sceneTable.map((row) => [
    String(row.ep), String(row.index), esc(`${row.sceneId} ${n.scene(row.sceneId)}`), esc(row.lighting),
    esc(row.characters.map(n.char).join(t.sep)), String(row.lineCount), String(row.estSeconds),
  ]);

  const castBlocks = stats.castLines
    .map((c) => {
      const allText = c.lines.map((l) => l.line).join('\n');
      return `<section class="cast-blk">
  <header class="cast-h">
    <b>${esc(n.char(c.id))}</b>
    <span class="cast-meta">${esc(t.castMeta(c.count, c.chars, r1(c.chars / stats.params.charsPerSecond)))}</span>
    ${n.voice(c.id) ? `<button class="copy" data-copy="${esc(n.voice(c.id))}">${esc(t.voiceBtn)}</button>` : ''}
    <button class="copy" data-copy="${esc(allText)}">${esc(t.copyAllLines)}</button>
  </header>
  <ol class="cast-lines">${c.lines.map((l) => `<li><i>${esc(t.lineRef(l.ep, l.sceneIndex))}</i><span>${esc(l.line)}</span>${l.delivery ? `<em>${esc(l.delivery)}</em>` : ''}</li>`).join('')}</ol>
</section>`;
    })
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(gateText(g, t.langCode).label)}${
        (!g.ok && g.detail) || (g.ok && g.detail.includes('跳過')) ? `<small>${esc(gateText(g, t.langCode).detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(doc.source, first, last))}</title>
<style>
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e; --seal-soft:#8a332412; --ok:#3d6b4f;
  --band:#3d6b4f22;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:1600px;margin:0 auto;padding:24px 32px 90px}
h1,h2,h3{margin:0;font-weight:400}

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

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .v small{font:400 14px var(--serif);color:var(--ink-2)}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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

/* duration gauge */
.timing{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:16px 20px 10px}
.trow{display:grid;grid-template-columns:44px minmax(0,1fr) 220px;gap:12px;align-items:center;padding:5px 0}
.tep{font:500 12px/1 var(--mono);color:var(--ink-2)}
.track{position:relative;height:18px;background:var(--paper);border:1px solid var(--rule);border-radius:2px;overflow:hidden}
.band{position:absolute;top:0;bottom:0;background:var(--band)}
.fill{position:absolute;top:2px;bottom:2px;border-radius:1px}
.fill.dlg{left:0;background:var(--seal)}
.fill.act{background:var(--seal-2)}
.tval{font:500 12px/1.5 var(--sans);color:var(--ink-2)}
.tval.okc{color:var(--ok)}
.tval .over{color:var(--seal);font-weight:600}
.legend{display:flex;gap:18px;font-size:12px;color:var(--ink-2);margin:8px 0 2px}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px}

/* episode scripts: two per row; scene area clips at 300px with a fade, expandable */
.eps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.eps.solo{grid-template-columns:minmax(0,1fr)}
@media(max-width:1100px){.eps{grid-template-columns:minmax(0,1fr)}}
.ep{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 22px}
.scenes{position:relative}
.scenes.clip{max-height:300px;overflow:hidden}
.scenes.clip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:70px;
  background:linear-gradient(180deg,transparent,var(--panel));pointer-events:none}
.scmore{display:block;width:100%;margin-top:8px;font:500 11.5px/1 var(--sans);letter-spacing:.06em;
  color:var(--ink-2);background:var(--paper);border:1px solid var(--rule-2);border-radius:2px;
  padding:7px 0;cursor:pointer;transition:.15s}
.scmore:hover{border-color:var(--seal);color:var(--seal)}
.scmore:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.ep-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px}
.ep-n{font:400 22px/1 var(--serif);letter-spacing:.04em;color:var(--seal)}
.ep-est{font-size:12.5px;color:var(--ink-2)}
.bt{font-style:normal;font-size:11px;padding:2px 8px;border:1px solid var(--seal);border-radius:99px;color:var(--seal)}
.hk{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px;font-size:13px;padding:10px 0;border-bottom:1px solid var(--rule)}
.hk.cliff{border-bottom:0;border-top:1px solid var(--rule)}
.hk b{font:500 11px/1.9 var(--sans);letter-spacing:.14em;color:var(--seal);white-space:nowrap}
.scene-blk{margin-top:14px}
.scene-h{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:8px}
.scene-h b{font:500 13px var(--serif);letter-spacing:.06em}
.chip{font:400 10.5px/1.6 var(--mono);border:1px solid var(--rule-2);border-radius:2px;
  padding:0 6px;background:var(--paper);color:var(--ink-2)}
.chip.lite{border-color:var(--seal-2);color:var(--seal-2)}
.chip.prop{border-color:var(--seal);color:var(--seal)}
.act-line{margin:8px 0;font:400 13.5px/1.9 var(--sans);color:var(--ink-2)}
.act-line.hooked,.dlg-line.hooked{border-left:2px solid var(--seal);padding-left:10px;background:var(--seal-soft)}
.hookat{font-style:normal;font-size:11px;padding:1px 8px;border:1px solid var(--seal);border-radius:99px;color:var(--seal);margin-left:8px;white-space:nowrap}
.dlg-line{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:5px 0 5px 10px;border-left:2px solid var(--rule-2)}
.dlg-line:hover{border-left-color:var(--seal)}
.who{font:500 13px/1.6 var(--serif)}
.who i{display:block;font:400 11px var(--sans);color:var(--ink-3);font-style:normal}
.said{font:400 14.5px/1.8 var(--serif)}
.dlg-line .copy{opacity:0;transition:.15s}
.dlg-line:hover .copy{opacity:1}

/* tables */
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:nowrap}

/* line book: two per row; lists capped at 6 rows, scroll vertically */
.casts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.casts{grid-template-columns:minmax(0,1fr)}}
.cast-blk{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:14px 18px}
.cast-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px}
.cast-h b{font:400 17px/1.2 var(--serif);letter-spacing:.04em}
.cast-meta{font-size:12px;color:var(--ink-2)}
.cast-h .copy{margin-left:auto}
.cast-lines{margin:8px 0 0;padding:0 6px 0 0;list-style:none;max-height:186px;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.cast-lines::-webkit-scrollbar{width:6px}
.cast-lines::-webkit-scrollbar-thumb{background:var(--rule-2);border-radius:3px}
.cast-lines li{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:4.5px 0;border-top:1px solid var(--rule);font-size:13px}
.cast-lines li:first-child{border-top:0}
.cast-lines i{font:400 11px/1.8 var(--mono);color:var(--ink-3);font-style:normal}
.cast-lines span{font-family:var(--serif)}
.cast-lines em{font-style:normal;font-size:11.5px;color:var(--ink-3)}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
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
  .expo,.copy,.scmore{display:none!important}
  .scenes.clip{max-height:none}
  .scenes.clip::after{display:none}
  .cast-lines{max-height:none;overflow:visible}
  .eps,.casts{grid-template-columns:minmax(0,1fr)}
  .page{max-width:none;padding:0}
  section.top-sec,.ep,.cast-blk{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(doc.source)}</h1>
  <span class="sub">${esc(t.kicker)} · ${esc(t.epRange(first, last))}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(doc.source))}-script.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.eps)}</div><div class="v">${stats.totals.episodes}</div><div class="d">${esc(t.kpi.epsSub(stats.totals.scenes))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.time)}</div><div class="v">${esc(fmtMin(stats.totals.estSeconds))}</div><div class="d">${esc(t.kpi.timeSub(fmtMin(stats.totals.targetSeconds)))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lines)}</div><div class="v">${stats.totals.lines} <small>${esc(t.unitLines)}</small></div><div class="d">${esc(t.kpi.linesSub(stats.totals.dialogueSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.dlgRatio)}</div><div class="v">${dlgRatio}<small>%</small></div><div class="d">${esc(t.kpi.dlgRatioSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.avgScene)}</div><div class="v">${avgScene} <small>${esc(t.unitSec)}</small></div><div class="d">${esc(t.kpi.avgSceneSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(gateText(g, t.langCode).label)}${g.detail ? ` — ${esc(gateText(g, t.langCode).detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-timing">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secTiming)}</h2><span class="note">${esc(t.timingNote(tolPct))}</span></div>
  <div class="timing">
    <div class="legend">
      <i><span class="sw" style="background:var(--seal)"></span>${esc(t.legendDlg)}</i>
      <i><span class="sw" style="background:var(--seal-2)"></span>${esc(t.legendAct)}</i>
      <i><span class="sw" style="background:var(--band)"></span>${esc(t.legendBand)}</i>
    </div>
${timingRows}
  </div>
</section>

<section class="top-sec" id="sec-script">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secScript)}</h2><span class="note">${eps.length > 1 ? esc(t.scriptNote) : ''}</span></div>
  <div class="eps${eps.length > 1 ? '' : ' solo'}">
${epBlocks}
  </div>
</section>

<section class="top-sec" id="sec-scenes">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secSceneTable)}</h2><span class="note">${esc(t.sceneTableNote)}</span></div>
  ${table(t.sceneCols, sceneRows)}
</section>

<section class="top-sec" id="sec-cast">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secCastLines)}</h2><span class="note">${esc(t.castLinesNote)}</span></div>
  <div class="casts">
${castBlocks}
  </div>
</section>

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">05</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<script type="application/json" id="script-data">${embedDoc(doc)}</script>
<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed, show: t.showScenes, hide: t.hideScenes })};

// episode scripts: scene areas clip at 300px; short ones unclip, tall ones toggle
document.querySelectorAll('.scmore').forEach((btn) => {
  const zone = btn.previousElementSibling;
  if (zone.scrollHeight <= 320) {
    zone.classList.remove('clip');
    btn.remove();
    return;
  }
  btn.addEventListener('click', () => {
    const clipped = zone.classList.toggle('clip');
    btn.textContent = clipped ? L.show : L.hide;
    if (clipped) zone.closest('.ep').scrollIntoView({ block: 'nearest' });
  });
});

// copy buttons (a single line / a character's whole line book)
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

// export: the report carries the full script.json; the download is it verbatim
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('script-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // don't revoke right away — Safari kills the blob before the download finishes reading it
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-script.mjs — novel-script skill 的確定性工具（劇本）

  seed <outline.json> [--eps 1-6]           從大綱預填每集骨架（列印到 stdout）
  validate <script.json> [--outline o.json] 校驗；有違規逐條列印並 exit 1
           [--art a.json]                   給了上游才做對賬（角色 / 場景光照道具 / 爽點認領）
  checkup <script.json> [--outline] [--art] 只列印品質門 ✓/✗，有未過項 exit 1
  render <script.json> [--html|--md]        渲染報告到 stdout（預設 --md）
         [--lang zh|en]                     報告介面語言（預設中文，或跟 script.json 的 lang 欄位）
         [--outline o.json] [--art a.json]  給了上游就把 ID 顯示成名字
         [--cast cast.json]                 臺詞本帶每個角色的音色提示詞（對接 TTS）
  slug <name>                               劇名轉安全檔名`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

function loadCtx(rest) {
  const get = (name) => {
    const path = flag(rest, name);
    return path ? readJson(path) : null;
  };
  return { outline: get('--outline'), art: get('--art'), cast: get('--cast') };
}

function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'seed') {
    const [path] = rest;
    if (!path) throw new Error('用法：seed <outline.json> [--eps 1-6]');
    const range = flag(rest, '--eps');
    let epRange = null;
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/) ?? String(range).match(/^(\d+)$/);
      if (!m) throw new Error('--eps 形如 3 或 1-6');
      epRange = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])];
    }
    console.log(JSON.stringify(seedFromOutline(readJson(path), epRange), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const [path] = rest;
    if (!path) throw new Error(`用法：${cmd} <script.json> [--outline o.json] [--art a.json]`);
    const doc = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.outline) console.error('⚠️ 沒給 --outline，跳過角色引用與爽點認領檢查');
    if (!ctx.art) console.error('⚠️ 沒給 --art，跳過場景／光照／道具對賬');

    if (cmd === 'checkup') {
      const gates = gateReport(doc, ctx);
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${!g.ok && g.detail ? ` — ${g.detail}` : ''}`);
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(failedN ? `\n✗ ${failedN} 項未過` : '\n✓ 全部通過');
      if (failedN) process.exit(1);
      return;
    }

    const problems = validateScript(doc, ctx);
    if (problems.length) {
      console.error(`✗ ${problems.length} 處違規：\n`);
      for (const x of problems) console.error('  ' + x);
      process.exit(1);
    }
    const st = computeStats(doc);
    console.log(`✓ ${st.totals.episodes} 集 / ${st.totals.scenes} 場 / ${st.totals.lines} 句臺詞全部通過校驗（預估 ${st.totals.estSeconds}s / 目標 ${st.totals.targetSeconds}s）`);
    return;
  }

  if (cmd === 'render') {
    const [path] = rest;
    if (!path) throw new Error('用法：render <script.json> [--html|--md] [--lang zh|en] [--outline o.json] [--art a.json]');
    const doc = readJson(path);
    const ctx = loadCtx(rest);
    const lang = flag(rest, '--lang');
    if (lang) ctx.lang = lang;
    process.stdout.write((rest.includes('--html') ? renderHtml(doc, ctx) : renderMarkdown(doc, ctx)) + '\n');
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
