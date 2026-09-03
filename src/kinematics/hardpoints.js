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
  const rearCarrierHP = CHASSIS.rearCarrier;
  const rearDamperHP = CHASSIS.rearDamperMount;
  const RHP = {
    upIn: [
      rearSubframeHP.upperArm.x,
      rearSubframeHP.upperArm.y,
      rearSubframeHP.upperArm.z,
    ],
    upOut: rearCarrierHP.upOut,
    splIn: [
      rearSubframeHP.springLink.x,
      rearSubframeHP.springLink.y,
      rearSubframeHP.springLink.z,
    ],
    splOut: rearCarrierHP.splOut,
    camIn: [
      rearSubframeHP.camberLink.x,
      rearSubframeHP.camberLink.y,
      rearSubframeHP.camberLink.z,
    ],
    camOut: rearCarrierHP.camOut,
    toeIn: [
      rearSubframeHP.toeLink.x,
      rearSubframeHP.toeLink.y,
      rearSubframeHP.toeLink.z,
    ],
    toeOut: rearCarrierHP.toeOut,
    trIn: [
      rearBodyHP.trailingArm.x,
      rearBodyHP.trailingArm.y,
      rearBodyHP.trailingArm.z,
    ],
    trOut: rearCarrierHP.trOut,
    springSeatT: 0.72,
    springTopX: rearBodyHP.springTop.x,
    springTopY: rearBodyHP.springTop.y,
    springTopZ: rearBodyHP.springTop.z,
    dmpSeatT: rearDamperHP.seatT,
    dmpSeatLift: rearDamperHP.lift,
    dmpSeatAft: rearDamperHP.aft,
    dmpTopX: rearBodyHP.damperTop.x,
    dmpTopY: rearBodyHP.damperTop.y,
    dmpTopZ: rearBodyHP.damperTop.z,
  };

  return { HP, RHP, BJ_CLAMP_DX, BJ_CLAMP_DY, BJ_CLAMP_LEN };
}
