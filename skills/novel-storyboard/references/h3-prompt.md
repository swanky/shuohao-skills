# H3 影片提示詞 · 寫法規範（內化版）

方法論學自 MiniMax-H3 官方提示詞指南（I2VA / 多圖對齊模式），**內化成本 skill 自帶文件——不依賴任何外部 skill**。寫每段的 `h3Prompt` 照這份做，結構部分有品質門逐字對賬。

**正文內容怎麼寫（一個運鏡、動作要做得完、臺詞逐字、聲音分層、不寫畫風）見 `shot-writing.md`，本文只講 H3 特有的語法和欄位。**

## 語言分工

- **預設整條英文**（`promptLang: 'en'`）——官方規範的口徑：正文、對齊指令、欄位名、鏡頭標記全英文，禁角色名（用 an old ferryman 這類通用身份）
- 三樣東西保留原文語言（官方規定）：**臺詞**（`<d>[Chinese] …</d>` 逐字原文，一個標點都不許動，門盯著）、歌詞、畫面裡可見的文字（英文雙引號原樣引用）
- `promptLang: 'zh'` 可切整條中文（對齊指令、欄位名、鏡頭標記都有中文版）——偏離官方推薦的備選項，實測中文效果不穩就回英文。**禁角色名這一條不跟著語言變**：它來自官方規範，中文版同樣用通用身份

## 結構（validate 逐字對賬的部分）

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 3.00-second mark of the target video; ….
（單分鏡的段改用官方 I2VA 固定句：For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.）

integrated_multimodal_description:
[Shot 1] 按 <Picture 1> 的構圖錨定人物與狀態，再寫這幾秒發生什麼、鏡頭怎麼動、誰說了什麼（全英文，**不寫畫風句**——畫風由呼叫方統一附加）。
[Shot 2] At 00:03.000, the camera cuts to <Picture 2>: ……（**每個鏡頭獨立一行**，切點時刻開頭，等於前面分鏡秒數的累計）

overall_soundscape: 1–4 句英文：環境聲、動作聲、非語言人聲。不復述臺詞。

non_diegetic_music: 1–3 句英文寫配器與速度（角色聽不見、只有觀眾聽得見）。沒有就寫 N/A。
```

中文模式（promptLang=zh）的對應 token：`參考圖與目標影片的對齊——` / `整體視聽描述：` / `[鏡頭 k] 於 00:0X.XXX，`，配樂沒有寫「無」。

首行對齊指令和切點時刻**由分鏡秒數推導**，改了秒數忘改提示詞，validate 當場攔。

## 運鏡詞按語言

內容規則（一切一個運鏡、寫成動作句）見 `shot-writing.md`。H3 特有的是**詞的語言**：英文模式用官方詞（static shot / push in / tracking shot……），中文模式用詞表的中文詞（固定/推/拉/跟拍……）——門按 `promptLang` 檢查，且**必須落在自己那一行裡**。

## 說話人與臺詞

- 臺詞逐字、身份寫在臺詞外面（見 `shot-writing.md`）。H3 特有的是**標記方式**：臺詞進 `<d>[Chinese] …</d>`，`<d>` 裡只放語言標籤和臺詞原文
- 說話人編號 `(S1)` `(S2)` 全段穩定，第一次出現給足辨識資訊（身份、年齡段、音色、語速）；同說不同人用 `(S1,S2)`
- **畫外音**：中文寫「以畫外音說（唇形完全閉合）」；英文用官方句式 `says in an off-screen voiceover … while their lips remain completely closed`
- 畫面裡真實可見的文字（招牌、字條）用英文雙引號原樣引用，不翻譯

## 聲音欄位名

三層怎麼分見 `shot-writing.md`。落到 H3 的欄位：臺詞、歌聲、劇內音樂 → `integrated_multimodal_description` 的鏡頭行；環境與動作聲 → `overall_soundscape`；配樂 → `non_diegetic_music`（沒有寫 `N/A`，中文模式寫「無」）。

## 關鍵幀在 H3 裡怎麼引用

主分鏡圖（f1）釘 0.00 秒，是這一段世界觀的完全參照；每個 `[Shot k]` 先寫 `<Picture k>` 錨定這一切的構圖與人物狀態，再寫動作展開。動作能不能做完、人物此刻在哪要和圖一致，見 `shot-writing.md`。
