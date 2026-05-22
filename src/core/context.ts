import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextPack, DiagnosticGroup, ModRoot, PatchTrace, PatchTraceEffect, XmlPatchOperation } from "./types.js";
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
  const operationsById = Object.fromEntries(Object.entries(detection.operationsById).map(([opId, operation]) => [opId, compactOperation(operation)]));
  return compactContextPack({
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    scan: {
      ...scan,
      xmlPatches: scan.xmlPatches.map(compactOperation),
      warnings: [...scan.warnings, ...detection.warnings]
    },
    trace: detection.trace.map(compactTrace),
    diagnosticGroups: detection.diagnosticGroups.map(compactDiagnosticGroup),
    operationsById,
    modsById: modsById(scan.enabledMods),
    filesById: filesById(scan.xmlPatches),
    replayEvidenceByGroupId: compactReplayEvidence(detection.replayEvidenceByGroupId),
    coverage: detection.coverage,
    logs: await scanLatestClientLog(undefined, scan.enabledMods)
  });
}

export async function writeContextPack(filePath: string, pack: ContextPack): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
}

const maxInlineText = 2_000;

function compactContextPack(pack: ContextPack): ContextPack {
  return pack;
}

function compactDiagnosticGroup(group: DiagnosticGroup): DiagnosticGroup {
  return {
    ...group,
    operationIds: group.operationIds,
    relatedOpIds: group.relatedOpIds
  };
}

function compactReplayEvidence(value: ContextPack["replayEvidenceByGroupId"]): ContextPack["replayEvidenceByGroupId"] {
  return Object.fromEntries(Object.entries(value).map(([groupId, item]) => [groupId, {
    ...item,
    evidence: item.evidence.map((evidence) => ({
      ...evidence,
      effects: evidence.effects.map(compactEffect),
      slotVersions: evidence.slotVersions.map((slot) => ({
        ...slot,
        before: compactText(slot.before),
        after: compactText(slot.after)
      })),
      note: compactText(evidence.note)
    }))
  }]));
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

function modsById(mods: ModRoot[]): ContextPack["modsById"] {
  return Object.fromEntries(mods.map((mod) => [mod.mo2Name, mod]));
}

function filesById(operations: XmlPatchOperation[]): ContextPack["filesById"] {
  const files = new Map<string, { path: string; operationIds: string[]; modIds: string[] }>();
  for (const operation of operations) {
    const current = files.get(operation.file) ?? { path: operation.file, operationIds: [], modIds: [] };
    current.operationIds.push(operationId(operation));
    if (!current.modIds.includes(operation.modName)) current.modIds.push(operation.modName);
    files.set(operation.file, current);
  }
  return Object.fromEntries(files);
}

function operationId(operation: XmlPatchOperation): string {
  return `${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`;
}

function compactText(value: string | undefined): string | undefined {
  if (value == null || value.length <= maxInlineText) return value;
  return `${value.slice(0, maxInlineText)}... [truncated ${value.length - maxInlineText} chars]`;
}
