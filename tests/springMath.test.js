import test from "node:test";
import assert from "node:assert/strict";
import {
  pitchShapeIntegral,
  solidCenterlineHeight,
  solidHeight,
  coilHeightAt,
  coilPitchAt,
  clampSpringLength,
  seatSpring,
  minimumCoilGap,
  coilSpringCenterline,
} from "../src/geometry/springMath.js";

/* Фактические параметры пружин из app.js */
const FRONT = { turns: 7, radius: 0.052, wireRadius: 0.008, endCoils: 0.85 };
const REAR = { turns: 6, radius: 0.05, wireRadius: 0.0075, endCoils: 0.8 };

/* Зазоры между тарелками на всём ходе подвески.
   Перед: gap = strutLen - 0.082 - 0.1675, strutLen ∈ [0.44, 0.60].
   Зад: gap = springLen - 0.026, springLen ∈ [0.32, 0.41]. */
const FRONT_GAPS = [0.1905, 0.2505, 0.3505];
const REAR_GAPS = [0.294, 0.334, 0.384];

test("витки начинаются в нуле и заканчиваются ровно на заданной длине", () => {
  for (const s of [FRONT, REAR]) {
    for (const L of [0.18, 0.2345, 0.319, 0.42]) {
      const h0 = coilHeightAt(0, L, s.turns, s.wireRadius, s.endCoils);
      const hN = coilHeightAt(s.turns, L, s.turns, s.wireRadius, s.endCoils);
      assert.equal(h0, 0);
      assert.ok(Math.abs(hN - L) < 1e-12, `h(turns)=${hN} вместо ${L}`);
    }
  }
});

test("высота витка монотонно растёт", () => {
  const L = 0.2345;
  let prev = -1;
  for (let i = 0; i <= 400; i++) {
    const u = (i / 400) * FRONT.turns;
    const h = coilHeightAt(u, L, FRONT.turns, FRONT.wireRadius, FRONT.endCoils);
    assert.ok(h >= prev, `высота упала на u=${u}`);
    prev = h;
  }
});

test("шаг никогда не меньше диаметра проволоки", () => {
  for (const s of [FRONT, REAR]) {
    const dWire = 2 * s.wireRadius;
    /* включая полное смыкание витков */
    for (const L of [solidCenterlineHeight(s.turns, s.wireRadius), 0.2, 0.4]) {
      for (let i = 0; i <= 200; i++) {
        const u = (i / 200) * s.turns;
        const p = coilPitchAt(u, L, s.turns, s.wireRadius, s.endCoils);
        assert.ok(p >= dWire - 1e-12, `шаг ${p} < ${dWire} на u=${u}`);
      }
    }
  }
});

test("опорные витки поджаты: шаг на концах равен диаметру проволоки", () => {
  const dWire = 2 * FRONT.wireRadius;
  const at = (u) =>
    coilPitchAt(u, 0.2345, FRONT.turns, FRONT.wireRadius, FRONT.endCoils);
  assert.ok(Math.abs(at(0) - dWire) < 1e-12);
  assert.ok(Math.abs(at(FRONT.turns) - dWire) < 1e-12);
});

test("интеграл формы шага равен turns − переход", () => {
  assert.ok(Math.abs(pitchShapeIntegral(7, 0.85) - 6.15) < 1e-12);
  assert.ok(Math.abs(pitchShapeIntegral(6, 0.8) - 5.2) < 1e-12);
  /* endCoils не может съесть больше половины витков */
  assert.ok(Math.abs(pitchShapeIntegral(2, 5) - 1) < 1e-12);
});

test("предел смыкания витков считается по диаметру проволоки", () => {
  assert.ok(Math.abs(solidCenterlineHeight(7, 0.008) - 0.112) < 1e-12);
  assert.ok(Math.abs(solidHeight(7, 0.008) - 0.128) < 1e-12);
  assert.ok(Math.abs(solidHeight(6, 0.0075) - 0.105) < 1e-12);
});

test("clampSpringLength не пускает пружину короче сомкнутых витков", () => {
  const solid = solidCenterlineHeight(7, 0.008);
  assert.equal(clampSpringLength(0.01, 7, 0.008, null), solid);
  assert.equal(clampSpringLength(0.3, 7, 0.008, null), 0.3);
  /* свободная длина ограничивает сверху */
  assert.equal(clampSpringLength(0.9, 7, 0.008, 0.5), 0.5);
});

test("seatSpring сажает пружину точно в зазор между тарелками", () => {
  const seat = seatSpring({ gap: 0.3, turns: 7, wireRadius: 0.008 });
  assert.equal(seat.offset, 0.008);
  assert.ok(Math.abs(seat.length - 0.284) < 1e-12);
  assert.ok(Math.abs(seat.height - 0.3) < 1e-12);
  assert.equal(seat.bound, false);
});

test("seatSpring сообщает о смыкании витков", () => {
  const seat = seatSpring({ gap: 0.05, turns: 7, wireRadius: 0.008 });
  assert.equal(seat.bound, true);
  /* даже в сомкнутом состоянии длина не уходит в отрицательные */
  assert.ok(seat.length > 0);
});

test("витки не проникают друг в друга на всём ходе подвески", () => {
  for (const [s, gaps] of [
    [FRONT, FRONT_GAPS],
    [REAR, REAR_GAPS],
  ]) {
    for (const gap of gaps) {
      const seat = seatSpring({
        gap,
        turns: s.turns,
        wireRadius: s.wireRadius,
      });
      assert.equal(seat.bound, false, `зазор ${gap} уже сомкнут`);
      const minGap = minimumCoilGap({
        turns: s.turns,
        wireRadius: s.wireRadius,
        endCoils: s.endCoils,
        length: seat.length,
      });
      assert.ok(minGap >= -1e-9, `витки пересеклись: ${minGap}`);
    }
  }
});

test("даже при полном смыкании витки касаются, но не пересекаются", () => {
  for (const s of [FRONT, REAR]) {
    const minGap = minimumCoilGap({
      turns: s.turns,
      wireRadius: s.wireRadius,
      endCoils: s.endCoils,
      length: solidCenterlineHeight(s.turns, s.wireRadius),
    });
    assert.ok(Math.abs(minGap) < 1e-9, `зазор при смыкании ${minGap}`);
  }
});

test("центровая линия лежит на цилиндре заданного радиуса", () => {
  const pts = coilSpringCenterline({ ...FRONT, length: 0.2345, samples: 120 });
  assert.equal(pts.length, 121);
  for (const p of pts) {
    const r = Math.hypot(p.x, p.z);
    assert.ok(Math.abs(r - FRONT.radius) < 1e-12, `радиус ${r}`);
  }
  assert.ok(Math.abs(pts[0].y) < 1e-12);
  assert.ok(Math.abs(pts[pts.length - 1].y - 0.2345) < 1e-12);
});
