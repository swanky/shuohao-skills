# 中國古典小說短劇大綱品質基準

這個目錄保存 `novel-outline` 經完整原文校驗與人工檢查後刻意版本化的中國古典小說產物。它不是一般執行輸出目錄。

## 現有基準

- [`紅樓夢-60集短劇/`](紅樓夢-60集短劇/)：60 集 × 2 分鐘的古裝宅門虐戀改編，共 24 位角色、13 個場景、8 件敘事道具與 25 個爽點；主角組為黛玉、寶玉、寶釵與鳳姐。

版本控制只保存 `outline.json` 與 Markdown 報告。HTML 報告是可重建的渲染產物，人工檢查時現場產生，不提交進 repository。

## 更新與驗收

更新大綱時，必須以 [`testdata/corpora/classic-chinese-novels/紅樓夢.txt`](../../../corpora/classic-chinese-novels/紅樓夢.txt) 執行完整校驗，確認 14 道品質門與 `adaptation.keep[].evidence` 原文比對全部通過：

```bash
node skills/novel-outline/scripts/novel-outline.mjs validate \
  "testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/紅樓夢-60集短劇-outline.json" \
  "testdata/corpora/classic-chinese-novels/紅樓夢.txt"
```

Markdown 與 HTML 報告都由同一份 JSON 產生；這份基準的資料語言為 `zh-TW`，渲染器目前以 `--lang zh` 選用台灣正體中文介面：

```bash
node skills/novel-outline/scripts/novel-outline.mjs render \
  "testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/紅樓夢-60集短劇-outline.json" \
  --md --lang zh > 紅樓夢-60集短劇-outline.md

node skills/novel-outline/scripts/novel-outline.mjs render \
  "testdata/benchmarks/novel-outline/classic-chinese-novels/紅樓夢-60集短劇/紅樓夢-60集短劇-outline.json" \
  --html --lang zh > outline-report.html
```

HTML 報告需人工查看爽點時間軸、分集卡與場景矩陣有無溢位或錯位；看完即可刪除。分卷摘要、分批 JSON 與其他中間檔不放進本目錄。
