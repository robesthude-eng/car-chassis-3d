/**
 * three-lite: крошечная заглушка three.js без зависимостей.
 * Нужна только для того, чтобы прогнать buildVehicle() в Node и посчитать
 * мировые габариты деталей (проверка зазоров). Ничего не рисует.
 */
export const BackSide = 1, FrontSide = 0, DoubleSide = 2;

export class Color {
	constructor(v) { this.v = v || 0; }
	set(v) { this.v = v; return this; }
	setHex(v) { this.v = v; return this; }
	getHex() { return this.v; }
	clone() { return new Color(this.v); }
}

export class Vector2 {
	constructor(x = 0, y = 0) { this.x = x; this.y = y; }
	set(x, y) { this.x = x; this.y = y; return this; }
	clone() { return new Vector2(this.x, this.y); }
}

export class Vector3 {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
	setScalar(s) { return this.set(s, s, s); }
	copy(v) { return this.set(v.x, v.y, v.z); }
	clone() { return new Vector3(this.x, this.y, this.z); }
	add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
	addVectors(a, b) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z); }
	sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
	subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
	addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
	multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
	divideScalar(s) { return this.multiplyScalar(1 / (s || 1)); }
	lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
	length() { return Math.sqrt(this.lengthSq()); }
	normalize() { return this.divideScalar(this.length() || 1); }
	negate() { return this.multiplyScalar(-1); }
	dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
	distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
	crossVectors(a, b) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
	cross(v) { return this.crossVectors(this.clone(), v); }
	lerpVectors(a, b, t) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
	lerp(v, t) { return this.lerpVectors(this.clone(), v, t); }
	min(v) { return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z)); }
	max(v) { return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z)); }
	rotateY() { return this; }
	applyQuaternion(q) {
		const { x, y, z } = this, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z;
		const iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
		return this.set(
			ix * qw + iw * -qx + iy * -qz - iz * -qy,
			iy * qw + iw * -qy + iz * -qx - ix * -qz,
			iz * qw + iw * -qz + ix * -qy - iy * -qx,
		);
	}
	toArray() { return [this.x, this.y, this.z]; }
}

export class Euler {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
	copy(e) { return this.set(e.x, e.y, e.z); }
}

export class Quaternion {
	constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; this.touched = false; }
	set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; this.touched = true; return this; }
	copy(q) { return this.set(q.x, q.y, q.z, q.w); }
	normalize() {
		const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
		this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this;
	}
	setFromUnitVectors(from, to) {
		const r = from.dot(to) + 1;
		if (r < 1e-8) {
			if (Math.abs(from.x) > Math.abs(from.z)) this.set(-from.y, from.x, 0, 0);
			else this.set(0, -from.z, from.y, 0);
		} else {
			this.set(from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z, from.x * to.y - from.y * to.x, r);
		}
		return this.normalize();
	}
}

const bb = (a, b, c, d, e, f) => ({ min: [a, b, c], max: [d, e, f] });

class Geo {
	constructor(type, parameters, box) { this.type = type; this.parameters = parameters; this.box = box; }
	clone() { const g = new Geo(this.type, this.parameters, bb(...this.box.min, ...this.box.max)); return g; }
	computeVertexNormals() { return this; }
	dispose() {}
	translate(x, y, z) {
		this.box = bb(this.box.min[0] + x, this.box.min[1] + y, this.box.min[2] + z,
			this.box.max[0] + x, this.box.max[1] + y, this.box.max[2] + z);
		return this;
	}
	scale(x, y, z) {
		const s = [x, y, z];
		this.box = bb(
			...[0, 1, 2].map((i) => Math.min(this.box.min[i] * s[i], this.box.max[i] * s[i])),
			...[0, 1, 2].map((i) => Math.max(this.box.min[i] * s[i], this.box.max[i] * s[i])),
		);
		return this;
	}
	_rot(axis, a) {
		const c = Math.cos(a), s = Math.sin(a), pts = [];
		for (const X of [this.box.min[0], this.box.max[0]])
			for (const Y of [this.box.min[1], this.box.max[1]])
				for (const Z of [this.box.min[2], this.box.max[2]]) {
					if (axis === "x") pts.push([X, Y * c - Z * s, Y * s + Z * c]);
					else if (axis === "y") pts.push([X * c + Z * s, Y, -X * s + Z * c]);
					else pts.push([X * c - Y * s, X * s + Y * c, Z]);
				}
		this.box = bb(...[0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))),
			...[0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))));
		return this;
	}
	rotateX(a) { return this._rot("x", a); }
	rotateY(a) { return this._rot("y", a); }
	rotateZ(a) { return this._rot("z", a); }
}

export class BoxGeometry extends Geo {
	constructor(w = 1, h = 1, d = 1) { super("Box", { width: w, height: h, depth: d }, bb(-w / 2, -h / 2, -d / 2, w / 2, h / 2, d / 2)); }
}
export class CylinderGeometry extends Geo {
	constructor(rt = 1, rb = 1, h = 1) {
		const r = Math.max(rt, rb);
		super("Cylinder", { radiusTop: rt, radiusBottom: rb, height: h }, bb(-r, -h / 2, -r, r, h / 2, r));
	}
}
export class ConeGeometry extends Geo {
	constructor(r = 1, h = 1) { super("Cone", { radius: r, height: h }, bb(-r, -h / 2, -r, r, h / 2, r)); }
}
export class SphereGeometry extends Geo {
	constructor(r = 1) { super("Sphere", { radius: r }, bb(-r, -r, -r, r, r, r)); }
}
export class TorusGeometry extends Geo {
	constructor(r = 1, tube = 0.4) { super("Torus", { radius: r, tube }, bb(-(r + tube), -(r + tube), -tube, r + tube, r + tube, tube)); }
}
export class LatheGeometry extends Geo {
	constructor(points = []) {
		const rmax = Math.max(...points.map((p) => Math.abs(p.x)));
		const ys = points.map((p) => p.y);
		super("Lathe", { points }, bb(-rmax, Math.min(...ys), -rmax, rmax, Math.max(...ys), rmax));
	}
}
export class CatmullRomCurve3 {
	constructor(points = []) { this.points = points; }
	getPoints() { return this.points; }
	getPointAt() { return this.points[0]; }
}
export class TubeGeometry extends Geo {
	constructor(curve, seg = 8, radius = 1) {
		const pts = (curve.points || []).map((p) => p.toArray());
		super("Tube", { radius },
			bb(...[0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) - radius),
				...[0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) + radius)));
	}
}

let uid = 0;
function srcLine() {
	const m = (new Error().stack || "").match(/vehicle\.js:(\d+):/);
	return m ? Number(m[1]) : 0;
}

export class Object3D {
	constructor() {
		this.uuid = ++uid;
		this.position = new Vector3();
		this.rotation = new Euler();
		this.scale = new Vector3(1, 1, 1);
		this.quaternion = new Quaternion();
		this.children = [];
		this.parent = null;
		this.visible = true;
		this.name = "";
		this.userData = {};
		this.castShadow = false;
		this.receiveShadow = false;
		this.srcLine = srcLine();
	}
	add(...objs) { for (const o of objs) { if (!o) continue; o.parent = this; this.children.push(o); } return this; }
	remove(o) { this.children = this.children.filter((c) => c !== o); return this; }
	traverse(cb) { cb(this); for (const c of this.children) c.traverse(cb); }
	clone() {
		const c = new this.constructor(this.geometry, this.material);
		c.position.copy(this.position); c.rotation.copy(this.rotation);
		c.scale.copy(this.scale); c.quaternion.copy(this.quaternion);
		c.srcLine = this.srcLine;
		for (const ch of this.children) c.add(ch.clone());
		return c;
	}
	getWorldPosition(t) { const w = worldOf(this); return (t || new Vector3()).set(w.t[0], w.t[1], w.t[2]); }
	lookAt() { return this; }
	rotateY(a) { this.rotation.y += a; return this; }
	updateMatrixWorld() { return this; }
}
export class Group extends Object3D { constructor() { super(); this.type = "Group"; } }
export class Mesh extends Object3D {
	constructor(geometry, material) { super(); this.type = "Mesh"; this.geometry = geometry; this.material = material; }
}

const eulerMat = (e) => {
	const a = Math.cos(e.x), b = Math.sin(e.x), c = Math.cos(e.y), d = Math.sin(e.y), f = Math.cos(e.z), g = Math.sin(e.z);
	return [
		[c * f, -c * g, d],
		[a * g + b * d * f, a * f - b * d * g, -b * c],
		[b * g - a * d * f, b * f + a * d * g, a * c],
	];
};
const quatMat = (q) => {
	const { x, y, z, w } = q;
	return [
		[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
		[2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
		[2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
	];
};
const mul = (A, B) => {
	const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += A[i][k] * B[k][j];
	return R;
};
const apply = (M, p) => [0, 1, 2].map((i) => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2]);

export function worldOf(obj) {
	const chain = [];
	for (let o = obj; o; o = o.parent) chain.unshift(o);
	let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t = [0, 0, 0];
	for (const o of chain) {
		const R = o.quaternion.touched ? quatMat(o.quaternion) : eulerMat(o.rotation);
		const S = [o.scale.x, o.scale.y, o.scale.z];
		const RS = R.map((row) => row.map((v, j) => v * S[j]));
		const p = apply(M, [o.position.x, o.position.y, o.position.z]);
		t = t.map((v, i) => v + p[i]);
		M = mul(M, RS);
	}
	return { M, t };
}

/** Ориентированный габаритный ящик детали в мировых координатах. */
export function worldObb(mesh) {
	const g = mesh.geometry;
	if (!g || !g.box) return null;
	const { M, t } = worldOf(mesh);
	const lc = [0, 1, 2].map((i) => (g.box.min[i] + g.box.max[i]) / 2);
	const lh = [0, 1, 2].map((i) => (g.box.max[i] - g.box.min[i]) / 2);
	const col = [0, 1, 2].map((j) => [M[0][j], M[1][j], M[2][j]]);
	const scale = col.map((c) => Math.hypot(c[0], c[1], c[2]) || 1);
	return {
		center: [0, 1, 2].map((i) => t[i] + M[i][0] * lc[0] + M[i][1] * lc[1] + M[i][2] * lc[2]),
		axes: col.map((c, j) => c.map((v) => v / scale[j])),
		half: lh.map((v, j) => v * scale[j]),
	};
}

/** Расстояние от точки до ориентированного ящика (0 внутри). */
export function distancePointToObb(p, obb) {
	let s = 0;
	for (let j = 0; j < 3; j++) {
		const d = (p[0] - obb.center[0]) * obb.axes[j][0] + (p[1] - obb.center[1]) * obb.axes[j][1] + (p[2] - obb.center[2]) * obb.axes[j][2];
		const o = Math.abs(d) - obb.half[j];
		if (o > 0) s += o * o;
	}
	return Math.sqrt(s);
}
