import path from "node:path";
import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { ConflictGroup, ConflictResolution, ConflictResolutionStep, ScanWarning, XmlPatchOperation } from "./types.js";
import { pathExists } from "./files.js";
import { normalizeXpath } from "./conflicts.js";
import { ResolveTracer, hashXPath, shortXPath } from "./resolutionTrace.js";

const defaultGamePath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\7 Days To Die";
const serializer = new XMLSerializer();
const detailedElementChildLimit = 40;
const broadStructuralChildLimit = 200;
const largeFragmentLengthLimit = 20_000;
const relatedOperationExpansionLimit = 500;
const candidateResolutionLimit = 80;
const elementIndexCache = new WeakMap<object, ElementIndex>();

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
type DomNode = any;
type XPathCache = Map<string, DomNode[]>;
type ResolveMode = "fast" | "exact";

export interface ResolveOptions {
  mode?: ResolveMode;
  tracePath?: string;
  timeoutMs?: number;
}

interface RuntimeResolveOptions {
  mode: ResolveMode;
  tracer: ResolveTracer;
  startedAt: number;
  timeoutMs: number;
}

interface ElementIndex {
  byTag: Map<string, DomNode[]>;
  byTagAttrValue: Map<string, DomNode[]>;
}

interface SimpleXPathStep {
  tag: string;
  attrEquals: Array<{ name: string; value: string }>;
  attrContains: Array<{ name: string; value: string }>;
  childExists: Array<{ tag: string; attrEquals: Array<{ name: string; value: string }> }>;
}

interface ParsedSimpleXPath {
  descendant: boolean;
  steps: SimpleXPathStep[];
  attributeName?: string;
}

export function defaultGameInstallPath(): string {
  return defaultGamePath;
}

function performanceNow(): number {
  return Date.now();
}

function budgetExpired(options: RuntimeResolveOptions): boolean {
  return performanceNow() - options.startedAt > options.timeoutMs;
}

export async function resolveConflicts(
  conflicts: ConflictGroup[],
  operations: XmlPatchOperation[],
  gamePath = defaultGamePath,
  options: ResolveOptions = {}
): Promise<{ conflicts: ConflictGroup[]; warnings: ScanWarning[] }> {
  const warnings: ScanWarning[] = [];
  const runtime: RuntimeResolveOptions = {
    mode: options.mode ?? "fast",
    tracer: new ResolveTracer(options.tracePath),
    startedAt: performanceNow(),
    timeoutMs: options.timeoutMs ?? 8_000
  };
  const conflictsByFile = groupBy(conflicts, (conflict) => conflict.file);
  const operationsByFile = groupBy(
    operations.filter((operation) => operation.xpath && operation.operation !== "parse-error"),
    (operation) => operation.file
  );
  const resolvedByKey = new Map<string, ConflictGroup>();

  for (const [file, fileConflicts] of conflictsByFile) {
    if (budgetExpired(runtime)) {
      const message = `Resolution skipped because global budget expired (${runtime.timeoutMs}ms)`;
      warnings.push({ kind: "resolution-budget-exceeded", message, path: file });
      runtime.tracer.skip({ phase: "file.start", file, reason: message });
      for (const group of fileConflicts) {
        resolvedByKey.set(conflictKey(group), { ...group, resolution: unresolvedResolution(group, [message]) });
      }
      continue;
    }

    const fileStart = runtime.tracer.enter({
      phase: "file.start",
      file,
      fileOperationCount: operationsByFile.get(file)?.length ?? 0
    });
    const fileOperationsPool = operationsByFile.get(file) ?? [];
    if (fileOperationsPool.length > relatedOperationExpansionLimit) {
      const message = `Resolution skipped for large XML patch file (${fileOperationsPool.length} operations): ${file}`;
      warnings.push({ kind: "resolution-skipped-large-file", message, path: file });
      runtime.tracer.skip({ phase: "file.large", file, reason: message, fileOperationCount: fileOperationsPool.length });
      for (const group of fileConflicts) {
        resolvedByKey.set(conflictKey(group), { ...group, resolution: unresolvedResolution(group, [message]) });
      }
      runtime.tracer.leave(fileStart, { phase: "file.end", file });
      continue;
    }

    const fileOperations = candidateOperations(fileConflicts, fileOperationsPool);
    runtime.tracer.leave(fileStart, {
      phase: "file.prepareCandidates",
      file,
      fileOperationCount: fileOperationsPool.length,
      candidateOperationCount: fileOperations.length
    });
    if (fileOperations.length > candidateResolutionLimit) {
      const message = `Resolution skipped for broad conflict candidate set (${fileOperations.length} operations): ${file}`;
      warnings.push({ kind: "resolution-skipped-broad-candidates", message, path: file });
      runtime.tracer.skip({
        phase: "file.broadCandidates",
        file,
        reason: message,
        fileOperationCount: fileOperationsPool.length,
        candidateOperationCount: fileOperations.length
      });
      for (const group of fileConflicts) {
        resolvedByKey.set(conflictKey(group), { ...group, resolution: unresolvedResolution(group, [message]) });
      }
      runtime.tracer.leave(fileStart, { phase: "file.end", file });
      continue;
    }
    const vanillaPath = path.join(gamePath, "Data", "Config", pathFromPosix(file));
    const resolutionWarnings: string[] = [];

    if (!(await pathExists(vanillaPath))) {
      const message = `Vanilla config file was not found: ${vanillaPath}`;
      warnings.push({ kind: "resolution-missing-vanilla", message, path: file });
      for (const group of fileConflicts) {
        resolvedByKey.set(conflictKey(group), { ...group, resolution: unresolvedResolution(group, resolutionWarnings.concat(message)) });
      }
      continue;
    }

    let document: XmlDocument;
    try {
      document = parseDocument(await readFile(vanillaPath, "utf8"), vanillaPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({ kind: "resolution-parse-error", message, path: file });
      for (const group of fileConflicts) {
        resolvedByKey.set(conflictKey(group), { ...group, resolution: unresolvedResolution(group, resolutionWarnings.concat(message)) });
      }
      continue;
    }

    const trackedToGroups = new Map<string, ConflictGroup[]>();
    const histories = new Map<string, ConflictResolutionStep[]>();
    const vanillaValues = new Map<string, string | undefined>();
    const unresolvedGroups = new Set<string>();
    let xpathCache: XPathCache = new Map();
    const fragmentCache = new Map<string, DomNode[]>();

    for (const group of fileConflicts) {
      histories.set(conflictKey(group), []);
      vanillaValues.set(conflictKey(group), valueAt(document, group.winner.xpath || group.normalizedXpath, xpathCache, runtime, file));
      for (const operation of group.operations) {
        const key = operationKey(operation);
        const groups = trackedToGroups.get(key) ?? [];
        groups.push(group);
        trackedToGroups.set(key, groups);
      }
    }

    for (const operation of fileOperations) {
      const trackedGroups = trackedToGroups.get(operationKey(operation)) ?? [];
      const beforeValue = trackedGroups.length > 0 ? valueAt(document, operation.xpath, xpathCache, runtime, file) : undefined;
      const result = applyPatchOperation(document, operation, xpathCache, fragmentCache, runtime, file);
      if (!result.applied) {
        const message = `${operation.modName}: ${result.warning}`;
        resolutionWarnings.push(message);
        warnings.push({ kind: "resolution-unresolved", message, modName: operation.modName, path: file });
      }
      if (trackedGroups.length > 0) {
        xpathCache = new Map();
        elementIndexCache.delete(document as object);
        const afterValue = valueAt(document, operation.xpath, xpathCache, runtime, file);
        const step: ConflictResolutionStep = {
          modName: operation.modName,
          displayName: operation.displayName,
          order: operation.order,
          operation: operation.operation,
          xpath: operation.xpath,
          beforeValue,
          authoredValue: operation.valueSummary ?? operation.valueText,
          afterValue,
          status: result.applied ? "applied" : "unresolved",
          warning: result.warning
        };
        for (const group of trackedGroups) {
          histories.get(conflictKey(group))?.push(step);
          if (!result.applied) {
            unresolvedGroups.add(conflictKey(group));
          }
        }
      } else if (result.applied) {
        xpathCache = new Map();
        elementIndexCache.delete(document as object);
      }
    }

    for (const group of fileConflicts) {
      const key = conflictKey(group);
      const resolution: ConflictResolution = {
        status: unresolvedGroups.has(key) ? "unresolved" : "resolved",
        vanillaValue: vanillaValues.get(key),
        finalValue: valueAt(document, group.winner.xpath || group.normalizedXpath, xpathCache, runtime, file),
        finalSource: group.winner.modName,
        history: histories.get(key) ?? [],
        warnings: resolutionWarnings
      };
      resolvedByKey.set(key, { ...group, resolution });
    }
    runtime.tracer.leave(fileStart, { phase: "file.end", file });
  }

  return { conflicts: conflicts.map((conflict) => resolvedByKey.get(conflictKey(conflict)) ?? conflict), warnings };
}

function applyPatchOperation(
  document: XmlDocument,
  operation: XmlPatchOperation,
  xpathCache: XPathCache,
  fragmentCache: Map<string, DomNode[]>,
  options: RuntimeResolveOptions,
  file: string
): { applied: boolean; warning?: string } {
  let targets: DomNode[];
  try {
    targets = selectNodes(document, operation.xpath, xpathCache, options, file);
  } catch (error) {
    return { applied: false, warning: error instanceof Error ? error.message : String(error) };
  }
  if (targets.length === 0) {
    return { applied: false, warning: `XPath target was not found: ${operation.xpath}` };
  }

  switch (operation.operation) {
    case "set":
      for (const target of targets) {
        if (target.nodeType === 2) {
          target.nodeValue = operation.valueText ?? "";
        } else {
          target.textContent = operation.valueText ?? "";
        }
      }
      return { applied: true };
    case "remove":
      for (const target of targets) removeNode(target);
      return { applied: true };
    case "append": {
      const broadWarning = broadStructuralWarning(targets, operation);
      if (broadWarning) return { applied: false, warning: broadWarning };
      const fragments = safeFragmentNodes(document, operation, fragmentCache);
      if ("warning" in fragments) return { applied: false, warning: fragments.warning };
      if (fragments.length === 0) return { applied: false, warning: "Append operation has no XML fragment body" };
      for (const target of targets) {
        if (target.nodeType !== 1 && target.nodeType !== 9) continue;
        for (const fragment of fragments) target.appendChild(importClone(document, fragment));
      }
      return { applied: true };
    }
    case "insertBefore":
    case "insertAfter": {
      const broadWarning = broadStructuralWarning(targets, operation);
      if (broadWarning) return { applied: false, warning: broadWarning };
      const fragments = safeFragmentNodes(document, operation, fragmentCache);
      if ("warning" in fragments) return { applied: false, warning: fragments.warning };
      if (fragments.length === 0) return { applied: false, warning: `${operation.operation} operation has no XML fragment body` };
      for (const target of targets) {
        const parent = target.parentNode;
        if (!parent) continue;
        const before = operation.operation === "insertBefore" ? target : target.nextSibling;
        for (const fragment of fragments) parent.insertBefore(importClone(document, fragment), before);
      }
      return { applied: true };
    }
    default:
      return { applied: false, warning: `Unsupported XML patch operation: ${operation.operation}` };
  }
}

function broadStructuralWarning(targets: DomNode[], operation: XmlPatchOperation): string | undefined {
  const valueLength = operation.valueText?.length ?? 0;
  if (valueLength > largeFragmentLengthLimit) {
    return `${operation.operation} XML fragment is too large for lightweight resolution (${valueLength} chars)`;
  }
  for (const target of targets) {
    const childCount = Array.from(target.childNodes ?? []).filter((child: any) => child.nodeType === 1).length;
    if (childCount > broadStructuralChildLimit) {
      return `${operation.operation} target is too broad for lightweight resolution (${childCount} child elements)`;
    }
  }
  return undefined;
}

function safeFragmentNodes(
  document: XmlDocument,
  operation: XmlPatchOperation,
  fragmentCache: Map<string, DomNode[]>
): DomNode[] | { warning: string } {
  try {
    return fragmentNodes(document, operation, fragmentCache);
  } catch (error) {
    return { warning: error instanceof Error ? error.message : String(error) };
  }
}

function valueAt(
  document: XmlDocument,
  xpathText: string,
  xpathCache: XPathCache,
  options: RuntimeResolveOptions,
  file: string
): string | undefined {
  try {
    const nodes = selectNodes(document, xpathText, xpathCache, options, file);
    if (nodes.length === 0) return undefined;
    return summarizeNode(nodes[0]);
  } catch {
    return undefined;
  }
}

function selectNodes(
  document: XmlDocument,
  xpathText: string,
  xpathCache: XPathCache,
  options: RuntimeResolveOptions,
  file: string
): DomNode[] {
  const cached = xpathCache.get(xpathText);
  if (cached) return cached;
  const simple = selectSimpleNodes(document, xpathText);
  if (simple.ok) {
    xpathCache.set(xpathText, simple.nodes);
    return simple.nodes;
  }
  if (options.mode === "fast") {
    throw new Error(`Unsupported XPath in fast resolution: ${simple.reason}`);
  }
  const xpathHash = hashXPath(xpathText);
  const start = options.tracer.enter({
    phase: "xpath.nativeSelect",
    file,
    xpath: shortXPath(xpathText),
    xpathHash,
    xpathKind: "native"
  });
  const selected = xpath.select(xpathText, document as any);
  if (!Array.isArray(selected)) {
    xpathCache.set(xpathText, []);
    options.tracer.leave(start, {
      phase: "xpath.nativeSelect",
      file,
      xpath: shortXPath(xpathText),
      xpathHash,
      xpathKind: "native",
      targetCount: 0
    });
    return [];
  }
  const nodes = selected.filter((item): item is DomNode => typeof item === "object" && item != null && "nodeType" in item);
  xpathCache.set(xpathText, nodes);
  options.tracer.leave(start, {
    phase: "xpath.nativeSelect",
    file,
    xpath: shortXPath(xpathText),
    xpathHash,
    xpathKind: "native",
    targetCount: nodes.length
  });
  return nodes;
}

function selectSimpleNodes(document: XmlDocument, xpathText: string): { ok: true; nodes: DomNode[] } | { ok: false; reason: string } {
  const parsed = parseSimpleXPath(xpathText);
  if (!parsed.ok) return parsed;
  const index = cachedElementIndex(document);
  let current: DomNode[];

  if (parsed.value.descendant) {
    current = seedDescendantCandidates(index, parsed.value.steps[0]);
  } else {
    const root = document.documentElement;
    current = root && matchesSimpleStep(root, parsed.value.steps[0]) ? [root] : [];
  }

  for (const step of parsed.value.steps.slice(1)) {
    current = current.flatMap((node) => elementChildren(node).filter((child) => matchesSimpleStep(child, step)));
  }

  if (parsed.value.attributeName) {
    current = current
      .map((node) => node.getAttributeNode?.(parsed.value.attributeName))
      .filter((node): node is DomNode => Boolean(node));
  }

  return { ok: true, nodes: current };
}

function cachedElementIndex(document: XmlDocument): ElementIndex {
  const cached = elementIndexCache.get(document as object);
  if (cached) return cached;
  const index = buildElementIndex(document);
  elementIndexCache.set(document as object, index);
  return index;
}

function seedDescendantCandidates(index: ElementIndex, step: SimpleXPathStep): DomNode[] {
  const equality = step.attrEquals[0];
  const base = equality
    ? index.byTagAttrValue.get(tagAttrKey(step.tag, equality.name, equality.value)) ?? []
    : index.byTag.get(step.tag) ?? [];
  return base.filter((node) => matchesSimpleStep(node, step));
}

function parseSimpleXPath(xpathText: string): { ok: true; value: ParsedSimpleXPath } | { ok: false; reason: string } {
  const trimmed = xpathText.trim();
  if (!trimmed || trimmed.length > 512) return { ok: false, reason: "empty-or-too-long-xpath" };
  if (/[|*]|\.\.|following-|preceding-|ancestor-|text\(\)|last\(\)|position\(\)|starts-with\(|not\(|\bor\b/i.test(trimmed)) {
    return { ok: false, reason: "unsupported-xpath-syntax" };
  }
  const descendant = trimmed.startsWith("//");
  if (!descendant && !trimmed.startsWith("/")) return { ok: false, reason: "relative-xpath" };

  const parts = splitXPath(trimmed.replace(/^\/\//, "").replace(/^\//, ""));
  if (parts.length === 0) return { ok: false, reason: "no-xpath-steps" };
  let attributeName: string | undefined;
  const last = parts[parts.length - 1];
  if (last.startsWith("@")) {
    attributeName = last.slice(1);
    parts.pop();
  }
  if (parts.length === 0 || (attributeName && !/^[\w.-]+$/.test(attributeName))) {
    return { ok: false, reason: "invalid-attribute-target" };
  }

  const steps = parts.map(parseSimpleXPathStep);
  const failed = steps.find((step) => !step.ok);
  if (failed && !failed.ok) return { ok: false, reason: failed.reason };
  return { ok: true, value: { descendant, steps: steps.map((step) => (step as { ok: true; value: SimpleXPathStep }).value), attributeName } };
}

function parseSimpleXPathStep(part: string): { ok: true; value: SimpleXPathStep } | { ok: false; reason: string } {
  const match = /^([\w.-]+)(?:\[(.*)\])?$/.exec(part);
  if (!match) return { ok: false, reason: `unsupported-step:${part}` };
  const [, tag, predicateText] = match;
  const step: SimpleXPathStep = { tag, attrEquals: [], attrContains: [], childExists: [] };
  if (!predicateText) return { ok: true, value: step };

  for (const predicate of splitPredicate(predicateText)) {
    let attr = /^@([\w.-]+)\s*=\s*(['"])(.*?)\2$/.exec(predicate);
    if (attr) {
      step.attrEquals.push({ name: attr[1], value: attr[3] });
      continue;
    }
    attr = /^contains\(\s*@([\w.-]+)\s*,\s*(['"])(.*?)\2\s*\)$/.exec(predicate);
    if (attr) {
      step.attrContains.push({ name: attr[1], value: attr[3] });
      continue;
    }
    const child = /^([\w.-]+)\s*\[\s*@([\w.-]+)\s*=\s*(['"])(.*?)\3\s*\]$/.exec(predicate);
    if (child) {
      step.childExists.push({ tag: child[1], attrEquals: [{ name: child[2], value: child[4] }] });
      continue;
    }
    return { ok: false, reason: `unsupported-predicate:${predicate}` };
  }

  return { ok: true, value: step };
}

function splitXPath(xpathText: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of xpathText) {
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === "/" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function splitPredicate(predicateText: string): string[] {
  const predicates: string[] = [];
  let current = "";
  let quote: string | undefined;
  let depth = 0;
  for (let index = 0; index < predicateText.length; index += 1) {
    const char = predicateText[index];
    if ((char === "'" || char === "\"") && predicateText[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote) {
      if (char === "[") depth += 1;
      if (char === "]") depth -= 1;
      if (depth === 0 && predicateText.slice(index, index + 5).toLowerCase() === " and ") {
        predicates.push(current.trim());
        current = "";
        index += 4;
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) predicates.push(current.trim());
  return predicates;
}

function matchesSimpleStep(node: DomNode, step: SimpleXPathStep): boolean {
  if (node.nodeType !== 1 || node.tagName !== step.tag) return false;
  for (const attr of step.attrEquals) {
    if (node.getAttribute(attr.name) !== attr.value) return false;
  }
  for (const attr of step.attrContains) {
    if (!String(node.getAttribute(attr.name) ?? "").includes(attr.value)) return false;
  }
  for (const child of step.childExists) {
    const found = elementChildren(node).some((candidate) => {
      return candidate.tagName === child.tag && child.attrEquals.every((attr) => candidate.getAttribute(attr.name) === attr.value);
    });
    if (!found) return false;
  }
  return true;
}

function buildElementIndex(document: XmlDocument): ElementIndex {
  const byTag = new Map<string, DomNode[]>();
  const byTagAttrValue = new Map<string, DomNode[]>();
  const visit = (node: DomNode): void => {
    if (node.nodeType !== 1) return;
    addToNodeIndex(byTag, node.tagName, node);
    for (const attr of Array.from(node.attributes ?? []) as DomNode[]) {
      addToNodeIndex(byTagAttrValue, tagAttrKey(node.tagName, attr.nodeName, String(attr.nodeValue ?? "")), node);
    }
    for (const child of elementChildren(node)) visit(child);
  };
  if (document.documentElement) visit(document.documentElement);
  return { byTag, byTagAttrValue };
}

function addToNodeIndex(index: Map<string, DomNode[]>, key: string, node: DomNode): void {
  const current = index.get(key) ?? [];
  current.push(node);
  index.set(key, current);
}

function tagAttrKey(tag: string, attr: string, value: string): string {
  return `${tag}\0${attr}\0${value}`;
}

function elementChildren(node: DomNode): DomNode[] {
  return Array.from(node.childNodes ?? []).filter((child: any) => child.nodeType === 1) as DomNode[];
}

function removeNode(node: DomNode): void {
  if (node.nodeType === 2 && node.ownerElement) {
    node.ownerElement.removeAttribute(node.nodeName);
    return;
  }
  node.parentNode?.removeChild(node);
}

function fragmentNodes(document: XmlDocument, operation: XmlPatchOperation, fragmentCache: Map<string, DomNode[]>): DomNode[] {
  if (!operation.valueText?.trim()) return [];
  const key = operationKey(operation);
  const cached = fragmentCache.get(key);
  if (cached) return cached;
  const xmlText = operation.valueText;
  const wrapper = parseDocument(`<wrapper>${xmlText}</wrapper>`, "patch-fragment");
  const nodes = Array.from(wrapper.documentElement?.childNodes ?? []).filter((node: any) => node.nodeType === 1 || node.nodeType === 3);
  const fragments = nodes.map((node) => document.importNode ? document.importNode(node, true) : node.cloneNode(true));
  fragmentCache.set(key, fragments);
  return fragments;
}

function importClone(document: XmlDocument, node: DomNode): DomNode {
  const clone = node.cloneNode(true);
  return document.importNode ? document.importNode(clone, true) : clone;
}

function parseDocument(text: string, source: string): XmlDocument {
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (_level: string, message: string) => errors.push(message)
  }).parseFromString(stripBom(text), "text/xml");
  if (errors.length > 0 || !document.documentElement) {
    throw new Error(`XML parse failed for ${source}: ${errors.join("; ") || "no document element"}`);
  }
  return document;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function summarizeNode(node: DomNode): string {
  if (node.nodeType === 2) return node.nodeValue ?? "";
  const text = (node.textContent ?? "").trim();
  if (node.nodeType === 3) return text;
  const children = Array.from(node.childNodes ?? []).filter((child: any) => child.nodeType === 1);
  if (children.length > detailedElementChildLimit) {
    return summarizeElementShallow(node, children.length);
  }
  const xml = serializer.serializeToString(node);
  return compact(xml || text);
}

function summarizeElementShallow(node: DomNode, childCount: number): string {
  const attrs = Array.from(node.attributes ?? []) as DomNode[];
  const attrText = attrs.slice(0, 3)
    .map((attr) => `${attr.nodeName}="${compact(String(attr.nodeValue ?? ""))}"`)
    .join(" ");
  const suffix = attrs.length > 3 ? ` +${attrs.length - 3} attrs` : "";
  return `<${node.nodeName}${attrText ? ` ${attrText}` : ""}> ${childCount} children${suffix}`;
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function unresolvedResolution(group: ConflictGroup, warnings: string[]): ConflictResolution {
  return {
    status: "unresolved",
    finalSource: group.winner?.modName,
    history: group.operations.map((operation) => ({
      modName: operation.modName,
      displayName: operation.displayName,
      order: operation.order,
      operation: operation.operation,
      xpath: operation.xpath,
      authoredValue: operation.valueSummary ?? operation.valueText,
      status: "unresolved",
      warning: warnings[0]
    })),
    warnings
  };
}

function operationKey(operation: XmlPatchOperation): string {
  return `${operation.modName}\0${operation.displayName}\0${operation.order}\0${operation.path}\0${operation.line}\0${operation.operation}\0${operation.xpath}`;
}

function candidateOperations(conflicts: ConflictGroup[], fileOperations: XmlPatchOperation[]): XmlPatchOperation[] {
  const candidates = new Map<string, XmlPatchOperation>();
  if (fileOperations.length > relatedOperationExpansionLimit) {
    for (const conflict of conflicts) {
      for (const operation of conflict.operations) {
        candidates.set(operationKey(operation), operation);
      }
    }
    return [...candidates.values()].sort((a, b) => a.order - b.order || a.line - b.line);
  }

  const indexes = buildOperationIndexes(fileOperations);

  for (const conflict of conflicts) {
    const relatedKeys = relatedXpathKeys(conflict.normalizedXpath);
    for (const key of relatedKeys) {
      for (const operation of indexes.byNormalized.get(key) ?? []) {
        candidates.set(operationKey(operation), operation);
      }
    }
    for (const operation of indexes.byAncestor.get(withoutAttribute(normalizeXpath(conflict.normalizedXpath))) ?? []) {
      candidates.set(operationKey(operation), operation);
    }
    for (const operation of conflict.operations) {
      candidates.set(operationKey(operation), operation);
    }
  }

  return [...candidates.values()].sort((a, b) => a.order - b.order || a.line - b.line);
}

function buildOperationIndexes(operations: XmlPatchOperation[]): {
  byNormalized: Map<string, XmlPatchOperation[]>;
  byAncestor: Map<string, XmlPatchOperation[]>;
} {
  const byNormalized = new Map<string, XmlPatchOperation[]>();
  const byAncestor = new Map<string, XmlPatchOperation[]>();
  for (const operation of operations) {
    const normalized = withoutAttribute(normalizeXpath(operation.xpath));
    addToIndex(byNormalized, normalized, operation);
    const ancestors = relatedXpathKeys(normalized).slice(1);
    for (const key of ancestors) {
      addToIndex(byAncestor, key, operation);
    }
  }
  return { byNormalized, byAncestor };
}

function addToIndex(index: Map<string, XmlPatchOperation[]>, key: string, operation: XmlPatchOperation): void {
  const current = index.get(key) ?? [];
  current.push(operation);
  index.set(key, current);
}

function conflictKey(group: ConflictGroup): string {
  return `${group.file}\0${group.normalizedXpath}`;
}

function relatedXpathKeys(xpathText: string): string[] {
  const normalized = withoutAttribute(normalizeXpath(xpathText));
  const keys = [normalized];
  const parts = normalized.split("/").filter(Boolean);
  for (let index = parts.length - 1; index > 0; index -= 1) {
    keys.push(`/${parts.slice(0, index).join("/")}`);
  }
  return keys;
}

function withoutAttribute(xpathText: string): string {
  return xpathText.trim().replace(/\/@[\w.-]+$/g, "");
}

function pathFromPosix(file: string): string {
  return file.split("/").join(path.sep);
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
