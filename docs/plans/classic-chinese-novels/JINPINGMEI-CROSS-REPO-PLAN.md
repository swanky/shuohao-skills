# 《金瓶梅》跨 repo 角色一致性與綜合報告規劃

## 目標

在本 repo 建立 `testdata/benchmarks/novel-characters/classic-chinese-novels/金瓶梅-主要角色/`，採用 `novel-characters` 的資料結構與報告版面，同時確保人物身份、臉部、體態、服裝與配色和下列外部 repo 的現行視覺權威一致：

```text
C:\cc_home\novel-characters-lab\jinpingmei-full
```

《金瓶梅》不硬套其他作品的「女性八人＋互補八人」規模。外部 repo 已有十九位完整現行角色，正好分成十一位女性與八位男性；本計畫全數納入，最後合併為一份十九人報告。

## 兩個 repo 的職責

| 項目 | 唯一依據 |
| --- | --- |
| 原文引文與最終 `validate` | 本 repo 的 `testdata/corpora/classic-chinese-novels/金瓶梅.txt` |
| JSON schema、`image.sheet`、Markdown 與 HTML 版面 | 本 repo 的 `skills/novel-characters/` |
| 現行角色名單與角色卡遷移起點 | 外部 repo 的 `_current/characters/金瓶梅詞話-目前視覺權威角色-cast.json` |
| 臉部身份、體態、服裝與配色 | 外部 repo 的 `_current/characters/authority-snapshot.json` 及其指向的 current authority 圖片 |
| 現行套件入口與版本鎖 | 外部 repo 的 `_current/characters/CURRENT_PACKAGE.json` |

外部 repo 全程唯讀。本工作不修改它的 manifest、圖片、Owner 決策、provenance、verifier、delivery 或任何 canonical bytes，也不發布任何內容。

## 目前鎖定的外部權威快照

規劃時讀到的現行狀態如下：

- 套件：`current-visual-authority-cast-v002`
- `CURRENT_PACKAGE.json` 記錄的 canonical manifest SHA-256：`bcc8b15eb524e6c0837f6e3bd96d3b95e2634114b12d85c605823badf6c05020`
- 規劃時實際讀到的 current／canonical manifest SHA-256：`95451ae83fe3d5dfb7e81cbf102845cb2b5f9ce695af9299f458adaef057a4a9`
- 角色卡所記 authority snapshot SHA-256：`af53b5b3f50cd386d57da9fb771a3dd9dda2068960f4a700604038926a44fcdd`
- authority projection SHA-256：`1fe12a28539f79a61a418f10dce97bfa5baeca91ceb7a6a254564ad9d018ebc6`
- 現行角色：19／19
- 現行視覺權威圖：38／38
- 發布動作：`NONE`

規劃時的唯讀稽核結果：

- `_current/characters/manifest.json` 與 canonical `data/catalog/visual-authority-cast/v002/manifest.json` 的實際 SHA-256 相同。
- authority snapshot 所列 38 張 current 圖片逐檔核對，38／38 存在且 SHA-256 相符。
- P1 current authority verifier 通過。
- 王婆 P2 authority verifier 通過。
- repository verifier 與 P6 verifier 因目前 Windows ACL 拒絕讀取 `data/gates/full-cast/v007/` 而未完成，不能宣稱 P6 已由本次工作重新驗證。
- `CURRENT_PACKAGE.json` 保存的 canonical manifest hash 與目前實際 manifest hash 不一致，屬正式執行前必須處理的摘要漂移。

這些值是規劃基準，不是永久寫死的來源。正式執行前必須重新讀取 `_current/characters/CURRENT_PACKAGE.json` 與 `authority-snapshot.json`：

1. 先讓 `CURRENT_PACKAGE.json` 的 canonical manifest hash 與實際 current／canonical manifest 一致，或由 Owner 明確指定以哪一個 manifest hash 作本次凍結版本；不得自行猜測舊 hash 或新 hash 誰應被覆寫。
2. 取得 `data/gates/full-cast/v007/` 的唯讀權限並重新執行 repository 與 P6 verifier。兩者通過前，可以整理角色卡與來源映射，但不得宣稱跨 repo 遷移已完成驗收。
3. 若外部 repo 已升版，重新建立十九人的來源映射並記錄新 hash，不得把新舊 authority 混用。
4. 若任何角色不再是 current authority、圖檔缺失或 hash 不符，停止該角色的圖片處理；不得退回 retired、history 或一般 reference 圖補位。

## 女性角色批次：十一位

| 角色 | 外部角色卡序號 | 一致性重點 |
| --- | ---: | --- |
| 潘金蓮 | 01 | 鎖定長橢圓臉、警覺斜睨、深藍灰與暖紅褐衣著；不得重新設計成其他常見影視版本。 |
| 李瓶兒 | 02 | 鎖定 owner-approved 臉部年齡、柔和氣質、身形與既有衣著比例。 |
| 吳月娘 | 03 | 鎖定正室的成熟身份、端整輪廓、髮式與服裝權威。 |
| 龐春梅 | 04 | 鎖定現行 master／turnaround；restricted reference pack 只作旁證，不凌駕 current authority。 |
| 宋惠蓮 | 05 | 鎖定現行成人造型、臉部身份與服裝，不以角色命運進行情色化設計。 |
| 孟玉樓 | 07 | 鎖定現行成熟年齡、臉部、體態與衣著，不年輕化成與潘、李近似的角色。 |
| 李嬌兒 | 08 | 使用 v002 現行 authority，不能退回 v001 或早期候選。 |
| 孫雪娥 | 11 | 鎖定中年形象與現行衣著，保留和其他妻妾的年齡及職責差異。 |
| 王婆 | 12 | 身份圖只鎖臉；完整體態、衣著與鞋履以 turnaround 為權威，兩者必須組合判讀。 |
| 韓愛姐 | 15 | 使用現行 authority；涉及未滿十八歲的生命階段時只作非情色、完整衣著的確定性版面組合，不進行性感化生圖。 |
| 王六兒 | 18 | 使用 repaired current authority，不得退回修復前版本。 |

## 互補主要角色批次：八位

| 角色 | 外部角色卡序號 | 一致性重點 |
| --- | ---: | --- |
| 西門慶 | 06 | 使用 v002 現行 master 與 turnaround，鎖定成年年齡、臉部與服裝。 |
| 陳經濟 | 09 | 鎖定年輕成年男性身份與現行服裝，不與西門慶做成同一種臉。 |
| 應伯爵 | 10 | 鎖定較成熟的幫閒形象、體態與衣著，避免通用文士造型。 |
| 武植 | 13 | 鎖定現行身高、體態、臉部與市井服裝，不以侮辱性漫畫比例誇張。 |
| 花子虛 | 14 | 鎖定二十四歲的現行成人身份與富戶服裝。 |
| 周秀 | 16 | 鎖定周守備的現行武職造型與成熟男性身份。 |
| 武松 | 17 | 使用 repaired current authority，不得退回修復前版本或套用《水滸傳》報告中的另一張臉。 |
| 普靜 | 19 | 使用 repaired current authority，維持年長僧人身份與服裝。 |

官哥兒不在十九人名單內；依外部 repo 規則，未來即使擴充也永久禁止建立真人身份圖。

## 格式轉換規則

外部角色卡與本 repo schema 相近但不完全相同，轉換時依下列方式處理：

| 外部欄位 | 本 repo 欄位或處理方式 |
| --- | --- |
| `name`、`aliases`、`importance`、`oneLiner` | 保留語義，並依本 repo 列舉與台灣正體規則校驗。 |
| `persona.*` | 作為側寫起點；所有 `persona.evidence` 必須重新對本 repo 的 `金瓶梅.txt` 做逐字比對。 |
| `image.style`、`image.prompt`、`image.negativePrompt`、`image.tags` | 保留已鎖定的外貌、年齡、服裝與配色內容，再補齊本 repo 的 `photoreal` 預設契約。 |
| `image.promptZh` | 對應本 repo 的 `image.promptLocal`，並檢查台灣用詞。 |
| `image.turnaround` | 作為 `image.sheet` 右上三視圖與身份一致性描述的主要來源，不直接改名冒充完整 sheet。 |
| `voice.*` | 保留可映射欄位；`voice.prompt` 維持英文，其他欄位依本 repo schema 正規化。 |
| `currentVisualAuthority`、`sourceProvenance`、`evidenceProvenance` | 不直接塞入可能不接受額外欄位的 cast schema；改寫進獨立的 `visual-authority-map.json`。 |

若外部引文因版本、異體字或標點差異無法在本 repo 的 `金瓶梅.txt` 找到，必須從本 repo 原文重新取證；不得為了通過校驗修改原文，也不得把外部 validation source 當成本 repo 的最終驗證來源。

## 設定圖轉換與身份鎖定

最終仍需符合本 repo 的 16:9 三區角色設定圖格式，但不能以純文字提示詞重新抽一張相似人物。每位角色依以下優先順序處理：

1. 以 authority snapshot 記錄的 current master 鎖定臉部、年齡、體態與主要服裝；以 current turnaround 鎖定正、側、背視圖及衣著結構。
2. 優先採確定性版面組合：從現行 authority 圖建立左側身份肖像、右上三視圖與右下服飾細節，不重新生成臉部或身體。
3. 只有確定性組合無法滿足版面時，才可用影像編輯方式製作衍生 sheet；必須同時提供該角色的 current master 與 turnaround 作參考，且不得更換演員身份、年齡、五官、體態、髮式、服裝剪裁、主色或鞋履。
4. 王婆例外：左側臉部以 identity reference 為準，右上全身與衣著、鞋履以 turnaround 為準；不得把 identity reference 的部分衣著誤判為完整權威。
5. 韓愛姐若採未成年生命階段，只允許確定性組合既有、完整衣著且非情色的權威素材，不進行生成式身體或服裝變體。
6. 每張衍生 sheet 必須人工並排比較來源 master 與 turnaround；身份、臉型、年齡感、體態、服裝剪裁或配色任一漂移即不通過。

最終目錄另存一份：

```text
testdata/benchmarks/novel-characters/classic-chinese-novels/金瓶梅-主要角色/visual-authority-map.json
```

每位角色至少記錄：canonical name、外部 package id、authority status、master 或 identity reference 的來源相對路徑與 SHA-256、turnaround 的來源相對路徑與 SHA-256、本 repo 衍生 sheet 的相對路徑與 SHA-256，以及轉換方式是 `DETERMINISTIC_COMPOSITE` 或 `REFERENCE_LOCKED_EDIT`。

此 manifest 只記錄可稽核資訊，不複製外部 repo 的 Owner 私密決策內容，也不把 restricted reference pack 宣稱為 current visual authority。

## 最終產物

```text
testdata/benchmarks/novel-characters/classic-chinese-novels/金瓶梅-主要角色/
├── 金瓶梅-主要角色-cast.json
├── 金瓶梅-主要角色-cast.md
├── report.html
├── visual-authority-map.json
└── images/
    └── <角色安全檔名>-sheet.png（十九張）
```

最終報告只呈現一份十九人群像，不另提交女性十一人報告。角色順序以敘事中心與關係可讀性安排，不以外部檔名序號機械排序。

## 執行與驗收

1. 重新驗證外部 `_current` 套件與 authority snapshot，建立十九人來源映射。
2. 對本 repo 的 `金瓶梅.txt` 按每 25 回左右分段掃描，再做全書層級別名歸併。
3. 遷移並正規化十九張角色卡，逐條重驗或替換 evidence。
4. 先校驗十一位女性角色暫存批次，再加入八位男性角色，合成唯一的十九人 cast。
5. 以本 repo 完整原著執行 `validate` 至零錯誤。
6. 依身份鎖定規則製作十九張 sheet，產生 `visual-authority-map.json` 並驗證來源及衍生檔 hash。
7. 人工逐角並排檢查外貌與服裝一致性；王婆另做身份圖／turnaround 雙來源檢查。
8. 圖片全部通過後才產生 Markdown 與 HTML，並檢查十九張圖片均正確載入。

完成條件：十九位角色零重複、原文校驗零錯誤、十九張 sheet 齊全、十九筆 provenance 映射完整、外貌一致性人工檢查全數通過，且外部 repo 零寫入、`publish_action` 維持 `NONE`。
