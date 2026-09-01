import * as THREE from "three";
import { VehiclePhysics, VEHICLE_SPEC } from "./vehiclePhysics.js";
import { world, LapTimer, TRACK, centerline, centerlineTangent, formatTime } from "./track.js";
import { buildTrackMesh, buildCar, createLighting } from "./scene.js";
import { InputController } from "./input.js";

const canvas = document.getElementById("scene");
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 2 : 2.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb6d4);
createLighting(scene);
scene.add(buildTrackMesh());

const car = buildCar();
scene.add(car.root);

const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 900);
const camState = { pos: new THREE.Vector3(0, 5, -12), look: new THREE.Vector3() };
let cameraMode = 0; // 0 погоня, 1 капот, 2 борт
const CAMERA_NAMES = ["Погоня", "Капот", "Борт"];

const physics = new VehiclePhysics(VEHICLE_SPEC);
const lap = new LapTimer(3);
const input = new InputController();

// стартовая позиция на осевой линии
function placeAtStart() {
  const p = centerline(0.002);
  const tan = centerlineTangent(0.002);
  physics.reset(p.x, p.z, Math.atan2(tan.x, tan.z));
  lap.reset();
}
placeAtStart();
input.onReset = placeAtStart;

const hud = {
  speed: document.getElementById("hud-speed"),
  gear: document.getElementById("hud-gear"),
  rpm: document.getElementById("hud-rpm"),
  rpmBar: document.getElementById("hud-rpm-bar"),
  lap: document.getElementById("hud-lap"),
  lapTime: document.getElementById("hud-lap-time"),
  bestLap: document.getElementById("hud-best"),
  lastLap: document.getElementById("hud-last"),
  gforce: document.getElementById("hud-gforce"),
  grip: document.getElementById("hud-grip"),
  surface: document.getElementById("hud-surface"),
  camera: document.getElementById("hud-camera"),
  assist: document.getElementById("hud-assist"),
};

input.bindTouchControls(document.getElementById("touch-controls"));

document.getElementById("btn-camera")?.addEventListener("click", () => {
  cameraMode = (cameraMode + 1) % 3;
  if (hud.camera) hud.camera.textContent = CAMERA_NAMES[cameraMode];
});
document.getElementById("btn-reset")?.addEventListener("click", placeAtStart);
document.getElementById("btn-tilt")?.addEventListener("click", async (e) => {
  if (input.tilt.enabled) {
    input.disableTilt();
    e.currentTarget.classList.remove("is-active");
    e.currentTarget.textContent = "Гироскоп";
  } else if (await input.enableTilt()) {
    input.calibrateTilt();
    e.currentTarget.classList.add("is-active");
    e.currentTarget.textContent = "Гироскоп вкл";
  }
});
document.getElementById("btn-assist")?.addEventListener("click", (e) => {
  const a = physics.assists;
  const on = !(a.abs && a.tcs);
  a.abs = a.tcs = a.esc = on;
  e.currentTarget.classList.toggle("is-active", on);
  if (hud.assist) hud.assist.textContent = on ? "ABS·TCS вкл" : "Ассистенты выкл";
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 120));
resize();

/** Обновление визуала подвески по реальному ходу из физики. */
function syncSuspension(snap) {
  for (let i = 0; i < 4; i += 1) {
    const w = snap.wheels[i];
    const view = car.wheels[i];
    const rest = i < 2 ? 0.317 : 0.317;
    view.hub.position.y = rest - w.compression;
    view.hub.rotation.y = w.steer;
    view.wheel.rotation.x = w.spin;
    view.wheel.rotation.z = w.camber;

    // пружина: меняем длину навивки, а не толщину прутка
    const travel = i < 2 ? VEHICLE_SPEC.travelFront : VEHICLE_SPEC.travelRear;
    const ratio = 1 - (w.compression / travel) * 0.42;
    car.springs[i].scale.y = 0.34 * Math.max(0.5, ratio);
    car.dampers[i].scale.y = Math.max(0.55, ratio);
    car.dampers[i].position.y = 0.6 - w.compression * 0.5;
  }
}

function updateCamera(dt, snap) {
  const h = physics.heading;
  const sh = Math.sin(h);
  const ch = Math.cos(h);
  const p = physics.position;
  const speedK = Math.min(1, physics.speedKph / 190);

  let target;
  let look;
  if (cameraMode === 0) {
    const dist = 7.4 + speedK * 3.2;
    const height = 3.1 + speedK * 0.7;
    target = new THREE.Vector3(p.x - sh * dist, p.y + height, p.z - ch * dist);
    look = new THREE.Vector3(p.x + sh * 7, p.y + 0.85, p.z + ch * 7);
  } else if (cameraMode === 1) {
    target = new THREE.Vector3(p.x + sh * 0.55, p.y + 0.86, p.z + ch * 0.55);
    look = new THREE.Vector3(p.x + sh * 24, p.y + 0.9, p.z + ch * 24);
  } else {
    target = new THREE.Vector3(p.x - ch * 8.5, p.y + 2.4, p.z + sh * 8.5);
    look = new THREE.Vector3(p.x, p.y + 0.7, p.z);
  }

  const k = cameraMode === 1 ? 1 : Math.min(1, dt * 7);
  camState.pos.lerp(target, k);
  camState.look.lerp(look, Math.min(1, dt * 9));
  camera.position.copy(camState.pos);
  camera.up.set(Math.sin(snap.roll) * 0.35, 1, 0);
  camera.lookAt(camState.look);
}

let hudTimer = 0;
function updateHud(dt, snap, near) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.08;

  const gearNames = ["R", "N", "1", "2", "3", "4", "5", "6"];
  if (hud.speed) hud.speed.textContent = Math.round(snap.speedKph);
  if (hud.gear) hud.gear.textContent = gearNames[snap.gear] ?? "N";
  if (hud.rpm) hud.rpm.textContent = Math.round(snap.rpm);
  if (hud.rpmBar) {
    const pct = Math.min(100, (snap.rpm / 7000) * 100);
    hud.rpmBar.style.width = `${pct}%`;
    hud.rpmBar.style.background =
      snap.rpm > 6400 ? "#ff4b3e" : snap.rpm > 5200 ? "#ffb02e" : "#4ad0a0";
  }
  if (hud.lap) hud.lap.textContent = `${Math.min(lap.lap + 1, TRACK.laps)} / ${TRACK.laps}`;
  if (hud.lapTime) hud.lapTime.textContent = formatTime(lap.lapTime);
  if (hud.bestLap) hud.bestLap.textContent = formatTime(lap.bestLap);
  if (hud.lastLap) hud.lastLap.textContent = formatTime(lap.lastLap);
  if (hud.gforce) {
    hud.gforce.textContent = `${snap.lateralG.toFixed(2)}g / ${snap.longitudinalG.toFixed(2)}g`;
  }
  if (hud.grip) {
    const worst = Math.max(...snap.wheels.map((w) => w.saturation));
    hud.grip.textContent = `${Math.round(Math.min(worst, 1.6) * 100)}%`;
    hud.grip.style.color = worst > 1 ? "#ff5a4d" : worst > 0.85 ? "#ffb02e" : "#4ad0a0";
  }
  if (hud.surface) {
    const kind = world.surfaceKind(physics.position.x, physics.position.z);
    hud.surface.textContent =
      { asphalt: "Асфальт", kerb: "Поребрик", gravel: "Гравий", grass: "Трава" }[kind];
    hud.surface.style.color = kind === "asphalt" ? "#cfd6e2" : "#ffb02e";
  }
}

const FIXED = 1 / 120;
let accumulator = 0;
let last = performance.now();
let running = true;

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  last = performance.now();
});

function frame(now) {
  requestAnimationFrame(frame);
  if (!running) return;

  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  accumulator += dt;

  const cmd = input.sample();
  let steps = 0;
  while (accumulator >= FIXED && steps < 8) {
    physics.step(FIXED, cmd, world);
    accumulator -= FIXED;
    steps += 1;
  }

  const snap = physics.snapshot();
  const near = world.nearestOnTrack(physics.position.x, physics.position.z, 96);
  lap.update(dt, near.t);

  car.root.position.set(physics.position.x, physics.position.y - 0.32, physics.position.z);
  car.root.rotation.set(0, physics.heading, 0);
  car.chassis.rotation.set(snap.pitch, 0, snap.roll);

  syncSuspension(snap);
  updateCamera(dt, snap);
  updateHud(dt, snap, near);

  renderer.render(scene, camera);
}

document.getElementById("loading")?.remove();
requestAnimationFrame(frame);
