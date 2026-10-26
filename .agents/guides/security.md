# 安全性考量

> 用途：修改認證、JWT、BYOK 加密、Cookie、Rate Limit、CORS 等安全相關程式前閱讀。
>
> 相關：[backend.md](./backend.md)、[deployment.md](./deployment.md)、[generation.md](./generation.md)

## 認證流程

1. 前端透過 GIS（`https://accounts.google.com/gsi/client`）取得 ID Token。
2. `POST /auth/google` 帶 idToken → 後端 `google-auth-library` 以 `audience: GOOGLE_CLIENT_ID` 驗簽，並檢查 `payload.email_verified === true`。
3. 首次登入於交易內建立 `User` + `OAuthAccount` + `UserSettings`。
4. 簽發 access token（Authorization header）+ refresh token（httpOnly cookie）。

## JWT Rotation

| Token | 存放位置 | 預設 TTL | 來源 env | 備註 |
|---|---|---|---|---|
| Access | Pinia 記憶體（**不**存 localStorage） | `ACCESS_TOKEN_TTL`（預設 15m） | `JWT_ACCESS_SECRET`（≥ 32 字元，Zod 強制） | `Authorization: Bearer <token>` |
| Refresh | httpOnly cookie `refresh_token` | `REFRESH_TOKEN_TTL`（預設 30d） | `JWT_REFRESH_SECRET`（≥ 32 字元） | DB 只存 SHA-256 hash，輪替時舊 token 標記 `revokedAt` |

驗證路徑：`server/src/modules/auth/auth.service.ts`、`server/src/shared/plugins/auth.plugin.ts`。

前端在收到 401 時由 `composables/useAxios.ts` 透過單一共享的 `refreshPromise` 呼叫 `/auth/refresh`，避免並發重複輪替。

## BYOK AES-256-GCM 加密

- 檔案：`server/src/shared/crypto/aesGcm.ts`
- 演算法：AES-256-GCM（Node.js 原生 `crypto`，具 authenticated encryption）。
- Master Key：`MASTER_KEY` env（base64 解碼後必須為 32 bytes，Zod 校驗）。
- 每筆資料：獨立 12-byte IV + auth tag，與 ciphertext 一同存於 `LlmApiKey` 三欄（`encryptedKey`、`iv`、`authTag`）。
- 指紋：SHA-256 前 12 字元，供 UI 顯示以便辨識，**不**外洩原始金鑰。
- 原始金鑰僅在 `generation.service.ts` 呼叫 LLM 當下解密於記憶體，**永不寫入 log、永不回傳前端**。
- 一旦 `MASTER_KEY` 外洩，需要重新加密所有 `LlmApiKey` 或要求使用者重新輸入。

## Cookie 策略

實際實作在 `server/src/modules/auth/auth.routes.ts` 的 `refreshCookieAttributes()`，設定與清除 cookie 共用同一組屬性（刪除 cookie 時 name / domain / path 必須一致）：

```ts
{
  httpOnly: true,
  // production 自動 true；sameSite='none' 也會強制升 Secure（瀏覽器強制要求兩者並用）
  secure: env.COOKIE_SECURE || isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,  // 'lax' | 'strict' | 'none'，預設 'lax'
  path: '/',
  // COOKIE_DOMAIN 預設 'localhost'；等於 'localhost' 時不設 domain（host-only），其餘才設
  ...(env.COOKIE_DOMAIN === 'localhost' ? {} : { domain: env.COOKIE_DOMAIN }),
}
```

**`COOKIE_SAMESITE` 怎麼選**：

| 部署形態 | 設定 | 說明 |
|---|---|---|
| localhost dev | `lax`（預設） | 同站不同 port 仍是 same-site，cookie 正常往返 |
| 同根域 prod（`app.example.com` ↔ `api.example.com`） | `lax`（預設） | 兩個 subdomain 同 eTLD+1，same-site；`COOKIE_DOMAIN` 設為 API 主機名稱（目前正式環境做法，見 `deploy/app.env.example`），或 `.example.com` 讓子網域共用 |
| 跨根域或公共後綴（`anki-sprache.zeabur.app` ↔ `api-anki-sprache.zeabur.app`） | **`none`** | `*.zeabur.app` 在 [public suffix list](https://publicsuffix.org/) 上 → 兩個 subdomain 被瀏覽器視為跨站，`lax` 不會在 XHR 上送 cookie。`none` 必須搭配 `secure=true`（程式碼會自動強制） |

`COOKIE_DOMAIN` 在 PSL 上的子網域**不能**設成根域（如 `zeabur.app`）— 瀏覽器會拒收。改設成 host-only（從 env 移除或設成 `localhost` 觸發 host-only 分支）。

## Rate Limit（Redis 後端）

`@fastify/rate-limit` 於 `preHandler` hook 執行（`server/src/app.ts`），確保 `req.user` 與路由 decorator 已填入後才算 key。

| 範圍 | 限制 | Key |
|---|---|---|
| 全域（預設） | 300 req/min | `userId` 或 IP |
| `POST /auth/google` | 10 req/min | IP（未登入） |
| `POST /auth/refresh` | 60 req/min | IP（未登入） |
| `POST /reviews` | 120 req/min | `userId` |
| `POST /generate/today` | prod 5/hr、dev 60/hr | `userId:provider:model` |
| `POST /generate/more` | prod 10/hr、dev 60/hr | `userId:provider:model` |
| `POST /cards/:id/examples/ensure` | prod 30/hr、dev 120/hr | `userId`（預設 key） |
| `POST /audio/lemma/:cardId`、`POST /audio/examples/:exampleId` | prod 60/hr、dev 200/hr | `userId`（預設 key） |

> 「補足」（`POST /generate/more` 帶 `fillShortfall: true`）有每日次數上限，不屬於 `@fastify/rate-limit`，說明見 [generation.md](./generation.md)。

> 上表數值集中在 `server/src/config/rate-limit.config.ts` 的 `RATE_LIMITS`；產品限制（每日新字上限、待複習上限、例句數等）在 `limits.config.ts`。調整時只改這兩個檔案，並同步本表。

> `/generate/*` 以 `provider:model` 作 bucket 尾綴，使用者切換偏好 LLM 後會拿到獨立的配額，不會因為先前模型用盡而共用限流。

## 其他防護

- **Helmet**：啟用預設安全標頭；CSP 目前未開啟（為允許 GIS 腳本與 LLM SDK XHR），需加強時請同步調整前端 `index.html` 與 cookie 設定。
- **CORS**：`CORS_ORIGIN` 逗號分隔多來源、`credentials: true`，預設 `http://localhost:5173`。
- **輸入驗證**：所有路由皆以 Zod schema 驗證；違反回 400 + issues 陣列。
- **秘密管理**：
  - `.env`、`server/.env`、`app/.env` 皆在 `.gitignore`；**不得** commit。
  - 範例值請一律使用 `change-me-*` 占位。
  - `JWT_*_SECRET` 與 `MASTER_KEY` 請以 `openssl` / `crypto.randomBytes(32)` 產生。
- **前端存儲**：僅主題偏好會寫入 `localStorage`（key: `theme`）；任何 token 或 PII 都**不得**寫入。
