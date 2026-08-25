**中文** · [English](README.en.md)

# novel-storyboard

給 AI 短劇出**分鏡**：把 novel-script 的節拍流切成可以直接下單給影片模型的生成任務單。這是管線裡第一個直接面對影片模型的層，前提刻在骨子裡：**鏡頭是生成出來的，多切一刀的成本幾乎為零**，短劇觀眾的注意力節奏是 3 秒左右一切。所以結構是三層：

```
段（segment）＝ 一次影片生成呼叫，≤ 15 秒，不跨場次
 ├─ 分鏡（cut）× 3–5 ＝ 段內切鏡，每切 2–5 秒（硬門），各自認領劇本節拍
 ├─ 分鏡圖 ＝ 每切一張關鍵幀（<段號>/f1..fN.png）：主圖釘 0.00 秒，子圖釘各自切點
 └─ H3 提示詞 ＝ 一段一條，多圖對齊指令 + [Shot k] 切點時刻逐字對賬
```

- **兩人對話的正反打在一段裡一次生成**——全景、A 近景、B 近景各是一個 2–5 秒的分鏡，每格構圖由自己的分鏡圖控制，不靠文字賭
- **對齊指令是推匯出來的，不是寫出來的** — 多圖對齊句式（`Picture 2 aligns with the 3.00-second mark…`）和 `[Shot k] At 00:0X.XXX` 切點時刻全部由分鏡秒數推導，validate **逐字對賬**：改了秒數忘改提示詞，當場攔
- **提示詞按官方口徑預設英文、逐鏡換行** — 每個鏡頭獨立一行、切點時刻開頭；臺詞/歌詞/畫面文字按官方規定保留原文（`<d>[Chinese] …</d>` 逐字）。`promptLang: 'zh'` 可切整條中文（對齊指令、欄位名、鏡頭標記都有中文版）。寫法規範已內化為 `references/h3-prompt.md`——**本 skill 自包含，不依賴任何外部 skill**
- **分鏡圖是資產合成，不是憑空畫** — 生圖掛場景/角色/道具設定圖當參考圖，novel-art 和 novel-characters 的圖在這一步真正被消費。有 codex 就真生圖（可選）

產出 `storyboard.json` + Markdown + 一個雙擊就能開的 `storyboard-report.html`：

![storyboard-report.html](assets/report.webp)

## 品質門：17 道，全是程式碼

與儲存庫裡另外四個 skill 同一主張：**checklist 交給模型自覺是靠不住的**。

| 門 | 規則 |
| --- | --- |
| **節拍全覆蓋** | 劇本每個節拍被恰好一個分鏡認領、按順序、連續、不跨場 |
| 段時長 | 0 < Σ分鏡 ≤ 15 秒（一次生成的上限，`params.maxSegmentSeconds` 按模型改） |
| **分鏡時長** | 每切 2–5 秒——3 秒左右的短劇節奏是**硬門**不是建議 |
| 臺詞裝得下 | 認領節拍的臺詞秒數 ≤ 分鏡秒數，逐切檢查 |
| 每集總時長 | Σ段 落在劇本 `targetSeconds` ±15% 內 |
| 同框上限 | 單個分鏡 ≤ 3 人，超了必須帶拆解說明 |
| 段號紀律 | `E01-01` 格式、按順序連號——段號就是素材檔名 |
| 景別短語 | `close-up` 這類英文短語必須出現在分鏡圖提示詞裡 |
| 運鏡詞表 | 運鏡直接用 H3 官方詞表（`Push In` / `Pan Left` / `Tracking Shot`…），且必須出現在**自己的 [Shot k] 段落**裡 |
| **H3 結構** | 首行對齊指令**由分鏡結構按語言推導、逐字對賬**；三欄位按序；每個 `[Shot k]` 的切點時刻等於前面分鏡秒數的累計 |
| **H3 臺詞逐字** | 認領的每句臺詞逐字出現在 `<d>` 塊裡，改一個標點都過不去 |
| **提示詞語言一致** | 正文語言與 `promptLang` 雙向對賬：設定中文寫成英文、設定英文混進中文，都攔 |
| **風格短語統一** | `style` 預設（realistic / ghibli，與角色/場景 skill 同名對齊）的英文短語必須出現在每條分鏡圖提示詞裡——同劇不許畫風漂 |
| 分鏡圖提示詞衛生 | 全英文非空 |
| 提示詞不含角色名 | 分鏡圖提示詞恆查；H3 提示詞僅英文模式查（中文放行，身份靠分鏡圖錨定）。給 `--outline` / `--cast` 才查，不給**明說跳過** |
| 引用對賬 | 場次/人物/道具全部對賬劇本該場 |
| **鏡頭配方**（可選掛載） | 給了 `--shots <卡片目錄>` 才查：cut 的 `recipe` id 在卡庫裡、卡片的每條必備短語出現在該切的分鏡圖提示詞裡、多格配方的連排格數夠。不給 `--shots` **明說跳過**；給了但全篇沒引用配方也明說 |

自測裡每道門都有**擊穿用例**——證明它真的會攔。

**鏡頭配方是可選掛載的語彙層**：cut 上可以寫一個可選的 `recipe`（外部可選卡庫中的卡片 id，**cut 級不是 segment 級**，**多格配方靠連續同 id 的分鏡表達**，不是陣列）。沒裝外部卡庫照跑不誤——本 skill 自包含，連解析卡片 frontmatter 的那 25 行都是自己寫的，不跨目錄 import。卡片的**建議景別與運鏡刻意不設門**，只在報告的「配方」列加 `≠` 標記（懸停看建議值）、`checkup` 末尾出一段提示：配方是語彙不是法條，可選掛載的東西一旦變嚴就沒人掛了，**誤攔的門比沒有門更糟**。

## 門失敗會累積，`stats` 告訴你模型最常違反哪條規則

`validate` 與 `checkup` 每次都把門的結果追加到**當前目錄**的 `.gates.jsonl`。積累幾十次之後：

```bash
node scripts/novel-storyboard.mjs stats
```

它回答三個問題：

| 問題 | 說明什麼 |
| --- | --- |
| **哪道門最常響** | 那條規則模型最常無視——**該改的是規則的措辭，不是再罵一遍模型** |
| **哪道門從沒響過** | 可能是死門，也可能規則已經被模型內化了 |
| **失敗詳情長什麼樣** | 反覆出現卻沒有對應門的那類問題，只能靠人看這些自由文字發現 |

這是從 SkillOpt「skill 文件是可訓練狀態」那套思路里拿的一條：**文件不是一次寫好的說明書，是要按反饋迭代的東西**——但迭代要有依據，而不是靠印象。日誌只累積證據，改不改、怎麼改仍然是人的判斷。

不想記就加 `--no-log`；寫不進去會靜默跳過，不影響校驗本身。`.gates.jsonl` 已在 `.gitignore` 裡。

## 報告長什麼樣

業內評審用的單頁報告，頁寬 1600：

- **KPI 帶**：生成段數 / 分鏡數與平均秒數 / 總時長 vs 目標 / 生成批次數 / 臺詞段數
- **分鏡節奏帶**（招牌圖）：每集一行色帶，**粗分隔 = 段邊界（一次生成）**，片寬 = 分鏡時長佔比、顏色深淺 = 景別遠近——深淺相間、長短相間就是好節奏；點一片跳到那張段卡
- **分集分鏡表**：每段一張卡——**主分鏡圖** 16:9（缺圖顯示提示詞佔位，**不裝有**）、**子分鏡條**縮略格、下方**五五分欄**：左列逐切分鏡行（起點秒 · 秒數 · 景別 · 運鏡 · 配方 · 畫面摘要**從劇本認領的節拍自動帶出**），右列 H3 提示詞面板——逐鏡換行直接可讀，一鍵複製
- **生成批次單**：同場景 + 同光照的段歸一批，共用同一張環境參考圖——批次卡嵌場景設定圖，列出需要的角色設定圖和道具
- **配音對齊單**：每句臺詞對到**段號#切序**——TTS 音訊貼到哪一段的第幾切，全自動
- **品質門**面板 + 頁首徽章 + **匯出 JSON**（下載的就是 `storyboard.json` 原樣）
- 全部圖形內聯 CSS/SVG，零外部依賴，離線雙擊能開
- 報告介面預設中文，`render --lang en` 輸出全英文介面（內建 zh / en 兩套）——只切介面標籤，與 `promptLang`（H3 提示詞語言，預設英文）互相獨立。英文介面下品質門標籤同樣翻譯（閾值原樣），門的失敗詳情與資料內容保持原文

## 五個 skill 的接力（管線到此閉環）

```
novel-outline    → outline.json    （什麼：結構與分集）
novel-characters → cast.json       （誰：角色設定圖）
novel-art        → art.json        （哪裡：場景/道具設定圖）
novel-script     → script.json     （戲：場次、節拍、臺詞）
novel-storyboard → storyboard.json （怎麼拍：段、分鏡、分鏡圖、H3 提示詞）
```

- `seed <script.json> --eps 1-3` 確定性展開每場的節拍清單（編號、每拍秒數、說話人）當切鏡底稿——**每拍幾秒是算出來的，不讓模型重新估**
- `validate --script` 是硬前提（分鏡離開劇本沒有意義）；`--outline` / `--cast` 查提示詞人名，`--art` 讓報告顯示場景名並在批次單嵌設定圖
- 分鏡圖生圖走 codex `$imagegen`，場景/角色/道具設定圖當 `-i` 參考圖；H3 提示詞 + 整套分鏡圖直接下單給 MiniMax H3

## 命令列直接用

```bash
node scripts/novel-storyboard.mjs seed script.json --eps 1     # 切鏡底稿
node scripts/novel-storyboard.mjs validate sb.json \
     --script script.json --outline outline.json --cast cast.json
node scripts/novel-storyboard.mjs checkup sb.json --script script.json
node scripts/novel-storyboard.mjs validate sb.json --script script.json \
     --shots /path/to/cards                                              # 可選：開第 17 道配方門
node scripts/novel-storyboard.mjs render sb.json --html \
     --script script.json --outline outline.json --art art.json > storyboard-report.html
node scripts/novel-storyboard.mjs render sb.json --html --lang en \
     --script script.json --outline outline.json --art art.json > storyboard-report.html   # 英文介面報告
node scripts/novel-storyboard.mjs export sb.json --script script.json   # H3 投產包
```

`export` 的投產結構固定：**每段一個資料夾** `E01-01/`——分鏡圖 `f1..fN.png` 和 `prompt.md` 同住（頭部 Picture ↔ 檔案對照表**明確 f1.png 是首幀**、各圖釘在第幾秒，分隔線以下是 h3Prompt 原樣），根部 `manifest.json` 帶 Picture 序圖清單、切點時刻表、缺圖示註。一個段資料夾 = 一次 H3 生成的全部材料。

## 邊界

- 不寫戲不改臺詞、不出設定圖、不做影片生成與剪輯合成
- 口型/唇形同步暫不管——那是生成管線的事
- 秒數是**下給影片模型的生成時長**不是估算；段上限、分鏡節奏區間都在 `params` 裡按模型調
- 報告介面內建中英（`--lang`，預設中文）；提示詞語言由 `promptLang` 單獨控制（預設英文）
- 分鏡圖預設先出第一段的整套（3–5 張）看效果，確認畫風和構圖再往後補——一集約 30–40 格，方向錯了整批重來

## 檔案

```
SKILL.md                 給 agent 讀的工作流
scripts/
  novel-storyboard.mjs   seed / validate / checkup / render / export / slug
  selftest.mjs           254 項斷言，不調模型
references/
  schema.md              storyboard.json 結構 + 時長約束鏈
  h3-prompt.md           H3 提示詞寫法規範（官方方法論內化版）
  storyboard-pass.md     切鏡：分段規則、導演運鏡手感、常見病
  frame.md               分鏡圖生圖的 codex 呼叫契約
  report-style.md        報告的設計約定
examples/
  渡口-storyboard.json    《渡口》第 1 集完整分鏡（10 段 34 切認領 35 拍），全部品質門通過，也是自測夾具
assets/
  report.webp            報告截圖
```

## 自測

```bash
node scripts/selftest.mjs
```

254 項斷言，覆蓋節拍展開 / H3 骨架推導 / 統計與批次 / 品質門逐項擊穿 / 配方卡庫解析與掛載 / seed / 渲染（含中英介面）/ 匯出。不調模型、不花額度、1 秒跑完。改完腳本先跑這個。

**只在 macOS + Node 24 上實測過。** 程式碼沒有平臺相關呼叫，Linux 和更低版本 Node 理論上沒問題，但**沒驗過**。
