# storyboard.json 結構

三層：**集 → 段（segment）→ 分鏡（cut）**。

- **段** = 一次影片生成呼叫，總時長 ≤ `maxSegmentSeconds`（預設 15 秒），不跨場次——換景必開新段
- **分鏡** = 段內的一次切鏡，`minCutSeconds`–`maxCutSeconds`（預設 2–5 秒），各自認領劇本節拍、帶景別運鏡和一張分鏡圖
- **分鏡圖** = 每個分鏡一張關鍵幀：第 1 切的是**主分鏡圖**（釘在 0.00 秒），其餘是**子分鏡圖**（各釘在自己的切點時刻）。**每段一個資料夾**：`<段號>/f<切序>.png` + `prompt.md`（export 生成，內容就是 h3Prompt）

```json
{
  "source": "渡口",
  "style": "realistic",
  "promptLang": "zh",
  "params": { "maxSegmentSeconds": 15, "minCutSeconds": 2, "maxCutSeconds": 5, "maxOnScreen": 3, "tolerance": 0.15 },
  "episodes": [ { "ep": 1, "segments": [ ... ] } ]
}
```

`promptLang` 可省略（**預設 `en`——官方規範口徑**）：整條英文、禁角色名，臺詞在 `<d>[Chinese]` 裡保留原文。設成 `zh` 可切整條中文（對齊指令、欄位名、鏡頭標記都有中文版，人名放行）——偏離官方推薦的備選項。`style` 可省略（預設 `realistic`），預設與角色/場景 skill 同名對齊（`realistic` / `ghibli`），對應的英文短語（如 `cinematic film still`）必須出現在**每條**分鏡圖提示詞裡——同一部劇的分鏡圖不許畫風漂，門查。

## segment（段）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | string | 段號 `E01-01`：集號 + 兩位序號，**按順序連號**。它就是素材檔名（`E01-01.mp4` / `E01-01-f1.png`） |
| `sceneIndex` | int | 這一段在劇本該集的第幾場（1 起）。段內全部分鏡同場 |
| `cuts` | cut[] | 段內分鏡，按時間順序。段總秒數 = 分鏡秒數之和，**不單獨存**——少一處會漂的冗餘 |
| `h3Prompt` | string | **一段一條 H3 影片提示詞**，正文語言跟 `promptLang`（預設中文），結構見 `references/h3-prompt.md` |
| `note` | string | 備註，可選 |

## cut（分鏡）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `beats` | [int, int] | 認領該場第幾拍到第幾拍（含兩端）。**每個節拍必須被恰好一個分鏡認領**，按順序、連續 |
| `seconds` | number | 分鏡時長，2–5 秒——短劇的注意力節奏是硬門。認領節拍的臺詞秒數必須裝得下 |
| `size` | enum | 景別：`extreme-wide` 大遠景 / `wide` 全景 / `medium` 中景 / `close` 特寫 / `extreme-close` 大特寫 |
| `camera` | enum | 運鏡，**直接用 H3 官方詞表**（原樣字串）：`Static Shot` `Push In` `Pull Out` `Zoom In/Out` `Pan Left/Right` `Truck Left/Right` `Tilt Up/Down` `Pedestal Up/Down` `Arc Shot` `Tracking Shot` `Shake Slightly/Strongly` `POV` `Roll Clockwise/Counterclockwise` |
| `characters` | string[] | 畫內人物（C 編號），必須 ⊆ 劇本該場人物；空鏡給空陣列。> `maxOnScreen` 時必須帶 `note` |
| `props` | string[] | 畫內道具（P 編號），必須 ⊆ 劇本該場道具。可省略 |
| `frame` | string | **分鏡圖英文提示詞**：這一格關鍵幀的樣子。景別英文短語必須在裡面；禁角色名 |
| `recipe` | string | 鏡頭配方卡 id，可選。掛了 `--shots <卡片目錄>` 才查（`shot-recipe` 門）。**cut 級不是 segment 級**——一段可以跨多種配方；**多格配方靠連續同 id 的分鏡表達**，不是陣列 |
| `note` | string | 備註，可選 |

`recipe` 是**可選掛載**：不給 `--shots` 就整門跳過。給了就查三條——id 在卡庫裡、卡片的每條 `must_phrases` 出現在該切的 `frame` 裡（兩邊小寫化後 `includes`）、卡片 `cuts` 下限 ≥ 2 時連續同 id 的分鏡數不得低於該下限。卡片的**建議景別與運鏡不設門**，只在報告裡提示偏離：配方是語彙不是法條。

## h3Prompt 的結構（三道門盯著，兩處逐字對賬）

寫法見 `references/h3-prompt.md`（官方方法論的內化版，本 skill 自包含不依賴外部 skill）。骨架：

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 3.00-second mark of the target video; ….

integrated_multimodal_description:
[Shot 1] Cinematic, live-action, …（首格錨定 → 動作 → 運鏡 → 對白）
[Shot 2] At 00:03.000, the camera cuts to …（每個鏡頭獨立一行，切點時刻開頭）

overall_soundscape: …（環境聲與動作聲，1–4 句）

non_diegetic_music: …（1–3 句，沒有就 N/A）
```

確定性檢查的五條：

1. **首行對齊指令整行由分鏡結構按 `promptLang` 推導**（`h3AlignmentLine`）：多分鏡的段把每張分鏡圖釘在自己的切點秒數上；單分鏡的段用固定句式。validate **逐字對賬**——分鏡秒數一改，舊指令立刻對不上
2. 三個欄位名齊全且按序；描述正文有 `[Shot 1]`
3. **每個 `[Shot k]`（k ≥ 2）必須帶切點時刻 `At 00:0X.XXX,`，且等於前面分鏡秒數的累計**——節奏寫在紙上就必須和提示詞一致
4. 認領節拍的每句臺詞**逐字**進 `<d>[Chinese] …</d>`；說話人身份音色語氣用英文寫在 `<d>` 外；畫外音用 `says in an off-screen voiceover` 並註明唇形閉合
5. `<d>` 塊之外的正文語言與 `promptLang` 一致（中文寫成英文、英文混進中文都攔）；英文模式禁角色名，中文模式放行（身份靠分鏡圖錨定）；每個分鏡的運鏡詞（中文用詞表中文詞如「推」「固定」，英文用官方詞）必須出現在**自己的 [Shot k] 段落**裡

## 時長約束鏈

臺詞秒數（按劇本語速折算）≤ 分鏡 `seconds` ≤ 5 秒；段 Σ分鏡 ≤ 15 秒；集 Σ段 落在劇本 `targetSeconds` ±15%。全部由 validate 逐級對賬。
