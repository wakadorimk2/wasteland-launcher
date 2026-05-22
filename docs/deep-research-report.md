# 7 Days to Die XML patch 診断ツールの設計調査

## 要旨

いまの `wasteland-launcher` は、すでに **read-only の診断 MVP** として、MO2 の有効 mod 順序の読取り、`Config/*.xml` からの patch operation 抽出、単純な same-file XPath conflict の検出、`fast` / `exact` を持つ patch trace、そして JSON/HTML/React UI への可視化基盤まで整っておりますの。現状の conflict 判定は **`file + normalized xpath` の単位でグルーピングし、最後の mod order を winner とみなす** 方式が中心で、trace 側では `silent-overwrite`、`order-induced-miss`、`dependency-order-miss`、`broad-match-risk` などの診断種別がすでに芽として入っています。 fileciteturn5file0L3-L3 fileciteturn6file0L3-L3 fileciteturn7file0L3-L3 fileciteturn8file0L3-L3 fileciteturn11file0L3-L3

この問題に対して、わたくしの最終的なおすすめは、**「DOM をそのまま最終 truth にする」のではなく、「安定 NodeId を持つ論理木 + provenance ledger + XPath footprint 解析」を中核にした診断エンジン**へ寄せることです。Exact mode では実 replay を行い、Fast heuristic mode では静的な read/write/structural footprint から候補を絞り込み、必要な箇所だけ局所 exact replay にフォールバックする二段構えが、精度・速度・実装容易性の釣り合いが最も良うございます。RFC 5261 は「**patch は document order で逐次適用**」されること、selector は **単一の一意 target** を想定することを明示しており、XQuery Update Facility は **node identity を持つ pending update list** と **更新同士の互換性規則**を与えてくれます。これらを合わせると、今回の診断器は **最終 XML 生成器**というより **更新の因果解析器** として設計するのが正道です。 citeturn34view2turn34view0turn37view2turn35view0turn31view1turn31view2

## 既存研究と標準の読み解き

あなた様の patch DSL は、厳密には単一の既存標準そのものではありませんの。**逐次 replay と XPath selector** という意味では RFC 5261 に近く、**`insert-before` / `insert-after` / `append` / `update` / `remove`** といった実務的な命令集合という意味では XUpdate に近く、**衝突・互換性・node identity** という意味では XQuery Update Facility の見方が最も役に立ちます。RFC 5261 は `<add> / <replace> / <remove>` を document order に従って逐次適用し、selector が複数ノードに当たるのをエラーとみなします。また論理同値性を canonical form と whitespace の扱いに結びつけており、診断器でも **white-space text node を無視してよいかどうかを最初に決める必要**がございます。 citeturn34view2turn34view0turn36view0turn36view1

XUpdate は 2000 年の Working Draft で止まっておりますが、**XPath でノード集合を選び、`insert-before` / `insert-after` / `append` / `update` / `remove` / `rename` を行う**という発想を、とても率直に表しております。あなた様の `append / set / setattribute / remove / removeattribute / insertBefore / insertAfter` は、命名こそ異なれど、実務上はこの流儀の延長として読むのがいちばん自然ですわ。つまり、今回の診断器の核心は「XML diff を比較する」のではなく、**既に与えられている update script を replay し、その script 同士の相互作用を診断する**ことにあります。 citeturn7view0turn5view0

XQuery Update Facility は、さらに一歩進んで、更新式の結果を **XDM instance と pending update list** の組として定義し、update primitive は **node identity** で参照されると述べています。また同一 snapshot 内では、同一 node への複数 `replace` や複数 `replace value of` をエラーにし、さらに **親 element への値置換が、その子への更新を事実上上書きする**例も与えています。これは、あなた様の世界で言えば **silent overwrite** や **structural mask** や **順序依存** を、単なる UX 上の警告ではなく、形式意味論に近い形で捉えるヒントになりますの。もっとも、XQUF は snapshot 内で pending updates を merge するモデルですから、**mod load order に沿って 1 本ずつ mutate される 7DTD の patch replay と同一ではありません**。ですが、**互換性規則の発想**はそのまま流用できます。 citeturn4view0turn35view0turn35view2turn37view2turn37view0

XML provenance については、Foster・Green・Tannen の仕事が重要で、**XML を semiring annotation つきデータとして扱い、XQuery view に現れる値の provenance を追跡する**枠組みを示しています。とくに有益なのは、XML を **child relation への shredding** で関係データ風に捉え、XPath を Datalog 的に翻訳する見方です。もちろんこの論文は **unordered XML** を主対象にし、属性や sibling order を簡略化しておりますから、そのまま 7DTD の ordered XML patch 診断に持ち込むことはできません。それでも、**node/slot provenance を別表に外出しする**、**木と index/table を併用する**、という設計思想には大変しっかりした学術的後ろ盾がございます。 citeturn3view0

XML 更新の静的解析については、直接の commutativity 論文ページはこの環境で取得できませんでしたが、周辺の accessible literature は十分に有益でした。`Type-Based Detection of XML Query-Update Independence` は、schema があるときに **型の連鎖 chains** から query と update の独立性を多項式空間・時間で判定する方向を示しています。Cheney の Flux は、更新言語に対して **path-error analysis**、すなわち「実は何も効かない dead update」を見つける発想を与えます。さらに XML adaptation の automata-based static analysis と rewrite-based verification は、**更新列の安全性や到達性を木オートマトン／書換え規則で検証する**方向性を示しており、Fast heuristic mode の理論的インスピレーションとして申し分ございません。 citeturn24academia0turn24academia1turn24academia2turn24academia3

XML diff/merge と tree edit distance は、核心ではなく **補助輪** として使うのがおすすめです。RFC 5261 自身が「これは full XML diff format ではない」と述べており、今回参照した標準群にも **XML 差分生成と三者マージを包括的に定める単一の支配的標準**は見当たりませんでした。Tree edit distance は ordered tree の sibling order を距離に含めるので、**局所 subtree の説明 UI** や **似た patch fragment のクラスタリング**には役立ちますが、正確計算は古典的に高価で、近年も weighted TED は実質 cubic 領域、unweighted でもなお superquadratic です。したがって、**核心ロジックは replay + provenance、TED は説明用の局所処理**に留めるのが現実的です。 citeturn1view0turn17view2turn43view0turn43view1turn43view2

## 計算モデルの提案

まず結論だけ申し上げますと、**生 DOM を唯一の実行モデルにするのは避けるべき**です。ただし、**parse front-end と exact fallback evaluator として DOM を使う**のは大いに結構です。XDM は **各 node が一意の identity を持つ**こと、**document order は安定な全順序**であること、ノード種別として document / element / attribute / text / comment / PI / namespace があることを明示しています。あなた様の診断器で本当に必要なのも、まさにこの **node identity・order・node kind の明示化**でして、DOM object の参照同一性だけでは provenance と tombstone を綺麗に保てませんの。 citeturn31view1turn31view2turn30view0turn31view4

したがって、実装の主状態は **file ごとの論理木** にいたします。patch は vanilla の各 target XML file ごとに mod load order 順で効くのですから、全 mod を一つの巨大木に混ぜるより、**`items.xml` ごと、`recipes.xml` ごと**に閉じた state machine として扱う方が単純で速うございます。これは RFC 5261 の逐次適用モデルにも自然に合致し、現リポジトリの `buildPatchTrace` も file ごとに operation を束ねて replay しているため、既存コードの進化としても無理がありません。 citeturn34view2turn8file0turn10file0

おすすめの論理表現は、**element / text / comment / PI を NodeRecord、attribute を別表 AttrRecord、値の更新履歴を SlotVersion として持つ方式**です。属性は child ではなく **element にぶら下がる別 slot** として表現し、text node は explicit node にいたします。これで `setattribute` と `set` を **同じ scalar slot 書込み**に正規化でき、現在のテストが狙っている「`set` と `setattribute` が同じ attribute target に収束する」という性質も、実装上もっと綺麗に保てます。現リポジトリのテストでも、`set` と `setattribute` が共通 canonical target に正規化され、後者を `silent-overwrite` として検出しています。 fileciteturn11file0L3-L3

削除後 provenance を保つには、**node を物理削除せず tombstone 化** するのが肝要です。すなわち `alive=false`, `deathOpId=<op>` を付け、親子リンクからは外すが records 自体は残します。挿入は逆に **fresh NodeId** を払い、`birthOpId=<op>` と `birthFragmentOrdinal` を付けます。最終値 provenance は `SlotVersion` の latest live version を辿れば取れますし、**「なぜ miss したのか」**は tombstone や future add candidate から説明できます。現在の repo でも `previouslyRemoved`, `futureAdds`, `previousScalarWrites` を side state に抱えており、方針としては既に正しい方向ですから、これを record 化するだけでずいぶん強くなります。 fileciteturn8file0L3-L3

sibling order は、理想を言えば order-maintenance データ構造が美しいのですが、TypeScript/Node の現実では **疎な整数キー** か **fractional order key** が良い塩梅です。たとえば各 sibling に `ord=1024, 2048, 3072...` のような gap を持たせ、`insertBefore/After` は中点を割り当て、詰まった親だけ局所 reindex すれば十分実務的です。これで append / insert にほぼ O(1) で対応でき、child list のソートも簡単です。一方で canonical explanation path は **`XPath 文字列そのもの` を identity に使わず**、`NodeId` から都度導出する説明表現にとどめるべきです。順序変更や削除で「同じ XPath だったはず」が簡単に drift するからですわ。これは XDM の node identity と document order の考え方に忠実な設計です。 citeturn31view1turn31view2

木と DB 風 index/table は、**併用一択** でございます。XML provenance 論文が示すように、child relation 的な shredding は XML query/provenance の説明に相性が良く、tree pattern 研究でも path/twig を index と join で高速化する蓄積がございます。ですから、**木は正しい意味論のために保持し、index は速い候補検索のために張る**のがいちばん自然です。 citeturn3view0turn27view0turn25academia3

### 推奨する正規化テーブルと index

| 名称 | 主な列 | 役割 |
|---|---|---|
| `operations` | `opId, modId, order, fileId, opcode, rawXpath, sourceLine, payloadKind, payloadText, attrsJson` | patch IR |
| `nodes` | `nodeId, fileId, kind, name, nsUri, parentId, ord, alive, birthOpId, deathOpId` | element/text/comment/PI の本体 |
| `attrs` | `attrId, ownerNodeId, name, nsUri, alive, birthOpId, deathOpId` | attribute slot 本体 |
| `slot_versions` | `versionId, slotKey, opId, beforeValue, afterValue, alive` | scalar provenance |
| `fragments` | `fragmentId, opId, serializedXml, fragmentHash` | 挿入 payload 管理 |
| `match_events` | `opId, nodeIdOrSlotKey, matchKind, cardinality, confidence` | XPath 命中履歴 |
| `effects` | `opId, effectKind, targetKey, beforeHash, afterHash, note` | 適用結果 |
| `footprints` | `opId, readSig, writeSig, structSig, broadRiskFlags` | fast mode 用静的署名 |
| `compiled_xpath_cache` | `xpathHash, subsetKind, planJson` | XPath plan cache |

おすすめ index は、少なくとも `nodes(fileId, name)`, `nodes(fileId, name, keyAttrName, keyAttrValue)` 相当、`children(parentId, ord)`, `attrs(ownerNodeId, name)`, `slot_versions(slotKey, versionId desc)`, `footprints(fileId, readSigPrefix)`, `footprints(fileId, writeSigPrefix)` でございます。

## 計算量と最適化

順次 replay の naive 実装は、file ごとに `m_f` 個の operation があり、各 XPath 評価が tree 全体 `n_f` をほぼ舐めるとすると、ざっくり **`O(Σ_f m_f * n_f + insertCost + provenanceWriteCost)`** になります。これは RFC 5261 の逐次適用意味論から直接導ける工学的上界で、tree pattern matching が XML query processing の主要ボトルネックである、という survey とも整合します。とくに descendant axis `//`、wildcard `*`、predicate 内関数、複数分岐が入ると generic XPath engine はフル走査寄りになりやすく、ここが主戦場です。 citeturn34view2turn27view0turn25academia3

現在の repo もすでにこの点を意識していて、`SimpleXPath` 的な fast path、`XmlReplayIndex` による tag / tag+key の index、dirty flag、`broadReplayTargetLimit`、generic XPath への fallback を持っています。これは方向としてとても宜しいですから、次は **fast path を「最適化の抜け道」ではなく「正式な compiled subset evaluator」へ昇格**させるのがよろしゅうございます。すなわち、よくあるパターンだけを明示的にコンパイルし、それ以外は exact fallback に逃がす設計です。現テストにも `contains`, `or`, ordinal, broad match, append→later lookup, remove→later miss といった重要ケースが揃っておりますから、回帰資産も十分です。 fileciteturn8file0L3-L3 fileciteturn11file0L3-L3

よく index 化すべき XPath パターンは、実務上つぎの順になりますの。第一に **絶対 child chain + `[@name='x']` / `[@id='x']`**。第二に **descendant + 最終 step が key attr つき**。第三に **terminal attribute access**。第四に **single ordinal after key predicate**。逆に `not()`, complex boolean, preceding/following axis, namespace axis, union などは fallback で構いません。tree pattern 研究が示す通り、XML query の多くは path/twig に落ちるので、subset evaluator でも実務カバー率はかなり高いはずです。 citeturn27view0turn25academia3

cache invalidation は、**構造 index と値 index を分けて考える**のが肝心です。`setattribute` や attribute terminal `set` は、通常は **その attr 名/value index** だけを触ればよく、親子構造 index は汚しません。`append` / `insertBefore` / `insertAfter` / `remove` は、**parent child-order**, **tag/key descendant index**, **subtree live set** を更新する必要があります。current repo のような file 単位 dirty flag は第一歩として良いのですが、次段階では **parent-local dirty** と **key-index dirty** に分けると、不要な全 rebuild を避けられます。 fileciteturn8file0L3-L3

### broad XPath risk の検出

`broad XPath risk` は exact mode なら単純で、**`matchCount != 1`** または RFC 5261 的に「一意 target が要請される selector なのに複数命中」した時点で旗を立てられます。fast mode では、**静的リスクフラグ**を併用なさるのがおすすめです。具体的には `//`, `*`, `contains`, `starts-with`, `or`, `not`, key predicate 不在、位置 predicate だけ、末尾 attr 参照なのに直前 element が key 無し、といった特徴です。query/update independence 研究が schema 下で chains を使うのと同じ発想で、ここでは schema の代わりに **経験的 key attribute 集合** と **vanilla corpus の頻度統計**を使えば十分に役立ちます。 citeturn24academia0turn27view0

### full replay せずに競合候補を見つける方法

ここが設計上の華でございます。各 operation に対して、exact な node 集合ではなく **footprint** を計算いたします。

- `R_path(op)`: XPath が読む構造・predicate
- `W_slot(op)`: attribute/text/value への scalar write
- `W_struct(op)`: child order, insertion anchor, deletion subtree
- `K_anchor(op)`: 親、兄弟、terminal slot などの canonical anchor
- `Risk(op)`: broad selector・unsupported function・namespace などの不確実性

この署名だけで、多くの pair を **`definitely commute` / `definitely non-commute` / `unknown`** に落とせます。たとえば file が違えば自明に可換、disjoint subtree への scalar update 同士も可換です。一方、同じ scalar slot への異値書込みは非可換、同じ親への append/insert は sibling order が結果に入る以上ふつう非可換、ancestor remove と descendant-targeted op も非可換です。`unknown` だけを **局所 two-op replay** に回せば、全 pair の全 replay を避けられます。独立性解析や path-error analysis の考え方が、そのまま heuristic mode の理論土台になります。 citeturn24academia0turn24academia1turn35view0turn35view2

### pairwise commutativity の実務ルール

| 組み合わせ | 判定 |
|---|---|
| 同じ slot への `set` / `setattribute` | **同値を書くときのみ可換**。異値は silent overwrite 候補 |
| `setattribute` と `removeattribute` 同 slot | **非可換** |
| attribute/text への `append` と `set` 同 slot | **通常は非可換** |
| 同じ parent への `append` 同士 | **順序が結果に残るので通常は非可換** |
| 同じ anchor への `insertBefore/After` 同士 | **通常は非可換** |
| ancestor `remove` と descendant 対象 op | **非可換**。後者 miss や structural mask を起こす |
| disjoint subtree への op 同士 | **可換** |
| 親 element の text/value 置換 と子操作 | **非可換**。親側が子変更を潰しうる |

この表は XQuery Update の compatibility ルール、RFC 5261 の一意 target・逐次適用、そして現 repo の silent-overwrite / order-induced-miss テストを土台にした設計判断です。 citeturn35view0turn35view2turn34view2 fileciteturn11file0L3-L3

## TypeScript と Node.js での実装案

現 repo は Node 20 以上、TypeScript、`@xmldom/xmldom`、`xpath`、React/Vite という実装になっております。これ自体は **ローカル read-only 診断 CLI/UI** としてとても良い土台でして、今すぐ全部を引き剥がす必要はございません。まずは `scanner.ts` の抽出 IR と `patchTrace.ts` の replay 土台を活かしつつ、**sidecar provenance store** と **footprint analyzer** を足すのが最短距離です。 fileciteturn10file0L3-L3 fileciteturn12file0L3-L3

### 実装の層構造

おすすめは以下の五層です。

**parse 層**  
mod XML から `OperationIR` を作ります。現 `scanner.ts` はここをすでに実装しており、`xpath/path` 属性、payload kind、source line まで採れております。これはそのまま継続で結構です。 fileciteturn10file0L3-L3

**compile 層**  
XPath を `CompiledPathPlan` に変換します。common subset は自前 AST、unsupported は `GenericXPath` タグを付けて exact fallback に回します。

**state 層**  
`FileState` に `nodes, attrs, slotVersions, indexes, tombstones` を持たせます。

**diagnostics 層**  
replay しながら `effects`, `matchEvents`, `provenance`, `conflictCandidates`, `commutativityPairs` を蓄えます。

**presentation 層**  
いまの `context-pack` / HTML / React viewer を拡張し、**lineage graph**, **why miss?**, **pairwise order dependency**, **broad selector heatmap** を見せます。README にあるローカル viewer の思想と極めて相性が良いです。 fileciteturn5file0L3-L3

### 中核データ構造

```ts
type OpId = string;
type NodeId = string;
type SlotKey = string; // `${nodeId}/@value` or `${nodeId}/#text`

interface OperationIR {
  opId: OpId;
  modName: string;
  order: number;
  file: string;
  opcode:
    | "append" | "set" | "setattribute"
    | "remove" | "removeattribute"
    | "insertBefore" | "insertAfter" | "csv";
  rawXpath: string;
  sourceLine: number;
  attrs: Record<string, string>;
  payloadKind: "text" | "xml" | "target" | "empty" | "unknown";
  payloadText?: string;
}

interface NodeRecord {
  nodeId: NodeId;
  file: string;
  kind: "element" | "text" | "comment" | "pi";
  name?: string;
  parentId?: NodeId;
  ord: bigint;
  alive: boolean;
  birthOpId?: OpId;
  deathOpId?: OpId;
}

interface AttrRecord {
  attrId: string;
  ownerNodeId: NodeId;
  name: string;
  alive: boolean;
  birthOpId?: OpId;
  deathOpId?: OpId;
}

interface SlotVersion {
  versionId: string;
  slotKey: SlotKey;
  opId: OpId;
  before?: string;
  after?: string;
  live: boolean;
}

interface Footprint {
  readSig: string[];
  writeSlots: SlotKey[];
  writeStruct: string[];   // parent/anchor/delete-subtree signatures
  broadRiskFlags: string[];
}

interface Effect {
  opId: OpId;
  kind:
    | "setValue" | "setAttribute" | "removeAttribute"
    | "appendChild" | "appendAttributeText"
    | "removeNode" | "insertBefore" | "insertAfter"
    | "miss" | "unsupported";
  targetKey: string;
  before?: string;
  after?: string;
}
```

### replay algorithm の疑似コード

```ts
function diagnoseFile(vanillaXml: string, ops: OperationIR[], mode: "exact" | "fast"): FileDiagnosis {
  const state = buildLogicalTree(vanillaXml);
  const idx = buildIndexes(state);
  const out = new FileDiagnosis();

  const futureAdds = precomputeFutureAdds(ops);

  for (const op of sortByLoadOrder(ops)) {
    const plan = compileXPath(op.rawXpath, mode);
    const matches = evaluate(plan, state, idx, mode);

    const selectionDiag = diagnoseSelection(op, matches, state, futureAdds, out);
    out.recordSelection(op, selectionDiag);

    if (selectionDiag.stop) continue;

    const effects = applyOperation(op, matches, state);
    out.recordEffects(op, effects);

    updateProvenance(op, matches, effects, state);
    invalidateIndexes(idx, effects);
    updateFootprints(op, plan, effects, out);
  }

  out.conflicts = detectConflictsFromEffects(out.effects, out.provenance);
  out.commutativity = analyzePairwiseCommutativity(out.footprints, state, mode);
  return out;
}
```

### pairwise commutativity の疑似コード

```ts
function analyzePairwiseCommutativity(footprints: Map<OpId, Footprint>, state: FileState, mode: "exact" | "fast") {
  const result = [];

  for (const [a, b] of candidatePairs(footprints)) {
    const quick = classifyByFootprint(a, b, footprints.get(a)!, footprints.get(b)!);
    if (quick !== "unknown") {
      result.push({ a, b, classification: quick, confidence: "high" });
      continue;
    }

    if (mode === "fast") {
      result.push({ a, b, classification: "order-dependent-candidate", confidence: "medium" });
      continue;
    }

    const slice = extractMinimalRelevantSlice(state, a, b);
    const ab = replayTwoOps(slice.clone(), [a, b]);
    const ba = replayTwoOps(slice.clone(), [b, a]);

    result.push(compareReplayResults(a, b, ab, ba));
  }

  return result;
}
```

### exact mode と fast heuristic mode の切り分け

**exact mode** は、file ごとに本当に state を mutate し、supported subset は compiled evaluator、unsupported は generic XPath fallback で補うモードです。provenance・miss 原因・final value origin まで **説明責任を持って返す本番診断**はこちらです。現 repo の `buildPatchTrace` はこの方向の芽をすでに持っています。 fileciteturn8file0L3-L3

**fast heuristic mode** は、`candidate detection` を主目的にいたします。つまり全 operation に対し、XPath pattern、key predicate、有名 attr、delete/insert anchor、payload kind から footprint を作り、**順位づけされた警告候補**を返すモードです。unsupported XPath や `csv` には「unknown / low-confidence」を許可し、必要時にだけ exact mode へ昇格させます。Flux の path-error analysis や independence analysis 的な「効かなそう」「干渉しそう」を速く出す役目です。 citeturn24academia0turn24academia1

### Node.js のライブラリ選択

短期的には、現在使っている `@xmldom/xmldom` + `xpath` を維持しつつ、**自前 subset evaluator** を前段に置くのが最小変更です。中期的には、もし XPath/XQuery 側の introspection と profiling をもう少し欲しければ、`fontoxpath` は有力候補です。GitHub README によれば、これは pure JS の XPath 3.1 / XQuery 3.1 engine で、**DOM facade**, **nodesFactory**, **documentWriter**, **pendingUpdateList の分離実行**, **performance profiler** を持っています。あなた様のように「custom logical tree を持ちたいが、既存 XPath engine も使いたい」という場合、橋渡しがしやすい設計です。もっとも、7DTD 固有 patch DSL をそのまま実行できるわけではありませんから、**セマンティクスは自前、評価器は必要なら借りる**くらいの距離感がよろしいでしょう。 citeturn41view0turn42view0turn42view2

## 実装上の落とし穴

いちばん見落としやすいのは **whitespace text node** です。RFC 5261 は canonical form と whitespace text を明示的に重視しており、text node 同士の併合や remove 時の周辺 whitespace 処理まで規定しています。7DTD 側がそこまで厳密でない可能性はございますが、**内部 exact state では捨てず、診断表示の normalizer だけで丸める**のが安全です。ここを雑にいたしますと、`set` が element の `textContent` を潰すケースや、`remove` 後の canonical path のズレで、provenance が簡単に壊れます。 citeturn36view0turn36view1

次に、**「XPath 文字列」と「診断対象の identity」を混同しないこと**です。現在の `detectConflicts` は正規化 XPath を軸に winner を出す簡潔な方式で、MVP としてはとても良いのですが、将来的には ordinal を剥がしたり末尾 attribute step を削ったりする正規化が、逆に **異なる live target を一つに畳み過ぎる**危険もございます。最終的な truth は XPath ではなく **NodeId / SlotKey** に置き、XPath は「どうやってそこへ到達したか」の説明用に格下げすべきです。 fileciteturn6file0L3-L3

さらに、**multi-match を「危険」なのか「仕様上許容」なのかを分ける**ことも大切です。RFC 5261 は一意 target を要求しますが、XUpdate は node-set を前提にし、現 repo も broad match を `ambiguous` / `broad-match-risk` として trace に残します。したがって、7DTD セマンティクスに合わせるなら、**複数命中 = ただちにエラー**ではなく、**複数命中 = exact result と risk score の両方を返す**設計が実務的です。 citeturn34view0turn7view0 fileciteturn7file0L3-L3 fileciteturn11file0L3-L3

`csv` は現 repo でも未実装扱いですから、**最初から operation plugin 化**しておくのが宜しいです。`csv` だけ payload も write semantics も特殊になりやすいので、core engine に直埋めせず、`approximateFootprint()`, `exactApply()`, `summarizeProvenance()` を持つ `OperationHandler` 抽象で包むと後が楽になります。少なくとも最初の版では、`csv` は **unsupported / unknown / exact-only** のどれかに寄せて、誤診を避けるべきです。 fileciteturn8file0L3-L3 fileciteturn11file0L3-L3

### 開いたままの論点

IBM の commutativity 論文ページはこの環境では本文取得ができず、そのため **commutativity 節は XQUF の互換規則と周辺の静的解析研究から補っております**。また、7DTD 独自の `csv`、namespace の実挙動、`set` が element children をどう扱うかのゲーム側仕様、複数マッチ時の engine 挙動などは、最終実装前に **実ログと実 mod corpus** で一度詰める必要がございます。ここは不確かなままにせず、`semantics conformance tests` を先にお作りになるのが賢明です。

## 参考文献

- RFC 5261 XML Patch。逐次適用、一意 target、canonical/whitespace の扱い。 citeturn1view0turn34view2turn34view0turn36view0turn36view1
- XQuery Update Facility 1.0。pending update list、node identity、compatibility rules、child update の domination 例。 citeturn4view0turn35view0turn35view2turn37view2
- XUpdate Working Draft と XML.com overview。`insert-before/after`, `append`, `update`, `remove`, `rename` の古典的 update DSL。 citeturn7view0turn5view0
- XQuery and XPath Data Model 3.1。node identity、document order、node kind。 citeturn30view0turn31view1turn31view2turn31view4
- Foster, Green, Tannen, *Annotated XML: Queries and Provenance*。semiring provenance、XML shredding、XPath-to-Datalog 的見方。 citeturn3view0
- Bidoit-Tollu らの query-update independence、Cheney の Flux、Solimando らの automata-based analysis、Jacquemard & Rusinowitch の rewrite-based verification。静的候補検出、miss/path-error、更新安全性の文脈。 citeturn24academia0turn24academia1turn24academia2turn24academia3
- Chen の tree edit distance review と Nogler らの近年の結果。TED は補助的説明用途に留める、という判断の根拠です。 citeturn17view0turn17view2turn43view0turn43view1turn43view2
- 現リポジトリ `wakadorimk2/wasteland-launcher` の README / scanner / conflicts / patchTrace / tests / package。現在の実装地盤と、移行の現実性の確認に用いました。 fileciteturn5file0L3-L3 fileciteturn10file0L3-L3 fileciteturn6file0L3-L3 fileciteturn8file0L3-L3 fileciteturn11file0L3-L3 fileciteturn12file0L3-L3