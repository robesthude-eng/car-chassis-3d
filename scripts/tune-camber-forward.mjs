/** Подбор развальной тяги, перенесённой ВПЕРЁД оси (компоновка PQ35).
 * Эталон — исходные кривые длиннорычажной схемы: подруливание в сжатие
 * и небольшой выкат в отбое. Внутренний шарнир стоит в одной плоскости z
 * с верхним рычагом (общий кронштейн на боковине), поэтому подбираются
 * только высоты: шарнир тяги, ухо на цапфе и высота шарнира сходовой тяги. */
import fs from "node:fs";
import {
	rearHubCoords,
	solveRearPose,
	rearLinkLengths,
	dist3,
} from "../src/kinematics/rear.js";

const W = (x, y, z) => ({ x, y, z });
const O = (a) => ({ x: a[0], y: a[1], z: a[2] });
const DEG = 180 / Math.PI;
const base = { sign: 1, wcY: 0.32, sc: { cfg: { x: 0.78, z: 1.3 } } };
const tr = { x: 0.6, y: 0.3, z: 0.76 };
const steps = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
const SEAT_T = 0.5366;
const SPRING_TOP = W(0.56, 0.6, 1.315);
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function segDist(p1, q1, p2, q2) {
	const d1 = [q1.x - p1.x, q1.y - p1.y, q1.z - p1.z];
	const d2 = [q2.x - p2.x, q2.y - p2.y, q2.z - p2.z];
	const r = [p1.x - p2.x, p1.y - p2.y, p1.z - p2.z];
	const a = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2;
	const e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
	const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
	const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
	const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
	const den = a * e - b * b;
	let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
	let t = (b * s + f) / e;
	if (t < 0) {
		t = 0;
		s = Math.min(1, Math.max(0, -c / a));
	} else if (t > 1) {
		t = 1;
		s = Math.min(1, Math.max(0, (b - c) / a));
	}
	return Math.hypot(
		r[0] + d1[0] * s - d2[0] * t,
		r[1] + d1[1] * s - d2[1] * t,
		r[2] + d1[2] * s - d2[2] * t,
	);
}

const sampleDist = (p1, q1, p2, q2) => {
	let m = Infinity;
	const N = 24;
	for (let i = 0; i <= N; i++) {
		const a = W(
			p1.x + ((q1.x - p1.x) * i) / N,
			p1.y + ((q1.y - p1.y) * i) / N,
			p1.z + ((q1.z - p1.z) * i) / N,
		);
		for (let j = 0; j <= N; j++) {
			const b = W(
				p2.x + ((q2.x - p2.x) * j) / N,
				p2.y + ((q2.y - p2.y) * j) / N,
				p2.z + ((q2.z - p2.z) * j) / N,
			);
			const d = len(a, b);
			if (d < m) m = d;
		}
	}
	return m;
};

function run(inners, locs) {
	const L = rearLinkLengths(base, inners, locs);
	const rows = [];
	for (const mm of steps) {
		const cm = {
			...base,
			wcY: 0.32 + mm / 1000,
			dxH: 0,
			camber: 0,
			dzH: 0,
			toe: 0,
		};
		const p = solveRearPose(cm, inners, L, locs, { iters: 16 });
		const a0 = (l) => rearHubCoords(cm, l, p.dxH, p.camber, 0, p.dzH);
		const aT = (l) => rearHubCoords(cm, l, p.dxH, p.camber, p.toe, p.dzH);
		const res = Math.max(
			Math.abs(dist3(a0(locs.upOut), inners.up) - L.LU),
			Math.abs(dist3(a0(locs.camOut), inners.cam) - L.LC),
			Math.abs(dist3(a0(locs.trOut), inners.tr) - L.LTR),
			Math.abs(dist3(aT(locs.toeOut), inners.toe) - L.LT),
		);
		const splOut = O(a0(locs.splOut));
		const camOut = O(a0(locs.camOut));
		const trOut = O(a0(locs.trOut));
		const seat = W(
			inners.spl.x + (splOut.x - inners.spl.x) * SEAT_T,
			inners.spl.y + (splOut.y - inners.spl.y) * SEAT_T + 0.025,
			inners.spl.z + (splOut.z - inners.spl.z) * SEAT_T,
		);
		rows.push({
			mm,
			camber: p.camber * DEG,
			toe: p.toe * DEG,
			dxH: p.dxH * 1000,
			res: res * 1000,
			drift: Math.abs(len(inners.spl, splOut) - L.LSPL) * 1000,
			dTr: sampleDist(inners.cam, camOut, inners.tr, trOut) * 1000,
			dSp: sampleDist(inners.cam, camOut, seat, SPRING_TOP) * 1000,
		});
	}
	return { L, rows };
}

const refLocs = {
	upOut: [-0.08, 0.09, -0.05],
	splOut: [-0.09, -0.11, 0.02],
	camOut: [-0.08, -0.06, 0.14],
	toeOut: [-0.12, 0.01, 0.21],
	trOut: [-0.05, -0.04, -0.17],
};
const ref = run(
	{
		up: W(0.26, 0.33, 1.23),
		spl: W(0.21, 0.11, 1.33),
		cam: W(0.24, 0.17, 1.47),
		toe: W(0.19, 0.25, 1.54),
		tr,
	},
	refLocs,
);

const UP = W(0.4, 0.3555, 1.2364);
const SPL = W(0.4, 0.1496, 1.326);
const CAM_Z = 1.2364; // общий кронштейн с верхним рычагом
const cands = [];
for (const oy of [-0.13, -0.115, -0.1, -0.085, -0.07]) {
	for (const oz of [-0.14, -0.12, -0.1]) {
		for (const iy of [0.14, 0.16, 0.18, 0.2, 0.22]) {
			for (const ty of [0.2657, 0.2857, 0.3057, 0.3257]) {
				const locs = { ...refLocs, camOut: [-0.08, oy, oz] };
				const cam = W(0.4, iy, CAM_Z);
				const toe = W(0.4, ty, 1.5266);
				const inners = { up: UP, spl: SPL, cam, toe, tr };
				const lc = len(cam, W(0.78 - 0.08, 0.32 + oy, 1.3 + oz));
				if (lc < 0.25 || lc > 0.35) continue;
				const c = run(inners, locs);
				if (c.rows.some((r) => r.res > 0.05)) continue;
				if (c.rows.some((r) => r.drift > 3)) continue;
				if (c.rows.some((r) => r.dTr < 68)) continue;
				if (c.rows.some((r) => r.dSp < 69)) continue;
				const eToe = Math.max(
					...c.rows.map((r, i) => Math.abs(r.toe - ref.rows[i].toe)),
				);
				const eCam = Math.max(
					...c.rows.map((r, i) => Math.abs(r.camber - ref.rows[i].camber)),
				);
				const eDx = Math.max(
					...c.rows.map((r, i) => Math.abs(r.dxH - ref.rows[i].dxH)),
				);
				cands.push({
					score: eToe + 0.5 * eCam + eDx / 50,
					oy,
					oz,
					iy,
					ty,
					eToe,
					eCam,
					eDx,
					c,
					lc,
				});
			}
		}
	}
}
cands.sort((a, b) => a.score - b.score);
const f = (v, n, w) => v.toFixed(n).padStart(w);
console.log("kandidatov: " + cands.length);
for (const k of cands.slice(0, 6)) {
	console.log(
		"  camOut y " +
			f(k.oy, 3, 6) +
		" z " +
			f(k.oz, 3, 6) +
		" | camIn y " +
			f(k.iy, 2, 4) +
		" | toeIn y " +
			f(k.ty, 4, 6) +
		" | LC " +
			f(k.lc * 1000, 0, 3) +
		" | eToe " +
			f(k.eToe, 2, 5) +
		" eCam " +
			f(k.eCam, 2, 5) +
		" eDx " +
			f(k.eDx, 1, 5) +
		" | dTr " +
			f(Math.min(...k.c.rows.map((r) => r.dTr)), 0, 3) +
		" dSp " +
			f(Math.min(...k.c.rows.map((r) => r.dSp)), 0, 3),
	);
}
const best = cands[0];
console.log(
	"dlina mm: LU " +
		f(best.c.L.LU * 1000, 0, 3) +
		" LC " +
		f(best.c.L.LC * 1000, 0, 3) +
		" LT " +
		f(best.c.L.LT * 1000, 0, 3) +
		" LSPL " +
		f(best.c.L.LSPL * 1000, 0, 3) +
		" LTR " +
		f(best.c.L.LTR * 1000, 0, 3),
);
console.log("   hod | camber etalon->novyi | toe etalon->novyi | dxH | resid | dTr dSp");
for (let i = 0; i < steps.length; i++) {
	const a = ref.rows[i];
	const b = best.c.rows[i];
	console.log(
		"  " +
			String(a.mm).padStart(4) +
			" | " +
			f(a.camber, 2, 6) +
			" -> " +
			f(b.camber, 2, 6) +
			" | " +
			f(a.toe, 2, 6) +
			" -> " +
			f(b.toe, 2, 6) +
			" | " +
			f(b.dxH, 1, 6) +
			" | " +
			f(b.res, 3, 6) +
			" | " +
			f(b.dTr, 0, 3) +
			" " +
			f(b.dSp, 0, 3),
	);
}
fs.writeFileSync(
	new URL("./.camfwd.json", import.meta.url),
	JSON.stringify({
		camOut: [-0.08, best.oy, best.oz],
		camIn: [0.4, Math.round((best.iy - 0.12) * 1e4) / 1e4, -0.0636],
		toeIn: [0.4, Math.round((best.ty - 0.12) * 1e4) / 1e4, 0.2266],
	}),
);
console.log("vybrano: " + fs.readFileSync(new URL("./.camfwd.json", import.meta.url), "utf8"));
