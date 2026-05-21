import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ConflictGroup, ContextPack, LogWarning } from "./types.js";
import { buildAnalyzerUiModel, renderAnalyzerHtml } from "./analyzer-ui.js";

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
  return renderAnalyzerHtml(buildAnalyzerUiModel({ pack, rankedConflicts }));
}

export function buildTreemapItems(conflicts: RankedConflict[]): TreemapItem[] {
  const byFile = new Map<string, TreemapItem>();
  conflicts.forEach((item, id) => {
    const current = byFile.get(item.group.file) ?? {
      id: slugId(`file-${item.group.file}`),
      file: item.group.file,
      count: 0,
      risk: 0,
      maxPriority: "low" as const,
      conflictIds: []
    };
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
    const current = cells.get(key) ?? {
      id: slugId(`cell-${item.group.file}-${category}`),
      file: item.group.file,
      category,
      count: 0,
      risk: 0,
      maxPriority: "low" as const,
      conflictIds: []
    };
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
  const byFile = new Map<string, number>();
  for (const conflict of conflicts) {
    byFile.set(conflict.file, (byFile.get(conflict.file) ?? 0) + 1);
  }
  return [...byFile.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

export function rankConflicts(conflicts: ConflictGroup[]): RankedConflict[] {
  return conflicts
    .map((group) => {
      const score = scoreConflict(group);
      return {
        group,
        score,
        mods: [...new Set(group.operations.map((operation) => operation.modName))],
        priority: score >= 70 ? "high" as const : score >= 30 ? "medium" as const : "low" as const
      };
    })
    .sort((a, b) => b.score - a.score || a.group.file.localeCompare(b.group.file) || a.group.normalizedXpath.localeCompare(b.group.normalizedXpath));
}

export function rankWarnings(warnings: LogWarning[]): LogWarning[] {
  return [...warnings].sort((a, b) => {
    const related = b.relatedMods.length - a.relatedMods.length;
    if (related !== 0) return related;
    return a.path.localeCompare(b.path) || a.line - b.line;
  });
}

function scoreConflict(group: ConflictGroup): number {
  const operations = group.operations.map((operation) => operation.operation.toLowerCase());
  const depth = group.normalizedXpath.split("/").filter(Boolean).length;
  const isRootish = /^\/?[\w.-]+(?:\/[\w.-]+)?$/.test(group.normalizedXpath.replace(/\/+$/, ""));
  const hasSet = operations.includes("set");
  const hasStructural = operations.some((operation) => /append|insert|remove/.test(operation));
  const category = categorizeConflict(group);

  let score = group.exact ? 45 : 18;
  score += Math.min(depth, 6) * 6;
  if (hasSet) score += 28;
  if (category === "item") score += 12;
  if (category === "lootgroup") score += 8;
  if (category === "window/xui") score -= 15;
  if (group.operations.length > 2) score += 8;
  if (hasStructural && !hasSet) score -= 8;
  if (hasStructural && hasSet && !group.exact) score -= 18;
  if (isRootish) score -= 48;
  return Math.max(1, score);
}

function higherPriority(a: RankedConflict["priority"], b: RankedConflict["priority"]): RankedConflict["priority"] {
  const order = { high: 3, medium: 2, low: 1 };
  return order[b] > order[a] ? b : a;
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}
