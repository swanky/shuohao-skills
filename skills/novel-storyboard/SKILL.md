---
name: novel-storyboard
version: 2.0.0
description: |
  給 AI 短劇出分鏡：三層結構——段（一次影片生成，≤15 秒）→ 分鏡（段內 2–5 秒的切鏡，認領劇本節拍）
  → 分鏡圖（每切一張關鍵幀：主分鏡圖釘 0.00 秒，子分鏡圖釘各自切點）。
  每段自帶一條 MiniMax H3 影片提示詞（官方口徑預設英文、逐鏡換行，promptLang 可切中文）：對齊指令和
  [Shot k] 切點時刻由分鏡結構推導、逐字對賬，臺詞逐字進 <d> 塊（寫法規範已內化為
  references/h3-prompt.md，不依賴外部 skill）。
  產出 storyboard.json + Markdown + 單頁評審報告（分鏡節奏帶 / 分集分鏡表 / 生成批次單 /
  配音對齊單，含匯出 JSON）。不生圖——交付的是每格的畫面提示詞和它該掛哪些參考圖。
  18 道品質門全部由腳本確定性檢查（第 18 道 shot-recipe 可選：掛上 shot-recipes 卡庫才查，不掛就明說跳過）；
  export 一鍵匯出 H3 投產包（每段提示詞 + 按 Picture 序的分鏡圖清單）。零依賴、零 API key，用當前會話額度。
  Use when asked to 分鏡、出分鏡、鏡頭表、切鏡、storyboard for AI short drama。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-storyboard
  - 分鏡
  - 出分鏡
  - 鏡頭表
  - 切鏡
  - 首幀
  - storyboard
  - shot list
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
  runtimes:
    - claude-code
    - codex
---

## novel-storyboard

給 AI 短劇出**分鏡**——管線裡第一個直接面對影片模型的層。**前提刻在骨子裡：鏡頭是生成出來的，多切一鏡的成本幾乎為零**，所以這裡不心疼鏡頭數量，上限只有一個：影片模型單段生成的時長（預設 15 秒）。

**核心機制：鏡頭認領節拍。** 每個鏡頭宣告它覆蓋劇本某場的哪幾個連續節拍（`sceneIndex` + `beats: [起, 止]`），鏡頭不許跨場次——換景必換鏡。這讓分鏡和劇本的關係變成可機械對賬的：

| 交付 | 解決什麼 |
| --- | --- |
| 節拍認領 | 每個節拍被恰好一個鏡頭認領、順序不亂——劇本改了重跑 validate，失效的鏡頭當場點名 |
| 單鏡頭 ≤ 15 秒 | AI 影片單段生成上限，長對話在這裡被強制拆鏡（`params.maxShotSeconds` 按模型改） |
| 臺詞裝得下 | 認領節拍的臺詞秒數 ≤ 鏡頭秒數——逐鏡檢查，不是拍腦袋 |
| 分鏡圖提示詞 + 鏡頭正文 | 分鏡圖提示詞（`frame`，中文，直呼角色名）給影像模型配合設定圖生圖；鏡頭正文（`shot`，中文，通用身份）寫這幾秒發生什麼。景別是列舉，中文景別詞必須寫進分鏡圖提示詞 |
| **H3 影片提示詞（每段一條）** | MiniMax H3 的 I2VA 結構：固定對齊指令 + integrated_multimodal_description + overall_soundscape + non_diegetic_music。**認領節拍的臺詞逐字進 `<d>[Chinese] …</d>` 塊**——對白、聲景、配樂一段提示詞全帶上 |
| **Seedance 影片提示詞（每段一條，程式拼）** | 跟 H3 並列。由腳本按官方結構拼：參考圖宣告、段級走位、逐鏡量化欄位、臺詞 `{}`、音效 `<>`、配樂 `（）`、編號約束。模型只寫每切的 `shot`，不寫秒數、編號和圖片引用 |
| 構圖量化欄位 | 每段 `blocking`（誰在左誰在右、間距），每鏡焦距／機位／構圖／視線落點／焦點／穩定性——不出分鏡圖時，它們就是構圖的全部來源 |
| 生成批次單 | 同場景 + 同光照的鏡頭歸一批，共用同一張環境參考圖——AI 版的順場表，腳本自動彙總 |
| 配音對齊單 | 每句臺詞對到鏡號——TTS 音訊貼到哪一段影片，腳本自動彙總 |

`{baseDir}` = 本檔案所在目錄。腳本 `{baseDir}/scripts/novel-storyboard.mjs`，零依賴，`node` 直接跑。

**邊界（不做的事）**：不寫戲不改臺詞（`novel-script` 的活）、不出場景/角色/道具設定圖（`novel-art` / `novel-characters` 的活）、不做影片生成與剪輯合成。口型/唇形同步暫不管——那是生成管線的事。

---

### Step 0 — 定輸入與範圍

**script.json 是硬前提**——分鏡離開劇本沒有意義，validate/render 都必須給 `--script`。其餘上游按有則用：

- `--outline` / `--cast`：提示詞禁人名檢查 + 報告裡 C01 顯示成人名
- `--art`：報告裡 S01 顯示成場景名 + 批次單嵌場景設定圖
- `--shots <卡片目錄>`：**可選**掛載 shot-recipes 的鏡頭配方卡庫（指向 `shot-recipes/references/cards`，只接受目錄不接受匯出的 JSON），開第 18 道 `shot-recipe` 門。沒裝 shot-recipes 就別給——本 skill 自包含，不依賴它

**一次切幾集**：跟劇本的批次走（劇本寫到哪就分到哪），預設一批 ≤ 3 集。

**先定畫幅**：storyboard.json 頂層 `aspectRatio` 是分鏡與下游生圖共同遵守的正式合同，只接受 `16:9` 或 `9:16`。沒有特別要求時使用 `16:9`；豎屏短劇明確寫 `9:16`。

### Step 1 — seed 工作底稿

```bash
node {baseDir}/scripts/novel-storyboard.mjs seed <script.json> --eps 1-3 --aspect 16:9 > <workdir>/storyboard.json
```

確定性展開：每場的節拍清單（編號、動作/臺詞、每拍秒數、說話人）進 `seedScenes`，這就是切鏡時的工作底稿；同時把 `--aspect` 寫進頂層 `aspectRatio`，省略時預設 `16:9`。**每拍幾秒是算出來的，不要讓模型重新估。** shots 留空，切鏡才是模型的活。

### Step 2 — 逐集分段切鏡

每集一份任務，能併發就併發。每份任務拿到：

- `{baseDir}/references/storyboard-pass.md` 和 `{baseDir}/references/schema.md`（讀它們，照著做）
- 該集的 seedScenes 底稿 + 場景卡（art.json 的錨點與光照提示詞）+ 角色卡（cast.json 的形象要點）

流程：**先按劇情單元分段**（每段 9–15 秒、不跨場），**段內切 2–5 秒的分鏡**（對話正反打、關鍵動作插入特寫、進場三件套——切鏡語法都在 storyboard-pass.md），每切寫一條分鏡圖提示詞（中文，直呼角色名）、一段鏡頭正文 `shot`（中文，通用身份）和六個構圖欄位；每段寫 `blocking`、`soundscape`，有配樂再寫 `music`。全部分鏡圖與下游生成圖必須保持頂層 `aspectRatio` 指定的同一畫幅。

**每段的鏡頭正文照 `{baseDir}/references/shot-writing.md` 寫**（協議無關：一切一個運鏡、動作要做得完、臺詞逐字、聲音分層、不寫畫風）。發給哪個影片服務，就再套哪份協議語法：MiniMax H3 見 `{baseDir}/references/h3-prompt.md`，Seedance 見 `{baseDir}/references/seedance-prompt.md`。

**每段寫一條 `h3Prompt`**，照 `{baseDir}/references/h3-prompt.md` 寫（官方方法論的內化版，**不依賴任何外部 skill**）。官方口徑預設英文（`promptLang` 可切中文），**每個鏡頭獨立一行**。要點：首行對齊指令和 `[Shot k]` 切點時刻**由分鏡秒數推導，一個字元都不許漂**（validate 逐字對賬）；認領臺詞**逐字**進 `<d>[Chinese] …</d>`；每切的運鏡詞寫進自己那一行；聲景與配樂分進後兩個欄位——**聲景也是動作指令，畫面改了聲景一起改**。

**Seedance 提示詞不用寫**：`render` 報告的提示詞面板和 `export --protocol seedance` 都會從上面這些欄位現拼。視覺風格由呼叫方提交時附加，全域性約束用 `--constraints <檔案>` 給。

切完把 `seedScenes` 刪掉。

### Step 3 — 校驗 ⛔ 不能跳

```bash
node {baseDir}/scripts/novel-storyboard.mjs validate <storyboard.json> \
  --script <script.json> --outline <outline.json> --cast <cast.json> \
  [--shots </path/to/cards>]
```

18 道品質門全是程式碼：節拍全覆蓋（分鏡級，恰好一次、按順序、連續）、段 0 < 總秒 ≤ 15、**每切 2–5 秒**、臺詞裝得進分鏡、每集總時長在劇本目標 ±15% 內、同框 ≤ 3 人（超了必須帶拆解說明）、段號 E01-01 格式連號、中文景別詞在分鏡圖提示詞裡、運鏡用 H3 詞表且在自己的 [Shot k] 段落裡、**H3 對齊指令由分鏡結構推導逐字對賬 + 切點時刻逐個對**、**認領臺詞逐字進 `<d>` 塊**、**提示詞語言與 promptLang 一致**（雙向查：中文寫成英文、英文混進中文都攔）、分鏡圖提示詞中文非空、**影片提示詞不含角色名**（H3 正文不分語言、Seedance 鏡頭正文都查；分鏡圖提示詞直呼其名放行）、**構圖量化欄位齊全**、**Seedance 鏡頭正文合規**（中文非空，不寫時間、鏡頭編號、圖片引用和協議符號）、場次/人物/道具對賬劇本、**鏡頭配方對賬**（可選門，見下）。

結構檢查還會校驗可選的 `aspectRatio`：只接受 `16:9` 或 `9:16`。它屬於 storyboard.json 合同檢查，不另算品質門。

**有違規逐條修，改完重跑，直到通過。**

**第 18 道 `shot-recipe`（可選掛載）**：給了 `--shots` 才查，不給就明說跳過。cut 上可以寫一個可選的 `recipe`（配方卡 id，**cut 級不是 segment 級**，**多格配方靠連續同 id 的分鏡表達**，不是陣列），門查三條——id 在卡庫裡、卡片的每條 `must_phrases` 出現在該切的 `frame` 裡（兩邊小寫化後 `includes`）、卡片 `cuts` 下限 ≥ 2 時連續同 id 的分鏡數不得低於該下限。卡片的**建議景別與運鏡不設門**，只在報告的「配方」列和 `checkup` 末尾提示偏離：配方是語彙不是法條，可選掛載的東西一旦變嚴就沒人掛。

### Step 4 — 輸出與彙報

```bash
cd <輸出目錄>
node {baseDir}/scripts/novel-storyboard.mjs render <劇名>-storyboard.json --md \
  --script <script.json> --outline <outline.json> --art <art.json> > <劇名>-storyboard.md
node {baseDir}/scripts/novel-storyboard.mjs render <劇名>-storyboard.json --html \
  --script <script.json> --outline <outline.json> --art <art.json> > storyboard-report.html
```

報告介面語言用 `--lang zh|en` 指定（優先順序 `--lang` > JSON 頂層 `lang` 欄位 > 預設中文）——只切介面標籤，與 `promptLang`（H3 提示詞語言）互相獨立。主分鏡圖與子分鏡條按頂層 `aspectRatio` 排版；舊資料的 `_meta.orientation` 與 frame 末尾畫幅標籤只作相容。`render` 用 `--frames <目錄>` 找分鏡圖（`<目錄>/<段號>/f<切序>.png`，預設當前目錄）、用 `--images <目錄>` 找批次單的場景設定圖（`<目錄>/<場景 slug>-sheet.png`，預設 `./images`），兩個都可以指到任意路徑——**本 skill 不產生這些檔案**，下游出完圖重跑一次 render 就能嵌進報告。`export --frames <目錄>` 會把找得到的分鏡圖拷進投產包，不用手動往包裡放。報告含：KPI 帶、分鏡節奏帶（粗分隔 = 段邊界、片寬 = 分鏡時長佔比、顏色深淺 = 景別遠近、點選跳段卡）、分集分鏡表（主分鏡圖 + 子分鏡條 + 逐切分鏡行 + 分鏡圖/H3 提示詞複製按鈕）、生成批次單、配音對齊單、品質門、匯出 JSON。Markdown 版每段附完整 H3 提示詞，直接複製可用。

彙報一句話說清：幾集幾鏡、總時長 vs 目標、幾個生成批次、報告路徑；沒過的門明說。

**不要說「已生圖」**——這一步不存在了，交付的是提示詞和掛圖清單。

最終落地：

```
<輸出目錄>/
├── <劇名>-storyboard.json
├── <劇名>-storyboard.md
├── storyboard-report.html         ← 雙擊就能開
├── manifest.json                  ← export 生成
└── E01-01/                        ← 一段一個資料夾 = 一次 H3 生成的全部材料
    ├── f1.png                     ← 主分鏡圖（下游出完放這兒）
    ├── f2.png …                   ← 子分鏡圖
    └── prompt.md                  ← H3 提示詞（export 生成）
```

---

## 五個 skill 的接力（管線到此閉環）

```
novel-outline    → outline.json    （什麼：結構與分集）
novel-characters → cast.json       （誰：角色設定圖）
novel-art        → art.json        （哪裡：場景/道具設定圖）
novel-script     → script.json     （戲：場次、節拍、臺詞）
novel-storyboard → storyboard.json （怎麼拍：鏡頭、首幀、批次）
```

分鏡是消費端：seed 吃 script.json，分鏡圖生圖（在下游）吃 art 和 characters 的設定圖當參考，H3 提示詞直接下單給影片模型，配音對齊單接 script 臺詞本的 TTS 產物。五份 JSON 各自的報告都帶匯出按鈕，改完都能餵回各自的 render/validate。

## 邊界

- 報告介面內建中英（`--lang`，預設中文）；提示詞語言由 `promptLang` 單獨控制（預設英文）
- 秒數是**下給影片模型的生成時長**不是估算——段上限按你的模型改 `params.maxSegmentSeconds`，切的節奏區間改 `min/maxCutSeconds`
- 口型/唇形同步暫不管——那是生成管線的事
- 分鏡圖不追求一次到位——它是給影片模型的構圖錨，構圖對、資產對就夠，微調交給重生成

## 門失敗會累積

`validate` 與 `checkup` 每次都把門的結果追加到**當前目錄**的 `.gates.jsonl`；跑 `stats` 彙總：

```bash
node {baseDir}/scripts/novel-storyboard.mjs stats
```

回答三件事：**哪道門最常響**（那條規則模型最常無視，該改的是措辭）、**哪道門從沒響過**（可能是死門，也可能規則已被內化）、**失敗詳情長什麼樣**（反覆出現卻沒有門的那類問題，只能靠人看）。

不想記加 `--no-log`；寫不進去靜默跳過，不影響校驗。

## 自測

```bash
node {baseDir}/scripts/selftest.mjs
```

336 項斷言，不調模型、不花額度。18 道品質門每一道都有擊穿用例。改完腳本先跑這個。

## 自帶樣例

`{baseDir}/examples/渡口-storyboard.json`：《渡口》第 1 集完整分鏡——10 段 34 切認領劇本全部 35 拍，平均 3.5 秒一切，共 119 秒 / 目標 120 秒，2 個生成批次，每段帶完整的 H3 影片提示詞（多圖對齊 + 切點時刻全部對賬透過）。當品質基準，也是自測夾具。
