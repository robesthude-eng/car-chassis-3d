import test from "node:test";
import assert from "node:assert/strict";
import { BOLT_SPECS } from "../src/data/boltSpecs.js";

test("bolt specifications keep a unique strict sequence", () => {
  assert.equal(BOLT_SPECS.length, 8);
  assert.deepEqual(
    BOLT_SPECS.map((spec) => spec.step),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(
    new Set(BOLT_SPECS.map((spec) => spec.id)).size,
    BOLT_SPECS.length,
  );
  assert.equal(
    new Set(BOLT_SPECS.map((spec) => spec.key)).size,
    BOLT_SPECS.length,
  );
  assert.ok(BOLT_SPECS.every((spec) => spec.torque && spec.bolts && spec.part));
});
