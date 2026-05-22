# XML Patch Diagnostics Design Note

## Status

Accepted as the design direction, with Phase 1 through Phase 3 partially implemented. This note documents both the intended semantics and the current implementation boundaries for XML patch diagnostics.

## Context

`wasteland-launcher` inspects 7 Days to Die / MO2 workspaces without writing to MO2, the game install, a dedicated server, or a remote PC. XML patch diagnostics therefore need to explain likely patch interactions from available files while keeping analysis read-only and predictable.

The current implementation already extracts XML patch operations, derives static footprints, replays many operations against vanilla XML, and builds Phase 3 conflict groups for the React UI. The remaining design work is to keep the diagnostic model explicit so future implementation choices converge on the same semantics.

## Problem Model

Treat each XML file as an ordered labeled tree:

- Element nodes have a tag name, ordered child slots, attributes, and text.
- Attribute nodes are scalar slots on an element.
- Child order matters because XPath predicates and insertion operations can depend on it.

Treat each XML patch operation as a partial function:

```text
PatchOperation: Tree -> Tree | Miss | Unsupported | ParseError
```

The function is partial because an XPath may match no nodes, match too many nodes for a precise diagnostic, refer to unsupported operation semantics, or depend on XML that cannot be parsed.

Treat XPath as a query from a tree to a node set:

```text
XPath: Tree -> NodeSet
```

Mod load order is sequential composition over a vanilla tree:

```text
Tn = fn(...f2(f1(T0)))
```

Where `T0` is the vanilla XML file, and each `fi` is the patch operation at its MO2 order and patch-file order. Diagnostics should be phrased against this ordered execution model.

## Current Implementation

The current IR for scanned patches is `XmlPatchOperation[]` in `src/core/types.ts`. It captures mod identity, load order, target file, operation name, XPath/path, source line, attributes, and a summarized patch value.

`PatchTrace` in `src/core/types.ts` is the current exact replay trace shape. `buildPatchTrace` in `src/core/patchTrace.ts` groups operations by XML file, loads the vanilla file from `Data/Config`, evaluates XPath in `fast` or `exact` mode, applies supported operations to an in-memory DOM, and records targets, effects, status, diagnostic kind, and confidence.

`extractPatchFootprints` in `src/core/footprint.ts` is the current Phase 1 static approximation. It extracts read selectors, written scalar slots, removed node selectors, inserted child slots, and a supported / broad / unknown precision marker without changing the public context-pack schema.

`detectConflicts` in `src/core/conflicts.ts` now combines three sources. It prefers replay effect overlap, uses footprint overlap for fallback candidates, and keeps normalized XPath grouping as the final conservative fallback. `ContextPack.conflicts` is the primary input for the React conflict viewer. `ContextPack.trace` remains the evidence source used to explain replay status, effects, warnings, and confidence.

The current replay loop already contains the beginning of a provenance ledger:

- `previouslyRemoved` records canonical targets removed earlier in replay and supports `order-induced-miss`.
- `previousScalarWrites` records scalar writes and supports `silent-overwrite`.
- `futureAdds` records likely later structural additions and supports `dependency-order-miss`.

These sets should be treated as early, lightweight provenance state rather than as final conflict semantics.

The existing `fast` / `exact` trace modes are also a useful architectural entry point. `fast` can host static or indexed approximations, while `exact` should preserve DOM/XPath replay semantics when precision is needed.

The legacy standalone HTML report path has been retired. The React UI is the formal visualization surface for conflict groups, replay evidence, load order, and XML browsing.

Append operations need special treatment. Multiple `append` operations against the same parent child slot usually coexist because they add sibling XML rather than overwrite a scalar value. A scalar `set` and an `append` that share a parent slot are also not automatically a conflict unless replay or footprint evidence shows the same scalar target, a remove/write overlap, an anchored insert dependency, or another diagnostic condition. The React derived model therefore suppresses plain append coexistence from review.

The review set should still include:

- `remove` operations that mask later operations or overlap with writes.
- Anchored `insertbefore` / `insertafter` operations, because order and target existence matter.
- Multiple writes to the same scalar slot.
- Replay diagnostics such as `order-induced-miss`, `dependency-order-miss`, `broad-match-risk`, `unsupported-operation`, and parse errors.

## Recommended Theory

Use exact replay as the executable semantics. If a diagnostic depends on whether an XPath matches after earlier patches have run, the authoritative answer should come from replaying operations over the current in-memory XML tree.

Use footprint analysis as abstract interpretation. `PatchFootprint` conservatively describes what an operation may read, write, insert, or delete without executing the full patch. The footprint can be broad or uncertain, but it must not pretend to be exact when the XPath or operation is outside the supported subset.

Use provenance as an event ledger plus last-writer state, not as a full historical tree. The useful questions are usually:

- Which operation last wrote this scalar slot?
- Which operation removed this node or ancestor?
- Which operation inserted a node that a later XPath matched?
- Which operations touched overlapping structural slots?

Represent these as operation effects and keyed ledgers. Avoid storing full tree snapshots unless a specific diagnostic requires them.

Over time, prefer stable target keys over XPath strings as the conflict truth. XPath text is an input expression; it is not a durable identity. Future diagnostics should converge on:

- `NodeId` for concrete replay nodes.
- `SlotKey` for attribute slots, text slots, and parent/child insertion positions.
- Operation effect logs for writes, removals, and insertions.

XPath strings can remain part of the user-facing explanation, but they should not be the primary key for conflict detection once better target keys are available.

## Diagnostic Confidence

Diagnostics should use three-valued reasoning:

- `yes`: the replay or footprint proves the interaction.
- `no`: the replay or footprint proves no relevant interaction in the supported model.
- `unknown`: unsupported XPath, broad match, missing vanilla XML, parse failure, timeout, or an intentionally conservative approximation prevents a definitive answer.

This maps naturally to the existing `confidence` field on `PatchTrace`, but the implementation should avoid reducing uncertainty to a false positive or false negative.

## Adopt

Adopt footprint analysis as the low-risk fallback layer. It is static, read-only, and conservative, producing a `PatchFootprint` from `XmlPatchOperation` without changing the public context-pack schema.

Adopt lightweight provenance. Extend replay internals around an event ledger and last-writer maps instead of building a full versioned XML tree.

Adopt an operation effect log as the shared substrate between replay, conflict detection, and UI explanation. The existing `PatchTraceEffect` is the starting point, and the React viewer already joins conflict groups to trace effects for its evidence pane.

Adopt three-valued diagnostics for new analysis. New checks should explicitly distinguish proven, disproven, and unknown interactions.

## Defer

Defer a full logical tree with stable tombstones. It may become useful for explaining removed nodes and historical identities, but the current replay ledger can answer the immediate questions with lower complexity.

Defer pairwise commutativity replay for every operation pair. It is expensive and should only be used for narrow, high-value cases after footprint filtering identifies likely interactions.

Defer fontoxpath validation. The current `xpath` package and simple fast path are sufficient for the present diagnostics; validating a second XPath engine can wait until XPath compatibility becomes a measured problem.

Defer public JSON schema changes until internal traces and conflict grouping require them. The React UI may continue to adjust its derived display model without changing `ContextPack`.

## Reject For Now

Reject turning the project into a full XML database. The tool is a local diagnostic assistant, not a general XML storage/query engine.

Reject global tree edit distance as the basis for conflict diagnostics. It is too broad, too expensive, and poorly aligned with authored patch operations.

Reject automatic compatibility patch generation for now. The project should first explain risks and provenance clearly; writing patches crosses a higher safety boundary.

## Future Implementation Path

### Phase 1: Static Footprint Extraction

Status: implemented as an internal extractor in `src/core/footprint.ts`.

Add an internal `PatchFootprint` extractor for `XmlPatchOperation`.

Expected fields:

- File key.
- Read selectors.
- Written scalar slots.
- Removed node selectors.
- Inserted child slots.
- Confidence or precision marker.

Use this to enrich diagnostics and prefilter potential conflicts, but keep `detectConflicts` output unchanged until the model is proven against tests.

### Phase 2: Stable Replay Target Keys

Status: partially implemented through canonical replay targets, replay effects, and lightweight provenance; full stable `NodeId` / `SlotKey` internals remain future work.

Extend replay internals so each selected DOM node receives a stable target key for the life of one replay.

Track:

- Last writer per scalar `SlotKey`.
- Remover per `NodeId` or removed subtree key.
- Inserter per created `NodeId`.
- Parent/child slot effects for append and insert operations.

The current `PatchTrace` can keep exposing canonical XPath-like strings while internals move to stronger keys.

### Phase 3: Effect-Based Conflict Detection

Status: partially implemented. `detectConflicts` prefers replay effect overlap, then footprint overlap, then normalized XPath fallback. The React UI consumes `ContextPack.conflicts` as its main conflict source.

Move conflict detection from normalized XPath grouping to footprint/effect overlap.

The first replacement should keep the existing cheap detector as a fallback and add higher-confidence groups when replay effects prove that operations touch the same target or dependent structural slots. Append-only coexistence should remain suppressed in UI review unless another diagnostic makes it reviewable.

### Phase 4: Logical Tree And Tombstones If Needed

Introduce a logical tree with tombstones only if provenance questions cannot be answered by event logs and last-writer maps.

Use this only for concrete needs such as explaining a later miss caused by an earlier removal when the removed node no longer exists in the replay DOM.

## Existing Code Mapping

| Concept | Current location | Notes |
| --- | --- | --- |
| Patch IR | `XmlPatchOperation` in `src/core/types.ts` | Keep as the scanned operation shape. |
| Replay trace | `PatchTrace` in `src/core/types.ts` | Current public trace object for context packs and UI. |
| Replay engine | `buildPatchTrace` in `src/core/patchTrace.ts` | Treat as executable semantics for supported operations. |
| Conflict detector | `detectConflicts` in `src/core/conflicts.ts` | Replay effect groups first, footprint fallback second, normalized XPath fallback last. |
| Footprint extractor | `extractPatchFootprints` in `src/core/footprint.ts` | Static conservative approximation for fallback grouping. |
| React viewer | `ui/src/model.ts` and `ui/src/main.tsx` | Uses `ContextPack.conflicts` first and joins `ContextPack.trace` for evidence. |
| Replay modes | `TraceOptions.mode` in `src/core/patchTrace.ts` | `fast` for indexed/simple paths, `exact` for generic XPath replay. |
| Early provenance state | `previouslyRemoved`, `previousScalarWrites`, `futureAdds` in `src/core/patchTrace.ts` | Evolve into event ledger and last-writer maps. |

## References

- Patrick Cousot and Radhia Cousot, "Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints", 1977.
- W3C, "XML Path Language (XPath) 1.0", 1999.
- W3C, "Document Object Model (DOM) Level 2 Core Specification", 2000.
- Microsoft, "XML Document Transform (XDT) Syntax", for a practical example of patch-like XML transformation semantics.
