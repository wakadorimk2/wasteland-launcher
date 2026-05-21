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
  conflicts: ConflictGroup[];
  logs: LogScanResult;
}
