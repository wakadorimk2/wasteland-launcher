import { buildPatchTrace, defaultGameInstallPath, TraceOptions } from "./patchTrace.js";
import { extractPatchFootprints, PatchFootprint, PatchFootprintSelector } from "./footprint.js";
import { ConflictDetectionResult, ConflictGroup, PatchTrace, PatchTraceEffect, XmlPatchOperation } from "./types.js";
import { normalizeXpath } from "./xpath.js";

type ConflictSource = "replay" | "footprint" | "normalized";
type OperationKey = string;

interface OperationEffect {
  operation: XmlPatchOperation;
  trace: PatchTrace;
  effect: PatchTraceEffect;
}

interface PendingGroup {
  file: string;
  target: string;
  operations: XmlPatchOperation[];
  exact: boolean;
  source: ConflictSource;
}

const scalarEffectKinds = new Set<PatchTraceEffect["kind"]>(["setValue", "setAttribute", "removeAttribute", "appendAttributeText"]);
const structuralEffectKinds = new Set<PatchTraceEffect["kind"]>(["removeNode", "appendChild", "insertBefore", "insertAfter"]);
const fallbackTraceStatuses = new Set<PatchTrace["status"]>(["missed", "unsupported", "parseError", "partial"]);

export async function detectConflicts(
  operations: XmlPatchOperation[],
  gamePath = defaultGameInstallPath(),
  options: TraceOptions = {}
): Promise<ConflictDetectionResult> {
  const replay = await buildPatchTrace(operations, gamePath, options);
  const operationByTraceId = mapOperationsByTraceId(operations);
  const pending: PendingGroup[] = [];

  pending.push(...detectReplayConflicts(replay.trace, operationByTraceId));

  const fallbackOperations = operationsNeedingFallback(operations, replay.trace);
  pending.push(...detectFootprintConflicts(fallbackOperations));
  pending.push(...detectNormalizedXpathConflicts(fallbackOperations));

  return {
    conflicts: materializeGroups(pending),
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
    const key = `${item.operation.file}\0${item.effect.target}`;
    if (scalarEffectKinds.has(item.effect.kind)) {
      pushMap(scalarByTarget, key, item);
    } else if (structuralEffectKinds.has(item.effect.kind)) {
      pushMap(structuralByTarget, key, item);
    }
  }

  for (const [key, items] of scalarByTarget) {
    const [file, target] = splitKey(key);
    pending.push({ file, target, operations: items.map((item) => item.operation), exact: true, source: "replay" });
  }
  for (const [key, items] of structuralByTarget) {
    const [file, target] = splitKey(key);
    pending.push({ file, target, operations: items.map((item) => item.operation), exact: true, source: "replay" });
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
    pending.push({
      file: remove.operation.file,
      target: remove.effect.target,
      operations: [remove.operation, ...operationsForRemovedSubtree],
      exact: true,
      source: "replay"
    });
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
      pending.push({ file: miss.file, target: missTarget, operations: [...removers, missedOperation], exact: true, source: "replay" });
    } else if (miss.diagnosticKind === "dependency-order-miss") {
      const creators = effects
        .filter((item) =>
          item.operation.file === miss.file
          && item.operation.order > miss.order
          && (item.effect.kind === "appendChild" || item.effect.kind === "insertBefore" || item.effect.kind === "insertAfter")
          && futureStructuralMayCreate(item.effect, missTarget)
        )
        .map((item) => item.operation);
      pending.push({ file: miss.file, target: missTarget, operations: [missedOperation, ...creators], exact: false, source: "replay" });
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
    pending.push({ file, target, operations: matches.map((match) => match.operation), exact: false, source: "footprint" });
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
      pending.push({ file: remover.file, target: removed.normalizedXpath, operations: operationsForTarget, exact: false, source: "footprint" });
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
    return {
      file,
      target,
      operations: list,
      exact: new Set(list.map((item) => item.xpath)).size === 1,
      source: "normalized" as const
    };
  });
}

function materializeGroups(pending: PendingGroup[]): ConflictGroup[] {
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
    .map((group) => {
      const operations = uniqueOperations(group.operations).sort((a, b) => a.order - b.order);
      return {
        file: group.file,
        normalizedXpath: group.target,
        operations,
        winner: operations[operations.length - 1],
        exact: group.exact
      } satisfies ConflictGroup;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.normalizedXpath.localeCompare(b.normalizedXpath));
}

function operationsNeedingFallback(operations: XmlPatchOperation[], trace: PatchTrace[]): XmlPatchOperation[] {
  const fallbackKeys = new Set<OperationKey>();
  for (const item of trace) {
    if (fallbackTraceStatuses.has(item.status) || item.effects.some((effect) => effect.kind === "unsupported" || effect.kind === "parseError" || effect.kind === "miss")) {
      fallbackKeys.add(traceOperationKey(item));
    }
  }
  return operations.filter((operation) => fallbackKeys.has(operationKey(operation)));
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
  return 2;
}
