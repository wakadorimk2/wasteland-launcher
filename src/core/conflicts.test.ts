import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectConflicts } from "./conflicts.js";
import { XmlPatchOperation } from "./types.js";

test("different XPath forms that write the same concrete attribute become one exact conflict", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const { diagnosticGroups, operationsById } = await detectConflicts([
      op("A", 1, "items.xml", "//property[@name='count']/@value", "set", "120"),
      op("B", 2, "items.xml", "/items/item[property[@name='count']]/property[@name='count']", "setattribute", "160", "text", "160", { name: "value", value: "160" })
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.length, 1);
    assert.equal(diagnosticGroups[0].normalizedXpath, "/items/item[@name='coin']/property[@name='count']/@value");
    assert.match(diagnosticGroups[0].targetKey, /^attr:\d+:value$/);
    assert.equal(diagnosticGroups[0].classification, "silent-overwrite");
    assert.equal(diagnosticGroups[0].confidence, "proven");
    assert.equal(operationsById[diagnosticGroups[0].primaryOpId].modName, "B");
    assert.equal(diagnosticGroups[0].proof, "exact");
  } finally {
    await fixture.cleanup();
  }
});

test("same parent append operations are retained as sibling order dependencies", async () => {
  const fixture = await makeGameFixture("items.xml", `<items></items>`);
  try {
    const { diagnosticGroups } = await detectConflicts([
      op("A", 1, "items.xml", "/items", "append", `<item name="a"/>`, "xml", "<item a>"),
      op("B", 2, "items.xml", "/items", "append", `<item name="b"/>`, "xml", "<item b>")
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.length, 1);
    assert.equal(diagnosticGroups[0].classification, "sibling-order-dependent");
    assert.match(diagnosticGroups[0].targetKey, /^children:\d+$/);
    assert.equal(diagnosticGroups[0].orderDependent, true);
    assert.equal(diagnosticGroups[0].risk, "warn");
  } finally {
    await fixture.cleanup();
  }
});

test("same XPath broad matches are grouped by concrete targets instead of one exact normalized XPath group", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="a" value="1"/><item name="b" value="2"/></items>`);
  try {
    const { diagnosticGroups } = await detectConflicts([
      op("A", 1, "items.xml", "/items/item", "setattribute", "first", "text", "first", { name: "value", value: "first" }),
      op("B", 2, "items.xml", "/items/item", "setattribute", "second", "text", "second", { name: "value", value: "second" })
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.length, 2);
    assert.deepEqual(diagnosticGroups.map((group) => group.normalizedXpath), ["/items/item[@name='a']/@value", "/items/item[@name='b']/@value"]);
    assert.equal(diagnosticGroups.every((group) => group.proof === "exact"), true);
  } finally {
    await fixture.cleanup();
  }
});

test("remove followed by later XPath miss groups remover and missed operation", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"><property name="value" value="1"/></item></items>`);
  try {
    const { diagnosticGroups, operationsById } = await detectConflicts([
      op("A", 1, "items.xml", "/items/item[@name='old']", "remove"),
      op("B", 2, "items.xml", "/items/item[@name='old']/property[@name='value']/@value", "set", "2")
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.length, 1);
    assert.deepEqual(diagnosticGroups[0].operationIds.map((opId) => operationsById[opId].modName), ["A", "B"]);
    assert.equal(operationsById[diagnosticGroups[0].primaryOpId].modName, "B");
    assert.equal(diagnosticGroups[0].proof, "exact");
  } finally {
    await fixture.cleanup();
  }
});

test("earlier miss against later append target groups missed operation with creator", async () => {
  const fixture = await makeGameFixture("items.xml", `<items></items>`);
  try {
    const { diagnosticGroups, operationsById } = await detectConflicts([
      op("A", 1, "items.xml", "/items/item[@name='future']/@value", "set", "2"),
      op("B", 2, "items.xml", "/items", "append", `<item name="future" value="1"/>`, "xml", "<item future>")
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.length, 1);
    assert.deepEqual(diagnosticGroups[0].operationIds.map((opId) => operationsById[opId].modName), ["A", "B"]);
    assert.equal(operationsById[diagnosticGroups[0].primaryOpId].modName, "B");
    assert.equal(diagnosticGroups[0].proof, "fallback");
  } finally {
    await fixture.cleanup();
  }
});

test("/items append operations are not mixed into a specific item structural-mask footprint group", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"/><item name="keep"/></items>`);
  try {
    const { diagnosticGroups, operationsById } = await detectConflicts([
      op("RemoveOld", 1, "items.xml", "/items/item[@name='old']", "remove"),
      op("AppendNew", 2, "items.xml", "/items", "append", `<item name="new"/>`, "xml", "<item new>"),
      op("EditOld", 3, "items.xml", "/items/item[@name='old']/@value", "set", "2")
    ], fixture.gamePath);

    const oldGroups = diagnosticGroups.filter((group) => group.displayTarget.includes("old"));
    assert.equal(oldGroups.some((group) => group.operationIds.some((opId) => operationsById[opId].modName === "AppendNew")), false);
    assert.equal(oldGroups.some((group) => group.kind === "order-induced-miss" || group.kind === "structural-mask"), true);
  } finally {
    await fixture.cleanup();
  }
});

test("insertBefore reads a removed anchor as an order-dependent candidate", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"/></items>`);
  try {
    const { diagnosticGroups, operationsById } = await detectConflicts([
      op("RemoveOld", 1, "items.xml", "/items/item[@name='old']", "remove"),
      op("InsertAtOld", 2, "items.xml", "/items/item[@name='old']", "insertbefore", `<item name="new"/>`, "xml", "<item new>")
    ], fixture.gamePath);

    assert.equal(diagnosticGroups.some((group) =>
      group.kind === "sibling-order-dependent"
      && group.operationIds.map((opId) => operationsById[opId].modName).includes("InsertAtOld")
    ), true);
    assert.equal(diagnosticGroups.some((group) =>
      group.kind === "structural-mask"
      && group.operationIds.map((opId) => operationsById[opId].modName).includes("InsertAtOld")
    ), false);
  } finally {
    await fixture.cleanup();
  }
});

test("missing vanilla file falls back to footprint and normalized XPath conflict detection", async () => {
  const fixture = await makeEmptyGameFixture();
  try {
    const { diagnosticGroups, operationsById, trace, warnings } = await detectConflicts([
      op("A", 1, "items.xml", "/items/item[@name='coin']/@value", "set", "120"),
      op("B", 2, "items.xml", "/items/item[@name='coin']", "setattribute", "160", "text", "160", { name: "value", value: "160" })
    ], fixture.gamePath);

    assert.equal(trace.every((item) => item.status === "missed"), true);
    assert.equal(warnings.some((warning) => warning.kind === "trace-missing-vanilla"), true);
    assert.equal(diagnosticGroups.length, 1);
    assert.equal(operationsById[diagnosticGroups[0].primaryOpId].modName, "B");
    assert.equal(diagnosticGroups[0].proof, "footprint");
  } finally {
    await fixture.cleanup();
  }
});

test("vanilla parse errors fall back to normalized XPath conflict detection", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item></items>`);
  try {
    const { diagnosticGroups, warnings } = await detectConflicts([
      op("A", 1, "items.xml", "/items/item[@name='coin']", "append", `<property name="x"/>`, "xml", "<property x>"),
      op("B", 2, "items.xml", "/items/item[@name='coin']", "append", `<property name="y"/>`, "xml", "<property y>")
    ], fixture.gamePath);

    assert.equal(warnings.some((warning) => warning.kind === "trace-parse-error"), true);
    assert.equal(diagnosticGroups.length, 1);
    assert.equal(diagnosticGroups[0].normalizedXpath, "/items/item[@name='coin']");
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
  valueSummary = valueText,
  attributes?: Record<string, string>
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
    attributes,
    valueKind,
    valueText,
    valueSummary
  };
}

async function makeGameFixture(file: string, xml: string): Promise<{ gamePath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "wasteland-conflicts-"));
  const configPath = path.join(root, "Data", "Config");
  await mkdir(configPath, { recursive: true });
  await writeFile(path.join(configPath, file), xml, "utf8");
  return {
    gamePath: root,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function makeEmptyGameFixture(): Promise<{ gamePath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "wasteland-conflicts-"));
  await mkdir(path.join(root, "Data", "Config"), { recursive: true });
  return {
    gamePath: root,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
