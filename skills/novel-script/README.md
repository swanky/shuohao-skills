**中文** · [English](README.en.md)

# novel-script

給 AI 短劇寫**劇本**：把 novel-outline 的分集梗概落成場次和臺詞。前提刻在骨子裡：**劇本管戲，分鏡管拍**——「爽不爽」和「怎麼拍」是兩種迭代節奏，臺詞要反覆推翻重寫，綁上鏡頭分解每改一句都得重排鏡頭。所以這層沒有鏡號、沒有首幀提示詞，那些是下一層分鏡 skill 的活。

但守住一條底線：**臺詞是結構化資料，不是散文**。

- **節拍流** — 每場戲是動作節拍與臺詞行的交替序列：動作一拍一件事（敘述體），臺詞逐句帶說話人與語氣。臺詞直接對接 TTS 逐句生成，動作節拍就是畫面要發生的事
- **逐集時長預算** — 臺詞按語速折算（預設 4.5 字/秒）、動作按節拍估時（預設 2.5 秒/拍），每集必須落在目標 ±15% 內。**一集三分鐘就是三分鐘**，寫超寫欠當場攔下，不流到生成環節才發現
- **開場鉤子 + 結尾懸念** — 每集都要落在紙面；**鉤子不是標籤是第一拍**：`hookBeat` 認領具象位置，必須在全集前 3 拍內冷開場兌現；認領的大綱爽點必須有戲扛
- **畫外音記號** — `VO` 統一標心聲與旁白，誰的心聲寫在語氣欄裡，臺詞本里單獨成組

產出 `script.json` + Markdown + 一個雙擊就能開的 `script-report.html`：

![script-report.html](assets/report.webp)

## 品質門：10 道，全是程式碼

與儲存庫裡另外三個 skill 同一主張：**checklist 交給模型自覺是靠不住的**。

| 門 | 規則 |
| --- | --- |
| **每集時長** | 預估落在 `targetSeconds` ±15% 內（語速、節拍秒數、容差都在 `params` 裡可調） |
| 單句臺詞長度 | ≤ 35 字——一口氣說不完的臺詞也生成不了 |
| 說話人合法 | speaker 必須在本場人物裡，或明確標 `VO` |
| 鉤子懸念落紙 | 每集 `hook` / `cliff` 必填 |
| **鉤子前 3 拍兌現** | `hookBeat` 認領鉤子具象的位置，必須落在全集前 3 拍內——冷開場是門不是自覺，鉤子和開場從此銜接得上 |
| **每場至少一個動作節拍** | 純對白的場是廣播劇，AI 生成時沒有畫面可寫 |
| 動作敘述體 | 動作裡不許出現引號臺詞——臺詞只能進 dialogue 欄位 |
| 爽點認領 | 大綱說這集有的爆點，劇本必須認領（給 `--outline` 才查，不給**明說跳過**） |
| 角色對賬 | 出場角色都在大綱角色表裡（給 `--outline` 才查） |
| 場景對賬 | 場景存在、**光照狀態是美術設定裡登記過的**、道具存在（給 `--art` 才查） |

自測裡每道門都有**擊穿用例**——證明它真的會攔。

## 報告長什麼樣

業內評審用的單頁報告，頁寬 1600。介面預設中文，render 加 `--lang en` 輸出全英文介面： 英文介面下品質門標籤同樣翻譯（閾值原樣），門的失敗詳情與資料內容保持原文。

- **KPI 帶**：集數 / 預估總時長 vs 目標 / 臺詞句數 / 臺詞佔比 / 平均每場——換景次數只是統計不設門，AI 換景不要錢
- **時長儀表**：每集一行條形圖，臺詞與動作堆疊，打在目標區間的綠帶上；超時欠時紅字點名差幾秒
- **分集劇本**：主體，**一排兩集**。集頭（預估/鉤子/懸念/爽點章）永遠可見，場次資訊預設最多 300px 漸隱截斷，點開看全部、再點收起；臺詞行懸停可單句複製
- **場次總表**：全部場次 × 場景 × 光照 × 人物 × 估秒，自動彙總，模型不寫
- **臺詞本**：**一排兩個**，按角色聚合全部臺詞，列表最多 6 行高可滾動，帶集/場引用和「複製全部臺詞」；給了 `--cast` 每個角色組頭還帶**音色提示詞**按鈕——臺詞和音色一頁配齊，直接跑 TTS
- **品質門**面板 + 頁首徽章 + **匯出 JSON**（下載的就是 `script.json` 原樣，改完能直接餵回 `render` / `validate`）
- 全部圖形是內聯 CSS/SVG，零外部依賴，離線雙擊能開

## 跟另外三個 skill 的接力

```
novel-outline    → outline.json （什麼：結構與分集）
novel-characters → cast.json    （誰：角色資產）
novel-art        → art.json     （哪裡 + 手裡拿的：美術資產）
novel-script     → script.json  （戲：場次、節拍、臺詞）
```

- `seed <outline.json> --eps 1-3` 確定性預填每集骨架：目標秒數、鉤子、懸念、爽點認領、候選場景人物
- `validate --outline --art` 三向對賬：角色、爽點、場景/光照/道具。劇本里寫了美術沒登記的光照狀態，當場報——去 art.json 補狀態，不是繞過門
- `render --outline --art` 把報告裡的 `C01` / `S01` 顯示成人名和場景名——**資料裡存編號，介面上看名字**

往下一層是分鏡 skill：鏡號、單鏡頭時長、首幀提示詞、生成批次單都在那邊。

## 命令列直接用

```bash
node scripts/novel-script.mjs seed outline.json --eps 1-3        # 預填骨架
node scripts/novel-script.mjs validate script.json \
     --outline outline.json --art art.json                       # 校驗
node scripts/novel-script.mjs checkup script.json                # 只跑品質門
node scripts/novel-script.mjs render script.json --html \
     --outline outline.json --art art.json \
     --cast cast.json > script-report.html                       # 出報告（--cast 帶音色提示詞）
node scripts/novel-script.mjs render script.json --html --lang en \
     --outline outline.json --art art.json > script-report.html  # 英文介面報告（預設中文）
node scripts/novel-script.mjs slug "渡口"                         # 安全檔名
```

## 邊界

- 不分鏡頭、無鏡號、不寫畫面生成提示詞、不生圖——分鏡層的活一件不碰
- 時長是**估算不是秒錶**，容差 ±15% 就是為此留的；配音語速不同就調 `params.charsPerSecond`
- 報告介面內建中英：render 加 `--lang en` 輸出全英文介面（預設中文，或跟 script.json 頂層的 `lang` 欄位）；臺詞語言跟劇走
- 一次建議寫 ≤ 3 集——劇本是全管線改得最兇的一層，小批次出、快拍板、再往下寫

## 檔案

```
SKILL.md                 給 agent 讀的工作流
scripts/
  novel-script.mjs       seed / validate / checkup / render / slug
  selftest.mjs           154 項斷言，不調模型
references/
  schema.md              script.json 結構 + 時長折算規則
  script-pass.md         寫戲：硬規則、手感規則、常見病
  report-style.md        報告的設計約定
examples/
  渡口-script.json        《渡口》全 6 集完整劇本（每集冷開場兌現鉤子），全部品質門透過，也是自測夾具
assets/
  report.webp            報告截圖
```

## 自測

```bash
node scripts/selftest.mjs
```

154 項斷言，覆蓋時長引擎 / 統計 / 品質門逐項擊穿 / seed / 渲染（含英文介面）/ 匯出。不調模型、不花額度、1 秒跑完。改完腳本先跑這個。

**只在 macOS + Node 24 上實測過。** 程式碼沒有平臺相關呼叫，Linux 和更低版本 Node 理論上沒問題，但**沒驗過**。
