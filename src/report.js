const CORNER_NAMES = ["FL", "FR", "RL", "RR"];

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export function buildDiagnosticReport({
  state,
  assemblyState,
  suspensionCorners,
  drivetrain,
  boltSpecs,
  generatedAt = new Date(),
}) {
  const assembly = boltSpecs.map((spec) => ({
    step: spec.step,
    id: spec.id,
    name: spec.short,
    part: spec.part,
    bolts: spec.bolts,
    torque: spec.torque,
    installed: Boolean(assemblyState[spec.key]),
  }));

  const missingAssemblies = assembly.filter((item) => !item.installed);
  const warnings = missingAssemblies.map(
    (item) => `Не установлен узел: ${item.name}`,
  );
  if (Math.abs(state.speedKmh) > 1 && missingAssemblies.length > 0) {
    warnings.unshift("Движение моделируется при неполной сборке шасси.");
  }

  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    application: {
      name: "3D Шасси VW Scirocco",
      version: "2.2.0",
    },
    vehicle: {
      model: "Volkswagen Scirocco III",
      platform: "PQ35",
      drivetrain: "FWD",
    },
    simulation: {
      mode: state.mode,
      speedKmh: round(state.speedKmh, 1),
      targetSpeedKmh: round(state.targetSpeedKmh, 1),
      engineRpm: Math.round(drivetrain.engineRpm || 0),
      driveshaftRpm: Math.round(state.driveshaftRpm || 0),
      steeringDeg: round(state.steerAngleDeg, 1),
      rideHeightMm: Math.round(state.rideHeightMm),
      rig: {
        mode: state.rigMode,
        frequencyHz: round(state.rigFreq, 1),
        amplitudeMm: Math.round(state.rigAmp),
      },
    },
    suspension: suspensionCorners.map((corner, index) => ({
      corner: CORNER_NAMES[index] || `corner-${index + 1}`,
      travelMm: Math.round(corner.travelMm || 0),
      camberDeg: round((-(corner.camberRad || 0) * 180) / Math.PI, 2),
      toeDeg: round(((corner.steerAngleRad || 0) * 180) / Math.PI, 2),
      wheelRpm: Math.round(corner.wheelRpm || 0),
      wheelSlip: round(corner.wheelSlip || 0, 3),
    })),
    assembly: {
      completedSteps: assembly.length - missingAssemblies.length,
      totalSteps: assembly.length,
      strictOrder: Boolean(state.strictOrder),
      items: assembly,
    },
    warnings,
    disclaimer:
      "Учебная модель. Перед ремонтом сверяйте данные с документацией по VIN.",
  };
}

export function downloadDiagnosticReport(report) {
  const payload = JSON.stringify(report, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  link.href = url;
  link.download = `scirocco-pq35-diagnostic-${timestamp}.json`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
