import path from "node:path";
import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { PatchTrace, PatchTraceEffect, PatchTraceTarget, ScanWarning, XmlPatchOperation } from "./types.js";
import { pathExists } from "./files.js";

const defaultGamePath = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\7 Days To Die";
const serializer = new XMLSerializer();
const keyAttributes = ["name", "id", "class", "type", "value"];
const broadReplayTargetLimit = 100;

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
type DomNode = any;
type NodeId = number;
type SlotKey = string;
type AttrCondition = { attr: string; value: string; op: "equals" | "contains" | "startsWith" };
type AttrPredicate = AttrCondition[][];
type ChildCondition = { tag: string; attrs: AttrCondition[] };
type SimpleXPathStep = { tag: string; attrPredicates: AttrPredicate[]; childConditions: ChildCondition[]; ordinal?: number };

interface SimpleXPath {
  mode: "absolute" | "descendant";
  steps: SimpleXPathStep[];
  attribute?: string;
}

interface ReplayEffectMetadata {
  scalarWriteSlot?: SlotKey;
  removed?: { nodeId: NodeId; canonicalTarget: string };
  insertedNodeIds?: NodeId[];
  childSlot?: SlotKey;
}

interface AppliedPatchEffect {
  effect: PatchTraceEffect;
  metadata?: ReplayEffectMetadata;
}

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
  const timeoutMs = options.timeoutMs ?? 8_000;
  const fileEntries = Array.from(byFile.entries());

  for (const [fileIndex, [file, fileOperations]] of fileEntries.entries()) {
    const fileStartedAt = Date.now();
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

    const provenance = new ReplayProvenance();
    const futureAdds = collectFutureAdds(fileOperations);
    const sortedOperations = sortOperations(fileOperations);
    const replayIndex = new XmlReplayIndex(document);
    for (const [operationIndex, operation] of sortedOperations.entries()) {
      if (budgetExpired(fileStartedAt, timeoutMs)) {
        pushBudgetSkipped(trace, warnings, file, sortedOperations.slice(operationIndex), fileIndex + 1, fileEntries.length, Date.now() - fileStartedAt);
        break;
      }
      const item = replayOperation(document, operation, provenance, futureAdds, replayIndex, options.mode ?? "fast");
      trace.push(item);
      let indexDirty = false;
      for (const effect of item.effects) {
        if (effectMayAffectIndex(effect)) {
          indexDirty = true;
        }
      }
      if (indexDirty) {
        replayIndex.markDirty();
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

function pushBudgetSkipped(trace: PatchTrace[], warnings: ScanWarning[], file: string, operations: XmlPatchOperation[], fileIndex: number, fileCount: number, elapsedMs: number): void {
  if (operations.length === 0) return;
  const message = `Patch trace replay budget exceeded at file ${fileIndex}/${fileCount} (${file}); ${operations.length} operation(s) left as partial diagnostics; elapsed ${elapsedMs}ms`;
  warnings.push({ kind: "trace-budget-exceeded", message, path: file });
  for (const operation of operations) {
    trace.push(baseTrace(operation, "partial", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: message }], "unsupported-operation", "low", message));
  }
}

class ReplayProvenance {
  private nextNodeId = 1;
  private readonly nodeIds = new WeakMap<object, NodeId>();
  private readonly lastScalarWriter = new Map<SlotKey, XmlPatchOperation>();
  private readonly removersByCanonicalTarget = new Map<string, XmlPatchOperation>();
  private readonly insertersByNodeId = new Map<NodeId, XmlPatchOperation>();
  private readonly insertersByChildSlot = new Map<SlotKey, XmlPatchOperation>();

  nodeId(node: DomNode): NodeId {
    const key = node as object;
    const existing = this.nodeIds.get(key);
    if (existing) return existing;
    const id = this.nextNodeId;
    this.nextNodeId += 1;
    this.nodeIds.set(key, id);
    return id;
  }

  textSlot(node: DomNode): SlotKey {
    return `text:${this.nodeId(node)}`;
  }

  attrSlot(node: DomNode, attributeName: string): SlotKey {
    const element = node.nodeType === 2 ? node.ownerElement : node;
    return `attr:${this.nodeId(element ?? node)}:${attributeName}`;
  }

  childSlot(parent: DomNode): SlotKey {
    return `children:${this.nodeId(parent)}`;
  }

  record(applied: AppliedPatchEffect, operation: XmlPatchOperation): void {
    const metadata = applied.metadata;
    if (!metadata) return;
    if (metadata.scalarWriteSlot) {
      this.lastScalarWriter.set(metadata.scalarWriteSlot, operation);
    }
    if (metadata.removed) {
      this.removersByCanonicalTarget.set(metadata.removed.canonicalTarget, operation);
    }
    if (metadata.childSlot) {
      this.insertersByChildSlot.set(metadata.childSlot, operation);
    }
    for (const nodeId of metadata.insertedNodeIds ?? []) {
      this.insertersByNodeId.set(nodeId, operation);
    }
  }

  overwritesPreviousScalar(appliedEffects: AppliedPatchEffect[]): boolean {
    return appliedEffects.some(({ effect, metadata }) =>
      (effect.kind === "setValue" || effect.kind === "setAttribute")
      && metadata?.scalarWriteSlot != null
      && this.lastScalarWriter.has(metadata.scalarWriteSlot)
      && effect.before !== effect.after
    );
  }

  wasRemovedByEarlierPatch(canonical: string): boolean {
    for (const removed of this.removersByCanonicalTarget.keys()) {
      if (canonical === removed || canonical.startsWith(`${removed}/`)) return true;
    }
    return false;
  }

  removerFor(canonical: string): XmlPatchOperation | undefined {
    for (const [removed, operation] of this.removersByCanonicalTarget.entries()) {
      if (canonical === removed || canonical.startsWith(`${removed}/`)) return operation;
    }
    return undefined;
  }
}

function replayOperation(
  document: XmlDocument,
  operation: XmlPatchOperation,
  provenance: ReplayProvenance,
  futureAdds: Set<string>,
  index: XmlReplayIndex,
  mode: TraceOptions["mode"]
): PatchTrace {
  if (operation.operation === "parse-error") {
    return baseTrace(operation, "parseError", 0, [], [{ kind: "parseError", target: operation.path, summary: "patch XML parse error" }], "parse-error", "low");
  }
  if (/^csv$/i.test(operation.operation)) {
    return baseTrace(operation, "unsupported", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: "csv replay is not implemented in v0.2" }], "unsupported-operation", "high", "csv replay is not implemented in v0.2");
  }

  let selected: DomNode[];
  try {
    selected = selectNodes(document, operation.xpath, index, mode ?? "fast");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return baseTrace(operation, "unsupported", 0, [], [{ kind: "unsupported", target: operation.xpath, summary: message }], "unsupported-operation", "low", message);
  }

  const matchCount = selected.length;
  if (matchCount === 0) {
    const canonical = canonicalFromXpath(operation.xpath);
    const diagnosticKind = provenance.wasRemovedByEarlierPatch(canonical) ? "order-induced-miss" : futureAddsXpathMayCreate(futureAdds, operation.xpath) ? "dependency-order-miss" : "xpath-miss";
    const remover = provenance.removerFor(canonical);
    return baseTrace(operation, "missed", 0, [], [{
      kind: "miss",
      target: canonical,
      targetKey: `miss:${operation.file}:${canonical}`,
      displayTarget: canonical,
      provenance: remover ? { removedByOpId: operationId(remover) } : undefined,
      summary: diagnosticKind
    }], diagnosticKind, "high", diagnosticKind);
  }

  const replayNodes = selected.length > broadReplayTargetLimit ? selected.slice(0, broadReplayTargetLimit) : selected;
  const targets = replayNodes.map((node) => targetFor(node, operation.xpath));
  const effects: PatchTraceEffect[] = [];
  const appliedEffects: AppliedPatchEffect[] = [];
  const op = operation.operation.toLowerCase();
  const fragmentTemplates = op === "append" || op === "insertbefore" || op === "insertafter" ? fragmentNodes(document, operation.valueText) : undefined;

  for (const node of replayNodes) {
    const target = targetFor(node, operation.xpath);
    let applied: AppliedPatchEffect;
    if (op === "set") {
      applied = applySet(node, target, operation, provenance);
    } else if (op === "setattribute") {
      applied = applySetAttribute(node, target, operation, provenance);
    } else if (op === "removeattribute") {
      applied = applyRemoveAttribute(node, target, operation, provenance);
    } else if (op === "append") {
      applied = applyAppend(node, target, operation, fragmentTemplates ?? [], provenance);
    } else if (op === "remove") {
      applied = applyRemove(node, target, provenance);
    } else if (op === "insertbefore" || op === "insertafter") {
      applied = applyInsert(node, target, operation, op === "insertbefore", fragmentTemplates ?? [], provenance);
    } else {
      applied = { effect: { kind: "unsupported", target: target.canonical, summary: `${operation.operation} replay is not implemented` } };
    }
    effects.push(applied.effect);
    appliedEffects.push(applied);
  }

  const diagnosticKind = effects.some((effect) => effect.kind === "unsupported")
    ? "unsupported-operation"
    : matchCount > 1
      ? "broad-match-risk"
      : provenance.overwritesPreviousScalar(appliedEffects) ? "silent-overwrite" : "ok";
  for (const applied of appliedEffects) {
    provenance.record(applied, operation);
  }
  const status = diagnosticKind === "unsupported-operation" ? "unsupported" : matchCount > 1 ? "ambiguous" : "applied";
  const message = matchCount > broadReplayTargetLimit
    ? `${diagnosticKind}; replay sampled ${broadReplayTargetLimit} of ${matchCount} matched target(s)`
    : diagnosticKind === "ok" ? undefined : diagnosticKind;
  return baseTrace(operation, status, matchCount, targets, effects, diagnosticKind, matchCount > 1 ? "medium" : "high", message);
}

function applySet(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, provenance: ReplayProvenance): AppliedPatchEffect {
  const value = operation.valueText ?? "";
  if (node.nodeType === 2) {
    const before = node.value ?? "";
    node.value = value;
    return {
      effect: {
        kind: "setAttribute",
        target: target.canonical,
        targetKey: provenance.attrSlot(node, node.name),
        displayTarget: target.canonical,
        before,
        after: value,
        value
      },
      metadata: { scalarWriteSlot: provenance.attrSlot(node, node.name) }
    };
  }
  const before = node.textContent ?? "";
  node.textContent = value;
  return {
    effect: {
      kind: "setValue",
      target: target.canonical,
      targetKey: provenance.textSlot(node),
      displayTarget: target.canonical,
      before,
      after: value,
      value
    },
    metadata: { scalarWriteSlot: provenance.textSlot(node) }
  };
}

function applySetAttribute(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, provenance: ReplayProvenance): AppliedPatchEffect {
  const attr = operation.attributes?.name ?? operation.attributes?.attribute ?? attributeNameFromXpath(operation.xpath) ?? "value";
  const value = operation.attributes?.value ?? operation.valueText ?? "";
  const element = node.nodeType === 2 ? node.ownerElement : node;
  const before = element.getAttribute(attr) ?? undefined;
  element.setAttribute(attr, value);
  const slotKey = provenance.attrSlot(element, attr);
  return {
    effect: {
      kind: "setAttribute",
      target: `${target.nodeRef}/@${attr}`,
      targetKey: slotKey,
      displayTarget: `${target.nodeRef}/@${attr}`,
      before,
      after: value,
      value
    },
    metadata: { scalarWriteSlot: slotKey }
  };
}

function applyRemoveAttribute(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, provenance: ReplayProvenance): AppliedPatchEffect {
  const attr = operation.attributes?.name ?? operation.attributes?.attribute ?? attributeNameFromXpath(operation.xpath) ?? "value";
  const element = node.nodeType === 2 ? node.ownerElement : node;
  const before = element.getAttribute(attr) ?? undefined;
  element.removeAttribute(attr);
  const slotKey = provenance.attrSlot(element, attr);
  return {
    effect: {
      kind: "removeAttribute",
      target: `${target.nodeRef}/@${attr}`,
      targetKey: slotKey,
      displayTarget: `${target.nodeRef}/@${attr}`,
      before,
      after: undefined
    },
    metadata: { scalarWriteSlot: slotKey }
  };
}

function applyAppend(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, templates: DomNode[], provenance: ReplayProvenance): AppliedPatchEffect {
  if (node.nodeType === 2) {
    const before = node.value ?? "";
    const after = `${before}${operation.valueText ?? ""}`;
    node.value = after;
    const slotKey = provenance.attrSlot(node, node.name);
    return {
      effect: {
        kind: "appendAttributeText",
        target: target.canonical,
        targetKey: slotKey,
        displayTarget: target.canonical,
        before,
        after,
        value: operation.valueSummary ?? operation.valueText
      },
      metadata: { scalarWriteSlot: slotKey }
    };
  }
  const nodes = cloneFragmentNodes(templates);
  for (const child of nodes) {
    node.appendChild(child);
  }
  const childSlot = provenance.childSlot(node);
  const insertedNodeIds = nodes.map((child) => provenance.nodeId(child));
  return {
    effect: {
      kind: "appendChild",
      target: target.canonical,
      targetKey: childSlot,
      displayTarget: target.canonical,
      provenance: { childSlot, insertedNodeIds },
      value: operation.valueSummary ?? operation.valueText,
      summary: `${nodes.length} child node(s)`
    },
    metadata: { childSlot, insertedNodeIds }
  };
}

function applyRemove(node: DomNode, target: PatchTraceTarget, provenance: ReplayProvenance): AppliedPatchEffect {
  const before = node.nodeType === 2 ? node.value : serializer.serializeToString(node);
  const removedNode = node.nodeType === 2 ? node.ownerElement ?? node : node;
  const removed = { nodeId: provenance.nodeId(removedNode), canonicalTarget: target.canonical };
  if (node.nodeType === 2) {
    node.ownerElement?.removeAttribute(node.name);
  } else {
    node.parentNode?.removeChild(node);
  }
  return {
    effect: {
      kind: "removeNode",
      target: target.canonical,
      targetKey: `node:${removed.nodeId}`,
      displayTarget: target.canonical,
      provenance: { nodeId: removed.nodeId },
      before
    },
    metadata: { removed }
  };
}

function applyInsert(node: DomNode, target: PatchTraceTarget, operation: XmlPatchOperation, before: boolean, templates: DomNode[], provenance: ReplayProvenance): AppliedPatchEffect {
  const nodes = cloneFragmentNodes(templates);
  const parent = node.parentNode;
  if (!parent) {
    return { effect: { kind: "unsupported", target: target.canonical, summary: "target has no parent" } };
  }
  for (const child of nodes) {
    parent.insertBefore(child, before ? node : node.nextSibling);
  }
  const childSlot = provenance.childSlot(parent);
  const insertedNodeIds = nodes.map((child) => provenance.nodeId(child));
  return {
    effect: {
      kind: before ? "insertBefore" : "insertAfter",
      target: target.canonical,
      targetKey: childSlot,
      displayTarget: target.canonical,
      provenance: { childSlot, insertedNodeIds },
      value: operation.valueSummary ?? operation.valueText,
      summary: `${nodes.length} sibling node(s)`
    },
    metadata: { childSlot, insertedNodeIds }
  };
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

function operationId(operation: XmlPatchOperation): string {
  return `${operation.file}:${operation.order}:${operation.line}:${operation.operation}:${operation.xpath}`;
}

function parseXml(text: string): XmlDocument {
  const errors: string[] = [];
  const document = new DOMParser({ onError: (_level: string, message: string) => errors.push(message) }).parseFromString(text.replace(/^\uFEFF/, ""), "text/xml");
  if (errors.length > 0 || !document.documentElement) {
    throw new Error(errors.join("; ") || "no document element");
  }
  return document;
}

function selectNodes(document: XmlDocument, expression: string, index: XmlReplayIndex, mode: TraceOptions["mode"]): DomNode[] {
  if (mode !== "exact") {
    const fast = selectSimpleXPath(document, expression, index);
    if (fast) return fast;
  }
  const result = xpath.select(expression, document as any);
  return Array.isArray(result) ? result as DomNode[] : [];
}

class XmlReplayIndex {
  private dirty = true;
  private byTag = new Map<string, DomNode[]>();
  private byTagKey = new Map<string, DomNode[]>();

  constructor(private readonly document: XmlDocument) {}

  markDirty(): void {
    this.dirty = true;
  }

  descendants(tag: string, keyAttr?: string, keyValue?: string): DomNode[] {
    this.ensureFresh();
    const nodes = keyAttr && keyValue != null ? this.byTagKey.get(indexKey(tag, keyAttr, keyValue)) ?? [] : this.byTag.get(tag) ?? [];
    return nodes.filter((node) => isAttachedToRoot(node, this.document.documentElement));
  }

  children(node: DomNode): DomNode[] {
    return Array.from(node.childNodes).filter((child: any) => child.nodeType === 1) as DomNode[];
  }

  liveDescendants(tag: string): DomNode[] {
    const nodes: DomNode[] = [];
    const root = this.document.documentElement;
    if (!root) return nodes;
    const visit = (node: DomNode): void => {
      if (node.nodeType !== 1) return;
      if (node.tagName === tag) nodes.push(node);
      for (const child of this.children(node)) visit(child);
    };
    visit(root);
    return nodes;
  }

  private ensureFresh(): void {
    if (!this.dirty) return;
    this.byTag = new Map();
    this.byTagKey = new Map();
    const root = this.document.documentElement;
    if (root) this.walk(root);
    this.dirty = false;
  }

  private walk(node: DomNode): void {
    if (node.nodeType !== 1) return;
    pushMap(this.byTag, node.tagName, node);
    for (const attr of keyAttributes) {
      const value = node.getAttribute?.(attr);
      if (value) pushMap(this.byTagKey, indexKey(node.tagName, attr, value), node);
    }
    const children = this.children(node);
    for (const child of children) this.walk(child);
  }
}

function selectSimpleXPath(document: XmlDocument, expression: string, index: XmlReplayIndex): DomNode[] | undefined {
  const parsed = parseSimpleXPath(expression);
  if (!parsed) return undefined;

  const elements = parsed.mode === "descendant"
    ? selectDescendantSimple(parsed, index)
    : selectAbsoluteSimple(document, parsed, index);
  if (!elements) return undefined;
  if (!parsed.attribute) return elements;

  const attributes: DomNode[] = [];
  for (const element of elements) {
    const attr = element.getAttributeNode?.(parsed.attribute);
    if (attr) attributes.push(attr);
  }
  return attributes;
}

function selectDescendantSimple(parsed: SimpleXPath, index: XmlReplayIndex): DomNode[] | undefined {
  const reverse = selectDescendantByLastKey(parsed, index);
  if (reverse) return reverse;
  const [first, ...rest] = parsed.steps;
  const key = firstIndexableCondition(first);
  let candidates = [...index.descendants(first.tag, key?.attr, key?.value)];
  if (key && candidates.length === 0) candidates = index.liveDescendants(first.tag);
  let current = applyOrdinal(candidates.filter((node) => matchesStep(node, first, index)), first);
  for (const step of rest) {
    const next: DomNode[] = [];
    for (const parent of current) {
      for (const child of index.children(parent)) {
        if (matchesStep(child, step, index)) next.push(child);
      }
    }
    current = applyOrdinal(next, step);
    if (current.length === 0) break;
  }
  return current;
}

function selectDescendantByLastKey(parsed: SimpleXPath, index: XmlReplayIndex): DomNode[] | undefined {
  if (parsed.steps.length < 2) return undefined;
  if (parsed.steps.some((step) => step.ordinal != null)) return undefined;
  const last = parsed.steps[parsed.steps.length - 1];
  const key = firstIndexableCondition(last);
  if (!key) return undefined;
  const matches: DomNode[] = [];
  for (const candidate of index.descendants(last.tag, key.attr, key.value)) {
    if (!matchesStep(candidate, last, index)) continue;
    let current = candidate.parentNode;
    let ok = true;
    for (let stepIndex = parsed.steps.length - 2; stepIndex >= 0; stepIndex -= 1) {
      const step = parsed.steps[stepIndex];
      if (!current || !matchesStep(current, step, index)) {
        ok = false;
        break;
      }
      current = current.parentNode;
    }
    if (ok) matches.push(candidate);
  }
  return matches;
}

function selectAbsoluteSimple(document: XmlDocument, parsed: SimpleXPath, index: XmlReplayIndex): DomNode[] | undefined {
  const root = document.documentElement;
  if (!root || parsed.steps.length === 0) return [];
  const [first, ...rest] = parsed.steps;
  if (!matchesStep(root, first, index)) return [];
  let current = applyOrdinal([root], first);
  for (const step of rest) {
    const next: DomNode[] = [];
    const key = firstIndexableCondition(step);
    if (key) {
      const parents = new Set(current);
      let candidates = index.descendants(step.tag, key.attr, key.value);
      if (candidates.length === 0) {
        const fallback: DomNode[] = [];
        for (const parent of current) fallback.push(...index.children(parent));
        candidates = fallback.filter((child) => child.tagName === step.tag);
      }
      for (const candidate of candidates) {
        if (parents.has(candidate.parentNode) && matchesStep(candidate, step, index)) next.push(candidate);
      }
    } else {
      for (const parent of current) {
        for (const child of index.children(parent)) {
          if (matchesStep(child, step, index)) next.push(child);
        }
      }
    }
    current = applyOrdinal(next, step);
    if (current.length === 0) break;
  }
  return current;
}

function parseSimpleXPath(expression: string): SimpleXPath | undefined {
  const normalized = canonicalFromXpath(expression);
  if (/[|*]|\b(?:text|position|last)\b/.test(normalized)) return undefined;
  const attributeMatch = /\/@([\w.-]+)$/.exec(normalized);
  const attribute = attributeMatch?.[1];
  const elementPath = attribute ? normalized.slice(0, -attributeMatch![0].length) : normalized;
  const mode = elementPath.startsWith("//") ? "descendant" : "absolute";
  const offset = elementPath.startsWith("//") ? 2 : elementPath.startsWith("/") ? 1 : 0;
  const rawSegments = elementPath.slice(offset).split("/").filter(Boolean);
  if (rawSegments.length === 0) return undefined;
  const steps = rawSegments.map(parseSimpleStep);
  if (steps.some((step) => !step)) return undefined;
  return { mode, steps: steps as SimpleXPathStep[], attribute };
}

function parseSimpleStep(segment: string): SimpleXPathStep | undefined {
  const match = /^([\w.-]+)((?:\[.+\])*)$/.exec(segment);
  if (!match) return undefined;
  const attrPredicates: AttrPredicate[] = [];
  const childConditions: ChildCondition[] = [];
  let ordinal: number | undefined;
  for (const predicate of splitPredicates(match[2])) {
    if (/^\d+$/.test(predicate)) {
      ordinal = Number.parseInt(predicate, 10);
      continue;
    }
    const child = parseChildCondition(predicate);
    if (child) {
      childConditions.push(child);
      continue;
    }
    const group = parseAttrPredicate(predicate);
    if (!group) return undefined;
    attrPredicates.push(group);
  }
  return { tag: match[1], attrPredicates, childConditions, ordinal };
}

function splitPredicates(text: string): string[] {
  const predicates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        predicates.push(text.slice(start, index));
        start = -1;
      }
      if (depth < 0) return [];
    }
  }
  return depth === 0 ? predicates : [];
}

function parseChildCondition(predicate: string): ChildCondition | undefined {
  const match = /^([\w.-]+)\[(.+)\]$/.exec(predicate);
  if (!match) return undefined;
  const attrs = parseAttrPredicate(match[2]);
  return attrs && attrs.length === 1 ? { tag: match[1], attrs: attrs[0] } : undefined;
}

function parseAttrPredicate(predicate: string): AttrCondition[][] | undefined {
  const orParts = predicate.split(/\s+or\s+/);
  const groups: AttrCondition[][] = [];
  for (const orPart of orParts) {
    const andParts = orPart.split(/\s+and\s+/);
    const group: AttrCondition[] = [];
    for (const part of andParts) {
      const trimmed = part.trim();
      const equals = /^@([\w.$-]+)='([^']*)'$/.exec(trimmed);
      if (equals) {
        group.push({ attr: equals[1], value: equals[2], op: "equals" });
        continue;
      }
      const contains = /^contains\(@([\w.$-]+),\s*'([^']*)'\)$/.exec(trimmed);
      if (contains) {
        group.push({ attr: contains[1], value: contains[2], op: "contains" });
        continue;
      }
      const startsWith = /^starts-with\(@([\w.$-]+),\s*'([^']*)'\)$/.exec(trimmed);
      if (startsWith) {
        group.push({ attr: startsWith[1], value: startsWith[2], op: "startsWith" });
        continue;
      }
      return undefined;
    }
    groups.push(group);
  }
  return groups;
}

function matchesStep(node: DomNode, step: SimpleXPathStep, index: XmlReplayIndex): boolean {
  if (node.nodeType !== 1 || node.tagName !== step.tag) return false;
  for (const predicate of step.attrPredicates) {
    if (!predicate.some((group) => group.every((condition) => matchesAttrCondition(node, condition)))) return false;
  }
  for (const condition of step.childConditions) {
    if (!index.children(node).some((child) => child.tagName === condition.tag && condition.attrs.every((attr) => matchesAttrCondition(child, attr)))) return false;
  }
  return true;
}

function applyOrdinal(nodes: DomNode[], step: SimpleXPathStep): DomNode[] {
  if (step.ordinal == null) return nodes;
  const byParent = groupBy(nodes, (node) => node.parentNode ?? null);
  const selected: DomNode[] = [];
  for (const siblings of byParent.values()) {
    const node = siblings[step.ordinal - 1];
    if (node) selected.push(node);
  }
  return selected;
}

function matchesAttrCondition(node: DomNode, condition: AttrCondition): boolean {
  const value = node.getAttribute?.(condition.attr);
  if (condition.op === "contains") return (value ?? "").includes(condition.value);
  if (condition.op === "startsWith") return (value ?? "").startsWith(condition.value);
  return value === condition.value;
}

function firstIndexableCondition(step: SimpleXPathStep): AttrCondition | undefined {
  for (const predicate of step.attrPredicates) {
    if (predicate.length !== 1) continue;
    for (const group of predicate) {
      const condition = group[0];
      if (condition && group.length === 1 && condition.op === "equals" && keyAttributes.includes(condition.attr)) return condition;
    }
  }
  return undefined;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const current = map.get(key);
  if (current) {
    current.push(value);
    return;
  }
  map.set(key, [value]);
}

function indexKey(tag: string, attr: string, value: string): string {
  return `${tag}\u0000${attr}\u0000${value}`;
}

function isAttachedToRoot(node: DomNode, root: DomNode | null): boolean {
  let current: DomNode | null = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

function effectMayAffectIndex(effect: PatchTraceEffect): boolean {
  if (effect.kind === "appendChild" || effect.kind === "insertBefore" || effect.kind === "insertAfter" || effect.kind === "removeNode") return true;
  if (effect.kind !== "setAttribute" && effect.kind !== "removeAttribute" && effect.kind !== "appendAttributeText") return false;
  const attr = attributeNameFromXpath(effect.target);
  return attr != null && keyAttributes.includes(attr);
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

function cloneFragmentNodes(nodes: DomNode[]): DomNode[] {
  return nodes.map((node) => node.cloneNode(true));
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
