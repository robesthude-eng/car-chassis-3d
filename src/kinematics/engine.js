import {
  GEAR_RATIO,
  TIRE_RADIUS,
  CG_Y,
  CG_Z,
  STATIC_WC_Y,
  createPhysicsConstants,
} from "../data/physics.js";
import { clamp } from "../utils.js";
import { createHardpoints } from "./hardpoints.js";
import { rearHubCoords, writePoint, solveRearPose } from "./rear.js";
import {
  KNUCKLE_REST_RADIUS,
  TIRE_MAX_SQUASH,
  minBodyY,
  minSubframeSag,
  resolveVerticalContact,
} from "./contacts.js";

export function createKinematicsEngine({
  THREE,
  CHASSIS,
  assemblyState,
  suspensionCorners,
  wheelAssemblies,
  LOW_END,
  state,
}) {
  const PHYS = createPhysicsConstants(LOW_END);
  const { HP, RHP, BJ_CLAMP_DX, BJ_CLAMP_DY, BJ_CLAMP_LEN } =
    createHardpoints(CHASSIS);

  /* ── КУЗОВ КАК ТЕЛО НА ПРУЖИНАХ (ход, крен, клевок) ── */
  const body = {
    y: 0,
    vy: 0,
    roll: 0,
    rollV: 0,
    pitch: 0,
    pitchV: 0,
    mS: PHYS.mass - 2 * PHYS.unsprungF - 2 * PHYS.unsprungR,
    Ixx: 520,
    Iyy: 1980,
    ay: 0,
    sag: 0,
  };

  const _mA = new THREE.Vector3(),
    _mB = new THREE.Vector3(),
    _mC = new THREE.Vector3();
  const _mD = new THREE.Vector3(),
    _mE = new THREE.Vector3();
  const _mQa = new THREE.Quaternion(),
    _mQb = new THREE.Quaternion();

  /* Точка кузова: ход + крен + клевок вокруг центра масс */
  function bodyPoint(out, x, y, z) {
    const dx = x,
      dy = y - CG_Y,
      dz = z - CG_Z;
    const cr = Math.cos(body.roll),
      sr = Math.sin(body.roll);
    const cp = Math.cos(body.pitch),
      sp = Math.sin(body.pitch);
    const x1 = dx * cr - dy * sr;
    const y1 = dx * sr + dy * cr;
    return out.set(
      x1,
      CG_Y + body.y + y1 * cp - dz * sp,
      CG_Z + y1 * sp + dz * cp,
    );
  }
  /* Вертикальная скорость точки кузова */
  function bodyPointVy(x, z) {
    return body.vy + body.rollV * x - body.pitchV * (z - CG_Z);
  }

  /* ── СОСТОЯНИЕ КАЖДОГО УГЛА ── */
  suspensionCorners.forEach((sc, idx) => {
    const isF = sc.cfg.isFront;
    const sign = sc.cfg.isLeft ? -1 : 1;
    sc.mech = {
      sc,
      idx,
      sign,
      isF,
      wcY: STATIC_WC_Y,
      wcV: 0,
      wcX: sc.cfg.x,
      wcZ: sc.cfg.z,
      mU: isF ? PHYS.unsprungF : PHYS.unsprungR,
      psi: 0,
      camber: 0,
      toe: 0,
      dxH: 0,
      dzH: 0,
      strutLen: 0.5,
      strutMR: -0.7,
      strutFree: 0.66,
      strutVel: 0,
      springLen: 0.36,
      springMR: -0.55,
      springFree: 0.5,
      damperLen: 0.5,
      damperMR: -0.9,
      damperVel: 0,
      groundMm: 0,
      groundY: 0,
      groundV: 0,
      fz: PHYS.mass * PHYS.g * 0.25,
      fSpring: 0,
      fDamp: 0,
      fStrut: 0,
      bumpHit: 0,
      geo: {
        pivot: new THREE.Vector3(),
        bj: new THREE.Vector3(),
        wc: new THREE.Vector3(),
        clamp: new THREE.Vector3(),
        top: new THREE.Vector3(),
        eye: new THREE.Vector3(),
        rackEnd: new THREE.Vector3(),
        hubIn: new THREE.Vector3(),
        axis: new THREE.Vector3(0, 1, 0),
        q: new THREE.Quaternion(),
        spin: new THREE.Vector3(1, 0, 0),
        armAngle: 0,
      },
      aLocal: new THREE.Vector3(sign * BJ_CLAMP_DX, BJ_CLAMP_DY, 0).normalize(),
      wcOffY: -HP.bjLocalY,
      tieRodLen: 0.36,
      rear: { LU: 0.34, LC: 0.36, LT: 0.34, LTR: 0.42 },
    };
    sc.mech.psiRef = 0;
  });
  const mechF = [suspensionCorners[0].mech, suspensionCorners[1].mech];
  const mechR = [suspensionCorners[2].mech, suspensionCorners[3].mech];

  /* ══ ГЕОМЕТРИЯ ПЕРЕДНЕГО УГЛА ══
   Вход: высота центра колеса (степень свободы) и ход рейки.
   Выход: положение шаровой, оси поворота, хомута стойки, наконечника. */
  function frontGeom(cm, wcY, rackX, solveSteer) {
    const sign = cm.sign,
      g = cm.geo,
      sc = cm.sc;
    bodyPoint(g.pivot, sign * HP.armPivotX, HP.armPivotY + body.sag, sc.cfg.z);
    bodyPoint(g.top, sign * HP.towerX, HP.towerY, sc.cfg.z);

    /* Рычаг постоянной длины: высота шаровой задаёт его угол и вынос по X */
    let bjY = wcY - cm.wcOffY;
    for (let it = 0; it < 4; it++) {
      const sinA = clamp((bjY - g.pivot.y) / HP.armLen, -0.86, 0.86);
      const cosA = Math.sqrt(1 - sinA * sinA);
      g.armAngle = Math.asin(sinA);
      g.bj.set(g.pivot.x + sign * HP.armLen * cosA, bjY, g.pivot.z);
      /* Ось поворота колеса = шаровая опора → верхняя опора стойки */
      g.axis.subVectors(g.top, g.bj);
      const axisLen = Math.max(0.2, g.axis.length());
      g.axis.multiplyScalar(1 / axisLen);
      cm.strutLen = axisLen - BJ_CLAMP_LEN;
      /* Цапфа: локальная ось "шаровая→хомут" ложится на ось поворота */
      _mQa.setFromUnitVectors(cm.aLocal, g.axis);
      _mQb.setFromAxisAngle(cm.aLocal, cm.psi);
      g.q.multiplyQuaternions(_mQa, _mQb);
      _mA.set(-sign * HP.bjLocalX, -HP.bjLocalY, 0).applyQuaternion(g.q);
      cm.wcOffY = _mA.y;
      bjY = wcY - cm.wcOffY;
    }
    g.wc.copy(g.bj).add(_mA);
    cm.wcX = g.wc.x;
    cm.wcZ = g.wc.z;
    g.clamp.copy(g.bj).addScaledVector(g.axis, BJ_CLAMP_LEN);

    /* Рейка → тяга → наконечник: угол поворота РЕШАЕТСЯ из длины тяги */
    bodyPoint(
      g.rackEnd,
      sign * HP.rackHalf + rackX,
      HP.rackY + body.sag,
      HP.rackZ,
    );
    if (solveSteer) {
      if (assemblyState.steeringBolted) {
        const L2 = cm.tieRodLen * cm.tieRodLen;
        let psi = cm.psi;
        for (let it = 0; it < 6; it++) {
          const f0 = eyeErr(cm, psi, L2);
          const f1 = eyeErr(cm, psi + 1e-3, L2);
          const d = (f1 - f0) / 1e-3;
          if (!isFinite(d) || Math.abs(d) < 1e-9) break;
          const stepPsi = clamp(f0 / d, -0.25, 0.25);
          psi = clamp(psi - stepPsi, -0.68, 0.68);
          if (Math.abs(stepPsi) < 1e-6) break;
        }
        cm.psi = psi;
      } else {
        /* Наконечники откручены — рейку никто не слушает, колесо стоит свободно */
        cm.psi *= 0.985;
      }
      _mQb.setFromAxisAngle(cm.aLocal, cm.psi);
      g.q.multiplyQuaternions(_mQa, _mQb);
    }
    _mA
      .set(sign * HP.eyeLocalX, HP.eyeLocalY, HP.eyeLocalZ)
      .applyQuaternion(g.q);
    g.eye.copy(g.wc).add(_mA);
    _mA.set(sign * HP.hubLocalX, 0, 0).applyQuaternion(g.q);
    g.hubIn.copy(g.wc).add(_mA);
    g.spin.set(sign, 0, 0).applyQuaternion(g.q);
    cm.camber = Math.asin(clamp(g.spin.y * sign, -1, 1));
    cm.toe = Math.atan2(-g.spin.z * sign, g.spin.x * sign);

    /* Передаточное отношение "ход колеса → сжатие стойки" (аналитически) */
    const sinA = clamp((g.bj.y - g.pivot.y) / HP.armLen, -0.86, 0.86);
    const tanA = sinA / Math.sqrt(1 - sinA * sinA);
    _mB.set(-sign * tanA, 1, 0);
    _mC.subVectors(g.top, g.bj).normalize();
    cm.strutMR = -_mC.dot(_mB);
    if (!isFinite(cm.strutMR)) cm.strutMR = -0.7;
    return cm.strutLen;
  }

  /* Ошибка длины рулевой тяги при пробном угле поворота */
  function eyeErr(cm, psi, L2) {
    const sign = cm.sign,
      g = cm.geo;
    _mQb.setFromAxisAngle(cm.aLocal, psi);
    _mD.set(sign * HP.eyeLocalX, HP.eyeLocalY, HP.eyeLocalZ);
    _mQa.setFromUnitVectors(cm.aLocal, g.axis);
    _mE.copy(_mD).applyQuaternion(_mQb).applyQuaternion(_mQa).add(g.wc);
    return _mE.distanceToSquared(g.rackEnd) - L2;
  }

  /* ══ ГЕОМЕТРИЯ ЗАДНЕГО УГЛА (многорычажка) ══
   Развал и сходимость решаются из длин рычагов: 2 уравнения на боковой сдвиг
   ступицы и угол развала, затем тяга сходимости даёт подруливание. */
  const _rIn = {
    up: new THREE.Vector3(),
    spl: new THREE.Vector3(),
    cam: new THREE.Vector3(),
    toe: new THREE.Vector3(),
    tr: new THREE.Vector3(),
  };
  const _rOut = new THREE.Vector3();

  function rearInner(cm) {
    const sign = cm.sign,
      zr = cm.sc.cfg.z,
      subY = HP.armPivotY + body.sag;
    bodyPoint(
      _rIn.up,
      sign * RHP.upIn[0],
      subY + RHP.upIn[1],
      zr + RHP.upIn[2],
    );
    bodyPoint(
      _rIn.spl,
      sign * RHP.splIn[0],
      subY + RHP.splIn[1],
      zr + RHP.splIn[2],
    );
    bodyPoint(
      _rIn.cam,
      sign * RHP.camIn[0],
      subY + RHP.camIn[1],
      zr + RHP.camIn[2],
    );
    bodyPoint(
      _rIn.toe,
      sign * RHP.toeIn[0],
      subY + RHP.toeIn[1],
      zr + RHP.toeIn[2],
    );
    bodyPoint(_rIn.tr, sign * RHP.trIn[0], RHP.trIn[1], zr + RHP.trIn[2]);
  }

  function rearHubPoint(out, cm, loc, dxH, gam, tau, dzH = cm.dzH || 0) {
    return writePoint(out, rearHubCoords(cm, loc, dxH, gam, tau, dzH));
  }

  function rearGeom(cm, full) {
    rearInner(cm);
    const R = cm.rear;
    if (full) {
      const pose = solveRearPose(cm, _rIn, R, {
        upOut: RHP.upOut,
        camOut: RHP.camOut,
        trOut: RHP.trOut,
        toeOut: RHP.toeOut,
        splOut: RHP.splOut,
      });
      cm.dxH = pose.dxH;
      cm.camber = pose.camber;
      cm.dzH = pose.dzH;
      cm.toe = pose.toe;
      cm.wcX = cm.sc.cfg.x + cm.dxH;
      cm.wcZ = cm.sc.cfg.z + cm.dzH;
      cm.psi = cm.toe;
    }
    rearHubPoint(_mA, cm, RHP.splOut, cm.dxH, cm.camber, cm.toe, cm.dzH);
    const t = RHP.springSeatT,
      sign = cm.sign;
    _mB.set(
      _rIn.spl.x + (_mA.x - _rIn.spl.x) * t,
      _rIn.spl.y + (_mA.y - _rIn.spl.y) * t + 0.025,
      _rIn.spl.z + (_mA.z - _rIn.spl.z) * t,
    );
    bodyPoint(
      _mC,
      sign * RHP.springTopX,
      RHP.springTopY,
      cm.sc.cfg.z + RHP.springTopZ,
    );
    cm.springLen = _mB.distanceTo(_mC);
    cm.springBot = cm.springBot || new THREE.Vector3();
    cm.springTop = cm.springTop || new THREE.Vector3();
    cm.springBot.copy(_mB);
    cm.springTop.copy(_mC);

    /* Нижняя опора амортизатора живёт на пружинном рычаге (Federlenker),
     как на настоящем PQ35, а не на цапфе. _mA всё ещё держит splOut,
     поэтому проушину считаем по той же хорде рычага, что и чашку пружины.
     Заодно это даёт реальное передаточное отношение амортизатора (< 1). */
    const dSeatT = RHP.dmpSeatT;
    _mB.set(
      _rIn.spl.x + (_mA.x - _rIn.spl.x) * dSeatT,
      _rIn.spl.y + (_mA.y - _rIn.spl.y) * dSeatT + RHP.dmpSeatLift,
      _rIn.spl.z + (_mA.z - _rIn.spl.z) * dSeatT + RHP.dmpSeatAft,
    );
    bodyPoint(
      _mC,
      cm.sign * RHP.dmpTopX,
      RHP.dmpTopY,
      cm.sc.cfg.z + RHP.dmpTopZ,
    );
    cm.damperLen = _mB.distanceTo(_mC);
    cm.dmpBot = cm.dmpBot || new THREE.Vector3();
    cm.dmpTop = cm.dmpTop || new THREE.Vector3();
    cm.dmpBot.copy(_mB);
    cm.dmpTop.copy(_mC);
  }

  /* Передаточные отношения задних элементов — численно по ходу колеса */
  function rearRatios(cm) {
    const y0 = cm.wcY,
      s0 = cm.springLen,
      d0 = cm.damperLen;
    cm.wcY = y0 + 1e-3;
    rearGeom(cm, false);
    cm.springMR = (cm.springLen - s0) / 1e-3;
    cm.damperMR = (cm.damperLen - d0) / 1e-3;
    cm.wcY = y0;
    cm.springLen = s0;
    cm.damperLen = d0;
    if (!isFinite(cm.springMR) || Math.abs(cm.springMR) < 0.05)
      cm.springMR = -0.55;
    if (!isFinite(cm.damperMR) || Math.abs(cm.damperMR) < 0.05)
      cm.damperMR = -0.9;
  }

  /* ══ ИНИЦИАЛИЗАЦИЯ: длины тяг и свободные длины пружин из статики ══ */
  function initMech() {
    body.sag = 0;
    /* Длина рулевой тяги = расстояние рейка↔наконечник в нейтрали (жёсткая деталь) */
    mechF.forEach((cm) => {
      cm.psi = 0;
      frontGeom(cm, STATIC_WC_Y, 0, false);
      cm.tieRodLen = cm.geo.rackEnd.distanceTo(cm.geo.eye);
      cm.strutStatic = cm.strutLen;
      const wheelLoad = PHYS.mass * PHYS.g * PHYS.frontBias * 0.5;
      const need =
        (wheelLoad - cm.mU * PHYS.g) / Math.max(0.2, Math.abs(cm.strutMR));
      cm.strutFreeBase = cm.strutLen + need / PHYS.springF;
      cm.strutFree = cm.strutFreeBase;
    });
    /* Длины задних рычагов = их длины в проектном положении */
    mechR.forEach((cm) => {
      cm.dxH = 0;
      cm.dzH = 0;
      cm.camber = 0;
      cm.toe = 0;
      rearInner(cm);
      cm.rear.LU = rearHubPoint(_rOut, cm, RHP.upOut, 0, 0, 0).distanceTo(
        _rIn.up,
      );
      cm.rear.LC = rearHubPoint(_rOut, cm, RHP.camOut, 0, 0, 0).distanceTo(
        _rIn.cam,
      );
      cm.rear.LT = rearHubPoint(_rOut, cm, RHP.toeOut, 0, 0, 0).distanceTo(
        _rIn.toe,
      );
      cm.rear.LTR = rearHubPoint(_rOut, cm, RHP.trOut, 0, 0, 0).distanceTo(
        _rIn.tr,
      );
      cm.rear.LSPL = rearHubPoint(_rOut, cm, RHP.splOut, 0, 0, 0).distanceTo(
        _rIn.spl,
      );
      rearGeom(cm, true);
      rearRatios(cm);
      cm.springStatic = cm.springLen;
      const wheelLoad = PHYS.mass * PHYS.g * (1 - PHYS.frontBias) * 0.5;
      const need =
        (wheelLoad - cm.mU * PHYS.g) / Math.max(0.2, Math.abs(cm.springMR));
      cm.springFreeBase = cm.springLen + need / PHYS.springR;
      cm.springFree = cm.springFreeBase;
      cm.damperStatic = cm.damperLen;
    });
  }
  initMech();

  /* ── ТРАНСМИССИЯ ── */
  const DL = {
    engineOmega: (PHYS.idleRpm * Math.PI) / 30,
    sideOmega: [0, 0],
    shaftAngle: [0, 0],
    windup: [0, 0],
    carrierOmega: 0,
    crownAngle: 0,
    spiderAngle: 0,
    engineRpm: PHYS.idleRpm,
  };

  const vehicle = { vx: 0, ax: 0, accum: 0, simTime: 0, wheels: [] };

  const zAxisV = new THREE.Vector3(0, 0, 1);
  const _hsA = new THREE.Vector3(),
    _hsB = new THREE.Vector3();

  suspensionCorners.forEach((sc, i) => {
    const wa = wheelAssemblies[i];
    const w = {
      wa: wa,
      corner: sc,
      mech: sc.mech,
      isFront: sc.cfg.isFront,
      omega: 0,
      hubAngle: 0,
      rimAngle: 0,
      rimOmega: 0,
      slip: 0,
      fx: 0,
      fz: sc.mech.fz,
      driveTorque: 0,
      brakeTorque: 0,
      locked: false,
      spinning: false,
    };
    vehicle.wheels.push(w);
    if (wa) wa.phys = w;
    sc.phys = w;
  });

  /* Продольная сила шины (формула Пацейки, упрощённая) */
  function tireForceX(slip, fz, mu) {
    const B = 11,
      C = 1.86,
      E = 0.96;
    const x = clamp(slip, -1.2, 1.2);
    const inner = B * x;
    const f = Math.sin(C * Math.atan(inner - E * (inner - Math.atan(inner))));
    return f * mu * fz;
  }

  /* Высота опорной поверхности под каждым колесом, мм — это ВХОД в подвеску */
  function platformHeightMm(cm, t) {
    const sc = cm.sc;
    if (state.mode === "rig") {
      const omega = state.rigFreq * Math.PI * 2;
      const amp = state.rigAmp;
      let h = 0;
      if (state.rigMode === "sine") {
        h = Math.sin(t * omega + (sc.cfg.isFront ? 0 : -0.8)) * amp;
      } else if (state.rigMode === "diagonal") {
        h = (cm.idx === 0 || cm.idx === 3 ? 1 : -1) * Math.sin(t * omega) * amp;
      } else if (state.rigMode === "wave") {
        h =
          (Math.sin(t * omega + cm.idx * 1.5) * 0.6 +
            Math.sin(t * omega * 2.3 + cm.idx) * 0.4) *
          amp;
      }
      if (state.impulseTimer > 0) {
        h +=
          Math.sin(state.impulseTimer * Math.PI) *
          75 *
          (sc.cfg.isFront ? 1 : 0.4);
      }
      return h;
    }
    if (state.mode === "drag") return sc.targetTravelMm || 0;
    const v = Math.abs(vehicle.vx);
    if (v < 0.5) return 0;
    /* Мелкая неровность асфальта — подвеска работает и на ровной дороге */
    return (
      (Math.sin(t * 22 + cm.idx * 2.1) * 1.2 +
        Math.sin(t * 9.5 + cm.idx) * 0.8) *
      Math.min(1, v / 22)
    );
  }

  /* Быстрый расчёт сжатия стойки и передаточного отношения (без кватернионов) */
  function frontStrutLen(cm, wcY) {
    const sign = cm.sign,
      z = cm.sc.cfg.z;
    bodyPoint(_mA, sign * HP.armPivotX, HP.armPivotY + body.sag, z);
    bodyPoint(_mB, sign * HP.towerX, HP.towerY, z);
    const bjY = wcY - cm.wcOffY;
    const sinA = clamp((bjY - _mA.y) / HP.armLen, -0.86, 0.86);
    const cosA = Math.sqrt(1 - sinA * sinA);
    _mC.set(_mA.x + sign * HP.armLen * cosA, bjY, _mA.z);
    const axisLen = Math.max(0.2, _mB.distanceTo(_mC));
    _mD.subVectors(_mB, _mC).multiplyScalar(1 / axisLen);
    cm.strutMR = -(_mD.x * ((-sign * sinA) / cosA) + _mD.y);
    if (!isFinite(cm.strutMR) || Math.abs(cm.strutMR) < 0.15) cm.strutMR = -0.7;
    cm.strutLen = axisLen - BJ_CLAMP_LEN;
    return cm.strutLen;
  }

  /* ══ ВЕРТИКАЛЬНАЯ ДИНАМИКА: шина → неподрессоренная масса → пружина/
   амортизатор → кузов. Ход подвески — результат сил, а не генератора. ══ */
  function rideStep(dt) {
    const sagFloor = minSubframeSag(CHASSIS.frontSubframe.nominalY);
    const sagTarget = assemblyState.subframeBolted
      ? 0
      : Math.max(PHYS.subframeSag, sagFloor);
    body.sag += (sagTarget - body.sag) * Math.min(1, dt * 6);
    if (body.sag < sagFloor) body.sag = sagFloor;
    const rideOff = (state.rideHeightMm - 180) / 1000;
    const armsOk = assemblyState.armsBolted && assemblyState.balljointsBolted;
    const wheelsOk = assemblyState.wheelsBolted;

    let heaveF = -body.mS * PHYS.g;
    let rollT = body.mS * body.ay * CG_Y;
    let pitchT = body.mS * vehicle.ax * CG_Y;

    for (let i = 0; i < 4; i++) {
      const cm = suspensionCorners[i].mech;

      /* 1. ОПОРНАЯ ПОВЕРХНОСТЬ */
      const gY = platformHeightMm(cm, vehicle.simTime) / 1000;
      cm.groundV = (gY - cm.groundY) / dt;
      cm.groundY = gY;

      /* 2. ШИНА КАК ПРУЖИНА ПЯТНА КОНТАКТА */
      let fz = 0;
      const squash = cm.groundY + TIRE_RADIUS - cm.wcY;
      if (wheelsOk && squash > 0) {
        fz = PHYS.tireK * squash + PHYS.tireC * (cm.groundV - cm.wcV);
        if (fz < 0) fz = 0;
      }
      cm.fz = fz;

      /* 3. ПРУЖИНА + АМОРТИЗАТОР ПО ФАКТИЧЕСКОМУ СЖАТИЮ ЭЛЕМЕНТА */
      let fWheel = 0;
      const relV = cm.wcV - bodyPointVy(cm.wcX, cm.wcZ);
      if (cm.isF) {
        frontStrutLen(cm, cm.wcY);
        const mr = cm.strutMR;
        cm.strutFree = cm.strutFreeBase + rideOff / Math.max(0.3, Math.abs(mr));
        if (assemblyState.strutsBolted && armsOk) {
          cm.fSpring = Math.max(0, PHYS.springF * (cm.strutFree - cm.strutLen));
          cm.strutVel = mr * relV;
          cm.fDamp =
            -(cm.strutVel < 0 ? PHYS.dampBumpF : PHYS.dampRebF) * cm.strutVel;
          const minLen = cm.strutStatic - PHYS.bumpGap;
          cm.bumpHit = cm.strutLen < minLen ? minLen - cm.strutLen : 0;
          const fBump = PHYS.bumpK * cm.bumpHit * (1 + 15 * cm.bumpHit);
          fWheel = (cm.fSpring + cm.fDamp + fBump) * mr;
        } else {
          cm.fSpring = 0;
          cm.fDamp = 0;
          cm.bumpHit = 0;
          cm.strutVel = 0;
        }
      } else {
        rearGeom(cm, false);
        cm.springFree =
          cm.springFreeBase + rideOff / Math.max(0.3, Math.abs(cm.springMR));
        if (assemblyState.rearLinksBolted) {
          cm.fSpring = Math.max(
            0,
            PHYS.springR * (cm.springFree - cm.springLen),
          );
          cm.strutVel = cm.damperMR * relV;
          cm.fDamp =
            -(cm.strutVel < 0 ? PHYS.dampBumpR : PHYS.dampRebR) * cm.strutVel;
          const minLen = cm.springStatic - PHYS.bumpGap;
          cm.bumpHit = cm.springLen < minLen ? minLen - cm.springLen : 0;
          const fBump = PHYS.bumpK * cm.bumpHit * (1 + 15 * cm.bumpHit);
          fWheel = (cm.fSpring + fBump) * cm.springMR + cm.fDamp * cm.damperMR;
        } else {
          cm.fSpring = 0;
          cm.fDamp = 0;
          cm.bumpHit = 0;
          cm.strutVel = 0;
        }
      }

      /* 4. ОГРАНИЧИТЕЛЬ ХОДА ОТБОЯ */
      const droop = STATIC_WC_Y - PHYS.droopGap - cm.wcY;
      if (droop > 0) fWheel += 180000 * droop;

      cm.fStrut = fWheel;
      cm._fW = fWheel;
      cm._fArb = 0;
    }

    /* 5. СТАБИЛИЗАТОРЫ: торсион реально связывает левый и правый борт */
    for (let p = 0; p < 2; p++) {
      const a = suspensionCorners[p * 2].mech,
        b = suspensionCorners[p * 2 + 1].mech;
      const ok =
        p === 0 ? assemblyState.strutsBolted : assemblyState.rearLinksBolted;
      if (!ok) continue;
      const f = (p === 0 ? PHYS.arbF : PHYS.arbR) * (a.wcY - b.wcY) * 0.5;
      a._fArb -= f;
      b._fArb += f;
      rollT += f * a.wcX - f * b.wcX;
    }

    /* 6. ИНТЕГРИРОВАНИЕ: колёса, затем кузов */
    const bodyFloor = minBodyY();
    for (let i = 0; i < 4; i++) {
      const cm = suspensionCorners[i].mech;
      const aW = (cm.fz + cm._fW + cm._fArb - cm.mU * PHYS.g) / cm.mU;
      cm.wcV = clamp(cm.wcV + aW * dt, -7, 7);
      cm.wcY = clamp(cm.wcY + cm.wcV * dt, 0.08, 0.56);
      const contact = resolveVerticalContact(
        cm.wcY,
        cm.wcV,
        cm.groundY,
        cm.groundV,
        wheelsOk ? TIRE_RADIUS : KNUCKLE_REST_RADIUS,
        wheelsOk ? TIRE_MAX_SQUASH : 0,
      );
      cm.wcY = contact.y;
      cm.wcV = contact.v;
      cm.groundHit = contact.penetration;
      if (!isFinite(cm.wcY)) {
        cm.wcY = STATIC_WC_Y;
        cm.wcV = 0;
      }
      heaveF -= cm._fW;
      rollT -= cm._fW * cm.wcX;
      pitchT += cm._fW * (cm.wcZ - CG_Z);
    }

    body.vy = clamp(body.vy + (heaveF / body.mS) * dt, -5, 5);
    body.y = clamp(body.y + body.vy * dt, bodyFloor, 0.22);
    if (body.y <= bodyFloor && body.vy < 0) body.vy = 0;
    body.rollV = clamp((body.rollV + (rollT / body.Ixx) * dt) * 0.9995, -3, 3);
    body.roll = clamp(body.roll + body.rollV * dt, -0.15, 0.15);
    body.pitchV = clamp(
      (body.pitchV + (pitchT / body.Iyy) * dt) * 0.9995,
      -3,
      3,
    );
    body.pitch = clamp(body.pitch + body.pitchV * dt, -0.13, 0.13);
    if (!isFinite(body.y)) {
      body.y = 0;
      body.vy = 0;
    }
    if (!isFinite(body.roll)) {
      body.roll = 0;
      body.rollV = 0;
    }
    if (!isFinite(body.pitch)) {
      body.pitch = 0;
      body.pitchV = 0;
    }
  }

  /* ══ ТРАНСМИССИЯ И ПРОДОЛЬНАЯ ДИНАМИКА
   двигатель → КПП → главная пара → открытый дифференциал → полуось → колесо
   Колесо получает момент ТОЛЬКО через закрутку полуоси. ══ */
  function physicsStep(dt, throttle, brakePedal) {
    const driveOk = assemblyState.driveshaftsBolted;
    const wheelsOk = assemblyState.wheelsBolted;
    const totalRatio = GEAR_RATIO * PHYS.gearRatio;

    DL.carrierOmega = (DL.sideOmega[0] + DL.sideOmega[1]) * 0.5;
    DL.engineOmega = Math.max(
      (PHYS.idleRpm * Math.PI) / 30,
      Math.abs(DL.carrierOmega) * totalRatio,
    );
    DL.engineRpm = (DL.engineOmega * 30) / Math.PI;
    const rpmFactor = Math.max(
      0.15,
      1 - Math.pow(Math.min(1, DL.engineRpm / PHYS.redline), 2.5),
    );
    const engineT = throttle * PHYS.engineTorque * rpmFactor;
    /* Открытый дифференциал: момент делится поровну, обороты складываются */
    const sideT = engineT * totalRatio * PHYS.driveEff * 0.5;
    const Iside = 0.03 + PHYS.engineInertia * totalRatio * totalRatio * 0.5;

    for (let s = 0; s < 2; s++) {
      const w = vehicle.wheels[s];
      let hsT = 0;
      if (driveOk) {
        const twist = clamp(DL.shaftAngle[s] - w.hubAngle, -0.9, 0.9);
        DL.windup[s] = twist;
        hsT =
          PHYS.halfShaftK * twist +
          PHYS.halfShaftC * (DL.sideOmega[s] - w.omega);
      } else {
        DL.windup[s] = 0;
        DL.shaftAngle[s] = w.hubAngle;
      }
      w.driveTorque = hsT;
      DL.sideOmega[s] = clamp(
        DL.sideOmega[s] + ((sideT - hsT) / Iside) * dt,
        -400,
        400,
      );
      DL.shaftAngle[s] += DL.sideOmega[s] * dt;
    }
    DL.crownAngle += (DL.carrierOmega / GEAR_RATIO) * dt;
    DL.spiderAngle += (DL.sideOmega[0] - DL.sideOmega[1]) * 0.5 * dt;

    let sumFx = 0;
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const cm = w.mech;
      w.fz = cm.fz;
      const share = w.isFront ? PHYS.brakeBias : 1 - PHYS.brakeBias;
      w.brakeTorque = brakePedal * PHYS.brakeTorqueMax * share * 0.5;

      if (!wheelsOk || w.fz < 5) {
        w.fx = 0;
        w.slip = 0;
      } else {
        const contact = w.omega * TIRE_RADIUS;
        w.slip = (contact - vehicle.vx) / Math.max(1.2, Math.abs(vehicle.vx));
        w.fx = tireForceX(w.slip, w.fz, PHYS.muRoad);
        sumFx += w.fx;
      }

      let net = w.driveTorque - w.fx * TIRE_RADIUS;
      if (Math.abs(w.omega) > 0.05)
        net -= PHYS.bearingDrag * Math.sign(w.omega);
      /* Суппорт зажимает диск — момент против вращения, возможна блокировка */
      if (w.brakeTorque > 1) {
        if (Math.abs(w.omega) < 0.8 && Math.abs(net) < w.brakeTorque) {
          w.omega = 0;
          net = 0;
          w.locked = brakePedal > 0.05 && w.fz > 5;
        } else {
          net -= Math.sign(w.omega) * w.brakeTorque;
          w.locked = false;
        }
      } else {
        w.locked = false;
      }

      const I = wheelsOk ? PHYS.wheelInertia : PHYS.hubInertia;
      w.omega = clamp(w.omega + (net / I) * dt, -420, 420);
      w.hubAngle += w.omega * dt;
      if (wheelsOk) {
        w.rimOmega = w.omega;
        w.rimAngle = w.hubAngle;
      } else {
        w.rimOmega *= Math.pow(0.35, dt);
        w.rimAngle += w.rimOmega * dt;
      }
      w.spinning = w.slip > 0.16 && w.fz > 5;
    }

    const drag =
      0.5 * PHYS.airDensity * PHYS.dragCdA * vehicle.vx * Math.abs(vehicle.vx);
    const rr = vehicle.vx > 0.1 ? PHYS.rollResist * PHYS.mass * PHYS.g : 0;
    vehicle.ax = (sumFx - drag - rr) / PHYS.mass;
    vehicle.vx = Math.max(0, vehicle.vx + vehicle.ax * dt);
    if (!isFinite(vehicle.vx)) {
      vehicle.vx = 0;
      vehicle.ax = 0;
    }

    /* Боковое ускорение — от ФАКТИЧЕСКИХ углов поворота колёс → крен кузова */
    const steerAvg = (mechF[0].toe + mechF[1].toe) * 0.5;
    const ayRaw =
      (-vehicle.vx * vehicle.vx * Math.tan(steerAvg)) / PHYS.wheelbase;
    body.ay = clamp(ayRaw, -PHYS.muRoad * PHYS.g, PHYS.muRoad * PHYS.g);
  }

  function stepVehiclePhysics(deltaSec, throttle, brakePedal) {
    vehicle.accum += deltaSec;
    let guard = 0;
    while (vehicle.accum >= PHYS.step && guard < 40) {
      vehicle.accum -= PHYS.step;
      vehicle.simTime += PHYS.step;
      rideStep(PHYS.step);
      physicsStep(PHYS.step, throttle, brakePedal);
      guard++;
    }
    if (guard >= 40) vehicle.accum = 0;
    state.speedKmh = vehicle.vx * 3.6;
  }

  return {
    PHYS,
    HP,
    RHP,
    BJ_CLAMP_LEN,
    body,
    DL,
    vehicle,
    mechF,
    mechR,
    frontGeom,
    rearGeom,
    rearInner,
    rearHubPoint,
    rearRatios,
    rideStep,
    physicsStep,
    stepVehiclePhysics,
    GEAR_RATIO,
    TIRE_RADIUS,
    STATIC_WC_Y,
    CG_Y,
    CG_Z,
    _rIn,
    _rOut,
    _hsA,
    _hsB,
    zAxisV,
  };
}
