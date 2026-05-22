import { normalizeXpath } from "./conflicts.js";
import { XmlPatchOperation } from "./types.js";

export type PatchFootprintPrecision = "supported" | "broad" | "unknown";
export type PatchFootprintSelectorKind = "node" | "text" | "attribute" | "child";

export interface PatchFootprintSelector {
  file: string;
  xpath: string;
  normalizedXpath: string;
  kind: PatchFootprintSelectorKind;
  attribute?: string;
}

export interface PatchFootprint {
  operation: XmlPatchOperation;
  file: string;
  operationName: string;
  reads: PatchFootprintSelector[];
  writtenScalarSlots: PatchFootprintSelector[];
  removedNodeSelectors: PatchFootprintSelector[];
  insertedChildSlots: PatchFootprintSelector[];
  precision: PatchFootprintPrecision;
  reasons: string[];
}

const supportedOperations = new Set(["set", "setattribute", "removeattribute", "append", "remove", "insertbefore", "insertafter"]);

export function extractPatchFootprints(operations: XmlPatchOperation[]): PatchFootprint[] {
  return operations.map(extractPatchFootprint);
}

export function extractPatchFootprint(operation: XmlPatchOperation): PatchFootprint {
  const operationName = operation.operation.toLowerCase();
  const precision = precisionFor(operationName, operation.xpath);
  const reasons = reasonsFor(operationName, operation.xpath, precision);
  const footprint = emptyFootprint(operation, operationName, precision, reasons);

  if (operationName === "parse-error") {
    return footprint;
  }

  if (!operation.xpath) {
    return footprint;
  }

  if (!supportedOperations.has(operationName)) {
    footprint.reads.push(selector(operation, operation.xpath, "node"));
    return footprint;
  }

  if (operationName === "set") {
    footprint.reads.push(selector(operation, operation.xpath, selectorKindForTarget(operation.xpath)));
    addSetWrite(footprint, operation);
  } else if (operationName === "setattribute" || operationName === "removeattribute") {
    const targetXpath = elementTargetXpath(operation.xpath);
    const attribute = attributeNameForOperation(operation);
    footprint.reads.push(selector(operation, targetXpath, "node"));
    footprint.writtenScalarSlots.push(selector(operation, targetXpath, "attribute", attribute));
  } else if (operationName === "append") {
    footprint.reads.push(selector(operation, operation.xpath, selectorKindForTarget(operation.xpath)));
    if (isAttributeTarget(operation.xpath)) {
      addAttributeWriteFromXpath(footprint, operation);
    } else {
      footprint.insertedChildSlots.push(selector(operation, operation.xpath, "child"));
    }
  } else if (operationName === "remove") {
    footprint.reads.push(selector(operation, operation.xpath, selectorKindForTarget(operation.xpath)));
    footprint.removedNodeSelectors.push(selector(operation, operation.xpath, selectorKindForTarget(operation.xpath)));
  } else if (operationName === "insertbefore" || operationName === "insertafter") {
    footprint.reads.push(selector(operation, operation.xpath, selectorKindForTarget(operation.xpath)));
    footprint.insertedChildSlots.push(selector(operation, parentXpath(operation.xpath) ?? operation.xpath, "child"));
  }

  return footprint;
}

export function groupFootprintsByFile(footprints: PatchFootprint[]): Map<string, PatchFootprint[]> {
  const grouped = new Map<string, PatchFootprint[]>();
  for (const footprint of footprints) {
    const current = grouped.get(footprint.file) ?? [];
    current.push(footprint);
    grouped.set(footprint.file, current);
  }
  return grouped;
}

function emptyFootprint(
  operation: XmlPatchOperation,
  operationName: string,
  precision: PatchFootprintPrecision,
  reasons: string[]
): PatchFootprint {
  return {
    operation,
    file: operation.file,
    operationName,
    reads: [],
    writtenScalarSlots: [],
    removedNodeSelectors: [],
    insertedChildSlots: [],
    precision,
    reasons
  };
}

function addSetWrite(footprint: PatchFootprint, operation: XmlPatchOperation): void {
  const attribute = attributeNameFromXpath(operation.xpath);
  if (attribute) {
    footprint.writtenScalarSlots.push(selector(operation, elementTargetXpath(operation.xpath), "attribute", attribute));
    return;
  }
  footprint.writtenScalarSlots.push(selector(operation, operation.xpath, "text"));
}

function addAttributeWriteFromXpath(footprint: PatchFootprint, operation: XmlPatchOperation): void {
  const attribute = attributeNameFromXpath(operation.xpath);
  if (!attribute) {
    return;
  }
  footprint.writtenScalarSlots.push(selector(operation, elementTargetXpath(operation.xpath), "attribute", attribute));
}

function selector(operation: XmlPatchOperation, xpath: string, kind: PatchFootprintSelectorKind, attribute?: string): PatchFootprintSelector {
  return {
    file: operation.file,
    xpath,
    normalizedXpath: normalizeXpath(xpath),
    kind,
    ...(attribute ? { attribute } : {})
  };
}

function precisionFor(operationName: string, xpath: string): PatchFootprintPrecision {
  if (operationName === "parse-error") {
    return "unknown";
  }
  if (!xpath.trim()) {
    return "unknown";
  }
  if (!supportedOperations.has(operationName)) {
    return "unknown";
  }
  if (!isStaticPathLike(xpath)) {
    return "unknown";
  }
  return hasBroadXpathShape(xpath) ? "broad" : "supported";
}

function reasonsFor(operationName: string, xpath: string, precision: PatchFootprintPrecision): string[] {
  if (operationName === "parse-error") {
    return ["parse-error"];
  }
  if (!xpath.trim()) {
    return ["empty-xpath"];
  }
  if (!supportedOperations.has(operationName)) {
    return ["unsupported-operation"];
  }
  if (precision === "unknown") {
    return ["unsupported-xpath"];
  }
  if (precision === "broad") {
    return ["broad-xpath"];
  }
  return [];
}

function isStaticPathLike(xpath: string): boolean {
  const trimmed = xpath.trim();
  return trimmed.startsWith("/") || trimmed.startsWith("//");
}

function hasBroadXpathShape(xpath: string): boolean {
  return /(^|[^/])\|/.test(xpath)
    || /\$[\w.-]+/.test(xpath)
    || /\[[^\]]*\b[\w.-]+\s*\(/.test(xpath)
    || /::/.test(xpath)
    || /\b(?:ancestor|following|preceding|self|parent|child|descendant)(?:-or-self)?::/.test(xpath);
}

function selectorKindForTarget(xpath: string): PatchFootprintSelectorKind {
  return isAttributeTarget(xpath) ? "attribute" : "node";
}

function isAttributeTarget(xpath: string): boolean {
  return attributeNameFromXpath(xpath) != null;
}

function attributeNameForOperation(operation: XmlPatchOperation): string {
  return operation.attributes?.name ?? operation.attributes?.attribute ?? attributeNameFromXpath(operation.xpath) ?? "value";
}

function attributeNameFromXpath(xpath: string): string | undefined {
  return /\/@([\w.-]+)\s*$/.exec(xpath)?.[1];
}

function elementTargetXpath(xpath: string): string {
  return xpath.replace(/\/@[\w.-]+\s*$/, "");
}

function parentXpath(xpath: string): string | undefined {
  const elementXpath = elementTargetXpath(xpath).trim();
  const segments = splitXpathSegments(elementXpath);
  if (segments.length <= 1) {
    return undefined;
  }
  const prefix = elementXpath.startsWith("//") ? "//" : "/";
  return `${prefix}${segments.slice(0, -1).join("/")}`;
}

function splitXpathSegments(xpath: string): string[] {
  const offset = xpath.startsWith("//") ? 2 : xpath.startsWith("/") ? 1 : 0;
  const text = xpath.slice(offset);
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
    } else if (char === "/" && depth === 0) {
      const segment = text.slice(start, index);
      if (segment) {
        segments.push(segment);
      }
      start = index + 1;
    }
  }
  const last = text.slice(start);
  if (last) {
    segments.push(last);
  }
  return segments;
}
