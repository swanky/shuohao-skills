# art.json 結構

美術設定集（場景 + 敘事道具）的載體。**模型只填設計欄位**，場景與道具的出現集、承載爽點都由 `seed` 從 outline.json 搬運；大綱沒有 `props` 時道具表留空，由模型按 `prop-pass.md` 從原文提取。Markdown 和報告由 `render` 渲染。

```json
{
  "source": "渡口",
  "style": "realistic",
  "scenes": [{
    "id": "S01", "name": "渡船船艙", "primary": true,
    "summary": "設計意圖：這個空間講什麼故事……",
    "anchors": [{ "name": "補丁船篷", "desc": "……" }],
    "lighting": [{ "state": "晨霧", "prompt": "dense white morning fog ..." }],
    "image": { "prompt": "…", "negativePrompt": "…", "sheet": "…", "tags": [] },
    "variantOf": "S02", "changes": "換背板 + 蘆葦前景",
    "usage": { "episodes": [1, 6], "beats": ["懸念鉤"] }
  }],
  "props": [{
    "id": "P01", "name": "舊皮箱", "scale": "手持級",
    "summary": "戲劇功能：全劇懸念核心……",
    "anchors": [{ "name": "綠鏽銅釦", "desc": "……" }],
    "states": [{ "state": "合上", "prompt": "the suitcase closed ..." }],
    "relatedScenes": ["S01"], "carriedBy": ["沈知微"],
    "image": { "prompt": "…", "negativePrompt": "…", "sheet": "…", "tags": [] },
    "usage": { "episodes": [1, 6], "beats": ["懸念鉤"] }
  }]
}
```

## 頂層

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `source` | 是 | 劇名/書名 |
| `style` | 是 | `realistic` / `ghibli`，與 novel-characters 的畫風同名對齊（內容是環境版，不帶皮膚毛孔那套） |
| `scenes` | 是 | 場景陣列 |
| `props` | 否 | **敘事道具**陣列——只收有特寫、跨集、承載劇情的（3–8 件為宜），場景陳設歸場景錨點。選法見 `prop-pass.md` |

## 單個場景（以校驗器為準）

| 欄位 | 必填 | 語言 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | — | `S01` 格式，全域唯一。用 seed 時沿用 outline 的場景 id |
| `name` | 是 | 中文 | 場景名 |
| `primary` | 是 | — | 是不是主場景 |
| `summary` | 是 | 中文 | **設計意圖**：這個空間講什麼故事、要什麼感覺，不是戶型說明 |
| `anchors` | 3–5 個 | 中文 | **一致性錨點** `{name, desc}`：每次生成都必須出現的可辨識特徵。認場景靠它，QC 生成鏡頭也靠它 |
| `lighting` | ≥1 個 | state 中文 / prompt 英文 | **光照狀態**：AI 換時段是重新生成不是重新打燈，每個狀態必須落成完整提示詞 |
| `image.prompt` | 是 | **英文** | 主視角單圖提示詞，**必須寫明空景無人** |
| `image.negativePrompt` | 是 | **英文** | **必須禁人**（people/figure/…），這是空景的硬保證 |
| `image.sheet` | 是 | **英文** | 環境設定圖完整版面指令（見 `sheet.md`），必須整段包含當前風格的渲染句 |
| `image.tags` | 是 | 英文 | 風格標籤陣列 |
| `variantOf` | 否 | — | 變體的母場景 id。AI 生成一個新景很便宜，但**變體複用母場景資產更一致**——outline 裡帶 reusePlan 的場景優先做成變體 |
| `changes` | variantOf 時必填 | 中文 | 相對母場景改了什麼（換時段/換天氣/換前景/刪道具） |
| `usage` | 否 | — | `{episodes, beats}`，seed 自動填，手寫也行 |

## 單件道具（以校驗器為準）

| 欄位 | 必填 | 語言 | 說明 |
| --- | --- | --- | --- |
| `id` | 是 | — | `P01` 格式，全域唯一 |
| `name` | 是 | 中文 | 道具名 |
| `scale` | 是 | 列舉 | `手持級` / `桌面級` / `傢俱級`，對應英文短語必須出現在提示詞裡 |
| `summary` | 是 | 中文 | **戲劇功能**：這件道具承載什麼劇情 |
| `anchors` | 3–5 個 | 中文 | 經得起特寫的細節特徵（銅釦的新劃痕、墨池的月牙磨痕） |
| `states` | ≥1 個 | state 中文 / prompt 英文 | **狀態變體**：合上/開啟、藏著/攤開——每個狀態一張參考 |
| `relatedScenes` | 否 | — | 主要出現的場景 id，必須存在 |
| `carriedBy` | 否 | 中文 | 誰帶著它，自由文字 |
| `image.prompt` | 是 | **英文** | 白底主視角，**必須帶尺度短語、無人無手** |
| `image.negativePrompt` | 是 | **英文** | **必須禁人且禁手**（hands/fingers） |
| `image.sheet` | 是 | **英文** | 設定圖版面指令，**必須寫明 pure white background** + 當前風格渲染句 |
| `usage` | 否 | — | `{episodes, beats}` |

## 硬規則（11 道品質門，全是程式碼）

1. 錨點 3–5 個——少了認不出，多了核對不過來
2. 光照狀態 ≥1 且都有英文提示詞
3. **空景**：負向提示詞必須禁人。環境和角色是兩層資產，混在一張圖裡一致性全毀
4. 生圖提示詞（主圖/反向/設定圖/光照）全部英文
5. 提示詞不含角色名（`validate --cast cast.json` 才查，不給就明說跳過）
6. 變體引用完整：`variantOf` 指向存在的場景且帶 `changes`
7. 風格與反向詞匹配：`realistic` 不禁 photorealistic、`ghibli` 必須禁；`sheet` 必須含渲染句

道具專屬四道：

8. 狀態 ≥1 且都有英文提示詞
9. 尺度參照寫進提示詞（scale 列舉對應的英文短語）
10. 負向提示詞禁手——拿著道具的手是最常見汙染
11. 設定圖純白背景可摳

## 校驗

```bash
node scripts/novel-art.mjs validate art.json --cast cast.json
node scripts/novel-art.mjs checkup art.json               # 只列印 11 道門 ✓/✗
```
