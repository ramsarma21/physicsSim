// The staging module's port (machines/mod_staging.py, line for line: the same documents, the same errors) and its plug-ins for the AI.
// Render only: a fixed side camera (settings.camera -> doc.view.camera) and starting gates (start_gate -> doc.view.gates); see the Python file.
// A module file takes everything from the framework object register_all gets (web/sim/items.js FRAMEWORK), so it imports nothing.
let F = null
let py = null
let TYPES = null

const CAMERA_DEFAULTS = { y: 0.3, pitch: 6.843, hfov: 69.39 }
const CAMERA_LIMITS = { x0: [-1000.0, 1000.0], x1: [-1000.0, 1000.0], y: [-10.0, 100.0], pitch: [-20.0, 80.0], hfov: [5.0, 120.0] }
const CAMERA_KEYS = ["x0", "x1", "y", "pitch", "hfov"]
const CAMERA_RANGE_TEXT = { x0: "-1000 to 1000", x1: "-1000 to 1000", y: "-10 to 100", pitch: "-20 to 80", hfov: "5 to 120" }
const SPAN = [0.1, 300.0]
const GATE_CATEGORIES = ["Balls", "Wheels & vehicles", "Blocks & shapes"]

const has = (o, k) => o !== null && typeof o === "object" && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, k)
const isDict = (o) => o !== null && typeof o === "object" && !Array.isArray(o)

export function register_all(f) {
	F = f
	py = f.py
	TYPES = f.TYPES
	f.register_common_prop(
		new f.Prop("start_gate", "Starting gate", false, { kind: "bool", help: "While it is held: a starting gate holds it (a bar that lifts away at the release) instead of the pull pin" }),
		(t) => !!t.dynamic && GATE_CATEGORIES.includes(t.category)
	)
	f.register_build_hook(_staging)
}

/** settings.camera checked: {x0, x1, y, pitch, hfov} as floats (the defaults where it says nothing); ValueError for one the view cannot use. */
export function camera_of(raw) {
	if (!isDict(raw)) throw new py.ValueError("settings.camera must be an object {x0, x1, y, pitch, hfov}")
	for (const k of Object.keys(raw)) if (!CAMERA_KEYS.includes(k)) throw new py.ValueError(`settings.camera has no ${py.pyRepr(py.pySlice(k, 20))} (it takes x0, x1, y, pitch, hfov)`)
	const out = {}
	for (const k of CAMERA_KEYS) {
		const v = has(raw, k) ? raw[k] : null
		if (v === null || v === undefined) {
			if (k === "x0" || k === "x1") throw new py.ValueError("settings.camera needs x0 and x1 (m: what the picture spans, left to right)")
			out[k] = CAMERA_DEFAULTS[k]
			continue
		}
		const [lo, hi] = CAMERA_LIMITS[k]
		if (typeof v !== "number" || !Number.isFinite(v) || !(lo <= v && v <= hi)) throw new py.ValueError(`settings.camera.${k} must be a number from ${CAMERA_RANGE_TEXT[k]}`)
		out[k] = py.toFloat(v)
	}
	if (!(SPAN[0] <= out.x1 - out.x0 && out.x1 - out.x0 <= SPAN[1])) throw new py.ValueError("settings.camera needs x1 - x0 from 0.1 to 300 m")
	return out
}

function _staging(sb, scene) {
	const view = {}
	const st = has(scene, "settings") ? scene.settings : null
	if (isDict(st) && has(st, "camera") && st.camera !== null && st.camera !== undefined) view.camera = camera_of(st.camera)
	const gates = []
	for (const item of scene.items ?? []) {
		if (isDict(item) && has(TYPES, item.type) && isDict(item.props) && item.props.start_gate === true) gates.push(item.id)
	}
	if (gates.length) view.gates = gates
	if (Object.keys(view).length) sb.view = view
}

export const plugin = {
	title: "Filming (fixed camera, starting gates)",
	howto:
		"Render only (the physics is untouched). settings.camera = {x0, x1, y, pitch?, hfov?} fixes the side camera: the machine plane spans x0…x1 m across the picture at height y m (the picture's centre line), looking down pitch° (default 6.843, the Wide shot's) through a lens of hfov° across (default 69.39, the Wide shot's 26 mm; 10-25 for a long track seen almost flat, so its metre marks are evenly spaced). Every run with the same camera is filmed from the same place: lanes run apart (one per run) line up pixel for pixel when stacked. Without it the Wide shot frames each run by itself (and never wider than x -1.5…4.5 m). " +
		"start_gate: true on a HELD ball, toy vehicle or block (held: true, and the scene's release time) draws a starting gate instead of the pull pin: a dark bar on a post behind the track whose stop touches the item's front (its downhill side) and lifts away at the release; the item still starts exactly at rest at the release.",
	prompt: {
		plan: "A ball or car that waits at the top of a ramp until the release: held: true and props.start_gate: true (a visible starting gate, not a pin). A long track (over 5 m) or lanes that must line up: settings.camera {x0, x1, y} spanning the track.",
		edit: "props.start_gate (bool) puts a starting gate in front of a held ball or car; settings.camera {x0, x1, y, pitch, hfov} fixes the camera (set_scene)."
	},
	words: {
		change(type, key, a, b, nameOf) {
			void type
			void nameOf
			if (key !== "start_gate") return null
			return b === true ? "starting gate on (it lifts at the release)" : a === true ? "starting gate off (the pull pin holds it)" : null
		}
	}
}
