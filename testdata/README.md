# 測試資料與品質基準

`testdata/` 只保存可重複使用的測試輸入，以及經過驗收、刻意納入版本控制的品質基準。一般執行產生的分塊、roster、單卡、工作目錄與臨時報告不放在這裡。

```text
testdata/
├── corpora/       原始或正規化後的測試輸入
└── benchmarks/    經校驗與人工檢查的版本化 skill 產物
```

## 目錄分工

- [`corpora/classic-chinese-novels/`](corpora/classic-chinese-novels/)：五部中國古典小說的正規化純文字、來源、雜湊與授權說明。
- [`benchmarks/novel-characters/classic-chinese-novels/`](benchmarks/novel-characters/classic-chinese-novels/)：`novel-characters` 的中國古典小說版本化品質基準。

尚未執行的工作規劃不屬於測試資料，統一放在 [`docs/plans/classic-chinese-novels/`](../docs/plans/classic-chinese-novels/)。

## 放置規則

- 可獨立作為 skill 輸入的原文或測試資料放進 `corpora/<資料集>/`。
- 經確定性校驗與人工檢查、需要長期追蹤品質差異的產物放進 `benchmarks/<skill>/<資料集>/`。
- 每個 benchmark 必須能指出對應 corpus，並記錄更新與驗收方式。
- 一般執行輸出寫到另行指定的工作目錄，不提交到 `testdata/`。
- 規劃、決策紀錄與尚未產生的目錄藍圖放進 `docs/`，不與測試資料混放。
