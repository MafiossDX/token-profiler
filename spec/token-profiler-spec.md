# token-profiler — 初期仕様書

> 用語の正式な定義は [`CONTEXT.md`](../CONTEXT.md) を参照。設計上の重要な決定とその理由は [`docs/adr/`](../docs/adr/) を参照。本文中の用語・図はそれらの決定に合わせて更新済みだが、§25 に挙げた論点はまだ未決定。

## 1. 概要

**token-profiler** は、LLM / AI Agent が「どこで・誰に・何 token を使ったか」を観測し、token 消費の増幅・再送・重複・ループなどの原因を特定するためのローカル観測ツールである。

コンセプトは以下。

> **A profiler for AI agent token traffic.**  
> **See where your tokens go.**

CPU profiler や Wireshark / ntopng のように、最適化そのものを行うのではなく、まず **実際に流れた token traffic を可視化し、原因を特定できること** を主目的とする。

---

## 2. 背景

LLM / Agent の利用では token が主要な計量資源となっている。

特にマルチエージェント構成では、単純な「1 request あたり token 数」だけでは実態を把握しにくい。

典型的には以下のような問題が発生する。

- Orchestrator が同じ context を複数 Worker に配布する
- Reviewer の結果を Orchestrator が再度 Worker に渡す
- tool output や source code が複数 request に繰り返し含まれる
- review / retry が終了条件なしで繰り返される
- 並列 Agent が同じファイルやログをそれぞれ読み込む
- system prompt / tool schema が毎回大きな割合を占める
- Agent 間 handoff により元情報量以上の token traffic が発生する

これらは **token 使用量そのものではなく、token の流れを観測しなければ原因を特定できない**。

---

## 3. プロダクトの立ち位置

### 3.1 Headroom との差別化

Headroom は主として LLM context の圧縮・最適化を行う。

token-profiler は **最適化ではなく診断** を担当する。

| 項目 | Headroom | token-profiler |
|---|---|---|
| 主目的 | token を減らす | token 消費の原因を特定する |
| Proxy | あり | あり |
| token / cost 集計 | あり | あり |
| context 圧縮 | 主機能 | 原則行わない |
| tool output 圧縮 | あり | 原則行わない |
| cache 最適化 | あり | 原則行わない |
| Agent 別 token 分析 | 一部 | 主機能 |
| context 再送追跡 | 一部 | 主機能 |
| 同一情報の伝播追跡 | 限定的 | 主機能 |
| review loop 検出 | 主目的ではない | 主機能 |
| fan-out 増幅検出 | 主目的ではない | 主機能 |
| Token Flamegraph | 主目的ではない | 主機能 |
| Task 間 regression 比較 | savings 寄り | 主機能 |
| 通信内容の変更 | あり得る | デフォルトでは変更しない |

関係性としては競合よりも、

```text
token-profiler
        │
        │ 問題箇所を発見
        ▼
「Reviewerへの再送が41万token」
        │
        ├─ Agent設計を修正
        └─ Headroom等で圧縮
```

という共存も可能。

---

### 3.2 RTK との差別化

RTK(https://github.com/rtk-ai/rtk)は、Claude Code の PreToolUse hook で `git status` 等の Bash コマンドを `rtk git status` のように書き換え、tool output を圧縮する。Claude の Read/Grep/Glob のような built-in tool はこの Bash hook を通らず、観測対象は tool 実行層に限られる。

token-profiler が観測するのはさらに外側の **model API 通信層**(system/context/tool/result/response 全体)であり、通信内容は原則変更しない。

| 項目 | RTK | token-profiler |
|---|---|---|
| 主目的 | token 削減 | token traffic の原因分析 |
| 観測位置 | tool 実行層 | model API 通信層 |
| 主対象 | Bash/tool output | system/context/tool/result/response 全体 |
| 動作 | command/output を変更 | 原則変更しない |
| token 計測 | bytes / 4 の推定 | provider observed + deterministic byte metrics |
| 重複分析 | output 圧縮のため | context lineage / amplification 分析 |
| Agent 分析 | 主目的ではない | Agent/Thread/Review Churn が主対象 |
| ゴール | LLM へ渡す量を減らす | なぜ量が増えたかを説明する |

競合というより役割が異なる:

> **RTK reduces what enters the context. token-profiler explains how context moves and amplifies.**

導入 UX については RTK から学ぶ点がある(`init`/`status`/`uninstall` のような zero-friction UX、client ごとに異なる仕組みを同じコマンド体系に隠す設計、ADR-0006〜ADR-0009)。ただし RTK の「対応 client 数」を KPI として追うことはしない(ADR-0008)。

---

## 4. 基本思想

### 4.1 Observability first

token-profiler は通信内容を勝手に最適化しない。

```text
観測
 ↓
原因特定
 ↓
人間 / Agent が判断
 ↓
設計変更・圧縮・キャッシュ等を実施
 ↓
Before / After を比較
```

CPU profiler が CPU 使用率を勝手に改善しないのと同じ考え方とする。

---

### 4.2 Fact と Diagnosis を分離する

Profiler が観測できる事実と、「無駄そう」という推定を分ける。

#### Observed

- input tokens
- output tokens
- cached tokens
- repeated context
- repeated tool output
- retry count
- agent handoff
- latency
- request count

#### Diagnostics

- likely redundant
- possibly redundant
- review loop suspected
- unnecessary fan-out suspected
- context retransmission unusually high

「重複している = 無駄」とは断定しない。

同一情報の再送が必要な場合もあるため、**Waste 判定は heuristic / Eval として扱う**。

---

## 5. アーキテクチャ

### 5.1 基本構成

本体は localhost に常駐する daemon とする。

```text
Codex / Claude Code / Custom Agent
                │
                ▼
        localhost:<port>
       ┌───────────────────┐
       │ Token Traffic Proxy│
       │                   │
       │ capture           │
       │ tokenize          │
       │ correlate         │
       │ analyze           │
       └───────┬─────┬─────┘
               │     │
               │     └────────► Web UI
               │
               ▼
       OpenAI / Anthropic
```

利用者は API Base URL を localhost proxy に切り替えることで観測を開始できる。

例:

```text
OPENAI_BASE_URL=http://localhost:8765/v1
```

---

### 5.2 wrap による明示的な意味情報の付与

Proxy だけでは「どの request が Orchestrator / Reviewer / Worker なのか」を完全には判定できない。

これを解決するために OpenTelemetry SDK 統合をすべての対象 CLI に要求すると、統合コストが高く、`wrap` の「Base URL を切り替えるだけ」という手軽さ(§5.1)と矛盾する。そのため、意味情報(Task / Agent / Agent Role)は `wrap` 実行時に明示的に付与し、Profiler 側では推測しない(詳細: ADR-0001)。

```text
Agent ──── wrap ──┬─ Task ID / Agent Role
                   │   (明示的 metadata。推測しない)
                   │
                   └─ Proxy Binding 経由の Local Proxy
                       実際に流れた通信
                            │
                            ▼
                      Token Profiler
```

役割は以下。

| レイヤー | 役割 |
|---|---|
| wrap | Task / Agent / Agent Role の明示的な付与。子プロセスは Task ID を環境変数で自動継承するが、別 Agent として区別されるには改めて `wrap` する必要がある |
| Local Proxy(Proxy Binding) | 実際に送受信された token traffic の観測。Proxy Binding(opaque token)で (task_id, agent_id, agent_role) に紐づける |
| Profiler Engine | overlap、増幅、loop、retry 等の分析 |
| Web UI | 人間向け可視化 |
| MCP | Agent 自身から分析結果へ問い合わせ |
| OTel(任意) | 対象プロセスが独自に span を発行している場合のみ、相関情報として記録する。MVP の必須要件ではない |
| Provider/Client Enrichment Adapter(任意) | client 固有の非公開実装詳細(例: Claude Code の `cc_is_subagent` marker)から Conversation Thread を復元する。Core(Task/Agent/Request/StructuralBlock/Fingerprint/Context Amplification)には影響しない、切り離された層(ADR-0005) |

---

## 6. MCP の位置づけ

MCP は観測の主経路にはしない。

理由は、MCP Server は通常 conversation 全体を観測する立場ではなく、Host から渡された invocation のみを見るため。

MCP は **Profiler の問い合わせインターフェース** とする。

想定 tool:

```text
get_token_summary
get_hotspots
get_context_growth
get_duplicate_context
get_agent_flows
get_amplification
get_review_loops
compare_tasks
explain_token_waste
```

利用例:

```text
Codex:
「今回の実装で一番token効率が悪かった箇所を調べて」
```

Profiler:

```text
1. Reviewer → Orchestrator
   28,420 tokens
   82% overlaps previous context

2. Worker-3 test output
   17,201 tokens
   same output included 4 times

3. Review loop
   46,102 tokens
   3 reviews with no material code change
```

Agent が自身の token traffic を解析できる構造を目指す。

---

## 7. 観測モデル

### 7.1 基本単位

ネットワーク解析との対応を以下のように捉える。

| Network | Token Profiler |
|---|---|
| packet | LLM request / message |
| bytes | tokens |
| flow | task / agent session |
| source | agent |
| destination | model / tool / agent |
| protocol | reasoning / review / tool / coding |
| payload | context |
| retransmission | context 再送 |
| duplicate traffic | duplicated context |
| retry | model / tool retry |
| top talker | token 大量消費 Agent |
| throughput | tokens/sec |
| NetFlow | span / trace 集計 |

---

## 8. データモデル

識別子階層は `Task → Agent → Conversation Thread → Request` を canonical hierarchy とする(ADR-0001、ADR-0005)。`run_id` は廃止し `task_id` に統合した。Conversation Thread は optional で、対応する Provider/Client Enrichment Adapter がある場合のみ埋まる。**Core の `task_id` を発行できるのは `wrap` のみ**(ADR-0001)であり、Adapter 側の `extractClientSessionMetadata()` が返す `external_session_id` は Enrichment 層の相関用メタデータに過ぎず Core の task_id を上書きしない(ADR-0009)。OTel 由来の識別子は必須ではなく、対象プロセスが独自に span を発行している場合のみ記録するオプションの相関フィールドとする。

Request 単位(Observed)で最低限以下を保存する。

```text
timestamp
request_id            REQUIRED

task_id                REQUIRED
agent_id               OPTIONAL (unknown 時は未設定)
agent_role             OPTIONAL (未指定時は unknown)

conversation_thread_id  OPTIONAL (Enrichment Adapter が識別できた場合のみ)
thread_role             OPTIONAL (block_fingerprint → role マッピングで解決できた場合のみ、ADR-0010)

model
provider
tokenizer_id

operation_type
tool_name

provider_reported_input_tokens
provider_reported_output_tokens
cache_creation_input_tokens   # Observed(provider の usage レスポンスに含まれる)
cache_read_input_tokens       # Observed

latency_ms
request_index
retry_of

otel_trace_id          OPTIONAL
otel_span_id           OPTIONAL
otel_parent_id         OPTIONAL
```

StructuralBlock 単位で以下を保存する。`context_class` は `type`/`transport_role` から機械的に導出せず、System Reminder 検出ロジック(§25 未解決 #1)を経て決める。1つの Transport Message から複数の StructuralBlock を抽出することを許容する(user message 内部に system reminder が埋め込まれるケース、ADR-0011)。

```text
type              # system / message / tool_schema / tool_result
transport_role     # system / user / assistant (API 上の role。type=message の場合のみ意味を持つ)
context_class       # application / protocol / unknown (System Reminder は常に protocol、ADR-0011)
block_fingerprint    # HMAC-SHA256(local_secret, normalized_block) — StructuralBlock 全体の fingerprint(ADR-0010、Thread Role マッピングに使用)
```

ContentChunk 単位(Deterministic / Derived、ADR-0002)で以下を保存する。`similarity_signature` は ContentChunk のフィールドではなく、Similarity Unit(下記)のフィールドである点に注意(ADR-0010)。

```text
byte_length              # normalized bytes (Deterministic)

exact_fingerprint         # HMAC-SHA256(local_secret, normalized_chunk)
fingerprint_algorithm
fingerprint_version
fingerprint_key_id        # Fingerprint Key Epoch

token_estimates[]          # Derived。tokenizer domain ごとに複数持ちうる
  tokenizer_id
  token_count
  method                    # local_exact_tokenizer / estimated
```

Similarity Unit 単位(Estimated、ADR-0010)で以下を保存する。粒度(message / StructuralBlock / review output のいずれか)は未決定(§25)。

```text
unit_id
member_content_chunk_ids[]   # このUnitを構成するContentChunkの集合

similarity_signature          # MinHash (Estimated)
similarity_scheme_id
similarity_epoch              # shingle hash/seed 自体が epoch に依存する(単なるタグ付けでは不可、ADR-0010)
```

任意で以下を保持(Payload Capture: ON の場合のみ)。

```text
prompt_payload
response_payload
tool_payload
```

---

## 9. Privacy / Capture Policy

### 9.1 デフォルト

全文 payload は保存しない。

保存するのは主として、

- token count
- metadata
- Exact Fingerprint(HMAC-SHA256)
- Similarity Signature(MinHash)
- Agent / model / tool 情報
- timing
- trace topology

とする。

理由:

LLM prompt には以下が含まれる可能性がある。

- source code
- credential 周辺情報
- customer data
- internal document
- confidential information

**注意**: Exact Fingerprint は非可逆(元テキストを復元できない)だが、辞書照合攻撃を防ぐため installation 固有の `local_secret` で HMAC 化する。Similarity Signature も非可逆だが、類似度計算を可能にするために元コンテンツの feature 情報を保持しているため、**無害なメタデータではなく sensitive metadata として扱う**(詳細: ADR-0002)。

---

### 9.2 Capture mode

必要な Task のみ全文 capture を有効にできる。

```text
Payload Capture: OFF   # default
Payload Capture: ON    # debug mode
```

保持期間も設定可能とする。

```text
Retention:
  metadata: 30 days
  payload: 1 day
```

Data retention(fingerprint/signature を何日保持するか)と、後述の Key Epoch の寿命(secret 自体をいつ rotate するか)は独立した概念である。Epoch は retention 期間より大幅に長く持続してよい(例: retention 30日、epoch は数ヶ月〜1年)。

---

### 9.3 Key rotation

`local_secret` は installation 単位で永続化し、OS の secure storage(macOS Keychain / Windows Credential Manager・DPAPI / Linux Secret Service)を第一選択とする。利用できない環境では permission 制限したローカルファイル(0600 相当)にフォールバックする。

rotate には2種類を用意する。

- **通常 rotation**: 旧 epoch の key も secure storage に保持し(世代数は制限)、新規 payload を旧・新両方の key で評価することで過去との継続性を保つ。
- **Privacy reset**(`rotate-secret --forget-old`): 旧 key を破棄し、以前の epoch との照合を意図的に断つ。HMAC key epoch と similarity epoch の両方を同時に切る。

既に保存済みの fingerprint 同士(同一 epoch 内)の比較は rotate 後も引き続き可能。無効になるのは異なる epoch をまたいだ新規照合のみで、この場合は「不一致(0%)」ではなく「比較不能」として明示する(詳細: ADR-0002)。

---

## 10. 主要指標

### 10.1 Token Usage

基本値。

```text
Input Tokens
Output Tokens
Cached Tokens
Total Tokens
```

---

### 10.2 Context Growth

request ごとの context 増加を追跡する。

```text
8k
 ↓
17k
 ↓
31k
 ↓
54k
 ↓
81k
```

異常な増加を検出する。

---

### 10.3 Context Overlap

直前 request または過去 request と context がどの程度重複しているか。「重複」は **Exact Reuse Ratio**(完全一致、Deterministic)と **Near-Duplicate Similarity**(推定類似度、Estimated)の2種類に分けて示す(詳細: ADR-0002)。Exact Reuse Ratio は Context Amplification と同じく basis を持ち、デフォルトは byte basis。

```text
Request #19

Input                44,281 tokens

system                3,201
tools                 5,882
new context           6,120
repeated context     24,911
repeated tool output  4,167

Previous Request Reuse
────────────────────────────
Exact reuse (byte basis)   68.1%
Estimated similarity       91.3%
```

詳細表示では StructuralBlock ごとに分解する。

```text
system
  exact reuse              93.1%

tool schemas
  exact reuse             100.0%

conversation
  exact reuse              71.8%
  near similarity          88.2%

tool results
  exact reuse              42.3%
  near similarity          94.1%
```

---

### 10.4 Context Amplification

Task 全体で、同一情報が Agent topology を通じて何倍 transport されたかを表す(旗艦指標。詳細: ADR-0003)。

```text
Unique Context Volume       31,000 bytes
Context Transport Volume   184,000 bytes

Context Amplification        5.94x
```

**basis はデフォルトで content bytes(provider/tokenizer 非依存、Deterministic)。** system prompt / tool schema(Protocol Context)は構造的に毎 request 再送される overhead のため、この計算から除外し Protocol Transport Volume として別集計する(§10.4.1)。

単一 tokenizer domain の Task では、補助指標として token basis の **Token Amplification** も表示できる。異なる tokenizer domain をまたぐ単一の比率は作らない — 実行順序(どちらの tokenizer が先にそのchunkを見たか)に依存して数値が変わってしまい、§19.1 Regression Detection の信頼性を損なうため。

```text
Context Amplification             5.94x   (basis: content bytes)

Token Traffic
  OpenAI                         98,100
  Anthropic                      85,900
                               ───────
  Observed Token Traffic        184,000

Token Amplification
  GPT tokenizer domain            4.58x
  Claude tokenizer domain         4.54x
```

**Context Amplification は Deterministic な値であり、その transport が回避可能・不要であったことは意味しない**(§4.2 Fact/Diagnosis 分離、Measurement tiers、ADR-0011)。avoidable かどうかの判定は別途 Diagnostics レイヤーで扱う。測っているのは request payload として実際に wire 上を transport された context(request-visible context)であり、model が実際に参照した effective context ではない — server-side conversation state を使う API(Codex Responses 等)では known limitation になる(CONTEXT.md Context Amplification 参照)。

```text
Context Amplification       5.94x   ← Deterministic
Classification Coverage      96.2%  ← 分類できた volume の割合(ADR-0011)

Likely avoidable traffic     81k    ← Diagnosis
Necessary/unknown traffic   103k    ← Diagnosis
```

#### 10.4.1 Protocol Transport

system / tool schema の transport 量を別途表示する。

```text
Task #142
──────────────────────────────
Total Input Transport       241k

Application Context         184k
Protocol Transport            57k
  system                     31k
  tool schemas                26k
Unclassified (context_class=unknown)  3k

Protocol Share: 23.7%
```

---

### 10.5 Agent Handoff Amplification

Agent 間で同じ情報が何度転送されたかを追跡。

```text
orchestrator
    │ 38k
    ▼
 reviewer
    │ 31k (82% overlap)
    ▼
orchestrator
    │ 29k (76% overlap)
    ▼
 worker-2
```

```text
Unique Context Volume:   21,492
Context Transport Volume: 98,241
Context Amplification:      4.57x
```

---

### 10.6 Tool Output Replay

同じ tool output が複数 request に含まれている状態。

```text
git diff: 14,281 tokens

Request #21   14,281
Request #22   14,281  same
Request #23   14,281  same
Request #24   12,917  91% same
Request #25   14,281  same

Context Transport Volume: 70,041
Unique Context Volume:    15,032
```

---

### 10.7 Retry Waste

同一目的の call が繰り返された量。

```text
attempt #1   18k
attempt #2   17k
attempt #3   19k

retry traffic: 36k
```

---

### 10.8 Review Cycle / Review Churn Suspected

Reviewer と修正 Agent の往復を検出する。**Review Cycle は structural fact、Review Churn Suspected は Diagnostic** として明確に分離する(詳細: ADR-0004)。

**Review Cycle**(structural fact。Observed ではない — Agent Role/Thread Role の取得 confidence に依存するため、Measurement tiers・ADR-0011 参照): 同一 Task 内で、Role が `reviewer` の単位 → 別 Role の単位 → 再び `reviewer` の単位、という遷移。**粒度は Conversation Thread + Thread Role が識別できる client では Thread 優先、できなければ Agent + Agent Role**(CONTEXT.md Review Cycle 参照)。Tool span は遷移判定から除外する。Role は明示的 metadata としてのみ与えられ(§5.2、ADR-0001)、Role が `unknown` の単位が絡む場合は判定しない。

```text
Task #142
│
├─ Reviewer R1     review #1   12k
├─ Implementer I1  fix         18k
├─ Reviewer R2     review #2   15k
├─ Implementer I2  fix         21k
└─ Reviewer R3     review #3   17k

Review cycles: 2
```

**Repeated Review Content**: ある review の output に含まれる ContentChunk のうち、それ以前の review output に既出だった割合(Exact Fingerprint 一致 + Near-Duplicate Similarity、累積計算)。「同じ指摘が繰り返されているか」を、review 全体の類似度ではなく **既出 content の割合** として観測する。

```text
Review #3
────────────────────────
Output volume             8.2 KB

Exact repeated content    2.1 KB
Near repeated content     3.4 KB
New content                2.7 KB

Repeated Review Ratio       67%
```

**Progress Signal**: Review Cycle の間に実際の成果物がどれだけ変化したかを示す外部シグナル(git が観測できれば files_changed / lines_added / lines_deleted / diff_bytes 等)。coding agent に限定しない一般概念とし、取得できなければ「unavailable」として扱う(MVP の必須入力ではない)。

**Review Churn Suspected**(Diagnostic): 上記のシグナルを個別の warning として提示する。単一の合成スコアにはしない。

```text
Review Churn Suspected

Review cycle count high          ⚠  (cycles: 4)
Repeated review content high     ⚠  (76%)
Low progress between reviews     ⚠  (progress signal: small)
```

`acceptance / exit condition が不明瞭`の判定は MVP では行わない(UNKNOWN すら出さない)。これは reviewer 出力の自然言語的な意味理解を要し、§4「Observability first」の思想と衝突するため。将来的には MCP 経由で Agent 自身に判断させる(§19.3)。

---

### 10.9 Parallel Duplication

複数 Agent が同一情報を別々に取得している状況。

例:

```text
Worker-A: README.md       18k
Worker-B: README.md       18k
Worker-C: README.md       18k
```

同一 source を各 Agent が独立して読み込んでいる場合に検出する。

---

## 11. Token Flamegraph

Agent/操作単位の token 消費を階層的に可視化する案。未実装。

---

## 12. Flow Graph

Agent 間の token flow を可視化する案。未実装。

---

## 13. Expert Diagnostics

> ADR-0014: Expert Diagnostics は Fact と分離した opt-in の Diagnosis レイヤーであり、観測 UI・既定出力には出さない(UI は Fact + 測定条件の注記のみ。唯一の write path は確認付き Task 削除 = ローカルデータ管理)。v0 では未実装。

Wireshark の Expert Information に相当する、事実値 + heuristic の warning 群を出す案。未実装。

---

## 14. UI

> 実装済みの localhost UI(`token-profiler ui` / `wrap` 相乗り、`/`)の情報設計は
> `docs/ui-information-design.md` + `docs/adr/0016-ui-leads-with-diagnostic-reading.md`
> (+ `docs/adr/0017-ui-brings-evidence-adjacent-and-softens-labels.md` が §3.2/§3.5/§3.6/§3.7/§3.9 を改訂、
> `docs/adr/0018-request-investigation-panel-and-pagination.md` がパネル構成をさらに統合・改番)で確定している。
> 中央ペインは Context Amplification の診断的な読み(1 Current amplification → 2 Next focus →
> 3 request 調査 [一覧⇄タイムラインの表示切替 + 隣接する Request detail、ページング付き] →
> 4 推移・閾値プロット → 5 重複文脈バイトの内訳)。Export はパネル番号を持たず Task 見出し横の
> `<details>` に置く(ADR-0018)。参照ゾーンは倍率レンジ表記(`1–2x` 等)で、評価語は出さない(ADR-0017)。
> 以下 §14.1–§14.6 は本 spec 起草時の当初スケッチで、そのまま実装しているわけではない。

### 14.1 Tasks

```text
Task              Tokens    Context Amplification   Duration
#142              1.21M       5.4x                   18m
#141               482k       2.1x                    7m
#140               991k       6.8x                   14m
```

---

### 14.2 Current Task Summary

```text
Current Task
────────────────────────────────
Total tokens              428,921
Input                     377,204
Output                     51,717
Cached                    201,482

Repeated context           63,817
Tool output replay         17,203
Retry traffic               7,912
```

---

### 14.3 Agent Conversations

```text
Agent             Calls    Input    Output   Repeated
────────────────────────────────────────────────────
orchestrator        42      381k      52k      188k
reviewer            18      242k      41k      103k
worker-1            12       81k      22k        9k
worker-2            14       94k      19k       11k
```

---

### 14.4 Token Timeline

request 単位の token 使用量、context growth、retry、tool call を時系列表示。

---

### 14.5 Context Inspector

request の構成要素を表示。

```text
Request #19

system              3,201
tool schemas        5,882
new context         6,120
repeated context   24,911
tool output         4,167
```

---

### 14.6 Task Comparison

> **将来機能(未実装)。** Task 同士の Before/After 比較。着手前に、比較の妥当性(Measurement Profile
> 互換性、因果効果の断定をしない範囲設定など)を ADR で整理してから着手する(ADR-0017)。

---

## 15. MVP

最初から Langfuse のような総合 LLM Observability platform は作らない。

> **現在の実装対象と将来構想の切り分けは `docs/STATUS.md` を正とする**(この節の一覧は当初スケッチで
> 範囲が広い)。最初の到達点は「1 つの Task で調査対象(request 調査パネルの重複の多い request)と根拠が分かる」まで。
> fingerprint 出現履歴 / Task 比較 / Task 名前・メモ は将来(ADR-0017 Deferred)。

### MVP の目的

> **「なぜこの Task は token が多かったのか」を説明できること。**

### MVP 機能

1. `wrap` CLI(Task/Agent/Agent Role/Proxy Binding の明示的発行。ADR-0001)
2. Localhost Proxy
3. Request / Response token count(Observed)
4. Task / Agent / Model / Tool 別集計
5. StructuralBlock/ContentChunk 分割 + Exact Fingerprint + Near-Duplicate Similarity(ADR-0002)
6. Context Overlap(Exact Reuse Ratio + Near-Duplicate Similarity)
7. Context Growth
8. Context Amplification(byte basis) + Token Amplification(tokenizer domain別)(ADR-0003)
9. Token Flow Graph
10. Token Flamegraph
11. Review Cycle検出 + Review Churn Suspected diagnostics(ADR-0004)
12. Task Comparison

---

## 16. MVP 初期画面

最重要画面は以下。

```text
Request #19

Input                   44,281 tokens
┌──────────────────────────────────────┐
│ system                    3,201      │
│ tools                     5,882      │
│ new context               6,120      │
│ repeated context         24,911 ████ │
│ repeated tool output      4,167      │
└──────────────────────────────────────┘

Previous Request Reuse
  Exact reuse (byte basis)   68.1%
  Estimated similarity       91.3%

⚠ Context retransmission unusually high
```

これだけでも「token が多い」のではなく、

**何が増やしているのか**

を判断できる。

---

## 17. MVP でやらないこと

初期段階では以下を Non-goal とする。

- context 自動圧縮
- prompt 自動書き換え
- Agent routing の自動変更
- model 自動変更
- token budget の強制
- LLM Gateway としての高度な routing
- full observability platform
- Eval platform
- distributed tracing platform の再実装

識別子階層は Task/Agent/Conversation Thread/Request を canonical hierarchy とし(Conversation Thread は Enrichment Adapter がある場合のみ、ADR-0005)、OTel SDK 統合は MVP の必須要件にしない。対象プロセスが独自に OTel span を発行している場合は、任意の相関情報として取り込む(ADR-0001)。

---

## 18. 成功指標

Token Profiler 自体の価値は単純な token 削減率だけでは測らない。

候補:

```text
tokens / successful task
tokens / accepted change
tokens / resolved issue
tokens / merged PR
tokens / completed review
```

また診断性能として、

```text
time to identify token hotspot
number of high-amplification flows detected
number of regressions detected
```

も考えられる。

---

## 19. 将来機能

### 19.1 Regression Detection

過去 Task との比較で token regression を検出する案。未実装。

---

### 19.2 Token Budget

Task の token 予算を設定・表示する案。profiler の主目的から外れないよう、初期には enforcement しない。
未実装。

---

### 19.3 Agent 自己診断

MCP を通じて Agent が自身の実行結果を評価する案。未実装。

---

### 19.4 Information Lineage

同じ情報がどの Agent を経由したかを追跡する案(fingerprint ベースの出現履歴)。未実装。

---

## 20. 技術方針

基本候補:

```text
wrap(明示的な Task/Agent/Proxy Binding 発行)
    +
Local Proxy
    +
Local Storage(fingerprint / similarity signature を含む)
    +
Web UI
    +
MCP Server
```

OTel は必須構成要素ではない。対象プロセスが独自に span を発行している場合のみ、任意の相関情報として取り込む(ADR-0001)。

Local-first を基本とする。

初期段階ではクラウドサービスを必須にしない。

### 20.1 言語 / ランタイムの選定

第一候補は Node.js + TypeScript。実装は TypeScript(`.ts`)。core / CLI / proxy は Node.js の native type stripping で変換なしに直接実行し、ビルド手順を持たない(要 Node >= 22.18、22.6〜22.17 は `--experimental-strip-types`)。`typescript` / `@types/node` は型検査専用の devDependency。

例外は Web UI クライアントのみ(ADR-0015)。UI は Preact + Vite でビルドする(`src/ui/client/`、`npm run build` = `vite build`)。成果物 `dist/ui/`(`index.html` + hashed `assets/*.js|css`)は版管理に載せず、`src/ui/server.ts` が配信する。Preact / Vite は devDependency で、バンドル時に JS へ焼き込まれるため **end user 視点のランタイム依存はゼロのまま**(配布 tarball は `dist/ui/` 同梱・展開して Node で実行するだけ・`npm install` 不要)。ビルドが要るのは source clone して開発する場合のみ(未ビルドなら `wrap` は `--no-ui` へ degrade、`ui` は fail-fast)。core / CLI / proxy 側は引き続きビルドなし・ランタイム依存ゼロ。なお ADR-0015 の A(この移行)は実装済み、B(タグ付き Release で tarball を配布する CI)は未着手。

Rust/Go の絶対性能ではなく、Proxy / Measurement Engine / Adapters / MCP / CLI / Web UI を同一言語・同一型定義で書けることのほうが、この規模の OSS では開発速度に効くという判断による。`RequestObservedEvent` / `StructuralBlock` / `ContentChunk` / `AdapterCapability` 等のデータモデル(§8)を core と UI で共有できる価値は大きい。Release tarball を展開して(または clone して)Node さえあれば `wrap` が動く手軽さも、利用・contributor の参加障壁を下げる(v0 の配布は GitHub Release のみ。npm registry 公開は行わない、ADR-0015)。

LLM 通信のボトルネックは通常 upstream のレスポンス時間(数百ms〜数十秒)であり、Proxy 側の処理(数ms)ではない。したがって「Node/TS を使ってよいか」自体は性能上のリスクではない。

### 20.2 Proxy の性能方針(hot path / cold path)

性能上の Architecture Decision は言語選定ではなく、**Proxy が analysis / storage を待たないこと**に置く。

```text
                HOT PATH
              ┌─────────────┐
Client ──────►│ Proxy Relay │────────► Anthropic
              └──────┬──────┘
                     │ non-blocking
                     ▼
                 Event Queue
                     │
              ───────┴────────
                 COLD PATH
                     │
            Measurement Workers
             ├─ normalize
             ├─ CDC
             ├─ HMAC
             └─ MinHash / DB
```

NG パターン(Node/Go に関わらず遅くなる):

```text
request受信 → JSON parse → normalize → CDC → HMAC → MinHash → SQLite commit → upstreamへ送信
```

OK パターン:

```text
request ├─→ upstream へ即 forward
        └─→ capture pipeline(非同期)
```

守るべき点:

1. **Event loop で CPU-heavy 処理をやりすぎない** — CDC / MinHash / 大きな payload の normalize は event loop を塞ぎうる。悪化したら `worker_threads` へ逃がす(HMAC は Node native crypto なので優先度は低い)。
2. **payload を無駄にコピーしない** — `Buffer → toString() → JSON.parse() → JSON.stringify() → Buffer.from()` の多段変換は大きな context で GC 圧を増やす。
3. **SQLite write を request forwarding と同期させない** — in-memory queue → batch insert とし、request ごとに `BEGIN/INSERT/COMMIT` を同期的に待たない。

現状の既知のギャップ: `src/proxy/server.ts` は upstream レスポンスを返却してから `recordRequest`(chunking/HMAC/SQLite insert)を実行しており、「forward してから analyze」の順序自体は守れているが、queue も `worker_threads` も無く同期実行のままである。v0 は単一 Task・低並行度の対話的 CLI wrap が前提のため実害は出ていない想定だが、並行 Agent 数が増えた場合は本節の queue 化を検討する。

最初から `worker_threads` 化はしない。まず素の Node.js + TypeScript でベンチを取り(例: 10MB request / 50MB tool_result / 100 concurrent streams で added latency・event loop lag・GC pause・analysis backlog を計測)、問題が出た箇所だけ `worker_threads`、それでも足りなければ該当部分のみ Rust native addon / WASM を検討する、という段階的対応とする。

---

## 21. CLI イメージ

`wrap` が `token-profiler` の主要な入口となる(ADR-0001)。

```bash
token-profiler wrap -- codex
```

```text
Token Profiler

Task: 019c...f21
Dashboard: http://localhost:8765/tasks/019c...f21

> Codex starting...
```

対象 CLI の起動と Base URL 切り替え(Proxy Binding を埋め込んだ endpoint)を一括で行うため、ユーザーは env var を手動で設定する必要がない。`task_id` は初回起動時に Profiler が自動発行(UUIDv7)する。子プロセスは `TOKEN_PROFILER_TASK_ID` を環境変数経由で継承するが、別 Agent として区別されるには改めて `wrap` する必要がある(§5.2)。

終了時:

```text
Task 019c...f21 completed
Input tokens: ...
Context amplification: ...
```

`--task-id` は advanced オプションとして残す(統合テスト、再現実験、外部 orchestrator との相関用途)。通常利用では不要。

```bash
token-profiler wrap --task-id foo --role reviewer -- codex
```

---

## 22. コンセプト上の重要な境界

### Token Monitor ではない

単なる、

```text
Total: 1,283,492 tokens
Cost: $xx.xx
```

では不十分。

---

### Token Optimizer ではない

「圧縮すると何 token 減るか」が中心ではない。

---

### Token Profiler である

中心となる問いは、

> **なぜ、この token がここを流れたのか？**

である。

そして、

> **同じ情報がどこを経由し、どれだけ増幅されたのか？**

を観測できることを価値とする。

---

## 23. 現時点の製品定義

### Name

**token-profiler**

仮称。

### One-liner

> **A profiler for AI agent token traffic.**

### Alternative

> **See where your tokens go.**

### Developer-oriented expression

> **perf for AI agents**

### Product category

**AI Agent Token Traffic Analysis / Token Profiling**

「LLM Observability」よりも狭く、原因分析に特化する。

---

## 24. 最初の Dogfooding 対象

最初の実証対象として、マルチエージェント開発環境が適している。

特に以下を検証する。

- Agent 並列化による token 増加
- Reviewer / Orchestrator 間の context 再送
- review loop
- tool output replay
- 同一ファイルの複数 Agent による読み込み
- issue / task 分割後の amplification
- context growth

最初のゴールは、

> **「並列化したらなぜ token が増えたのか」を Profiler が説明できること。**

とする。

**前提条件(§25 Q10 は解決済み、残る条件に注意)**: 上記の検証項目のうち Review loop、Agent 間の context 再送、同一ファイルの複数 Agent 読み込みは、Agent 単位の識別を前提にしている。現行の Core Agent identity モデル(ADR-0001)は `wrap` された **プロセス単位**でのみ識別するため、Claude Code の Task tool のような **同一プロセス内 subagent** で構成される場合、Core だけでは単一の Agent(role unknown)に見える。Q10 自体は Claude Code の Conversation Thread 識別(cc_version marker + hook、ADR-0005・ADR-0006)によって解決済みだが、これはあくまで Enrichment 層の Thread 粒度であり、Review Cycle 等の診断がこの Thread 粒度を実際に優先する実装になっていること(§10.8 の Thread 優先ルール)を、この Dogfooding シナリオの前提条件として確認する必要がある。

---

## 25. 次に詰めるべき論点

### 解決済み(詳細は `CONTEXT.md` / `docs/adr/` を参照)

- Agent identity の付与方法 → ADR-0001(`wrap` による明示的付与、プロセス系譜の自動検出はしない)
- Run / Task / Agent / Span の ID 設計 → ADR-0001(Run は Task に統合。Task → Agent → Conversation Thread → Request が canonical hierarchy、OTel は任意)
- chunk overlap の計算方式、payload 非保存時の重複検出精度 → ADR-0002(CDC + HMAC Exact Fingerprint + MinHash Similarity Signature + Key Epoch)。実測(下記スパイク)で tool_schema の動的変化に対する CDC の有効性を確認(Decision Evidence として ADR-0002 に追記済み)。
- unique information の定義、Token Amplification の厳密な計算式 → ADR-0003(Context Amplification は byte basis が旗艦指標、Token Amplification は tokenizer domain 内限定)
- Review Loop の検出ルール → ADR-0004(Review Cycle は structural fact、Review Churn Suspected は Diagnostic として分離。粒度は Conversation Thread があればそちらを優先)
- Exact Reuse Ratio の basis → CONTEXT.md(Context Amplification と同じく byte basis がデフォルト、token basis は Derived)
- **Core Measurement と Provider/Client Enrichment Adapter の分離** → ADR-0005(client 固有の非公開実装詳細は Core の指標に混ぜない、というアーキテクチャ境界)
- **Adapter Capability の宣言モデル** → ADR-0005 / ADR-0009 / CONTEXT.md(Codex スパイクで確定。Adapter は機能ごとに confidence(`supported_contract`/`verified_best_effort`/`discovered_unverified`/`unknown`)と availability(`available`/`unimplemented`/`blocked`/`unsupported`)を独立2軸で宣言し、「対応/非対応」の二値評価にしない)
- **Q10: Claude Code の Conversation Thread 識別**(実測スパイク、ADR-0001 補記・ADR-0005)。Claude Code は system prompt 先頭に非公開の擬似ヘッダ `cc_version=X.Y.Z.<suffix>; cc_is_subagent=true` を埋め込んでおり、suffix が Agent 内部の Conversation Thread を安定して区別できることを確認。Codex 等の他 CLI は未検証、汎用的な解法は意図的に非対応(Enrichment Adapter が存在する client のみ Thread 粒度が使える)。
- **Claude Code 公式 hook(`SessionStart`/`SessionEnd`/`SubagentStart`/`SubagentStop`)による identity metadata 取得** → ADR-0006(`identity_metadata`/`request_attribution` を独立した capability 軸に分離。Core Agent identity model は変更しない)
- **wrap-first を常設 native integration(settings.json + daemon)へ移行するか** → ADR-0007(**proposed、未決定**。並行 subagent の request attribution 実測・daemon 障害 semantics・opt-in/pause/uninstall UX・privacy boundary・Task identity source の委譲、の5条件待ち)
- **client 対応度の表現方法(「対応 client 数」を KPI にしない)** → ADR-0008(Support Tier は Adapter Capability 宣言から機械的に導出)。→ ADR-0009 で Transport / Provider Protocol / Client Enrichment の3層に精緻化(`OpenAI-compatible`/`Anthropic-compatible` は Transport ではなく Provider Protocol)。ロードマップは §27 参照。
- **Adapter 3層分離・capability 2軸化・Core Task authority の明確化** → ADR-0009(`ClientAdapter.identifyTask` を `extractClientSessionMetadata`/`external_session_id` に改名し、Core の `task_id` 発行権限は `wrap` のみに限定)
- **Similarity Unit と Block Fingerprint の導入** → ADR-0010(Near-Duplicate Similarity は ContentChunk ではなく Similarity Unit(粒度未定)で計算。Thread Role マッピングは system prompt に対応する StructuralBlock の Block Fingerprint を使う。cross-epoch 比較の alias 方式は未決定)
- **context_class の3値化 + StructuralBlock 分割 + Observed の厳格化** → ADR-0011(`context_class=unknown` を追加し application/protocol への強制フォールバックをしない。1 message → 複数 StructuralBlock を許容。Measurement tiers を Fact{Observed/Deterministic/Derived/Estimated}+Diagnostic に再整理し、Observed は provider 直接報告値専用語に固定)
- StructuralBlock の `context_class`(Application/Protocol/unknown)を `type`/`transport_role` から独立した属性にする必要性 → CONTEXT.md / ADR-0011(実測で `<system-reminder>` が user message 内・独立した system-role message・system prompt 内の3箇所に分散することを確認。判定不能な場合は unknown に倒し、Classification Coverage として別集計する)
- Context Amplification と cache(cost)の直交性 → CONTEXT.md(Context Amplification は cache hit で変えない。billing 側は Cache Hit Ratio という別指標)
- raw capture(`spike/**/raw/`、`capture.jsonl`)を git 管理から除外 → `.gitignore`(full payload と account_uuid/device_id/session_id 等の識別情報を含むため、ADR-0002 の privacy-first 方針上コミットしない)

### 未解決 — 優先順位順

引き続き検討中の技術的な論点。

0. Conversation Thread identification の相関精度(ADR-0006)
1. Protocol Context extraction の具体化(ADR-0011)
2. Cache semantics の指標設計
3. Claude Code Adapter の degradation 設計
4. Codex Adapter の Transport 対応
5. Canonical Representation / Normalization の厳密な定義
6. CDC アルゴリズム・パラメータ・versioning
7. Measurement Profile の互換性境界の具体化
8. §10.9 Parallel Duplication の検出粒度・アルゴリズム
9. tokenizer domain / token estimates の具体的な扱い
10. ローカル保存方式
11. Web UI 技術選定(実装済み、Preact + Vite、ADR-0015)
12. MCP tool schema の詳細
13. Progress Signal の具体的な取得方法
14. 並行 subagent 実行下での identity 相関(ADR-0006)
15. wrap-first → native integration 移行の是非(ADR-0007、proposed)
16. Similarity Unit の既定粒度決定(ADR-0010)
17. Cross-epoch fingerprint 比較の方式決定(ADR-0010)
18. Classification Coverage の実装(ADR-0011)
19. Claude Code Conversation Thread marker の安定性(ADR-0013)

### 実装要件として確定した事項(スパイクより)

- Proxy は単純な JSON reverse proxy では不十分。最低限 (a) `content-encoding: gzip`(および br/deflate)の解凍、(b) SSE(`text/event-stream`)の incremental parse、(c) `message_start`/`message_delta` イベントからの usage 再構成、が必要(§8 データモデルの `provider_reported_input_tokens` 等の取得に必須)。
- Proxy は `ANTHROPIC_BASE_URL` 経由で、事前の `HEAD /api/hello` のような疎通確認リクエストも含めて全通信を観測できることを確認済み(認証ヘッダなしのリクエストも proxy を通る)。

---

## 26. 現時点の結論

token-profiler の価値は、token 数を数えることではない。

**Agent system 内の token traffic を観測し、増幅・再送・重複・loop の発生源を特定すること**にある。

Headroom 等が「token をどう減らすか」を主眼とするのに対し、本ツールは、

> **どこを直すべきなのかを発見する profiler**

として位置づける。

実装アーキテクチャとしては、

> **localhost daemon + wrap(明示的 Task/Agent 識別) + proxy + Web UI + MCP**

を基本形とする。OTel は必須構成要素ではなく、対象プロセスが独自に発行する場合の任意の相関情報として扱う(ADR-0001)。

最初の MVP は総合 observability platform を目指さず、

> **1 Task の token 消費理由を説明できること**

に集中する。

## 27. Client support roadmap(非拘束、ADR-0008 参照)

対応 client 数は KPI ではなく、Transport Adapter と Client Enrichment Adapter を分離できたことの結果として増える。現状は Claude Code の Full Profiling を先に証明することを優先し、他 client への展開順は非拘束。
