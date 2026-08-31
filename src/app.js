import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ChassisAudioEngine } from "./audio/ChassisAudioEngine.js";
import { BOLT_SPECS } from "./data/boltSpecs.js";
import { CHASSIS_GEOMETRY } from "./data/chassisGeometry.js";
import { buildDiagnosticReport, downloadDiagnosticReport } from "./report.js";
import { clamp, triggerHaptic, showToast, nextFrame } from "./utils.js";
import { createBoot } from "./boot.js";
import { createTextureGenerators } from "./textures.js";
import { createSceneMaterials } from "./materials.js";
import { buildVehicle } from "./geometry/vehicle.js";
import { createKinematicsEngine } from "./kinematics/engine.js";
import { droppedWheelLocalOffset, limitArmSag } from "./kinematics/contacts.js";

const audio = new ChassisAudioEngine();

function unlockAudio() {
  void audio.resume();
  window.removeEventListener("touchstart", unlockAudio);
  window.removeEventListener("pointerdown", unlockAudio);
}
window.addEventListener("touchstart", unlockAudio, { passive: true });
window.addEventListener("pointerdown", unlockAudio, { passive: true });

const { bootProgress, bootDone, bootFail } = createBoot();

async function bootstrapScene() {
  const container = document.getElementById("canvas-container");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181f);
  scene.fog = new THREE.FogExp2(0x2b3038, 0.03);

  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth < 768;

  /* ─── Профиль производительности: слабый телефон получает меньше полигонов и пикселей ─── */
  const _cores = navigator.hardwareConcurrency || 4;
  const _ram =
    typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 4;
  const LOW_END = isMobile && (_cores <= 4 || _ram <= 3);
  /* SEG(десктоп, мобильный) — число сегментов у тел вращения */
  const SEG = (hi, lo) =>
    LOW_END ? Math.max(6, Math.round(lo * 0.75)) : isMobile ? lo : hi;
  const MAX_DPR = LOW_END ? 1.1 : isMobile ? 1.4 : 1.75;
  let _dprScale = 1;
  function applyDpr() {
    renderer.setPixelRatio(
      Math.max(0.6, Math.min(window.devicePixelRatio, MAX_DPR) * _dprScale),
    );
  }

  const camera = new THREE.PerspectiveCamera(
    isMobile ? 50 : 45,
    window.innerWidth / window.innerHeight,
    0.05,
    50,
  );
  camera.position.set(
    isMobile ? 3.0 : 2.8,
    isMobile ? 1.9 : 1.8,
    isMobile ? 3.6 : 3.4,
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: !LOW_END && (!isMobile || window.devicePixelRatio < 2),
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyDpr();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  /* ─── Студийная HDR-среда (IBL): честные отражения на металле ─── */
  const _pmrem = new THREE.PMREMGenerator(renderer);
  const _envScene = new THREE.Scene();
  const _envBox = new THREE.BoxGeometry(1, 1, 1);
  const _envPanel = (hex, intensity, sx, sy, sz, px, py, pz) => {
    const mesh = new THREE.Mesh(
      _envBox,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(px, py, pz);
    _envScene.add(mesh);
  };
  _envScene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(16, 8, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x20262e),
        side: THREE.BackSide,
      }),
    ),
  );
  _envPanel(0xffffff, 8.0, 7.5, 0.12, 3.2, 0, 3.7, 0.8);
  _envPanel(0xffffff, 5.0, 3.2, 0.12, 6.5, -2.4, 3.7, -1.2);
  _envPanel(0xdae8ff, 3.4, 0.12, 3.0, 7.0, -7.2, 2.4, 0);
  _envPanel(0xffe6c8, 2.2, 0.12, 2.6, 6.0, 7.2, 2.2, 0);
  _envPanel(0xc7d8f2, 1.4, 6.0, 2.4, 0.12, 0, 2.2, -7.2);
  _envPanel(0x6b7480, 0.7, 16, 0.12, 16, 0, -1.2, 0);
  const _envRT = _pmrem.fromScene(_envScene, 0.03);
  scene.environment = _envRT.texture;
  scene.background = _envRT.texture;
  scene.backgroundBlurriness = 0.9;
  scene.backgroundIntensity = 0.17;
  if ("environmentIntensity" in scene) scene.environmentIntensity = 1.0;
  _pmrem.dispose();
  const _environmentResources = new Set();
  _envScene.traverse((object) => {
    if (object.geometry) _environmentResources.add(object.geometry);
    if (Array.isArray(object.material))
      object.material.forEach((material) =>
        _environmentResources.add(material),
      );
    else if (object.material) _environmentResources.add(object.material);
  });
  _environmentResources.forEach((resource) => resource.dispose());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2 + 0.08;
  controls.minDistance = 0.6;
  controls.maxDistance = 8.0;
  controls.target.set(0, 0.3, 0);
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  /* Освещение поста: мягкий заполняющий + ключевой софтбокс + контровой */
  const ambientLight = new THREE.AmbientLight(0xd8e2f0, 0.18);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xaec4dd, 0x2b2724, 0.45);
  scene.add(hemiLight);

  const dirLight1 = new THREE.DirectionalLight(0xfff2e0, 2.6);
  dirLight1.position.set(3.4, 5.2, 2.6);
  dirLight1.castShadow = true;
  const _shadowRes = LOW_END ? 512 : isMobile ? 1024 : 2048;
  dirLight1.shadow.mapSize.width = _shadowRes;
  dirLight1.shadow.mapSize.height = _shadowRes;
  dirLight1.shadow.camera.near = 0.5;
  dirLight1.shadow.camera.far = 14;
  dirLight1.shadow.camera.left = -2.6;
  dirLight1.shadow.camera.right = 2.6;
  dirLight1.shadow.camera.top = 2.6;
  dirLight1.shadow.camera.bottom = -2.6;
  dirLight1.shadow.bias = -0.00035;
  dirLight1.shadow.normalBias = 0.015;
  dirLight1.shadow.radius = 3;
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xbfd6f5, 0.75);
  dirLight2.position.set(-4.2, 2.6, -2.4);
  scene.add(dirLight2);

  const rimLight = new THREE.DirectionalLight(0xffd9b0, 0.85);
  rimLight.position.set(-1.5, 1.4, -5.0);
  scene.add(rimLight);

  const underLight = new THREE.DirectionalLight(0x8f9aa8, 0.22);
  underLight.position.set(0, -3, 0);
  scene.add(underLight);

  bootProgress(8, "Текстуры: бетон цеха");
  await nextFrame();

  bootProgress(8, "Текстуры: бетон цеха");
  await nextFrame();

  const maps = createTextureGenerators({ renderer });
  const _floorTex = maps.floorMaps();
  const gridHelper = new THREE.GridHelper(20, 20, 0x2f3a45, 0x252c34);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.22;
  gridHelper.material.depthWrite = false;
  gridHelper.position.y = 0.0015;
  scene.add(gridHelper);

  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({
    map: _floorTex.color,
    roughnessMap: _floorTex.rough,
    normalMap: _floorTex.normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: 0xb6bcc4,
    roughness: 0.95,
    metalness: 0.05,
    envMapIntensity: 0.45,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  bootProgress(14, "Процедурные PBR-текстуры");
  await nextFrame();

  const materials = createSceneMaterials(maps);

  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  const chassisFrameGroup = new THREE.Group();
  rootGroup.add(chassisFrameGroup);

  const frontSubframeGroup = new THREE.Group();
  rootGroup.add(frontSubframeGroup);

  const rearSubframeGroup = new THREE.Group();
  rootGroup.add(rearSubframeGroup);

  const drivetrainGroup = new THREE.Group();
  rootGroup.add(drivetrainGroup);

  const suspensionGroup = new THREE.Group();
  rootGroup.add(suspensionGroup);

  const steeringGroup = new THREE.Group();
  rootGroup.add(steeringGroup);

  const wheelsGroup = new THREE.Group();
  rootGroup.add(wheelsGroup);

  const rigPlatformsGroup = new THREE.Group();
  scene.add(rigPlatformsGroup);

  const CHASSIS = CHASSIS_GEOMETRY;

  const {
    assemblyState,
    frontSubframeMeshGroup,
    rearSubframeMeshGroup,
    frontSwayAssembly,
    steeringRackBar,
    leftTieRodAssembly,
    rightTieRodAssembly,
    steeringColumnShaft,
    steeringRackBoots,
    suspensionCorners,
    wheelAssemblies,
    gearboxAssembly,
    diffGroup,
    diffCrownGear,
    spiderGroup,
    leftHalfShaftGroup,
    rightHalfShaftGroup,
    rigPads,
    aimRod,
    aimGroup,
    P,
  } = await buildVehicle({
    THREE,
    materials,
    SEG,
    CHASSIS,
    chassisFrameGroup,
    frontSubframeGroup,
    rearSubframeGroup,
    drivetrainGroup,
    suspensionGroup,
    steeringGroup,
    wheelsGroup,
    rigPlatformsGroup,
    bootProgress,
    nextFrame,
    isMobile,
  });

  /* 8. 3D FLOATING LABELS */
  const pinsContainer = document.getElementById("pins-container");
  const labelPoints = [
    {
      title: "Подрамник PQ35 · 1K0199369F",
      pos: new THREE.Vector3(0, 0.09, -1.34),
    },
    {
      title: "Алюм. консоль сайлентблока · 1K0199231",
      pos: new THREE.Vector3(-0.42, 0.12, -1.48),
    },
    {
      title: "L-рычаг · 1K0407151",
      pos: new THREE.Vector3(-0.55, 0.11, -1.22),
    },
    {
      title: "3-болтовая шаровая · 1K0407365",
      pos: new THREE.Vector3(-0.72, 0.13, -1.3),
    },
    {
      title: "Стойка Макферсон Ø55 · 1K0413031",
      pos: new THREE.Vector3(-0.5, 0.56, -1.3),
    },
    {
      title: "Поворотный кулак · 1K0407255",
      pos: new THREE.Vector3(-0.78, 0.38, -1.36),
    },
    {
      title: "Ступица 5x112 · 1T0498621",
      pos: new THREE.Vector3(-0.8, 0.29, -1.23),
    },
    {
      title: "Тормозной диск 340x30",
      pos: new THREE.Vector3(-0.7, 0.46, -1.3),
    },
    {
      title: "Рулевая рейка · 1K1423055",
      pos: new THREE.Vector3(0.14, 0.18, -1.25),
    },
    {
      title: "Наконечник рулев��й тяги · 1K0423811",
      pos: new THREE.Vector3(-0.6, 0.19, -1.15),
    },
    {
      title: "КПП поперёк + главная пара 3.73",
      pos: new THREE.Vector3(0.14, 0.33, -1.4),
    },
    {
      title: "Дифференциал и выходной фланец",
      pos: new THREE.Vector3(-0.21, 0.19, -1.46),
    },
    {
      title: "Приводной вал со ШРУСами",
      pos: new THREE.Vector3(-0.45, 0.28, -1.36),
    },
    {
      title: "Продольный рычаг многорычажки",
      pos: new THREE.Vector3(-0.68, 0.27, 0.92),
    },
    {
      title: "Развальный рычаг + тяга сходимости",
      pos: new THREE.Vector3(-0.45, 0.19, 1.45),
    },
    {
      title: "Пружина на нижнем рычаге",
      pos: new THREE.Vector3(-0.52, 0.42, 1.31),
    },
    {
      title: "Задний амортизатор (без пружины)",
      pos: new THREE.Vector3(-0.7, 0.64, 1.41),
    },
    {
      title: "Задний ступичный узел · 1T0598611",
      pos: new THREE.Vector3(-0.8, 0.33, 1.3),
    },
  ];

  labelPoints.forEach((lp) => {
    const div = document.createElement("div");
    const dot = document.createElement("span");
    const label = document.createElement("span");
    div.className = "pin-label";
    dot.className = "pin-dot";
    label.textContent = lp.title;
    div.append(dot, label);
    pinsContainer.appendChild(div);
    lp.element = div;
    lp.shown = false;
    lp.w = 0;
  });

  /* ─── РАСКЛАДКА 3D-ВЫНОСОК БЕЗ ПЕРЕКРЫТИЙ ───
   Метки сортируются по удалённости от камеры: ближняя ставится на место, остальные
   поднимаются вверх с поводком, пока не перестанут накладываться друг на друга. */
  const _labelV = new THREE.Vector3();
  const _labelBoxes = [];
  const _labelVisible = [];
  let _labelFrame = 0;

  function layoutLabels() {
    if (!state.showLabels) return;

    _labelFrame++;
    /* На слабом телефоне пересчитываем раскладку через кадр — экономим на reflow */
    if (LOW_END && _labelFrame & 1) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const halfW = vw / 2;
    const halfH = vh / 2;

    _labelVisible.length = 0;

    for (let i = 0; i < labelPoints.length; i++) {
      const lp = labelPoints[i];
      _labelV.copy(lp.pos);
      const dist = camera.position.distanceTo(_labelV);
      _labelV.project(camera);

      const x = _labelV.x * halfW + halfW;
      const y = -(_labelV.y * halfH) + halfH;
      const visible =
        _labelV.z < 1 &&
        dist < 7.0 &&
        x > -60 &&
        x < vw + 60 &&
        y > -30 &&
        y < vh + 30;

      if (!visible) {
        if (lp.shown) {
          lp.element.style.display = "none";
          lp.shown = false;
        }
        continue;
      }

      lp.sx = x;
      lp.sy = y;
      lp.dist = dist;
      _labelVisible.push(lp);
    }

    _labelVisible.sort((a, b) => a.dist - b.dist);
    _labelBoxes.length = 0;

    const LH = 20;
    const GAP = 4;

    for (let i = 0; i < _labelVisible.length; i++) {
      const lp = _labelVisible[i];
      if (!lp.shown) {
        lp.element.style.display = "flex";
        lp.shown = true;
      }
      /* Ширина текста не меняется — замеряем один раз и кэшируем */
      if (!lp.w) lp.w = lp.element.offsetWidth || 0;
      const w = lp.w || 150;

      let lift = 0;
      for (let tries = 0; tries < 8; tries++) {
        const top = lp.sy - lift - LH;
        const left = lp.sx - w / 2;
        let hit = false;
        for (let b = 0; b < _labelBoxes.length; b++) {
          const box = _labelBoxes[b];
          if (
            left < box.r &&
            left + w > box.l &&
            top < box.b &&
            top + LH > box.t
          ) {
            hit = true;
            break;
          }
        }
        if (!hit) break;
        lift += LH + GAP;
      }

      _labelBoxes.push({
        l: lp.sx - w / 2,
        r: lp.sx + w / 2,
        t: lp.sy - lift - LH,
        b: lp.sy - lift,
      });

      const st = lp.element.style;
      st.left = lp.sx + "px";
      st.top = lp.sy + "px";
      st.setProperty("--lift", -lift + "px");
      st.setProperty("--leader", lift + "px");
      st.zIndex = String(2000 - Math.round(lp.dist * 100));
      const isFar = lp.dist > 5;
      if (lp.far !== isFar) {
        lp.far = isFar;
        lp.element.classList.toggle("pin-far", lp.far);
      }
    }
  }

  /* SIMULATION STATE & KINEMATICS ENGINE */
  const state = {
    mode: "dyno",
    speedKmh: 0,
    targetSpeedKmh: 0,
    driveshaftRpm: 0,
    steerAngleDeg: 0,
    targetSteerAngleDeg: 0,
    rideHeightMm: 180,
    rigMode: "sine",
    rigFreq: 2.0,
    rigAmp: 40,
    impulseTimer: 0,
    isCutaway: false,
    isXRay: false,
    isColorCoded: false,
    showLabels: false,
    touchGas: false,
    touchBrake: false,
    touchSteerL: false,
    touchSteerR: false,
    stopRequested: false,
  };

  const {
    HP,
    RHP,
    body,
    DL,
    mechF,
    mechR,
    frontGeom,
    rearGeom,
    rearInner,
    rearHubPoint,
    rearRatios,
    stepVehiclePhysics,
    STATIC_WC_Y,
    _rIn,
    _rOut,
    _hsA,
    _hsB,
    zAxisV,
  } = createKinematicsEngine({
    THREE,
    CHASSIS,
    assemblyState,
    suspensionCorners,
    wheelAssemblies,
    LOW_END,
    state,
  });

  const keys = { w: false, s: false, a: false, d: false };
  const drivingKeys = new Set([
    "w",
    "s",
    "a",
    "d",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
  ]);

  function isFormControl(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    );
  }

  function updateDrivingKey(e, pressed) {
    const k = e.key.toLowerCase();
    if (!drivingKeys.has(k) || isFormControl(e.target)) return;
    e.preventDefault();
    if (k === "w" || k === "arrowup") keys.w = pressed;
    if (k === "s" || k === "arrowdown") keys.s = pressed;
    if (k === "a" || k === "arrowleft") keys.a = pressed;
    if (k === "d" || k === "arrowright") keys.d = pressed;
  }

  window.addEventListener("keydown", (e) => updateDrivingKey(e, true));
  window.addEventListener("keyup", (e) => updateDrivingKey(e, false));
  window.addEventListener("blur", () => {
    Object.keys(keys).forEach((key) => {
      keys[key] = false;
    });
    state.touchGas = false;
    state.touchBrake = false;
    state.touchSteerL = false;
    state.touchSteerR = false;
    document
      .querySelectorAll(".touch-drive-btn.pressed")
      .forEach((button) => button.classList.remove("pressed"));
  });

  let lastTime = performance.now();
  let lastHudUpdate = 0;
  const upVec = new THREE.Vector3(0, 1, 0);
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const qSteer = new THREE.Quaternion();

  function updateSimulation(time, deltaSec) {
    const isGasActive = keys.w || state.touchGas;
    const isBrakeActive = keys.s || state.touchBrake;
    const isSteerL = keys.a || state.touchSteerL;
    const isSteerR = keys.d || state.touchSteerR;

    if (isGasActive) state.stopRequested = false;

    if (state.mode === "dyno") {
      if (isSteerL)
        state.targetSteerAngleDeg = Math.max(
          -35,
          state.targetSteerAngleDeg - 55 * deltaSec,
        );
      if (isSteerR)
        state.targetSteerAngleDeg = Math.min(
          35,
          state.targetSteerAngleDeg + 55 * deltaSec,
        );
      if (!isSteerL && !isSteerR && Math.abs(state.targetSteerAngleDeg) > 0.1) {
        state.targetSteerAngleDeg *= Math.pow(0.08, deltaSec);
      }
      if (document.activeElement !== sliderSteer) {
        sliderSteer.value = state.targetSteerAngleDeg.toFixed(1);
        valSteer.textContent = state.targetSteerAngleDeg.toFixed(1) + "°";
        sliderSteer.setAttribute(
          "aria-valuetext",
          state.targetSteerAngleDeg.toFixed(1) + " градуса",
        );
      }
    }

    const pedalRate = deltaSec * 4.5;
    state.throttle = Math.max(
      0,
      Math.min(
        1,
        (state.throttle || 0) + (isGasActive ? pedalRate : -pedalRate * 2),
      ),
    );
    state.brakePedal = Math.max(
      0,
      Math.min(
        1,
        (state.brakePedal || 0) +
          (isBrakeActive ? pedalRate * 1.6 : -pedalRate * 3),
      ),
    );

    // Ползунок ск��рости теперь круиз-контроль: он давит на педали, а не двигает машину
    if (!isGasActive && !isBrakeActive && state.targetSpeedKmh > 0.5) {
      const cruiseErr = state.targetSpeedKmh - state.speedKmh;
      state.throttle = Math.max(0, Math.min(1, cruiseErr * 0.06));
      state.brakePedal = cruiseErr < -3 ? Math.min(1, -cruiseErr * 0.03) : 0;
    }

    if (state.stopRequested && !isGasActive) {
      state.throttle = 0;
      state.brakePedal = Math.abs(state.speedKmh) > 0.5 ? 1 : 0;
      if (Math.abs(state.speedKmh) <= 0.5) state.stopRequested = false;
    }

    stepVehiclePhysics(deltaSec, state.throttle, state.brakePedal);
    state.steerAngleDeg +=
      (state.targetSteerAngleDeg - state.steerAngleDeg) *
      Math.min(1.0, deltaSec * 10);

    /* Обороты берутся из САМОЙ трансмиссии, а не из скорости машины */
    const gearboxOutRpm = (DL.carrierOmega * 60) / (Math.PI * 2);
    state.driveshaftRpm = gearboxOutRpm;
    state.engineRpm = DL.engineRpm;

    const isDriveEngaged = assemblyState.driveshaftsBolted;
    const hasWheelDrive = isDriveEngaged && assemblyState.wheelsBolted;

    audio.setSpeed(state.speedKmh, state.driveshaftRpm, hasWheelDrive);

    /* ══ 1. КУЗОВ НА ПОДВЕСКЕ: высота, крен и клевок — результат работы
     пружин и амортизаторов, а не положение ползунка ══ */
    const chassisBaseY = body.y;
    const targetSubframeSag = body.sag;
    chassisFrameGroup.position.y = chassisBaseY;
    chassisFrameGroup.rotation.z = body.roll;
    chassisFrameGroup.rotation.x = body.pitch;

    frontSubframeMeshGroup.position.y =
      CHASSIS.frontSubframe.nominalY + chassisBaseY + targetSubframeSag;
    rearSubframeMeshGroup.position.y =
      CHASSIS.rearSubframe.nominalY + chassisBaseY + targetSubframeSag;
    frontSubframeGroup.rotation.z = body.roll;
    frontSubframeGroup.rotation.x = body.pitch;
    rearSubframeGroup.rotation.z = body.roll;
    rearSubframeGroup.rotation.x = body.pitch;

    /* КПП и редуктор висят на опорах подрамника */
    gearboxAssembly.currentSagY = targetSubframeSag;
    const gearboxY =
      gearboxAssembly.baseY + chassisBaseY + gearboxAssembly.currentSagY;
    const gearboxTilt = body.roll + (assemblyState.subframeBolted ? 0 : -0.05);
    gearboxAssembly.gearboxGroup.position.y = gearboxY;
    gearboxAssembly.gearboxGroup.rotation.z = gearboxTilt;
    diffGroup.position.y = gearboxY;
    diffGroup.rotation.z = gearboxTilt;

    /* ══ 2. РУЛЕВАЯ РЕЙКА: шток ходит влево-вправо на реальные ±72 мм ══ */
    const rackX = -clamp(state.steerAngleDeg / 35, -1, 1) * HP.rackStroke;
    steeringGroup.position.y = chassisBaseY + targetSubframeSag;
    steeringGroup.rotation.z = body.roll;
    steeringGroup.rotation.x = body.pitch;
    steeringGroup.updateMatrixWorld(true);
    if (steeringRackBar) steeringRackBar.position.x = rackX;
    if (steeringColumnShaft)
      steeringColumnShaft.rotation.y = 0.2 + (rackX / HP.rackStroke) * 1.8;

    /* ══ 3. КИНЕМАТИКА КАЖДОГО УГЛА: все детали ставятся ПО РЕШЕНИЮ
     геометрии, а не по подогнанным формулам ══ */
    const frontArmsOk =
      assemblyState.armsBolted && assemblyState.balljointsBolted;

    suspensionCorners.forEach((sc, idx) => {
      const cm = sc.mech;
      const sign = cm.sign;
      const g = cm.geo;
      cm.rackX = rackX;

      if (cm.isF) {
        /* Решаем: рычаг → шаровая → ось поворота → рейка/тяга → уг��л цапфы */
        frontGeom(cm, cm.wcY, rackX, true);

        /* Нижний рычаг 1K0407151: качается вокруг своих сайлентблоков */
        sc.lowerArmPivot.position.copy(g.pivot);
        const armSagTarget = frontArmsOk ? 0 : -sign * 0.08;
        sc.armSagZ += (armSagTarget - sc.armSagZ) * Math.min(1, deltaSec * 6);
        sc.armSagZ = limitArmSag(
          sc.armSagZ,
          sign,
          g.armAngle,
          g.pivot.y,
          HP.armLen,
          cm.groundY + 0.04,
        );
        sc.armData.armGroup.rotation.z = sign * g.armAngle + sc.armSagZ;

        /* Цапфа 1K0407255: поворачивается вокруг оси «шаровая → верхняя опора» */
        sc.knuckleGroup.position.copy(g.wc);
        sc.knuckleGroup.quaternion.copy(g.q);
        if (!frontArmsOk) {
          qSteer.setFromAxisAngle(zAxisV, sign * 0.2);
          sc.knuckleGroup.quaternion.premultiply(qSteer);
        }

        /* Стойка 1K0413031: стоит в хомуте цапфы, ось совпадает с осью поворота.
         Влево-вправо она НЕ качается — только проворачивается вокруг себя
         вместе с цапфой (для этого и стоит верхний опорный подшипник 1K0412331) */
        const st = sc.strutAssembly;
        st.strutGroup.position.copy(g.clamp);
        qTilt.setFromUnitVectors(upVec, g.axis);
        qSteer.setFromAxisAngle(upVec, cm.psi);
        st.strutGroup.quaternion.multiplyQuaternions(qTilt, qSteer);
        st.topMount.position.y = cm.strutLen;
        /* Пружина сжата ровно на то, на сколько сжалась стойка */
        st.springMesh.scale.y = clamp((cm.strutLen - 0.22) / 0.32, 0.4, 1.25);
        st.pistonRod.position.y = Math.max(0.14, cm.strutLen - 0.17);

        /* Верхняя опора: внутреннее кольцо и тарелка пружины едут со штоком */
        st.bearingInner.position.y = cm.strutLen - 0.025;
        st.upperSeat.position.y = cm.strutLen - 0.075;
        /* Наружная обойма стоит в стакане: наклон оси есть, поворота НЕТ */
        st.bearingOuter.position.copy(
          P(13, 0, cm.strutLen - 0.025, 0)
            .applyQuaternion(qTilt)
            .add(g.clamp),
        );
        st.bearingOuter.quaternion.copy(qTilt);

        /* Отбойник сжимается ровно на bumpHit, пыльник — на открытую часть штока */
        const bsLen = Math.max(0.026, 0.075 - cm.bumpHit * 0.75);
        const rodTopY = cm.strutLen - 0.05;
        st.bumpStop.scale.y = bsLen / 0.075;
        st.bumpStop.position.y = rodTopY - bsLen * 0.5;
        const bootLen = Math.max(0.03, rodTopY - bsLen - 0.17);
        st.dustBoot.scale.y = bootLen / 0.18;
        st.dustBoot.position.y = 0.17 + bootLen * 0.5;

        /* ═══ СТАБИЛИЗАТОР: стойка тянет плечо штанги ═══
         Длина стойки постоянна, поэтому угол плеча решается в замкнутой форме
         из пересечения окружности плеча со сферой длины стойки. */
        if (frontSwayAssembly) {
          const fsa = frontSwayAssembly;
          fsa.group.position.y = chassisBaseY + targetSubframeSag;
          const brk = P(15, 0, 0.06, sign * 0.045)
            .applyQuaternion(st.strutGroup.quaternion)
            .add(g.clamp);
          const pX = sign * fsa.armX;
          const pY = fsa.barY + chassisBaseY;
          const pZ = fsa.barZ;
          const dX = brk.x - pX,
            dY = brk.y - pY,
            dZ = brk.z - pZ;
          const dd = dX * dX + dY * dY + dZ * dZ;
          const hyp = Math.sqrt(dY * dY + dZ * dZ) || 1e-4;
          const cTerm =
            (dd + fsa.armR * fsa.armR - fsa.linkLen * fsa.linkLen) /
            (2 * fsa.armR);
          const th = Math.atan2(dY, -dZ) - Math.acos(clamp(cTerm / hyp, -1, 1));
          fsa.arms[cm.idx].rotation.x = th;
          fsa.theta[cm.idx] = th;
          const armEnd = P(
            14,
            pX,
            pY + fsa.armR * Math.sin(th),
            pZ - fsa.armR * Math.cos(th),
          );
          aimRod(fsa.links[cm.idx], armEnd, brk, fsa.linkLen);
          if (cm.idx === 1) {
            fsa.barGroup.rotation.x = (fsa.theta[0] + fsa.theta[1]) * 0.5;
            state.arbTwistDeg = ((fsa.theta[0] - fsa.theta[1]) * 180) / Math.PI;
          }
        }

        /* Пыльники рейки: один сжимается, другой растягивается — как на машине */
        if (cm.idx === 0 && steeringRackBoots.length === 2) {
          const gapL = Math.max(0.018, 0.09 - rackX);
          const gapR = Math.max(0.018, 0.09 + rackX);
          steeringRackBoots[0].scale.y = gapL / 0.12;
          steeringRackBoots[0].position.x = -0.315 + rackX * 0.5;
          steeringRackBoots[1].scale.y = gapR / 0.12;
          steeringRackBoots[1].position.x = 0.315 + rackX * 0.5;
        }

        /* Рулевая тяга с наконечником 1K0423811: жёсткая деталь между шарниром
         рейки и рулевым рычагом цапфы — именно она тянет колесо */
        const tra = sign < 0 ? leftTieRodAssembly : rightTieRodAssembly;
        if (tra) {
          steeringGroup.worldToLocal(tempVecA.copy(g.rackEnd));
          steeringGroup.worldToLocal(tempVecB.copy(g.eye));
          tra.innerJoint.position.copy(tempVecA);
          tra.outerEnd.position.copy(tempVecB);
          tra.castleNut.position.set(tempVecB.x, tempVecB.y - 0.03, tempVecB.z);
          const dxT = tempVecB.x - tempVecA.x;
          const dyT = tempVecB.y - tempVecA.y;
          const dzT = tempVecB.z - tempVecA.z;
          const dLenT = Math.max(
            0.001,
            Math.sqrt(dxT * dxT + dyT * dyT + dzT * dzT),
          );
          tra.rod.position.set(
            tempVecA.x + dxT * 0.5,
            tempVecA.y + dyT * 0.5,
            tempVecA.z + dzT * 0.5,
          );
          tra.rod.rotation.set(
            0,
            Math.atan2(dzT, -dxT),
            Math.acos(clamp(dyT / dLenT, -1, 1)),
          );
          tra.rod.scale.y = dLenT / 0.36;
          tra.group.visible = assemblyState.steeringBolted;
        }
      } else {
        /* ══ ЗАДНЯЯ МНОГОРЫЧАЖКА PQ35: развал и сходимость решаются из
         постоянства длин рычагов, а не задаются коэффициентом ══ */
        rearGeom(cm, true);
        rearRatios(cm);
        const rl = sc.rearLinks;
        const tau = cm.toe;

        rearInner(cm);
        const upInner = P(0, _rIn.up.x, _rIn.up.y, _rIn.up.z);
        const splInner = P(2, _rIn.spl.x, _rIn.spl.y, _rIn.spl.z);
        const camInner = P(4, _rIn.cam.x, _rIn.cam.y, _rIn.cam.z);
        const toeInner = P(6, _rIn.toe.x, _rIn.toe.y, _rIn.toe.z);
        const trInner = P(8, _rIn.tr.x, _rIn.tr.y, _rIn.tr.z);

        rearHubPoint(_rOut, cm, RHP.upOut, cm.dxH, cm.camber, tau);
        const upOuter = P(1, _rOut.x, _rOut.y, _rOut.z);
        rearHubPoint(_rOut, cm, RHP.splOut, cm.dxH, cm.camber, tau);
        const splOuter = P(3, _rOut.x, _rOut.y, _rOut.z);
        rearHubPoint(_rOut, cm, RHP.camOut, cm.dxH, cm.camber, tau);
        const camOuter = P(5, _rOut.x, _rOut.y, _rOut.z);
        rearHubPoint(_rOut, cm, RHP.toeOut, cm.dxH, cm.camber, tau);
        const toeOuter = P(7, _rOut.x, _rOut.y, _rOut.z);
        rearHubPoint(_rOut, cm, RHP.trOut, cm.dxH, cm.camber, tau);
        const trOuter = P(9, _rOut.x, _rOut.y, _rOut.z);

        aimRod(rl.upperArm.mesh, upInner, upOuter, rl.upperArm.base);
        aimRod(rl.springLink.mesh, splInner, splOuter, rl.springLink.base);
        aimRod(rl.camberLink.mesh, camInner, camOuter, rl.camberLink.base);
        aimRod(rl.toeLink.mesh, toeInner, toeOuter, rl.toeLink.base);
        aimRod(rl.trailingArm.mesh, trInner, trOuter, rl.trailingArm.base);

        rl.bushes[0].position.copy(upInner);
        rl.bushes[1].position.copy(splInner);
        rl.bushes[2].position.copy(camInner);
        rl.bushes[3].position.copy(toeInner);
        rl.bushes[4].position.copy(trInner);
        rl.toeCam.position.copy(toeInner);

        /* Пружина стоит на рычаге (Federlenker) — её длина и есть та, что в расчёте */
        const springLenVis = aimGroup(
          rl.springGroup,
          cm.springBot,
          cm.springTop,
        );
        rl.springMesh.scale.set(1.0, Math.max(0.45, springLenVis / 0.36), 1.0);
        rl.springTopSeat.position.y = springLenVis;

        const dmpLenVis = aimGroup(rl.damperGroup, cm.dmpBot, cm.dmpTop);
        rl.pistonRod.position.y = Math.max(0.2, dmpLenVis - 0.14);
        rl.damperTopMount.position.y = dmpLenVis;

        sc.knuckleGroup.position.set(cm.wcX, cm.wcY, cm.wcZ);
        sc.knuckleGroup.rotation.set(0, cm.toe, cm.camber);
        sc.toeRad = cm.toe;
      }

      sc.travelMm = (cm.wcY - STATIC_WC_Y) * 1000;
      sc.steerAngleRad = cm.toe;
      sc.camberRad = cm.camber;

      /* Площадка стенда — то, что возбуждает шину */
      const pad = rigPads[idx];
      if (pad) pad.rigGroup.position.y = cm.groundY;
    });

    if (state.impulseTimer > 0) {
      state.impulseTimer = Math.max(0, state.impulseTimer - deltaSec * 3);
    }

    /* ══ 4. ПРИВОД: коронная шестерня и сателлиты дифференциала ══ */
    if (diffCrownGear) diffCrownGear.rotation.z = DL.crownAngle;
    if (typeof spiderGroup !== "undefined" && spiderGroup)
      spiderGroup.rotation.y = DL.spiderAngle;

    /* ══ 5. ПОЛУОСИ: идут от фланца редуктора в ступицу и крутятся на свой
     СОБСТВЕННЫЙ угол — колесо отстаёт на угол закрутки вала ══ */
    function updateHalfShaft3D(assembly, corner, sideIdx) {
      if (!assembly || !corner) return;
      const sign = assembly.isLeft ? -1 : 1;
      const isBolted = assemblyState.driveshaftsBolted;
      const cm = corner.mech;

      _hsA.set(
        sign * 0.17,
        gearboxAssembly.baseY + chassisBaseY + gearboxAssembly.currentSagY,
        gearboxAssembly.baseZ,
      );
      assembly.pivotGroup.position.copy(_hsA);

      if (isBolted) _hsB.copy(cm.geo.hubIn);
      else _hsB.set(sign * 0.4, 0.07, gearboxAssembly.baseZ + 0.05);

      _hsB.sub(_hsA);
      const shaftDist = Math.max(0.2, _hsB.length());
      _hsB.multiplyScalar(1 / shaftDist);
      assembly.pivotGroup.quaternion.setFromUnitVectors(upVec, _hsB);
      assembly.shaftRod.scale.set(
        1.0,
        Math.max(0.25, (shaftDist - 0.14) / 0.5),
        1.0,
      );
      assembly.shaftRod.position.y = shaftDist * 0.5;
      assembly.outerBoot.position.y = shaftDist - 0.075;
      if (assembly.outerJoint)
        assembly.outerJoint.position.y = shaftDist - 0.012;
      if (assembly.axleNut) assembly.axleNut.position.y = shaftDist + 0.035;
      if (assembly.supportBearing)
        assembly.supportBearing.position.y = shaftDist * 0.56;

      assembly.rotationAngle = DL.shaftAngle[sideIdx];
      assembly.rotatingShaftGroup.rotation.y = assembly.rotationAngle;
    }

    updateHalfShaft3D(leftHalfShaftGroup, suspensionCorners[0], 0);
    updateHalfShaft3D(rightHalfShaftGroup, suspensionCorners[1], 1);

    /* ══ 6. КОЛЁСА И ТОРМОЗА: ступица и диск крутятся от полуоси,
     колесо — от ступицы на колёсных болтах ══ */
    wheelAssemblies.forEach((wa) => {
      const sc = wa.corner;
      const cm = sc.mech;
      const wp = wa.phys;
      const isWheelBolted = assemblyState.wheelsBolted;

      const wheelOff = droppedWheelLocalOffset({
        wcY: cm.wcY,
        sign: cm.sign,
        groundY: cm.groundY,
        bolted: isWheelBolted,
      });
      if (wa.wheelOffX == null) wa.wheelOffX = 0;
      if (wa.wheelOffY == null) wa.wheelOffY = 0;
      wa.wheelOffX += (wheelOff.x - wa.wheelOffX) * Math.min(1, deltaSec * 10);
      wa.wheelOffY += (wheelOff.y - wa.wheelOffY) * Math.min(1, deltaSec * 10);

      wa.wheelGroup.position.set(cm.wcX, cm.wcY, cm.wcZ);
      if (cm.isF) {
        wa.wheelGroup.quaternion.copy(cm.geo.q);
        if (!frontArmsOk) {
          qSteer.setFromAxisAngle(zAxisV, cm.sign * 0.2);
          wa.wheelGroup.quaternion.premultiply(qSteer);
        }
      } else {
        wa.wheelGroup.rotation.set(0, cm.toe, cm.camber);
      }
      wa.hubAndDiscGroup.position.y = 0;
      wa.rotatingWheelGroup.position.set(
        wa.wheelOffX || 0,
        wa.wheelOffY || 0,
        0,
      );

      const rpmNow = wp ? (Math.abs(wp.omega) * 60) / (Math.PI * 2) : 0;
      sc.wheelRpm = rpmNow;
      sc.wheelSlip = wp ? wp.slip : 0;

      if (wp) {
        sc.wheelAngle = wp.rimAngle;
        wa.hubAndDiscGroup.rotation.x = wp.hubAngle;
        wa.discMesh.rotation.x = 0;
        wa.rotatingWheelGroup.rotation.x = wp.rimAngle;
      }

      if (isBrakeActive && rpmNow > 100) {
        wa.discMesh.material.emissive.setHex(0xff3300);
        wa.discMesh.material.emissiveIntensity = THREE.MathUtils.clamp(
          rpmNow / 800,
          0,
          1.5,
        );
      } else {
        wa.discMesh.material.emissiveIntensity *= Math.pow(0.05, deltaSec);
      }
    });

    // 7. 3D-ВЫНОСКИ (разводятся по вертикали, не накладываясь)
    layoutLabels();

    if (time - lastHudUpdate >= 100) {
      lastHudUpdate = time;
      updateTelemetryHUD();
    }
  }

  /* Telemetry HUD Updates */
  const hudSpeed = document.getElementById("hud-speed");
  const hudRpm = document.getElementById("hud-rpm");
  const hudAttitude = document.getElementById("hud-attitude");
  const hudRoll = document.getElementById("hud-roll");
  const hudPitch = document.getElementById("hud-pitch");
  const hudAckermann = document.getElementById("hud-ackermann");
  const travelFL = document.getElementById("travel-fl");
  const travelFR = document.getElementById("travel-fr");
  const travelRL = document.getElementById("travel-rl");
  const travelRR = document.getElementById("travel-rr");
  const barFL = document.getElementById("bar-fl");
  const barFR = document.getElementById("bar-fr");
  const barRL = document.getElementById("bar-rl");
  const barRR = document.getElementById("bar-rr");
  const statusSubframe = document.getElementById("status-subframe");
  const statusConsoles = document.getElementById("status-consoles");
  const statusBalljoints = document.getElementById("status-balljoints");
  const statusStruts = document.getElementById("status-struts");
  const statusKnuckles = document.getElementById("status-knuckles");
  const statusSteering = document.getElementById("status-steering");
  const statusDriveshafts = document.getElementById("status-driveshafts");
  const statusRearlinks = document.getElementById("status-rearlinks");
  const statusTorque = document.getElementById("status-torque");

  function updateTelemetryHUD() {
    hudSpeed.textContent = Math.round(state.speedKmh) + " км/ч";
    hudRpm.textContent = Math.round(DL.engineRpm) + " RPM";
    const rollDeg = (body.roll * 180) / Math.PI;
    const pitchDeg = (body.pitch * 180) / Math.PI;
    const ackermann = ((mechF[0].toe - mechF[1].toe) * 180) / Math.PI;
    if (hudAttitude) {
      hudAttitude.textContent =
        (rollDeg >= 0 ? "+" : "") +
        rollDeg.toFixed(1) +
        "° / " +
        (pitchDeg >= 0 ? "+" : "") +
        pitchDeg.toFixed(1) +
        "°";
    }
    if (hudRoll)
      hudRoll.textContent =
        (rollDeg >= 0 ? "+" : "") + rollDeg.toFixed(1) + "°";
    if (hudPitch)
      hudPitch.textContent =
        (pitchDeg >= 0 ? "+" : "") + pitchDeg.toFixed(1) + "°";
    if (hudAckermann)
      hudAckermann.textContent =
        (ackermann >= 0 ? "+" : "") + ackermann.toFixed(2) + "°";

    function setBar(bar, valMm) {
      if (!bar) return;
      const norm = THREE.MathUtils.clamp((valMm + 70) / 160, 0, 1) * 100;
      bar.style.left = (valMm < 0 ? norm : 50) + "%";
      bar.style.width = Math.abs(norm - 50) + "%";
      bar.style.background = valMm >= 0 ? "#38bdf8" : "#f43f5e";
    }

    const els = [travelFL, travelFR, travelRL, travelRR];
    const bars = [barFL, barFR, barRL, barRR];
    for (let i = 0; i < 4; i++) {
      const sc = suspensionCorners[i];
      if (!sc || !sc.mech || !els[i]) continue;
      const cm = sc.mech;
      const mm = Math.round((cm.wcY - STATIC_WC_Y) * 1000);
      /* Знак как в развал-стенде: минус = верх колеса завален внутрь */
      const camb = (-cm.camber * 180) / Math.PI;
      els[i].textContent =
        (mm >= 0 ? "+" : "") +
        mm +
        " мм · " +
        (camb >= 0 ? "+" : "") +
        camb.toFixed(1) +
        "°";
      setBar(bars[i], mm);
    }

    if (statusSubframe) {
      statusSubframe.textContent = assemblyState.subframeBolted
        ? "4x M14 ЗАТЯНУТЫ"
        : "УПАЛ (БЕЗ БОЛТОВ)";
      statusSubframe.className =
        "chain-status " + (assemblyState.subframeBolted ? "ok" : "off");
    }
    if (statusConsoles) {
      statusConsoles.textContent = assemblyState.armsBolted
        ? "1K0199231 OK"
        : "СНЯТЫ";
      statusConsoles.className =
        "chain-status " + (assemblyState.armsBolted ? "ok" : "off");
    }
    if (statusBalljoints) {
      statusBalljoints.textContent = assemblyState.balljointsBolted
        ? "3 БОЛТА OK"
        : "ОТСОЕДИНЕНЫ";
      statusBalljoints.className =
        "chain-status " + (assemblyState.balljointsBolted ? "ok" : "off");
    }
    if (statusStruts) {
      const fkN = (mechF[0].fSpring + mechF[1].fSpring) * 0.001;
      statusStruts.textContent = assemblyState.strutsBolted
        ? "ПРУЖИНЫ " + fkN.toFixed(1) + " кН"
        : "УПАЛИ (БЕЗ ГАЕК)";
      statusStruts.className =
        "chain-status " + (assemblyState.strutsBolted ? "ok" : "off");
    }
    if (statusKnuckles) {
      const isOk =
        assemblyState.armsBolted &&
        assemblyState.strutsBolted &&
        assemblyState.balljointsBolted;
      const cL = (-mechF[0].camber * 180) / Math.PI;
      const cR = (-mechF[1].camber * 180) / Math.PI;
      statusKnuckles.textContent = isOk
        ? "РАЗВАЛ " + cL.toFixed(1) + "° / " + cR.toFixed(1) + "°"
        : "РАЗРЫВ ПОДВЕСКИ";
      statusKnuckles.className = "chain-status " + (isOk ? "ok" : "off");
    }
    if (statusSteering) {
      const aL = (mechF[0].toe * 180) / Math.PI;
      const aR = (mechF[1].toe * 180) / Math.PI;
      statusSteering.textContent = assemblyState.steeringBolted
        ? "Л " +
          aL.toFixed(1) +
          "° · П " +
          aR.toFixed(1) +
          "° · РЕЙКА " +
          Math.round(
            -clamp(state.steerAngleDeg / 35, -1, 1) * HP.rackStroke * 1000,
          ) +
          "мм"
        : "ТЯГИ ОТСОЕДИНЕНЫ";
      statusSteering.className =
        "chain-status " + (assemblyState.steeringBolted ? "ok" : "off");
    }
    if (statusDriveshafts) {
      const dsOk = assemblyState.driveshaftsBolted;
      const twistDeg =
        ((Math.abs(DL.windup[0]) + Math.abs(DL.windup[1])) * 0.5 * 180) /
        Math.PI;
      statusDriveshafts.textContent = dsOk
        ? assemblyState.wheelsBolted
          ? "ВАЛ КРУТИТ КОЛЕСО · СКРУТКА " + twistDeg.toFixed(1) + "°"
          : "ШРУС OK · КОЛЕСА СНЯТЫ"
        : "ВАЛЫ СНЯТЫ · МОМЕНТА НЕТ";
      statusDriveshafts.className = "chain-status " + (dsOk ? "ok" : "off");
    }
    if (statusRearlinks) {
      const tR = ((mechR[0].toe - mechR[1].toe) * 0.5 * 180) / Math.PI;
      statusRearlinks.textContent = assemblyState.rearLinksBolted
        ? "4 РЫЧАГА · СХОД " + tR.toFixed(2) + "°"
        : "РЫЧАГИ СНЯТЫ";
      statusRearlinks.className =
        "chain-status " + (assemblyState.rearLinksBolted ? "ok" : "off");
    }
  }

  let _firstFrameDone = false;
  let _fpsAccum = 0;
  let _fpsFrames = 0;

  function animate(now) {
    requestAnimationFrame(animate);

    /* Вкладка скрыта — не жжём батарею */
    if (document.hidden) {
      lastTime = now;
      return;
    }

    const deltaSec = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    updateSimulation(now, deltaSec);
    controls.update();
    renderer.render(scene, camera);

    if (!_firstFrameDone) {
      _firstFrameDone = true;
      bootDone();
    }

    /* Адаптивное качество: не держим кадры — снижаем внутреннее разрешение, а не FPS */
    _fpsAccum += deltaSec;
    _fpsFrames++;
    if (_fpsAccum >= 1.5) {
      const fps = _fpsFrames / _fpsAccum;
      _fpsAccum = 0;
      _fpsFrames = 0;
      if (fps < 38 && _dprScale > 0.6) {
        _dprScale = Math.max(0.6, _dprScale - 0.15);
        applyDpr();
      } else if (fps > 56 && _dprScale < 1) {
        _dprScale = Math.min(1, _dprScale + 0.1);
        applyDpr();
      }
    }
  }
  requestAnimationFrame(animate);

  /* UI HANDLERS */
  const tabBtns = document.querySelectorAll(".tab-btn");
  const modePanels = document.querySelectorAll(".mode-panel");

  function activateTab(btn, { focus = false } = {}) {
    const tab = btn.dataset.tab;
    state.mode = tab;
    tabBtns.forEach((item) => {
      const isActive = item === btn;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      item.tabIndex = isActive ? 0 : -1;
    });
    modePanels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${tab}`;
    });
    if (focus) btn.focus();
  }

  tabBtns.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      triggerHaptic(10);
      activateTab(btn);
    });
    btn.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft")
        nextIndex = (index - 1 + tabBtns.length) % tabBtns.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabBtns.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabBtns.length - 1;
      activateTab(tabBtns[nextIndex], { focus: true });
    });
  });

  const telemetryPanel = document.getElementById("telemetry-panel");
  const btnToggleTelemetry = document.getElementById("btn-toggle-telemetry");

  btnToggleTelemetry.addEventListener("click", () => {
    triggerHaptic(12);
    telemetryPanel.classList.toggle("hidden");
    const isOpen = !telemetryPanel.classList.contains("hidden");
    btnToggleTelemetry.classList.toggle("active", isOpen);
    btnToggleTelemetry.setAttribute("aria-expanded", String(isOpen));
    btnToggleTelemetry.setAttribute(
      "aria-label",
      isOpen ? "Скрыть телеметрию" : "Показать телеметрию",
    );
    telemetryPanel.setAttribute("aria-hidden", String(!isOpen));
  });

  /* ─── ПОРЯДОК СБОРКИ И МОМЕНТЫ ЗАТЯЖКИ ───
   Порядок шагов и моменты — справочные, типовые для платформы PQ35 (Golf V / Scirocco).
   Перед реальной работой сверяться с ELSA/ETKA под конкретный VIN. */
  const boltById = Object.fromEntries(
    BOLT_SPECS.map((spec) => [spec.id, spec]),
  );

  const boltButtons = {};
  document.querySelectorAll("[data-bolt]").forEach((btn) => {
    boltButtons[btn.dataset.bolt] = btn;
  });

  const btnOrderMode = document.getElementById("btn-order-mode");
  const orderHint = document.getElementById("order-hint");
  const torqueReadout = document.getElementById("torque-readout");

  let strictOrder = true;
  let sequenceRunning = false;

  /* Сборка идёт снизу вверх по списку, разборка — с конца */
  function nextAssemblyStep() {
    for (let i = 0; i < BOLT_SPECS.length; i++) {
      if (!assemblyState[BOLT_SPECS[i].key]) return BOLT_SPECS[i];
    }
    return null;
  }

  function nextDisassemblyStep() {
    for (let i = BOLT_SPECS.length - 1; i >= 0; i--) {
      if (assemblyState[BOLT_SPECS[i].key]) return BOLT_SPECS[i];
    }
    return null;
  }

  function blockedReason(spec, wantBolted) {
    if (!strictOrder) return null;
    if (wantBolted) {
      const nx = nextAssemblyStep();
      if (nx && nx.id !== spec.id)
        return "сначала шаг " + nx.step + " — " + nx.short;
    } else {
      const nx = nextDisassemblyStep();
      if (nx && nx.id !== spec.id)
        return "сначала снимите шаг " + nx.step + " — " + nx.short;
    }
    return null;
  }

  function refreshBoltUI() {
    let done = 0;
    for (let i = 0; i < BOLT_SPECS.length; i++) {
      const sp = BOLT_SPECS[i];
      const on = !!assemblyState[sp.key];
      if (on) done++;
      const btn = boltButtons[sp.id];
      if (!btn) continue;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.textContent =
        sp.step + ". " + sp.icon + " " + sp.short + (on ? "" : " ✗");
      btn.title =
        sp.part + "\n" + sp.bolts + "\nМомент: " + sp.torque + "\n" + sp.note;
    }

    const nxA = nextAssemblyStep();
    if (orderHint) {
      orderHint.textContent = nxA
        ? "Далее: шаг " + nxA.step + " — " + nxA.short
        : "Собрано по регламенту";
    }
    if (statusTorque) {
      statusTorque.textContent = done + "/" + BOLT_SPECS.length + " ЗАТЯНУТО";
      statusTorque.className =
        "chain-status " + (done === BOLT_SPECS.length ? "ok" : "off");
    }
  }

  function setBolt(id, wantBolted, opts) {
    const spec = boltById[id];
    if (!spec) return false;
    const silent = !!(opts && opts.silent);
    const force = !!(opts && opts.force);

    if (!!assemblyState[spec.key] === !!wantBolted) return true;

    if (!force) {
      const why = blockedReason(spec, wantBolted);
      if (why) {
        triggerHaptic(45);
        showToast("⚠ Порядок работ: " + why);
        return false;
      }
    }

    assemblyState[spec.key] = !!wantBolted;
    refreshBoltUI();

    if (!silent) {
      triggerHaptic(wantBolted ? 20 : 35);
      if (wantBolted) {
        audio.playBoltClink();
        showToast(
          "Шаг " +
            spec.step +
            ": " +
            spec.short +
            " — " +
            spec.bolts +
            ", момент " +
            spec.torque,
        );
      } else {
        audio.playPartDropThud();
        showToast(
          "Шаг " + spec.step + ": " + spec.short + " — крепёж откручен",
        );
      }
      if (torqueReadout) {
        torqueReadout.textContent = wantBolted
          ? "Момент: " + spec.torque
          : "Снято: " + spec.short;
      }
    }
    return true;
  }

  /* Последовательная сборка/разборка: шаги идут с паузой, чтобы было видно порядок */
  function runBoltSequence(ids, wantBolted, doneMsg) {
    if (sequenceRunning) return;
    sequenceRunning = true;
    let i = 0;
    const stepFn = () => {
      if (i >= ids.length) {
        sequenceRunning = false;
        if (torqueReadout) torqueReadout.textContent = "Момент: —";
        showToast(doneMsg);
        return;
      }
      setBolt(ids[i], wantBolted, { force: true, silent: true });
      const sp = boltById[ids[i]];
      if (sp) {
        if (wantBolted) {
          audio.playBoltClink();
        } else {
          audio.playPartDropThud();
        }
        if (torqueReadout) {
          torqueReadout.textContent =
            (wantBolted ? "Шаг " : "Снят шаг ") + sp.step + ": " + sp.torque;
        }
      }
      i++;
      setTimeout(stepFn, 240);
    };
    stepFn();
  }

  document.querySelectorAll("[data-bolt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const spec = boltById[btn.dataset.bolt];
      if (!spec) return;
      setBolt(spec.id, !assemblyState[spec.key]);
    });
  });

  if (btnOrderMode) {
    btnOrderMode.addEventListener("click", () => {
      triggerHaptic(15);
      strictOrder = !strictOrder;
      btnOrderMode.classList.toggle("active", strictOrder);
      btnOrderMode.setAttribute("aria-pressed", String(strictOrder));
      btnOrderMode.textContent =
        "\u{1F4CB} Порядок: " + (strictOrder ? "строгий" : "свободный");
      showToast(
        strictOrder
          ? "Строгий режим: узлы только по регламенту 1 → 8"
          : "Свободный режим: можно крутить любой узел",
      );
      refreshBoltUI();
    });
  }

  const btnUnboltAll = document.getElementById("btn-unbolt-all");
  btnUnboltAll.addEventListener("click", () => {
    triggerHaptic(35);
    const order = BOLT_SPECS.map((sp) => sp.id)
      .slice()
      .reverse();
    runBoltSequence(order, false, "Разобрано в обратном порядке: 8 → 1");
  });

  const btnBoltAll = document.getElementById("btn-bolt-all");
  btnBoltAll.addEventListener("click", () => {
    triggerHaptic(30);
    runBoltSequence(
      BOLT_SPECS.map((sp) => sp.id),
      true,
      "Сборка по регламенту завершена: все моменты выдержаны",
    );
  });

  refreshBoltUI();

  const btnExportReport = document.getElementById("btn-export-report");
  btnExportReport.addEventListener("click", () => {
    try {
      const report = buildDiagnosticReport({
        state: { ...state, strictOrder },
        assemblyState,
        suspensionCorners,
        drivetrain: DL,
        boltSpecs: BOLT_SPECS,
      });
      downloadDiagnosticReport(report);
      triggerHaptic(18);
      showToast("Диагностический отчёт сохранён");
    } catch (error) {
      console.error("Diagnostic report export failed.", error);
      showToast("Не удалось сохранить отчёт");
    }
  });

  // Ride Height Slider
  const sliderRideHeight = document.getElementById("slider-ride-height");
  const valRideHeight = document.getElementById("val-ride-height");
  sliderRideHeight.addEventListener("input", (e) => {
    state.rideHeightMm = parseFloat(e.target.value);
    valRideHeight.textContent = Math.round(state.rideHeightMm) + " мм";
    sliderRideHeight.setAttribute(
      "aria-valuetext",
      Math.round(state.rideHeightMm) + " миллиметров",
    );
  });

  // Virtual Pedals
  function bindTouchBtn(elementId, stateKey) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = (e) => {
      e.preventDefault();
      state[stateKey] = true;
      el.classList.add("pressed");
      if (typeof e.pointerId === "number") el.setPointerCapture?.(e.pointerId);
      triggerHaptic(15);
    };
    const end = (e) => {
      e.preventDefault();
      state[stateKey] = false;
      el.classList.remove("pressed");
    };

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    el.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat)
        start(event);
    });
    el.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") end(event);
    });
  }

  bindTouchBtn("touch-gas", "touchGas");
  bindTouchBtn("touch-brake", "touchBrake");
  bindTouchBtn("touch-steer-left", "touchSteerL");
  bindTouchBtn("touch-steer-right", "touchSteerR");

  const sliderSpeed = document.getElementById("slider-speed");
  const valSpeed = document.getElementById("val-speed");
  const sliderSteer = document.getElementById("slider-steer");
  const valSteer = document.getElementById("val-steer");

  sliderSpeed.addEventListener("input", (e) => {
    state.targetSpeedKmh = parseFloat(e.target.value);
    state.stopRequested = false;
    valSpeed.textContent = Math.round(state.targetSpeedKmh) + " км/ч";
    sliderSpeed.setAttribute(
      "aria-valuetext",
      Math.round(state.targetSpeedKmh) + " километров в час",
    );
  });

  sliderSteer.addEventListener("input", (e) => {
    state.targetSteerAngleDeg = parseFloat(e.target.value);
    valSteer.textContent = state.targetSteerAngleDeg.toFixed(1) + "°";
    sliderSteer.setAttribute(
      "aria-valuetext",
      state.targetSteerAngleDeg.toFixed(1) + " градуса",
    );
  });

  document.querySelectorAll(".speed-preset").forEach((b) => {
    b.addEventListener("click", () => {
      triggerHaptic(10);
      const val = parseFloat(b.dataset.val);
      state.targetSpeedKmh = val;
      state.stopRequested = val === 0;
      sliderSpeed.value = val;
      valSpeed.textContent = val + " км/ч";
      sliderSpeed.setAttribute("aria-valuetext", val + " километров в час");
    });
  });

  const rigPresetBtns = document.querySelectorAll(".rig-preset");
  rigPresetBtns.forEach((b) => {
    b.addEventListener("click", () => {
      triggerHaptic(10);
      rigPresetBtns.forEach((item) => {
        const isActive = item === b;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });
      state.rigMode = b.dataset.mode;
    });
  });

  const sliderFreq = document.getElementById("slider-freq");
  const valFreq = document.getElementById("val-freq");
  sliderFreq.addEventListener("input", (e) => {
    state.rigFreq = parseFloat(e.target.value);
    valFreq.textContent = state.rigFreq.toFixed(1) + " Гц";
    sliderFreq.setAttribute(
      "aria-valuetext",
      state.rigFreq.toFixed(1) + " герц",
    );
  });

  const sliderAmp = document.getElementById("slider-amp");
  const valAmp = document.getElementById("val-amp");
  sliderAmp.addEventListener("input", (e) => {
    state.rigAmp = parseFloat(e.target.value);
    valAmp.textContent = Math.round(state.rigAmp) + " мм";
    sliderAmp.setAttribute(
      "aria-valuetext",
      Math.round(state.rigAmp) + " миллиметров",
    );
  });

  document.getElementById("btn-impulse-bump").addEventListener("click", () => {
    triggerHaptic(25);
    state.impulseTimer = 1.0;
    audio.playDamperHiss();
  });

  const wheelManualSliders = document.querySelectorAll(".wheel-manual-slider");
  wheelManualSliders.forEach((sl) => {
    sl.addEventListener("input", (e) => {
      const cIdx = parseInt(sl.dataset.corner, 10);
      const travelMm = parseFloat(e.target.value);
      suspensionCorners[cIdx].targetTravelMm = travelMm;
      sl.setAttribute("aria-valuetext", Math.round(travelMm) + " миллиметров");
    });
  });
  document.getElementById("btn-reset-drag").addEventListener("click", () => {
    triggerHaptic(10);
    suspensionCorners.forEach((sc) => (sc.targetTravelMm = 0));
    wheelManualSliders.forEach((sl) => {
      sl.value = 0;
      sl.setAttribute("aria-valuetext", "0 миллиметров");
    });
    state.rideHeightMm = 180;
    sliderRideHeight.value = 180;
    valRideHeight.textContent = "180 мм";
  });

  const cameraPresets = {
    orbit: {
      pos: [isMobile ? 3.0 : 2.8, isMobile ? 1.9 : 1.8, isMobile ? 3.6 : 3.4],
      target: [0, 0.3, 0],
    },
    front: { pos: [1.1, 0.8, -2.0], target: [0, 0.3, -1.3] },
    controlarm: { pos: [-0.9, 0.25, -1.5], target: [-0.55, 0.2, -1.3] },
    steering: { pos: [0.01, 1.2, -1.8], target: [0, 0.2, -1.25] },
    knuckle: { pos: [-0.95, 0.28, -1.55], target: [-0.68, 0.25, -1.3] },
    subframe: { pos: [0.01, -0.4, -1.3], target: [0, 0.2, -1.3] },
    gearbox: { pos: [-1.05, 0.55, -2.15], target: [-0.1, 0.25, -1.4] },
    rearaxle: { pos: [-1.55, 0.8, 1.95], target: [-0.55, 0.28, 1.32] },
  };

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      triggerHaptic(10);
      document.querySelectorAll("[data-view]").forEach((item) => {
        const isActive = item === btn;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-pressed", String(isActive));
      });
      btn.classList.add("active");
      const preset = cameraPresets[btn.dataset.view];
      if (preset) {
        animateCamera(preset.pos, preset.target);
      }
    });
  });

  let cameraAnimationId = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function animateCamera(targetPos, targetLookAt) {
    if (cameraAnimationId) cancelAnimationFrame(cameraAnimationId);
    const startPos = camera.position.clone();
    const endPos = new THREE.Vector3(...targetPos);
    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(...targetLookAt);

    if (reducedMotion.matches) {
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      controls.update();
      cameraAnimationId = 0;
      return;
    }

    let progress = 0;
    const duration = 500;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      progress = Math.min(1, elapsed / duration);
      const ease =
        progress < 0.5
          ? 2 * progress * progress
          : -1 + (4 - 2 * progress) * progress;

      camera.position.lerpVectors(startPos, endPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      controls.update();

      if (progress < 1) cameraAnimationId = requestAnimationFrame(step);
      else cameraAnimationId = 0;
    }
    cameraAnimationId = requestAnimationFrame(step);
  }

  const btnXray = document.getElementById("btn-xray");
  btnXray.addEventListener("click", () => {
    triggerHaptic(10);
    state.isXRay = !state.isXRay;
    btnXray.classList.toggle("active", state.isXRay);
    btnXray.setAttribute("aria-pressed", String(state.isXRay));
    btnXray.setAttribute(
      "aria-label",
      state.isXRay ? "Выключить рентген рамы" : "Включить рентген рамы",
    );
    chassisFrameGroup.children.forEach((c) => {
      if (c.material)
        c.material = state.isXRay ? materials.xrayChassis : materials.frame;
    });
  });

  const btnDiffCutaway = document.getElementById("btn-diff-cutaway");
  btnDiffCutaway.addEventListener("click", () => {
    triggerHaptic(10);
    state.isCutaway = !state.isCutaway;
    btnDiffCutaway.classList.toggle("active", state.isCutaway);
    btnDiffCutaway.setAttribute("aria-pressed", String(state.isCutaway));
    btnDiffCutaway.setAttribute(
      "aria-label",
      state.isCutaway
        ? "Выключить разрез редуктора"
        : "Включить разрез редуктора",
    );
    materials.diffHousing.transparent = state.isCutaway;
    materials.diffHousing.opacity = state.isCutaway ? 0.3 : 1.0;
    materials.diffHousing.depthWrite = !state.isCutaway;
    materials.diffHousing.needsUpdate = true;
  });

  const btnColorCode = document.getElementById("btn-colorcode");
  btnColorCode.addEventListener("click", () => {
    triggerHaptic(10);
    state.isColorCoded = !state.isColorCoded;
    btnColorCode.classList.toggle("active", state.isColorCoded);
    btnColorCode.setAttribute("aria-pressed", String(state.isColorCoded));
    btnColorCode.setAttribute(
      "aria-label",
      state.isColorCoded ? "Выключить цветовые зоны" : "Включить цветовые зоны",
    );
    materials.controlArmAluminum.color.setHex(
      state.isColorCoded ? 0xef4444 : 0xb9c0c8,
    );
    materials.consoleBracket.color.setHex(
      state.isColorCoded ? 0x3b82f6 : 0x7c8794,
    );
    materials.steeringRack.color.setHex(
      state.isColorCoded ? 0xf97316 : 0x6d7783,
    );
  });

  const btnLabels = document.getElementById("btn-labels");
  btnLabels.addEventListener("click", () => {
    triggerHaptic(10);
    state.showLabels = !state.showLabels;
    btnLabels.classList.toggle("active", state.showLabels);
    btnLabels.setAttribute("aria-pressed", String(state.showLabels));
    btnLabels.setAttribute(
      "aria-label",
      state.showLabels ? "Скрыть 3D-метки" : "Показать 3D-метки",
    );
    pinsContainer.style.display = state.showLabels ? "block" : "none";
    pinsContainer.setAttribute("aria-hidden", String(!state.showLabels));
  });

  const btnSound = document.getElementById("btn-sound");
  btnSound.addEventListener("click", () => {
    triggerHaptic(10);
    const isEnabled = audio.toggle();
    btnSound.classList.toggle("active", isEnabled);
    btnSound.setAttribute("aria-pressed", String(isEnabled));
    btnSound.setAttribute(
      "aria-label",
      isEnabled ? "Выключить звук" : "Включить звук",
    );
    if (!isEnabled && !audio.initialized)
      showToast("Звук недоступен в этом браузере");
  });

  const specsModal = document.getElementById("specs-modal");
  const specsCard = specsModal.querySelector(".modal-card");
  const specsCloseButton = document.getElementById("modal-close-btn");
  let focusBeforeModal = null;

  function openSpecsModal() {
    focusBeforeModal = document.activeElement;
    specsModal.classList.add("open");
    specsModal.setAttribute("aria-hidden", "false");
    specsCard.focus();
  }

  function closeSpecsModal() {
    if (!specsModal.classList.contains("open")) return;
    specsModal.classList.remove("open");
    specsModal.setAttribute("aria-hidden", "true");
    focusBeforeModal?.focus?.();
  }

  document.getElementById("btn-specs").addEventListener("click", () => {
    triggerHaptic(10);
    openSpecsModal();
  });
  specsCloseButton.addEventListener("click", closeSpecsModal);
  specsModal.addEventListener("click", (event) => {
    if (event.target === specsModal) closeSpecsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && specsModal.classList.contains("open")) {
      event.preventDefault();
      closeSpecsModal();
    }
  });

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyDpr();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));

  bootProgress(97, "Первый кадр");
} /* ─── конец bootstrapScene ─── */

/* Сборка стартует после первой отрисовки HUD: на слабом телефоне видно прогресс, а не чёрный экран */
requestAnimationFrame(() =>
  setTimeout(() => {
    bootstrapScene().catch(bootFail);
  }, 40),
);
