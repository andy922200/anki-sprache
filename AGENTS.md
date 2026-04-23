# AGENTS.md

> 本檔為 AI 協作者（Claude Code、Codex、Copilot 等）與人類貢獻者進入本 repo 的單一事實來源。根目錄 `CLAUDE.md` 內容為 `@AGENTS.md`，開啟專案時會自動載入本檔。
>
> 文件語言：正體中文（zh-TW），採台灣慣用詞彙。

---

## A. 專案概述 (Project Overview)

**Anki-Sprache** 是一套仿 Anki 風格的多語言學習 Web App，核心特色：

- **FSRS 間隔重複**：排程由後端 `ts-fsrs` 實作，非 SM-2。
- **BYOK LLM 每日生成**：使用者自備 API Key（OpenAI / Anthropic / Google Gemini），伺服器以 AES-256-GCM 加密後儲存；每日依使用者時區於當地 04:00 自動生成當日單字卡。
- **多母語支援**：同一張 `VocabularyCard` 可有多筆 `CardTranslation`（依使用者 `nativeLanguageCode` 動態挑選）。
- **Google Identity Services 登入**：前端取得 ID Token，後端 `google-auth-library` 驗簽後簽發 JWT（access + refresh rotation）。

### 架構與部署

```
┌──────────────┐   HTTPS + Cookies    ┌──────────────┐
│  app (Vue3)  │ ───────────────────▶ │  server (API)│─── Prisma ──▶ Postgres 16
│  Vite SPA    │ ◀─────────────────── │  Fastify 5   │─── ioredis ─▶ Redis 7
└──────────────┘   JWT + refresh      └──────────────┘                    ▲
                                              │                           │
                                              ▼ BullMQ                    │
                                     ┌──────────────┐                     │
                                     │  worker      │ ───────────────────┘
                                     │  BullMQ      │  （每小時 fan-out、
                                     └──────────────┘   每使用者當地 04:00 生成）
```

部署目標為 **Zeabur**，拆成五個服務：`postgres`（Template）、`redis`（Template）、`server`（Docker）、`worker`（Docker）、`app`（Docker）。

### 技術堆疊

| 層級 | 主要套件 |
|---|---|
| Monorepo | pnpm workspaces（`app/` + `server/`），pnpm 9.12.0 |
| Frontend | Vue 3.5、TypeScript 5.6、Vite 5.4、Tailwind CSS 4（beta）、Pinia 2.2、Vue Router 4.4、vue-i18n 10、Axios 1.7 |
| Backend | Fastify 5、Prisma 5、PostgreSQL 16、Redis 7、BullMQ 5、ts-fsrs 4.4、Zod 3.23、Pino 9、jsonwebtoken 9 |
| LLM SDKs | `@anthropic-ai/sdk`、`openai`、`@google/generative-ai`、`google-auth-library` |
| 安全 | `@fastify/helmet`、`@fastify/cors`、`@fastify/rate-limit`、`@fastify/cookie`、AES-256-GCM |
| 測試 | Vitest 2.1（前端 + 後端） |
| 容器 | Docker Compose（dev：postgres + redis） |

### 目錄結構速覽

```
anki-sprache/
├── app/                    # Vue 3 SPA
│   └── src/
│       ├── pages/          # 7 個頁面元件（含 404）
│       ├── components/     # layout / cards / common
│       ├── stores/         # Pinia: auth / cards / settings / ui
│       ├── api/            # 8 個 API client 模組
│       ├── composables/    # useAxios / useTheme
│       ├── i18n/locales/   # en.json、zh-TW.json
│       ├── router/         # 路由 + 守衛
│       └── types/          # domain DTO
├── server/                 # Fastify API + BullMQ worker
│   ├── src/
│   │   ├── app.ts          # Fastify builder（plugin + route 註冊）
│   │   ├── index.ts        # HTTP 入口
│   │   ├── worker.ts       # BullMQ worker 入口
│   │   ├── config/env.ts   # Zod 校驗的環境變數
│   │   ├── modules/        # auth / users / settings / llmKeys / languages / cards / reviews / generation
│   │   └── shared/
│   │       ├── crypto/aesGcm.ts
│   │       ├── fsrs/scheduler.ts
│   │       ├── llm/        # adapters + prompts + retry
│   │       └── plugins/    # auth / prisma / redis / bullmq / errorHandler
│   └── prisma/             # schema.prisma、seed.ts、migrations/
├── docker-compose.yml      # dev 用 postgres + redis
├── pnpm-workspace.yaml
├── .env.example / .editorconfig / .prettierrc / .nvmrc
├── README.md
├── CLAUDE.md               # 僅為 @AGENTS.md 參照
└── AGENTS.md               # 本檔
```

---

## B. 建構與測試指令 (Build & Test Commands)

### 環境需求

| 項目 | 版本 |
|---|---|
| Node.js | `>=20.10.0`（`.nvmrc` 鎖定 `20.18.0`） |
| pnpm | `9.12.0`（`packageManager` 鎖定） |
| Docker Desktop | 任意近期版本（需能跑 compose v2） |

### 首次設定

```bash
pnpm install                      # 安裝所有 workspace 相依
pnpm docker:up                    # 啟動 Postgres 16 + Redis 7
cp .env.example .env              # 根範本
cp server/.env.example server/.env
cp app/.env.example app/.env
# 編輯 .env：填入 GOOGLE_CLIENT_ID、產生 JWT_*_SECRET 與 MASTER_KEY
pnpm db:migrate                   # 套用 Prisma migrations
pnpm db:seed                      # 匯入語言種子資料
```

### 產出秘鑰

```bash
# JWT secrets（≥ 32 字元）
openssl rand -base64 48

# BYOK master key（32 bytes，base64）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 指令彙整

| 分類 | 指令 | 作用 |
|---|---|---|
| 開發（全部） | `pnpm dev` | 以 `-r --parallel` 同時啟動 `app` 與 `server` |
| 開發（單一） | `pnpm dev:app` | Vite dev server，port **5173**（`strictPort: true`） |
|  | `pnpm dev:server` | Fastify（tsx watch），port **3000** |
|  | `pnpm dev:worker` | BullMQ worker（獨立程序，正式環境務必拆開） |
| 建置 | `pnpm build` | 兩個 workspace 皆 build（前端 `vue-tsc --noEmit && vite build`；後端 `tsc -p tsconfig.build.json`） |
| 型別檢查 | `pnpm typecheck` | 全 workspace 跑 `tsc --noEmit` / `vue-tsc --noEmit` |
| 程式碼檢查 | `pnpm lint` | 目前為 pass-through（尚未導入 ESLint，詳見 C 節） |
| 測試 | `pnpm test` | 全 workspace 跑 `vitest run` |
|  | `pnpm --filter server test:watch` | 後端 watch 模式 |
| 資料庫 | `pnpm db:migrate` | `prisma migrate dev`（含 generate + 套用） |
|  | `pnpm db:seed` | 執行 `prisma/seed.ts`（`tsx`） |
|  | `pnpm db:studio` | Prisma Studio（port 5555） |
| Docker | `pnpm docker:up` | 背景啟動 postgres + redis |
|  | `pnpm docker:down` | 停止容器（volumes 保留） |
| 正式執行 | `pnpm --filter server start` | `node --env-file=.env dist/index.js` |
|  | `pnpm --filter server start:worker` | 啟動已 build 的 worker |
|  | `pnpm --filter app preview` | 預覽前端 production 打包 |

### API 文件

後端啟動後：`http://localhost:3000/docs`（Swagger UI，由 `@fastify/swagger` + `@fastify/swagger-ui` 產生）。

---

## C. 程式碼風格規範 (Code Style Guidelines)

### 格式工具

- **Prettier 3.3**（根 `.prettierrc`）：
  - `semi: false`
  - `singleQuote: true`
  - `trailingComma: 'all'`
  - `printWidth: 100`
  - `arrowParens: 'always'`
  - `endOfLine: 'lf'`
- **EditorConfig**（根 `.editorconfig`）：UTF-8、LF、2 空格縮排、保留最後換行、去除行尾空白（`.md` 除外）。
- **ESLint**：目前**未設定**。短期以 Prettier + `tsc --noEmit` 為守門；若新增請於根層導入 flat config，同時為兩個 workspace 提供規則。

### TypeScript

- 前後端皆啟用 `strict: true` 與 `noUncheckedIndexedAccess: true`。
- 前端：`target: ES2022`、`module: ESNext`、`moduleResolution: bundler`、`jsx: preserve`、`noEmit: true`。
- 後端：`target: ES2022`、`module: NodeNext`、`moduleResolution: NodeNext`、`outDir: dist`；`tsconfig.build.json` 另外排除 `**/*.test.ts`、`**/*.spec.ts`、`__tests__/`。
- 路徑別名統一 `@/*` → `./src/*`。

### 模組與匯入

- 後端 `"type": "module"`（純 ESM）；相對 import **必須帶副檔名**（例：`./foo.js`），即便原始檔為 `.ts`。
- 前端以 Vite 打包，無此限制，但請維持一致的 `@/` 別名風格。

### 命名慣例

| 類型 | 規則 | 範例 |
|---|---|---|
| 檔名 | kebab-case | `auth.routes.ts`、`use-theme.ts` |
| Vue 元件檔 | PascalCase | `AppButton.vue`、`FlipCard.vue` |
| 類別 / 型別 / Interface | PascalCase | `UserDto`、`GenerateForUserInput` |
| 變數 / 函式 | camelCase | `submitReview()`、`userId` |
| 常數 | UPPER_SNAKE_CASE | `LOCK_TTL_SECONDS` |
| Enum 值 | UPPER_SNAKE | `'GOOGLE'`、`'LEARNING'` |
| API 路徑 | kebab-case | `/me/llm-keys/:provider` |
| Pinia Store | `*.store.ts`，`defineStore('name', ...)` | `auth.store.ts` |

### Vue 元件

- 僅使用 `<script setup lang="ts">`；禁用 Options API。
- props / emits 以泛型 `defineProps<T>()` / `defineEmits<T>()` 宣告。
- 樣式採 Tailwind utility-first；必要時用 `<style scoped lang="scss">`。
- 圖示統一使用 Unicode emoji（目前無引入 icon library）。

### Fastify 後端

- 路由一律使用 `fastify-type-provider-zod`，每個路由有 `schema: { body/params/query/response }`。
- 例外交給 global `errorHandler`（`shared/plugins/errorHandler.ts`），回應一律為 `{ statusCode, error, message }`，Zod 失敗回 400 + issues。
- HTTP 錯誤使用 `app.httpErrors.*`（來自 `@fastify/sensible`）。
- Prisma 交易使用 `prisma.$transaction(async (tx) => { ... })`；跨步驟的寫入請放交易內。

### i18n

- 新增 UI 字串必須同時更新 `app/src/i18n/locales/en.json` 與 `zh-TW.json`。
- 切勿於元件內硬寫中英文字串；使用 `const { t } = useI18n()` 後以鍵取值。

### 註解

- **預設不寫**；好的識別字即是文件。
- 僅在「為什麼」非顯而易見（隱藏約束、workaround、效能取捨）時才寫一行說明。
- 不寫「什麼（WHAT）」或追蹤資訊（issue 編號、"added for X" 等 → 交給 commit message / PR）。

---

## D. 測試指南 (Testing Instructions)

### 框架與環境

| Workspace | 框架 | 環境 | 設定 |
|---|---|---|---|
| `app` | Vitest 2.1 | `happy-dom` | `app/vite.config.ts` 的 `test` 區塊，`globals: true` |
| `server` | Vitest 2.1 | Node.js（預設） | 無獨立 config，使用預設 |

### 指令

```bash
pnpm test                              # 全 workspace
pnpm --filter app test                 # 前端
pnpm --filter server test              # 後端
pnpm --filter server test:watch        # 後端 watch 模式
```

### 現況

- 測試基礎設施**已就位**，但目前**尚無測試檔**。
- 尚未引入 Playwright / Supertest / Testing Library；如需 E2E 或 API integration test，請先與 owner 討論方向。
- 尚未設定覆蓋率（未來可用 `vitest --coverage` 搭配 v8 provider）。

### 新增測試放置位置

- 前端：與受測檔同層的 `*.spec.ts`，或 `app/src/**/__tests__/` 目錄下。
- 後端：`server/src/**/*.test.ts`（build 時由 `tsconfig.build.json` 自動排除）。

### 手動端到端驗證流程

修改 API / 頁面 / FSRS / 生成流程後，至少跑過一次下列路徑再宣告完成：

1. `pnpm docker:up`
2. `pnpm db:migrate && pnpm db:seed`
3. 三個終端機分別 `pnpm dev:server`、`pnpm dev:worker`、`pnpm dev:app`
4. 瀏覽器走：`/login` → Google 登入 → `/` Dashboard 觸發生成 → `/review?mode=FLIP` → `/review?mode=choice` → `/logbook` → `/settings` → `/settings/api-keys`
5. 開啟 `http://localhost:3000/docs` 核對 Swagger Schema 是否仍合法

### UI 變更

文件或程式碼本身無法驗證「功能是否好用」。若改動 UI，請**實際在瀏覽器操作**並觀察 golden path 與邊界；若無法測，回報時明確說明「未進行瀏覽器驗證」。

---

## E. 安全性考量 (Security Considerations)

### 認證流程

1. 前端透過 GIS（`https://accounts.google.com/gsi/client`）取得 ID Token。
2. `POST /auth/google` 帶 idToken → 後端 `google-auth-library` 以 `audience: GOOGLE_CLIENT_ID` 驗簽，並檢查 `payload.email_verified === true`。
3. 首次登入於交易內建立 `User` + `OAuthAccount` + `UserSettings`。
4. 簽發 access token（Authorization header）+ refresh token（httpOnly cookie）。

### JWT Rotation

| Token | 存放位置 | 預設 TTL | 來源 env | 備註 |
|---|---|---|---|---|
| Access | Pinia 記憶體（**不**存 localStorage） | `ACCESS_TOKEN_TTL`（預設 15m） | `JWT_ACCESS_SECRET`（≥ 32 字元，Zod 強制） | `Authorization: Bearer <token>` |
| Refresh | httpOnly cookie `refresh_token` | `REFRESH_TOKEN_TTL`（預設 30d） | `JWT_REFRESH_SECRET`（≥ 32 字元） | DB 只存 SHA-256 hash，輪替時舊 token 標記 `revokedAt` |

驗證路徑：`server/src/modules/auth/auth.service.ts`、`server/src/shared/plugins/auth.plugin.ts`。

前端在收到 401 時由 `composables/useAxios.ts` 透過單一共享的 `refreshPromise` 呼叫 `/auth/refresh`，避免並發重複輪替。

### BYOK AES-256-GCM 加密

- 檔案：`server/src/shared/crypto/aesGcm.ts`
- 演算法：AES-256-GCM（Node.js 原生 `crypto`，具 authenticated encryption）。
- Master Key：`MASTER_KEY` env（base64 解碼後必須為 32 bytes，Zod 校驗）。
- 每筆資料：獨立 12-byte IV + auth tag，與 ciphertext 一同存於 `LlmApiKey` 三欄（`encryptedKey`、`iv`、`authTag`）。
- 指紋：SHA-256 前 12 字元，供 UI 顯示以便辨識，**不**外洩原始金鑰。
- 原始金鑰僅在 `generation.service.ts` 呼叫 LLM 當下解密於記憶體，**永不寫入 log、永不回傳前端**。
- 一旦 `MASTER_KEY` 外洩，需要重新加密所有 `LlmApiKey` 或要求使用者重新輸入。

### Cookie 策略

```ts
{
  httpOnly: true,
  secure: env.COOKIE_SECURE || isProd,   // production 必定為 true
  sameSite: 'lax',                        // 允許 top-level 導航、阻擋跨站 XHR
  path: '/',
  domain: env.COOKIE_DOMAIN || undefined, // localhost 請省略
}
```

### Rate Limit（Redis 後端）

| 範圍 | 限制 |
|---|---|
| 全域（預設） | 300 req/min，key 為 `req.user.userId` 或 IP |
| `POST /auth/google` | 10 req/min |
| `POST /auth/refresh` | 60 req/min |
| `POST /reviews` | 120 req/min |
| `POST /generate/today` | prod 5/hr、dev 60/hr |
| `POST /generate/more` | prod 10/hr、dev 60/hr |

### 其他防護

- **Helmet**：啟用預設安全標頭；CSP 目前未開啟（為允許 GIS 腳本與 LLM SDK XHR），需加強時請同步調整前端 `index.html` 與 cookie 設定。
- **CORS**：`CORS_ORIGIN` 逗號分隔多來源、`credentials: true`，預設 `http://localhost:5173`。
- **輸入驗證**：所有路由皆以 Zod schema 驗證；違反回 400 + issues 陣列。
- **秘密管理**：
  - `.env`、`server/.env`、`app/.env` 皆在 `.gitignore`；**不得** commit。
  - 範例值請一律使用 `change-me-*` 占位。
  - `JWT_*_SECRET` 與 `MASTER_KEY` 請以 `openssl` / `crypto.randomBytes(32)` 產生。
- **前端存儲**：僅主題偏好會寫入 `localStorage`（key: `theme`）；任何 token 或 PII 都**不得**寫入。

---

## F. 頁面細節與權限 (Page Details & Permissions)

### 路由守衛規則

- 所有路由定義於 `app/src/router/index.ts`，`beforeEach` guard 會先 `auth.hydrate()`。
- 未標記 `meta.public: true` 的路由皆需登入；未登入會被導向 `/login?redirect=<原目標>`。
- 已登入者訪問 `/login` 會被導去 `/`。
- 本專案**無角色分級**：所有登入使用者權限相同，無 admin 專區；資源隔離透過 `userId` 綁定完成。

### 前端頁面與子頁面

| 路徑 | 元件 | 公開 / 需登入 | 子頁面 | 主要功能 | Query / Params |
|---|---|---|---|---|---|
| `/login` | `LoginPage.vue` | 公開（`meta.public`） | — | Google Sign-In；成功後導向 `redirect` 或 `/` | `?redirect=<path>` |
| `/` | `DashboardPage.vue` | 需登入 | — | 每日生成狀態（3 秒輪詢、上限 50 次）、LLM 設定檢查、今日 5 張卡預覽、Flip / 選擇題 / 練習模式入口 | — |
| `/review` | `ReviewPage.vue` | 需登入 | — | 複習介面；支援 FSRS 正式複習與 Practice 模式；快速鍵 1–4 評分、Space / Enter 翻面 | `mode=FLIP\|choice`、`practice=true` |
| `/logbook` | `LogbookPage.vue` | 需登入 | — | 複習紀錄分頁（每頁 50 筆），可按評分與模式篩選 | — |
| `/settings` | `SettingsPage.vue` | 需登入 | `/settings/api-keys` | 個人資料、目標 / 母語、CEFR、每日新詞數、偏好 LLM Provider + Model、主題、UI 語系 | — |
| `/settings/api-keys` | `ApiKeysPage.vue` | 需登入 | —（Settings 子頁面） | OpenAI / Anthropic / Google API Key 管理；僅顯示 12 字元指紋；新增 / 取代 / 刪除 | — |
| `/:pathMatch(.*)*` | `NotFoundPage.vue` | 公開 | — | 404 Fallback | — |

合計 **7 個路由**，其中 `/settings/api-keys` 為 `/settings` 的子頁面。

### 後端 API 權限矩陣

| Method | 路徑 | 需登入 | Rate Limit | 備註 |
|---|---|---|---|---|
| POST | `/auth/google` | ❌ | 10/min | Google ID Token 登入 |
| POST | `/auth/refresh` | ❌（需 cookie） | 60/min | Refresh rotation |
| POST | `/auth/logout` | ✅ | — | 撤銷 refresh token |
| GET | `/me` | ✅ | — | 個人資料 |
| PATCH | `/me` | ✅ | — | `displayName`、`timezone` |
| GET | `/me/settings` | ✅ | — | 學習偏好 |
| PATCH | `/me/settings` | ✅ | — | 目標 / 母語、CEFR、每日新詞數、LLM 偏好、主題、UI 語系 |
| GET | `/me/llm-keys` | ✅ | — | 回傳 masked 指紋 |
| PUT | `/me/llm-keys/:provider` | ✅ | — | `provider` ∈ {OPENAI, ANTHROPIC, GOOGLE} |
| DELETE | `/me/llm-keys/:provider` | ✅ | — | — |
| GET | `/languages` | ✅ | — | 可用語言清單 |
| GET | `/cards/today` | ✅ | — | 當日卡組（無論是否到期） |
| GET | `/cards/due` | ✅ | — | 到期卡；60 秒 Redis 快取 |
| GET | `/cards/:id` | ✅ | — | 單卡，支援 ETag 304 |
| POST | `/reviews` | ✅ | 120/min | 寫入後失效快取 |
| GET | `/reviews/logbook` | ✅ | — | Cursor 分頁，支援 rating / mode 篩選 |
| POST | `/generate/today` | ✅ | prod 5/hr、dev 60/hr | 202 Accepted 或 200（已完成） |
| POST | `/generate/more` | ✅ | prod 10/hr、dev 60/hr | 追加 N 張卡 |
| GET | `/generate/status` | ✅ | — | 生成狀態 + 近期錯誤 |
| GET | `/health` | ❌ | — | 健康檢查 |
| GET | `/docs` | ❌ | — | Swagger UI |

---

## G. 最佳實踐與注意事項 (Best Practices & Notes)

### 新增功能的既定路徑

- **新增後端路由**：於 `server/src/modules/<domain>/` 建立 `*.routes.ts` + `*.service.ts` + `*.schema.ts`（Zod），並在 `server/src/app.ts` 統一註冊；務必附 response schema 以讓 `/docs` 自動生成正確。
- **新增前端頁面**：在 `app/src/pages/` 建立 `*.vue`，在 `router/index.ts` 加入路由；需要導航時同步更新 `components/layout/AppHeader.vue`。
- **新增 Pinia Store**：命名 `*.store.ts`，放 `app/src/stores/`，以 `defineStore('name', () => { ... })` 的組合式風格撰寫。
- **新增 i18n 鍵**：同時改 `en.json` 與 `zh-TW.json`，保持鍵結構一致。
- **新增 Prisma 模型**：`schema.prisma` 改完跑 `pnpm db:migrate`（dev 會 `prisma migrate dev`），勿手改 `migrations/*.sql`；種子改動請同步 `prisma/seed.ts`。

### 既有工具必用

- **FSRS 排程**：一切 `UserCardState` 更新必經 `server/src/shared/fsrs/scheduler.ts`；前端**不得**自行計算下次到期日。
- **BullMQ Queue**：新增佇列於 `shared/plugins/bullmq.plugin.ts` 註冊；生成類任務必搭 Redis 鎖（`SET ... NX`）避免同 `userId + date` 重複執行。
- **LLM 呼叫**：統一透過 `shared/llm/llmClient.ts` 工廠 + `retry.ts` 指數退避，prompt 放 `shared/llm/prompts/`；每次呼叫都必須寫入 `LlmUsageLog`（成功 / 失敗皆是）。
- **快取**：`/cards/due` 有 60 秒 Redis 快取、`/cards/:id` 用 ETag；`POST /reviews` 成功後必須走既有的 invalidation（key 樣板 `cards:due:<userId>:*`）。

### 絕對不要做

- 勿將 Access Token 或任何 PII 寫入 `localStorage` / `sessionStorage`。
- 勿在 log / 錯誤訊息中輸出解密後的 API Key 或 JWT。
- 勿繞過 `auth.plugin.ts`，自行解 JWT 寫在路由裡。
- 勿 commit `.env`、`server/.env`、`app/.env`（`.gitignore` 已排除）。
- 勿使用 `--no-verify` 或 `--no-gpg-sign` 跳過 hooks；hook 失敗請修根因。
- 勿手動編輯 `prisma/migrations/*.sql`（歷史 migration 已上線）。
- 勿在前端元件中硬寫中英文字串（用 i18n）。
- 勿新增可選擴充點 / feature flag / backwards-compat shim 去支援尚未存在的需求。

### 依賴版本注意

- Tailwind CSS 4 目前為 **beta**（`@tailwindcss/vite`），升版前先查 Context7 的官方遷移指引。
- Vite 5、Vue 3.5、Fastify 5、Prisma 5、Zod 3 皆為較新主版；升版時注意 breaking changes。
- `ts-fsrs` 的 API 變動頻繁，升版前跑完 review 路徑手動驗證。

### 部署（Zeabur）

| 服務 | 來源 | 對外 |
|---|---|---|
| `postgres` | Zeabur Template | `DATABASE_URL` |
| `redis` | Zeabur Template | `REDIS_URL` |
| `server` | Docker `Dockerfile.server` | port 3000（公開） |
| `worker` | Docker `Dockerfile.worker` | 僅內部 |
| `app` | Docker `Dockerfile.app` | port 8080（公開） |

Dockerfile 依 Zeabur 命名慣例置於 **repo 根目錄**（`Dockerfile.<service-name>`）。Zeabur 依每個 service 的 **Service Name** 自動配對到對應 Dockerfile，因此 Zeabur Dashboard 上三個 service 必須命名為 `server` / `worker` / `app`，且 **Root Directory** 欄位保持空白（build context = repo root，Dockerfile 會以 pnpm workspace 方式安裝）。

`server` 與 `worker` 必填 env：`DATABASE_URL`、`REDIS_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`MASTER_KEY`、`GOOGLE_CLIENT_ID`、`CORS_ORIGIN`、`COOKIE_DOMAIN`、`COOKIE_SECURE=true`。

`app` build-time env：`VITE_API_BASE_URL`、`VITE_GOOGLE_CLIENT_ID`。

`server` 首次部署：Zeabur Console 內執行 `npx prisma migrate deploy && npx prisma db seed` 一次。

---

## H. AI 輔助開發指引 (AI Assist Guidelines)

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
   - 其他：Nuxt、Supabase（若專案未來採用）
2. 生成程式碼後，請於**文末簡要標註**：
   ```
   參考自 Context7: [庫名稱/版本]
   ```
   多個來源可用逗號分隔，例如：`參考自 Context7: Fastify 5.1, Prisma 5.22, ts-fsrs 4.4`。
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
- **秘密使用**：`MASTER_KEY`、`JWT_*_SECRET`、`GOOGLE_CLIENT_ID` 一律以 env 讀取（經 `config/env.ts` 校驗）；範例 / 文件一律使用 `change-me-*` 占位。
- **時區**：FSRS 排程、每日生成 fan-out 皆以使用者 `timezone` 為準；新增時區相關邏輯請使用 `Intl.DateTimeFormat` 或既有的工具函式，勿用裸 `new Date()` 做日界。
- **多母語**：生成或顯示翻譯時必經 `CardTranslation` / `ExampleSentenceTranslation` 按使用者 `nativeLanguageCode` 挑選，不可假設 `en`。

---

_最後更新：由本次初建的 AI 協作整理；日後異動請保持本檔結構與中文用語一致。_
