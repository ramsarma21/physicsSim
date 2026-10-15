// The catalog, digested for the AI steps: a compact text every planning prompt carries, and a structured index the validators
// (ai/schemas.mjs) check plans against. Built from web/sim's catalog() (the exact JS port of machines/items.py), else from the
// running server's GET /api/catalog, else from the last good digest on disk; cached in ai/.cache/ keyed by the web/sim files.
//
//   import { getCatalog } from "./catalog-digest.mjs"
//   const cat = await getCatalog()            // {fingerprint, source, index: {types, categories, ...}, text, brief, stats}
//   cat.text                                  // the full digest (every type: what it is, size, mass, anchor, outline, props with ranges)
//   cat.brief                                 // one line per type (for the refine step, with full detail only for the types in use)
//   detailFor(cat, ["superball", "plank"])    // full detail for just those types
//
// CLI: node ai/catalog-digest.mjs [--brief] [--stats] [--json] [--rebuild]
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = dirname(HERE)
const SIM = join(PG, "web", "sim")
const CACHE_DIR = process.env.AI_CACHE_DIR || join(HERE, ".cache")
const CACHE_FILE = join(CACHE_DIR, "catalog-digest.json")
const DIGEST_VERSION = 6 // bump when the digest's format or notes change (invalidates the cache)

/** Container types whose "in" goal the engine's summary can check (machines/items.py inside()). */
export const GOAL_CONTAINERS = ["box", "cup", "bucket", "basket"]
/** Prop keys every type has: the surface material and its tunable contact numbers. */
export const MATERIAL_KEYS = ["material", "bounce", "friction", "rolling", "side"]
/** The default stage and table (web/scenarios/empty.json). */
export const DEFAULT_STAGE = { x0: -0.559, x1: 3.191, y0: -0.156, y1: 2.344 }
export const DEFAULT_TABLE = { x: 1.3, width: 3.7, left: -0.55, right: 3.15 }

// ---------------------------------------------------------------- geometry of a type's preview
const r5 = (v) => Math.round(v * 1e5) / 1e5
const fmt = (v, d = 3) => {
	if (typeof v !== "number" || !Number.isFinite(v)) return String(v)
	if (v === 0) return "0"
	const a = Math.abs(v)
	let s
	if (a >= 1000) s = v.toFixed(0)
	else if (a >= 1) s = v.toFixed(Math.max(0, d - 1))
	else if (a >= 0.01) s = v.toFixed(d)
	else s = v.toPrecision(2)
	if (s.includes(".") && !s.includes("e")) s = s.replace(/0+$/, "").replace(/\.$/, "")
	return s
}
const signed = (v) => (Math.abs(v) < 5e-4 ? "+0" : (v >= 0 ? "+" : "−") + fmt(Math.abs(v)))
const sig3 = (v) => String(Number(v.toPrecision(3)))
const massText = (kg) => (kg >= 1 ? `${sig3(kg)} kg` : kg >= 0.001 ? `${sig3(kg * 1000)} g` : `${sig3(kg * 1e6)} mg`)

/** World pose [x, y, angle] of every solid, following parent chains (a part welded or hinged to a parent is given in its frame). */
function worldPoses(solids) {
	const by = new Map(solids.map((s) => [s.id, s]))
	const out = new Map()
	const pose = (s, depth = 0) => {
		if (out.has(s.id)) return out.get(s.id)
		let x = s.at.x
		let y = s.at.y
		let a = s.angle ?? 0
		const q = s.parent ? by.get(s.parent) : null
		if (q && depth < 10) {
			const [qx, qy, qa] = pose(q, depth + 1)
			;[x, y] = [qx + x * Math.cos(qa) - y * Math.sin(qa), qy + x * Math.sin(qa) + y * Math.cos(qa)]
			a += qa
		}
		const p = [x, y, a]
		out.set(s.id, p)
		return p
	}
	for (const s of solids) pose(s)
	return out
}

/** Axis-aligned bounds [x0, y0, x1, y1] of one solid at a pose. */
export function solidBounds(s, [x, y, a]) {
	const b = s.body
	if (b.kind === "ball") return [x - b.radius, y - b.radius, x + b.radius, y + b.radius]
	let pts
	if (b.kind === "polygon") pts = b.points.map((p) => [p.x, p.y])
	else {
		const hw = b.width / 2
		const hh = b.height / 2
		const hb = hw * (b.taper ?? 1)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	}
	const c = Math.cos(a)
	const n = Math.sin(a)
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
	for (const [px, py] of pts) {
		const wx = x + px * c - py * n
		const wy = y + px * n + py * c
		x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy)
	}
	return [x0, y0, x1, y1]
}

/** Bounds of a set of doc solids (world frame), or null. */
export function boundsOf(solids, poses = worldPoses(solids)) {
	let B = null
	for (const s of solids) {
		const p = poses.get(s.id)
		if (!p || !s.body) continue
		const [x0, y0, x1, y1] = solidBounds(s, p)
		if (![x0, y0, x1, y1].every(Number.isFinite)) continue
		B = B ? [Math.min(B[0], x0), Math.min(B[1], y0), Math.max(B[2], x1), Math.max(B[3], y1)] : [x0, y0, x1, y1]
	}
	return B
}
export { worldPoses }

/** Volume of a solid's body (m³), for an approximate mass. */
function volumeOf(b) {
	if (b.kind === "ball") {
		const r = b.radius
		if (b.wall) return (4 / 3) * Math.PI * (r ** 3 - Math.max(0, r - b.wall) ** 3)
		return (4 / 3) * Math.PI * r ** 3
	}
	if (b.kind === "slab") return b.width * ((1 + (b.taper ?? 1)) / 2) * b.height * (b.depth ?? 0.1)
	if (b.kind === "polygon") {
		let A = 0
		const P = b.points
		for (let i = 0; i < P.length; i++) {
			const p = P[i], q = P[(i + 1) % P.length]
			A += p.x * q.y - q.x * p.y
		}
		return (Math.abs(A) / 2) * (b.depth ?? 0.1)
	}
	return 0
}

// ---------------------------------------------------------------- loading the catalog
function simFingerprint() {
	const h = createHash("sha1")
	h.update(`v${DIGEST_VERSION}`)
	try {
		for (const f of readdirSync(SIM).sort()) {
			if (!f.endsWith(".js")) continue
			const st = statSync(join(SIM, f))
			h.update(`${f}:${st.size}:${st.mtimeMs}\n`)
		}
	} catch {
		h.update("no-sim")
	}
	h.update(readSafe(join(HERE, "catalog-digest.mjs")).length.toString())
	return h.digest("hex").slice(0, 16)
}
function readSafe(p) {
	try {
		return readFileSync(p, "utf8")
	} catch {
		return ""
	}
}

async function loadRawCatalog({ catalogUrl, timeoutMs = 8000 } = {}) {
	const errors = []
	try {
		const m = await import(pathToFileURL(join(SIM, "index.js")).href)
		const c = m.catalog()
		if (c && Array.isArray(c.types) && c.types.length) return { catalog: c, source: "web/sim" }
		errors.push("web/sim catalog() was empty")
	} catch (e) {
		errors.push(`web/sim: ${e?.message ?? e}`)
	}
	const url = catalogUrl || process.env.AI_CATALOG_URL || "http://127.0.0.1:8790/api/catalog"
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		if (r.ok) {
			const c = await r.json()
			if (c && Array.isArray(c.types) && c.types.length) return { catalog: c, source: "server" }
		}
		errors.push(`server: HTTP ${r.status}`)
	} catch (e) {
		errors.push(`server: ${e?.message ?? e}`)
	}
	const err = new Error(`no catalog: ${errors.join("; ")}`)
	err.code = "config"
	throw err
}

// ---------------------------------------------------------------- the structured index
const RELEASE_RE = /\brelease\b/i

function describeJoints(t) {
	const solids = t.preview?.solids ?? []
	const joints = t.preview?.joints ?? []
	const notes = []
	const kinds = new Set(joints.map((j) => j.kind))
	const pivots = solids.filter((s) => s.pivot)
	const motors = solids.filter((s) => s.motor).length + joints.filter((j) => j.motor).length
	if (pivots.length) notes.push(`${pivots.length > 1 ? pivots.length + " hinged parts" : "a hinged part"}`)
	if (kinds.has("spring")) notes.push("springs")
	if (kinds.has("rope")) notes.push(joints.some((j) => j.render?.style === "chain") ? "a chain" : "a rope")
	if (kinds.has("pin")) notes.push("pin joints")
	if (kinds.has("wheel")) notes.push("wheels on axles")
	if (kinds.has("pulley")) notes.push("a pulley")
	if (motors) notes.push("a motor")
	if (solids.some((s) => s.surfaceSpeed)) notes.push("a moving belt surface")
	if ((t.preview?.animated ?? []).some((a) => a.airflow)) notes.push("an air jet")
	return notes
}

function indexType(t, materials) {
	const solids = t.preview?.solids ?? []
	const poses = worldPoses(solids)
	const B = boundsOf(solids, poses)
	const kinds = new Set(solids.map((s) => s.kind))
	const props = {}
	for (const p of t.props) {
		const spec = { kind: p.kind, label: p.label, default: p.default }
		if (p.unit) spec.unit = p.unit
		if (p.min !== undefined) spec.min = p.min
		if (p.max !== undefined) spec.max = p.max
		if (p.choices) spec.choices = p.choices
		if (p.auto) spec.auto = p.auto
		if (p.help) spec.help = p.help
		props[p.key] = spec
	}
	// mass at the defaults: the type's own mass-like prop if it has one, else density x volume of its moving parts
	let mass = null
	let massNote = ""
	if (t.dynamic) {
		const own = ["mass", "body_mass", "bob_mass", "weight"].find((k) => typeof t.defaults?.[k] === "number" || typeof props[k]?.default === "number")
		if (own) {
			mass = t.defaults?.[own] ?? props[own].default
			massNote = own === "mass" ? "" : ` (${own})`
		} else {
			let m = 0
			for (const s of solids) {
				if (s.kind !== "dynamic") continue
				const base = String(s.material ?? "").replace(/\s*\[[0-9a-f]+\]$/, "")
				const dens = materials?.[base]?.density
				if (dens) m += dens * volumeOf(s.body)
			}
			if (m > 0) mass = m
		}
	}
	const dyn = solids.filter((s) => s.kind === "dynamic")
	const container = t.category === "Containers"
	const joints = t.preview?.joints ?? []
	const pinned = dyn.some((s) => s.pivot && !s.parent) || joints.some((j) => j.a === null || j.b === null || j.chassis === null)
	const out = {
		key: t.key,
		name: t.name,
		category: t.category,
		dynamic: !!t.dynamic,
		mixed: kinds.has("static") && kinds.has("dynamic"),
		pinned,
		anchor: t.anchor,
		description: t.description,
		facts: t.facts || "",
		tags: t.tags ?? [],
		props,
		outline: B ? { x0: r5(B[0]), y0: r5(B[1]), x1: r5(B[2]), y1: r5(B[3]) } : null,
		mass: mass != null ? r5(mass) : null,
		massNote,
		joints: describeJoints(t),
		container,
		goalContainer: GOAL_CONTAINERS.includes(t.key),
		usesRelease: RELEASE_RE.test(t.description) || ["spring-launcher", "spring-catapult", "pinball-flipper"].includes(t.key),
		parts: solids.length,
		movingParts: dyn.length,
		note: TYPE_NOTES[t.key] ?? ""
	}
	if (t.preview?.error) out.previewError = t.preview.error
	return out
}

// ---------------------------------------------------------------- the text
/** Planner notes that the catalog's own fields do not say outright (each checked against the type's preview build: which way it faces,
 *  what a sign means). Keep them short; a type missing here simply has none. */
const TYPE_NOTES = {
	box: "hung (default on) draws the two cords it hangs from, up out of the picture: set hung false for a box standing on a surface.",
	seesaw: "The plank's left end is raised (tilt) and its right end rests low, with a lip that holds a ball there: drop or roll something onto the raised left end and the ball on the right end is flung up.",
	lever: "tilt is the plank's starting angle (positive raises its right end); pivot_offset moves the fulcrum along the plank.",
	"domino-row": "The first, smallest domino stands at the anchor; the row runs to the right, each domino growth× the last. Push the first one rightwards to start the wave.",
	domino: "Stands upright on its base; tip it with something moving to the right (or left).",
	staircase: "The steps climb to the right from the anchor's left end.",
	wedge: "Its upright back is on the RIGHT and its slope runs down to the LEFT: a ball let go on it rolls off to the left. It cannot be mirrored (turning it 180° stands it on its point): for a ramp that runs down to the right, lean a plank.",
	funnel: "The anchor is the middle of its mouth (top); the funnel hangs below it: place it in the air (y_m = the mouth's height) and stand it on two posts, one under each side of its rim (wooden-block items with fixed true, height = the rim's height, on the table just outside the cone), so it does not float.",
	"peg-board": "Hangs below its anchor (the middle of the top row): place it in the air.",
	pendulum: "start_angle: degrees from hanging straight down, positive = pulled out to the right, negative = to the left; it swings from t = 0 (held: true keeps it still until the release).",
	"hinged-gate": "start_angle as for a pendulum (0 = hanging straight down).",
	"spring-gate": "start_angle as for a pendulum (0 = hanging straight down).",
	"rope-pendulum": "start_angle as for a pendulum (0 = hanging straight down).",
	"wrecking-ball": "start_angle as for a pendulum: the default −60 pulls the ball out to the LEFT, so it swings right into whatever stands below the hook.",
	swing: "start_angle as for a pendulum (default −30: pulled out to the left).",
	"newtons-cradle": "start_angle pulls the first (left) ball out (negative = to the left); the frame stands on the surface below.",
	fan: "At angle 0 it faces right and blows along +x (its body is to the left of the anchor); turn it with the item's angle.",
	"conveyor-belt": "Positive speed carries things to the right, negative to the left. The anchor is the middle of its top surface.",
	"motor-car": "Drives to the right; turn it with angle 180 to drive left (it is then upside down), or put it where right is the way to go.",
	"spring-catapult": "Put the ball on the arm's long left end; at the release it is flung up and to the right.",
	"spring-launcher": "Put the thing to launch on its plate; at the release it is flung straight up (along the item's own up when tilted).",
	"pinball-flipper": "The flipper points right from its hinge, resting at rest_angle; at the release it swings counter-clockwise through sweep, flicking up whatever rests on it.",
	"spring-bumper": "Mounted on a wall at its left; the plate faces right.",
	"motor-spinner": "Turns on a gear motor's shaft at its middle (a fixed hub, drawn on a stand behind it) and is driven: positive rpm turns counter-clockwise.",
	"atwood-machine": "The pulley is fixed at the anchor; the two weights hang below it.",
	"pulley-lift": "The pulley is fixed at the anchor; the weight and the pail hang below it; things put in the pail ride up.",
	"hanging-spring": "Hangs below its anchor (the top of the spring).",
	"hanging-chain": "Two fixed posts at the anchor's height, span apart; the chain sags between them.",
	trampoline: "Stands on the surface below it (the anchor is the floor under its middle); drop things onto the mat from above.",
	"bounce-pad": "Stands on its base; things that land on its plate are pushed back up.",
	wall: "A fixed upright wall standing on its base. Put invisible_in_3d walls at the table's ends to keep balls on the table without being seen.",
	table: "Already in every scene with id \"table\": never add one. Its top is y = 0."
}

/** How a type looks in the 3D view (its colour and kind), so a picture's thing is matched to the type that looks like it and a difference is
 *  reported instead of made silently. Checked against catalog.looks (fill colours), the solids' own colours and patterns, and web/models. */
const LOOK_NOTES = {
	superball: "solid red rubber",
	"plastic-ball": "plain yellow plastic",
	"clay-ball": "green modelling clay",
	"ping-pong-ball": "white table-tennis ball",
	"tennis-ball": "yellow-green felt with the white seam",
	"golf-ball": "white and dimpled",
	baseball: "off-white leather with stitched seams",
	basketball: "orange with black lines",
	"soccer-ball": "white with black patches",
	"bowling-ball": "dark, nearly black",
	"glass-marble": "blue glass",
	"steel-ball": "polished silver steel",
	"beach-ball": "a striped inflatable beach ball",
	"wooden-ball": "dark brown turned wood (not painted)",
	"billiard-ball": "a pool ball whose colour follows its number (0 = the white cue ball, 8 black, 9-15 striped)",
	"wooden-block": "natural light varnished wood",
	brick: "red-brown clay brick",
	"foam-block": "yellow foam",
	"ice-cube": "clear pale-blue ice",
	"cardboard-box": "a closed brown cardboard box",
	domino: "light wood with dark pips",
	"domino-row": "light wood dominoes with dark pips",
	"hardcover-book": "a dark red hardcover",
	"paperback-book": "a dark blue paperback (a night-sky cover picture, a dark blue spine, cream page edges)",
	cup: "a tapered paper cup (its other materials, aluminium, glass or wood, change its look)",
	bucket: "a grey metal pail",
	basket: "woven wicker, always (its material only changes the wicker's colour): never report wicker as missing",
	box: "an open varnished wooden box",
	"plastic-cup": "a red plastic party cup",
	"glass-jar": "a clear glass jar",
	"soda-can": "a red aluminium can",
	"coffee-mug": "an off-white ceramic mug",
	plank: "varnished natural wood, standing on wooden legs down to the table while legs is on (legs false: a bare board)",
	wedge: "natural varnished wood",
	"cutting-board": "a natural wooden chopping board",
	"wrecking-ball": "a dark steel ball on a chain from a yellow crane-jib hanger; the view stands the hanger on its own stand (a steel rod on a heavy foot, with an arm), which is part of this item",
	pendulum: "a steel bob on a light wooden rod from a wooden hanger, which the view stands on its own retort stand (part of this item)",
	"rope-pendulum": "a steel bob on a rope from a wooden hanger, which the view stands on its own retort stand (part of this item)",
	"toy-car": "a small plastic toy car on black rubber wheels",
	trampoline: "a black mat in a steel frame on legs"
}

/** One line for every catalog (and the refine step's "types in this scene"): how an item's own surface props meet another's. Checked
 *  against web/sim/materials.js contact(). */
export const SURFACE_NOTE = `Every type also has the surface props material, bounce 0…1, friction 0…2, rolling 0…0.5, side 0…1, even where its list below leaves them out. Where two things touch, the engine uses the measured value for their two materials when it has one, scaled by how far each item's own friction is from its material's: pair friction = measured × √(fa/fa₀ × fb/fb₀) (no measured pair: √(fa × fb)); so halving ONE item's friction lowers the pair's by only about 30 %: quarter it, or halve both, to halve the pair. Bounce: measured × (ba/ba₀)(bb/bb₀), else ba × bb. A thing on a slope slides when tan(angle) > the pair's friction; the run's events, not the props, say what really happened.`

const CATEGORY_NOTES = {
	Containers: "Open-topped and fixed in place (static): put things in them with place.inside. Only box, cup, bucket and basket can be goal containers. One above the table stands ON a support item (a fixed wooden-block post, bricks, books, a box, a plank shelf on legs), never on \"air\"; only a box may hang (hung).",
	"Surfaces & ramps": "Static: fixed in place, they never move. Put them anywhere, at any height and angle (place.on \"air\" with y_m, or place.lean); wooden legs are drawn down to the floor while `legs` is on (keep them on for anything in the air: without them it floats).",
	Scenery: "The table is already in every scene (id \"table\"): never add another. Walls are fixed; `invisible_in_3d` makes a safety wall that keeps things on the table without being seen.",
	Balls: "Dynamic. A ball's mass follows its diameter (and hollow/wall) unless you set mass.",
	"Wheels & vehicles": "Dynamic. Anchor = the ground under the middle (where the wheels touch): placed on a surface they stand on their wheels.",
	"Springs & ropes": "Most hang from a fixed top point (anchor at the top): they need room below the anchor. The view stands each fixed top point on its own support (a retort stand behind the machine, or a wall bracket above 1.3 m): the stand is part of the item, never a separate object.",
	"Rods & hinges": "Hinged items pivot on a fixed hanger or fulcrum (drawn on its own retort stand, part of the item); loose rods are dynamic.",
	Groups: "Several parts built as one item.",
	"Motors & belts": "Driven: they move by themselves from the start (a flipper at the scene's release).",
	Air: "The fan blows along its angle (turn it with the item's angle) and pushes light things such as a beach ball or a ping-pong ball.",
	Dominoes: "Dynamic; stand upright on their base.",
	"Blocks & shapes": "Dynamic solid blocks; anchor at the centre.",
	"Everyday objects": "Dynamic real-world objects at their true sizes and weights; anchor at the centre unless stated."
}

function propText(key, p, own) {
	const unit = p.unit && !/^(of |heights|×)/.test(p.unit) ? ` ${p.unit}` : p.unit ? ` (${p.unit})` : ""
	if (p.kind === "bool") return `${key}: bool =${p.default}`
	if (p.kind === "choice") return `${key}: ${p.choices.map((c) => (c === p.default ? `*${c}*` : c)).join(" | ")}`
	const follows = Array.isArray(p.auto) ? p.auto.filter((k) => !own || own.includes(k)) : null
	const auto = p.auto ? ` auto (follows ${follows?.length ? follows.join(", ") : "the other props"} unless set)` : ""
	const range = p.min !== undefined || p.max !== undefined ? ` [${fmt(p.min)}…${fmt(p.max)}]` : ""
	return `${key}:${p.kind === "int" ? " int" : ""}${unit} =${fmt(p.default, 4)}${range}${auto}`
}

function typeDetail(T) {
	const lines = []
	const kind = T.dynamic ? (T.mixed || T.pinned ? "dynamic, on a fixed frame or pivot (it does not fall)" : "dynamic") : "static (fixed in place)"
	lines.push(`### ${T.key} — ${T.name} · ${kind}`)
	let what = T.description || `${T.name}.`
	if (T.facts) what += ` Facts: ${T.facts}.`
	if (T.mass != null && !/\d\s*k?g\b/.test(T.facts)) what += ` Moving parts ≈${massText(T.mass)}${T.massNote}.`
	lines.push(what)
	if (T.outline) {
		const o = T.outline
		const w = o.x1 - o.x0
		const h = o.y1 - o.y0
		const centred = Math.abs(o.x0 + o.x1) < 1e-4 && Math.abs(o.y0 + o.y1) < 1e-4
		lines.push(`Anchor (x, y): ${T.anchor}. Outline at defaults: ${fmt(w)} × ${fmt(h)} m${centred ? ", centred on the anchor" : `; from the anchor x ${signed(o.x0)}…${signed(o.x1)}, y ${signed(o.y0)}…${signed(o.y1)}`}.`)
	} else lines.push(`Anchor (x, y): ${T.anchor}.`)
	const own = Object.entries(T.props).filter(([k]) => !MATERIAL_KEYS.includes(k))
	const keys = Object.keys(T.props)
	if (own.length) lines.push(`Props: ${own.map(([k, p]) => propText(k, p, keys)).join("; ")}.`)
	if (T.note) lines.push(T.note)
	if (LOOK_NOTES[T.key]) lines.push(`Looks: ${LOOK_NOTES[T.key]}.`)
	const m = T.props.material
	if (m) {
		const mat = m.choices.length > 1 ? `material ${m.choices.map((c) => (c === m.default ? `*${c}*` : c)).join(" | ")}` : `material ${m.default}`
		const pick = (k) => (T.props[k] ? fmt(T.props[k].default) : "?")
		lines.push(`Surface: ${mat}; bounce ${pick("bounce")}, friction ${pick("friction")}, rolling ${pick("rolling")}, side ${pick("side")}.`)
	}
	const notes = []
	if (T.joints.length) notes.push(`has ${T.joints.join(", ")}`)
	if (T.goalContainer) notes.push("goal container (\"in\" goals work)")
	else if (T.container) notes.push("container, but NOT usable as a goal container")
	if (T.usesRelease) notes.push("acts at the scene's release time")
	if (T.tags.length) notes.push(`also called: ${T.tags.slice(0, 10).join(", ")}`)
	if (notes.length) lines.push(`Notes: ${notes.join("; ")}.`)
	return lines.join("\n")
}

function briefLine(T) {
	const o = T.outline
	const size = o ? `${fmt(o.x1 - o.x0)}×${fmt(o.y1 - o.y0)} m` : ""
	const mass = T.mass != null ? massText(T.mass) : ""
	return `- ${T.key} (${T.name}; ${T.dynamic ? "dyn" : "static"}${size ? "; " + size : ""}${mass ? "; " + mass : ""}): ${(T.description || T.name).split(/(?<=[.:])\s/)[0].slice(0, 110)}`
}

const HEADER = `# The catalog: the ONLY things that can be in a scene
Every item has: id, type (one of the keys below), props (only the keys listed for its type, inside their ranges; leave a prop out to keep its default), held, fixed.
Units: metres, kilograms, seconds, degrees (counter-clockwise), m/s. "*x*" marks a choice's default; "=v" a prop's default; "[a…b]" its allowed range.
Outline = the item's box at its default props and angle 0, relative to its anchor (x right, y up): use it to know how tall/wide a thing is and where its bottom is (an item resting on a surface at height h has its anchor at y = h − outline.y0 … i.e. h + |y0|).
Static = fixed in place (it never moves; it can be placed in mid-air, but must visibly stand on or hang from something: its legs, its cords, or a support item). Dynamic = falls and moves (set "fixed": true to pin it, "held": true to hold it until the scene's release time).
How the view draws what holds things up: a held item rests on a small wooden pull pin on a thin wooden post behind the machine until the release (so in a picture, a thin post or pin holding a ball or weight at its top IS that held state: build the thing with held true; the post is neither an item nor missing); a fixed top point or pivot (a pendulum's or a wrecking ball's hanger) stands on its own retort stand (a steel rod on a heavy foot, with an arm) or a wall bracket, which is part of that item; a plank stands on wooden legs while its legs prop is on. "Looks:" says each type's colour and kind, where it matters for matching a picture.
${SURFACE_NOTE} (material: a choice, its default shown; rolling = rolling resistance; side = the sideways spring-back of grippy balls.) Change them only when the request asks for a surface behaviour, or to make a run work without changing how a thing looks.`

function buildText(index) {
	const parts = [HEADER]
	for (const cat of index.categories) {
		const types = Object.values(index.types).filter((T) => T.category === cat)
		if (!types.length) continue
		parts.push(`\n## ${cat} (${types.length})${CATEGORY_NOTES[cat] ? "\n" + CATEGORY_NOTES[cat] : ""}`)
		for (const T of types) parts.push(typeDetail(T))
	}
	return parts.join("\n")
}

function buildBrief(index) {
	const parts = ["# Catalog (one line per type; key (name; static|dyn; size; mass): what it is)"]
	for (const cat of index.categories) {
		const types = Object.values(index.types).filter((T) => T.category === cat)
		if (!types.length) continue
		parts.push(`## ${cat}`)
		for (const T of types) parts.push(briefLine(T))
	}
	return parts.join("\n")
}

/** Full detail (as in the digest) for just these type keys (unknown keys are skipped). */
export function detailFor(cat, keys) {
	const seen = new Set()
	const out = []
	for (const k of keys) {
		if (seen.has(k) || !cat.index.types[k]) continue
		seen.add(k)
		out.push(typeDetail(cat.index.types[k]))
	}
	return out.join("\n")
}

/** Token counts for this kind of text, from the gateway's usage on 2026-10-15: the full digest (71.9k characters) was 34.6k prompt
 *  tokens for Claude Opus 5.5 (2.08 characters a token) and 24.4k for GPT-6.1 (2.95); the brief one 5.5k and 3.8k. */
export const estimateTokens = (s, family = "claude") => Math.ceil(s.length / (family === "openai" ? 2.95 : 2.08))

export function digestFromCatalog(raw, { source = "given", fingerprint = "given" } = {}) {
	const categories = [...(raw.categories ?? [])]
	for (const t of raw.types) if (!categories.includes(t.category)) categories.push(t.category)
	const types = {}
	for (const t of raw.types) types[t.key] = indexType(t, raw.materials)
	const index = { categories, types, materials: Object.keys(raw.materials ?? {}), count: raw.types.length }
	const text = buildText(index)
	const brief = buildBrief(index)
	return {
		version: DIGEST_VERSION,
		fingerprint,
		source,
		builtAt: new Date().toISOString(),
		index,
		text,
		brief,
		stats: {
			types: raw.types.length,
			chars: text.length,
			tokens: estimateTokens(text),
			tokensOpenAI: estimateTokens(text, "openai"),
			briefChars: brief.length,
			briefTokens: estimateTokens(brief),
			briefTokensOpenAI: estimateTokens(brief, "openai")
		}
	}
}

// ---------------------------------------------------------------- the cache
let memo = null

/** The digest: from memory, else the disk cache (when web/sim is unchanged), else built anew (and cached). */
export async function getCatalog({ rebuild = false, catalogUrl } = {}) {
	const fp = simFingerprint()
	if (!rebuild && memo && memo.fingerprint === fp) return memo
	if (!rebuild) {
		try {
			const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"))
			if (c.version === DIGEST_VERSION && c.fingerprint === fp && c.index?.types) return (memo = c)
		} catch {}
	}
	let raw
	try {
		raw = await loadRawCatalog({ catalogUrl })
	} catch (e) {
		// web/sim is mid-edit and the server is not answering: the last good digest is better than nothing
		try {
			const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"))
			if (c.version === DIGEST_VERSION && c.index?.types) return (memo = { ...c, stale: true })
		} catch {}
		throw e
	}
	const d = digestFromCatalog(raw.catalog, { source: raw.source, fingerprint: fp })
	try {
		mkdirSync(CACHE_DIR, { recursive: true })
		const tmp = `${CACHE_FILE}.${process.pid}.tmp`
		writeFileSync(tmp, JSON.stringify(d))
		renameSync(tmp, CACHE_FILE)
	} catch {} // a read-only file system (a serverless function): the memo still serves this process
	return (memo = d)
}

export function _resetMemo() {
	memo = null
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = new Set(process.argv.slice(2))
	const d = await getCatalog({ rebuild: args.has("--rebuild") })
	if (args.has("--json")) process.stdout.write(JSON.stringify(d.index, null, 1) + "\n")
	else if (args.has("--stats")) process.stdout.write(JSON.stringify({ source: d.source, fingerprint: d.fingerprint, ...d.stats }, null, 1) + "\n")
	else process.stdout.write((args.has("--brief") ? d.brief : d.text) + "\n")
}
