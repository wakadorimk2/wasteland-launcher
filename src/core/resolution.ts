import { DiagnosticGroup, ScanWarning, XmlPatchOperation } from "./types.js";
import { buildPatchTrace, defaultGameInstallPath, TraceOptions } from "./patchTrace.js";

export type ResolveOptions = TraceOptions;

export { defaultGameInstallPath };

export async function resolveConflicts(
  diagnosticGroups: DiagnosticGroup[],
  operations: XmlPatchOperation[],
  gamePath = defaultGameInstallPath(),
  options: ResolveOptions = {}
): Promise<{ diagnosticGroups: DiagnosticGroup[]; warnings: ScanWarning[] }> {
  const replay = await buildPatchTrace(operations, gamePath, options);
  return { diagnosticGroups, warnings: replay.warnings };
}
