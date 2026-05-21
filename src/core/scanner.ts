import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { DllInfo, ModRoot, ScanResult, XmlPatchOperation } from "./types.js";
import { listFiles, pathExists, fileSizeAndMtime, sha256File } from "./files.js";
import { modsPath, modlistPath, toPosixRelative } from "./paths.js";
import { readModlist } from "./modlist.js";
import { parseXmlFile } from "./xml.js";

const patchOperations = new Set(["append", "set", "setattribute", "remove", "removeattribute", "insertBefore", "insertAfter", "csv"]);
const serializer = new XMLSerializer();

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
    const text = await readFile(file, "utf8");
    try {
      operations.push(...extractPatchOperationsFromText(mod, configPath, file, text));
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
    }
  }

  return operations;
}

function extractPatchOperationsFromText(mod: ModRoot, configPath: string, file: string, text: string): XmlPatchOperation[] {
  const document = parsePatchDocument(text);
  const elements = Array.from(document.getElementsByTagName("*"));
  const output: XmlPatchOperation[] = [];
  let searchFrom = 0;

  for (const element of elements) {
    const operation = element.tagName;
    if (!patchOperations.has(operation)) {
      continue;
    }
    const xpath = element.getAttribute("xpath") ?? element.getAttribute("path") ?? "";
    const openTagIndex = findOpenTag(text, operation, searchFrom);
    if (openTagIndex >= 0) {
      searchFrom = openTagIndex + 1;
    }
    const value = extractPatchValue(operation, element);
    output.push({
      modName: mod.mo2Name,
      displayName: mod.displayName,
      order: mod.order,
      file: toPosixRelative(configPath, file),
      path: file,
      operation,
      xpath,
      line: openTagIndex >= 0 ? lineNumberAt(text, openTagIndex) : 1,
      attributes: extractAttributes(element),
      valueKind: value.kind,
      valueText: value.text,
      valueSummary: value.summary
    });
  }

  return output;
}

function parsePatchDocument(text: string): ReturnType<DOMParser["parseFromString"]> {
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (_level: string, message: string) => errors.push(message)
  }).parseFromString(stripBom(text), "text/xml");
  if (errors.length > 0 || !document.documentElement) {
    throw new Error(errors.join("; ") || "no document element");
  }
  return document;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function extractAttributes(element: any): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < (element.attributes?.length ?? 0); index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) {
      attributes[attribute.name] = attribute.value;
    }
  }
  return attributes;
}

function extractPatchValue(operation: string, element: any): { kind: XmlPatchOperation["valueKind"]; text?: string; summary?: string } {
  if (operation === "remove" || operation === "removeattribute") {
    return { kind: "target", summary: "remove target" };
  }
  if (operation === "set" || operation === "setattribute" || operation === "csv") {
    const text = (element.textContent ?? "").trim();
    return { kind: text ? "text" : "empty", text, summary: summarizeValue(text) };
  }
  const fragments = Array.from(element.childNodes)
    .filter((node: any) => node.nodeType === 1)
    .map((node) => serializer.serializeToString(node as any))
    .join("");
  if (!fragments.trim()) {
    return { kind: "empty", text: "", summary: "(empty)" };
  }
  const children = Array.from(element.childNodes).filter((node: any) => node.nodeType === 1) as any[];
  return { kind: "xml", text: fragments, summary: summarizeXmlChildren(children, fragments) };
}

function summarizeXmlChildren(children: any[], fallbackXml: string): string {
  const labels = children.slice(0, 3).map((child) => {
    const name = child.getAttribute("name") ?? child.getAttribute("id");
    return name ? `<${child.tagName} ${name}>` : `<${child.tagName}>`;
  });
  const suffix = children.length > labels.length ? ` +${children.length - labels.length}` : "";
  return labels.length > 0 ? `${labels.join(", ")}${suffix}` : summarizeValue(fallbackXml);
}

function summarizeValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function findOpenTag(text: string, tagName: string, from: number): number {
  const pattern = new RegExp(`<\\s*${escapeRegExp(tagName)}\\b`, "g");
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match?.index ?? -1;
}

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
