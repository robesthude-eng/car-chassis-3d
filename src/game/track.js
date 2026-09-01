/**
 * Трасса: рельеф, покрытие и контрольные точки круга.
 * Высоты и коэффициент сцепления считаются аналитически,
 * поэтому физика и меш всегда согласованы.
 */

const TAU = Math.PI * 2;

export const TRACK = Object.freeze({
  radiusX: 132,
  radiusZ: 92,
  width: 15,
  laps: 3,
});

/** Осевая линия трассы — вытянутое кольцо с шиканой. */
export function centerline(t) {
  const a = t * TAU;
  const wobble = Math.sin(a * 3) * 13 + Math.sin(a * 5 + 1.1) * 6;
  return {
    x: Math.cos(a) * (TRACK.radiusX + wobble),
    z: Math.sin(a) * (TRACK.radiusZ + wobble * 0.65),
  };
}

export function centerlineTangent(t) {
  const e = 1e-3;
  const a = centerline(t - e);
  const b = centerline(t + e);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/** Ближайшая точка осевой линии — нужна и для сцепления, и для счёта кругов. */
export function nearestOnTrack(x, z, samples = 240) {
  let best = { t: 0, dist: Infinity, px: 0, pz: 0 };
  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const p = centerline(t);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best.dist) best = { t, dist: d, px: p.x, pz: p.z };
  }
  return best;
}

/** Рельеф: плавные волны плюс лёгкая «стиральная доска» на прямой. */
export function heightAt(x, z) {
  const base =
    Math.sin(x * 0.014) * 1.15 +
    Math.cos(z * 0.019) * 0.95 +
    Math.sin((x + z) * 0.008) * 0.6;
  const ripple = Math.sin(x * 0.62) * Math.cos(z * 0.55) * 0.022;
  return base + ripple;
}

/** Асфальт на полотне, трава и гравий за пределами. */
export function muAt(x, z) {
  const near = nearestOnTrack(x, z, 120);
  const half = TRACK.width / 2;
  if (near.dist <= half) return 1.0;
  if (near.dist <= half + 3) return 0.78; // поребрик
  if (near.dist <= half + 12) return 0.55; // гравий
  return 0.42; // трава
}

export function surfaceKind(x, z) {
  const near = nearestOnTrack(x, z, 120);
  const half = TRACK.width / 2;
  if (near.dist <= half) return "asphalt";
  if (near.dist <= half + 3) return "kerb";
  if (near.dist <= half + 12) return "gravel";
  return "grass";
}

export const world = Object.freeze({ heightAt, muAt, surfaceKind, nearestOnTrack });

/** Секторы круга: пересечение по возрастанию t с защитой от срезания. */
export class LapTimer {
  constructor(sectors = 3) {
    this.sectors = sectors;
    this.reset();
  }

  reset() {
    this.lap = 0;
    this.time = 0;
    this.lapTime = 0;
    this.bestLap = null;
    this.lastLap = null;
    this.sector = 0;
    this.prevT = 0;
    this.started = false;
    this.history = [];
  }

  update(dt, t) {
    this.time += dt;
    this.lapTime += dt;

    const target = (this.sector + 1) / this.sectors;
    const crossed =
      this.prevT < target && t >= target && Math.abs(t - this.prevT) < 0.4;
    if (crossed) {
      this.sector += 1;
      if (this.sector >= this.sectors) {
        this.sector = 0;
        if (this.started) {
          this.lastLap = this.lapTime;
          if (this.bestLap === null || this.lapTime < this.bestLap) {
            this.bestLap = this.lapTime;
          }
          this.history.push(this.lapTime);
          this.lap += 1;
        }
        this.started = true;
        this.lapTime = 0;
      }
    }
    this.prevT = t;
  }
}

export function formatTime(sec) {
  if (sec === null || sec === undefined) return "--:--.---";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
