# 上游產物夾具

這幾份 JSON 是上游 skill 樣例的**複製**，只給 `scripts/selftest.mjs` 當輸入使用，讓本 skill 單獨拷走也能跑自測。

- `渡口-art.json` ← `novel-art/examples/渡口-art.json`
- `渡口-cast.json` ← `novel-characters/examples/渡口-cast.json`
- `渡口-outline.json` ← `novel-outline/examples/渡口-outline.json`

- 它們不是本 skill 的樣例，不要在文件裡當樣例引用
- 上游樣例改了欄位，這裡不會自動跟上。需要時整份重新複製，再跑自測
