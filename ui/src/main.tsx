import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadInitialModel, readContextFile } from "./dataLoader";
import { conflictKinds } from "./model";
import type { ConflictCategory, LayoutMode, Risk, UiAttr, UiModel, UiNode, ViewId } from "./types";
import "./styles.css";

const tweakDefaults = {
  conflictLayout: "3-column" as LayoutMode,
  wireframe: false,
  accentColor: "#6ea8fe"
};

function App() {
  const [model, setModel] = useState<UiModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("dashboard");
  const [highlightMod, setHighlightMod] = useState<string | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutMode>(tweakDefaults.conflictLayout);
  const [wireframe, setWireframe] = useState(tweakDefaults.wireframe);
  const [accentColor, setAccentColor] = useState(tweakDefaults.accentColor);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInitialModel().then(setModel).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor);
    document.body.classList.toggle("wireframe", wireframe);
  }, [accentColor, wireframe]);

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setLoadError(null);
      setModel(await readContextFile(file));
      setView("dashboard");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!model) {
    return <div className="boot">{loadError ?? "Loading analyzer..."}</div>;
  }

  const meta = viewMeta(view, selectedFile, model);
  return (
    <div className="app">
      <div className="titlebar">
        <div className="dots"><span className="dot r" /><span className="dot y" /><span className="dot g" /></div>
        <span className="title-text">7DTD Mod Conflict Analyzer</span>
        <span className="meta">{model.profile} - {model.mods.length} loaded</span>
      </div>

      <Sidebar model={model} view={view} setView={setView} />

      <main className="main">
        <div className="main-header">
          <h1>{meta.title}</h1>
          <span className="crumbs">{meta.crumbs.join(" / ")}</span>
          <span className="spacer" />
          <input className="search" placeholder="search nodes, mods, files..." aria-label="Search" />
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void loadFile(event.target.files?.[0])} />
          <button className="btn" type="button" onClick={() => fileInput.current?.click()}>Load JSON</button>
          <button className="btn" type="button" title="Non-destructive placeholder">Rescan</button>
          <button className="btn primary" type="button" disabled title="Disabled: diagnostic UI only">Apply zzz_ patch</button>
        </div>
        {loadError && <div className="notice danger">{loadError}</div>}
        {model.source === "sample" && <div className="notice">No ui/public/context.json found. Showing bundled sample diagnostics.</div>}
        <div className="main-content">
          {view === "dashboard" && <Dashboard model={model} setView={setView} setSelectedConflict={setSelectedConflict} />}
          {view === "load-order" && <LoadOrderView model={model} highlightMod={highlightMod} setHighlightMod={setHighlightMod} />}
          {view === "xml-browser" && <XmlBrowser model={model} setView={setView} setSelectedFile={setSelectedFile} highlightMod={highlightMod} setHighlightMod={setHighlightMod} />}
          {view === "conflict" && (
            <ConflictViewer
              model={model}
              selectedConflict={selectedConflict}
              selectedFile={selectedFile}
              layout={layout}
              setView={setView}
              highlightMod={highlightMod}
              setHighlightMod={setHighlightMod}
            />
          )}
          {view === "settings" && <Settings model={model} />}
        </div>
      </main>

      <div className="statusbar">
        <span className="item"><RiskChip risk="safe" dot /> ready</span>
        <span className="item">{model.source === "context" ? "ContextPack" : "sample"}</span>
        <span className="item">{model.stats.modsEnabled}/{model.stats.modsLoaded} mods</span>
        <span className="item danger-text">{model.stats.conflicts} conflict groups</span>
        <span className="item critical-text">{model.stats.missingXPath} missing</span>
        <span className="spacer" />
        <span className="item">UTF-8</span>
        <span className="item">XML / XPath</span>
      </div>

      <TweaksPanel layout={layout} setLayout={setLayout} wireframe={wireframe} setWireframe={setWireframe} accentColor={accentColor} setAccentColor={setAccentColor} />
    </div>
  );
}

function viewMeta(view: ViewId, selectedFile: string | null, model: UiModel) {
  const map = {
    dashboard: { title: "Dashboard", crumbs: ["analyzer", model.profile, "overview"] },
    "load-order": { title: "Mod Load Order", crumbs: ["analyzer", "mods", "load-order"] },
    "xml-browser": { title: "XML Target Browser", crumbs: ["analyzer", "xml"] },
    conflict: { title: "Diagnostics", crumbs: ["analyzer", "trace", selectedFile ?? "browse"] },
    settings: { title: "Settings", crumbs: ["analyzer", "settings"] }
  };
  return map[view];
}

function Sidebar({ model, view, setView }: { model: UiModel; view: ViewId; setView: (view: ViewId) => void }) {
  const views: { id: ViewId; label: string; glyph: string; count?: number }[] = [
    { id: "dashboard", label: "Dashboard", glyph: "D" },
    { id: "load-order", label: "Load Order", glyph: "L", count: model.mods.length },
    { id: "xml-browser", label: "XML Browser", glyph: "X", count: model.xmlFiles.length },
    { id: "conflict", label: "Diagnostics", glyph: "D", count: model.conflicts.length },
    { id: "settings", label: "Settings", glyph: "S" }
  ];
  return (
    <>
      <nav className="activity" aria-label="Views">
        {views.map((item) => (
          <button key={item.id} className={`activity-btn ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)} data-badge={item.id === "conflict" ? compactCount(item.count) : undefined} title={item.label}>
            <span className="ico">{item.glyph}</span>
          </button>
        ))}
        <div className="spacer" />
      </nav>
      <aside className="sidebar">
        <div className="sidebar-head"><span>Explorer</span><span className="mono">.</span></div>
        <div className="sidebar-section views-section">
          <div className="sidebar-section-title">Views</div>
          {views.map((item) => (
            <div key={item.id} className={`sidebar-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}>
              <span className="glyph">{item.glyph}</span><span>{item.label}</span>{item.count != null && <span className="count">{item.count}</span>}
            </div>
          ))}
        </div>
        <div className="divider" />
        <div className="sidebar-section mods-section">
          <div className="sidebar-section-title">Loaded Mods</div>
          {model.mods.slice(0, 80).map((mod) => (
            <div key={mod.id} className={`sidebar-item ${!mod.enabled ? "muted" : ""}`} onClick={() => setView("load-order")} title={`${mod.folder} (${mod.author})`}>
              <span className="glyph mono">{formatModOrder(mod)}</span>
              <span className={mod.isUser ? "user-text" : undefined}>{mod.name}</span>
              <span className="count">{mod.patchCount}</span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function Dashboard({ model, setView, setSelectedConflict }: { model: UiModel; setView: (view: ViewId) => void; setSelectedConflict: (id: string) => void }) {
  const conflictByKind = countBy(model.conflicts.map((conflict) => conflict.kind));
  const topConflicts = [...model.conflicts].sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || b.operations.length - a.operations.length || a.file.localeCompare(b.file));
  return (
    <div>
      <div className="dash-grid">
        <Kpi label="Mods loaded" value={model.stats.modsLoaded} sub={`${model.stats.modsEnabled} enabled`} />
        <Kpi label="XML files touched" value={model.stats.xmlFiles} sub={`${model.stats.totalPatches.toLocaleString()} patches total`} risk="info" />
        <Kpi label="Conflict groups" value={model.stats.conflicts} sub={`${conflictByKind["silent-overwrite"] ?? 0} silent overwrites`} risk="danger" />
        <Kpi label="Exact replay-proven" value={model.stats.exactConflictGroups} sub="concrete replay targets" risk="safe" />
        <Kpi label="Fallback" value={model.stats.fallbackConflictGroups} sub="footprint or normalized XPath" risk="warn" />
        <Kpi label="Replay warnings" value={model.stats.replayWarnings} sub={`${model.stats.missingXPath} misses`} risk="critical" />
      </div>
      <SectionTitle label="Conflict kind summary" />
      <Panel>
        <Table headers={["", "Conflict kind", "Description", "Count", ""]}>
          {(Object.entries(conflictKinds) as [keyof typeof conflictKinds, (typeof conflictKinds)[keyof typeof conflictKinds]][]).filter(([key]) => key !== "ok").map(([key, kind]) => (
            <tr key={key} onClick={() => setView("conflict")}>
              <td><RiskChip risk={kind.risk} dot /></td><td className="mono">{kind.label}</td><td className="muted">{kind.desc}</td><td className="num mono">{conflictByKind[key] ?? 0}</td><td className="mono muted">open</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <SectionTitle label="Top conflict groups to review" />
      <Panel>
        <Table headers={["", "File", "Target", "Proof", "Winner", "Operations"]}>
          {topConflicts.slice(0, 80).map((conflict) => (
            <tr key={conflict.id} onClick={() => { setSelectedConflict(conflict.id); setView("conflict"); }}>
              <td><RiskChip risk={conflict.risk} dot /></td>
              <td className="mono accent2">{conflict.file}</td>
              <td className="mono path-cell">{conflict.target}</td>
              <td><RiskChip risk={conflict.exact ? "safe" : "warn"} label={conflict.exact ? "exact" : "fallback"} /></td>
              <td><span className="chip safe">{conflict.winner}</span></td>
              <td className="mono">{conflict.operations.length}</td>
            </tr>
          ))}
          {topConflicts.length === 0 && <tr><td colSpan={6} className="muted">No conflict groups found in this context pack.</td></tr>}
        </Table>
      </Panel>
      <SectionTitle label="Mods overview" />
      <Panel className="bottom-panel">
        <Table headers={["", "Order", "Mod", "Author", "Patches", "Files"]}>
          {model.mods.map((mod) => (
            <tr key={mod.id} onClick={() => setView("load-order")}>
              <td><RiskChip risk={mod.missing ? "warn" : mod.enabled ? "safe" : "info"} dot /></td>
              <td className="num mono">{formatModOrder(mod)}</td>
              <td><strong className={mod.isUser ? "user-text" : undefined}>{mod.name}</strong><span className="mono muted pad-left">{mod.folder}/</span></td>
              <td className="mono muted">{mod.author}</td>
              <td className="num mono">{mod.patchCount}</td>
              <td className="mono muted">{mod.files.slice(0, 3).join(", ")}{mod.files.length > 3 ? ` +${mod.files.length - 3}` : ""}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function LoadOrderView({ model, highlightMod, setHighlightMod }: { model: UiModel; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  const displayMods = [...model.mods].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.order - b.order || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
  return (
    <div>
      <Panel className="top-panel">
        <div className="panel-head"><span>Load order - diagnostic view only</span><span className="hint">top: low priority / bottom: wins later</span><span className="right">{model.stats.modsEnabled}/{model.stats.modsLoaded} enabled</span></div>
        <div className="load-list">
          {displayMods.map((mod) => {
            const conflicts = model.conflicts.filter((conflict) => conflict.mods.includes(mod.id));
            return (
              <div key={`${mod.id}-${mod.sortOrder}`} className={["load-row", mod.enabled ? "enabled" : "disabled", mod.missing ? "missing" : "", mod.isCore ? "core" : "", mod.isUser ? "user" : "", highlightMod === mod.id ? "highlight" : ""].join(" ")} onMouseEnter={() => setHighlightMod(mod.id)} onMouseLeave={() => setHighlightMod(null)}>
                <span className="grip">::</span><span className="order">{formatModOrder(mod)}</span><span className="toggle" title="Display-only toggle" />
                <div className="body"><div className="name">{mod.name}<span className="folder">{mod.folder}/</span><span className="mono muted">v{mod.version}</span></div><div className="meta"><span>by {mod.author}</span><span>{mod.patchCount} patches</span><span>{mod.files.length} touch files</span>{mod.modlistLine != null && <span>line {mod.modlistLine}</span>}</div></div>
                <div className="badges">{mod.missing ? <RiskChip risk="warn" label="missing" /> : conflicts.length > 0 ? <RiskChip risk={riskFromConflicts(conflicts.map((c) => c.risk))} label={String(conflicts.length)} /> : <RiskChip risk="safe" label="ok" />}</div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function XmlBrowser({ model, setView, setSelectedFile, highlightMod, setHighlightMod }: { model: UiModel; setView: (view: ViewId) => void; setSelectedFile: (file: string) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const filtered = model.xmlFiles.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()));
  return (
    <div>
      <div className="filterbar"><input className="search wide" placeholder="filter file..." value={query} onChange={(event) => setQuery(event.target.value)} /><span className="mono muted">{filtered.length} files</span></div>
      <Panel>
        <Table headers={["", "XML file", "Patches", "Mods touching", "Conflicts", "Misses", "Risk"]}>
          {filtered.map((file) => (
            <tr key={file.path} onClick={() => { setSelectedFile(file.path); setView("conflict"); }}>
              <td><RiskChip risk={file.risk} dot /></td><td className="mono accent2">{file.path}</td><td className="num mono">{file.patches}</td><td><ChipList values={file.touchingMods.slice(0, 6)} /></td><td className="num mono danger-text">{file.conflicts}</td><td className="num mono critical-text">{file.missing}</td><td><RiskChip risk={file.risk} /></td>
            </tr>
          ))}
        </Table>
      </Panel>
      <SectionTitle label="File patch heatmap by mod" />
      <Panel className="bottom-panel table-scroll">
        <table className="table heat-table">
          <thead><tr><th>File / Mod</th>{model.mods.filter((m) => !m.isCore).slice(0, 20).map((mod) => <th key={mod.id} onMouseEnter={() => setHighlightMod(mod.id)} onMouseLeave={() => setHighlightMod(null)}>{String(mod.order).padStart(2, "0")}<br /><span>{mod.folder.slice(0, 14)}</span></th>)}</tr></thead>
          <tbody>{model.xmlFiles.map((file) => <tr key={file.path}><td className="mono accent2">{file.path}</td>{model.mods.filter((m) => !m.isCore).slice(0, 20).map((mod) => <td key={mod.id}><div className={file.touchingMods.includes(mod.id) ? `heat-cell ${highlightMod === mod.id ? "active" : ""}` : "heat-empty"}>{file.touchingMods.includes(mod.id) ? "." : ""}</div></td>)}</tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}

function ConflictViewer(props: { model: UiModel; selectedConflict: string | null; selectedFile: string | null; layout: LayoutMode; setView: (view: ViewId) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  const { model, selectedConflict, selectedFile, layout } = props;
  const [tab, setTab] = useState<ConflictCategory>("value");
  const flat = useMemo(() => flattenTree(model, tab), [model, tab]);
  const valueCount = model.conflictCounts.value + model.conflictCounts.mixed;
  const structuralCount = model.conflictCounts.structural + model.conflictCounts.mixed;
  const initial = useMemo(() => {
    if (selectedConflict) {
      const conflict = model.conflicts.find((item) => item.id === selectedConflict);
      const hit = flat.find((item) => item.kind === "attr" && item.attr.conflictId === conflict?.id);
      if (hit) return hit;
    }
    if (selectedFile) {
      const hit = flat.find((item) => item.kind === "attr" && item.file === selectedFile);
      if (hit) return hit;
    }
    return flat.find((item) => item.kind === "attr");
  }, [flat, model.conflicts, selectedConflict, selectedFile]);
  const [selected, setSelected] = useState<FlatItem | undefined>(initial);
  useEffect(() => setSelected(initial), [initial]);
  const layoutView = layout === "timeline"
    ? <TimelineLayout flat={flat} selected={selected} setSelected={setSelected} {...props} />
    : layout === "unified"
      ? <UnifiedLayout flat={flat} selected={selected} setSelected={setSelected} {...props} />
      : <ThreeColumnLayout flat={flat} selected={selected} setSelected={setSelected} {...props} />;
  return (
    <div className="cv-view">
      <div className="cv-tabs" role="tablist" aria-label="Conflict category">
        <button type="button" role="tab" aria-selected={tab === "value"} className={tab === "value" ? "active" : ""} onClick={() => setTab("value")}>Values <span>{valueCount}</span></button>
        <button type="button" role="tab" aria-selected={tab === "structural"} className={tab === "structural" ? "active" : ""} onClick={() => setTab("structural")}>Structural <span>{structuralCount}</span></button>
      </div>
      {layoutView}
    </div>
  );
}

type FlatItem = { kind: "file"; file: string; depth: number; label: string; risk: Risk } | { kind: "node"; file: string; node: UiNode; depth: number; label: string; risk: Risk } | { kind: "attr"; file: string; node: UiNode; attr: UiAttr; depth: number; label: string; risk: Risk };

function flattenTree(model: UiModel, tab: ConflictCategory): FlatItem[] {
  const out: FlatItem[] = [];
  for (const [file, content] of Object.entries(model.xmlTree)) {
    const fileStart = out.length;
    out.push({ kind: "file", file, depth: 0, label: file, risk: model.xmlFiles.find((item) => item.path === file)?.risk ?? "safe" });
    for (const node of content.children) {
      const attrs = node.attrs.filter((attr) => categoryInTab(attr.category, tab));
      if (attrs.length === 0) continue;
      out.push({ kind: "node", file, node, depth: 1, label: node.label, risk: node.risk });
      for (const attr of attrs) out.push({ kind: "attr", file, node, attr, depth: 2, label: attr.name, risk: attr.risk });
    }
    if (out.length === fileStart + 1) {
      out.pop();
    }
  }
  return out;
}

function categoryInTab(category: ConflictCategory, tab: ConflictCategory): boolean {
  if (category === "mixed") return tab === "value" || tab === "structural";
  return category === tab;
}

function ThreeColumnLayout({ flat, selected, setSelected, setView, highlightMod, setHighlightMod }: { flat: FlatItem[]; selected?: FlatItem; setSelected: (item: FlatItem) => void; setView: (view: ViewId) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  return (
    <div className="cv-shell">
      <TreePane flat={flat} selected={selected} setSelected={setSelected} query={query} setQuery={setQuery} />
      <div className="cv-pane"><div className="cv-pane-head"><span>Change history</span><span className="hint">low priority to high priority</span></div><HistoryPane item={selected} highlightMod={highlightMod} setHighlightMod={setHighlightMod} /></div>
      <div className="cv-pane"><div className="cv-pane-head"><span>Detail / Explanation</span></div><ExplainPane item={selected} setView={setView} highlightMod={highlightMod} setHighlightMod={setHighlightMod} /></div>
    </div>
  );
}

function UnifiedLayout(props: { flat: FlatItem[]; selected?: FlatItem; setSelected: (item: FlatItem) => void; setView: (view: ViewId) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  return <div className="cv-unified"><TreePane flat={props.flat} selected={props.selected} setSelected={props.setSelected} /><div className="cv-pane"><HistoryPane item={props.selected} highlightMod={props.highlightMod} setHighlightMod={props.setHighlightMod} /><ExplainPane item={props.selected} setView={props.setView} highlightMod={props.highlightMod} setHighlightMod={props.setHighlightMod} /></div></div>;
}

function TimelineLayout(props: { flat: FlatItem[]; selected?: FlatItem; setSelected: (item: FlatItem) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  const attrs = props.flat.filter((item) => item.kind === "attr");
  const selected = props.selected?.kind === "attr" ? props.selected : attrs[0];
  return <div className="cv-timeline"><TreePane flat={props.flat} selected={props.selected} setSelected={props.setSelected} /><div className="cv-pane"><div className="cv-pane-head">Timeline</div>{selected?.kind === "attr" && <HistoryPane item={selected} highlightMod={props.highlightMod} setHighlightMod={props.setHighlightMod} timeline />}</div></div>;
}

function TreePane({ flat, selected, setSelected, query = "", setQuery }: { flat: FlatItem[]; selected?: FlatItem; setSelected: (item: FlatItem) => void; query?: string; setQuery?: (value: string) => void }) {
  const filtered = flat.filter((item) => !query || item.label.toLowerCase().includes(query.toLowerCase()));
  return <div className="cv-pane"><div className="cv-pane-head"><span>Conflict Groups</span>{setQuery && <input className="mini-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="filter..." />}</div><div className="tree">{filtered.length === 0 ? <div className="empty compact">No conflicts in this tab.</div> : filtered.map((item, index) => <TreeNode key={index} item={item} selected={selected} onSelect={setSelected} />)}</div></div>;
}

function TreeNode({ item, selected, onSelect }: { item: FlatItem; selected?: FlatItem; onSelect: (item: FlatItem) => void }) {
  const selectedId = selected ? flatId(selected) : "";
  return <div className={`tree-node ${flatId(item) === selectedId ? "active" : ""}`} data-depth={item.depth} onClick={() => onSelect(item)}><span className="twist">{item.kind === "attr" ? "." : "v"}</span><RiskChip risk={item.risk} dot /><span className="label">{item.label}</span></div>;
}

function flatId(item: FlatItem) {
  if (item.kind === "file") return item.file;
  if (item.kind === "node") return `${item.file}|${item.node.path}`;
  return `${item.file}|${item.node.path}|${item.attr.name}`;
}

function HistoryPane({ item, highlightMod, setHighlightMod, timeline = false }: { item?: FlatItem; highlightMod: string | null; setHighlightMod: (id: string | null) => void; timeline?: boolean }) {
  if (!item || item.kind !== "attr") return <div className="empty"><div className="ico">&lt;/&gt;</div><div>Select a node or attribute.</div></div>;
  const { attr, node, file } = item;
  const structural = attr.category === "structural" || attr.finalKind === "status";
  const finalLabel = attr.finalKind === "candidate" ? "CANDIDATE" : attr.finalKind === "status" ? "STATUS" : "FINAL";
  const proofLabel = attr.exact === false ? "FALLBACK" : "EXACT";
  return (
    <div className={timeline ? "history-shell timeline-mode" : "history-shell"}>
      <div className="history-head">
        <div className="title-row"><RiskChip risk={attr.risk} /><h2>{attr.name}</h2><span className="mono muted">{conflictKinds[attr.kind].label}</span><span className={`chip ${attr.exact === false ? "warn" : "safe"}`}>{proofLabel}</span><span className={`chip ${attr.category === "value" ? "info" : attr.category === "mixed" ? "warn" : "critical"}`}>{categoryLabel(attr.category)}</span></div>
        <div className="xpath">{file} :: <span>{attr.target ?? node.path}</span></div>
        <div className="detail-strip"><span>{attr.sourceLabel ?? "Trace-derived fallback"}</span><span>winner: {attr.winner ?? "(unknown)"}</span><span>{attr.operations?.length ?? attr.history.length} operations</span></div>
      </div>
      <div className="timeline">
        <div className="tl-row vanilla"><span className="bullet" /><div className="mod-info"><div className="nm">vanilla</div><div className="author">7 Days to Die / Data/Config</div></div><div className="op-value"><span className="op">base</span><span className="value-cur">{attr.vanilla ?? "(unknown)"}</span></div><span className="verdict">base</span></div>
        {attr.history.map((history, index) => {
          const isWin = history.mod === attr.winner;
          return <div key={index} className={["tl-row", isWin ? "win" : "", history.error ? "error" : "", highlightMod === history.mod ? "highlight" : ""].join(" ")} onMouseEnter={() => setHighlightMod(history.mod)} onMouseLeave={() => setHighlightMod(null)}><span className="bullet" /><div className="mod-info"><div className="nm"><span className="order">prio {String(history.order).padStart(2, "0")}</span><span>{history.mod}</span>{isWin && <span className="winner-tag">{finalLabel}</span>}</div><div className="author">{history.authored ? `authored: ${history.authored}` : history.error ?? "diagnostic only"}</div></div><div className="op-value"><span className={`op ${history.op}`}>{history.op}</span><span className="value-cur" title={history.value ?? ""}>{history.value ?? "(unknown)"}</span></div><span className="verdict">{history.error ? "unresolved" : isWin ? attr.finalKind === "candidate" ? "candidate" : "wins" : "shadowed"}</span></div>;
        })}
      </div>
      <div className="final-card"><div><div className="lab">{structural ? "Structural status" : attr.finalKind === "candidate" ? "Candidate final" : "Final value"}</div><div className="val">{attr.final ?? "(unknown)"}</div><div className="from">{attr.finalKind === "candidate" ? "candidate source" : "winner"}: {attr.winner ?? "(unknown)"}</div></div><div className="final-chips"><RiskChip risk={attr.exact === false ? "warn" : "safe"} label={proofLabel.toLowerCase()} /><RiskChip risk={attr.risk} label={finalLabel.toLowerCase()} /></div></div>
    </div>
  );
}

function ExplainPane({ item, setView, highlightMod, setHighlightMod }: { item?: FlatItem; setView: (view: ViewId) => void; highlightMod: string | null; setHighlightMod: (id: string | null) => void }) {
  if (!item || item.kind !== "attr") return <div className="empty"><div className="ico">i</div><div>Details appear here.</div></div>;
  const attr = item.attr;
  const categoryText = attr.exact === false
    ? fallbackText(attr.sourceLabel)
    : attr.category === "structural"
      ? "Replay proved a structural target. Append, remove, and insert operations change the document shape, so the result is shown as a status instead of a scalar value."
      : "Replay proved the concrete target. The timeline shows each operation in load-order order and marks the current winner.";
  const evidence = attr.evidence ?? [];
  return <div className="explain"><div><div className="kind-label">{conflictKinds[attr.kind].label} / {categoryLabel(attr.category)}</div><h3>{attr.name}</h3></div><p>{categoryText}</p><div className="rec"><div className="head">Replay basis</div>{attr.note ?? "Read the history from top to bottom. Higher priority rows later in the list can shadow earlier rows."}</div><div className="evidence-list">{evidence.map((item) => <div className="evidence-block" key={item.operationKey}><div className="mono muted">{item.operationKey.replaceAll("\0", " / ")}</div><div className="evidence-chips"><RiskChip risk={item.diagnosticKind && item.diagnosticKind !== "ok" ? conflictKinds[item.diagnosticKind].risk : "safe"} label={item.status ?? "not traced"} />{item.confidence && <span className="chip info">{item.confidence}</span>}</div><div className="muted">{item.message ?? (item.effects.map((effect) => `${effect.kind}: ${effect.target}`).join(", ") || "No replay effect was attached to this operation.")}</div></div>)}</div><div className="kind-label">Related mods ({attr.history.length})</div><ul className="mods-involved">{attr.history.map((history) => <li key={`${history.mod}-${history.order}-${history.op}`} onMouseEnter={() => setHighlightMod(history.mod)} onMouseLeave={() => setHighlightMod(null)} className={highlightMod === history.mod ? "active" : ""}><span className="order">{history.mod === attr.winner ? "win" : `p${history.order}`}</span><span>{history.mod}</span>{history.mod === attr.winner && <RiskChip risk="safe" dot />}</li>)}</ul><button className="link-button" onClick={() => setView("load-order")}>Open Load Order</button><button className="link-button" onClick={() => setView("xml-browser")}>Open XML Browser</button></div>;
}

function fallbackText(sourceLabel: string | undefined): string {
  if (/miss/i.test(sourceLabel ?? "")) return "Replay missed at least one XPath. The group is shown from replay miss evidence plus conservative fallback grouping.";
  if (/unsupported/i.test(sourceLabel ?? "")) return "At least one operation is not replay-supported, so the group is shown from conservative fallback evidence.";
  if (/parse/i.test(sourceLabel ?? "")) return "A parse error prevented exact replay proof, so this group falls back to normalized XPath or footprint evidence.";
  return "Exact replay proof was unavailable. This group uses footprint or normalized XPath fallback evidence.";
}

function categoryLabel(category: ConflictCategory): string {
  if (category === "value") return "Values";
  if (category === "structural") return "Structural";
  return "Mixed";
}

function Settings({ model }: { model: UiModel }) {
  return <Panel className="settings"><div className="panel-head">Settings</div><div className="settings-body"><p><span className="mono accent2">MO2:</span> {model.mo2Path}</p><p><span className="mono accent2">Profile:</span> {model.profile}</p><p><span className="mono accent2">Generated:</span> {model.generatedAt}</p><p className="muted">This React UI is diagnostics-only. Rescan and patch apply controls do not write to MO2, the game install, a dedicated server, or a remote PC.</p></div></Panel>;
}

function TweaksPanel({ layout, setLayout, wireframe, setWireframe, accentColor, setAccentColor }: { layout: LayoutMode; setLayout: (value: LayoutMode) => void; wireframe: boolean; setWireframe: (value: boolean) => void; accentColor: string; setAccentColor: (value: string) => void }) {
  return <div className="twk-panel"><div className="twk-hd"><b>Tweaks</b></div><div className="twk-body"><label>Conflict viewer<select value={layout} onChange={(event) => setLayout(event.target.value as LayoutMode)}><option>3-column</option><option>unified</option><option>timeline</option></select></label><label className="twk-row-h"><span>Wireframe mode</span><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} /></label><label>Accent<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label></div></div>;
}

function Kpi({ label, value, sub, risk = "" }: { label: string; value: number; sub: string; risk?: Risk | "" }) {
  return <div className={`kpi ${risk}`}><span className="label">{label}</span><span className="value">{value.toLocaleString()}</span><span className="sub">{sub}</span></div>;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

function SectionTitle({ label }: { label: string }) {
  return <div className="section-title"><span>{label}</span><span className="line" /></div>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="table-wrap"><table className="table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function RiskChip({ risk, label, dot = false }: { risk: Risk; label?: string; dot?: boolean }) {
  return <span className={`chip ${dot ? "dot" : ""} ${risk}`}>{dot ? "" : label ?? risk}</span>;
}

function ChipList({ values }: { values: string[] }) {
  return <span className="chip-list">{values.map((value) => <span key={value} className="mod-chip">{value}</span>)}</span>;
}

function formatModOrder(mod: { enabled: boolean; order: number }) {
  return mod.enabled && mod.order >= 0 ? String(mod.order).padStart(2, "0") : "--";
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function compactCount(value: number | undefined): string | undefined {
  if (value == null) return undefined;
  return value > 999 ? "999+" : String(value);
}

function riskFromConflicts(risks: Risk[]): Risk {
  if (risks.includes("critical")) return "critical";
  if (risks.includes("danger")) return "danger";
  if (risks.includes("warn")) return "warn";
  if (risks.includes("info")) return "info";
  return "safe";
}

function riskRank(risk: Risk): number {
  return { safe: 0, info: 1, warn: 2, danger: 3, critical: 4 }[risk];
}

createRoot(document.getElementById("root")!).render(<App />);
