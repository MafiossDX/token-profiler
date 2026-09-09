---
status: accepted
---

# UI クライアントのビルド工程(Preact + Vite)と、それを end user に見せない release tarball 配布

1. 現状の設計境界: spec §20.1 は「`dist/` もビルド手順も持たない」「ランタイム依存はゼロのまま」「`npm install -g` で入って `wrap` で動く手軽さ」を明示している。ADR-0014 の consequence として `docs/ui-information-design.md` §6 も「`index.html` 1 枚・フレームワーク無し・ビルド無し」を運用ルールにしている。
2. 裏付け: `package.json` に `"dependencies"` キー自体が無い(`devDependencies` のみ)。`node bin/token-profiler.ts --help` を `npm install` 無し・`--experimental-strip-types` 無し(Node 22.18)で直接実行して正常動作。CLI / core 側は「リポジトリを落として Node さえあれば動く」が既にほぼ達成されている。
3. 一方 `.github/workflows/` は存在せず、CI もリリース自動化も未着手。git ログは `Initial public release` → `README/timestamp 対応` → `UI client tests + per-view export` の 3 コミットのみで、「リリースパイプライン」という概念自体がまだ無い。配布形態は「HEAD を clone して使う」しかなく、バージョン付き成果物の再現性は低い。
4. UI 側の圧力(ui-review §3 / §6 / §7): 6 つの `view*()` の文字列組み立て重複と、`renderDetail()` の full-`innerHTML`-replace に伴う `window.scrollY` 退避ハック(`pollRefresh()` / Requests ソートハンドラ)。§3 の option A(client test)+ B(`renderTable` 共有ヘルパ)は実施済みだが、component 単位の diffing が無い限り §6 の症状は残る。§6 #1 は「Preact + htm を no-build で vendoring」を推奨していたが、§7 で「React は本ツールの規模に対して過剰、jQuery 的 DOM ヘルパは §3/§6 の問題を解けるほどではない、Preact が中間(~3KB, diffing あり)。ただし Vite を入れると §6 が避けたかった no-build 前提が崩れる」と整理し直した。
5. カギになる観察: Vite 導入の最大の懸念は「開発時のビルド工程追加」だが、**タグ付き GitHub Release で tarball 配布する形にすると、ビルドは CI の責務になり、end user は「ビルド済み `dist/ui/` を同梱した tarball を Node で実行するだけ」になる**。つまり「clone & run が崩れる」のは *source clone して開発する人* だけの問題になり、*release を落として使う人* には影響しない、という形で切り分けられる。同時に、タグ付き成果物ができることで 3 の「再現性の低さ」も解消される。この 2 点(§7 の build step 導入と、それを打ち消す配布方法)は対で決めるのが筋がよい。

## Status

**Accepted。** レビューで骨子・方向性ともに問題なしと判定。当初「未決事項」として残した 8 点は、レビューが「方向性は妥当」と評価した『たたき台』をそのまま決定として確定する(→「決定事項の詳細」節)。§7 の build-step tradeoff と「Preact vs 代替」は本来別々の決定だが、5 の切り分けが成立する前提で一体の決定として扱う。本 ADR の accepted に伴い spec §20.1 と `docs/ui-information-design.md` §6 を改訂する。

**実装状況**: **A(UI クライアントの Preact + Vite 移行)は実装済み** — `src/ui/client/`(Preact app)、`vite.config.ts` / `vitest.config.ts`、`src/ui/server.ts` の `dist/ui/` 配信 + `/assets/<file>` realpath 境界、`uiClientBuilt()` による `wrap` の `--no-ui` degrade / `ui` の fail-fast、`test/ui-server.test.ts` の asset ルート・不在時 reject テスト、旧 `test/ui-client.test.ts`(jsdom)→ `src/ui/client/**/*.test.tsx`(Vitest)への置換、`npm run build` / `dev:ui` / `test:ui` の追加、spec §20.1 と `docs/ui-information-design.md` §6/§6.1 の改訂。**B(タグ付き GitHub Release で `dist/ui/` 同梱 tarball を配布する CI)は未着手** — `.github/workflows/check.yml` / `release.yml`、`THIRD_PARTY_NOTICES.txt` 生成、README/INSTALL の 2 導線整備が残っている(下記 Decision B / Consequences 参照)。

## Decision

2 つの決定を対にする。

### A. UI クライアントにビルド工程を導入する

- UI クライアント(`src/ui/index.html` の inline `<script>`)を Preact + Vite へ移行する。Preact / Vite は **`devDependency` のまま**(ビルド時に JS へバンドルして焼き込む)。core / CLI / proxy は `.ts` 直接実行のまま一切変えない。
- `npm run build`(Vite)を追加し、`npm run check` / CI に組み込む。client build が壊れたら `tsc --noEmit` と同じように落ちる。
- UI 側の TypeScript は Node の native type stripping(`erasableSyntaxOnly` 制約下)ではなく Vite の TS/JSX 処理に載る。`src/ui/` 用に別 `tsconfig`(または Vite 既定)が要る。
- `src/ui/server.ts` は Vite build 出力(`dist/ui/index.html` + hashed `assets/*.js|css`)を配信する。static asset ルートを追加し、hashed filename には長期キャッシュ、`/api/*` は現状の `no-store` を維持する。ルートの path boundary は決定事項 6、`dist/ui/` 不在時の起動挙動は決定事項 5。

### B. タグ付き GitHub Release で「ビルド済み同梱 tarball」を配布する

- `.github/workflows/release.yml`(仮): タグ push(`v0.1.0` 等)をトリガーに `npm ci` → `npm run build` → `bin/` ・ `src/`(core は `.ts` のまま)・ビルド済み `dist/ui/` ・ `package.json` ・ `package-lock.json` ・ `LICENSE` ・ `SECURITY.md` ・ `README.md` ・ `INSTALL.md` ・ 生成した `THIRD_PARTY_NOTICES` を tar.gz 化 → `gh release create` で添付(同梱物は決定事項 7・8 で確定)。
- **end user 視点**: 「tarball を展開し、Node ≥ 22.18 で `node bin/token-profiler.ts wrap -- claude`」。`npm install` 不要・ビルド不要・ランタイム依存ゼロは維持される(Preact/Vite は成果物に焼き込み済みで、`node_modules` を必要としない)。
- **developer 視点(source clone)**: `npm install` + `npm run build` が必要。INSTALL.md に 2 導線を明記する。

## 決定事項の詳細(旧「未決事項」— レビューを経て確定)

1. **ビルド成果物の置き場所**: (a) `dist/ui/` を commit する / (b) commit せず `prepare` / `prepublishOnly` でビルド / (c) commit せず release CI でのみビルドし tarball にだけ含める。`.gitignore` は現状 `dist/` `build/` を無視。→ **決定: (c)**。`dist/ui/` は版管理に載せない。ローカル開発は `npm run build`(または `vite build --watch`)。`.gitignore` の `dist/` 無視は維持する。
2. **`src/ui/server.ts` のアセット参照**: 開発時(`src/ui/` 直下)とリリース物(`dist/ui/`)で分岐するか、常に `dist/ui/` だけを見るか。→ **決定: 分岐なし**。`INDEX_HTML` / `ASSETS_DIR` 定数を `dist/ui/` 配下に固定し、dev では `vite build --watch` を回す。サーバ実装を二重化しない。
3. **配布チャネル**: → **決定: v0 は GitHub Release(tarball)のみ**。npm registry 公開は行わない。`package.json` の `"files"` は追加しない(npm 公開する場合に別途 ADR を起こす)。
4. **dev ループ**: → **決定: `vite build --watch` + 既存 `node:http` サーバが `dist/ui/` を配信**。`vite` dev server は使わない(`/api/*` の proxy 設定・サーバ二重化を避ける)。README / INSTALL の Quick Start 脇に記載する。
5. **source checkout で `dist/ui/` が無い場合の UI 起動挙動**: 決定事項 1 で `dist/ui/` を commit しないため、`npm run build` 前の clone 直後は `wrap` の proxy / core は動くが UI asset が無い。→ **決定: `dist/ui/index.html` の不在を起動時に検出する。`wrap` は warning を出して `--no-ui` へ degrade(`[token-profiler] ui not built — run 'npm run build' (source checkout only); continuing with --no-ui`)、`ui` コマンドは同メッセージで exit 1(fail-fast)**。release tarball には `dist/ui/` が常に含まれるのでこの経路には入らない。
6. **static asset route の path boundary**: → **決定: 許可ルートは「`/` → `dist/ui/index.html`」と「`/assets/<file>`」の 2 つだけ**。後者は `path.resolve(ASSETS_DIR, path.basename(reqPath))` で組み立て、`fs.realpathSync()` の結果が `fs.realpathSync(ASSETS_DIR)` 配下に収まることを確認してから読む(`path.normalize` だけでは symlink 経由の脱出を防げないため realpath 比較必須)。外れたら 404、ファイル不在も 404。`/api/*` とはルーティングを明確に分け、localhost bind は現状どおり固定。
7. **bundle した UI 依存の license notice**: Apache-2.0 で配布する以上、tarball に焼き込んだ Preact(および Vite が注入する helper 類)の notice を同梱する。→ **決定: build 時に `rollup-plugin-license` 相当で `dist/ui/THIRD_PARTY_NOTICES.txt` を生成**し、CI build と `npm run check` の両方で生成できるようにする。`README.md` の License 節から参照する。
8. **release tarball に `package-lock.json` を含めるか**: → **決定: 含める**。end user は `npm install` 不要だが、同じ tarball から rebuild / `npm audit` する人のために lockfile を同梱する(コスト小)。

## Considered Options

- **§6 #1: Preact + htm を no-build で vendoring**(ビルド工程を足さない)。次点。`htm` の tagged-template は JSX 変換不要で diffing の恩恵(`scrollY` ハック除去・重複削減)は得られるが、vendoring した UMD ファイルを `src/ui/` に手で置いて更新する運用になり、バージョン管理・更新性は release tarball 方式より弱い。「ビルドをどうしても入れたくない」場合の選択肢。
- **lit-html(no-build)**: 同じ tagged-template + diffing。state を global のまま保てるので移行はより漸進的だが、重複削減は Preact + components より小さい。
- **htmx(サーバレンダ)**: client JS はほぼ消えるが `src/ui/server.ts` にテンプレート層が増え、spec §17「core と UI が同一言語・同一データモデル」から離れる。§7 の判断どおり変更範囲が大きすぎる。
- **現状維持(何もしない)**: ui-review §3-A/B は実施済みなので許容範囲。§6 の full-replace 症状(`scrollY` 退避等)は残るが、実データの Task サイズ次第では体感影響は小さい。「ビルド工程ゼロ」の価値を最優先するならこれ。
- **配布: `dist/` を commit**: tarball CI 不要で clone だけで動くが、生成物を版管理に載せる(diff ノイズ・マージ衝突)。
- **配布: npm publish + `prepare` ビルド**: `npm i -g` の手軽さ(spec §20.1)を保てるが、`"files"` 設計と、npm 経由での初めての依存導入判断が要る。

## Consequences

- **spec §20.1 を改訂**(本 ADR の accepted に伴い実施): 「`dist/` もビルド手順も持たない」→「core / CLI / proxy は `.ts` 直接実行でビルド無し。UI client のみ Vite build を持ち、その成果物は release tarball に同梱する。end user 視点のランタイム依存ゼロ・`npm install` 不要は維持する」。移行完了までは「決定済み・移行前」と明示する。
- **`docs/ui-information-design.md` §6 を改訂**(ADR-0014 consequence の「one file / no framework / no build」を本 ADR が上書き)。現行コード(inline `<script>` + `renderTable` 共有ヘルパ + jsdom テスト)は「移行前の状態」として残し、移行後の姿を併記する。
- **`.gitignore`**: 変更なし(決定事項 1 — `dist/` は無視のまま。`dist/ui/` は commit しない)。
- **`src/ui/server.ts`**: static asset ルートを追加し、`INDEX_HTML` / `ASSETS_DIR` を `dist/ui/` 配下へ。配信範囲は `dist/ui/index.html` + `dist/ui/assets/*` のみ、`fs.realpathSync()` で assets ディレクトリの realpath 配下に収まることを確認してから読む(symlink 脱出も拒否、決定事項 6)、未知 asset は 404。`/api/*` の `no-store` は変えない。`dist/ui/index.html` 不在時の起動挙動(決定事項 5)—— `wrap` は `--no-ui` degrade + warning、`ui` は fail-fast。`test/ui-server.test.ts` に asset ルート(200 / content-type / 404 / `..` と symlink の traversal 拒否)と不在時 degrade のケースを追加。
- **`.github/workflows/`**: このプロジェクト初の CI。最低限 `check.yml`(`npm ci && npm run build && npm run check`)と `release.yml`(タグ → build → THIRD_PARTY_NOTICES 生成 → tarball → `gh release`)。
- **License attribution**: build 時に `dist/ui/THIRD_PARTY_NOTICES.txt` を生成(決定事項 7)。`README.md` の License 節から参照する。
- **README.md / INSTALL.md**: 「end user は Release tarball で完結」「developer は `npm install` + `npm run build`」の 2 導線を明記。現在の INSTALL.md は前者の存在を想定していない。source checkout で UI 未ビルドのときの挙動(決定事項 5)も INSTALL.md に書く。
- **`package.json`**: `scripts.build` を追加。`"files"` は追加しない(決定事項 3 — npm 非公開)。
- **release tarball 同梱物**: `bin/` ・ `src/` ・ `dist/ui/` ・ `package.json` ・ `package-lock.json`(決定事項 8)・ `LICENSE` ・ `THIRD_PARTY_NOTICES`(決定事項 7)・ `SECURITY.md` ・ `README.md` ・ `INSTALL.md`。`SECURITY.md` は実行に不要だが配布物として `README` / `LICENSE` / `INSTALL` と同カテゴリなので含める。
- Preact + Vite を後で外すには本 ADR を supersede する ADR が必要(ADR-0014 と同じ、drift ではなく決定として扱うための意図的な摩擦)。
- ADR-0014 の client 関連 consequence(再描画をまたぐ ephemeral UI 状態を module-level state で保持し、polling の signature-gated 再描画で潰さない)は、Preact 移行時に component-local state / signals へ移す設計判断が別途必要になる(本 ADR では踏み込まない)。
