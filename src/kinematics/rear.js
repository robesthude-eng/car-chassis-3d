import { clamp } from "../utils.js";

export function rearHubCoords(cm, loc, dxH, gam, tau, dzH = 0) {
  const sign = cm.sign;
  const lx = sign * loc[0];
  const ly = loc[1];
  const lz = loc[2];
  const cg = Math.cos(gam);
  const sg = Math.sin(gam);
  const x = lx * cg - ly * sg;
  const y = lx * sg + ly * cg;
  const z = lz;
  const ct = Math.cos(tau);
  const st = Math.sin(tau);
  const x2 = x * ct + z * st;
  const z2 = -x * st + z * ct;
  return {
    x: cm.sc.cfg.x + dxH + x2,
    y: cm.wcY + y,
    z: cm.sc.cfg.z + dzH + z2,
  };
}

export function writePoint(out, point) {
  if (typeof out.set === "function") return out.set(point.x, point.y, point.z);
  out.x = point.x;
  out.y = point.y;
  out.z = point.z;
  return out;
}

export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function det3(a11, a12, a13, a21, a22, a23, a31, a32, a33) {
  return (
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31)
  );
}

function solve3(a11, a12, a13, a21, a22, a23, a31, a32, a33, b1, b2, b3) {
  const det = det3(a11, a12, a13, a21, a22, a23, a31, a32, a33);
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    det3(b1, a12, a13, b2, a22, a23, b3, a32, a33) / det,
    det3(a11, b1, a13, a21, b2, a23, a31, b3, a33) / det,
    det3(a11, a12, b1, a21, a22, b2, a31, a32, b3) / det,
  ];
}

export function solveRearPose(cm, inners, lengths, locs, opts = {}) {
  const h = opts.h ?? 2e-4;
  const iters = opts.iters ?? 6;
  let dxH = cm.dxH ?? 0;
  let gam = cm.camber ?? 0;
  let dzH = cm.dzH ?? 0;
  let tau = cm.toe ?? 0;

  const residual = (key, loc, len, dx, g, t, dz) =>
    dist3(rearHubCoords(cm, loc, dx, g, t, dz), inners[key]) - len;

  for (let it = 0; it < iters; it++) {
    const f1 = residual("up", locs.upOut, lengths.LU, dxH, gam, 0, dzH);
    const f2 = residual("cam", locs.camOut, lengths.LC, dxH, gam, 0, dzH);
    const f3 = residual("tr", locs.trOut, lengths.LTR, dxH, gam, 0, dzH);
    const a11 =
      (residual("up", locs.upOut, lengths.LU, dxH + h, gam, 0, dzH) - f1) / h;
    const a12 =
      (residual("up", locs.upOut, lengths.LU, dxH, gam + h, 0, dzH) - f1) / h;
    const a13 =
      (residual("up", locs.upOut, lengths.LU, dxH, gam, 0, dzH + h) - f1) / h;
    const a21 =
      (residual("cam", locs.camOut, lengths.LC, dxH + h, gam, 0, dzH) - f2) / h;
    const a22 =
      (residual("cam", locs.camOut, lengths.LC, dxH, gam + h, 0, dzH) - f2) / h;
    const a23 =
      (residual("cam", locs.camOut, lengths.LC, dxH, gam, 0, dzH + h) - f2) / h;
    const a31 =
      (residual("tr", locs.trOut, lengths.LTR, dxH + h, gam, 0, dzH) - f3) / h;
    const a32 =
      (residual("tr", locs.trOut, lengths.LTR, dxH, gam + h, 0, dzH) - f3) / h;
    const a33 =
      (residual("tr", locs.trOut, lengths.LTR, dxH, gam, 0, dzH + h) - f3) / h;
    const step = solve3(
      a11,
      a12,
      a13,
      a21,
      a22,
      a23,
      a31,
      a32,
      a33,
      f1,
      f2,
      f3,
    );
    if (!step) break;
    dxH -= clamp(step[0], -0.02, 0.02);
    gam -= clamp(step[1], -0.08, 0.08);
    dzH -= clamp(step[2], -0.02, 0.02);
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-7) break;
  }

  for (let it = 0; it < 4; it++) {
    const f = residual("toe", locs.toeOut, lengths.LT, dxH, gam, tau, dzH);
    const d =
      (residual("toe", locs.toeOut, lengths.LT, dxH, gam, tau + h, dzH) - f) /
      h;
    if (!isFinite(d) || Math.abs(d) < 1e-9) break;
    const stepTau = clamp(f / d, -0.05, 0.05);
    tau -= stepTau;
    if (Math.abs(stepTau) < 1e-6) break;
  }

  return {
    dxH: clamp(dxH, -0.09, 0.09),
    camber: clamp(gam, -0.2, 0.2),
    dzH: clamp(dzH, -0.06, 0.06),
    toe: clamp(tau, -0.09, 0.09),
  };
}

export function rearLinkLengths(cm, inners, locs) {
  const at = (loc) => rearHubCoords(cm, loc, 0, 0, 0, 0);
  return {
    LU: dist3(at(locs.upOut), inners.up),
    LC: dist3(at(locs.camOut), inners.cam),
    LT: dist3(at(locs.toeOut), inners.toe),
    LTR: dist3(at(locs.trOut), inners.tr),
    LSPL: dist3(at(locs.splOut), inners.spl),
  };
}
