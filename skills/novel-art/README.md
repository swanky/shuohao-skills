**中文** · [English](README.en.md)

# novel-art

給 AI 短劇出**美術設定集**：場景 + 敘事道具。前提刻在骨子裡：**這是 AI 生成，不是實拍**——沒有堪景、搭景、置景採買，環境和道具都是要被生成幾十次還得長一樣的資產。交付物不是置景清單，是一致性方案。

**場景層**：

- **設計意圖** — 這個空間為哪場戲存在，不是戶型說明
- **一致性錨點**（每景 3–5 個） — 每次生成必現的可辨識特徵（補丁船篷、斷裂的第七塊橋板）。觀眾靠它認場景，QC 靠它核對生成鏡頭有沒有漂
- **光照時段變體** — AI 換時段是**重新生成不是重新打燈**，每個狀態落成完整英文提示詞
- **變體機制** — `variantOf` + `changes` 把衍生場景掛在母場景上，生圖拿母場景成圖當參考

**道具層**（只收**敘事道具**：有特寫、跨集、承載劇情，通常 3–8 件）：

- **戲劇功能** — 皮箱是全劇懸念、舊硯是爆點實體——先說它在劇裡幹什麼
- **狀態變體** — 合上/開啟、藏著/攤開：道具有狀態弧，每個狀態一張參考圖
- **尺度參照** — 手持級/桌面級/傢俱級，英文短語寫死進提示詞——AI 把手持道具畫成傢俱尺寸是高頻事故
- **白底無手** — 道具圖要被貼進各種鏡頭，必須純白可摳；拿著道具的手是最常見汙染

場景陳設歸場景錨點、一次性手部道具鏡頭級提示詞解決——都不單獨建資產。

產出 `art.json` + Markdown + 一個雙擊就能開的 `art-report.html`。報告介面預設中文；render 加 `--lang en` 輸出全英文介面（或在 art.json 頂層寫 `"lang": "en"`，`--lang` 優先）： 英文介面下品質門標籤同樣翻譯（閾值原樣），門的失敗詳情與資料內容保持原文。

![art-report.html](assets/report.webp)

## 品質門：11 道，全是程式碼

與儲存庫裡另外兩個 skill 同一主張：**checklist 交給模型自覺是靠不住的**。

| 門 | 規則 |
| --- | --- |
| 一致性錨點 | 3–5 個（場景與道具同規） |
| 光照狀態 | 每景 ≥1 且落成英文提示詞 |
| **無人** | 負向提示詞禁人（場景與道具都查） |
| 提示詞語言 | 全部英文 |
| 提示詞不含角色名 | `validate --cast cast.json` 才查；不給就**明說跳過** |
| 變體引用完整 | `variantOf` 指向存在的場景且帶 `changes` |
| 風格與反向詞匹配 | `realistic` 不禁 photorealistic、`ghibli` 必須禁 |
| **道具狀態** | ≥1 且落成英文提示詞 |
| **道具尺度** | scale 列舉對應的英文短語必須出現在提示詞裡 |
| **道具無手** | 負向提示詞禁 hands/fingers |
| **道具白底** | 設定圖必須 pure white background |

自測裡每道門都有**擊穿用例**——證明它真的會攔。

## 跟另外兩個 skill 的接力

```
novel-outline    → outline.json （什麼：結構與分集）
novel-characters → cast.json    （誰：角色資產）
novel-art        → art.json     （哪裡 + 手裡拿的：美術資產）
```

- `seed <outline.json>` 確定性預填場景與道具兩張清單，連出現集、承載爽點一起搬；大綱沒有 `props` 時道具留空，模型按 `prop-pass.md` 從原文提取
- `validate --cast <cast.json>` 用角色表查提示詞裡有沒有混進角色名
- 畫風預設與 novel-characters **同名對齊**（realistic / ghibli）但內容是環境版——真實感來自用舊的材質，不是皮膚毛孔

## 命令列直接用

```bash
node scripts/novel-art.mjs seed outline.json > art.json      # 從大綱預填場景骨架
node scripts/novel-art.mjs validate art.json --cast cast.json
node scripts/novel-art.mjs checkup art.json                  # 只跑品質門
node scripts/novel-art.mjs render art.json --html            # 出報告（介面預設中文）
node scripts/novel-art.mjs render art.json --html --lang en  # 英文介面報告
node scripts/novel-art.mjs styles                            # 看畫風預設
```

## 生圖（可選）

走 codex 內建 `$imagegen`，零 API key。場景和道具各一張 16:9 設定圖，版面都是**主視角大圖 + 底部和右側的 L 形細節邊框**：場景細節格放錨點特寫，道具細節格放錨點特寫 + 其他狀態 + 側面。場景**無人**；道具另加**無手、純白背景**。變體場景拿母場景成圖當參考圖。沒有 codex 就只交提示詞，其餘照常。呼叫契約見 `references/sheet.md`。

## 檔案

```
SKILL.md                 給 agent 讀的工作流
scripts/
  novel-art.mjs          seed / validate / checkup / render / styles / slug
  selftest.mjs           158 項斷言，不調模型
references/
  schema.md              art.json 結構 + 硬規則
  scene-pass.md          怎麼填場景設定（AI 短劇的思路）
  prop-pass.md           怎麼選、怎麼填敘事道具
  sheet.md               設定圖生圖的 codex 呼叫契約
  report-style.md        報告的設計約定
examples/
  渡口-art.json           《渡口》三場景 + 兩件道具樣例，全部品質門透過
assets/
  report.webp            報告截圖
```

## 自測

```bash
node scripts/selftest.mjs
```

158 項斷言，覆蓋 seed / 畫風預設 / 11 道門逐項擊穿 / 渲染（中英介面）/ 匯出。不調模型、不花額度、1 秒跑完。改完腳本先跑這個。

**只在 macOS + Node 24 上實測過。** 程式碼沒有平臺相關呼叫，Linux 和更低版本 Node 理論上沒問題，但**沒驗過**。
