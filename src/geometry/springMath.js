/* ═══════════════════════════════════════════════════════════════════════════
   МАТЕМАТИКА ЦИЛИНДРИЧЕСКОЙ ВИТОЙ ПРУЖИНЫ

   Модуль намеренно не знает ни о Three.js, ни о DOM: его можно проверить
   обычными тестами Node. Ключевая идея — пружина НИКОГДА не масштабируется
   как меш. Меняется только шаг навивки, а диаметр прутка остаётся постоянным,
   потому что у настоящей пружины сжимается расстояние между витками, а не сам
   пруток.

   Закон шага:
       pitch(u) = dWire + (pitchActive - dWire) * w(u),   u — номер витка

   где w(u) — гладкая форма от 0 на торцах до 1 в рабочей части, dWire —
   диаметр прутка. Отсюда сразу два важных свойства:

     • pitch(u) >= dWire всюду ⇒ витки физически не могут пройти друг
       через друга ни при каком сжатии;
     • на торцах pitch = dWire ⇒ крайние витки поджаты и лежат на соседнем
       витке, то есть получаются настоящие «закрытые» опорные витки.
   ═══════════════════════════════════════════════════════════════════════════ */

export const TWO_PI = Math.PI * 2;

export const SPRING_DEFAULTS = Object.freeze({
  turns: 7,
  radius: 0.05,
  wireRadius: 0.008,
  /* Сколько витков на каждом торце уходит на поджатие (переходной участок). */
  endCoils: 0.85,
});

const smoothstep = (t) => t * t * (3 - 2 * t);

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/* Форма шага: 0 на торцах, 1 в рабочей части. Симметрична и гладкая (C¹). */
export function pitchShape(u, turns, endCoils) {
  const transition = Math.min(endCoils, turns * 0.5);
  if (!(transition > 0)) return 1;
  const edge = Math.min(u, turns - u);
  return smoothstep(clamp01(edge / transition));
}

/* ∫₀^turns w(u) du в замкнутой форме: интеграл smoothstep на [0,1] равен ½,
   поэтому каждый переходной участок даёт ровно половину своей длины. */
export function pitchShapeIntegral(turns, endCoils) {
  const transition = Math.min(endCoils, turns * 0.5);
  return turns - transition;
}

/* Высота полностью сжатой пружины по осевой линии: все витки соприкасаются. */
export function solidCenterlineHeight(turns, wireRadius) {
  return turns * 2 * wireRadius;
}

/* Габаритная высота сжатой пружины с учётом толщины крайних витков. */
export function solidHeight(turns, wireRadius) {
  return solidCenterlineHeight(turns, wireRadius) + 2 * wireRadius;
}

/* Шаг рабочей части, обеспечивающий заданную длину осевой линии. */
export function activePitch(length, turns, wireRadius, endCoils) {
  const dWire = 2 * wireRadius;
  const shapeIntegral = pitchShapeIntegral(turns, endCoils);
  if (!(shapeIntegral > 0)) return dWire;
  return dWire + (length - dWire * turns) / shapeIntegral;
}

/* Профиль высоты: h(0) = 0, h(turns) = length, монотонно возрастает. */
export function coilHeightAt(u, length, turns, wireRadius, endCoils) {
  const dWire = 2 * wireRadius;
  const pitchActive = activePitch(length, turns, wireRadius, endCoils);
  const extra = pitchActive - dWire;
  const transition = Math.min(endCoils, turns * 0.5);

  /* ∫₀^u w(u) du: на переходных участках берём интеграл smoothstep
     аналитически (∫ t²(3-2t) dt = t³ - t⁴/2), в середине — линейно. */
  const shapeArea = (from, to) => {
    if (to <= from) return 0;
    if (!(transition > 0)) return to - from;
    const headEnd = Math.min(to, transition);
    const tailStart = Math.max(from, turns - transition);
    let area = 0;
    if (headEnd > from) {
      const a = clamp01(from / transition);
      const b = clamp01(headEnd / transition);
      const F = (t) => (t * t * t - (t * t * t * t) / 2) * transition;
      area += F(b) - F(a);
    }
    const midFrom = Math.max(from, transition);
    const midTo = Math.min(to, turns - transition);
    if (midTo > midFrom) area += midTo - midFrom;
    if (to > tailStart) {
      const a = clamp01((turns - to) / transition);
      const b = clamp01((turns - tailStart) / transition);
      const F = (t) => (t * t * t - (t * t * t * t) / 2) * transition;
      area += F(b) - F(a);
    }
    return area;
  };

  return dWire * u + extra * shapeArea(0, u);
}

/* Мгновенный шаг навивки — нужен для касательной к осевой линии. */
export function coilPitchAt(u, length, turns, wireRadius, endCoils) {
  const dWire = 2 * wireRadius;
  const pitchActive = activePitch(length, turns, wireRadius, endCoils);
  return dWire + (pitchActive - dWire) * pitchShape(u, turns, endCoils);
}

/* Рабочая длина, приведённая к физическим границам: пружина не может стать
   короче высоты сжатия и не должна растягиваться сверх свободной длины. */
export function clampSpringLength(length, turns, wireRadius, freeLength) {
  const min = solidCenterlineHeight(turns, wireRadius);
  const max = Number.isFinite(freeLength) ? Math.max(min, freeLength) : Infinity;
  if (!Number.isFinite(length)) return min;
  return Math.min(max, Math.max(min, length));
}

/* ── ПОСАДКА ПРУЖИНЫ МЕЖДУ ЧАШКАМИ ──
   На вход идёт чистый зазор между опорными поверхностями. Осевая линия
   отступает от каждой чашки на радиус прутка, поэтому поверхность крайнего
   витка касается чашки ровно, без зазора и без утопания в металл. */
export function seatSpring({ gap, turns, wireRadius }) {
  const dWire = 2 * wireRadius;
  const requested = gap - dWire;
  const min = solidCenterlineHeight(turns, wireRadius);
  const length = Math.max(min, requested);
  return Object.freeze({
    /* смещение начала осевой линии от опорной поверхности */
    offset: wireRadius,
    length,
    /* габаритная высота вместе с прутком — должна совпасть с gap */
    height: length + dWire,
    /* true, если пружина упёрлась в высоту сжатия (коил-байнд) */
    bound: requested < min - 1e-12,
  });
}

/* Полная осевая линия. Возвращает простые объекты — удобно для тестов;
   для отрисовки используется потоковая версия в CoilSpringMesh. */
export function coilSpringCenterline({
  turns = SPRING_DEFAULTS.turns,
  radius = SPRING_DEFAULTS.radius,
  wireRadius = SPRING_DEFAULTS.wireRadius,
  endCoils = SPRING_DEFAULTS.endCoils,
  length = 0.3,
  samples = 240,
} = {}) {
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const u = (i / samples) * turns;
    const theta = u * TWO_PI;
    points.push({
      u,
      x: Math.cos(theta) * radius,
      y: coilHeightAt(u, length, turns, wireRadius, endCoils),
      z: Math.sin(theta) * radius,
    });
  }
  return points;
}

/* Минимальный просвет между соседними витками по всей длине. Отрицательное
   значение означало бы, что витки прошли друг через друга. */
export function minimumCoilGap({
  turns = SPRING_DEFAULTS.turns,
  wireRadius = SPRING_DEFAULTS.wireRadius,
  endCoils = SPRING_DEFAULTS.endCoils,
  length = 0.3,
  samples = 240,
} = {}) {
  let worst = Infinity;
  for (let i = 0; i <= samples; i++) {
    const u = (i / samples) * turns;
    if (u + 1 > turns) break;
    const here = coilHeightAt(u, length, turns, wireRadius, endCoils);
    const above = coilHeightAt(u + 1, length, turns, wireRadius, endCoils);
    worst = Math.min(worst, above - here - 2 * wireRadius);
  }
  return worst === Infinity ? 0 : worst;
}
