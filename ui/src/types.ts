export type Risk = "safe" | "info" | "warn" | "danger" | "critical";
export type ConflictKind = "xpath-miss" | "order-induced-miss" | "dependency-order-miss" | "silent-overwrite" | "structural-mask" | "slot-order-dependent" | "sibling-order-dependent" | "broad-match-risk" | "unsupported-operation" | "parse-error" | "ambiguous-target" | "unknown-risk" | "ok";
export type ConflictCategory = "value" | "structural" | "mixed";
export type LayoutMode = "3-column" | "unified" | "timeline";
export type ViewId = "dashboard" | "load-order" | "xml-browser" | "conflict" | "settings";

export interface ModlistEntry {
  raw: string;
  name: string;
  state: "enabled" | "disabled" | "separator";
  line: number;
  order?: number;
}

export interface ModRoot {
  mo2Name: string;
  displayName: string;
  rootPath: string;
  modInfoPath: string;
  order: number;
  version?: string;
  author?: string;
}

export interface XmlPatchOperation {
  modName: string;
  displayName: string;
  order: number;
  file: string;
  path: string;
  operation: string;
  xpath: string;
  line: number;
  attributes?: Record<string, string>;
  valueKind?: "text" | "xml" | "target" | "empty" | "unknown";
  valueText?: string;
  valueSummary?: string;
}

export interface PatchTraceTarget {
  canonical: string;
  nodeRef: string;
  kind: "element" | "attribute";
  value?: string;
}

export interface PatchTraceEffect {
  kind: string;
  target: string;
  targetKey?: string;
  displayTarget?: string;
  provenance?: {
    slotKey?: string;
    nodeId?: number;
    childSlot?: string;
    removedByOpId?: string;
    insertedNodeIds?: number[];
  };
  before?: string;
  after?: string;
  value?: string;
  summary?: string;
}

export interface PatchTrace {
  id: string;
  modName: string;
  displayName: string;
  order: number;
  file: string;
  path: string;
  line: number;
  operation: string;
  xpath: string;
  status: "applied" | "missed" | "unsupported" | "parseError" | "ambiguous" | "partial";
  matchCountBefore: number;
  affectedTargets: PatchTraceTarget[];
  effects: PatchTraceEffect[];
  confidence: "high" | "medium" | "low";
  diagnosticKind: ConflictKind;
  message?: string;
}

export interface ConflictGroup {
  id?: string;
  file: string;
  kind?: ConflictKind;
  classification?: string;
  risk?: Risk;
  confidence?: "proven" | "likely" | "unknown";
  targetKey?: string;
  displayTarget?: string;
  operationIds?: string[];
  normalizedXpath: string;
  operations: XmlPatchOperation[];
  primaryOpId?: string;
  relatedOpIds?: string[];
  evidence?: {
    opId: string;
    effects: PatchTraceEffect[];
    matchEvents: unknown[];
    slotVersions: unknown[];
    note?: string;
  }[];
  source?: "replay" | "footprint" | "normalized";
  orderDependent?: boolean;
  winner?: XmlPatchOperation;
  exact: boolean;
}

export interface ContextPack {
  generatedAt: string;
  scan: {
    mo2Path: string;
    profile: string;
    modlistPath: string;
    entries: ModlistEntry[];
    enabledMods: ModRoot[];
    missingEnabledMods: string[];
    xmlPatches: XmlPatchOperation[];
    dlls: unknown[];
    warnings: { kind: string; message: string; modName?: string; path?: string }[];
  };
  trace: PatchTrace[];
  diagnosticGroups?: ConflictGroup[];
  conflicts: ConflictGroup[];
  logs: {
    latestLogPath?: string;
    warnings: { path: string; line: number; text: string; relatedMods: string[] }[];
  };
}

export interface UiMod {
  id: string;
  folder: string;
  name: string;
  author: string;
  version: string;
  enabled: boolean;
  order: number;
  sortOrder: number;
  modlistLine?: number;
  description: string;
  files: string[];
  patchCount: number;
  isCore: boolean;
  isUser: boolean;
  missing: boolean;
}

export interface UiXmlFile {
  path: string;
  patches: number;
  touchingMods: string[];
  conflicts: number;
  missing: number;
  risk: Risk;
}

export interface UiAttrHistory {
  mod: string;
  order: number;
  op: string;
  value?: string;
  before?: string;
  authored?: string;
  after?: string;
  error?: string;
  disabled?: boolean;
}

export interface UiConflictEvidence {
  operationKey: string;
  status?: PatchTrace["status"];
  diagnosticKind?: ConflictKind;
  confidence?: PatchTrace["confidence"];
  message?: string;
  effects: PatchTraceEffect[];
  affectedTargets: PatchTraceTarget[];
}

export interface UiAttr {
  conflictId: string;
  name: string;
  target?: string;
  category: ConflictCategory;
  finalKind?: "final" | "candidate" | "status";
  vanilla: string | null;
  history: UiAttrHistory[];
  final: string | null;
  winner?: string;
  exact?: boolean;
  sourceLabel?: string;
  operations?: XmlPatchOperation[];
  evidence?: UiConflictEvidence[];
  risk: Risk;
  kind: ConflictKind;
  xpath?: string;
  note?: string;
}

export interface UiNode {
  path: string;
  label: string;
  risk: Risk;
  attrs: UiAttr[];
}

export interface UiConflict {
  id: string;
  file: string;
  node: string;
  target: string;
  exact: boolean;
  winner: string;
  operations: XmlPatchOperation[];
  evidence: UiConflictEvidence[];
  sourceLabel: string;
  category: ConflictCategory;
  finalKind?: "final" | "candidate" | "status";
  kind: ConflictKind;
  risk: Risk;
  mods: string[];
  final: string | null;
  summary: string;
}

export interface UiModel {
  source: "sample" | "context";
  generatedAt: string;
  mo2Path: string;
  profile: string;
  mods: UiMod[];
  xmlFiles: UiXmlFile[];
  xmlTree: Record<string, { children: UiNode[] }>;
  conflicts: UiConflict[];
  stats: {
    modsLoaded: number;
    modsEnabled: number;
    xmlFiles: number;
    totalPatches: number;
    warnings: number;
    conflicts: number;
    exactConflictGroups: number;
    fallbackConflictGroups: number;
    replayWarnings: number;
    missingXPath: number;
    loadOrderDependent: number;
    safeChanges: number;
  };
  conflictCounts: Record<ConflictCategory, number>;
}
