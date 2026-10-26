# 架構與技術堆疊

> 用途：了解整體架構、技術堆疊、目錄結構與依賴版本注意事項時閱讀。
>
> 相關：[setup-and-commands.md](./setup-and-commands.md)、[deployment.md](./deployment.md)

## 架構與部署

```
┌──────────────┐   HTTPS + Cookies    ┌──────────────┐
│  app (Vue3)  │ ───────────────────▶ │  server (API)│─── Prisma ──▶ Postgres 18
│  Vite SPA    │ ◀─────────────────── │  Fastify 5   │─── ioredis ─▶ Redis 7
└──────────────┘   JWT + refresh      └──────────────┘                    ▲
                                              │                           │
                                              ▼ BullMQ                    │
                                     ┌──────────────┐                     │
                                     │  worker      │ ───────────────────┘
                                     │  BullMQ      │  （每小時 fan-out、
                                     └──────────────┘   每使用者當地 04:00 生成）
```

部署拓樸、步驟與備份見 [README](../../README.md) 的部署章節，修改部署設定時要守的規則見 [deployment.md](./deployment.md)。

## 技術堆疊

| 層級 | 主要套件 |
|---|---|
| Monorepo | pnpm workspaces（`app/` + `server/`），pnpm 10.33.2 |
| Frontend | Vue 3.5、TypeScript 6、Vite 8（Rolldown）、Tailwind CSS 4、Pinia 3、Vue Router 5、vue-i18n 11、Axios 1.15 |
| Backend | Fastify 5.8、Prisma 7（Rust-free + driver adapter）、PostgreSQL 18、Redis 7、BullMQ 5、ts-fsrs 5.3、Zod 4、Pino 10、jsonwebtoken 9 |
| LLM SDKs | `@anthropic-ai/sdk` 0.90、`openai` 6、`@google/generative-ai` 0.24（deprecated，待遷移至 `@google/genai`）、`google-auth-library` 10 |
| 音檔 | Google Cloud Text-to-Speech（REST）、Cloudflare R2（經 `@aws-sdk/client-s3`） |
| 安全 | `@fastify/helmet`、`@fastify/cors` 11、`@fastify/rate-limit`、`@fastify/cookie`、AES-256-GCM |
| 風格 / Lint | ESLint 10 + Prettier 3.8（前端）、Biome 2（後端）、EditorConfig |
| 測試 | Vitest 4、happy-dom 20（前端）|
| 容器 | Docker Compose（dev：postgres + redis） |

## 目錄結構速覽

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
│       ├── types/          # domain DTO
│       └── utils/          # gender.ts：依語言挑冠詞（德文 der/die/das、葡文 o/a）
├── server/                 # Fastify API + BullMQ worker
│   ├── prisma.config.ts    # Prisma 7 設定檔（datasource URL、migrations、seed）
│   ├── src/
│   │   ├── app.ts          # Fastify builder（plugin + route 註冊）
│   │   ├── index.ts        # HTTP 入口
│   │   ├── worker.ts       # BullMQ worker 入口
│   │   ├── config/         # env.config.ts（Zod 校驗的環境變數）、limits.config.ts（產品限制常數）、rate-limit.config.ts（速率限制）
│   │   ├── generated/      # `prisma generate` 產物（gitignored，build 時自動產生）
│   │   ├── modules/        # auth / users / settings / llmKeys / languages / cards / audio / reviews / generation
│   │   └── shared/
│   │       ├── audio/pruneExamples.ts   # 裁剪例句並清理 R2 音檔（cards / generation 共用）
│   │       ├── crypto/aesGcm.ts
│   │       ├── fsrs/scheduler.ts
│   │       ├── llm/        # adapters + prompts + retry
│   │       ├── plugins/    # auth / prisma / redis / bullmq / errorHandler
│   │       ├── schemas/    # enums.ts：由 Prisma enum 建立的共用 Zod schema
│   │       ├── storage/r2.ts   # R2 上傳 / 刪除 / 列舉 / 存在檢查、音檔 key 規則
│   │       ├── tts/        # ttsClient 工廠 + Google TTS adapter
│   │       └── types/      # fastify.d.ts：FastifyInstance / FastifyRequest 型別擴充
│   ├── scripts/            # 一次性維護腳本（audit-audio / prune-audio-by-language / backfill-pt-gender），納入 typecheck 但不進 build
│   └── prisma/             # schema.prisma、seed.ts、migrations/
├── .agents/
│   ├── skills/             # Agent Skills（symlink 至同層 agent-skills repo）
│   └── guides/             # 分段載入的工程指引（本資料夾）
├── docker-compose.yml      # dev 用 postgres + redis
├── deploy/                 # 正式環境 compose + 每日備份腳本
├── pnpm-workspace.yaml
├── .editorconfig / .prettierrc / .nvmrc   # 環境變數範本在 server/.env.example、app/.env.example（根目錄沒有 .env）
├── README.md
├── CLAUDE.md               # 僅為 @AGENTS.md 參照
└── AGENTS.md               # 核心規範 + guides 索引
```

## 依賴版本注意

- **Prisma 7**：Rust-free / driver-adapter 架構。`datasource` block 不允許 `url`（要搬去 `prisma.config.ts`）；generator 是 `prisma-client` 而非 `prisma-client-js`，且必須指定 `output`。任何升級只要碰到 Prisma，都要重跑 `pnpm --filter ./server exec prisma generate`。
- **Zod 4** + **fastify-type-provider-zod 6**：`z.string().email()` / `z.string().url()` 已被替換為頂層 `z.email()` / `z.url()`；fastify 的驗證失敗用官方 guard 判別，見 [backend.md](./backend.md)「Fastify 後端」。
- **Vite 8**：Rolldown 引擎，build 速度快且 chunk 切得更細。我們沒用 `import.meta.hot.accept`，升級沒碰到破壞性變更；CSS 預設 minifier 變成 Lightning CSS。
- **ts-fsrs 5 → 6 路徑**：`Card.elapsed_days` 已 `@deprecated`，scheduler 中該 input 已改為即時計算。v6 發布時只要把 `scheduler.ts` 的 `elapsed_days` 那一行刪除即可。
- **`@google/generative-ai` 已 deprecated**：官方繼任者為 `@google/genai`，2026-06-24 之後不會再有新版。`server/src/shared/llm/adapters/google.ts` 需另開任務切換 SDK。
- **Tailwind CSS 4** 已 GA，不再是 beta。
