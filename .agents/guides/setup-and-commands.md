# 指令與維護腳本

> 用途：跑 build / lint / test / DB / Docker 指令、執行一次性維護腳本時閱讀。環境需求、首次安裝、秘鑰產生、環境變數填寫與 Prisma 注意事項見 [README](../../README.md) 的「快速開始」，本檔不重複。
>
> 相關：[testing.md](./testing.md)、[deployment.md](./deployment.md)、[code-style.md](./code-style.md)

## 指令彙整

| 分類 | 指令 | 作用 |
|---|---|---|
| 開發（全部） | `pnpm up:all` | `pnpm docker:up` 後接 `pnpm dev:all`，一鍵啟動容器與三個服務 |
|  | `pnpm dev` | 以 `-r --parallel` 同時啟動 `app` 與 `server`（**不含 worker**） |
|  | `pnpm dev:all` | 同時啟動 `app`、`server` 與 `worker`（log 會混流，除錯時建議改用單一指令） |
| 開發（單一） | `pnpm dev:app` | Vite dev server，port **5173**（`strictPort: true`） |
|  | `pnpm dev:server` | Fastify（tsx watch），port **3000** |
|  | `pnpm dev:worker` | BullMQ worker（獨立程序，正式環境務必拆開） |
| 建置 | `pnpm build` | 兩個 workspace 皆 build（前端 `vue-tsc --noEmit && vite build`；後端 `tsc -p tsconfig.build.json`） |
| 型別檢查 | `pnpm typecheck` | 全 workspace 跑 `tsc --noEmit` / `vue-tsc --noEmit`（後端含 `scripts/`） |
| 程式碼檢查 | `pnpm lint` | 全 workspace 跑 lint（前端 ESLint、後端 Biome），詳見 [code-style.md](./code-style.md) |
|  | `pnpm --filter ./app lint:fix` / `pnpm --filter ./server lint:fix` | 自動修復可 safe-fix 的規則（不會套用 unsafe fix） |
| 程式碼格式 | `pnpm format` | 全 workspace 寫入格式化（前端 Prettier、後端 Biome） |
|  | `pnpm format:check` | dry-run，CI 友善；通過代表所有檔案已符合格式 |
| 測試 | `pnpm test` | 全 workspace 跑 `vitest run`；單一 workspace 與 watch 見 [testing.md](./testing.md) |
| 資料庫 | `pnpm db:migrate` | `prisma migrate dev`（含 generate + 套用） |
|  | `pnpm db:seed` | 由 `prisma.config.ts` 的 `migrations.seed` 呼叫 `tsx prisma/seed.ts` |
|  | `pnpm db:studio` | Prisma Studio（port 5555） |
| Docker | `pnpm docker:up` | 背景啟動 postgres + redis |
|  | `pnpm docker:down` | 停止容器（volumes 保留） |
| 正式執行 | `pnpm --filter ./server start` | `node --env-file=.env dist/index.js` |
|  | `pnpm --filter ./server start:worker` | 啟動已 build 的 worker |
|  | `pnpm --filter ./app preview` | 預覽前端 production 打包 |

> pnpm 10 不再做 workspace 名稱的子字串比對。`app` / `server` 的實際 package name 分別是 `anki-sprache-app` / `anki-sprache-server`，所以所有 `--filter` 都改用**路徑前綴**（`./app`、`./server`）比較穩定且不綁名稱。

## 一次性維護腳本

位於 `server/scripts/`，以 `pnpm --filter ./server <script>` 執行（`tsx --env-file=.env`）。共通規則：預設 dry-run，加 `--confirm` 才會實際寫入或刪除；作用對象是本機 `server/.env` 指向的 DB 與 R2 bucket，執行前先核對腳本印出的 bucket 與 DB host。參數與用法以各腳本檔頭註解為準。

| 腳本 | 作用 |
|---|---|
| `audit:audio` | 找出 R2 上沒有 DB 參照的孤兒音檔（`--delete --confirm` 才會刪） |
| `prune:audio:lang <code>` | 刪除 `audio/*/<code>/` 底下全部音檔，用於停用語言 |
| `backfill:pt-gender` | 以 LLM 回填既有葡萄牙文名詞的陰陽性；需 `BACKFILL_LLM_PROVIDER` / `BACKFILL_LLM_KEY`（選填 `BACKFILL_LLM_MODEL`） |

- 腳本的 import 鏈會經 `config/env.config.ts` 全量校驗，所以對遠端 DB 或正式 bucket 執行時要**保留**本機 `.env`，再用 shell 匯出覆寫 `DATABASE_URL`、`R2_BUCKET`、`R2_PUBLIC_URL`（shell 優先於 `--env-file`）。
- 本機 `.env` 預設指向 dev bucket，清正式 bucket 的孤兒時 DB 與 bucket 變數都要一起覆寫。
- 新增腳本時比照既有檔頭註解格式，並在此表補一列。

## API 文件

後端啟動後：`http://localhost:3000/docs`（Swagger UI，由 `@fastify/swagger` + `@fastify/swagger-ui` 產生）。

## Agent Skills

`.claude/skills/*` 是指向 `.agents/skills/*` 的 symlink，而後者再指向與本專案**同層**的 `agent-skills` repo（`../../../agent-skills/<skill>`）。

- 使用 skill 前，請先把 `agent-skills` clone 到 `anki-sprache/` 旁邊（兩個資料夾同層）。
- 缺少該 repo 時 symlink 會失效，skill 不會被載入，但不影響 build、lint 與測試。
