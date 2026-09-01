import test from "node:test";
import assert from "node:assert/strict";
import {
  longitudinalForce,
  lateralForce,
  frictionEllipse,
  slipRatio,
  slipAngle,
} from "../src/game/tireModel.js";

const FZ = 3300; // типичная нагрузка на переднее колесо, Н

test("продольная сила растёт до пика и затем падает", () => {
  const atPeak = Math.abs(longitudinalForce(0.12, FZ));
  const small = Math.abs(longitudinalForce(0.02, FZ));
  const far = Math.abs(longitudinalForce(0.9, FZ));
  assert.ok(atPeak > small, "пик должен превышать малое проскальзывание");
  assert.ok(atPeak > far, "после пика сила обязана снижаться");
});

test("продольная сила нечётная по знаку проскальзывания", () => {
  const p = longitudinalForce(0.2, FZ);
  const n = longitudinalForce(-0.2, FZ);
  assert.ok(p > 0 && n < 0);
  assert.ok(Math.abs(p + n) < Math.abs(p) * 0.25);
});

test("без нагрузки шина не передаёт силу", () => {
  assert.equal(longitudinalForce(0.3, 0), 0);
  assert.equal(lateralForce(0.1, 0), 0);
});

test("боковая сила растёт с углом увода до насыщения", () => {
  const a2 = Math.abs(lateralForce(2 * (Math.PI / 180), FZ));
  const a6 = Math.abs(lateralForce(6 * (Math.PI / 180), FZ));
  const a20 = Math.abs(lateralForce(20 * (Math.PI / 180), FZ));
  assert.ok(a6 > a2, "6 градусов держит больше, чем 2");
  assert.ok(a20 < a6 * 1.05, "после пика боковая не должна расти");
});

test("сцепление ограничивает суммарную силу", () => {
  const mu = 1;
  const r = frictionEllipse(FZ, FZ, FZ, mu);
  const mag = Math.hypot(r.fx, r.fy);
  assert.ok(mag <= FZ * mu * 1.001, `модуль ${mag} превысил предел ${FZ}`);
  assert.ok(r.saturation > 1, "перегруз должен отражаться в saturation");
});

test("внутри круга сцепления силы не масштабируются", () => {
  const r = frictionEllipse(500, 400, FZ, 1);
  assert.equal(r.fx, 500);
  assert.equal(r.fy, 400);
  assert.ok(r.saturation < 1);
});

test("нулевое проскальзывание при качении без буксования", () => {
  assert.ok(Math.abs(slipRatio(20, 20)) < 1e-9);
});

test("разгон даёт положительное проскальзывание, торможение — отрицательное", () => {
  assert.ok(slipRatio(24, 20) > 0);
  assert.ok(slipRatio(16, 20) < 0);
});

test("угол увода нулевой на стоянке", () => {
  assert.equal(slipAngle(2, 0.1), 0);
});

test("боковая скорость даёт угол увода нужного знака", () => {
  assert.ok(slipAngle(3, 25) < 0);
  assert.ok(slipAngle(-3, 25) > 0);
});
