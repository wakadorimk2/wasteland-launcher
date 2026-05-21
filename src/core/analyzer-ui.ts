import path from "node:path";
import { ConflictGroup, ContextPack, XmlPatchOperation } from "./types.js";

export type AnalyzerConflictKind = "item" | "lootgroup" | "perk" | "buff" | "window/xui" | "block" | "entity" | "recipe/quest/trader" | "other";

export interface AnalyzerRankedConflict {
  group: ConflictGroup;
  score: number;
  mods: string[];
  priority: "high" | "medium" | "low";
}

export interface AnalyzerMod {
  enabled: boolean;
  order: number;
  folder: string;
  name: string;
  author: string;
  version: string;
  files: string[];
  patchCount: number;
  isCore: boolean;
  isUser: boolean;
  isCoreOrUser: "core" | "user";
}

export interface AnalyzerXmlFile {
  path: string;
  patches: string[];
  touchingMods: string[];
  conflicts: number;
  missing: boolean;
  risk: "safe" | "warn" | "danger";
}

export interface AnalyzerConflict {
  id: string;
  file: string;
  node: string;
  kind: AnalyzerConflictKind;
  risk: "safe" | "warn" | "danger";
  mods: string[];
  final: string;
  summary: string;
}

export interface AnalyzerXmlTreeNode {
  name: string;
  attrs: Record<string, string | number | boolean>;
  children: AnalyzerXmlTreeNode[];
}

export interface AnalyzerXmlTreeItem {
  file: string;
  attrs: Record<string, string | number | boolean>;
  children: AnalyzerXmlTreeNode[];
}

export interface AnalyzerStats {
  generatedAt: string;
  profile: string;
  mo2Path: string;
  mods: number;
  enabledMods: number;
  userMods: number;
  coreMods: number;
  xmlFiles: number;
  xmlPatches: number;
  conflicts: number;
  warnings: number;
  dlls: number;
}

export interface AnalyzerUiModel {
  MODS: AnalyzerMod[];
  XML_FILES: AnalyzerXmlFile[];
  CONFLICTS: AnalyzerConflict[];
  XML_TREE: AnalyzerXmlTreeItem[];
  CONFLICT_KINDS: AnalyzerConflictKind[];
  STATS: AnalyzerStats;
}

export interface BuildAnalyzerContextArgs {
  pack: ContextPack;
  rankedConflicts: AnalyzerRankedConflict[];
}

function getModFolder(rootPath: string): string {
  const base = path.basename(rootPath || "").trim();
  return base.length > 0 ? base : "n/a";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function classifyConflictKind(file: string, xpath: string): AnalyzerConflictKind {
  const normalized = xpath.toLowerCase();
  const targetFile = file.toLowerCase();

  if (targetFile === "items.xml" || /\b(item|items)\b/.test(normalized)) {
    return "item";
  }
  if (/lootgroup|lootcontainers|lootcontainer/.test(normalized)) {
    return "lootgroup";
  }
  if (/\bperk\b/.test(normalized) || /perk/i.test(targetFile) || /perk/i.test(normalized)) {
    return "perk";
  }
  if (/\bbuff\b/.test(normalized) || /buff/i.test(targetFile)) {
    return "buff";
  }
  if (/XUi/i.test(file) || /\bwindow\b/.test(normalized) || /uixml/i.test(normalized) || /hud|window/.test(normalized)) {
    return "window/xui";
  }
  if (/\b(block|blocks)\b/.test(normalized) || /blocks?/i.test(targetFile)) {
    return "block";
  }
  if (/\b(entity|entities|monster)\b/.test(normalized)) {
    return "entity";
  }
  if (/\b(recipe|quest|trader)\b/.test(normalized) || /recipes?/i.test(targetFile)) {
    return "recipe/quest/trader";
  }

  return "other";
}

function buildRiskFromPriority(priority: AnalyzerRankedConflict["priority"]): "safe" | "warn" | "danger" {
  switch (priority) {
    case "high":
      return "danger";
    case "medium":
      return "warn";
    default:
      return "safe";
  }
}

function pickPathForPatch(patch: XmlPatchOperation): string {
  if (patch.path && patch.path.trim().length > 0) {
    return patch.path.trim();
  }
  return patch.xpath;
}

function insertXmlTreeNode(children: AnalyzerXmlTreeNode[], segment: string): AnalyzerXmlTreeNode {
  const existing = children.find((node) => node.name === segment);
  if (existing) {
    existing.attrs.count = Number(existing.attrs.count) + 1;
    return existing;
  }
  const node: AnalyzerXmlTreeNode = {
    name: segment,
    attrs: { count: 1 },
    children: []
  };
  children.push(node);
  return node;
}

function buildXmlTreeForFile(file: string, patches: XmlPatchOperation[], conflicts: ConflictGroup[]): AnalyzerXmlTreeItem {
  const root: AnalyzerXmlTreeItem = {
    file,
    attrs: {
      file,
      patches: patches.length,
      conflicts: conflicts.length
    },
    children: []
  };

  const addPath = (xpath: string): void => {
    const segments = xpath.split("?").slice(0, 1)[0] // drop query fragments
      .replace(/\\s+/g, " ")
      .split("/")
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      return;
    }

    let cursor: { children: AnalyzerXmlTreeNode[] } = root;
    segments.forEach((segment) => {
      const next = insertXmlTreeNode(cursor.children, segment);
      next.attrs["depth"] = Number(next.attrs["depth"] ?? 0);
      next.attrs["depth"] = Math.min(16, Number(next.attrs["depth"]) + 1);
      cursor = next;
    });
  };

  patches.forEach((patch) => addPath(pickPathForPatch(patch)));
  conflicts.forEach((conflict) => addPath(conflict.normalizedXpath));

  return root;
}

export function buildAnalyzerUiModel(args: BuildAnalyzerContextArgs): AnalyzerUiModel {
  const { pack, rankedConflicts } = args;
  const filesByPatch = new Map<string, XmlPatchOperation[]>();
  const filesByConflict = new Map<string, ConflictGroup[]>();

  pack.scan.xmlPatches.forEach((patch) => {
    const list = filesByPatch.get(patch.file) ?? [];
    list.push(patch);
    filesByPatch.set(patch.file, list);
  });

  rankedConflicts.forEach((entry) => {
    const file = entry.group.file;
    const list = filesByConflict.get(file) ?? [];
    list.push(entry.group);
    filesByConflict.set(file, list);
  });

  const mods: AnalyzerMod[] = pack.scan.enabledMods.map((mod) => {
    const patchOps = pack.scan.xmlPatches.filter((patch) => patch.modName === mod.mo2Name);
    const touchedFiles = uniqueSorted(patchOps.map((patch) => patch.file));
    const conflictCount = rankedConflicts.reduce((count, conflict) => {
      return count + Number(conflict.mods.includes(mod.mo2Name));
    }, 0);
    const isCore = mod.order <= 8;
    return {
      enabled: true,
      order: mod.order,
      folder: getModFolder(mod.rootPath),
      name: `${mod.displayName} (${mod.mo2Name})`,
      author: mod.author?.trim().length ? mod.author!.trim() : "n/a",
      version: mod.version?.trim().length ? mod.version!.trim() : "n/a",
      files: touchedFiles,
      patchCount: patchOps.length,
      isCore,
      isUser: !isCore,
      isCoreOrUser: isCore ? "core" as const : "user" as const
    };
  }).sort((a, b) => a.order - b.order);

  const fileRows: AnalyzerXmlFile[] = [];
  const tree: AnalyzerXmlTreeItem[] = [];
  const conflictKinds = new Set<AnalyzerConflictKind>();

  [...filesByPatch.keys()].sort((a, b) => a.localeCompare(b)).forEach((file) => {
    const filePatches = filesByPatch.get(file) ?? [];
    const conflictRows = filesByConflict.get(file) ?? [];
    const touchingMods = uniqueSorted(filePatches.map((patch) => patch.modName));
    const risk = conflictRows.length >= 8 ? "danger" : conflictRows.length >= 3 ? "warn" : "safe";

    conflictRows.forEach((conflict) => {
      conflictKinds.add(classifyConflictKind(conflict.file, conflict.normalizedXpath));
    });

    fileRows.push({
      path: file,
      patches: uniqueSorted(filePatches.map((patch) => `${patch.operation}:${patch.path || patch.xpath}`)),
      touchingMods,
      conflicts: conflictRows.length,
      missing: false,
      risk
    });

    tree.push(buildXmlTreeForFile(file, filePatches, conflictRows));
  });

  const conflicts: AnalyzerConflict[] = rankedConflicts.map((entry, index) => {
    const kind = classifyConflictKind(entry.group.file, entry.group.normalizedXpath);
    conflictKinds.add(kind);
    return {
      id: String(index),
      file: entry.group.file,
      node: entry.group.normalizedXpath,
      kind,
      risk: buildRiskFromPriority(entry.priority),
      mods: uniqueSorted(entry.mods),
      final: entry.group.winner.modName,
      summary: `${entry.group.winner.operation} ${entry.group.winner.xpath}`
    };
  });

  const coreMods = mods.filter((mod) => mod.isCore).length;

  return {
    MODS: mods,
    XML_FILES: fileRows,
    CONFLICTS: conflicts,
    XML_TREE: tree,
    CONFLICT_KINDS: [...conflictKinds].sort((a, b) => a.localeCompare(b)),
    STATS: {
      generatedAt: pack.generatedAt,
      profile: pack.scan.profile,
      mo2Path: pack.scan.mo2Path,
      mods: pack.scan.enabledMods.length + pack.scan.entries.filter((entry) => entry.state === "disabled").length,
      enabledMods: pack.scan.enabledMods.length,
      userMods: Math.max(0, pack.scan.enabledMods.length - coreMods),
      coreMods,
      xmlFiles: filesByPatch.size,
      xmlPatches: pack.scan.xmlPatches.length,
      conflicts: pack.conflicts.length,
      warnings: pack.logs.warnings.length,
      dlls: pack.scan.dlls.length
    }
  };
}

function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAnalyzerHtml(data: AnalyzerUiModel): string {
  const escapedData = escapeScriptJson(JSON.stringify(data));
  const title = "7DTD Mod Conflict Analyzer";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    :root {
      --bg: #090f18;
      --surface-0: #101827;
      --surface-1: #172236;
      --surface-2: #1c2a43;
      --surface-3: #273451;
      --text-1: #ecf2ff;
      --text-2: #aeb6c4;
      --text-3: #8b96a8;
      --line: #2d4560;
      --accent: #72b7ff;
      --accent-2: #9fffb6;
      --warn: #ffd166;
      --danger: #ff7d7d;
      --safe: #7ef2b6;
    }
    * { box-sizing: border-box; }
    html, body, #app { margin: 0; width: 100%; height: 100%; }
    body {
      font-family: "Space Grotesk", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif;
      background: radial-gradient(1200px 380px at 10% -10%, #25314d 0%, transparent 60%),
        radial-gradient(700px 340px at 90% 110%, #172845 0%, transparent 55%),
        var(--bg);
      color: var(--text-1);
    }
    .app-shell {
      height: 100%;
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(18, 31, 53, 0.95), rgba(16, 23, 36, 0.9));
      padding: 16px 14px;
      overflow: auto;
    }
    .brand {
      font-size: 12px;
      color: var(--text-3);
      margin-bottom: 12px;
    }
    .brand strong {
      color: var(--text-1);
      font-size: 18px;
      display: block;
    }
    .nav {
      display: grid;
      gap: 8px;
    }
    .nav a {
      color: var(--text-2);
      text-decoration: none;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      justify-content: space-between;
      gap: 6px;
      font-size: 12px;
    }
    .nav a.active, .nav a:hover {
      border-color: var(--line);
      color: var(--text-1);
      background: rgba(114, 183, 255, 0.08);
    }
    .content {
      padding: 14px;
      overflow: auto;
    }
    .title {
      display: flex;
      gap: 8px;
      align-items: baseline;
      justify-content: space-between;
      margin: 2px 0 12px;
    }
    .title h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: .02em;
    }
    .title .muted { color: var(--text-3); font-size: 11px; }
    .panel {
      background: linear-gradient(180deg, rgba(28, 42, 67, 0.78), rgba(20, 30, 49, 0.85));
      border: 1px solid var(--line);
      border-radius: 10px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .panel h2 {
      margin: 0;
      background: rgba(31, 44, 68, 0.95);
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .panel-body {
      padding: 10px 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
      min-width: 0;
    }
    .kpi .label { color: var(--text-3); font-size: 11px; margin-bottom: 6px; }
    .kpi .value { color: var(--text-1); font-size: 22px; font-weight: 700; font-family: "JetBrains Mono", monospace; }
    .kpi .hint { color: var(--text-3); font-size: 11px; margin-top: 6px; }
    .btn {
      border: 1px solid #2b3e5f;
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-2);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn[disabled] { cursor: not-allowed; opacity: .5; }
    .btn.primary { color: #04151f; background: var(--safe); border-color: #2ff3a0; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin: 0; }
    .toolbar .search { margin-left: auto; width: min(260px, 35vw); }
    input {
      border: 1px solid var(--line);
      background: var(--surface-0);
      color: var(--text-1);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      min-width: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding: 7px 8px;
      vertical-align: top;
    }
    th {
      font-size: 11px;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: .03em;
    }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .mono { font-family: "JetBrains Mono", monospace; }
    .chip {
      border-radius: 999px;
      display: inline-block;
      padding: 2px 8px;
      font-size: 10px;
      margin-right: 4px;
      background: rgba(255,255,255,0.09);
      color: var(--text-2);
      text-transform: uppercase;
      white-space: nowrap;
    }
    .chip.danger { background: rgba(255,125,125,0.2); color: #ffc4c4; }
    .chip.warn { background: rgba(255,209,102,0.18); color: #ffe6a6; }
    .chip.safe { background: rgba(126,242,182,0.18); color: #a9ffd9; }
    .row-muted { color: var(--text-3); }
    .flex { display:flex; align-items:center; gap: 8px; flex-wrap: wrap; }
    .column-gap { row-gap: 10px; }
    .warning {
      padding: 10px;
      border-radius: 8px;
      border: 1px dashed #8c6f4f;
      color: #f4d4a4;
      background: rgba(145, 96, 34, 0.18);
      font-size: 12px;
    }
    .read-only {
      border-left: 3px solid var(--warn);
      padding: 2px 8px;
      color: var(--warn);
      font-size: 11px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div id="app"></div>

  <script id="MODS" type="application/json">${escapeScriptJson(JSON.stringify(data.MODS))}</script>
  <script id="XML_FILES" type="application/json">${escapeScriptJson(JSON.stringify(data.XML_FILES))}</script>
  <script id="CONFLICTS" type="application/json">${escapeScriptJson(JSON.stringify(data.CONFLICTS))}</script>
  <script id="XML_TREE" type="application/json">${escapeScriptJson(JSON.stringify(data.XML_TREE))}</script>
  <script id="CONFLICT_KINDS" type="application/json">${escapeScriptJson(JSON.stringify(data.CONFLICT_KINDS))}</script>
  <script id="STATS" type="application/json">${escapeScriptJson(JSON.stringify(data.STATS))}</script>
  <script id="__WASTELAND_CONTEXT__" type="application/json">${escapedData}</script>

  <script type="text/babel">
    const MODS = JSON.parse(document.getElementById("MODS").textContent || "[]");
    const XML_FILES = JSON.parse(document.getElementById("XML_FILES").textContent || "[]");
    const CONFLICTS = JSON.parse(document.getElementById("CONFLICTS").textContent || "[]");
    const STATS = JSON.parse(document.getElementById("STATS").textContent || "{}");
    const CONTEXT = JSON.parse(document.getElementById("__WASTELAND_CONTEXT__").textContent || "{}");

    window.MODS = MODS;
    window.XML_FILES = XML_FILES;
    window.CONFLICTS = CONTEXT.CONFLICTS || CONFLICTS;
    window.XML_TREE = CONTEXT.XML_TREE || [];
    window.CONFLICT_KINDS = CONTEXT.CONFLICT_KINDS || [];
    window.STATS = STATS;

    const { useMemo, useState } = React;

    const escapeHtml = (value) => String(value)
      .replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

    function StatCard({ label, value, hint }) {
      return (
        <article className="kpi">
          <div className="label">{label}</div>
          <div className="value">{value}</div>
          <div className="hint">{hint}</div>
        </article>
      );
    }

    function Dashboard() {
      return (
        <section className="panel" id="dashboard">
          <h2>Dashboard</h2>
          <div className="panel-body">
            <div className="grid">
              <StatCard label="Enabled Mods" value={STATS.enabledMods || 0} hint={(STATS.userMods || 0) + " user / " + (STATS.coreMods || 0) + " core"} />
              <StatCard label="XML Ops" value={STATS.xmlPatches || 0} hint={(STATS.xmlFiles || 0) + " files"} />
              <StatCard label="Conflicts" value={STATS.conflicts || 0} hint="review required" />
              <StatCard label="Warnings" value={STATS.warnings || 0} hint="runtime scan items" />
            </div>
          </div>
        </section>
      );
    }

    function Sidebar() {
      return (
        <aside className="sidebar">
          <div className="brand"><strong>7DTD Mod Conflict Analyzer</strong>read-only diagnostics</div>
          <div className="nav">
            <a href="#dashboard" className="active">Dashboard</a>
            <a href="#load-order">Load Order</a>
            <a href="#xml-browser">XML Browser</a>
            <a href="#conflicts">Conflict Viewer</a>
            <a href="#tweaks">Tweaks Panel</a>
          </div>
          <hr style={{ borderColor: "rgba(255,255,255,.1)", borderWidth: 1, borderStyle: "solid", margin: "12px 0" }} />
          <div className="row-muted" style={{ fontSize: 11 }}>Top mods</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {MODS.slice(0, 18).map((mod) => (
              <div key={mod.name + "-" + mod.order} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
                <span>{mod.name}</span>
                <span className="chip">{mod.order}</span>
              </div>
            ))}
          </div>
        </aside>
      );
    }

    function LoadOrder() {
      return (
        <section className="panel" id="load-order">
          <h2>Load Order</h2>
          <div className="panel-body" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Order</th><th>Mod Name</th><th>Folder</th><th>Author</th><th>Version</th><th>Patch count</th><th>Files</th></tr>
              </thead>
              <tbody>
                {MODS.map((mod) => (
                  <tr key={mod.order + "-" + mod.name}>
                    <td className="mono">{mod.order}</td>
                    <td>{mod.name}</td>
                    <td>{mod.folder}</td>
                    <td>{mod.author}</td>
                    <td>{mod.version}</td>
                    <td className="mono">{mod.patchCount}</td>
                    <td>{mod.files.join(", ") || "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    function XmlBrowser() {
      return (
        <section className="panel" id="xml-browser">
          <h2>XML Browser</h2>
          <div className="panel-body" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Path</th><th>Risk</th><th>Patch Count</th><th>Touching Mods</th><th>Conflicts</th></tr>
              </thead>
              <tbody>
                {XML_FILES.map((file) => (
                  <tr key={file.path}>
                    <td><span className="mono">{file.path}</span></td>
                    <td><span className={"chip " + file.risk}>{file.risk}</span></td>
                    <td className="mono">{file.patches.length}</td>
                    <td>{(file.touchingMods || []).join(", ") || "n/a"}</td>
                    <td className="mono">{file.conflicts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    function ConflictViewer() {
      const [query, setQuery] = useState("");
      const [kind, setKind] = useState("all");

      const kinds = useMemo(() => {
        const list = [...new Set(CONFLICTS.map((conflict) => conflict.kind))];
        return ["all", ...list];
      }, []);

      const filtered = useMemo(() => {
        const q = query.toLowerCase();
        return CONFLICTS.filter((conflict) => {
          const matchesKind = kind === "all" || conflict.kind === kind;
          const text = [conflict.file, conflict.node, ...conflict.mods].join(" ").toLowerCase();
          return matchesKind && (q === "" || text.includes(q));
        });
      }, [query, kind]);

      return (
        <section className="panel" id="conflicts">
          <h2>Conflict Viewer</h2>
          <div className="panel-body">
            <div className="toolbar">
              <input className="search" placeholder="search file / node / mod" value={query} onChange={(ev) => setQuery(ev.target.value)} />
              <select style={{ border: "1px solid var(--line)", background: "var(--surface-0)", color: "var(--text-1)", borderRadius: 8, padding: 6, fontSize: 12 }} value={kind} onChange={(ev) => setKind(ev.target.value)}>
                {kinds.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <span className="chip safe">{filtered.length} rows</span>
            </div>
            <div style={{ marginTop: 8, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr><th>Priority</th><th>File</th><th>Node</th><th>Mods</th><th>Final</th><th>Summary</th></tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td><span className={"chip " + item.risk}>{item.risk}</span></td>
                      <td><span className="mono">{item.file}</span></td>
                      <td><span className="mono">{item.node}</span></td>
                      <td>{(item.mods || []).join(" -> ")}</td>
                      <td className="mono">{item.final}</td>
                      <td>{item.summary}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={6} className="row-muted">No matching conflicts.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      );
    }

    function TweaksPanel() {
      return (
        <section className="panel" id="tweaks">
          <h2>Tweaks Panel</h2>
          <div className="panel-body">
            <div className="read-only">Read-only mode: this view is diagnostics only.</div>
            <div className="flex">
              <button className="btn" disabled title="read-only mode in this version">Rescan</button>
              <button className="btn primary" disabled title="read-only mode in this version">Apply zzz_ patch</button>
              <span className="row-muted">Rescan/Apply operations are intentionally disabled.</span>
            </div>
          </div>
        </section>
      );
    }

    function App() {
      return (
        <div className="app-shell">
          <Sidebar />
          <main className="content">
            <header className="title">
              <div>
                <h1>7DTD Mod Conflict Analyzer</h1>
                <div className="muted">{escapeHtml(STATS.profile || "default")} / {escapeHtml(STATS.mo2Path || "mo2")} / {escapeHtml(STATS.generatedAt || "")}</div>
              </div>
            </header>
            <Dashboard />
            <LoadOrder />
            <XmlBrowser />
            <ConflictViewer />
            <TweaksPanel />
          </main>
        </div>
      );
    }

    ReactDOM.render(<App />, document.getElementById("app"));
  </script>
</body>
</html>`;
}
