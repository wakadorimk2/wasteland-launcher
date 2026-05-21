import type { ConflictCategory, ConflictGroup, ConflictKind, ConflictResolutionStep, ContextPack, Risk, UiAttr, UiModel, UiNode, UiXmlFile, XmlPatchOperation } from "./types";

export const conflictKinds: Record<ConflictKind, { label: string; risk: Risk; desc: string }> = {
  "direct-overwrite": { label: "Direct overwrite", risk: "danger", desc: "Multiple mods touch the same target; the later load-order winner is shown." },
  "same-node-multi-touch": { label: "Same node multi-touch", risk: "info", desc: "Multiple operations affect the same node area." },
  "structural-dependency": { label: "Structural dependency", risk: "warn", desc: "Add/remove style operations may depend on earlier structure." },
  "missing-xpath": { label: "Missing XPath", risk: "critical", desc: "A patch target could not be confirmed from diagnostics." },
  "load-order-dependent": { label: "Load order dependent", risk: "info", desc: "The current winner depends on mod order." },
  "single-winner": { label: "Single winner", risk: "safe", desc: "Only one mod touches this diagnostic target." }
};

const samplePack: ContextPack = {
  generatedAt: new Date().toISOString(),
  scan: {
    mo2Path: "sample://MO2",
    profile: "Sample",
    modlistPath: "sample://profiles/Sample/modlist.txt",
    entries: [
      { raw: "+0_TFP_Harmony", name: "0_TFP_Harmony", state: "enabled", line: 1, order: 0 },
      { raw: "+KHA21-HUDPlus", name: "KHA21-HUDPlus", state: "enabled", line: 2, order: 1 },
      { raw: "+BiggerBackpack_60", name: "BiggerBackpack_60", state: "enabled", line: 3, order: 2 },
      { raw: "+ZMXuiCP", name: "ZMXuiCP", state: "enabled", line: 4, order: 3 },
      { raw: "+zzz_MyTweaks", name: "zzz_MyTweaks", state: "enabled", line: 5, order: 4 }
    ],
    enabledMods: [
      { mo2Name: "0_TFP_Harmony", displayName: "TFP Harmony Core", rootPath: "", modInfoPath: "", order: 0, version: "1.0.0", author: "The Fun Pimps" },
      { mo2Name: "KHA21-HUDPlus", displayName: "Khaine HUDPlus A21", rootPath: "", modInfoPath: "", order: 1, version: "21.2", author: "Khaine" },
      { mo2Name: "BiggerBackpack_60", displayName: "Bigger Backpack (60 slots)", rootPath: "", modInfoPath: "", order: 2, version: "1.4", author: "khzmusik" },
      { mo2Name: "ZMXuiCP", displayName: "ZMXui Compo Pack", rootPath: "", modInfoPath: "", order: 3, version: "5.0", author: "Sirillion" },
      { mo2Name: "zzz_MyTweaks", displayName: "My Personal Tweaks", rootPath: "", modInfoPath: "", order: 4, version: "0.1", author: "you" }
    ],
    missingEnabledMods: [],
    xmlPatches: [
      op("KHA21-HUDPlus", 1, "XUi/windows.xml", "/windows/window[@name='windowBackpack']", "set", 10),
      op("BiggerBackpack_60", 2, "XUi/windows.xml", "/windows/window[@name='windowBackpack']", "set", 18),
      op("ZMXuiCP", 3, "XUi/windows.xml", "/windows/window[@name='windowBackpack']", "set", 22),
      op("zzz_MyTweaks", 4, "items.xml", "/items/item[@name='gunPistolT0PipePistol']/property[@name='EconomicValue']/@value", "set", 7, "80"),
      op("KHA21-HUDPlus", 1, "XUi/xui.xml", "/xui/ruleset", "append", 12, "<rule name=\"hud\"/>", "xml", "append <rule name=\"hud\"/>"),
      op("ZMXuiCP", 3, "items.xml", "/items/item[@name='gunPistolT0PipePistol']/property[@name='EconomicValue']/@value", "set", 28, "120"),
      op("BiggerBackpack_60", 2, "XUi/xui.xml", "/xui/ruleset", "append", 30, "<rule name=\"bag\"/>", "xml", "append <rule name=\"bag\"/>"),
      op("ZMXuiCP", 3, "items.xml", "/items/item[@name='foodCan']/property[@name='Stacknumber']/@value", "set", 40, "120"),
      op("zzz_MyTweaks", 4, "items.xml", "/items/item[@name='foodCan']/property[@name='Stacknumber']/@value", "set", 41, "80"),
      op("KHA21-HUDPlus", 1, "items.xml", "/items/item[@name='foodCan']", "append", 42, "<property name=\"CustomIconTint\" value=\"ffffff\"/>", "xml", "append <property CustomIconTint>")
    ],
    dlls: [],
    warnings: []
  },
  conflicts: [],
  logs: { warnings: [] }
};
samplePack.conflicts = [
  {
    file: "XUi/windows.xml",
    normalizedXpath: "/windows/window[@name='windowBackpack']",
    operations: [samplePack.scan.xmlPatches[5], samplePack.scan.xmlPatches[3]],
    winner: samplePack.scan.xmlPatches[3],
    exact: true,
    resolution: {
      status: "resolved",
      vanillaValue: "100",
      finalValue: "80",
      finalSource: "zzz_MyTweaks",
      history: [
        { modName: "ZMXuiCP", displayName: "ZMXuiCP", order: 3, operation: "set", xpath: samplePack.scan.xmlPatches[5].xpath, beforeValue: "100", authoredValue: "120", afterValue: "120", status: "applied" },
        { modName: "zzz_MyTweaks", displayName: "zzz_MyTweaks", order: 4, operation: "set", xpath: samplePack.scan.xmlPatches[3].xpath, beforeValue: "120", authoredValue: "80", afterValue: "80", status: "applied" }
      ],
      warnings: []
    }
  },
  {
    file: "XUi/windows.xml",
    normalizedXpath: "/windows/window[@name='windowBackpack']",
    operations: samplePack.scan.xmlPatches.slice(0, 3),
    winner: samplePack.scan.xmlPatches[2],
    exact: true
  },
  {
    file: "XUi/xui.xml",
    normalizedXpath: "/xui/ruleset",
    operations: [samplePack.scan.xmlPatches[4], samplePack.scan.xmlPatches[6]],
    winner: samplePack.scan.xmlPatches[6],
    exact: true,
    resolution: {
      status: "unresolved",
      history: [],
      warnings: ["Resolution skipped for broad conflict candidate set (2 operations): XUi/xui.xml"]
    }
  },
  {
    file: "items.xml",
    normalizedXpath: "/items/item[@name='foodCan']",
    operations: [samplePack.scan.xmlPatches[7], samplePack.scan.xmlPatches[8], samplePack.scan.xmlPatches[9]],
    winner: samplePack.scan.xmlPatches[9],
    exact: false,
    resolution: {
      status: "unresolved",
      history: [],
      warnings: ["Structural append is unresolved, but exact set values can be reviewed as candidates."]
    }
  }
];

function op(modName: string, order: number, file: string, xpath: string, operation: string, line: number, valueText?: string, valueKind: "text" | "xml" | "target" | "empty" | "unknown" = "text", valueSummary?: string) {
  return { modName, displayName: modName, order, file, path: xpath, operation, xpath, line, valueText, valueKind, valueSummary };
}

export function buildSampleModel(): UiModel {
  return buildUiModel(samplePack, "sample");
}

export function buildUiModel(pack: ContextPack, source: UiModel["source"] = "context"): UiModel {
  const patchesByMod = groupBy(pack.scan.xmlPatches, (patch) => patch.modName);
  const patchesByFile = groupBy(pack.scan.xmlPatches, (patch) => patch.file);
  const conflictsByFile = groupBy(pack.conflicts, (conflict) => conflict.file);
  const rootsByMod = groupBy(pack.scan.enabledMods, (mod) => mod.mo2Name);
  const seenRoots = new Set<string>();
  const mods = pack.scan.entries
    .filter((entry) => entry.state !== "separator")
    .flatMap((entry, index) => {
      const sortOrder = index;
      if (entry.state === "disabled") {
        return [entryToMod(entry.name, false, entry.order ?? -1, sortOrder, entry.line, "disabled in modlist")];
      }

      const roots = rootsByMod.get(entry.name) ?? [];
      if (roots.length === 0) {
        return [entryToMod(entry.name, true, entry.order ?? sortOrder, sortOrder, entry.line, "enabled in modlist, but folder or ModInfo.xml was not found", true)];
      }

      for (const mod of roots) {
        seenRoots.add(rootKey(mod));
      }
      return [rootToMod(roots[0], patchesByMod.get(entry.name) ?? [], sortOrder, entry.line)];
    });

  for (const mod of pack.scan.enabledMods) {
    if (!seenRoots.has(rootKey(mod))) {
      mods.push(rootToMod(mod, patchesByMod.get(mod.mo2Name) ?? [], pack.scan.entries.length + mods.length, undefined));
    }
  }
  mods.sort((a, b) => a.sortOrder - b.sortOrder || a.order - b.order || a.folder.localeCompare(b.folder));

  const xmlFiles: UiXmlFile[] = [...patchesByFile.entries()].map(([file, patches]) => {
    const conflicts = conflictsByFile.get(file) ?? [];
    return {
      path: file,
      patches: patches.length,
      touchingMods: [...new Set(patches.map((patch) => patch.modName))].sort(),
      conflicts: conflicts.length,
      missing: countMissing(pack, file),
      risk: riskFor(conflicts.length, countMissing(pack, file))
    };
  }).sort((a, b) => b.conflicts - a.conflicts || b.patches - a.patches || a.path.localeCompare(b.path));

  const sortedConflictGroups = [...pack.conflicts].sort(compareConflictGroupsForReview);
  const reviewRows = buildReviewRows(sortedConflictGroups);
  const conflicts = reviewRows.map((row, index) => {
    const modsInvolved = [...new Set(row.operations.map((operation) => operation.modName))];
    return {
      id: `c${index + 1}`,
      file: row.file,
      node: row.xpath,
      category: row.category,
      finalKind: row.finalKind,
      kind: row.kind,
      risk: row.risk,
      mods: modsInvolved,
      final: row.final,
      summary: `${modsInvolved.join(" -> ")} touch ${row.xpath}. ${row.finalKind === "candidate" ? "Candidate" : "Final"} is ${row.final}.`
    };
  });

  const xmlTree = buildTree(reviewRows);
  const conflictCounts = countConflictCategories(conflicts.map((conflict) => conflict.category));
  const totalConflictOps = new Set(pack.conflicts.flatMap((conflict) => conflict.operations.map((operation) => `${operation.file}\0${operation.xpath}\0${operation.modName}\0${operation.line}`))).size;
  return {
    source,
    generatedAt: pack.generatedAt,
    mo2Path: pack.scan.mo2Path,
    profile: pack.scan.profile,
    mods,
    xmlFiles,
    xmlTree,
    conflicts,
    stats: {
      modsLoaded: mods.length,
      modsEnabled: mods.filter((mod) => mod.enabled).length,
      xmlFiles: xmlFiles.length,
      totalPatches: pack.scan.xmlPatches.length,
      warnings: pack.scan.warnings.length + pack.logs.warnings.length,
      conflicts: pack.conflicts.length,
      missingXPath: pack.scan.warnings.filter((warning) => /xpath|missing/i.test(`${warning.kind} ${warning.message}`)).length,
      loadOrderDependent: conflicts.filter((conflict) => conflict.kind === "load-order-dependent").length,
      safeChanges: Math.max(0, pack.scan.xmlPatches.length - totalConflictOps)
    },
    conflictCounts
  };
}

function rootToMod(mod: ContextPack["scan"]["enabledMods"][number], patches: ContextPack["scan"]["xmlPatches"], sortOrder: number, modlistLine: number | undefined) {
  const files = [...new Set(patches.map((patch) => patch.file))].sort((a, b) => a.localeCompare(b));
  return {
    id: mod.mo2Name,
    folder: mod.mo2Name,
    name: mod.displayName || mod.mo2Name,
    author: mod.author ?? "unknown",
    version: mod.version ?? "unknown",
    enabled: true,
    order: mod.order,
    sortOrder,
    modlistLine,
    description: mod.rootPath || "diagnostic only",
    files,
    patchCount: patches.length,
    isCore: /harmony|score|tfp/i.test(mod.mo2Name),
    isUser: /^z{2,}|waka|tweaks/i.test(mod.mo2Name),
    missing: false
  };
}

function entryToMod(name: string, enabled: boolean, order: number, sortOrder: number, modlistLine: number, description: string, missing = false) {
  return {
    id: name,
    folder: name,
    name,
    author: "unknown",
    version: "unknown",
    enabled,
    order,
    sortOrder,
    modlistLine,
    description,
    files: [],
    patchCount: 0,
    isCore: /harmony|score|tfp/i.test(name),
    isUser: /^z{2,}|waka|tweaks/i.test(name),
    missing
  };
}

function rootKey(mod: ContextPack["scan"]["enabledMods"][number]): string {
  return `${mod.mo2Name}\0${mod.rootPath}`;
}

interface ReviewRow {
  source: ConflictGroup;
  file: string;
  xpath: string;
  operations: XmlPatchOperation[];
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

function buildReviewRows(groups: ConflictGroup[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const group of groups) {
    rows.push(...valueCandidateRows(group));
    const structural = structuralRow(group);
    if (structural) rows.push(structural);
  }
  return rows.sort(compareReviewRows);
}

function valueCandidateRows(group: ConflictGroup): ReviewRow[] {
  const byExactXpath = group.operations.filter(isValueCandidateOperation).reduce<Map<string, XmlPatchOperation[]>>((acc, operation) => {
    const current = acc.get(operation.xpath) ?? [];
    current.push(operation);
    acc.set(operation.xpath, current);
    return acc;
  }, new Map());

  const rows: ReviewRow[] = [];
  for (const [xpath, operations] of byExactXpath.entries()) {
    if (operations.length === 0) continue;
    operations.sort(compareOperations);
    const historySteps = matchingHistory(group, xpath);
    const history = historySteps.length > 0
      ? historySteps.map(historyStepToUi)
      : operations.map(operationToCandidateHistory);
    const allApplied = historySteps.length > 0 && historySteps.every((step) => step.status === "applied");
    const resolvedFinal = allApplied ? lastDefined(historySteps.map((step) => step.afterValue)) : undefined;
    const winner = operations[operations.length - 1];
    const candidateFinal = winner.valueSummary ?? winner.valueText ?? null;
    const finalKind = group.resolution?.status === "resolved" && resolvedFinal != null ? "final" : "candidate";
    const category = classifyConflictCategory(group);
    rows.push({
      source: group,
      file: group.file,
      xpath,
      operations,
      category: "value",
      kind: operations.length > 2 ? "load-order-dependent" : "direct-overwrite",
      risk: finalKind === "final" ? riskForKind(operations.length > 2 ? "load-order-dependent" : "direct-overwrite", group) : category === "mixed" ? "warn" : "info",
      final: finalKind === "final" ? resolvedFinal ?? candidateFinal : candidateFinal,
      finalKind,
      vanilla: group.resolution?.status === "resolved" ? group.resolution.vanillaValue ?? null : null,
      history,
      winner: finalKind === "final" ? group.resolution?.finalSource ?? winner.modName : winner.modName,
      note: finalKind === "candidate"
        ? category === "mixed"
          ? "This is an individual value candidate extracted from a mixed conflict. Structural resolution is still unresolved; treat the shown final as load-order candidate only."
          : "No complete resolution history is available for this exact value. Candidate final is the last authored value by load order."
        : "Final value comes from the resolver history for this exact value target."
    });
  }
  return rows;
}

function structuralRow(group: ConflictGroup): ReviewRow | null {
  const structuralOperations = group.operations.filter(isStructuralOperation);
  if (structuralOperations.length === 0) return null;
  const kind = inferKind({ ...group, operations: structuralOperations });
  const final = structuralStatus(group);
  return {
    source: group,
    file: group.file,
    xpath: group.normalizedXpath,
    operations: structuralOperations,
    category: "structural",
    kind,
    risk: riskForKind(kind, group),
    final,
    finalKind: "status",
    vanilla: null,
    history: structuralOperations.sort(compareOperations).map(operationToCandidateHistory),
    winner: group.winner?.modName,
    note: group.resolution?.warnings?.length
      ? `Resolution warning: ${group.resolution.warnings[0]}`
      : "Structural conflict: review append, remove, and insert operations here. Scalar value candidates are shown separately in Values."
  };
}

function buildTree(rows: ReviewRow[]): UiModel["xmlTree"] {
  const byFile = new Map<string, UiNode[]>();
  for (const [index, row] of rows.entries()) {
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
    const node: UiNode = {
      path: nodePath,
      label: `<${nodePath || row.xpath}>`,
      risk: attr.risk,
      attrs: [attr]
    };
    const fileNodes = byFile.get(row.file) ?? [];
    fileNodes.push(node);
    byFile.set(row.file, fileNodes);
    if (index > 80) break;
  }
  return Object.fromEntries([...byFile.entries()].map(([file, children]) => [file, { children }]));
}

function inferKind(group: ConflictGroup): ConflictKind {
  if (!group.exact) return "same-node-multi-touch";
  if (group.operations.some((operation) => /remove|insert|append/i.test(operation.operation))) return "structural-dependency";
  if (group.operations.length > 2) return "load-order-dependent";
  return "direct-overwrite";
}

function classifyConflictCategory(group: ConflictGroup): ConflictCategory {
  const hasStructural = group.operations.some(isStructuralOperation);
  const hasValue = group.operations.some(isValueOperation);
  if (hasStructural && hasValue) return "mixed";
  if (hasStructural) return "structural";
  return "value";
}

function isValueOperation(operation: ConflictGroup["operations"][number]): boolean {
  if (/^set$/i.test(operation.operation)) return true;
  if (/\/@[\w.-]+$/i.test(operation.xpath)) return true;
  if (/(EconomicValue|Price|Count|Damage|Range|Duration|value)/i.test(operation.xpath)) return true;
  if (operation.valueKind === "text") return true;
  return looksNumeric(operation.valueText);
}

function isValueCandidateOperation(operation: XmlPatchOperation): boolean {
  if (operation.valueKind === "xml") return false;
  if (isStructuralOperation(operation)) return false;
  if (/^set$/i.test(operation.operation)) return true;
  if (/\/@[\w.-]+$/i.test(operation.xpath)) return true;
  if (looksNumeric(operation.valueText)) return true;
  return operation.valueKind === "text" && (operation.valueText?.length ?? 0) <= 160 && !/[<>]/.test(operation.valueText ?? "");
}

function isStructuralOperation(operation: XmlPatchOperation): boolean {
  return /^(append|insertBefore|insertAfter|remove)$/i.test(operation.operation);
}

function riskForKind(kind: ConflictKind, group: ConflictGroup): Risk {
  if (group.resolution?.status === "unresolved") return "critical";
  if (kind === "structural-dependency") return "warn";
  if (kind === "load-order-dependent") return "info";
  if (!group.exact) return "info";
  return "danger";
}

function historyStepToUi(step: ConflictResolutionStep): UiAttr["history"][number] {
  return {
    mod: step.modName,
    order: step.order,
    op: step.operation,
    value: formatHistoryValue(step.beforeValue, step.afterValue, step.authoredValue),
    before: step.beforeValue,
    authored: step.authoredValue,
    after: step.afterValue,
    error: step.status === "unresolved" ? step.warning ?? "unresolved" : undefined
  };
}

function operationToCandidateHistory(operation: XmlPatchOperation): UiAttr["history"][number] {
  const value = operation.valueSummary ?? operation.valueText;
  return {
    mod: operation.modName,
    order: operation.order,
    op: operation.operation,
    value: value ?? "(unknown)",
    authored: value
  };
}

function formatHistoryValue(before?: string, after?: string, authored?: string): string {
  if (before != null || after != null) {
    return `${before ?? "(missing)"} -> ${after ?? "(missing)"}`;
  }
  return authored ?? "unresolved";
}

function structuralStatus(group: ConflictGroup): string {
  if (group.resolution?.status === "resolved") return "resolved";
  return "unresolved";
}

function compareConflictGroupsForReview(a: ConflictGroup, b: ConflictGroup): number {
  return reviewScore(b) - reviewScore(a) || a.file.localeCompare(b.file) || a.normalizedXpath.localeCompare(b.normalizedXpath);
}

function reviewScore(group: ConflictGroup): number {
  let score = 0;
  if (/\/@[\w.-]+$/.test(group.winner.xpath)) score += 80;
  if (/\/@value$/i.test(group.winner.xpath)) score += 40;
  if (group.operations.every((operation) => operation.operation === "set")) score += 35;
  if (group.operations.some((operation) => looksNumeric(operation.valueText))) score += 25;
  if (group.exact) score += 10;
  if (group.resolution?.status === "resolved") score += 10;
  if (group.operations.some((operation) => /append|insert|remove/i.test(operation.operation))) score -= 60;
  if (/^\/[^/]+$/.test(group.normalizedXpath)) score -= 50;
  return score;
}

function compareReviewRows(a: ReviewRow, b: ReviewRow): number {
  return rowScore(b) - rowScore(a) || a.file.localeCompare(b.file) || a.xpath.localeCompare(b.xpath);
}

function rowScore(row: ReviewRow): number {
  let score = 0;
  if (row.category === "value") score += 120;
  if (row.finalKind === "candidate" && row.final != null) score += 35;
  if (row.finalKind === "final") score += 25;
  if (/\/@value$/i.test(row.xpath)) score += 20;
  if (row.operations.some((operation) => looksNumeric(operation.valueText))) score += 15;
  if (row.category === "structural") score -= 80;
  return score;
}

function compareOperations(a: XmlPatchOperation, b: XmlPatchOperation): number {
  return a.order - b.order || a.line - b.line || a.modName.localeCompare(b.modName);
}

function matchingHistory(group: ConflictGroup, xpath: string): ConflictResolutionStep[] {
  return (group.resolution?.history ?? []).filter((step) => step.xpath === xpath && /^set$/i.test(step.operation));
}

function lastDefined<T>(values: Array<T | undefined>): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] != null) return values[index];
  }
  return undefined;
}

function looksNumeric(value: string | undefined): boolean {
  return value != null && /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function countConflictCategories(categories: ConflictCategory[]): Record<ConflictCategory, number> {
  return {
    value: categories.filter((category) => category === "value").length,
    structural: categories.filter((category) => category === "structural").length,
    mixed: categories.filter((category) => category === "mixed").length
  };
}

function riskFor(conflicts: number, missing: number): Risk {
  if (missing > 0) return "critical";
  if (conflicts >= 8) return "danger";
  if (conflicts >= 3) return "warn";
  if (conflicts > 0) return "info";
  return "safe";
}

function countMissing(pack: ContextPack, file: string): number {
  return pack.scan.warnings.filter((warning) => warning.path?.includes(file) && /xpath|missing/i.test(`${warning.kind} ${warning.message}`)).length;
}

function targetName(xpath: string): string {
  const parts = xpath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? xpath;
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
