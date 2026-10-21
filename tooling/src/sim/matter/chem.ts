/**
 * Chemical changes for the matter module (tooling/src/sim/modules/matter.ts runs them by role; machines/mod_matter.py builds the records):
 *   pack       an instant cold (or hot) pack: a salt dissolving in its water bag takes heat in (or gives it out), to its solubility
 *   warmer     a hand warmer: iron powder rusting as fast as its air holes let oxygen in, giving out 412 kJ per mol of iron
 *   rust       steel wool rusting over days: the oxygen it takes from the air is the mass a scale gains
 *   indicator  red cabbage juice: its pH from the charge balance of what is added (vinegar, lemon juice, baking soda, washing soda), the
 *              carbon dioxide that bubbles out, and the colour that pH gives
 *   precip     calcium chloride poured into baking soda solution: it warms as it dissolves, a white solid (calcium carbonate) forms and
 *              settles, carbon dioxide bubbles out
 *   atoms      a molecule's or crystal's model: its fixed readings (atoms, bonds, mass)
 * Temperature: when the heat module is loaded the item's body (a pouch, a pad) or its beaker's water is a node of heat.ts's world (the
 * builder adds the heat record): the chemistry's heat goes into that node (heat.ts `heat`, booked in its ledger as `chem`), so a thermometer
 * touching it or standing in it reads it and it gives its heat to the room as everything there does; at the start the body's heat capacity
 * is set to what the item really holds (water and a salt in a pouch: no material of heat's table) and the world's start energy follows, so
 * its books still close. Without the heat module: a lumped model of its own, h = 10 W/(m²·K) to the room's air (natural convection about 5
 * and radiation about 6 near room temperature: Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed., §9 and §1.2).
 * Values (and their sources: [CRC-H], [CRC], [NIST-WB], [IUPAC13]) are in machines/mod_matter.py "chemical changes"; the enthalpies here are
 * the CRC's standard enthalpies of formation (25 °C), relative to liquid water where water takes part. Deterministic: + − × ÷, sqrt, exp, pow.
 */
import { heatWorldOf } from "#sim/heat.ts"
import type { ProcessContext, ProcessRecord, SolidHandle } from "#sim/plugins.ts"
import { table } from "#sim/matter/substances.ts"

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d)

const C_WATER = 4184
/** Heat a body gives the room's air per m² and K without the heat module (see the header). */
const H_ROOM = 10
/** J per mol of iron rusting (4Fe + 3O2 → 2Fe2O3: 2 × −824.2 kJ [CRC-H]); kg of oxygen taken per mol of iron (0.75 × 31.998 g). */
export const FE_HEAT = 412100
export const O2_PER_FE = 0.75 * 0.031998
/** The most a hand warmer's breathable film lets oxygen in for, W of its rusting (real warmers peak at about 60-70 °C: a modelling bound). */
export const WARMER_MAX_W = 20
/** m³ of a mol of gas at 20 °C and 1 atm (RT/P). */
const MOLAR_VOLUME = (8.314462618 * 293.15) / 101325

// ---------------------------------------------------------------- the heat these items make, and where it goes
interface HeatNodeLike {
	C: number
	T: number
}
interface HeatWorldLike {
	node(id: string): HeatNodeLike | undefined
	heat(n: HeatNodeLike, q: number): void
	ledger: { chem: number }
	start0: number
}

/** The heat world of this run when the heat module made one and it holds these nodes (else undefined: the item's own model). */
const worldOf = (ctx: ProcessContext): HeatWorldLike | undefined => {
	const w = heatWorldOf(ctx.scene) as unknown as Partial<HeatWorldLike> | undefined
	if (w === undefined || typeof w.node !== "function" || typeof w.heat !== "function" || typeof w.ledger !== "object" || typeof w.start0 !== "number") return undefined
	return w as HeatWorldLike
}

/**
 * An item's temperature: a node of the heat world (`at`: the node it is read from and heated through: its body, or its beaker's water;
 * `body`: the body whose heat capacity is set to `capacity`), or its own lumped model (capacity `own` J/K, area m², starting at `start`).
 */
class Warmth {
	private world: HeatWorldLike | undefined
	private node: HeatNodeLike | undefined
	T = 20
	private room = 20
	// (plain fields, not parameter properties: Node's strip-only TypeScript, which the CI syntax check runs, has no parameter properties)
	private readonly at: string | undefined
	private readonly body: string | undefined
	private readonly capacity: number
	private readonly own: number
	private readonly area: number
	private readonly start0: number | undefined
	constructor(at: string | undefined, body: string | undefined, capacity: number, own: number, area: number, start0: number | undefined) {
		this.at = at
		this.body = body
		this.capacity = capacity
		this.own = own
		this.area = area
		this.start0 = start0
	}
	start(ctx: ProcessContext) {
		this.room = ctx.settings.roomTemperature
		this.T = this.start0 ?? this.room
		const w = this.at === undefined ? undefined : worldOf(ctx)
		const n = w?.node(this.at as string)
		if (w === undefined || n === undefined || !Number.isFinite(n.T)) return
		this.world = w
		this.node = n
		const b = this.body === undefined ? undefined : w.node(this.body)
		if (b !== undefined && this.capacity > 0 && Number.isFinite(b.C)) {
			w.start0 += (this.capacity - b.C) * b.T
			b.C = this.capacity
		}
	}
	/** Whether its heat node still holds something to heat (a beaker's water can all evaporate over days of time-lapse). */
	private usable() {
		const n = this.node as (HeatNodeLike & { melt?: { solid: number; liquid: number } }) | undefined
		if (n === undefined || !Number.isFinite(n.T)) return false
		return n.melt === undefined ? n.C > 0 : n.melt.solid + n.melt.liquid > 1e-7 || n.C > 0
	}
	get temp() {
		if (this.node !== undefined && this.usable()) this.T = this.node.T
		return this.T
	}
	/**
	 * P W given out steadily over the next dt s of lesson time (a slow source: a hand warmer, rusting). In the heat world it is the power of
	 * the item's own heater record (the builder adds one at 0 W, never cutting out: heat.ts spreads a heater's power over its sub-steps, so a
	 * long time-lapse beat does not make one jump); it takes effect from the world's next beat. Without that heater, the beat's heat at once;
	 * in its own model, exactly as a steady source against the room.
	 */
	stream(P: number, dt: number) {
		if (this.node !== undefined && this.world !== undefined) {
			const heaters = (this.world as unknown as { heaters?: { node?: unknown; power: number }[] }).heaters
			const mine = Array.isArray(heaters) ? heaters.find((h) => h.node === this.node) : undefined
			if (mine !== undefined) {
				mine.power = this.usable() ? Math.max(0, P) : 0
				return
			}
			this.put(P * dt, dt)
			return
		}
		const C = Math.max(1e-6, this.own)
		const G = H_ROOM * this.area
		const k = dt > 0 ? Math.exp((-G * dt) / C) : 1
		this.T = this.room + (this.T - this.room) * k + (G > 0 ? (P / G) * (1 - k) : (P * dt) / C)
	}
	/** q J into it over dt s of lesson time (negative: taken out); its own model also loses heat to the room meanwhile. */
	put(q: number, dt: number) {
		if (this.node !== undefined && this.world !== undefined) {
			if (q !== 0 && this.usable()) {
				this.world.heat(this.node, q)
				this.world.ledger.chem += q
			}
			return
		}
		const C = Math.max(1e-6, this.own)
		const k = dt > 0 ? Math.exp((-H_ROOM * this.area * dt) / C) : 1
		this.T = this.room + (this.T - this.room) * k + q / C
	}
}

/** A ballast resized to carry `mass` kg of the `full` it was built with (once the bodies move: after the release). */
const carry = (h: SolidHandle | undefined, mass: number, full: number, ctx: ProcessContext) => {
	if (h === undefined || !(full > 0) || !ctx.released()) return
	const k = mass <= 0 ? 0 : Math.pow(Math.min(1, mass / full), 1 / 3)
	if (Math.abs(k - h.scale()) > 1e-9) h.resize(k < 0.01 ? 0.01 : k)
}

const idOf = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined)

/** Says once when an item's temperature has turned back after its coldest (or hottest): when it is 0.3 °C past its extreme. */
const extremeWatch = (item: string, cold: boolean) => {
	let best: number | undefined
	let when = 0
	let said = false
	return (ctx: ProcessContext, T: number, active: boolean) => {
		if (said || !active) return
		if (best === undefined || (cold ? T < best : T > best)) {
			best = T
			when = ctx.time()
		} else if (Math.abs(T - best) > 0.3) {
			said = true
			ctx.event(`${item} is ${cold ? "coldest" : "hottest"} at ${best.toFixed(1)} °C`, [item], cold ? "coldest" : "hottest", when)
		}
	}
}

// ---------------------------------------------------------------- instant cold and hot packs
/** Solubility, g per 100 g of water, by temperature (°C) [CRC]; each table's first row is its ice-salt eutectic (approximate): below it the
 *  solution would freeze rather than cool, which is not modelled (it dissolves no more there). */
const PACK_SOLUBILITY: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
	"ammonium nitrate": [[-16.9, 73.6], [0, 118.3], [10, 150], [20, 190], [30, 238], [40, 292], [50, 344], [60, 421]],
	urea: [[-11.5, 48.1], [0, 66.7], [20, 108], [40, 167], [60, 251]],
	"ammonium chloride": [[-15.4, 24.5], [0, 29.4], [10, 33.2], [20, 37.2], [30, 41.4], [40, 45.8], [50, 50.4], [60, 55.3]],
	"calcium chloride": [[-49.8, 42.5], [0, 59.5], [10, 64.7], [20, 74.5], [30, 100], [40, 128], [60, 137]]
}

export const packProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const key = str(r.chemical, "ammonium nitrate")
	const rows = PACK_SOLUBILITY[key] ?? (PACK_SOLUBILITY["ammonium nitrate"] as readonly (readonly [number, number])[])
	const M = Math.max(1e-6, num(r.molar, 0.080043))
	const dh = num(r.dh, 25690)
	const salt = Math.max(0, num(r.salt, 0.03))
	const water = Math.max(1e-6, num(r.water, 0.1))
	const at = num(r.at, 1.2)
	const tau = Math.max(0.01, num(r.tau, 30))
	const C = Math.max(1e-6, num(r.capacity, 450))
	const warm = new Warmth(idOf(r.solid), idOf(r.solid), C, C, num(r.area, 0.04), undefined)
	const watch = extremeWatch(item, dh > 0)
	let dissolved = 0
	let heat = 0
	let burst = false
	const publish = (ctx: ProcessContext) => {
		ctx.set(item, "temp_c", warm.temp)
		ctx.set(item, "dissolved_g", dissolved * 1000)
		ctx.set(item, "dissolved_pct", salt > 0 ? (100 * dissolved) / salt : 0)
		ctx.set(item, "heat_kj", heat / 1000)
		ctx.set(item, "burst", burst ? 1 : 0)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			warm.start(ctx)
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			let q = 0
			if (ctx.time() >= at) {
				if (!burst) {
					burst = true
					ctx.event(`${item} is squeezed: its water bag bursts and the ${key} dissolves`, [item], "bursts")
				}
				// (it dissolves toward all of it, or what the water holds at its temperature now, first order in lesson time)
				const holds = (table(rows, warm.temp) / 100) * water
				const target = Math.min(salt, holds)
				const dm = (target - dissolved) * (1 - Math.exp(-dt / tau))
				dissolved = Math.min(salt, Math.max(0, dissolved + dm))
				q = (-dm / M) * dh
				heat += q
			}
			warm.put(q, dt)
			watch(ctx, warm.temp, burst && dissolved > 0.5 * salt)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- a hand warmer
export const warmerProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const iron = Math.max(0, num(r.iron, 0.02))
	const n = iron / 0.055845
	const full = Math.max(0, num(r.full, n * O2_PER_FE))
	const at = num(r.at, 1.2)
	const lasts = Math.max(1, num(r.lasts, 18000))
	const C = Math.max(1e-6, num(r.capacity, 50))
	const warm = new Warmth(idOf(r.solid), idOf(r.solid), C, C, num(r.area, 0.026), undefined)
	const watch = extremeWatch(item, false)
	let left = n
	let heat = 0
	let power = 0
	let opened = false
	let spent = false
	const publish = (ctx: ProcessContext) => {
		const used = n - left
		ctx.set(item, "temp_c", warm.temp)
		ctx.set(item, "iron_left_pct", n > 0 ? (100 * left) / n : 0)
		ctx.set(item, "oxygen_g", used * O2_PER_FE * 1000)
		ctx.set(item, "power_w", power)
		ctx.set(item, "heat_kj", heat / 1000)
		carry(ctx.solid(r.ballast as string), used * O2_PER_FE, full, ctx)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			warm.start(ctx)
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			let q = 0
			power = 0
			if (ctx.time() >= at && left > 0) {
				if (!opened) {
					opened = true
					ctx.event(`${item} is opened: air gets in and its iron starts to rust, giving out heat`, [item], "opened")
				}
				// (oxygen comes in through its air holes at a steady rate; the last 15 % of the iron, harder to reach, fades out)
				const rate = Math.min(n / lasts, WARMER_MAX_W / FE_HEAT) * Math.min(1, left / (0.15 * n))
				const dx = Math.min(left, rate * dt)
				left -= dx
				q = dx * FE_HEAT
				heat += q
				power = dt > 0 ? q / dt : 0
				if (!spent && left <= 0.01 * n) {
					spent = true
					ctx.event(`${item} is used up: its iron has all rusted`, [item], "used up")
				}
			}
			warm.stream(power, dt)
			watch(ctx, warm.temp, opened)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- steel wool rusting
export const rustProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const n = Math.max(0, num(r.iron, 0.005)) / 0.055845
	const share = Math.min(1, Math.max(0, num(r.share, 0.5)))
	const full = Math.max(0, num(r.full, share * n * O2_PER_FE))
	const tau = Math.max(1, num(r.rustTau, 43200))
	const at = num(r.at, 1.2)
	const C = Math.max(1e-6, num(r.capacity, 12))
	const warm = new Warmth(idOf(r.solid), idOf(r.solid), C, C, num(r.area, 0.012), undefined)
	let rusted = 0
	let power = 0
	let shown = false
	const publish = (ctx: ProcessContext) => {
		ctx.set(item, "rust_pct", n > 0 ? (100 * rusted) / n : 0)
		ctx.set(item, "gained_g", rusted * O2_PER_FE * 1000)
		ctx.set(item, "oxygen_ml", rusted * 0.75 * MOLAR_VOLUME * 1e6)
		ctx.set(item, "temp_c", warm.temp)
		carry(ctx.solid(r.ballast as string), rusted * O2_PER_FE, full, ctx)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			warm.start(ctx)
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			let q = 0
			power = 0
			const t = ctx.time()
			if (t >= at) {
				// (what can rust rusts as 1 − e^(−t/τ) in lesson time since it was set out: fast at first, slowed by its own coat of rust)
				const now = share * n * (1 - Math.exp(-((t - at) * ctx.settings.timeLapse) / tau))
				const dx = Math.max(0, now - rusted)
				rusted += dx
				q = dx * FE_HEAT
				power = dt > 0 ? q / dt : 0
				if (!shown && n > 0 && rusted >= 0.05 * n) {
					shown = true
					ctx.event(`${item} shows rust: orange-brown iron oxide, a new substance made with the air's oxygen`, [item], "rusts")
				}
			}
			warm.stream(power, dt)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- acids, bases and red cabbage
/** Acid constants at 25 °C [CRC]: acetic; carbonic (CO2(aq) + H2O, first and second); citric (three); water. */
const KA_ACETIC = 1.75e-5
const K1_CARBONIC = 4.45e-7
const K2_CARBONIC = 4.69e-11
const K1_CITRIC = 7.44e-4
const K2_CITRIC = 1.73e-5
const K3_CITRIC = 4.02e-7
const KW = 1.0e-14
/** CO2 water holds at 1 atm of it, 20 °C: 1.69 g/L (mol/L) [CRC]; more bubbles out. In the open it then goes on leaving, slowly, toward what
 *  the air's 420 ppm hold (1.4e-5 mol/L), with a time of about an hour (a modelling choice). */
const CO2_SAT = 1.69 / 44.01
const CO2_AIR = 1.4e-5
const CO2_SLOW = 3600
/** Enthalpies, J/mol [CRC-H] (relative to liquid water where it takes part: H2CO3* = CO2(aq) + H2O, OH− = OH− − H2O, CO2 gone = CO2(g) + H2O). */
const H_NA = -240120
const H_HCO3 = -691990
const H_CO3 = -677140
const H_H2CO3 = -413800 - 285830
const H_OH = -229990 + 285830
const H_HA = -485760
const H_A = -486010
const H_CO2_GONE = -393510 - 285830
const H_NAHCO3_S = -950810
const H_NA2CO3_S = -1130680
const H_CACL2_S = -795400
const H_CA = -542830
const H_CL = -167160
const H_CACO3_S = -1207600
/** Red cabbage's colour bands by pH (approximate, as widely published): red, pink, purple, blue, blue-green, green, yellow. */
export const BAND_EDGES = [3, 5, 7.5, 9, 10.5, 12.5]
export const BAND_NAMES = ["red", "pink", "purple", "blue", "blue-green", "green", "yellow"]
export const bandOf = (ph: number) => {
	let k = 0
	while (k < BAND_EDGES.length && ph >= (BAND_EDGES[k] as number)) k++
	return k
}

/** Solubility, g per 100 g of water, by temperature (°C) [CRC]: baking soda (NaHCO3) and washing soda (Na2CO3, anhydrous). Past it a powder
 *  stays on the bottom, and dissolves as an acid uses up what is dissolved. */
const SODA_SOLUBILITY: readonly (readonly [number, number])[] = [[0, 6.9], [10, 8.15], [20, 9.6], [30, 11.1], [40, 12.7], [50, 14.45], [60, 16.4]]
const WASHING_SOLUBILITY: readonly (readonly [number, number])[] = [[0, 7.0], [10, 12.5], [20, 21.5], [30, 39.7], [40, 49.0], [60, 46.0]]

/** Totals in a solution (mol, and its volume L): sodium, acetic acid, citric acid, carbonate (CO2(aq), HCO3−, CO3^2−). */
interface Totals {
	na: number
	ac: number
	cit: number
	ct: number
	V: number
}
/** Its pH, by the charge balance (an ideal solution: no activities), by bisection between −1 and 16 (60 halvings). */
export const phOf = (s: Totals) => {
	const V = Math.max(1e-6, s.V)
	const na = s.na / V
	const ac = s.ac / V
	const cit = s.cit / V
	const ct = s.ct / V
	const f = (p: number) => {
		const h = 10 ** -p
		const c1 = K1_CARBONIC
		const c2 = K1_CARBONIC * K2_CARBONIC
		const t1 = K1_CITRIC
		const t2 = K1_CITRIC * K2_CITRIC
		const t3 = t2 * K3_CITRIC
		return (
			h +
			na -
			KW / h -
			(ac * KA_ACETIC) / (KA_ACETIC + h) -
			(ct * (c1 * h + 2 * c2)) / (h * h + c1 * h + c2) -
			(cit * (t1 * h * h + 2 * t2 * h + 3 * t3)) / (h * h * h + t1 * h * h + t2 * h + t3)
		)
	}
	let lo = -1
	let hi = 16
	for (let k = 0; k < 60; k++) {
		const mid = (lo + hi) / 2
		if (f(mid) > 0) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}
/** The solution's species at pH p (mol): acetic acid and acetate, CO2(aq), bicarbonate, carbonate, hydroxide. */
const speciesAt = (s: Totals, p: number) => {
	const h = 10 ** -p
	const c1 = K1_CARBONIC
	const c2 = K1_CARBONIC * K2_CARBONIC
	const d = h * h + c1 * h + c2
	return {
		ha: (s.ac * h) / (KA_ACETIC + h),
		a: (s.ac * KA_ACETIC) / (KA_ACETIC + h),
		h2co3: (s.ct * h * h) / d,
		hco3: (s.ct * c1 * h) / d,
		co3: (s.ct * c2) / d,
		oh: (KW / h) * Math.max(1e-6, s.V)
	}
}
/** The solution's enthalpy (J, relative to its water), at pH p. */
const enthalpyAt = (s: Totals, p: number) => {
	const x = speciesAt(s, p)
	return s.na * H_NA + x.ha * H_HA + x.a * H_A + x.h2co3 * H_H2CO3 + x.hco3 * H_HCO3 + x.co3 * H_CO3 + x.oh * H_OH
}

interface Step {
	what: string
	at: number
	acetic: number
	citric: number
	hco3: number
	co3: number
	na: number
	ml: number
	kg: number
}

export const indicatorProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const water = Math.max(1e-6, num(r.water, 0.1))
	const steps: Step[] = (Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : []).map((s) => ({
		what: str(s.what, "none"),
		at: num(s.at, 1),
		acetic: Math.max(0, num(s.acetic, 0)),
		citric: Math.max(0, num(s.citric, 0)),
		hco3: Math.max(0, num(s.hco3, 0)),
		co3: Math.max(0, num(s.co3, 0)),
		na: Math.max(0, num(s.na, 0)),
		ml: Math.max(0, num(s.ml, 0)),
		kg: Math.max(0, num(s.kg, 0))
	}))
	const extra = Math.max(0, num(r.extra, 0))
	const fizzTau = Math.max(0.01, num(r.fizz, 3))
	const glass = Math.max(0, num(r.capacity, 75))
	const warm = new Warmth(idOf(r.heat), idOf(r.heat) === undefined ? undefined : idOf(r.solid), glass, water * C_WATER + glass, num(r.area, 0.02), num(r.start, 20))
	const sol: Totals = { na: 0, ac: 0, cit: 0, ct: 0, V: water / 998.2 * 1000 }
	let done = 0
	let ph = phOf(sol)
	let H = enthalpyAt(sol, ph)
	let escaped = 0
	let excess = 0
	let band = bandOf(ph)
	// powder still on the bottom (mol): baking soda, washing soda
	let solidHco3 = 0
	let solidCo3 = 0
	const solids = () => solidHco3 * H_NAHCO3_S + solidCo3 * H_NA2CO3_S
	const publish = (ctx: ProcessContext) => {
		ctx.set(item, "ph", ph)
		ctx.set(item, "left_g", solidHco3 * 84.007 + solidCo3 * 105.988)
		ctx.set(item, "color_band", band)
		ctx.set(item, "co2_g", (escaped + excess) * 44.01)
		ctx.set(item, "escaped_g", escaped * 44.01)
		ctx.set(item, "fizz", Math.min(1, excess / 0.002))
		ctx.set(item, "temp_c", warm.temp)
		carry(ctx.solid(r.ballast as string), Math.max(0, extra - (escaped * 44.01) / 1000), Math.max(extra, 1e-6), ctx)
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			warm.start(ctx)
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			const t = ctx.time()
			let added = false
			while (done < steps.length && t >= (steps[done] as Step).at) {
				const s = steps[done] as Step
				done++
				added = true
				sol.na += Math.max(0, s.na - s.hco3 - 2 * s.co3)
				sol.ac += s.acetic
				sol.cit += s.citric
				sol.V += s.ml / 1000
				solidHco3 += s.hco3
				solidCo3 += s.co3
				// (what came in, as it came: acetic acid in solution; the powders as solids, which dissolve, as it is stirred in, up to what the water holds)
				H += s.acetic * H_HA + s.hco3 * H_NAHCO3_S + s.co3 * H_NA2CO3_S
				ctx.event(`${s.what} is poured into ${item}`, [item], "poured")
			}
			if (solidHco3 > 0 || solidCo3 > 0) {
				const kg = water + (sol.V - water / 998.2 * 1000) * 1.0
				const T = warm.temp
				const capA = (table(SODA_SOLUBILITY, T) * kg * 10) / 84.007
				const capB = (table(WASHING_SOLUBILITY, T) * kg * 10) / 105.988
				const a = Math.min(solidHco3, Math.max(0, capA - sol.ct))
				solidHco3 -= a
				sol.ct += a
				sol.na += a
				const b = Math.min(solidCo3, Math.max(0, capB - sol.ct))
				solidCo3 -= b
				sol.ct += b
				sol.na += 2 * b
				if (a > 0 || b > 0) added = true
			}
			if (!added && sol.ct <= 0) {
				warm.put(0, dt)
				publish(ctx)
				return
			}
			ph = phOf(sol)
			// (the CO2(aq) past what the water holds bubbles out within fizzTau; the rest leaves slowly toward the air's)
			const h2co3 = speciesAt(sol, ph).h2co3
			const sat = CO2_SAT * sol.V
			excess = Math.max(0, h2co3 - sat)
			const fast = excess * (1 - Math.exp(-dt / fizzTau))
			const slow = Math.max(0, Math.min(h2co3, sat) - CO2_AIR * sol.V) * (1 - Math.exp(-dt / CO2_SLOW))
			const gone = Math.min(sol.ct, fast + slow)
			sol.ct -= gone
			escaped += gone
			excess = Math.max(0, excess - fast)
			ph = phOf(sol)
			const now = enthalpyAt(sol, ph) + solids()
			const q = H - now - gone * H_CO2_GONE
			H = now
			warm.put(q, dt)
			const b = bandOf(ph)
			if (b !== band) {
				band = b
				ctx.event(`${item} turns ${BAND_NAMES[b]} (pH ${ph.toFixed(1)})`, [item], "colour")
			}
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- calcium chloride + baking soda: a precipitate
/** Calcium carbonate's fine grains (about 10 µm) settle at Stokes' speed 2Δρ g r²/9μ (Δρ 1711 kg/m³, μ 1.0 mPa·s): 0.093 mm/s. How cloudy
 *  a suspension looks: 1 − e^(−c/0.5 g/L) (about 1 g/L is milky: a modelling choice). */
const SETTLE = (2 * 1711 * 9.81 * 5e-6 * 5e-6) / (9 * 1.0e-3)
const CLOUD = 0.5

export const precipProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const water = Math.max(1e-6, num(r.water, 0.1))
	const nCa = Math.max(0, num(r.cacl2, 0.045))
	const nHco3 = Math.max(0, num(r.hco3, 0.0595))
	const extra = Math.max(0, num(r.extra, 0.01))
	const depth = Math.max(0.005, num(r.depth, 0.03))
	const at = num(r.at, 1.2)
	const react = Math.max(0.01, num(r.react, 2))
	const fizzTau = Math.max(0.01, num(r.fizz, 3))
	const glass = Math.max(0, num(r.capacity, 75))
	const warm = new Warmth(idOf(r.heat), idOf(r.heat) === undefined ? undefined : idOf(r.solid), glass, water * C_WATER + glass, num(r.area, 0.02), num(r.start, 20))
	const V = (water / 998.2) * 1000
	const sodaCap = (T: number) => (table(SODA_SOLUBILITY, T) * water * 10) / 84.007
	let mixed = false
	let ca = 0
	// (the baking soda dissolved in the water from the start, up to what it holds; the rest on the bottom dissolves as the reaction uses it)
	let hco3 = Math.min(nHco3, sodaCap(num(r.start, 20)))
	let solidSoda = nHco3 - hco3
	let p = 0
	let h2co3 = 0
	let escaped = 0
	let suspended = 0
	let settled = 0
	let excess = 0
	const said = { cloudy: false, fizz: false }
	const publish = (ctx: ProcessContext) => {
		const cloudy = 1 - Math.exp(-(suspended * 100.087) / V / CLOUD)
		ctx.set(item, "solid_g", p * 100.087)
		ctx.set(item, "cloudy", cloudy)
		ctx.set(item, "settled_g", settled * 100.087)
		ctx.set(item, "co2_g", (escaped + excess) * 44.01)
		ctx.set(item, "escaped_g", escaped * 44.01)
		ctx.set(item, "fizz", Math.min(1, excess / 0.002))
		ctx.set(item, "temp_c", warm.temp)
		carry(ctx.solid(r.ballast as string), Math.max(0, extra - (escaped * 44.01) / 1000), Math.max(extra, 1e-6), ctx)
		if (!said.cloudy && cloudy >= 0.5) {
			said.cloudy = true
			ctx.event(`${item} turns cloudy white: a new solid, calcium carbonate (chalk), forms`, [item], "precipitate")
		}
		if (!said.fizz && excess > 0.0002) {
			said.fizz = true
			ctx.event(`${item} fizzes: carbon dioxide bubbles out`, [item], "fizz")
		}
	}
	return {
		coarse: 8,
		start(ctx: ProcessContext) {
			warm.start(ctx)
			publish(ctx)
		},
		slow(ctx: ProcessContext, dt: number) {
			let q = 0
			if (ctx.time() >= at) {
				if (!mixed) {
					// (the calcium chloride dissolves as it is stirred in: CaCl2(s) → Ca2+ + 2Cl−, −81.8 kJ/mol by ΔfH)
					mixed = true
					ca = nCa
					q += nCa * (H_CACL2_S - H_CA - 2 * H_CL)
					ctx.event(`calcium chloride is poured into ${item}`, [item], "poured")
				}
				// the powder on the bottom dissolves as far as the water holds it (+18.7 kJ/mol taken in)
				if (solidSoda > 0) {
					const d = Math.min(solidSoda, Math.max(0, sodaCap(warm.temp) - hco3))
					solidSoda -= d
					hco3 += d
					q += d * (H_NAHCO3_S - H_NA - H_HCO3)
				}
				// Ca2+ + 2HCO3− → CaCO3(s) + CO2(aq) + H2O (+19.6 kJ/mol), first order toward what the scarcer of the two allows
				const most = Math.min(nCa, (hco3 + 2 * p) / 2)
				const dp = Math.max(0, Math.min(ca, hco3 / 2, (most - p) * (1 - Math.exp(-dt / react))))
				p += dp
				ca -= dp
				hco3 -= 2 * dp
				h2co3 += dp
				suspended += dp
				q += dp * (H_CA + 2 * H_HCO3 - H_CACO3_S - H_H2CO3)
				// the CO2 past what the water holds bubbles out; the rest leaves slowly
				const sat = CO2_SAT * V
				excess = Math.max(0, h2co3 - sat)
				const fast = excess * (1 - Math.exp(-dt / fizzTau))
				const slow = Math.max(0, Math.min(h2co3, sat) - CO2_AIR * V) * (1 - Math.exp(-dt / CO2_SLOW))
				const gone = Math.min(h2co3, fast + slow)
				h2co3 -= gone
				escaped += gone
				excess = Math.max(0, excess - fast)
				q += gone * (H_H2CO3 - H_CO2_GONE)
				// the white solid settles to the bottom
				const ds = suspended * (1 - Math.exp((-SETTLE * dt) / depth))
				suspended -= ds
				settled += ds
			}
			warm.put(q, dt)
			publish(ctx)
		}
	}
}

// ---------------------------------------------------------------- models of molecules and crystals
export const atomsProcess = (r: ProcessRecord) => {
	const item = r.item as string
	const readings = (typeof r.readings === "object" && r.readings !== null ? r.readings : {}) as Record<string, unknown>
	return {
		start(ctx: ProcessContext) {
			for (const [k, v] of Object.entries(readings)) if (typeof v === "number" && Number.isFinite(v)) ctx.set(item, k, v)
		}
	}
}

export const CHEM_ROLES = ["pack", "warmer", "rust", "indicator", "precip", "atoms"] as const

/** Why a chemistry record cannot run, or undefined. */
export const chemProblem = (r: ProcessRecord): string | undefined => {
	if (r.role === "indicator") {
		if (r.steps !== undefined && (!Array.isArray(r.steps) || (r.steps as unknown[]).length > 8)) return "steps must be a list of at most 8 additions"
		for (const s of (r.steps ?? []) as unknown[]) {
			if (typeof s !== "object" || s === null) return "each step must be an object"
			for (const k of ["at", "acetic", "citric", "hco3", "co3", "na", "ml", "kg"]) {
				const v = (s as Record<string, unknown>)[k]
				if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e6)) return `a step's ${k} must be a finite number`
			}
		}
	}
	for (const k of ["capacity", "area", "molar", "dh", "salt", "iron", "full", "lasts", "rustTau", "share", "cacl2", "hco3", "extra", "depth", "react", "fizz", "at"]) {
		const v = r[k]
		if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9)) return `${k} must be a finite number`
	}
	if (r.role === "atoms" && r.readings !== undefined && (typeof r.readings !== "object" || r.readings === null)) return "readings must be an object"
	return undefined
}

export const chemProcess = (r: ProcessRecord) => {
	switch (r.role) {
		case "pack":
			return packProcess(r)
		case "warmer":
			return warmerProcess(r)
		case "rust":
			return rustProcess(r)
		case "indicator":
			return indicatorProcess(r)
		case "precip":
			return precipProcess(r)
		default:
			return atomsProcess(r)
	}
}
