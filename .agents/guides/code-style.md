# 程式碼風格規範

> 用途：撰寫或修改任何程式碼前閱讀（Lint / Formatter、TypeScript、匯入、命名、註解）。前端 / 後端專屬慣例見各自的指引。
>
> 相關：[frontend.md](./frontend.md)、[backend.md](./backend.md)、[setup-and-commands.md](./setup-and-commands.md)

## 程式碼風格與 Lint

兩個 workspace 採不同 lint / formatter 工具，避免互踩；皆走「務實」路線，以 recommended 為基底、僅關閉與專案 idiom 不合的規則：

| Workspace | Linter | Formatter | 設定檔 |
|---|---|---|---|
| `app/`（Vue 3 + TS） | ESLint 10（flat config） | Prettier 3.8 | `app/eslint.config.mjs`、根 `.prettierrc` |
| `server/`（Fastify + TS） | Biome 2 | Biome 2（一站式） | `server/biome.json` |

**前端 ESLint**（`app/eslint.config.mjs`）：

- 主要 plugin：`eslint-plugin-vue`（`flat/recommended`）+ `@vue/eslint-config-typescript`（`vueTsConfigs.recommended`，整合 `typescript-eslint`）+ `eslint-config-prettier/flat`（關閉與 Prettier 衝突的 stylistic 規則）
- 不開 typescript-eslint 的 type-checked 規則（成本高、`vue-tsc --noEmit` 已把關）
- 自訂例外：
  - `vue/multi-word-component-names: 'off'`（router 內單字元件名常見）
  - `@typescript-eslint/no-unused-vars`：允許 `_` 前綴（`argsIgnorePattern` / `varsIgnorePattern` / `caughtErrorsIgnorePattern: '^_'`）
- ignores：`dist/`、`coverage/`、`public/`、`node_modules/`

**後端 Biome**（`server/biome.json`）：

- `linter.rules.recommended: true`，僅關閉 `style.noNonNullAssertion`（Fastify `auth.plugin.ts` 註冊 `authenticate` 後 `req.user!.userId` 是專案 idiom，TS 無法跨 hook 推導）
- formatter 設定**鏡射**根 `.prettierrc`：`quoteStyle: single`、`semicolons: asNeeded`、`trailingCommas: all`、`arrowParentheses: always`、`indentWidth: 2`、`lineWidth: 100`、`lineEnding: lf`
- `files.includes`：`src/**/*.ts`、`prisma/**/*.ts`，並排除 `src/generated`、`dist`、`node_modules`、`prisma/migrations`
- 注意：Biome 的折行 heuristic 與 Prettier 在邊界長度的處理略有差異，少數陳述式格式可能會被 Biome 重排，這是預期行為

**Prettier**（`.prettierrc`，僅作用於 `app/`）：

- `semi: false`、`singleQuote: true`、`trailingComma: 'all'`、`printWidth: 100`、`arrowParens: 'always'`、`endOfLine: 'lf'`
- 根 `.prettierignore` 排除 `server/`、產物、lock file、`.env`，避免 Prettier 與 Biome 互踩

**EditorConfig**（根 `.editorconfig`）：UTF-8、LF、2 空格縮排、保留最後換行、去除行尾空白（`.md` 除外）。

**Pre-commit hook**：目前未設定。如需 commit 前自動跑 lint/format，請另開任務導入 husky + lint-staged。

## TypeScript

- 前後端皆使用 **TypeScript 6**；啟用 `strict: true` 與 `noUncheckedIndexedAccess: true`。
- 前端：`target: ES2022`、`module: ESNext`、`moduleResolution: bundler`、`jsx: preserve`、`noEmit: true`。
- 後端：`target: ES2022`、`module: NodeNext`、`moduleResolution: NodeNext`、`outDir: dist`；`tsconfig.build.json` 另外排除 `**/*.test.ts`、`**/*.spec.ts`、`__tests__/`。
- 路徑別名統一 `@/*` → `./src/*`。Prisma 7 的產物在 `server/src/generated/prisma/`，因此型別與 client 透過 `@/generated/prisma/client.js` 匯入。
- TS 6 取消了 `node_modules/@types/*` 的自動 include；兩個 tsconfig 都已在 `compilerOptions.types` 顯式列出（`node`、前端再加 `vite/client`、`google.accounts`）。

## 模組與匯入

- 後端 `"type": "module"`（純 ESM）；相對 import **必須帶副檔名**（例：`./foo.js`），即便原始檔為 `.ts`。
- 前端以 Vite 打包，無此限制，但請維持一致的 `@/` 別名風格。

## 命名慣例

| 類型 | 規則 | 範例 |
|---|---|---|
| 檔名 | kebab-case | `auth.routes.ts`、`use-theme.ts` |
| Vue 元件檔 | PascalCase | `AppButton.vue`、`FlipCard.vue` |
| 類別 / 型別 / Interface | PascalCase | `UserDto`、`GenerateForUserInput` |
| 變數 / 函式 | camelCase | `submitReview()`、`userId` |
| 常數 | UPPER_SNAKE_CASE | `LOCK_TTL_SECONDS` |
| Enum 值 | UPPER_SNAKE | `'GOOGLE'`、`'LEARNING'` |
| API 路徑 | kebab-case | `/me/llm-keys/:provider` |
| Pinia Store 檔案 | `*.store.ts`，`defineStore('id', { ... })` | `auth.store.ts` |
| Pinia Store getter | UPPER_SNAKE_CASE（**store 內 computed 屬性的特例**） | `IS_AUTHENTICATED`、`CURRENT`、`REMAINING` |

## 註解

- **預設不寫**；好的識別字即是文件。
- 僅在「為什麼」非顯而易見（隱藏約束、workaround、效能取捨）時才寫一行說明。
- 不寫「什麼（WHAT）」或追蹤資訊（issue 編號、"added for X" 等 → 交給 commit message / PR）。
