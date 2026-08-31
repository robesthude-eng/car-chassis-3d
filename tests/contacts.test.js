import test from "node:test";
import assert from "node:assert/strict";
import { TIRE_RADIUS } from "../src/data/physics.js";
import {
  TIRE_MAX_SQUASH,
  droppedWheelLocalOffset,
  minBodyY,
  minSubframeSag,
  resolveVerticalContact,
  restOnPadY,
  tireMinCenterY,
} from "../src/kinematics/contacts.js";

test("tire cannot sink more than max squash into the pad", () => {
  const minY = tireMinCenterY(0);
  assert.ok(minY > 0.29);
  assert.equal(minY, TIRE_RADIUS - TIRE_MAX_SQUASH);

  const hit = resolveVerticalContact(
    0.12,
    -2,
    0,
    0,
    TIRE_RADIUS,
    TIRE_MAX_SQUASH,
  );
  assert.equal(hit.y, minY);
  assert.ok(hit.penetration > 0.1);
  assert.equal(hit.v, 0);

  const free = resolveVerticalContact(
    0.34,
    -0.1,
    0,
    0,
    TIRE_RADIUS,
    TIRE_MAX_SQUASH,
  );
  assert.equal(free.y, 0.34);
  assert.equal(free.penetration, 0);
});

test("chassis rails and subframe stay above the floor", () => {
  const bodyFloor = minBodyY();
  assert.ok(bodyFloor > -0.18);
  assert.ok(bodyFloor < 0);

  const sagFloor = minSubframeSag(0.12);
  assert.ok(sagFloor > -0.1);
  assert.ok(-0.14 < sagFloor);
});

test("unbolted wheel rests on the pad and slides off the hub", () => {
  const bolted = droppedWheelLocalOffset({
    wcY: 0.32,
    sign: -1,
    groundY: 0,
    bolted: true,
  });
  assert.deepEqual(bolted, { x: 0, y: 0, z: 0 });

  const off = droppedWheelLocalOffset({
    wcY: 0.4,
    sign: 1,
    groundY: 0.05,
    bolted: false,
  });
  assert.equal(off.x, 0.07);
  assert.ok(Math.abs(off.y - (restOnPadY(0.05, TIRE_RADIUS) - 0.4)) < 1e-12);
  const tireBottom = 0.4 + off.y - TIRE_RADIUS;
  assert.ok(Math.abs(tireBottom - 0.05) < 1e-12);
});
