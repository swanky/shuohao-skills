# 場景設定 · 怎麼填

給你一個場景的骨架（seed 預填了 id/名稱/主場景標記/出現集/承載爽點）+ 原文或大綱裡關於這個空間的全部資訊，產出完整的場景設定。**只輸出 JSON，不要解釋、不要圍欄。**結構見 `schema.md`。

## 先想清楚：這是 AI 短劇，不是實拍

場景不是「尋找實拍場地」，而是**會被生成數十次、每次都必須維持一致的環境資產**。每個欄位都在為一致性服務：

| 欄位 | 它在解決什麼 |
| --- | --- |
| 錨點 | 觀眾靠什麼認出「又回到這裡了」；QC 靠什麼判斷生成的鏡頭沒漂 |
| 光照狀態 | 換時段 = 換提示詞重新生成，不是現場重新打光 |
| 空景 | 人是另一層資產（novel-characters 管），環境參考圖裡有人，一致性全毀 |
| 朝代 | 建築形制、傢俱、器物、紋樣共用的那個基準；不定它，每個場景各挑一個世紀 |

## 硬規則

1. **先定朝代，再寫場景。**整部劇**一個**具體的真實朝代或年代，寫進文件級的 `dynasty`：`明`、`北宋`、`民國`、`唐`。

   **不許寫「古代」「古裝」「某朝」「架空」這類詞。**它們在畫面上沒有任何對應物——模型讀到「古代府邸」只能自己挑一個，於是庭院出成宋、書房出成明、道具出成清，擺在一起不像同一部戲。這跟不許寫「架空」是同一條：關於設定的話進不了畫面，設定本身才進。

   原文沒明說就按線索推斷，**推斷出一個具體的，不要因為不確定就寫含糊的**：官職名、服制、器物、貨幣、稱謂、建築形制、節令風俗、度量衡都是線索。原著是架空設定時，寫它**像**哪個朝代——`明代風格`——而不是寫它是架空的。

   定好之後，`image.prompt`、`image.sheet`、錨點描述、光照狀態全部按這個朝代寫：斗拱樣式、傢俱腿型、窗欞紋樣、燈具形制、地面鋪裝，都有朝代差別。

2. **`summary` 寫設計意圖，不寫戶型說明。**「小到人與人躲不開視線的審訊室」是設計意圖；「約十平方公尺，六排坐板」只是測量資料。空間要為戲服務，先說它為哪場戲存在。

3. **錨點要「可畫、可認、可核對」。**好錨點：補丁船篷、斷裂的第七塊橋板、綠鏽銅鈴——生成圖裡一眼找得到，缺了立刻發現。壞錨點：「陳舊的氛圍」「歲月的痕跡」——沒法核對的不是錨點是形容詞。每個錨點 `name` 短到能進核對表，`desc` 寫清位置和特徵。

4. **光照狀態從分集反推。**這個場景在出現的那些集裡經歷了什麼時段和天氣，就寫哪些狀態。別憑空寫一套「白天/夜晚/黃昏」全家桶——用不上的狀態是維護負擔。

5. **提示詞永遠英文，永遠空景。**`image.prompt` 裡明寫 empty scene / no people，`negativePrompt` 必須禁人。**絕不出現角色名、作者名、作品名**——影像模型會把它認識的東西畫進去。

6. **提示詞裡不寫渲染風格，只寫這個地方的狀態。**不要出現 `Semi-realistic environment concept art` / `painterly rendering` 這類句子，也不要給 `image.tags` 打 `semi-realistic`、`painterly` 這種風格標。畫風是生圖那一刻才定的，整批共用一段風格指令由呼叫方附加——寫進每條提示詞只會跟當時選的風格打架，而且換風格要逐條改。

   要整段帶上的是**表面處理**，它講的是這個空間被誰在用、用了多久，換任何畫風都成立。
   **兩檔二選一，按這個空間的實際保養水平選**——不是兩種畫風，是兩種事實：

   **A · 日常使用**（民居、客棧、碼頭、作坊、久無人修的宅子）：
   ```
   Weathered, lived-in materials: chipped paint, water stains, patina on metal, worn wood grain, dust in corners and light shafts; fabric and paper props show creases and age; nothing looks factory-new. Atmospheric depth with haze or volumetric light where the space allows
   ```

   **B · 持續維護**（宮殿、官署、顯貴府邸的前廳、新建或剛整修的空間）：
   ```
   Well-kept, actively maintained materials: sound lacquer with an even sheen, swept stone and timber, polished metal fittings, tight joinery, no peeling paint and no water staining; wear confined to the traffic a space like this really takes — thresholds, handrails, the stone directly inside a doorway. Atmospheric depth with haze or volumetric light where the space allows
   ```

   **別把 A 當預設。**一整部戲全上 A，金鑾殿會出成漏雨的廢殿——實測《狀元是買的》裡 S06 金鑾殿拿到了「漆面剝落」和「門框下部有淺淡水漬」，那是全國維護最勤的一棟建築。這跟「每條提示詞必須逐字包含同一句畫風」是同一個錯誤：把一個該按物件決定的事實，寫成了一句對誰都成立的常量。

   選了 B 仍然要寫磨損，只是**磨在該磨的地方**：門檻正中、欄杆扶手、臺階踏面——人走出來的，不是年久失修出來的。

   負向提示詞打底（按場景再補）：
   ```
   people, human figures, characters, crowds, silhouettes of people, oversaturated colours, sterile showroom cleanliness, warped perspective, melted geometry, floating objects, text, watermark, signature
   ```

   `image.tags` 打底：`environment sheet`、`weathered materials`、`cinematic`——描述這是什麼圖、什麼狀態，不描述它用什麼筆法畫。

   **負向提示詞裡絕不能禁畫風詞**（`photorealistic`、`3d render`、`anime` 這些）——生圖時選的就可能正是它，禁掉等於自己跟自己打架。

7. **能做變體就別開新景。**AI 生成一個新環境很便宜，但**每多一個獨立環境就多一份一致性維護**。outline 裡帶複用方案的場景（seedNote 會提示），用 `variantOf` + `changes` 掛到母場景上：改時段、換天氣、換前景、刪道具，橋板細節這類資產直接複用。

8. **不要把角色 skill 的表面處理帶進來。**毛孔、皮下散射是皮膚的事；環境的可信度來自**用舊的材質**——掉漆、水漬、包漿、磨白的木紋。「要整段帶上的是表面處理」那兩檔已經寫好了，按這個空間的保養水平選一檔照抄。

## 輸入格式

```
Scene: S01 渡船船艙（主場景）
出現集：1–6　承載爽點：懸念鉤、身份揭破、反轉、收束

原文/大綱裡關於這個空間的資訊：
- ……
- ……

同批其他場景：S02 渡口棧橋、S03 對岸蘆葦灘
```

同批其他場景要彼此知道名稱——空間氣質必須能區分，不要把每個場景都寫成同一種「破舊」。
