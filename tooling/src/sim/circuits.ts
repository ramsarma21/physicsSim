/**
 * Circuits and electricity: what a scene's `doc.circuits` describes, solved every engine step (480 Hz) with tooling/src/sim/circuit-solver.ts.
 * Planck-free: the engine's adapter (circuits-engine.ts) hands each step what the mechanics says (a motor shaft's turning, what presses a
 * switch, what bridges a tester's probes, how much light falls on a solar panel, how far apart a wire's two ends are) and takes back what the
 * circuit does to the mechanics (each motor's drive: the speed it heads for and the most torque it gives now).
 *
 * Parts (each joins two terminals, `a` and `b`; a terminal is a node name, "<item id>/<terminal>"; an item may have internal nodes):
 *   battery    emf (V) with its + at a, r (Ω, internal)                       I_ab = (V_ab − emf)/r
 *   wire       r (Ω), length (m): pulled off (open for good) once its two ends are farther apart than its length
 *   bulb       v_rated, i_rated (A), t_rated (K): a tungsten filament, R from its temperature, which follows the power in and the light out
 *   led        vf (V at i_rated), i_rated (A), rs (Ω), i_max (A): conducts a→b only (a = anode), from its knee vf − rs·i_rated
 *   switch     closed (at the start), flips [s] (moments it is switched), r (Ω closed); press: {solid, force N}: closed while pressed that hard
 *   resistor   r (Ω); turn: {r, from, to}: a dimmer turned from r to turn.r between the two moments (s)
 *   buzzer     r (Ω), v_min (V it sounds from), v_rated, pitch (Hz)
 *   motor      k (V·s/rad at its shaft, gearbox included), r (Ω), efficiency (gearbox), joint (the shaft's pin joint id)
 *   generator  the same as a motor; its shaft is turned by a hand crank (the joint's own drive), so it only gives current
 *   probe      contacts [solid, solid]: a tester's two probes; closed through whatever single solid touches both, R = ρ·L/A of its material
 *   solar      isc (A at 1000 W/m²), v_knee (V), g_d (S above the knee), rsh, rs (Ω), cells: a panel's face {solid, at, normal, area}
 *   meter      mode "volts" (10 MΩ across a and b) | "amps" | "galvanometer" (r in series): its reading is V_ab or I_ab
 *   coil       r (Ω, its winding), turns; an EMF the step's input gives it (StepInput.emf: a magnet's changing flux through it, + at a)
 *   conductor  r (Ω): a straight wire whose current makes a field round it (`field`: its line, for the module's force on magnets)
 *
 * Values and sources: see machines/catalog_circuits.py, which builds these parts (the constants below that are the engine's own say where they
 * come from). Every number here is in SI units.
 */
import { type Branch, lineOf, type Solution, solve } from "#sim/circuit-solver.ts"

export interface Vec {
	readonly x: number
	readonly y: number
}
export interface Vec3 {
	readonly x: number
	readonly y: number
	readonly z: number
}

export type CircuitPart =
	| { readonly kind: "battery"; readonly id: string; readonly item?: string; readonly name?: string; readonly a: string; readonly b: string; readonly emf: number; readonly r: number }
	| { readonly kind: "wire"; readonly id: string; readonly item?: string; readonly name?: string; readonly a: string; readonly b: string; readonly r: number; readonly length?: number }
	| {
			readonly kind: "bulb"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly v_rated: number
			readonly i_rated: number
			readonly t_rated?: number
	  }
	| {
			readonly kind: "led"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly vf: number
			readonly i_rated: number
			readonly rs: number
			readonly i_max: number
	  }
	| {
			readonly kind: "switch"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly closed: boolean
			readonly r: number
			readonly flips?: readonly number[]
			readonly press?: { readonly solid: string; readonly force: number }
	  }
	| {
			readonly kind: "resistor"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly r: number
			readonly turn?: { readonly r: number; readonly from: number; readonly to: number }
	  }
	| {
			readonly kind: "buzzer"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly r: number
			readonly v_min: number
			readonly v_rated: number
			readonly pitch: number
	  }
	| {
			readonly kind: "motor"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly k: number
			readonly r: number
			readonly efficiency?: number
			/** its shaft: a solid it turns against its stator (a solid, or the world when none) about `pivot` (in the rotor's frame) */
			readonly rotor?: string
			readonly stator?: string
			readonly pivot?: Vec
			/** a fan's rotor instead (not a body: it turns about the motor's axis along x): inertia (kg·m²), drag torque c·ω² (N·m·s²), and its jet */
			readonly fan?: { readonly inertia: number; readonly drag: number; readonly solid: string; readonly at: Vec; readonly direction: number; readonly diameter: number; readonly pitch: number }
			/** friction torque at the shaft (N·m) */
			readonly friction?: number
	  }
	| {
			readonly kind: "generator"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly k: number
			readonly r: number
			/** turned by hand at this many rad/s from `from` (s) until `to` (s) */
			readonly speed: number
			readonly from: number
			readonly to?: number
	  }
	| { readonly kind: "probe"; readonly id: string; readonly item?: string; readonly name?: string; readonly a: string; readonly b: string; readonly contacts: readonly [string, string] }
	| {
			readonly kind: "solar"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly isc: number
			readonly v_knee: number
			readonly g_d: number
			readonly rsh: number
			readonly rs: number
			readonly face: { readonly solid: string; readonly at: Vec; readonly normal: Vec; readonly width: number }
			readonly sun?: { readonly irradiance: number; readonly angle: number }
	  }
	| { readonly kind: "meter"; readonly id: string; readonly item?: string; readonly name?: string; readonly a: string; readonly b: string; readonly mode: "volts" | "amps" | "galvanometer"; readonly r: number; readonly fs?: number }
	| {
			readonly kind: "coil"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly r: number
			readonly turns: number
			/** its turns as a magnet's field meets them: the bore's middle (`at`, in `solid`'s frame), its axis (rad, that frame: positive current
			 *  a→b makes its field along it), the mean turn's radius and the winding's length (m) */
			readonly induce?: { readonly solid: string; readonly at: Vec; readonly axis: number; readonly radius: number; readonly length: number }
	  }
	| {
			readonly kind: "conductor"
			readonly id: string
			readonly item?: string
			readonly name?: string
			readonly a: string
			readonly b: string
			readonly r: number
			/** its line from a to b (in `solid`'s frame; z across the machine plane, m): positive current runs from `from` to `to` */
			readonly field?: { readonly solid: string; readonly from: Vec3; readonly to: Vec3 }
	  }

export interface CircuitsDoc {
	readonly parts: readonly CircuitPart[]
	/** Where each terminal is: on a solid, in its own frame (wires run between these; a wire's ends pull apart with them). */
	readonly terminals?: Readonly<Record<string, { readonly solid: string; readonly at: Vec }>>
	/** Ω·m by material name: what a tester's probes conduct through (a material not listed is an insulator, INSULATOR). */
	readonly resistivity?: Readonly<Record<string, number>>
	/** The scene's items' names, [id, name] pairs, for what the events say ("conducts through Coin"). */
	readonly names?: readonly (readonly [string, string])[]
	/** Light sources that are not parts (a lamp of another kind): radiated power (W) from a point on a solid; `usable`: the share a silicon cell uses. */
	readonly lights?: readonly { readonly solid: string; readonly at: Vec; readonly power: number; readonly usable?: number }[]
}

// ---------------------------------------------------------------- constants (SI)
/** Room temperature (K), 20 °C. */
export const ROOM_K = 293.15
/** Stefan–Boltzmann constant (W/m²K⁴), CODATA 2018. */
const SIGMA = 5.670374419e-8
/** Tungsten: resistivity at 20 °C (Ω·m, CRC Handbook: 5.28 µΩ·cm), its rise with temperature ρ ∝ T^1.2 (a fit to Desai et al., J. Phys. Chem. Ref. Data 13, 1069 (1984), within 7 % from 300 to 3000 K), density 19 300 kg/m³, mean specific heat 0.15 J/(g·K) over 300–2500 K (CRC: 0.132 at 300 K to 0.17 at 2500 K), total emissivity 0.30 at 2500 K (Forsythe & Worthing, Astrophys. J. 61, 146 (1925)), melting point 3695 K (CRC). */
const W_RHO20 = 5.28e-8
const W_RHO_EXP = 1.2
const W_DENSITY = 19300
const W_HEAT = 150
const W_EMISSIVITY = 0.3
export const W_MELT = 3695
/** A filament's light against its rated light: exp(LAMP_C·(1 − T_r/T)). LAMP_C = 3.4 × 2.6: light ∝ V^3.4 (the lamp law: GE Miniature Lamp catalog, "light output ∝ V^3.4, current ∝ V^0.55"), and V ∝ T^2.6 here (V² = P·R, P ∝ T⁴, R ∝ T^1.2). */
const LAMP_C = 3.4 * 2.6
/** What counts as lit (the events and the goals): a tenth of its full light: a bulb glows dull orange there (about 50 % of its rated voltage); an
 * LED at 2 mA is plainly seen in a lit room. */
export const LIT = 0.1
/** An LED fails open once its current has stayed over twice its most continuous current (i_max: 30 mA for a 5 mm LED [LED]) for this long (s):
 * a red LED straight on two AA cells (about 140 mA) burns out at once; at 40 mA it only ages faster (provisional). */
const LED_FAIL_OVER = 2
const LED_FAIL_S = 0.05
/** A material a tester's probes touch that is not in the resistivity table: an insulator (Ω·m, dry wood's order). */
export const INSULATOR = 1e14
/** How long a new state must last before it is said (s): a click of a bouncing ball on a push switch is not a ring. */
export const EVENT_HOLD = 0.03
/** An active buzzer's driver conducts forward only, from about this voltage (a transistor's base-emitter drop; provisional). */
const BUZZER_KNEE = 0.7
/** Contact resistance where a probe touches a test object (Ω): clean metal on metal, provisional. */
const PROBE_CONTACT = 0.05
/**
 * A watt of a filament's radiation against a watt of sunlight, in what a silicon cell turns into current (see lightsNow): a 2500 K black body
 * gives 0.121 A per W of its radiation to crystalline silicon (its quantum efficiency [GREEN], Planck's law band by band), AM1.5 sunlight 0.347
 * A/W (the optics module's spectrum, ASTM G173; tooling/src/sim/circuits-em.ts SI_RESPONSE): 0.35.
 */
export const FILAMENT_USABLE = 0.35
/** Sunlight a solar panel's isc is stated for (W/m², the standard test condition). */
const STC = 1000
/**
 * A filament's life: the lamp law's life ∝ V^-13 (IES Lighting Handbook; GE Miniature Lamp catalog: life ∝ V^-12 to -13), here ∝ (T/T_r)^33.8
 * (V ∝ T^2.6), from a rated average life of 15 h (GE #14, 2.47 V 0.30 A: 15 h; provisional for the other ratings). Its wear adds up as it
 * burns; it burns out (opens for good) when it reaches 1. At its rated voltage that is 15 hours; at twice it, two seconds; at 1.5 times, minutes.
 */
const LIFE_S = 15 * 3600
const LIFE_EXP = 13 * 2.6
/** The most a filament's temperature may change in one solve (K): the thermal sub-steps (a cold filament takes a 3 A inrush). */
const THERMAL_STEP_K = 20
const THERMAL_SUB_MAX = 64
/** Above this a battery is reported short-circuited (A): a fresh AA's short-circuit current is about 10 A (Energizer E91: 0.15 Ω). */
export const SHORT_A = 5

// ---------------------------------------------------------------- a bulb's filament, from its rating
export interface Filament {
	readonly rHot: number
	readonly tRated: number
	readonly pRated: number
	/** J/K */
	readonly heat: number
	/** m: wire diameter and length (what its rating takes) */
	readonly d: number
	readonly length: number
}

/**
 * The filament a rating makes: it radiates its rated power at t_rated with emissivity 0.30, and has its rated resistance there, so its
 * radiating area A = P/(εσ(T⁴ − T₀⁴)) and its length over diameter² Q = R·π/(4ρ(T)) fix its diameter d = (A/(πQ))^⅓ and length L = Q·d²;
 * its heat capacity is its tungsten's (2.5 V 0.3 A: d 34 µm, L 10.6 mm, 2.7e-5 J/K, a 23 ms time constant at full glow).
 */
export const filamentOf = (vRated: number, iRated: number, tRated = 2500): Filament => {
	const rHot = vRated / iRated
	const pRated = vRated * iRated
	const rho = W_RHO20 * (tRated / ROOM_K) ** W_RHO_EXP
	const area = pRated / (W_EMISSIVITY * SIGMA * (tRated ** 4 - ROOM_K ** 4))
	const q = (rHot * Math.PI) / (4 * rho)
	const d = (area / (Math.PI * q)) ** (1 / 3)
	const length = q * d * d
	const mass = W_DENSITY * ((Math.PI * d * d) / 4) * length
	return { rHot, tRated, pRated, heat: mass * W_HEAT, d, length }
}

/** The filament's resistance at temperature T (Ω). */
const filamentR = (f: Filament, T: number) => f.rHot * (T / f.tRated) ** W_RHO_EXP
/** What it radiates at T (W). */
const filamentRadiates = (f: Filament, T: number) => (f.pRated * (T ** 4 - ROOM_K ** 4)) / (f.tRated ** 4 - ROOM_K ** 4)
/** Its light against its rated light. */
export const filamentLight = (f: Filament, T: number) => (T <= ROOM_K + 1 ? 0 : Math.exp(LAMP_C * (1 - f.tRated / T)))

// ---------------------------------------------------------------- readings
/** One part's state at a moment. */
export interface Reading {
	/** A, a→b through the part */
	i: number
	/** V, a − b */
	v: number
	/** light against rated (bulb, led) */
	light?: number
	/** K (bulb) */
	temp?: number
	/** it has failed open (a bulb burnt out, an LED blown, a wire pulled off) */
	broken?: boolean
	/** switch closed, probe bridged */
	closed?: boolean
	/** buzzer sounding (0..: loudness against rated) */
	sound?: number
	/** motor or generator shaft speed (rad/s) */
	omega?: number
	/** W/m² on a solar panel */
	irradiance?: number
	/** what a probe conducts through (its item id) */
	through?: string
	/** a meter's reading (V or A) */
	reads?: number
	/** a coil's EMF (V, + at a) */
	emf?: number
}

export interface StepInput {
	/** a motor's or generator's shaft speed now (rad/s, counter-clockwise: its rotor against its stator) */
	readonly omega?: (part: CircuitPart) => number
	/** the force pressing a solid now (N) */
	readonly press?: (solid: string) => number
	/** what single solid touches both of a tester's contacts now: its item id, its material name, and the path's length and cross-section (m, m²) */
	readonly bridge?: (contacts: readonly [string, string]) => { readonly item: string; readonly material: string; readonly length: number; readonly area: number } | undefined
	/** where a terminal is now (world, m) */
	readonly terminal?: (name: string) => Vec | undefined
	/** the light falling on a solar panel's face now (W/m², silicon-usable), from the sun and the lights, with what blocks it */
	readonly irradiance?: (part: CircuitPart & { kind: "solar" }, lights: readonly { readonly at: Vec; readonly power: number; readonly usable: number; readonly item?: string }[]) => number
	/** where a light part (a bulb) is now (world, m) */
	readonly lightAt?: (part: CircuitPart) => Vec | undefined
	/** a coil's EMF now (V, + at a: the flux its turns link changing) */
	readonly emf?: (part: CircuitPart & { kind: "coil" }) => number
}

/**
 * A motor's line for the coming step: its current as a function of its back-EMF, I(e) = a − b·e (A; b in A/V), the rest of the circuit held.
 * Its torque is then η·k·I(k·ω): the caller turns it into a drive that is implicit in ω (stable however light the rotor).
 */
export interface Line {
	readonly a: number
	readonly b: number
}

export interface CircuitEvent {
	readonly t: number
	readonly part: string
	readonly item?: string
	readonly kind: "lights" | "goes-out" | "burns-out" | "sounds" | "stops-sounding" | "turns" | "stops" | "closes" | "opens" | "pulled-off" | "short" | "conducts" | "insulates"
	readonly text: string
}

const finite = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback)

/** The nodes, the parts' branches and their order (one branch per part, solar cells three, at fixed places). */
interface Layout {
	readonly n: number
	readonly node: Map<string, number>
	/** each part's branch indices: [main] or, for a solar panel, [photocurrent, junction, shunt, series] */
	readonly at: readonly (readonly number[])[]
	readonly count: number
}

const layoutOf = (doc: CircuitsDoc): Layout => {
	const node = new Map<string, number>()
	const id = (name: string) => {
		let k = node.get(name)
		if (k === undefined) {
			k = node.size
			node.set(name, k)
		}
		return k
	}
	let count = 0
	const at = doc.parts.map((p) => {
		id(p.a)
		id(p.b)
		if (p.kind === "solar") {
			id(`${p.id}#cell`)
			const out = [count, count + 1, count + 2, count + 3]
			count += 4
			return out
		}
		return [count++]
	})
	return { n: node.size, node, at, count }
}

/** Checks a circuits document (one line on what is wrong, as the engine's own admission does). */
export const admitCircuits = (raw: unknown, solidIds: ReadonlySet<string>): CircuitsDoc => {
	const bad = (why: string): never => {
		throw new Error(`circuits: ${why}`)
	}
	if (typeof raw !== "object" || raw === null) bad("is not an object")
	const doc = raw as CircuitsDoc
	if (!Array.isArray(doc.parts)) bad("has no parts list")
	const num = (p: Record<string, unknown>, key: string, lo = 0, strict = false) => {
		const v = p[key]
		if (typeof v !== "number" || !Number.isFinite(v) || v < lo || (strict && v === lo)) bad(`part ${String(p.id)}'s ${key} is ${JSON.stringify(v)}; it must be a number ${strict ? "over" : "at least"} ${lo}`)
	}
	const seen = new Set<string>()
	for (const part of doc.parts) {
		const p = part as unknown as Record<string, unknown>
		if (typeof p.id !== "string" || p.id === "") bad("a part has no id")
		if (seen.has(p.id as string)) bad(`two parts are called ${String(p.id)}`)
		seen.add(p.id as string)
		if (typeof p.a !== "string" || typeof p.b !== "string") bad(`part ${String(p.id)} needs two terminals, a and b`)
		switch (part.kind) {
			case "battery":
				num(p, "emf")
				num(p, "r", 0, true)
				break
			case "wire":
				num(p, "r", 0, true)
				if (p.length !== undefined) num(p, "length", 0, true)
				break
			case "bulb":
				num(p, "v_rated", 0, true)
				num(p, "i_rated", 0, true)
				if (p.t_rated !== undefined) num(p, "t_rated", 1000)
				break
			case "led":
				num(p, "vf", 0, true)
				num(p, "i_rated", 0, true)
				num(p, "rs", 0, true)
				num(p, "i_max", 0, true)
				break
			case "switch":
				num(p, "r", 0, true)
				if (typeof p.closed !== "boolean") bad(`switch ${String(p.id)}'s closed must be true or false`)
				if (p.press !== undefined && !solidIds.has(part.press?.solid ?? "")) bad(`switch ${String(p.id)}'s press solid ${JSON.stringify(part.press?.solid)} is not a solid`)
				break
			case "resistor":
				num(p, "r", 0, true)
				if (part.turn !== undefined && !(part.turn.r > 0 && Number.isFinite(part.turn.r))) bad(`resistor ${String(p.id)}'s turn.r must be over 0`)
				break
			case "buzzer":
				num(p, "r", 0, true)
				num(p, "v_min")
				num(p, "v_rated", 0, true)
				num(p, "pitch", 0, true)
				break
			case "motor":
				num(p, "k", 0, true)
				num(p, "r", 0, true)
				if (part.rotor !== undefined && !solidIds.has(part.rotor)) bad(`motor ${String(p.id)}'s rotor ${JSON.stringify(part.rotor)} is not a solid`)
				if (part.stator !== undefined && !solidIds.has(part.stator)) bad(`motor ${String(p.id)}'s stator ${JSON.stringify(part.stator)} is not a solid`)
				if (part.fan !== undefined && !(part.fan.inertia > 0 && part.fan.drag >= 0 && solidIds.has(part.fan.solid))) bad(`motor ${String(p.id)}'s fan needs an inertia over 0, a drag of 0 or more and a solid`)
				break
			case "generator":
				num(p, "k", 0, true)
				num(p, "r", 0, true)
				if (typeof p.speed !== "number" || !Number.isFinite(p.speed)) bad(`generator ${String(p.id)}'s speed must be a number`)
				num(p, "from")
				break
			case "probe":
				if (!Array.isArray(part.contacts) || part.contacts.length !== 2 || !part.contacts.every((s) => solidIds.has(s))) bad(`probe ${String(p.id)}'s contacts must be two solids`)
				break
			case "solar":
				num(p, "isc")
				num(p, "v_knee")
				num(p, "g_d", 0, true)
				num(p, "rsh", 0, true)
				num(p, "rs", 0, true)
				if (!solidIds.has(part.face?.solid ?? "")) bad(`solar panel ${String(p.id)}'s face is not on a solid`)
				break
			case "meter":
				num(p, "r", 0, true)
				if (part.mode !== "volts" && part.mode !== "amps" && part.mode !== "galvanometer") bad(`meter ${String(p.id)}'s mode must be "volts", "amps" or "galvanometer"`)
				if (p.fs !== undefined) num(p, "fs", 0, true)
				break
			case "coil": {
				num(p, "r", 0, true)
				num(p, "turns", 0, true)
				const ind = part.induce
				if (ind !== undefined) {
					if (!solidIds.has(ind.solid ?? "")) bad(`coil ${String(p.id)}'s induce.solid ${JSON.stringify(ind.solid)} is not a solid`)
					for (const v of [ind.at?.x, ind.at?.y, ind.axis]) if (typeof v !== "number" || !Number.isFinite(v)) bad(`coil ${String(p.id)}'s induce needs at {x, y} and axis (numbers)`)
					if (!(ind.radius > 0 && ind.length > 0 && Number.isFinite(ind.radius) && Number.isFinite(ind.length))) bad(`coil ${String(p.id)}'s induce needs a radius and a length over 0`)
				}
				break
			}
			case "conductor": {
				num(p, "r", 0, true)
				const f = part.field
				if (f !== undefined) {
					if (!solidIds.has(f.solid ?? "")) bad(`conductor ${String(p.id)}'s field.solid ${JSON.stringify(f.solid)} is not a solid`)
					for (const v of [f.from?.x, f.from?.y, f.from?.z, f.to?.x, f.to?.y, f.to?.z]) if (typeof v !== "number" || !Number.isFinite(v)) bad(`conductor ${String(p.id)}'s field needs from and to {x, y, z} (numbers)`)
				}
				break
			}
			default:
				bad(`part ${String(p.id)} is of no known kind (${JSON.stringify(p.kind)})`)
		}
	}
	for (const [name, t] of Object.entries(doc.terminals ?? {})) {
		if (!solidIds.has(t.solid)) bad(`terminal ${name} is on ${JSON.stringify(t.solid)}, which is not a solid`)
	}
	return doc
}

/**
 * One run of a scene's circuits. `step(t, h, input)` once per engine step (before the world steps): the parts' states move on by h, the circuit
 * is solved, and `drive(joint)` then says how each motor drives its shaft through the coming step. `sample()` gives every part's reading now.
 */
export class CircuitSim {
	readonly doc: CircuitsDoc
	readonly layout: Layout
	readonly filaments: Map<string, Filament>
	/** per part */
	readonly temp: Map<string, number>
	/** a filament's wear (0 new, 1 worn through) */
	readonly wear: Map<string, number> = new Map()
	readonly broken: Set<string>
	readonly overSince: Map<string, number>
	private readonly peak = new Map<string, number>()
	readonly lines: Map<string, Line>
	readonly events: CircuitEvent[] = []
	readonly readings: Map<string, Reading> = new Map()
	private diodes: boolean[] = []
	/** each part's reported state per channel ("<id>#lit"...), and since when a different state has lasted */
	private shown = new Map<string, boolean>()
	private pending = new Map<string, number>()
	private shorted = new Set<string>()
	private judged = new Set<string>()
	private bridgeSince = new Map<string, { item: string; t: number }>()

	constructor(doc: CircuitsDoc) {
		this.doc = doc
		this.layout = layoutOf(doc)
		this.filaments = new Map()
		this.temp = new Map()
		this.broken = new Set()
		this.overSince = new Map()
		this.lines = new Map()
		for (const p of doc.parts) {
			if (p.kind === "bulb") {
				this.filaments.set(p.id, filamentOf(p.v_rated, p.i_rated, p.t_rated))
				this.temp.set(p.id, ROOM_K)
			}
		}
	}

	/** Whether a switch is closed at t (its flips and its press). */
	private switchClosed(p: CircuitPart & { kind: "switch" }, t: number, input: StepInput): boolean {
		let closed = p.closed
		for (const f of p.flips ?? []) if (t >= f) closed = !closed
		// (a push switch is also closed while what rests on its button weighs its press force)
		if (!closed && p.press !== undefined) closed = (input.press?.(p.press.solid) ?? 0) >= p.press.force
		return closed
	}

	/** A dimmer's resistance at t. */
	private static resistance(p: CircuitPart & { kind: "resistor" }, t: number) {
		const turn = p.turn
		if (turn === undefined || t <= turn.from) return p.r
		if (t >= turn.to || turn.to <= turn.from) return turn.r
		return p.r + ((turn.r - p.r) * (t - turn.from)) / (turn.to - turn.from)
	}

	/**
	 * The branches now, given the filaments' temperatures and what the step's inputs say; `extra` gathers what the readings need besides
	 * (a probe's path, a panel's light).
	 */
	private branches(t: number, input: StepInput, extra: Map<string, Partial<Reading>>, lights: readonly { readonly at: Vec; readonly power: number; readonly usable: number; readonly item?: string }[]): Branch[] {
		const { node, at, count } = this.layout
		const out: Branch[] = new Array(count)
		const open = (a: number, b: number): Branch => ({ kind: "g", a, b, g: 0, e: 0 })
		this.doc.parts.forEach((p, k) => {
			const a = node.get(p.a) as number
			const b = node.get(p.b) as number
			const [m] = at[k] as readonly number[]
			const main = m as number
			if (this.broken.has(p.id)) {
				out[main] = open(a, b)
				if (p.kind === "solar") for (const j of (at[k] as number[]).slice(1)) out[j] = open(a, b)
				return
			}
			switch (p.kind) {
				case "battery":
					out[main] = { kind: "g", a, b, g: 1 / p.r, e: p.emf }
					return
				case "wire":
					out[main] = { kind: "g", a, b, g: 1 / p.r, e: 0 }
					return
				case "bulb": {
					const f = this.filaments.get(p.id) as Filament
					out[main] = { kind: "g", a, b, g: 1 / filamentR(f, this.temp.get(p.id) as number), e: 0 }
					return
				}
				case "led":
					out[main] = { kind: "d", a, b, g: 1 / p.rs, v0: p.vf - p.rs * p.i_rated }
					return
				case "switch": {
					const closed = this.switchClosed(p, t, input)
					extra.set(p.id, { closed })
					out[main] = closed ? { kind: "g", a, b, g: 1 / p.r, e: 0 } : open(a, b)
					return
				}
				case "resistor":
					out[main] = { kind: "g", a, b, g: 1 / CircuitSim.resistance(p, t), e: 0 }
					return
				case "buzzer":
					// (an active buzzer's driver: forward only, from about 0.7 V)
					out[main] = { kind: "d", a, b, g: 1 / p.r, v0: BUZZER_KNEE }
					return
				case "meter":
				case "conductor":
					out[main] = { kind: "g", a, b, g: 1 / p.r, e: 0 }
					return
				case "coil": {
					const emf = finite(input.emf?.(p) ?? 0)
					extra.set(p.id, { emf })
					out[main] = { kind: "g", a, b, g: 1 / p.r, e: emf }
					return
				}
				case "motor":
				case "generator": {
					const omega = finite(input.omega?.(p) ?? 0)
					extra.set(p.id, { omega })
					out[main] = { kind: "g", a, b, g: 1 / p.r, e: p.k * omega }
					return
				}
				case "probe": {
					const via = input.bridge?.(p.contacts)
					if (via === undefined) {
						extra.set(p.id, { closed: false })
						out[main] = open(a, b)
						return
					}
					const rho = this.doc.resistivity?.[via.material] ?? INSULATOR
					const r = PROBE_CONTACT + (rho * via.length) / Math.max(via.area, 1e-8)
					extra.set(p.id, { closed: true, through: via.item })
					out[main] = { kind: "g", a, b, g: 1 / r, e: 0 }
					return
				}
				case "solar": {
					const [, junction, shunt, series] = at[k] as readonly number[]
					const cell = node.get(`${p.id}#cell`) as number
					const irr = Math.max(0, finite(input.irradiance?.(p, lights) ?? 0))
					extra.set(p.id, { irradiance: irr })
					// the cell: its photocurrent and junction and shunt between its inner node and b; its series resistance out to a
					out[main] = { kind: "j", a: cell, b, i: (p.isc * irr) / STC }
					out[junction as number] = { kind: "d", a: cell, b, g: p.g_d, v0: p.v_knee }
					out[shunt as number] = { kind: "g", a: cell, b, g: 1 / p.rsh, e: 0 }
					out[series as number] = { kind: "g", a: cell, b: a, g: 1 / p.rs, e: 0 }
					return
				}
			}
		})
		return out
	}

	/** The light sources now: the parts that glow (bulbs), and the document's other lights. */
	private lightsNow(input: StepInput) {
		const out: { at: Vec; power: number; usable: number; item?: string }[] = []
		for (const p of this.doc.parts) {
			if (p.kind !== "bulb" || this.broken.has(p.id)) continue
			const f = this.filaments.get(p.id) as Filament
			const power = filamentRadiates(f, this.temp.get(p.id) as number)
			const at = input.lightAt?.(p)
			// (as sunlight would, per W/m²: a watt of a 2500 K filament's radiation makes FILAMENT_USABLE of the current a watt of sunlight makes)
			if (power > 0 && at !== undefined) out.push({ at, power, usable: FILAMENT_USABLE, ...(p.item === undefined ? {} : { item: p.item }) })
		}
		for (const l of this.doc.lights ?? []) {
			out.push({ at: l.at, power: l.power, usable: l.usable ?? FILAMENT_USABLE })
		}
		return out
	}

	/** Moves the circuit on from t − h to t and solves it at t (call before the world steps from t). */
	step(t: number, h: number, input: StepInput): void {
		// wires pulled off: their ends farther apart than the wire is long
		for (const p of this.doc.parts) {
			if (p.kind !== "wire" || p.length === undefined || this.broken.has(p.id)) continue
			const ea = input.terminal?.(p.a)
			const eb = input.terminal?.(p.b)
			if (ea === undefined || eb === undefined) continue
			if (Math.hypot(eb.x - ea.x, eb.y - ea.y) > p.length) {
				this.broken.add(p.id)
				this.events.push({ t, part: p.id, ...(p.item === undefined ? {} : { item: p.item }), kind: "pulled-off", text: "pulled off" })
			}
		}
		const lights = this.lightsNow(input)
		let extra = new Map<string, Partial<Reading>>()
		let br = this.branches(t, input, extra, lights)
		let sol = solve(this.layout.n, br, this.diodes)
		// the filaments' heat over the step, in sub-steps short enough that none changes more than THERMAL_STEP_K in one, the circuit solved
		// again at each (a cold filament draws ten times its rated current, and heats a thousand kelvin in a few milliseconds)
		if (this.filaments.size > 0 && h > 0) {
			let left = h
			for (let guard = 0; left > 0 && guard < THERMAL_SUB_MAX; guard++) {
				let rate = 0
				const rates = new Map<string, number>()
				this.doc.parts.forEach((p, k) => {
					if (p.kind !== "bulb" || this.broken.has(p.id)) return
					const f = this.filaments.get(p.id) as Filament
					const T = this.temp.get(p.id) as number
					const i = sol.current[(this.layout.at[k] as number[])[0] as number] as number
					const dT = (i * i * filamentR(f, T) - filamentRadiates(f, T)) / f.heat
					rates.set(p.id, dT)
					rate = Math.max(rate, Math.abs(dT))
				})
				let dt = left
				if (rate * dt > THERMAL_STEP_K && guard < THERMAL_SUB_MAX - 1) dt = Math.max(THERMAL_STEP_K / rate, h / THERMAL_SUB_MAX)
				if (dt > left) dt = left
				for (const [id, dT] of rates) {
					const T = Math.max(ROOM_K, (this.temp.get(id) as number) + dT * dt)
					this.temp.set(id, T)
					const f = this.filaments.get(id) as Filament
					// (its wear over the sub-step, at the temperature it ends it at)
					const worn = (this.wear.get(id) ?? 0) + (dt * (T / f.tRated) ** LIFE_EXP) / LIFE_S
					this.wear.set(id, worn)
					if ((T >= W_MELT || worn >= 1) && !this.broken.has(id)) {
						this.broken.add(id)
						const p = this.doc.parts.find((q) => q.id === id) as CircuitPart
						this.events.push({ t: t - left + dt, part: id, ...(p.item === undefined ? {} : { item: p.item }), kind: "burns-out", text: T >= W_MELT ? "burns out (its filament melted)" : "burns out (far over its rated voltage, its filament wore through)" })
					}
				}
				left -= dt
				if (left <= 1e-15) break
				this.diodes = sol.on
				extra = new Map()
				br = this.branches(t - left, input, extra, lights)
				sol = solve(this.layout.n, br, this.diodes)
			}
			// the circuit at t with the temperatures it ends the step at
			this.diodes = sol.on
			extra = new Map()
			br = this.branches(t, input, extra, lights)
			sol = solve(this.layout.n, br, this.diodes)
		}
		this.diodes = sol.on
		this.read(t, h, br, sol, extra)
	}

	/** Readings, failures, drives and events from a solution at t. */
	private read(t: number, h: number, br: readonly Branch[], sol: Solution, extra: Map<string, Partial<Reading>>) {
		const { node, at, n } = this.layout
		const ev = (p: CircuitPart, kind: CircuitEvent["kind"], text: string) =>
			this.events.push({ t, part: p.id, ...(p.item === undefined ? {} : { item: p.item }), kind, text })
		this.doc.parts.forEach((p, k) => {
			const idx = at[k] as readonly number[]
			const main = idx[0] as number
			const va = sol.v[node.get(p.a) as number] as number
			const vb = sol.v[node.get(p.b) as number] as number
			// (a part whose two ends lie in different components has no voltage across it that means anything: it reads the open-circuit
			// difference as 0 unless a solved path joins them)
			const joined = sol.component[node.get(p.a) as number] !== -1 && sol.component[node.get(p.a) as number] === sol.component[node.get(p.b) as number]
			const v = joined ? va - vb : 0
			let i = sol.current[main] as number
			if (p.kind === "solar") i = sol.current[idx[3] as number] as number
			const r: Reading = { i: finite(i), v: finite(v), ...extra.get(p.id) }
			if (this.broken.has(p.id)) r.broken = true
			switch (p.kind) {
				case "bulb": {
					const f = this.filaments.get(p.id) as Filament
					const T = this.temp.get(p.id) as number
					r.temp = T
					r.light = this.broken.has(p.id) ? 0 : filamentLight(f, T)
					break
				}
				case "led": {
					r.light = this.broken.has(p.id) || i <= 0 ? 0 : i / p.i_rated
					if (!this.broken.has(p.id) && i > LED_FAIL_OVER * p.i_max) {
						const since = this.overSince.get(p.id) ?? t
						this.overSince.set(p.id, since)
						const peak = Math.max(this.peak.get(p.id) ?? 0, i)
						this.peak.set(p.id, peak)
						if (t - since >= LED_FAIL_S) {
							this.broken.add(p.id)
							r.broken = true
							r.light = 0
							ev(p, "burns-out", `burned out: ${Math.round(peak * 1000)} mA is over its ${Math.round(p.i_max * 1000)} mA`)
						}
					} else this.overSince.delete(p.id)
					break
				}
				case "buzzer":
					// (sounds while driven forward from its least voltage; silent the wrong way round)
					r.sound = !this.broken.has(p.id) && v >= p.v_min && i > 0 ? v / p.v_rated : 0
					break
				case "meter":
					r.reads = p.mode === "volts" ? r.v : r.i
					break
				case "motor": {
					// its line: I(e) = a − b·e, e = k·ω (the caller drives the shaft with η·k·I along it)
					const line = this.broken.has(p.id) ? { a: 0, b: 0 } : lineOf(n, br, sol, main)
					this.lines.set(p.id, { a: finite(line.a), b: finite(line.b) })
					break
				}
				case "battery":
					if (-i > SHORT_A && !this.shorted.has(p.id)) {
						this.shorted.add(p.id)
						ev(p, "short", `is short-circuited (${(-i).toFixed(1)} A)`)
					}
					break
			}
			this.readings.set(p.id, r)
			// events: lights / goes out, sounds / stops, turns / stops, a switch closes / opens, a probe conducts / insulates; each said once its
			// new state has lasted EVENT_HOLD (a ball bouncing on a push switch closes it for 2 ms at a time: a click, not a ring), dated when it began
			if (p.kind === "bulb" || p.kind === "led") {
				if (r.broken) this.settle(p.id, false)
				else this.toggle(p, "lit", (r.light ?? 0) >= LIT, t, ["lights", "lights"], ["goes-out", "goes out"])
			} else if (p.kind === "buzzer") {
				this.toggle(p, "sound", (r.sound ?? 0) > 0, t, ["sounds", `sounds (${Math.round(p.pitch)} Hz)`], ["stops-sounding", "stops sounding"])
			} else if (p.kind === "motor") {
				// (turning: carrying current and turning its shaft at least half a turn a second)
				this.toggle(p, "turn", Math.abs(r.omega ?? 0) >= Math.PI && Math.abs(i) > 1e-4, t, ["turns", "starts turning"], ["stops", "stops"])
			} else if (p.kind === "switch") {
				const c = r.closed ?? false
				if (!this.shown.has(`${p.id}#closed`)) this.settle(p.id, c, "closed")
				this.toggle(p, "closed", c, t, ["closes", "closes"], ["opens", "opens"])
			} else if (p.kind === "probe") {
				const through = r.through
				const conducts = through !== undefined && Math.abs(i) > 1e-4
				const key = through ?? ""
				// (each test object laid across it is said once: it conducts, or it does not)
				if (through !== undefined && !this.judged.has(`${p.id}#${key}`)) {
					const since = this.bridgeSince.get(p.id)
					if (since === undefined || since.item !== through) this.bridgeSince.set(p.id, { item: through, t })
					else if (t - since.t >= EVENT_HOLD) {
						this.judged.add(`${p.id}#${key}`)
						const who = this.doc.names?.find((n) => n[0] === through)?.[1] ?? through
						this.events.push({ t: since.t, part: p.id, ...(p.item === undefined ? {} : { item: p.item }), kind: conducts ? "conducts" : "insulates",
							text: conducts ? `conducts through ${who}` : `does not conduct through ${who}` })
					}
				} else if (through === undefined) this.bridgeSince.delete(p.id)
			}
		})
		void h
	}

	/** A state as reported without saying it (a burnt-out bulb is out; a switch's state at the start). */
	private settle(id: string, state: boolean, channel = "lit") {
		this.shown.set(`${id}#${channel}`, state)
		this.pending.delete(`${id}#${channel}`)
	}

	/** A channel's state now: said (dated when it began) once it has lasted EVENT_HOLD. */
	private toggle(p: CircuitPart, channel: string, state: boolean, t: number, on: readonly [CircuitEvent["kind"], string], off: readonly [CircuitEvent["kind"], string]) {
		const key = `${p.id}#${channel}`
		const was = this.shown.get(key) ?? false
		if (state === was) {
			this.pending.delete(key)
			return
		}
		const since = this.pending.get(key)
		if (since === undefined) {
			this.pending.set(key, t)
			if (EVENT_HOLD > 0) return
		}
		const from = since ?? t
		if (t - from < EVENT_HOLD) return
		this.shown.set(key, state)
		this.pending.delete(key)
		const [kind, text] = state ? on : off
		this.events.push({ t: from, part: p.id, ...(p.item === undefined ? {} : { item: p.item }), kind, text })
	}

	/** Motor part `id`'s line for the coming step (undefined: no such motor). */
	line(id: string): Line | undefined {
		return this.lines.get(id)
	}

	/** Every part's reading now. */
	sample(): Map<string, Reading> {
		return this.readings
	}
}
