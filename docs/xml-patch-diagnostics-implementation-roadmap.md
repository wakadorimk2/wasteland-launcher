# XML Patch Diagnostics Implementation Roadmap

## 位置づけ

この文書は `docs/xml-patch-diagnostics-design.md` を実装順序へ落とし込むためのロードマップである。目的は XML patch diagnostics の内部モデルを段階的に強化し、実装者が同じ順序と境界で作業できるようにすることである。

このロードマップは内部実装の計画に限定する。公開 CLI、public JSON schema、UI 表示、ユーザー向け出力形式は、内部モデルが安定するまで変更しない。

## 現行モデルの前提

現行の scanned patch IR は `src/core/types.ts` の `XmlPatchOperation[]` である。mod identity、load order、対象ファイル、operation 名、XPath/path、行番号、属性、patch value の要約を保持する。

現行の replay trace は `src/core/types.ts` の `PatchTrace` である。`src/core/patchTrace.ts` の `buildPatchTrace` が XML ファイル単位で operation を並べ、vanilla XML を読み、XPath を評価し、対応済み operation を in-memory DOM に適用して trace を生成する。

`PatchTraceEffect` は `PatchTrace` 内の効果ログであり、`setValue`、`setAttribute`、`removeAttribute`、`appendChild`、`appendAttributeText`、`removeNode`、`insertBefore`、`insertAfter`、`unsupported`、`parseError`、`miss` を表現する。今後の conflict detection と UI explanation の共通基盤として扱う。

`detectConflicts` は `src/core/conflicts.ts` の安価な一次検出器である。現在は同一 file と正規化 XPath で operation を group 化し、複数 mod が触る group と最後の load-order winner を返す。これは有用な cheap pass だが、XML effect の真理モデルではない。

`fast` / `exact` は `TraceOptions.mode` の replay mode である。`fast` は simple XPath の indexed path を優先し、必要に応じて generic XPath 評価へ fallback する。`exact` は generic XPath replay semantics を優先する。今後も `fast` は静的・indexed 近似の入口、`exact` は DOM/XPath replay の精密確認の入口として扱う。

## 実装順序

1. `PatchFootprint` の静的抽出を内部実装として追加する。
2. `PatchTrace` replay 内部に stable target key、provenance ledger、last-writer map を導入する。
3. `detectConflicts` を footprint/effect ベースへ段階移行する。
4. 必要性が実証された場合のみ logical tree と tombstone を検討する。

## Phase 1: Static Footprint Extraction

### 目的

`XmlPatchOperation` から read/write/insert/remove の可能性を静的に抽出し、replay 前の conservative な事前分類と conflict prefilter に使える内部モデルを追加する。

### 実装対象

- 内部型 `PatchFootprint` を追加する。
- `XmlPatchOperation` を入力にして `PatchFootprint` を返す extractor を追加する。
- XPath と operation の対応が supported subset に入る場合だけ precision を高くし、曖昧な XPath、未知 operation、parse-error 由来の operation は broad または unknown として扱う。
- footprint は少なくとも file key、read selectors、written scalar slots、removed node selectors、inserted child slots、confidence または precision marker を持つ。

### 既存コードとの接点

- 入力は `src/core/types.ts` の `XmlPatchOperation[]` とする。
- `src/core/scanner.ts` の抽出結果を変更せずに使う。
- `src/core/conflicts.ts` の `detectConflicts` はこの Phase では出力を変えない。
- `src/core/patchTrace.ts` の replay semantics は変更しない。

### 成果物

- `PatchFootprint` の内部型。
- footprint extractor。
- supported / broad / unknown の判定を確認する unit test。
- 将来の conflict prefilter に使える file-level grouping helper。

### 受け入れ条件

- CLI、public JSON schema、UI の出力が変わらない。
- `XmlPatchOperation[]` から read-only に footprint を生成できる。
- unsupported な XPath や operation を exact と誤認しない。
- 既存の `detectConflicts` の結果が変わらない。

### 次 Phase へ進む条件

- representative な `set`、`setattribute`、`removeattribute`、`append`、`remove`、`insertbefore`、`insertafter` で footprint の分類がテストされている。
- broad / unknown の扱いが false negative を避ける conservative な仕様になっている。

## Phase 2: Stable Replay Target Keys

### 目的

`PatchTrace` replay 内部で XPath 文字列ではなく replay 中の concrete target を安定して参照できるようにし、provenance ledger と last-writer map を導入する。

### 実装対象

- replay 1 回の生存期間内で有効な `NodeId` を DOM node に割り当てる。
- attribute slot、text slot、parent/child insertion position を表す `SlotKey` を導入する。
- scalar slot ごとの last writer map を持つ。
- removed node または removed subtree key ごとの remover ledger を持つ。
- created `NodeId` ごとの inserter ledger を持つ。
- append / insert 系 operation の parent/child slot effect を記録する。

### 既存コードとの接点

- 主対象は `src/core/patchTrace.ts` の `buildPatchTrace` と replay loop。
- 現行の `previouslyRemoved`、`previousScalarWrites`、`futureAdds` は lightweight provenance state として扱い、event ledger と last-writer map へ段階的に置き換える。
- `PatchTrace` は当面、既存の canonical XPath-like string を公開し続ける。
- `PatchTraceEffect` は既存 shape を保ちつつ、内部では stable key から生成する。

### 成果物

- replay 内部用の `NodeId` / `SlotKey` 管理。
- provenance event ledger。
- last-writer map。
- `order-induced-miss`、`silent-overwrite`、`dependency-order-miss` が既存と同等以上に説明できる test。

### 受け入れ条件

- `PatchTrace` の外部 shape が変わらない。
- 既存 test が通る。
- same XPath ではなく same target / same slot を根拠に scalar overwrite を検出できる。
- remove 後に存在しない node について、少なくとも remover ledger から原因を説明できる。

### 次 Phase へ進む条件

- `PatchTraceEffect` の target 生成が stable key 由来でも既存 UI と context pack で破綻しない。
- last-writer map と ledger により、XPath string grouping より強い conflict 根拠を返せる見込みが確認できている。

## Phase 3: Effect-Based Conflict Detection

### 目的

`detectConflicts` を正規化 XPath grouping だけに依存する実装から、footprint overlap と replay effect overlap を使う実装へ段階移行する。

### 実装対象

- Phase 1 の footprint を使って potential conflict candidate を prefilter する。
- Phase 2 の `PatchTraceEffect` と stable key 由来の effect を使って proven conflict group を作る。
- scalar slot overlap、remove/write overlap、insert/remove overlap、parent/child slot overlap を区別する。
- `fast` では cheap prefilter と indexed replay の結果を使い、`exact` では generic XPath replay の effect を優先する。
- 既存の normalized XPath detector は fallback として残す。

### 既存コードとの接点

- 主対象は `src/core/conflicts.ts` の `detectConflicts`。
- `src/core/visualize.ts` の trace 由来 conflict grouping と整合させる。
- `src/core/types.ts` の `ConflictGroup` は、必要性が実証されるまで変更しない。
- CLI と UI は既存 `ConflictGroup` shape を受け取る前提を維持する。

### 成果物

- footprint/effect overlap による conflict grouping。
- fallback としての existing normalized XPath grouping。
- same target but different XPath、same XPath but non-overlapping effect、order-induced miss を含む unit test。

### 受け入れ条件

- 既存 `detectConflicts` が拾っていた重要ケースを落とさない。
- different XPath が同じ concrete slot を触る場合に高 confidence の conflict として扱える。
- identical XPath でも replay effect が衝突しない場合に過剰な exact 判定へ寄せない。
- public JSON schema と UI はこの Phase でも即時変更しない。

### 次 Phase へ進む条件

- footprint/effect ベースの結果が normalized XPath fallback より有用であるケースが test と fixture で確認できている。
- 未対応 XPath や timeout で `unknown` 相当の保守的扱いができている。

## Phase 4: Logical Tree And Tombstones If Needed

### 目的

event ledger と last-writer map では説明できない provenance の要求が実証された場合のみ、logical tree と tombstone を導入する。

### 実装対象

- removed node の historical identity を保持する tombstone を設計する。
- replay DOM から消えた node と later miss を関連付ける lookup を追加する。
- logical tree は必要な diagnostic query に限定し、full XML database にはしない。

### 既存コードとの接点

- `src/core/patchTrace.ts` の replay state が主な接点になる。
- Phase 2 の `NodeId` と remover ledger を拡張する形で検討する。
- `PatchTrace` の公開 shape は、具体的な UI / schema 変更が必要になるまで維持する。

### 成果物

- tombstone が必要な diagnostic query の具体例。
- logical tree state の最小実装。
- earlier removal が later miss を引き起こすケースの説明 test。

### 受け入れ条件

- event ledger と last-writer map で解けない問題が明文化されている。
- memory cost と replay cost が現実的な範囲に収まる。
- read-only diagnostics の性質を保つ。

### 次 Phase へ進む条件

- この Phase は必須ではない。必要性が実証されない限り実装しない。
- 実装する場合は、public API 変更の前に内部 trace と test で有効性を確認する。

## 当面やらないこと

- public JSON schema の即時変更。
- UI の即時変更。
- 自動 compatibility patch 生成。
- 全 pairwise commutativity replay。
- full XML database 化。

## 検証方針

この文書の追加だけでは実装テストは必須ではない。以後の実装 Phase では、変更範囲に応じて `npm test` または対象 unit test を実行する。

ドキュメント更新時は最低限、次を確認する。

- `rg` で参照しているローカル path と型名が現行ファイル名と一致すること。
- `git diff --check` で Markdown の不要な空白がないこと。
- 可能なら `npm test` で既存挙動に影響がないこと。
