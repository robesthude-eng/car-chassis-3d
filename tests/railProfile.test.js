import test from "node:test";
import assert from "node:assert/strict";
import {
  SIDE_RAIL_PATH,
  SIDE_RAIL_SECTION,
  railYAt,
  railTopAt,
  railBottomAt,
  railOutline,
  maxRailKinkDeg,
  isRailOutlineSimple,
} from "../src/geometry/railProfile.js";

test("профиль лонжерона идёт строго от носа к хвосту", () => {
  assert.ok(SIDE_RAIL_PATH.length >= 2);
  for (let i = 1; i < SIDE_RAIL_PATH.length; i++) {
    assert.ok(
      SIDE_RAIL_PATH[i].z > SIDE_RAIL_PATH[i - 1].z,
      `узлы не отсортированы на индексе ${i}`,
    );
  }
});

test("railYAt точен в каждом узле", () => {
  for (const knot of SIDE_RAIL_PATH) {
    assert.equal(railYAt(knot.z), knot.y, `узел z=${knot.z}`);
  }
});

test("за пределами профиля высота зажата крайними узлами", () => {
  const first = SIDE_RAIL_PATH[0];
  const last = SIDE_RAIL_PATH[SIDE_RAIL_PATH.length - 1];
  assert.equal(railYAt(first.z - 5), first.y);
  assert.equal(railYAt(last.z + 5), last.y);
});

test("интерполяция не вылетает за соседние узлы", () => {
  for (let i = 1; i < SIDE_RAIL_PATH.length; i++) {
    const a = SIDE_RAIL_PATH[i - 1];
    const b = SIDE_RAIL_PATH[i];
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    for (let k = 1; k < 12; k++) {
      const z = a.z + ((b.z - a.z) * k) / 12;
      const y = railYAt(z);
      assert.ok(y >= lo - 1e-12 && y <= hi + 1e-12, `z=${z} дал высоту ${y}`);
    }
  }
});

test("верх и низ сечения отстоят от оси на полвысоты", () => {
  const half = SIDE_RAIL_SECTION.height * 0.5;
  for (const z of [-1.7, -1.3, -0.5, 0, 0.5, 1.3, 1.7]) {
    assert.ok(Math.abs(railTopAt(z) - (railYAt(z) + half)) < 1e-12);
    assert.ok(Math.abs(railBottomAt(z) - (railYAt(z) - half)) < 1e-12);
  }
});

test("контур замкнут и имеет по две точки на узел", () => {
  const outline = railOutline();
  assert.equal(outline.length, SIDE_RAIL_PATH.length * 2);
  for (const p of outline) {
    assert.equal(typeof p.z, "number");
    assert.equal(typeof p.y, "number");
    assert.ok(Number.isFinite(p.z) && Number.isFinite(p.y));
  }
});

test("контур не самопересекается — выдавливание корректно", () => {
  assert.equal(isRailOutlineSimple(), true);
});

test("изломы лонжерона остаются правдоподобными", () => {
  const kink = maxRailKinkDeg();
  assert.ok(kink > 0, "профиль оказался абсолютно плоским");
  assert.ok(kink < 15, `излом ${kink}° слишком резкий для штампованого профиля`);
});

test("сечение лонжерона — закрытый профиль реальных размеров", () => {
  assert.ok(SIDE_RAIL_SECTION.width > 0.03);
  assert.ok(SIDE_RAIL_SECTION.height > SIDE_RAIL_SECTION.width);
  assert.throws(() => {
    SIDE_RAIL_SECTION.width = 1;
  });
});

test("опорные точки подвески лежат на ожидаемых высотах", () => {
  /* передняя ось выше центра — подъём над подрамником */
  assert.ok(Math.abs(railYAt(-1.3) - 0.2669) < 2e-4);
  assert.ok(Math.abs(railYAt(0) - 0.2185) < 2e-4);
  /* задняя ось выше передней — арка под многорычажку */
  assert.ok(Math.abs(railYAt(1.3) - 0.2907) < 2e-4);
  assert.ok(railYAt(1.3) > railYAt(0));
  assert.ok(railYAt(-1.3) > railYAt(0));
  /* верх лонжерона под чашкой задней пружины */
  assert.ok(Math.abs(railTopAt(1.315) - 0.3387) < 2e-4);
});
