import { buildPatchTrace, defaultGameInstallPath, TraceOptions } from "./patchTrace.js";
import { extractPatchFootprints, PatchFootprint, PatchFootprintSelector } from "./footprint.js";
import { ConflictDetectionResult, DiagnosticClassification, DiagnosticConfidence, DiagnosticEvidence, DiagnosticGroup, PatchDiagnosticKind, PatchTrace, PatchTraceEffect, ReplayCoverage, ReplayEvidence, SlotVersion, XmlPatchOperation } from "./types.js";
import { normalizeXpath } from "./xpath.js";

type ConflictSource = "replay" | "footprint" | "normalized" | "budget";
type OperationKey = string;

interface OperationEffect {
  operation: XmlPatchOperation;
  trace: PatchTrace;
  effect: PatchTraceEffect;
}

interface PendingGroup {
  file: string;
  target: string;
  targetKey: string;
  operations: XmlPatchOperation[];
  traces: PatchTrace[];
  effects: PatchTraceEffect[];
  exact: boolean;
  source: ConflictSource;
  classification: DiagnosticClassification;
  kind: PatchDiagnosticKind;
  confidence: DiagnosticConfidence;
  orderDependent: boolean;
}

interface MaterializedGroup {
  group: DiagnosticGroup;
  operations: XmlPatchOperation[];
  evidence: DiagnosticEvidence[];
}

const scalarEffectKinds = new Set<PatchTraceEffect["kind"]>(["setValue", "setAttribute", "removeAttribute", "appendAttributeText"]);
const structuralEffectKinds = new Set<PatchTraceEffect["kind"]>(["removeNode", "appendChild", "insertBefore", "insertAfter"]);
const fallbackTraceStatuses = new Set<PatchTrace["status"]>(["missed", "unsupported", "parseError", "partial"]);

export async function detectConflicts(
  operations: XmlPatchOperation[],
  gamePath = defaultGameInstallPath(),
  options: TraceOptions = {}
): Promise<ConflictDetectionResult> {
  const pending: PendingGroup[] = [];
  pending.push(...detectFootprintConflicts(operations));
  pending.push(...detectNormalizedXpathConflicts(candidateFallbackOperations(operations)));

  const replayOperations = replayCandidates(operations, pending);
  const replay = await buildPatchTrace(replayOperations, gamePath, {
    ...options,
    timeoutMs: options.timeoutMs ?? 2_000
  });
  const operationByTraceId = mapOperationsByTraceId(replayOperations);
  pending.push(...detectReplayConflicts(replay.trace, operationByTraceId));

  const materialized = materializeGroups(pending);
  const diagnosticGroups = materialized.map((item) => item.group);
  const replayEvidenceByGroupId = Object.fromEntries(materialized.map((item) => [item.group.id, {
    groupId: item.group.id,
    proof: item.group.proof,
    evidence: item.evidence,
    traceIds: item.evidence.map((evidence) => evidence.opId)
  } satisfies ReplayEvidence]));
  const operationsById = Object.fromEntries(operations.map((operation) => [operationId(operation), operation]));
  const coverage = coverageFor(operations, replayOperations, replay.trace, diagnosticGroups, replay.warnings);

  return {
    diagnosticGroups,
    operationsById,
    replayEvidenceByGroupId,
    coverage,
    trace: replay.trace,
    warnings: replay.warnings
  };
}

export { normalizeXpath };

function detectReplayConflicts(trace: PatchTrace[], operationByTraceId: Map<string, XmlPatchOperation>): PendingGroup[] {
  const pending: PendingGroup[] = [];
  const effects = replayEffects(trace, operationByTraceId);

  const scalarByTarget = new Map<string, OperationEffect[]>();
  const structuralByTarget = new Map<string, OperationEffect[]>();
  for (const item of effects) {
    const key = `${item.operation.file}\0${effectTargetKey(item.effect)}`;
    if (scalarEffectKinds.has(item.effect.kind)) {
      pushMap(scalarByTarget, key, item);
    } else if (structuralEffectKinds.has(item.effect.kind)) {
      pushMap(structuralByTarget, key, item);
    }
  }

  for (const [key, items] of scalarByTarget) {
    const [file, targetKey] = splitKey(key);
    const target = displayTarget(items[0].effect);
    pending.push(pendingGroup({
      file,
      target,
      targetKey,
      operations: items.map((item) => item.operation),
      traces: items.map((item) => item.trace),
      effects: items.map((item) => item.effect),
      exact: true,
      source: "replay",
      classification: classifyScalarEffects(items.map((item) => item.effect)),
      kind: classifyScalarEffects(items.map((item) => item.effect)) === "slot-order-dependent" ? "slot-order-dependent" : "silent-overwrite",
      confidence: "proven",
      orderDependent: true
    }));
  }
  for (const [key, items] of structuralByTarget) {
    const [file, targetKey] = splitKey(key);
    const target = displayTarget(items[0].effect);
    pending.push(pendingGroup({
      file,
      target,
      targetKey,
      operations: items.map((item) => item.operation),
      traces: items.map((item) => item.trace),
      effects: items.map((item) => item.effect),
      exact: true,
      source: "replay",
      classification: items.some((item) => item.effect.kind === "removeNode") ? "structural-mask" : "sibling-order-dependent",
      kind: items.some((item) => item.effect.kind === "removeNode") ? "structural-mask" : "sibling-order-dependent",
      confidence: "proven",
      orderDependent: true
    }));
  }

  const removes = effects.filter((item) => item.effect.kind === "removeNode");
  for (const remove of removes) {
    const operationsForRemovedSubtree = effects
      .filter((item) =>
        item.operation.file === remove.operation.file
        && item.operation !== remove.operation
        && targetContains(remove.effect.target, item.effect.target)
        && (scalarEffectKinds.has(item.effect.kind) || structuralEffectKinds.has(item.effect.kind))
      )
      .map((item) => item.operation);
    pending.push(pendingGroup({
      file: remove.operation.file,
      target: remove.effect.target,
      targetKey: effectTargetKey(remove.effect),
      operations: [remove.operation, ...operationsForRemovedSubtree],
      traces: [remove.trace, ...effects.filter((item) => operationsForRemovedSubtree.includes(item.operation)).map((item) => item.trace)],
      effects: [remove.effect, ...effects.filter((item) => operationsForRemovedSubtree.includes(item.operation)).map((item) => item.effect)],
      exact: true,
      source: "replay",
      classification: "structural-mask",
      kind: "structural-mask",
      confidence: "proven",
      orderDependent: true
    }));
  }

  const missed = trace.filter((item) => item.status === "missed");
  for (const miss of missed) {
    const missedOperation = operationByTraceId.get(miss.id);
    if (!missedOperation) continue;
    const missTarget = miss.effects.find((effect) => effect.kind === "miss")?.target ?? normalizeXpath(miss.xpath);
    if (miss.diagnosticKind === "order-induced-miss") {
      const removers = removes
        .filter((item) => item.operation.file === miss.file && item.operation.order < miss.order && targetContains(item.effect.target, missTarget))
        .map((item) => item.operation);
      pending.push(pendingGroup({
        file: miss.file,
        target: missTarget,
        targetKey: miss.effects[0]?.targetKey ?? `miss:${miss.file}:${missTarget}`,
        operations: [...removers, missedOperation],
        traces: [miss],
        effects: miss.effects,
        exact: true,
        source: "replay",
        classification: "order-induced-miss",
        kind: "order-induced-miss",
        confidence: "proven",
        orderDependent: true
      }));
    } else if (miss.diagnosticKind === "dependency-order-miss") {
      const creators = effects
        .filter((item) =>
          item.operation.file === miss.file
          && item.operation.order > miss.order
          && (item.effect.kind === "appendChild" || item.effect.kind === "insertBefore" || item.effect.kind === "insertAfter")
          && futureStructuralMayCreate(item.effect, missTarget)
        )
        .map((item) => item.operation);
      pending.push(pendingGroup({
        file: miss.file,
        target: missTarget,
        targetKey: miss.effects[0]?.targetKey ?? `miss:${miss.file}:${missTarget}`,
        operations: [missedOperation, ...creators],
        traces: [miss],
        effects: miss.effects,
        exact: false,
        source: "replay",
        classification: "dependency-order-miss",
        kind: "dependency-order-miss",
        confidence: "likely",
        orderDependent: true
      }));
    }
  }

  return pending;
}

function detectFootprintConflicts(operations: XmlPatchOperation[]): PendingGroup[] {
  const footprints = extractPatchFootprints(operations).filter((footprint) => footprint.precision === "supported" || footprint.precision === "broad");
  const pending: PendingGroup[] = [];

  const scalarBySlot = new Map<string, PatchFootprint[]>();
  for (const footprint of footprints) {
    for (const slot of footprint.writtenScalarSlots) {
      pushMap(scalarBySlot, selectorKey(slot), footprint);
    }
  }
  for (const [key, matches] of scalarBySlot) {
    const [file, target] = splitKey(key);
    pending.push(pendingGroup({
      file,
      target,
      targetKey: `footprint:${file}:${target}`,
      operations: matches.map((match) => match.operation),
      traces: [],
      effects: [],
      exact: false,
      source: "footprint",
      classification: "unknown-risk",
      kind: "unknown-risk",
      confidence: "unknown",
      orderDependent: true
    }));
  }

  for (const remover of footprints) {
    for (const removed of remover.removedNodeSelectors) {
      const operationsForTarget: XmlPatchOperation[] = [remover.operation];
      for (const writer of footprints) {
        if (writer.operation === remover.operation || writer.file !== remover.file) continue;
        if (writer.writtenScalarSlots.some((slot) => normalizedContains(removed.normalizedXpath, slot.normalizedXpath))) {
          operationsForTarget.push(writer.operation);
        }
        if (writer.insertedChildSlots.some((slot) => normalizedContains(removed.normalizedXpath, slot.normalizedXpath) || normalizedContains(slot.normalizedXpath, removed.normalizedXpath))) {
          operationsForTarget.push(writer.operation);
        }
      }
      pending.push(pendingGroup({
        file: remover.file,
        target: removed.normalizedXpath,
        targetKey: `footprint:${remover.file}:${removed.normalizedXpath}`,
        operations: operationsForTarget,
        traces: [],
        effects: [],
        exact: false,
        source: "footprint",
        classification: "structural-mask",
        kind: "structural-mask",
        confidence: "likely",
        orderDependent: true
      }));
    }
  }

  return pending;
}

function detectNormalizedXpathConflicts(operations: XmlPatchOperation[]): PendingGroup[] {
  const groups = new Map<string, XmlPatchOperation[]>();

  for (const operation of operations) {
    if (!operation.xpath || operation.operation === "parse-error") {
      continue;
    }
    pushMap(groups, `${operation.file}\0${normalizeXpath(operation.xpath)}`, operation);
  }

  return [...groups.entries()].map(([key, list]) => {
    const [file, target] = splitKey(key);
    return pendingGroup({
      file,
      target,
      targetKey: `normalized:${file}:${target}`,
      operations: list,
      traces: [],
      effects: [],
      exact: new Set(list.map((item) => item.xpath)).size === 1,
      source: "normalized" as const,
      classification: "unknown-risk",
      kind: "unknown-risk",
      confidence: "unknown",
      orderDependent: true
    });
  });
}

function materializeGroups(pending: PendingGroup[]): MaterializedGroup[] {
  const byOperationSet = new Map<string, PendingGroup>();
  const acceptedOperationSetsBySource = new Map<string, ConflictSource[]>();
  const orderedPending = [...pending].sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source));
  for (const group of orderedPending) {
    const operations = uniqueOperations(group.operations).sort((a, b) => a.order - b.order);
    if (!hasMultipleMods(operations)) continue;
    const operationSetKey = operations.map(operationKey).join("\0");
    const acceptedSources = acceptedOperationSetsBySource.get(operationSetKey) ?? [];
    if (group.source !== "replay" && acceptedSources.some((source) => sourcePriority(source) < sourcePriority(group.source))) {
      continue;
    }
    const key = `${group.file}\0${group.target}\0${operationSetKey}`;
    const existing = byOperationSet.get(key);
    if (!existing || sourcePriority(group.source) < sourcePriority(existing.source) || (group.exact && !existing.exact)) {
      byOperationSet.set(key, { ...group, operations });
      acceptedOperationSetsBySource.set(operationSetKey, [...acceptedSources, group.source]);
    }
  }

  return [...byOperationSet.values()]
    .map((group, index) => {
      const operations = uniqueOperations(group.operations).sort((a, b) => a.order - b.order);
      const primary = operations[operations.length - 1];
      const operationIds = operations.map(operationId);
      const evidence = evidenceFor(group, operations);
      const diagnosticGroup: DiagnosticGroup = {
        id: `dg${index + 1}`,
        file: group.file,
        kind: group.kind,
        classification: group.classification,
        risk: riskForGroup(group),
        confidence: group.confidence,
        proof: proofForGroup(group),
        targetKey: group.targetKey,
        displayTarget: group.target,
        operationIds,
        normalizedXpath: group.target,
        primaryOpId: operationId(primary),
        relatedOpIds: operationIds.slice(0, -1),
        source: group.source,
        orderDependent: group.orderDependent,
      };
      return { group: diagnosticGroup, operations, evidence };
    })
    .sort((a, b) => a.group.file.localeCompare(b.group.file) || a.group.normalizedXpath.localeCompare(b.group.normalizedXpath));
}

function pendingGroup(group: PendingGroup): PendingGroup {
  return group;
}

function effectTargetKey(effect: PatchTraceEffect): string {
  return effect.targetKey ?? effect.provenance?.slotKey ?? effect.provenance?.childSlot ?? effect.target;
}

function displayTarget(effect: PatchTraceEffect): string {
  return effect.displayTarget ?? effect.target;
}

function classifyScalarEffects(effects: PatchTraceEffect[]): DiagnosticClassification {
  const kinds = new Set(effects.map((effect) => effect.kind));
  if (kinds.has("removeAttribute") && (kinds.has("setAttribute") || kinds.has("appendAttributeText"))) return "slot-order-dependent";
  if (kinds.has("appendAttributeText") && (kinds.has("setAttribute") || kinds.has("setValue"))) return "slot-order-dependent";
  return "silent-overwrite";
}

function riskForGroup(group: PendingGroup): DiagnosticGroup["risk"] {
  if (group.kind === "order-induced-miss" || group.kind === "parse-error") return "critical";
  if (group.classification === "structural-mask") return "critical";
  if (group.classification === "silent-overwrite") return "danger";
  if (group.classification === "slot-order-dependent" || group.classification === "dependency-order-miss") return "warn";
  if (group.classification === "sibling-order-dependent") return "warn";
  if (group.classification === "unsupported-operation" || group.classification === "unknown-risk") return "info";
  return group.exact ? "warn" : "info";
}

function evidenceFor(group: PendingGroup, operations: XmlPatchOperation[]): DiagnosticEvidence[] {
  const tracesByOperation = new Map(group.traces.map((trace) => [traceOperationKey(trace), trace]));
  return operations.map((operation) => {
    const trace = tracesByOperation.get(operationKey(operation));
    const effects = trace?.effects ?? [];
    return {
      opId: operationId(operation),
      effects,
      matchEvents: trace ? [{
        opId: operationId(operation),
        targetKey: trace.affectedTargets[0]?.canonical ?? effects[0]?.targetKey,
        displayTarget: trace.affectedTargets[0]?.canonical ?? effects[0]?.displayTarget ?? effects[0]?.target ?? operation.xpath,
        matchKind: trace.status === "missed" ? "miss" : trace.status === "unsupported" ? "unsupported" : trace.status === "parseError" ? "parseError" : trace.affectedTargets[0]?.kind === "attribute" ? "attribute" : "node",
        cardinality: trace.matchCountBefore,
        confidence: trace.confidence,
        note: trace.message
      }] : [],
      slotVersions: slotVersionsFor(operation, effects),
      note: trace?.message
    };
  });
}

function slotVersionsFor(operation: XmlPatchOperation, effects: PatchTraceEffect[]): SlotVersion[] {
  return effects
    .filter((effect) => scalarEffectKinds.has(effect.kind) && (effect.before != null || effect.after != null))
    .map((effect) => ({
      slotKey: effectTargetKey(effect),
      opId: operationId(operation),
      before: effect.before,
      after: effect.after,
      displayTarget: displayTarget(effect)
    }));
}

function operationId(operation: XmlPatchOperation): string {
  return `${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`;
}

function candidateFallbackOperations(operations: XmlPatchOperation[]): XmlPatchOperation[] {
  const byFile = new Map<string, XmlPatchOperation[]>();
  for (const operation of operations) pushMap(byFile, operation.file, operation);
  return [...byFile.values()].filter(hasMultipleMods).flat();
}

function replayCandidates(operations: XmlPatchOperation[], pending: PendingGroup[]): XmlPatchOperation[] {
  const ids = new Set<OperationKey>();
  for (const group of pending) {
    for (const operation of group.operations) ids.add(operationKey(operation));
  }
  if (ids.size === 0) {
    for (const operation of candidateFallbackOperations(operations)) ids.add(operationKey(operation));
  }
  return operations.filter((operation) => ids.has(operationKey(operation)));
}

function proofForGroup(group: PendingGroup): DiagnosticGroup["proof"] {
  if (group.source === "replay" && group.exact) return "exact";
  if (group.source === "footprint") return "footprint";
  if (group.source === "budget") return "partial";
  return "fallback";
}

function coverageFor(
  operations: XmlPatchOperation[],
  replayOperations: XmlPatchOperation[],
  trace: PatchTrace[],
  groups: DiagnosticGroup[],
  warnings: ConflictDetectionResult["warnings"]
): ReplayCoverage {
  const replayed = new Set(trace.filter((item) => item.status !== "partial").map(traceOperationKey));
  const partial = new Set(trace.filter((item) => item.status === "partial").map(traceOperationKey));
  return {
    totalOperations: operations.length,
    candidateOperations: replayOperations.length,
    replayedOperations: replayed.size,
    partialOperations: partial.size,
    skippedOperations: Math.max(0, replayOperations.length - replayed.size - partial.size),
    candidateGroups: groups.length,
    exactGroups: groups.filter((group) => group.proof === "exact").length,
    footprintGroups: groups.filter((group) => group.proof === "footprint").length,
    fallbackGroups: groups.filter((group) => group.proof === "fallback").length,
    budgetGroups: groups.filter((group) => group.proof === "partial").length,
    warnings
  };
}

function replayEffects(trace: PatchTrace[], operationByTraceId: Map<string, XmlPatchOperation>): OperationEffect[] {
  const items: OperationEffect[] = [];
  for (const item of trace) {
    const operation = operationByTraceId.get(item.id);
    if (!operation) continue;
    for (const effect of item.effects) {
      items.push({ operation, trace: item, effect });
    }
  }
  return items;
}

function mapOperationsByTraceId(operations: XmlPatchOperation[]): Map<string, XmlPatchOperation> {
  const result = new Map<string, XmlPatchOperation>();
  for (const operation of operations) {
    result.set(`${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`, operation);
  }
  return result;
}

function selectorKey(selector: PatchFootprintSelector): string {
  const target = selector.kind === "attribute" ? `${selector.normalizedXpath}/@${selector.attribute ?? ""}` : `${selector.normalizedXpath}:${selector.kind}`;
  return `${selector.file}\0${target}`;
}

function splitKey(key: string): [string, string] {
  const index = key.indexOf("\0");
  return [key.slice(0, index), key.slice(index + 1)];
}

function operationKey(operation: XmlPatchOperation): OperationKey {
  return `${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`;
}

function traceOperationKey(trace: PatchTrace): OperationKey {
  return `${trace.file}:${trace.order}:${trace.line}:${trace.operation}:${trace.xpath}`;
}

function hasMultipleMods(operations: XmlPatchOperation[]): boolean {
  return new Set(operations.map((operation) => operation.modName)).size > 1;
}

function uniqueOperations(operations: XmlPatchOperation[]): XmlPatchOperation[] {
  const result: XmlPatchOperation[] = [];
  const seen = new Set<OperationKey>();
  for (const operation of operations) {
    const key = operationKey(operation);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(operation);
  }
  return result;
}

function targetContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function normalizedContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function futureStructuralMayCreate(effect: PatchTraceEffect, missTarget: string): boolean {
  if (effect.kind === "appendChild") {
    return targetContains(effect.target, missTarget) || targetContains(parentTarget(missTarget), effect.target);
  }
  const parent = parentTarget(effect.target);
  return targetContains(parent, missTarget) || targetContains(parentTarget(missTarget), parent);
}

function parentTarget(target: string): string {
  const trimmed = target.replace(/\/@[\w.-]+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) return trimmed;
  return trimmed.slice(0, index);
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function sourcePriority(source: ConflictSource): number {
  if (source === "replay") return 0;
  if (source === "footprint") return 1;
  if (source === "normalized") return 2;
  return 3;
}
