---
status: accepted
---

# Review Cycle detection stays structural; semantic judgment is out of scope for MVP

§10.8 の Review Churn は「review 回数が閾値超過」「同じ指摘が繰り返される」「acceptance/exit condition が不明瞭」という3種の検出条件を挙げていたが、後者2つは自然言語の意味理解を必要とし、Profiler 自身が意味解釈を始めると §4「Observability first」(通信内容を勝手に解釈・変更しない)の思想と衝突する。またデフォルトでは payload を保持しないため、意味解析をしようにも原文が残っていない。

そこで Review Churn を Observed な **Review Cycle** と、そこから導かれる Diagnostic な **Review Churn Suspected** に分離した。Review Cycle は「同一 Task 内で Role が `reviewer` の Agent → 別 Role の Agent → 再び `reviewer` の Agent」という遷移(Tool span は無視)であり、Agent Role は ADR-0001 の通り明示的 metadata としてのみ与えられ、Profiler が Agent 名や発話内容から推測することはない。Role が `unknown` の場合は Review Cycle 判定自体を行わない。

「同じ指摘の繰り返し」は、ADR-0002 の fingerprint 基盤を転用し、ある review の output に含まれる ContentChunk のうち過去の review output に既出だった割合(**Repeated Review Content**、累積計算)として観測する。これは content 再出現の観測・推定値であり、「同じ問題が未解決である」ことを意味しない。

「acceptance/exit condition が不明瞭」の判定は MVP では行わない(UNKNOWN すら出さない)。将来的には MCP 経由で Agent 自身に `analyze_review_churn` のような形で「4 cycles発生しており review content の76%が既出である。exit condition が原因か判断せよ」と問い合わせる形(§19.3)に委ね、Profiler 自体が意味判定を担わない。

## Consequences

- Review Churn の warning は単一の合成スコアにせず、cycle count / repeated review content / progress signal / token traffic を個別の warning として並べて提示する(例: "Review cycle count high" ⚠)。
- diff サイズの代わりに **Progress Signal**(git の files_changed/lines_added 等)という coding-agent 限定でない一般概念を採用し、取得できない場合は "unavailable" として扱い MVP の必須入力にはしない。
- これは本プロダクト全体の原則("意味的分類を推測しない"; Agent Role・Task 境界・acceptance 判定はすべて明示的メタデータか対象外)の一適用例であり、他の診断機能を設計する際もこの原則に従う。
