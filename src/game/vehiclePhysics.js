/**
 * Полная 3D-динамика автомобиля.
 *
 * Отличие от прежнего стенда: там была одна продольная ось (vx/ax).
 * Здесь — 6 степеней свободы кузова, четыре независимых колеса
 * с raycast-подвеской, перенос веса, крен, клевок и yaw-момент.
 * Ход подвески, который считает этот модуль, отдаётся визуализации
 * Макферсона и многорычажки, поэтому картинка остаётся инженерно верной.
 */

import {
  longitudinalForce,
  lateralForce,
  frictionEllipse,
  slipRatio,
  slipAngle,
  clamp,
} from "./tireModel.js";

/** Паспортные данные Scirocco III 2.0 TSI. */
export const VEHICLE_SPEC = Object.freeze({
  mass: 1350,
  wheelbase: 2.578,
  trackFront: 1.539,
  trackRear: 1.514,
  cgHeight: 0.52,
  frontBias: 0.61,
  yawInertia: 1950,
  rollInertia: 480,
  pitchInertia: 1900,

  wheelRadius: 0.317,
  wheelInertia: 1.1,
  unsprungFront: 42,
  unsprungRear: 38,

  springFront: 32000,
  springRear: 28000,
  damperBumpFront: 3200,
  damperReboundFront: 4400,
  damperBumpRear: 2800,
  damperReboundRear: 3900,
  travelFront: 0.16,
  travelRear: 0.17,
  arbFront: 14000,
  arbRear: 9000,

  maxSteer: 0.55,
  steerRatio: 15.2,
  ackermann: 0.72,

  dragCoeff: 0.34,
  frontalArea: 2.12,
  airDensity: 1.204,
  liftFront: -0.04,
  liftRear: -0.06,
  rollResist: 0.013,

  brakeTorqueFront: 2400,
  brakeTorqueRear: 1250,
  gravity: 9.81,
});

/** Кривая момента 2.0 TSI, Н·м по оборотам. */
const TORQUE_CURVE = [
  [800, 120],
  [1500, 265],
  [2000, 320],
  [3000, 350],
  [4000, 350],
  [5000, 330],
  [6000, 290],
  [6800, 235],
  [7200, 150],
];

/** Приведённая инерция вращающихся масс двигателя и КПП, кг·м². */
const ENGINE_INERTIA = 0.22;

export const DRIVETRAIN = Object.freeze({
  gears: [-3.6, 0, 3.77, 2.13, 1.36, 1.03, 0.84, 0.69],
  finalDrive: 3.65,
  efficiency: 0.9,
  idleRpm: 850,
  maxRpm: 7000,
  shiftUpRpm: 6400,
  shiftDownRpm: 2400,
});

export function engineTorque(rpm, throttle) {
  const r = clamp(rpm, 600, 7400);
  let t = TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
  for (let i = 0; i < TORQUE_CURVE.length - 1; i += 1) {
    const [r0, t0] = TORQUE_CURVE[i];
    const [r1, t1] = TORQUE_CURVE[i + 1];
    if (r >= r0 && r <= r1) {
      t = t0 + ((t1 - t0) * (r - r0)) / (r1 - r0);
      break;
    }
  }
  const drag = 22 + (r / 7000) * 45; // насосные потери и трение
  return t * throttle - drag * (1 - throttle * 0.7);
}

const WHEEL_LAYOUT = [
  { name: "FL", front: true, sx: -1 },
  { name: "FR", front: true, sx: 1 },
  { name: "RL", front: false, sx: -1 },
  { name: "RR", front: false, sx: 1 },
];

function createWheel(spec, layout) {
  const halfBase = spec.wheelbase / 2;
  const track = layout.front ? spec.trackFront : spec.trackRear;
  return {
    name: layout.name,
    front: layout.front,
    sx: layout.sx,
    // положение в осях кузова: x — вправо, y — вверх, z — вперёд
    posX: (layout.sx * track) / 2,
    posZ: layout.front ? halfBase : -halfBase,
    restLength: layout.front ? spec.travelFront : spec.travelRear,
    compression: 0,
    prevCompression: 0,
    velocity: 0,
    fz: 0,
    fx: 0,
    fy: 0,
    slipRatio: 0,
    slipAngle: 0,
    camber: 0,
    steer: 0,
    spin: 0,
    spinVel: 0,
    saturation: 0,
    grounded: true,
    surfaceMu: 1,
  };
}

export class VehiclePhysics {
  constructor(spec = VEHICLE_SPEC) {
    this.spec = spec;
    this.wheels = WHEEL_LAYOUT.map((l) => createWheel(spec, l));

    this.position = { x: 0, y: spec.cgHeight, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 }; // мировые оси
    this.heading = 0;
    this.yawRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.pitch = 0;
    this.pitchRate = 0;

    this.vx = 0; // продольная в осях кузова
    this.vy = 0; // боковая в осях кузова
    this.ax = 0;
    this.ay = 0;

    this.gear = 3;
    this.rpm = DRIVETRAIN.idleRpm;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.autoShiftTimer = 0;
    this.odometer = 0;

    this.assists = { abs: true, tcs: true, esc: true, autoGearbox: true };
    this.telemetry = { absActive: false, tcsActive: false, escActive: false };
  }

  reset(x = 0, z = 0, heading = 0) {
    this.position = { x, y: this.spec.cgHeight, z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.heading = heading;
    this.yawRate = 0;
    this.roll = this.pitch = this.rollRate = this.pitchRate = 0;
    this.vx = this.vy = this.ax = this.ay = 0;
    this.rpm = DRIVETRAIN.idleRpm;
    this.gear = 3;
    for (const w of this.wheels) {
      w.compression = 0;
      w.velocity = 0;
      w.spinVel = 0;
      w.fx = w.fy = w.fz = 0;
    }
  }

  get speedKph() {
    return Math.hypot(this.vx, this.vy) * 3.6;
  }

  /** Статическая нагрузка на колесо, Н. */
  staticLoad(wheel) {
    const { mass, gravity, frontBias } = this.spec;
    const share = wheel.front ? frontBias : 1 - frontBias;
    return mass * gravity * share * 0.5;
  }

  /**
   * Один шаг интегрирования.
   * @param {number} dt шаг, секунды (рекомендуется <= 1/120)
   * @param {object} input {throttle, brake, steer, handbrake, gearUp, gearDown}
   * @param {object} world {heightAt(x,z), muAt(x,z)}
   */
  step(dt, input, world) {
    const s = this.spec;
    this.applyInput(dt, input);

    // --- рулевое управление с Ackermann ---
    const targetSteer = this.steerInput * s.maxSteer * this.speedSteerFactor();
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, dt * 9);

    // --- перенос веса ---
    const lonTransfer = (s.mass * this.ax * s.cgHeight) / s.wheelbase;
    const latTransferF =
      (s.mass * this.ay * s.cgHeight * s.frontBias) / s.trackFront;
    const latTransferR =
      (s.mass * this.ay * s.cgHeight * (1 - s.frontBias)) / s.trackRear;

    // --- аэродинамика ---
    const speed = Math.hypot(this.vx, this.vy);
    const qA = 0.5 * s.airDensity * s.frontalArea * speed * speed;
    const drag = s.dragCoeff * qA;
    const downForceF = -s.liftFront * qA;
    const downForceR = -s.liftRear * qA;

    let sumFx = 0;
    let sumFy = 0;
    let yawMoment = 0;
    let rollMoment = 0;

    const arbF = this.antiRollMoment(true);
    const arbR = this.antiRollMoment(false);

    for (const w of this.wheels) {
      this.updateSuspension(dt, w, world, {
        lonTransfer,
        latTransfer: w.front ? latTransferF : latTransferR,
        aero: w.front ? downForceF * 0.5 : downForceR * 0.5,
        arb: w.front ? arbF : arbR,
      });
      this.updateTire(dt, w, input);

      // силы колеса в осях кузова с учётом угла поворота
      const c = Math.cos(w.steer);
      const sn = Math.sin(w.steer);
      const fxBody = w.fx * c - w.fy * sn;
      const fyBody = w.fx * sn + w.fy * c;

      sumFx += fxBody;
      sumFy += fyBody;
      yawMoment += fyBody * w.posZ - fxBody * w.posX;
      rollMoment += w.fz * w.posX;
    }

    // --- сопротивление качению ---
    const rr =
      Math.abs(this.vx) > 0.2
        ? Math.sign(this.vx) * s.rollResist * s.mass * s.gravity
        : 0;

    // --- интегрирование тела ---
    this.ax = (sumFx - drag * Math.sign(this.vx || 1) - rr) / s.mass;
    this.ay = (sumFy - s.mass * this.vx * this.yawRate) / s.mass;

    this.vx += this.ax * dt;
    this.vy += (this.ay - this.vx * this.yawRate * 0) * dt;
    this.vy *= 1 - Math.min(0.6, dt * 1.2); // демпфирование боковой на малой скорости

    if (Math.abs(this.vx) < 0.08 && this.throttle < 0.02) {
      this.vx *= 0.86;
      this.vy *= 0.86;
    }

    const yawAcc = yawMoment / s.yawInertia;
    this.yawRate += yawAcc * dt;
    this.yawRate *= 1 - Math.min(0.5, dt * 0.7);
    this.heading += this.yawRate * dt;

    // --- крен и клевок как затухающие колебания ---
    const rollTarget = clamp(
      (-this.ay * s.cgHeight * s.mass) / (s.arbFront + s.arbRear + 40000),
      -0.13,
      0.13,
    );
    const pitchTarget = clamp((this.ax * s.cgHeight * s.mass) / 320000, -0.09, 0.09);
    this.rollRate += (rollTarget - this.roll) * 190 * dt - this.rollRate * 13 * dt;
    this.roll += this.rollRate * dt;
    this.pitchRate += (pitchTarget - this.pitch) * 170 * dt - this.pitchRate * 12 * dt;
    this.pitch += this.pitchRate * dt;

    // --- перевод в мировые координаты ---
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    this.velocity.x = this.vx * sh + this.vy * ch;
    this.velocity.z = this.vx * ch - this.vy * sh;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.odometer += Math.abs(this.vx) * dt;

    const ground = world?.heightAt?.(this.position.x, this.position.z) ?? 0;
    const avgComp =
      this.wheels.reduce((a, w) => a + w.compression, 0) / this.wheels.length;
    this.position.y = ground + s.cgHeight - avgComp * 0.5;

    this.updateDrivetrain(dt);
    return this;
  }

  applyInput(dt, input) {
    const rate = dt * 6;
    this.throttle += (clamp(input.throttle ?? 0, 0, 1) - this.throttle) * Math.min(1, rate);
    this.brake += (clamp(input.brake ?? 0, 0, 1) - this.brake) * Math.min(1, rate * 1.6);
    this.handbrake = clamp(input.handbrake ?? 0, 0, 1);
    const targetSteerInput = clamp(input.steer ?? 0, -1, 1);
    const steerRate = Math.abs(targetSteerInput) > Math.abs(this.steerInput) ? 4.5 : 7;
    this.steerInput +=
      (targetSteerInput - this.steerInput) * Math.min(1, dt * steerRate);
    if (input.gearUp) this.shift(1);
    if (input.gearDown) this.shift(-1);
  }

  /** На скорости руль «тяжелеет» — иначе машина неуправляема на 200 км/ч. */
  speedSteerFactor() {
    const v = Math.abs(this.vx);
    return clamp(1 - v / 95, 0.28, 1);
  }

  antiRollMoment(front) {
    const [l, r] = front
      ? [this.wheels[0], this.wheels[1]]
      : [this.wheels[2], this.wheels[3]];
    const k = front ? this.spec.arbFront : this.spec.arbRear;
    return (l.compression - r.compression) * k;
  }

  updateSuspension(dt, w, world, ctx) {
    const s = this.spec;
    const spring = w.front ? s.springFront : s.springRear;
    const travel = w.front ? s.travelFront : s.travelRear;

    // точка контакта в мире
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const wx = this.position.x + w.posX * ch + w.posZ * sh;
    const wz = this.position.z - w.posX * sh + w.posZ * ch;
    const ground = world?.heightAt?.(wx, wz) ?? 0;
    w.surfaceMu = world?.muAt?.(wx, wz) ?? 1;

    // геометрический ход от рельефа, крена и клевка
    const rollOffset = -this.roll * w.posX;
    const pitchOffset = this.pitch * w.posZ;
    const hubHeight =
      this.position.y - s.cgHeight + rollOffset + pitchOffset - ground;
    const targetComp = clamp(-hubHeight, -travel, travel);

    w.prevCompression = w.compression;
    w.compression += (targetComp - w.compression) * Math.min(1, dt * 18);
    w.velocity = (w.compression - w.prevCompression) / Math.max(dt, 1e-4);

    const bump = w.front ? s.damperBumpFront : s.damperBumpRear;
    const rebound = w.front ? s.damperReboundFront : s.damperReboundRear;
    const damping = w.velocity > 0 ? bump : rebound;

    let fz =
      this.staticLoad(w) +
      spring * w.compression +
      damping * w.velocity +
      ctx.lonTransfer * (w.front ? -1 : 1) * 0.5 +
      ctx.latTransfer * w.sx +
      ctx.aero -
      ctx.arb * w.sx;

    // отбойник в конце хода
    if (w.compression > travel * 0.86) {
      fz += (w.compression - travel * 0.86) * spring * 5.5;
    }

    w.grounded = fz > 0 && hubHeight < travel * 1.15;
    w.fz = Math.max(0, fz);
    // развал растёт с ходом сжатия — Макферсон теряет развал в отбое
    w.camber = (w.front ? -0.017 : -0.021) + w.compression * (w.front ? 0.9 : 0.6) - this.roll * w.sx * 0.55;
  }

  updateTire(dt, w, input) {
    const s = this.spec;
    if (!w.grounded) {
      w.fx = w.fy = 0;
      w.slipRatio = 0;
      w.slipAngle = 0;
      w.saturation = 0;
      w.spinVel *= 1 - Math.min(0.9, dt * 1.5);
      w.spin += w.spinVel * dt;
      return;
    }

    // Ackermann: внутреннее колесо доворачивается сильнее
    if (w.front) {
      const inner = Math.sign(this.steerAngle) === w.sx;
      const k = inner ? 1 + s.ackermann * 0.16 : 1 - s.ackermann * 0.1;
      w.steer = this.steerAngle * k;
    } else {
      w.steer = 0;
    }

    // скорость точки контакта в осях колеса
    const vxContact = this.vx - this.yawRate * w.posX;
    const vyContact = this.vy + this.yawRate * w.posZ;
    const c = Math.cos(w.steer);
    const sn = Math.sin(w.steer);
    const vLong = vxContact * c + vyContact * sn;
    const vLat = -vxContact * sn + vyContact * c;

    // привод — передний, как на Scirocco
    const driveTorque = w.front ? this.wheelDriveTorque() * 0.5 : 0;
    let brakeTorque =
      this.brake * (w.front ? s.brakeTorqueFront : s.brakeTorqueRear);
    if (!w.front) brakeTorque += this.handbrake * 1900;

    const wheelSurfaceSpeed = w.spinVel * s.wheelRadius;
    w.slipRatio = slipRatio(wheelSurfaceSpeed, vLong);
    w.slipAngle = slipAngle(vLat, vLong);

    let fx = longitudinalForce(w.slipRatio, w.fz, w.surfaceMu);
    let fy = lateralForce(w.slipAngle, w.fz, w.camber, w.surfaceMu);

    // --- ассистенты ---
    if (this.assists.abs && this.brake > 0.05 && w.slipRatio < -0.18) {
      brakeTorque *= 0.35;
      this.telemetry.absActive = true;
    }
    if (this.assists.tcs && w.front && w.slipRatio > 0.19 && this.throttle > 0.1) {
      fx *= 0.55;
      this.telemetry.tcsActive = true;
    }

    const lim = frictionEllipse(fx, fy, w.fz, w.surfaceMu);
    w.fx = lim.fx;
    w.fy = lim.fy;
    w.saturation = lim.saturation;

    // Динамика вращения колеса. К инерции самого колеса добавляется
    // приведённая инерция двигателя и трансмиссии — без неё ведущее
    // колесо мгновенно срывается в буксование от любого момента.
    const ratio = DRIVETRAIN.gears[this.gear] || 0;
    const geared = w.front ? ENGINE_INERTIA * ratio * ratio * DRIVETRAIN.finalDrive : 0;
    const inertia = s.wheelInertia + geared;

    const reaction = w.fx * s.wheelRadius;
    const brakeSign = -Math.sign(w.spinVel || vLong || 1);
    const net = driveTorque - reaction + brakeSign * brakeTorque;
    w.spinVel += (net / inertia) * dt;

    // Кинематическая связь: пока шина держит, колесо катится со скоростью
    // дороги. Это стабилизирует решатель на больших шагах.
    const rolling = vLong / s.wheelRadius;
    const bond = w.saturation < 1 ? 0.35 : 0.08;
    w.spinVel += (rolling - w.spinVel) * Math.min(1, dt * 60 * bond);

    if (brakeTorque > 0 && Math.abs(w.spinVel) < 0.7 && Math.abs(vLong) < 0.7) {
      w.spinVel = 0;
    }
    w.spin += w.spinVel * dt;
  }

  wheelDriveTorque() {
    const d = DRIVETRAIN;
    const ratio = d.gears[this.gear];
    if (!ratio) return 0;
    const raw = engineTorque(this.rpm, this.throttle) * ratio * d.finalDrive * d.efficiency;
    // Сцепление выжато на холостых — иначе машина «ползёт» сама.
    if (this.throttle < 0.03) {
      const v = Math.abs(this.vx);
      if (v < 0.5) return 0;
      return Math.min(0, raw); // только торможение двигателем
    }
    return raw;
  }

  updateDrivetrain(dt) {
    const d = DRIVETRAIN;
    const ratio = d.gears[this.gear];
    if (ratio) {
      const avgFront = (this.wheels[0].spinVel + this.wheels[1].spinVel) / 2;
      const target = Math.abs(avgFront * ratio * d.finalDrive * 60) / (2 * Math.PI);
      this.rpm += (Math.max(d.idleRpm, target) - this.rpm) * Math.min(1, dt * 7);
    } else {
      const target = d.idleRpm + this.throttle * 4200;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 4);
    }
    this.rpm = clamp(this.rpm, d.idleRpm, d.maxRpm + 260);

    if (this.assists.autoGearbox) {
      this.autoShiftTimer -= dt;
      if (this.autoShiftTimer <= 0) {
        if (this.rpm > d.shiftUpRpm && this.gear < d.gears.length - 1) this.shift(1);
        else if (this.rpm < d.shiftDownRpm && this.gear > 2) this.shift(-1);
      }
    }
  }

  shift(dir) {
    const next = this.gear + dir;
    if (next < 0 || next >= DRIVETRAIN.gears.length) return;
    this.gear = next;
    this.autoShiftTimer = 0.55;
  }

  /** Снимок для HUD и для визуализации подвески. */
  snapshot() {
    return {
      speedKph: this.speedKph,
      rpm: this.rpm,
      gear: this.gear,
      throttle: this.throttle,
      brake: this.brake,
      steerAngle: this.steerAngle,
      yawRate: this.yawRate,
      roll: this.roll,
      pitch: this.pitch,
      lateralG: this.ay / this.spec.gravity,
      longitudinalG: this.ax / this.spec.gravity,
      odometer: this.odometer,
      wheels: this.wheels.map((w) => ({
        name: w.name,
        compression: w.compression,
        fz: w.fz,
        slipRatio: w.slipRatio,
        slipAngle: w.slipAngle,
        saturation: w.saturation,
        camber: w.camber,
        steer: w.steer,
        spin: w.spin,
        grounded: w.grounded,
      })),
    };
  }
}
