import { ConflictGroup, XmlPatchOperation } from "./types.js";

export function detectConflicts(operations: XmlPatchOperation[]): ConflictGroup[] {
  const groups = new Map<string, XmlPatchOperation[]>();

  for (const operation of operations) {
    if (!operation.xpath || operation.operation === "parse-error") {
      continue;
    }
    const key = `${operation.file}\0${normalizeXpath(operation.xpath)}`;
    const list = groups.get(key) ?? [];
    list.push(operation);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const [file, normalizedXpath] = key.split("\0");
      const uniqueMods = new Set(list.map((item) => item.modName));
      if (uniqueMods.size < 2) {
        return undefined;
      }
      const sorted = [...list].sort((a, b) => a.order - b.order);
      const exact = new Set(list.map((item) => item.xpath)).size === 1;
      return {
        file,
        normalizedXpath,
        operations: sorted,
        winner: sorted[sorted.length - 1],
        exact
      } satisfies ConflictGroup;
    })
    .filter((group): group is ConflictGroup => Boolean(group))
    .sort((a, b) => a.file.localeCompare(b.file) || a.normalizedXpath.localeCompare(b.normalizedXpath));
}

export function normalizeXpath(xpath: string): string {
  return xpath
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\[\s*@name\s*=\s*(['"])(.*?)\1\s*\]/g, "[@name='$2']")
    .replace(/\[\s*@id\s*=\s*(['"])(.*?)\1\s*\]/g, "[@id='$2']")
    .replace(/\[\s*\d+\s*\]/g, "[]")
    .replace(/\/@[\w.-]+$/g, "")
    .toLowerCase();
}
