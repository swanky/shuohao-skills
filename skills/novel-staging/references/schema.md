# staging.json 格式

一份 staging.json 記一部劇（或其中幾集）每一場**開場那一刻**誰在哪。中途換位置不記——那是分鏡的事，分鏡從這一刻往後接著寫。

```json
{
  "source": "渡口",
  "lang": "zh",
  "locations": [ … ],
  "scenes": [ … ]
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `source` | string | 劇名，`seed` 從 script.json 搬過來 |
| `lang` | `zh` / `en` | 工作語言：東西的名字、人名、走位句用哪種語言寫。報告介面預設也跟它 |
| `locations` | location[] | 每個地點（美術場景）一條：從它的場景圖裡認出來的東西 |
| `scenes` | scene[] | 每一場（劇本的場次）一條：開場站位 |

## 座標系

所有方位都按**場景**說，不按畫面說：

- **主視角**（場景圖的標準取景）的機位在**南側**，向北看。所以圖的左邊是西、右邊是東，越往上（越遠）越靠北，越往下（越近）越靠南。
- **平面**（`plan`）是把整個房間擺平以後從正上方看：北在上、西在左，0 到 1，從西北角量起——橫向從西牆（0）到東牆（1），縱向從北牆（0）到南邊機位那一側（1）。
- 人的位置寫成「在哪件東西的哪一側、沿著這一側多遠」，不寫平面座標。平面上的點由程式按這句話算出來，所以畫出來的和寫出來的永遠是一回事。

## location

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `sceneId` | string | `S01` 格式，對賬 art.json 的場景 |
| `name` | string | 地點名，`seed` 從 art.json 搬過來；報告按它找圖（`images/<名字>-sheet.png`） |
| `readFrom` | `picture` / `prompt` / null | `picture`：看著場景圖認的；`prompt`：還沒有圖，按 art.json 的錨點和主視角提示詞推算的。null = 還沒認 |
| `items` | item[] | 4–20 件，按從北到南排 |

### item

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `name` | string | 用工作語言寫，十個字以內，寫成走位裡說得出口的叫法；同類的東西帶上方位或特徵區分（「北端主位太師椅」「東側落地窗」）。不重複 |
| `alt` | string | 同一件東西的另一種語言，英文走位句用它 |
| `box` | [左, 上, 右, 下] | 它在圖上的位置，0–1，以整張圖的寬高為 1。`readFrom` 是 `picture` 時必填；`prompt` 時沒有圖，不寫 |
| `plan` | [西, 北, 東, 南] | 它在平面上佔的地方，0–1。按透視推算，不是照抄 box |
| `on` | boolean | 人能坐在、站在它上面（椅子、長凳、床、臺子、臺階、船板） |
| `round` | boolean，可選 | 從正上方看是圓的（圓桌、圓地毯）：畫成圓，人圍著它一圈；不寫就看名字裡有沒有「圓」 |

## scene

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `ep` | number | 集號 |
| `scene` | number | 這一集的第幾場，從 1 開始，對賬 script.json 的 `episodes[].scenes[]` 順序 |
| `sceneId` | string | 在哪個地點，對賬 `locations[].sceneId` |
| `lighting` | string，可選 | 劇本寫的時段光照，`seed` 搬過來，只給人看 |
| `cast` | {id, name}[] | 這一場的出場人物，`seed` 從劇本搬過來，不改 |
| `places` | place[] | 出場人物每人正好一條，順序就是走位句的順序 |
| `extras` | number | 除了出場人物還有幾個群演。劇本沒寫有別人就是 0 |
| `extrasWhere` | string / null | 群演在哪（「長桌西側南端」）；`extras` 是 0 時寫 null |
| `why` | string，可選 | 一句話：為什麼這麼排。報告裡顯示，給人改的時候參考 |

### place

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` / `name` | string | 照抄 `cast` |
| `present` | boolean | 開場時這個人在不在。後面才進來的寫 false |
| `item` | string / null | 照抄這個地點 `items` 裡的一個名字；不在場寫 null |
| `side` | `north` / `east` / `south` / `west` / `on` / null | 在這件東西的哪一側；在它上面寫 `on`（只有 `on: true` 的東西可以） |
| `along` | number / null | 沿這一側的位置，0–1：東側、西側從北端（0）到南端（1）；北側、南側從西端（0）到東端（1）。`side` 是 `on` 時寫 0.5 |
| `posture` | `sit` / `stand` | 坐還是站；不在場可以寫 null |
| `facing` | 八個方位之一 | `north` / `northeast` / `east` / `southeast` / `south` / `southwest` / `west` / `northwest`；不在場可以寫 null |

## 開場走位句

`blocking` 命令和報告按上面的資料寫出每一場的開場走位：在場的每個人一句，按 `places` 的順序，最後一句交代還有沒有別人。

> 沈知微站在岸端土坡上，面朝北；老周坐在靠岸的渡船上，面朝南；其餘座位空著，沒有其他人。

同一件東西同一側落在同一段的幾個人，後面的人會帶上「、XX 南側」說清先後。分鏡寫這一場第一段的開場走位時，照抄這一句。
