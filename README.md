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
| 後端 | Fastify 5.8（ESM）· Prisma 7（Rust-free + driver adapter）· PostgreSQL 18 · Redis 7 · BullMQ · ts-fsrs 5 · Zod 4 · Pino 10 |
| LLM | `@anthropic-ai/sdk` · `openai` · `@google/generative-ai`（已 deprecated，將遷移至 `@google/genai`） |
| 安全 | `@fastify/helmet` · `@fastify/cors` · `@fastify/rate-limit` · AES-256-GCM |
| 風格 / Lint | ESLint 10 + Prettier 3.8（前端） · Biome 2（後端，lint+format 一站式） |
| 測試 | Vitest 4 · happy-dom 20（前端） |
| 部署 | AWS Lightsail（docker compose）+ Cloudflare（Tunnel / Pages / R2） |

---

## 🏗️ 架構

```
┌──────────────┐   HTTPS + Cookies    ┌──────────────┐
│  app (Vue3)  │ ───────────────────▶ │  server (API)│─── Prisma ──▶ Postgres 18
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

> 開發用的 Postgres 已由 16 升到 18（與正式環境一致），舊版本的本機 volume 無法沿用。從舊版更新的人請先執行 `docker compose down -v` 清掉舊 volume，再依序跑 `pnpm docker:up`、`pnpm db:migrate`、`pnpm db:seed`（本機資料會重新開始）。

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
├── deploy/               # 正式環境 compose + 每日備份腳本
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

## ☁️ 部署（Lightsail + Cloudflare）

單台 AWS Lightsail（2GB）以 docker compose 跑後端，前端放 Cloudflare Pages，對外流量全走 Cloudflare Tunnel，VM 不開 80 / 443。

```
瀏覽器 ──▶ Cloudflare ──▶ Pages（app）                          anki.example.com
              │
              └─ Tunnel ──▶ Lightsail VM（deploy/compose.yml）   anki-api.example.com
                              ├─ server      Fastify（:3000，僅內部網路）
                              ├─ worker      BullMQ
                              ├─ postgres    18
                              ├─ redis       7（noeviction）
                              └─ cloudflared
```

| 元件 | 位置 | 備註 |
|------|------|------|
| `app` | Cloudflare Pages | 見「前端」 |
| `server` / `worker` / `postgres` / `redis` / `cloudflared` | Lightsail VM，[`deploy/compose.yml`](./deploy/compose.yml) | 沒有任何 `ports:`，唯一入口是 Tunnel；映像來自 GHCR |
| TTS 音檔 | Cloudflare R2 | 與主機無關 |
| 備份 | Cloudflare R2（另一個 bucket） | [`deploy/backup.sh`](./deploy/backup.sh) |

### 後端（VM）

1. 建立 Lightsail 執行個體（Ubuntu 24.04、2GB、Dual-stack），掛上 Static IP；防火牆只保留 SSH（22）。
2. 安裝 Docker，並加 2GB swap。
3. 在 Cloudflare Zero Trust 建立 Tunnel，Public Hostname 設為 `anki-api.example.com` → `http://server:3000`。子網域只能一層，免費的 Universal SSL 才涵蓋。
4. 在 VM 上執行：

   ```bash
   git clone https://github.com/andy922200/anki-sprache.git && cd anki-sprache/deploy
   cp .env.example .env && cp app.env.example app.env   # 填入實際值，並 chmod 600
   docker compose pull && docker compose up -d
   curl https://anki-api.example.com/health
   ```

`server` 啟動時會自動執行 `prisma migrate deploy` 與種子腳本（`Language` 表非空時略過）。`app.env` 的變數請見 [`deploy/app.env.example`](./deploy/app.env.example)。前端與 API 位於同一個網站（`anki.example.com` 與 `anki-api.example.com`）底下，因此使用 `COOKIE_SAMESITE=lax`，`COOKIE_DOMAIN` 設為 API 主機名稱即可。

### 自動佈署（GitHub Actions）

推到 `master` 且動到後端相關檔案時，[`deploy.yml`](./.github/workflows/deploy.yml) 會把 `server`、`worker` 映像 build 後推到 GHCR，再經 Cloudflare Tunnel SSH 進 VM 執行 `docker compose pull && up -d`，最後打 `/health` 確認。VM 上只需要 `deploy/` 資料夾（compose 與 env 檔），不需要 clone 原始碼。

一次性設定：

1. GHCR 第一次推送後，到 GitHub 的 Packages 把 `anki-server`、`anki-worker` 設為 Public（映像不含任何 secret），VM 才能免登入 `pull`。
2. Tunnel 新增 Public Hostname，例如 `ssh.example.com` → `ssh://host.docker.internal:22`（`compose.yml` 的 `cloudflared` 已加 `extra_hosts`）。
3. Zero Trust → Access 建立 Service Token，並對 `ssh.example.com` 建立 Self-hosted application，policy 的 Action 選 `Service Auth` 並指定該 token。
4. 產生專用金鑰 `ssh-keygen -t ed25519 -f deploy_key -N ""`，公鑰加入 VM 的 `~/.ssh/authorized_keys`。
5. 在 repo 的 Settings → Secrets and variables → Actions 新增：`DEPLOY_SSH_KEY`（私鑰內容）、`DEPLOY_SSH_HOST`（`ssh.example.com`）、`DEPLOY_SSH_USER`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`。

### 前端（Cloudflare Pages）

匯入此 repo 建立 **Pages** 專案（不是 Workers）：

| 設定 | 值 |
|------|-----|
| Build command | `pnpm --filter ./app build` |
| Build output directory | `app/dist` |
| 環境變數 | `VITE_API_BASE_URL=https://anki-api.example.com`、`VITE_GOOGLE_CLIENT_ID`、`NODE_VERSION=22`、`PNPM_VERSION=10.33.2` |

Custom domain 設為 `anki.example.com`，並將它加入 Google OAuth 的 Authorized JavaScript origins。`Dockerfile.app`（nginx）仍保留，可用於不走 Pages 的情況。

### 備份與還原

`deploy/backup.sh` 以 `pg_dump -Fc` 匯出並上傳到 R2，建議用 cron 每天執行（VM 時區為 UTC）：

```
0 19 * * * /home/ubuntu/deploy/backup.sh >> /home/ubuntu/deploy/backup.log 2>&1
```

憑證放在 `deploy/backup.env`（見 `backup.env.example`）。請使用只能存取備份 bucket 的 R2 token，並在 bucket 設定生命週期規則（例如 30 天後刪除）。還原時，`pg_restore` 所屬的 Postgres 主版本不可低於匯出端：

```bash
docker compose exec -T postgres pg_restore -U anki -d anki_sprache --clean --if-exists --no-owner --no-privileges < anki.dump
```

### 注意事項

- `MASTER_KEY` 一旦更換，所有已儲存的使用者 LLM API Key 都會無法解密，搬遷時務必沿用原值。
- Google TTS 的 API key 若有設定 IP 限制，需加入 VM 的 Static IP。
- Postgres 18 的映像把資料放在 `/var/lib/postgresql/18/...`，所以 compose 的 volume 掛在 `/var/lib/postgresql`，而不是 `/var/lib/postgresql/data`。

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

## 🔊 TTS 音檔對照查詢

R2 bucket 內的音檔採 content-addressed 命名（`audio/{kind}/{lang}/{sha256}.mp3`），hash 沒辦法直接認人。想知道某個 key 對應到哪個單字或例句，用 `pnpm db:studio` 打開 Prisma Studio 的 SQL 分頁跑：

```sql
-- 所有單字音檔對照
SELECT lemma, "languageCode", "audioUrl"
FROM "VocabularyCard"
WHERE "audioUrl" IS NOT NULL
ORDER BY "languageCode", lemma;

-- 所有例句音檔對照（含所屬單字）
SELECT c.lemma, c."languageCode", e.text, e."audioUrl"
FROM "ExampleSentence" e
JOIN "VocabularyCard" c ON c.id = e."cardId"
WHERE e."audioUrl" IS NOT NULL
ORDER BY c."languageCode", c.lemma, e."orderIndex";
```

> 每個 R2 物件也會夾帶 `text` / `lang` / `kind` 三個 metadata 欄位（`text` 為 URL-encoded 以相容非 ASCII），在 Cloudflare R2 dashboard 點開物件即可看到。

---

## 📚 更多文件

- [`AGENTS.md`](./AGENTS.md) — 完整的工程規範、命名慣例、安全實作、頁面權限、部署細節、AI 協作守則
- `http://localhost:3000/docs` — 後端啟動後可用的 Swagger UI

---

## 📄 授權

Private — 尚未授權公開使用。
