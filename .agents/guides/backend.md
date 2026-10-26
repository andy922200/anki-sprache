# 後端（server/）指引

> 用途：修改 `server/`（路由、service、Prisma、FSRS、BullMQ、LLM、TTS 音檔、快取）前閱讀。
>
> 相關：[generation.md](./generation.md)（每日單字生成）、[security.md](./security.md)（含 Rate Limit 數值）、[code-style.md](./code-style.md)、[architecture.md](./architecture.md)

## Fastify 後端

- 路由一律使用 `fastify-type-provider-zod` v6，每個路由有 `schema: { body/params/query/response }`。
- 例外交給 global `errorHandler`（`shared/plugins/errorHandler.ts`），回應一律為 `{ error, message, issues? }`。
  - 請求 schema 失敗：`hasZodFastifySchemaValidationErrors(error)` → 400 + `issues`（從 `error.validation` 讀）
  - 回應 schema 失敗：`isResponseSerializationError(error)` → 500 + log
  - v5+ 不再丟 `ZodError`，請**不要**自行 `instanceof ZodError` 判斷
- HTTP 錯誤使用 `app.httpErrors.*`（來自 `@fastify/sensible`）。
- Prisma 交易使用 `prisma.$transaction(async (tx) => { ... })`；跨步驟的寫入請放交易內。

## 新增功能的既定路徑

- **新增後端路由**：於 `server/src/modules/<domain>/` 建立 `*.routes.ts` + `*.service.ts` + `*.schema.ts`（Zod），並在 `server/src/app.ts` 統一註冊；務必附 response schema 以讓 `/docs` 自動生成正確。
- **後端模組定義**：`server/src/modules/<name>/` 是一個領域模組，對應 `app.ts` 註冊的**一組路由前綴**；前綴只在 `app.ts` 設定，模組內部路由寫相對路徑。
  - 模組檔案：`*.routes.ts`（HTTP + Zod）、`*.service.ts`（不依賴 HTTP 的邏輯，供路由與 worker 共用）、必要時 `*.schema.ts`。
  - 模組之間不互相 import，沒有例外；跨模組共用的邏輯放 `shared/`（例如 `cards`、`generation` 共用的 `shared/audio/pruneExamples.ts`）。
  - 列舉 schema 一律從 `shared/schemas/enums.ts` 匯入；數值型限制放 `config/limits.config.ts` 與 `config/rate-limit.config.ts`。
- **新增 Prisma 模型**：`schema.prisma` 改完跑 `pnpm db:migrate`（dev 會 `prisma migrate dev`），勿手改 `migrations/*.sql`；種子改動請同步 `prisma/seed.ts`。Prisma 7 的 client 產物路徑由 schema 的 `generator` block 指定（`../src/generated/prisma`），若需改輸出位置記得同步調整所有 import（目前統一走 `@/generated/prisma/client.js`）。

## 既有工具必用

- **FSRS 排程**：一切 `UserCardState` 更新必經 `server/src/shared/fsrs/scheduler.ts`；前端**不得**自行計算下次到期日。`elapsed_days` 已在 scheduler 內部以 `(now - last_review)` 即時計算，**不要**新增回對應的 Prisma 欄位（ts-fsrs v5 已標 `@deprecated`、v6 將移除）。
- **BullMQ Queue**：新增佇列於 `shared/plugins/bullmq.plugin.ts` 註冊；生成類任務必搭 Redis 鎖（`SET ... NX`）避免同 `userId + date` 重複執行。
- **LLM 呼叫**：統一透過 `shared/llm/llmClient.ts` 工廠 + `retry.ts` 指數退避，prompt 放 `shared/llm/prompts/`；每次呼叫都必須寫入 `LlmUsageLog`（成功 / 失敗皆是）。
- **Prisma Client 實例化**：Prisma 7 強制使用 driver adapter。**所有** `new PrismaClient()` 呼叫（`prisma.plugin.ts`、`worker.ts`、`prisma/seed.ts`，以及 `scripts/audit-audio.ts`、`scripts/backfill-pt-gender.ts`）都必須傳入 `new PrismaPg({ connectionString: ... })`，且 `DATABASE_URL` 來源是 `prisma.config.ts`（migrate / seed）或 `env.DATABASE_URL`（runtime / 腳本）。
- **每日單字生成**：改動 `generation.service.ts` 前先讀 [generation.md](./generation.md)，守住其中的順序與不變量。
- **TTS 音檔**：一律經 `modules/audio/audio.service.ts` 的 `ensureAudio()`，不要直接呼叫 TTS 或 R2。
  - 流程：讀到 `audioUrl` 先以 `objectExists` 驗證 R2 上真的有（被外部刪掉就清掉欄位重做）→ Redis 鎖 `tts:lock:<kind>:<id>`（30 秒，拿不到就輪詢等對手結果，最多 20 秒）→ 以 `buildAudioKey(kind, languageCode, text)` 算 content-addressed key，R2 已有就只回寫 URL，沒有才呼叫 `shared/tts` 合成並 `uploadAudio`。
  - 單字音檔唸的是「冠詞 + 單字」（如 `die Stadt`、`a palavra`），所以冠詞邏輯要與前端 `genderArticle()` 同步，見 [frontend.md](./frontend.md)。
  - 例句會被 LLM 重新生成，其音檔不會去重；刪音檔或換語言時用 [setup-and-commands.md](./setup-and-commands.md) 的維護腳本清孤兒。
  - 本機 dev 與正式環境用不同 R2 bucket（設在各自的 `.env`），避免 dev 播放產生的例句音檔污染正式桶。
- **快取**：`/cards/due` 有 60 秒 Redis 快取、`/cards/:id` 用 ETag；`POST /reviews` 成功後必須走既有的 invalidation（key 樣板 `cards:due:<userId>:*`）。

## 後端 API 權限矩陣

限流數值集中在 `config/rate-limit.config.ts`，對照表見 [security.md](./security.md)，此處不重複。

| Method | 路徑 | 需登入 | 備註 |
|---|---|---|---|
| POST | `/auth/google` | ❌ | Google ID Token 登入 |
| POST | `/auth/refresh` | ❌（需 cookie） | Refresh rotation |
| POST | `/auth/logout` | ✅ | 撤銷 refresh token |
| GET | `/me` | ✅ | 個人資料 |
| PATCH | `/me` | ✅ | `displayName`、`timezone` |
| GET | `/me/settings` | ✅ | 學習偏好 |
| PATCH | `/me/settings` | ✅ | 目標 / 母語、CEFR、每日新詞數、待複習上限、LLM 偏好、主題、UI 語系 |
| GET | `/me/llm-keys` | ✅ | 回傳 masked 指紋 |
| PUT | `/me/llm-keys/:provider` | ✅ | `provider` ∈ {OPENAI, ANTHROPIC, GOOGLE} |
| DELETE | `/me/llm-keys/:provider` | ✅ | — |
| GET | `/languages` | ✅ | 全部語言，已啟用的排前面（`enabled` 欄位區分） |
| GET | `/cards/today` | ✅ | 當日卡組（無論是否到期） |
| GET | `/cards/due` | ✅ | 到期卡，上限為 `UserSettings.maxDueCards`；60 秒 Redis 快取 |
| GET | `/cards/:id` | ✅ | 單卡，支援 ETag 304 |
| POST | `/cards/:id/examples/ensure` | ✅ | 即時補齊該卡在使用者 CEFR + 母語下缺的例句／翻譯；用請求者自己的 BYOK；同一張卡同時請求回 409 `EXAMPLES_GENERATION_IN_PROGRESS`（Redis 鎖 60 秒），LLM 失敗回 424（`LLM_RATE_LIMITED`、`LLM_INVALID_RESPONSE` 等） |
| POST | `/audio/lemma/:cardId` | ✅ | 確保單字音檔存在並回傳 `audioUrl`，必要時合成 |
| POST | `/audio/examples/:exampleId` | ✅ | 同上，對象為例句 |
| POST | `/reviews` | ✅ | 寫入後失效快取 |
| GET | `/reviews/logbook` | ✅ | Cursor 分頁（預設 50、上限 100），支援 rating / mode 篩選 |
| POST | `/generate/today` | ✅ | 202 Accepted 或 200（已完成） |
| POST | `/generate/more` | ✅ | 追加 N 張卡；`fillShortfall: true` 為補足，見 [generation.md](./generation.md) |
| GET | `/generate/status` | ✅ | 生成狀態 + 近期錯誤 |
| GET | `/health` | ❌ | 健康檢查 |
| GET | `/docs` | ❌ | Swagger UI |
