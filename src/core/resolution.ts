import { ConflictGroup, ScanWarning, XmlPatchOperation } from "./types.js";
import { buildPatchTrace, defaultGameInstallPath, TraceOptions } from "./patchTrace.js";

export type ResolveOptions = TraceOptions;

export { defaultGameInstallPath };

export async function resolveConflicts(
  conflicts: ConflictGroup[],
  operations: XmlPatchOperation[],
  gamePath = defaultGameInstallPath(),
  options: ResolveOptions = {}
): Promise<{ conflicts: ConflictGroup[]; warnings: ScanWarning[] }> {
  const replay = await buildPatchTrace(operations, gamePath, options);
  return { conflicts, warnings: replay.warnings };
}
