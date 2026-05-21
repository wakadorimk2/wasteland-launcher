import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildPatchTrace } from "./patchTrace.js";
import { XmlPatchOperation } from "./types.js";

test("replay trace normalizes set and setattribute to the same attribute target", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "/items/item[@name='coin']/property[@name='count']/@value", "set", "120"),
      op("B", 2, "items.xml", "/items/item[@name='coin']/property[@name='count']", "setattribute", "160", "text", "160", { name: "value", value: "160" })
    ];

    const { trace, warnings } = await buildPatchTrace(operations, fixture.gamePath);

    assert.equal(warnings.filter((warning) => warning.kind.includes("miss")).length, 0);
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/property[@name='count']/@value");
    assert.equal(trace[0].effects[0].after, "120");
    assert.equal(trace[1].effects[0].target, trace[0].effects[0].target);
    assert.equal(trace[1].effects[0].before, "120");
    assert.equal(trace[1].effects[0].after, "160");
    assert.equal(trace[1].diagnosticKind, "silent-overwrite");
  } finally {
    await fixture.cleanup();
  }
});

test("removeattribute emits an attribute deletion effect", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" tags="money"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']", "removeattribute", undefined, "target", "remove tags", { name: "tags" })
    ], fixture.gamePath);

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].kind, "removeAttribute");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/@tags");
    assert.equal(trace[0].effects[0].before, "money");
  } finally {
    await fixture.cleanup();
  }
});

test("append handles element and attribute targets", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" tags="money"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items", "append", `<item name="tail"/>`, "xml", "<item tail>"),
      op("B", 2, "items.xml", "/items/item[@name='coin']/@tags", "append", ",quest", "text", ",quest")
    ], fixture.gamePath);

    assert.equal(trace[0].effects[0].kind, "appendChild");
    assert.equal(trace[0].effects[0].target, "/items");
    assert.equal(trace[1].effects[0].kind, "appendAttributeText");
    assert.equal(trace[1].effects[0].before, "money");
    assert.equal(trace[1].effects[0].after, "money,quest");
  } finally {
    await fixture.cleanup();
  }
});

test("remove followed by a later XPath reference becomes order-induced-miss", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"><property name="value" value="1"/></item></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='old']", "remove"),
      op("B", 2, "items.xml", "/items/item[@name='old']/property[@name='value']/@value", "set", "2")
    ], fixture.gamePath);

    assert.equal(trace[0].effects[0].kind, "removeNode");
    assert.equal(trace[1].status, "missed");
    assert.equal(trace[1].diagnosticKind, "order-induced-miss");
  } finally {
    await fixture.cleanup();
  }
});

test("reference to a later appended target becomes dependency-order-miss", async () => {
  const fixture = await makeGameFixture("items.xml", `<items></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='future']/@value", "set", "2"),
      op("B", 2, "items.xml", "/items", "append", `<item name="future" value="1"/>`, "xml", "<item future>")
    ], fixture.gamePath);

    assert.equal(trace[0].status, "missed");
    assert.equal(trace[0].diagnosticKind, "dependency-order-miss");
    assert.equal(trace[1].effects[0].kind, "appendChild");
  } finally {
    await fixture.cleanup();
  }
});

test("broad XPath matches and csv operations remain diagnostic traces", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="a"/><item name="b"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item", "setattribute", "checked", "text", "checked", { name: "tag", value: "checked" }),
      op("B", 2, "items.xml", "/items", "csv", "ignored")
    ], fixture.gamePath);

    assert.equal(trace[0].status, "ambiguous");
    assert.equal(trace[0].matchCountBefore, 2);
    assert.equal(trace[0].diagnosticKind, "broad-match-risk");
    assert.equal(trace[1].status, "unsupported");
    assert.equal(trace[1].diagnosticKind, "unsupported-operation");
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
  const root = await mkdtemp(path.join(tmpdir(), "wasteland-trace-"));
  const configPath = path.join(root, "Data", "Config");
  await mkdir(configPath, { recursive: true });
  await writeFile(path.join(configPath, file), xml, "utf8");
  return {
    gamePath: root,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
