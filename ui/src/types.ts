export type Risk = "safe" | "info" | "warn" | "danger" | "critical";
export type ConflictKind = "direct-overwrite" | "same-node-multi-touch" | "structural-dependency" | "missing-xpath" | "load-order-dependent" | "single-winner";
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
  valueKind?: "text" | "xml" | "target" | "empty" | "unknown";
  valueText?: string;
  valueSummary?: string;
}

export interface ConflictResolutionStep {
  modName: string;
  displayName: string;
  order: number;
  operation: string;
  xpath: string;
  beforeValue?: string;
  authoredValue?: string;
  afterValue?: string;
  status: "applied" | "unresolved";
  warning?: string;
}

export interface ConflictResolution {
  status: "resolved" | "unresolved";
  vanillaValue?: string;
  finalValue?: string;
  finalSource?: string;
  history: ConflictResolutionStep[];
  warnings: string[];
}

export interface ConflictGroup {
  file: string;
  normalizedXpath: string;
  operations: XmlPatchOperation[];
  winner: XmlPatchOperation;
  exact: boolean;
  resolution?: ConflictResolution;
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

export interface UiAttr {
  conflictId: string;
  name: string;
  category: ConflictCategory;
  finalKind?: "final" | "candidate" | "status";
  vanilla: string | null;
  history: UiAttrHistory[];
  final: string | null;
  winner?: string;
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
    missingXPath: number;
    loadOrderDependent: number;
    safeChanges: number;
  };
  conflictCounts: Record<ConflictCategory, number>;
}
