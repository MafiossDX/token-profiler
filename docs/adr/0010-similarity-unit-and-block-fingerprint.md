---
status: accepted
---

# Similarity Unit is distinct from ContentChunk; Block Fingerprint identifies whole StructuralBlocks; cross-epoch comparison requires explicit aliasing

ADR-0002 で Exact Fingerprint(ContentChunk 単位)と Similarity Signature(MinHash)を導入したが、実装可能な粒度まで詰めると3つの不整合が見つかった。

1. CONTEXT.md は「Similarity Signature は ContentChunk **集合**から生成する」と書く一方、spec.md §8 のデータモデルは `similarity_signature` を ContentChunk **単体**のフィールドとして持たせている。CDC の ContentChunk は数百バイト〜数KB程度の小さな単位で、この粒度で近似類似度を出しても、Review Churn の「Near repeated content 3.4 KB」のような**どの領域が重複していたか**を説明できる volume にならない。
2. CONTEXT.md の Thread Role は「system prompt の Exact Fingerprint」に対してユーザーが role をマッピングする、としているが、Exact Fingerprint は ContentChunk(Level 2、CDC 分割後の断片)単位でしか定義されておらず、「system prompt 全体」を指す fingerprint が存在しない。
3. Fingerprint Key Epoch(ADR-0002・CONTEXT.md)は「異なる epoch は比較不能」とするが、ContentChunk が fingerprint を1個しか持たない設計だと、epoch をまたいだ過去 Task との比較を後から行いたくなっても(raw を破棄済みのため)再計算できない。Similarity Signature 側も、`similarity_epoch` を単なるタグとして付けるだけでは、MinHash の shingle hash/seed 自体が epoch に依存していない限り privacy reset の意味を持たない。

## Decision

### 1. Similarity Unit を新設し、Near-Duplicate Similarity の粒度とする

```text
ContentChunk        # Exact Reuse 用。CDC 分割後の最小単位(Level 2)
Similarity Unit      # Near-Duplicate Similarity 用。message / StructuralBlock / review output 等、
                      # 診断結果として意味のある volume を報告できる粒度
```

Similarity Signature(MinHash)は Similarity Unit 単位で生成・保存する。ContentChunk は Unit 内部の shingle 抽出の材料として使われるが、`similarity_signature` を ContentChunk のフィールドとして持たせることはしない(spec.md §8 データモデルを修正)。**具体的にどの粒度(message か StructuralBlock か review output か)を Similarity Unit の既定値にするかは未決定**(§25 spec.md に追記)— Measurement Profile の一部としてバージョン管理する。

### 2. Block Fingerprint を新設し、Thread Role マッピングに使う

```text
Block Fingerprint    # HMAC-SHA256(local_secret, normalized_block) — StructuralBlock 全体に対する fingerprint
```

Thread Role のマッピング(`thread_roles: { ..., role: ... }`)は、ContentChunk 単位の Exact Fingerprint ではなく、system prompt に対応する StructuralBlock 全体の Block Fingerprint をキーにする。CONTEXT.md の Thread Role 定義を修正する。

### 3. Cross-epoch 比較は「比較不能」がデフォルト。alias を持たせるかは実装判断として保留

現行の「異なる epoch は比較不能」という原則(ADR-0002・CONTEXT.md Fingerprint Key Epoch)は変更しない。ただし、rotation 後に過去 Task との意図的な再比較をしたい場合の選択肢として、(a) ContentChunk が複数 epoch 分の fingerprint alias を保持する、(b) rotation 時に cross-epoch equivalence レコードを明示的に生成する、の2案があることを記録する。**どちらを採るかは未決定**(§25 に追記)。

Similarity Signature の epoch は、`similarity_epoch` というタグを付けるだけでは不十分で、**MinHash の shingle hash 関数/seed 自体が epoch に依存する**必要がある(タグだけでは同じ内部状態が epoch をまたいで漏れうるため)。これは実装要件として確定する。

## Considered Options

- **Similarity Signature も ContentChunk 単位のまま、UI 側で volume を再集約する**: 却下。近似類似度は集合の性質であり、CDC の小さな chunk 単位で個別に持たせても集約時に意味のある近似にならない(MinHash はある程度の feature 集合に対してのみ Jaccard 近似の意味を持つ)。
- **system prompt 全体を1つの巨大な ContentChunk として扱う**: 却下。CDC の目的(挿入・削除への耐性)と矛盾し、Exact Reuse Ratio の粒度も壊れる。

## Consequences

- spec.md §8 のデータモデルで `similarity_signature`/`similarity_scheme_id`/`similarity_epoch` を ContentChunk のフィールドから Similarity Unit のフィールドへ移す。
- CONTEXT.md の Similarity Signature / Near-Duplicate Similarity / Repeated Review Content / Thread Role の各定義を、Similarity Unit と Block Fingerprint を使うよう更新する。
- MVP でどの Similarity Unit 粒度を採用するかは §25 の未解決事項として残る。決めるまでは Near-Duplicate Similarity の volume 表示(例:「Near repeated content 3.4 KB」)は実装できない。
