# 衣櫃顧問 Wardrobe Advisor

一個會記得你衣櫃的 AI 穿搭與購物顧問。在店裡拍下衣服和吊牌，它會對照「你已經有什麼、還缺什麼、喜歡哪些品牌、身形與預算」，告訴你值不值得買。

An AI wardrobe and shopping advisor that remembers what you own, what you still need, and which brands you like. Bring your own OpenAI, Anthropic or Google Gemini API key. No server, no account: everything stays in your browser.

## 功能

- **顧問**：打字或附照片（最多 3 張）發問。快速問題：還缺什麼、推薦品牌、用現有衣服搭一套、這件值不值得買。
- **自動記憶**：顧問發現該記下的事（買了新衣服、新偏好、缺什麼、品牌看法），會在回答下方列出「套用／略過」，你確認後才寫入。
- **衣櫃**：依類別分組、可搜尋，記錄顏色、品牌、材質、備註。
- **待買**：分優先程度，買到按 ✓。可請顧問分析缺口。
- **品牌筆記**：喜歡、想認識、普通、不喜歡。可請顧問推薦新品牌。
- **偏好**：風格、身形與版型、預算、地區氣候、喜歡與不喜歡的。
- **多人**：同一個 app 可以有好幾個衣櫃（例如「我」和家人）。
- **備份**：匯出、匯入 JSON（不含 API key），可以換電腦、換瀏覽器。
- **範例資料**：設定裡可以載入一組虛構的範例衣櫃先試用。

## 隱私與安全

- 沒有後端。衣櫃資料和 API key 存在瀏覽器的 localStorage。
- 問顧問時，請求從你的瀏覽器**直接**送到你選的 AI 供應商，不經過任何第三方。
- 因為 key 存在瀏覽器裡，請不要在公用電腦使用，並建議在供應商後台設定每月用量上限。

## 使用方式

### 直接用（不需要安裝）

1. 把這個資料夾放上任何靜態網站空間（見下方部署方式），用瀏覽器打開 `index.html` 所在的網址。
2. 點右上角「設定」，選供應商、貼上自己的 API key，按「測試連線」。
3. 到「偏好」寫下自己的風格和身形，到「衣櫃」新增衣服，或直接到「顧問」拍照開始問。

API key 申請：

| 供應商 | 申請網址 | 預設模型 |
| --- | --- | --- |
| OpenAI | https://platform.openai.com/api-keys | `gpt-4o-mini` |
| Anthropic | https://console.anthropic.com/settings/keys | `claude-sonnet-5-5` |
| Google Gemini | https://aistudio.google.com/apikey | `gemini-flash-lite-latest` |

預設模型名稱可能會過時，可以在設定裡改成供應商目前提供、而且看得懂照片的模型。「測試連線」超過 20 秒沒有回應就會停下來並顯示原因。

Gemini 小提醒：新申請的 key 不一定能用每個模型。`gemini-flash-lite-latest` 速度快、免費額度內通常可用；`gemini-flash-latest` 比較聰明，但回答前會思考較久。Gemini app 的付費訂閱和 API 額度是分開計算的。

### 部署

整個 app 就是一個 `index.html`，不需要建置步驟：

- **GitHub Pages**：把資料夾推上 GitHub，Settings → Pages → 選 main 分支根目錄。
- **Vercel / Netlify / Cloudflare Pages**：直接拖曳資料夾上傳，或連結 repo，不需要設定 build 指令。
- **本機**：建議用 `python3 -m http.server` 開一個本機伺服器再打開 `http://localhost:8000`。直接雙擊檔案也能用，但部分瀏覽器對 `file://` 的限制比較多。

## 專案結構

```
index.html                 開源版（自備 API key），由 build.py 產生
claude-builtin/index.html  Claude 版（在 claude.ai 上以 artifact 執行，用 Claude 回答、資料存在使用者自己的帳號空間）
src/core.html              共用的介面與邏輯
src/adapter-oss.js         開源版：localStorage + OpenAI / Anthropic / Gemini
src/adapter-claude.js      Claude 版：claude.ai artifact 的 db 與 sample 能力
build.py                   把 core 和 adapter 組成兩個版本：python3 build.py
test/                      Playwright 測試（AI 回應用假資料模擬）
```

修改後執行 `python3 build.py` 重新產生兩個 `index.html`。

### 新增其他 AI 供應商

在 `src/adapter-oss.js`：

1. 在 `PROVIDERS` 加一筆（顯示名稱、預設模型、申請網址）。
2. 在 `buildRequest()` 組出該供應商的請求格式，`parseReply()` 取出回答文字。
3. 執行 `python3 build.py`。

很多服務（OpenRouter、本機的 Ollama 等）提供 OpenAI 相容的 API，可以參考 `openai` 分支改網址即可。

### 測試

```
pip install playwright && playwright install chromium
python3 build.py
python3 test/test_open_source.py
python3 test/test_claude_builtin.py
```

測試會攔截 AI 供應商的網址並回傳假資料，不會真的呼叫 API、也不會花錢。

## 記憶更新的格式

顧問需要更新資料時，會在回答最後附上一個 `wardrobe-actions` 區塊（使用者看不到原文，只看到「套用／略過」按鈕）：

```wardrobe-actions
[{"type":"add_item","category":"襯衫","name":"淺藍牛津襯衫","color":"淺藍","brand":"Uniqlo","material":"100% 棉"}]
```

支援的動作：`add_item`、`remove_item`、`add_wish`、`complete_wish`、`set_brand`、`set_pref`。詳見 `src/core.html` 的 `systemPrompt()` 與 `apply()`。

## 授權

MIT License，見 `LICENSE`。
