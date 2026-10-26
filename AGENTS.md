# AGENTS.md

> 本檔為 AI 協作者（Claude Code、Codex、Copilot 等）與人類貢獻者進入本 repo 的單一入口，只放「永遠要知道」的核心規範與指引索引；各領域細節拆在 `.agents/guides/`，需要時才讀。根目錄 `CLAUDE.md` 內容為 `@AGENTS.md`，開啟專案時會自動載入本檔。
>
> 文件語言：正體中文（zh-TW），採台灣慣用詞彙。

---

## 專案概述

**Anki-Sprache** 是一套仿 Anki 風格的多語言學習 Web App，核心特色：

- **FSRS 間隔重複**：排程由後端 `ts-fsrs` 實作，非 SM-2。
- **BYOK LLM 每日生成**：使用者自備 API Key（OpenAI / Anthropic / Google Gemini），伺服器以 AES-256-GCM 加密後儲存；每日依使用者時區於當地 04:00 自動生成當日單字卡。
- **多母語支援**：同一張 `VocabularyCard` 可有多筆 `CardTranslation`（依使用者 `nativeLanguageCode` 動態挑選）。
- **Google Identity Services 登入**：前端取得 ID Token，後端 `google-auth-library` 驗簽後簽發 JWT（access + refresh rotation）。

pnpm monorepo：`app/`（Vue 3 SPA）+ `server/`（Fastify API + BullMQ worker），後端用 Postgres 18 + Redis 7。

---

## 指引索引（動手前必讀）

**動手前先依下表讀對應檔案；跨領域任務請讀多份。** 這些檔案不會自動載入，不讀就容易違反專案慣例。

| 要做的事 | 先讀 |
|---|---|
| 了解架構、目錄結構、技術堆疊、升級依賴 | [`.agents/guides/architecture.md`](.agents/guides/architecture.md) |
| 跑 build / lint / DB / Docker 指令、執行 `server/scripts/` 維護腳本（首次安裝見 [`README.md`](README.md)） | [`.agents/guides/setup-and-commands.md`](.agents/guides/setup-and-commands.md) |
| 寫任何程式碼（Lint、TypeScript、命名、註解） | [`.agents/guides/code-style.md`](.agents/guides/code-style.md) |
| 改 `app/`（頁面、元件、Pinia store、i18n、Tailwind、路由） | [`.agents/guides/frontend.md`](.agents/guides/frontend.md) |
| 改 `server/`（路由、Prisma、FSRS、BullMQ、LLM、TTS 音檔、快取、API 清單） | [`.agents/guides/backend.md`](.agents/guides/backend.md) |
| 改每日單字生成 / `/generate/*` / worker / 補足上限 | [`.agents/guides/generation.md`](.agents/guides/generation.md) |
| 動認證、JWT、BYOK 加密、Cookie、Rate Limit、CORS | [`.agents/guides/security.md`](.agents/guides/security.md) |
| 寫測試，或宣告完成前的驗證流程 | [`.agents/guides/testing.md`](.agents/guides/testing.md) |
| 部署、Dockerfile、CI、正式環境 env | [`.agents/guides/deployment.md`](.agents/guides/deployment.md) |

---

## 絕對不要做

- 勿將 Access Token 或任何 PII 寫入 `localStorage` / `sessionStorage`。
- 勿在 log / 錯誤訊息中輸出解密後的 API Key 或 JWT。
- 勿繞過 `auth.plugin.ts`，自行解 JWT 寫在路由裡。
- 勿 commit `.env`、`server/.env`、`app/.env`（`.gitignore` 已排除）。
- 勿使用 `--no-verify` 或 `--no-gpg-sign` 跳過 hooks；hook 失敗請修根因。
- 勿手動編輯 `prisma/migrations/*.sql`（歷史 migration 已上線）。
- 勿在前端元件中硬寫中英文字串（用 i18n）。
- 勿新增可選擴充點 / feature flag / backwards-compat shim 去支援尚未存在的需求。
- 勿在 `server/` 跑 Prettier、或在 `app/` 跑 Biome（兩套 formatter 互踩會造成風格漂移）；`.prettierignore` 已排除 `server/`，請勿放行。
- 勿用 `--unsafe` 套 Biome 的 unsafe fix、或對 ESLint 用 `--fix-type` 包山包海後一鍵 commit；逐條看過再 fix。

---

## AI 輔助開發指引 (AI Assist Guidelines)

### 預設輸出語言與用語

- AI 輸出**預設為正體中文（zh-TW）**，採台灣慣用詞彙：

| 避免（簡中 / 陸用） | 建議（台灣用語） | 說明 |
|---|---|---|
| 示例 | **範例** / **示範** | `example` |
| 質量（作為 Quality） | **品質** | 「質量」僅於描述物理 mass 時使用 |
| 代碼 | **程式碼** / **程式** | `code` |
| 函数 | **函式** | `function` |
| 对象 | **物件** | `object` |
| 数组 | **陣列** | `array` |
| 字符串 | **字串** | `string` |
| 视频 | **影片** | `video` |
| 文件（指 file） | **檔案** | 「文件」僅指 document / documentation |
| 优化 | **最佳化** | `optimize` |
| 内存 | **記憶體** | `memory` |
| 登陆 / 登录 | **登入** | `login` |

註解、commit message、變數名稱可保留英文；但解說、回覆、說明文件請用正體中文。

### Context7 MCP 使用規範（強制）

> 本規範適用於所有涉及第三方套件 API / 用法的程式碼生成。

1. **若 Context7 MCP 為啟用狀態**，AI **必須優先**呼叫該工具取得第三方套件的**最新官方文件與 API 規範**。常用套件包含但不限於：
   - 前端：Vue 3、Vue Router、Pinia、Vite、Tailwind CSS 4、vue-i18n、Axios
   - 後端：Fastify、Prisma、BullMQ、ioredis、ts-fsrs、Zod、jsonwebtoken、Pino
   - LLM：`@anthropic-ai/sdk`、`openai`、`@google/generative-ai`、`google-auth-library`
   - Lint / 格式：`eslint`、`eslint-plugin-vue`、`@vue/eslint-config-typescript`、`typescript-eslint`、`eslint-config-prettier`、`@biomejs/biome`、`prettier`
   - 其他：Nuxt、Supabase（若專案未來採用）
2. 生成程式碼後，請於**文末簡要標註**：
   ```
   參考自 Context7: [庫名稱/版本]
   ```
   多個來源可用逗號分隔，例如：`參考自 Context7: Fastify 5.8, Prisma 7.8, ts-fsrs 5.3`。
3. **嚴禁僅憑內建訓練資料（Knowledge Cutoff）產生第三方 API 程式碼**，除非 Context7 無法提供相關資訊。若查無資料，請在回覆中明確註記：
   ```
   Context7 無資料，依訓練資料提供，請使用者覆核
   ```
4. 若 Context7 MCP **未啟用**，請先通知使用者並建議啟用，再決定是否以訓練資料為暫用來源（仍須加上警示註記）。

### 一般工作原則

- **計畫優先**：非瑣碎任務請先進 Plan mode 撰寫計畫，與使用者對齊後再執行。
- **最小變更**：修 bug 不做周邊整理；一次性操作不抽 helper；不為假想需求預留擴充點；三行相似程式好過早期抽象。
- **邊界驗證即可**：內部呼叫信任型別保證；僅在系統邊界（使用者輸入、外部 API）做驗證。
- **不要新增無必要檔案**：尤其是 `*.md`；計畫 / 決策紀錄一律留在對話裡，不另存檔。
- **行動謹慎**：不自行 `git push`、不強推、不 `reset --hard`、不刪 branch、不改 CI 去規避測試。破壞性動作一定要先確認。
- **UI 改動必測**：改前端的話，啟動 dev server 實際操作 golden path 與邊界；不能測就如實說「未進行瀏覽器驗證」。

### 專案特有守則

- **Google OAuth 本機測試**：先至 Google Cloud Console 把 `http://localhost:5173` 加入 Authorized JavaScript Origins。
- **Schema 守門**：後端所有路由必有 Zod schema；改 schema 務必確認 `/docs`（Swagger）仍能正確序列化。
- **秘密使用**：`MASTER_KEY`、`JWT_*_SECRET`、`GOOGLE_CLIENT_ID` 一律以 env 讀取（經 `config/env.config.ts` 校驗）；範例 / 文件一律使用 `change-me-*` 占位。
- **時區**：FSRS 排程、每日生成 fan-out 皆以使用者 `timezone` 為準；新增時區相關邏輯請使用 `Intl.DateTimeFormat` 或既有的工具函式，勿用裸 `new Date()` 做日界。
- **多母語**：生成或顯示翻譯時必經 `CardTranslation` / `ExampleSentenceTranslation` 按使用者 `nativeLanguageCode` 挑選，不可假設 `en`。

---

_日後異動請保持本檔精簡：領域細節寫進 `.agents/guides/` 對應檔案，新增 guide 時同步更新上方索引表與中文用語一致。_
