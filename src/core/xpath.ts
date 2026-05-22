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

export type XPathSubsetKind = "absolute-child-chain" | "keyed-descendant" | "unsupported";

export interface CompiledXPathStep {
  axis: "child" | "descendant";
  tag: string;
  keyAttribute?: string;
  keyValue?: string;
}

export interface CompiledXPathSubset {
  kind: XPathSubsetKind;
  normalizedXpath: string;
  steps: CompiledXPathStep[];
  terminalAttribute?: string;
  supported: boolean;
  reason?: string;
}

export function compileXPathSubset(xpath: string): CompiledXPathSubset {
  const normalizedXpath = normalizeAuthoredXpath(xpath);
  const terminalAttribute = /\/@([\w.-]+)$/.exec(normalizedXpath)?.[1];
  const elementPath = terminalAttribute ? normalizedXpath.replace(/\/@[\w.-]+$/, "") : normalizedXpath;
  if (!elementPath.startsWith("/") || elementPath === "/" || /[|*]|\b(?:text|position|last)\b|::/.test(elementPath)) {
    return unsupported(normalizedXpath, "unsupported-shape");
  }

  const descendant = elementPath.startsWith("//");
  const offset = descendant ? 2 : 1;
  const rawSteps = splitXpathSegments(elementPath.slice(offset));
  if (rawSteps.length === 0) return unsupported(normalizedXpath, "empty-path");

  const steps: CompiledXPathStep[] = [];
  for (const [index, segment] of rawSteps.entries()) {
    const parsed = parseStep(segment);
    if (!parsed) return unsupported(normalizedXpath, "unsupported-predicate");
    const axis = descendant && index === 0 ? "descendant" : "child";
    steps.push({ axis, ...parsed });
  }

  if (descendant) {
    const last = steps[steps.length - 1];
    if (!last.keyAttribute || !last.keyValue) return unsupported(normalizedXpath, "descendant-without-final-key");
    return { kind: "keyed-descendant", normalizedXpath, steps, terminalAttribute, supported: true };
  }
  return { kind: "absolute-child-chain", normalizedXpath, steps, terminalAttribute, supported: true };
}

function unsupported(normalizedXpath: string, reason: string): CompiledXPathSubset {
  return { kind: "unsupported", normalizedXpath, steps: [], supported: false, reason };
}

function parseStep(segment: string): Omit<CompiledXPathStep, "axis"> | undefined {
  const match = /^([\w.-]+)(?:\[\s*@([\w.-]+)\s*=\s*(['"])(.*?)\3\s*\])?$/.exec(segment);
  if (!match) return undefined;
  return {
    tag: match[1],
    ...(match[2] ? { keyAttribute: match[2], keyValue: match[4] } : {})
  };
}

function normalizeAuthoredXpath(xpath: string): string {
  return xpath.trim().replace(/"/g, "'").replace(/\s+/g, " ");
}

function splitXpathSegments(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === "/" && depth === 0) {
      const segment = text.slice(start, index);
      if (segment) segments.push(segment);
      start = index + 1;
    }
  }
  const final = text.slice(start);
  if (final) segments.push(final);
  return segments;
}
