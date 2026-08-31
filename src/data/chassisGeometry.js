const point = (x, y, z) => Object.freeze({ x, y, z });

const rearSubframeHardpoints = Object.freeze({
  upperArm: point(0.26, 0.21, -0.07),
  springLink: point(0.21, -0.01, 0.03),
  camberLink: point(0.24, 0.05, 0.17),
  toeLink: point(0.19, 0.13, 0.24),
});

const rearBodyHardpoints = Object.freeze({
  trailingArm: point(0.6, 0.3, -0.54),
  springTop: point(0.48, 0.6, 0.015),
  damperTop: point(0.63, 0.78, 0.11),
});

export const CHASSIS_GEOMETRY = Object.freeze({
  frontAxleZ: -1.3,
  rearAxleZ: 1.3,
  mainRailX: 0.45,
  sillRailX: 0.66,
  front: Object.freeze({
    lowerPivotX: 0.4,
    lowerPivotY: 0.12,
    towerX: 0.6,
    towerY: 0.86,
  }),
  frontSubframe: Object.freeze({
    nominalY: 0.12,
  }),
  rearSubframe: Object.freeze({
    nominalY: 0.12,
    hardpoints: rearSubframeHardpoints,
    bodyMounts: Object.freeze([
      point(0.45, 0.04, -0.18),
      point(0.45, 0.04, 0.18),
    ]),
  }),
  rearBody: rearBodyHardpoints,
});

export function mirrorHardpoint(pointValue, sign, origin = {}) {
  const { x = 0, y = 0, z = 0 } = origin;
  return Object.freeze({
    x: x + sign * pointValue.x,
    y: y + pointValue.y,
    z: z + pointValue.z,
  });
}

export function rearSubframeWorldPoint(name, sign) {
  const hardpoint = rearSubframeHardpoints[name];
  if (!hardpoint) throw new RangeError(`Unknown rear subframe point: ${name}`);
  return mirrorHardpoint(hardpoint, sign, {
    y: CHASSIS_GEOMETRY.rearSubframe.nominalY,
    z: CHASSIS_GEOMETRY.rearAxleZ,
  });
}

export function rearBodyWorldPoint(name, sign) {
  const hardpoint = rearBodyHardpoints[name];
  if (!hardpoint) throw new RangeError(`Unknown rear body point: ${name}`);
  return mirrorHardpoint(hardpoint, sign, {
    z: CHASSIS_GEOMETRY.rearAxleZ,
  });
}
