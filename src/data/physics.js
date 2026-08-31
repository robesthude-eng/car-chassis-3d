export const GEAR_RATIO = 3.73;
export const TIRE_RADIUS = 0.32;
export const CG_Y = 0.52;
export const CG_Z = -0.318;
export const STATIC_WC_Y = 0.32;

export function createPhysicsConstants(lowEnd) {
  return {
    mass: 1350,
    wheelbase: 2.578,
    cgHeight: 0.52,
    frontBias: 0.61,
    wheelInertia: 1.3,
    hubInertia: 0.055,
    rollResist: 0.013,
    dragCdA: 0.68,
    airDensity: 1.225,
    g: 9.81,
    muRoad: 1.05,
    step: lowEnd ? 1 / 180 : 1 / 240,
    engineTorque: 280,
    engineInertia: 0.26,
    idleRpm: 850,
    redline: 6800,
    gearRatio: 1.55,
    driveEff: 0.93,
    halfShaftK: 5200,
    halfShaftC: 16,
    brakeTorqueMax: 2600,
    brakeBias: 0.66,
    bearingDrag: 1.1,
    springF: 31000,
    springR: 26000,
    dampBumpF: 2150,
    dampRebF: 3950,
    dampBumpR: 1850,
    dampRebR: 3350,
    arbF: 24000,
    arbR: 15000,
    unsprungF: 41,
    unsprungR: 38,
    tireK: 245000,
    tireC: 520,
    bumpK: 420000,
    bumpGap: 0.058,
    droopGap: 0.085,
    subframeSag: -0.14,
  };
}
