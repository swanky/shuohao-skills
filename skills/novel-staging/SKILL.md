---
name: novel-staging
version: 1.0.1
description: |
  給 AI 短劇的每一場排開場站位：先從場景圖裡認出能站能坐的東西（推算到俯視平面上），
  再按劇本給每一場排誰在哪件東西的哪一側、坐還是站、面朝哪、有沒有群演，
  程式寫出每一場的開場走位句，分鏡這一場第一段照抄它。
  預設交付能拖動調整站位的 HTML 工具報告，頁面內可匯出 staging.json；JSON 同時作為工作資料儲存，Markdown 按需匯出。
  8 道品質門全部由腳本確定性檢查（認圖件數、東西在圖上、出場人物不多不少、在場的人落在認出來的東西上、
  同一側不疊人、群演寫明在哪……）。吃 novel-script 的 script.json 和 novel-art 的 art.json 預填骨架。
  零依賴、零 API key。
  Use when asked to 站位、開場站位、群戲站位、誰坐在哪、排座位、走位、blocking、staging for AI short drama。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-staging
  - 站位
  - 開場站位
  - 群戲站位
  - 排座位
  - 走位
  - blocking
  - staging
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
  runtimes:
    - claude-code
    - codex
---

## novel-staging

給 AI 短劇的每一場排**開場站位**：這一場一開始，每個出場的人在哪件東西旁、坐還是站、面朝哪。

**為什麼要單獨排**：短劇的每一段影片是一次獨立生成，各段自己決定誰坐哪。群戲裡六個人圍一張長桌，第一段桌邊多出五個沒名字的賓客，第三段端酒坐著的人穿著主角的衣服。分鏡的走位句一段接一段地交接，可每一場**第一段**的那一句是分鏡自己編的，人看不到、改不動。所以在分鏡之前，每場先定一份站位，分鏡照抄。

| 交付 | 解決什麼 |
| --- | --- |
| 認圖結果（每個地點 4–20 件東西） | 站位只落在圖上真有的東西旁——提示詞裡寫了、圖上沒畫的高臺，人坐上去，每段影片都不一樣 |
| 俯視平面 | 在透視的場景圖上「桌子北側」只是桌子後面一小條，前後深淺說不清；擺平了從上往下看，方位一目瞭然 |
| 開場站位（每場） | 誰開場就在、誰後來才進；坐還是站跟著劇本；主位、對立、孤立用位置說出來 |
| 開場走位句 | 程式按站位寫，一字不差交給分鏡：「胡二爺坐在第三排坐板上，面朝北；其餘座位空著，沒有其他人。」 |
| 能調整的報告 | 人在頁面上拖動、改坐站和朝向，改完匯出就是新的 staging.json，不用手改 JSON |

`{baseDir}` = 本檔案所在目錄。腳本 `{baseDir}/scripts/novel-staging.mjs`，零依賴，`node` 直接跑。

**邊界（不做的事）**：不寫分鏡、不寫劇本、不生圖。只管**開場那一刻**——中途誰站起來、走到哪，是分鏡的事，分鏡從這一刻往後接著寫。

---

### Step 0 — 定輸入

- **script.json**（novel-script 的產出）——硬前提：有哪幾場、每場在哪個地點、誰出場、劇本怎麼寫的
- **art.json**（novel-art 的產出）——地點的名字；還沒有圖時，按它的錨點和主視角提示詞推算
- **outline.json**（novel-outline 的產出）——人物編號對應的名字（C01 → 沈知微）
- **場景圖**——每個地點一張，放在 `images/<地點名>-sheet.png`（novel-art 的設定圖版面，主視角在左上）。**最好有**：站位要落在圖上真有的東西旁。沒有圖也能先排，但只是草稿（見 Step 2）

### Step 1 — seed 骨架

```bash
node {baseDir}/scripts/novel-staging.mjs seed <script.json> --art <art.json> --outline <outline.json> > <workdir>/staging.json
```

確定性搬運：地點（按第一次出現的順序）、每一場的集號場號、在哪個地點、光照時段、出場人物，每個人一條空的站位。**這些事實不要讓模型重新想一遍。** 只要其中幾集就加 `--eps 1-3`。

### Step 2 — 認圖（每個地點一次）

每個地點一份任務，能併發就併發。讀 `{baseDir}/references/read-pass.md`，照著做：看場景圖的主視角，認出人會站在旁邊、坐在上面的東西，每件寫名字、另一種語言、圖上的框（`box`）、平面上的位置（`plan`）、能不能坐（`on`）、是不是圓的（`round`），4–20 件，`readFrom` 寫 `picture`。

最重的兩條：**圖裡看不到的不寫**（提示詞裡有、圖上沒有的一律不寫）；**`plan` 按透視推算**，不是照抄 `box`。

**還沒有圖**：按 art.json 的錨點和主視角提示詞推算，`readFrom` 寫 `prompt`、不寫 `box`。報告會標出來；圖出來以後重新認一遍、核對站位。

### Step 3 — 排站位（每場一次）

每場一份任務，能併發就併發（同一個地點連著幾場的，按順序排，保持位置連貫）。讀 `{baseDir}/references/staging-pass.md`，拿這一場的劇本、出場人物和這個地點認出來的東西，給 `places` 裡每個人填：開場在不在（`present`）、在哪件東西（`item`）的哪一側（`side`）、沿這一側多遠（`along`）、坐還是站（`posture`）、面朝哪（`facing`）；再填群演（`extras` / `extrasWhere`）和一句 `why`。

最重的三條：**後來才進來的人開場不在**；**劇本沒寫有別人就沒有群演**；**只使用認出來的那些東西**。

### Step 4 — 校驗 ⛔ 不能跳

```bash
node {baseDir}/scripts/novel-staging.mjs validate <staging.json> --script <script.json> --art <art.json>
```

8 道品質門全是程式碼：每個地點認了圖且 4–20 件、東西的名字不重複且框合法（按圖認的必須有 `box`）、每一場的地點都有認圖結果、出場人物不多不少（給了 `--script` 還核對跟劇本一致）、每個人都定了在不在場且至少一人在場、在場的人落在認出來的東西上且方位坐站朝向合法、同一側不疊人、群演人數是整數且寫明在哪。

**有違規逐條修，改完重跑，直到通過。**

### Step 5 — 預設交付 HTML 工具報告

```bash
cd <輸出目錄>
node {baseDir}/scripts/novel-staging.mjs render staging.json > staging-report.html
```

**預設主交付是 `staging-report.html`，完成後直接給使用者報告連結或路徑，不要只返回 JSON、Markdown 或一段聊天摘要。** `render` 不指定格式時直接輸出 HTML，顯式 `--html` 仍然支援。`staging.json` 作為工作資料儲存，供校驗、再次渲染和後續交接；僅在使用者需要文字版時執行 `render staging.json --md > staging.md`。

`staging-report.html` 雙擊就能開，每一場一張俯視平面：

- **拖動**一個人換位置，鬆手時落在最近那件東西最近的一側；拖回下面的托盤就是開場不在，從托盤拖進來就是在場
- **點一下**一個人，調整坐著／站著、朝向（八個方位）
- 群演加減、寫在哪；開場走位句和這一場的檢查跟著實時更新
- 改動存在瀏覽器裡，重新整理不丟；**「匯出 JSON」**下載改過的 staging.json

把匯出的檔案覆蓋回 `staging.json`，**再跑一次 Step 4**。報告介面預設中文，`--lang en` 出英文介面（走位句改用認圖時寫的另一種語言名字）。圖在別處就用 `--images <目錄>` 指過去。

使用者也可以用一句話要求調整（「把胡二爺挪到船頭」）：照 `staging-pass.md`「按一句話調整」改，只動說到的人，再校驗。

### Step 6 — 交給分鏡

```bash
node {baseDir}/scripts/novel-staging.mjs blocking staging.json            # 每場一行：場次 + 開場走位句
node {baseDir}/scripts/novel-staging.mjs blocking staging.json --lang en  # 英文
```

分鏡寫每一場**第一段**的開場走位（novel-storyboard 的 `blocking`）時，照抄這一句；之後各段照舊由上一段的段末走位接下去。

先提供 HTML 工具報告連結或路徑，再用一句話說清：幾個地點（幾個按圖認的、幾個按提示詞推算的）、幾場、幾場有人開場不在、群演多少；沒過的門明說。JSON 是配套工作資料，Markdown 不是預設交付項。

最終落地：

```
<輸出目錄>/
├── staging-report.html            ← 預設主交付，雙擊開啟，拖動調整並匯出 JSON
├── staging.json                   ← 工作資料，供校驗、渲染和後續交接
└── images/                        ← 本 skill 不寫這個目錄
    └── <地點名>-sheet.png          ← novel-art 的場景設定圖放這兒，認圖和報告都使用它
```

---

## 在管線裡的位置

```
novel-outline    → outline.json （人物名字）
novel-art        → art.json     （地點 + 場景圖）
novel-script     → script.json  （每一場誰出場、怎麼演）
novel-staging    → staging.json （每一場開場誰在哪）
novel-storyboard → storyboard.json（每一場第一段的開場走位照抄 staging）
```

seed 吃 script.json，`--art` 給地點名字，`--outline` 給人物名字。novel-storyboard 目前**不自動讀** staging.json：使用 `blocking` 命令打出的句子，寫進分鏡每場第一段的 `blocking`。

## 邊界

- 只排開場那一刻；中途換位置歸分鏡
- 本 skill 不生圖；場景圖是 novel-art 的設定圖出完以後放進 `images/`
- 方位一律按場景說（東南西北、在哪件東西旁），不按畫面說（左右）——畫面左右由機位推出，機位一換就翻

## 自測

```bash
node {baseDir}/scripts/selftest.mjs
```

99 項斷言，不調模型、不花額度。8 道品質門每一道都有擊穿用例；平面幾何、拖動落點、走位句、seed、報告（中英介面、轉義、嵌圖）都覆蓋；還會單獨拿嵌進頁面的那份演算法的原始碼重建一份，核對跟命令列算的一樣。改完腳本先跑這個。

## 自帶樣例

`{baseDir}/examples/渡口-staging.json`：《渡口》三個地點（渡口棧橋、渡船船艙、對岸蘆葦灘）、九場的開場站位，全部品質門通過（對著樣例劇本和美術）。樣例沒有場景圖，三個地點都是按設定提示詞推算的（`readFrom: prompt`）。當品質基準，也是自測夾具。
