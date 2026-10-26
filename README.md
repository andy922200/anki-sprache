# Anki-Sprache

一套仿 Anki 風格的多語言學習 Web App。以 **FSRS** 間隔重複排程、**使用者自備 LLM API Key（BYOK）** 自動生成每日單字卡，支援多母語翻譯與 Google 登入。

> 📖 核心工程規範與 AI 協作指引請見 [`AGENTS.md`](./AGENTS.md)，各領域細節（架構、風格、前後端、安全、測試、部署）拆在 [`.agents/guides/`](./.agents/guides/)。

---

## ✨ 核心特色

- **FSRS 排程**：以 `ts-fsrs` 實作的現代間隔重複演算法，取代傳統 SM-2。
- **BYOK LLM 生成**：自行提供 OpenAI / Anthropic Claude / Google Gemini API Key，伺服器以 AES-256-GCM 加密儲存；每日依你的時區於當地 04:00 自動生成新卡，並優先沿用全站已有的單字，不足才呼叫 LLM。
- **多母語翻譯**：同一張單字卡可同時帶多種母語翻譯，介面會依使用者設定挑選。目前啟用德文、英文、葡萄牙文、繁體中文，其餘語言在種子資料中預設停用。
- **TTS 發音**：單字與例句的音檔以 Google Cloud Text-to-Speech 合成，存放在 Cloudflare R2。
- **Google 登入**：前端走 Google Identity Services，後端驗 ID Token 後簽發 JWT（access + refresh rotation，refresh token 僅存於 httpOnly cookie）。
- **FLIP 與選擇題雙模式**：支援傳統翻牌複習與 4 選 1 模式，也有不計入 FSRS 的 Practice 模式。
- **深色模式 / 繁中 · 英文介面**。

技術堆疊、架構圖與目錄結構請見 [`architecture.md`](./.agents/guides/architecture.md)。

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

# 3. 複製環境變數範本（後端與前端各自一份，根目錄沒有 .env）
cp server/.env.example server/.env
cp app/.env.example app/.env
```

編輯 `server/.env`，以下變數沒填後端會無法啟動：

- `GOOGLE_CLIENT_ID`（Google Cloud Console → OAuth Client，類型 Web application），同一個值也要填進 `app/.env` 的 `VITE_GOOGLE_CLIENT_ID`
- `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`（以 `openssl rand -base64 48` 產生）
- `MASTER_KEY`（BYOK 加密主金鑰，以 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 產生）
- `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_PUBLIC_URL`（Cloudflare R2，存放 TTS 音檔；本機建議用獨立的 dev bucket，避免污染正式環境）
- `GOOGLE_TTS_API_KEY`（Google Cloud Text-to-Speech，限制為該 API）

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
pnpm up:all        # 啟動 Postgres + Redis，並同時啟動 app + server + worker
```

或分開啟動：

```bash
pnpm dev:app       # Vite dev server → http://localhost:5173
pnpm dev:server    # Fastify API    → http://localhost:3000
pnpm dev:worker    # BullMQ worker（正式環境務必獨立程序）
```

開發時可開 Swagger UI 檢視 API：<http://localhost:3000/docs>

完整指令表（build、lint、format、test、DB、Docker、一次性維護腳本）請見 [`setup-and-commands.md`](./.agents/guides/setup-and-commands.md)；測試慣例請見 [`testing.md`](./.agents/guides/testing.md)。

---

## 🔒 安全設計

Access Token 只存在記憶體、Refresh Token 僅存 httpOnly cookie，使用者的 LLM API Key 以 AES-256-GCM 加密儲存，所有路由皆以 Zod 驗證並由 Redis 後端做 Rate Limit。完整細節請見 [`security.md`](./.agents/guides/security.md)。

---

## ☁️ 部署（Lightsail + Cloudflare）

單台 AWS Lightsail（2GB）以 docker compose 跑後端，前端放 Cloudflare Pages，對外流量全走 Cloudflare Tunnel，VM 不開 80 / 443。修改部署設定時要守的規則請見 [`deployment.md`](./.agents/guides/deployment.md)。

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

`deploy/.env` 放 compose 內插用的 `POSTGRES_PASSWORD` 與 `TUNNEL_TOKEN`；`app.env` 放 `server` / `worker` 的執行期變數（含 R2 與 TTS），欄位請見 [`deploy/app.env.example`](./deploy/app.env.example)。`server` 啟動時會自動執行 `prisma migrate deploy` 與種子腳本（`Language` 表非空時略過）。前端與 API 位於同一個網站（`anki.example.com` 與 `anki-api.example.com`）底下，因此使用 `COOKIE_SAMESITE=lax`，`COOKIE_DOMAIN` 設為 API 主機名稱即可。

### 自動佈署（GitHub Actions）

推到 `master` 且動到後端相關檔案時，[`deploy.yml`](./.github/workflows/deploy.yml) 會把 `server`、`worker` 映像 build 後推到 GHCR，再經 Cloudflare Tunnel SSH 進 VM 執行 `docker compose pull && up -d`，最後打 `/health` 確認。每次佈署前會先把 `deploy/compose.yml` 複製到 VM 的 `~/deploy/`（覆蓋原檔），所以 compose 以 repo 為準；`.env`、`app.env`、`backup.env` 不同步，維持只存在 VM。VM 上不需要 clone 原始碼。

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

## 🔊 TTS 音檔

音檔機制（合成流程、鎖、快取驗證）請見 [`backend.md`](./.agents/guides/backend.md)。

### 對照查詢

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

### 維護腳本

`server/scripts/` 下的腳本都預設 dry-run，加 `--confirm` 才會實際寫入或刪除，且會作用在本機 `server/.env` 指向的 DB 與 R2 bucket，執行前請先核對腳本印出的 bucket 與 DB host。用法與參數見各腳本檔頭註解。

| 指令（在專案根目錄用 `pnpm --filter ./server <script>`） | 用途 |
|------|------|
| `audit:audio` | 找出 R2 上沒有 DB 參照的孤兒音檔，可選擇刪除 |
| `prune:audio:lang <code>` | 刪除某個語言代碼底下的全部音檔（停用語言時使用） |
| `backfill:pt-gender` | 以 LLM 回填既有葡萄牙文名詞的陰陽性；需自備 `BACKFILL_LLM_PROVIDER` / `BACKFILL_LLM_KEY` |

> 想對遠端 DB 或正式 bucket 執行時，用 shell 匯出 `DATABASE_URL`、`R2_BUCKET`、`R2_PUBLIC_URL` 覆寫即可（shell 優先於 `--env-file`），仍須保留本機 `server/.env` 以通過環境變數校驗。

---

## 📚 更多文件

- [`AGENTS.md`](./AGENTS.md) — 核心工程規範、AI 協作守則與 guides 索引
- [`.agents/guides/`](./.agents/guides/) — 架構、程式碼風格、前後端、每日生成、安全實作、測試、部署細節

---

## 📄 授權

Private — 尚未授權公開使用。
