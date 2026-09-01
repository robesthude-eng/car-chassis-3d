import * as THREE from "three";
import {
  TWO_PI,
  SPRING_DEFAULTS,
  coilHeightAt,
  coilPitchAt,
  clampSpringLength,
  seatSpring,
  solidHeight,
} from "./springMath.js";

/* ═══════════════════════════════════════════════════════════════════════════
   ВИТАЯ ПРУЖИНА — геометрия перестраивается, а не масштабируется.

   ПОЧЕМУ СТАРЫЙ КОД БЫЛ НЕВЕРЕН.
   Раньше пружина была одной TubeGeometry фиксированной длины, а ход подвески
   передавался через mesh.scale.y. Но при масштабе по одной оси КРУГЛОЕ
   сечение проволоки превращается в ЭЛЛИПС: на сжатии пруток расплющивался,
   на отбое вытягивался в лапшу, а нормали портились и свет ложился неверно.
   Кроме того, масштаб ничем не ограничивался снизу, и витки проходили друг
   сквозь друга.

   КАК СДЕЛАНО СЕЙЧАС.
   Топология (индексы, UV) строится один раз, а setLength() пересчитывает только
   position и normal. Радиус проволоки остаётся постоянным при любом ходе,
   меняется только шаг витков — ровно так, как у настоящей пружины.

   СОПРОВОЖДАЮЩИЙ БАЗИС.
   Для спирали с постоянным радиусом касательная всегда перпендикулярна
   радиальному направлению (T·N = 0 тождественно). Поэтому вместо рамок
   Френе (которые умеют внезапно переворачиваться) берётся точный
   цилиндрический базис N = (cosθ, 0, sinθ), B = T × N. Он аналитичен,
   не дрейфует и не даёт скручивания по длине проволоки.
   ═══════════════════════════════════════════════════════════════════════════ */

const REBUILD_EPS = 0.0002; // 0.2 мм — меньше пикселя на экране

export class CoilSpringMesh extends THREE.Mesh {
  constructor({
    turns = SPRING_DEFAULTS.turns,
    radius = SPRING_DEFAULTS.radius,
    wireRadius = SPRING_DEFAULTS.wireRadius,
    endCoils = SPRING_DEFAULTS.endCoils,
    length = 0.28,
    freeLength = null,
    tubularSegments = Math.max(48, Math.round(turns * 26)),
    radialSegments = 8,
    material,
  } = {}) {
    const geometry = new THREE.BufferGeometry();
    super(geometry, material);

    this.turns = turns;
    this.coilRadius = radius;
    this.wireRadius = wireRadius;
    this.endCoils = endCoils;
    this.freeLength = freeLength;
    this.tubularSegments = tubularSegments;
    this.radialSegments = radialSegments;

    /* Предел сжатия: витки сомкнулись металл к металлу. */
    this.solidHeight = solidHeight(turns, wireRadius);
    /* true, когда пружина упёрлась в свой предел. */
    this.bound = false;
    this.springLength = 0;

    this._buildTopology();
    this._length = -1;
    this.setLength(length);

    this.castShadow = true;
    this.receiveShadow = true;
  }

  /* Индексы и UV от длины не зависят — считаются единожды. */
  _buildTopology() {
    const S = this.tubularSegments;
    const R = this.radialSegments;
    const bodyCount = (S + 1) * (R + 1);
    const capCount = R + 2; // центр + кольцо
    const total = bodyCount + capCount * 2;

    this._bodyCount = bodyCount;
    this._startCapBase = bodyCount;
    this._endCapBase = bodyCount + capCount;

    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const indices = [];

    // Боковая поверхность проволоки
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < R; j++) {
        const a = i * (R + 1) + j;
        const b = (i + 1) * (R + 1) + j;
        const c = (i + 1) * (R + 1) + j + 1;
        const d = i * (R + 1) + j + 1;
        indices.push(a, b, d, b, c, d);
      }
    }

    // Торцы — стёсанные концы пружины, лежащие на тарелках.
    const s0 = this._startCapBase;
    for (let j = 0; j < R; j++) {
      indices.push(s0, s0 + 1 + j + 1, s0 + 1 + j); // нормаль -T
    }
    const e0 = this._endCapBase;
    for (let j = 0; j < R; j++) {
      indices.push(e0, e0 + 1 + j, e0 + 1 + j + 1); // нормаль +T
    }

    for (let i = 0; i <= S; i++) {
      for (let j = 0; j <= R; j++) {
        const k = (i * (R + 1) + j) * 2;
        uvs[k] = i / S;
        uvs[k + 1] = j / R;
      }
    }

    const g = this.geometry;
    g.setIndex(indices);
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  /**
   * Задать длину осевой линии пружины. Значение обрезается по пределу
   * смыкания витков, поэтому взаимного проникновения не бывает никогда.
   */
  setLength(length) {
    const clamped = clampSpringLength(
      length,
      this.turns,
      this.wireRadius,
      this.freeLength,
    );
    this.bound = clamped > length + 1e-12;
    if (Math.abs(clamped - this._length) < REBUILD_EPS) return this._length;
    this._length = clamped;
    this.springLength = clamped;
    this._writeGeometry(clamped);
    return clamped;
  }

  /**
   * Посадить пружину между двумя тарелками (координаты — в системе родителя).
   * Поверхность проволоки касается обеих тарелок точно: ни зазора, ни
   * утопания. Именно этого не хватало раньше.
   */
  seatBetween(bottomY, topY) {
    const seat = seatSpring({
      gap: topY - bottomY,
      turns: this.turns,
      wireRadius: this.wireRadius,
    });
    this.position.y = bottomY + seat.offset;
    this.setLength(seat.length);
    return seat;
  }

  _writeGeometry(length) {
    const S = this.tubularSegments;
    const R = this.radialSegments;
    const turns = this.turns;
    const r = this.coilRadius;
    const wr = this.wireRadius;
    const ec = this.endCoils;

    const g = this.geometry;
    const pos = g.attributes.position.array;
    const nrm = g.attributes.normal.array;

    let startCx = 0,
      startCy = 0,
      startCz = 0,
      startTx = 0,
      startTy = 0,
      startTz = 0;
    let endCx = 0,
      endCy = 0,
      endCz = 0,
      endTx = 0,
      endTy = 0,
      endTz = 0;

    for (let i = 0; i <= S; i++) {
      const u = (i / S) * turns;
      const theta = TWO_PI * u;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);

      // Осевая линия
      const cx = r * ct;
      const cy = coilHeightAt(u, length, turns, wr, ec);
      const cz = r * st;

      // Касательная dc/du
      const pitch = coilPitchAt(u, length, turns, wr, ec);
      let tx = -r * TWO_PI * st;
      let ty = pitch;
      let tz = r * TWO_PI * ct;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;

      // N — радиальный единичный, B = T × N (тоже единичный, т.к. T ⊥ N)
      const nx = ct;
      const nz = st;
      const bx = ty * nz;
      const by = tz * nx - tx * nz;
      const bz = -ty * nx;

      for (let j = 0; j <= R; j++) {
        const phi = (j / R) * TWO_PI;
        const cf = Math.cos(phi);
        const sf = Math.sin(phi);
        const vnx = cf * nx + sf * bx;
        const vny = sf * by;
        const vnz = cf * nz + sf * bz;
        const k = (i * (R + 1) + j) * 3;
        pos[k] = cx + wr * vnx;
        pos[k + 1] = cy + wr * vny;
        pos[k + 2] = cz + wr * vnz;
        nrm[k] = vnx;
        nrm[k + 1] = vny;
        nrm[k + 2] = vnz;
      }

      if (i === 0) {
        startCx = cx;
        startCy = cy;
        startCz = cz;
        startTx = -tx;
        startTy = -ty;
        startTz = -tz;
      } else if (i === S) {
        endCx = cx;
        endCy = cy;
        endCz = cz;
        endTx = tx;
        endTy = ty;
        endTz = tz;
      }
    }

    // Торцевые крышечки: центр + копия кольца с плоской нормалью.
    this._writeCap(
      pos,
      nrm,
      this._startCapBase,
      0,
      startCx,
      startCy,
      startCz,
      startTx,
      startTy,
      startTz,
    );
    this._writeCap(
      pos,
      nrm,
      this._endCapBase,
      S,
      endCx,
      endCy,
      endCz,
      endTx,
      endTy,
      endTz,
    );

    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }

  _writeCap(pos, nrm, base, ring, cx, cy, cz, nx, ny, nz) {
    const R = this.radialSegments;
    let k = base * 3;
    pos[k] = cx;
    pos[k + 1] = cy;
    pos[k + 2] = cz;
    nrm[k] = nx;
    nrm[k + 1] = ny;
    nrm[k + 2] = nz;
    for (let j = 0; j <= R; j++) {
      const src = (ring * (R + 1) + j) * 3;
      k = (base + 1 + j) * 3;
      pos[k] = pos[src];
      pos[k + 1] = pos[src + 1];
      pos[k + 2] = pos[src + 2];
      nrm[k] = nx;
      nrm[k + 1] = ny;
      nrm[k + 2] = nz;
    }
  }

  dispose() {
    this.geometry.dispose();
  }
}
