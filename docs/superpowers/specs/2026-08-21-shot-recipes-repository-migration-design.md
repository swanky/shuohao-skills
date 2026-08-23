# `shot-recipes` 儲存庫遷移設計

## 目標

把 `shot-recipes` 從 `shuohao-skills` 遷移到新的短影片製作 skills 儲存庫
`shuohao-video-skills`。新儲存庫先保持私有，作為後續分鏡、剪輯、聲音、字幕、提示詞和釋出等
短影片周邊 skills 的容器。

遷移完成後，`shot-recipes` 只有一個權威副本；兩個儲存庫都可以獨立安裝、測試和維護。

## 儲存庫與目錄

本地新儲存庫：

```text
/Users/wesley/workspace/shuohao-video-skills/
├── README.md
├── README.en.md
├── CHANGELOG.md
├── LICENSE
├── NOTICE
├── .gitignore
└── skills/
    └── shot-recipes/
```

GitHub 新儲存庫：`eternityspring/shuohao-video-skills`，可見性為 private。

保留 `skills/shot-recipes/` 這一層，而不是把 skill 直接放在儲存庫根目錄，以便以後在同一儲存庫增加
其他短影片製作 skill。

## 遷移範圍

遷入新儲存庫的是當前工作區中 `skills/shot-recipes/` 的完整快照，包括：

- 已跟蹤的卡片、腳本、文件、資源和範例；
- 當前尚未提交的 1.1.0 更新；
- 新增的複合運鏡、機位載體和速度斜坡卡片及其中英版本；
- 《查無此人》JSON、Markdown 和 `examples/film/` 素材；
- 當前對 CLI、自測和 `dolly-zoom` 卡片的修改。

新儲存庫的 `CHANGELOG.md` 收錄 `shot-recipes` 自己的歷史條目，不收錄小說流水線和其他 skill
的變更。許可證沿用當前儲存庫的 Apache-2.0 `LICENSE` 與 `NOTICE`。

根目錄的 `分段說明.md` 不屬於 skill，不遷移也不提交。

## 歷史策略

採用乾淨快照遷移，不搬運舊儲存庫的 Git 歷史。原因是 `shot-recipes` 在舊儲存庫只有一個已提交的
引入提交，而當前主要更新尚未提交。新儲存庫以當前完整、經過驗證的 1.1.0 狀態作為首個正式版本，
比重寫歷史更清楚。

## 舊儲存庫清理

遷入並驗證成功後，從 `shuohao-skills` 刪除 `skills/shot-recipes/`，並同步清理：

- 根目錄中把 `shot-recipes` 當作內建 skill 展示的中英文 README 行與圖片；
- 根 `.gitignore` 中只服務於該目錄的規則；
- 當前未提交 `CHANGELOG.md` 中屬於 `shot-recipes` 1.1.0 的段落，該段落遷入新儲存庫；
- `novel-storyboard` 文件中指向原相鄰目錄的內部連結與範例路徑。

`novel-storyboard` 的 `--shots` 介面繼續接受任意卡片目錄，因此功能介面不變。它的自測不再讀取
被移走的真實 skill，而是增加一個最小卡片 fixture 來覆蓋解析、必備短語檢查和錯誤資訊，保證舊儲存庫
不依賴新儲存庫也能完整自測。

舊儲存庫中《查無此人》涉及其他小說 skills 的 changelog 內容以及其他未提交檔案保持原樣，不納入
本次遷移提交。

## 提交與 GitHub 流程

兩個儲存庫都在 `codex/` 字首的遷移分支上工作，並只暫存明確屬於本次遷移的路徑。

新儲存庫：

1. 建立私有 GitHub 儲存庫並初始化預設分支；
2. 在 `codex/import-shot-recipes` 分支提交完整的新儲存庫結構；
3. 推送該分支並建立 draft PR，便於審閱後合併。

舊儲存庫：

1. 使用當前 `codex/migrate-shot-recipes` 分支；
2. 提交 skill 刪除、README 清理和 `novel-storyboard` 解耦；
3. 推送分支並建立 draft PR，不混入 `分段說明.md` 或其他小說 skill 改動。

## 驗證

新儲存庫至少執行：

```bash
node skills/shot-recipes/scripts/selftest.mjs
node skills/shot-recipes/scripts/shot-recipes.mjs lint
node skills/shot-recipes/scripts/shot-recipes.mjs check skills/shot-recipes/examples/vocab-reel.json
node skills/shot-recipes/scripts/shot-recipes.mjs check skills/shot-recipes/examples/no-such-person.json
```

舊儲存庫至少執行：

```bash
node skills/novel-storyboard/scripts/selftest.mjs
rg 'skills/shot-recipes|\.\./shot-recipes' README.md README.en.md skills
```

最後確認：

- 新 GitHub 儲存庫確實為 private；
- 新儲存庫工作樹幹淨，遷移分支已推送；
- 舊儲存庫遷移提交不包含使用者的無關改動；
- 兩個 draft PR 都能清楚展示遷入與遷出的邊界。

## 失敗與恢復

在新儲存庫全部測試透過併成功推送前，不提交舊儲存庫的刪除。遷移期間舊儲存庫原始內容仍在 Git 歷史中，
即使檔案移動或驗證失敗，也能從 `main` 恢復；使用者現有未提交內容不透過 stash、reset 或 checkout
改寫。
