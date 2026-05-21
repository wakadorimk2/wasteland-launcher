import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { DllInfo, ModRoot, ScanResult, XmlPatchOperation } from "./types.js";
import { listFiles, pathExists, fileSizeAndMtime, sha256File } from "./files.js";
import { modsPath, modlistPath, toPosixRelative } from "./paths.js";
import { readModlist } from "./modlist.js";
import { parseXmlFile, readXmlAttribute } from "./xml.js";

const patchOperations = new Set(["append", "set", "remove", "insertBefore", "insertAfter"]);

export async function scanMo2(mo2Path: string, profile: string): Promise<ScanResult> {
  const listPath = modlistPath(mo2Path, profile);
  const entries = await readModlist(listPath);
  const enabledEntries = entries.filter((entry) => entry.state === "enabled");
  const enabledMods: ModRoot[] = [];
  const missingEnabledMods: string[] = [];
  const warnings: ScanResult["warnings"] = [];

  for (const entry of enabledEntries) {
    const roots = await resolveModRoots(mo2Path, entry.name, entry.order ?? 0);
    if (roots.length === 0) {
      missingEnabledMods.push(entry.name);
      warnings.push({ kind: "missing-mod", message: `Enabled mod folder was not found or has no ModInfo.xml: ${entry.name}`, modName: entry.name });
      continue;
    }
    enabledMods.push(...roots);
  }

  const xmlPatches: XmlPatchOperation[] = [];
  const dlls: DllInfo[] = [];

  for (const mod of enabledMods) {
    const [modPatches, modDlls] = await Promise.all([
      extractXmlPatches(mod),
      findDlls(mod)
    ]);
    xmlPatches.push(...modPatches);
    dlls.push(...modDlls);
  }

  return {
    mo2Path,
    profile,
    modlistPath: listPath,
    entries,
    enabledMods,
    missingEnabledMods,
    xmlPatches,
    dlls,
    warnings
  };
}

async function resolveModRoots(mo2Path: string, mo2Name: string, order: number): Promise<ModRoot[]> {
  const folderPath = path.join(modsPath(mo2Path), mo2Name);
  if (!(await pathExists(folderPath))) {
    return [];
  }

  const directModInfo = path.join(folderPath, "ModInfo.xml");
  if (await pathExists(directModInfo)) {
    return [await buildModRoot(mo2Name, folderPath, directModInfo, order)];
  }

  const children = await readdir(folderPath, { withFileTypes: true });
  const roots: ModRoot[] = [];
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const childPath = path.join(folderPath, child.name);
    const childModInfo = path.join(childPath, "ModInfo.xml");
    if (await pathExists(childModInfo)) {
      roots.push(await buildModRoot(mo2Name, childPath, childModInfo, order));
    }
  }
  return roots.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

async function buildModRoot(mo2Name: string, rootPath: string, modInfoPath: string, order: number): Promise<ModRoot> {
  let displayName = path.basename(rootPath);
  let version: string | undefined;
  let author: string | undefined;

  try {
    const parsed = await parseXmlFile(modInfoPath) as Record<string, unknown>;
    const info = parsed.ModInfo as Record<string, unknown> | undefined;
    displayName = readModInfoValue(info, "Name") ?? displayName;
    version = readModInfoValue(info, "Version");
    author = readModInfoValue(info, "Author");
  } catch {
    displayName = path.basename(rootPath);
  }

  return { mo2Name, displayName, rootPath, modInfoPath, order, version, author };
}

function readModInfoValue(info: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = info?.[key];
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "@_value" in value) {
    const attrValue = (value as Record<string, unknown>)["@_value"];
    return typeof attrValue === "string" ? attrValue : undefined;
  }
  return undefined;
}

async function extractXmlPatches(mod: ModRoot): Promise<XmlPatchOperation[]> {
  const configPath = path.join(mod.rootPath, "Config");
  if (!(await pathExists(configPath))) {
    return [];
  }
  const files = await listFiles(configPath, (filePath) => path.extname(filePath).toLowerCase() === ".xml");
  const operations: XmlPatchOperation[] = [];

  for (const file of files) {
    try {
      await parseXmlFile(file);
    } catch {
      operations.push({
        modName: mod.mo2Name,
        displayName: mod.displayName,
        order: mod.order,
        file: toPosixRelative(configPath, file),
        path: file,
        operation: "parse-error",
        xpath: "",
        line: 1
      });
      continue;
    }

    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const openTag = /<\s*([A-Za-z][\w.-]*)\b[^>]*>/g;
      let match: RegExpExecArray | null;
      while ((match = openTag.exec(lineText)) !== null) {
        const operation = match[1];
        if (!patchOperations.has(operation)) {
          continue;
        }
        const tagText = match[0];
        const xpath = readXmlAttribute(tagText, "xpath") ?? readXmlAttribute(tagText, "path") ?? "";
        operations.push({
          modName: mod.mo2Name,
          displayName: mod.displayName,
          order: mod.order,
          file: toPosixRelative(configPath, file),
          path: file,
          operation,
          xpath,
          line: index + 1
        });
      }
    });
  }

  return operations;
}

async function findDlls(mod: ModRoot): Promise<DllInfo[]> {
  const files = await listFiles(mod.rootPath, (filePath) => path.extname(filePath).toLowerCase() === ".dll");
  const out: DllInfo[] = [];

  for (const file of files) {
    const [meta, hash] = await Promise.all([fileSizeAndMtime(file), sha256File(file)]);
    out.push({
      modName: mod.mo2Name,
      displayName: mod.displayName,
      order: mod.order,
      path: toPosixRelative(mod.rootPath, file),
      fileName: path.basename(file),
      size: meta.size,
      mtime: meta.mtime,
      sha256: hash
    });
  }

  return out;
}
