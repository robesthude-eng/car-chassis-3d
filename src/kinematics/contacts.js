import { clamp } from "../utils.js";
import { TIRE_RADIUS } from "../data/physics.js";

/** Максимальное сжатие пятна контакта, м. Дальше шина — твёрдое тело. */
export const TIRE_MAX_SQUASH = 0.022;
export const FLOOR_CLEARANCE = 0.008;
/** Цапфа/ступица без колеса не проваливается сквозь площадку. */
export const KNUCKLE_REST_RADIUS = 0.09;
/** Низ лонжерона кузова в локали рамы: центр 0.22, высота 0.09. */
export const RAIL_BOTTOM_LOCAL = 0.175;
export const SUBFRAME_RAIL_LOCAL_Y = 0.012;
export const SUBFRAME_HALF_H = 0.0375;
export const WHEEL_SLIDE_OFF_HUB = 0.07;

export function restOnPadY(groundY, radius) {
  return groundY + radius;
}

export function tireMinCenterY(
  groundY,
  tireRadius = TIRE_RADIUS,
  maxSquash = TIRE_MAX_SQUASH,
) {
  return groundY + tireRadius - maxSquash;
}

/**
 * Жёсткий контакт с площадкой: центр не опускается ниже радиуса минус squash.
 * Используется и для шины, и для цапфы без колеса.
 */
export function resolveVerticalContact(
  y,
  v,
  groundY,
  groundV,
  radius,
  maxSquash = 0,
) {
  const minY = groundY + radius - maxSquash;
  if (y < minY) {
    return {
      y: minY,
      v: Math.max(v, groundV),
      penetration: minY - y,
    };
  }
  return { y, v, penetration: 0 };
}

export function minBodyY(
  railBottomLocal = RAIL_BOTTOM_LOCAL,
  floorY = 0,
  clearance = FLOOR_CLEARANCE,
) {
  return floorY + clearance - railBottomLocal;
}

export function minSubframeSag(
  nominalY,
  railLocalY = SUBFRAME_RAIL_LOCAL_Y,
  halfH = SUBFRAME_HALF_H,
  floorY = 0,
  clearance = FLOOR_CLEARANCE,
) {
  return floorY + clearance + halfH - nominalY - railLocalY;
}

/**
 * Снятое колесо лежит на площадке и сдвигается с ступицы,
 * а не проваливается сквозь пол и не остаётся внутри цапфы.
 */
export function droppedWheelLocalOffset({
  wcY,
  sign,
  groundY,
  bolted,
  tireRadius = TIRE_RADIUS,
  slide = WHEEL_SLIDE_OFF_HUB,
}) {
  if (bolted) return { x: 0, y: 0, z: 0 };
  return {
    x: sign * slide,
    y: restOnPadY(groundY, tireRadius) - wcY,
    z: 0,
  };
}

/** Дополнительный угол рычага, чтобы шаровая не ушла ниже площадки. */
export function limitArmSag(extraSag, sign, armAngle, pivotY, armLen, minBjY) {
  const minSin = clamp((minBjY - pivotY) / Math.max(0.05, armLen), -0.86, 0.86);
  const minAngle = Math.asin(minSin);
  if (sign > 0) {
    return clamp(extraSag, minAngle - armAngle, extraSag);
  }
  return clamp(extraSag, extraSag, minAngle - sign * armAngle);
}
