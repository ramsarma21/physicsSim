import { type Body, type Joint, Vec2, WeldJoint, type World } from "planck"
import { areaAndCentroid, type EngineInternals, type Point, type Process, type ProcessContext, type ProcessRecord, type SolidHandle } from "#sim/plugins.ts"

/**
 * The air module's engine physics (engine4 module "air"; its process kind is tooling/src/sim/modules/air.ts, its catalog
 * machines/mod_air.py and the exact port web/sim/modules/air.js). Everything here runs only for a document's `air` process records
 * ({kind: "air", id, item, role, ...}); a document without one runs exactly as before.
 *
 * Roles (machines/mod_air.py builds them; points are WORLD metres unless said, angles radians):
 *   balloon  a rubber party balloon: its gas (air or helium, `moles`, `molar`) at the room's temperature fills it to where the gas's
 *            pressure equals the room's (or a vacuum jar's) plus its rubber's (`skinPressure`): the ideal gas law PV = nRT against the
 *            thin Mooney-Rivlin sphere. It grows, shrinks and pops (stretched past `burst`, pricked at `prick` s, or in a vacuum); an
 *            untied one lets its air out of its neck as a jet (thrust 2·C_c·Δp·A, the flow C_c·A·v, v = √(2Δp/ρ)); a pumped one grows from
 *            a hand pump's nozzle (`pump` mol/s) until it pops; helium (and air, slower) seeps out through the latex over hours (`leak`,
 *            1/s of the scene's time-lapse). Its body is resized to its size and its mass is its rubber + its gas + the air it drags
 *            along (½ρV), so the engine's own air buoyancy (ρ·g·V) lifts it exactly as a real one: helium rises, air sinks slowly.
 *   hotair   a model hot-air balloon (envelope + mouth ring, one weld group): its inside air heats from a heat gun below its mouth and
 *            cools through its skin (U·A·ΔT); the air inside weighs ρ_room·T_room/T_in (ideal gas at the room's pressure), so the
 *            group's mass is lightened by (ρ − ρ_in)·V: it rises when that beats its envelope, ring and payload.
 *   glider   a paper airplane or balsa glider: thin flat lifting surfaces (normal force C_N(α) with Helmbold's lift slope, crossflow
 *            and stall; centre of pressure moving aft with α), thrown at the release with `launch`; lands where it first touches.
 *   kite     a flat kite on a line to a stake: the same flat-plate aerodynamics in the wind (fans, a breeze) plus its tail's drag.
 *   smoke    an incense stick's smoke: particles carried by the air (fans' and a breeze's streams), rising in its own plume
 *            (Morton-Taylor-Turner) and in the plumes over warm things (any item with a "temp" or "water_temp" reading: the heat
 *            module's) and the heat guns, sinking under cold ones; drawn from `track.series[item].smoke` ([x, y, age] per particle).
 *   anemometer  a cup anemometer: the air's speed at its cups (fans, a breeze).
 *   jar      a vacuum jar (bell jar on a pump): its inside pressure falls as P_low + (P_room − P_low)·e^(−t/τ) from `pump_at`, back up at
 *            `vent_at`; balloons, cards and suction cups inside it feel that pressure.
 *   card     a card under an upside-down glass of water: held while the air's push can hold up the water and the card with the trapped
 *            air expanding less than the water's seal can bridge (a weld while it holds, broken when it cannot).
 *   cup      a suction cup holding a hanging weight under a panel: holds while the weight's pull is less than the air's push Δp·A
 *            (a weld broken past it).
 *   can      a soda can with steam in it, dunked mouth-down into cold water by tongs: its steam condenses, its pressure falls to the
 *            water's vapour pressure plus what air is left, and the room's air crushes it once the difference passes its wall's
 *            buckling pressure (Windenburg & Trilling).
 *
 * Determinism: only + − × ÷, Math.sqrt/abs/min/max/floor/round/sign and the engine's Math.sin/cos/atan2/exp/pow (tools/fdlibm.ts,
 * tools/crpow.ts); particles' jitter is a 32-bit xorshift seeded from the item id. No clocks, no Math.random.
 */

// ------------------------------------------------------------------------------------------------------------------------------
// Constants (each with its source)

/** physics.ts's LENGTH_SCALE: planck units per metre (checked against EngineInternals.lengthScale). */
export const LS = 10
/** The molar gas constant, J/(mol·K): CODATA 2018 (exact). */
export const GAS_R = 8.314462618
/** The standard atmosphere, Pa (ISO 2533): the room's pressure. */
export const ATM = 101325
export const KELVIN = 273.15
/** Molar masses, kg/mol: dry air 28.9644 g/mol (U.S. Standard Atmosphere 1976), helium 4.0026 g/mol (IUPAC). */
export const MOLAR = { air: 0.0289644, helium: 0.0040026 } as const
/** The engine's air density, kg/m³ (physics.ts AIR_DENSITY: air at about 20 °C, 1 atm is 1.204). */
export const ENGINE_AIR = 1.2
/** Air's specific heat at constant pressure, J/(kg·K) at 300 K: 1007 (Incropera, Fundamentals of Heat and Mass Transfer, Table A.4). */
export const CP_AIR = 1007
/** Water at 20 °C, kg/m³ (IAPWS-95: 998.2). */
export const WATER = 998.2

/**
 * A latex party balloon's rubber, as the thin Mooney-Rivlin sphere of Merritt & Weinhaus ("The pressure curve for a rubber balloon",
 * Am. J. Phys. 46, 976 (1978)): Δp ∝ (1/λ − 1/λ⁷)(1 + λ²/k), k = C1/C2 ≈ 10 (the mechanics module's balloon rocket uses the same law).
 * Scaled to `fullPressure` at the balloon's rated size, which is `full` times its unstretched radius; it bursts past `burst`.
 * Provisional calibrations: party balloons hold 2-4 kPa over the room (3.0 used); a balloon is blown to about 6 times its slack size
 * and pops at about 1.3 times its rated diameter (latex's elongation at break 700-900 %; makers say "do not over-inflate").
 */
export const RUBBER = { k: 10, full: 6, fullPressure: 3000, burst: 7.8 } as const
/** A sharp-edged neck's jet contraction (orifice C_c 0.60-0.62, ISO 5167-2), the mechanics module's `JET_CONTRACTION`. */
export const NECK_CONTRACTION = 0.62

/** The vapour pressure of water over a flat surface, Pa, at T °C: Buck's equation (Buck, J. Appl. Meteor. 20, 1527 (1981), 1996 form). */
export const steamPressure = (tc: number) => 611.21 * Math.exp((18.678 - tc / 234.5) * (tc / (257.14 + tc)))

/**
 * The external pressure (Pa) that buckles a thin cylinder of length L, diameter D and wall t: Windenburg & Trilling's form of von
 * Mises' result (Trans. ASME 56, 819 (1934)), p = 2.42·E·(t/D)^2.5 / ((1 − ν²)^0.75 · (L/D − 0.45·(t/D)^0.5)).
 */
export const bucklingPressure = (E: number, nu: number, t: number, D: number, L: number) =>
	(2.42 * E * Math.pow(t / D, 2.5)) / (Math.pow(1 - nu * nu, 0.75) * (L / D - 0.45 * Math.sqrt(t / D)))

// ------------------------------------------------------------------------------------------------------------------------------
// Gas and rubber (the catalog builders, machines/mod_air.py and web/sim/modules/air.js, compute the same numbers the same way)

/** The rubber's stretch law's shape (zero while slack). */
export const rubberShape = (l: number) => {
	if (l <= 1) return 0
	const l2 = l * l
	const l4 = l2 * l2
	const l7 = l4 * l2 * l
	return (1 / l - 1 / l7) * (1 + l2 / RUBBER.k)
}
const FULL_SHAPE = rubberShape(RUBBER.full)
/** The balloon's over-pressure (Pa) at stretch λ = r/r₀. */
export const skinPressure = (l: number) => (RUBBER.fullPressure * rubberShape(l)) / FULL_SHAPE
export const sphereVolume = (r: number) => (4 / 3) * Math.PI * r * r * r

/**
 * The radius (m) at which n mol of gas at T (K) fill a balloon of unstretched radius r0 against the pressure pout outside:
 * (pout + Δp(r/r0))·(4/3)πr³ = nRT, by 64 halvings between half its slack size and `cap` (its bursting radius). Returns `cap` when the
 * gas needs more room than that (it bursts) and the lower end when it is less than a limp balloon holds.
 */
export const balloonRadius = (n: number, T: number, pout: number, r0: number, cap: number) => {
	const want = n * GAS_R * T
	const f = (r: number) => (pout + skinPressure(r / r0)) * sphereVolume(r) - want
	let lo = 0.5 * r0
	let hi = cap
	if (f(lo) >= 0) return lo
	if (f(hi) <= 0) return hi
	for (let k = 0; k < 64; k++) {
		const mid = (lo + hi) / 2
		if (f(mid) < 0) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

/** Whether n mol at T need more room than the rubber can give before it bursts (its equilibrium is past `burst`). */
export const bursts = (n: number, T: number, pout: number, r0: number) => {
	const rb = r0 * RUBBER.burst
	return (pout + skinPressure(RUBBER.burst)) * sphereVolume(rb) < n * GAS_R * T
}

// ------------------------------------------------------------------------------------------------------------------------------
// Flat-plate aerodynamics (gliders, kites)

/** Helmbold's lift-curve slope (per radian) of a thin wing of aspect ratio AR: 2πAR/(2 + √(AR² + 4)) (Anderson, Fundamentals of Aerodynamics §5.3). */
export const liftSlope = (AR: number) => (2 * Math.PI * AR) / (2 + Math.sqrt(AR * AR + 4))
/**
 * The angle (rad) past which a flat plate's attached-flow lift fails: about 15° for aspect ratios of 3 and more, rising to about 35° at
 * aspect ratio 1 and under, where the edge vortices hold the flow (Torres & Mueller, AIAA J. 42, 865 (2004): low-aspect-ratio flat plates
 * stall late and gently). Approximate.
 */
export const stallAngle = (AR: number) => (AR >= 3 ? 0.26 : AR <= 1 ? 0.61 : 0.61 + ((AR - 1) * (0.26 - 0.61)) / 2)
/** A flat plate's crossflow (broadside) drag coefficient: Hoerner, Fluid-Dynamic Drag (1965), a square plate 1.17 (1.2 used). */
export const CROSSFLOW = 1.2

/**
 * A thin flat surface's normal-force coefficient at angle of attack α (rad, any value; positive: the air meets its underside):
 * C_N = a·sin α·|cos α|·s(α) + C_Dc·sin α·|sin α| (attached-flow lift with Helmbold's slope a, faded to nothing over 20° past the stall,
 * plus the crossflow term that takes over toward 90°: Polhamus's form for low-aspect-ratio wings, NASA TN D-3767 (1966)).
 */
export const normalCoefficient = (alpha: number, AR: number, crossflow = CROSSFLOW) => {
	const s = Math.sin(alpha)
	const c = Math.cos(alpha)
	const a = Math.abs(Math.atan2(Math.abs(s), Math.abs(c))) // the angle folded into 0…π/2 (a plate met back-first is the same plate)
	const st = stallAngle(AR)
	const fade = a <= st ? 1 : Math.max(0, 1 - (a - st) / 0.35)
	return liftSlope(AR) * s * Math.abs(c) * fade + crossflow * s * Math.abs(s)
}
/** Where the normal force acts, as a share of the chord from the edge that meets the air: 0.25 at small angles, 0.5 broadside (Hoerner). */
export const pressureCentre = (alpha: number) => 0.25 + 0.25 * Math.abs(Math.sin(alpha))

/** One lifting surface in its body's frame: its leading edge (m), its chord's direction (rad, trailing edge → leading edge), size. */
export interface Surface {
	readonly lx: number
	readonly ly: number
	readonly ang: number
	readonly c: number
	readonly S: number
	readonly AR: number
	readonly cd0: number
}

/**
 * The air's force on a surface of a body at pose (x, y, θ) moving at v (m/s) and turning at ω (rad/s) through air moving at `wind`
 * (m/s, from `air(p)`), density ρ: {fx, fy, at (world point), alpha, speed}. The normal force ½ρu²·S·C_N(α) along the surface's normal,
 * at its centre of pressure, and its skin friction ½ρu²·S·C_D0 against its motion through the air.
 */
export const surfaceForce = (
	s: Surface,
	pose: { x: number; y: number; angle: number },
	v: Point,
	w: number,
	rho: number,
	air: (p: Point) => Point
) => {
	const ca = Math.cos(pose.angle)
	const sa = Math.sin(pose.angle)
	const toWorld = (lx: number, ly: number) => ({ x: pose.x + lx * ca - ly * sa, y: pose.y + lx * sa + ly * ca })
	const ch = { x: Math.cos(pose.angle + s.ang), y: Math.sin(pose.angle + s.ang) }
	const nr = { x: -ch.y, y: ch.x }
	const le = toWorld(s.lx, s.ly)
	// (first at mid-chord, then at the centre of pressure that angle gives)
	const at = (share: number) => ({ x: le.x - ch.x * s.c * share, y: le.y - ch.y * s.c * share })
	const motion = (p: Point) => {
		const wind = air(p)
		// the point's velocity: the body's at its middle plus ω × r (r from the body's origin: the pose's point, where v is taken)
		const rx = p.x - pose.x
		const ry = p.y - pose.y
		return { x: v.x - w * ry - wind.x, y: v.y + w * rx - wind.y }
	}
	let p = at(0.5)
	let u = motion(p)
	let alpha = Math.atan2(-(u.x * nr.x + u.y * nr.y), u.x * ch.x + u.y * ch.y)
	const back = Math.abs(alpha) > Math.PI / 2
	const share = (a: number) => (back ? 1 - pressureCentre(a) : pressureCentre(a))
	p = at(share(alpha))
	u = motion(p)
	alpha = Math.atan2(-(u.x * nr.x + u.y * nr.y), u.x * ch.x + u.y * ch.y)
	const speed2 = u.x * u.x + u.y * u.y
	if (!(speed2 > 0) || !(rho > 0)) return { fx: 0, fy: 0, at: p, alpha, speed: Math.sqrt(speed2) }
	const q = 0.5 * rho * speed2
	const cn = normalCoefficient(alpha, s.AR)
	const speed = Math.sqrt(speed2)
	const fx = q * s.S * cn * nr.x - (q * s.S * s.cd0 * u.x) / speed
	const fy = q * s.S * cn * nr.y - (q * s.S * s.cd0 * u.y) / speed
	return { fx, fy, at: p, alpha, speed }
}

// ------------------------------------------------------------------------------------------------------------------------------
// Rising air: the plume over a heat source (Morton, Taylor & Turner, Proc. R. Soc. A 234, 1 (1956))

/** A plume's buoyancy flux F = g·Q/(ρ·c_p·T), m⁴/s³, from a heat source of Q watts in air at T K. */
export const buoyancyFlux = (q: number, g: number, T: number) => (g * q) / (ENGINE_AIR * CP_AIR * T)
/** Its centreline speed z metres above the source, m/s: w = 3.4·F^(1/3)·z^(−1/3) (MTT's point-source plume, entrainment 0.1; capped near it). */
export const plumeSpeed = (F: number, z: number) => (F === 0 ? 0 : Math.sign(F) * 3.4 * Math.pow(Math.abs(F), 1 / 3) * Math.pow(Math.max(z, 0.02), -1 / 3))
/** Its half-width z metres above the source: 6/5 of the entrainment coefficient (0.1) per metre (MTT). */
export const PLUME_SPREAD = 0.12

// ------------------------------------------------------------------------------------------------------------------------------
// Small deterministic helpers

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d)
const pt = (v: unknown, d: Point = { x: 0, y: 0 }): Point => {
	const o = v as { x?: unknown; y?: unknown } | null | undefined
	return o && typeof o === "object" ? { x: num(o.x, d.x), y: num(o.y, d.y) } : d
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (u: number) => {
	const v = clamp01(u)
	return v * v * (3 - 2 * v)
}
/** A 32-bit xorshift generator seeded from a text (the item's id): the same numbers everywhere. */
export const randomOf = (seed: string) => {
	let h = 2166136261
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
	let x = h || 1
	return () => {
		x ^= x << 13
		x >>>= 0
		x ^= x >>> 17
		x ^= x << 5
		x >>>= 0
		return x / 4294967296
	}
}

/** A jar a thing may stand in: its inside (world), whose pressure its own process sets as the reading `pressure_kpa`. */
interface Jar {
	readonly item: string
	readonly x0: number
	readonly x1: number
	readonly y0: number
	readonly y1: number
}
const jarsOf = (r: ProcessRecord): Jar[] =>
	Array.isArray(r.jars)
		? (r.jars as unknown[]).flatMap((j) => {
				const o = j as Record<string, unknown>
				return typeof o?.item === "string" ? [{ item: o.item, x0: num(o.x0, 0), x1: num(o.x1, 0), y0: num(o.y0, 0), y1: num(o.y1, 0) }] : []
			})
		: []
/** The air's pressure (Pa) round a point: none in a vacuum, a jar's inside it, else the room's. */
const pressureAt = (ctx: ProcessContext, jars: readonly Jar[], p: Point) => {
	if (!ctx.settings.air) return 0
	for (const j of jars) {
		if (p.x >= j.x0 && p.x <= j.x1 && p.y >= j.y0 && p.y <= j.y1) {
			const kpa = ctx.get(j.item, "pressure_kpa")
			return kpa === undefined ? ATM : Math.max(0, kpa * 1000)
		}
	}
	return ATM
}
const roomK = (ctx: ProcessContext) => ctx.settings.roomTemperature + KELVIN
// (a world's own air, settings.airDensity: Mars's 0.020, Venus's 65 kg/m³; the standard is ENGINE_AIR itself, 1.2, bit for bit)
const airRho = (ctx: ProcessContext) => (ctx.settings.air ? (ctx.settings.airDensity ?? ENGINE_AIR) : 0)
const bodyOf = (ctx: ProcessContext, id: string) => ctx.engine()?.bodyOf(id) as Body | undefined
const middle = (h: SolidHandle | undefined): Point => {
	if (h === undefined) return { x: 0, y: 0 }
	const o = h.outline()
	if (o.circle !== undefined) return { x: o.circle.x, y: o.circle.y }
	const pts = o.points ?? []
	if (pts.length < 3) return h.pose()
	const c = areaAndCentroid(pts)
	return { x: c.x, y: c.y }
}
const bounds = (h: SolidHandle) => {
	const o = h.outline()
	if (o.circle !== undefined) return { x0: o.circle.x - o.circle.r, x1: o.circle.x + o.circle.r, y0: o.circle.y - o.circle.r, y1: o.circle.y + o.circle.r }
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	for (const q of o.points ?? []) {
		x0 = Math.min(x0, q.x)
		x1 = Math.max(x1, q.x)
		y0 = Math.min(y0, q.y)
		y1 = Math.max(y1, q.y)
	}
	return { x0, x1, y0, y1 }
}
const r3 = (v: number) => Math.round(v * 1000) / 1000
const r2 = (v: number) => Math.round(v * 100) / 100

// ------------------------------------------------------------------------------------------------------------------------------
// The roles

export const AIR_ROLES = ["balloon", "hotair", "glider", "kite", "smoke", "anemometer", "jar", "card", "cup", "can"] as const
const NEEDS: Record<string, readonly string[]> = {
	balloon: ["solid"],
	hotair: ["solid", "ring"],
	glider: ["solid"],
	kite: ["solid"],
	smoke: [],
	anemometer: [],
	jar: [],
	card: ["solid", "glass"],
	cup: ["solid", "plate"],
	can: ["solid"]
}

/** Why an air record cannot run (the document is refused with it), or undefined. */
export const airProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	const role = str(r.role, "")
	if (!(AIR_ROLES as readonly string[]).includes(role)) return `an air record needs a role (${AIR_ROLES.join(", ")}), not "${role}"`
	for (const key of NEEDS[role] ?? []) if (typeof r[key] !== "string" || !solids.has(r[key] as string)) return `its ${key} is not a solid of the document`
	if (role === "balloon" && !(num(r.r0, 0) > 0 && num(r.rubber, 0) > 0 && num(r.molar, 0) > 0 && num(r.moles, -1) >= 0)) return "a balloon needs r0, rubber and molar above 0 and moles of 0 or more"
	if (role === "glider" && !(Array.isArray(r.surfaces) && r.surfaces.length > 0)) return "a glider needs its surfaces"
	if (role === "kite" && typeof r.surface !== "object") return "a kite needs its surface"
	return undefined
}

/** Sets a lone ball body's mass and inertia (planck units) when they differ from what is wanted. */
const setBallMass = (body: Body | undefined, mass: number, inertia: number) => {
	if (body === undefined || !body.isDynamic()) return
	if (Math.abs(body.getMass() - mass) <= 1e-12 * Math.max(1, mass)) return
	body.setMassData({ mass, center: new Vec2(0, 0), I: inertia * LS * LS })
	// (its weight against its lift changed: a body planck put to sleep resting somewhere must feel it)
	body.setAwake(true)
}

// ---- the warm and cold things round a balloon (the heat module's items: any item with a "temp" or "water_temp" reading)
/** A latex balloon touching a surface this hot (°C) pops at once: natural rubber softens and tears from about 120-180 °C (a party balloon on a
 *  hot plate bursts on contact; provisional, as the repair asked: about 150 °C). */
export const LATEX_LIMIT_C = 150
/**
 * The MTT plume's excess buoyancy z metres above a point source of buoyancy flux F: g' = C·F^(2/3)·z^(−5/3), C = (5/(6α))·(9α/10)^(−1/3)·π^(−2/3)
 * = 8.67 for the top-hat entrainment α = 0.1 (Morton, Taylor & Turner 1956; Linden, "The fluid mechanics of natural ventilation", Annu. Rev.
 * Fluid Mech. 31, 201 (1999)). The air there is ΔT = T·g'/g warmer than the room.
 */
export const PLUME_G = 8.67
/** A balloon skin's overall heat transfer (W/(m²·K)): free convection on both sides of a thin rubber skin, about 5 (provisional: still air
 *  2-25 each side, Incropera Table 1.1). Its gas then warms toward the air round it with τ = (m_gas·c_p + m_rubber·c_rubber)/(U·A): about 15 s
 *  for an 8 L party balloon. */
export const SKIN_U = 5
/** Specific heats, J/(kg·K): air 1007, helium 5193 (NIST webbook, 300 K, 1 atm), natural rubber 1900 (CRC: 1.88-2.0 kJ/(kg·K)). */
export const CP_GAS = { air: 1007, helium: 5193 } as const
export const CP_RUBBER = 1900
/** How long an over-filled balloon, or one in no air, takes to swell to bursting once let go, s: within a few tenths of a second (it is
 *  drawn as it was filled while it is held, so a video shows it swell and burst; provisional). */
export const SWELL_S = 0.3

interface Warm {
	readonly item: string
	readonly solids: ReadonlySet<string>
	readonly x0: number
	readonly x1: number
	readonly top: number
	readonly bottom: number
	/** its temperature, °C, and its excess over the room's */
	readonly t: number
	readonly dT: number
	readonly F: number
}
/** The warm and cold things in the run other than `self`, with their plumes' buoyancy fluxes (as the smoke's refresh: h ≈ 5 W/(m²·K) over its top). */
const warmThings = (ctx: ProcessContext, self: string): Warm[] => {
	const seen = new Set<string>()
	const out: Warm[] = []
	const room = ctx.settings.roomTemperature
	const Troom = roomK(ctx)
	for (const h of ctx.all()) {
		if (h.item === self || seen.has(h.item)) continue
		seen.add(h.item)
		const ts = [ctx.get(h.item, "temp"), ctx.get(h.item, "water_temp")].filter((v): v is number => v !== undefined)
		if (!ts.length) continue
		const t = ts.reduce((a, b) => (Math.abs(b - room) > Math.abs(a - room) ? b : a))
		const dT = t - room
		if (Math.abs(dT) < 2) continue
		let b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
		const solids = new Set<string>()
		for (const s of ctx.solidsOf(h.item)) {
			const q = bounds(s)
			solids.add(s.id)
			b = { x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), y0: Math.min(b.y0, q.y0), y1: Math.max(b.y1, q.y1) }
		}
		const q = 5 * (b.x1 - b.x0) * 0.1 * dT
		out.push({ item: h.item, solids, x0: b.x0, x1: b.x1, top: b.y1, bottom: b.y0, t, dT, F: buoyancyFlux(q, ctx.settings.gravity, Troom) })
	}
	return out
}
/**
 * The air's temperature (K) round a ball of radius R at p: the room's, warmer in the plume over a hot thing (colder under a cold one), and
 * halfway to a thing's own temperature where it touches it (the thin layer of air between them: provisional). `touching`: the solids it touches.
 */
const airTemperatureAt = (ctx: ProcessContext, warm: readonly Warm[], p: Point, R: number, touching: readonly string[]) => {
	const Troom = roomK(ctx)
	if (!ctx.settings.air) return Troom
	let best = 0
	for (const s of warm) {
		let dT = 0
		if (touching.some((id) => s.solids.has(id))) dT = 0.5 * s.dT
		else {
			const above = s.F > 0 ? p.y - R - s.top : s.bottom - (p.y + R)
			if (above < -R) continue
			const half = (s.x1 - s.x0) / 2 + PLUME_SPREAD * Math.max(0, above)
			const off = Math.abs(p.x - (s.x0 + s.x1) / 2)
			if (off > half + R) continue
			const z = Math.max(0, above) + 0.05
			const gp = PLUME_G * Math.pow(Math.abs(s.F), 2 / 3) * Math.pow(z, -5 / 3)
			const g = ctx.settings.gravity > 0 ? ctx.settings.gravity : 9.81
			dT = Math.sign(s.dT) * Math.min(Math.abs(s.dT), (Troom * gp) / g) * Math.exp(-(off * off) / (half * half))
		}
		if (Math.abs(dT) > Math.abs(best)) best = dT
	}
	return Troom + best
}

// ---- balloon
function balloonProcess(r: ProcessRecord, ctx0: ProcessContext): Process {
	const item = r.item as string
	const solid = r.solid as string
	const name = str(r.name, item)
	const r0 = num(r.r0, 0.02)
	const rubber = num(r.rubber, 0.003)
	const molar = num(r.molar, MOLAR.air)
	const rdoc = num(r.rdoc, r0 * RUBBER.full)
	const neck = num(r.neck, 0.004)
	const tied = r.tied !== false
	const pump = num(r.pump, 0)
	const nozzle = r.nozzle === undefined ? null : pt(r.nozzle)
	const up = pt(r.up, { x: 0, y: 1 })
	const prick = num(r.prick, -1)
	const leak = num(r.leak, 0)
	const jars = jarsOf(r)
	const cpGas = molar < 0.01 ? CP_GAS.helium : CP_GAS.air
	let n = Math.max(0, num(r.moles, 0))
	let radius = rdoc
	let shown = rdoc
	let popped = false
	let thrust = 0
	/** its gas's temperature, K (the room's at the start; it warms or cools toward the air round it) */
	let T = 0
	/** why it bursts as soon as it is let go (it would at the start: no air outside, or over-filled), or null */
	let doomed: string | null = null
	let swellAt = -1
	let swellFrom = rdoc
	let d0 = -1
	let warm: Warm[] = []
	const cap = r0 * RUBBER.burst
	void ctx0
	const handle = (ctx: ProcessContext) => ctx.solid(solid)
	const centre = (ctx: ProcessContext) => {
		const h = handle(ctx)
		return h === undefined ? { x: 0, y: 0 } : h.pose()
	}
	/** The air's density round it, kg/m³: the room's, or a pumped jar's (ρ ∝ p at the room's temperature). */
	const rhoOut = (ctx: ProcessContext, pout: number) => airRho(ctx) * Math.min(1, Math.max(0, pout / ATM))
	const fixMass = (ctx: ProcessContext) => {
		if (popped) return
		const V = sphereVolume(radius)
		const gas = n * molar
		// (the air it drags along is the air round it: a pumped jar's thinner air; the engine's buoyancy on it scales the same way, set by the jar)
		const rho = rhoOut(ctx, pressureAt(ctx, jars, centre(ctx)))
		setBallMass(bodyOf(ctx, solid), rubber + gas + 0.5 * rho * V, ((2 / 3) * rubber + (2 / 5) * gas) * radius * radius)
	}
	const pop = (ctx: ProcessContext, why: string, others: readonly string[] = []) => {
		popped = true
		n = 0
		thrust = 0
		handle(ctx)?.resize(0)
		ctx.set(item, "popped", 1)
		ctx.set(item, "diameter_cm", 0)
		ctx.set(item, "lift_g", 0)
		ctx.set(item, "pressure_kpa", 0)
		ctx.set(item, "volume_l", 0)
		ctx.event(`${name} popped (${why})`, [item, ...others], "popped")
	}
	const place = (ctx: ProcessContext) => {
		// a balloon on a pump: its neck stays on the nozzle, so its middle is a radius above it along `up`
		if (nozzle === null) return
		const b = bodyOf(ctx, solid)
		if (b === undefined) return
		b.setTransform(new Vec2((nozzle.x + up.x * radius) * LS, (nozzle.y + up.y * radius) * LS), Math.atan2(-up.x, up.y))
		b.setLinearVelocity(new Vec2(0, 0))
		b.setAngularVelocity(0)
	}
	const whyBursts = (pout: number) => (pout <= 0 ? "no air pressed on it from outside" : "over-filled: stretched past what its rubber takes")
	const settle = (ctx: ProcessContext) => {
		const pout = pressureAt(ctx, jars, centre(ctx))
		if (doomed !== null) {
			// it would burst at once: drawn as it was filled while it is held, then it swells and bursts within SWELL_S of the release
			if (!ctx.released()) radius = rdoc
			else {
				if (swellAt < 0) {
					swellAt = ctx.time()
					swellFrom = radius
				}
				const u = (ctx.time() - swellAt) / SWELL_S
				if (u >= 1) return pop(ctx, doomed)
				radius = swellFrom + (cap - swellFrom) * smooth(u)
			}
		} else if (bursts(n, T, pout, r0)) return pop(ctx, whyBursts(pout))
		else radius = balloonRadius(n, T, pout, r0, cap)
		if (Math.abs(radius - shown) > 0.002 * shown) {
			handle(ctx)?.resize(radius / rdoc)
			shown = radius
		}
		place(ctx)
		fixMass(ctx)
		const lambda = radius / r0
		const V = sphereVolume(radius)
		if (d0 < 0) d0 = 200 * radius
		ctx.set(item, "diameter_cm", 200 * radius)
		ctx.set(item, "pressure_kpa", skinPressure(lambda) / 1000)
		ctx.set(item, "volume_l", V * 1000)
		// (its net lift in the air round it: a pumped jar's thinner air lifts it less, so in a hard vacuum even a swollen balloon sinks)
		ctx.set(item, "lift_g", (rhoOut(ctx, pout) * V - rubber - n * molar) * 1000)
		ctx.set(item, "thrust_n", thrust)
		ctx.set(item, "gas_c", T - KELVIN)
	}
	return {
		start(ctx) {
			T = roomK(ctx)
			ctx.set(item, "popped", 0)
			const pout = pressureAt(ctx, jars, centre(ctx))
			if (bursts(n, T, pout, r0)) doomed = whyBursts(pout)
			warm = warmThings(ctx, item)
			settle(ctx)
		},
		step(ctx) {
			if (popped) return
			// (a pin pricks it then, or at the release if that is later: a balloon is never gone before it is seen)
			if (prick >= 0 && ctx.time() >= prick && ctx.released() && radius > r0 * 1.02) return pop(ctx, "a pin pricked it")
			if (pump > 0 && ctx.settings.air) n += pump * ctx.step
			if (warm.length > 0) {
				// touching something hotter than latex takes: it pops at once
				const hot = warm.find((s) => s.t >= LATEX_LIMIT_C && ctx.touching(solid).some((id) => s.solids.has(id)))
				if (hot !== undefined) return pop(ctx, `it touched ${hot.item} at ${hot.t.toFixed(0)} °C: hot enough to melt latex`, [hot.item])
			}
			settle(ctx)
		},
		slow(ctx, dt) {
			// gas seeping out through the latex (helium in hours, air in days): the scene's time-lapse speeds it up
			if (!popped && leak > 0) n *= Math.exp(-leak * dt)
			if (popped) return
			// its gas warms or cools toward the air round it (Charles: V ∝ T at its pressure), through its skin with τ = heat capacity / (U·A)
			warm = warmThings(ctx, item)
			const Tair = warm.length > 0 ? airTemperatureAt(ctx, warm, centre(ctx), radius, ctx.touching(solid)) : roomK(ctx)
			const C = n * molar * cpGas + rubber * CP_RUBBER
			const UA = SKIN_U * 4 * Math.PI * radius * radius
			if (C > 0 && UA > 0 && Tair !== T) T += (Tair - T) * (1 - Math.exp((-dt * UA) / C))
		},
		end(ctx) {
			// (a balloon that grew or shrank and did not pop, said for the run's story)
			if (popped || d0 <= 0) return
			const d = 200 * radius
			if (Math.abs(d / d0 - 1) >= 0.05) ctx.event(`${name} ${d > d0 ? "swelled" : "shrank"} from ${d0.toFixed(1)} to ${d.toFixed(1)} cm across`, [item], d > d0 ? "swelled" : "shrank", ctx.time() - ctx.step)
		},
		force(ctx, h) {
			if (popped) return
			fixMass(ctx)
			if (tied) return
			const lambda = radius / r0
			const dp = skinPressure(lambda)
			const pout = pressureAt(ctx, jars, centre(ctx))
			if (!(dp > 0) || !(pout > 0)) {
				thrust = 0
				return
			}
			const rhoGas = ((pout + dp) * molar) / (GAS_R * T)
			const speed = Math.sqrt((2 * dp) / rhoGas)
			const area = Math.PI * neck * neck
			const flow = NECK_CONTRACTION * area * rhoGas * speed // kg/s
			thrust = flow * speed // = 2·C_c·Δp·A
			const hd = handle(ctx)
			if (hd === undefined) return
			const a = hd.pose().angle
			// the neck points along the balloon's own −y; the jet leaves that way and pushes it the other
			hd.push(-Math.sin(a) * thrust, Math.cos(a) * thrust)
			n = Math.max(0, n - (flow / molar) * h)
		}
	}
}

// ---- hot-air balloon
function hotAirProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const solid = r.solid as string
	const ring = r.ring as string
	const V = num(r.volume, 0.3)
	const A = num(r.area, 2.5)
	const U = num(r.U, 3.5)
	const power = num(r.power, 0)
	const heater = pt(r.heater)
	const reach = num(r.reach, 0.6)
	const mouth = num(r.mouth, 0.15)
	const until = num(r.until, 1e9)
	const eta = num(r.eta, 0.6)
	const dry = num(r.dry, 0.05)
	let T = num(r.start, 20) + KELVIN
	let rose = false
	let top = 0
	let base: { mass: number; center: Vec2; I: number } | null = null
	let y0: number | null = null
	const apply = (ctx: ProcessContext, rhoIn: number) => {
		const b = bodyOf(ctx, solid)
		if (b === undefined || !b.isDynamic()) return
		if (base === null) {
			const md = { mass: 0, center: new Vec2(0, 0), I: 0 }
			b.getMassData(md)
			base = { mass: md.mass, center: Vec2.clone(md.center), I: md.I }
		}
		const dm = (airRho(ctx) - rhoIn) * V
		const mass = Math.max(1e-6, base.mass - dm)
		if (Math.abs(b.getMass() - mass) <= 1e-12) return
		const k = base.mass / mass
		// (the lighter air is at the envelope's middle, the group body's origin: the centre of mass moves away from it; I about the origin keeps)
		b.setMassData({ mass, center: new Vec2(base.center.x * k, base.center.y * k), I: base.I })
		// (its air warming lightens it: a body planck put to sleep on its stand must feel it)
		b.setAwake(true)
	}
	return {
		start(ctx) {
			y0 = ctx.solid(ring)?.pose().y ?? 0
		},
		step(ctx) {
			const Troom = roomK(ctx)
			const rho = airRho(ctx)
			const rhoIn = rho > 0 ? (rho * Troom) / T : 0
			let heat = 0
			const m = ctx.solid(ring)?.pose()
			if (m !== undefined && rho > 0 && ctx.time() < until && power > 0) {
				const d = m.y - heater.y
				const lat = Math.abs(m.x - heater.x)
				heat = power * eta * clamp01(1 - d / reach) * clamp01(1 - lat / (mouth + 0.05)) * (d > -0.05 ? 1 : 0)
			}
			const cap = Math.max(1e-6, rhoIn * V) * CP_AIR
			if (rho > 0) T += ((heat - U * A * (T - Troom)) / cap) * ctx.step
			T = Math.max(Troom - 40, Math.min(Troom + 160, T))
			apply(ctx, rho > 0 ? (rho * Troom) / T : 0)
			const lift = (rho - (rho > 0 ? (rho * Troom) / T : 0)) * V
			ctx.set(item, "inside_c", T - KELVIN)
			ctx.set(item, "lift_n", lift * ctx.settings.gravity)
			ctx.set(item, "net_g", (lift - dry) * 1000)
			ctx.set(item, "heating_w", heat)
			const up = m === undefined || y0 === null ? 0 : m.y - y0
			ctx.set(item, "height_m", up)
			if (!rose && up >= 0.05) {
				rose = true
				ctx.event(`${str(r.name, item)} lifts off (the air inside ${(T - KELVIN).toFixed(0)} °C)`, [item], "lifts off")
			}
			top = Math.max(top, up)
		},
		end(ctx) {
			const name = str(r.name, item)
			ctx.event(rose ? `${name} rose ${top.toFixed(2)} m at most` : `${name} stays on its stand (the air inside ${(T - KELVIN).toFixed(0)} °C is not hot enough)`, [item], rose ? "rose" : "stays", ctx.time() - ctx.step)
		}
	}
}

// ---- surfaces of a glider or a kite
const surfaceOf = (v: unknown): Surface => {
	const o = (v ?? {}) as Record<string, unknown>
	return { lx: num(o.lx, 0), ly: num(o.ly, 0), ang: num(o.ang, 0), c: num(o.c, 0.1), S: num(o.S, 0.01), AR: num(o.AR, 1), cd0: num(o.cd0, 0.03) }
}
const kinematics = (h: SolidHandle) => {
	// (v at the solid's pose point: its middle's velocity carried to its origin by the turning)
	const pose = h.pose()
	const o = middle(h)
	const v = h.velocity()
	const w = h.spin()
	return { pose, v: { x: v.x - w * (pose.y - o.y), y: v.y + w * (pose.x - o.x) }, w }
}

function gliderProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const solid = r.solid as string
	const name = str(r.name, item)
	const parts = Array.isArray(r.parts) ? (r.parts as unknown[]).filter((p): p is string => typeof p === "string") : [solid]
	const surfaces = (r.surfaces as unknown[]).map(surfaceOf)
	const launch = pt(r.launch)
	// (the other paper planes' parts: planes thrown side by side in this side view share one flight path, so they pass through each other
	// instead of crashing as two planes a metre apart across a room never would)
	const pass = new Set(Array.isArray(r.pass) ? (r.pass as unknown[]).filter((p): p is string => typeof p === "string") : [])
	const mine = new Set(parts)
	let launched = false
	let landed = false
	let start: Point | null = null
	let distance = 0
	let alpha = 0
	let since = 0
	return {
		start(ctx) {
			start = ctx.solid(solid)?.pose() ?? { x: 0, y: 0 }
			ctx.set(item, "distance_m", 0)
			ctx.set(item, "flying", 0)
		},
		contact(ctx, touch) {
			if (pass.size === 0) return false
			const E = ctx.engine()
			const t = touch as { getFixtureA(): { getUserData(): unknown }; getFixtureB(): { getUserData(): unknown } }
			const a = E?.solidOf(t.getFixtureA().getUserData())?.id
			const b = E?.solidOf(t.getFixtureB().getUserData())?.id
			if (a === undefined || b === undefined) return false
			return (mine.has(a) && pass.has(b)) || (mine.has(b) && pass.has(a))
		},
		force(ctx) {
			const h = ctx.solid(solid)
			if (h === undefined) return
			if (!launched) {
				launched = true
				since = ctx.time()
				start = h.pose()
				h.setVelocity(launch.x, launch.y, 0)
			}
			if (landed) {
				// on the floor: a paper plane skids a hand's width, its nose dug in, and stops (the floor's grip on paper as a damping of
				// 25 /s: a 4 m/s landing stops within about 16 cm; provisional), so where it lies is where it landed
				const b = h.body()
				const v = b.velocity
				h.push(-BRAKE * b.mass * v.x, -BRAKE * b.mass * v.y)
				h.twist(-BRAKE * b.inertia * b.spin)
			}
			const rho = airRho(ctx)
			if (!(rho > 0)) return
			const k = kinematics(h)
			surfaces.forEach((s, i) => {
				const f = surfaceForce(s, k.pose, k.v, k.w, rho, (p) => ctx.air(p))
				if (i === 0) alpha = f.alpha
				h.push(f.fx, f.fy, f.at)
			})
		},
		after(ctx) {
			if (!launched || landed || ctx.time() - since < 0.08) return
			if (parts.some((p) => ctx.touching(p).some((o) => !mine.has(o) && !pass.has(o)))) {
				landed = true
				const p = ctx.solid(solid)?.pose()
				distance = p === undefined || start === null ? 0 : Math.abs(p.x - start.x)
				ctx.event(`${name} landed ${distance.toFixed(2)} m from where it was thrown`, [item], "landed")
			}
		},
		step(ctx) {
			const h = ctx.solid(solid)
			if (h === undefined || start === null) return
			const p = h.pose()
			const v = h.velocity()
			ctx.set(item, "speed_ms", Math.hypot(v.x, v.y))
			ctx.set(item, "height_m", p.y - start.y)
			ctx.set(item, "distance_m", landed ? distance : Math.abs(p.x - start.x))
			ctx.set(item, "flying", launched && !landed ? 1 : 0)
			ctx.set(item, "aoa_deg", (alpha * 180) / Math.PI)
		},
		end(ctx) {
			if (launched && !landed) ctx.event(`${name} is still flying at the end, ${(ctx.get(item, "distance_m") ?? 0).toFixed(2)} m from where it was thrown`, [item], "flying", ctx.time() - ctx.step)
		}
	}
}
/** A landed paper plane's skid on the floor, as a damping rate (1/s): see gliderProcess. */
export const BRAKE = 25

function kiteProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const solid = r.solid as string
	const s = surfaceOf(r.surface)
	const tail = (r.tail ?? {}) as Record<string, unknown>
	const tl = { lx: num(tail.lx, -0.3), ly: num(tail.ly, 0), area: num(tail.area, 0), cd: num(tail.cd, 0.1) }
	const stake = pt(r.stake)
	const line = num(r.line, 1)
	let pull = 0
	let wind = 0
	return {
		force(ctx) {
			const h = ctx.solid(solid)
			const rho = airRho(ctx)
			if (h === undefined || !(rho > 0)) return
			const k = kinematics(h)
			const f = surfaceForce(s, k.pose, k.v, k.w, rho, (p) => ctx.air(p))
			h.push(f.fx, f.fy, f.at)
			let fx = f.fx
			let fy = f.fy
			if (tl.area > 0) {
				// its tail: a streamer's drag at the kite's trailing end, against its motion through the air there
				const c = Math.cos(k.pose.angle)
				const sn = Math.sin(k.pose.angle)
				const p = { x: k.pose.x + tl.lx * c - tl.ly * sn, y: k.pose.y + tl.lx * sn + tl.ly * c }
				const air = ctx.air(p)
				const ux = k.v.x - k.w * (p.y - k.pose.y) - air.x
				const uy = k.v.y + k.w * (p.x - k.pose.x) - air.y
				const sp = Math.hypot(ux, uy)
				if (sp > 0) {
					const d = 0.5 * rho * tl.cd * tl.area * sp
					h.push(-d * ux, -d * uy, p)
					fx -= d * ux
					fy -= d * uy
				}
			}
			const m = h.body().mass
			pull = Math.hypot(fx, fy - m * ctx.settings.gravity)
			const a = ctx.air(k.pose)
			wind = Math.hypot(a.x, a.y)
		},
		step(ctx) {
			const h = ctx.solid(solid)
			if (h === undefined) return
			const p = h.pose()
			const dy = p.y - stake.y
			const dx = p.x - stake.x
			ctx.set(item, "height_m", dy)
			ctx.set(item, "line_angle_deg", (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI)
			ctx.set(item, "pull_n", pull)
			ctx.set(item, "wind_ms", wind)
			ctx.set(item, "flying", dy > 0.3 * line && ctx.released() ? 1 : 0)
		},
		end(ctx) {
			const name = str(r.name, item)
			const h = ctx.get(item, "height_m") ?? 0
			const w = ctx.get(item, "wind_ms") ?? 0
			ctx.event(ctx.get(item, "flying") === 1 ? `${name} flies ${h.toFixed(2)} m above its stake (the wind there ${w.toFixed(1)} m/s)` : `${name} does not fly (the wind at it ${w.toFixed(1)} m/s)`, [item], "kite", ctx.time() - ctx.step)
		}
	}
}

// ---- smoke
interface Source {
	readonly x0: number
	readonly x1: number
	readonly top: number
	readonly bottom: number
	readonly F: number
}
function smokeProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const tip = pt(r.tip)
	const rate = Math.max(1, num(r.rate, 10))
	const life = Math.max(0.5, num(r.life, 4.8))
	const count = Math.max(1, Math.min(64, Math.round(num(r.count, 48))))
	const lit = num(r.lit, 0)
	const power = num(r.power, 1.5)
	const heaters = (Array.isArray(r.heaters) ? (r.heaters as unknown[]) : []).map((h) => {
		const o = h as Record<string, unknown>
		return { x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 1), half: num(o.half, 0.03) }
	})
	const rnd = randomOf(`smoke:${item}`)
	const px = new Float64Array(count)
	const py = new Float64Array(count)
	const cycle = new Int32Array(count).fill(-1)
	let sources: Source[] = []
	let every = 0
	const EVERY = 4 // steps (120 Hz)
	const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2 // mean 0, variance 1
	const refresh = (ctx: ProcessContext) => {
		// the warm and cold things in the run (any item with a temperature reading), as plume sources, 10 times a second
		const seen = new Set<string>()
		const out: Source[] = []
		const Troom = roomK(ctx)
		for (const h of ctx.all()) {
			if (h.item === item || seen.has(h.item)) continue
			seen.add(h.item)
			// (its temperature, or its water's: whichever is further from the room's, a pan of hot water's water)
			const room = ctx.settings.roomTemperature
			const ts = [ctx.get(h.item, "temp"), ctx.get(h.item, "water_temp")].filter((v): v is number => v !== undefined)
			if (!ts.length) continue
			const t = ts.reduce((a, b) => (Math.abs(b - room) > Math.abs(a - room) ? b : a))
			const dT = t - room
			if (Math.abs(dT) < 2) continue
			let b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
			for (const s of ctx.solidsOf(h.item)) {
				const q = bounds(s)
				b = { x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), y0: Math.min(b.y0, q.y0), y1: Math.max(b.y1, q.y1) }
			}
			// its heat to the air by free convection, h ≈ 5 W/(m²·K) over its top (provisional: still air 2-25, Incropera Table 1.1)
			const q = 5 * (b.x1 - b.x0) * 0.1 * dT
			out.push({ x0: b.x0, x1: b.x1, top: b.y1, bottom: b.y0, F: buoyancyFlux(q, ctx.settings.gravity, Troom) })
		}
		sources = out
	}
	return {
		start(ctx) {
			refresh(ctx)
		},
		step(ctx) {
			if (every++ % EVERY !== 0) return
			const t = ctx.time()
			if (Math.round(t * 1000) % 100 === 0) refresh(ctx)
			const dt = EVERY * ctx.step
			const g = ctx.settings.gravity
			const Troom = roomK(ctx)
			const own = buoyancyFlux(power, g, Troom)
			const list: number[] = []
			let sx = 0
			let sy = 0
			let ns = 0
			const burning = ctx.settings.air
			for (let i = 0; i < count; i++) {
				const born = lit + i / rate
				if (t < born || !burning) {
					cycle[i] = -1
					continue
				}
				const age = (t - born) % life
				const c = Math.floor((t - born) / life)
				if (c !== cycle[i]) {
					cycle[i] = c
					px[i] = tip.x + (rnd() - 0.5) * 0.004
					py[i] = tip.y + rnd() * 0.004
				}
				const p = { x: px[i] as number, y: py[i] as number }
				const air = ctx.air(p)
				let vx = air.x
				let vy = air.y
				// its own plume: rising from the tip, weakening as it climbs (and drifting with whatever stream it is in)
				const z = p.y - tip.y
				const b = PLUME_SPREAD * Math.max(0, z) + 0.02
				const off = (p.x - tip.x) / b
				vy += plumeSpeed(own, z + 0.03) * Math.exp(-off * off)
				for (const s of sources) {
					const above = s.F > 0 ? p.y - s.top : s.bottom - p.y
					if (above < -0.01) continue
					const half = (s.x1 - s.x0) / 2 + PLUME_SPREAD * Math.max(0, above)
					const mid = (s.x0 + s.x1) / 2
					const off = Math.abs(p.x - mid)
					if (off > half * 1.5) continue
					vy += plumeSpeed(s.F, above + 0.05) * Math.exp(-(off * off) / (half * half))
				}
				for (const hgun of heaters) {
					const above = p.y - hgun.y
					if (above < -0.01) continue
					const half = hgun.half + PLUME_SPREAD * Math.max(0, above)
					const off = Math.abs(p.x - hgun.x)
					if (off > half * 1.5) continue
					vy += hgun.w * Math.exp(-(off * off) / (half * half))
				}
				// mixing: a random walk with eddy diffusivity K = 0.0005 + 0.01·|wind| m²/s (a laminar column in still air, turbulent in a wind: provisional)
				const K = 0.0005 + 0.01 * Math.hypot(air.x, air.y)
				const kick = Math.sqrt(2 * K * dt)
				px[i] = p.x + vx * dt + kick * gauss()
				py[i] = p.y + vy * dt + kick * gauss()
				list.push(r3(px[i] as number), r3(py[i] as number), r2(age))
				if (age > 0.5) {
					sx += (px[i] as number) - tip.x
					sy += (py[i] as number) - tip.y
					ns++
				}
			}
			ctx.series(item, "smoke", list)
			ctx.set(item, "drift_m", ns ? sx / ns : 0)
			ctx.set(item, "rise_m", ns ? sy / ns : 0)
			ctx.set(item, "puffs", list.length / 3)
		},
		end(ctx) {
			// (what its smoke showed, for the run's story: which way the air carried it)
			const name = str(r.name, item)
			if (!ctx.settings.air) return void ctx.event(`${name} makes no smoke (no air to burn in)`, [item], "smoke", ctx.time() - ctx.step)
			const dx = ctx.get(item, "drift_m") ?? 0
			const dy = ctx.get(item, "rise_m") ?? 0
			const side = Math.abs(dx) >= 0.05 ? `drifts ${dx > 0 ? "right" : "left"} ${Math.abs(dx).toFixed(2)} m` : ""
			const vert = Math.abs(dy) >= 0.03 ? `${dy > 0 ? "rises" : "sinks"} ${Math.abs(dy).toFixed(2)} m` : ""
			const what = [side, vert].filter((w) => w).join(" and ") || "hangs round its tip"
			ctx.event(`smoke from ${name} ${what}`, [item], "smoke", ctx.time() - ctx.step)
		}
	}
}

// ---- anemometer
function anemometerProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const at = pt(r.at)
	const arm = Math.max(0.01, num(r.arm, 0.06))
	let turns = 0
	return {
		step(ctx) {
			const a = ctx.air(at)
			const v = Math.hypot(a.x, a.y)
			// the cups turn at about a third of the wind's speed (Robinson's cup factor 2-3): turns = ∫ v/(3·arm) dt / 2π
			turns += (v / (3 * arm) / (2 * Math.PI)) * ctx.step
			ctx.set(item, "wind_ms", v)
			ctx.set(item, "turns", turns)
		},
		end(ctx) {
			const v = ctx.get(item, "wind_ms") ?? 0
			const name = str(r.name, item)
			ctx.event(v >= 0.05 ? `${name} reads ${v.toFixed(1)} m/s` : `${name} reads no wind (no stream reaches its cups)`, [item], "reads", ctx.time() - ctx.step)
		}
	}
}

// ---- vacuum jar
function jarProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const name = str(r.name, item)
	const pumpAt = num(r.pump_at, 0.5)
	const tau = Math.max(0.05, num(r.tau, 2))
	const low = Math.max(0, num(r.low, 2000))
	const vent = num(r.vent, -1)
	// (another module's jar, the waves module's bell jar: its own straight-line pump-down, from `from` % of the room's air at t0 to `to` % at t1)
	const line = (r.linear ?? null) as Record<string, unknown> | null
	const box = { x0: num(r.x0, 0), x1: num(r.x1, 0), y0: num(r.y0, 0), y1: num(r.y1, 0) }
	let atVent = ATM
	let lowest = ATM
	/** the solids inside it whose air share it set (the engine's buoyancy and drag on them follow its pressure) */
	const inside = new Set<string>()
	const share = (ctx: ProcessContext, k: number) => {
		for (const h of ctx.all()) {
			if (!h.dynamic || h.setAirShare === undefined) continue
			const c = h.pose()
			if (c.x >= box.x0 && c.x <= box.x1 && c.y >= box.y0 && c.y <= box.y1) {
				h.setAirShare(k)
				inside.add(h.id)
			} else if (inside.has(h.id)) {
				h.setAirShare(1)
				inside.delete(h.id)
			}
		}
	}
	return {
		step(ctx) {
			const t = ctx.time()
			let p = ATM
			if (!ctx.settings.air) p = 0
			else if (line !== null) {
				const from = num(line.from, 100)
				const to = num(line.to, from)
				const t0 = num(line.t0, 0)
				const t1 = num(line.t1, t0)
				const u = t1 > t0 ? clamp01((t - t0) / (t1 - t0)) : t >= t0 ? 1 : 0
				p = (ATM * Math.max(0, from + (to - from) * u)) / 100
			} else if (vent >= 0 && t >= vent) {
				const pv = t - vent < ctx.step ? (atVent = pumpedTo(vent)) : atVent
				p = ATM - (ATM - pv) * Math.exp(-(t - vent) / 0.4)
			} else p = pumpedTo(t)
			lowest = Math.min(lowest, p)
			ctx.set(item, "pressure_kpa", p / 1000)
			// what is inside feels the jar's thinner air: its buoyancy and drag (a feather falls like a coin in a hard vacuum)
			if (ctx.settings.air && (p !== ATM || inside.size > 0)) share(ctx, p / ATM)
		},
		end(ctx) {
			if (ctx.settings.air && lowest < 0.95 * ATM) ctx.event(`${name} was pumped down to ${(lowest / 1000).toFixed(1)} kPa (the room's air is 101.3)`, [item], "pumped", ctx.time() - ctx.step)
		}
	}
	function pumpedTo(t: number) {
		return t < pumpAt ? ATM : low + (ATM - low) * Math.exp(-(t - pumpAt) / tau)
	}
}

// ---- welds that let go: a card under a glass of water, a suction cup
interface Hold {
	joint: Joint | null
	/** The pull, smoothed (see pullOf). */
	pull: number | null
}
const makeWeld = (ctx: ProcessContext, a: string, b: string, at: Point): Joint | null => {
	const eng = ctx.engine() as EngineInternals | undefined
	if (eng === undefined) return null
	const ba = eng.bodyOf(a) as Body | undefined
	const bb = eng.bodyOf(b) as Body | undefined
	if (ba === undefined || bb === undefined) return null
	const world = eng.world as World
	return world.createJoint(new WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, ba, bb, new Vec2(at.x * LS, at.y * LS))) as Joint | null
}
/** How quickly a hold feels a pull, s: a suction cup's or a wet card's seal gives way over some hundredths of a second, not in one step (and the
 *  solver's start-up jolt, when a hanging load first meets its weld through a 5 g cup, is not a pull it feels). Provisional. */
const HOLD_TAU = 0.1
/** The weld's pull on its moving end along `axis` (N, toward the fixed part: what holds it up), smoothed over HOLD_TAU. */
const pullOf = (hold: Hold, axis: Point, h: number) => {
	if (hold.joint === null) return 0
	const f = hold.joint.getReactionForce(1 / h)
	const v = (f.x * axis.x + f.y * axis.y) / LS
	hold.pull = hold.pull === null ? v : hold.pull + (v - hold.pull) * Math.min(1, h / HOLD_TAU)
	return hold.pull
}
const release = (ctx: ProcessContext, hold: Hold) => {
	const eng = ctx.engine()
	if (hold.joint !== null && eng !== undefined) (eng.world as World).destroyJoint(hold.joint)
	hold.joint = null
}

function cardProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const name = str(r.name, item)
	const card = r.solid as string
	const glass = r.glass as string
	const A = num(r.area, 0.0035)
	const h = num(r.water_h, 0.08)
	const Vair = num(r.air_v, 1e-4)
	const seal = num(r.seal, 0.002)
	const water = num(r.water, 0.8)
	const axis = pt(r.axis, { x: 0, y: 1 })
	const at = pt(r.at)
	const down = r.mouth_down !== false
	const jars = jarsOf(r)
	const hold: Hold = { joint: null, pull: null }
	let holding = down
	let fell = -1
	return {
		start(ctx) {
			if (down) hold.joint = makeWeld(ctx, glass, card, at)
			holding = down && hold.joint !== null
			ctx.set(item, "holding", holding ? 1 : 0)
			ctx.set(item, "water", water > 0 ? 1 : 0)
		},
		after(ctx, step) {
			if (!holding) return
			const pull = Math.max(0, pullOf(hold, axis, step))
			const pout = pressureAt(ctx, jars, at)
			const g = ctx.settings.gravity
			// the water column's weight (its height along the glass's axis as it is tilted) and the card's, per area of the mouth
			const tilt = axis.y // cos of the glass's tilt from upside down
			const need = WATER * g * h * Math.max(0, tilt) + pull / A
			let why: string | null = null
			if (!(water > 0.001)) why = "there is no water to seal it: air gets in round the card"
			else if (pout <= need) why = pout <= 0 ? "there is no air to push it up" : "the air's push is less than the water's weight"
			else if ((Vair / A) * (need / (pout - need)) > seal) why = "the trapped air stretched so far the water's seal broke"
			if (why !== null) {
				holding = false
				fell = ctx.time()
				release(ctx, hold)
				ctx.event(`${name}'s card fell (${why})`, [item], "let go")
			}
			ctx.set(item, "holding", holding ? 1 : 0)
			ctx.set(item, "outside_kpa", pout / 1000)
			ctx.set(item, "inside_kpa", holding ? Math.max(0, pout - need) / 1000 : pout / 1000)
			ctx.set(item, "push_n", pout * A)
		},
		step(ctx) {
			if (!down) {
				ctx.set(item, "holding", 0)
				return
			}
			if (fell >= 0) ctx.set(item, "water", Math.max(0, 1 - (ctx.time() - fell) / 0.4))
			else if (!ctx.released()) {
				const pout = pressureAt(ctx, jars, at)
				ctx.set(item, "outside_kpa", pout / 1000)
				ctx.set(item, "push_n", pout * A)
			}
		},
		end(ctx) {
			if (holding) ctx.event(`${name}'s card stays up (the air pushes up on it with ${(ctx.get(item, "push_n") ?? 0).toFixed(0)} N)`, [item], "holds", ctx.time() - ctx.step)
		}
	}
}

function cupProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const name = str(r.name, item)
	const cup = r.solid as string
	const plate = r.plate as string
	const A = num(r.area, 0.002)
	const dp = num(r.dp, 50000)
	const axis = pt(r.axis, { x: 0, y: 1 })
	const at = pt(r.at)
	const jars = jarsOf(r)
	const hold: Hold = { joint: null, pull: null }
	let holding = false
	return {
		start(ctx) {
			hold.joint = dp > 0 ? makeWeld(ctx, plate, cup, at) : null
			holding = hold.joint !== null
			ctx.set(item, "holding", holding ? 1 : 0)
			ctx.set(item, "hold_n", dp * A)
			ctx.set(item, "pull_n", 0)
			if (!holding) ctx.event(`${name} did not stick (${dp > 0 ? "no surface to hold" : "the surface is too rough to seal"})`, [item], "let go")
		},
		after(ctx, step) {
			if (!holding) return
			const pull = pullOf(hold, axis, step)
			const pout = pressureAt(ctx, jars, at)
			const most = dp * (pout / ATM) * A
			ctx.set(item, "pull_n", Math.max(0, pull))
			ctx.set(item, "hold_n", most)
			if (pull > most) {
				holding = false
				release(ctx, hold)
				ctx.event(`${name} let go (the load pulled ${pull.toFixed(1)} N; the air could hold ${most.toFixed(1)} N)`, [item], "let go")
			}
			ctx.set(item, "holding", holding ? 1 : 0)
		},
		step(ctx) {
			if (!ctx.released()) {
				const pout = pressureAt(ctx, jars, at)
				ctx.set(item, "hold_n", dp * (pout / ATM) * A)
			}
			if (!holding) ctx.set(item, "pull_n", 0)
		},
		end(ctx) {
			if (holding) ctx.event(`${name} holds (the load pulls ${(ctx.get(item, "pull_n") ?? 0).toFixed(1)} N; the air could hold ${(ctx.get(item, "hold_n") ?? 0).toFixed(1)} N)`, [item], "holds", ctx.time() - ctx.step)
		}
	}
}

// ---- the steam can
function canProcess(r: ProcessRecord): Process {
	const item = r.item as string
	const name = str(r.name, item)
	const solid = r.solid as string
	const dip = num(r.dip, 1)
	const boiled = r.boiled === true
	// the air left after boiling: the steam sweeps it out, e^(−t/8 s), never under 3 % (it mixes as it goes: provisional)
	const xair = boiled ? Math.max(0.03, Math.exp(-num(r.boil_s, 0) / 8)) : 1
	const bath = num(r.bath, 2) + KELVIN
	const lift = pt(r.lift) // the can's middle once lifted off the stove
	const over = pt(r.over) // above the bowl
	const dunk = pt(r.dunk) // in the water, mouth down
	const pcr = bucklingPressure(num(r.E_gpa, 69) * 1e9, num(r.nu, 0.33), num(r.wall, 0.000097), num(r.diameter, 0.066), num(r.length, 0.115))
	const H = num(r.height, 0.122)
	const water = num(r.water_y, 0)
	const dish = (r.dish ?? {}) as Record<string, unknown>
	const dx0 = num(dish.x0, -Infinity)
	const dx1 = num(dish.x1, Infinity)
	let T = 0
	let start: { x: number; y: number; angle: number } | null = null
	let crushed = 0
	let said = false
	const HOT = 100 + KELVIN
	const MOVE = 1.3
	return {
		start(ctx) {
			T = boiled ? HOT : roomK(ctx)
			start = ctx.solid(solid)?.pose() ?? null
		},
		step(ctx) {
			const t = ctx.time()
			const Troom = roomK(ctx)
			const room = ctx.settings.air ? ATM : 0
			const b = bodyOf(ctx, solid)
			let under = false
			if (start !== null && b !== undefined && t >= dip) {
				// the tongs: lift it off the stove, carry it over the bowl turning it mouth-down, and push it into the water
				const u = (t - dip) / MOVE
				let x: number
				let y: number
				let a: number
				if (u < 0.25) {
					const s = smooth(u / 0.25)
					x = start.x + (lift.x - start.x) * s
					y = start.y + (lift.y - start.y) * s
					a = start.angle
				} else if (u < 0.65) {
					const s = smooth((u - 0.25) / 0.4)
					x = lift.x + (over.x - lift.x) * s
					y = lift.y + (over.y - lift.y) * s
					a = start.angle + Math.PI * s
				} else {
					const s = smooth((u - 0.65) / 0.35)
					x = over.x + (dunk.x - over.x) * s
					y = over.y + (dunk.y - over.y) * s
					a = start.angle + Math.PI
				}
				b.setTransform(new Vec2(x * LS, y * LS), a)
				b.setLinearVelocity(new Vec2(0, 0))
				b.setAngularVelocity(0)
				// (mouth-down over the dish, its mouth under the water's surface)
				under = u >= 0.65 && x >= dx0 && x <= dx1 && y - H / 2 < water
			}
			// its inside: on the stove the water boils (100 °C, steam); in the air it barely cools; mouth-down in the water the steam
			// condenses in a few tenths of a second (water rushes in): T relaxes to the water's with τ = 0.15 s (provisional, from videos)
			if (t < dip) T = boiled ? HOT : Troom
			else T += ((under ? bath : Troom) - T) * (1 - Math.exp(-ctx.step / (under ? 0.15 : 30)))
			const pAir = boiled ? xair * room * (T / HOT) : room * (T / Troom)
			const pSteam = boiled ? Math.min((1 - xair) * room, steamPressure(T - KELVIN)) : 0
			const pin = pAir + pSteam
			if (room - pin > pcr) {
				// it buckles and folds in until what is left of its gas, squeezed, nearly holds the room's push (the folds give way at half
				// the first buckling pressure): the volume it keeps, at least 30 % of a can
				const keep = Math.max(0.3, Math.min(1, pAir / Math.max(1, room - pSteam - pcr / 2)))
				crushed = Math.max(crushed, 1 - keep)
			}
			if (crushed > 0.05 && !said) {
				said = true
				ctx.event(`${name} was crushed by the air's push (inside ${(pin / 1000).toFixed(1)} kPa against the room's ${(room / 1000).toFixed(1)})`, [item], "crushed")
			}
			ctx.set(item, "inside_kpa", pin / 1000)
			ctx.set(item, "temp_c", T - KELVIN)
			ctx.set(item, "crushed", crushed)
			ctx.set(item, "steaming", boiled && t < dip + 0.3 ? 1 : 0)
			ctx.set(item, "tongs", t >= dip ? 1 : 0)
		},
		end(ctx) {
			if (!said) ctx.event(`${name} is not crushed (inside ${((ctx.get(item, "inside_kpa") ?? 0)).toFixed(1)} kPa against the room's ${(ctx.settings.air ? ATM / 1000 : 0).toFixed(1)})`, [item], "not crushed", ctx.time() - ctx.step)
		}
	}
}

/** The process of an air record (modules/air.ts registers the kind "air"). */
export const airProcess = (r: ProcessRecord, ctx: ProcessContext): Process => {
	switch (str(r.role, "")) {
		case "balloon":
			return balloonProcess(r, ctx)
		case "hotair":
			return hotAirProcess(r)
		case "glider":
			return gliderProcess(r)
		case "kite":
			return kiteProcess(r)
		case "smoke":
			return smokeProcess(r)
		case "anemometer":
			return anemometerProcess(r)
		case "jar":
			return jarProcess(r)
		case "card":
			return cardProcess(r)
		case "cup":
			return cupProcess(r)
		case "can":
			return canProcess(r)
		default:
			return {}
	}
}
