# token-profiler

LLM / AI エージェントの token traffic をローカルで観測するツールです。
`claude` などの CLI を `wrap` 経由で起動し、どの context がどれだけ transport / reuse / amplify
されたかをブラウザ UI で確認できます。

基本の流れはこれだけです。

1. `wrap` でエージェントを起動する
2. ローカル UI を開く
3. 必要なら Task 見出し横の Export から CSV / JSON を出す

## 必要環境

- Node.js **>= 22.18**
- npm（依存関係のインストールとチェック実行用）

end user 視点のランタイム依存はありません。`typescript` / `@types/node` / `vite` / `preact` は
すべて devDependency です(UI クライアントはビルド時に `dist/ui/` へバンドルされます)。

## Quick Start

```sh
npm install
npm run build            # Web UI クライアント(Preact + Vite)を dist/ui/ にビルド
node bin/token-profiler.ts wrap -- claude
```

`npm run build` を省くと `wrap` は UI 無し(`--no-ui`)で動きます。core の記録・`report` は
ビルド不要です。

あとは普段どおり `claude` を使います。`wrap` は対象 CLI を子プロセスとして起動し、
ローカル proxy 経由で API traffic を記録します。Claude の挙動や API 利用料は変更しません。

実行中に以下を開きます。

```text
http://127.0.0.1:7331/
```

左側の Task 一覧から対象を選ぶと、観測結果を確認できます。CSV / JSON は Task 見出し横の Export
（`<details>` で開閉）から出力できます。

## 読み方の例

UI で 1 つの Task を調べるときの典型的な流れ（特定の過去事例ではなく手順の例）。

1. **Current amplification** の倍率とゾーン色を見る。倍率 CTV/UCV は「同じ情報が Task 内で何倍
   transport されたか」で、それ自体は無駄・削減可能を意味しない。帯の色は heuristic な参照ライン。
2. **Next focus** の Request カードをクリックすると、重複文脈バイトが最大の request が下の
   **Request detail** に開く。
3. Request detail の `thread` と `gap 占有率`、`新規(→UCV) | 重複(→CTV−UCV)` の split を見る。
   重複が特定の thread に偏っていれば、Next focus の Thread カードでその thread に絞る。
4. **request 調査** の集中度サマリ（および折りたたみの Pareto グラフ）で「上位何件で重複ボリューム
   の 80%」かを確認する。少数の request に集中していれば、その request 群が調査対象。
5. ここまでで分かるのは「どの request / thread が重複文脈バイトを積んでいるか」まで。
   原因の断定や「N トークン削減できる」という結論は、通信の観測だけでは出さない。harness や
   運用ルールの変更候補として書き留め、変更後に同じ手順で Before/After を見比べる。

## 詳しい使い方

[INSTALL.md](./INSTALL.md) に以下をまとめています。

- セッション終了後に UI を開く方法
- UI ポートや DB パスの変更
- CLI レポートの出し方
- targeted debug capture の使い方
- テストと型検査

## ドキュメント

- [docs/STATUS.md](./docs/STATUS.md): 今できること / 未実装 / 既知の限界（現状の早見表）
- [docs/ui-reading-guide.md](./docs/ui-reading-guide.md): UI の各パネル・指標の意味・計算方法・読み方
  （❔ アイコンの「詳しい説明」リンク先）
- [CONTEXT.md](./CONTEXT.md): ドメインモデルと用語
- [spec/token-profiler-spec.md](./spec/token-profiler-spec.md): 作業仕様
- [docs/adr](./docs/adr): Architecture Decision Records

## License

Apache-2.0（[LICENSE](./LICENSE)）
