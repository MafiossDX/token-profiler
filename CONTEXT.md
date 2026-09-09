# token-profiler

LLM / AI Agent の token traffic を観測し、増幅・再送・重複・loop を測定・提示するためのローカル観測ツール。最適化・原因の断定・合成スコアは行わない。Profiler は Fact(Observed / Deterministic / Derived / Estimated)の提示を土台とし、`/` の観測 UI はその上に **Context Amplification の診断的な読み**(参照ゾーン / Next focus / 重複文脈バイト順の削減候補ランキング)を載せる(ADR-0016 が ADR-0014 の Fact-only を上書き)。原因の断定・用途名の推測・合成スコアは引き続きしない。spec §13 相当の warning 群は将来レイヤー(§4.2、ADR-0011、ADR-0014、ADR-0016)。

## Language

**Task**:
`token-profiler wrap` で起動した AI CLI の 1 セッションに対応する、観測の最上位単位。`wrap` 実行時に Profiler が `task_id`（UUIDv7）を自動発行するため、通常ユーザーは意識する必要がない（`--task-id` は再現実験・外部 orchestrator との相関等の advanced 用途としてのみ残す）。root プロセス（wrap された対象 CLI）が終了した時点で Task も終了する。
_Avoid_: Run（旧概念。Task と実質的に重複していたため廃止・統合した）、Session

**Agent**:
`wrap` コマンドで起動された、単一のトップレベルプロセスインスタンス。Agent identity はプロセス単位で払い出され、同一プロセス内の subagent（例: Claude Code の Task tool による内部 subagent 起動）は別 Agent として区別されない。子プロセスは `TOKEN_PROFILER_TASK_ID` を環境変数経由で自動継承し同じ Task に属するが、それだけでは別 Agent にはならない。別 Agent として区別されるのは、子プロセスが改めて明示的に `wrap` された場合（Proxy Binding を新規発行した場合）のみで、それ以外の子プロセスのトラフィックは親 Agent に帰属する。
_Avoid_: Subagent（プロセス境界を越えない内部処理を指す言葉として区別する）

**Agent Role**:
Agent に付与される明示的な semantic attribute（例: `reviewer`, `implementer`, `orchestrator`）。`wrap` 実行時の指定、または agent id → role の設定マッピングによって与えられる。指定がなければ `unknown` として扱う。Profiler は Agent 名・tool 利用パターン・発話内容から Role を推測しない。
_Avoid_: Agent Type

**Conversation Thread**:
Agent(プロセス)内部で識別可能な、独立した会話系列。`Task → Agent → Conversation Thread → Request` という階層のうち、Agent と Request の間に位置する。Core Measurement の一部ではなく、Provider/Client Enrichment Adapter(下記、ADR-0005)によってのみ識別される — 対応する Adapter がない client では、Agent 全体が単一の暗黙的 Thread として扱われる。手がかりは client によって性質が異なる: Claude Code は system prompt に埋め込まれた非公開 marker(`cc_version` suffix、request 単位の discriminator)に加えて、公式 hook(`SubagentStart`/`SubagentStop`)から得る `agent_id`/`agent_type`(authoritative だが request 単位ではなく lifecycle event 単位、ADR-0006)の 2 種類の手がかりを持つ。Codex は素の HTTP ヘッダー(`session-id` / `thread-id`)。後者は生ヘッダーである分扱いやすい可能性があるが、値のライフサイクル(Task ごとか、login session ごとか等)は実測未検証。
_Avoid_: Agent(Agent はプロセス単位、Conversation Thread はプロセス内部の会話単位で、意味が異なる)。hook の agent_id を Core Agent と混同すること(ADR-0006 により Enrichment 層に留まる)

**Adapter Capability**:
各 Provider/Client Enrichment Adapter が、`extractClientSessionMetadata` / `identifyThread` / `identifySubagent` / `classifyProtocolContext` / `extractCacheUsage` などの機能ごとに宣言する評価。「対応/非対応」の二値ではなく、**confidence**(`supported_contract` / `verified_best_effort` / `discovered_unverified` / `unknown`、この順で確からしさが下がる)と **availability**(`available` / `unimplemented` / `blocked` / `unsupported`)を独立した2軸として宣言する(ADR-0009。旧: 単一軸の `supported`/`best_effort`/`discovered_unverified`/`unknown`/`blocked_currently` は本 ADR で置き換え)。`availability != available` の場合 confidence は評価しない。Transport(HTTP JSON/SSE+gzip/WebSocket)・Provider Protocol(Anthropic Messages/OpenAI Responses)・Client Enrichment(Claude Code/Codex 固有知識)の3層それぞれがこの2軸で capability を宣言する(ADR-0009)。実測(Claude Code の marker は `verified_best_effort`、Codex の header は `discovered_unverified` かつ HTTP capture の availability が `blocked`)を踏まえて導入した(ADR-0005)。Claude Code についてはさらに `identity_metadata`(hook から得る `supported_contract` 相当の agent_id/agent_type/session_id)と `request_attribution`(個々の request を特定の agent/thread に紐づける能力)を独立した機能軸として宣言する(ADR-0006) — 前者が `available`/`supported_contract` でも、並行 subagent 下での相関が未実証な間は後者は `verified_best_effort` のまま。
_Avoid_: 対応/非対応の二値評価。identity_metadata が取れることを理由に request_attribution も高い confidence とみなすこと。confidence と availability を1軸にまとめること

**Support Tier**:
client ごとの対応度を表す4段階(`Full Profiling` / `Traffic Profiling` / `Basic・Experimental` / `Not Tested`)。ユーザーが手で割り当てるラベルではなく、既存の Adapter Capability 宣言(confidence × availability の2軸、ADR-0009)から機械的に導出する(ADR-0008)。手で割り当てると、ADR-0005 が退けた「対応/非対応」の二値評価が client 単位で復活してしまうため。
_Avoid_: 単独の「Tier」という表記(下記 Measurement tiers と紛らわしいため、必ず Support Tier と書く)。client ごとの手動ラベル付け

**Thread Role**:
Conversation Thread に付与される role。Agent Role と同じ「意味を推測しない」原則に従い、Thread 自身の system prompt に対応する StructuralBlock の Block Fingerprint(下記、ADR-0010)に対してユーザーが明示的に role をマッピングすることで与えられる(`thread_roles: { block_fingerprint: ..., role: ... }`)。client 固有の marker(例: `cc_is_subagent=true`)から分かるのは「これは独立した thread である」「これは subagent である」までであり、「reviewer である」ことまでは marker からは分からないため。
_Avoid_: Agent Role からの自動継承・推測。ContentChunk 単位の Exact Fingerprint をキーにすること(粒度が違う。system prompt 全体には Block Fingerprint を使う)

**wrap**:
対象 CLI（`claude`, `codex` 等）をサブプロセスとして起動し、環境変数（Proxy Binding を組み込んだ API Base URL、Task ID 等）を注入することで透過的に Proxy 経由の観測を開始するコマンド。例: `token-profiler wrap -- codex`。
_Avoid_: Instrument, Attach

**Proxy Binding**:
`wrap` 実行 1 回ごとに発行される opaque token。API Base URL に埋め込まれ（例: `http://localhost:8765/proxy/<opaque-token>/v1`）、Proxy が HTTP request を特定の (task_id, agent_id, agent_role) に紐づけるための唯一の手がかりとなる。Proxy は環境変数を直接参照できないため必須の仕組み。
_Avoid_: capture token（用途が広く聞こえるため）

**StructuralBlock**:
Request/response を意味的境界(system, message, tool_schema, tool_result)で区切った最上位の分割単位(Level 1)。`type`(system/message/tool_schema/tool_result)と `context_class`(下記の Application Context / Protocol Context / unknown)は直交する別属性であり、`type` から `context_class` を機械的に導出できない(例: `type=message, transport_role=user` の StructuralBlock でも、中身が `<system-reminder>` なら `context_class=protocol`)。1つの Transport Message(API上の1メッセージ)が複数の StructuralBlock に分割されることを許容する — user message の content 内部に system reminder が埋め込まれるケースでは、同一 message から `context_class=application` の StructuralBlock と `context_class=protocol` の StructuralBlock を両方抽出する(ADR-0011)。§10.3 等の内訳表示はこの単位に対応する。
_Avoid_: Section, segment。「role が user なら Application Context」という単純な導出ルール(Q10 の実測スパイクで反例が確認された)。1 message = 1 StructuralBlock という前提

**ContentChunk**:
StructuralBlock の内部を Content-Defined Chunking でさらに分割した最小単位（Level 2）。挿入・削除が発生しても後続 chunk の境界がずれにくい。
_Avoid_: 固定長 chunk

**Exact Fingerprint**:
ContentChunk ごとに保存する `HMAC-SHA256(local_secret, normalized_chunk)`。過去の ContentChunk と完全一致するかどうかの判定にのみ用いる。生テキストは保持しない。
_Avoid_: hash, chunk hash（曖昧なため）

**Block Fingerprint**:
StructuralBlock 全体に対して保存する `HMAC-SHA256(local_secret, normalized_block)`(ADR-0010)。ContentChunk 単位の Exact Fingerprint(CDC 分割後の断片同士の完全一致判定用)とは粒度が異なる — Block Fingerprint は「このブロック全体が過去に見たものと同一か」を判定する用途(Thread Role マッピング等)に使う。
_Avoid_: Exact Fingerprint と同一視すること

**Exact Reuse Ratio**:
ある request の input のうち、Exact Fingerprint が過去 request の ContentChunk と完全一致した部分が占める割合。Context Amplification と同じく basis を持つ: **byte basis**(normalized bytes、Deterministic、デフォルト)と **token basis**(単一 Tokenizer Domain 内限定、Derived)。token basis はその request 自身の tokenizer が全 chunk に一貫して適用されるため Tokenizer Domain をまたぐ問題は生じないが、chunk 単位の token 数自体が provider から直接得られない(Derived)ことに変わりはない。
_Avoid_: 「input tokens のうちの割合」という表現のみで basis を明示しないこと

**Similarity Unit**:
Near-Duplicate Similarity を計算する粒度。Exact Reuse Ratio が使う ContentChunk(CDC分割後の小さな断片、数百バイト〜数KB)とは別の、message / StructuralBlock / review output 等の「診断結果として意味のある volume を報告できる」明示的な単位(ADR-0010)。具体的にどの粒度を既定値にするかは未決定(§25 spec.md、Measurement Profile の一部としてバージョン管理する)。
_Avoid_: ContentChunk と同一視すること(粒度が違う。ContentChunk は Exact Reuse 専用)

**Similarity Signature**:
Similarity Unit ごとに MinHash によって生成する signature(ADR-0010)。非可逆だが、2つの signature 間で近似 Jaccard similarity を計算できる。ContentChunk 単位のフィールドとしては持たせない。
_Avoid_: Simhash（本プロジェクトでは MinHash を採用）。ContentChunk 単位で持たせること

**Near-Duplicate Similarity**:
2つの Similarity Signature(= 2つの Similarity Unit)から推定した Jaccard similarity。Exact Reuse Ratio とは異なり、あくまで推定値であることを UI 上も明示する。

**Application Context**:
StructuralBlock の `context_class` の値の1つ。ユーザー/Agent 間で流通する実質的な情報を指し、Context Amplification の計算対象になる。`type=message` かつ `transport_role` が user/assistant であっても、中身が System Reminder(下記)であれば Application Context ではなく Protocol Context になる。
_Avoid_: content, payload。type/transport_role だけからの機械的判定

**Protocol Context**:
StructuralBlock の `context_class` の値の1つ。API 呼び出しの都度構造的に再送される overhead(system prompt、tool_schema、System Reminder)を指し、Context Amplification の計算からは除外し、Protocol Transport Volume として別集計する。
_Avoid_: overhead（曖昧なため上記に統一）

**Unclassified Context(context_class=unknown)**:
StructuralBlock の `context_class` の値の1つ。System Reminder 検出ロジックが application/protocol のどちらか判定できなかったことを明示する(ADR-0011)。Context Amplification の分母分子には含めないが、volume 自体は破棄せず Classification Coverage(下記)として別集計する。
_Avoid_: application または protocol への自動フォールバック

**Classification Coverage**:
Task 内の全 StructuralBlock volume のうち、`context_class` が application/protocol のどちらかに分類できた割合(ADR-0011)。unknown が多い Task では、Context Amplification の数値がどこまでの範囲をカバーしているかをこの指標と併記する。

**System Reminder**:
Claude Code 等が会話に注入する、framework 由来の指示文(`<system-reminder>` 等)。実測(Q10 スパイク)では、(a) 独立した system-role message、(b) user message の content 内に埋め込まれた text block、(c) 通常の system prompt 内、という3箇所いずれにも出現し得ることを確認した。出現位置によらず常に `context_class=protocol` として扱う — でなければ Application Context(≒ Context Amplification の分母分子)が framework の定型文で水増しされてしまう。
_Avoid_: ordinary user/system content と同列に扱うこと

**Unique Context Volume (UCV)**:
Task 内で Application Context として観測された ContentChunk のうち、同一 Exact Fingerprint を一度だけ数えた volume の合計。basis（下記）によって単位が変わる。
_Avoid_: Information generated（「生成されたが誰にも transport されていない情報」と混同するため廃止）

**Context Transport Volume (CTV)**:
Application Context の ContentChunk が、実際にモデル入力として transport された volume を、重複を含めて累積した総和。UCV と同じ basis で測る。

**Basis（byte basis / token basis）**:
UCV・CTV・Context Amplification を測る単位。
- **byte basis**（デフォルト）: normalized ContentChunk の byte 長。provider/tokenizer に依存しない deterministic な値。
- **token basis**: 特定の tokenizer domain（後述）内でのみ意味を持つ値。

**Context Amplification**:
`CTV / UCV`（デフォルトは byte basis）。旗艦指標。同一情報が Task 内で何倍 transport されたかを表す **Deterministic 値**であり(Measurement tiers 参照。Observed ではない — provider が直接報告する値ではないため)、その transport が回避可能・不要であったことは意味しない（§4.2 の Fact/Diagnosis 分離に従う）。avoidable かどうかの判定は別途 Diagnosis レイヤー（likely avoidable traffic 等）で扱う。byte basis を使うのは、同一 fingerprint が複数 provider/tokenizer に transport された場合でも実行順序に依存せず一意に定まるため。**provider の prompt cache がヒットしたかどうかでは変えない** — Context Amplification が測るのは「情報フロー上、何回 context を参照・transport した構造になっているか」であり、それが安く再送されたか(cache hit)高く再送されたか(cache miss)は別軸の関心事のため(下記 Cache Hit Ratio 参照)。**測っているのは request payload として実際に wire 上を transport された context(request-visible context)であり、model が実際に参照した effective context ではない。** Codex の Responses API のように server-side conversation state を使う API では、過去 context が request payload に再送されなくても model 側では参照され得る — proxy だけで確実に測れるのは前者のみであり、provider-side retained context は既知の限界として扱う(known limitation、Full Profiling を主張する client でも同様)。
_Avoid_: CAF, Content Amplification, Token Amplification（後者は tokenizer domain 内限定の別指標）、cache hit 分を差し引いた「実質 Amplification」。model が実際に参照した context の総量という意味で使うこと(measured なのは transported context のみ)

**Tokenizer Domain**:
同一の tokenizer を共有するモデル群の単位（例: 同じ tokenizer を使う複数モデルは同一 domain）。`tokenizer_id` で識別する。

**Token Amplification**:
`CTV / UCV` を token basis・単一 Tokenizer Domain 内でのみ計算したもの。異なる Tokenizer Domain をまたいで単一の比率を作らない — またぐと、同じ情報フローでも「どちらの tokenizer が先にそのchunkを見たか」という実行順序だけで数値が変わってしまうため（§19.1 Regression Detection の信頼性を損なう）。

**Observed Token Traffic**:
Task 内の全 request について、provider が実際に報告した input/output token 数（request 単位）をそのまま合算した値。cost/traffic の把握には使うが、Context Amplification や Token Amplification の分母には使わない（tokenizer が混在し得るため）。uncached input / cache creation / cache read の内訳を持つ(provider の usage レスポンスにこれらが含まれる、Observed)。

**Cache Hit Ratio**:
Observed Token Traffic のうち、cache read で賄われた割合(billing/cost 側の指標)。Context Amplification(structural、情報フローの再送構造を測る)とは独立した軸として扱う。同じ Task が「Context Amplification 高 / Cache Hit Ratio 高(structural inefficiency は高いが billing impact は低い)」にも「Context Amplification 低 / Cache Hit Ratio 低(structural inefficiency は低いが billing impact は高い)」にもなり得る。Conversation Thread ごとに cache の系列が独立している場合がある(実測: Claude Code の subagent thread は orchestrator の cache を引き継がず、cache_read_input_tokens=0 から始まる)。

**Gross Transport Ratio**:
Application Context と Protocol Context の両方を含めた、全 StructuralBlock 込みの byte basis transport 倍率。Context Amplification を補助する低レベル指標であり、UI上の主役にはしない。

**Protocol Transport Volume / Protocol Share**:
Protocol Context（system / tool_schema）が占める transport volume、および Total Input Transport に対するその割合。

**Fingerprint Key Epoch**:
`local_secret` の世代を表す識別子。同一 epoch 内で生成された Exact Fingerprint 同士だけが比較可能。異なる epoch をまたぐ比較は「不一致（0%）」ではなく「比較不能」として明確に区別する（デフォルト）。rotation 後に過去 Task と意図的に再比較したい場合の選択肢（ContentChunk が複数 epoch 分の fingerprint alias を保持する／rotation 時に cross-epoch equivalence レコードを生成する）はどちらを採るか未決定（ADR-0010、§25）。Similarity Signature 側にも対応する epoch 概念を持たせるが、単なるタグ付けでは不十分で、**MinHash の shingle hash/seed 自体が epoch に依存する**必要がある（タグだけでは同じ内部状態が epoch をまたいで漏れうるため、ADR-0010）。privacy reset 時は両方の epoch を同時に切る。
_Avoid_: key version。Similarity Signature の epoch を単なるタグとして扱うこと

**Measurement Profile**:
ある ContentChunk/Fingerprint が「どう測られたか」を一意に決める設定の組（normalization のルール、CDC アルゴリズムとパラメータ、Fingerprint Key Epoch、similarity scheme）。Fingerprint Key Epoch の考え方（異なる epoch は「不一致」ではなく「比較不能」）を一般化したもの: **Measurement Profile が互換な Task 同士だけが content-level 比較（Exact Reuse Ratio、Context Amplification の Task 間比較、Regression Detection 等）を行える。** 各要素の具体的な値・アルゴリズムは未決定（§25）だが、この互換性境界という概念自体は確定している。
_Avoid_: version（何のバージョンかが曖昧なため）

**Review Cycle**:
同一 Task 内で、Role が `reviewer` の単位 → 別 Role の単位 → 再び Role が `reviewer` の単位、という遷移が観測された単位。「単位」は、Conversation Thread + Thread Role が識別できる client では Thread 粒度、できなければ Agent + Agent Role 粒度になる(粒度が粗いほど、同一プロセス内の往復は検出できない)。Tool span は遷移判定から除外する。**structural fact**（Fact グループ。Agent Role/Thread Role の取得 confidence、ADR-0009 に依存するため厳密には Observed ではない — Measurement tiers 参照）であり、それ自体は問題を意味しない。
_Avoid_: Review Loop（"Loop" は問題含みのニュアンスを持つため、Diagnostics 側の Review Churn と区別する）

**Repeated Review Content**:
ある review の output のうち、それ以前の review output に既出だった割合。ContentChunk の Exact Fingerprint 一致(exact 判定)と、Similarity Unit の Near-Duplicate Similarity 高(near 判定、ADR-0010)の両方を合成する。単一の直前 review だけでなく、それまでの review 全体に対して累積的に計算する。
_Avoid_: Review Similarity（直前 review 一回との類似度に限定される別指標。両者を混同しない）

**Review Similarity**:
直前の review output 一回とのみの類似度。Repeated Review Content（過去すべての review に対する累積既出率）とは区別する。

**Progress Signal**:
Review Cycle の間に実際の成果物がどれだけ変化したかを示す外部シグナル（例: git の files_changed / lines_added / lines_deleted / diff_bytes）。coding agent に限定しない一般概念とする。取得できない場合は「unavailable」として扱い、MVP では必須入力にしない。
_Avoid_: Code Diff（coding 以外の Agent にも一般化するため）

**Review Churn (Suspected)**:
Review Cycle 数、Repeated Review Content、token traffic、Progress Signal（利用可能な場合）を組み合わせた Diagnostic。単一の合成スコアにはせず、個別の warning（例: "Review cycle count high"、"Repeated review content high"、"Low progress between reviews"）として提示する。structural fact である Review Cycle 自体とは明確に分離する。

## Measurement tiers

§4.2 の Fact/Diagnosis 分離をさらに細分化したもの(ADR-0011)。すべての指標は `Fact`(下記4種のいずれか)または `Diagnostic` に分類される。client ごとの対応度を表す Support Tier(ADR-0008)とは別軸なので混同しないこと。

```text
Fact
├─ Observed        # provider が API response で直接報告する値そのもの。これ以外の意味で使わない
├─ Deterministic     # raw payload から機械的・一意に計算できる値
├─ Derived          # ローカルで再計算する必要がある値
└─ Estimated        # 確率的手法による推定値

Diagnostic          # heuristic による判断。事実値ではなく解釈
```

- **Observed**: provider が API response で直接報告する値そのもの（request 単位の input/output tokens 等）に**専用**の語。ContentChunk 単位の token 数は provider から得られないため、たとえ token 単位であっても Observed ではない。Context Amplification や Review Cycle のようにローカルで構造から導いた値を Observed と呼ばないこと(ADR-0011 で修正済み。旧仕様では誤用があった)。
- **Deterministic**: raw payload から機械的・一意に計算できる値（ContentChunk の byte_length、Exact Fingerprint の一致、byte basis の Context Amplification 等）。再計算しても常に同じ結果になる。
- **Derived**: ローカルで tokenizer を使って再計算する必要がある値（ContentChunk 単位の token 数など）。request 全体の Observed token 数との合計が完全には一致しない場合がある（メッセージ整形上のオーバーヘッド等）。
- **Estimated**: 確率的手法による推定値（MinHash による Near-Duplicate Similarity 等）。
- **Diagnostic**: heuristic による判断（likely avoidable traffic、review loop suspected 等）。事実値ではなく解釈。

## Design boundary

`wrap` は明示的にラップされたプロセスのみを Agent として識別する（プロセス系譜の自動検出は行わない）。ラップされていないプロセスが起動した子プロセスは観測対象外になる。単一プロセス内の subagent 識別は Core Measurement では非対応 — Claude Code に限っては Conversation Thread という Enrichment Adapter(下記、ADR-0005・ADR-0006)で部分的に対応する。`wrap` を Task/Agent identity source の唯一の手段とするか(settings.json 常設 + daemon による native-first への移行を検討するか)は ADR-0007 で **proposed のまま未決定** — 現時点の Design boundary は本節の記述が正。

root プロセス(最初に `wrap` された対象 CLI)が終了した時点で Task は終了する。終了時点で進行中の HTTP request はレスポンスまで記録してから close する。root 終了後に detach したプロセスが新たに発行する request は、原則としてその Task に含めない。

識別子階層は `Task → Agent → Conversation Thread → Request` を **canonical hierarchy**(正典的な識別子階層)とする(Conversation Thread は optional、対応する Adapter がある場合のみ)。_Avoid_: 「native モデル」という表現(Conversation Thread は Core Measurement ではなく Enrichment Adapter 由来であり、Core が「本来持つ」identity であるかのように読めてしまうため)。`otel_trace_id` / `otel_span_id` / `otel_parent_id` のような OTel 由来の識別子は必須ではなく、wrap 対象プロセスが独自に OTel span を発行している場合にのみ記録するオプションの相関用フィールドとして扱う(OTel SDK 統合は MVP の必須要件ではない)。

**Core Measurement と Provider/Client Enrichment Adapter の分離**(ADR-0005): Task/Agent/Request/StructuralBlock/Fingerprint/Context Amplification 等は protocol-independent な Core Measurement であり、特定 client の非公開実装詳細に依存しない。Conversation Thread、subagent marker の解釈、cache semantics の解釈のような client 固有の知識は、明示的に分離された Enrichment Adapter 層に置く。Adapter 自体も Transport(HTTP/SSE/WebSocket) / Provider Protocol(Anthropic Messages・OpenAI Responses) / Client Enrichment(Claude Code・Codex 固有知識)の3層に分離し、複数 client が Transport/Provider Protocol を再利用できるようにする(ADR-0009)。Adapter が対象 client の内部実装変化で壊れても(例: Claude Code のバージョンアップで marker 形式が変わる)、Core Measurement の指標は影響を受けない設計にする。Adapter は marker が期待した形式でない場合、静かに `unknown`/情報なしにフォールバックする。Adapter は Core の `task_id` を発行できない — `extractClientSessionMetadata()` が返す `external_session_id` はあくまで Enrichment 層の相関用メタデータであり、Core の Task identity 権威は `wrap` のみが持つ(ADR-0001・ADR-0009)。実装上の対応: Client Launch = `src/launch/`(`ClientLaunchProfile` — wrap されたコマンドから env var 名 / target host / protocol / enrichment 集合を解決。`wrap.ts` はこれ以外 provider 非依存)、Transport = `src/proxy/`(HTTP forwarding + `decompress`)、Provider Protocol = `src/protocol/`(`ProviderProtocol` interface + `anthropic-messages` 実装。method/path で自分の形か判定してから request parse / usage 抽出 / neutral block 化)、Client Enrichment = `src/enrichment/`(`claude-code` の thread identity、`system-reminder` の split/分類)、Core Measurement = `src/core/`(normalize / chunk / fingerprint / metrics — provider 非依存)。合流点は `src/recorder.ts`(enrichment は launch profile から注入され、recorder 自身は client 固有知識を持たない)。v0 の profile は `claude-code`(`ANTHROPIC_BASE_URL` / `api.anthropic.com` / Anthropic Messages)のみで、未知コマンドはこれに fallback する。

**意味的分類を推測しない原則**: Agent Role、acceptance/exit condition のような意味的分類が必要な情報を、Profiler は Agent 名・tool 利用パターン・発話内容から推測しない。分からないものは `unknown` として扱い、判定を保留する。観測可能な構造は厳密に観測し（Observed/Deterministic レイヤー）、意味解釈は Diagnostics、または MCP 経由の Agent 自己診断（§19.3）という別レイヤーに委ねる。

Raw payload は StructuralBlock への分割・CDC・fingerprint/signature 生成のためだけに一時的にメモリ上で使用し、処理後は破棄する（§9.1 のデフォルト方針）。Similarity Signature は元コンテンツを直接復元できないが、feature 情報を保持しているため、無害なメタデータとしてではなく sensitive metadata として扱う。

Data retention（fingerprint / similarity signature を何日保持するか）と Key Epoch の寿命（secret 自体をいつ rotate するか）は独立した概念である。Epoch は data retention 期間より大幅に長く持続してよい（例: retention 30日、epoch は数ヶ月〜1年）。

normalization の具体的なルール（Unicode 正規化形式、改行コード、JSON whitespace、tool JSON の key order 等）と CDC のアルゴリズム・パラメータ（min/avg/max chunk size 等）はまだ決定していない（§25 spec.md）。ただし、どちらも旗艦指標（Exact Fingerprint、Context Amplification）の根幹であり、値を変えると過去データと互換性がなくなる one-way door であるため、`normalization_version` / `chunking_algorithm` / `chunking_version` として必ずバージョン管理する、という要件だけは確定している(Measurement Profile の一部)。
