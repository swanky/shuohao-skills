// 生圖適配層：Qwen（遠端 ComfyUI）、GPT（本機 codex 內建 $imagegen）、OpenAI Images API（GPT Image 2）、自定義命令模板。
// 每個轉接器只做一件事：給定 {text, negative, ratio, refs[檔案路徑], seed}，返回 PNG 位元組。
// 憑據只從環境變數或配置裡指定的 .env 檔案讀，從不列印。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';

/** 在本機 shell 裡執行一條使用者配置的命令；顯式指定直譯器，避免 shell:true 再做一層字串解析。 */
export function runShell(cmd, opts = {}, platform = process.platform) {
  if (platform === 'win32') {
    const comspec = opts.env?.ComSpec || process.env.ComSpec || 'cmd.exe';
    return spawnSync(comspec, ['/d', '/s', '/c', `"${cmd}"`], { ...opts, windowsVerbatimArguments: true });
  }
  return spawnSync('sh', ['-c', cmd], opts);
}

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 配置放在 skill 安裝目錄（install.sh 是軟鏈，重灌不會沖掉）；檔名帶 .local，不進版本控制。 */
export const CONFIG_PATH = process.env.CHARACTER_REFS_CONFIG || join(SKILL_DIR, 'config.local.json');   // 環境變數只給自測用

export const DEFAULT_CONFIG = {
  anchorModel: null,          // 主圖（錨點）用哪個模型：qwen / codex / openai / custom:<名字>
  deriveModel: null,          // 派生圖用哪個模型；初次設定時與 anchorModel 相同，可以單獨改
  confirmAnchor: null,        // 出完錨點是否停下來等人確認；初次執行時由使用者決定
  models: {
    qwen: {
      envFile: null,          // 可選：從這個 .env 讀 COMFY_URL / COMFY_USER / COMFY_PASS
      unet: 'qwen_image_2.1_int8_convrot.safetensors',
      clip: 'qwen3vl_8b_int8_convrot.safetensors',
      vae: 'qwen_image_2.1_vae_bf16.safetensors',
      steps: 20, cfg: 2.5, shift: 3.1,
    },
    codex: { bin: null },     // 不給就自動找本機版本最高的 codex
    openai: {                 // OpenAI Images API（GPT Image 2）；也可指向相容 OpenAI 格式的中轉
      envFile: null,          // 可選：從這個 .env 讀 OPENAI_API_KEY（與 OPENAI_BASE_URL）
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      quality: 'high',        // 認臉敏感的編輯官方建議 high
    },
    custom: {},               // { 名字: { cmd: "mytool --prompt-file {prompt_file} --ref {refs} --out {out} --size {width}x{height}" } }
  },
};

export function loadConfig(path = CONFIG_PATH) {
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return {
    ...DEFAULT_CONFIG, ...raw,
    models: {
      qwen: { ...DEFAULT_CONFIG.models.qwen, ...(raw.models?.qwen ?? {}) },
      codex: { ...DEFAULT_CONFIG.models.codex, ...(raw.models?.codex ?? {}) },
      openai: { ...DEFAULT_CONFIG.models.openai, ...(raw.models?.openai ?? {}) },
      custom: { ...(raw.models?.custom ?? {}) },
    },
  };
}
export const saveConfig = (cfg, path = CONFIG_PATH) => writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

/** 初次執行要問使用者的三件事，缺一件就不生圖。 */
export function configMissing(cfg) {
  const m = [];
  if (!cfg.anchorModel) m.push('主圖（錨點）用哪個模型');
  if (!cfg.deriveModel) m.push('派生圖用哪個模型（預設與主圖相同）');
  if (cfg.confirmAnchor === null || cfg.confirmAnchor === undefined) m.push('出完錨點是否停下來等人確認');
  return m;
}

export function modelKind(name) {
  if (name === 'qwen' || name === 'codex' || name === 'openai') return name;
  if (/^custom:[\w-]+$/.test(String(name))) return 'custom';
  throw new Error(`不認識的模型 ${name}（可用：qwen / codex / openai / custom:<名字>）`);
}

/* ------------------------------------------------------------------ */
/* Qwen · 遠端 ComfyUI                                                   */
/* ------------------------------------------------------------------ */
// 尺寸都是 16 的倍數、約 1.6–1.8 百萬畫素（Qwen Image 的舒適區），比例嚴格等於 2:3 / 4:5 / 1:1
export const QWEN_SIZES = { '2:3': [1056, 1584], '4:5': [1152, 1440], '1:1': [1328, 1328] };

export function parseEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export function qwenEndpoint(qcfg, env = process.env) {
  const file = qcfg.envFile ? parseEnv(readFileSync(resolve(qcfg.envFile.replace(/^~/, homedir())), 'utf8')) : {};
  const pick = (k) => env[k] || file[k] || '';
  const url = (qcfg.url || pick('COMFY_URL')).replace(/\/+$/, '');
  if (!url) throw new Error('Qwen 沒配地址：設 COMFY_URL 環境變數，或在配置裡給 models.qwen.envFile / url');
  const user = pick('COMFY_USER'), pass = pick('COMFY_PASS');
  return { url, auth: user ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null };
}

/**
 * ComfyUI 工作流（API 格式）。錨點純文生圖；其餘把參考圖接進 TextEncodeQwenImageEditPlus
 * （最多 3 張，參考圖走文字編碼器條件，不是 img2img）。與實測時的工作流逐項一致。
 */
export function qwenWorkflow({ text, negative, ratio, seed }, refNames, q) {
  const [w, h] = QWEN_SIZES[ratio];
  const g = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: q.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: q.clip, type: 'qwen_image', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: q.vae } },
    ms: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['unet', 0], shift: q.shift, sampling: 'flow' } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: negative } },
    lat: { class_type: 'EmptySD3LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    ks: { class_type: 'KSampler', inputs: { model: ['ms', 0], positive: ['pos', 0], negative: ['neg', 0], latent_image: ['lat', 0],
      seed, steps: q.steps, cfg: q.cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    dec: { class_type: 'VAEDecode', inputs: { samples: ['ks', 0], vae: ['vae', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['dec', 0], filename_prefix: 'character-refs/out' } },
  };
  if (!refNames.length) {
    g.pos = { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text } };
  } else {
    const enc = { clip: ['clip', 0], vae: ['vae', 0], prompt: text };
    refNames.forEach((r, i) => {
      g[`ref${i + 1}`] = { class_type: 'LoadImage', inputs: { image: r } };
      enc[`image${i + 1}`] = [`ref${i + 1}`, 0];
    });
    g.pos = { class_type: 'TextEncodeQwenImageEditPlus', inputs: enc };
  }
  return g;
}

async function http(ep, method, path, body, { timeoutMs = 120_000, raw = false } = {}) {
  let last;
  for (let i = 0; i < 4; i++) {  // 隧道偶爾返回空響應，重試
    try {
      const headers = { ...(ep.auth ? { Authorization: ep.auth } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
      const r = await fetch(ep.url + path, { method, headers, body: body && !(body instanceof FormData) ? JSON.stringify(body) : body, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${path.split('?')[0]}`);
      return raw ? Buffer.from(await r.arrayBuffer()) : await r.json();
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  throw last;
}

export async function qwenGenerate(job, cfg) {
  const q = cfg.models.qwen;
  const ep = qwenEndpoint(q);
  const names = [];
  for (const f of job.refs) {
    const form = new FormData();
    form.append('image', new Blob([readFileSync(f)], { type: 'image/png' }), basename(f).replace(/[^\w.-]/g, '_'));
    form.append('subfolder', 'character-refs');
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const up = await http(ep, 'POST', '/upload/image', form);
    names.push(up.subfolder ? `${up.subfolder}/${up.name}` : up.name);
  }
  const { prompt_id: pid } = await http(ep, 'POST', '/prompt', { prompt: qwenWorkflow(job, names, q) });
  const t0 = Date.now();
  for (;;) {
    const h = await http(ep, 'GET', `/history/${pid}`);
    if (h[pid]) {
      const st = h[pid].status ?? {};
      if (st.status_str === 'error') {
        const m = (st.messages ?? []).find((x) => x[0] === 'execution_error');
        throw new Error(`ComfyUI 執行出錯：${m?.[1]?.exception_message ?? '未知錯誤'}`);
      }
      const img = h[pid].outputs?.save?.images?.[0];
      if (!img) throw new Error('ComfyUI 沒有返回圖片');
      return http(ep, 'GET', `/view?${new URLSearchParams(img)}`, null, { raw: true, timeoutMs: 300_000 });
    }
    if (Date.now() - t0 > 15 * 60_000) throw new Error('ComfyUI 等了 15 分鐘還沒生圖');
    await new Promise((ok) => setTimeout(ok, 3000));
  }
}

/* ------------------------------------------------------------------ */
/* GPT · 本機 codex 內建 $imagegen                                        */
/* ------------------------------------------------------------------ */
// 不需要 API key，吃 ChatGPT 訂閱額度（實測約二十多張觸頂，幾小時後恢復）。
// 尺寸不能作為引數傳，只能寫進提示詞——所以比例門對它是必需的（實測它會照提示詞出嚴格的 2:3 / 4:5）。

export function findCodex(explicit = null) {
  if (explicit) return explicit;
  const home = homedir();
  // Windows 的 where.exe 可能同時返回 .cmd / .exe 多行；直接呼叫，不把固定查詢再交給 shell。
  const discovered = IS_WIN
    ? (spawnSync('where.exe', ['codex'], { encoding: 'utf8' }).stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [(spawnSync('sh', ['-c', 'command -v codex'], { encoding: 'utf8' }).stdout ?? '').trim()].filter(Boolean);
  const cands = [...discovered, `${home}/.npm-global/bin/codex`, `${home}/.local/bin/codex`, '/opt/homebrew/bin/codex', '/usr/local/bin/codex'];
  let best = null, bestN = -1;
  for (const c of new Set(cands.filter(Boolean))) {
    if (!existsSync(c)) continue;
    const v = runProgram(c, ['--version'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }).stdout?.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!v) continue;
    const n = +v[1] * 1e6 + +v[2] * 1e3 + +v[3];
    if (n > bestN) { bestN = n; best = c; }  // 機器上可能裝了多個，舊版會直接報 requires a newer version
  }
  if (!best) throw new Error('找不到 codex——裝一下 npm i -g @openai/codex，或在配置裡寫 models.codex.bin');
  return best;
}

export function codexStdin(job) {
  const ratioLine = { '2:3': 'Portrait orientation, 2:3 aspect ratio.', '4:5': 'Portrait orientation, 4:5 aspect ratio.', '1:1': 'Square 1:1 aspect ratio.' }[job.ratio];
  const note = job.refs.length > 1
    ? 'The attached images are references: image 1 is the full outfit, image 2 is a close-up of the face; they are the same person.'
    : job.refs.length ? 'The attached image is the reference image.' : '';
  return ['Use $imagegen to generate exactly one image with the built-in image_gen tool, then copy the final PNG to ./out.png in the current ' +
    'working directory. Reply with only the file path — no base64, no markdown image preview.', note,
  `${job.text} ${ratioLine} Avoid: ${job.negative}.`].filter(Boolean).join('\n\n');
}

export function codexGenerate(job, cfg) {
  const bin = findCodex(cfg.models.codex.bin);
  const dir = mkdtempSync(join(tmpdir(), 'character-refs-'));
  try {
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', ...job.refs.flatMap((f) => ['-i', resolve(f)]), '-'];
    // 父行程的 NODE_OPTIONS 會被 codex 繼承，指向已刪除的預載入檔案時它會在啟動階段崩
    const r = runProgram(bin, args, { cwd: dir, input: codexStdin(job), encoding: 'utf8', timeout: 15 * 60_000, env: { ...process.env, NODE_OPTIONS: '' }, maxBuffer: 64 * 2 ** 20 });
    const out = join(dir, 'out.png');
    if (existsSync(out)) return readFileSync(out);
    const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (/usage limit|usage_limit_reached/i.test(log)) throw new Error('codex 生圖額度用完了（ChatGPT 訂閱額度），過幾小時再試或換模型');
    if (/401|Unauthorized/.test(log)) throw new Error('codex 登入失效，執行 codex logout && codex login 重新登入');
    throw new Error(`codex 沒有產生圖片（退出碼 ${r.status}）`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* GPT Image · OpenAI Images API                                         */
/* ------------------------------------------------------------------ */
// 錨點走 /images/generations，派生圖走 /images/edits（參考圖用 image[] 逐張附上，gpt-image 最多 16 張）。
// 介面沒有負向提示詞，寫成 Avoid: 附在正文後。gpt-image-2 對輸入圖恆為高保真，不傳 input_fidelity；
// 老的 gpt-image-1 / 1.5 才傳 input_fidelity=high。尺寸與 Qwen 同一套：都是 16 的倍數、比例嚴格。

export function openaiEndpoint(ocfg, env = process.env) {
  const file = ocfg.envFile ? parseEnv(readFileSync(resolve(ocfg.envFile.replace(/^~/, homedir())), 'utf8')) : {};
  const key = env.OPENAI_API_KEY || file.OPENAI_API_KEY || '';
  if (!key) throw new Error('GPT Image 沒有 API key：設 OPENAI_API_KEY 環境變數，或在配置裡給 models.openai.envFile');
  const base = (env.OPENAI_BASE_URL || file.OPENAI_BASE_URL || ocfg.baseUrl).replace(/\/+$/, '');
  return { base, key };
}

export function openaiRequest(job, ocfg) {
  const [w, h] = QWEN_SIZES[job.ratio];
  const prompt = `${job.text} Avoid: ${job.negative}.`;
  const common = { model: ocfg.model, prompt, size: `${w}x${h}`, quality: ocfg.quality, n: 1 };
  if (!job.refs.length) return { path: '/images/generations', json: { ...common, output_format: 'png' } };
  const form = new FormData();
  for (const [k, v] of Object.entries(common)) form.append(k, String(v));
  if (ocfg.model !== 'gpt-image-2') form.append('input_fidelity', 'high');
  for (const f of job.refs) form.append('image[]', new Blob([readFileSync(f)], { type: 'image/png' }), basename(f).replace(/[^\w.-]/g, '_'));
  return { path: '/images/edits', form };
}

export async function openaiGenerate(job, cfg) {
  const ep = openaiEndpoint(cfg.models.openai);
  const req = openaiRequest(job, cfg.models.openai);
  const r = await fetch(ep.base + req.path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ep.key}`, ...(req.json ? { 'Content-Type': 'application/json' } : {}) },
    body: req.json ? JSON.stringify(req.json) : req.form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GPT Image 介面返回 ${r.status}：${body?.error?.message ?? '未知錯誤'}`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('GPT Image 介面沒有返回圖片（data[0].b64_json）');
  return Buffer.from(b64, 'base64');
}

/* ------------------------------------------------------------------ */
/* 自定義命令模板                                                        */
/* ------------------------------------------------------------------ */

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** 把一個值安全地放進本機 shell 的單個引數，模型提示詞也不能逃出引數邊界。 */
export function quoteShellArg(value, platform = process.platform) {
  const s = String(value);
  if (platform !== 'win32') return `'${s.replace(/'/g, `'\\''`)}'`;
  if (s.includes('\0')) throw new Error('Windows shell 引數不能包含 NUL 字元');

  // cmd.exe 先解析元字元，再把雙引號引數交給 Windows 程式；反斜槓與引號要按兩層規則轉義。
  // CR/LF 不能安全放進 /c 命令列；需要保留換行的提示詞應使用 {prompt_file}。
  let arg = s.replace(/\r\n?|\n/g, ' ').replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  arg = `"${arg}"`;
  return arg.replace(CMD_META, '^$1');
}

/** .cmd / .bat 不能直接 CreateProcess；只對這兩類入口走 cmd.exe，其餘程式仍按引數陣列執行。 */
function runProgram(command, args, opts = {}) {
  if (IS_WIN && /\.(?:cmd|bat)$/i.test(command)) {
    const escapedCommand = String(command).replace(CMD_META, '^$1');
    const line = [escapedCommand, ...args.map((arg) => quoteShellArg(arg, 'win32'))].join(' ');
    return runShell(line, opts, 'win32');
  }
  return spawnSync(command, args, opts);
}

/** 佔位符：{prompt_file} {negative_file} {prompt} {negative} {refs} {ref1} {ref2} {ref3} {out} {width} {height} {ratio} {seed}，全部已加引號。 */
export function fillTemplate(cmd, vars, platform = process.platform) {
  const quote = (value) => quoteShellArg(value, platform);
  return cmd.replace(/\{(\w+)\}/g, (m, k) => (k === 'refs' ? vars.refs.map(quote).join(' ') : k in vars ? quote(vars[k]) : m));
}

export function customGenerate(job, cfg, name) {
  const spec = cfg.models.custom[name];
  if (!spec?.cmd) throw new Error(`配置裡沒有自定義模型 ${name}（models.custom.${name}.cmd）`);
  const dir = mkdtempSync(join(tmpdir(), 'character-refs-'));
  try {
    const [width, height] = QWEN_SIZES[job.ratio];
    const vars = { prompt_file: join(dir, 'prompt.txt'), negative_file: join(dir, 'negative.txt'), prompt: job.text, negative: job.negative,
      refs: job.refs.map((f) => resolve(f)), ref1: job.refs[0] ?? '', ref2: job.refs[1] ?? '', ref3: job.refs[2] ?? '',
      out: join(dir, 'out.png'), width, height, ratio: job.ratio, seed: job.seed ?? '' };
    writeFileSync(vars.prompt_file, job.text);
    writeFileSync(vars.negative_file, job.negative);
    const r = runShell(fillTemplate(spec.cmd, vars), { encoding: 'utf8', timeout: 20 * 60_000 });
    if (!existsSync(vars.out)) throw new Error(`自定義模型 ${name} 沒有寫出 {out}（退出碼 ${r.status}）：${(r.stderr ?? '').trim().slice(0, 300)}`);
    return readFileSync(vars.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function generate(model, job, cfg) {
  const kind = modelKind(model);
  if (kind === 'qwen') return qwenGenerate(job, cfg);
  if (kind === 'codex') return codexGenerate(job, cfg);
  if (kind === 'openai') return openaiGenerate(job, cfg);
  return customGenerate(job, cfg, model.slice('custom:'.length));
}

/** 展示用：密碼與令牌打碼。 */
export function maskConfig(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  if (c.models?.qwen?.pass) c.models.qwen.pass = '（已隱藏）';
  return c;
}
