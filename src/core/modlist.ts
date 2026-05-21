import { readFile } from "node:fs/promises";
import { ModlistEntry } from "./types.js";

export async function readModlist(filePath: string): Promise<ModlistEntry[]> {
  const text = await readFile(filePath, "utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: ModlistEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("#")) {
      continue;
    }

    const prefix = raw[0];
    const name = raw.slice(1);
    if (prefix !== "+" && prefix !== "-") {
      continue;
    }

    const state = name.endsWith("_separator")
      ? "separator"
      : prefix === "+"
        ? "enabled"
        : "disabled";

    const entry: ModlistEntry = {
      raw,
      name,
      state,
      line: index + 1
    };

    entries.push(entry);
  }

  let order = entries.filter((entry) => entry.state === "enabled").length - 1;
  for (const entry of entries) {
    if (entry.state === "enabled") {
      entry.order = order;
      order -= 1;
    }
  }

  return entries;
}
