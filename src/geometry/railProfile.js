/* ═══════════════════════════════════════════════════════════════════════════
   ПРОФИЛЬ ЛОНЖЕРОНА РАМЫ

   Модуль без Three.js и DOM — проверяется тестами Node.

   Раньше лонжерон собирался из трёх НЕСВЯЗАННЫХ коробов: ровная балка и два
   повёрнутых на ±0.1 рад куска. Концы повёрнутых кусков оказывались на 4–6 см
   выше ровной балки — в картинке были видны ступеньки и разрывы.

   Здесь лонжерон задан ОДНОЙ ломаной в плоскости ZY. Все изгибы — только в
   этой плоскости, а ширина по X постоянна. Значит, балку можно получить
   выдавливанием ЗАМКНУТОГО контура вдоль X — одна цельная деталь без швов,
   с автоматически правильными угловыми стыками.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SIDE_RAIL_SECTION = Object.freeze({
  width: 0.062,
  height: 0.092,
});

/* Осевая линия лонжерона: подъём над передней осью, ровный участок под
   полом салона, арка над задней осью. Отсортирована по z. */
export const SIDE_RAIL_PATH = Object.freeze(
  [
    { z: -1.72, y: 0.302 },
    { z: -1.46, y: 0.292 },
    { z: -1.18, y: 0.248 },
    { z: -0.86, y: 0.224 },
    { z: -0.05, y: 0.218 },
    { z: 0.72, y: 0.226 },
    { z: 1.04, y: 0.256 },
    { z: 1.34, y: 0.296 },
    { z: 1.7, y: 0.306 },
  ].map((node) => Object.freeze(node)),
);

/**
 * Высота осевой линии лонжерона в заданном z. Нужна, чтобы все чашки,
 * аутригеры и раскосы садились НА балку, а не висели рядом с ней.
 */
export function railYAt(z, path = SIDE_RAIL_PATH) {
  if (z <= path[0].z) return path[0].y;
  const last = path[path.length - 1];
  if (z >= last.z) return last.y;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return a.y + (b.y - a.y) * t;
    }
  }
  return last.y;
}

/** Верхняя полка лонжерона. */
export function railTopAt(z, path = SIDE_RAIL_PATH, height = SIDE_RAIL_SECTION.height) {
  return railYAt(z, path) + height * 0.5;
}

/** Нижняя полка лонжерона. */
export function railBottomAt(z, path = SIDE_RAIL_PATH, height = SIDE_RAIL_SECTION.height) {
  return railYAt(z, path) - height * 0.5;
}

/**
 * Замкнутый контур лонжерона в координатах (z, y): сначала вся верхняя
 * полка вперёд, затем вся нижняя обратно. Стыки получаются точными
 * автоматически: у соседних участков ОБЩАЯ вершина.
 */
export function railOutline(
  path = SIDE_RAIL_PATH,
  height = SIDE_RAIL_SECTION.height,
) {
  const half = height * 0.5;
  const top = path.map((node) => ({ z: node.z, y: node.y + half }));
  const bottom = path
    .map((node) => ({ z: node.z, y: node.y - half }))
    .reverse();
  return [...top, ...bottom];
}

/**
 * Максимальный излом ломаной в градусах. Служебная величина для тестов:
 * если излом становится большим, контур перестанет быть простым и
 * выдавливание даст самопересечение.
 */
export function maxRailKinkDeg(path = SIDE_RAIL_PATH) {
  let worst = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const a1 = Math.atan2(b.y - a.y, b.z - a.z);
    const a2 = Math.atan2(c.y - b.y, c.z - b.z);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = Math.PI * 2 - d;
    worst = Math.max(worst, (d * 180) / Math.PI);
  }
  return worst;
}

/**
 * Проверка, что контур не самопересекается: верхняя полка всегда выше
 * нижней и ломаная строго монотонна по z.
 */
export function isRailOutlineSimple(
  path = SIDE_RAIL_PATH,
  height = SIDE_RAIL_SECTION.height,
) {
  for (let i = 1; i < path.length; i++) {
    if (!(path[i].z > path[i - 1].z)) return false;
  }
  const maxSlopeDeg = 90 - 1e-9;
  for (let i = 1; i < path.length; i++) {
    const dz = path[i].z - path[i - 1].z;
    const dy = path[i].y - path[i - 1].y;
    const slope = (Math.abs(Math.atan2(dy, dz)) * 180) / Math.PI;
    if (slope >= maxSlopeDeg) return false;
  }
  return height > 0;
}
