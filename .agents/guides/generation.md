# 每日單字生成

> 用途：修改 `generation.service.ts`、生成相關 worker / 路由（`/generate/*`）、補足上限或相關 Redis key 前閱讀。
>
> 相關：[backend.md](./backend.md)、[security.md](./security.md)（Rate Limit）

改動時守住以下順序與不變量：

- 順序：今天已有 `DailyGenerationLog` 就直接回傳 → 先 `pickRandomCards` 從全站詞庫挑（排除使用者已有的卡，且須已有其母語翻譯與例句；上限為 `dailyNewCount`，追加則為 `count`）→ 不足才呼叫 LLM（`fillFromLlm`，最多兩輪）。
- LLM 提的字只在「使用者自己已有」時才被拒；全站已有但使用者沒有的字會沿用並補翻譯 / 例句（`backfillCard`）。prompt 不帶詞庫，靠事後比對。
- 一張都湊不到須丟 `NoNewWordsError` 且**不寫空的今日記錄**（否則今天會被誤判為已完成）；worker 以 `UnrecoverableError` 不自動重試。
- 湊不滿的補足：前端確認後走 `POST /generate/more` 帶 `fillShortfall: true`，每天最多 `MAX_DAILY_TOP_UPS` 次（`limits.config.ts`），超過回 409 `TOP_UP_LIMIT`；一般的「追加」不計入。
- Redis key（皆為短期暫存）：`gen:no-new-words:<userId>`（1 小時，供 UI 詢問重試，每次請求前清除）、`gen:rejected-lemmas:<userId>`（24 小時，被拒的字，下次請求自動帶入 prompt 避開，最多 `MAX_AVOID_LEMMAS` 個）、`gen:top-ups:<userId>:<date>`（補足次數）、`gen:short-streak:<userId>`（連續湊不滿次數，達 `SHORT_STREAK_HINT_THRESHOLD` 時 `/generate/status` 回 `suggestHigherLevel`，Dashboard 提示調高 CEFR）。
