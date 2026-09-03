/** Подбор высоты внутренних шарниров (x = 0.40) так, чтобы кривые
 * развала и схода остались как до укорочения рычагов. */
import fs from "node:fs";
import { rearHubCoords, solveRearPose, rearLinkLengths, dist3 } from "../src/kinematics/rear.js";

const locs = {
	upOut: [-0.08, 0.09, -0.05], splOut: [-0.09, -0.11, 0.02],
	camOut: [-0.08, -0.06, 0.14], toeOut: [-0.12, 0.01, 0.21], trOut: [-0.05, -0.04, -0.17],
};
const base = { sign: 1, wcY: 0.32, sc: { cfg: { x: 0.78, z: 1.3 } } };
const tr = { x: 0.6, y: 0.3, z: 0.76 };
const steps = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
const DEG = 180 / Math.PI;
const W = (x, y, z) => ({ x, y, z });
const OLD = { up: W(0.26, 0.33, 1.23), spl: W(0.21, 0.11, 1.33), cam: W(0.24, 0.17, 1.47), toe: W(0.19, 0.25, 1.54) };
const OUT = { up: W(0.7, 0.41, 1.25), spl: W(0.69, 0.21, 1.32), cam: W(0.7, 0.26, 1.44), toe: W(0.66, 0.33, 1.51) };
const onAxis = (p0, o, x, dy) => {
	const s = (x - p0.x) / (o.x - p0.x);
	return { x, y: p0.y + s * (o.y - p0.y) + dy, z: p0.z + s * (o.z - p0.z) };
};
const SPL = onAxis(OLD.spl, OUT.spl, 0.4, 0);
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function curves(up, cam, toe) {
	const inners = { up, spl: SPL, cam, toe, tr };
	const L = rearLinkLengths(base, inners, locs);
	const rows = [];
	for (const mm of steps) {
		const cm = { ...base, wcY: 0.32 + mm / 1000, dxH: 0, camber: 0, dzH: 0, toe: 0 };
		const p = solveRearPose(cm, inners, L, locs, { iters: 16 });
		const a0 = (l) => rearHubCoords(cm, l, p.dxH, p.camber, 0, p.dzH);
		const aT = (l) => rearHubCoords(cm, l, p.dxH, p.camber, p.toe, p.dzH);
		const res = Math.max(
			Math.abs(dist3(a0(locs.upOut), up) - L.LU),
			Math.abs(dist3(a0(locs.camOut), cam) - L.LC),
			Math.abs(dist3(a0(locs.trOut), tr) - L.LTR),
			Math.abs(dist3(aT(locs.toeOut), toe) - L.LT));
		rows.push({ mm, camber: p.camber * DEG, toe: p.toe * DEG, dxH: p.dxH * 1000, dzH: p.dzH * 1000, res: res * 1000 });
	}
	return { L, rows };
}

const ref = curves(OLD.up, OLD.cam, OLD.toe);
const grid = [];
for (let d = -0.06; d <= 0.0601; d += 0.01) grid.push(Math.round(d * 1000) / 1000);

let best = null;
for (const du of grid) {
	for (const dc of grid) {
		const up = onAxis(OLD.up, OUT.up, 0.4, du);
		const cam = onAxis(OLD.cam, OUT.cam, 0.4, dc);
		if (len(up, OUT.up) < 0.25 || len(up, OUT.up) > 0.36) continue;
		if (len(cam, OUT.cam) < 0.25 || len(cam, OUT.cam) > 0.36) continue;
		const c = curves(up, cam, onAxis(OLD.toe, OUT.toe, 0.4, 0));
		if (c.rows.some((r) => r.res > 0.05)) continue;
		const eCam = Math.max(...c.rows.map((r, i) => Math.abs(r.camber - ref.rows[i].camber)));
		const eDx = Math.max(...c.rows.map((r, i) => Math.abs(r.dxH - ref.rows[i].dxH)));
		const score = eCam + eDx / 50;
		if (!best || score < best.score) best = { score, du, dc, eCam, eDx, up, cam };
	}
}
let bestToe = null;
for (const dt of grid) {
	const toe = onAxis(OLD.toe, OUT.toe, 0.4, dt);
	if (len(toe, OUT.toe) < 0.24 || len(toe, OUT.toe) > 0.36) continue;
	const c = curves(best.up, best.cam, toe);
	if (c.rows.some((r) => r.res > 0.05)) continue;
	const eToe = Math.max(...c.rows.map((r, i) => Math.abs(r.toe - ref.rows[i].toe)));
	if (!bestToe || eToe < bestToe.eToe) bestToe = { dt, eToe, toe };
}

const fin = curves(best.up, best.cam, bestToe.toe);
const f = (v, n, w) => v.toFixed(n).padStart(w);
console.log("dy: verh " + best.du + "  razval " + best.dc + "  shod " + bestToe.dt);
console.log("dlina mm: LU " + f(fin.L.LU * 1000, 0, 3) + " LC " + f(fin.L.LC * 1000, 0, 3) +
	" LT " + f(fin.L.LT * 1000, 0, 3) + " LSPL " + f(fin.L.LSPL * 1000, 0, 3) + " LTR " + f(fin.L.LTR * 1000, 0, 3));
console.log("   hod | camber old->new | toe old->new | dxH old->new | resid");
for (let i = 0; i < steps.length; i++) {
	const a = ref.rows[i], b = fin.rows[i];
	console.log("  " + String(a.mm).padStart(4) + " | " + f(a.camber, 2, 6) + " -> " + f(b.camber, 2, 6) +
		" | " + f(a.toe, 2, 6) + " -> " + f(b.toe, 2, 6) +
		" | " + f(a.dxH, 1, 6) + " -> " + f(b.dxH, 1, 6) + " | " + f(b.res, 3, 6));
}
const loc = (p) => [Math.round(p.x * 1e4) / 1e4, Math.round((p.y - 0.12) * 1e4) / 1e4, Math.round((p.z - 1.3) * 1e4) / 1e4];
const out = { upperArm: loc(best.up), camberLink: loc(best.cam), toeLink: loc(bestToe.toe), springLink: loc(SPL) };
fs.writeFileSync(new URL("./.pivots.json", import.meta.url), JSON.stringify(out));
console.log("local: " + JSON.stringify(out));
