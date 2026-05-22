import test from "node:test";
import assert from "node:assert/strict";
import { classifyFootprintPair, extractPatchFootprint, extractPatchFootprints, groupFootprintsByFile } from "./footprint.js";
import { XmlPatchOperation } from "./types.js";

test("set attribute XPath writes an attribute scalar slot", () => {
  const footprint = extractPatchFootprint(op("set", "/items/item[@name='coin']/@value"));

  assert.equal(footprint.precision, "supported");
  assert.equal(footprint.reads[0].kind, "attribute");
  assert.deepEqual(footprint.writtenScalarSlots[0], {
    file: "items.xml",
    xpath: "/items/item[@name='coin']",
    normalizedXpath: "/items/item[@name='coin']",
    kind: "attribute",
    attribute: "value"
  });
});

test("set element XPath writes a text scalar slot", () => {
  const footprint = extractPatchFootprint(op("set", "/items/item[@name='coin']/property[@name='price']"));

  assert.equal(footprint.precision, "supported");
  assert.deepEqual(footprint.writtenScalarSlots[0], {
    file: "items.xml",
    xpath: "/items/item[@name='coin']/property[@name='price']",
    normalizedXpath: "/items/item[@name='coin']/property[@name='price']",
    kind: "text"
  });
});

test("setattribute uses attributes.name for the attribute slot", () => {
  const footprint = extractPatchFootprint(op("setattribute", "/items/item[@name='coin']", { name: "tags", value: "money" }));

  assert.equal(footprint.reads[0].xpath, "/items/item[@name='coin']");
  assert.deepEqual(footprint.writtenScalarSlots[0], {
    file: "items.xml",
    xpath: "/items/item[@name='coin']",
    normalizedXpath: "/items/item[@name='coin']",
    kind: "attribute",
    attribute: "tags"
  });
});

test("removeattribute is classified as a scalar delete/write", () => {
  const footprint = extractPatchFootprint(op("removeattribute", "/items/item[@name='coin']", { name: "tags" }));

  assert.equal(footprint.removedNodeSelectors.length, 0);
  assert.deepEqual(footprint.writtenScalarSlots[0], {
    file: "items.xml",
    xpath: "/items/item[@name='coin']",
    normalizedXpath: "/items/item[@name='coin']",
    kind: "attribute",
    attribute: "tags"
  });
});

test("append element target inserts a child slot and append attribute target writes a scalar slot", () => {
  const element = extractPatchFootprint(op("append", "/items"));
  const attribute = extractPatchFootprint(op("append", "/items/item[@name='coin']/@tags"));

  assert.deepEqual(element.insertedChildSlots[0], {
    file: "items.xml",
    xpath: "/items",
    normalizedXpath: "/items",
    kind: "child"
  });
  assert.equal(element.writtenScalarSlots.length, 0);
  assert.deepEqual(attribute.writtenScalarSlots[0], {
    file: "items.xml",
    xpath: "/items/item[@name='coin']",
    normalizedXpath: "/items/item[@name='coin']",
    kind: "attribute",
    attribute: "tags"
  });
  assert.equal(attribute.insertedChildSlots.length, 0);
});

test("remove records the removed node selector", () => {
  const footprint = extractPatchFootprint(op("remove", "/items/item[@name='old']"));

  assert.deepEqual(footprint.removedNodeSelectors[0], {
    file: "items.xml",
    xpath: "/items/item[@name='old']",
    normalizedXpath: "/items/item[@name='old']",
    kind: "node"
  });
});

test("insertbefore and insertafter insert into the target parent child slot", () => {
  const before = extractPatchFootprint(op("insertBefore", "/items/item[@name='coin']"));
  const after = extractPatchFootprint(op("insertAfter", "/items/group[@name='currency']/item[@name='coin']"));

  assert.deepEqual(before.insertedChildSlots[0], {
    file: "items.xml",
    xpath: "/items",
    normalizedXpath: "/items",
    kind: "child"
  });
  assert.deepEqual(after.insertedChildSlots[0], {
    file: "items.xml",
    xpath: "/items/group[@name='currency']",
    normalizedXpath: "/items/group[@name='currency']",
    kind: "child"
  });
});

test("unsupported operations are unknown and not treated as supported", () => {
  const footprint = extractPatchFootprint(op("csv", "/items/item[@name='coin']"));

  assert.equal(footprint.precision, "unknown");
  assert.deepEqual(footprint.reasons, ["unsupported-operation"]);
  assert.equal(footprint.reads[0].kind, "node");
  assert.equal(footprint.writtenScalarSlots.length, 0);
  assert.equal(footprint.insertedChildSlots.length, 0);
});

test("empty XPath and parse-error are unknown", () => {
  const empty = extractPatchFootprint(op("set", ""));
  const parseError = extractPatchFootprint(op("parse-error", ""));

  assert.equal(empty.precision, "unknown");
  assert.deepEqual(empty.reasons, ["empty-xpath"]);
  assert.equal(parseError.precision, "unknown");
  assert.deepEqual(parseError.reasons, ["parse-error"]);
  assert.equal(parseError.reads.length, 0);
});

test("unsupported XPath subset is unknown risk", () => {
  const footprint = extractPatchFootprint(op("set", "/items/item[contains(@name,'coin')]/@value"));

  assert.equal(footprint.precision, "unknown");
  assert.deepEqual(footprint.reasons, ["unsupported-xpath"]);
  assert.equal(footprint.writtenScalarSlots[0].attribute, "value");
});

test("groupFootprintsByFile groups footprints by file", () => {
  const footprints = extractPatchFootprints([
    op("set", "/items/item[@name='coin']/@value", undefined, "items.xml"),
    op("append", "/blocks", undefined, "blocks.xml"),
    op("remove", "/items/item[@name='old']", undefined, "items.xml")
  ]);

  const grouped = groupFootprintsByFile(footprints);
  assert.equal(grouped.get("items.xml")?.length, 2);
  assert.equal(grouped.get("blocks.xml")?.length, 1);
});

test("footprint classifier separates commuting, non-commuting, and unknown pairs", () => {
  const valueA = extractPatchFootprint(op("set", "/items/item[@name='coin']/@value"));
  const valueB = extractPatchFootprint(op("setattribute", "/items/item[@name='coin']", { name: "value" }));
  const unrelated = extractPatchFootprint(op("set", "/items/item[@name='rock']/@value"));
  const unknown = extractPatchFootprint(op("csv", "/items/item[@name='coin']"));

  assert.equal(classifyFootprintPair(valueA, valueB), "non_commutes");
  assert.equal(classifyFootprintPair(valueA, unrelated), "commutes");
  assert.equal(classifyFootprintPair(valueA, unknown), "unknown");
});

function op(operation: string, xpath: string, attributes?: Record<string, string>, file = "items.xml"): XmlPatchOperation {
  return {
    modName: "Example",
    displayName: "Example",
    order: 1,
    file,
    path: `/mods/Example/Config/${file}`,
    operation,
    xpath,
    line: 1,
    ...(attributes ? { attributes } : {})
  };
}
