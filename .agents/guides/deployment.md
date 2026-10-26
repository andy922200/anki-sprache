# 部署規則（Lightsail + Cloudflare）

> 用途：修改 `deploy/`、Dockerfile、CI workflow、正式環境 env 或 Cookie / CORS 部署設定前閱讀。
>
> 部署拓樸、元件對照、VM 與 Pages 設定步驟、GitHub Actions 一次性設定、備份還原、`MASTER_KEY` 與 Postgres 18 volume 等注意事項都在 [README](../../README.md) 的部署章節，本檔只記錄**改動時要守的規則**，不重複。
>
> 相關：[security.md](./security.md)（Cookie 策略）、[architecture.md](./architecture.md)

## 規則

- 對外流量只經 Cloudflare Tunnel；`deploy/compose.yml` **不得**新增 `ports:`。
- Redis 必須維持 `noeviction`（BullMQ 要求，否則排隊中的 job 可能無聲消失）。
- `Dockerfile.server` / `Dockerfile.worker` 的 `prisma generate` 需帶佔位的 `DATABASE_URL`（`prisma.config.ts` 載入時就要求該變數），否則在沒有注入環境變數的建置環境會失敗。
- `server` 容器啟動時會自動跑 `prisma migrate deploy` 與 `prisma/seed.ts`；seed 內有 `Language` 表 count 守衛，只會在全新 DB 插入種子資料，既有資料不會被覆寫。所以新增或停用語言不能只改 seed，既有資料庫需要另寫 migration。
- `compose.yml` 由 `.github/workflows/deploy.yml` 在每次佈署時覆蓋到 VM；`deploy/.env`、`app.env`、`backup.env` 只存在 VM，不進 repo。

## 環境變數

- `server` 與 `worker` 必填（Zod 校驗，缺任一個會啟動失敗）：`DATABASE_URL`、`REDIS_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`MASTER_KEY`、`GOOGLE_CLIENT_ID`、`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_PUBLIC_URL`、`GOOGLE_TTS_API_KEY`。正式環境另需 `CORS_ORIGIN`、`COOKIE_DOMAIN`、`COOKIE_SECURE=true`。
- `deploy/.env`（compose 內插用）：`POSTGRES_PASSWORD`、`TUNNEL_TOKEN`。
- 新增或移除環境變數時，同步更新 `config/env.config.ts`、`server/.env.example`、`deploy/app.env.example`，以及 README 的安裝步驟。
- `CORS_ORIGIN` 精確列出前端 URL（無結尾 `/`）— `credentials: true` 跟 wildcard `*` 不能共存。
- `COOKIE_SAMESITE`、`COOKIE_DOMAIN` 依前後端是否同站選擇，規則與原因見 [security.md](./security.md)「Cookie 策略」。
- `app` 的 build-time env 為 `VITE_API_BASE_URL`、`VITE_GOOGLE_CLIENT_ID`（設定位置見 README 的 Pages 表）。
