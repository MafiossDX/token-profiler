---
status: accepted
---

# Two-layer chunking with keyed exact fingerprint + MinHash near-duplicate estimation

Payload はデフォルトで保存しない(§9.1)一方、「71.4% overlap」のような重複度は表示したい。単純な構造境界(StructuralBlock)単位の SHA-256 では、tool output のわずかな差分(timestamp の1行違いなど)で「完全に別物」と誤判定してしまう。逆に固定長 chunk では、先頭へのテキスト挿入だけで境界が全部ずれ、後続の一致が消える。

そこで二層構成を採用した。StructuralBlock(system / message / tool_result などの意味的境界、Level 1)の内部を、Content-Defined Chunking(CDC)でさらに分割する(Level 2、ContentChunk)。CDC は内容から境界を決めるため、途中への挿入があっても後続 chunk の境界が復帰しやすい。

各 ContentChunk には `HMAC-SHA256(local_secret, normalized_chunk)` を Exact Fingerprint として保存する(完全一致判定用)。plain SHA-256 ではなく HMAC にしたのは、既知の短い prompt 文字列に対する辞書照合攻撃を難しくするため。加えて MinHash による Similarity Signature を保存し、Near-Duplicate Similarity(推定 Jaccard similarity)を算出できるようにした。SimHash ではなく MinHash を選んだのは、「91% same」という UI 表現に対して Jaccard similarity の推定値の方が意味的に直結するため。raw text は処理中に一時的にメモリ上で使うだけで、fingerprint/signature 生成後は破棄する。

`local_secret` は installation 単位で永続化し、`Fingerprint Key Epoch` という世代識別子を fingerprint ごとに保存する。rotate しても、既に保存済みの fingerprint 同士の比較(同一 epoch 内)は引き続き可能。無効になるのは、異なる epoch をまたいだ新規照合のみであり、その場合は「不一致(0%)」ではなく「比較不能」として明示的に区別する。Similarity Signature 側にも対応する epoch を持たせ、privacy reset(`--forget-old`)時は両方の epoch を同時に切る。

## Decision Evidence

Q10 の実測スパイクで、Claude Code の orchestrator は1ターン目で31個、2ターン目で57個の tool schema を送っており、差分はすべて MCP サーバー接続完了に伴う追加(27個の新規ツール)と1個の削除(`WaitForMcpServers`)だった。StructuralBlock 全体を丸ごとハッシュする方式であればこの tool_schema block は「完全に別物」と判定され、既存27個分の再利用が一切検出できない。CDC による ContentChunk 分割であれば、変化していない既存ツールの chunk はそのまま Exact Fingerprint が一致し、新規追加分だけが「新規」として計上されるはずで、この設計判断の実務上の妥当性を裏付ける実例になった。

## Considered Options

- **固定長 chunk**: 挿入・削除で境界が全ずれし、実用的な dedup 精度が出ないため却下。
- **StructuralBlock 単位のみ(CDC なし)**: tool output の些細な差分を「別物」と誤判定するため却下。
- **Canonical tokenizer による再計算**: 元テキストを保持しない前提と矛盾しないが、実際にどの provider にも課金されていない架空の数値になり、「Observed」の原則を壊すため、token volume の文脈では別途 ADR-0003 で却下。

## Consequences

- raw payload を捨てた後は chunk 粒度や hash 方式を後から変更できない(one-way door)。
- Similarity Signature は非可逆だが元コンテンツの feature 情報を保持するため、無害なメタデータではなく sensitive metadata として扱う必要がある。
- Data retention(fingerprint/signature を何日保持するか)と Key Epoch の寿命(secret をいつ rotate するか)は独立した概念であり、epoch は retention 期間より大幅に長く持続してよい。
