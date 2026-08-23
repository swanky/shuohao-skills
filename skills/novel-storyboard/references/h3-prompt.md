# H3 影片提示詞 · 寫法規範（內化版）

方法論學自 MiniMax-H3 官方提示詞指南（I2VA / 多圖對齊模式），**內化成本 skill 自帶文件——不依賴任何外部 skill**。寫每段的 `h3Prompt` 照這份做，結構部分有品質門逐字對賬。

## 語言分工

- **預設整條英文**（`promptLang: 'en'`）——官方規範的口徑：正文、對齊指令、欄位名、鏡頭標記全英文，禁角色名（用 an old ferryman 這類通用身份）
- 三樣東西保留原文語言（官方規定）：**臺詞**（`<d>[Chinese] …</d>` 逐字原文，一個標點都不許動，門盯著）、歌詞、畫面裡可見的文字（英文雙引號原樣引用）
- `promptLang: 'zh'` 可切整條中文（對齊指令、欄位名、鏡頭標記都有中文版，人名放行）——偏離官方推薦的備選項，實測中文效果不穩就回英文

## 結構（validate 逐字對賬的部分）

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 3.00-second mark of the target video; ….
（單分鏡的段改用官方 I2VA 固定句：For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.）

integrated_multimodal_description:
[Shot 1] Cinematic, live-action, cold gray-green palette. 按 <Picture 1> 的構圖錨定人物與狀態，再寫這幾秒發生什麼、鏡頭怎麼動、誰說了什麼（全英文）。
[Shot 2] At 00:03.000, the camera cuts to <Picture 2>: ……（**每個鏡頭獨立一行**，切點時刻開頭，等於前面分鏡秒數的累計）

overall_soundscape: 1–4 句英文：環境聲、動作聲、非語言人聲。不復述臺詞。

non_diegetic_music: 1–3 句英文寫配器與速度（角色聽不見、只有觀眾聽得見）。沒有就寫 N/A。
```

中文模式（promptLang=zh）的對應 token：`參考圖與目標影片的對齊——` / `整體視聽描述：` / `[鏡頭 k] 於 00:0X.XXX，`，配樂沒有寫「無」。

首行對齊指令和切點時刻**由分鏡秒數推導**，改了秒數忘改提示詞，validate 當場攔。

## 運鏡

- 詞表 20 種（schema.md 的 camera 列舉），可加幅度（小幅/大幅）與速度（緩/快），寫成自然動作句：「鏡頭小幅緩推向掐白的指節」
- **每個分鏡的運鏡詞必須落在自己那一行裡**：英文用官方詞（static shot / push in / tracking shot……），中文模式用詞表的中文詞（固定/推/拉/跟拍……）——門按 `promptLang` 檢查

## 說話人與臺詞

- 說話人第一次出現給足辨識資訊（身份、年齡段、音色、語速），編號 `(S1)` `(S2)` 全段穩定；同說不同人用 `(S1,S2)`
- `<d>` 裡只放語言標籤和臺詞原文；身份、音色、語氣寫在 `<d>` 外面
- **畫外音**：中文寫「以畫外音說（唇形完全閉合）」；英文用官方句式 `says in an off-screen voiceover … while their lips remain completely closed`
- 畫面裡真實可見的文字（招牌、字條）用英文雙引號原樣引用，不翻譯

## 聲音欄位的分工（踩過的坑）

- 臺詞、歌聲、劇內音樂 → 描述欄位；環境與動作聲 → `overall_soundscape`；配樂 → `non_diegetic_music`
- **聲景也是動作指令**：畫面動作改了，聲景必須一起改——聲景裡寫「銅鈴在撞擊時炸響」，影片就真把撞擊演出來

## 關鍵幀怎麼用

- 主分鏡圖（f1）釘 0.00 秒，是這一段世界觀的完全參照；每個 `[Shot k]` 先錨定 `<Picture k>` 的構圖與人物狀態，再寫動作展開
- 動作遵守 novel-script 的**常見動作原則**：挑擔上船、搭手卸擔這類模型見過千萬次的動作；精確物理互動、微表情不要寫
- 人物**此刻的位置狀態**（已上船 / 在艙內）要和分鏡圖一致——圖與文對不上，模型聽圖的，動作就亂
