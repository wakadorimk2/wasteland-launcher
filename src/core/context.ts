import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextPack } from "./types.js";
import { scanMo2 } from "./scanner.js";
import { scanLatestClientLog } from "./logs.js";
import { buildPatchTrace, defaultGameInstallPath, TraceOptions } from "./patchTrace.js";

export async function buildContextPack(
  mo2Path: string,
  profile: string,
  gamePath = defaultGameInstallPath(),
  traceOptions: TraceOptions = {}
): Promise<ContextPack> {
  const scan = await scanMo2(mo2Path, profile);
  const replay = await buildPatchTrace(scan.xmlPatches, gamePath, traceOptions);
  return {
    generatedAt: new Date().toISOString(),
    scan: {
      ...scan,
      warnings: [...scan.warnings, ...replay.warnings]
    },
    trace: replay.trace,
    conflicts: [],
    logs: await scanLatestClientLog(undefined, scan.enabledMods)
  };
}

export async function writeContextPack(filePath: string, pack: ContextPack): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
}
