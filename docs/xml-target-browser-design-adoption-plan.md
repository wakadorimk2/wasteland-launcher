# XML Target Browser Design Adoption Plan

## 位置づけ

この文書は `C:\Users\wakad\Downloads\wasteland-launcher` 側で検討された XML target browser デザイン案を、現行 `wasteland-launcher` の React UI と ContextPack v3 に段階導入するための実装計画である。

目的は、XML patch diagnostics を file 単位の一覧から、`item`、`block`、`window`、`entity_class` などの XML entity target 単位で確認できる UI へ移行することである。診断・閲覧専用の性質は維持し、MO2、ゲーム本体、専用サーバー、リモート PC への書き込み UI は追加しない。

## 採用する設計原則

### Risk と Proof の視覚分離

`risk` は色だけで表す。既存の `Risk` 型は `safe`、`info`、`warn`、`danger`、`critical` を持つため、この意味づけを維持する。

`proof` は形、線、パターン、ラベルで表す。既存の `DiagnosticGroup.proof` は `exact`、`footprint`、`fallback`、`partial` を持つため、risk 色と混ぜずに chip shape や outline style で表す。

この分離により、たとえば `warn + exact` と `warn + fallback` を色だけで誤読しないようにする。

### Row の標準列順

target 行の標準列順は次に固定する。

1. `risk`
2. `target name`
3. `category`
4. `proof`
5. `diagnostics`
6. `mods`
7. `last writer`

`risk` と `proof` を離して配置し、危険度と証拠強度を別々にスキャンできるようにする。`diagnostics` は `ConflictKind` の要約、`mods` は関与 mod 数または代表 mod、`last writer` は load order 上の最後の scalar writer または primary operation の mod を示す。

### 対象単位

主表示単位は XML file ではなく XML entity target とする。

代表例:

- `items.xml`: `item`
- `blocks.xml`: `block`
- `windows.xml`: `window`
- `entityclasses.xml`: `entity_class`
- その他 XML: replay target または normalized XPath から推定できる最も安定した entity segment

file は facet、group、breadcrumb として残す。既存 `UiXmlFile` の集計は廃止せず、target rows を絞り込む入口として使う。

### Detail Pane の順序

target detail pane は次の順に固定する。

1. proof conclusion
2. affected slots
3. replay evidence
4. operation timeline
5. flag reasons
6. authored XPath

最初に「何がどの程度証明されたか」を置き、その後に evidence と operation history を置く。authored XPath は重要だが、target identity の一次情報ではなく説明情報として最後にまとめる。

## 現行 UI との対応

現行 UI は `ui/src/types.ts` の `ViewId` に `xml-browser` を持ち、`ui/src/main.tsx` の `XmlBrowser` と `ConflictViewer` が主な閲覧面である。

現行 derived model は `ui/src/model.ts` で `ContextPack.diagnosticGroups`、`operationsById`、`trace` を join し、`UiConflict`、`UiAttr`、`UiConflictEvidence` を構築している。Phase 1 ではこの derived model を拡張し、public JSON schema は変えない。

関連する既存型:

| 用途 | 既存型 |
| --- | --- |
| context pack | `ContextPack` |
| diagnostic group | `DiagnosticGroup` |
| replay effect | `PatchTraceEffect` |
| UI conflict row | `UiConflict` |
| UI target/detail row | `UiAttr` |
| XML file summary | `UiXmlFile` |
| top-level view id | `ViewId` |

## Phase 1: 既存 XML Browser を Target Browser 化

### 目的

既存 `xml-browser` view を維持したまま、表示の中心を file 一覧から entity target 一覧と detail pane へ移す。

### 実装対象

- `ui/src/model.ts` に target row derived model を追加する。
- `UiConflict`、`UiAttr`、`PatchTraceEffect`、`DiagnosticGroup` から entity target を推定する。
- `items.xml` など既知 XML では XPath segment から entity name と category を抽出する。
- replay evidence がある場合は `PatchTraceEffect.targetKey`、`displayTarget`、`affectedTargets[].canonical` を優先する。
- replay evidence がない場合は `DiagnosticGroup.displayTarget`、`normalizedXpath`、authored `XmlPatchOperation.xpath` に fallback する。
- `ui/src/main.tsx` の `XmlBrowser` を 3 ペイン構成へ拡張する。
  - 左: file / category / risk facet
  - 中: entity target rows
  - 右: target detail pane
- 既存 Diagnostics viewer への導線を維持する。

### Target Row の最小フィールド

Phase 1 の UI 内部型は、少なくとも次を持つ。

- `id`
- `file`
- `targetName`
- `targetKind`
- `category`
- `risk`
- `proof`
- `diagnosticKinds`
- `operationIds`
- `mods`
- `lastWriter`
- `displayTarget`
- `authoredXpaths`
- `affectedSlots`
- `evidence`

この型は UI 内部の derived model として扱い、ContextPack v3 には追加しない。

### Detail Pane

detail pane は次を表示する。

- proof conclusion: `exact`、`footprint`、`fallback`、`partial` と confidence の結論。
- affected slots: scalar slot、child slot、removed node などの replay target。
- replay evidence: `PatchTraceEffect` の kind、target、before / after、summary。
- operation timeline: load order、mod、operation、line、status。
- flag reasons: `ConflictKind` と説明文。
- authored XPath: operation ごとの authored XPath。

### 受け入れ条件

- `ViewId` は変更しない。
- `ContextPack` public schema は変更しない。
- `xml-browser` から entity target を一覧し、target detail を確認できる。
- `Diagnostics` view に遷移できる。
- replay evidence がない context でも fallback target row を表示できる。
- read-only UI のままで、apply 系操作は追加しない。

## Phase 2: Target Inspector を Top-Level View として追加

### 目的

Phase 1 の target browser が有用であることを確認した後、専用 top-level view として `target-inspector` を追加する。

### 実装対象

- `ui/src/types.ts` の `ViewId` に `target-inspector` を追加する。
- `ui/src/main.tsx` の `Sidebar`、`viewMeta`、view routing に `TargetInspector` を追加する。
- Phase 1 の target row model を共有し、`xml-browser` と重複実装しない。
- facet rail を追加する。
  - file
  - target kind
  - risk
  - proof
  - diagnostic kind
  - mod
- grouping を追加する。
  - by file
  - by target kind
  - by category
  - by last writer
  - by diagnostic kind
- replay diff 表示を detail pane に追加する。

### 受け入れ条件

- `target-inspector` は `Diagnostics` と競合せず、target-first browsing に集中する。
- `xml-browser` は軽量な XML overview として残せる。
- facet の組み合わせで大量 target を絞り込める。
- replay diff は evidence がある場合だけ表示し、ない場合は `not traced` / fallback reason を明示する。

## Phase 3: 大量データ向け強化

### 目的

実データで target rows が増えた場合に、スクロール、検索、facet、grouping の性能と理解しやすさを強化する。

### 実装対象

- target row list の仮想化。
- facet count の precompute。
- group summary row。
- target name / mod / XPath / effect target を横断する検索 index。
- exact target、fallback target、not traced target の検索重みづけ。
- keyboard navigation と selected row state の安定化。

### 受け入れ条件

- 数千 target row でも操作が重くならない。
- facet count と検索結果が現在の filter state と一致する。
- group summary から詳細 target row へ自然に掘れる。

## Schema 方針

ContextPack v3 を維持する。

Phase 1 と Phase 2 では、`DiagnosticGroup`、`PatchTrace`、`PatchTraceEffect`、`XmlPatchOperation` から UI 側 derived model を構築する。public JSON schema の変更は行わない。

schema 変更が必要になる可能性があるのは、次のような条件が実データで確認された場合のみである。

- UI 側 XPath parsing だけでは target entity identity を安定して復元できない。
- `PatchTraceEffect.targetKey` だけでは affected slot の種類を十分に分類できない。
- replay diff に必要な before / after 情報が現行 `PatchTraceEffect` では不足する。
- facet count を context-pack 生成時に持たないと性能要件を満たせない。

その場合も、別 Phase の提案として扱い、既存 schema v3 consumer との互換性を先に確認する。

## Design Token 方針

既存 `ui/src/styles.css` を基準にし、必要な token だけを追加する。

外部デザイン案の `tokens.css` を丸ごと移植しない。追加する場合は、既存 CSS の命名と用途に合わせて次のような最小 token に留める。

- proof outline / pattern
- target row density
- facet rail width
- selected row background
- slot badge style

色 token は risk 表現と衝突しないようにする。proof の表現に risk 色を再利用しない。

## Diagnostics Viewer との関係

`Diagnostics` view は candidate group の evidence review に残す。

`XML Browser` / `Target Inspector` は target-first browsing を担当する。target row から該当 `UiConflict` または `DiagnosticGroup` に遷移できるようにし、既存の operation timeline と evidence pane を再利用する。

責務分担:

| View | 主目的 |
| --- | --- |
| `Dashboard` | context pack 全体の概要 |
| `Load Order` | mod order と mod ごとの patch 概要 |
| `XML Browser` | XML file / target の軽量 browsing |
| `Diagnostics` | candidate group の evidence review |
| `Target Inspector` | Phase 2 以降の target-first deep inspection |

## 実装対象ファイル

Phase 1 の主対象:

- `ui/src/model.ts`
- `ui/src/types.ts`
- `ui/src/main.tsx`
- `ui/src/styles.css`

Phase 2 の追加対象:

- `ui/src/types.ts` の `ViewId`
- `ui/src/main.tsx` の routing / sidebar / view metadata
- 必要であれば target model helper の分離

Phase 3 の追加対象:

- target row virtualization helper
- search / facet index helper
- 必要に応じた UI component 分割

## 検証計画

docs-only 変更では次を確認する。

- `rg` で参照 path、型名、view id が現行ファイルに存在すること。
- `git diff --check` で Markdown の不要な空白がないこと。

Phase 1 以降の UI 実装では次を確認する。

- `npm test`
- `npm run ui:build`
- 可能なら既存優先 URL `http://127.0.0.1:5180/` で UI を確認する。
- browser 検証が使えない場合は、HTTP 200、`npm run ui:build`、`npm test` を代替検証とする。

## 当面やらないこと

- public JSON schema の即時変更。
- `target-inspector` の Phase 1 追加。
- MO2、ゲーム本体、専用サーバー、リモート PC への書き込み。
- compatibility patch の自動生成。
- デザイン案の token 全量移植。
- Diagnostics viewer の削除。

## 未解決事項

- `entity_class` など file ごとの target naming rule をどこまで Phase 1 で持つか。
- fallback target row の重複排除 key を `targetKey`、`displayTarget`、`normalizedXpath` のどれへ寄せるか。
- replay diff に before / after が不足する operation をどの表示粒度にするか。
- Phase 2 の `target-inspector` を `XML Browser` から完全分離するか、同じ component の mode として実装するか。
