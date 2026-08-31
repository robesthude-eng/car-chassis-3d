export function createHardpoints(CHASSIS) {
  const HP = {
    armPivotX: CHASSIS.front.lowerPivotX,
    armPivotY: CHASSIS.front.lowerPivotY,
    armLen: 0.3533,
    towerX: CHASSIS.front.towerX,
    towerY: CHASSIS.front.towerY,
    rackHalf: 0.36,
    rackY: 0.18,
    rackZ: -1.25,
    rackStroke: 0.072,
    bjLocalX: -0.04,
    bjLocalY: -0.104,
    clampLocalX: -0.105,
    clampLocalY: 0.14,
    eyeLocalX: -0.025,
    eyeLocalY: -0.045,
    eyeLocalZ: 0.115,
    hubLocalX: -0.085,
  };

  const BJ_CLAMP_DX = HP.clampLocalX - HP.bjLocalX;
  const BJ_CLAMP_DY = HP.clampLocalY - HP.bjLocalY;
  const BJ_CLAMP_LEN = Math.sqrt(
    BJ_CLAMP_DX * BJ_CLAMP_DX + BJ_CLAMP_DY * BJ_CLAMP_DY,
  );

  const rearSubframeHP = CHASSIS.rearSubframe.hardpoints;
  const rearBodyHP = CHASSIS.rearBody;
  const RHP = {
    upIn: [
      rearSubframeHP.upperArm.x,
      rearSubframeHP.upperArm.y,
      rearSubframeHP.upperArm.z,
    ],
    upOut: [-0.08, 0.09, -0.05],
    splIn: [
      rearSubframeHP.springLink.x,
      rearSubframeHP.springLink.y,
      rearSubframeHP.springLink.z,
    ],
    splOut: [-0.09, -0.11, 0.02],
    camIn: [
      rearSubframeHP.camberLink.x,
      rearSubframeHP.camberLink.y,
      rearSubframeHP.camberLink.z,
    ],
    camOut: [-0.08, -0.06, 0.14],
    toeIn: [
      rearSubframeHP.toeLink.x,
      rearSubframeHP.toeLink.y,
      rearSubframeHP.toeLink.z,
    ],
    toeOut: [-0.12, 0.01, 0.21],
    trIn: [
      rearBodyHP.trailingArm.x,
      rearBodyHP.trailingArm.y,
      rearBodyHP.trailingArm.z,
    ],
    trOut: [-0.05, -0.04, -0.17],
    springSeatT: 0.62,
    springTopX: rearBodyHP.springTop.x,
    springTopY: rearBodyHP.springTop.y,
    springTopZ: rearBodyHP.springTop.z,
    dmpBot: [-0.035, -0.05, 0.11],
    dmpTopX: rearBodyHP.damperTop.x,
    dmpTopY: rearBodyHP.damperTop.y,
    dmpTopZ: rearBodyHP.damperTop.z,
  };

  return { HP, RHP, BJ_CLAMP_DX, BJ_CLAMP_DY, BJ_CLAMP_LEN };
}
