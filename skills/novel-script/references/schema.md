# script.json 結構

一份劇本檔案覆蓋一個集數區間（通常一批 ≤ 3 集），頂層：

```json
{
  "source": "渡口",
  "params": { "charsPerSecond": 4.5, "actionSeconds": 2.5, "tolerance": 0.15, "maxLineChars": 35 },
  "episodes": [ ... ]
}
```

`params` 可省略，省略就用預設值。四個鍵都只在需要偏離預設時寫。

## episode

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `ep` | int | 集號，正整數，同一檔案內不許重複 |
| `targetSeconds` | number | 目標秒數。seed 會從大綱的 `minutesPerEpisode × 60` 算好 |
| `hook` | string | 開場鉤子的說明——這一集頭幾拍靠什麼把人摁住。**必填** |
| `cliff` | string | 結尾懸念的說明——最後一拍留什麼讓人點下一集。**必填** |
| `beatsClaimed` | string[] | 認領的大綱爽點 `type`（如 `"身份揭破"`）。沒有就空陣列，**欄位本身必須在** |
| `hookBeat` | [int, int] | **鉤子具象的認領位置** `[場, 拍]`：鉤子說皮箱，哪一拍真給了皮箱。必須落在全集前 `hookWindow`（預設 3）拍內——冷開場規則，門查位置 |
| `scenes` | scene[] | 場次，按劇情順序 |

`hook` / `cliff` 是**說明不是臺詞**——它們描述開場和結尾要達成的效果，具體的戲寫在場次裡。說明配合 `hookBeat` 認領：**說明給人讀，認領給機器查**——鉤子和第一場開頭銜接不上，就是缺了認領這一環。

## scene（場次）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `sceneId` | string | `S01` 格式，對賬 art.json 的場景 |
| `lighting` | string | 該場用的光照狀態名，必須是 art.json 裡該場景登記過的狀態。可省略 |
| `characters` | string[] | 本場出場角色（`C01` 格式，對賬 outline.json）。空鏡給空陣列 |
| `props` | string[] | 本場用到的敘事道具（`P01` 格式，對賬 art.json）。可省略 |
| `flow` | beat[] | 節拍流，**動作與臺詞交替**，按發生順序 |

## beat（節拍）——二選一

**動作節拍**：

```json
{ "action": "沈知微一把按住箱蓋。動作快得不像閨秀，倒像護崽的獸。" }
```

**臺詞節拍**：

```json
{ "speaker": "C01", "line": "不勞煩。它跟我。", "delivery": "聲音很輕，卻沒商量" }
```

| 欄位 | 說明 |
| --- | --- |
| `action` | 敘述體畫面描述，一拍一件事。**不許出現引號臺詞**（「」『』“”都不行）——臺詞混進動作就沒法計秒、沒法餵 TTS |
| `speaker` | 本場 `characters` 裡的角色 id，或 `"VO"`（畫外音/心聲——誰的心聲寫進 delivery） |
| `line` | 臺詞本體，口語，單句 ≤ 35 字（非空白字元計） |
| `delivery` | 表演提示：語氣、動作伴隨、潛臺詞。可省略，建議都寫 |

一個節拍不能既有 `action` 又有 `line`；兩者都沒有也不行。

## 時長折算（確定性）

- 臺詞秒數 = 非空白字元數 ÷ `charsPerSecond`（標點算時間——停頓也是時間）
- 動作秒數 = 動作節拍數 × `actionSeconds`
- 每集預估 = 全部場次之和，必須落在 `targetSeconds × (1 ± tolerance)` 內

三分鐘（180 秒）一集的參考體量：約 45–55 個節拍，其中臺詞 30 句上下。兩分鐘（120 秒）約 35 拍、臺詞 20 句上下。

## ID 紀律

角色用 outline.json 的 `C` 編號（不是 cast.json 的名字），場景道具用 art.json 的 `S` / `P` 編號。報告渲染時給了 `--outline` / `--art` 會自動把編號顯示成名字——**資料裡存編號，介面上看名字**。
