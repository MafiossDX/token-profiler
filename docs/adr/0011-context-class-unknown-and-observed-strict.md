---
status: accepted
---

# context_class becomes three-valued with StructuralBlock splitting; Observed is reserved strictly for provider-reported values

1. spec.md §8 は `context_class` を `application / protocol` の二値としているが、「意味を推測しない」という設計原則(CONTEXT.md)と矛盾する: System Reminder 検出ロジック(§25 未解決 #1)が判定できないケースを、二値のどちらかに強制的に倒すことになる。
2. 実測(Q10 スパイク)で、`<system-reminder>` が user message の content 内部に埋め込まれるケースが確認されている。この場合、1つの API message の中に「本物の user text(application)」と「system reminder(protocol)」が混在しうる。現在の StructuralBlock は「1つの API message に1つの StructuralBlock」を暗黙に前提としており、この混在ケースを message 全体を application または protocol のどちらかに倒すことでしか表現できない。
3. CONTEXT.md の Measurement tiers は `Observed`/`Deterministic`/`Derived`/`Estimated`/`Diagnostic` をフラットに並べているが、spec.md では Context Amplification(byte basis で機械的に計算される Deterministic 値)や Review Cycle(Agent Role 遷移という structural fact から導かれる値)を「Observed」と表記している箇所がある(spec.md §10.4/§10.8)。CONTEXT.md 自身は「Observed は provider が直接報告した値」と厳密に定義しているため、これは用語の誤用であり、Fact/Diagnosis 分離(§4.2)の意図を弱める。

## Decision

### 1. context_class に unknown を追加し、1 message → 複数 StructuralBlock を許容する

```text
context_class: application | protocol | unknown
```

`unknown` は「System Reminder 検出ロジックが判定できなかった」ことを明示する値であり、application/protocol どちらかへのフォールバックは行わない(意味的分類を推測しない原則、CONTEXT.md)。

Transport Message(API 上の1メッセージ)から複数の StructuralBlock を抽出できるようにする:

```text
Transport Message
    ↓ extraction
StructuralBlock(application)
StructuralBlock(protocol)
```

user message 内部に system reminder が埋め込まれているケースは、そのメッセージを application 部分と protocol 部分の2つの StructuralBlock に分割して保存する。

### 2. Classification Coverage を導入する

Context Amplification の分母分子には `context_class=unknown` の volume を含めない一方、その volume 自体は破棄せず、**Classification Coverage**(全 volume のうち application/protocol に分類できた割合)として別途保持・表示する。unknown が多い Task では、Context Amplification の数値がどれだけの範囲をカバーしているかをユーザーが判断できるようにする。

### 3. Measurement tiers を Fact / Diagnostic の2グループに再整理する

```text
Fact
├─ Observed        # provider が API response で直接報告した値そのもの。これ以外の意味で使わない
├─ Deterministic     # raw payload から機械的・一意に計算できる値(Context Amplification 等はここ)
├─ Derived          # ローカル tokenizer 等で再計算する必要がある値
└─ Estimated        # 確率的手法による推定値(Near-Duplicate Similarity 等)

Diagnostic          # heuristic による解釈(likely avoidable traffic、Review Churn Suspected 等)
```

**Observed は「provider が API response で直接報告した値」専用語に固定する。** Context Amplification は Deterministic とする。Review Cycle は Agent Role/Thread Role の遷移という観測可能な構造から導かれる structural fact であり、厳密には Deterministic に近いが、Agent Role/Thread Role 自体の取得 confidence(ADR-0009)に依存するため、表示時はその confidence を併記する。spec.md 内の該当箇所(§10.4/§10.8)の「Observed」表記を修正する。

## Considered Options

- **context_class を二値のまま、判定できないケースは application にフォールバックする**: 却下。System Reminder が水増しされて Context Amplification が過大評価される方向にバイアスがかかる(protocol へのフォールバックなら過小評価だが、いずれにせよ「分からない」を「分かった」ことにしてしまう点が原則違反)。
- **Observed の定義を広げて「構造的に確からしい値」全般を含める**: 却下。Fact/Diagnosis 分離の運用上、「provider が直接報告した」という最も強い保証を持つ値と、ローカルで導出した値を同じ語で呼ぶと、UI 上の信頼度表示が意味を失う。

## Consequences

- spec.md §8 の StructuralBlock データモデルに `context_class=unknown` を追加し、1 message → 複数 StructuralBlock の分割を許容するようスキーマを更新する。
- Classification Coverage という新しい表示指標が必要になる(§25 実装項目に追加)。
- spec.md 内の「Context Amplification ← Observed」「Review Cycle(Observed)」という表記を修正する。
- CONTEXT.md の Measurement tiers セクションを Fact/Diagnostic の入れ子構造に更新する。
