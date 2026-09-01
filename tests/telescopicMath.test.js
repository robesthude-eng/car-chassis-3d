import test from "node:test";
import assert from "node:assert/strict";
import {
  solveTelescopic,
  solveRodShroud,
} from "../src/geometry/telescopicMath.js";

/* Фактические параметры из app.js */
const FRONT = {
  tubeBottom: -0.12,
  tubeLength: 0.28,
  rodTopInset: 0.03,
  minInsertion: 0.075,
  minRodLength: 0.1,
};
const REAR = {
  tubeBottom: 0.01,
  tubeLength: 0.24,
  rodTopInset: 0.02,
  minInsertion: 0.07,
  minRodLength: 0.09,
};

/* Полный ход с запасом в обе стороны */
const FRONT_TRAVEL = [0.4, 0.44, 0.5, 0.56, 0.62, 0.66];
const REAR_TRAVEL = [0.42, 0.47, 0.532, 0.58, 0.63, 0.66];

test("шток НИКОГДА не отрывается от корпуса", () => {
  for (const [spec, travel] of [
    [FRONT, FRONT_TRAVEL],
    [REAR, REAR_TRAVEL],
  ]) {
    for (const length of travel) {
      const t = solveTelescopic({ length, ...spec });
      assert.ok(
        t.insertion >= spec.minInsertion - 1e-12,
        `заделка ${t.insertion} < ${spec.minInsertion} при L=${length}`,
      );
      /* низ штока всегда внутри трубы */
      assert.ok(t.rodBottom > t.tubeBottom, `шток пробил дно при L=${length}`);
      assert.ok(t.rodBottom < t.tubeTop, `шток вышел из трубы при L=${length}`);
    }
  }
});

test("шток достаёт до верхней опоры", () => {
  for (const [spec, travel] of [
    [FRONT, FRONT_TRAVEL],
    [REAR, REAR_TRAVEL],
  ]) {
    for (const length of travel) {
      const t = solveTelescopic({ length, ...spec });
      assert.ok(Math.abs(t.rodTop - (length - spec.rodTopInset)) < 1e-12);
      assert.ok(t.rodLength >= spec.minRodLength - 1e-12);
      /* геометрическая согласованность */
      assert.ok(Math.abs(t.rodTop - t.rodBottom - t.rodLength) < 1e-12);
      assert.ok(Math.abs(t.rodCenter - (t.rodBottom + t.rodLength / 2)) < 1e-12);
    }
  }
});

test("геометрия трубы не зависит от хода", () => {
  for (const length of FRONT_TRAVEL) {
    const t = solveTelescopic({ length, ...FRONT });
    assert.equal(t.tubeBottom, -0.12);
    assert.ok(Math.abs(t.tubeTop - 0.16) < 1e-12);
    assert.ok(Math.abs(t.tubeCenter - 0.02) < 1e-12);
  }
});

test("выдвинутая часть штока растёт с ходом отбоя", () => {
  let prev = -1;
  for (const length of FRONT_TRAVEL) {
    const t = solveTelescopic({ length, ...FRONT });
    assert.ok(t.exposed > prev, `вылет не вырос на L=${length}`);
    prev = t.exposed;
  }
});

test("на предельном сжатии заделка упирается в минимум, а не рвётся", () => {
  /* абсурдно короткая стойка — защита от аварийных значений */
  const t = solveTelescopic({ length: 0.15, ...FRONT });
  assert.ok(t.insertion >= FRONT.minInsertion - 1e-12);
  assert.ok(t.rodLength >= FRONT.minRodLength - 1e-12);
});

test("отбойник и пыльник заполняют шток без разрывов", () => {
  for (const length of FRONT_TRAVEL) {
    const t = solveTelescopic({ length, ...FRONT });
    for (const crush of [0, 0.02, 0.05, 0.09]) {
      const s = solveRodShroud({
        tubeTop: t.tubeTop,
        rodTop: t.rodTop,
        bumpStopCrush: crush,
      });
      assert.ok(s.bumpStopLength >= 0.026 - 1e-12);
      assert.ok(s.bumpStopLength <= 0.075 + 1e-12);
      assert.ok(s.bootLength >= 0.03 - 1e-12);
      /* верх отбойника совпадает с вершиной штока */
      const bsTop = s.bumpStopCenter + s.bumpStopLength / 2;
      assert.ok(Math.abs(bsTop - t.rodTop) < 1e-12, `отбойник оторвался`);
      /* низ пыльника — на верху корпуса */
      const bootBottom = s.bootCenter - s.bootLength / 2;
      assert.ok(Math.abs(bootBottom - t.tubeTop) < 1e-12, `пыльник оторвался`);
    }
  }
});

test("сжатие отбойника укорачивает его монотонно", () => {
  let prev = Infinity;
  for (const crush of [0, 0.01, 0.03, 0.06]) {
    const s = solveRodShroud({
      tubeTop: 0.16,
      rodTop: 0.47,
      bumpStopCrush: crush,
    });
    assert.ok(s.bumpStopLength <= prev + 1e-12);
    prev = s.bumpStopLength;
  }
});
