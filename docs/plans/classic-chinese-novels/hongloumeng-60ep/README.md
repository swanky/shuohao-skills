# 紅樓夢 60 集短劇大綱基準 · 待辦

把古典小說品質基準從 `novel-characters` 延伸到 `novel-outline` 的第一件工作。**做到一半，Step 5 之前停下來的**，這份文件記錄已經完成什麼、接下來從哪裡接手。

目標產物：`testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/`（`-outline.json`／`-outline.md`／`outline-report.html`）。

## 參數（已定案，使用者拍板過）

| 項目 | 值 |
| --- | --- |
| 原著 | `testdata/corpora/classic-chinese-novels/紅樓夢.txt` |
| 集數 × 時長 | 60 集 × 2 分鐘 |
| 題材 | 古裝宅門虐戀 |
| 改編幅度 | 抽核 |
| 介面語言 | `zh-TW` |

選紅樓不選三國，是因為下游 `novel-characters` 已有紅樓角色基準（16 位），主角組四人正好與那份基準的四位 `protagonist` 對齊，上下游可以互相驗證。

## 已完成

- **Step 2 分卷摘要**：9 卷（123 回、90 萬字，未截斷），存在 [`volume-summaries/`](volume-summaries/)。九份共 **256 條 `evidence` 全部逐字對得上原文**。
- **Step 3 骨架四塊**：[`outline-skeleton.json`](outline-skeleton.json)，24 個角色（4 lead／10 support／10 functional）、13 個場景（10 主場景）、8 件敘事道具、25 個爽點（11 個 major）。**已通過 `validate --stage beats`，6 條 `keep.evidence` 也通過原文比對。**
- **使用者拍板**（SKILL.md Step 3 的三件事，全部照方案）：
  1. 砍神話框架、官場線、大量詩詞與各支線，終點停在雪地一拜，不用原著後四十回的復官復產。
  2. 主角組四人：黛玉、寶玉、寶釵、鳳姐。
  3. 大爆點落點：掉包計 45 → 揭蓋頭同時黛玉氣絕 47 → 抄家 52 → 托孤 56 → 救巧姐 58 → 出家 60。

## 待辦

1. **Step 5 分集梗概**（最大的一塊）：6 批 × 10 集，每批一個子代理，讀 `skills/novel-outline/references/episode-pass.md` 與 `outline-skeleton.json`，產出 `eps-01.json` … `eps-06.json`。
   - 每批要指派「這批必須用到的角色／場景／道具 id」，否則合併後 `refs` 門會抓到失業角色、空轉場景、零集道具。分配方式見下表。
   - 硬規則：三欄必填、敘述體不得出現引號對白、`characterIds` ≥ 3 要寫 `crowdPlan`、生成難點進 `warnings`。
2. **合併**：依 `ep` 排序拼進 `episodes`，順便查 1–60 連號無缺無重。
3. **Step 6 校驗**：`validate <outline.json> testdata/corpora/classic-chinese-novels/紅樓夢.txt`（帶原文，14 道品質門 + `evidence` 比對），違規逐條修到全過。
4. **Step 7 輸出**：`render --md` 與 `render --html`，人工看過報告版面。
5. **落地**：產物放進 `testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/`，比照 `testdata/benchmarks/novel-characters/` 的 README 寫法補一份說明，並更新 `testdata/README.md` 的目錄分工。

### 各批要覆蓋的 id

| 批次 | 集數 | 該批的爽點 | 必須用到的角色 | 場景 | 道具 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1–10 | B01 初見摔玉、B02 金玉成對、B03 元春封妃、B04 省親 | C01 C02 C03 C04 C05 C06 C09 C15 C16 C20 | S01 S02 S04 S05 S07 S09 | P01 P02 |
| 2 | 11–20 | B05 你放心、B06 晴雯被攆、B07 寶玉挨打、B08 襲人進言 | C07 C08 C14 C18 | S03 S06 | P04 |
| 3 | 21–30 | B09 劉姥姥二進、B10 尤二姐之死、B11 拾繡春囊 | C11 C12 C13 C19 C22 | S08 | P08 P03 |
| 4 | 31–40 | B12 抄檢打臉、B13 晴雯之死、B14 迎春死訊、B15 賈母定寶釵 | C10 C21 | — | P03 P05 |
| 5 | 41–50 | B16 失玉、B17 元妃薨、B18 掉包計、B19 揭蓋頭與焚稿、B20 探春遠嫁 | C17 C20 | S11 | P01 P02 P06 P04 |
| 6 | 51–60 | B21 抄家、B22 賈母散財、B23 托孤、B24 救巧姐、B25 出家 | C24 C17 C23 C22 C18 C11 C13 C07 | S10 S12 S13 | P07 P08 |

被砍掉的人物（尤二姐、迎春、鴛鴦、王仁）不在人物表裡，戲要寫但只能用轉述，`characterIds` 不得填未登記的 id。

## 接手方式

Claude Code 與 codex 都能接（codex 從根目錄 `AGENTS.md` 進入，再讀 `CLAUDE.md`）。從上面的待辦第 1 項開始，做完第 5 項之後 **commit 並 push**，提交訊息用台灣正體。

一次不必做完六批——每批梗概寫完就能合併、跑一次 `validate`，過了再寫下一批。骨架已經拍板，不要回頭改骨架，除非品質門逼你改。

## 兩件必須留意的事

- **語料缺陷**：`紅樓夢.txt` 第 55 回後半被第 120 回內容取代（第 13786–13837 行），詳見 [`testdata/corpora/classic-chinese-novels/README.md`](../../../../testdata/corpora/classic-chinese-novels/README.md) 的「已知問題」。骨架的 `adaptation.risks` 已寫入對策：該段不採用。
- **`volume-summaries/` 是中間產物**，不是交付物，也不是品質基準。留著只是因為重建它要跑九個子代理讀 260 萬字元。裡面的 `evidence` 是原文逐字引文（字形跟著語料走），第 9 卷那份是子代理用簡體寫的，接手時**只讀取、不要拿它的文字直接填進 outline.json**。用詞檢查腳本對這個目錄整份跳過。
