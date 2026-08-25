# 紅樓夢 60 集短劇大綱基準 · 完成記錄

把古典小說品質基準從 `novel-characters` 延伸到 `novel-outline` 的第一件工作。60 集分集梗概、完整校驗、報告渲染與 benchmark 落地均已完成；這份文件保留參數、決策與分批覆蓋記錄，供後續更新時重驗。

正式產物：[`testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/`](../../../../testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/)（`紅樓夢-60集短劇-outline.json`／`紅樓夢-60集短劇-outline.md`）。HTML 報告已現場重新產生並人工檢查；依 repository 規範不進版本控制。

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
- **Step 5 分集梗概**：6 批 × 10 集完成後合併為 1–60 連號；24 位角色、13 個場景與 8 件道具都有分集引用，沒有失業角色、空轉場景或零集道具。
- **Step 6 完整校驗**：帶入《紅樓夢》原文後，14 道品質門與 6 條 `keep.evidence` 逐字比對全部通過。
- **Step 7 輸出與人工檢查**：Markdown 報告已版本化；HTML 報告的 KPI 帶、爽點時間軸、分集卡與場景概覽均無溢位或錯位，品質門顯示 14／14。
- **基準落地**：正式 JSON／Markdown 與驗收說明已放進 `testdata/benchmarks/novel-outline/classic-chinese-novels/`，並更新 `testdata/README.md` 的目錄分工。
- **使用者拍板**（SKILL.md Step 3 的三件事，全部照方案）：
  1. 砍神話框架、官場線、大量詩詞與各支線，終點停在雪地一拜，不用原著後四十回的復官復產。
  2. 主角組四人：黛玉、寶玉、寶釵、鳳姐。
  3. 大爆點落點：掉包計 45 → 揭蓋頭同時黛玉氣絕 47 → 抄家 52 → 托孤 56 → 救巧姐 58 → 出家 60。

## 完成結果

- 60 集 × 2 分鐘，總長 120 分鐘。
- 25 個爽點中 11 個為 major，最大間隔 3 集。
- 第 47 集以揭蓋頭與黛玉焚稿氣絕交叉剪接形成全劇最大爆點；第 52–60 集依序收束抄家、散盡、托孤、善報與出家。
- 生成難點共標註 101 處，群戲、手部特寫、肢體接觸、雪景、火戲與幼童等都已進預警清單。

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

## 更新與重驗

後續若修改骨架或分集，先更新正式 JSON，再以完整原文重跑校驗：

```bash
node skills/novel-outline/scripts/novel-outline.mjs validate \
  "testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/紅樓夢-60集短劇-outline.json" \
  "testdata/corpora/classic-chinese-novels/紅樓夢.txt"
```

Markdown 與 HTML 都由正式 JSON 重新渲染；渲染時加 `--lang zh` 選用本 fork 的台灣正體介面。HTML 只供人工驗收，不提交。

## 兩件必須留意的事

- **語料缺陷**：`紅樓夢.txt` 第 55 回後半被第 120 回內容取代（第 13786–13837 行），詳見 [`testdata/corpora/classic-chinese-novels/README.md`](../../../../testdata/corpora/classic-chinese-novels/README.md) 的「已知問題」。骨架的 `adaptation.risks` 已寫入對策：該段不採用。
- **`volume-summaries/` 是中間產物**，不是交付物，也不是品質基準。留著只是因為重建它要跑九個子代理讀 260 萬字元。裡面的 `evidence` 是原文逐字引文（字形跟著語料走），第 9 卷那份是子代理用簡體寫的，接手時**只讀取、不要拿它的文字直接填進 outline.json**。用詞檢查腳本對這個目錄整份跳過。
