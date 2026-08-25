---
name: novel-script
version: 1.2.0
description: |
  給 AI 短劇寫劇本：把 novel-outline 的分集梗概落成結構化的場次 + 節拍流（動作節拍與臺詞行交替），
  臺詞逐句帶說話人與語氣，時長逐集按語速確定性折算。產出 script.json + Markdown + 單頁評審報告
  （時長儀表 / 分集劇本 / 場次總表 / 按角色聚合的臺詞本，含匯出 JSON）。
  劇本管戲，分鏡管拍——本 skill 不分鏡頭、無鏡號、不寫生成提示詞，那些是下一層分鏡 skill 的活。
  10 道品質門全部由腳本確定性檢查（每集時長 ±15%、單句 ≤35 字、說話人合法、鉤子懸念落紙、
  鉤子具象前 3 拍內兌現（hookBeat 認領冷開場）、每場至少一個動作節拍、爽點認領、
  角色/場景/光照/道具對賬上游……）。
  有 outline.json 就用 seed 預填每集骨架；給 --art 連光照狀態一起對賬。
  零依賴、零 API key，用當前會話額度。
  Use when asked to 寫劇本、出劇本、臺詞、場次、寫戲、screenwriting for AI short drama。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-script
  - 劇本
  - 寫劇本
  - 出劇本
  - 寫臺詞
  - 場次
  - 寫戲
  - screenplay
  - script
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
  runtimes:
    - claude-code
    - codex
---

## novel-script

給 AI 短劇寫**劇本**。**前提刻在骨子裡：劇本管戲，分鏡管拍**——「爽不爽」和「怎麼拍」是兩種迭代節奏，臺詞要反覆推翻重寫，綁上鏡頭分解每改一句都得重排鏡頭。所以這層只有集、場次、節拍流，沒有鏡號；鏡頭、首幀提示詞、生成批次都是下一層分鏡 skill 的活。

但有一條底線：**臺詞必須是結構化資料，不能寫成散文**。每句臺詞是獨立條目（說話人 + 臺詞 + 語氣），動作是獨立節拍——這是全部確定性檢查的地基：

| 交付 | 解決什麼 |
| --- | --- |
| 逐集時長預算 | 一集三分鐘就是三分鐘：臺詞按語速折算、動作按節拍估時，寫超寫欠當場攔下，不流到生成環節才發現 |
| 節拍流（動作 ⇄ 臺詞） | 臺詞直接對接 TTS 逐句生成；動作節拍就是畫面要發生的事。混成散文兩頭都餵不進管線 |
| 每場至少一個動作節拍 | 純對白的場是廣播劇——AI 生成時沒有畫面可寫 |
| 開場鉤子 + 結尾懸念 | 短劇的生死線，每集都要落在紙面；**鉤子不是標籤是第一拍**——`hookBeat` 認領具象位置，必須落在全集前 3 拍內（冷開場） |
| 爽點認領 | 大綱說這一集有大爆點，劇本必須有戲認領它——防止改著改著把爆點改丟 |
| 上游對賬 | 場景/光照/道具對 art.json、角色對 outline.json，寫了美術沒登記的光照狀態當場報 |

`{baseDir}` = 本檔案所在目錄。腳本 `{baseDir}/scripts/novel-script.mjs`，零依賴，`node` 直接跑。

**邊界（不做的事）**：不分鏡頭、無鏡號、不寫畫面生成提示詞、不生圖、不配樂——分鏡層的活一件不碰。不改大綱結構（砍線合人是 `novel-outline` 的活）；不做角色和場景設定（`novel-characters` / `novel-art` 的活）。

---

### Step 0 — 定輸入與範圍

**outline.json 是劇本的直接上游**（分集梗概、爽點落點、單集時長都在裡面），標準流程從它開始。沒有的話先問使用者是否跑 `novel-outline`；使用者堅持直接寫，就問清集數與單集分鐘數，手建骨架，對賬門會明說跳過。

**一次寫幾集**：預設一批 ≤ 3 集。劇本是全管線改得最兇的一層，小批次出、快拍板、再往下寫。使用者明確要全劇也分批產出，每批過一次校驗。

順手帶上（都可選，給了才對賬/顯示名字）：

- `--outline`：角色引用對賬 + 爽點認領檢查 + 報告裡 C01 顯示成人名
- `--art`：場景/光照狀態/道具對賬 + 報告裡 S01 顯示成場景名

### Step 1 — seed 骨架

```bash
node {baseDir}/scripts/novel-script.mjs seed <outline.json> --eps 1-3 > <workdir>/script.json
```

確定性搬運：目標秒數（單集分鐘 × 60）、鉤子、懸念、該集爽點認領、候選場景與人物（進 `seedNote`）。**這些事實不要讓模型重新想一遍。** scenes 留空，那才是寫戲的活。

### Step 2 — 逐集寫戲

每集一份任務，能併發就併發。每份任務拿到：

- `{baseDir}/references/script-pass.md` 和 `{baseDir}/references/schema.md`（讀它們，照著做）
- 該集的 seed 骨架 + 大綱裡這一集的梗概/爽點/人群方案
- 該集用到的場景卡（art.json 裡的錨點、光照狀態）與角色資訊（性情、說話方式——有 cast.json 更好）
- **前一集的結尾懸念**（這一集的開場要接得上）

核心要求都在 script-pass.md 裡，最重的四條：**動作節拍只寫常見動作**（挑擔上船、搭手卸擔這種 AI 見過千萬次的；伸篙一擋、睫毛顫這種精巧動作生成必崩）；**時長預算先於一切**（三分鐘一集約 50 個節拍，寫完自己跑一遍 validate 看秒數）；臺詞口語、單句一口氣、**誰的話像誰**（有 cast.json 就吃角色的性情與說話方式）；**每集第 1 拍冷開場給鉤子的具象**（`hookBeat` 認領，門查位置），結尾一拍必須是懸念。

寫完把 `seedNote` 刪掉。

### Step 3 — 校驗 ⛔ 不能跳

```bash
node {baseDir}/scripts/novel-script.mjs validate <script.json> \
  --outline <outline.json> --art <art.json>
```

10 道品質門全是程式碼：每集時長在目標 ±15% 內（臺詞按 4.5 字/秒折算、動作按 2.5 秒/拍，`params` 可調）、單句臺詞 ≤ 35 字、說話人在本場人物裡或標 `VO`、每集鉤子懸念落紙、**鉤子具象在全集前 3 拍內兌現**（`hookBeat` 認領，`params.hookWindow` 可調）、每場至少一個動作節拍、動作敘述體不混引號臺詞、爽點認領、角色對賬、場景/光照/道具對賬。

**有違規逐條修，改完重跑，直到通過。** 寫超了先砍動作節拍再壓臺詞；寫欠了補戲不注水——加衝突不加寒暄。需要一個美術沒登記的光照狀態時，去 art.json 裡補狀態再回來，不要繞過門。

### Step 4 — 輸出與彙報

```bash
cd <輸出目錄>
node {baseDir}/scripts/novel-script.mjs render <劇名>-script.json --md \
  --outline <outline.json> --art <art.json> > <劇名>-script.md
node {baseDir}/scripts/novel-script.mjs render <劇名>-script.json --html \
  --outline <outline.json> --art <art.json> --cast <cast.json> > script-report.html
# 英文介面：加 --lang en（預設中文，也可跟 script.json 頂層的 lang 欄位）
```

報告含：KPI 帶（含臺詞佔比）、時長儀表（每集條形打在目標區間帶上，超欠標紅）、分集劇本（一排兩集，場次資訊超過 300px 漸隱截斷、點開展開）、場次總表、**臺詞本**（一排兩個，按角色聚合、列表六行高可滾動、整組複製；給了 `--cast` 每個角色組頭帶**音色提示詞**按鈕——臺詞和音色一頁配齊直接跑 TTS）、品質門面板、匯出 JSON（下載的就是 script.json 原樣）。

彙報一句話說清：幾集幾場幾句臺詞、預估總時長 vs 目標、哪幾集貼著容差邊、報告路徑；沒過的門明說。

最終落地：

```
<輸出目錄>/
├── <劇名>-script.json
├── <劇名>-script.md
└── script-report.html             ← 雙擊就能開
```

---

## 四個 skill 的接力

```
novel-outline    → outline.json （什麼：結構與分集）
novel-characters → cast.json    （誰：角色資產）
novel-art        → art.json     （哪裡 + 手裡拿的：美術資產）
novel-script     → script.json  （戲：場次、節拍、臺詞）
```

seed 吃 outline.json；validate/render 的 `--outline` `--art` 負責對賬和顯示名字。四份 JSON 各自的報告都帶匯出按鈕，改完都能餵回各自的 render/validate。往下一層是分鏡：鏡號、單鏡頭時長、首幀提示詞、生成批次單都在那邊。

## 邊界

- 報告介面內建中英（`--lang`，預設中文、或跟 script.json 的 `lang` 欄位）；臺詞語言跟劇走
- 時長是**估算不是秒錶**——容差 ±15% 就是為此留的；`params.charsPerSecond` 按配音語速可調
- `VO` 是畫外音統一記號，誰的心聲寫在 `delivery` 裡；臺詞本里 VO 單獨成組
- 不設每集場次上限——AI 換景不要錢，換景次數只進 KPI 統計不設門

## 自測

```bash
node {baseDir}/scripts/selftest.mjs
```

154 項斷言，不調模型、不花額度。10 道品質門每一道都有擊穿用例。改完腳本先跑這個。

## 自帶樣例

`{baseDir}/examples/渡口-script.json`：《渡口》**全 6 集完整劇本**（9 場 123 句臺詞，每集冷開場兌現鉤子、都落在 120 秒 ±15% 內），對著 novel-outline 與 novel-art 的樣例全部品質門通過。當品質基準，也是自測夾具。
