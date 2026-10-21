/**
 * The energy module's process kind, "energy" (machines/mod_energy.py builds its records, web/sim/modules/energy.js is its port; the physics is
 * tooling/src/sim/energy.ts). Records ({kind: "energy", id, item, role, ...}):
 *   rotor {solid, at {x, y}, axis, yaw, sense, rotor {blades, r0, R, chord [root, tip], pitch [root, tip], ar, cd0, stations}}
 *         A wind turbine's or a paper windmill's blades on a shaft along the wind. `solid` is a planck body hinged at its own middle that stands
 *         for the rotor's turning: its spin (counter-clockwise +) is the rotor's about its shaft, + the way its blades drive it, and its rotational
 *         inertia is the rotor's (the builder gives it the blades', hub's and spool's). The rotor's disc is centred at `at` (world, m: it stands on
 *         a fixed tower), its shaft pointing downwind along `axis` (rad, in the picture), turned `yaw` (rad) out of the picture toward the viewer
 *         (0: square into a wind along `axis`). Every (sub-)step after the release the air the engine blows (ProcessContext.air: a fan's round
 *         jet, a breeze) meets every blade element where it is (energy.ts rotorLoads) and the torque twists `solid`. A fan's jet is round about
 *         its own axis, which lies in the picture: an element out of the picture's plane (its blades sweep the y-z plane) takes the wind at its
 *         own distance from that axis (found each step as the centroid of the jet's push across the rotor's height).
 *         Readings: rpm, turns, angle (rad, what the view turns the blades by), wind_ms (the axial wind over its disc), tsr (tip speed ratio
 *         ωR/U), power_mw (the wind's power taken by the blades, mW), cp (that over ½ρAU³), thrust_n.
 *   pass  {solid, through: [solid ids]}   the solid's contacts with those are left out (a load on a thread that hangs through its own machine:
 *         a waterwheel's paddles, a windmill's tower), and never counted as impacts.
 * Nothing here runs for a document without these records.
 */
import { annuliOf, type ElementWind, type Rotor, rotorLoads } from "#sim/energy.ts"
import type { Point, ProcessContext, ProcessKind, ProcessRecord } from "#sim/plugins.ts"

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)

/** Why an energy record cannot run, or undefined. */
export const energyProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	if (r.role === "rotor") {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return `its solid ${JSON.stringify(r.solid)} is not a solid of the document`
		const rot = r.rotor as Partial<Rotor> | undefined
		if (typeof rot !== "object" || rot === null) return "a rotor needs its blades (rotor {blades, r0, R, chord, pitch, ar, cd0, stations})"
		const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v)
		if (!(ok(rot.blades) && (rot.blades as number) >= 1 && (rot.blades as number) <= 24)) return "a rotor needs 1 to 24 blades"
		if (!(ok(rot.r0) && ok(rot.R) && (rot.r0 as number) >= 0 && (rot.R as number) > (rot.r0 as number))) return "a rotor needs 0 ≤ r0 < R"
		for (const k of ["chord", "pitch"] as const) {
			const v = rot[k]
			if (!Array.isArray(v) || v.length !== 2 || !v.every(ok)) return `a rotor's ${k} is [at r0, at R] (numbers)`
		}
		if (!(ok(rot.ar) && (rot.ar as number) > 0 && ok(rot.cd0) && (rot.cd0 as number) >= 0)) return "a rotor needs ar > 0 and cd0 ≥ 0"
		if (!(ok(rot.stations) && (rot.stations as number) >= 1 && (rot.stations as number) <= 40)) return "a rotor needs 1 to 40 stations"
		const at = r.at as Point | undefined
		if (typeof at !== "object" || at === null || !ok(at.x) || !ok(at.y)) return "a rotor needs at {x, y}"
		for (const k of ["axis", "yaw"]) if (r[k] !== undefined && !ok(r[k])) return `its ${k} is not a number`
		return undefined
	}
	if (r.role === "pass") {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return `its solid ${JSON.stringify(r.solid)} is not a solid of the document`
		if (!Array.isArray(r.through)) return "a pass record needs through: [solid ids]"
		return undefined
	}
	return `role must be rotor or pass (it is ${String(r.role)})`
}

/** A rotor's process: the wind's torque on its stand-in body, and its readings. */
const rotorProcess = (r: ProcessRecord) => {
	const rot = r.rotor as Rotor
	const ans = annuliOf(rot)
	const B = Math.max(1, Math.round(rot.blades))
	const ind = { a: ans.map(() => 0), ap: ans.map(() => 0) }
	const at = r.at as Point
	const axis = num(r.axis, 0)
	const yaw = num(r.yaw, 0)
	const item = r.item as string
	const solid = r.solid as string
	// the shaft downwind (n) and the picture's direction across it (e); a yawed disc's second axis (z') leans out of the picture
	const nx = Math.cos(axis)
	const ny = Math.sin(axis)
	const ex = -ny
	const ey = nx
	const cy = Math.cos(yaw)
	const sy = Math.sin(yaw)
	const area = Math.PI * rot.R * rot.R
	let theta0: number | undefined
	let last = { torque: 0, thrust: 0, wind: 0 }
	/** The jet's axis across the rotor's height (m from its centre along e): the centroid of the wind's push there (0 in an even breeze). */
	const jetAxis = (ctx: ProcessContext) => {
		const N = Math.max(4, ans.length)
		let s1 = 0
		let s0 = 0
		let lo = Number.POSITIVE_INFINITY
		let hi = 0
		for (let k = -N; k <= N; k++) {
			const s = (k / N) * rot.R
			const w = ctx.air({ x: at.x + s * ex, y: at.y + s * ey })
			const u = w.x * nx + w.y * ny
			const q = u > 0 ? u * u : 0
			s1 += s * q
			s0 += q
			lo = Math.min(lo, q)
			hi = Math.max(hi, q)
		}
		return hi > 0 && hi - lo > 0.05 * hi && s0 > 0 ? s1 / s0 : 0
	}
	const loads = (ctx: ProcessContext, omega: number) => {
		const hub = ctx.solid(solid)
		const theta = hub === undefined ? 0 : hub.pose().angle - (theta0 ?? 0)
		const d0 = jetAxis(ctx)
		const rho = ctx.settings.air ? ctx.settings.airDensity : 0
		const wind = (b: number, j: number): ElementWind => {
			const rr = (ans[j] as { r: number }).r
			const phi = theta + (2 * Math.PI * b) / B
			const cphi = Math.cos(phi)
			const sphi = Math.sin(phi)
			// the element in the disc: u along e (in the picture), v along z' (out of it, leaning with the yaw)
			const u = rr * cphi
			const v = rr * sphi
			const z = v * cy
			// (a round jet about an axis in the picture: the wind at the element's own distance from that axis)
			const du = u - d0
			const dist = Math.sqrt(du * du + z * z)
			const s = d0 + (du >= 0 ? dist : -dist)
			const p = { x: at.x + s * ex - v * sy * nx, y: at.y + s * ey - v * sy * ny }
			const w = ctx.air(p)
			const wn = w.x * nx + w.y * ny
			const we = w.x * ex + w.y * ey
			// along the shaft (tilted by the yaw) and along the blade's path: t = −sin φ·e + cos φ·z', z' = −sin ψ·n + cos ψ·ẑ
			return { axial: wn * cy, across: -sphi * we - cphi * sy * wn }
		}
		return rotorLoads(rot, ans, omega, rho, wind, ind)
	}
	return {
		start(ctx: ProcessContext) {
			theta0 = ctx.solid(solid)?.pose().angle ?? 0
			for (const k of ["rpm", "turns", "angle", "wind_ms", "tsr", "power_mw", "cp", "thrust_n"]) ctx.set(item, k, 0)
		},
		step(ctx: ProcessContext) {
			const hub = ctx.solid(solid)
			if (hub === undefined) return
			const omega = hub.spin()
			const angle = hub.pose().angle - (theta0 ?? 0)
			ctx.set(item, "rpm", (omega * 60) / (2 * Math.PI))
			ctx.set(item, "angle", angle)
			ctx.set(item, "turns", angle / (2 * Math.PI))
			// (before the release nothing turns, but the wind already blows: what reaches it)
			if (!ctx.released()) last = loads(ctx, 0)
			const U = last.wind
			const rho = ctx.settings.air ? ctx.settings.airDensity : 0
			const power = last.torque * omega
			ctx.set(item, "wind_ms", U)
			ctx.set(item, "tsr", U > 0.1 ? (omega * rot.R) / U : 0)
			ctx.set(item, "power_mw", power * 1000)
			ctx.set(item, "cp", U > 0.1 && rho > 0 ? power / (0.5 * rho * area * U * U * U) : 0)
			ctx.set(item, "thrust_n", last.thrust)
		},
		force(ctx: ProcessContext) {
			const hub = ctx.solid(solid)
			if (hub === undefined || !hub.dynamic) return
			last = loads(ctx, hub.spin())
			if (Number.isFinite(last.torque)) hub.twist(last.torque)
		}
	}
}

/** A pass record's process: the contacts of its solid with the solids it hangs through are left out. */
const passProcess = (r: ProcessRecord, ctx: ProcessContext) => {
	const solid = r.solid as string
	const through = new Set((r.through as unknown[]).filter((s): s is string => typeof s === "string"))
	type Fx = { getUserData(): unknown }
	type Touch = { getFixtureA(): Fx; getFixtureB(): Fx }
	return {
		contact(_c: ProcessContext, touch: unknown, _phase: "begin" | "pre") {
			const E = ctx.engine()
			if (E === undefined) return false
			const t = touch as Touch
			const a = E.solidOf(t.getFixtureA().getUserData())?.id
			const b = E.solidOf(t.getFixtureB().getUserData())?.id
			if (a === undefined || b === undefined) return false
			return (a === solid && through.has(b)) || (b === solid && through.has(a))
		}
	}
}

const energy: ProcessKind = {
	kind: "energy",
	check: (record: ProcessRecord, solids: ReadonlySet<string>) => energyProblem(record, solids),
	create(record, ctx) {
		if (record.role === "rotor") return rotorProcess(record)
		if (record.role === "pass") return passProcess(record, ctx)
		return {}
	}
}

export default [energy]
