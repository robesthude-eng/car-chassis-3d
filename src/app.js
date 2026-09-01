import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ChassisAudioEngine } from "./audio/ChassisAudioEngine.js";
import { BOLT_SPECS } from "./data/boltSpecs.js";
import { CHASSIS_GEOMETRY } from "./data/chassisGeometry.js";
import { buildDiagnosticReport, downloadDiagnosticReport } from "./report.js";
import { CoilSpringMesh } from "./geometry/CoilSpringMesh.js";
import { createSideRail } from "./geometry/FrameRail.js";
import {
  SIDE_RAIL_PATH,
  SIDE_RAIL_SECTION,
  railYAt,
  railTopAt,
} from "./geometry/railProfile.js";
import {
  solveTelescopic,
  solveRodShroud,
} from "./geometry/telescopicMath.js";

function triggerHaptic(durationMs = 12) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(durationMs);
    } catch {}
  }
}

function showToast(text) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

const audio = new ChassisAudioEngine();

function unlockAudio() {
  void audio.resume();
  window.removeEventListener("touchstart", unlockAudio);
  window.removeEventListener("pointerdown", unlockAudio);
}
window.addEventListener("touchstart", unlockAudio, { passive: true });
window.addEventListener("pointerdown", unlockAudio, { passive: true });

/* ─── Экран загрузки: тяжёлая сборка сцены уходит из первого кадра ─── */
const bootScreen = document.getElementById("boot-screen");
const bootFill = document.getElementById("boot-fill");
const bootStepEl = document.getElementById("boot-step");
const bootRetry = document.getElementById("boot-retry");

function bootProgress(pct, label) {
  if (bootFill) bootFill.style.width = Math.max(3, Math.min(100, pct)) + "%";
  if (bootStepEl && label) bootStepEl.textContent = label;
}

function bootDone() {
  if (!bootScreen || bootScreen.classList.contains("done")) return;
  bootProgress(100, "Готово");
  bootScreen.setAttribute("aria-busy", "false");
  bootScreen.classList.add("done");
  setTimeout(function () {
    bootScreen.style.display = "none";
  }, 520);
}

/* Пауза на кадр: браузер успевает нарисовать прогресс между этапами сборки */
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/* Three.js Setup */
async function bootstrapScene() {
  const container = document.getElementById("canvas-container");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181f);
  scene.fog = new THREE.FogExp2(0x2b3038, 0.03);

  /* ─────────── Процедурные PBR-текстуры (генерируются локально) ─────────── */
  const _texCache = {};
  function _canvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }
  function _wrapIdx(v, n) {
    return ((v % n) + n) % n;
  }
  function _rgba(g, a) {
    return "rgba(" + g + "," + g + "," + g + "," + a + ")";
  }
  function _bumpToNormal(src, strength) {
    const S = src.width;
    const data = src.getContext("2d").getImageData(0, 0, S, S).data;
    const out = _canvas(S);
    const octx = out.getContext("2d");
    const img = octx.createImageData(S, S);
    const h = (x, y) => data[(_wrapIdx(y, S) * S + _wrapIdx(x, S)) * 4] / 255;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = (h(x - 1, y) - h(x + 1, y)) * strength;
        const ny = (h(x, y - 1) - h(x, y + 1)) * strength;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        const i = (y * S + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  function _tex(canvas, repeat, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat || 1, repeat || 1);
    try {
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    } catch {}
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  /* Литьё в песчаную форму: подрамник, цапфы, корпус редуктора */
  function castMaps() {
    if (_texCache.cast) return _texCache.cast;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#909090";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 12000; i++) {
      ctx.fillStyle = _rgba(70 + ((Math.random() * 110) | 0), 0.4);
      ctx.beginPath();
      ctx.arc(
        Math.random() * S,
        Math.random() * S,
        Math.random() * 2.3 + 0.35,
        0,
        6.2832,
      );
      ctx.fill();
    }
    _texCache.cast = {
      rough: _tex(c, 4),
      normal: _tex(_bumpToNormal(c, 2.4), 4),
    };
    return _texCache.cast;
  }

  /* Механообработка: шлифованная сталь, метизы, штоки */
  function machinedMaps() {
    if (_texCache.mach) return _texCache.mach;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#b8b8b8";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2400; i++) {
      const y = Math.random() * S;
      ctx.strokeStyle = _rgba(130 + ((Math.random() * 110) | 0), 0.3);
      ctx.lineWidth = Math.random() * 1.3 + 0.25;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y + (Math.random() - 0.5) * 2.5);
      ctx.stroke();
    }
    _texCache.mach = {
      rough: _tex(c, 3),
      normal: _tex(_bumpToNormal(c, 0.8), 3),
    };
    return _texCache.mach;
  }

  /* Резина: пыльники ШРУС, сайлентблоки, отбойники */
  function rubberMaps() {
    if (_texCache.rub) return _texCache.rub;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 24000; i++) {
      ctx.fillStyle = _rgba(150 + ((Math.random() * 105) | 0), 0.28);
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    _texCache.rub = {
      rough: _tex(c, 6),
      normal: _tex(_bumpToNormal(c, 0.7), 6),
    };
    return _texCache.rub;
  }

  /* Протектор покрышки 225/40 R18 */
  function treadMaps() {
    if (_texCache.tread) return _texCache.tread;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#b4b4b4";
    ctx.fillRect(0, 0, S, S);
    [0.32, 0.5, 0.68].forEach((v) => {
      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(0, v * S - S * 0.028, S, S * 0.056);
    });
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = "#303030";
      ctx.fillRect(i * S * 0.5 + S * 0.12, S * 0.18, S * 0.09, S * 0.64);
    }
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(0, 0, S, S * 0.13);
    ctx.fillRect(0, S * 0.87, S, S * 0.13);
    const n = _tex(_bumpToNormal(c, 3.0));
    n.repeat.set(18, 1);
    const r = _tex(c);
    r.repeat.set(18, 1);
    _texCache.tread = { normal: n, rough: r };
    return _texCache.tread;
  }

  /* Тормозной диск: борозды от колодок, перфорация, ржавая ступица */
  function discMaps() {
    if (_texCache.disc) return _texCache.disc;
    const S = 512;
    const c = _canvas(S),
      ctx = c.getContext("2d");
    const rc = _canvas(S),
      rctx = rc.getContext("2d");
    const cx = S / 2,
      cy = S / 2;
    ctx.fillStyle = "#1b1e22";
    ctx.fillRect(0, 0, S, S);
    rctx.fillStyle = "#d8d8d8";
    rctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(cx, cy, S * 0.17, cx, cy, S * 0.5);
    g.addColorStop(0, "#5f666d");
    g.addColorStop(0.12, "#99a1a9");
    g.addColorStop(0.75, "#8d949b");
    g.addColorStop(0.97, "#6d747b");
    g.addColorStop(1, "#3a3f45");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.5, 0, 6.2832);
    ctx.fill();
    rctx.fillStyle = "#606060";
    rctx.beginPath();
    rctx.arc(cx, cy, S * 0.48, 0, 6.2832);
    rctx.fill();
    for (let r = S * 0.18; r < S * 0.48; r += 1.6) {
      const v = 120 + ((Math.random() * 80) | 0);
      ctx.strokeStyle = "rgba(" + v + "," + (v + 3) + "," + (v + 7) + ",0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.stroke();
    }
    for (let ring = 0; ring < 3; ring++) {
      const rr = S * (0.235 + ring * 0.075);
      const cnt = 12 + ring * 4;
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * 6.2832 + ring * 0.3;
        const px = cx + Math.cos(a) * rr,
          py = cy + Math.sin(a) * rr;
        ctx.fillStyle = "#101316";
        ctx.beginPath();
        ctx.arc(px, py, S * 0.0115, 0, 6.2832);
        ctx.fill();
        rctx.fillStyle = "#f2f2f2";
        rctx.beginPath();
        rctx.arc(px, py, S * 0.0115, 0, 6.2832);
        rctx.fill();
      }
    }
    ctx.fillStyle = "#4a3a2b";
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.165, 0, 6.2832);
    ctx.fill();
    rctx.fillStyle = "#ececec";
    rctx.beginPath();
    rctx.arc(cx, cy, S * 0.165, 0, 6.2832);
    rctx.fill();
    for (let i = 0; i < 1600; i++) {
      const a = Math.random() * 6.2832,
        rr = Math.random() * S * 0.165;
      ctx.fillStyle =
        "rgba(" +
        (95 + ((Math.random() * 60) | 0)) +
        "," +
        (60 + ((Math.random() * 40) | 0)) +
        ",34,0.35)";
      ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.7, 1.7);
    }
    ctx.fillStyle = "#0b0d10";
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.055, 0, 6.2832);
    ctx.fill();
    _texCache.disc = {
      color: _tex(c, 1, true),
      rough: _tex(rc, 1),
      normal: _tex(_bumpToNormal(c, 1.1), 1),
    };
    return _texCache.disc;
  }

  /* Пол цеха: шлифованный бетон с разводами */
  function floorMaps() {
    if (_texCache.floor) return _texCache.floor;
    const S = 512;
    const c = _canvas(S),
      ctx = c.getContext("2d");
    const rc = _canvas(S),
      rctx = rc.getContext("2d");
    ctx.fillStyle = "#4a4f57";
    ctx.fillRect(0, 0, S, S);
    rctx.fillStyle = "#bdbdbd";
    rctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * S,
        y = Math.random() * S;
      const v = 45 + ((Math.random() * 55) | 0);
      ctx.fillStyle =
        "rgba(" +
        v +
        "," +
        (v + 3) +
        "," +
        (v + 9) +
        "," +
        (0.05 + Math.random() * 0.14).toFixed(3) +
        ")";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        Math.random() * 80 + 14,
        Math.random() * 60 + 10,
        Math.random() * 3,
        0,
        6.2832,
      );
      ctx.fill();
      rctx.fillStyle =
        "rgba(255,255,255," + (0.03 + Math.random() * 0.08).toFixed(3) + ")";
      rctx.beginPath();
      rctx.ellipse(
        x,
        y,
        Math.random() * 70 + 12,
        Math.random() * 55 + 10,
        0,
        0,
        6.2832,
      );
      rctx.fill();
    }
    for (let i = 0; i < 16000; i++) {
      const v = 30 + ((Math.random() * 130) | 0);
      ctx.fillStyle = _rgba(v, 0.16);
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
      rctx.fillStyle = _rgba(v, 0.1);
      rctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    _texCache.floor = {
      color: _tex(c, 12, true),
      rough: _tex(rc, 12),
      normal: _tex(_bumpToNormal(c, 1.0), 12),
    };
    return _texCache.floor;
  }

  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth < 768;

  /* ─── Профиль производительности: слабый телефон получает меньше полигонов и пи��селей ─── */
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

  /* Пол цеха: шлифованный бетон + технологическая разметка */
  const _floorTex = floorMaps();
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

  /* Materials (VW OEM PBR Finishes) */
  const materials = {
    frame: new THREE.MeshStandardMaterial({
      color: 0x1e242b,
      metalness: 0.85,
      roughness: 0.35,
    }),
    subframeAluminum: new THREE.MeshStandardMaterial({
      color: 0x5a6578,
      metalness: 0.92,
      roughness: 0.28,
    }),
    consoleBracket: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.94,
      roughness: 0.25,
    }),
    controlArmAluminum: new THREE.MeshStandardMaterial({
      color: 0xc7d2fe,
      metalness: 0.9,
      roughness: 0.25,
    }),
    ballJointSteel: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.92,
      roughness: 0.22,
    }),
    bolt: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.98,
      roughness: 0.1,
    }),
    driveshaft: new THREE.MeshStandardMaterial({
      color: 0xa0aec0,
      metalness: 0.95,
      roughness: 0.15,
    }),
    ujoint: new THREE.MeshStandardMaterial({
      color: 0x2d3748,
      metalness: 0.9,
      roughness: 0.25,
    }),
    diffHousing: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.45,
    }),
    diffCover: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.3,
    }),
    diffGears: new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.95,
      roughness: 0.2,
    }),
    halfShaft: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.9,
      roughness: 0.25,
    }),
    cvBoots: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05,
    }),
    mcphersonStrut: new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.88,
      roughness: 0.22,
    }),
    mcphersonSpring: new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.4,
      roughness: 0.2,
    }),
    damperShaft: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.05,
    }),
    knuckleCastIron: new THREE.MeshStandardMaterial({
      color: 0x384252,
      metalness: 0.9,
      roughness: 0.35,
    }),
    hubWheelBearing: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.95,
      roughness: 0.2,
    }),
    brakeDisc: new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.92,
      roughness: 0.25,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    }),
    brakeCaliper: new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      metalness: 0.5,
      roughness: 0.2,
    }),
    steeringRack: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.88,
      roughness: 0.25,
    }),
    steeringTieRod: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.92,
      roughness: 0.2,
    }),
    rim: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.92,
      roughness: 0.18,
    }),
    tire: new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.9,
      metalness: 0.05,
    }),
    rigPlatform: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.35,
    }),
    rigPiston: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.98,
      roughness: 0.08,
    }),
    swayBar: new THREE.MeshStandardMaterial({
      color: 0x10b981,
      metalness: 0.8,
      roughness: 0.3,
    }),
    xrayChassis: new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.6,
      depthWrite: false,
    }),
  };

  /* ─── Доводка отделок до заводских: карты шероховатости, микрорельеф, лак ─── */
  (function refineMaterials() {
    const cast = castMaps();
    const mach = machinedMaps();
    const rub = rubberMaps();
    const disc = discMaps();
    const tread = treadMaps();
    const V2 = (x, y) => new THREE.Vector2(x, y);
    const apply = (key, props) => {
      const m = materials[key];
      if (!m) return;
      Object.keys(props).forEach((k) => {
        if (k === "color" || k === "emissive") m[k].setHex(props[k]);
        else m[k] = props[k];
      });
      m.needsUpdate = true;
    };

    /* Кузовная сталь — катафорезная грунтовка */
    apply("frame", {
      color: 0x262b32,
      metalness: 0.85,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.35, 0.35),
      envMapIntensity: 0.9,
    });
    /* Литой алюминиевый подрамник 1K0 199 369 F */
    apply("subframeAluminum", {
      color: 0x8d959f,
      metalness: 1.0,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.85, 0.85),
      envMapIntensity: 1.15,
    });
    apply("consoleBracket", {
      color: 0x7c8794,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 1.1,
    });
    /* Кованый рычаг 1K0 407 151 */
    apply("controlArmAluminum", {
      color: 0xb9c0c8,
      metalness: 1.0,
      roughness: 0.85,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 1.25,
    });
    apply("ballJointSteel", {
      color: 0x3b4350,
      metalness: 1.0,
      roughness: 0.42,
      roughnessMap: mach.rough,
      envMapIntensity: 1.1,
    });
    /* Оцинкованный крепёж класса 10.9 */
    apply("bolt", {
      color: 0xc9d1d9,
      metalness: 1.0,
      roughness: 0.42,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.35, 0.35),
      envMapIntensity: 1.3,
    });
    apply("driveshaft", {
      color: 0x9098a2,
      metalness: 1.0,
      roughness: 0.38,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.3, 0.3),
      envMapIntensity: 1.2,
    });
    apply("ujoint", {
      color: 0x353b43,
      metalness: 0.95,
      roughness: 0.9,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 0.95,
    });
    apply("diffHousing", {
      color: 0x5d656f,
      metalness: 0.95,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.9, 0.9),
      envMapIntensity: 1.0,
    });
    apply("diffCover", {
      color: 0x76808c,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 1.05,
    });
    /* Цементированные шестерни главной пары */
    apply("diffGears", {
      color: 0xbf9a4f,
      metalness: 1.0,
      roughness: 0.32,
      roughnessMap: mach.rough,
      envMapIntensity: 1.25,
    });
    apply("halfShaft", {
      color: 0x2e353d,
      metalness: 1.0,
      roughness: 0.45,
      roughnessMap: mach.rough,
      envMapIntensity: 1.0,
    });
    /* Резина пыльников ШРУС */
    apply("cvBoots", {
      color: 0x0e1114,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: rub.normal,
      normalScale: V2(0.8, 0.8),
      envMapIntensity: 0.35,
    });
    apply("damperShaft", {
      color: 0xf2f4f6,
      metalness: 1.0,
      roughness: 0.035,
      envMapIntensity: 1.5,
    });
    /* Чугунная цапфа 1K0 407 255 */
    apply("knuckleCastIron", {
      color: 0x4d545c,
      metalness: 0.8,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(1.0, 1.0),
      envMapIntensity: 0.85,
    });
    apply("hubWheelBearing", {
      color: 0x262c33,
      metalness: 1.0,
      roughness: 0.55,
      roughnessMap: mach.rough,
      envMapIntensity: 1.0,
    });
    /* Вентилируемый диск 340 мм: борозды, перфорация, ржавая ступица */
    apply("brakeDisc", {
      color: 0xffffff,
      map: disc.color,
      roughnessMap: disc.rough,
      normalMap: disc.normal,
      normalScale: V2(0.5, 0.5),
      metalness: 1.0,
      roughness: 1.0,
      envMapIntensity: 0.85,
    });
    apply("steeringRack", {
      color: 0x6d7783,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 1.05,
    });
    apply("steeringTieRod", {
      color: 0x99a1aa,
      metalness: 1.0,
      roughness: 0.32,
      roughnessMap: mach.rough,
      envMapIntensity: 1.25,
    });
    /* Покрышка 225/40 R18 */
    apply("tire", {
      color: 0x121316,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: tread.normal,
      normalScale: V2(1.1, 1.1),
      envMapIntensity: 0.3,
    });
    apply("rigPlatform", {
      color: 0x3a424c,
      metalness: 0.9,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 0.8,
    });
    apply("rigPiston", {
      color: 0xeef1f4,
      metalness: 1.0,
      roughness: 0.05,
      envMapIntensity: 1.45,
    });
    apply("swayBar", {
      color: 0x10b981,
      metalness: 0.35,
      roughness: 0.5,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.4, 0.4),
      envMapIntensity: 0.9,
    });

    /* Окрашенные узлы получают лаковый слой (clearcoat) */
    materials.mcphersonStrut = new THREE.MeshPhysicalMaterial({
      color: 0x1f6f9e,
      metalness: 0.6,
      roughness: 0.42,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.3, 0.3),
      clearcoat: 0.75,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.1,
    });
    materials.mcphersonSpring = new THREE.MeshPhysicalMaterial({
      color: 0xd8a41c,
      metalness: 0.45,
      roughness: 0.45,
      roughnessMap: mach.rough,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1.15,
    });
    materials.brakeCaliper = new THREE.MeshPhysicalMaterial({
      color: 0xa8171b,
      metalness: 0.25,
      roughness: 0.5,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.55, 0.55),
      clearcoat: 0.8,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1.0,
    });
    materials.rim = new THREE.MeshPhysicalMaterial({
      color: 0xa9b0b8,
      metalness: 1.0,
      roughness: 0.26,
      roughnessMap: mach.rough,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.35,
    });

    /* Дополнительные отделки для новых деталей */
    materials.boltThread = new THREE.MeshStandardMaterial({
      color: 0x8f97a1,
      metalness: 1.0,
      roughness: 0.55,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.8, 0.8),
      envMapIntensity: 1.0,
    });
    materials.rimInner = new THREE.MeshStandardMaterial({
      color: 0x33383f,
      metalness: 0.9,
      roughness: 0.7,
      roughnessMap: cast.rough,
      envMapIntensity: 0.6,
    });
    materials.brakePad = new THREE.MeshStandardMaterial({
      color: 0x2b2723,
      metalness: 0.2,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 0.4,
    });
    materials.tireSidewall = new THREE.MeshStandardMaterial({
      color: 0x0f1013,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: rub.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 0.28,
    });
  })();

  /* 3D Scene Root Groups */
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

  /* PHYSICAL BOLTS STATE */
  const assemblyState = {
    subframeBolted: true,
    strutsBolted: true,
    armsBolted: true,
    balljointsBolted: true,
    steeringBolted: true,
    wheelsBolted: true,
    driveshaftsBolted: true,
    rearLinksBolted: true,
  };

  function createHexBoltMesh(radius = 0.016, length = 0.04) {
    const group = new THREE.Group();
    const hr = radius * 1.35;

    /* Шестигранная головка с фаской */
    const headGeo = new THREE.CylinderGeometry(hr * 0.9, hr, 0.013, 6);
    const head = new THREE.Mesh(headGeo, materials.bolt);
    head.rotation.x = Math.PI / 2;
    head.position.z = length * 0.5 + 0.0085;
    head.castShadow = true;
    group.add(head);

    /* Кольцевой буртик под головкой */
    const collarGeo = new THREE.CylinderGeometry(
      hr * 0.98,
      hr * 0.86,
      0.004,
      16,
    );
    const collar = new THREE.Mesh(collarGeo, materials.bolt);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = length * 0.5 + 0.0005;
    group.add(collar);

    /* Резьбовая часть */
    const studGeo = new THREE.CylinderGeometry(
      radius,
      radius * 0.94,
      length,
      16,
    );
    const stud = new THREE.Mesh(
      studGeo,
      materials.boltThread || materials.bolt,
    );
    stud.rotation.x = Math.PI / 2;
    stud.castShadow = true;
    group.add(stud);

    /* Шайба */
    const washerGeo = new THREE.CylinderGeometry(
      radius * 1.75,
      radius * 1.75,
      0.0035,
      20,
    );
    const washer = new THREE.Mesh(washerGeo, materials.bolt);
    washer.rotation.x = Math.PI / 2;
    washer.position.z = length * 0.5 - 0.002;
    group.add(washer);

    return group;
  }

  const CHASSIS = CHASSIS_GEOMETRY;
  const structuralUp = new THREE.Vector3(0, 1, 0);

  function V3(x, y, z) {
    return new THREE.Vector3(x, y, z);
  }

  /* Силовой профиль между двумя расчётными точками. Геометрия строится по
   фактическим координатам креплений, поэтому после изменения кинематики
   кронштейны и силовая структура не расходятся визуально. */
  function addBoxBeam(
    parent,
    from,
    to,
    width = 0.05,
    depth = width,
    material = materials.frame,
  ) {
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = Math.max(0.001, direction.length());
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1, depth),
      material,
    );
    beam.position.copy(from).addScaledVector(direction, 0.5);
    beam.quaternion.setFromUnitVectors(
      structuralUp,
      direction.multiplyScalar(1 / length),
    );
    beam.scale.y = length;
    beam.castShadow = true;
    beam.receiveShadow = true;
    parent.add(beam);
    return beam;
  }

  /* Две щеки, перемычка и сквозной болт образуют видимый силовой узел вокруг
   сайлентблока. Ось z используется для поперечных рычагов, x — для
   продольного рычага, y — для вертикальных опор подрамника. */
  function addClevisMount(
    parent,
    point,
    axis = "z",
    { gap = 0.052, height = 0.09, span = 0.09, boltRadius = 0.009 } = {},
  ) {
    const mount = new THREE.Group();
    mount.position.copy(point);
    const plateThickness = 0.012;

    [-1, 1].forEach((side) => {
      const geometry =
        axis === "x"
          ? new THREE.BoxGeometry(plateThickness, height, span)
          : new THREE.BoxGeometry(span, height, plateThickness);
      const plate = new THREE.Mesh(geometry, materials.consoleBracket);
      if (axis === "x") {
        plate.position.x = side * (gap + plateThickness) * 0.5;
      } else {
        plate.position.z = side * (gap + plateThickness) * 0.5;
      }
      plate.castShadow = true;
      mount.add(plate);
    });

    const bridge = new THREE.Mesh(
      axis === "x"
        ? new THREE.BoxGeometry(gap + plateThickness * 2, 0.014, span)
        : new THREE.BoxGeometry(span, 0.014, gap + plateThickness * 2),
      materials.consoleBracket,
    );
    bridge.position.y = height * 0.5;
    bridge.castShadow = true;
    mount.add(bridge);

    const bolt = createHexBoltMesh(boltRadius, gap + plateThickness * 3);
    if (axis === "x") bolt.rotation.y = Math.PI / 2;
    if (axis === "y") bolt.rotation.x = Math.PI / 2;
    mount.add(bolt);
    parent.add(mount);
    return mount;
  }

  function addBodyMountReceiver(parent, x, z) {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.045, 0.075, SEG(18, 10)),
      materials.frame,
    );
    /* Чашка садится на нижнюю полку лонжерона в этом сечении, а не на
     зашитую высоту 0.225 — иначе на изгибах рамы она висела в воздухе. */
    cup.position.set(x, railYAt(z) - SIDE_RAIL_SECTION.height * 0.5 + 0.024, z);
    cup.castShadow = true;
    parent.add(cup);

    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.082, SEG(16, 8)),
      materials.bracket,
    );
    sleeve.position.copy(cup.position);
    parent.add(sleeve);
  }

  /* 1. BUILD CHASSIS FRAME & STRUT TOWERS */
  function buildChassisFrame() {
    const railMat = materials.frame;

    [-CHASSIS.mainRailX, CHASSIS.mainRailX].forEach((x) => {
      const sign = Math.sign(x);

      /* ЛОНЖЕРОН — одна цельная деталь.
       Раньше здесь лежали три отдельных короба: ровная балка 2.4 м и два
       куска, повёрнутых на ±0.1 рад вокруг СВОИХ центров. Из-за поворота
       вокруг центра их внутренние концы поднимались на 0.28…0.30 против
       0.22 у ровной балки — в кадре были видны ступеньки и щели.
       Теперь замкнутый профиль выдавливается вдоль одной ломаной, поэтому
       стыки геометрически точные по построению. */
      const rail = createSideRail({
        x,
        path: SIDE_RAIL_PATH,
        section: SIDE_RAIL_SECTION,
        material: railMat,
        name: `sideRail${sign > 0 ? "R" : "L"}`,
      });
      chassisFrameGroup.add(rail);

      // FRONT STRUT TOWERS
      const towerFrontGroup = new THREE.Group();
      towerFrontGroup.position.set(
        sign * CHASSIS.front.towerX,
        0.24,
        CHASSIS.frontAxleZ,
      );

      /* Ноги стакана укорочены с 0.64 до 0.50: раньше их низ уходил на y=0.22,
       то есть ниже панели арки, и торчал в пустоте. Теперь они
       заканчиваются внутри панели (0.29…0.79). */
      const strutTowerTrussGeo = new THREE.CylinderGeometry(
        0.018,
        0.026,
        0.5,
        10,
      );
      const strutLeg1 = new THREE.Mesh(
        strutTowerTrussGeo,
        materials.subframeAluminum,
      );
      strutLeg1.position.set(0, 0.3, 0.09);
      strutLeg1.rotation.x = -0.16;
      strutLeg1.castShadow = true;
      towerFrontGroup.add(strutLeg1);

      const strutLeg2 = new THREE.Mesh(
        strutTowerTrussGeo,
        materials.subframeAluminum,
      );
      strutLeg2.position.set(0, 0.3, -0.09);
      strutLeg2.rotation.x = 0.16;
      strutLeg2.castShadow = true;
      towerFrontGroup.add(strutLeg2);

      const strutLegOuter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.022, 0.5, 10),
        materials.subframeAluminum,
      );
      strutLegOuter.position.set(sign * 0.06, 0.3, 0);
      strutLegOuter.rotation.z = sign * 0.1;
      strutLegOuter.castShadow = true;
      towerFrontGroup.add(strutLegOuter);

      const towerBrace = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.014, 0.19),
        materials.subframeAluminum,
      );
      towerBrace.position.set(0, 0.4, 0);
      towerFrontGroup.add(towerBrace);

      const towerCone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.078, 0.125, 0.11, 22, 1, true),
        materials.frame,
      );
      towerCone.position.set(0, 0.555, 0);
      towerCone.castShadow = true;
      towerFrontGroup.add(towerCone);

      const topHatPlateGeo = new THREE.CylinderGeometry(
        0.078,
        0.078,
        0.022,
        22,
      );
      const topPlate = new THREE.Mesh(topHatPlateGeo, materials.bracket);
      topPlate.position.set(0, 0.621, 0);
      topPlate.castShadow = true;
      towerFrontGroup.add(topPlate);

      for (let sn = 0; sn < 3; sn++) {
        const sang = (sn / 3) * Math.PI * 2;
        const topNut = createHexBoltMesh(0.008, 0.022);
        topNut.rotation.x = Math.PI / 2;
        topNut.position.set(
          Math.cos(sang) * 0.052,
          0.641,
          Math.sin(sang) * 0.052,
        );
        towerFrontGroup.add(topNut);
      }
      chassisFrameGroup.add(towerFrontGroup);

      /* Панель колёсной арки: связывает стакан с лонжероном кузова, иначе
       стакан после переноса на реальные ±600 мм висел бы в воздухе */
      const archPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.055, 0.24),
        materials.frame,
      );
      /* Панель расширена до 0.26, чтобы перекрыть и лонжерон (x≈0.45), и
       наружную ногу стакана (x≈0.66): иначе стакан ни на что не опирался. */
      archPanel.position.set(
        sign * 0.565,
        railTopAt(CHASSIS.frontAxleZ) - 0.0225,
        CHASSIS.frontAxleZ,
      );
      archPanel.castShadow = true;
      chassisFrameGroup.add(archPanel);

      const archGusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.3, 0.2),
        materials.subframeAluminum,
      );
      archGusset.position.set(sign * 0.545, 0.44, CHASSIS.frontAxleZ);
      chassisFrameGroup.add(archGusset);

      /* Задний амортизатор крепится на 110 мм позади оси колеса. Раньше
       стакан стоял строго над осью, поэтому верхняя опора висела рядом с ним. */
      const rearDamperTop = CHASSIS.rearBody.damperTop;
      const towerRearGroup = new THREE.Group();
      towerRearGroup.position.set(
        sign * rearDamperTop.x,
        rearDamperTop.y - 0.32,
        CHASSIS.rearAxleZ + rearDamperTop.z,
      );
      /* Тот же дефект, что и спереди: ноги длиной 0.62 с центром на -0.03
       прошивали лонжерон насквозь (мир 0.12…0.74). Теперь они стоят
       на панели арки и упираются в конус опоры. */
      const rearTrussGeo = new THREE.CylinderGeometry(0.016, 0.024, 0.4, 10);
      const rLeg1 = new THREE.Mesh(rearTrussGeo, materials.subframeAluminum);
      rLeg1.position.set(0, 0.07, 0.075);
      rLeg1.rotation.x = -0.18;
      rLeg1.castShadow = true;
      towerRearGroup.add(rLeg1);
      const rLeg2 = new THREE.Mesh(rearTrussGeo, materials.subframeAluminum);
      rLeg2.position.set(0, 0.07, -0.075);
      rLeg2.rotation.x = 0.18;
      rLeg2.castShadow = true;
      towerRearGroup.add(rLeg2);
      const rLegOuter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.02, 0.4, 10),
        materials.subframeAluminum,
      );
      rLegOuter.position.set(sign * 0.055, 0.07, 0);
      rLegOuter.rotation.z = -sign * 0.09;
      rLegOuter.castShadow = true;
      towerRearGroup.add(rLegOuter);
      const rearCone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.105, 0.09, 22, 1, true),
        materials.frame,
      );
      rearCone.position.set(0, 0.265, 0);
      rearCone.castShadow = true;
      towerRearGroup.add(rearCone);
      const rTopPlate = new THREE.Mesh(topHatPlateGeo, materials.frame);
      rTopPlate.position.set(0, 0.32, 0);
      rTopPlate.castShadow = true;
      towerRearGroup.add(rTopPlate);
      for (let rn = 0; rn < 3; rn++) {
        const rang = (rn / 3) * Math.PI * 2 + 0.5;
        const rNut = createHexBoltMesh(0.008, 0.02);
        rNut.rotation.x = Math.PI / 2;
        rNut.position.set(
          Math.cos(rang) * 0.048,
          0.339,
          Math.sin(rang) * 0.048,
        );
        towerRearGroup.add(rNut);
      }
      chassisFrameGroup.add(towerRearGroup);

      /* Внутренняя панель задней арки связывает стакан амортизатора с
       продольным лонжероном и воспринимает нагрузку верхней опоры. */
      const rearArchPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.065, 0.32),
        materials.frame,
      );
      rearArchPanel.position.set(
        sign * 0.575,
        railTopAt(CHASSIS.rearAxleZ + rearDamperTop.z) - 0.0275,
        CHASSIS.rearAxleZ + rearDamperTop.z,
      );
      rearArchPanel.castShadow = true;
      chassisFrameGroup.add(rearArchPanel);

      const rearArchGusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.31, 0.25),
        materials.subframeAluminum,
      );
      rearArchGusset.position.set(
        sign * 0.565,
        0.46,
        CHASSIS.rearAxleZ + rearDamperTop.z,
      );
      rearArchGusset.castShadow = true;
      chassisFrameGroup.add(rearArchGusset);

      /* Верхняя чашка задней пружины — отдельный узел кузова PQ35. Точка
       полностью совпадает с расчётной неподвижной опорой пружины. */
      const springTopSpec = CHASSIS.rearBody.springTop;
      const springTop = V3(
        sign * springTopSpec.x,
        springTopSpec.y,
        CHASSIS.rearAxleZ + springTopSpec.z,
      );
      const springCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.084, 0.066, 0.026, SEG(24, 14)),
        materials.frame,
      );
      /* Чашка высотой 0.026 раньше ставилась ЦЕНТРОМ в точку опоры пружины,
       поэтому верхний виток входил в металл на 13 мм. Сдвигаем вверх на
       полвысоты — теперь НИЖНЯЯ плоскость чашки ровно в точке опоры. */
      springCup.position.copy(springTop);
      springCup.position.y += 0.013;
      springCup.castShadow = true;
      chassisFrameGroup.add(springCup);

      const springCupRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.066, 0.009, SEG(8, 6), SEG(24, 14)),
        materials.bracket,
      );
      springCupRing.rotation.x = Math.PI / 2;
      springCupRing.position.copy(springTop);
      springCupRing.position.y += 0.009;
      chassisFrameGroup.add(springCupRing);

      addBoxBeam(
        chassisFrameGroup,
        V3(
          sign * CHASSIS.mainRailX,
          railYAt(CHASSIS.rearAxleZ - 0.11),
          CHASSIS.rearAxleZ - 0.11,
        ),
        V3(springTop.x, springTop.y + 0.014, springTop.z),
        0.038,
        0.05,
        materials.subframeAluminum,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * rearDamperTop.x, 0.43, CHASSIS.rearAxleZ + rearDamperTop.z),
        V3(springTop.x, springTop.y + 0.014, springTop.z),
        0.034,
        0.044,
        materials.subframeAluminum,
      );

      /* Передняя о����ора продольного рычага закреплена в усилителе порога,
       а не в заднем подрамнике. */
      const trailingSpec = CHASSIS.rearBody.trailingArm;
      const trailingPoint = V3(
        sign * trailingSpec.x,
        trailingSpec.y,
        CHASSIS.rearAxleZ + trailingSpec.z,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.mainRailX, railYAt(trailingPoint.z), trailingPoint.z),
        V3(trailingPoint.x, trailingPoint.y, trailingPoint.z),
        0.055,
        0.08,
        materials.frame,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.sillRailX, 0.28, trailingPoint.z),
        V3(trailingPoint.x, trailingPoint.y, trailingPoint.z),
        0.045,
        0.065,
        materials.frame,
      );
      addClevisMount(chassisFrameGroup, trailingPoint, "x", {
        gap: 0.052,
        height: 0.105,
        span: 0.11,
        boltRadius: 0.01,
      });
    });

    /* Пороговые усилители и короткие аутригеры превращают две центральные
     балки в связанную силовую структуру кузова, сохраняя открытый обзор. */
    [-1, 1].forEach((sign) => {
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.sillRailX, 0.28, -0.82),
        V3(sign * CHASSIS.sillRailX, 0.28, 0.78),
        0.078,
        0.1,
        railMat,
      );
      [-0.78, -0.05, 0.7].forEach((z) => {
        addBoxBeam(
          chassisFrameGroup,
          V3(sign * CHASSIS.mainRailX, railYAt(z), z),
          V3(sign * CHASSIS.sillRailX, 0.28, z),
          0.05,
          0.075,
          materials.subframeAluminum,
        );
      });
    });

    /* Четыре точки каждого подрамника тепе��ь заканчиваются в силовых чашках
     лонжеронов кузова; вертикальные болты физически входят в них. */
    [CHASSIS.frontAxleZ, CHASSIS.rearAxleZ].forEach((axleZ) => {
      [-1, 1].forEach((sign) => {
        [-0.18, 0.18].forEach((zOffset) => {
          addBodyMountReceiver(
            chassisFrameGroup,
            sign * CHASSIS.mainRailX,
            axleZ + zOffset,
          );
        });
      });
    });

    const crossmemberZs = [-1.65, -0.85, 0.15, 0.85, 1.65];
    crossmemberZs.forEach((z) => {
      const cmGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.96, 12);
      const cm = new THREE.Mesh(cmGeo, materials.subframeAluminum);
      cm.rotation.z = Math.PI / 2;
      /* Поперечины следуют за высотой лонжерона. При зашитой 0.2 крайние
       из них (z=±1.65) висели ниже рамы с зазором около 18 мм. */
      cm.position.set(0, railYAt(z), z);
      cm.castShadow = true;
      chassisFrameGroup.add(cm);
    });

    const hoopGeo = new THREE.TorusGeometry(0.12, 0.02, 8, 20, Math.PI);
    const hoop = new THREE.Mesh(hoopGeo, materials.subframeAluminum);
    hoop.position.set(0, railYAt(0.15), 0.15);
    hoop.rotation.x = Math.PI;
    chassisFrameGroup.add(hoop);

    const bumperGeo = new THREE.BoxGeometry(1.2, 0.05, 0.05);
    const bumper = new THREE.Mesh(bumperGeo, railMat);
    bumper.position.set(0, railYAt(-1.7), -1.7);
    chassisFrameGroup.add(bumper);
  }
  bootProgress(24, "Рама и стаканы стоек");
  await nextFrame();
  buildChassisFrame();

  /* 2. AUTHENTIC VW SCIROCCO (PQ35) SUBFRAME WITH REAR ALUMINUM CONSOLES */
  let frontSubframeMeshGroup, rearSubframeMeshGroup;
  let frontSwayAssembly = null;

  function buildSubframes() {
    frontSubframeMeshGroup = new THREE.Group();
    frontSubframeMeshGroup.position.set(
      0,
      CHASSIS.frontSubframe.nominalY,
      CHASSIS.frontAxleZ,
    );
    frontSubframeGroup.add(frontSubframeMeshGroup);

    /* ══ ПОДРАМНИК 1K0 199 369 F: ЗАМКНУТАЯ РАМА, А НЕ ПЛИТА ══
     Два лонжерона проходят рядом с осями сайлентблоков рычага,
     спереди и сзади их связывают поперечины, а середина ОТКРЫТА —
     там идут стабилизатор, приёмная труба и опора КПП. */
    const SUB_RAIL_X = 0.355;

    [-1, 1].forEach((s) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.075, 0.5),
        materials.subframeAluminum,
      );
      rail.position.set(s * SUB_RAIL_X, 0.012, 0);
      rail.castShadow = true;
      frontSubframeMeshGroup.add(rail);

      /* Выносы к четырём точкам крепления на лонжеронах кузова */
      [-0.18, 0.18].forEach((bz) => {
        const outrigger = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.055, 0.09),
          materials.subframeAluminum,
        );
        outrigger.position.set(s * 0.41, 0.02, bz);
        frontSubframeMeshGroup.add(outrigger);
      });
    });

    const subFrontCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.71, 0.06, 0.075),
      materials.subframeAluminum,
    );
    subFrontCross.position.set(0, 0.012, -0.215);
    subFrontCross.castShadow = true;
    frontSubframeMeshGroup.add(subFrontCross);

    /* Задняя поперечина: сверху опора КПП, снизу втулки стабилизатора */
    const subRearCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.71, 0.07, 0.095),
      materials.subframeAluminum,
    );
    subRearCross.position.set(0, 0.012, 0.21);
    subRearCross.castShadow = true;
    frontSubframeMeshGroup.add(subRearCross);

    [
      [-0.45, 0.18],
      [0.45, 0.18],
      [-0.45, -0.18],
      [0.45, -0.18],
    ].forEach(([bx, bz]) => {
      const bushingGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12);
      const bushing = new THREE.Mesh(bushingGeo, materials.bracket);
      bushing.position.set(bx, 0.04, bz);
      frontSubframeMeshGroup.add(bushing);

      const m14Bolt = createHexBoltMesh(0.014, 0.09);
      m14Bolt.rotation.x = Math.PI / 2;
      m14Bolt.position.set(bx, 0.08, bz);
      frontSubframeMeshGroup.add(m14Bolt);
    });

    /* Кронштейны нижнего рычага стоят РОВНО там, где его сайлентблоки:
     передний — вилка с продольным болтом (z = -0.14),
     задний — консоль 1K0 199 231 с вертикальной запрессовкой (z = +0.14). */
    [-1, 1].forEach((s) => {
      const bx = s * 0.4;

      [-0.042, 0.042].forEach((ez) => {
        const ear = new THREE.Mesh(
          new THREE.BoxGeometry(0.075, 0.105, 0.014),
          materials.consoleBracket,
        );
        ear.position.set(bx, -0.022, -0.14 + ez);
        ear.castShadow = true;
        frontSubframeMeshGroup.add(ear);
      });

      const armFrontBolt = createHexBoltMesh(0.01, 0.115);
      armFrontBolt.position.set(bx, 0, -0.14);
      frontSubframeMeshGroup.add(armFrontBolt);

      const armConsole = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.095, 0.115),
        materials.consoleBracket,
      );
      armConsole.position.set(bx, -0.03, 0.14);
      armConsole.castShadow = true;
      frontSubframeMeshGroup.add(armConsole);

      const armConsoleBore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.031, 0.031, 0.1, 14),
        materials.cvBoots,
      );
      armConsoleBore.position.set(bx, -0.01, 0.14);
      frontSubframeMeshGroup.add(armConsoleBore);

      const armRearBolt = createHexBoltMesh(0.01, 0.075);
      armRearBolt.rotation.x = Math.PI / 2;
      armRearBolt.position.set(bx, -0.075, 0.14);
      frontSubframeMeshGroup.add(armRearBolt);
    });

    [
      [-0.22, 0.05],
      [0.22, 0.05],
      [-0.22, -0.05],
      [0.22, -0.05],
    ].forEach(([rx, rz]) => {
      const rBoss = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.04, 10),
        materials.bracket,
      );
      rBoss.position.set(rx, 0.04, rz);
      frontSubframeMeshGroup.add(rBoss);

      const rBolt = createHexBoltMesh(0.009, 0.045);
      rBolt.position.set(rx, 0.06, rz);
      frontSubframeMeshGroup.add(rBolt);
    });

    /* ══ ЗАДНИЙ ПОДРАМНИК: ОТКРЫТАЯ ПРОСТРАНСТВЕННАЯ ЛЮЛЬКА ══
     Вместо условной прямоугольной плиты — две продольные балки, поперечины,
     аутригеры кузовных опор и отдельные кронштейны в каждой расчётной точке
     многорычажки. */
    rearSubframeMeshGroup = new THREE.Group();
    rearSubframeMeshGroup.position.set(
      0,
      CHASSIS.rearSubframe.nominalY,
      CHASSIS.rearAxleZ,
    );
    rearSubframeGroup.add(rearSubframeMeshGroup);

    const rearRailX = 0.35;
    [-1, 1].forEach((sign) => {
      const sideRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.075, 0.5),
        materials.subframeAluminum,
      );
      sideRail.position.set(sign * rearRailX, 0.018, 0.01);
      sideRail.castShadow = true;
      rearSubframeMeshGroup.add(sideRail);

      CHASSIS.rearSubframe.bodyMounts.forEach((mountPoint) => {
        addBoxBeam(
          rearSubframeMeshGroup,
          V3(sign * rearRailX, 0.018, mountPoint.z),
          V3(sign * mountPoint.x, mountPoint.y, mountPoint.z),
          0.06,
          0.075,
          materials.subframeAluminum,
        );
      });
    });

    const rearFrontCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.07, 0.085),
      materials.subframeAluminum,
    );
    rearFrontCross.position.set(0, 0.015, -0.205);
    rearFrontCross.castShadow = true;
    rearSubframeMeshGroup.add(rearFrontCross);

    const rearCenterCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.06, 0.075),
      materials.subframeAluminum,
    );
    rearCenterCross.position.set(0, -0.015, 0.03);
    rearCenterCross.castShadow = true;
    rearSubframeMeshGroup.add(rearCenterCross);

    const rearBackCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.69, 0.07, 0.085),
      materials.subframeAluminum,
    );
    rearBackCross.position.set(0, 0.025, 0.215);
    rearBackCross.castShadow = true;
    rearSubframeMeshGroup.add(rearBackCross);

    [-1, 1].forEach((sign) => {
      CHASSIS.rearSubframe.bodyMounts.forEach((mountPoint) => {
        const bx = sign * mountPoint.x;
        const bushing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.08, SEG(14, 9)),
          materials.bracket,
        );
        bushing.position.set(bx, mountPoint.y, mountPoint.z);
        bushing.castShadow = true;
        rearSubframeMeshGroup.add(bushing);

        const m14Bolt = createHexBoltMesh(0.014, 0.09);
        m14Bolt.rotation.x = Math.PI / 2;
        m14Bolt.position.set(bx, 0.08, mountPoint.z);
        rearSubframeMeshGroup.add(m14Bolt);
      });

      const hp = CHASSIS.rearSubframe.hardpoints;
      const mounts = [
        {
          name: "upperArm",
          point: hp.upperArm,
          anchors: [
            V3(sign * rearRailX, 0.025, -0.15),
            V3(sign * 0.44, 0.04, -0.18),
          ],
        },
        {
          name: "springLink",
          point: hp.springLink,
          anchors: [V3(sign * rearRailX, -0.005, 0.03)],
        },
        {
          name: "camberLink",
          point: hp.camberLink,
          anchors: [
            V3(sign * rearRailX, 0.025, 0.14),
            V3(sign * 0.3, 0.025, 0.205),
          ],
        },
        {
          name: "toeLink",
          point: hp.toeLink,
          anchors: [
            V3(sign * 0.32, 0.04, 0.205),
            V3(sign * rearRailX, 0.025, 0.17),
          ],
        },
      ];

      mounts.forEach(({ name, point, anchors }) => {
        const hardpoint = V3(sign * point.x, point.y, point.z);
        const clevis = addClevisMount(rearSubframeMeshGroup, hardpoint, "z", {
          gap: 0.052,
          height: name === "upperArm" ? 0.105 : 0.09,
          span: name === "toeLink" ? 0.075 : 0.085,
          boltRadius: 0.009,
        });
        clevis.userData.hardpoint = name;
        anchors.forEach((anchor) => {
          addBoxBeam(
            rearSubframeMeshGroup,
            anchor,
            hardpoint,
            0.042,
            0.052,
            materials.subframeAluminum,
          );
        });
      });
    });
  }
  bootProgress(33, "Подрамники PQ35");
  await nextFrame();
  buildSubframes();

  /* 3. STEERING SYSTEM */
  let steeringRackBar,
    leftTieRodAssembly,
    rightTieRodAssembly,
    steeringColumnShaft;
  const steeringRackBoots = [];

  function buildSteering() {
    const steerBase = new THREE.Group();
    steerBase.position.set(0, 0.18, -1.25);
    steeringGroup.add(steerBase);

    const rackHousingGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.54, 12);
    const rackHousing = new THREE.Mesh(rackHousingGeo, materials.steeringRack);
    rackHousing.rotation.z = Math.PI / 2;
    steerBase.add(rackHousing);

    const motorBulgeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12);
    const motorBulge = new THREE.Mesh(motorBulgeGeo, materials.bracket);
    motorBulge.position.set(-0.12, 0.04, 0);
    steerBase.add(motorBulge);

    const rackBarGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.72, 10);
    steeringRackBar = new THREE.Mesh(rackBarGeo, materials.damperShaft);
    steeringRackBar.rotation.z = Math.PI / 2;
    steerBase.add(steeringRackBar);

    /* Гофры рейки: закрывают шток от корпуса до шарнира рулевой тяги,
     поэтому их длина меняется вместе с ходом штока (см. updateSimulation) */
    [-0.28, 0.28].forEach((bx) => {
      const bootGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10);
      const boot = new THREE.Mesh(bootGeo, materials.cvBoots);
      boot.rotation.z = Math.PI / 2;
      boot.position.x = bx;
      steerBase.add(boot);
      steeringRackBoots.push(boot);
    });

    function createTieRodAssembly(isLeft) {
      const group = new THREE.Group();
      steeringGroup.add(group);

      const sign = isLeft ? -1 : 1;

      const innerJointGeo = new THREE.SphereGeometry(0.022, 10, 10);
      const innerJoint = new THREE.Mesh(innerJointGeo, materials.ujoint);
      innerJoint.position.set(sign * 0.36, 0.18, -1.25);
      group.add(innerJoint);

      const rodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8);
      const rod = new THREE.Mesh(rodGeo, materials.steeringTieRod);
      rod.position.set(sign * 0.54, 0.18, -1.25);
      rod.rotation.z = (sign * Math.PI) / 2;
      group.add(rod);

      const outerEndGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.05, 10);
      const outerEnd = new THREE.Mesh(outerEndGeo, materials.bracket);
      outerEnd.position.set(sign * 0.72, 0.18, -1.25);
      outerEnd.rotation.x = Math.PI / 2;
      group.add(outerEnd);

      const castleNut = createHexBoltMesh(0.008, 0.025);
      castleNut.position.set(sign * 0.72, 0.15, -1.25);
      group.add(castleNut);

      return { group, innerJoint, rod, outerEnd, castleNut, isLeft };
    }

    leftTieRodAssembly = createTieRodAssembly(true);
    rightTieRodAssembly = createTieRodAssembly(false);

    const colGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 10);
    steeringColumnShaft = new THREE.Mesh(colGeo, materials.ujoint);
    steeringColumnShaft.position.set(-0.15, 0.34, -1.15);
    steeringColumnShaft.rotation.x = -0.6;
    steeringColumnShaft.rotation.y = 0.2;
    steeringGroup.add(steeringColumnShaft);
  }
  bootProgress(41, "Рулевая рейка и тяги");
  await nextFrame();
  buildSteering();

  /* 4. SUSPENSION: OEM VW SCIROCCO CONTROL ARM & 55MM STRUT CLAMP KNUCKLE */
  const suspensionCorners = [];

  /* Верхняя плоскость нижней тарелки передней пружины в локальных
   координатах strutGroup: центр тарелки 0.16 + полтолщины 0.0075. */
  const FRONT_PERCH_TOP_Y = 0.1675;

  /* createCoilSpringGeometry удалён. Он возвращал ГОТОВУЮ TubeGeometry фиксиро-
   ванно�� длины, и код анимации был вынужден жать пружину через scale.y.
   Для трубы, навитой в спираль, это недопустимо: масштаб по одной оси
   деформирует КРУГЛОЕ сечение проволоки в эллипс и портит нормали.
   Заменён на CoilSpringMesh, который ПЕРЕСТРАИВАЕТ буферы под новую длину
   (см. src/geometry/CoilSpringMesh.js и src/geometry/springMath.js). */

  function createSciroccoControlArm(sign) {
    const group = new THREE.Group();
    const L = 0.3533;

    const fSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.055, 14),
      materials.bracket,
    );
    fSleeve.position.set(0, 0, 0.14);
    group.add(fSleeve);

    const rHexPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.06, 6),
      materials.controlArmAluminum,
    );
    rHexPin.position.set(0, 0, -0.14);
    rHexPin.rotation.x = Math.PI / 2;
    group.add(rHexPin);

    const mainWeb = new THREE.Mesh(
      new THREE.BoxGeometry(L, 0.022, 0.08),
      materials.controlArmAluminum,
    );
    mainWeb.position.set(sign * (L * 0.5), 0, 0);
    mainWeb.castShadow = true;
    group.add(mainWeb);

    const fDiagonal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8),
      materials.controlArmAluminum,
    );
    fDiagonal.position.set(sign * (L * 0.5), 0, 0.07);
    fDiagonal.rotation.z = (sign * Math.PI) / 2;
    fDiagonal.rotation.y = -sign * 0.38;
    group.add(fDiagonal);

    const rDiagonal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8),
      materials.controlArmAluminum,
    );
    rDiagonal.position.set(sign * (L * 0.5), 0, -0.07);
    rDiagonal.rotation.z = (sign * Math.PI) / 2;
    rDiagonal.rotation.y = sign * 0.38;
    group.add(rDiagonal);

    const padGeo = new THREE.BoxGeometry(0.06, 0.025, 0.08);
    const padMesh = new THREE.Mesh(padGeo, materials.controlArmAluminum);
    padMesh.position.set(sign * L, 0, 0);
    group.add(padMesh);

    // 3-BOLT BALL JOINT (1K0 407 365)
    const ballJointGroup = new THREE.Group();
    ballJointGroup.position.set(sign * L, 0, 0);

    const bjPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.01, 0.085),
      materials.ballJointSteel,
    );
    ballJointGroup.add(bjPlate);

    [
      [0, 0.03],
      [-0.02, -0.025],
      [0.02, -0.025],
    ].forEach(([px, pz]) => {
      const bjNut = createHexBoltMesh(0.007, 0.035);
      bjNut.position.set(px, 0.015, pz);
      ballJointGroup.add(bjNut);
    });

    const bjHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.028, 12),
      materials.ballJointSteel,
    );
    bjHousing.position.set(sign * 0.02, 0.02, 0);
    ballJointGroup.add(bjHousing);

    const bjRubberBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.02, 10),
      materials.cvBoots,
    );
    bjRubberBoot.position.set(sign * 0.02, 0.04, 0);
    ballJointGroup.add(bjRubberBoot);

    const taperedBallStud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.01, 0.035, 10),
      materials.bolt,
    );
    taperedBallStud.position.set(sign * 0.02, 0.06, 0);
    ballJointGroup.add(taperedBallStud);

    group.add(ballJointGroup);

    return { armGroup: group, ballJointGroup };
  }

  function createSciroccoMacPhersonStrut(sign) {
    const strutGroup = new THREE.Group();

    /* ОПОРНЫЙ ПОДШИПНИК 1K0 412 331.
     Наружная обойма запрессована в стакан кузова и НЕ вращается,
     внутреннее кольцо крутится вместе со штоком, пружиной и цапфой.
     Поэтому bearingOuter живёт вне strutGroup (его ставит cornerGroup). */
    const bearingOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.074, 0.074, 0.024, SEG(20, 12)),
      materials.consoleBracket,
    );
    bearingOuter.castShadow = true;

    const bearingInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.052, 0.02, SEG(20, 12)),
      materials.hubWheelBearing,
    );
    bearingInner.position.y = 0.515;
    strutGroup.add(bearingInner);

    const topMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.04, 16),
      materials.consoleBracket,
    );
    topMount.position.y = 0.54;
    strutGroup.add(topMount);

    /* Верхняя тарелка пружины: вращается со штоком, поджимает верхний виток */
    const upperSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.066, 0.066, 0.014, SEG(18, 10)),
      materials.bracket,
    );
    upperSeat.position.y = 0.465;
    strutGroup.add(upperSeat);

    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.32, 12),
      materials.damperShaft,
    );
    pistonRod.position.y = 0.38;
    strutGroup.add(pistonRod);

    /* ОТБОЙНИК (Anschlagpuffer) на штоке — упирается в верх корпуса стойки
     на ходе сжатия; сжимается ровно на bumpHit из расчёта сил */
    const bumpStop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.029, 0.075, SEG(14, 8)),
      materials.cvBoots,
    );
    bumpStop.position.y = 0.34;
    strutGroup.add(bumpStop);

    /* Гофрированный пыльник штока: длина = открытая часть штока */
    const dustBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.18, SEG(14, 8)),
      materials.cvBoots,
    );
    dustBoot.position.y = 0.25;
    strutGroup.add(dustBoot);

    /* ПРУЖИНА 1K0 411 105.
     Длина задаётся каждый кадр методом seatBetween(), а не scale.y:
     сечение проволоки остаётся круглым на всём ходе подвески.
     Опорные витки поджаты до шага = диаметр проволоки, поэтому крайние
     витки лежат на тарелках плоско, как у реальной пружины. */
    const springMesh = new CoilSpringMesh({
      turns: 7,
      radius: 0.052,
      wireRadius: 0.008,
      endCoils: 0.85,
      length: 0.2345,
      tubularSegments: SEG(196, 126),
      radialSegments: SEG(10, 7),
      material: materials.mcphersonSpring,
    });
    springMesh.castShadow = true;
    strutGroup.add(springMesh);

    /* Нижняя тарелка приварена к корпусу стойки: верхняя плоскость
     на 0.1675 — именно от неё отсчитывается пружина. Раньше основание
     пружины стояло на той же высоте 0.16, что и ЦЕНТР тарелки,
     то есть нижний виток был замурован в металле. */
    const lowerSpringPerch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.015, 16),
      materials.bracket,
    );
    lowerSpringPerch.position.y = 0.16;
    strutGroup.add(lowerSpringPerch);

    const strutBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0275, 0.0275, 0.28, 16),
      materials.mcphersonStrut,
    );
    strutBody.position.y = 0.02;
    strutGroup.add(strutBody);

    const swayBracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.034, 0.05),
      materials.bracket,
    );
    swayBracket.position.set(0, 0.06, sign * 0.045);
    strutGroup.add(swayBracket);

    /* СТОЙКА СТАБИЛИЗАТОРА 1K0 411 315: тело постоянной длины 240 мм.
     Живёт в cornerGroup, потому что соединяет ДВЕ разные детали —
     плечо штанги на подрамнике и кронштейн на амортизаторной стойке. */
    const dropLinkRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.33, SEG(10, 6)),
      materials.swayBar,
    );
    dropLinkRod.castShadow = true;

    return {
      strutGroup,
      topMount,
      pistonRod,
      springMesh,
      strutBody,
      bearingOuter,
      bearingInner,
      upperSeat,
      bumpStop,
      dustBoot,
      swayBracket,
      dropLinkRod,
    };
  }

  /* ЦАПФА / ПОВОРОТНЫЙ КУЛАК 1K0 407 255 — литой корпус со ступичным гнездом */
  function createSciroccoKnuckle(sign, isFront) {
    const knuckleGroup = new THREE.Group();
    const CI = materials.knuckleCastIron;
    const put = (m, x, y, z, shadow) => {
      m.position.set(x, y, z);
      if (shadow !== false) m.castShadow = true;
      knuckleGroup.add(m);
      return m;
    };

    /* Гнездо ступичного подшипника (внутрь от тормозного щита) */
    const hubBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.075, 30),
      CI,
    );
    hubBoss.rotation.z = Math.PI / 2;
    put(hubBoss, -sign * 0.08, 0, 0);

    const hubFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.074, 0.016, 30),
      CI,
    );
    hubFlange.rotation.z = Math.PI / 2;
    put(hubFlange, -sign * 0.121, 0, 0);

    /* Четыре болта ступичного узла 1T0 498 621 */
    [
      [0.048, 0.048],
      [-0.048, 0.048],
      [0.048, -0.048],
      [-0.048, -0.048],
    ].forEach(([by, bz]) => {
      const bBolt = createHexBoltMesh(0.0075, 0.028);
      bBolt.rotation.y = (-sign * Math.PI) / 2;
      put(bBolt, -sign * 0.133, by, bz);
    });

    /* Литая стойка вверх к хомуту амортизатора */
    const upperLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.048, 0.125, 4),
      CI,
    );
    upperLeg.geometry.rotateY(Math.PI / 4);
    upperLeg.scale.set(0.72, 1, 1);
    upperLeg.rotation.z = sign * 0.22;
    put(upperLeg, -sign * 0.094, 0.076, 0);

    /* Разрезной хомут стойки Ø55 мм */
    const clampCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.038, 0.09, 24),
      CI,
    );
    put(clampCollar, -sign * 0.105, 0.14, 0);

    const clampBore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0295, 0.0295, 0.094, 20, 1, true),
      materials.rimInner,
    );
    put(clampBore, -sign * 0.105, 0.14, 0, false);

    [-0.016, 0.016].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.056, 0.034), CI);
      put(ear, -sign * 0.105 + ex, 0.14, -0.048);
    });

    const pinchBolt = createHexBoltMesh(0.01, 0.064);
    pinchBolt.rotation.y = Math.PI / 2;
    put(pinchBolt, -sign * 0.105, 0.14, -0.048);

    /* Нижняя лапа и гнездо шаровой опоры 1K0 407 365 */
    const lowerLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.028, 0.1, 4),
      CI,
    );
    lowerLeg.geometry.rotateY(Math.PI / 4);
    lowerLeg.scale.set(0.78, 1, 1);
    lowerLeg.rotation.z = sign * 0.34;
    put(lowerLeg, -sign * 0.055, -0.062, 0);

    const bjSocket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.033, 0.044, 20),
      CI,
    );
    put(bjSocket, -sign * 0.04, -0.104, 0);

    const lowerLockNut = createHexBoltMesh(0.011, 0.022);
    put(lowerLockNut, -sign * 0.04, -0.128, 0);

    /* Рулевой рычаг с конусным гнездом наконечника */
    if (isFront) {
      const steerArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.034, 0.13, 4),
        CI,
      );
      steerArm.geometry.rotateY(Math.PI / 4);
      steerArm.scale.set(0.82, 1, 1);
      steerArm.rotation.x = Math.PI / 2;
      steerArm.rotation.z = sign * 0.19;
      put(steerArm, -sign * 0.013, -0.048, 0.068);

      const tieRodEye = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.036, 18),
        CI,
      );
      put(tieRodEye, -sign * 0.025, -0.045, 0.115);

      const tieRodTaperedHole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.052, 14),
        materials.bolt,
      );
      put(tieRodTaperedHole, -sign * 0.025, -0.045, 0.115, false);

      const castleNut = createHexBoltMesh(0.011, 0.02);
      castleNut.rotation.x = Math.PI / 2;
      put(castleNut, -sign * 0.025, -0.072, 0.115);
    }

    /* Уши крепления суппорта — по касательной к диску */
    const calMountGroup = new THREE.Group();
    calMountGroup.position.set(0, 0.104, -0.08);
    calMountGroup.rotation.x = -0.656;
    knuckleGroup.add(calMountGroup);

    [-0.054, 0.054].forEach((tz) => {
      const ear = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.032, 0.036),
        CI,
      );
      ear.position.set(-sign * 0.02, 0, tz);
      ear.castShadow = true;
      calMountGroup.add(ear);

      const eBolt = createHexBoltMesh(0.008, 0.032);
      eBolt.rotation.y = Math.PI / 2;
      eBolt.position.set(-sign * 0.04, 0, tz);
      calMountGroup.add(eBolt);
    });

    /* Рёбра жёсткости литья */
    [1, -1].forEach((rs) => {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.085, 0.014),
        CI,
      );
      rib.rotation.x = rs * 0.42;
      put(rib, -sign * 0.07, rs * 0.05, 0.048);
    });

    /* Датчик ABS в приливе цапфы */
    const absSensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.052, 12),
      materials.cvBoots,
    );
    absSensor.rotation.x = 0.45;
    put(absSensor, -sign * 0.062, 0.054, 0.062, false);

    /* Шейка под сальник ступицы */
    const spindleShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.085, 20),
      materials.bolt,
    );
    spindleShaft.rotation.z = Math.PI / 2;
    put(spindleShaft, -sign * 0.05, 0, 0, false);

    return { knuckleGroup, spindleShaft, pinchBolt };
  }

  /* ─── ГЕОМЕТРИЧЕСКИЕ ХЕЛПЕРЫ ДЛЯ СТЕРЖНЕВЫХ ЗВЕНЬЕВ ─── */
  const _rodA = new THREE.Vector3();
  const _rodB = new THREE.Vector3();
  const _rodUp = new THREE.Vector3(0, 1, 0);
  const _ptPool = [];
  for (let i = 0; i < 16; i++) _ptPool.push(new THREE.Vector3());
  const P = (i, x, y, z) => _ptPool[i].set(x, y, z);

  /* Ставит стержень между двумя точками: геометрия ориентирована по локальной +Y */
  function aimRod(mesh, from, to, baseLen) {
    _rodA.subVectors(to, from);
    const len = Math.max(0.02, _rodA.length());
    mesh.position.copy(from).addScaledVector(_rodA, 0.5);
    _rodB.copy(_rodA).normalize();
    mesh.quaternion.setFromUnitVectors(_rodUp, _rodB);
    mesh.scale.set(1, len / baseLen, 1);
    return len;
  }

  /* Ставит группу нач��лом в точку from, локальная +Y смотрит на to */
  function aimGroup(group, from, to) {
    _rodA.subVectors(to, from);
    const len = Math.max(0.02, _rodA.length());
    group.position.copy(from);
    _rodB.copy(_rodA).normalize();
    group.quaternion.setFromUnitVectors(_rodUp, _rodB);
    return len;
  }

  /* ─── ЗАДНЯЯ МНОГОРЫЧАЖКА PQ35 ───
   Продольный рычаг (Längslenker) держит продольные силы, три поперечных рычага задают
   развал, тяга с эксцентриком — сходимость. Пружина стоит на нижнем рычаге
   (Federlenker) отдельно от амортизатора — именно поэтому пол багажника низкий. */
  function createPQ35RearMultilink(sign) {
    const group = new THREE.Group();

    function rodMesh(radius, len, mat) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, SEG(12, 8)),
        mat,
      );
      m.castShadow = true;
      group.add(m);
      return { mesh: m, base: len };
    }

    function boxRod(w, len, d, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
      m.castShadow = true;
      group.add(m);
      return { mesh: m, base: len };
    }

    const trailingArm = boxRod(
      0.052,
      0.42,
      0.095,
      materials.controlArmAluminum,
    );
    const upperArm = rodMesh(0.019, 0.34, materials.controlArmAluminum);
    const springLink = boxRod(0.05, 0.4, 0.072, materials.controlArmAluminum);
    const camberLink = rodMesh(0.017, 0.36, materials.controlArmAluminum);
    const toeLink = rodMesh(0.015, 0.34, materials.steeringTieRod);

    /* Сайлентблоки внутренних шарниров: 0..3 — к подрамнику, 4 — продольный рычаг к кузову */
    const bushes = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.027, 0.027, 0.048, SEG(12, 8)),
        materials.cvBoots,
      );
      if (i < 4) {
        b.rotation.x = Math.PI / 2;
      } else {
        b.rotation.z = Math.PI / 2;
      }
      group.add(b);
      bushes.push(b);
    }

    /* Эксцентрик регулировки сходимости */
    const toeCam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.031, 0.031, 0.02, SEG(14, 9)),
      materials.bolt,
    );
    toeCam.rotation.x = Math.PI / 2;
    group.add(toeCam);

    /* Пружина на нижнем рычаге с отдельными чашками */
    const springGroup = new THREE.Group();
    group.add(springGroup);

    const springMesh = new CoilSpringMesh({
      turns: 6,
      radius: 0.05,
      wireRadius: 0.0075,
      endCoils: 0.8,
      length: 0.319,
      tubularSegments: SEG(168, 108),
      radialSegments: SEG(10, 7),
      material: materials.mcphersonSpring,
    });
    springMesh.castShadow = true;
    springGroup.add(springMesh);

    /* Нижняя чашка лежит НА рычаге: её низ в точке опоры, верх — на 0.012 */
    const springSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.058, 0.012, SEG(16, 10)),
      materials.consoleBracket,
    );
    springSeat.position.y = 0.006;
    springGroup.add(springSeat);

    const springTopSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.014, SEG(16, 10)),
      materials.consoleBracket,
    );
    springGroup.add(springTopSeat);

    /* Амортизатор без пружины */
    const damperGroup = new THREE.Group();
    group.add(damperGroup);

    const damperBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.031, 0.24, SEG(14, 9)),
      materials.mcphersonStrut,
    );
    damperBody.position.y = 0.13;
    damperBody.castShadow = true;
    damperGroup.add(damperBody);

    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.26, SEG(10, 7)),
      materials.damperShaft,
    );
    pistonRod.position.y = 0.32;
    damperGroup.add(pistonRod);

    const damperTopMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.032, SEG(14, 9)),
      materials.consoleBracket,
    );
    damperTopMount.position.y = 0.46;
    damperGroup.add(damperTopMount);

    const damperLowerEye = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.05, SEG(12, 8)),
      materials.ballJointSteel,
    );
    damperLowerEye.rotation.z = Math.PI / 2;
    damperGroup.add(damperLowerEye);

    return {
      group,
      sign,
      trailingArm,
      upperArm,
      springLink,
      camberLink,
      toeLink,
      bushes,
      toeCam,
      springGroup,
      springMesh,
      springSeat,
      springTopSeat,
      damperGroup,
      damperBody,
      pistonRod,
      damperTopMount,
      damperLowerEye,
    };
  }

  function buildSuspension() {
    const configs = [
      {
        name: "FL",
        isFront: true,
        isLeft: true,
        x: -0.78,
        z: CHASSIS.frontAxleZ,
      },
      {
        name: "FR",
        isFront: true,
        isLeft: false,
        x: 0.78,
        z: CHASSIS.frontAxleZ,
      },
      {
        name: "RL",
        isFront: false,
        isLeft: true,
        x: -0.78,
        z: CHASSIS.rearAxleZ,
      },
      {
        name: "RR",
        isFront: false,
        isLeft: false,
        x: 0.78,
        z: CHASSIS.rearAxleZ,
      },
    ];

    configs.forEach((cfg, idx) => {
      const cornerGroup = new THREE.Group();
      suspensionGroup.add(cornerGroup);

      const sign = cfg.isLeft ? -1 : 1;

      const lowerArmPivot = new THREE.Group();
      lowerArmPivot.position.set(
        sign * CHASSIS.front.lowerPivotX,
        CHASSIS.front.lowerPivotY,
        cfg.z,
      );
      cornerGroup.add(lowerArmPivot);

      /* L-образный рычаг 1K0407151 — только передняя ось; сзади стоит многорычажка */
      const armData = cfg.isFront ? createSciroccoControlArm(sign) : null;
      if (armData) lowerArmPivot.add(armData.armGroup);

      let strutAssembly = null;
      let rearLinks = null;
      if (cfg.isFront) {
        strutAssembly = createSciroccoMacPhersonStrut(sign);
        cornerGroup.add(strutAssembly.strutGroup);
        cornerGroup.add(strutAssembly.bearingOuter);
        cornerGroup.add(strutAssembly.dropLinkRod);
      } else {
        rearLinks = createPQ35RearMultilink(sign);
        cornerGroup.add(rearLinks.group);
      }

      const knuckleData = createSciroccoKnuckle(sign, cfg.isFront);
      knuckleData.knuckleGroup.position.set(cfg.x, 0.32, cfg.z);
      cornerGroup.add(knuckleData.knuckleGroup);

      suspensionCorners.push({
        id: idx,
        cfg,
        cornerGroup,
        lowerArmPivot,
        armData,
        strutAssembly,
        knuckleGroup: knuckleData.knuckleGroup,
        knuckleData,
        travelMm: 0,
        targetTravelMm: 0,
        steerAngleRad: 0,
        wheelRpm: 0,
        wheelAngle: 0,
        armSagZ: 0,
        strutSagZ: 0,
        knuckleFallY: 0,
        rearLinks,
        toeRad: 0,
      });
    });

    /* ═══ ПЕРЕДНИЙ СТАБИЛИЗАТОР 1K0 411 315 ═══
     Торсионная штанга в двух втулках подрамника, два плеча по краям и две
     стойки стабилизатора. Стойка — тело ПОСТОЯННОЙ длины, поэтому угол
     плеча не задаётся, а решается из положения амортизаторной стойки. */
    (function buildFrontArb() {
      const grp = new THREE.Group();
      frontSubframeGroup.add(grp);

      const barY = 0.085,
        barZ = -1.1,
        armX = 0.6,
        armR = 0.23,
        linkLen = 0.33;

      const barGroup = new THREE.Group();
      barGroup.position.set(0, barY, barZ);
      grp.add(barGroup);

      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, armX * 2, SEG(14, 8)),
        materials.swayBar,
      );
      bar.rotation.z = Math.PI / 2;
      bar.castShadow = true;
      barGroup.add(bar);

      /* Плечи штанги: каждое поворачивается вокруг оси штанги на свой угол,
       разница углов и есть закрутка стабилизатора */
      const arms = [];
      [-1, 1].forEach((s) => {
        const arm = new THREE.Group();
        arm.position.set(s * armX, barY, barZ);
        grp.add(arm);

        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, armR, SEG(12, 8)),
          materials.swayBar,
        );
        rod.rotation.x = Math.PI / 2;
        rod.position.set(0, 0, -armR * 0.5);
        rod.castShadow = true;
        arm.add(rod);

        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, SEG(12, 8), SEG(10, 6)),
          materials.ballJointSteel,
        );
        eye.position.set(0, 0, -armR);
        arm.add(eye);

        arms.push(arm);
      });

      /* Втулки крепления штанги к подрамнику — неподвижны */
      [-0.3, 0.3].forEach((bx) => {
        const bush = new THREE.Mesh(
          new THREE.BoxGeometry(0.062, 0.078, 0.062),
          materials.consoleBracket,
        );
        bush.position.set(bx, barY + 0.018, barZ);
        grp.add(bush);
      });

      frontSwayAssembly = {
        group: grp,
        barGroup,
        arms,
        links: [
          suspensionCorners[0].strutAssembly.dropLinkRod,
          suspensionCorners[1].strutAssembly.dropLinkRod,
        ],
        theta: [0, 0],
        barY,
        barZ,
        armX,
        armR,
        linkLen,
      };
    })();

    /* Задний стабилизатор: штанга по заднему подрамнику + стойки на рычаги пружин */
    const rearSwayGeo = new THREE.TorusGeometry(
      0.42,
      0.013,
      6,
      SEG(14, 10),
      Math.PI,
    );
    const rearSway = new THREE.Mesh(rearSwayGeo, materials.swayBar);
    rearSway.rotation.x = -Math.PI / 2;
    rearSway.position.set(0, 0.01, 0.16);
    if (rearSubframeMeshGroup) rearSubframeMeshGroup.add(rearSway);
  }
  bootProgress(55, "Подвеска: Макферсон и многорычажка");
  await nextFrame();
  buildSuspension();

  /* 5. WHEEL HUBS, BRAKE DISCS & WHEELS */
  const wheelAssemblies = [];

  function buildWheelsAndBrakes() {
    suspensionCorners.forEach((sc, idx) => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(sc.cfg.x, 0.32, sc.cfg.z);
      wheelsGroup.add(wheelGroup);

      const sign = sc.cfg.isLeft ? -1 : 1;

      const hubAndDiscGroup = new THREE.Group();
      wheelGroup.add(hubAndDiscGroup);

      const hubFlangeGeo = new THREE.CylinderGeometry(
        0.082,
        0.082,
        0.032,
        SEG(40, 24),
      );
      const hubMesh = new THREE.Mesh(hubFlangeGeo, materials.hubWheelBearing);
      hubMesh.rotation.z = Math.PI / 2;
      hubMesh.castShadow = true;
      hubAndDiscGroup.add(hubMesh);

      /* Обойма ступичного подшипника и тормозной щит */
      const bearingRace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.056, 0.056, 0.052, 32),
        materials.ballJointSteel,
      );
      bearingRace.rotation.z = Math.PI / 2;
      bearingRace.position.x = -sign * 0.022;
      hubAndDiscGroup.add(bearingRace);

      const dustShield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.158, 0.158, 0.003, SEG(40, 24)),
        materials.frame,
      );
      dustShield.rotation.z = Math.PI / 2;
      dustShield.position.x = -sign * 0.036;
      dustShield.receiveShadow = true;
      hubAndDiscGroup.add(dustShield);

      const lugNutMeshes = [];
      for (let s = 0; s < 5; s++) {
        const la = (s / 5) * Math.PI * 2;
        const stud = createHexBoltMesh(0.008, 0.05);
        stud.rotation.y = (sign * Math.PI) / 2;
        stud.position.set(
          sign * 0.022,
          Math.sin(la) * 0.056,
          Math.cos(la) * 0.056,
        );
        hubAndDiscGroup.add(stud);
        lugNutMeshes.push(stud);
      }

      /* Вентилируемый диск 340×30 мм */
      const discGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.03, SEG(64, 36));
      const discMesh = new THREE.Mesh(discGeo, materials.brakeDisc.clone());
      discMesh.rotation.z = Math.PI / 2;
      discMesh.castShadow = true;
      discMesh.receiveShadow = true;
      hubAndDiscGroup.add(discMesh);

      /* Тёмный поясок вентиляционного зазора между рабочими поверхностями */
      const ventEdge = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.1706,
          0.1706,
          0.0095,
          SEG(64, 36),
          1,
          true,
        ),
        materials.rimInner,
      );
      ventEdge.rotation.z = Math.PI / 2;
      hubAndDiscGroup.add(ventEdge);

      /* Ступичная шляпка диска */
      const discHat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.046, 32),
        materials.hubWheelBearing,
      );
      discHat.rotation.z = Math.PI / 2;
      discHat.position.x = sign * 0.008;
      hubAndDiscGroup.add(discHat);

      const caliperGroup = new THREE.Group();
      caliperGroup.position.set(0, 0.115, -0.088);
      caliperGroup.rotation.x = -0.656;
      wheelGroup.add(caliperGroup);

      /* Суппорт: внутренняя половина, мост через диск, колодки */
      const caliperGeo = new THREE.BoxGeometry(0.036, 0.074, 0.128);
      const caliperMesh = new THREE.Mesh(caliperGeo, materials.brakeCaliper);
      caliperMesh.position.set(-0.032, 0.004, 0);
      caliperMesh.castShadow = true;
      caliperGroup.add(caliperMesh);

      const caliperOuter = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.064, 0.118),
        materials.brakeCaliper,
      );
      caliperOuter.position.set(0.032, 0.002, 0);
      caliperOuter.castShadow = true;
      caliperGroup.add(caliperOuter);

      [0.056, -0.056].forEach((tz) => {
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(0.092, 0.028, 0.026),
          materials.brakeCaliper,
        );
        bridge.position.set(0, 0.026, tz);
        bridge.castShadow = true;
        caliperGroup.add(bridge);
      });

      [-0.034, 0.034].forEach((fz) => {
        const fin = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.012, 0.01),
          materials.brakeCaliper,
        );
        fin.position.set(-0.032, 0.044, fz);
        caliperGroup.add(fin);
      });

      [-0.02, 0.02].forEach((px) => {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(0.011, 0.046, 0.102),
          materials.brakePad,
        );
        pad.position.set(px, -0.006, 0);
        caliperGroup.add(pad);
      });

      /* Штуцер тормозного шланга */
      const hoseFitting = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.034, 14),
        materials.ballJointSteel,
      );
      hoseFitting.position.set(-0.046, 0.034, 0.05);
      hoseFitting.rotation.z = 0.55;
      caliperGroup.add(hoseFitting);

      const calBolt1 = createHexBoltMesh(0.008, 0.036);
      calBolt1.rotation.y = Math.PI / 2;
      calBolt1.position.set(-0.048, 0, 0.054);
      caliperGroup.add(calBolt1);

      const calBolt2 = createHexBoltMesh(0.008, 0.036);
      calBolt2.rotation.y = Math.PI / 2;
      calBolt2.position.set(-0.048, 0, -0.054);
      caliperGroup.add(calBolt2);

      const rotatingWheelGroup = new THREE.Group();
      wheelGroup.add(rotatingWheelGroup);

      /* Диск колеса 5×112: тёмный обод, полированные закраины, 5 спиц */
      const rimProfile = [
        [0.15, -0.098],
        [0.212, -0.098],
        [0.229, -0.092],
        [0.2255, -0.086],
        [0.216, -0.082],
        [0.216, -0.058],
        [0.184, -0.038],
        [0.184, 0.014],
        [0.216, 0.042],
        [0.216, 0.082],
        [0.2255, 0.086],
        [0.229, 0.092],
        [0.212, 0.098],
        [0.15, 0.098],
      ].map((p) => new THREE.Vector2(p[0], p[1]));

      const rimBarrelGeo = new THREE.LatheGeometry(rimProfile, 56);
      const rimBarrel = new THREE.Mesh(rimBarrelGeo, materials.rim);
      rimBarrel.rotation.z = (-sign * Math.PI) / 2;
      rimBarrel.castShadow = true;
      rotatingWheelGroup.add(rimBarrel);

      const rimBarrelInner = new THREE.Mesh(
        rimBarrelGeo,
        materials.rimInner.clone(),
      );
      rimBarrelInner.material.side = THREE.BackSide;
      rimBarrelInner.rotation.z = (-sign * Math.PI) / 2;
      rotatingWheelGroup.add(rimBarrelInner);

      const spokeGroup = new THREE.Group();
      const faceX = sign * 0.072;

      const rimOuterRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.207, 0.017, 16, 56),
        materials.rim,
      );
      rimOuterRing.rotation.y = Math.PI / 2;
      rimOuterRing.position.x = sign * 0.078;
      rimOuterRing.castShadow = true;
      spokeGroup.add(rimOuterRing);

      const rimHubPlate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.014, 32),
        materials.rim,
      );
      rimHubPlate.rotation.z = Math.PI / 2;
      rimHubPlate.position.x = sign * 0.023;
      spokeGroup.add(rimHubPlate);

      const rimDish = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.05, 32, 1, true),
        materials.rim,
      );
      rimDish.rotation.z = (-sign * Math.PI) / 2;
      rimDish.position.x = sign * 0.052;
      spokeGroup.add(rimDish);

      for (let s = 0; s < 5; s++) {
        const angle = (s / 5) * Math.PI * 2;
        const spokeGeo = new THREE.CylinderGeometry(0.021, 0.036, 0.176, 4, 1);
        spokeGeo.rotateY(Math.PI / 4);
        const spoke = new THREE.Mesh(spokeGeo, materials.rim);
        spoke.scale.set(0.6, 1, 1);
        spoke.position.set(
          faceX,
          Math.sin(angle) * 0.126,
          Math.cos(angle) * 0.126,
        );
        spoke.rotation.x = Math.PI / 2 - angle;
        spoke.castShadow = true;
        spokeGroup.add(spoke);

        const spokeBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.145, 0.028),
          materials.rimInner,
        );
        spokeBack.position.set(
          faceX - sign * 0.026,
          Math.sin(angle) * 0.12,
          Math.cos(angle) * 0.12,
        );
        spokeBack.rotation.x = Math.PI / 2 - angle;
        spokeGroup.add(spokeBack);
      }
      rotatingWheelGroup.add(spokeGroup);

      const centerCapGeo = new THREE.CylinderGeometry(0.05, 0.053, 0.018, 28);
      const centerCap = new THREE.Mesh(centerCapGeo, materials.hubWheelBearing);
      centerCap.rotation.z = (-sign * Math.PI) / 2;
      centerCap.position.x = sign * 0.07;
      rotatingWheelGroup.add(centerCap);

      const centerCapRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.006, 10, 26),
        materials.rim,
      );
      centerCapRing.rotation.y = Math.PI / 2;
      centerCapRing.position.x = sign * 0.074;
      rotatingWheelGroup.add(centerCapRing);

      /* Покрышка 225/40 R18 */
      const tireProfile = [
        [0.224, -0.086],
        [0.243, -0.099],
        [0.268, -0.104],
        [0.295, -0.099],
        [0.313, -0.086],
        [0.322, -0.062],
        [0.3255, -0.03],
        [0.326, 0],
        [0.3255, 0.03],
        [0.322, 0.062],
        [0.313, 0.086],
        [0.295, 0.099],
        [0.268, 0.104],
        [0.243, 0.099],
        [0.224, 0.086],
      ].map((p) => new THREE.Vector2(p[0], p[1]));

      const tireGeo = new THREE.LatheGeometry(tireProfile, SEG(72, 44));
      const tire = new THREE.Mesh(tireGeo, materials.tire);
      tire.rotation.z = (-sign * Math.PI) / 2;
      tire.castShadow = true;
      tire.receiveShadow = true;
      rotatingWheelGroup.add(tire);

      wheelAssemblies.push({
        id: idx,
        corner: sc,
        wheelGroup,
        hubAndDiscGroup,
        discMesh,
        caliperGroup,
        caliperMesh,
        rotatingWheelGroup,
        lugNutMeshes,
        wheelFallY: 0,
      });
    });
  }
  bootProgress(72, "Тормоза, ступицы, шины 225/40 R18");
  await nextFrame();
  buildWheelsAndBrakes();

  /* 6. ПРИВОД FWD: ПОПЕРЕЧНАЯ КПП СО ВСТРОЕННЫМ РЕДУКТОРОМ + ПРИВОДНЫЕ ВАЛ�� */
  let gearboxAssembly, diffGroup, diffCrownGear, spiderGroup;
  let leftHalfShaftGroup, rightHalfShaftGroup;

  function buildDrivetrain() {
    /* У PQ35 силовой агрегат стоит поперёк: КПП слева по ходу, главная пара и
     дифференциал — в том же картере, два приводных вала идут на передние ступицы.
     Карданного вала и заднего моста на переднеприводной машине нет. */
    const GEARBOX_Y = 0.25;
    const GEARBOX_Z = -1.4;

    const gearboxGroup = new THREE.Group();
    gearboxGroup.position.set(0, GEARBOX_Y, GEARBOX_Z);
    drivetrainGroup.add(gearboxGroup);

    /* Картер сцепления — стык с двигателем (справа по ходу) */
    const bellHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.125, 0.12, SEG(20, 12)),
      materials.diffCover,
    );
    bellHousing.rotation.z = Math.PI / 2;
    bellHousing.position.set(0.22, 0.01, 0);
    bellHousing.castShadow = true;
    gearboxGroup.add(bellHousing);

    /* Картер 6-ступенчатой КПП (алюминий) */
    const gearCase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.105, 0.3, SEG(18, 11)),
      materials.diffHousing,
    );
    gearCase.rotation.z = Math.PI / 2;
    gearCase.position.set(0.01, 0, 0);
    gearCase.castShadow = true;
    gearboxGroup.add(gearCase);

    /* Рёбра жёсткости картера */
    for (let f = -0.06; f <= 0.14; f += 0.05) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.15, 0.05),
        materials.diffCover,
      );
      fin.position.set(f, 0.02, 0.1);
      gearboxGroup.add(fin);
    }

    /* Поддон и сливная пробка трансмиссионного масла */
    const oilPan = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.15),
      materials.diffCover,
    );
    oilPan.position.set(0.02, -0.11, 0);
    gearboxGroup.add(oilPan);

    const drainPlug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.022, 6),
      materials.bolt,
    );
    drainPlug.position.set(-0.06, -0.14, 0);
    gearboxGroup.add(drainPlug);

    /* Задняя опора КПП на подрамник (тяга-демпфер) */
    const mountArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.035, 0.22),
      materials.consoleBracket,
    );
    mountArm.position.set(-0.14, -0.07, 0.16);
    gearboxGroup.add(mountArm);

    const mountBush = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.06, SEG(14, 9)),
      materials.cvBoots,
    );
    mountBush.rotation.x = Math.PI / 2;
    mountBush.position.set(-0.14, -0.07, 0.27);
    gearboxGroup.add(mountBush);

    /* Рабочий цилиндр сцепления */
    const clutchSlave = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.09, SEG(12, 8)),
      materials.damperShaft,
    );
    clutchSlave.rotation.z = Math.PI / 2;
    clutchSlave.position.set(0.24, 0.09, 0.08);
    gearboxGroup.add(clutchSlave);

    /* Выходные фланцы редуктора под внутренние ШРУСы */
    const flangeMeshes = [];
    [-1, 1].forEach((fs) => {
      const flange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.035, SEG(16, 10)),
        materials.ujoint,
      );
      flange.rotation.z = Math.PI / 2;
      flange.position.set(fs * 0.17, 0, 0);
      gearboxGroup.add(flange);
      flangeMeshes.push(flange);
    });

    gearboxAssembly = {
      gearboxGroup,
      gearCase,
      bellHousing,
      flangeMeshes,
      baseY: GEARBOX_Y,
      baseZ: GEARBOX_Z,
      currentSagY: 0,
    };

    /* ── Передний редуктор: главная пара 3.73 + дифференциал (видно в режиме разреза) ── */
    diffGroup = new THREE.Group();
    diffGroup.position.set(-0.17, GEARBOX_Y, GEARBOX_Z);
    drivetrainGroup.add(diffGroup);

    const diffCaseGeo = new THREE.SphereGeometry(
      0.132,
      SEG(14, 10),
      SEG(14, 8),
    );
    diffCaseGeo.scale(1.0, 1.0, 0.88);
    const diffCase = new THREE.Mesh(diffCaseGeo, materials.diffHousing);
    diffCase.castShadow = true;
    diffGroup.add(diffCase);

    /* Ведущая шестерня вторичного вала КПП */
    const pinion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.1, SEG(14, 9)),
      materials.diffGears,
    );
    pinion.rotation.z = Math.PI / 2;
    pinion.position.set(0.13, 0.065, 0);
    diffGroup.add(pinion);

    /* Коронная шестерня главной пары: ось вращения поперечная (по X) */
    const crownPivot = new THREE.Group();
    crownPivot.rotation.y = Math.PI / 2;
    diffGroup.add(crownPivot);

    const crownGeo = new THREE.TorusGeometry(
      0.098,
      0.024,
      SEG(10, 7),
      SEG(22, 14),
    );
    diffCrownGear = new THREE.Mesh(crownGeo, materials.diffGears);
    crownPivot.add(diffCrownGear);

    /* Полуосевые шестерни и сателлиты внутри коробки дифференциала */
    spiderGroup = new THREE.Group();
    diffCrownGear.add(spiderGroup);
    [-0.055, 0.055].forEach((sz) => {
      const sp = new THREE.Mesh(
        new THREE.ConeGeometry(0.032, 0.045, SEG(10, 7)),
        materials.diffGears,
      );
      sp.position.set(0, 0, sz);
      sp.rotation.x = sz > 0 ? Math.PI / 2 : -Math.PI / 2;
      spiderGroup.add(sp);
    });

    function createHalfShaftAssembly(isLeft) {
      const pivotGroup = new THREE.Group();
      drivetrainGroup.add(pivotGroup);

      const rotatingShaftGroup = new THREE.Group();
      pivotGroup.add(rotatingShaftGroup);

      /* Внутренний ШРУС — трипоидный, допускает осевое перемещение вала */
      const innerJoint = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.07, SEG(14, 9)),
        materials.ujoint,
      );
      innerJoint.position.y = 0.035;
      rotatingShaftGroup.add(innerJoint);

      const innerBoot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.034, 0.075, SEG(12, 8)),
        materials.cvBoots,
      );
      innerBoot.position.y = 0.105;
      rotatingShaftGroup.add(innerBoot);

      const shaftGeo = new THREE.CylinderGeometry(
        0.022,
        0.022,
        0.5,
        SEG(12, 8),
      );
      const shaftRod = new THREE.Mesh(shaftGeo, materials.halfShaft);
      shaftRod.position.y = 0.28;
      shaftRod.castShadow = true;
      rotatingShaftGroup.add(shaftRod);

      /* Правый вал длиннее и опирается на промежуточный подшипник */
      let supportBearing = null;
      if (!isLeft) {
        supportBearing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.044, 0.044, 0.05, SEG(14, 9)),
          materials.ujoint,
        );
        supportBearing.position.y = 0.3;
        rotatingShaftGroup.add(supportBearing);
      }

      const outerBootGeo = new THREE.CylinderGeometry(
        0.034,
        0.05,
        0.09,
        SEG(12, 8),
      );
      const outerBoot = new THREE.Mesh(outerBootGeo, materials.cvBoots);
      outerBoot.position.y = 0.47;
      rotatingShaftGroup.add(outerBoot);

      /* Наружный шариковый ШРУС в ступице + ступичный болт M16 */
      const outerJoint = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, SEG(14, 9), SEG(10, 7)),
        materials.ujoint,
      );
      outerJoint.position.y = 0.53;
      rotatingShaftGroup.add(outerJoint);

      const axleNutGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.02, 6);
      const axleNut = new THREE.Mesh(axleNutGeo, materials.bolt);
      axleNut.position.y = 0.58;
      rotatingShaftGroup.add(axleNut);

      return {
        pivotGroup,
        rotatingShaftGroup,
        shaftRod,
        innerJoint,
        innerBoot,
        outerBoot,
        outerJoint,
        axleNut,
        supportBearing,
        isLeft,
        rotationAngle: 0,
      };
    }

    leftHalfShaftGroup = createHalfShaftAssembly(true);
    rightHalfShaftGroup = createHalfShaftAssembly(false);
  }
  bootProgress(85, "КПП, редуктор и приводные валы");
  await nextFrame();
  buildDrivetrain();

  /* 7. 4-POST RIG TEST PLATFORMS */
  const rigPads = [];

  function build4PostRig() {
    suspensionCorners.forEach((sc, idx) => {
      const rigGroup = new THREE.Group();
      rigGroup.position.set(sc.cfg.x, 0, sc.cfg.z);
      rigPlatformsGroup.add(rigGroup);

      const padGeo = new THREE.BoxGeometry(0.42, 0.04, 0.75);
      const pad = new THREE.Mesh(padGeo, materials.rigPlatform);
      pad.position.y = 0.02;
      pad.receiveShadow = true;
      rigGroup.add(pad);

      const ramGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12);
      const ram = new THREE.Mesh(ramGeo, materials.rigPiston);
      ram.position.y = -0.2;
      rigGroup.add(ram);

      rigPads.push({ id: idx, rigGroup, pad, ram });
    });
  }
  bootProgress(92, "Вибростенд 4x");
  await nextFrame();
  build4PostRig();

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
      title: "Наконечник рулевой тяги · 1K0423811",
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
   Метки сортируются по удал��нности от камеры: ближняя ставится на место, остальные
   поднимаются вверх с поводком, пока не перестанут накла����ываться друг на друга. */
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

  const GEAR_RATIO = 3.73;
  const TIRE_RADIUS = 0.32;

  /* ЭТАП 1: ШИНА И КОЛЕСО КАК ИСТОЧНИК ДВИЖЕНИЯ */
  /* ══════════════════════════════════════════════════════════════════════════
   МЕХАНИЧЕСКАЯ МОДЕЛЬ. Ни один угол и ни один ход подвески не задаётся
   "на глаз" — всё считается из реальных точек крепления деталей:

     рейка → рулевая тяга (жёсткая длина) → наконечник → рычаг цапфы
       ⇒ угол поворота колеса РЕШАЕТСЯ из длины тяги (Аккерман и подруливание
         на ходах подвески получаются сами)
     шаровая опора + верхняя опора стойки ⇒ ось поворота (KPI + кастер)
       ⇒ развал и изменение колеи — следствие геометрии, а не формула
     пружина/амортизатор ⇒ сила на кузов ⇒ кузов реально качается, клюёт и
       кренится, а вес переносится по осям сам
     шина ⇒ вертикальная жёсткость пятна контакта ⇒ нагрузка на колесо
     двигатель → КПП → главная пара → дифференциал → полуось (торсионная
       жёсткость) → ступица → колесо: колесо крутится ИМЕННО приводом
   ═════════════════════════════════════════════════════════════════════════ */
  const PHYS = {
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
    step: LOW_END ? 1 / 180 : 1 / 240,
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
    /* подвеска: жёсткости по оси самого элемента */
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

  const CG_Y = 0.52,
    CG_Z = -0.318;
  const STATIC_WC_Y = 0.32;

  /* Жёсткие точки. Локальные точки цапфы — относительно центра колеса. */
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
  /* Расстояние "шаровая → хомут стойки" по цапфе и его наклон = KPI цапфы */
  const BJ_CLAMP_DX = HP.clampLocalX - HP.bjLocalX;
  const BJ_CLAMP_DY = HP.clampLocalY - HP.bjLocalY;
  const BJ_CLAMP_LEN = Math.sqrt(
    BJ_CLAMP_DX * BJ_CLAMP_DX + BJ_CLAMP_DY * BJ_CLAMP_DY,
  );

  /* Задняя многорычажка: внутренние точки (подрамник/кузов) и внешние (ступица) */
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
    dmpBot: [0.745, -0.05, 0.11],
    dmpTopX: rearBodyHP.damperTop.x,
    dmpTopY: rearBodyHP.damperTop.y,
    dmpTopZ: rearBodyHP.damperTop.z,
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
  const _mUp = new THREE.Vector3(0, 1, 0);
  const _mAxisLocal = new THREE.Vector3();

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
    for (let it = 0; it < 2; it++) {
      const sinA = clamp((bjY - g.pivot.y) / HP.armLen, -0.86, 0.86);
      const cosA = Math.sqrt(1 - sinA * sinA);
      g.armAngle = Math.asin(sinA);
      g.bj.set(g.pivot.x + sign * HP.armLen * cosA, bjY, g.pivot.z);
      /* Ось поворота колеса = шаровая опора → верх��яя опора стойки */
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

    /* Рейка → тяга → нак��нечник: угол поворота РЕШАЕТСЯ из длины тяги */
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

  /* ══ ГЕОМЕТРИЯ ЗАДНЕГО УГ��А (многорычажка) ══
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

  /* Точка ступицы: локальная точка + развал (вокруг Z) + сходимость (вокруг Y) */
  function rearHubPoint(out, cm, loc, dxH, gam, tau) {
    const sign = cm.sign;
    const lx = sign * loc[0],
      ly = loc[1],
      lz = loc[2];
    const cg = Math.cos(gam),
      sg = Math.sin(gam);
    let x = lx * cg - ly * sg,
      y = lx * sg + ly * cg,
      z = lz;
    const ct = Math.cos(tau),
      st = Math.sin(tau);
    const x2 = x * ct + z * st,
      z2 = -x * st + z * ct;
    return out.set(cm.sc.cfg.x + dxH + x2, cm.wcY + y, cm.sc.cfg.z + z2);
  }

  function rearGeom(cm, full) {
    rearInner(cm);
    const R = cm.rear;
    if (full) {
      /* Ньютон 2×2: длины верхнего и развального рычагов постоянны */
      let dxH = cm.dxH,
        gam = cm.camber;
      for (let it = 0; it < 3; it++) {
        const f1 =
          rearHubPoint(_rOut, cm, RHP.upOut, dxH, gam, 0).distanceTo(_rIn.up) -
          R.LU;
        const f2 =
          rearHubPoint(_rOut, cm, RHP.camOut, dxH, gam, 0).distanceTo(
            _rIn.cam,
          ) - R.LC;
        const h = 2e-4;
        const a11 =
          (rearHubPoint(_rOut, cm, RHP.upOut, dxH + h, gam, 0).distanceTo(
            _rIn.up,
          ) -
            R.LU -
            f1) /
          h;
        const a12 =
          (rearHubPoint(_rOut, cm, RHP.upOut, dxH, gam + h, 0).distanceTo(
            _rIn.up,
          ) -
            R.LU -
            f1) /
          h;
        const a21 =
          (rearHubPoint(_rOut, cm, RHP.camOut, dxH + h, gam, 0).distanceTo(
            _rIn.cam,
          ) -
            R.LC -
            f2) /
          h;
        const a22 =
          (rearHubPoint(_rOut, cm, RHP.camOut, dxH, gam + h, 0).distanceTo(
            _rIn.cam,
          ) -
            R.LC -
            f2) /
          h;
        const det = a11 * a22 - a12 * a21;
        if (!isFinite(det) || Math.abs(det) < 1e-9) break;
        dxH -= clamp((f1 * a22 - f2 * a12) / det, -0.02, 0.02);
        gam -= clamp((f2 * a11 - f1 * a21) / det, -0.08, 0.08);
      }
      cm.dxH = clamp(dxH, -0.09, 0.09);
      cm.camber = clamp(gam, -0.2, 0.2);
      /* Тяга сходимости даёт подруливание при ходе подвески */
      let tau = cm.toe;
      for (let it = 0; it < 3; it++) {
        const f =
          rearHubPoint(
            _rOut,
            cm,
            RHP.toeOut,
            cm.dxH,
            cm.camber,
            tau,
          ).distanceTo(_rIn.toe) - R.LT;
        const h = 2e-4;
        const d =
          (rearHubPoint(
            _rOut,
            cm,
            RHP.toeOut,
            cm.dxH,
            cm.camber,
            tau + h,
          ).distanceTo(_rIn.toe) -
            R.LT -
            f) /
          h;
        if (!isFinite(d) || Math.abs(d) < 1e-9) break;
        tau -= clamp(f / d, -0.05, 0.05);
      }
      cm.toe = clamp(tau, -0.09, 0.09);
      cm.wcX = cm.sc.cfg.x + cm.dxH;
      cm.psi = cm.toe;
    }
    /* Пружина стоит на рычаге (Federlenker), амортизатор — отдельно на ступице */
    rearHubPoint(_mA, cm, RHP.splOut, cm.dxH, cm.camber, 0);
    const t = RHP.springSeatT,
      sign = cm.sign;
    _mB.set(
      _rIn.spl.x + (_mA.x - _rIn.spl.x) * t,
      _rIn.spl.y + (_mA.y - _rIn.spl.y) * t + 0.025,
      _rIn.spl.z + (_mA.z - _rIn.spl.z) * t,
    );
    /* Верхняя чашка принадлежит кузову: она остаётся в фиксирован��ой
     расчётной точке, а не ездит вслед за нижним рычагом. */
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

    rearHubPoint(
      _mA,
      cm,
      [RHP.dmpBot[0] - 0.78, RHP.dmpBot[1], RHP.dmpBot[2]],
      cm.dxH,
      cm.camber,
      0,
    );
    bodyPoint(
      _mC,
      cm.sign * RHP.dmpTopX,
      RHP.dmpTopY,
      cm.sc.cfg.z + RHP.dmpTopZ,
    );
    cm.damperLen = _mA.distanceTo(_mC);
    cm.dmpBot = cm.dmpBot || new THREE.Vector3();
    cm.dmpTop = cm.dmpTop || new THREE.Vector3();
    cm.dmpBot.copy(_mA);
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
    const sagTarget = assemblyState.subframeBolted ? 0 : PHYS.subframeSag;
    body.sag += (sagTarget - body.sag) * Math.min(1, dt * 6);
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
    for (let i = 0; i < 4; i++) {
      const cm = suspensionCorners[i].mech;
      const aW = (cm.fz + cm._fW + cm._fArb - cm.mU * PHYS.g) / cm.mU;
      cm.wcV = clamp(cm.wcV + aW * dt, -7, 7);
      cm.wcY = clamp(cm.wcY + cm.wcV * dt, 0.12, 0.56);
      if (!isFinite(cm.wcY)) {
        cm.wcY = STATIC_WC_Y;
        cm.wcV = 0;
      }
      heaveF -= cm._fW;
      rollT -= cm._fW * cm.wcX;
      pitchT += cm._fW * (cm.wcZ - CG_Z);
    }

    body.vy = clamp(body.vy + (heaveF / body.mS) * dt, -5, 5);
    body.y = clamp(body.y + body.vy * dt, -0.22, 0.22);
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

    // Ползунок скорости теперь круиз-контроль: он давит на педали, а не двигает машину
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
        /* Решаем: рычаг → шаровая → ось поворота → рейка/тяга → угол цапфы */
        frontGeom(cm, cm.wcY, rackX, true);

        /* Нижний рычаг 1K0407151: качается вокруг своих сайлентблоков */
        sc.lowerArmPivot.position.copy(g.pivot);
        const armSagTarget = frontArmsOk ? 0 : -sign * 0.3;
        sc.armSagZ += (armSagTarget - sc.armSagZ) * Math.min(1, deltaSec * 6);
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

        /* Верхняя опора: внутреннее кольцо и тарелка пружины едут со штоком */
        st.bearingInner.position.y = cm.strutLen - 0.025;
        st.upperSeat.position.y = cm.strutLen - 0.075;

        /* ПРУЖИНА: длина берётся из ФАКТИЧЕСКОГО зазора между тарелками,
         и геометрия перестраивается. Раньше было
           scale.y = clamp((strutLen - 0.22) / 0.32, 0.4, 1.25)
         — числа никак не связаны с реальными тарелками (пружина входила
         в верхнюю тарелку на ~22 мм), а сам масштаб сжимал проволоку
         ⌀ 16 мм до 6.4 мм по вертикали. */
        st.springMesh.seatBetween(FRONT_PERCH_TOP_Y, cm.strutLen - 0.082);

        /* ШТОК: раньше длина была жёсткой (0.32) при плавающем центре,
         поэтому на статике низ штока оказывался на 0.17, а верх корпуса
         — на 0.16: шток висел в воздухе с зазором 10 мм, а на отбое и больше.
         Теперь решается задача телескопа с гарантированной заделкой 75 мм. */
        const tel = solveTelescopic({
          length: cm.strutLen,
          tubeBottom: -0.12,
          tubeLength: 0.28,
          rodTopInset: 0.03,
          minInsertion: 0.075,
          minRodLength: 0.1,
        });
        st.pistonRod.scale.y = tel.rodLength / 0.32;
        st.pistonRod.position.y = tel.rodCenter;
        /* Наружная обойма стоит в стак��не: наклон оси есть, поворота НЕТ */
        st.bearingOuter.position.copy(
          P(13, 0, cm.strutLen - 0.025, 0)
            .applyQuaternion(qTilt)
            .add(g.clamp),
        );
        st.bearingOuter.quaternion.copy(qTilt);

        /* Отбойник сжимается ровно на bumpHit, пыльник закрывает остаток штока.
         Оба отсчитываются от тех же tubeTop/rodTop, что и сам шток, так что
         разрывов между корпусом, пыльником и отбойником быть не может. */
        const shroud = solveRodShroud({
          tubeTop: tel.tubeTop,
          rodTop: tel.rodTop,
          bumpStopFree: 0.075,
          bumpStopMin: 0.026,
          bumpStopCrush: cm.bumpHit * 0.75,
          bootMin: 0.03,
        });
        st.bumpStop.scale.y = shroud.bumpStopLength / 0.075;
        st.bumpStop.position.y = shroud.bumpStopCenter;
        st.dustBoot.scale.y = shroud.bootLength / 0.18;
        st.dustBoot.position.y = shroud.bootCenter;

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

        /* Ру��евая тяга с наконечником 1K0423811: жёсткая деталь между шарниром
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
        /* Верхняя чашка толщиной 0.014 верхом упирается в точку опоры кузова,
         поэтому её центр на (springLenVis - 0.007), а не на springLenVis. */
        rl.springTopSeat.position.y = springLenVis - 0.007;

        /* Та же правка, что и спереди. Здесь был
           scale.set(1, Math.max(0.45, springLenVis / 0.36), 1)
         — полка 0.45 ещё и ОТВЯЗЫВАЛА вершину пружины от верхней чашки. */
        rl.springMesh.seatBetween(0.012, springLenVis - 0.014);

        const dmpLenVis = aimGroup(rl.damperGroup, cm.dmpBot, cm.dmpTop);
        const rtel = solveTelescopic({
          length: dmpLenVis,
          tubeBottom: 0.01,
          tubeLength: 0.24,
          rodTopInset: 0.02,
          minInsertion: 0.07,
          minRodLength: 0.09,
        });
        rl.pistonRod.scale.y = rtel.rodLength / 0.26;
        rl.pistonRod.position.y = rtel.rodCenter;
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

      const targetWheelFall = isWheelBolted ? 0 : -0.16;
      wa.wheelFallY +=
        (targetWheelFall - wa.wheelFallY) * Math.min(1.0, deltaSec * 14);

      wa.wheelGroup.position.set(
        cm.wcX,
        cm.wcY + (isWheelBolted ? 0 : wa.wheelFallY),
        cm.wcZ,
      );
      if (cm.isF) {
        wa.wheelGroup.quaternion.copy(cm.geo.q);
        if (!frontArmsOk) {
          qSteer.setFromAxisAngle(zAxisV, cm.sign * 0.2);
          wa.wheelGroup.quaternion.premultiply(qSteer);
        }
      } else {
        wa.wheelGroup.rotation.set(0, cm.toe, cm.camber);
      }
      wa.hubAndDiscGroup.position.y = -wa.wheelFallY;

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
   Порядок шагов и мо��енты — справочные, типовые для платформы PQ35 (Golf V / Scirocco).
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
      Math.round(state.rigAmp) + " ��иллиметров",
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
    bootstrapScene().catch((err) => {
      if (bootStepEl)
        bootStepEl.textContent =
          "Ошибка сборки: " + ((err && err.message) || err);
      if (bootScreen) {
        bootScreen.setAttribute("role", "alert");
        bootScreen.setAttribute("aria-busy", "false");
      }
      if (bootRetry) {
        bootRetry.hidden = false;
        bootRetry.addEventListener("click", () => window.location.reload(), {
          once: true,
        });
      }
      console.error(err);
    });
  }, 40),
);
