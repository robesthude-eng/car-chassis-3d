import * as THREE from "three";
import {
  SIDE_RAIL_PATH,
  SIDE_RAIL_SECTION,
  railOutline,
  railYAt,
} from "./railProfile.js";

/* ═══════════════════════════════════════════════════════════════════════════
   ЛОНЖЕРОН РАМЫ — одна цельная деталь вместо трёх коробов.

   Все изгибы балки лежат в плоскости ZY, а ширина по X постоянна. Поэтому
   достаточно выдавить замкнутый плоский контур вдоль X. Угловые стыки
   получаются сами собой: у соседних участков общие вершины, так что ни
   щелей, ни ступенек быть не может в принципе.

   ОРИЕНТАЦИЯ. После rotation.y = -π/2 локальная точка (x, y, z) уезжает в
   (-z, y, x). Значит ось X контура становится мировым +Z, ось Y остаётся
   высотой, а глубина выдавливания уходит в мировой -X. Отсюда сдвиг
   position.x = x + width/2, чтобы балка стояла ровно по центру на x.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Геометрия балки из произвольного замкнутого контура [{z, y}, …].
 */
export function createSweptBeamGeometry(outline, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0].z, outline[0].y);
  for (let i = 1; i < outline.length; i++) {
    shape.lineTo(outline[i].z, outline[i].y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.computeVertexNormals();
  return geometry;
}

export function createSideRailGeometry({
  path = SIDE_RAIL_PATH,
  section = SIDE_RAIL_SECTION,
} = {}) {
  return createSweptBeamGeometry(railOutline(path, section.height), section.width);
}

/**
 * Готовый лонжерон, стоящий по центру на координате x.
 */
export function createSideRail({
  x,
  path = SIDE_RAIL_PATH,
  section = SIDE_RAIL_SECTION,
  material,
  name = "sideRail",
} = {}) {
  const mesh = new THREE.Mesh(createSideRailGeometry({ path, section }), material);
  mesh.name = name;
  mesh.rotation.y = -Math.PI / 2;
  mesh.position.x = x + section.width * 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Точка крепления на лонжероне. Всё, что садится на раму, должно брать
 * высоту отсюда, а не из зашитой константы.
 */
export function railAnchor(z, side = 1, {
  path = SIDE_RAIL_PATH,
  section = SIDE_RAIL_SECTION,
  railX = 0.45,
} = {}) {
  const y = railYAt(z, path);
  const half = section.height * 0.5;
  return {
    x: side * railX,
    y,
    z,
    top: y + half,
    bottom: y - half,
    innerX: side * (railX - section.width * 0.5),
    outerX: side * (railX + section.width * 0.5),
  };
}
