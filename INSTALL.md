# インストールと使い方

このドキュメントは、checkout した `token-profiler` をローカルで動かすための詳細手順です。

## 必要環境

Node.js **>= 22.18** を使ってください。

`token-profiler` は TypeScript ソースをそのまま実行します。Node 22.6 から 22.17 でも動かせますが、
各コマンドに `--experimental-strip-types` が必要です。Node 22.18 以降なら追加フラグなしで実行できます。

依存関係を入れ、UI クライアントをビルドします。

```sh
npm install
npm run build
```

`npm run build` は Web UI クライアント(Preact + Vite)を `dist/ui/` にバンドルします(ADR-0015)。
core / CLI / proxy は TypeScript ソースをそのまま実行するのでビルド不要です。UI だけが対象です。

`dist/ui/` が無い状態(clone 直後・`npm run build` 前)でも `wrap` の記録自体は動きますが、
UI は起動できません。`wrap` は warning を出して `--no-ui` に degrade し、`ui` コマンドは
`ui not built` で終了します。UI を使うには一度 `npm run build` を実行してください
(開発中は `npm run dev:ui` = `vite build --watch` を回しておくと自動で追従します)。

**end user 視点のランタイム依存はゼロです**。`typescript` / `@types/node` / `vite` / `preact` は
すべて devDependency で、UI は `dist/ui/` にバンドル済みとして配布されます(GitHub Release の
tarball には `dist/ui/` が同梱されるため、展開して Node で実行するだけで動きます)。

## セッションを wrap する

```sh
node bin/token-profiler.ts wrap -- claude
```

`wrap` は対象コマンドを子プロセスとして起動し、API の base URL をローカル proxy に差し替えて
traffic を記録します。起動後は普段どおり CLI を使います。

既定では、`wrap` は `127.0.0.1:7331` にローカル UI も起動します。すでに同じポートで
`token-profiler` UI が動いている場合は、新しく起動せず既存 UI の URL を表示します。

UI を起動しない場合:

```sh
node bin/token-profiler.ts wrap --no-ui -- claude
```

別ポートで UI を起動する場合:

```sh
node bin/token-profiler.ts wrap --ui-port 8000 -- claude
```

`--ui-port` と `--no-ui` は同時に指定できません。

## UI で見る

wrap したセッションの実行中に以下を開きます。

```text
http://127.0.0.1:7331/
```

UI では Task を選び、以下のビューで観測結果を確認できます。

- Task Overview
- Traffic Breakdown
- Conversation Threads
- Reuse Timeline
- Requests
- Export

CSV / JSON は Export ビューから出力できます。

wrap したコマンドが終了すると、相乗り起動した UI も終了します。過去の Task を見返す場合は、
UI を単体で起動します。

```sh
node bin/token-profiler.ts ui
```

ポートや DB パスを変える場合:

```sh
node bin/token-profiler.ts ui --port 8000 --db <path>
```

DB パスの既定値:

```text
~/.token-profiler/profiler.sqlite
```

## CLI でレポートを見る

通常は UI で確認します。端末だけで 1 Task の概要を見たい場合は `report` を使います。

```sh
node bin/token-profiler.ts report <task_id>
```

`task_id` は `wrap` 起動時に表示されます。

```text
[token-profiler] task <task_id>
```

終了時にも、そのまま使える `report` コマンドが表示されます。

```text
[token-profiler] task <task_id> ended — run: token-profiler report <task_id>
```

## targeted debug capture

通常は不要です。特定の measurement を調べるために、一部の raw chunk text だけを一時的に保存する
診断用機能です。profiler DB には保存されません。

1 セッションだけ scoped capture を有効にする例:

```sh
node bin/token-profiler.ts wrap --debug-capture-filter "system:first:2048" -- claude
```

capture の一覧:

```sh
node bin/token-profiler.ts debug-capture list --task <task_id>
```

capture の削除:

```sh
node bin/token-profiler.ts debug-capture purge --task <task_id>
```

## テストと型検査

```sh
npm test           # core / CLI / proxy(node --test)
npm run test:ui    # UI クライアント component テスト(Vitest)
npm run typecheck  # tsc(root)+ tsc(src/ui/client)
npm run check      # typecheck → build → npm test → test:ui
```
