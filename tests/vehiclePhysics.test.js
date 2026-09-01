import test from "node:test";
import assert from "node:assert/strict";
import { VehiclePhysics, VEHICLE_SPEC, engineTorque } from "../src/game/vehiclePhysics.js";

const flatWorld = { heightAt: () => 0, muAt: () => 1 };
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(v, input, seconds, dt = 1 / 120) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) v.step(dt, input, flatWorld);
  return v;
}

test("статические нагрузки в сумме дают вес автомобиля", () => {
  const v = new VehiclePhysics();
  const total = v.wheels.reduce((a, w) => a + v.staticLoad(w), 0);
  const weight = VEHICLE_SPEC.mass * VEHICLE_SPEC.gravity;
  assert.ok(Math.abs(total - weight) < 1, `${total} против ${weight}`);
});

test("передняя ось нагружена сильнее — компоновка переднеприводная", () => {
  const v = new VehiclePhysics();
  assert.ok(v.staticLoad(v.wheels[0]) > v.staticLoad(v.wheels[2]));
});

test("машина стоит на месте без газа", () => {
  const v = new VehiclePhysics();
  run(v, IDLE, 2);
  assert.ok(Math.abs(v.speedKph) < 1, `скорость ${v.speedKph}`);
});

test("газ разгоняет автомобиль", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1 }, 5);
  assert.ok(v.speedKph > 30, `за 5 с набрано лишь ${v.speedKph.toFixed(1)} км/ч`);
  assert.ok(v.speedKph < 260, "нереалистичная скорость");
});

test("тормоз останавливает разогнанный автомобиль", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1 }, 5);
  const fast = v.speedKph;
  run(v, { ...IDLE, brake: 1 }, 6);
  assert.ok(v.speedKph < fast * 0.4, `с ${fast.toFixed(1)} до ${v.speedKph.toFixed(1)}`);
});

test("поворот руля меняет курс автомобиля", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1 }, 4);
  const h0 = v.heading;
  run(v, { ...IDLE, throttle: 0.4, steer: 1 }, 3);
  assert.ok(Math.abs(v.heading - h0) > 0.05, "курс не изменился при повороте руля");
});

test("в повороте возникает боковое ускорение", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1 }, 5);
  run(v, { ...IDLE, throttle: 0.5, steer: 1 }, 2);
  assert.ok(Math.abs(v.ay) > 0.2, "боковое ускорение отсутствует");
});

test("крен направлен наружу поворота", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1 }, 5);
  run(v, { ...IDLE, throttle: 0.5, steer: 1 }, 2.5);
  assert.ok(Math.abs(v.roll) > 0.002, "кузов не кренится");
  assert.ok(Math.abs(v.roll) < 0.14, "крен вне физичных пределов");
});

test("состояние остаётся конечным на длинной дистанции", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1, steer: 0.4 }, 20);
  for (const key of ["x", "y", "z"]) {
    assert.ok(Number.isFinite(v.position[key]), `позиция ${key} разошлась`);
  }
  assert.ok(Number.isFinite(v.heading) && Number.isFinite(v.yawRate));
  for (const w of v.wheels) {
    assert.ok(Number.isFinite(w.fz) && w.fz >= 0, "нагрузка колеса некорректна");
  }
});

test("ход подвески не выходит за конструктивный предел", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1, steer: 0.7 }, 8);
  for (const w of v.wheels) {
    const travel = w.front ? VEHICLE_SPEC.travelFront : VEHICLE_SPEC.travelRear;
    assert.ok(Math.abs(w.compression) <= travel * 1.02, `${w.name}: ${w.compression}`);
  }
});

test("руль становится острее на малой скорости", () => {
  const v = new VehiclePhysics();
  const slow = v.speedSteerFactor();
  v.vx = 60;
  assert.ok(v.speedSteerFactor() < slow, "на скорости руль обязан притупляться");
});

test("момент двигателя максимален в средних оборотах", () => {
  const low = engineTorque(1000, 1);
  const mid = engineTorque(3500, 1);
  const high = engineTorque(7000, 1);
  assert.ok(mid > low && mid > high, `${low} / ${mid} / ${high}`);
});

test("закрытый газ даёт торможение двигателем", () => {
  assert.ok(engineTorque(4000, 0) < 0);
});

test("сброс возвращает автомобиль в исходное состояние", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 1, steer: 1 }, 5);
  v.reset(10, 20, 1.2);
  assert.equal(v.position.x, 10);
  assert.equal(v.position.z, 20);
  assert.equal(v.heading, 1.2);
  assert.ok(Math.abs(v.speedKph) < 0.001);
});

test("снимок телеметрии содержит все четыре колеса", () => {
  const v = new VehiclePhysics();
  run(v, { ...IDLE, throttle: 0.6 }, 2);
  const s = v.snapshot();
  assert.equal(s.wheels.length, 4);
  assert.ok(Number.isFinite(s.speedKph) && Number.isFinite(s.rpm));
  assert.ok(Number.isFinite(s.lateralG) && Number.isFinite(s.longitudinalG));
});

test("скользкое покрытие снижает разгон", () => {
  const dry = new VehiclePhysics();
  run(dry, { ...IDLE, throttle: 1 }, 5);
  const ice = new VehiclePhysics();
  const slippery = { heightAt: () => 0, muAt: () => 0.25 };
  for (let i = 0; i < 600; i += 1) ice.step(1 / 120, { ...IDLE, throttle: 1 }, slippery);
  assert.ok(ice.speedKph < dry.speedKph, `лёд ${ice.speedKph} против сухого ${dry.speedKph}`);
});
