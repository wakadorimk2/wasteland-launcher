import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readModlist } from "./modlist.js";
import { scanMo2 } from "./scanner.js";
import { detectConflicts } from "./conflicts.js";
import { scanLatestClientLog } from "./logs.js";

test("modlist handles enabled, disabled, and separators", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wasteland-"));
  const file = path.join(root, "modlist.txt");
  await writeFile(file, "# header\n+Enabled\n-Disabled\n+Tools_separator\n", "utf8");

  const entries = await readModlist(file);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].state, "enabled");
  assert.equal(entries[0].order, 0);
  assert.equal(entries[1].state, "disabled");
  assert.equal(entries[2].state, "separator");
});

test("scan resolves direct and nested ModInfo, XML patches, DLLs, and conflicts", async () => {
  const mo2 = await mkdtemp(path.join(os.tmpdir(), "wasteland-mo2-"));
  await mkdir(path.join(mo2, "profiles", "Default"), { recursive: true });
  await mkdir(path.join(mo2, "mods", "A", "Config"), { recursive: true });
  await mkdir(path.join(mo2, "mods", "B", "Child", "Config"), { recursive: true });

  await writeFile(path.join(mo2, "profiles", "Default", "modlist.txt"), "+A\n+B\n-Disabled\n+Sep_separator\n", "utf8");
  await writeFile(path.join(mo2, "mods", "A", "ModInfo.xml"), `<ModInfo><Name value="Alpha"/><Version value="1"/></ModInfo>`, "utf8");
  await writeFile(path.join(mo2, "mods", "B", "Child", "ModInfo.xml"), `<ModInfo><Name value="Bravo"/></ModInfo>`, "utf8");
  await writeFile(path.join(mo2, "mods", "A", "Config", "items.xml"), `<configs>\n<set xpath="/items/item[@name='x']/property[@name='Price']/@value">1</set>\n</configs>`, "utf8");
  await writeFile(path.join(mo2, "mods", "B", "Child", "Config", "items.xml"), `<configs>\n<append xpath="/items/item[@name='x']/property[@name='Price']"/>\n<setattribute xpath="/items/item[@name='x']" name="tags" value="coin"/>\n<csv xpath="/items/item[@name='x']">ignored</csv>\n</configs>`, "utf8");
  await writeFile(path.join(mo2, "mods", "B", "Child", "Harmony.dll"), "dll", "utf8");

  const scan = await scanMo2(mo2, "Default");
  assert.equal(scan.enabledMods.length, 2);
  assert.equal(scan.xmlPatches.length, 4);
  assert.equal(scan.xmlPatches.find((patch) => patch.operation === "setattribute")?.attributes?.name, "tags");
  assert.equal(scan.xmlPatches.find((patch) => patch.operation === "csv")?.valueText, "ignored");
  assert.equal(scan.dlls.length, 1);
  assert.equal(scan.enabledMods[1].displayName, "Bravo");

  const { diagnosticGroups, operationsById } = await detectConflicts(scan.xmlPatches);
  assert.equal(diagnosticGroups.length, 1);
  assert.equal(operationsById[diagnosticGroups[0].primaryOpId].modName, "A");
});

test("logs picks latest non-empty client log and extracts warnings", async () => {
  const logs = await mkdtemp(path.join(os.tmpdir(), "wasteland-logs-"));
  await writeFile(path.join(logs, "output_log_client__old.txt"), "", "utf8");
  const latest = path.join(logs, "output_log_client__new.txt");
  await writeFile(latest, "ok\nWRN XML issue in Alpha\nERR Exception\n", "utf8");

  const result = await scanLatestClientLog(logs, [{ mo2Name: "A", displayName: "Alpha", rootPath: "", modInfoPath: "", order: 0 }]);
  assert.equal(result.latestLogPath, latest);
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(result.warnings[0].relatedMods, ["Alpha"]);
});
