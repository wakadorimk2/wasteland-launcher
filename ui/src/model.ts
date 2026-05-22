import type { ConflictCategory, ConflictKind, ContextPack, PatchTrace, Risk, UiAttr, UiConflictEvidence, UiModel, UiNode, UiXmlFile } from "./types";

export const conflictKinds: Record<ConflictKind, { label: string; risk: Risk; desc: string }> = {
  "xpath-miss": { label: "XPath miss", risk: "critical", desc: "The patch XPath matched no current target." },
  "order-induced-miss": { label: "Order-induced miss", risk: "critical", desc: "An earlier patch removed a target used later." },
  "dependency-order-miss": { label: "Dependency-order miss", risk: "warn", desc: "A patch appears to reference a target that is added later." },
  "silent-overwrite": { label: "Silent overwrite", risk: "danger", desc: "A later scalar write hides an earlier write on the same canonical target." },
  "structural-mask": { label: "Structural mask", risk: "warn", desc: "A structural operation hides or removes another change." },
  "slot-order-dependent": { label: "Slot order dependency", risk: "warn", desc: "A scalar slot is changed by non-commuting operations." },
  "sibling-order-dependent": { label: "Sibling order dependency", risk: "warn", desc: "Structural inserts share a parent or anchor, so sibling order matters." },
  "broad-match-risk": { label: "Broad selector", risk: "warn", desc: "The XPath matched multiple targets." },
  "unsupported-operation": { label: "Unsupported op", risk: "info", desc: "The patch is inventoried but not replayed in v0.2." },
  "parse-error": { label: "Parse error", risk: "critical", desc: "The patch or vanilla XML could not be parsed." },
  "ambiguous-target": { label: "Ambiguous target", risk: "warn", desc: "The patch matched more targets than expected." },
  "unknown-risk": { label: "Unknown risk", risk: "info", desc: "The engine found conservative evidence but could not prove the target." },
  ok: { label: "Applied", risk: "safe", desc: "The replayed patch has no diagnostic warning." }
};

const samplePack: ContextPack = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  scan: {
    mo2Path: "sample://MO2",
    profile: "Sample",
    modlistPath: "sample://profiles/Sample/modlist.txt",
    entries: [
      { raw: "+AlphaEconomy", name: "AlphaEconomy", state: "enabled", line: 1, order: 1 },
      { raw: "+RemoveBaseItems", name: "RemoveBaseItems", state: "enabled", line: 2, order: 2 },
      { raw: "+LateDependency", name: "LateDependency", state: "enabled", line: 3, order: 3 },
      { raw: "+zzz_MyTweaks", name: "zzz_MyTweaks", state: "enabled", line: 4, order: 4 }
    ],
    enabledMods: [
      { mo2Name: "AlphaEconomy", displayName: "Alpha Economy", rootPath: "", modInfoPath: "", order: 1 },
      { mo2Name: "RemoveBaseItems", displayName: "Remove Base Items", rootPath: "", modInfoPath: "", order: 2 },
      { mo2Name: "LateDependency", displayName: "Late Dependency", rootPath: "", modInfoPath: "", order: 3 },
      { mo2Name: "zzz_MyTweaks", displayName: "My Tweaks", rootPath: "", modInfoPath: "", order: 4 }
    ],
    missingEnabledMods: [],
    xmlPatches: [
      op("AlphaEconomy", 1, "items.xml", "/items/item[@name='coin']/property[@name='EconomicValue']/@value", "set", 10, "120"),
      op("zzz_MyTweaks", 4, "items.xml", "/items/item[@name='coin']/property[@name='EconomicValue']/@value", "set", 18, "80"),
      op("RemoveBaseItems", 2, "items.xml", "/items/item[@name='oldCoin']", "remove", 20),
      op("zzz_MyTweaks", 4, "items.xml", "/items/item[@name='oldCoin']/property[@name='EconomicValue']/@value", "set", 21, "5"),
      op("AlphaEconomy", 1, "items.xml", "/items/item[@name='futureCoin']/@value", "set", 22, "2"),
      op("LateDependency", 3, "items.xml", "/items", "append", 23, "<item name=\"futureCoin\" value=\"1\"/>", "xml", "<item futureCoin>"),
      op("AlphaEconomy", 1, "items.xml", "/items/item", "setattribute", 24, "checked", "text", "checked", { name: "tag", value: "checked" }),
      op("AlphaEconomy", 1, "loot.xml", "/lootcontainers/lootgroup[@name='ammo']", "csv", 30, "ammoBullet,10")
    ],
    dlls: [],
    warnings: []
  },
  trace: [],
  diagnosticGroups: [],
  operationsById: {},
  modsById: {},
  filesById: {},
  replayEvidenceByGroupId: {},
  coverage: { totalOperations: 0, candidateOperations: 0, replayedOperations: 0, partialOperations: 0, skippedOperations: 0, candidateGroups: 0, exactGroups: 0, footprintGroups: 0, fallbackGroups: 0, budgetGroups: 0, warnings: [] },
  logs: { warnings: [] }
};

samplePack.trace = [
  trace(samplePack.scan.xmlPatches[0], "applied", "ok", [target("/items/item[@name='coin']/property[@name='EconomicValue']/@value", "attribute", "100")], [{ kind: "setAttribute", target: "/items/item[@name='coin']/property[@name='EconomicValue']/@value", before: "100", after: "120", value: "120" }]),
  trace(samplePack.scan.xmlPatches[1], "applied", "silent-overwrite", [target("/items/item[@name='coin']/property[@name='EconomicValue']/@value", "attribute", "120")], [{ kind: "setAttribute", target: "/items/item[@name='coin']/property[@name='EconomicValue']/@value", before: "120", after: "80", value: "80" }]),
  trace(samplePack.scan.xmlPatches[2], "applied", "ok", [target("/items/item[@name='oldCoin']", "element")], [{ kind: "removeNode", target: "/items/item[@name='oldCoin']", before: "<item name=\"oldCoin\"/>" }]),
  trace(samplePack.scan.xmlPatches[3], "missed", "order-induced-miss", [], [{ kind: "miss", target: "/items/item[@name='oldCoin']/property[@name='EconomicValue']/@value", summary: "order-induced-miss" }]),
  trace(samplePack.scan.xmlPatches[4], "missed", "dependency-order-miss", [], [{ kind: "miss", target: "/items/item[@name='futureCoin']/@value", summary: "dependency-order-miss" }]),
  trace(samplePack.scan.xmlPatches[5], "applied", "ok", [target("/items", "element")], [{ kind: "appendChild", target: "/items", value: "<item futureCoin>", summary: "1 child node(s)" }]),
  trace(samplePack.scan.xmlPatches[6], "ambiguous", "broad-match-risk", [target("/items/item[@name='coin']", "element"), target("/items/item[@name='oldCoin']", "element")], [{ kind: "setAttribute", target: "/items/item[@name='coin']/@tag", before: undefined, after: "checked", value: "checked" }], 2),
  trace(samplePack.scan.xmlPatches[7], "unsupported", "unsupported-operation", [], [{ kind: "unsupported", target: "/lootcontainers/lootgroup[@name='ammo']", summary: "csv replay is not implemented in v0.2" }])
];

samplePack.operationsById = Object.fromEntries(samplePack.scan.xmlPatches.map((operation) => [operationKey(operation), operation]));
samplePack.modsById = Object.fromEntries(samplePack.scan.enabledMods.map((mod) => [mod.mo2Name, mod]));
samplePack.filesById = {
  "items.xml": { path: "items.xml", operationIds: samplePack.scan.xmlPatches.filter((operation) => operation.file === "items.xml").map(operationKey), modIds: ["AlphaEconomy", "RemoveBaseItems", "LateDependency", "zzz_MyTweaks"] },
  "loot.xml": { path: "loot.xml", operationIds: samplePack.scan.xmlPatches.filter((operation) => operation.file === "loot.xml").map(operationKey), modIds: ["AlphaEconomy"] }
};
samplePack.diagnosticGroups = [
  {
    id: "dg1",
    file: "items.xml",
    kind: "silent-overwrite",
    classification: "silent-overwrite",
    risk: "danger",
    confidence: "proven",
    proof: "exact",
    targetKey: "attr:sample:value",
    displayTarget: "/items/item[@name='coin']/property[@name='EconomicValue']/@value",
    operationIds: [operationKey(samplePack.scan.xmlPatches[0]), operationKey(samplePack.scan.xmlPatches[1])],
    primaryOpId: operationKey(samplePack.scan.xmlPatches[1]),
    relatedOpIds: [operationKey(samplePack.scan.xmlPatches[0])],
    source: "replay",
    orderDependent: true,
    normalizedXpath: "/items/item[@name='coin']/property[@name='EconomicValue']/@value",
  },
  {
    id: "dg2",
    file: "items.xml",
    kind: "order-induced-miss",
    classification: "order-induced-miss",
    risk: "critical",
    confidence: "proven",
    proof: "exact",
    targetKey: "miss:items.xml:/items/item[@name='oldCoin']/property[@name='EconomicValue']/@value",
    displayTarget: "/items/item[@name='oldCoin']/property[@name='EconomicValue']/@value",
    operationIds: [operationKey(samplePack.scan.xmlPatches[2]), operationKey(samplePack.scan.xmlPatches[3])],
    primaryOpId: operationKey(samplePack.scan.xmlPatches[3]),
    relatedOpIds: [operationKey(samplePack.scan.xmlPatches[2])],
    source: "replay",
    orderDependent: true,
    normalizedXpath: "/items/item[@name='oldCoin']/property[@name='EconomicValue']/@value",
  },
  {
    id: "dg3",
    file: "items.xml",
    kind: "dependency-order-miss",
    classification: "dependency-order-miss",
    risk: "warn",
    confidence: "likely",
    proof: "fallback",
    targetKey: "miss:items.xml:/items/item[@name='futureCoin']/@value",
    displayTarget: "/items/item[@name='futureCoin']/@value",
    operationIds: [operationKey(samplePack.scan.xmlPatches[4]), operationKey(samplePack.scan.xmlPatches[5])],
    primaryOpId: operationKey(samplePack.scan.xmlPatches[5]),
    relatedOpIds: [operationKey(samplePack.scan.xmlPatches[4])],
    source: "replay",
    orderDependent: true,
    normalizedXpath: "/items/item[@name='futureCoin']/@value",
  }
];
samplePack.coverage = { totalOperations: samplePack.scan.xmlPatches.length, candidateOperations: 6, replayedOperations: samplePack.trace.length, partialOperations: 0, skippedOperations: 0, candidateGroups: samplePack.diagnosticGroups.length, exactGroups: 2, footprintGroups: 0, fallbackGroups: 1, budgetGroups: 0, warnings: [] };

function op(modName: string, order: number, file: string, xpath: string, operation: string, line: number, valueText?: string, valueKind: "text" | "xml" | "target" | "empty" | "unknown" = valueText == null ? "target" : "text", valueSummary = valueText, attributes?: Record<string, string>) {
  return { modName, displayName: modName, order, file, path: xpath, operation, xpath, line, valueText, valueKind, valueSummary, attributes };
}

function trace(operation: ContextPack["scan"]["xmlPatches"][number], status: PatchTrace["status"], diagnosticKind: ConflictKind, affectedTargets: PatchTrace["affectedTargets"], effects: PatchTrace["effects"], matchCountBefore = affectedTargets.length): PatchTrace {
  return { id: `${operation.file}:${operation.line}`, modName: operation.modName, displayName: operation.displayName, order: operation.order, file: operation.file, path: operation.path, line: operation.line, operation: operation.operation, xpath: operation.xpath, status, matchCountBefore, affectedTargets, effects, confidence: "high", diagnosticKind };
}

function target(canonical: string, kind: "element" | "attribute", value?: string) {
  return { canonical, nodeRef: canonical.replace(/\/@[\w.-]+$/, ""), kind, value };
}

export function buildSampleModel(): UiModel {
  return buildUiModel(samplePack, "sample");
}

export function buildUiModel(pack: ContextPack, source: UiModel["source"] = "context"): UiModel {
  const traces = pack.trace ?? [];
  const patchesByMod = groupBy(pack.scan.xmlPatches, (patch) => patch.modName);
  const patchesByFile = groupBy(pack.scan.xmlPatches, (patch) => patch.file);
  const tracesByFile = groupBy(traces, (item) => item.file);
  const conflictGroups = pack.diagnosticGroups;
  const traceIndex = buildTraceIndex(traces);
  const operationsById = pack.operationsById ?? Object.fromEntries(pack.scan.xmlPatches.map((operation) => [operationKey(operation), operation]));
  const rootsByMod = groupBy(pack.scan.enabledMods, (mod) => mod.mo2Name);
  const seenRoots = new Set<string>();
  const mods = pack.scan.entries
    .filter((entry) => entry.state !== "separator")
    .flatMap((entry, index) => {
      const sortOrder = index;
      if (entry.state === "disabled") return [entryToMod(entry.name, false, entry.order ?? -1, sortOrder, entry.line, "disabled in modlist")];
      const roots = rootsByMod.get(entry.name) ?? [];
      if (roots.length === 0) return [entryToMod(entry.name, true, entry.order ?? sortOrder, sortOrder, entry.line, "enabled in modlist, but folder or ModInfo.xml was not found", true)];
      roots.forEach((mod) => seenRoots.add(rootKey(mod)));
      return [rootToMod(roots[0], patchesByMod.get(entry.name) ?? [], sortOrder, entry.line)];
    });

  for (const mod of pack.scan.enabledMods) {
    if (!seenRoots.has(rootKey(mod))) mods.push(rootToMod(mod, patchesByMod.get(mod.mo2Name) ?? [], pack.scan.entries.length + mods.length, undefined));
  }
  mods.sort((a, b) => a.sortOrder - b.sortOrder || a.order - b.order || a.folder.localeCompare(b.folder));

  const rows = conflictGroups.length > 0 ? buildConflictGroupRows(conflictGroups, operationsById, traceIndex) : buildReviewRows(traces);
  const rowsByFile = groupBy(rows, (row) => row.file);

  const xmlFiles: UiXmlFile[] = [...patchesByFile.entries()].map(([file, patches]) => {
    const fileTraces = tracesByFile.get(file) ?? [];
    const fileRows = rowsByFile.get(file) ?? [];
    const missCount = fileTraces.filter((item) => /miss/.test(item.diagnosticKind)).length;
    return {
      path: file,
      patches: patches.length,
      touchingMods: [...new Set(patches.map((patch) => patch.modName))].sort(),
      conflicts: fileRows.length || (conflictGroups.length === 0 ? fileTraces.filter((item) => item.diagnosticKind !== "ok").length : 0),
      missing: missCount,
      risk: fileRows.length > 0 ? highestRisk(fileRows.map((row) => row.risk)) : riskForDiagnostics(fileTraces)
    };
  }).sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || b.conflicts - a.conflicts || b.patches - a.patches || a.path.localeCompare(b.path));

  const conflicts = rows.map((row, index) => ({
    id: `c${index + 1}`,
    file: row.file,
    node: row.xpath,
    target: row.xpath,
    exact: row.exact ?? true,
    proof: row.proof,
    winner: row.winner ?? "(unknown)",
    operations: row.operations ?? [],
    evidence: row.evidence ?? [],
    sourceLabel: row.sourceLabel ?? "Trace-derived fallback",
    category: row.category,
    finalKind: row.finalKind,
    kind: row.kind,
    risk: row.risk,
    mods: [...new Set(row.history.map((history) => history.mod))],
    final: row.final,
    summary: row.note
  }));

  return {
    source,
    generatedAt: pack.generatedAt,
    mo2Path: pack.scan.mo2Path,
    profile: pack.scan.profile,
    mods,
    xmlFiles,
    xmlTree: buildTree(rows),
    conflicts,
    stats: {
      modsLoaded: mods.length,
      modsEnabled: mods.filter((mod) => mod.enabled).length,
      xmlFiles: xmlFiles.length,
      totalPatches: pack.scan.xmlPatches.length,
      warnings: pack.scan.warnings.length + pack.logs.warnings.length,
      conflicts: rows.length || (conflictGroups.length === 0 ? traces.filter((item) => item.diagnosticKind !== "ok").length : 0),
      exactDiagnosticGroups: rows.filter((row) => row.exact !== false).length,
      fallbackDiagnosticGroups: rows.filter((row) => row.exact === false).length,
      replayWarnings: traces.filter((item) => item.diagnosticKind !== "ok").length,
      missingXPath: traces.filter((item) => /miss/.test(item.diagnosticKind)).length,
      loadOrderDependent: traces.filter((item) => item.diagnosticKind === "order-induced-miss" || item.diagnosticKind === "dependency-order-miss").length,
      safeChanges: traces.filter((item) => item.diagnosticKind === "ok").length
    },
    conflictCounts: countConflictCategories(rows.map((row) => row.category))
  };
}

interface ReviewRow {
  file: string;
  xpath: string;
  searchText?: string;
  isSummary?: boolean;
  exact?: boolean;
  proof?: ContextPack["diagnosticGroups"][number]["proof"];
  sourceLabel?: string;
  operations?: ContextPack["scan"]["xmlPatches"];
  evidence?: UiConflictEvidence[];
  category: ConflictCategory;
  kind: ConflictKind;
  risk: Risk;
  final: string | null;
  finalKind: "final" | "candidate" | "status";
  vanilla: string | null;
  history: UiAttr["history"];
  winner?: string;
  note: string;
}

function buildConflictGroupRows(groups: ContextPack["diagnosticGroups"], operationsById: ContextPack["operationsById"], traceIndex: Map<string, PatchTrace>): ReviewRow[] {
  const detailRows = groups.flatMap((group) => {
    if (!isReviewableConflictGroup(group, traceIndex)) return [];
    const operations = group.operationIds.map((opId) => operationsById[opId]).filter((operation): operation is ContextPack["scan"]["xmlPatches"][number] => Boolean(operation)).sort(compareOperation);
    const evidence = operations.map((operation) => operationEvidence(operation, traceIndex));
    const traces = evidence.map((item) => item.trace).filter((item): item is PatchTrace => Boolean(item));
    const historyOperations = operations.filter((operation) => traceIndex.get(operationKey(operation))?.status !== "partial");
    const category = categoryForGroup(operations, traces);
    const kind = group.kind ?? worstKind(traces.length > 0 ? traces : operations.map(operationToPseudoTrace));
    const winner = operationsById[group.primaryOpId] ?? operations[operations.length - 1];
    const final = finalValueForOperation(winner, traces.find((trace) => operationKey(trace) === operationKey(winner)));
    const target = group.displayTarget ?? group.normalizedXpath;
    const risk = riskForConflictGroup(group, traceIndex);
    const finalKind: ReviewRow["finalKind"] = category === "value" ? "final" : "status";
    return [{
      file: group.file,
      xpath: target,
      exact: group.proof === "exact",
      proof: group.proof,
      sourceLabel: sourceLabelForProof(group.proof, traces),
      operations,
      evidence: aggregatePartialEvidence(evidence.map(({ trace: _trace, ...item }) => item)),
      category,
      kind,
      risk,
      final,
      finalKind,
      vanilla: firstVanillaValue(traces),
      history: (historyOperations.length > 0 ? historyOperations : operations.filter((operation) => !traceIndex.has(operationKey(operation)))).map((operation) => operationToHistory(operation, traceIndex)),
      winner: winner.modName,
      note: explainConflictGroup(group, traces, category)
    }];
  }).sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.file.localeCompare(b.file) || a.xpath.localeCompare(b.xpath));
  return [...buildItemSummaryRows(detailRows), ...detailRows];
}

function buildItemSummaryRows(rows: ReviewRow[]): ReviewRow[] {
  const candidates = rows.filter((row) => row.file === "items.xml").map((row) => {
    const itemName = itemNameForTarget(row.xpath);
    if (!itemName) return undefined;
    return { row, itemName, itemCategory: itemCategoryForName(itemName), changeKind: changeKindForTarget(row.xpath) };
  }).filter((item): item is { row: ReviewRow; itemName: string; itemCategory: string; changeKind: string } => Boolean(item));
  const summaries: ReviewRow[] = [];
  for (const [key, entries] of groupBy(candidates, (item) => `${item.row.file}\0${item.itemCategory}\0${item.changeKind}`).entries()) {
    if (entries.length < 2) continue;
    const [file, itemCategory, changeKind] = key.split("\0");
    const memberRows = entries.map((entry) => entry.row);
    const operations = memberRows.flatMap((row) => row.operations ?? []);
    const risk = highestRisk(memberRows.map((row) => row.risk));
    const category = summarizeCategory(memberRows.map((row) => row.category));
    const kind = highestRiskKind(memberRows.map((row) => row.kind));
    const modCounts = countByValues(operations.map((operation) => operation.modName));
    const targetCounts = countByValues(entries.map((entry) => entry.itemName));
    const topMods = topCounts(modCounts, 5);
    const topTargets = topCounts(targetCounts, 8);
    const groupCount = memberRows.length;
    const operationCount = operations.length;
    summaries.push({
      file,
      xpath: `${itemCategory} / ${changeKind}`,
      searchText: [itemCategory, changeKind, ...memberRows.map((row) => row.xpath), ...topMods.map((item) => item.name), ...topTargets.map((item) => item.name)].join(" "),
      isSummary: true,
      exact: memberRows.every((row) => row.exact !== false),
      proof: memberRows.some((row) => row.proof === "partial") ? "partial" : memberRows.every((row) => row.proof === "exact") ? "exact" : "fallback",
      sourceLabel: "UI summary from diagnostic groups",
      operations,
      evidence: [{
        operationKey: `summary\0${file}\0${itemCategory}\0${changeKind}`,
        status: undefined,
        diagnosticKind: kind,
        confidence: "low",
        message: `${groupCount} groups / ${operationCount} operations. Top mods: ${formatCounts(topMods)}. Top targets: ${formatCounts(topTargets)}.`,
        effects: [],
        affectedTargets: []
      }],
      category,
      kind,
      risk,
      final: `${groupCount} groups / ${operationCount} operations`,
      finalKind: "status",
      vanilla: null,
      history: topMods.map((item, index) => ({
        mod: item.name,
        order: index + 1,
        op: "summary",
        value: `${item.count} operations`,
        authored: `${groupCount} groups total`
      })),
      winner: topMods[0]?.name,
      note: `Summary only. Individual diagnostic groups remain below. Top targets: ${formatCounts(topTargets)}.`
    });
  }
  return summaries.sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.file.localeCompare(b.file) || a.xpath.localeCompare(b.xpath));
}

function aggregatePartialEvidence(evidence: UiConflictEvidence[]): UiConflictEvidence[] {
  const partial = evidence.filter((item) => item.status === "partial");
  if (partial.length === 0) return evidence;
  return [
    ...evidence.filter((item) => item.status !== "partial"),
    {
      operationKey: `budget-partial\0${partial.length}`,
      status: "partial",
      diagnosticKind: "unsupported-operation",
      confidence: "low",
      message: `Budget partial: ${partial.length} operations`,
      effects: [],
      affectedTargets: []
    }
  ];
}

function isReviewableConflictGroup(group: ContextPack["diagnosticGroups"][number], _traceIndex: Map<string, PatchTrace>): boolean {
  if (group.kind !== "ok") return true;
  return group.risk !== "info";
}

function hasScalarCollision(operations: ContextPack["scan"]["xmlPatches"], traces: PatchTrace[]): boolean {
  const tracedTargets = traces.flatMap((trace) => trace.effects.filter((effect) => isScalarEffect(effect.kind) && effect.kind !== "miss" && effect.kind !== "unsupported").map((effect) => effect.target));
  if (hasDuplicate(tracedTargets)) return true;
  const operationTargets = operations.filter((operation) => isScalarOperation(operation.operation)).map((operation) => operation.xpath);
  return hasDuplicate(operationTargets);
}

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function isAppendOperation(operation: string): boolean {
  return operation.toLowerCase() === "append";
}

function isAnchoredInsertOperation(operation: string): boolean {
  const lower = operation.toLowerCase();
  return lower === "insertbefore" || lower === "insertafter";
}

function isRemoveOperation(operation: string): boolean {
  return operation.toLowerCase().includes("remove");
}

function isScalarOperation(operation: string): boolean {
  const lower = operation.toLowerCase();
  return lower === "set" || lower === "setattribute" || lower === "removeattribute" || lower === "csv";
}

function operationEvidence(operation: ContextPack["scan"]["xmlPatches"][number], traceIndex: Map<string, PatchTrace>): UiConflictEvidence & { trace?: PatchTrace } {
  const key = operationKey(operation);
  const trace = traceIndex.get(key);
  return {
    operationKey: key,
    status: trace?.status,
    diagnosticKind: trace?.diagnosticKind,
    confidence: trace?.confidence,
    message: trace?.message,
    effects: trace?.effects ?? [],
    affectedTargets: trace?.affectedTargets ?? [],
    trace
  };
}

function operationToHistory(operation: ContextPack["scan"]["xmlPatches"][number], traceIndex: Map<string, PatchTrace>): UiAttr["history"][number] {
  const trace = traceIndex.get(operationKey(operation));
  if (trace) return traceToHistory(trace);
  return {
    mod: operation.modName,
    order: operation.order,
    op: operation.operation,
    value: operation.valueSummary ?? operation.valueText ?? operation.xpath,
    authored: operation.valueSummary ?? operation.valueText,
    error: undefined
  };
}

function finalValueForOperation(operation: ContextPack["scan"]["xmlPatches"][number], trace: PatchTrace | undefined): string | null {
  const effect = trace?.effects.find((item) => item.after != null || item.value != null || item.summary != null);
  return effect?.after ?? effect?.value ?? effect?.summary ?? operation.valueSummary ?? operation.valueText ?? operation.operation ?? null;
}

function firstVanillaValue(traces: PatchTrace[]): string | null {
  return traces.flatMap((trace) => trace.effects).find((effect) => effect.before != null)?.before ?? null;
}

function categoryForGroup(operations: ContextPack["scan"]["xmlPatches"], traces: PatchTrace[]): ConflictCategory {
  const effects = traces.flatMap((trace) => trace.effects.map((effect) => effect.kind));
  const opNames = operations.map((operation) => operation.operation.toLowerCase());
  const hasScalar = effects.some(isScalarEffect) || opNames.some((opName) => /set|attribute|csv/.test(opName));
  const hasStructural = effects.some(isStructuralEffect) || opNames.some((opName) => /append|insert|remove/.test(opName));
  if (hasScalar && hasStructural) return "mixed";
  return hasStructural ? "structural" : "value";
}

function riskForConflictGroup(group: ContextPack["diagnosticGroups"][number], traceIndex: Map<string, PatchTrace>): Risk {
  if (group.risk) return group.risk;
  const traces = group.operationIds.map((opId) => traceIndex.get(opId)).filter((item): item is PatchTrace => Boolean(item));
  const traceRisk = riskForDiagnostics(traces);
  if (traceRisk === "critical") return "critical";
  if (traces.some((trace) => trace.diagnosticKind === "unsupported-operation") && group.proof !== "exact") return "info";
  if (group.proof !== "exact") return "warn";
  if (traces.some((trace) => trace.effects.some((effect) => effect.kind === "removeNode" || effect.kind === "miss"))) return "critical";
  const scalarWrites = traces.filter((trace) => trace.effects.some((effect) => isScalarEffect(effect.kind) && effect.kind !== "miss" && effect.kind !== "unsupported"));
  if (scalarWrites.length > 1) return "danger";
  const category = traces.some((trace) => trace.effects.some((effect) => isStructuralEffect(effect.kind))) ? "structural" : "value";
  if (category === "structural") return "warn";
  return traceRisk === "safe" ? "danger" : traceRisk;
}

function sourceLabelForProof(proof: ContextPack["diagnosticGroups"][number]["proof"], traces: PatchTrace[]): string {
  if (proof === "exact") return "Targeted exact replay";
  if (proof === "footprint") return "Footprint candidate analysis";
  if (proof === "partial") return "Budget-limited partial evidence";
  return sourceForFallback(traces);
}

function sourceForFallback(traces: PatchTrace[]): string {
  if (traces.some((trace) => trace.status === "missed")) return "Trace miss fallback";
  if (traces.some((trace) => trace.status === "unsupported")) return "Unsupported replay fallback";
  if (traces.some((trace) => trace.status === "parseError")) return "Parse-error fallback";
  return "Footprint / normalized XPath fallback";
}

function explainConflictGroup(group: ContextPack["diagnosticGroups"][number], traces: PatchTrace[], category: ConflictCategory): string {
  if (group.classification) return `${group.classification}; confidence ${group.confidence ?? "unknown"}; proof ${group.proof}; target ${group.displayTarget ?? group.normalizedXpath}.`;
  if (group.proof === "exact") return `Targeted replay proved these operations touch ${group.normalizedXpath}.`;
  if (traces.some((trace) => trace.status === "missed")) return "Replay could not match at least one operation, so this group uses miss evidence plus conservative fallback grouping.";
  if (traces.some((trace) => trace.status === "unsupported")) return "At least one operation is not replay-supported, so this group is shown from conservative fallback evidence.";
  if (category === "structural" || category === "mixed") return "Structural footprint overlap was grouped conservatively because replay could not prove a single scalar slot.";
  return "Normalized XPath / footprint fallback grouped these operations when exact replay evidence was unavailable.";
}

function operationToPseudoTrace(operation: ContextPack["scan"]["xmlPatches"][number]): PatchTrace {
  return {
    id: operationKey(operation),
    modName: operation.modName,
    displayName: operation.displayName,
    order: operation.order,
    file: operation.file,
    path: operation.path,
    line: operation.line,
    operation: operation.operation,
    xpath: operation.xpath,
    status: "applied",
    matchCountBefore: 0,
    affectedTargets: [],
    effects: [],
    confidence: "low",
    diagnosticKind: "silent-overwrite"
  };
}

function buildReviewRows(traces: PatchTrace[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const replayed = traces.filter((item) => item.status !== "partial");
  const scalar = replayed.filter((item) => item.effects.some((effect) => isScalarEffect(effect.kind)) || item.diagnosticKind.includes("miss") || isRealUnsupportedDiagnostic(item));
  for (const [targetKey, targetTraces] of groupBy(scalar, (item) => scalarTarget(item)).entries()) {
    const sorted = [...targetTraces].sort(compareTrace);
    const last = [...sorted].reverse().find((item) => item.effects.some((effect) => isScalarEffect(effect.kind)));
    const firstEffect = sorted.flatMap((item) => item.effects).find((effect) => isScalarEffect(effect.kind));
    const finalEffect = last?.effects.find((effect) => isScalarEffect(effect.kind));
    const kind = worstKind(sorted);
    rows.push({
      file: sorted[0].file,
      xpath: targetKey,
      category: "value",
      kind,
      risk: conflictKinds[kind].risk,
      final: finalEffect?.after ?? finalEffect?.value ?? null,
      finalKind: "final",
      vanilla: firstEffect?.before ?? null,
      history: sorted.map(traceToHistory),
      winner: last?.modName ?? sorted[sorted.length - 1].modName,
      note: explainTraceGroup(sorted)
    });
  }

  const structural = replayed.filter((item) => item.effects.some((effect) => isStructuralEffect(effect.kind)));
  for (const item of structural) {
    const kind = item.effects.some((effect) => effect.kind === "removeNode") ? "structural-mask" : item.diagnosticKind;
    rows.push({
      file: item.file,
      xpath: item.affectedTargets[0]?.canonical ?? item.xpath,
      category: "structural",
      kind,
      risk: conflictKinds[kind].risk,
      final: item.effects.map((effect) => effect.summary ?? effect.kind).join(", ") || item.status,
      finalKind: "status",
      vanilla: null,
      history: [traceToHistory(item)],
      winner: item.modName,
      note: `${item.operation} by ${item.modName}: ${item.effects.map((effect) => effect.target).join(", ") || item.xpath}`
    });
  }
  return rows.sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.file.localeCompare(b.file) || a.xpath.localeCompare(b.xpath));
}

function traceToHistory(item: PatchTrace): UiAttr["history"][number] {
  const effect = item.effects[0];
  return {
    mod: item.modName,
    order: item.order,
    op: item.operation,
    value: formatEffect(effect),
    before: effect?.before,
    authored: effect?.value ?? effect?.summary,
    after: effect?.after,
    error: item.status === "applied" || item.status === "ambiguous" ? undefined : item.message ?? conflictKinds[item.diagnosticKind].label
  };
}

function formatEffect(effect: PatchTrace["effects"][number] | undefined): string {
  if (!effect) return "(unknown)";
  if (effect.before != null || effect.after != null) return `${effect.before ?? "(missing)"} -> ${effect.after ?? "(missing)"}`;
  return effect.value ?? effect.summary ?? effect.kind;
}

function scalarTarget(item: PatchTrace): string {
  const effect = item.effects.find((candidate) => isScalarEffect(candidate.kind));
  if (effect) return effect.target;
  return item.affectedTargets[0]?.canonical ?? item.xpath;
}

function isScalarEffect(kind: string): boolean {
  return kind === "setValue" || kind === "setAttribute" || kind === "removeAttribute" || kind === "appendAttributeText" || kind === "miss" || kind === "unsupported";
}

function isStructuralEffect(kind: string): boolean {
  return kind === "appendChild" || kind === "removeNode" || kind === "insertBefore" || kind === "insertAfter";
}

function isRealUnsupportedDiagnostic(item: PatchTrace): boolean {
  return item.diagnosticKind === "unsupported-operation" && item.status !== "partial" && !/budget exceeded/i.test(item.message ?? item.effects[0]?.summary ?? "");
}

function worstKind(items: PatchTrace[]): ConflictKind {
  return [...items].map((item) => item.diagnosticKind).sort((a, b) => riskRank(conflictKinds[b].risk) - riskRank(conflictKinds[a].risk))[0] ?? "ok";
}

function explainTraceGroup(items: PatchTrace[]): string {
  const kind = worstKind(items);
  if (kind === "silent-overwrite") return "Later load-order writes hide earlier values on this canonical target.";
  if (kind.includes("miss")) return "At least one XPath did not match during replay.";
  if (kind === "unsupported-operation") return "This operation is visible in inventory but not replayed in v0.2.";
  return "Final value comes from replaying writes in load order.";
}

function buildTree(rows: ReviewRow[]): UiModel["xmlTree"] {
  const byFile = new Map<string, UiNode[]>();
  rows.forEach((row, index) => {
    const attr: UiAttr = {
      conflictId: `c${index + 1}`,
      name: row.isSummary ? row.xpath : targetName(row.xpath),
      target: row.xpath,
      searchText: row.searchText,
      category: row.category,
      finalKind: row.finalKind,
      vanilla: row.vanilla,
      history: row.history,
      final: row.final,
      winner: row.winner,
      exact: row.exact,
      sourceLabel: row.sourceLabel,
      operations: row.operations,
      evidence: row.evidence,
      risk: row.risk,
      kind: row.kind,
      xpath: row.xpath,
      note: row.note
    };
    const nodePath = row.isSummary ? `Summary / ${row.file}` : parentPath(row.xpath);
    const node = { path: nodePath, label: row.isSummary ? "Summaries" : `<${nodePath || row.xpath}>`, risk: attr.risk, attrs: [attr] };
    const list = byFile.get(row.file) ?? [];
    list.push(node);
    byFile.set(row.file, list);
  });
  return Object.fromEntries([...byFile.entries()].map(([file, children]) => [file, { children }]));
}

function rootToMod(mod: ContextPack["scan"]["enabledMods"][number], patches: ContextPack["scan"]["xmlPatches"], sortOrder: number, modlistLine: number | undefined) {
  const files = [...new Set(patches.map((patch) => patch.file))].sort((a, b) => a.localeCompare(b));
  return { id: mod.mo2Name, folder: mod.mo2Name, name: mod.displayName || mod.mo2Name, author: mod.author ?? "unknown", version: mod.version ?? "unknown", enabled: true, order: mod.order, sortOrder, modlistLine, description: mod.rootPath || "diagnostic only", files, patchCount: patches.length, isCore: /harmony|score|tfp/i.test(mod.mo2Name), isUser: /^z{2,}|waka|tweaks/i.test(mod.mo2Name), missing: false };
}

function entryToMod(name: string, enabled: boolean, order: number, sortOrder: number, modlistLine: number, description: string, missing = false) {
  return { id: name, folder: name, name, author: "unknown", version: "unknown", enabled, order, sortOrder, modlistLine, description, files: [], patchCount: 0, isCore: /harmony|score|tfp/i.test(name), isUser: /^z{2,}|waka|tweaks/i.test(name), missing };
}

function rootKey(mod: ContextPack["scan"]["enabledMods"][number]): string {
  return `${mod.mo2Name}\0${mod.rootPath}`;
}

function riskForDiagnostics(traces: PatchTrace[]): Risk {
  return traces.map((item) => conflictKinds[item.diagnosticKind].risk).sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "safe";
}

function highestRisk(risks: Risk[]): Risk {
  return risks.sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "safe";
}

function highestRiskKind(kinds: ConflictKind[]): ConflictKind {
  return kinds.sort((a, b) => riskRank(conflictKinds[b].risk) - riskRank(conflictKinds[a].risk))[0] ?? "unknown-risk";
}

function summarizeCategory(categories: ConflictCategory[]): ConflictCategory {
  const unique = new Set(categories);
  if (unique.has("mixed") || (unique.has("value") && unique.has("structural"))) return "mixed";
  if (unique.has("structural")) return "structural";
  return "value";
}

function riskRank(risk: Risk): number {
  return { safe: 0, info: 1, warn: 2, danger: 3, critical: 4 }[risk];
}

function countConflictCategories(categories: ConflictCategory[]): Record<ConflictCategory, number> {
  return { value: categories.filter((category) => category === "value").length, structural: categories.filter((category) => category === "structural").length, mixed: categories.filter((category) => category === "mixed").length };
}

function compareTrace(a: PatchTrace, b: PatchTrace): number {
  return a.order - b.order || a.line - b.line || a.modName.localeCompare(b.modName);
}

function compareOperation(a: ContextPack["scan"]["xmlPatches"][number], b: ContextPack["scan"]["xmlPatches"][number]): number {
  return a.order - b.order || a.line - b.line || a.modName.localeCompare(b.modName);
}

function buildTraceIndex(traces: PatchTrace[]): Map<string, PatchTrace> {
  return new Map(traces.map((trace) => [operationKey(trace), trace]));
}

function operationKey(operation: Pick<PatchTrace, "file" | "order" | "line" | "operation" | "xpath">): string {
  return `${operation.file}\0${operation.order}\0${operation.line}\0${operation.operation}\0${operation.xpath}`;
}

function targetName(xpath: string): string {
  return xpath.split("/").filter(Boolean).pop() ?? xpath;
}

function parentPath(xpath: string): string {
  const parts = xpath.split("/").filter(Boolean);
  return parts.slice(Math.max(0, parts.length - 2)).join("/") || xpath;
}

function itemNameForTarget(target: string): string | undefined {
  return target.match(/\/items\/item\[@name=['"]([^'"]+)['"]\]/)?.[1];
}

function itemCategoryForName(name: string): string {
  if (/^ammo(?:Eft)?/i.test(name)) return "Ammo";
  if (/^gunbow/i.test(name)) return "Bow";
  if (/^gun/i.test(name)) return "Gun";
  if (/^(?:armor|modArmor)/i.test(name)) return "Armor";
  if (/^(?:melee|tool)/i.test(name)) return "Tool/Melee";
  return "Item";
}

function changeKindForTarget(target: string): string {
  const passive = target.match(/\/passive_effect\[@name=['"]([^'"]+)['"]\]/);
  if (passive) return `Passive effect: ${passive[1]}`;
  if (/\/property\[@name=['"]EconomicValue['"]\]\/@value$/.test(target)) return "EconomicValue";
  if (/\/effect_group(?:\/|$)/.test(target)) return "Effect group";
  const attr = target.match(/\/@([\w.-]+)$/);
  if (attr) return attr[1];
  const named = target.match(/\/([\w.-]+)\[@name=['"]([^'"]+)['"]\](?:$|\/)/);
  if (named) return `${named[1]}: ${named[2]}`;
  return targetName(target).replace(/\[[^\]]+\]/g, "");
}

function countByValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function topCounts(counts: Map<string, number>, limit: number): { name: string; count: number }[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function formatCounts(items: { name: string; count: number }[]): string {
  return items.length > 0 ? items.map((item) => `${item.name} (${item.count})`).join(", ") : "none";
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return map;
}
