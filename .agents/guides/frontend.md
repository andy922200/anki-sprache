# 前端（app/）指引

> 用途：修改 `app/`（頁面、元件、Pinia store、i18n、Tailwind、路由）前閱讀。
>
> 相關：[code-style.md](./code-style.md)、[backend.md](./backend.md)、[security.md](./security.md)

## Vue 元件

- 僅使用 `<script setup lang="ts">`；禁用 Options API。
- props / emits 以泛型 `defineProps<T>()` / `defineEmits<T>()` 宣告。
- 樣式採 Tailwind utility-first；必要時用 `<style scoped lang="scss">`。
- 圖示統一使用 Unicode emoji（目前無引入 icon library）。

## Tailwind 響應式斷點

- **禁用 `sm:`（≥640px）前綴。** 640px 太接近大型手機 landscape 寬度，作為 mobile / desktop 切換點容易讓人誤判：明明還是手機卻已跳成桌面版。
- 桌面 / 平板分界一律用 `md:`（≥768px，平板 portrait 起跳）；確需更細層次再用 `lg:`（≥1024px）/ `xl:`（≥1280px）。
- 例外：元件內部 size prop 名稱（如 `<AppButton size="sm">`、`AudioButton` 的 `sizeClass.sm`）的 `'sm'` 字串是設計系統尺寸命名（small / medium / large），與 RWD 斷點無關，不在此規範內。
- 不需要動 `tailwind.config` 移除 `sm` 斷點定義 — 規範以 review 為主，斷點本身保留以免外部 plugin 用到。

## i18n

- 新增 UI 字串必須同時更新 `app/src/i18n/locales/en.json` 與 `zh-TW.json`，保持鍵結構一致。
- 元件內以 `const { t } = useI18n()` 後的鍵取值，不硬寫字串（硬性禁令見 [AGENTS.md](../../AGENTS.md)）。

## 德文 / 葡文冠詞

`Gender` enum 混用兩種語意：德文存冠詞值 `DER` / `DIE` / `DAS`，羅曼語系（目前只有葡文）存 `MASCULINE` / `FEMININE`。顯示冠詞一律走 `app/src/utils/gender.ts` 的 `genderArticle(languageCode, gender)`（葡文 → `o` / `a`），**不要**直接對 `gender` 做 `toLowerCase()`（葡文會變成字面的 "masculine"）。後端 `audio.service.ts` 有一份同邏輯決定 TTS 唸的冠詞，新增語言的陰陽性時兩份要同步，並在 `shared/llm/prompts/dailyWords.ts` 的 `LEMMA_CONVENTIONS` 加一筆。

## 新增功能的既定路徑

- **新增前端頁面**：在 `app/src/pages/` 建立 `*.vue`，在 `router/index.ts` 加入路由；需要導航時同步更新 `components/layout/AppHeader.vue`。
- **新增 Pinia Store**：命名 `*.store.ts`，放 `app/src/stores/`，採 **Options Store** 風格 `defineStore('id', { state: () => ({ ... }), getters: { ... }, actions: { ... } })`：
  - `state`、actions 名稱沿用 camelCase；**`getters` 一律 UPPER_SNAKE_CASE**（如 `IS_AUTHENTICATED`、`CURRENT`），便於與 state / actions 一眼區分。
  - getter 用箭頭函式接 `state`：`IS_AUTHENTICATED: (state): boolean => !!state.accessToken`；需要交叉引用其他 getter 時才改用 `function () { return this.OTHER_GETTER }`。
  - action 內以 `this.foo` 存取 state、`this.BAR` 存取 getter；箭頭函式（如 `setTimeout` 回呼）會自動繼承外層 `this`。
  - 不得用 closure 宣告私有變數；如需「不暴露給 reactive 系統的可變值」（例如 `hydrationPromise`、`nextToastId`），請放在**模組層級**（`defineStore` 之外）。
  - 修改 store 暴露面（renaming getter / action）時，務必同步更新 `app/src/router/`、`composables/`、`pages/`、`components/` 中所有 callsite。

## 路由守衛規則

- 所有路由定義於 `app/src/router/index.ts`，`beforeEach` guard 會先 `auth.hydrate()`。
- 未標記 `meta.public: true` 的路由皆需登入；未登入會被導向 `/login?redirect=<原目標>`。
- 已登入者訪問 `/login` 會被導去 `/`。
- 本專案**無角色分級**：所有登入使用者權限相同，無 admin 專區；資源隔離透過 `userId` 綁定完成。

## 前端頁面與子頁面

| 路徑 | 元件 | 公開 / 需登入 | 子頁面 | 主要功能 | Query / Params |
|---|---|---|---|---|---|
| `/login` | `LoginPage.vue` | 公開（`meta.public`） | — | Google Sign-In；成功後導向 `redirect` 或 `/` | `?redirect=<path>` |
| `/` | `DashboardPage.vue` | 需登入 | — | 每日生成狀態（每 1.5 秒輪詢、最多 10 次，約 15 秒後請使用者重新整理）、LLM 設定檢查、今日 5 張卡預覽、Flip / 選擇題 / 練習模式入口 | — |
| `/review` | `ReviewPage.vue` | 需登入 | — | 複習介面；支援 FSRS 正式複習與 Practice 模式；快速鍵 1–4 評分、Space / Enter 翻面、P 播放單字發音 | `mode=FLIP\|choice`、`practice=true` |
| `/logbook` | `LogbookPage.vue` | 需登入 | — | 複習紀錄分頁（每頁 50 筆），可按評分與模式篩選 | — |
| `/settings` | `SettingsPage.vue` | 需登入 | `/settings/api-keys` | 個人資料、目標 / 母語、CEFR、每日新詞數、偏好 LLM Provider + Model、主題、UI 語系 | — |
| `/settings/api-keys` | `ApiKeysPage.vue` | 需登入 | —（Settings 子頁面） | OpenAI / Anthropic / Google API Key 管理；僅顯示 12 字元指紋；新增 / 取代 / 刪除 | — |
| `/:pathMatch(.*)*` | `NotFoundPage.vue` | 公開 | — | 404 Fallback | — |

合計 **7 個路由**，其中 `/settings/api-keys` 為 `/settings` 的子頁面。
