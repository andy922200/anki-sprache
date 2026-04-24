# Anki-Sprache

一套仿 Anki 風格的多語言學習 Web App。以 **FSRS** 間隔重複排程、**使用者自備 LLM API Key（BYOK）** 自動生成每日單字卡，支援多母語翻譯與 Google 登入。

> 📖 詳細的工程規範、程式碼風格與 AI 協作指引請見 [`AGENTS.md`](./AGENTS.md)。

---

## ✨ 核心特色

- **FSRS 排程**：以 `ts-fsrs` 實作的現代間隔重複演算法，取代傳統 SM-2。
- **BYOK LLM 生成**：自行提供 OpenAI / Anthropic Claude / Google Gemini API Key，伺服器以 AES-256-GCM 加密儲存；每日依你的時區於當地 04:00 自動生成新卡。
- **多母語翻譯**：同一張單字卡可同時帶多種母語翻譯，介面會依使用者設定挑選。
- **Google 登入**：前端走 Google Identity Services，後端驗 ID Token 後簽發 JWT（access + refresh rotation，refresh token 僅存於 httpOnly cookie）。
- **FLIP 與選擇題雙模式**：支援傳統翻牌複習與 4 選 1 模式，也有不計入 FSRS 的 Practice 模式。
- **深色模式 / 繁中 · 英文介面**。

---

## 🧱 技術堆疊

| 層級 | 技術 |
|------|------|
| Monorepo | pnpm 10 workspaces（`app/` + `server/`） |
| 前端 | Vue 3.5 · TypeScript 6 · Vite 8（Rolldown）· Tailwind CSS 4 · Pinia 3 · Vue Router 5 · vue-i18n 11 |
| 後端 | Fastify 5.8（ESM）· Prisma 7（Rust-free + driver adapter）· PostgreSQL 16 · Redis 7 · BullMQ · ts-fsrs 5 · Zod 4 · Pino 10 |
| LLM | `@anthropic-ai/sdk` · `openai` · `@google/generative-ai`（已 deprecated，將遷移至 `@google/genai`） |
| 安全 | `@fastify/helmet` · `@fastify/cors` · `@fastify/rate-limit` · AES-256-GCM |
| 風格 / Lint | ESLint 10 + Prettier 3.8（前端） · Biome 2（後端，lint+format 一站式） |
| 測試 | Vitest 4 · happy-dom 20（前端） |
| 部署 | Zeabur（Docker-based） |

---

## 🏗️ 架構

```
┌──────────────┐   HTTPS + Cookies    ┌──────────────┐
│  app (Vue3)  │ ───────────────────▶ │  server (API)│─── Prisma ──▶ Postgres 16
│  Vite SPA    │ ◀─────────────────── │  Fastify 5   │─── ioredis ─▶ Redis 7
└──────────────┘   JWT + refresh      └──────────────┘                    ▲
                                              │                           │
                                              ▼ BullMQ                    │
                                     ┌──────────────┐                     │
                                     │  worker      │ ───────────────────┘
                                     │  BullMQ      │  （每小時 fan-out，
                                     └──────────────┘   每位使用者當地 04:00 生成）
```

---

## 🚀 快速開始

### 環境需求

- **Node.js** `>=22.20.0`（`.nvmrc` 鎖定 `22.22.2`，建議搭配 nvm）
- **pnpm** `10.33.2`（專案已鎖 `packageManager`，corepack 會自動啟用）
- **Docker Desktop**（本機用於跑 Postgres + Redis）

### 安裝與設定

```bash
# 1. 安裝相依
pnpm install

# 2. 啟動 Postgres + Redis
pnpm docker:up

# 3. 複製環境變數範本
cp .env.example .env
cp server/.env.example server/.env
cp app/.env.example app/.env
```

編輯 `.env` 填入：

- `GOOGLE_CLIENT_ID`（Google Cloud Console → OAuth Client，類型 Web application）
- `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`（以 `openssl rand -base64 48` 產生）
- `MASTER_KEY`（BYOK 加密主金鑰，以 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 產生）

> ⚠️ Google OAuth 本機測試需先把 `http://localhost:5173` 加入 Google Cloud Console 的 **Authorized JavaScript Origins**。

### 初始化資料庫

```bash
pnpm db:migrate    # 套用 Prisma migrations（順便 prisma generate）
pnpm db:seed       # 匯入語言種子資料
```

> Prisma 7 的 client 產物位於 `server/src/generated/prisma/`（已 gitignore）。第一次 clone 後必須跑過 `pnpm db:migrate`（或 `pnpm --filter ./server exec prisma generate`），否則 `pnpm dev:server` 會找不到 client。

### 啟動開發環境

```bash
pnpm dev           # 同時啟動 app + server
```

或分開啟動：

```bash
pnpm dev:app       # Vite dev server → http://localhost:5173
pnpm dev:server    # Fastify API    → http://localhost:3000
pnpm dev:worker    # BullMQ worker（正式環境務必獨立程序）
```

開發時可開 Swagger UI 檢視 API：<http://localhost:3000/docs>

---

## 📜 常用指令

| 指令 | 用途 |
|------|------|
| `pnpm dev` | 同時啟動 app + server |
| `pnpm build` | 前後端 production build |
| `pnpm typecheck` | 兩個 workspace 都跑 `tsc --noEmit` |
| `pnpm lint` | 兩個 workspace 跑 lint（前端 ESLint、後端 Biome） |
| `pnpm format` | 兩個 workspace 寫入格式化（前端 Prettier、後端 Biome） |
| `pnpm format:check` | dry-run 格式檢查，CI 友善 |
| `pnpm test` | 兩個 workspace 跑 `vitest run` |
| `pnpm db:migrate` | 套用 / 建立 Prisma migration |
| `pnpm db:seed` | 匯入種子資料 |
| `pnpm db:studio` | 開啟 Prisma Studio（<http://localhost:5555>） |
| `pnpm docker:up` / `pnpm docker:down` | 啟動 / 停止本機 Postgres + Redis |

---

## 🗂️ 目錄結構

```
anki-sprache/
├── app/                  # Vue 3 SPA
│   └── src/
│       ├── pages/        # 7 個頁面（Dashboard / Review / Logbook / Settings ...）
│       ├── components/   # layout · cards · common
│       ├── stores/       # Pinia stores
│       ├── api/          # API client 模組
│       ├── composables/  # useAxios · useTheme
│       └── i18n/locales/ # en.json · zh-TW.json
├── server/               # Fastify API + BullMQ worker
│   ├── src/
│   │   ├── app.ts        # Fastify builder
│   │   ├── index.ts      # HTTP 入口
│   │   ├── worker.ts     # BullMQ worker 入口
│   │   ├── modules/      # auth / users / cards / reviews / generation ...
│   │   └── shared/       # crypto · fsrs · llm · plugins
│   └── prisma/           # schema.prisma · migrations · seed.ts
├── docker-compose.yml    # dev 用 postgres + redis
├── AGENTS.md             # 工程與 AI 協作單一事實來源
└── CLAUDE.md             # 參照 AGENTS.md
```

---

## 🔒 安全設計重點

- **Access Token** 只存在 Pinia 記憶體，**不**寫入 `localStorage`；**Refresh Token** 僅存 httpOnly cookie，DB 只保留 SHA-256 hash。
- **BYOK API Key** 以 AES-256-GCM 加密儲存（每筆獨立 IV + auth tag），UI 僅顯示 SHA-256 前 12 字元指紋，原始金鑰僅在呼叫 LLM 的當下解密於記憶體。
- **Rate Limit** 以 Redis 後端實作，針對登入、refresh、review、generation 有各自的配額。
- 所有路由皆以 Zod schema 驗證；違反回 `400` + `issues` 陣列。

完整安全與認證細節請見 [`AGENTS.md` § E](./AGENTS.md#e-安全性考量-security-considerations)。

---

## ☁️ 部署（Zeabur）

以 Zeabur 作為部署目標，同一個 project 建 5 個 services：

| 服務 | 來源 | 對外 |
|------|------|------|
| `postgres` | Zeabur Marketplace | 內部（提供 `DATABASE_URL`） |
| `redis` | Zeabur Marketplace | 內部（提供 `REDIS_URL`） |
| `server` | Docker（`Dockerfile.server`） | port 3000 |
| `worker` | Docker（`Dockerfile.worker`） | 僅內部 |
| `app` | Docker（`Dockerfile.app`，nginx serve 靜態檔） | port 8080 |

> Dockerfile 依 Zeabur 命名慣例放在 repo 根目錄（`Dockerfile.<service-name>`），請將 Zeabur 上三個 service 的名稱分別設為 `server` / `worker` / `app`，平台會自動配對到對應 Dockerfile。Root Directory 欄位保持空白（＝ repo root）。

**server / worker 必填 env**：`DATABASE_URL`、`REDIS_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`MASTER_KEY`、`GOOGLE_CLIENT_ID`、`CORS_ORIGIN`、`COOKIE_DOMAIN`、`COOKIE_SECURE=true`

**app 的 build-time env**（Zeabur **Build Arguments** 區塊，不是 runtime env）：`VITE_API_BASE_URL`、`VITE_GOOGLE_CLIENT_ID`

> `server` 容器啟動時會自動跑 `prisma migrate deploy` 與種子資料腳本；`prisma/seed.ts` 內有「Language 表為空才寫入」的守衛，既有資料不會被覆寫。

---

## 🧪 測試

```bash
pnpm test                              # 全 workspace
pnpm --filter ./app test               # 前端
pnpm --filter ./server test            # 後端
pnpm --filter ./server test:watch      # 後端 watch
```

> pnpm 10 不再做 workspace 名稱的子字串比對，workspace 的實際 package 名稱是 `anki-sprache-{app,server}`，所以 `--filter` 一律用路徑前綴（`./app` / `./server`）。

> 測試基礎設施已就位，但目前尚無測試檔。新增時請參考 [`AGENTS.md` § D](./AGENTS.md#d-測試指南-testing-instructions) 的放置慣例。

---

## 📚 更多文件

- [`AGENTS.md`](./AGENTS.md) — 完整的工程規範、命名慣例、安全實作、頁面權限、部署細節、AI 協作守則
- `http://localhost:3000/docs` — 後端啟動後可用的 Swagger UI

---

## 📄 授權

Private — 尚未授權公開使用。
