import test from "node:test";
import assert from "node:assert/strict";
import {
  dist3,
  rearHubCoords,
  rearLinkLengths,
  solveRearPose,
} from "../src/kinematics/rear.js";
import { CHASSIS_GEOMETRY } from "../src/data/chassisGeometry.js";
import { createHardpoints } from "../src/kinematics/hardpoints.js";

function makeCorner(sign = 1, wcY = 0.32) {
  return {
    sign,
    wcY,
    dxH: 0,
    dzH: 0,
    camber: 0,
    toe: 0,
    sc: { cfg: { x: sign * 0.78, z: CHASSIS_GEOMETRY.rearAxleZ } },
  };
}

function designInners(cm, RHP) {
  const sign = cm.sign;
  const zr = cm.sc.cfg.z;
  const subY = CHASSIS_GEOMETRY.front.lowerPivotY;
  const world = (x, y, z) => ({ x, y, z });
  return {
    up: world(sign * RHP.upIn[0], subY + RHP.upIn[1], zr + RHP.upIn[2]),
    spl: world(sign * RHP.splIn[0], subY + RHP.splIn[1], zr + RHP.splIn[2]),
    cam: world(sign * RHP.camIn[0], subY + RHP.camIn[1], zr + RHP.camIn[2]),
    toe: world(sign * RHP.toeIn[0], subY + RHP.toeIn[1], zr + RHP.toeIn[2]),
    tr: world(sign * RHP.trIn[0], RHP.trIn[1], zr + RHP.trIn[2]),
  };
}

test("rear hub transform mirrors across the vehicle centerline", () => {
  const left = makeCorner(-1);
  const right = makeCorner(1);
  const loc = [-0.08, 0.09, -0.05];
  const l = rearHubCoords(left, loc, 0, 0, 0, 0);
  const r = rearHubCoords(right, loc, 0, 0, 0, 0);
  assert.equal(Math.sign(l.x), -1);
  assert.equal(Math.sign(r.x), 1);
  assert.ok(Math.abs(l.x + r.x) < 1e-12);
  assert.ok(Math.abs(l.y - r.y) < 1e-12);
  assert.ok(Math.abs(l.z - r.z) < 1e-12);
});

test("multilink solver keeps upper, camber and trailing arms at design length", () => {
  const { RHP } = createHardpoints(CHASSIS_GEOMETRY);
  const cm = makeCorner(1, 0.38);
  const inners = designInners(cm, RHP);
  const locs = {
    upOut: RHP.upOut,
    camOut: RHP.camOut,
    trOut: RHP.trOut,
    toeOut: RHP.toeOut,
    splOut: RHP.splOut,
  };
  const lengths = rearLinkLengths({ ...cm, wcY: 0.32 }, inners, locs);
  const pose = solveRearPose(cm, inners, lengths, locs);

  const up = rearHubCoords(cm, RHP.upOut, pose.dxH, pose.camber, 0, pose.dzH);
  const cam = rearHubCoords(cm, RHP.camOut, pose.dxH, pose.camber, 0, pose.dzH);
  const tr = rearHubCoords(cm, RHP.trOut, pose.dxH, pose.camber, 0, pose.dzH);
  const toe = rearHubCoords(
    cm,
    RHP.toeOut,
    pose.dxH,
    pose.camber,
    pose.toe,
    pose.dzH,
  );

  assert.ok(Math.abs(dist3(up, inners.up) - lengths.LU) < 5e-4);
  assert.ok(Math.abs(dist3(cam, inners.cam) - lengths.LC) < 5e-4);
  assert.ok(Math.abs(dist3(tr, inners.tr) - lengths.LTR) < 5e-4);
  assert.ok(Math.abs(dist3(toe, inners.toe) - lengths.LT) < 8e-4);
  assert.ok(Number.isFinite(pose.dxH));
  assert.ok(Number.isFinite(pose.dzH));
});
