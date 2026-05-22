export type ModlistEntryState = "enabled" | "disabled" | "separator";

export interface ModlistEntry {
  raw: string;
  name: string;
  state: ModlistEntryState;
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

export interface DllInfo {
  modName: string;
  displayName: string;
  order: number;
  path: string;
  fileName: string;
  size: number;
  mtime: string;
  sha256: string;
}

export interface ScanWarning {
  kind: string;
  message: string;
  modName?: string;
  path?: string;
}

export interface ScanResult {
  mo2Path: string;
  profile: string;
  modlistPath: string;
  entries: ModlistEntry[];
  enabledMods: ModRoot[];
  missingEnabledMods: string[];
  xmlPatches: XmlPatchOperation[];
  dlls: DllInfo[];
  warnings: ScanWarning[];
}

export interface ConflictGroup {
  file: string;
  normalizedXpath: string;
  operations: XmlPatchOperation[];
  winner: XmlPatchOperation;
  exact: boolean;
}

export type OperationId = string;
export type TargetKey = string;

export interface OperationIR extends XmlPatchOperation {
  opId: OperationId;
  opcode: string;
  rawXpath: string;
  sourceLine: number;
}

export type DiagnosticConfidence = "proven" | "likely" | "unknown";
export type DiagnosticClassification =
  | "silent-overwrite"
  | "slot-order-dependent"
  | "structural-mask"
  | "order-induced-miss"
  | "dependency-order-miss"
  | "sibling-order-dependent"
  | "broad-selector-risk"
  | "unsupported-operation"
  | "parse-error"
  | "unknown-risk";

export interface MatchEvent {
  opId: OperationId;
  targetKey?: TargetKey;
  displayTarget: string;
  matchKind: "node" | "attribute" | "miss" | "unsupported" | "parseError";
  cardinality: number;
  confidence: PatchTrace["confidence"];
  note?: string;
}

export interface SlotVersion {
  slotKey: TargetKey;
  opId: OperationId;
  before?: string;
  after?: string;
  displayTarget: string;
}

export interface DiagnosticEvidence {
  opId: OperationId;
  effects: PatchTraceEffect[];
  matchEvents: MatchEvent[];
  slotVersions: SlotVersion[];
  note?: string;
}

export interface DiagnosticGroup {
  id: string;
  file: string;
  kind: PatchDiagnosticKind;
  classification: DiagnosticClassification;
  risk: "info" | "warn" | "danger" | "critical";
  confidence: DiagnosticConfidence;
  targetKey: TargetKey;
  displayTarget: string;
  operationIds: OperationId[];
  operations: XmlPatchOperation[];
  primaryOpId: OperationId;
  relatedOpIds: OperationId[];
  evidence: DiagnosticEvidence[];
  source: "replay" | "footprint" | "normalized";
  orderDependent: boolean;
  winner: XmlPatchOperation;
  normalizedXpath: string;
  exact: boolean;
}

export interface ConflictDetectionResult {
  diagnosticGroups: DiagnosticGroup[];
  conflicts: DiagnosticGroup[];
  trace: PatchTrace[];
  warnings: ScanWarning[];
}

export type PatchTraceStatus = "applied" | "missed" | "unsupported" | "parseError" | "ambiguous" | "partial";

export type PatchDiagnosticKind =
  | "ok"
  | "xpath-miss"
  | "order-induced-miss"
  | "dependency-order-miss"
  | "silent-overwrite"
  | "structural-mask"
  | "slot-order-dependent"
  | "sibling-order-dependent"
  | "broad-match-risk"
  | "unsupported-operation"
  | "parse-error"
  | "ambiguous-target"
  | "unknown-risk";

export interface PatchTraceTarget {
  canonical: string;
  nodeRef: string;
  kind: "element" | "attribute";
  value?: string;
}

export interface PatchTraceEffect {
  kind: "setValue" | "setAttribute" | "removeAttribute" | "appendChild" | "appendAttributeText" | "removeNode" | "insertBefore" | "insertAfter" | "unsupported" | "parseError" | "miss";
  target: string;
  targetKey?: TargetKey;
  displayTarget?: string;
  provenance?: {
    slotKey?: TargetKey;
    nodeId?: number;
    childSlot?: TargetKey;
    removedByOpId?: OperationId;
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
  status: PatchTraceStatus;
  matchCountBefore: number;
  affectedTargets: PatchTraceTarget[];
  effects: PatchTraceEffect[];
  confidence: "high" | "medium" | "low";
  diagnosticKind: PatchDiagnosticKind;
  message?: string;
}

export interface LogWarning {
  path: string;
  line: number;
  text: string;
  relatedMods: string[];
}

export interface LogScanResult {
  latestLogPath?: string;
  warnings: LogWarning[];
}

export interface ContextPack {
  generatedAt: string;
  scan: ScanResult;
  trace: PatchTrace[];
  diagnosticGroups: DiagnosticGroup[];
  conflicts: DiagnosticGroup[];
  logs: LogScanResult;
}
