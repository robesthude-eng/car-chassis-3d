/**
 * 3D-сцена игры: трасса, окружение, кузов и подвеска.
 * Визуализация подвески использует реальный ход из физики,
 * поэтому пружины и амортизаторы работают достоверно.
 */

import * as THREE from "three";
import { TRACK, centerline, centerlineTangent, heightAt } from "./track.js";

const SEG = 320;

export function buildTrackMesh() {
  const group = new THREE.Group();
  const half = TRACK.width / 2;

  const road = new THREE.BufferGeometry();
  const verts = [];
  const uvs = [];
  const idx = [];

  for (let i = 0; i <= SEG; i += 1) {
    const t = i / SEG;
    const p = centerline(t);
    const tan = centerlineTangent(t);
    const nx = -tan.z;
    const nz = tan.x;
    const lx = p.x + nx * half;
    const lz = p.z + nz * half;
    const rx = p.x - nx * half;
    const rz = p.z - nz * half;
    verts.push(lx, heightAt(lx, lz) + 0.02, lz);
    verts.push(rx, heightAt(rx, rz) + 0.02, rz);
    uvs.push(0, t * 60, 1, t * 60);
    if (i < SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  road.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  road.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  road.setIndex(idx);
  road.computeVertexNormals();

  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x2a2d33,
    roughness: 0.94,
    metalness: 0.02,
  });
  group.add(new THREE.Mesh(road, asphalt));

  // разметка по краям
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xf2f4f8 });
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= SEG; i += 1) {
      const t = i / SEG;
      const p = centerline(t);
      const tan = centerlineTangent(t);
      const x = p.x + -tan.z * half * side * 0.93;
      const z = p.z + tan.x * half * side * 0.93;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.05, z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  // земля
  const ground = new THREE.PlaneGeometry(700, 700, 90, 90);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - 0.05);
  }
  ground.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      ground,
      new THREE.MeshStandardMaterial({ color: 0x394832, roughness: 1 }),
    ),
  );

  // стартовая линия
  const startT = 0;
  const sp = centerline(startT);
  const stan = centerlineTangent(startT);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK.width, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xe8eaf0, roughness: 0.7 }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(stan.x, stan.z);
  line.position.set(sp.x, heightAt(sp.x, sp.z) + 0.04, sp.z);
  group.add(line);

  return group;
}

/** Кузов Scirocco — упрощённый, но узнаваемый силуэт. */
function buildBody() {
  const body = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: 0xb42b28,
    roughness: 0.32,
    metalness: 0.62,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x10151c,
    roughness: 0.1,
    metalness: 0.4,
    transparent: true,
    opacity: 0.82,
  });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.52, 4.24), paint);
  lower.position.y = 0.52;
  lower.castShadow = true;
  body.add(lower);

  const mid = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.34, 3.5), paint);
  mid.position.y = 0.86;
  body.add(mid);

  const greenhouse = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.46, 2.1), glass);
  greenhouse.position.set(0, 1.2, -0.12);
  body.add(greenhouse);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.1, 1.9), paint);
  roof.position.set(0, 1.44, -0.16);
  body.add(roof);

  // фары
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d0,
    emissive: 0xffd98a,
    emissiveIntensity: 1.6,
  });
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.08), lampMat);
    lamp.position.set(sx * 0.6, 0.72, 2.12);
    body.add(lamp);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x8c1410,
        emissive: 0xd8221a,
        emissiveIntensity: 1.1,
      }),
    );
    tail.position.set(sx * 0.62, 0.78, -2.12);
    body.add(tail);
  }

  const splitter = new THREE.Mesh(
    new THREE.BoxGeometry(1.84, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }),
  );
  splitter.position.set(0, 0.3, 2.06);
  body.add(splitter);

  return body;
}

function buildWheel(radius = 0.317) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.225, 26),
    new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.95 }),
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.66, radius * 0.66, 0.235, 20),
    new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.3, metalness: 0.85 }),
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);

  for (let i = 0; i < 5; i += 1) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, radius * 1.15, 0.055),
      new THREE.MeshStandardMaterial({ color: 0xd3d8df, roughness: 0.25, metalness: 0.9 }),
    );
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    g.add(spoke);
  }
  return g;
}

/** Пружина как настоящая спираль — перестраивается по ходу подвески. */
function buildSpring(coils = 7, radius = 0.075) {
  const pts = [];
  const n = coils * 16;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, i / n, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, n, 0.011, 7, false);
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xd94f2b, roughness: 0.45, metalness: 0.7 }),
  );
}

export function buildCar() {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  chassis.add(buildBody());

  const wheels = [];
  const springs = [];
  const dampers = [];
  const layout = [
    { x: -0.77, z: 1.289 },
    { x: 0.77, z: 1.289 },
    { x: -0.757, z: -1.289 },
    { x: 0.757, z: -1.289 },
  ];

  for (const l of layout) {
    const hub = new THREE.Group();
    hub.position.set(l.x, 0.317, l.z);
    const wheel = buildWheel();
    hub.add(wheel);
    chassis.add(hub);
    wheels.push({ hub, wheel });

    const spring = buildSpring();
    spring.position.set(l.x * 0.82, 0.42, l.z * 0.94);
    spring.scale.y = 0.34;
    chassis.add(spring);
    springs.push(spring);

    const damper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x8f959e, roughness: 0.35, metalness: 0.8 }),
    );
    damper.position.set(l.x * 0.82, 0.6, l.z * 0.94);
    chassis.add(damper);
    dampers.push(damper);
  }

  return { root, chassis, wheels, springs, dampers };
}

export function createLighting(scene) {
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2f3a2a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(48, 78, 34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  const d = 60;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  scene.add(sun);
  scene.fog = new THREE.Fog(0x9fb6d4, 130, 420);
  return sun;
}
