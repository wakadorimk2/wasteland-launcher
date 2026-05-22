import test from "node:test";
import assert from "node:assert/strict";
import { compileXPathSubset } from "./xpath.js";

test("XPath subset compiler accepts absolute child chains with key predicates and terminal attributes", () => {
  const compiled = compileXPathSubset("/items/item[@name='coin']/property[@name=\"value\"]/@value");

  assert.equal(compiled.supported, true);
  assert.equal(compiled.kind, "absolute-child-chain");
  assert.equal(compiled.terminalAttribute, "value");
  assert.deepEqual(compiled.steps.map((step) => [step.axis, step.tag, step.keyAttribute, step.keyValue]), [
    ["child", "items", undefined, undefined],
    ["child", "item", "name", "coin"],
    ["child", "property", "name", "value"]
  ]);
});

test("XPath subset compiler accepts descendant lookup only with a final key", () => {
  const compiled = compileXPathSubset("//property[@name='value']/@value");

  assert.equal(compiled.supported, true);
  assert.equal(compiled.kind, "keyed-descendant");
  assert.equal(compiled.steps[0].axis, "descendant");
});

test("XPath subset compiler rejects unsupported predicates as unknown risk input", () => {
  const compiled = compileXPathSubset("/items/item[contains(@name,'coin')]/@value");

  assert.equal(compiled.supported, false);
  assert.equal(compiled.kind, "unsupported");
  assert.equal(compiled.reason, "unsupported-predicate");
});
