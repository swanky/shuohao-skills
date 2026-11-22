---
name: character-refs
description: |
  給任何故事裡的角色真出參考圖（小說改編、自己原創的故事、單獨設計一個角色都行，不需要小說原文）：
  一段話描述角色，拆成分層欄位、補全後確認，
  先出一張正面全身錨點，其餘檢視（大頭照、90° 側面、背面、細節、45° 大頭照）都只參考這張錨點，
  按需分檔生圖。每張圖帶標識、可單獨重出，重出後自動標出哪些圖過期。
  支援 Qwen Image（ComfyUI）、codex 內建生圖、OpenAI Images API（GPT Image 2）和自定義命令，主圖與派生圖可以使用不同模型。
  產出 asset.json + 一組 PNG + 雙擊就能開的報告。零依賴。
  只要提示詞、不生圖的話使用 novel-characters。
  Use when asked to 出角色圖、做角色參考圖、給我的角色生圖、定妝照、真出三檢視、character reference images。
allowed-tools:
  - Read
  - Write
  - Bash
metadata:
  version: 2.1.0
  triggers:
    - character-refs
    - 角色參考圖
    - 角色圖
    - 出角色圖
    - 建立角色
    - 定妝照
    - 三檢視
    - character reference images
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
  runtimes:
    - claude-code
    - codex
---

## character-refs

輸入一段角色描述，輸出一組角色參考圖——**角色從哪來都行**：小說改編、自己編的故事、臨時想到的一個人。**一張正面全身錨點，其餘每張都只參考這張錨點**。
給影片模型（H3 / Wan / Seedance）當參考圖使用，也給人看。

`{baseDir}` = 本檔案所在目錄。腳本 `{baseDir}/scripts/character-refs.mjs`，零依賴，`node` 直接跑。

**這是儲存庫裡唯一真生圖的 skill。**其餘 skill 只交提示詞，因為生圖那一刻才能決定模型和畫風；
這個 skill 就是「那一刻」——模型在 Step 0 由使用者選定，畫風在建角色時選擇（預設動漫，另有寫實預設，也能掛自定義畫風）。

### 核心規則（先讀懂再動手）

- **一組圖只有一個根：正面全身錨點。**只有它是文生圖，其餘全是「錨點 + 一句改圖指令」。
  頭髮、臉、領口三類細節額外掛確認過的正臉大頭照。圖與圖之間不再互相參考——
  所以任何一張出壞了，單獨重出這一張就行，不會連鎖。
- **分檔，預設出到第二檔**：

  | 檔位 | 內容 | 什麼時候出 |
  | --- | --- | --- |
  | 1 | 正面全身（錨點） | 總是，第一張 |
  | 2（預設） | 正臉大頭照、90° 側面（面朝畫面右側）、背面 | 預設就出齊 |
  | 3 | 細節圖（最多 8 張）：使用者點名的、角色最能認出來的地方；沒有就用預設的頭髮 / 髮飾、領口、袖口、鞋 | 有配飾或服裝區域性的特寫 |
  | 4（預設不出） | 45° 大頭照（面朝畫面左側） | 使用者明確要 |

  H3 實測：只給正面全身，服裝和背影都對，但臉會走樣；**加一張大頭照，臉最接近**。所以預設出齊第二檔。
  只要錨點（比如先看看長相再說）：`gen <asset.json> --tier 1`。
- **模型不鎖定**：主圖與派生圖可以使用不同模型，重出單張也可以換模型。一致性來自「同一張錨點」，
  不來自「同一個模型」（實測 Qwen 錨點 + GPT 派生、GPT 錨點 + Qwen 派生、同組混用都銜接得上）。
  每張圖記錄自己的模型，同組混用只在報告裡提醒。
- **凍結的只有三樣**：錨點檔案（sha256）、畫風快照、文字描述指紋。任何一樣變了，
  依賴它的圖示成「過期」——**只標記，不刪除**，舊版本全部留著。

---

### Step 0 — 初次設定（每臺機器一次）

```bash
node {baseDir}/scripts/character-refs.mjs config --show
```

輸出末尾寫「還缺：……」就要問使用者這三件事，**一次問完**：

1. **主圖（錨點）使用哪個模型**：
   - `qwen` —— Qwen Image 2.1，走自己的 ComfyUI 伺服器。快（每張 25–45 秒）、尺寸精確、不吃訂閱額度。
     需要 `COMFY_URL`（可選 `COMFY_USER` / `COMFY_PASS`），放環境變數或一個 .env 檔案
   - `codex` —— codex 內建生圖（GPT）。不要 API key，但**吃 ChatGPT 訂閱額度**（Plus 約 25 張會觸頂，幾小時後恢復），每張 80–160 秒
   - `openai` —— OpenAI Images API，預設 `gpt-image-2`。按量計費，要 `OPENAI_API_KEY`；也能指到相容介面（`--openai-base-url`）
   - `custom:<名字>` —— 使用者自己的生圖命令，見 `references/models.md`
2. **派生圖使用哪個模型**：預設與主圖相同。可以分開（比如錨點 GPT、派生 Qwen）
3. **出完錨點要不要停下來等人確認**：推薦 `yes`——錨點是全組的根，它不對後面全白出。
   選 `no` 則自動放行，報告裡標「未經人工確認」；**沒過檢查門的錨點不會自動放行**，要人看過再 `confirm` 或重出

```bash
node {baseDir}/scripts/character-refs.mjs config --model qwen --confirm-anchor yes --qwen-env-file <.env 路徑>
# 分開設定：--anchor-model codex --derive-model qwen
```

配置寫在 `{baseDir}/config.local.json`（不進版本控制，重新安裝不會覆蓋）。以後預設一直使用它，
使用者說「換成 xx」就重新跑 `config`。**不要把 .env 裡的密碼或 key 列印出來**，`config --show` 已經打碼。

### Step 1 — 一次性輸入

使用者**一段話**描述角色就夠了，不要一項一項問。你（模型）來拆：

```bash
node {baseDir}/scripts/character-refs.mjs intake-template
```

照模板把描述拆進各欄位，寫到 `<工作目錄>/<角色名>-intake.json`。規則（詳見 `references/intake.md`）：

- `lang` 填使用者說話的語言（中文 `zh`、英文 `en`、日文 `ja` 內建）。確認表和報告都用這個語言；
  其他語言先執行 `ui-template <lang>`，把列印出的英文文案逐項翻譯，整塊放進 intake 的 `ui` 欄位
- 使用者說了的標 `stated`，你推出來的標 `inferred`，按慣例補的標 `default`——**如實標**，確認表靠它提醒使用者看哪幾項
- **年齡、性別、年代推不出來就問使用者**，只有這三樣不許自己編；其餘一律自己補，不要追問
- `en` 進提示詞：**永遠英文**、不寫角色名、不寫畫風詞；`text` 給人看，用 `lang` 的語言寫（舊輸入寫的 `zh` 照樣認）
- 服裝分 `top` / `bottom`——大頭照只用上裝，帶上下裝模型就會把鏡頭拉遠
- **細節圖按角色挑**：使用者點名的優先，沒點名挑最能認出這個角色的地方，預設四槽位兜底；臉上的特徵不出細節圖（大頭照已經看得清）。詳見 `references/intake.md`

```bash
node {baseDir}/scripts/character-refs.mjs intake-check <intake.json>
```

有問題按報錯改到通過。通過後它列印**確認表**，原樣給使用者看，推斷和預設的項帶標記。
**使用者確認（或改完再確認）之後才往下走。**

### Step 2 — 建資產

```bash
node {baseDir}/scripts/character-refs.mjs new <intake.json> --out <輸出目錄> [--look 畫風]
```

建出 `<輸出目錄>/<角色名>/asset.json`。畫風層此時整份快照進資產，之後改預設不影響已有角色。

**畫風**：使用者說了就按使用者說的選擇，沒說就是動漫。同一部劇的角色**全部使用同一個畫風**。

| 預設 | `--look` 認的名字 |
| --- | --- |
| 動漫（預設） | `動漫` `卡通` `anime` `cartoon` `二次元` `アニメ` |
| 寫實照片 | `寫實` `realistic` `photo` `真人` |

`looks` 列出全部預設。使用者要別的畫風（國風、美漫……）：`look-template <最接近的預設> > my-look.json`，改 `style`（介質、線條）、
`clean`（背景與光，**必須保留白底**）、`neg`（反向詞——換成畫出來的畫風要把 `anime` `illustration` 從反向詞裡拿掉），
畫出來的畫風把 `medium` 寫成 `drawn`，然後 `--look my-look.json`。自定義畫風沒有實測，先出錨點看效果。

已經建好的角色要換畫風：

```bash
node {baseDir}/scripts/character-refs.mjs restyle <asset.json> --look 動漫
```

換完所有已有的圖（連錨點）都標過期，舊圖保留，從錨點開始重出。

### Step 3 — 出預設的第二檔

```bash
node {baseDir}/scripts/character-refs.mjs gen <asset.json>
```

不給檢視和檔位，就是補齊第一、二檔裡還沒出的、已過期的圖。

配置了確認：這條命令**只出錨點就停下**。把圖給使用者看（報告或直接開啟 PNG），使用者說可以再

```bash
node {baseDir}/scripts/character-refs.mjs confirm <asset.json>
node {baseDir}/scripts/character-refs.mjs gen <asset.json>      # 同一條命令，接著出大頭照、側面、背面
```

不滿意就再跑一次 `gen <asset.json> front-full`（出 v2，可 `--seed` 換種子、`--model` 換模型），
或者回 Step 1 改描述。**錨點沒確認，派生圖會被拒。**配置為不確認時，一條命令出齊四張。

### Step 4 — 按需升檔

```bash
node {baseDir}/scripts/character-refs.mjs gen <asset.json> --tier 3 --reason "E03 有髮飾和領口特寫"
```

`--reason` 寫為什麼升檔，記進資產。也可以只出某幾張：`gen <asset.json> detail-hair detail-neck`。

### Step 5 — 檢查與重出

```bash
node {baseDir}/scripts/character-refs.mjs check <asset.json>
```

每張圖過程式碼門（尺寸 300–5760、寬高比 0.4–2.5、比例對得上、≤20MB、背景夠白），再看過期。
**有問題 exit 1。**門沒過或過期的，單獨重出那一張：

```bash
node {baseDir}/scripts/character-refs.mjs gen <asset.json> detail-neck --model codex
```

門裡「背景夠白」對全身圖查四邊，對大頭照只查上邊和兩側上半段（身體本來就頂到下邊），細節圖跳過並明說。
**門查不了長相、角度、取景**——出完一定要看圖，這幾項靠眼睛。

### Step 6 — 報告

```bash
node {baseDir}/scripts/character-refs.mjs render <asset.json>... --out <輸出目錄>/character-refs.html
```

多個角色可以一起出。語言預設取資產的 `lang`，臨時換加 `--lang en`；非內建語言沒帶 `ui` 時，用 `--ui <檔案>` 傳自譯文案，
缺文案會直接報錯，不出半中半英的報告。介面文案換語言，角色描述保持原文。
第一檔只有一張卡片；第二檔起是設定圖版面（左大頭照，右上正面 / 側面 / 背面，右下細節條），
**預設不顯示細節圖**，頁面上一鍵切換。過期的圖示紅框，頁面頂部有圖例說明，滑鼠移到紅框圖上能看到原因；混用模型會提醒。


### Step 7 — 彙報

一句話：出了哪幾張、使用的哪個模型、報告路徑。門沒過或過期的點名。**沒看過圖不要說「效果很好」。**

---

## 落地結構

```
<輸出目錄>/
├── character-refs.html          ← render 產出
└── <角色名>/
    ├── asset.json               ← 角色描述 + 每張圖的全部版本
    └── default/                 ← 造型（v1 只有 default 一套）
        ├── front-full.v1.png    ← 錨點
        ├── face-front.v1.png
        ├── face-front.v2.png    ← 重出不覆蓋
        └── detail-hair.v1.png …
```

每張 PNG 裡都寫著標識（`角色/造型/檢視/版本`）、模型、參考了哪幾張，圖被單獨拷走也查得到來歷。
`asset.json` 的結構見 `references/schema.md`。

## 邊界

- 實測過的畫風只有寫實和動漫兩種（都是 Qwen 跑四檔）；自定義畫風效果取決於寫法，先出錨點看
- 細節圖只收長在角色身上的（髮飾、領口、袖口、鞋）；道具歸 novel-art
- 已知短板：小疤痕容易畫成新傷、雙排扣這類大面積細節取景偏遠、Qwen 的領口細節會把粗布畫得像絲絨（換 codex 重出這一張）、Qwen 細節圖裡露出的皮膚會偏老（提示詞已加年齡句，16 歲樣例上有效，未大量驗證）
- `openai` 介面卡只使用本地假伺服器驗過請求格式，**沒有用真 key 跑過**；第一次使用時先出一張錨點看看
- 同一套提示詞在 Qwen 和 GPT 上都實測過；自定義模型的效果取決於那個模型

## 自測

```bash
node {baseDir}/scripts/selftest.mjs
```

234 項斷言，不調模型、不花額度：PNG 標識讀寫、檢查門、輸入校驗、多語言確認表與報告、畫風預設與換畫風、提示詞、過期傳導、生圖介面卡的請求格式（Qwen 與 GPT Image 使用本地假伺服器）、
以及使用自定義命令跑通的完整流程。改完腳本先跑這個。

## 自帶樣例

`{baseDir}/examples/阿禾-描述.txt` 是一段使用者式的一句話描述（1920 年代江南採茶姑娘），
`阿禾-intake.json` 是拆好的輸入，推斷和預設的欄位都標了。樣例圖不進版本控制，要看就使用自己的模型跑一遍。
