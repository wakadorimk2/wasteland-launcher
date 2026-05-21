import path from "node:path";
import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { PatchTrace, PatchTraceEffect, PatchTraceTarget, ScanWarning, XmlPatchOperation } from "./types.js";
import { pathExists } from "./files.js";

const defaultGamePath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\7 Days To Die";
const serializer = new XMLSerializer();
const keyAttributes = ["name", "id", "class", "type", "value"];

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
type DomNode = any;

export interface TraceOptions {
  mode?: "fast" | "exact";
  tracePath?: string;
  timeoutMs?: number;
}

export function defaultGameInstallPath(): string {
  return defaultGamePath;
}

export async function buildPatchTrace(operations: XmlPatchOperation[], gamePath = defaultGamePath, options: TraceOptions = {}): Promise<{ trace: PatchTrace[]; warnings: ScanWarning[] }> {
  const trace: PatchTrace[] = [];
  const warnings: ScanWarning[] = [];
  const byFile = groupBy(operations, (operation) => operation.file);
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 8_000;

  for (const [file, fileOperations] of byFile) {
    if (budgetExpired(startedAt, timeoutMs)) {
      pushBudgetSkipped(trace, warnings, file, sortOperations(fileOperations));
      continue;
    }
    const vanillaPath = path.join(gamePath, "Data", "Config", file);
    if (!(await pathExists(vanillaPath))) {
      for (const operation of sortOperations(fileOperations)) {
        const item = baseTrace(operation, "missed", 0, [], [{ kind: "miss", target: operation.xpath, summary: "vanilla file missing" }], "xpath-miss", "low");
        item.message = `Vanilla XML file was not found: ${file}`;
        trace.push(item);
      }
      warnings.push({ kind: "trace-missing-vanilla", message: `Vanilla XML file was not found: ${file}`, path: file });
      continue;
    }

    let document: XmlDocument;
    try {
      document = parseXml(await readFile(vanillaPath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const operation of sortOperations(fileOperations)) {
        const item = baseTrace(operation, "parseError", 0, [], [{ kind: "parseError", target: operation.xpath, summary: message }], "parse-error", "low");
        item.message = message;
        trace.push(item);
      }
      warnings.push({ kind: "trace-parse-error", message: `Could not parse vanilla XML ${file}: ${message}`, path: file });
      continue;
    }

    const previouslyRemoved = new Set<string>();
    const previousScalarWrites = new Set<string>();
    const futureAdds = collectFutureAdds(fileOperations);
    const sortedOperations = sortOperations(fileOperations);
    for (const [index, operation] of sortedOperations.entries()) {
      if (budgetExpired(startedAt, timeoutMs)) {
        pushBudgetSkipped(trace, warnings, file, sortedOperations.slice(index));
        break;
      }
      const item = replayOperation(document, operation, previouslyRemoved, futureAdds, previousScalarWrites);
      trace.push(item);
      for (const effect of item.effects) {
        if (effect.kind === "removeNode") {
          previouslyRemoved.add(effect.target);
        }
        if (effect.kind === "setValue" || effect.kind === "setAttribute" || effect.kind === "removeAttribute" || effect.kind === "appendAttributeText") {
          previousScalarWrites.add(effect.target);
        }
      }
      if (item.diagnosticKind !== "ok") {
        warnings.push({ kind: `trace-${item.diagnosticKind}`, message: item.message ?? `${operation.operation} ${operation.xpath}: ${item.diagnosticKind}`, modName: operation.modName, path: operation.file });
      }
    }
  }

  return { trace, warnings };
}

function budgetExpired(startedAt: number, timeoutMs: number): boolean {
  return Date.now() - startedAt > timeoutMs;
}

function pushBudgetSkipped(trace: PatchTrace[], warnings: ScanWarning[], file: string, operations: XmlPatchOperation[]): void {
  if (operations.length === 0) return;
  const message = `Patch trace replay budget exceeded; ${operations.length} operation(s) left as partial diagnostics for ${file}`;
  warnings.push({ kind: "trace-budget-exceeded", message, path: file });
  for (const operation of operations) {
    trace.push(baseTrace(operation, "partial", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: message }], "unsupported-operation", "low", message));
  }
}

function replayOperation(document: XmlDocument, operation: XmlPatchOperation, previouslyRemoved: Set<string>, futureAdds: Set<string>, previousScalarWrites: Set<string>): PatchTrace {
  if (operation.operation === "parse-error") {
    return baseTrace(operation, "parseError", 0, [], [{ kind: "parseError", target: operation.path, summary: "patch XML parse error" }], "parse-error", "low");
  }
  if (/^csv$/i.test(operation.operation)) {
    return baseTrace(operation, "unsupported", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: "csv replay is not implemented in v0.2" }], "unsupported-operation", "high", "csv replay is not implemented in v0.2");
  }

  let selected: DomNode[];
  try {
    selected = selectNodes(document, operation.xpath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return baseTrace(operation, "unsupported", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: message }], "unsupported-operation", "low", message);
  }

  const matchCount = selected.length;
  if (matchCount === 0) {
    const canonical = canonicalFromXpath(operation.xpath);
    const diagnosticKind = wasRemovedByEarlierPatch(previouslyRemoved, canonical) ? "order-induced-miss" : futureAddsXpathMayCreate(futureAdds, operation.xpath) ? "dependency-order-miss" : "xpath-miss";
    return baseTrace(operation, "missed", 0, [], [{ kind: "miss", target: canonical, summary: diagnosticKind }], diagnosticKind, "high", diagnosticKind);
  }

  const targets = selected.map((node) => targetFor(node, operation.xpath));
  const effects: PatchTraceEffect[] = [];
  const op = operation.operation.toLowerCase();

  for (const node of selected) {
    const target = targetFor(node, operation.xpath);
    if (op === "set") {
      effects.push(applySet(node, target, operation));
    } else if (op === "setattribute") {
      effects.push(applySetAttribute(node, target, operation));
    } else if (op === "removeattribute") {
      effects.push(applyRemoveAttribute(node, target, operation));
    } else if (op === "append") {
      effects.push(applyAppend(document, node, target, operation));
    } else if (op === "remove") {
      effects.push(applyRemove(node, target));
    } else if (op === "insertbefore" || op === "insertafter") {
      effects.push(applyInsert(document, node, target, operation, op === "insertbefore"));
    } else {
      effects.push({ kind: "unsupported", target: target.canonical, summary: `${operation.operation} replay is not implemented` });
    }
  }

  const diagnosticKind = effects.some((effect) => effect.kind === "unsupported")
    ? "unsupported-operation"
    : matchCount > 1
      ? "broad-match-risk"
      : overwritesPreviousScalar(effects, previousScalarWrites) ? "silent-overwrite" : "ok";
  const status = diagnosticKind === "unsupported-operation" ? "unsupported" : matchCount > 1 ? "ambiguous" : "applied";
  return baseTrace(operation, status, matchCount, targets, effects, diagnosticKind, matchCount > 1 ? "medium" : "high", diagnosticKind === "ok" ? undefined : diagnosticKind);
}

function applySet(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation): PatchTraceEffect {
  const value = operation.valueText ?? "";
  if (node.nodeType === 2) {
    const before = node.value ?? "";
    node.value = value;
    return { kind: "setAttribute", target: target.canonical, before, after: value, value };
  }
  const before = node.textContent ?? "";
  node.textContent = value;
  return { kind: "setValue", target: target.canonical, before, after: value, value };
}

function applySetAttribute(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation): PatchTraceEffect {
  const attr = operation.attributes?.name ?? operation.attributes?.attribute ?? attributeNameFromXpath(operation.xpath) ?? "value";
  const value = operation.attributes?.value ?? operation.valueText ?? "";
  const element = node.nodeType === 2 ? node.ownerElement : node;
  const before = element.getAttribute(attr) ?? undefined;
  element.setAttribute(attr, value);
  return { kind: "setAttribute", target: `${target.nodeRef}/@${attr}`, before, after: value, value };
}

function applyRemoveAttribute(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation): PatchTraceEffect {
  const attr = operation.attributes?.name ?? operation.attributes?.attribute ?? attributeNameFromXpath(operation.xpath) ?? "value";
  const element = node.nodeType === 2 ? node.ownerElement : node;
  const before = element.getAttribute(attr) ?? undefined;
  element.removeAttribute(attr);
  return { kind: "removeAttribute", target: `${target.nodeRef}/@${attr}`, before, after: undefined };
}

function applyAppend(document: XmlDocument, node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation): PatchTraceEffect {
  if (node.nodeType === 2) {
    const before = node.value ?? "";
    const after = `${before}${operation.valueText ?? ""}`;
    node.value = after;
    return { kind: "appendAttributeText", target: target.canonical, before, after, value: operation.valueSummary ?? operation.valueText };
  }
  const nodes = fragmentNodes(document, operation.valueText);
  for (const child of nodes) {
    node.appendChild(child);
  }
  return { kind: "appendChild", target: target.canonical, value: operation.valueSummary ?? operation.valueText, summary: `${nodes.length} child node(s)` };
}

function applyRemove(node: DomNode, target: PatchTraceTarget): PatchTraceEffect {
  const before = node.nodeType === 2 ? node.value : serializer.serializeToString(node);
  if (node.nodeType === 2) {
    node.ownerElement?.removeAttribute(node.name);
  } else {
    node.parentNode?.removeChild(node);
  }
  return { kind: "removeNode", target: target.canonical, before };
}

function applyInsert(document: XmlDocument, node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, before: boolean): PatchTraceEffect {
  const nodes = fragmentNodes(document, operation.valueText);
  const parent = node.parentNode;
  if (!parent) {
    return { kind: "unsupported", target: target.canonical, summary: "target has no parent" };
  }
  for (const child of nodes) {
    parent.insertBefore(child, before ? node : node.nextSibling);
  }
  return { kind: before ? "insertBefore" : "insertAfter", target: target.canonical, value: operation.valueSummary ?? operation.valueText, summary: `${nodes.length} sibling node(s)` };
}

function baseTrace(
  operation: XmlPatchOperation,
  status: PatchTrace["status"],
  matchCountBefore: number,
  affectedTargets: PatchTraceTarget[],
  effects: PatchTraceEffect[],
  diagnosticKind: PatchTrace["diagnosticKind"],
  confidence: PatchTrace["confidence"],
  message?: string
): PatchTrace {
  return {
    id: `${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`,
    modName: operation.modName,
    displayName: operation.displayName,
    order: operation.order,
    file: operation.file,
    path: operation.path,
    line: operation.line,
    operation: operation.operation,
    xpath: operation.xpath,
    status,
    matchCountBefore,
    affectedTargets,
    effects,
    confidence,
    diagnosticKind,
    message
  };
}

function parseXml(text: string): XmlDocument {
  const errors: string[] = [];
  const document = new DOMParser({ onError: (_level: string, message: string) => errors.push(message) }).parseFromString(text.replace(/^\uFEFF/, ""), "text/xml");
  if (errors.length > 0 || !document.documentElement) {
    throw new Error(errors.join("; ") || "no document element");
  }
  return document;
}

function selectNodes(document: XmlDocument, expression: string): DomNode[] {
  const result = xpath.select(expression, document as any);
  return Array.isArray(result) ? result as DomNode[] : [];
}

function targetFor(node: DomNode, fallbackXpath: string): PatchTraceTarget {
  if (node.nodeType === 2) {
    const owner = node.ownerElement;
    const nodeRef = canonicalElement(owner, fallbackXpath);
    return { canonical: `${nodeRef}/@${node.name}`, nodeRef, kind: "attribute", value: node.value };
  }
  const nodeRef = canonicalElement(node, fallbackXpath);
  return { canonical: nodeRef, nodeRef, kind: "element", value: textSummary(node.textContent ?? "") };
}

function canonicalElement(node: DomNode, fallbackXpath: string): string {
  if (!node || node.nodeType !== 1) return canonicalFromXpath(fallbackXpath);
  const parts: string[] = [];
  let current: DomNode | null = node;
  while (current && current.nodeType === 1) {
    parts.unshift(elementSegment(current));
    current = current.parentNode;
  }
  return `/${parts.join("/")}`;
}

function elementSegment(node: DomNode): string {
  for (const attr of keyAttributes) {
    const value = node.getAttribute?.(attr);
    if (value) return `${node.tagName}[@${attr}='${value}']`;
  }
  const ordinal = siblingOrdinal(node);
  return ordinal > 1 ? `${node.tagName}[${ordinal}]` : node.tagName;
}

function siblingOrdinal(node: DomNode): number {
  let ordinal = 1;
  let cursor = node.previousSibling;
  while (cursor) {
    if (cursor.nodeType === 1 && cursor.tagName === node.tagName) ordinal += 1;
    cursor = cursor.previousSibling;
  }
  return ordinal;
}

function canonicalFromXpath(xpathValue: string): string {
  return xpathValue.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

function attributeNameFromXpath(xpathValue: string): string | undefined {
  return /\/@([\w.-]+)$/.exec(xpathValue)?.[1];
}

function fragmentNodes(document: XmlDocument, text: string | undefined): DomNode[] {
  if (!text?.trim()) return [];
  const fragment = parseXml(`<__root>${text}</__root>`);
  const nodes = Array.from(fragment.documentElement!.childNodes).filter((node: any) => node.nodeType === 1) as DomNode[];
  return nodes.map((node) => document.importNode ? document.importNode(node, true) : node.cloneNode(true));
}

function collectFutureAdds(operations: XmlPatchOperation[]): Set<string> {
  const additions = new Set<string>();
  for (const operation of operations) {
    if (!/^(append|insertBefore|insertAfter)$/i.test(operation.operation)) continue;
    for (const name of [...(operation.valueText ?? "").matchAll(/\b(?:name|id|class|type|value)=["']([^"']+)["']/g)].map((match) => match[1])) {
      additions.add(name);
    }
  }
  return additions;
}

function futureAddsXpathMayCreate(futureAdds: Set<string>, xpathValue: string): boolean {
  for (const name of futureAdds) {
    if (xpathValue.includes(`'${name}'`) || xpathValue.includes(`"${name}"`)) return true;
  }
  return false;
}

function wasRemovedByEarlierPatch(previouslyRemoved: Set<string>, canonical: string): boolean {
  for (const removed of previouslyRemoved) {
    if (canonical === removed || canonical.startsWith(`${removed}/`)) return true;
  }
  return false;
}

function overwritesPreviousScalar(effects: PatchTraceEffect[], previousScalarWrites: Set<string>): boolean {
  return effects.some((effect) => (effect.kind === "setValue" || effect.kind === "setAttribute") && previousScalarWrites.has(effect.target) && effect.before !== effect.after);
}

function textSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function sortOperations(operations: XmlPatchOperation[]): XmlPatchOperation[] {
  return [...operations].sort((a, b) => a.order - b.order || a.line - b.line || a.modName.localeCompare(b.modName));
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }
  return map;
}
