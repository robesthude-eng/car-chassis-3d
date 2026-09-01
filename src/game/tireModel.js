/**
 * Pacejka "Magic Formula" 96 — упрощённая, но честная реализация.
 * Считает продольную и боковую силы шины и объединяет их через
 * эллипс сцепления (friction circle), чтобы шина не могла отдать
 * больше суммарной силы, чем позволяет пятно контакта.
 */

const DEG = Math.PI / 180;

/** Коэффициенты продольной силы (Fx) — 205/40 R18, лето. */
export const LONG_COEFF = Object.freeze({
  b0: 1.65,
  b1: 0,
  b2: 1100,
  b3: 0,
  b4: 300,
  b5: 0,
  b6: 0,
  b7: 0,
  b8: -2,
  b9: 0,
  b10: 0,
  b13: 0,
});

/** Коэффициенты боковой силы (Fy). */
export const LAT_COEFF = Object.freeze({
  a0: 1.4,
  a1: -22,
  a2: 1011,
  a3: 1078,
  a4: 1.82,
  a5: 0.208,
  a6: 0,
  a7: -0.354,
  a8: 0.707,
  a9: 0.028,
  a10: 0,
  a11: 14.8,
  a12: 0.022,
  a13: 0,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Продольная сила шины.
 * @param {number} slipRatio безразмерное проскальзывание, обычно -1..1
 * @param {number} fz вертикальная нагрузка, Н
 * @param {number} mu коэффициент сцепления покрытия
 */
export function longitudinalForce(slipRatio, fz, mu = 1) {
  if (fz <= 0) return 0;
  const fzk = fz / 1000; // Pacejka работает в кН
  const c = LONG_COEFF;
  const slipPct = clamp(slipRatio, -1.5, 1.5) * 100;

  const D = (c.b1 * fzk + c.b2) * fzk;
  if (D === 0) return 0;
  const B = ((c.b3 * fzk + c.b4) * fzk * Math.exp(-c.b5 * fzk)) / (c.b0 * D);
  const E = (c.b6 * fzk * fzk + c.b7 * fzk + c.b8) * (1 - c.b13 * Math.sign(slipPct));
  const Ez = Number.isFinite(E) ? clamp(E, -3, 1) : 0;

  const phi = (1 - Ez) * B * slipPct + Ez * Math.atan(B * slipPct);
  return mu * D * Math.sin(c.b0 * Math.atan(phi));
}

/**
 * Боковая сила шины.
 * @param {number} slipAngle угол увода, радианы
 * @param {number} fz вертикальная нагрузка, Н
 * @param {number} camber развал, радианы
 * @param {number} mu коэффициент сцепления
 */
export function lateralForce(slipAngle, fz, camber = 0, mu = 1) {
  if (fz <= 0) return 0;
  const fzk = fz / 1000;
  const a = LAT_COEFF;
  const alphaDeg = clamp(slipAngle, -0.6, 0.6) / DEG;
  const camberDeg = camber / DEG;

  const D = (a.a1 * fzk + a.a2) * fzk;
  if (D === 0) return 0;
  const BCD = a.a3 * Math.sin(2 * Math.atan(fzk / a.a4)) * (1 - a.a5 * Math.abs(camberDeg));
  const B = BCD / (a.a0 * D);
  const E = clamp(a.a6 * fzk + a.a7, -3, 1);
  const Sh = a.a8 * camberDeg + a.a9 * fzk + a.a10;
  const Sv = (a.a11 * fzk + a.a12) * camberDeg * fzk + a.a13;

  const x = alphaDeg + Sh;
  const phi = (1 - E) * x + (E / B) * Math.atan(B * x);
  return mu * (D * Math.sin(a.a0 * Math.atan(B * phi)) + Sv);
}

/**
 * Эллипс сцепления: масштабирует пару сил так, чтобы их модуль
 * не превышал mu * fz. Это то, что даёт «срыв в занос при газе в повороте».
 */
export function frictionEllipse(fx, fy, fz, mu = 1) {
  const limit = mu * fz;
  if (limit <= 0) return { fx: 0, fy: 0, saturation: 0 };
  const mag = Math.hypot(fx, fy);
  const saturation = mag / limit;
  if (saturation <= 1) return { fx, fy, saturation };
  const k = 1 / saturation;
  return { fx: fx * k, fy: fy * k, saturation };
}

/** Проскальзывание колеса по продольной оси. */
export function slipRatio(wheelSurfaceSpeed, contactSpeed) {
  const denom = Math.max(1.5, Math.abs(contactSpeed));
  return clamp((wheelSurfaceSpeed - contactSpeed) / denom, -1.5, 1.5);
}

/** Угол увода колеса. */
export function slipAngle(lateralSpeed, longitudinalSpeed) {
  if (Math.abs(longitudinalSpeed) < 0.6) return 0;
  return Math.atan2(-lateralSpeed, Math.abs(longitudinalSpeed));
}

export { clamp };
