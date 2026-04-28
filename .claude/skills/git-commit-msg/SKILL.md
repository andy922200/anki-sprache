---
name: git-commit-msg
description: 撰寫 commit message。Conventional Commits + 正體中文 + 整行 ≤ 50 字；type 限定 feat/fix/chore/refactor/docs/style/perf/test 八種。
---

# git-commit-msg

## 何時使用

被要求撰寫、建議或修正本專案的 git commit message 時，套用以下規範。

## 格式

```
<type>(<scope>): <描述>
```

- `<scope>` 選填；無合適 scope 時直接寫 `<type>: <描述>`。
- 冒號後一個半形空白，描述不加結尾句點。

## Type（僅此 8 種）

| Type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修正 bug |
| `refactor` | 重構（不改變外部行為） |
| `perf` | 效能改善 |
| `style` | 格式 / 排版（不影響邏輯） |
| `docs` | 文件 |
| `test` | 測試 |
| `chore` | 雜項（建置、相依套件、工具設定） |

不在表內的 type（如 `build`、`ci`、`revert`）一律不使用。

## 長度

整行（含 type、scope、括號、冒號、空白、描述）**≤ 50 字**。中文一字計一字、英文一字母計一字。超出時優先精簡描述，再考慮拿掉 scope。

## 語言

- 描述用**正體中文（zh-TW）**，採台灣慣用詞（檔案 / 函式 / 物件 / 陣列 / 字串 / 最佳化…）。
- `type`、`scope`、程式識別字（class、function、env 變數、套件名）保留英文。

## scope 建議

從本 repo 既有提交歷史提煉，可視變更區域擇一：`ipa`、`audio`、`cards`、`llm`、`fsrs`、`auth`、`review`、`worker`、`generation`、`settings`。新模組可自訂簡短英文名。

## 撰寫風格

- 著重「為何改」或「帶來的影響」，而非單純複述「做了什麼」。
- 祈使句或結果敘述皆可，不加結尾句點。
- 不寫 issue 編號、不寫「added for X」、不擅自加 `Co-Authored-By`（除非使用者明確要求）。

## 範例

良好：

- `fix(ipa): 統一存為 /.../ 並修正雙斜線`
- `feat(cards): 加入 TTS 發音按鈕`
- `refactor(llm): lemma normalizer 多語言工廠化`
- `chore: 升級 prisma 至 7.8`

避免：

- `Fixed typo`（英文、無 type）
- `feat: add new feature`（中英混用、語意空泛）
- `fix(audio): R2 改用 content-addressed key 以避免跨環境重複下載`（超過 50 字）
- `update.`（無 type、有句點、無資訊量）

## 提交前檢查

- [ ] type 屬上述 8 種之一
- [ ] 整行 ≤ 50 字
- [ ] 描述為正體中文
- [ ] 無多餘標點（句點、引號、括號濫用）
- [ ] 未自行加 `Co-Authored-By` 等附註

## 延伸閱讀

- `AGENTS.md` § H — AI 輔助開發指引（語言與術語規範）
- `git log --oneline -20` — 觀摩近期提交實際樣式
