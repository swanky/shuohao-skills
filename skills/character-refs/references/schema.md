# asset.json

一個角色一個檔案，放在 `<輸出目錄>/<角色名>/asset.json`，圖片路徑都相對它。**由腳本讀寫，不要手改 `views`。**
要改描述：改 intake 重新 `new`（新資產），或直接改 `layers` / 造型裡的文字——改完所有照舊文字出的圖都會標成過期。

```jsonc
{
  "name": "阿禾",                     // 只用於檔名、標識和報告，不進提示詞
  "source": "樣例 · 茶山",             // 可省
  "lang": "zh",                       // 確認表與報告的語言；沒有這個欄位按 zh
  "ui": { … },                        // 只有非內建語言才有：自譯的介面文案
  "layers": {                         // 角色層：換造型也不變的
    "identity": { "age": 16, "gender": "female", "en": "…", "text": "…", "source": "stated" },
    "face":  { "en": "…", "text": "…", "source": "stated" },   // en 進提示詞；text 給人看（舊資產是 zh，照樣認）
    "hair":  { … },
    "build": { … },                   // 可省
    "skin":  { … },                   // 可省，省了按年齡補
    "backCue": { … }                  // 可省，省了按髮型與服裝拼
  },
  "outfits": {                        // 造型層；v1 只有 default
    "default": {
      "label": "常態 · 採茶裝",
      "top":    { "en": "…", "text": "…", "source": "stated" },
      "bottom": { … },
      "details": [ { "slot": "hair", "en": "…", "text": "…", "source": "stated" }, … ],
      "overrides": {},                // 這套造型要改的角色層，比如換髮型：{ "hair": { … } }
      "look": { "id": "anime", "label": { "zh": "動漫", "en": "Anime", "ja": "アニメ" }, "medium": "drawn",
                "style": "…", "clean": "…", "neg": "…" },   // 畫風快照；medium: photo 照片 / drawn 畫出來的
      "upgrades": [ { "tier": 2, "reason": "E03 有面部特寫", "at": "…" } ],
      "views": {
        "front-full": {
          "current": 2,               // 當前生效的版本
          "versions": [ { … v1 … }, { … v2 … } ]   // 重出只追加，不刪
        }
      }
    }
  }
}
```

## 一個版本

```jsonc
{
  "v": 1,
  "id": "阿禾/default/front-full/v1",          // 標識：角色/造型/檢視/版本
  "file": "default/front-full.v1.png",
  "sha256": "…",                               // 寫入標識之後的檔案雜湊
  "model": "qwen",                             // 這張使用的模型；同組混用只提醒
  "seed": 1980929016,
  "prompt": "…", "negative": "…",              // 實際發出去的提示詞
  "refs": [ { "view": "front-full", "v": 1, "sha256": "…" } ],   // 實際掛了哪幾張參考圖
  "notes": [],                                 // 比如「face-front 缺失或已過期，這張只掛錨點」
  "layersHash": "…",                           // 生圖時的文字描述指紋
  "lookHash": "…",                             // 生圖時的畫風快照指紋
  "gates": [ { "id": "size", "label": "…", "ok": true, "detail": "1056×1584" }, … ],
  "createdAt": "…",
  "confirmed": true, "confirmedAt": "…"        // 只有錨點有：false 待確認 / true 已確認 / "auto" 配置為不確認
}
```

同樣的標識、模型、參考圖也寫進 PNG 的 iTXt 欄位（`shuohao:id`、`shuohao:model`、`shuohao:refs`）。

## 檢視

| id | 檔位 | 比例 | 參考圖 |
| --- | --- | --- | --- |
| `front-full` | 1（錨點） | 2:3 | 無 |
| `face-front` | 2 | 4:5 | 錨點 |
| `side-full` | 2 | 2:3 | 錨點 |
| `back-full` | 2 | 2:3 | 錨點 |
| `detail-hair` / `detail-neck` | 3 | 1:1 | 錨點 + 大頭照 |
| `detail-sleeve` / `detail-feet` | 3 | 1:1 | 錨點 |
| `detail-<id>`（自定義） | 3 | 1:1 | `part` 為 hair / neck 掛錨點 + 大頭照，其餘只掛錨點；標「未實測」 |
| `face-45` | 4 | 4:5 | 錨點 |

## 過期

一張圖的當前版本滿足任一條就過期（`check` exit 1，報告標紅框）：

- 文字描述指紋變了：改了人本身的描述（身份、年齡、性別、臉、頭髮、身形、皮膚、上下裝、背面）→ 全部過期；
  改了某條細節 → 只有那張細節圖過期；加、刪細節 → 不影響其他圖
- 畫風快照變了
- 它參考的某張圖換了版本（重出錨點 → 其餘全部過期；重出大頭照 → 掛了大頭照的細節過期）

只標記，不刪除；重出這一張就好。錨點重出後要重新確認。
