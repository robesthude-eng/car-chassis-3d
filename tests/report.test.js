import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticReport } from "../src/report.js";

const boltSpecs = [
  {
    step: 1,
    id: "subframe",
    key: "subframeBolted",
    short: "Подрамник",
    part: "1K0",
    bolts: "4x M14",
    torque: "110 Н·м + 90°",
  },
  {
    step: 2,
    id: "wheels",
    key: "wheelsBolted",
    short: "Колёса",
    part: "5x112",
    bolts: "5x M14",
    torque: "120 Н·м",
  },
];

const state = {
  mode: "dyno",
  speedKmh: 62.47,
  targetSpeedKmh: 60,
  driveshaftRpm: 1234.6,
  steerAngleDeg: -4.26,
  rideHeightMm: 180,
  rigMode: "sine",
  rigFreq: 2,
  rigAmp: 40,
  strictOrder: true,
};

const suspensionCorners = Array.from({ length: 4 }, (_, index) => ({
  travelMm: index * 10.4,
  camberRad: -0.02,
  steerAngleRad: 0.01,
  wheelRpm: 410.8,
  wheelSlip: 0.01234,
}));

test("buildDiagnosticReport creates a stable, rounded report", () => {
  const report = buildDiagnosticReport({
    state,
    assemblyState: { subframeBolted: true, wheelsBolted: true },
    suspensionCorners,
    drivetrain: { engineRpm: 3188.7 },
    boltSpecs,
    generatedAt: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(report.generatedAt, "2026-08-31T12:00:00.000Z");
  assert.equal(report.simulation.speedKmh, 62.5);
  assert.equal(report.simulation.engineRpm, 3189);
  assert.equal(report.suspension[0].corner, "FL");
  assert.equal(report.suspension[0].camberDeg, 1.15);
  assert.equal(report.assembly.completedSteps, 2);
  assert.deepEqual(report.warnings, []);
});

test("buildDiagnosticReport warns about incomplete assembly in motion", () => {
  const report = buildDiagnosticReport({
    state,
    assemblyState: { subframeBolted: false, wheelsBolted: true },
    suspensionCorners,
    drivetrain: { engineRpm: 1800 },
    boltSpecs,
    generatedAt: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(report.assembly.completedSteps, 1);
  assert.match(report.warnings[0], /неполной сборке/i);
  assert.match(report.warnings[1], /Подрамник/);
});
