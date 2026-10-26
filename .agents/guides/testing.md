# 測試指南

> 用途：撰寫測試，或修改 API / 頁面 / FSRS / 生成流程後進行驗證、宣告完成前閱讀。
>
> 相關：[setup-and-commands.md](./setup-and-commands.md)、[frontend.md](./frontend.md)、[backend.md](./backend.md)

## 框架與環境

| Workspace | 框架 | 環境 | 設定 |
|---|---|---|---|
| `app` | Vitest 4 | `happy-dom` 20 | `app/vite.config.ts` 的 `test` 區塊，`globals: true` |
| `server` | Vitest 4 | Node.js（預設） | `server/vitest.config.ts`，只設 `@` → `./src` 的 alias |

## 指令

`pnpm test` 的總覽見 [setup-and-commands.md](./setup-and-commands.md)，單一 workspace 與 watch：

```bash
pnpm --filter ./app test               # 前端
pnpm --filter ./server test            # 後端
pnpm --filter ./server test:watch      # 後端 watch 模式
```

## 現況

- 後端已有測試：`cards.service.test.ts`、`generation.service.test.ts`、`generation.routes.test.ts`、`shared/llm/prompts/dailyWords.test.ts`。前端尚無測試檔。
- 後端的慣例是**不連 DB / Redis**：以 `vi.fn()` 手寫 Prisma / Redis 替身。路由測試用 `Fastify()` 搭配 `fastify-type-provider-zod` 的編譯器與 `@fastify/sensible`，再以 `inject` 發請求；會載入 `env.config.ts` 或 BullMQ plugin 的模組要先 `vi.mock`（例：`vi.mock('@/config/env.config.js', () => ({ isDev: true, env: {} }))`），否則 Zod 環境變數校驗會在匯入時失敗。新增後端測試請沿用這個模式。
- 尚未引入 Playwright / Supertest / Testing Library；如需 E2E 或 API integration test，請先與 owner 討論方向。
- 尚未設定覆蓋率（未來可用 `vitest --coverage` 搭配 v8 provider）。

## 新增測試放置位置

- 前端：與受測檔同層的 `*.spec.ts`，或 `app/src/**/__tests__/` 目錄下。
- 後端：與受測檔同層的 `server/src/**/*.test.ts`（build 時由 `tsconfig.build.json` 自動排除）。

## 手動端到端驗證流程

修改 API / 頁面 / FSRS / 生成流程後，至少跑過一次下列路徑再宣告完成（改 UI 時要實際在瀏覽器操作，規則見 [AGENTS.md](../../AGENTS.md)）：

1. `pnpm docker:up`
2. `pnpm db:migrate && pnpm db:seed`
3. 三個終端機分別 `pnpm dev:server`、`pnpm dev:worker`、`pnpm dev:app`（或直接 `pnpm up:all`）
4. 瀏覽器走：`/login` → Google 登入 → `/` Dashboard 觸發生成 → `/review?mode=FLIP` → `/review?mode=choice` → `/logbook` → `/settings` → `/settings/api-keys`
5. 開啟 `http://localhost:3000/docs` 核對 Swagger Schema 是否仍合法
