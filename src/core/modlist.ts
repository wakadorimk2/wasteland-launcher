import { readFile } from "node:fs/promises";
import { ModlistEntry } from "./types.js";

export async function readModlist(filePath: string): Promise<ModlistEntry[]> {
  const text = await readFile(filePath, "utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let order = 0;
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

    if (state === "enabled") {
      entry.order = order;
      order += 1;
    }

    entries.push(entry);
  }

  return entries;
}
