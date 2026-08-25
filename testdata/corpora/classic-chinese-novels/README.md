# 中國古典小說測試語料

這個目錄收錄五部中國古典小說的 UTF-8 純文字版本，用於 `novel-characters` 與 `novel-outline` 的本機整合、壓力及邊界測試。檔案取自 `classic_chinese_novels_text_only_2026-08-09`，僅保留已正規化的完整本文，未加入同一來源中的逐回、JSONL 或原始下載副本。

本目錄只放測試輸入；經驗收的 skill 產物另放在 [`testdata/benchmarks/`](../../benchmarks/)，尚未執行的規劃則放在 [`docs/plans/`](../../../docs/plans/)。

## 檔案清單

| 檔案 | 作者（傳統題署） | Project Gutenberg | 章回 | 位元組 | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| `三國演義.txt` | 羅貫中 | [#23950](https://www.gutenberg.org/ebooks/23950) | 120 | 1,822,634 | `2489944eb39bc9491d7e63f52240701df260927ccc8412c90099ff5243fd1fe7` |
| `水滸傳.txt` | 施耐庵 | [#23863](https://www.gutenberg.org/ebooks/23863) | 楔子＋70 | 1,595,341 | `de19d122eeac06d6b2381c048dfc6c503516e4a79a8aec2f88211a469ddfb7d9` |
| `西遊記.txt` | 吳承恩 | [#23962](https://www.gutenberg.org/ebooks/23962) | 100 | 2,217,065 | `f6c1b88adcda0f76fcc21c8612214a87f40c45f922e5d50fdb19fd9c96890310` |
| `金瓶梅.txt` | 蘭陵笑笑生 | [#52200](https://www.gutenberg.org/ebooks/52200) | 100 | 2,270,362 | `929fddeaabc472b30e2b1ce64d1df224d0c799435ffbeb11a3073d821f9d733d` |
| `紅樓夢.txt` | 曹雪芹、高鶚 | [#24264](https://www.gutenberg.org/ebooks/24264) | 120 | 2,615,302 | `efbdcbfda9a0e225c049765ea379d62ec238670659bc3b93b94c33a6934b1b9d` |

正規化內容為 UTF-8、LF 換行，並移除 Project Gutenberg 的外框文字；未進行簡繁轉換、標點現代化或 AI 改寫。

## 已知問題

`紅樓夢.txt` 的**第 55 回後半被第 120 回的內容取代**。第 13785 行探春向平兒說「我有一件大事」的話說到一半就斷了，接著（第 13786–13837 行，約 1,500 字）整段變成全書結局：王夫人與薛姨媽議襲人歸宿、賈政回家、皇上賞寶玉「文妙真人」道號、巧姐許給周家、襲人配蔣家。第 56 回標題緊接在後。

後果有兩層：**第 55 回後半的內容在這份檔案裡是遺失的**，而那段結局內容在第 120 回的正確位置（第 28200 行附近）還有完整的一份，等於重複。掃過五部語料，只有這一處有這種問題。

檔案維持原樣沒有修補——上表的 SHA-256 與 Project Gutenberg 來源是可追溯性的依據，改了就對不上。拿這份檔案做整書分析時（分卷、切塊、抽爽點），要留意這一段會同時造成劇透與時序錯亂；`testdata/benchmarks/novel-outline/` 的紅樓夢大綱基準已明確排除它。

## 使用方式

以下範例會把中間產物寫到你指定的工作目錄；不要把產生的工作目錄或報告寫回 corpus 目錄。

```bash
node skills/novel-outline/scripts/novel-outline.mjs chunk "testdata/corpora/classic-chinese-novels/紅樓夢.txt" <工作目錄>
node skills/novel-characters/scripts/novel-characters.mjs chunk "testdata/corpora/classic-chinese-novels/紅樓夢.txt" <工作目錄>
```

`novel-characters` 的單次分析上限為 24 個分塊（約 33 萬字元），直接輸入完整長篇時預期會顯示 `truncated: true`；這可用來測試截斷保護，也可以先切分小說再逐段分析。`novel-outline` 則可依章回分卷處理完整長篇。

## 授權與來源提醒

這些文學原著屬公版作品，但文字檔來源仍受 Project Gutenberg 的使用條款及使用者所在地法律規範。它們是獨立測試資料，不因放入本 repo 而自動改以根目錄的 Apache 2.0 授權釋出；重新散布或商用前，請自行確認適用條款。
