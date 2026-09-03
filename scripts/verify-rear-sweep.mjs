/** Сравнение кинематики задней подвески до/после переноса внутренних шарниров. */
import { rearHubCoords, solveRearPose, rearLinkLengths, dist3 } from "../src/kinematics/rear.js";
const locs = {
	upOut: [-0.08, 0.09, -0.05], splOut: [-0.09, -0.11, 0.02],
	camOut: [-0.08, -0.06, 0.14], toeOut: [-0.12, 0.01, 0.21], trOut: [-0.05, -0.04, -0.17],
};
const trIn = { x: 0.6, y: 0.3, z: 0.76 };
const mk = (hp) => ({
	up: { x: hp.up[0], y: 0.12 + hp.up[1], z: 1.3 + hp.up[2] },
	spl: { x: hp.spl[0], y: 0.12 + hp.spl[1], z: 1.3 + hp.spl[2] },
	cam: { x: hp.cam[0], y: 0.12 + hp.cam[1], z: 1.3 + hp.cam[2] },
	toe: { x: hp.toe[0], y: 0.12 + hp.toe[1], z: 1.3 + hp.toe[2] },
	tr: trIn,
});
const OLD = { up: [0.26, 0.21, -0.07], spl: [0.21, -0.01, 0.03], cam: [0.24, 0.05, 0.17], toe: [0.19, 0.13, 0.24] };
const NEW = { up: [0.4, 0.2355, -0.0636], spl: [0.4, 0.0296, 0.026], cam: [0.4, 0.0813, 0.1596], toe: [0.4, 0.1657, 0.2266] };
const DEG = 180 / Math.PI;
const f = (v, n, w) => v.toFixed(n).padStart(w);
function run(tag, hp) {
	const inners = mk(hp);
	const base = { sign: 1, wcY: 0.32, sc: { cfg: { x: 0.78, z: 1.3 } } };
	const L = rearLinkLengths(base, inners, locs);
	console.log("\n" + tag);
	console.log("  lengths mm: LU " + f(L.LU * 1000, 0, 3) + "  LC " + f(L.LC * 1000, 0, 3) +
		"  LT " + f(L.LT * 1000, 0, 3) + "  LTR " + f(L.LTR * 1000, 0, 3) + "  LSPL " + f(L.LSPL * 1000, 0, 3));
	console.log("   hod  camber   toe    dxH    dzH  resid  dLSPL");
	for (let mm = -80; mm <= 80; mm += 20) {
		const cm = { ...base, wcY: 0.32 + mm / 1000, dxH: 0, camber: 0, dzH: 0, toe: 0 };
		const p = solveRearPose(cm, inners, L, locs, { iters: 14 });
		const at0 = (loc) => rearHubCoords(cm, loc, p.dxH, p.camber, 0, p.dzH);
		const atT = (loc) => rearHubCoords(cm, loc, p.dxH, p.camber, p.toe, p.dzH);
		const res = [
			dist3(at0(locs.upOut), inners.up) - L.LU,
			dist3(at0(locs.camOut), inners.cam) - L.LC,
			dist3(at0(locs.trOut), inners.tr) - L.LTR,
			dist3(atT(locs.toeOut), inners.toe) - L.LT,
		];
		const spl = dist3(at0(locs.splOut), inners.spl) - L.LSPL;
		console.log("  " + String(mm).padStart(4) + "  " + f(p.camber * DEG, 2, 6) + " " + f(p.toe * DEG, 2, 5) +
			"  " + f(p.dxH * 1000, 1, 5) + "  " + f(p.dzH * 1000, 1, 5) + "  " + f(Math.max(...res.map(Math.abs)) * 1000, 2, 5) +
			"  " + f(spl * 1000, 1, 5));
	}
}
run("OLD inner pivots x 190..260", OLD);
run("NEW inner pivots x 400 (on subframe rail)", NEW);
