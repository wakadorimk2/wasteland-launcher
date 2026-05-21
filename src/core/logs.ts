import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { appDataLogsPath } from "./paths.js";
import { LogScanResult, ModRoot } from "./types.js";

const warningPattern = /(?:^|\s)(?:ERR|WRN)(?:\s|$)|XPath|XML patch|ModInfo\.xml|Exception/i;

export async function scanLatestClientLog(logsPath = appDataLogsPath(), mods: ModRoot[] = []): Promise<LogScanResult> {
  if (!logsPath) {
    return { warnings: [] };
  }

  let entries;
  try {
    entries = await readdir(logsPath, { withFileTypes: true });
  } catch {
    return { warnings: [] };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^output_log_client__.*\.txt$/i.test(entry.name)) {
      continue;
    }
    const fullPath = path.join(logsPath, entry.name);
    const info = await stat(fullPath);
    if (info.size > 0) {
      candidates.push({ path: fullPath, mtime: info.mtimeMs });
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  const latest = candidates[0];
  if (!latest) {
    return { warnings: [] };
  }

  const text = await readFile(latest.path, "utf8");
  const lines = text.split(/\r?\n/);
  const knownNames = [...new Set(mods.flatMap((mod) => [mod.mo2Name, mod.displayName]).filter((name) => name.length >= 3))];
  const warnings = lines
    .map((lineText, index) => ({ lineText, index }))
    .filter(({ lineText }) => warningPattern.test(lineText))
    .map(({ lineText, index }) => ({
      path: latest.path,
      line: index + 1,
      text: lineText,
      relatedMods: knownNames.filter((name) => includesLoose(lineText, name))
    }));

  return {
    latestLogPath: latest.path,
    warnings
  };
}

function includesLoose(text: string, name: string): boolean {
  const normalizedText = normalizeName(text);
  const normalizedName = normalizeName(name);
  return normalizedName.length >= 3 && normalizedText.includes(normalizedName);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
