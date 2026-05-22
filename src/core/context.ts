import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextPack, DiagnosticGroup, PatchTrace, PatchTraceEffect, XmlPatchOperation } from "./types.js";
import { scanMo2 } from "./scanner.js";
import { scanLatestClientLog } from "./logs.js";
import { defaultGameInstallPath, TraceOptions } from "./patchTrace.js";
import { detectConflicts } from "./conflicts.js";

export async function buildContextPack(
  mo2Path: string,
  profile: string,
  gamePath = defaultGameInstallPath(),
  traceOptions: TraceOptions = {}
): Promise<ContextPack> {
  const scan = await scanMo2(mo2Path, profile);
  const detection = await detectConflicts(scan.xmlPatches, gamePath, traceOptions);
  return compactContextPack({
    generatedAt: new Date().toISOString(),
    scan: {
      ...scan,
      xmlPatches: scan.xmlPatches.map(compactOperation),
      warnings: [...scan.warnings, ...detection.warnings]
    },
    trace: detection.trace.map(compactTrace),
    diagnosticGroups: detection.diagnosticGroups.map(compactDiagnosticGroup),
    conflicts: detection.conflicts.map(compactDiagnosticGroup),
    logs: await scanLatestClientLog(undefined, scan.enabledMods)
  });
}

export async function writeContextPack(filePath: string, pack: ContextPack): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
}

const maxInlineText = 2_000;
const maxGroupOperations = 80;

function compactContextPack(pack: ContextPack): ContextPack {
  return pack;
}

function compactDiagnosticGroup(group: DiagnosticGroup): DiagnosticGroup {
  const operations = group.operations.map(compactOperation);
  const cappedOperations = operations.length > maxGroupOperations
    ? [...operations.slice(0, maxGroupOperations / 2), ...operations.slice(-maxGroupOperations / 2)]
    : operations;
  const cappedOperationIds = group.operationIds.length > maxGroupOperations
    ? [...group.operationIds.slice(0, maxGroupOperations / 2), ...group.operationIds.slice(-maxGroupOperations / 2)]
    : group.operationIds;
  const cappedOperationKeys = new Set(cappedOperationIds);
  return {
    ...group,
    operations: cappedOperations,
    operationIds: cappedOperationIds,
    relatedOpIds: group.relatedOpIds.filter((opId) => cappedOperationKeys.has(opId)),
    evidence: group.evidence
      .filter((item) => cappedOperationKeys.has(item.opId) || item.opId === group.primaryOpId)
      .map((item) => ({
        ...item,
        effects: item.effects.map(compactEffect),
        slotVersions: item.slotVersions.map((slot) => ({
          ...slot,
          before: compactText(slot.before),
          after: compactText(slot.after)
        })),
        note: compactText(item.note)
      })),
    winner: compactOperation(group.winner)
  };
}

function compactTrace(trace: PatchTrace): PatchTrace {
  return {
    ...trace,
    affectedTargets: trace.affectedTargets.map((target) => ({ ...target, value: compactText(target.value) })),
    effects: trace.effects.map(compactEffect),
    message: compactText(trace.message)
  };
}

function compactEffect(effect: PatchTraceEffect): PatchTraceEffect {
  return {
    ...effect,
    before: compactText(effect.before),
    after: compactText(effect.after),
    value: compactText(effect.value),
    summary: compactText(effect.summary)
  };
}

function compactOperation(operation: XmlPatchOperation): XmlPatchOperation {
  return {
    ...operation,
    valueText: compactText(operation.valueText),
    valueSummary: compactText(operation.valueSummary)
  };
}

function compactText(value: string | undefined): string | undefined {
  if (value == null || value.length <= maxInlineText) return value;
  return `${value.slice(0, maxInlineText)}... [truncated ${value.length - maxInlineText} chars]`;
}
