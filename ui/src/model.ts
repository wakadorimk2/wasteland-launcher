import type { ConflictCategory, ConflictKind, ContextPack, PatchTrace, Risk, UiAttr, UiModel, UiNode, UiXmlFile } from "./types";

export const conflictKinds: Record<ConflictKind, { label: string; risk: Risk; desc: string }> = {
  "xpath-miss": { label: "XPath miss", risk: "critical", desc: "The patch XPath matched no current target." },
  "order-induced-miss": { label: "Order-induced miss", risk: "critical", desc: "An earlier patch removed a target used later." },
  "dependency-order-miss": { label: "Dependency-order miss", risk: "warn", desc: "A patch appears to reference a target that is added later." },
  "silent-overwrite": { label: "Silent overwrite", risk: "danger", desc: "A later scalar write hides an earlier write on the same canonical target." },
  "structural-mask": { label: "Structural mask", risk: "warn", desc: "A structural operation hides or removes another change." },
  "broad-match-risk": { label: "Broad selector", risk: "warn", desc: "The XPath matched multiple targets." },
  "unsupported-operation": { label: "Unsupported op", risk: "info", desc: "The patch is inventoried but not replayed in v0.2." },
  "parse-error": { label: "Parse error", risk: "critical", desc: "The patch or vanilla XML could not be parsed." },
  ok: { label: "Applied", risk: "safe", desc: "The replayed patch has no diagnostic warning." }
};

const samplePack: ContextPack = {
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
  conflicts: [],
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

  const xmlFiles: UiXmlFile[] = [...patchesByFile.entries()].map(([file, patches]) => {
    const fileTraces = tracesByFile.get(file) ?? [];
    const diagnosticCount = fileTraces.filter((item) => item.diagnosticKind !== "ok").length;
    const missCount = fileTraces.filter((item) => /miss/.test(item.diagnosticKind)).length;
    return {
      path: file,
      patches: patches.length,
      touchingMods: [...new Set(patches.map((patch) => patch.modName))].sort(),
      conflicts: diagnosticCount,
      missing: missCount,
      risk: riskForDiagnostics(fileTraces)
    };
  }).sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || b.conflicts - a.conflicts || b.patches - a.patches || a.path.localeCompare(b.path));

  const rows = buildReviewRows(traces);
  const conflicts = rows.map((row, index) => ({
    id: `c${index + 1}`,
    file: row.file,
    node: row.xpath,
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
      conflicts: traces.filter((item) => item.diagnosticKind !== "ok").length,
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
  rows.slice(0, 160).forEach((row, index) => {
    const attr: UiAttr = {
      conflictId: `c${index + 1}`,
      name: targetName(row.xpath),
      category: row.category,
      finalKind: row.finalKind,
      vanilla: row.vanilla,
      history: row.history,
      final: row.final,
      winner: row.winner,
      risk: row.risk,
      kind: row.kind,
      xpath: row.xpath,
      note: row.note
    };
    const nodePath = parentPath(row.xpath);
    const node = { path: nodePath, label: `<${nodePath || row.xpath}>`, risk: attr.risk, attrs: [attr] };
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

function riskRank(risk: Risk): number {
  return { safe: 0, info: 1, warn: 2, danger: 3, critical: 4 }[risk];
}

function countConflictCategories(categories: ConflictCategory[]): Record<ConflictCategory, number> {
  return { value: categories.filter((category) => category === "value").length, structural: categories.filter((category) => category === "structural").length, mixed: categories.filter((category) => category === "mixed").length };
}

function compareTrace(a: PatchTrace, b: PatchTrace): number {
  return a.order - b.order || a.line - b.line || a.modName.localeCompare(b.modName);
}

function targetName(xpath: string): string {
  return xpath.split("/").filter(Boolean).pop() ?? xpath;
}

function parentPath(xpath: string): string {
  const parts = xpath.split("/").filter(Boolean);
  return parts.slice(Math.max(0, parts.length - 2)).join("/") || xpath;
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
