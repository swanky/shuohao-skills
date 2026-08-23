---
name: novel-art
version: 1.2.0
description: |
  給 AI 短劇出美術設定集（場景 + 敘事道具）：場景的設計意圖、一致性錨點、光照時段變體、
  空景提示詞；道具的戲劇功能、狀態變體、尺度參照、白底無手提示詞。
  產出 art.json + Markdown + 單頁評審報告（含匯出 JSON）。
  為 AI 生成而設計，不是實拍——環境和道具都是生成資產，交付的是讓它們跨集長一樣的一致性方案；
  11 道品質門全部由腳本確定性檢查（錨點 3–5、無人無手、白底可摳、尺度短語、提示詞英文……）。
  有 novel-outline 的 outline.json 就用 seed 預填場景清單與出現集；生圖走 codex 內建 $imagegen（可選）。
  零依賴、零 API key，用當前會話額度。
  Use when asked to 場景設定、出場景、環境設定集、場景一致性、scene bibles for AI short drama。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-art
  - 美術設定
  - 場景設定
  - 場景道具
  - 出場景
  - 道具設定
  - 環境設定
  - scene bible
  - prop sheet
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用標準庫，無 npm 依賴
    optional:
      - codex         # 有才出環境設定圖；沒有就只交提示詞，其餘照常
  runtimes:
    - claude-code
    - codex
---

## novel-art

給 AI 短劇出**美術設定集**：場景 + 敘事道具。**前提刻在骨子裡：這是 AI 生成，不是實拍**——沒有堪景搭景置景採買，環境和道具都是要被生成幾十次還得長一樣的資產，所以交付物全部圍繞一致性：

| 交付 | 解決什麼 |
| --- | --- |
| 一致性錨點（每景 3–5 個） | 觀眾靠它認場景，QC 靠它核對生成鏡頭有沒有漂 |
| 光照時段變體 | AI 換時段是重新生成不是重新打燈，每個狀態落成完整提示詞 |
| 空景生圖提示詞 | 環境和角色是兩層資產，參考圖裡混進人，一致性全毀 |
| 變體機制（variantOf） | 生成新景便宜，但變體複用母場景資產更一致 |
| 道具狀態變體 | 皮箱的合上與開啟是兩張參考圖——道具有狀態弧，場景沒有 |
| 道具尺度參照 | AI 經常把手持道具畫成傢俱尺寸，提示詞必須帶尺度短語 |
| 道具白底無手 | 道具圖要被貼進各種鏡頭，必須可摳；拿著道具的手是最常見汙染 |

`{baseDir}` = 本檔案所在目錄。腳本 `{baseDir}/scripts/novel-art.mjs`，零依賴，`node` 直接跑。

**邊界（不做的事）**：不做分鏡、不寫劇本、不管角色（`novel-characters` 的活）、不排大綱（`novel-outline` 的活）。**道具只收敘事道具**（有特寫、跨集、承載劇情的，通常 3–8 件）——場景陳設歸場景錨點，一次性手部道具鏡頭級提示詞解決，都不單獨建資產。

---

### Step 0 — 定輸入與畫風

三種輸入，優先順序從高到低：

1. **outline.json**（novel-outline 的產出）——最優，場景清單、出現集、承載爽點、複用方案都是現成的
2. 小說原文——自己歸納場景清單（主舞臺優先，參考 novel-outline 的主場景上限思路：別貪多）
3. 使用者手寫的場景清單

畫風：**預設 `realistic`**（半寫實厚塗），動畫質感用 `ghibli`。**跟角色 skill 保持同一檔**——角色是吉卜力、場景是半寫實，合成的時候沒法看。跑 `node {baseDir}/scripts/novel-art.mjs styles` 看預設全文，整塊取用不混搭。

有 cast.json（novel-characters 的產出）也帶上——校驗「提示詞不含角色名」要用。

### Step 1 — seed 骨架（有 outline.json 才有這步）

```bash
node {baseDir}/scripts/novel-art.mjs seed <outline.json> > <workdir>/art.json
```

確定性搬運：場景 id/名稱/主場景標記/出現集/承載爽點，帶複用方案的場景會有 `seedNote` 提示做成變體。**這些事實不要讓模型重新想一遍。**

沒有 outline.json 就自己按 `references/schema.md` 建清單。

### Step 2 — 逐場景填設定 + 提取敘事道具

每個場景一份，能併發就併發。每份任務拿到：

- `{baseDir}/references/scene-pass.md` 和 `{baseDir}/references/schema.md`（讀它們，照著做）
- 該場景的骨架 + 原文/大綱裡關於這個空間的全部資訊
- **同批其他場景的名字**（空間氣質要區分開，別都寫成同一種破舊）
- 畫風預設全文（`styles` 命令的輸出）

核心要求都在 scene-pass.md 裡，最重的三條：錨點要**可畫可認可核對**（「補丁船篷」是錨點，「陳舊的氛圍」是形容詞）；光照狀態**從分集反推**，不寫用不上的全家桶；**能做變體就別開新景**。

**敘事道具優先吃大綱**：`outline.json` 從 1.1.0 起帶 `props`，`seed` 會把道具表連同「承載什麼」「托起哪幾個爽點」「哪幾集出現」一起搬過來，這一層只填設計欄位（尺度、錨點、狀態變體、白底提示詞）。**大綱沒有 props 就從原文提取**，那時這步是模型的活：只收**有特寫、跨集出現、承載劇情**的，通常 3–8 件，跟主角數量一個量級。每件按 `references/prop-pass.md` 填：戲劇功能、錨點、狀態變體、尺度、白底無手提示詞。皮箱這種「跟人走的道具」就該在這——塞進場景錨點和角色畫像都不對。

### Step 3 — 校驗 ⛔ 不能跳

```bash
node {baseDir}/scripts/novel-art.mjs validate <art.json> --cast <cast.json>
```

11 道品質門全是程式碼。場景 + 共用 7 道：錨點 3–5、光照狀態 ≥1、**無人**、提示詞全英文、不含角色名（給了 --cast 才查）、變體引用完整、風格與反向詞匹配。道具專屬 4 道：**狀態 ≥1**、**尺度短語寫進提示詞**、**反向詞禁手**、**設定圖純白背景**。

**有違規逐條修，改完重跑，直到透過。**

### Step 4 — 生圖（可選）

場景和道具各一張 16:9 設定圖，版面都是**主視角大圖 + 底部和右側的 L 形細節邊框**。場景：標準取景 + 第一個光照狀態，細節格是錨點特寫。道具：白底三四分之一主視角（主狀態），細節格是錨點特寫 + 其他狀態 + 側面。讀 `{baseDir}/references/sheet.md` 照呼叫契約做，要點：

- **沒有 codex 就整步跳過**，只交提示詞
- **全圖無人**；道具圖另加**無手**、**純白背景**，出現人影或手就重生成
- **變體場景拿母場景成圖當參考圖**（`-i` + stdin）——變體機制的意義就在這
- 一個場景一次呼叫絕不批次；單個失敗跳過不阻斷

### Step 5 — 輸出與彙報

```bash
cd <輸出目錄>
node {baseDir}/scripts/novel-art.mjs render <劇名>-art.json --md   > <劇名>-art.md
node {baseDir}/scripts/novel-art.mjs render <劇名>-art.json --html > art-report.html
```

報告介面預設中文；使用者要英文介面就加 `--lang en`（或在 art.json 頂層寫 `"lang": "en"`，`--lang` 優先）。`render` 自動去 `images/<slug>-sheet.png` 找圖（場景和道具都找），**先生圖再 render**。報告含：KPI 帶、場景清單、場景設定卡、道具清單、道具設定卡（錨點核對表 / 狀態變體 / 提示詞包全帶複製按鈕）、品質門面板、匯出 JSON（下載的就是 art.json 原樣）。

彙報一句話說清：幾個場景（主場景/變體各幾）、幾件道具、錨點總數、生圖數、報告路徑；沒過的門和沒出的圖明說。

最終落地：

```
<輸出目錄>/
├── <劇名>-art.json
├── <劇名>-art.md
├── art-report.html                ← 雙擊就能開
└── images/
    └── <slug>-sheet.png           ← 有 codex 才有
```

---

## 三個 skill 的接力

```
novel-outline    → outline.json （什麼：結構與分集）
novel-characters → cast.json    （誰：角色資產）
novel-art        → art.json     （哪裡 + 手裡拿的：美術資產）
```

seed 吃 outline.json 的場景與道具兩塊（大綱沒有 `props` 時道具留空，模型從原文提取），`--cast` 吃 cast.json。三份 JSON 各自的報告都帶匯出按鈕，改完都能餵回各自的 render/validate。

## 邊界

- 報告介面內建中英（`--lang`，預設中文、或跟 art.json 的 `lang` 欄位）；生圖提示詞永遠英文
- 畫風要跟角色 skill 同檔，別一半寫實一半動畫
- 生圖只走 codex built-in `$imagegen`，不碰要 API key 的 CLI fallback
- 場景數量不設硬上限——上限在 novel-outline 的主場景門那裡管；這裡管的是每個資產的品質
- 道具只收敘事道具，3–8 件為宜——每多一件就多一份跨集一致性維護

## 自測

```bash
node {baseDir}/scripts/selftest.mjs
```

158 項斷言，不調模型、不花額度。11 道品質門每一道都有擊穿用例。改完腳本先跑這個。

## 自帶樣例

`{baseDir}/examples/渡口-art.json`：《渡口》三場景 + 兩件敘事道具（舊皮箱、縣衙舊硯）的完整設定，全部品質門透過（含對著 novel-characters 樣例 cast 的角色名檢查）。當品質基準，也是自測夾具。
