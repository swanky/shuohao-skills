---
name: upstream-sync
version: 1.0.0
description: |
  把上游（簡體）的新提交合併進這個台灣正體 fork：比對落後幾筆、合併、解衝突一律取正體、
  把上游新增的內容整份轉成台灣正體與台灣用詞，再用確定性檢查把漏改逐檔掃出來。
  用詞檢查由 scripts/check-zh-tw.mjs 執行，不靠模型自覺；`--lang zh` 的簡體語系表與日文語系表有白名單，不會被誤改。
  零依賴、零 API key，只需要 node >= 18 與 git。
  Use when asked to 同步上游、拉上游更新、merge upstream、正體化、sync upstream。
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
triggers:
  - upstream-sync
  - 同步上游
  - 拉上游更新
  - 上游有沒有更新
  - 正體化
  - sync upstream
  - merge upstream
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
      - git
  runtimes:
    - claude-code
    - codex
---

## upstream-sync

上游 `eternityspring/shuohao-skills` 是簡體專案，這個 fork 全面使用台灣正體。每次同步都是同一件事：**把上游的功能拿過來，把上游的字換掉**。

`{baseDir}` = 本檔案所在目錄。檢查腳本 `{baseDir}/scripts/check-zh-tw.mjs`，零依賴，`node` 直接跑。

**邊界（不做的事）**：不改上游的功能設計、不順手重構、不動已推上 `origin` 的歷史。合併之外的改動另開一次提交，不混進同步提交裡。

---

### Step 0 — 前置檢查 ⛔ 缺了不開工

```bash
git status --porcelain          # 必須是空的，有未提交的改動先處理掉
git remote -v | grep upstream   # 沒有就 git remote add upstream <上游網址>
git fetch upstream
```

工作區不乾淨就先停下來問使用者，不要自作主張 stash。

---

### Step 1 — 有沒有更新

```bash
git rev-list --count main..upstream/main    # 落後幾筆
git rev-list --count upstream/main..main    # 領先幾筆（fork 自己的擴充）
```

**落後 0 筆就到此為止**：回報「上游沒有新提交」，附上兩個數字當證據，不要為了有事做而去改別的東西。

---

### Step 2 — 先看上游改了什麼

```bash
git log --oneline main..upstream/main
git diff --stat main..upstream/main
```

看完先講一句人話的摘要：新增了哪個 skill、動了哪些腳本、有沒有碰到 fork 特有的檔案。**這一步決定後面要花多少力氣，不能跳過直接合併。**

---

### Step 3 — 合併，不要 rebase

```bash
git merge upstream/main
```

**用 merge 不用 rebase**：這個 fork 的同步歷史本來就是 merge commit，而且已經推上 `origin`。rebase 會改寫已發布的歷史，逼出 force push。

---

### Step 4 — 解衝突：一律取正體那一側

上游是簡體專案，衝突幾乎都是同一段話的簡繁兩版。判斷順序：

1. **內容相同、只差字形** → 取這個 fork 的正體版本。
2. **上游改了內容** → 以上游的新內容為準，但用台灣正體與台灣用詞重寫。
3. **衝突落在 fork 專屬的擴充上**（`zh-TW` 預設、`photoreal` 畫風、古典小說品質基準、`upstream-sync` 本身）→ 保留 fork 版本，再把上游的新東西補進去。

衝突解完先跑一次 `git diff --stat HEAD` 確認範圍，再進 Step 5。

---

### Step 5 — 正體化：上游新增的內容整份轉

上游這次動過的每一個檔案都要看過。轉換範圍包含**文件、程式碼註解、CLI 訊息、報告介面文案、範例資料、CHANGELOG**。

用詞對照與一簡對多繁的判斷表在 [`references/terminology.md`](references/terminology.md)，開工前讀一遍。

**四條例外，轉了就是錯：**

<!-- zh-tw-lint: off -->

| 絕不轉的東西 | 為什麼 |
| --- | --- |
| `novel-characters.mjs` 的 `STRINGS.zh` 整套 | 那是 `--lang zh` 這個功能本身，不是待翻譯的內容 |
| `selftest.mjs` 裡驗證 `--lang zh` 輸出的斷言 | 改了就驗不到簡體語系 |
| `image.prompt`／`negativePrompt`／`tags`／`sheet`／`voice.prompt` | 永遠英文，生圖與 TTS 引擎吃英文最穩 |
| 範例資料裡的原文引文 | 引文是證據，翻譯了就不是證據；`validate` 會逐字比對 |

<!-- zh-tw-lint: on -->

日文語系表（`ja`）用的是日文新字體，字形與簡體重疊，**同樣不要動**。

轉完用腳本掃一遍。合併剛做完時 `ORIG_HEAD` 就是合併前的 HEAD，用它掃到的正是這次合併碰過的檔案：

```bash
node {baseDir}/scripts/check-zh-tw.mjs --since ORIG_HEAD
```

想連 fork 相對上游的全部差異一起看（範圍更大、不會漏），就掃 `upstream/main`；不帶 `--since` 則是全 repository，連還沒 `git add` 的新檔案也掃。

輸出分兩級：`✗` 是漏改，必須修到零；`·` 是待確認的用詞，逐條看過再決定。文件裡本來就要寫出反例的地方（用詞對照表那一欄），用標記豁免：

- Markdown：`<!-- zh-tw-lint: off -->` … `<!-- zh-tw-lint: on -->`
- 程式碼：`// zh-tw-lint: off` … `// zh-tw-lint: on`
- 只豁免一行：在該行尾端寫 `zh-tw-lint: allow`

**加規則的正確位置是 `check-zh-tw.mjs`**，不是在這份文件裡多寫一句「請注意」。新的大陸用詞漏了就補進 `TERM_RULES`，新的簡體字漏了就補進 `SIMPLIFIED_CHARS`，一簡對多繁的字不要補——那是語境判斷，腳本決定不了。

---

### Step 6 — 驗證 ⛔ 不能跳

從 repository 根目錄跑完整套：

```bash
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
node scripts/report-selftest.mjs
node skills/upstream-sync/scripts/check-zh-tw.mjs
```

三樣全綠才算完成。`check-zh-tw.mjs` 不加參數時會掃全部受版本控制的檔案，連還沒 `git add` 的新檔案也一起掃。

上游若動過版面或提示詞，再拿 `skills/novel-characters/examples/渡口.txt` 端到端跑一次，看報告有沒有變形。

---

### Step 7 — 收尾

1. `CHANGELOG.md` 開一則 `## Fork x.y.0 — YYYY-MM-DD`，照既有條目的寫法：同步到哪個提交、整合幾筆、上游帶來什麼、fork 保留了什麼、自測共幾項通過。
2. 提交訊息用台灣正體，例如 `feat: 同步上游 <短雜湊> 並完成正體化`。
3. `git push origin main`。

**證據紀律**：回報時附上可貼出的驗證輸出（自測項數、檢查腳本的結束訊息）。缺證據就寫「已改、未驗」，不要宣稱完成。
