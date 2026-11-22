# 生圖模型

四種，在 `config` 裡選。主圖（錨點）和派生圖可以分開設，重出單張可以使用 `gen --model` 臨時換。
轉接器都在 `scripts/models.mjs`，統一介面：給 `{text, negative, ratio, refs[檔案路徑], seed}`，返回 PNG 位元組。

尺寸三檔（四個模型通用，都滿足 gpt-image-2 的尺寸規則，也都落在影片模型參考圖的交集裡）：

| 比例 | 尺寸 | 用在 |
| --- | --- | --- |
| 2:3 | 1056×1584 | 正面全身、側面、背面 |
| 4:5 | 1152×1440 | 大頭照 |
| 1:1 | 1328×1328 | 細節 |

影片模型參考圖的交集（H3 / Wan / Seedance）：單邊 300–5760 畫素、寬高比 0.4–2.5、單張 ≤20MB。檢查門就按這個查。

## qwen —— Qwen Image 2.1（自己的 ComfyUI）

- 連線：`COMFY_URL`，有鑑權再給 `COMFY_USER` / `COMFY_PASS`（Basic）。放環境變數，或 `config --qwen-env-file <.env>`
- 工作流：`UNETLoader`（`qwen_image_2.1_int8_convrot.safetensors`）→ `ModelSamplingAuraFlow`（shift 3.1）→
  `KSampler`（euler / simple，20 步，cfg 2.5）；`CLIPLoader`（`qwen3vl_8b_int8_convrot.safetensors`，type `qwen_image`）；
  `VAELoader`（`qwen_image_2.1_vae_bf16.safetensors`）；`EmptySD3LatentImage` 給尺寸
- 錨點使用 `CLIPTextEncode` 文生圖；派生圖使用 `TextEncodeQwenImageEditPlus`，參考圖接 `image1..3`（最多 3 張，本 skill 最多掛 2 張）
- 參考圖先 `POST /upload/image`，再 `POST /prompt`，輪詢 `/history/<id>`，從 `/view` 取圖
- 伺服器上模型檔名不一樣，改 `config.local.json` 裡 `models.qwen` 的 `unet` / `clip` / `vae`
- 實測：每張 25–50 秒，尺寸精確，身份一致性好；角度和取景全靠提示詞第一句（見 `prompting.md`）

## codex —— codex 內建生圖（GPT）

- 調本機 `codex exec`，參考圖透過 `-i` 掛上，提示詞從標準輸入給；自動找版本最高的 codex，也可 `--codex-bin` 指定
- **不要 API key，但吃 ChatGPT 訂閱額度**：Plus 約 25 張觸頂（`usage_limit_reached`），幾小時後恢復。一部劇角色多時不夠，
  使用它出錨點或補救單張，批次派生交給 qwen / openai
- 內建工具不收尺寸引數，比例寫進提示詞；實測照出了嚴格的 2:3 和 4:5
- 每張 80–160 秒。登入失效會報 401，`codex logout && codex login`
- **出的是透明背景 PNG**（看圖軟體顯示成白底，實際是透明的黑）。存檔前自動鋪成白底，記錄裡留注——影片模型拿到透明圖怎麼處理背景說不準
- 實測：角度最準（45° 更接近 45°），細節圖材質最好

## openai —— OpenAI Images API（GPT Image 2）

- key：`OPENAI_API_KEY`，放環境變數或 `config --openai-env-file <.env>`；介面地址預設 `https://api.openai.com/v1`，
  相容 OpenAI 格式的中轉使用 `--openai-base-url`（或 `.env` 裡的 `OPENAI_BASE_URL`）
- 錨點走 `POST /images/generations`；派生圖走 `POST /images/edits`（multipart，參考圖作為 `image[]`）
- 預設 `gpt-image-2`、`quality: high`。gpt-image-2 尺寸任意（兩邊 16 的倍數、總畫素 655,360–8,294,400），
  參考圖恆為高保真，不收 `input_fidelity`；沒有反向詞引數，反向詞拼成提示詞末尾的 `Avoid: …`
- 換成 `gpt-image-1` 系列會傳 `input_fidelity=high`，但它們只支援 1024×1024 / 1024×1536 / 1536×1024，
  本 skill 的尺寸會被介面拒掉——只用 gpt-image-2
- **只使用本地假伺服器驗過請求格式，沒有使用真 key 跑過**。第一次使用先出一張錨點確認

## custom:<名字> —— 自定義命令

```bash
node scripts/character-refs.mjs config --custom 'mine=mytool --prompt-file {prompt_file} --neg-file {negative_file} --ref {refs} --size {width}x{height} --out {out}'
node scripts/character-refs.mjs config --model custom:mine
```

佔位符（全部自動加引號，未知的原樣保留）：

| 佔位符 | 值 |
| --- | --- |
| `{prompt}` / `{negative}` | 提示詞 / 反向詞正文；Windows 命令列會把換行折成空格，需要保留換行時使用下面的檔案佔位符 |
| `{prompt_file}` / `{negative_file}` | 寫好的文字檔案路徑（長提示詞使用這個更穩） |
| `{refs}` | 參考圖路徑，空格分隔；錨點沒有參考圖時為空 |
| `{ref1}` `{ref2}` `{ref3}` | 單張參考圖，沒有就是空字串 |
| `{out}` | 命令必須把 PNG 寫到這裡 |
| `{width}` `{height}` `{ratio}` | 尺寸與比例 |
| `{seed}` | 種子 |

同一條模板要能處理有參考圖和沒有參考圖兩種情況（錨點沒有）。命令退出後 `{out}` 不存在就算失敗，報錯帶上 stderr 前 300 字。

## 換模型

一致性來自同一張錨點，不來自同一個模型。實測組合（沈知微，每種 1 個種子）：

| 錨點 | 派生 | 結果 |
| --- | --- | --- |
| Qwen | GPT | 7/7 一次全對，細節圖最好 |
| GPT | Qwen | 可用，Qwen 完全跟隨 GPT 錨點的設計（七分袖也照著出） |
| Qwen | Qwen + GPT 混用 | 銜接得上，細節圖之間有輕微亮度差 |

推薦：派生預設 qwen（快、不吃額度），出不好的單張使用 `gen <檢視> --model codex` 重出。
