import test from "node:test";
import assert from "node:assert/strict";
import {
  CHASSIS_GEOMETRY,
  rearBodyWorldPoint,
  rearSubframeWorldPoint,
} from "../src/data/chassisGeometry.js";

function assertPoint(actual, expected) {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(actual[axis] - expected[axis]) < 1e-12,
      `${axis}: expected ${expected[axis]}, received ${actual[axis]}`,
    );
  }
}

test("every rear suspension link has a finite subframe hardpoint", () => {
  const names = ["upperArm", "springLink", "camberLink", "toeLink"];
  assert.deepEqual(
    Object.keys(CHASSIS_GEOMETRY.rearSubframe.hardpoints),
    names,
  );

  for (const name of names) {
    for (const sign of [-1, 1]) {
      const hardpoint = rearSubframeWorldPoint(name, sign);
      assert.ok(Object.values(hardpoint).every(Number.isFinite));
      assert.equal(
        Math.sign(hardpoint.x),
        sign,
        `${name} must mirror across the vehicle centerline`,
      );
    }
  }
});

test("rear body mounts align with the visible spring and damper towers", () => {
  const leftSpring = rearBodyWorldPoint("springTop", -1);
  const rightSpring = rearBodyWorldPoint("springTop", 1);
  const rightDamper = rearBodyWorldPoint("damperTop", 1);
  const rightTrailing = rearBodyWorldPoint("trailingArm", 1);

  assertPoint(leftSpring, { x: -0.56, y: 0.6, z: 1.315 });
  assertPoint(rightSpring, { x: 0.56, y: 0.6, z: 1.315 });
  assertPoint(rightDamper, { x: 0.63, y: 0.78, z: 1.5 });
  assertPoint(rightTrailing, { x: 0.6, y: 0.3, z: 0.76 });
});

test("точки задней цапфы заданы и смотрят внутрь машины", () => {
  const carrier = CHASSIS_GEOMETRY.rearCarrier;
  const names = ["upOut", "splOut", "camOut", "toeOut", "trOut"];
  assert.deepEqual(Object.keys(carrier), names);
  for (const name of names) {
    const loc = carrier[name];
    assert.equal(loc.length, 3, `${name} обязан быть тройкой координат`);
    assert.ok(loc.every(Number.isFinite), `${name} содержит не число`);
    assert.ok(loc[0] < 0, `${name} должен смотреть внутрь машины`);
  }
});

test("нижняя опора амортизатора стоит на пружинном рычаге", () => {
  const mount = CHASSIS_GEOMETRY.rearDamperMount;
  assert.ok(
    mount.seatT > 0.62 && mount.seatT < 0.92,
    `seatT ${mount.seatT}: опора должна быть снаружи чашки пружины (0.62) и не доходить до шарнира цапфы`,
  );
  assert.ok(mount.lift > 0, "проушина обязана стоять над осью рычага");
  assert.ok(mount.aft >= 0, "проушина смещается назад, под стакан кузова");

  /* Плоскость колеса 0.78, обод занимает ±98 мм. Нижний конец
   амортизатора обязан остаться минимум на 40 мм внутрь от кромки
   обода, иначе он графически проходит сквозь диск. */
  const WHEEL_PLANE_X = 0.78;
  const RIM_HALF_WIDTH = 0.098;
  const splIn = rearSubframeWorldPoint("springLink", 1);
  const splOutX = WHEEL_PLANE_X + CHASSIS_GEOMETRY.rearCarrier.splOut[0];
  const mountX = splIn.x + (splOutX - splIn.x) * mount.seatT;
  assert.ok(
    mountX < WHEEL_PLANE_X - RIM_HALF_WIDTH - 0.04,
    `опора на x=${mountX.toFixed(3)} слишком близко к ободу`,
  );

  /* Амортизатор должен стоять почти вертикально */
  const damperTop = rearBodyWorldPoint("damperTop", 1);
  assert.ok(
    Math.abs(damperTop.x - mountX) < 0.06,
    `наклон слишком большой: низ x=${mountX.toFixed(3)}, верх x=${damperTop.x}`,
  );
});

test("unknown suspension hardpoints fail loudly", () => {
  assert.throws(() => rearSubframeWorldPoint("missing", 1), RangeError);
  assert.throws(() => rearBodyWorldPoint("missing", -1), RangeError);
});

/* Пружина должна стоять в кармане арки снаружи от лонжерона:
 в прошлой геометрии её витки шли сквозь лонжерон и панель арки. */
test("задняя пружина стоит снаружи лонжерона", () => {
  const SPRING_OUTER_R = 0.0535;
  const top = rearBodyWorldPoint("springTop", 1);
  const railOuterX = CHASSIS_GEOMETRY.mainRailX + 0.03;
  assert.ok(
    top.x - SPRING_OUTER_R > railOuterX,
    `витки пружины (${(top.x - SPRING_OUTER_R).toFixed(3)}) должны быть снаружи лонжерона (${railOuterX})`,
  );
  const mount = CHASSIS_GEOMETRY.rearDamperMount;
  assert.ok(
    mount.aft > SPRING_OUTER_R,
    "нижняя опора амортизатора должна быть отнесена назад дальше радиуса витков",
  );
});

test("внутренние шарниры задних рычагов стоят на боковине подрамника", () => {
	const RAIL_OUTER_X = 0.3925; // боковина 0.085 шириной на x = 0.35
	const wheel = { x: 0.78, y: 0.32, z: CHASSIS_GEOMETRY.rearAxleZ };
	const pairs = [
		["upperArm", "upOut"],
		["springLink", "splOut"],
		["camberLink", "camOut"],
		["toeLink", "toeOut"],
	];
	for (const [name, key] of pairs) {
		const inner = rearSubframeWorldPoint(name, 1);
		assert.ok(
			inner.x >= RAIL_OUTER_X,
			`${name}: шарнир внутри подрамника (x = ${inner.x})`,
		);
		const off = CHASSIS_GEOMETRY.rearCarrier[key];
		const len = Math.hypot(
			wheel.x + off[0] - inner.x,
			wheel.y + off[1] - inner.y,
			wheel.z + off[2] - inner.z,
		);
		assert.ok(
			len > 0.24 && len < 0.36,
			`${name}: длина рычага ${(len * 1000).toFixed(0)} мм вне диапазона 240...360`,
		);
	}
});
