/**
 * Аудит зазоров: собирает всю машину в Node (без three и без браузера) и ищет
 * пересечения подвижных деталей (пружина, амортизатор, рычаги, колесо)
 * с неподвижной структурой (рама + подрамник) во всём диапазоне хода подвески.
 *
 *   node scripts/audit-clearances.mjs
 */
import fs from "node:fs";
import * as THREE from "./lib/three-lite.mjs";
import { worldObb, distancePointToObb } from "./lib/three-lite.mjs";
import { buildVehicle } from "../src/geometry/vehicle.js";
import {
	CHASSIS_GEOMETRY as CHASSIS,
	rearSubframeWorldPoint,
	rearBodyWorldPoint,
} from "../src/data/chassisGeometry.js";
import { createHardpoints } from "../src/kinematics/hardpoints.js";

const SWEEP_MM = 80; // ход колеса относительно кузова, +/- мм (соответствует клиренсу 100..260 мм)
const TOL = 0.001;
const { RHP } = createHardpoints(CHASSIS);

const vehicleSrc = fs
	.readFileSync(new URL("../src/geometry/vehicle.js", import.meta.url), "utf8")
	.split("\n");
function label(line) {
	for (let i = line - 1; i >= Math.max(0, line - 16); i--) {
		const m = vehicleSrc[i].match(/const\s+([A-Za-z0-9_]+)\s*=/);
		if (m) return m[1];
	}
	return "line" + line;
}

const matCache = new Map();
const materials = new Proxy(
	{},
	{
		get(_t, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (!matCache.has(key)) {
				const stub = { color: new THREE.Color(0), side: 0, name: key };
				stub.clone = () => stub;
				stub.dispose = () => {};
				matCache.set(key, stub);
			}
			return matCache.get(key);
		},
	},
);

const groups = {};
for (const name of [
	"chassisFrameGroup", "frontSubframeGroup", "rearSubframeGroup", "drivetrainGroup",
	"suspensionGroup", "steeringGroup", "wheelsGroup", "rigPlatformsGroup",
]) {
	groups[name] = new THREE.Group();
	groups[name].name = name;
}

await buildVehicle({
	THREE, materials, CHASSIS, ...groups,
	SEG: (hi) => hi,
	bootProgress: () => {},
	nextFrame: async () => {},
	isMobile: false,
});

/* ---------- неподвижная структура ---------- */
const parts = [];
for (const groupName of [
	"chassisFrameGroup",
	"rearSubframeGroup",
	"drivetrainGroup",
]) {
	groups[groupName].traverse((o) => {
		if (o.type !== "Mesh") return;
		const obb = worldObb(o);
		if (!obb) return;
		if (o.geometry.type === "Torus") return; // кольцо: ящик закрывает дырку, считать нечего
		parts.push({ group: groupName.replace("Group", ""), name: label(o.srcLine), line: o.srcLine, obb });
	});
}

/* ---------- подвижные коридоры ---------- */
const WHEEL = { x: 0.78, y: 0.32, z: CHASSIS.rearAxleZ };
const RC = CHASSIS.rearCarrier;
const DM = CHASSIS.rearDamperMount;
const inner = {
	up: rearSubframeWorldPoint("upperArm", 1),
	spl: rearSubframeWorldPoint("springLink", 1),
	cam: rearSubframeWorldPoint("camberLink", 1),
	toe: rearSubframeWorldPoint("toeLink", 1),
};
const trailingIn = rearBodyWorldPoint("trailingArm", 1);
const springTop = rearBodyWorldPoint("springTop", 1);
const damperTop = rearBodyWorldPoint("damperTop", 1);
const carrier = (key) => ({ x: WHEEL.x + RC[key][0], y: WHEEL.y + RC[key][1], z: WHEEL.z + RC[key][2] });
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
function swing(pivot, outer, dy) {
	const v = { x: outer.x - pivot.x, y: outer.y - pivot.y, z: outer.z - pivot.z };
	const len = Math.hypot(v.x, v.y, v.z);
	const w = { x: v.x, y: v.y + dy, z: v.z };
	const k = len / Math.hypot(w.x, w.y, w.z);
	return { x: pivot.x + w.x * k, y: pivot.y + w.y * k, z: pivot.z + w.z * k };
}
function envelopes(dy) {
	const splOut = swing(inner.spl, carrier("splOut"), dy);
	const seat = lerpP(inner.spl, splOut, RHP.springSeatT);
	seat.y += 0.025;
	const eye = lerpP(inner.spl, splOut, RHP.dmpSeatT);
	eye.y += RHP.dmpSeatLift;
	eye.z += RHP.dmpSeatAft;
	return [
		{ n: "пружина", a: seat, b: springTop, r: 0.0535 },
		{ n: "амортизатор", a: eye, b: damperTop, r: 0.027 },
		{ n: "вилка аморта", a: { x: eye.x - 0.043, y: eye.y + 0.02, z: eye.z }, b: { x: eye.x + 0.043, y: eye.y + 0.02, z: eye.z }, r: 0.028 },
		{ n: "пружинный рычаг", a: inner.spl, b: splOut, r: 0.04 },
		{ n: "верхний рычаг", a: inner.up, b: swing(inner.up, carrier("upOut"), dy), r: 0.019 },
		{ n: "развальная тяга", a: inner.cam, b: swing(inner.cam, carrier("camOut"), dy), r: 0.015 },
		{ n: "сходовая тяга", a: inner.toe, b: swing(inner.toe, carrier("toeOut"), dy), r: 0.015 },
		{ n: "продольный рычаг", a: trailingIn, b: swing(trailingIn, carrier("trOut"), dy), r: 0.05 },
	];
}

const mm = (v) => (v * 1000).toFixed(0);
const dist3 = (p, q) => Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z);
/* Детали самого шарнира (щёки, кронштейн, чашка) касаются рычага по замыслу. */
const partCenter = (part) => part.obb?.center ?? part.center ?? part.c ?? null;
const cenNear = (part, p) => {
	const c = partCenter(part);
	return c ? dist3(c, p) < 0.09 : false;
};
const worst = new Map();
const steps = [];
for (let i = -SWEEP_MM; i <= SWEEP_MM; i += 10) steps.push(i / 1000);

for (const dy of steps) {
	for (const env of envelopes(dy)) {
		const len = Math.hypot(env.b.x - env.a.x, env.b.y - env.a.y, env.b.z - env.a.z);
		const n = Math.max(2, Math.ceil(len / 0.004));
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const p = [
				env.a.x + (env.b.x - env.a.x) * t,
				env.a.y + (env.b.y - env.a.y) * t,
				env.a.z + (env.b.z - env.a.z) * t,
			];
			// точки у своих же опор игнорируем: там контакт по замыслу
			if (dist3(p, env.a) < 0.09 || dist3(p, env.b) < 0.09) continue;
			for (const part of parts) {
				if (cenNear(part, env.a) || cenNear(part, env.b)) continue;
				for (const side of [1]) {
					const q = side > 0 ? p : [-p[0], p[1], p[2]];
					const pen = env.r - distancePointToObb(q, part.obb);
					if (pen <= TOL) continue;
					const key = env.n + "|" + part.name + "@" + part.line;
					const rec = worst.get(key) || { pen: -1, atNominal: -1, env: env.n, part };
					if (pen > rec.pen) { rec.pen = pen; rec.dy = dy; }
					if (dy === 0 && pen > rec.atNominal) rec.atNominal = pen;
					worst.set(key, rec);
				}
			}
		}
	}
}

const rows = [...worst.values()].sort((a, b) => b.pen - a.pen);
console.log("Деталей в неподвижной структуре: " + parts.length + ", шагов хода: " + steps.length);
console.log("\n=== ПЕРЕСЕЧЕНИЯ (мм) ===");
console.log("  худшее  номинал  подвижная деталь   неподвижная деталь");
for (const r of rows) {
	console.log(
		"  " + mm(r.pen).padStart(6) + "  " + (r.atNominal > 0 ? mm(r.atNominal) : "-").padStart(7) +
		"  " + r.env.padEnd(18) + " " + r.part.name + " (" + r.part.group + ":" + r.part.line + ")" +
		"  центр " + r.part.obb.center.map(mm).join("/") + "  полуразмер " + r.part.obb.half.map(mm).join("/") +
		"  ход " + mm(r.dy),
	);
}
if (!rows.length) console.log("  чисто");

/* ---------- подвижные друг относительно друга ---------- */
function capsuleGap(e1, e2) {
	let best = Infinity;
	for (let i = 0; i <= 60; i++) {
		const t = i / 60;
		const p = [e1.a.x + (e1.b.x - e1.a.x) * t, e1.a.y + (e1.b.y - e1.a.y) * t, e1.a.z + (e1.b.z - e1.a.z) * t];
		for (let j = 0; j <= 60; j++) {
			const s = j / 60;
			const q = [e2.a.x + (e2.b.x - e2.a.x) * s, e2.a.y + (e2.b.y - e2.a.y) * s, e2.a.z + (e2.b.z - e2.a.z) * s];
			const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - e1.r - e2.r;
			if (d < best) best = d;
		}
	}
	return best;
}
console.log("\n=== ЗАЗОРЫ МЕЖДУ ПОДВИЖНЫМИ ДЕТАЛЯМИ (худший по ходу, мм) ===");
const names = envelopes(0).map((e) => e.n);
for (let i = 0; i < names.length; i++) {
	for (let j = i + 1; j < names.length; j++) {
		let w = Infinity, wdy = 0;
		for (const dy of steps) {
			const es = envelopes(dy);
			const d = capsuleGap(es[i], es[j]);
			if (d < w) { w = d; wdy = dy; }
		}
		if (w < 0.02) console.log("  " + (names[i] + " / " + names[j]).padEnd(40) + mm(w).padStart(6) + "  ход " + mm(wdy));
	}
}

/* ---------- колёсные ниши ---------- */
const TIRE_R = 0.326, TIRE_IN = 0.676, TIRE_OUT = 0.884;
const aabbFromObb = (obb) => {
	const e = [0, 1, 2].map((i) =>
		Math.abs(obb.axes[0][i]) * obb.half[0] + Math.abs(obb.axes[1][i]) * obb.half[1] + Math.abs(obb.axes[2][i]) * obb.half[2]);
	return { min: [0, 1, 2].map((i) => obb.center[i] - e[i]), max: [0, 1, 2].map((i) => obb.center[i] + e[i]) };
};
console.log("\n=== \u0414\u0415\u0422\u0410\u041b\u0418 \u0412 \u041a\u041e\u041b\u0415\u0421\u0415 (\u043c\u043c) ===");
let wheelHits = 0;
for (const [axleZ, tag] of [[CHASSIS.frontAxleZ, "\u043f\u0435\u0440\u0435\u0434"], [CHASSIS.rearAxleZ, "\u0437\u0430\u0434"]]) {
	for (const part of parts) {
		const box = aabbFromObb(part.obb);
		for (const side of [1, -1]) {
			const xLo = side > 0 ? box.min[0] : -box.max[0];
			const xHi = side > 0 ? box.max[0] : -box.min[0];
			const xIn = Math.min(xHi, TIRE_OUT) - Math.max(xLo, TIRE_IN);
			if (xIn <= 0.001) continue;
			let worstDepth = -1, worstDy = 0;
			for (const dy of steps) {
				const cy = WHEEL.y + dy;
				const ry = Math.max(box.min[1] - cy, 0, cy - box.max[1]);
				const rz = Math.max(box.min[2] - axleZ, 0, axleZ - box.max[2]);
				const depth = TIRE_R - Math.hypot(ry, rz);
				if (depth > worstDepth) { worstDepth = depth; worstDy = dy; }
			}
			if (worstDepth <= 0.001) continue;
			wheelHits++;
			console.log("  " + tag + (side > 0 ? " \u043f\u0440\u0430\u0432" : " \u043b\u0435\u0432") + ": " + part.name + " (" + part.line + ")" +
				" \u0437\u0430\u0445\u043e\u0434 \u043f\u043e X " + mm(xIn) + ", \u0433\u043b\u0443\u0431\u0438\u043d\u0430 " + mm(worstDepth) + ", \u0445\u043e\u0434 " + mm(worstDy) +
				", x " + mm(box.min[0]) + ".." + mm(box.max[0]) + " y " + mm(box.min[1]) + ".." + mm(box.max[1]));
		}
	}
}
if (!wheelHits) console.log("  \u043d\u0435\u0442");

/* ---------- висящие в воздухе детали ---------- */
const aabbOf = (obb) => {
	const c = obb.center, ax = obb.axes, h = obb.half;
	const e = [0, 1, 2].map((i) => Math.abs(ax[0][i]) * h[0] + Math.abs(ax[1][i]) * h[1] + Math.abs(ax[2][i]) * h[2]);
	return { min: [0, 1, 2].map((i) => c[i] - e[i]), max: [0, 1, 2].map((i) => c[i] + e[i]) };
};
const gapAabb = (a, b) => {
	let s = 0;
	for (let i = 0; i < 3; i++) {
		const d = Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i], 0);
		s += d * d;
	}
	return Math.sqrt(s);
};
console.log("\n=== ДЕТАЛИ БЕЗ КОНТАКТА С ОСТАЛЬНОЙ СТРУКТУРОЙ ===");
let floating = 0;
const boxes = parts.map((p) => aabbOf(p.obb));
for (let i = 0; i < parts.length; i++) {
	if (boxes[i].max[0] < -0.02) continue;
	let best = Infinity, who = "";
	for (let j = 0; j < parts.length; j++) {
		if (i === j) continue;
		const g = gapAabb(boxes[i], boxes[j]);
		if (g < best) { best = g; who = parts[j].name + "@" + parts[j].line; }
	}
	if (best > 0.004) {
		floating++;
		console.log("  " + parts[i].name + " (" + parts[i].group + ":" + parts[i].line + ") зазор " + mm(best) + " мм до " + who);
	}
}
if (!floating) console.log("  нет");
