import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectConflicts } from "./conflicts.js";
import { resolveConflicts } from "./resolution.js";
import { XmlPatchOperation } from "./types.js";

test("resolves set authored value and final attribute value", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "/items/item[@name='coin']/property[@name='count']/@value", "set", "120"),
      op("B", 2, "items.xml", "/items/item[@name='coin']/property[@name='count']/@value", "set", "160")
    ];

    const { conflicts, warnings } = await resolveConflicts(detectConflicts(operations), operations, fixture.gamePath);

    assert.equal(warnings.length, 0);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].operations[1].valueText, "160");
    assert.equal(conflicts[0].resolution?.vanillaValue, "10");
    assert.equal(conflicts[0].resolution?.history[1].authoredValue, "160");
    assert.equal(conflicts[0].resolution?.history[1].beforeValue, "120");
    assert.equal(conflicts[0].resolution?.history[1].afterValue, "160");
    assert.equal(conflicts[0].resolution?.finalValue, "160");
  } finally {
    await fixture.cleanup();
  }
});

test("applies append, insertBefore, insertAfter, and remove in load order", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="base"/><item name="old"/></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "/items", "append", `<item name="tail"/>`, "xml", "<item tail>"),
      op("B", 2, "items.xml", "/items/item[@name='tail']", "insertBefore", `<item name="beforeTail"/>`, "xml", "<item beforeTail>"),
      op("C", 3, "items.xml", "/items/item[@name='tail']", "insertAfter", `<item name="afterTail"/>`, "xml", "<item afterTail>"),
      op("D", 4, "items.xml", "/items/item[@name='old']", "remove", undefined, "target", "remove target"),
      op("E", 5, "items.xml", "/items", "append", `<item name="final"/>`, "xml", "<item final>")
    ];

    const conflicts = detectConflicts(operations.filter((operation) => operation.operation === "append"));
    const { conflicts: resolved, warnings } = await resolveConflicts(conflicts, operations, fixture.gamePath);

    assert.equal(warnings.length, 0);
    assert.equal(resolved[0].resolution?.status, "resolved");
    assert.match(resolved[0].resolution?.finalValue ?? "", /beforeTail/);
    assert.match(resolved[0].resolution?.finalValue ?? "", /afterTail/);
    assert.match(resolved[0].resolution?.finalValue ?? "", /final/);
    assert.doesNotMatch(resolved[0].resolution?.finalValue ?? "", /old/);
    assert.equal(resolved[0].resolution?.history[0].authoredValue, "<item tail>");
  } finally {
    await fixture.cleanup();
  }
});

test("resolves contains and multiple predicate XPath expressions", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="gunPipePistol"><property name="Tags" value="weapon,pipe"/><property name="count" value="1"/></item></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", `//item[contains(@name,'Pipe') and property[@name='Tags']]/property[@name='count']/@value`, "set", "2"),
      op("B", 2, "items.xml", `//item[contains(@name,'Pipe') and property[@name='Tags']]/property[@name='count']/@value`, "set", "3")
    ];

    const { conflicts, warnings } = await resolveConflicts(detectConflicts(operations), operations, fixture.gamePath);

    assert.equal(warnings.length, 0);
    assert.equal(conflicts[0].resolution?.finalValue, "3");
  } finally {
    await fixture.cleanup();
  }
});

test("missing vanilla file and missing XPath become warnings without throwing", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"/></items>`);
  try {
    const missingFileOps = [
      op("A", 1, "missing.xml", "/items/item/@value", "set", "1"),
      op("B", 2, "missing.xml", "/items/item/@value", "set", "2")
    ];
    const missingXpathOps = [
      op("A", 1, "items.xml", "/items/item[@name='absent']/@value", "set", "1"),
      op("B", 2, "items.xml", "/items/item[@name='absent']/@value", "set", "2")
    ];

    const fileResult = await resolveConflicts(detectConflicts(missingFileOps), missingFileOps, fixture.gamePath);
    const xpathResult = await resolveConflicts(detectConflicts(missingXpathOps), missingXpathOps, fixture.gamePath);

    assert.equal(fileResult.conflicts[0].resolution?.status, "unresolved");
    assert.match(fileResult.warnings[0].kind, /missing-vanilla/);
    assert.equal(xpathResult.conflicts[0].resolution?.status, "unresolved");
    assert.match(xpathResult.warnings[0].message, /target was not found/i);
  } finally {
    await fixture.cleanup();
  }
});

test("vanilla parse errors become warnings without throwing", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "/items/item[@name='coin']/@value", "set", "1"),
      op("B", 2, "items.xml", "/items/item[@name='coin']/@value", "set", "2")
    ];

    const { conflicts, warnings } = await resolveConflicts(detectConflicts(operations), operations, fixture.gamePath);

    assert.equal(conflicts[0].resolution?.status, "unresolved");
    assert.match(warnings[0].kind, /parse-error/);
  } finally {
    await fixture.cleanup();
  }
});

test("skips unrelated operations when resolving a conflict target", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="0"/><item name="other" value="0"/></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "/items/item[@name='coin']/@value", "set", "1"),
      op("B", 2, "items.xml", "/items/item[@name='coin']/@value", "set", "2"),
      op("BrokenUnrelated", 3, "items.xml", "/items/item[@name='absent']/@value", "set", "999")
    ];

    const { conflicts, warnings } = await resolveConflicts(detectConflicts(operations.slice(0, 2)), operations, fixture.gamePath);

    assert.equal(warnings.length, 0);
    assert.equal(conflicts[0].resolution?.status, "resolved");
    assert.equal(conflicts[0].resolution?.finalValue, "2");
  } finally {
    await fixture.cleanup();
  }
});

function op(
  modName: string,
  order: number,
  file: string,
  xpath: string,
  operation: string,
  valueText?: string,
  valueKind: XmlPatchOperation["valueKind"] = valueText == null ? "target" : "text",
  valueSummary = valueText
): XmlPatchOperation {
  return {
    modName,
    displayName: modName,
    order,
    file,
    path: `${modName}/Config/${file}`,
    operation,
    xpath,
    line: order,
    valueKind,
    valueText,
    valueSummary
  };
}

async function makeGameFixture(file: string, xml: string): Promise<{ gamePath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "wasteland-resolution-"));
  const configPath = path.join(root, "Data", "Config");
  await mkdir(configPath, { recursive: true });
  await writeFile(path.join(configPath, file), xml, "utf8");
  return {
    gamePath: root,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
