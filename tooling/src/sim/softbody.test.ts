// Unit tests of the softbody module's pure physics (tooling/src/sim/softbody.ts): node --test tooling/src/sim/softbody.test.ts
// (The engine runs are checked against theory by research/rw-validate-softbody.ts, and end to end by tools/softbody/test.mjs.)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
	addFlat,
	type BallLaw,
	clayForce,
	closestOnOutline,
	dampingRatio,
	elasticEnergy,
	elasticForce,
	type Flat,
	flatArea,
	gasSquash,
	meetOutline,
	reach,
	rubberEnergy,
	rubberForce,
	softbodyProblem
} from "./softbody.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)
const law = (o: Partial<BallLaw>): BallLaw => ({ law: "pressure", R: 0.108, gauge: 14000, wall: 0, Estar: 0, flow: 0, kc: 0, e: 0.75, hard: 0.054, ...o })

test("damping ratio of a linear contact for a restitution: e = exp(−πζ/√(1−ζ²))", () => {
	for (const e of [0.05, 0.3, 0.55, 0.75, 0.95]) {
		const z = dampingRatio(e)
		near(Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z)), e, 1e-9, `e ${e}`)
	}
})

test("a sphere's flat: area π(2Rδ − δ²), none past nothing, the whole disc at δ = R", () => {
	near(flatArea(0.1, 0), 0, 0)
	near(flatArea(0.1, 0.01), Math.PI * (0.002 - 0.0001), 1e-15)
	near(flatArea(0.1, 0.1), Math.PI * 0.01, 1e-15)
	near(flatArea(0.1, 0.2), Math.PI * 0.01, 1e-15, "(held at R)")
})

test("inflated ball: F = (p − p_atm)·A with the gas squeezed by the flattened cap, its slope and its energy agree", () => {
	const L = law({})
	for (const d of [0.001, 0.01, 0.03, 0.08]) {
		const { F, k } = elasticForce(L, d)
		// (the cap πδ²(R − δ/3) squeezed out of 4/3·πR³, adiabatic from 101 325 + 14 000 Pa)
		const V0 = (4 / 3) * Math.PI * 0.108 ** 3
		const p = (101325 + 14000) * (V0 / (V0 - Math.PI * d * d * (0.108 - d / 3))) ** 1.4
		near(F, (p - 101325) * flatArea(0.108, d), 1e-9 * F, "force")
		const h = 1e-7
		near(k, (elasticForce(L, d + h).F - elasticForce(L, d - h).F) / (2 * h), 1e-3 * k, "slope")
		// energy: ∫F dδ by Simpson
		let s = 0
		const n = 200
		for (let i = 0; i <= n; i++) s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * elasticForce(L, (d * i) / n).F
		near(elasticEnergy(L, d), (s * d) / (3 * n), 1e-9 * Math.max(1, s), "energy")
	}
	// small squash: k → 2πR·Δp (the textbook's linear stiffness), the energy → Δp × the cap's volume (Cross's law)
	near(elasticForce(L, 1e-7).k, 2 * Math.PI * 0.108 * 14000, 1, "small-squash stiffness")
	near(gasSquash(0.108, 14000, 1e-4).E, 14000 * Math.PI * 1e-8 * (0.108 - 1e-4 / 3), 1e-3 * 14000 * Math.PI * 1e-8 * 0.108, "small-squash energy")
	// a nearly flat ball (0.5 kPa) still pushes back as it flattens: the gas it squeezes (half its volume at δ = R: (2^1.4 − 1)·p_atm)
	near(gasSquash(0.108, 500, 0.108).F, ((101325 + 500) * 2 ** 1.4 - 101325) * Math.PI * 0.108 * 0.108, 1e-6, "flattened to its middle")
})

test("Hertz ball: F = (4/3)E*√R·δ^1.5 and its energy (8/15)E*√R·δ^2.5", () => {
	const L = law({ law: "hertz", R: 0.035, Estar: 1.1e5 })
	const d = 0.008
	near(elasticForce(L, d).F, (4 / 3) * 1.1e5 * Math.sqrt(0.035) * Math.pow(d, 1.5), 1e-9)
	near(elasticEnergy(L, d), (8 / 15) * 1.1e5 * Math.sqrt(0.035) * Math.pow(d, 2.5), 1e-12)
})

test("clay: elastic up to the flow force, then it flows and keeps the flat", () => {
	const R = 0.03
	const p = 360000
	const L = law({ law: "clay", R, flow: p, kc: 50 * 2 * Math.PI * R * p })
	// even a tiny squash flows (the flow force grows as 2πRp·δ, the elastic part 50 times as fast): it keeps 98 % of it
	const a = clayForce(L, 1e-7, 0)
	near(a.dp, 1e-7 * (1 - 1 / 50), 1e-12, "the flat it keeps")
	near(a.F, p * flatArea(R, 1e-7), 1e-12, "at the flow force")
	// pressed 2 mm from round: it flows until the elastic part carries exactly the flow force
	const b = clayForce(L, 0.002, 0)
	near(b.F, p * flatArea(R, 0.002), 1e-9, "flow force")
	near(b.dp, 0.002 - b.F / L.kc, 1e-12, "the flat it keeps")
	assert.ok(b.dp > 0.0019, "nearly all of it stays (rigid-plastic)")
	// with a flat already there, pressed no deeper: nothing more flows
	const c = clayForce(L, b.dp, b.dp)
	assert.equal(c.F, 0)
	assert.equal(c.dp, b.dp)
})

test("flats: the dented ball's reach, merging within 25°, at most 8", () => {
	const R = 0.03
	const flats: Flat[] = []
	addFlat(flats, -Math.PI / 2, 0.005)
	near(reach(R, flats, -Math.PI / 2), R - 0.005, 1e-15, "on its flat")
	near(reach(R, flats, 0), R, 0, "away from it")
	// at the flat's edge, the reach is R again (continuous)
	const al = Math.atan2(Math.sqrt(R * R - (R - 0.005) * (R - 0.005)), R - 0.005)
	near(reach(R, flats, -Math.PI / 2 + al), R, 1e-12, "at its edge")
	addFlat(flats, -Math.PI / 2 + 0.2, 0.007)
	assert.equal(flats.length, 1, "merged")
	assert.equal(flats[0]?.d, 0.007)
	addFlat(flats, -Math.PI / 2, 0.003)
	assert.equal(flats[0]?.d, 0.007, "a shallower one adds nothing")
	for (let k = 0; k < 12; k++) addFlat(flats, (k * 2 * Math.PI) / 12, 0.001 + k * 0.0001)
	assert.ok(flats.length <= 8, `at most 8 (${flats.length})`)
})

test("closest point of an outline, inside and outside; meeting a circle", () => {
	const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]
	const o = closestOnOutline(sq, { x: 0, y: 3 })
	assert.equal(o.inside, false)
	near(o.q.y, 1, 1e-12)
	near(o.ny, 1, 1e-12)
	const i = closestOnOutline(sq, { x: 0.8, y: 0 })
	assert.equal(i.inside, true)
	near(i.q.x, 1, 1e-12)
	near(i.nx, 1, 1e-12)
	const m = meetOutline({ x: 0, y: 1.25 }, { points: sq })
	near(m?.s ?? 0, 0.25, 1e-12, "distance to the top")
	const c = meetOutline({ x: 3, y: 0 }, { circle: { x: 0, y: 0, r: 1 } })
	near(c?.s ?? 0, 2, 1e-12)
	near(c?.px ?? 0, 1, 1e-12)
})

test("rubber: neo-Hookean A0·(E/3)(λ − 1/λ²), slack below λ 1, Gent-stiffened, energy = ∫F dl", () => {
	const A0 = 5e-6
	const E = 1.5e6
	assert.equal(rubberForce(A0, E, 0, 0.9), 0)
	near(rubberForce(A0, E, 0, 2), A0 * (E / 3) * (2 - 0.25), 1e-12, "no lock: neo-Hookean")
	assert.ok(rubberForce(A0, E, 40, 4) > rubberForce(A0, E, 0, 4) * 1.3, "stiffens toward full stretch")
	// energy against a fine sum
	const l0 = 0.05
	let w = 0
	const n = 20000
	for (let i = 0; i < n; i++) w += rubberForce(A0, E, 40, 1 + ((i + 0.5) / n) * 1.6)
	near(rubberEnergy(A0, E, 40, l0, 2.6), (w * 1.6 * l0) / n, 1e-6, "energy")
	// (neo-Hookean closed form: A0·l0·(E/3)·(λ²/2 + 1/λ − 3/2))
	near(rubberEnergy(A0, E, 0, l0, 2), A0 * l0 * (E / 3) * (2 + 0.5 - 1.5), 1e-6 * 0.125, "closed form (Simpson, 24 pieces)")
})

test("records: what the engine refuses", () => {
	const solids = new Set(["a/ball", "r/seg1", "r/seg2", "L/pouch"])
	assert.equal(softbodyProblem({ kind: "softbody", id: "a/soft", role: "ball", solid: "a/ball", law: "pressure", R: 0.1 }, solids), undefined)
	assert.match(softbodyProblem({ kind: "softbody", id: "a/soft", role: "ball", solid: "nope", law: "pressure", R: 0.1 }, solids) ?? "", /solid/)
	assert.match(softbodyProblem({ kind: "softbody", id: "a/soft", role: "ball", solid: "a/ball", law: "jelly", R: 0.1 }, solids) ?? "", /law/)
	assert.equal(softbodyProblem({ kind: "softbody", id: "r/beam", role: "beam", solids: ["r/seg1", "r/seg2"], joints: [{ a: "r/seg1", b: "r/seg2", k: 10, c: 0 }] }, solids), undefined)
	assert.match(softbodyProblem({ kind: "softbody", id: "r/beam", role: "beam", solids: ["r/seg1"], joints: [{ a: "r/seg1", b: "x", k: 10, c: 0 }] }, solids) ?? "", /joins/)
	assert.match(softbodyProblem({ kind: "softbody", id: "L/band", role: "band", pad: "L/pouch", anchor: { x: 0, y: 0 }, l0: 0, area: 1, E: 1 }, solids) ?? "", /positive/)
	assert.match(softbodyProblem({ kind: "softbody", id: "x", role: "jelly" }, solids) ?? "", /no softbody role/)
})
