#!/usr/bin/env node
import { Command } from "commander";
import { buildContextPack, writeContextPack } from "./core/context.js";
import { detectConflicts } from "./core/conflicts.js";
import { scanLatestClientLog } from "./core/logs.js";
import { defaultMo2Path, defaultProfile } from "./core/paths.js";
import { scanMo2 } from "./core/scanner.js";
import { ModRoot } from "./core/types.js";
import { readContextPack, renderVisualization, writeHtmlReport } from "./core/visualize.js";

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
  .action(async (options) => {
    const scan = await scanMo2(options.mo2, options.profile);
    const mode = options.resolveMode === "exact" ? "exact" : "fast";
    const timeoutMs = Number.parseInt(options.resolveTimeoutMs, 10);
    const detection = await detectConflicts(scan.xmlPatches, options.game, {
      mode,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000
    });
    if (wantsJson(options)) {
      printJson(detection.conflicts);
      return;
    }
    printConflicts(detection.conflicts);
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
  .action(async (options) => {
    const mode = options.resolveMode === "exact" ? "exact" : "fast";
    const timeoutMs = Number.parseInt(options.resolveTimeoutMs, 10);
    const pack = await buildContextPack(options.mo2, options.profile, options.game, {
      mode,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 8000,
      tracePath: options.traceResolve
    });
    if (options.out) {
      await writeContextPack(options.out, pack);
      console.log(`Wrote ${options.out}`);
      return;
    }
    printJson(pack);
  });

program.command("visualize")
  .description("Render a static HTML conflict dashboard from a context-pack JSON file")
  .requiredOption("--input <path>", "read context-pack JSON from this path")
  .option("--out <path>", "write HTML to this path; stdout when omitted")
  .action(async (options) => {
    const pack = await readContextPack(options.input);
    const html = renderVisualization(pack);
    if (options.out) {
      await writeHtmlReport(options.out, html);
      console.log(`Wrote ${options.out}`);
      return;
    }
    console.log(html);
  });

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
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

function printConflicts(conflicts: Awaited<ReturnType<typeof detectConflicts>>["conflicts"]): void {
  console.log(`Conflict groups: ${conflicts.length}`);
  console.table(conflicts.slice(0, 120).map((group) => ({
    file: group.file,
    xpath: group.normalizedXpath,
    mods: [...new Set(group.operations.map((operation) => operation.modName))].join(" -> "),
    winner: group.winner.modName,
    exact: group.exact
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
