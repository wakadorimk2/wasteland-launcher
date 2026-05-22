#!/usr/bin/env node
import { Command } from "commander";
import { buildContextPack, writeContextPack } from "./core/context.js";
import { detectConflicts } from "./core/conflicts.js";
import { scanLatestClientLog } from "./core/logs.js";
import { defaultMo2Path, defaultProfile } from "./core/paths.js";
import { PatchTraceProgress } from "./core/patchTrace.js";
import { scanMo2 } from "./core/scanner.js";
import { ModRoot } from "./core/types.js";

const program = new Command();

program
  .name("wasteland")
  .description("Read-only diagnostics for 7 Days to Die MO2 mod workspaces")
  .option("--json", "print JSON output");

function addMo2Options(command: Command): Command {
  return command
    .option("--mo2 <path>", "MO2 workspace path", defaultMo2Path)
    .option("--profile <name>", "MO2 profile name", defaultProfile)
    .option("--json", "print JSON output");
}

function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || program.opts().json);
}

addMo2Options(program.command("scan").description("Scan enabled mods, ModInfo, XML patches, and DLLs"))
  .action(async (options) => {
    const scan = await scanMo2(options.mo2, options.profile);
    if (wantsJson(options)) {
      printJson(scan);
      return;
    }
    printScan(scan);
  });

addMo2Options(program.command("conflicts").description("Report XML patch conflicts"))
  .option("--game <path>", "7 Days to Die install path for vanilla Data/Config resolution")
  .option("--resolve-mode <mode>", "conflict resolution mode: fast or exact", "fast")
  .option("--resolve-timeout-ms <ms>", "best-effort conflict resolution budget in milliseconds", "8000")
  .option("--trace-profile <path>", "write replay performance profile JSON to this path")
  .option("--no-progress", "disable terminal progress output")
  .action(async (options) => {
    const scan = await scanMo2(options.mo2, options.profile);
    const mode = options.resolveMode === "exact" ? "exact" : "fast";
    const timeoutMs = Number.parseInt(options.resolveTimeoutMs, 10);
    const progress = createProgressReporter(options.progress !== false && !wantsJson(options));
    const detection = await withProgress(progress, () => detectConflicts(scan.xmlPatches, options.game, {
        mode,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000,
        traceProfilePath: options.traceProfile,
        onProgress: progress.onProgress
      }));
    if (wantsJson(options)) {
      printJson(detection.diagnosticGroups);
      return;
    }
    printConflicts(detection.diagnosticGroups, detection.operationsById);
  });

addMo2Options(program.command("logs")
  .description("Inspect 7DTD client logs")
  .option("--latest", "inspect latest non-empty client log", true))
  .action(async (options) => {
    let mods: ModRoot[] = [];
    try {
      mods = (await scanMo2(options.mo2, options.profile)).enabledMods;
    } catch {
      mods = [];
    }
    const result = await scanLatestClientLog(undefined, mods);
    if (wantsJson(options)) {
      printJson(result);
      return;
    }
    printLogs(result);
  });

addMo2Options(program.command("inventory").description("List enabled mod inventory"))
  .option("--waka", "show only Waka/high-Z local patch style mods")
  .action(async (options) => {
    const scan = await scanMo2(options.mo2, options.profile);
    const mods = options.waka
      ? scan.enabledMods.filter((mod) => /waka/i.test(mod.mo2Name) || /waka/i.test(mod.displayName))
      : scan.enabledMods;
    const payload = { mo2Path: scan.mo2Path, profile: scan.profile, mods };
    if (wantsJson(options)) {
      printJson(payload);
      return;
    }
    printInventory(mods);
  });

addMo2Options(program.command("context-pack").description("Build an LLM-friendly diagnostics JSON pack"))
  .option("--game <path>", "7 Days to Die install path for vanilla Data/Config resolution")
  .option("--out <path>", "write JSON to this path; stdout when omitted")
  .option("--resolve-mode <mode>", "conflict resolution mode: fast or exact", "fast")
  .option("--resolve-timeout-ms <ms>", "best-effort conflict resolution budget in milliseconds", "8000")
  .option("--trace-resolve <path>", "write conflict resolution trace JSONL to this path")
  .option("--trace-profile <path>", "write replay performance profile JSON to this path")
  .option("--no-progress", "disable terminal progress output")
  .action(async (options) => {
    const mode = options.resolveMode === "exact" ? "exact" : "fast";
    const timeoutMs = Number.parseInt(options.resolveTimeoutMs, 10);
    const progress = createProgressReporter(options.progress !== false && Boolean(options.out));
    const pack = await withProgress(progress, () => buildContextPack(options.mo2, options.profile, options.game, {
        mode,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000,
        tracePath: options.traceResolve,
        traceProfilePath: options.traceProfile,
        onProgress: progress.onProgress
      }));
    if (options.out) {
      await writeContextPack(options.out, pack);
      console.log(`Wrote ${options.out}`);
      return;
    }
    printJson(pack);
  });

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function withProgress<T>(progress: { finish: () => void }, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    progress.finish();
  }
}

function createProgressReporter(enabled: boolean): { onProgress?: (progress: PatchTraceProgress) => void; finish: () => void } {
  if (!enabled || !process.stderr.isTTY) return { finish: () => undefined };
  const width = 28;
  let lastRenderAt = 0;
  let lastLineLength = 0;
  let active = false;

  const render = (progress: PatchTraceProgress, force = false): void => {
    const now = Date.now();
    if (!force && progress.phase === "operation" && now - lastRenderAt < 100) return;
    lastRenderAt = now;
    active = true;

    const total = Math.max(progress.totalOperations, 1);
    const processed = Math.min(progress.processedOperations, total);
    const ratio = processed / total;
    const filled = Math.min(width, Math.floor(ratio * width));
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const percent = String(Math.floor(ratio * 100)).padStart(3, " ");
    const filePart = progress.file && progress.fileIndex && progress.fileCount
      ? ` file ${progress.fileIndex}/${progress.fileCount} ${progress.file}`
      : "";
    const fileOps = progress.fileOperations != null && progress.fileProcessed != null
      ? ` (${progress.fileProcessed}/${progress.fileOperations})`
      : "";
    const elapsed = formatDuration(progress.elapsedMs);
    const message = progress.message ? ` - ${progress.message}` : "";
    const line = `[${bar}] ${percent}% ${processed}/${progress.totalOperations}${filePart}${fileOps} elapsed ${elapsed}${message}`;
    const padding = " ".repeat(Math.max(0, lastLineLength - line.length));
    process.stderr.write(`\r${line}${padding}`);
    lastLineLength = line.length;
    if (progress.phase === "done") {
      process.stderr.write("\n");
      active = false;
    }
  };

  return {
    onProgress: (progress) => render(progress, progress.phase !== "operation"),
    finish: () => {
      if (active) process.stderr.write("\n");
      active = false;
    }
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function printScan(scan: Awaited<ReturnType<typeof scanMo2>>): void {
  console.log(`MO2: ${scan.mo2Path}`);
  console.log(`Profile: ${scan.profile}`);
  console.log(`Enabled mod roots: ${scan.enabledMods.length}`);
  console.log(`XML patch operations: ${scan.xmlPatches.length}`);
  console.log(`DLL files: ${scan.dlls.length}`);
  if (scan.missingEnabledMods.length > 0) {
    console.log(`Missing enabled mods: ${scan.missingEnabledMods.join(", ")}`);
  }
  console.table(scan.enabledMods.slice(0, 80).map((mod) => ({
    order: mod.order,
    mo2: mod.mo2Name,
    name: mod.displayName,
    version: mod.version ?? "",
    dlls: scan.dlls.filter((dll) => dll.modName === mod.mo2Name && dll.displayName === mod.displayName && dll.order === mod.order).length,
    patches: scan.xmlPatches.filter((patch) => patch.modName === mod.mo2Name && patch.displayName === mod.displayName && patch.order === mod.order).length
  })));
}

function printConflicts(
  diagnosticGroups: Awaited<ReturnType<typeof detectConflicts>>["diagnosticGroups"],
  operationsById: Awaited<ReturnType<typeof detectConflicts>>["operationsById"]
): void {
  console.log(`Diagnostic groups: ${diagnosticGroups.length}`);
  console.table(diagnosticGroups.slice(0, 120).map((group) => ({
    file: group.file,
    target: group.displayTarget,
    classification: group.classification,
    confidence: group.confidence,
    proof: group.proof,
    risk: group.risk,
    mods: [...new Set(group.operationIds.map((opId) => operationsById[opId]?.modName ?? opId))].join(" -> "),
    primary: operationsById[group.primaryOpId]?.modName ?? group.primaryOpId,
    source: group.source
  })));
}

function printLogs(result: Awaited<ReturnType<typeof scanLatestClientLog>>): void {
  console.log(`Latest log: ${result.latestLogPath ?? "(none)"}`);
  console.log(`Warnings: ${result.warnings.length}`);
  console.table(result.warnings.slice(0, 120).map((warning) => ({
    line: warning.line,
    relatedMods: warning.relatedMods.join(", "),
    text: warning.text.slice(0, 180)
  })));
}

function printInventory(mods: Awaited<ReturnType<typeof scanMo2>>["enabledMods"]): void {
  console.log(`Mods: ${mods.length}`);
  console.table(mods.map((mod) => ({
    order: mod.order,
    mo2: mod.mo2Name,
    name: mod.displayName,
    root: mod.rootPath
  })));
}

await program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
