# upstream-sync

把上游（簡體）的新提交合併進這個台灣正體 fork，並把上游新增的內容整份轉成台灣正體與台灣用詞。

這是維運型 skill，不產出短劇資產。它服務的是同一件反覆發生的事：上游改了什麼、合併進來、字換掉、確認沒有漏改。

## 用法

```
同步上游
```

skill 會依序做：比對落後幾筆 → 看上游改了什麼 → `git merge upstream/main` → 解衝突一律取正體 → 正體化 → 跑全套自測與用詞檢查 → 寫 CHANGELOG、提交、推送。

**上游沒有新提交就到此為止**，附上 `git rev-list --count` 的兩個數字當證據，不會為了有事做而去改別的東西。

## 用詞檢查

```bash
node scripts/check-zh-tw.mjs                          # 全部受版本控制的文字檔（含未追蹤的新檔案）
node scripts/check-zh-tw.mjs --since upstream/main    # 只掃與該 ref 有差異的檔案
node scripts/check-zh-tw.mjs --report                 # 列出全部命中，一律 exit 0
node scripts/check-zh-tw.mjs --json                   # 給其他腳本取用
node scripts/selftest.mjs                             # 96 項自測，不呼叫模型，約一秒
```

命中分兩級：`✗` 是漏改，必須修到零，會讓腳本 exit 1；`·` 是語境上偶爾成立的用詞，只提示，不影響結束碼。

**腳本只查得了「一定錯」的東西**：簡體專用字與定案用詞。一簡對多繁（發髮／乾幹／裡里／鬆松／醜丑／面麵／只隻／復複覆／係系繫／表錶／板闆）不進字表，那是語境判斷，交給人和模型——判斷依據在 [`references/terminology.md`](references/terminology.md)。

## 白名單與豁免

這個 repository 有幾處簡體與日文是功能本身，不是漏改，`ALLOWLIST` 會自動跳過：

- `novel-characters.mjs` 的 `STRINGS.zh` 語系表（`--lang zh` 的輸出）
- 同一支腳本的 `ja` 語系表（日文新字體與簡體字形重疊）
- `novel-characters/scripts/selftest.mjs` 裡驗證簡體語系的斷言
- `testdata/corpora/**`（原始語料）與 `testdata/benchmarks/**`（品質基準）整份跳過：原典什麼字形就是什麼字形，基準裡的逐字引文與別名跟著語料走

文件裡本來就要寫出反例的地方（用詞對照表的「別寫」那一欄）用標記豁免：

| 形式 | 寫法 |
| --- | --- |
| Markdown 整段 | `<!-- zh-tw-lint: off -->` … `<!-- zh-tw-lint: on -->` |
| 程式碼整段 | `// zh-tw-lint: off` … `// zh-tw-lint: on` |
| 只豁免一行 | 該行尾端寫 `zh-tw-lint: allow` |

## 檔案

```text
upstream-sync/
├── SKILL.md                    八步流程，給 agent 讀的
├── references/terminology.md   用詞對照、一簡對多繁、四處例外
└── scripts/
    ├── check-zh-tw.mjs         確定性用詞檢查，零依賴
    └── selftest.mjs            96 項自測，含反例
```
