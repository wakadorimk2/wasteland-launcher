import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ContextPack } from "./types.js";
import { scanMo2 } from "./scanner.js";
import { detectConflicts } from "./conflicts.js";
import { scanLatestClientLog } from "./logs.js";

export async function buildContextPack(mo2Path: string, profile: string): Promise<ContextPack> {
  const scan = await scanMo2(mo2Path, profile);
  return {
    generatedAt: new Date().toISOString(),
    scan,
    conflicts: detectConflicts(scan.xmlPatches),
    logs: await scanLatestClientLog(undefined, scan.enabledMods)
  };
}

export async function writeContextPack(filePath: string, pack: ContextPack): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
}
