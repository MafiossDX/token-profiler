---
status: accepted
---

# Flagship metric (Context Amplification) is measured in content bytes, not tokens

初期仕様の "Token Amplification"(Information generated 31k / Tokens transported 184k)は、分子・分母の求め方が未定義だった。ContentChunk/Exact Fingerprint 基盤を使えば「Run(現 Task)内で distinct fingerprint が占める token 数」として機械的に定義できるように見えたが、これには致命的な問題がある: token はモデル(tokenizer)をまたいだ共通単位ではない。同一 ContentChunk が Claude で 950 tokens、GPT で 1,050 tokens になり得るため、「最初にどちらの provider がそのchunkを見たか」という実行順序だけで比率が変わってしまう。これは特に §19.1 Regression Detection で、Agent のスケジューリング順が変わっただけで指標が改善/悪化して見えるという致命的な不安定さを生む。

そこで、旗艦指標 **Context Amplification** は `Context Transport Volume / Unique Context Volume` を **normalized content bytes(basis: byte)** で計算することとした。byte 長は provider/tokenizer に依存しない deterministic な値であり、実行順序に依存しない。token ベースの **Token Amplification** は同一 Tokenizer Domain 内でのみ計算する補助指標として残し、異なる domain をまたぐ単一比率は作らない。

あわせて、system prompt / tool schema(Protocol Context)は API 仕様上 毎 request 再送される構造的 overhead であり、これを分子・分母に含めると通常の会話でも人為的に amplification が嵩上げされてしまう。そのため Protocol Context は Context Amplification の計算から除外し、Protocol Transport Volume / Protocol Share として別集計する。

さらに、chunk 単位の token 数は provider の API response からは得られない(provider が返すのは request 全体の input_tokens のみ)ため、たとえ token 単位であっても "Observed" ではなく "Derived"(ローカル tokenizer による再計算値)であると明示することにした。この区別を明文化するため、指標を Observed / Deterministic / Derived / Estimated / Diagnostic の5層タクソノミーに整理した(§4.2 の Fact/Diagnosis 分離をさらに細分化したもの)。

## Considered Options

- **Canonical tokenizer で全 chunk を再計算**: 実際に課金されていない架空の数値になり、「Observed」の原則(§4.2, §10.1)と矛盾するため却下。
- **First-occurrence tokenizer(その fingerprint が最初に登場した際の実測 token 数を代表値にする)**: 常に実測値である点は良いが、実行順序に依存して Task をまたいだ比較(Regression Detection)が不安定になるため却下。

## Consequences

- "Context Amplification 5.94x" は「同一情報が何倍 transport されたか」という観測値であり、「5.94倍が無駄」「1.0xまで削減可能」を意味しない。avoidable かどうかの判定は別途 Diagnostics レイヤー(likely avoidable traffic 等)で扱う。
- UI 上は Context Amplification(byte basis, 主役)の隣に Observed Token Traffic(コスト把握用、tokenizer 混在可)を並置し、両者を混ぜた比率は作らない。
