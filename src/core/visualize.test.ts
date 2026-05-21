import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ContextPack } from "./types.js";
import { buildHeatmapCells, buildTreemapItems, categorizeConflict, rankConflictFiles, rankConflicts, renderVisualization } from "./visualize.js";

const execFileAsync = promisify(execFile);

test("visualization renders hero stats, treemap, heatmap, details, and warning hotspots", () => {
  const pack = fixturePack();
  const html = renderVisualization(pack);

  assert.match(html, /<title>7DTD Mod Conflict Analyzer<\/title>/);
  assert.match(html, /id="app"/);
  assert.match(html, /Dashboard/);
  assert.match(html, /Load Order/);
  assert.match(html, /XML Browser/);
  assert.match(html, /Conflict Viewer/);
  assert.match(html, /Tweaks Panel/);
  assert.match(html, /"MODS"/);
  assert.match(html, /"XML_FILES"/);
  assert.match(html, /"CONFLICTS"/);
  assert.match(html, /"XML_TREE"/);
  assert.match(html, /"CONFLICT_KINDS"/);
  assert.match(html, /"STATS"/);
  assert.match(html, /window\.MODS/);
  assert.match(html, /window\.CONFLICTS/);
  assert.match(html, /window\.XML_FILES/);
  assert.match(html, /__WASTELAND_CONTEXT__/);
});

test("conflict file ranking sorts by conflict count", () => {
  const ranking = rankConflictFiles(fixturePack().conflicts);
  assert.deepEqual(ranking.map((item) => `${item.file}:${item.count}`), [
    "items.xml:2",
    "loot.xml:1",
    "progression.xml:1",
    "XUi/windows.xml:1"
  ]);
});

test("specific xpath conflicts outrank root appends", () => {
  const ranked = rankConflicts(fixturePack().conflicts);
  assert.equal(ranked[0].group.normalizedXpath, "/items/item[@name='gunak47']");
  assert.equal(ranked[ranked.length - 1].group.normalizedXpath, "/items");
});

test("treemap aggregates conflict count and risk by file", () => {
  const treemap = buildTreemapItems(rankConflicts(fixturePack().conflicts));
  assert.deepEqual(treemap.map((item) => `${item.file}:${item.count}`), [
    "items.xml:2",
    "progression.xml:1",
    "loot.xml:1",
    "XUi/windows.xml:1"
  ]);
  assert.equal(treemap[0].maxPriority, "high");
});

test("categorizes xpath conflicts for heatmap buckets", () => {
  const conflicts = fixturePack().conflicts;
  assert.equal(categorizeConflict(conflicts[1]), "item");
  assert.equal(categorizeConflict(conflicts[2]), "lootgroup");
  assert.equal(categorizeConflict(conflicts[3]), "perk");
  assert.equal(categorizeConflict(conflicts[4]), "window/xui");
  assert.equal(categorizeConflict(conflicts[0]), "other");
});

test("heatmap cells include count and priority data", () => {
  const cells = buildHeatmapCells(rankConflicts(fixturePack().conflicts));
  const itemCell = cells.find((cell) => cell.file === "items.xml" && cell.category === "item");
  const lootCell = cells.find((cell) => cell.file === "loot.xml" && cell.category === "lootgroup");
  const xuiCell = cells.find((cell) => cell.file === "XUi/windows.xml" && cell.category === "window/xui");

  assert.equal(itemCell?.count, 1);
  assert.equal(itemCell?.maxPriority, "high");
  assert.equal(lootCell?.count, 1);
  assert.equal(xuiCell?.count, 1);
});

test("visualize writes HTML to stdout when out is omitted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wasteland-visualize-"));
  await mkdir(root, { recursive: true });
  const input = path.join(root, "context.json");
  await writeFile(input, JSON.stringify(fixturePack()), "utf8");

  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.resolve(testDir, "..", "cli.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "visualize", "--input", input]);

  assert.match(stdout, /^<!doctype html>/);
  assert.match(stdout, /7DTD Mod Conflict Analyzer/);
  assert.match(stdout, /items\.xml/);
});

function fixturePack(): ContextPack {
  return {
    generatedAt: "2026-05-21T19:18:59.722Z",
    scan: {
      mo2Path: "C:\\Modding\\MO2",
      profile: "Default",
      modlistPath: "C:\\Modding\\MO2\\profiles\\Default\\modlist.txt",
      entries: [],
      enabledMods: [
        { mo2Name: "A", displayName: "Alpha", rootPath: "", modInfoPath: "", order: 0 },
        { mo2Name: "B", displayName: "Bravo", rootPath: "", modInfoPath: "", order: 1 },
        { mo2Name: "FastTravel", displayName: "FastTravel", rootPath: "", modInfoPath: "", order: 2 }
      ],
      missingEnabledMods: [],
      xmlPatches: [
        { modName: "A", displayName: "Alpha", order: 0, file: "items.xml", path: "", operation: "append", xpath: "/items", line: 1 },
        { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "append", xpath: "/items", line: 1 },
        { modName: "A", displayName: "Alpha", order: 0, file: "items.xml", path: "", operation: "set", xpath: "/items/item[@name='gunAK47']/@tags", line: 2 },
        { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "set", xpath: "/items/item[@name='gunAK47']/@tags", line: 2 }
      ],
      dlls: [
        { modName: "FastTravel", displayName: "FastTravel", order: 2, path: "", fileName: "FastTravel.dll", size: 10, mtime: "", sha256: "abc" }
      ],
      warnings: []
    },
    trace: [],
    conflicts: [
      {
        file: "items.xml",
        normalizedXpath: "/items",
        operations: [
          { modName: "A", displayName: "Alpha", order: 0, file: "items.xml", path: "", operation: "append", xpath: "/items", line: 1 },
          { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "append", xpath: "/items", line: 1 }
        ],
        winner: { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "append", xpath: "/items", line: 1 },
        exact: true
      },
      {
        file: "items.xml",
        normalizedXpath: "/items/item[@name='gunak47']",
        operations: [
          { modName: "A", displayName: "Alpha", order: 0, file: "items.xml", path: "", operation: "set", xpath: "/items/item[@name='gunAK47']/@tags", line: 2 },
          { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "set", xpath: "/items/item[@name='gunAK47']/@tags", line: 2 }
        ],
        winner: { modName: "B", displayName: "Bravo", order: 1, file: "items.xml", path: "", operation: "set", xpath: "/items/item[@name='gunAK47']/@tags", line: 2 },
        exact: true
      },
      {
        file: "loot.xml",
        normalizedXpath: "/lootcontainers/lootgroup[@name='ammo']",
        operations: [
          { modName: "A", displayName: "Alpha", order: 0, file: "loot.xml", path: "", operation: "append", xpath: "/lootcontainers/lootgroup[@name='ammo']", line: 4 },
          { modName: "B", displayName: "Bravo", order: 1, file: "loot.xml", path: "", operation: "append", xpath: "/lootcontainers/lootgroup[@name='ammo']/item", line: 5 }
        ],
        winner: { modName: "B", displayName: "Bravo", order: 1, file: "loot.xml", path: "", operation: "append", xpath: "/lootcontainers/lootgroup[@name='ammo']/item", line: 5 },
        exact: false
      },
      {
        file: "progression.xml",
        normalizedXpath: "/progression/perks/perk[@name='perkboomstick']",
        operations: [
          { modName: "A", displayName: "Alpha", order: 0, file: "progression.xml", path: "", operation: "set", xpath: "/progression/perks/perk[@name='perkBoomStick']/@max_level", line: 8 },
          { modName: "B", displayName: "Bravo", order: 1, file: "progression.xml", path: "", operation: "set", xpath: "/progression/perks/perk[@name='perkBoomStick']/@max_level", line: 9 }
        ],
        winner: { modName: "B", displayName: "Bravo", order: 1, file: "progression.xml", path: "", operation: "set", xpath: "/progression/perks/perk[@name='perkBoomStick']/@max_level", line: 9 },
        exact: true
      },
      {
        file: "XUi/windows.xml",
        normalizedXpath: "/windows/window[@name='fasttravelwindow']",
        operations: [
          { modName: "FastTravel", displayName: "FastTravel", order: 2, file: "XUi/windows.xml", path: "", operation: "append", xpath: "/windows/window[@name='fastTravelWindow']", line: 11 },
          { modName: "B", displayName: "Bravo", order: 1, file: "XUi/windows.xml", path: "", operation: "set", xpath: "/windows/window[@name='fastTravelWindow']/@controller", line: 12 }
        ],
        winner: { modName: "FastTravel", displayName: "FastTravel", order: 2, file: "XUi/windows.xml", path: "", operation: "append", xpath: "/windows/window[@name='fastTravelWindow']", line: 11 },
        exact: false
      }
    ],
    logs: {
      latestLogPath: "output_log_client__new.txt",
      warnings: [
        {
          path: "output_log_client__new.txt",
          line: 10,
          text: "WRN XML patch failed in XUi/windows.xml for FastTravel",
          relatedMods: ["FastTravel"]
        },
        {
          path: "output_log_client__new.txt",
          line: 12,
          text: "WRN Harmony warning: patch target not found",
          relatedMods: []
        }
      ]
    }
  };
}
