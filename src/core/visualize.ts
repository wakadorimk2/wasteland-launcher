import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConflictGroup, ContextPack, LogWarning } from "./types.js";

export interface RankedConflict {
  group: ConflictGroup;
  score: number;
  mods: string[];
  priority: "high" | "medium" | "low";
}

interface FileRanking {
  file: string;
  count: number;
}

export type ConflictCategory = "item" | "lootgroup" | "perk" | "buff" | "window/xui" | "block" | "entity" | "recipe/quest/trader" | "other";

interface TreemapItem {
  id: string;
  file: string;
  count: number;
  risk: number;
  maxPriority: RankedConflict["priority"];
  conflictIds: number[];
}

interface HeatmapCell {
  id: string;
  file: string;
  category: ConflictCategory;
  count: number;
  risk: number;
  maxPriority: RankedConflict["priority"];
  conflictIds: number[];
}

interface DetailItem {
  id: number;
  priority: RankedConflict["priority"];
  score: number;
  file: string;
  xpath: string;
  winner: string;
  winnerOperation: string;
  winnerXpath: string;
  mods: string[];
  match: string;
}

const categoryOrder: ConflictCategory[] = ["item", "lootgroup", "perk", "buff", "window/xui", "block", "entity", "recipe/quest/trader", "other"];

export async function readContextPack(filePath: string): Promise<ContextPack> {
  return JSON.parse(await readFile(filePath, "utf8")) as ContextPack;
}

export async function writeHtmlReport(filePath: string, html: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${html}\n`, "utf8");
}

export function renderVisualization(pack: ContextPack): string {
  const rankedConflicts = rankConflicts(pack.conflicts);
  const treemapItems = buildTreemapItems(rankedConflicts);
  const heatmapCells = buildHeatmapCells(rankedConflicts);
  const rankedWarnings = rankWarnings(pack.logs.warnings);
  const maxTreemapRisk = Math.max(1, ...treemapItems.map((item) => item.risk));
  const maxHeatmapRisk = Math.max(1, ...heatmapCells.map((cell) => cell.risk));
  const hotspotCells = rankHeatmapHotspots(heatmapCells);
  const generatedAt = formatDate(pack.generatedAt);
  const detailData: DetailItem[] = rankedConflicts.map((item, id) => ({
    id,
    priority: item.priority,
    score: item.score,
    file: item.group.file,
    xpath: item.group.normalizedXpath,
    winner: item.group.winner.modName,
    winnerOperation: item.group.winner.operation,
    winnerXpath: item.group.winner.xpath,
    mods: item.mods,
    match: item.group.exact ? "exact" : "near"
  }));
  const initialIds = hotspotCells[0]?.conflictIds.slice(0, 20) ?? detailData.slice(0, 20).map((item) => item.id);
  const initialDetails = detailData.filter((item) => initialIds.includes(item.id));
  const initialTitle = hotspotCells[0] ? `${hotspotCells[0].file} / ${hotspotCells[0].category}` : "Top Risk Conflicts";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wasteland Conflict Report</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #06111f;
      --bg-2: #0a1728;
      --panel: rgba(12, 27, 46, 0.82);
      --panel-2: rgba(9, 22, 39, 0.94);
      --ink: #ecf7ff;
      --muted: #94a9bd;
      --line: rgba(126, 218, 255, 0.18);
      --cyan: #40d9ff;
      --magenta: #ff4fd8;
      --orange: #ff9b45;
      --green: #4de28d;
      --red: #ff596d;
      --low: #72829a;
      --shadow: 0 20px 70px rgba(0, 0, 0, 0.32);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(rgba(64, 217, 255, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(64, 217, 255, 0.035) 1px, transparent 1px),
        radial-gradient(circle at 20% 0%, rgba(64, 217, 255, 0.17), transparent 34%),
        radial-gradient(circle at 82% 8%, rgba(255, 79, 216, 0.12), transparent 30%),
        var(--bg);
      background-size: 34px 34px, 34px 34px, auto, auto, auto;
      color: var(--ink);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    header, main { width: min(1460px, calc(100vw - 32px)); margin: 0 auto; }
    header { padding: 30px 0 18px; }
    h1 { margin: 0; font-size: clamp(30px, 4vw, 54px); font-weight: 800; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 16px; letter-spacing: 0; text-transform: uppercase; color: #cfeeff; }
    .meta { margin-top: 8px; color: var(--muted); font-size: 13px; font-family: Consolas, "Cascadia Mono", monospace; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }
    .metric { position: relative; padding: 16px 16px 18px; min-width: 0; overflow: hidden; }
    .metric strong { display: block; font-size: clamp(30px, 4vw, 48px); line-height: 1; font-family: Consolas, "Cascadia Mono", monospace; }
    .metric span { display: block; color: var(--muted); font-size: 12px; margin-top: 8px; text-transform: uppercase; letter-spacing: 0; overflow-wrap: anywhere; }
    .metric::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--metric-color, var(--cyan)); box-shadow: 0 0 18px var(--metric-color, var(--cyan)); }
    .layout {
      display: grid;
      grid-template-columns: minmax(440px, 1.1fr) minmax(520px, 1fr);
      gap: 18px;
      align-items: start;
    }
    section { padding: 18px; margin-bottom: 18px; }
    .focus-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 14px;
      align-items: start;
    }
    .hotspot-rail {
      display: grid;
      gap: 10px;
    }
    .hotspot-button {
      border: 1px solid rgba(255, 155, 69, 0.26);
      border-radius: 8px;
      padding: 12px;
      background: rgba(8, 20, 35, 0.84);
      color: var(--ink);
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .hotspot-button[data-active="true"], .heat-cell[data-active="true"], .tile[data-active="true"] {
      border-color: rgba(255, 155, 69, 0.9);
      box-shadow: 0 0 28px rgba(255, 155, 69, 0.24);
    }
    .hotspot-rank { color: var(--orange); font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; font-weight: 800; }
    .hotspot-name { display: block; margin-top: 4px; font-family: Consolas, "Cascadia Mono", monospace; font-weight: 800; overflow-wrap: anywhere; }
    .hotspot-meta { display: block; margin-top: 8px; color: var(--muted); font-size: 12px; }
    .hotspot-count { display: block; margin-top: 10px; font-family: Consolas, "Cascadia Mono", monospace; font-size: 30px; line-height: 1; }
    .treemap {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      min-height: 360px;
      align-content: stretch;
    }
    .tile {
      flex: var(--basis) 1 150px;
      min-width: 140px;
      min-height: 100px;
      border: 1px solid rgba(64, 217, 255, 0.22);
      border-radius: 8px;
      padding: 12px;
      color: var(--ink);
      background: linear-gradient(135deg, rgba(64, 217, 255, var(--alpha)), rgba(255, 79, 216, calc(var(--alpha) * 0.55)));
      box-shadow: inset 0 0 28px rgba(255, 255, 255, 0.035), 0 0 24px rgba(64, 217, 255, 0.08);
      cursor: pointer;
      text-align: left;
      font: inherit;
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .tile:hover, .heat-cell:hover { transform: translateY(-2px); border-color: rgba(64, 217, 255, 0.7); box-shadow: 0 0 26px rgba(64, 217, 255, 0.18); }
    .tile-file, .cell-file, code { font-family: Consolas, "Cascadia Mono", monospace; overflow-wrap: anywhere; }
    .tile-file { font-size: 15px; font-weight: 800; }
    .tile-count { margin-top: 12px; font-family: Consolas, "Cascadia Mono", monospace; font-size: 32px; line-height: 1; }
    .subtle { color: var(--muted); font-size: 12px; }
    .heatmap { overflow: auto; }
    .heat-grid {
      display: grid;
      grid-template-columns: minmax(110px, 160px) repeat(${categoryOrder.length}, minmax(112px, 1fr));
      gap: 6px;
      min-width: 1120px;
    }
    .heat-head, .heat-file, .heat-cell {
      border-radius: 6px;
      border: 1px solid var(--line);
      min-height: 58px;
      padding: 9px;
    }
    .heat-head, .heat-file { background: rgba(8, 20, 35, 0.86); color: var(--muted); font-size: 12px; font-weight: 700; }
    .heat-file { color: var(--ink); font-family: Consolas, "Cascadia Mono", monospace; }
    .heat-head { position: sticky; top: 0; z-index: 2; }
    .heat-file { position: sticky; left: 0; z-index: 1; }
    .heat-cell {
      background: linear-gradient(135deg, rgba(255, 155, 69, var(--alpha)), rgba(255, 79, 216, calc(var(--alpha) * 0.7)));
      color: var(--ink);
      cursor: pointer;
      text-align: left;
      font: inherit;
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .cell-count { display: block; font-family: Consolas, "Cascadia Mono", monospace; font-size: 24px; line-height: 1; }
    .cell-priority { display: block; margin-top: 5px; color: rgba(236, 247, 255, 0.76); font-size: 11px; text-transform: uppercase; }
    .details-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .details-top h2 { margin-bottom: 0; }
    button.show-all {
      border: 1px solid rgba(64, 217, 255, 0.34);
      border-radius: 6px;
      background: rgba(64, 217, 255, 0.1);
      color: var(--ink);
      min-height: 34px;
      padding: 0 12px;
      cursor: pointer;
    }
    .detail-list { display: grid; gap: 10px; }
    .detail-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel-2);
    }
    .detail-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .detail-file { font-family: Consolas, "Cascadia Mono", monospace; font-weight: 800; color: #dff7ff; }
    .kv { display: grid; grid-template-columns: 76px 1fr; gap: 7px 10px; font-size: 12px; }
    .kv span { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0; }
    code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; overflow-wrap: anywhere; }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 58px;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
    }
    .high { background: var(--red); box-shadow: 0 0 14px rgba(255, 89, 109, 0.34); }
    .medium { background: var(--orange); color: #201107; }
    .low { background: var(--low); }
    .winner { color: var(--green); font-weight: 700; }
    .mods { color: var(--muted); }
    .warning-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .warning {
      border: 1px solid rgba(255, 155, 69, 0.28);
      border-radius: 8px;
      padding: 12px;
      background: linear-gradient(135deg, rgba(255, 155, 69, 0.13), rgba(255, 89, 109, 0.08));
    }
    .warning-line { color: #ffd7b3; font-size: 12px; margin-bottom: 6px; display: flex; gap: 8px; flex-wrap: wrap; }
    .tag { color: #081423; background: var(--orange); border-radius: 999px; padding: 1px 7px; font-weight: 800; }
    .warning-text { font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; overflow-wrap: anywhere; }
    .empty { color: var(--muted); padding: 10px 0; }
    @media (max-width: 900px) {
      header, main { width: min(100vw - 20px, 1460px); }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1fr; }
      .focus-layout { grid-template-columns: 1fr; }
      .treemap { min-height: 0; }
    }
    @media (max-width: 620px) {
      body {
        background-size: 26px 26px, 26px 26px, auto, auto, auto;
      }
      header, main { width: calc(100vw - 16px); }
      header { padding: 36px 0 12px; }
      h1 { font-size: 28px; line-height: 1.12; }
      h2 { font-size: 14px; margin-bottom: 12px; }
      .meta { font-size: 11px; overflow-wrap: anywhere; }
      .summary { gap: 8px; margin-bottom: 12px; }
      .metric { padding: 12px 12px 14px; }
      .metric strong { font-size: 28px; }
      .metric span { font-size: 10px; }
      section { padding: 12px; margin-bottom: 12px; }
      .focus-layout { gap: 0; }
      .heatmap { display: none; }
      .hotspot-rail { gap: 8px; }
      .hotspot-button {
        min-height: 116px;
        display: grid;
        grid-template-columns: 42px 1fr auto;
        grid-template-areas:
          "rank name count"
          "rank meta count";
        column-gap: 10px;
        align-items: center;
      }
      .hotspot-rank { grid-area: rank; font-size: 14px; }
      .hotspot-name { grid-area: name; margin-top: 0; font-size: 13px; }
      .hotspot-meta { grid-area: meta; margin-top: 4px; font-size: 11px; }
      .hotspot-count { grid-area: count; margin-top: 0; font-size: 34px; }
      .details-top { align-items: flex-start; }
      .details-top h2 { overflow-wrap: anywhere; }
      .detail-card { padding: 10px; }
      .detail-head { align-items: flex-start; }
      .kv { grid-template-columns: 1fr; gap: 4px; }
      .kv span { margin-top: 5px; }
      .treemap { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tile { min-width: 0; min-height: 88px; padding: 10px; }
      .tile-count { font-size: 26px; }
      .warning-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Wasteland Conflict Report</h1>
    <div class="meta">Generated ${escapeHtml(generatedAt)} from ${escapeHtml(pack.scan.mo2Path)} / ${escapeHtml(pack.scan.profile)}</div>
  </header>
  <main>
    <div class="summary">
      ${metric("Enabled Mods", pack.scan.enabledMods.length, "var(--cyan)")}
      ${metric("XML Ops", pack.scan.xmlPatches.length, "var(--magenta)")}
      ${metric("Conflicts", pack.conflicts.length, "var(--orange)")}
      ${metric("Warnings", pack.logs.warnings.length, "var(--green)")}
    </div>
    <section>
      <h2>Conflict Heatmap</h2>
      <div class="focus-layout">
        ${heatmapCells.length === 0 ? `<div class="empty">No conflict groups found.</div>` : renderHeatmap(heatmapCells, maxHeatmapRisk, hotspotCells[0]?.id)}
        <div class="hotspot-rail">${hotspotCells.slice(0, 8).map((cell, index) => renderHotspotButton(cell, index, cell.id === hotspotCells[0]?.id)).join("")}</div>
      </div>
    </section>
    <div class="layout">
      <section>
        <div class="details-top">
          <h2 id="detailsTitle">${escapeHtml(initialTitle)}</h2>
          <button class="show-all" id="showAll" type="button">Top risk</button>
        </div>
        <div id="detailsList" class="detail-list">${renderDetailCards(initialDetails)}</div>
      </section>
      <div>
        <section>
          <h2>Conflict Treemap</h2>
          ${treemapItems.length === 0 ? `<div class="empty">No conflict groups found.</div>` : `<div class="treemap">${treemapItems.map((item) => renderTreemapItem(item, maxTreemapRisk)).join("")}</div>`}
        </section>
        <section>
          <h2>Runtime Warning Hotspots</h2>
          ${rankedWarnings.length === 0 ? `<div class="empty">No warnings found.</div>` : `<div class="warning-grid">${rankedWarnings.slice(0, 24).map(renderWarning).join("")}</div>`}
        </section>
      </div>
    </div>
  </main>
  <script type="application/json" id="conflictData">${escapeScriptJson(JSON.stringify(detailData))}</script>
  <script>
    const conflicts = JSON.parse(document.getElementById("conflictData").textContent);
    const detailsList = document.getElementById("detailsList");
    const detailsTitle = document.getElementById("detailsTitle");
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function renderCards(items) {
      if (items.length === 0) return '<div class="empty">No matching conflict groups.</div>';
      return items.map((item) => '<article class="detail-card">' +
        '<div class="detail-head"><div class="detail-file">' + escapeHtml(item.file) + '</div><span class="pill ' + item.priority + '">' + escapeHtml(item.priority) + '</span></div>' +
        '<div class="kv"><span>XPath</span><code>' + escapeHtml(item.xpath) + '</code>' +
        '<span>Winner</span><div class="winner">' + escapeHtml(item.winner) + ' / ' + escapeHtml(item.winnerOperation) + '</div>' +
        '<span>Winner XPath</span><code>' + escapeHtml(item.winnerXpath) + '</code>' +
        '<span>Mods</span><div class="mods">' + escapeHtml(item.mods.join(" -> ")) + '</div>' +
        '<span>Match</span><div>' + escapeHtml(item.match) + ' / score ' + escapeHtml(item.score) + '</div></div>' +
      '</article>').join("");
    }
    function showDetails(ids, title) {
      const idSet = new Set(ids.map((id) => Number(id)));
      const selected = conflicts.filter((item) => idSet.has(item.id));
      detailsTitle.textContent = title;
      detailsList.innerHTML = renderCards(selected);
    }
    document.querySelectorAll("[data-conflict-ids]").forEach((el) => {
      el.addEventListener("click", () => {
        document.querySelectorAll("[data-active]").forEach((active) => active.dataset.active = "false");
        document.querySelectorAll('[data-cell-key="' + el.dataset.cellKey + '"]').forEach((active) => active.dataset.active = "true");
        showDetails(el.dataset.conflictIds.split(","), el.dataset.title);
      });
    });
    document.getElementById("showAll")?.addEventListener("click", () => {
      detailsTitle.textContent = "Top Risk Conflicts";
      detailsList.innerHTML = renderCards(conflicts.slice(0, 20));
    });
  </script>
</body>
</html>`;
}

export function buildTreemapItems(conflicts: RankedConflict[]): TreemapItem[] {
  const byFile = new Map<string, TreemapItem>();
  conflicts.forEach((item, id) => {
    const current = byFile.get(item.group.file) ?? { id: slugId(`file-${item.group.file}`), file: item.group.file, count: 0, risk: 0, maxPriority: "low", conflictIds: [] };
    current.count += 1;
    current.risk += item.score;
    current.maxPriority = higherPriority(current.maxPriority, item.priority);
    current.conflictIds.push(id);
    byFile.set(item.group.file, current);
  });
  return [...byFile.values()].sort((a, b) => b.risk - a.risk || b.count - a.count || a.file.localeCompare(b.file));
}

export function categorizeConflict(group: ConflictGroup): ConflictCategory {
  const xpath = group.normalizedXpath.toLowerCase();
  const file = group.file.toLowerCase();
  const normalized = xpath.replace(/\/+$/, "");
  if (/^\/?[\w.-]+$/.test(normalized) || /^\/?[\w.-]+\/[\w.-]+$/.test(normalized)) return "other";
  if (/\b(item|items)\b/.test(xpath) || file === "items.xml") return "item";
  if (/lootgroup|lootcontainer/.test(xpath) || file === "loot.xml") return "lootgroup";
  if (/\bperk\b|perks/.test(xpath) || file === "progression.xml") return "perk";
  if (/\bbuff\b|buffs/.test(xpath) || file === "buffs.xml") return "buff";
  if (/window|xui|ui_display|xui\//.test(xpath) || /xui|windows\.xml/.test(file)) return "window/xui";
  if (/\bblock\b|blocks/.test(xpath) || file === "blocks.xml") return "block";
  if (/entity_class|entitygroup|\bentity\b|entities/.test(xpath) || /entity/.test(file)) return "entity";
  if (/recipe|quest|trader|trader_info/.test(xpath) || /recipes|quests|traders/.test(file)) return "recipe/quest/trader";
  return "other";
}

export function buildHeatmapCells(conflicts: RankedConflict[]): HeatmapCell[] {
  const cells = new Map<string, HeatmapCell>();
  conflicts.forEach((item, id) => {
    const category = categorizeConflict(item.group);
    const key = `${item.group.file}\u0000${category}`;
    const current = cells.get(key) ?? { id: slugId(`cell-${item.group.file}-${category}`), file: item.group.file, category, count: 0, risk: 0, maxPriority: "low", conflictIds: [] };
    current.count += 1;
    current.risk += item.score;
    current.maxPriority = higherPriority(current.maxPriority, item.priority);
    current.conflictIds.push(id);
    cells.set(key, current);
  });
  return [...cells.values()].sort((a, b) => a.file.localeCompare(b.file) || categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
}

export function rankHeatmapHotspots(cells: HeatmapCell[]): HeatmapCell[] {
  return [...cells].sort((a, b) => b.risk - a.risk || b.count - a.count || a.file.localeCompare(b.file) || categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
}

export function rankConflictFiles(conflicts: ConflictGroup[]): FileRanking[] {
  const counts = new Map<string, number>();
  for (const conflict of conflicts) {
    counts.set(conflict.file, (counts.get(conflict.file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

export function rankConflicts(conflicts: ConflictGroup[]): RankedConflict[] {
  return conflicts
    .map((group) => {
      const mods = [...new Set(group.operations.map((operation) => operation.modName))];
      const score = scoreConflict(group, mods.length);
      return {
        group,
        score,
        mods,
        priority: score >= 80 ? "high" : score >= 45 ? "medium" : "low"
      } satisfies RankedConflict;
    })
    .sort((a, b) => b.score - a.score || b.mods.length - a.mods.length || a.group.file.localeCompare(b.group.file) || a.group.normalizedXpath.localeCompare(b.group.normalizedXpath));
}

export function rankWarnings(warnings: LogWarning[]): LogWarning[] {
  return [...warnings].sort((a, b) => warningScore(b) - warningScore(a) || a.line - b.line);
}

function scoreConflict(group: ConflictGroup, modCount: number): number {
  const xpath = group.normalizedXpath;
  let score = 20 + modCount * 8;
  if (group.exact) score += 12;
  if (/@(name|id)=/.test(xpath)) score += 34;
  if (/\b(item|lootgroup|perk|window|block|recipe|quest|buff|entity_class|entity)\b/.test(xpath)) score += 22;
  if (/\/@[\w.-]+$/.test(group.winner.xpath)) score += 12;
  if (/(append|insertAfter|insertBefore)/i.test(group.winner.operation)) score += 5;
  if (isRootAppend(group)) return Math.min(score, 30);
  return Math.max(0, score);
}

function isRootAppend(group: ConflictGroup): boolean {
  const xpath = group.normalizedXpath.replace(/\/+$/, "");
  const shallowRoot = /^\/?[\w.-]+$/.test(xpath) || /^\/?[\w.-]+\/[\w.-]+$/.test(xpath);
  return shallowRoot && group.operations.some((operation) => /append/i.test(operation.operation));
}

function warningScore(warning: LogWarning): number {
  let score = 0;
  if (warning.relatedMods.length > 0) score += 80;
  if (/xml patch failed|xpath/i.test(warning.text)) score += 70;
  if (/harmony/i.test(warning.text)) score += 45;
  if (/err|exception/i.test(warning.text)) score += 35;
  if (/wrn|warning/i.test(warning.text)) score += 20;
  return score;
}

function metric(label: string, value: number, color: string): string {
  return `<div class="metric" style="--metric-color:${color}"><strong>${value.toLocaleString("en-US")}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderTreemapItem(item: TreemapItem, maxRisk: number): string {
  const basis = Math.max(1, Math.round((item.risk / maxRisk) * 18));
  const alpha = heatAlpha(item.risk, maxRisk);
  return `<button class="tile" type="button" style="--basis:${basis};--alpha:${alpha}" data-conflict-ids="${item.conflictIds.join(",")}" data-title="${escapeHtml(`${item.file} conflicts`)}">
    <div class="tile-file">${escapeHtml(item.file)}</div>
    <div class="tile-count">${item.count.toLocaleString("en-US")}</div>
    <div class="subtle">risk ${item.risk.toLocaleString("en-US")} / ${escapeHtml(item.maxPriority)}</div>
  </button>`;
}

function renderHeatmap(cells: HeatmapCell[], maxRisk: number, activeCellId?: string): string {
  const files = [...new Set(cells.map((cell) => cell.file))].sort((a, b) => {
    const riskA = cells.filter((cell) => cell.file === a).reduce((total, cell) => total + cell.risk, 0);
    const riskB = cells.filter((cell) => cell.file === b).reduce((total, cell) => total + cell.risk, 0);
    return riskB - riskA || a.localeCompare(b);
  });
  const byKey = new Map(cells.map((cell) => [`${cell.file}\u0000${cell.category}`, cell]));
  return `<div class="heatmap"><div class="heat-grid">
    <div class="heat-head">file</div>${categoryOrder.map((category) => `<div class="heat-head">${escapeHtml(category)}</div>`).join("")}
    ${files.map((file) => `<div class="heat-file">${escapeHtml(file)}</div>${categoryOrder.map((category) => {
      const cell = byKey.get(`${file}\u0000${category}`);
      return cell ? renderHeatmapCell(cell, maxRisk, cell.id === activeCellId) : `<div class="heat-head subtle">0</div>`;
    }).join("")}`).join("")}
  </div></div>`;
}

function renderHeatmapCell(cell: HeatmapCell, maxRisk: number, active: boolean): string {
  const alpha = heatAlpha(cell.risk, maxRisk);
  return `<button class="heat-cell" type="button" style="--alpha:${alpha}" data-cell-key="${escapeHtml(cell.id)}" data-active="${active ? "true" : "false"}" data-conflict-ids="${cell.conflictIds.join(",")}" data-title="${escapeHtml(`${cell.file} / ${cell.category}`)}">
    <span class="cell-count">${cell.count.toLocaleString("en-US")}</span>
    <span class="cell-priority">${escapeHtml(cell.maxPriority)} / risk ${cell.risk.toLocaleString("en-US")}</span>
  </button>`;
}

function renderHotspotButton(cell: HeatmapCell, index: number, active: boolean): string {
  return `<button class="hotspot-button" type="button" data-cell-key="${escapeHtml(cell.id)}" data-active="${active ? "true" : "false"}" data-conflict-ids="${cell.conflictIds.join(",")}" data-title="${escapeHtml(`${cell.file} / ${cell.category}`)}">
    <span class="hotspot-rank">#${index + 1}</span>
    <span class="hotspot-name">${escapeHtml(cell.file)} / ${escapeHtml(cell.category)}</span>
    <span class="hotspot-count">${cell.count.toLocaleString("en-US")}</span>
    <span class="hotspot-meta">${cell.count.toLocaleString("en-US")} conflicts / risk ${cell.risk.toLocaleString("en-US")} / ${escapeHtml(cell.maxPriority)}</span>
  </button>`;
}

function renderDetailCards(items: DetailItem[]): string {
  if (items.length === 0) return `<div class="empty">No matching conflict groups.</div>`;
  return items.map((item) => `<article class="detail-card">
    <div class="detail-head"><div class="detail-file">${escapeHtml(item.file)}</div><span class="pill ${item.priority}">${escapeHtml(item.priority)}</span></div>
    <div class="kv">
      <span>XPath</span><code>${escapeHtml(item.xpath)}</code>
      <span>Winner</span><div class="winner">${escapeHtml(item.winner)} / ${escapeHtml(item.winnerOperation)}</div>
      <span>Winner XPath</span><code>${escapeHtml(item.winnerXpath)}</code>
      <span>Mods</span><div class="mods">${escapeHtml(item.mods.join(" -> "))}</div>
      <span>Match</span><div>${escapeHtml(item.match)} / score ${item.score}</div>
    </div>
  </article>`).join("");
}

function renderWarning(warning: LogWarning): string {
  const mods = warning.relatedMods.length > 0 ? warning.relatedMods.join(", ") : "No related mod detected";
  const fileMatch = warning.text.match(/(?:Config[\\/])?([A-Za-z0-9_/-]*?(?:XUi\/)?[A-Za-z0-9_-]+\.xml)/i);
  const tag = fileMatch?.[1] ?? (warning.text.match(/harmony/i) ? "Harmony" : "Runtime");
  return `<div class="warning">
    <div class="warning-line"><span class="tag">${escapeHtml(tag)}</span><span>${escapeHtml(mods)}</span><span>line ${warning.line}</span></div>
    <div class="warning-text">${escapeHtml(warning.text)}</div>
  </div>`;
}

function higherPriority(a: RankedConflict["priority"], b: RankedConflict["priority"]): RankedConflict["priority"] {
  const weight = { low: 1, medium: 2, high: 3 };
  return weight[b] > weight[a] ? b : a;
}

function heatAlpha(value: number, max: number): string {
  return (0.16 + Math.min(1, value / max) * 0.58).toFixed(2);
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeScriptJson(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
