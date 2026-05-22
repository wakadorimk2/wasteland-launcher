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
    assert.match(trace[0].effects[0].targetKey ?? "", /^attr:\d+:value$/);
    assert.equal(trace[0].effects[0].after, "120");
    assert.equal(trace[1].effects[0].target, trace[0].effects[0].target);
    assert.equal(trace[1].effects[0].targetKey, trace[0].effects[0].targetKey);
    assert.equal(trace[1].effects[0].before, "120");
    assert.equal(trace[1].effects[0].after, "160");
    assert.equal(trace[1].diagnosticKind, "silent-overwrite");
  } finally {
    await fixture.cleanup();
  }
});

test("same concrete attribute slot overwrites across different XPath forms", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const operations = [
      op("A", 1, "items.xml", "//property[@name='count']/@value", "set", "120"),
      op("B", 2, "items.xml", "/items/item[property[@name='count']]/property[@name='count']", "setattribute", "160", "text", "160", { name: "value", value: "160" })
    ];

    const { trace } = await buildPatchTrace(operations, fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/property[@name='count']/@value");
    assert.equal(trace[1].effects[0].target, trace[0].effects[0].target);
    assert.equal(trace[1].effects[0].before, "120");
    assert.equal(trace[1].diagnosticKind, "silent-overwrite");
  } finally {
    await fixture.cleanup();
  }
});

test("simple XPath set changes an attribute target in fast mode", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']/property[@name='count']/@value", "set", "120")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].kind, "setAttribute");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/property[@name='count']/@value");
    assert.equal(trace[0].effects[0].before, "10");
    assert.equal(trace[0].effects[0].after, "120");
  } finally {
    await fixture.cleanup();
  }
});

test("setattribute converges to the same canonical target in fast mode", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin"><property name="count" value="10"/></item></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']/property[@name='count']", "setattribute", "120", "text", "120", { name: "value", value: "120" })
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].affectedTargets[0].canonical, "/items/item[@name='coin']/property[@name='count']");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/property[@name='count']/@value");
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

test("setattribute after removeattribute uses the same scalar slot writer", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" tags="money"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']", "removeattribute", undefined, "target", "remove tags", { name: "tags" }),
      op("B", 2, "items.xml", "/items/item[@name='coin']", "setattribute", "quest", "text", "quest", { name: "tags", value: "quest" })
    ], fixture.gamePath);

    assert.equal(trace[0].effects[0].kind, "removeAttribute");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/@tags");
    assert.equal(trace[1].effects[0].kind, "setAttribute");
    assert.equal(trace[1].effects[0].target, "/items/item[@name='coin']/@tags");
    assert.equal(trace[1].effects[0].before, undefined);
    assert.equal(trace[1].effects[0].after, "quest");
    assert.equal(trace[1].diagnosticKind, "silent-overwrite");
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

test("insert operations update fast-path targets for later XPath lookups", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="anchor" value="0"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='anchor']", "insertbefore", `<item name="before" value="1"/>`, "xml", "<item before>"),
      op("B", 2, "items.xml", "/items/item[@name='before']/@value", "set", "2"),
      op("C", 3, "items.xml", "/items/item[@name='anchor']", "insertafter", `<item name="after" value="3"/>`, "xml", "<item after>"),
      op("D", 4, "items.xml", "/items/item[@name='after']/@value", "set", "4")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].effects[0].kind, "insertBefore");
    assert.equal(trace[1].status, "applied");
    assert.equal(trace[1].effects[0].target, "/items/item[@name='before']/@value");
    assert.equal(trace[1].effects[0].before, "1");
    assert.equal(trace[1].effects[0].after, "2");
    assert.equal(trace[2].effects[0].kind, "insertAfter");
    assert.equal(trace[3].status, "applied");
    assert.equal(trace[3].effects[0].target, "/items/item[@name='after']/@value");
    assert.equal(trace[3].effects[0].before, "3");
    assert.equal(trace[3].effects[0].after, "4");
  } finally {
    await fixture.cleanup();
  }
});

test("append updates fast-path targets for later XPath lookups", async () => {
  const fixture = await makeGameFixture("items.xml", `<items></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items", "append", `<item name="future" value="1"/>`, "xml", "<item future>"),
      op("B", 2, "items.xml", "/items/item[@name='future']/@value", "set", "2")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].effects[0].kind, "appendChild");
    assert.equal(trace[1].status, "applied");
    assert.equal(trace[1].effects[0].target, "/items/item[@name='future']/@value");
    assert.equal(trace[1].effects[0].before, "1");
    assert.equal(trace[1].effects[0].after, "2");
  } finally {
    await fixture.cleanup();
  }
});

test("append refreshes fast-path key index when matching keys already exist", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><group name="old"><item name="future" value="stale"/></group><group name="new"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/group[@name='new']", "append", `<item name="future" value="1"/>`, "xml", "<item future>"),
      op("B", 2, "items.xml", "/items/group[@name='new']/item[@name='future']/@value", "set", "2")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].effects[0].kind, "appendChild");
    assert.equal(trace[1].status, "applied");
    assert.equal(trace[1].effects[0].target, "/items/group[@name='new']/item[@name='future']/@value");
    assert.equal(trace[1].effects[0].before, "1");
    assert.equal(trace[1].effects[0].after, "2");
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
    assert.match(trace[0].effects[0].targetKey ?? "", /^node:\d+$/);
    assert.equal(trace[1].status, "missed");
    assert.equal(trace[1].diagnosticKind, "order-induced-miss");
    assert.equal(trace[1].effects[0].provenance?.removedByOpId, "items.xml:1:1:remove:/items/item[@name='old']");
  } finally {
    await fixture.cleanup();
  }
});

test("removed subtree attribute XPath miss is attributed to the remover ledger", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"><property name="value" value="1"/></item></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='old']/property[@name='value']", "remove"),
      op("B", 2, "items.xml", "/items/item[@name='old']/property[@name='value']/@value", "set", "2")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].effects[0].kind, "removeNode");
    assert.equal(trace[1].status, "missed");
    assert.equal(trace[1].diagnosticKind, "order-induced-miss");
    assert.equal(trace[1].effects[0].target, "/items/item[@name='old']/property[@name='value']/@value");
  } finally {
    await fixture.cleanup();
  }
});

test("remove invalidates fast-path targets under the removed node", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="old"><property name="value" value="1"/></item></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='old']", "remove"),
      op("B", 2, "items.xml", "/items/item[@name='old']/property[@name='value']/@value", "set", "2")
    ], fixture.gamePath, { mode: "fast" });

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

test("replay budget is applied per file so one heavy file does not starve another", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="1"/></items>`);
  await writeFile(path.join(fixture.gamePath, "Data", "Config", "blocks.xml"), `<blocks><block name="stone" value="1"/></blocks>`, "utf8");
  try {
    const { trace, warnings } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']/@value", "set", "2"),
      op("B", 2, "blocks.xml", "/blocks/block[@name='stone']/@value", "set", "3")
    ], fixture.gamePath, { timeoutMs: -1 });

    assert.equal(trace.length, 2);
    assert.deepEqual(trace.map((item) => item.file).sort(), ["blocks.xml", "items.xml"]);
    assert.equal(trace.every((item) => item.status === "partial"), true);
    assert.equal(warnings.filter((warning) => warning.kind === "trace-budget-exceeded").length, 2);
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

test("non-indexed simple fast path uses fast predicate filtering", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="10"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[contains(@name,'co')]/@value", "set", "120")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/@value");
    assert.equal(trace[0].effects[0].after, "120");
  } finally {
    await fixture.cleanup();
  }
});

test("fast path does not prefilter multi-branch or predicates by only the first key", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="cash" value="10"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin' or @name='cash']/@value", "set", "120")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='cash']/@value");
    assert.equal(trace[0].effects[0].before, "10");
    assert.equal(trace[0].effects[0].after, "120");
  } finally {
    await fixture.cleanup();
  }
});

test("fast path applies ordinals after earlier predicates like XPath", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="5"/><item name="cash" value="10"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='cash'][1]/@value", "set", "120")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='cash']/@value");
    assert.equal(trace[0].effects[0].before, "10");
    assert.equal(trace[0].effects[0].after, "120");
  } finally {
    await fixture.cleanup();
  }
});

test("unsupported fast path falls back to generic XPath", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="10"/><item name="iron" value="20"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[not(@name='iron')]/@value", "set", "120")
    ], fixture.gamePath, { mode: "fast" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/@value");
    assert.equal(trace[0].effects[0].after, "120");
  } finally {
    await fixture.cleanup();
  }
});

test("exact resolve mode keeps generic XPath semantics", async () => {
  const fixture = await makeGameFixture("items.xml", `<items><item name="coin" value="10"/></items>`);
  try {
    const { trace } = await buildPatchTrace([
      op("A", 1, "items.xml", "/items/item[@name='coin']/@value", "set", "120")
    ], fixture.gamePath, { mode: "exact" });

    assert.equal(trace[0].status, "applied");
    assert.equal(trace[0].effects[0].target, "/items/item[@name='coin']/@value");
    assert.equal(trace[0].effects[0].before, "10");
    assert.equal(trace[0].effects[0].after, "120");
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
