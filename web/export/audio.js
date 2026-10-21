// Impact sounds for the MP4 export: every impact in the engine's log becomes a short sound made from the two bodies' materials, sizes and
// masses, mixed in stereo, with a small room and a limiter. Plain ES module.
//
//   synthesizeImpacts(impacts, doc, {duration, sampleRate?, track?, stage?, panAt?, room?, gain?, normalize?}) → Promise<AudioBuffer>   (needs OfflineAudioContext)
//   renderImpacts(impacts, doc, {duration, sampleRate?, track?, stage?, panAt?, gain?}) → {left, right, sampleRate, events}  (pure: no Web Audio)
//
// impacts: track.impacts ([{t, a, b (solid ids), speed}]); doc: sim.doc (solids, materials); track (sim.track): where each impact is, for the pan
// (without it the solids' starting places are used); panAt(t, x, y) → −1 … 1: where the machine-plane point (x, y) m shows across the picture at
// run time t (the export's own camera: view.exportProject), so a hit is heard where it is seen (null or not a number: the stage's fallback below);
// stage: {x0, x1} (scene.stage; else read from doc.camera): the fallback pan, by where the hit is across the stage; duration: seconds of sound
// (the run's length); room: 0…1, how much of the small room is heard (default 0.22; 0 = dry); gain: an extra factor (default 1);
// normalize: true (default) sets the level by loudness (see "the mix" below); false keeps the fixed calibration (still limited). The buffer
// carries `info` {events, dryPeak, level, room, loudness: {target, before, loudest (LUFS), truePeak (dBTP), limited (dB)}}.
// The same input gives the same samples every time (the little variations are seeded by the impact's index).
//
// The model (physically motivated, tuned to sound right rather than measured; materials from the solid's engine material, else its look):
//  - Each body is a set of vibration modes from its shape, size and material. A slab or polygon rings like a free bar along its longest side
//    (f₁ = 1.03·h·√(E/ρ)/L², overtones 2.76, 5.40, 8.93 … × f₁), and a plate (wider than twice its thickness) also has its modes across and
//    mixed ones, as many per hertz as its area and thickness give (n = √3·S/(h·c_L)), up to 12 kHz, at places fixed by its id (the same part
//    sounds the same at every hit): a wooden box wall knocks near 1 kHz, a plank near 250–1300 Hz, a domino ticks at 7 kHz. A rod (a
//    cylinder) rings like a cantilever when it is fixed (a steel peg: 1.1 kHz). A solid ball has its own spheroidal modes (f = 0.42·c_s/r:
//    a superball's or a golf ball's 3 kHz tock; a steel or glass ball's are ultrasonic, so it only clicks), a hollow ball the ring of the air
//    inside (f = 113.6/r Hz: a basketball's ping near 940 Hz, a ping-pong ball's 5.7 kHz pock). Each mode decays at π·f·tanφ (the material's
//    loss factor; a static, mounted part 3× faster and never longer than ~0.5 s), so wood knocks, steel and glass ring, rubber and clay thud.
//  - How bright a hit is comes from the contact time τ (Hertz: τ = 2.87·(m²/(R·E*²·v))^⅕ from the reduced mass, the radius of the ball (1 cm
//    for an edge on a face) and the two contact stiffnesses): steel on steel ~0.2 ms (a sharp click), a superball ~1 ms, a basketball ~9 ms,
//    foam ~15 ms (almost silent). Mode amplitudes follow the contact pulse's spectrum and how well a body of that size radiates at that
//    frequency (pressure ∝ √((ka)²/(1+(ka)²)), and for a plate or bar also √(1/(1+(f_c/f)²)) below its coincidence frequency
//    f_c = c²/(1.8·h·c_L): a plank's low modes are felt more than heard, thin cardboard barely sounds); a body rings in proportion to (lighter mass / its mass)^0.3 (a big plate's mass near the
//    hit: within half a bending wavelength), so a ping-pong ball hardly sounds a plank and a bowling ball booms it.
//  - The click of the contact itself (the radiated pressure of the force pulse: d/dt sin^1.5, from 0, so no step) plus a little filtered noise.
//  - Loudness: amplitude ∝ v^0.8 (the level in dB goes with log speed) × the reduced mass (≈ the lighter body's) ^0.3; ±10 % per hit.
//    Pan: equal-power, by where the moving body shows in the picture (panAt; else where it is across the stage), at most 80 % to a side.
//  - Mix: a 60 Hz high-pass (no rumble to eat the headroom), a small room (a short deterministic stereo reverb through a ConvolverNode; the dry
//    sound is untouched, so onsets stay sample-exact), then the level set by loudness (ITU-R BS.1770): the loudest 400 ms of the run
//    ("momentary loudness", K-weighted) at −18 LUFS, raised by at most 30 dB, and a look-ahead true-peak limiter (peaks found 4× oversampled,
//    ceiling −2 dBTP, applied without delaying anything) that takes at most 6 dB off any peak, so the file decodes under −1 dBTP after AAC.
//    A scene whose loudest moment is a sharp click (steel on steel) ends below −18 LUFS: its 400 ms hold little energy for its peak, and
//    limiting a click harder would flatten it (measured on the Newton's cradle: 10 dB more limiting would raise its loudest moment by 0.5 LU).
//  - Not modelled: rolling and sliding noise (the engine reports impacts, not contacts; a guessed rumble would add hiss, not realism),
//    breaking, and air (a fan's whoosh).
import { placementsAt } from "../track.js"
import { addTones } from "./tones.js"

const TAU = Math.PI * 2
const TARGET_LUFS = -18 // the loudest 400 ms of every sound track (BS.1770 momentary loudness); see synthesizeImpacts
const MAX_BOOST_DB = 30 // the most the level is raised to get there
const TP_CEILING = 10 ** (-2 / 20) // −2 dBTP: the limiter's true-peak ceiling, leaving room for the AAC encoder's overshoot (measured: up to 0.8 dB on a click), so the file decodes under −1 dBTP
const MAX_LIMIT_DB = 6 // the most the limiter may take off any peak (more flattens a click); the level stops rising there
const LIMIT_RELEASE = 0.05 // s: how fast the limiter lets go after a peak (a click's ring and the room after it keep their level)
const C_AIR = 343
const NU = 0.3

// ---------- materials ----------

// Ec: contact stiffness (Pa: Hertz; for pressurised or hollow balls the effective value that gives their measured contact time), Eb: bending
// stiffness for the vibration modes (Pa; null = no bar or sphere modes), tan: loss factor, cav: [amplitude, loss factor] of a hollow ball's air
// ring, click: how much of the contact click and noise is heard, ring: how strongly its modes sound.
const CLASSES = {
	wood: { Ec: 1.2e9, Eb: 1.2e10, tan: 0.022, click: 1, ring: 1 }, // knock: 400–1600 Hz on planks and boxes, fast decay
	cork: { Ec: 2e7, Eb: 3e7, tan: 0.12, click: 0.5, ring: 0.5 },
	steel: { Ec: 2e11, Eb: 2e11, tan: 0.0006, click: 1, ring: 1 }, // ring: inharmonic, long
	aluminium: { Ec: 7e10, Eb: 7e10, tan: 0.0012, click: 1, ring: 0.9 },
	can: { Ec: 7e10, Eb: 7e10, tan: 0.006, click: 0.9, ring: 0.8 }, // a thin can: tinny, shorter
	coin: { Ec: 1.4e11, Eb: 1.4e11, tan: 0.0008, click: 1, ring: 1 },
	glass: { Ec: 7e10, Eb: 7e10, tan: 0.0015, click: 1, ring: 1 }, // clink
	ice: { Ec: 9e9, Eb: 9e9, tan: 0.008, click: 0.9, ring: 0.7 },
	ceramic: { Ec: 7e10, Eb: 7e10, tan: 0.0025, click: 1, ring: 0.9 },
	eggshell: { Ec: 2e9, Eb: 2e9, tan: 0.02, click: 0.8, ring: 0.5 },
	brick: { Ec: 1.5e10, Eb: 1.5e10, tan: 0.015, click: 0.9, ring: 0.6 },
	concrete: { Ec: 3e10, Eb: 3e10, tan: 0.015, click: 0.9, ring: 0.5 },
	phenolic: { Ec: 7e9, Eb: 7e9, tan: 0.006, click: 1.1, ring: 0.8 }, // billiard clack
	plastic: { Ec: 2.3e9, Eb: 2.3e9, tan: 0.02, click: 0.8, ring: 0.7, cav: [0.45, 0.012] }, // tick
	celluloid: { Ec: 4e6, Eb: 2e9, tan: 0.02, click: 0.7, ring: 0.6, cav: [0.6, 0.013] }, // ping-pong pock
	golf: { Ec: 3e8, Eb: 1e8, tan: 0.03, click: 0.9, ring: 0.7 },
	bowling: { Ec: 3e9, Eb: 3e9, tan: 0.012, click: 0.9, ring: 0.8 },
	baseball: { Ec: 1e8, Eb: 1e8, tan: 0.06, click: 0.7, ring: 0.5 },
	rubber: { Ec: 1e8, Eb: 1e8, tan: 0.08, click: 0.6, ring: 0.5 }, // a hard rubber superball
	softRubber: { Ec: 1e7, Eb: 1e7, tan: 0.15, click: 0.35, ring: 0.3 }, // mats, tyres, belts, trampoline
	ballLeather: { Ec: 1.5e6, Eb: null, tan: 0.04, click: 0.4, ring: 0.6, cav: [0.8, 0.0067] }, // basketball ring
	ballSynthetic: { Ec: 1.5e6, Eb: null, tan: 0.04, click: 0.4, ring: 0.5, cav: [0.5, 0.011] }, // football thump
	felt: { Ec: 2e6, Eb: null, tan: 0.1, click: 0.35, ring: 0.4, cav: [0.3, 0.016] }, // tennis: damped pock
	pvc: { Ec: 2e5, Eb: null, tan: 0.05, click: 0.25, ring: 0.4, cav: [0.3, 0.033] }, // beach ball
	cardboard: { Ec: 2e7, Eb: 2e9, tan: 0.06, click: 0.5, ring: 0.6 },
	paper: { Ec: 1e6, Eb: 1e8, tan: 0.2, click: 0.15, ring: 0.2 },
	foam: { Ec: 1e5, Eb: null, tan: 0.4, click: 0.05, ring: 0.05 }, // almost silent
	fabric: { Ec: 1e5, Eb: null, tan: 0.4, click: 0.08, ring: 0.05 },
	clay: { Ec: 3e6, Eb: 3e6, tan: 0.5, click: 0.3, ring: 0.5 }, // dead thud
	fruit: { Ec: 3e6, Eb: 3e6, tan: 0.25, click: 0.3, ring: 0.4 },
	wax: { Ec: 2e8, Eb: 2e8, tan: 0.06, click: 0.6, ring: 0.4 },
}

// Engine material names (without their " [hash]" suffix) and render looks → a class. Words are tried in order; the look is the fallback.
const BY_NAME = [
	[/cupronickel|coin/i, "coin"], [/aluminium can|\bcan\b/i, "can"], [/glass & aluminium/i, "glass"], [/alumin/i, "aluminium"], [/steel|iron|metal/i, "steel"],
	[/marble|glass/i, "glass"], [/\bice\b/i, "ice"], [/ceramic|porcelain/i, "ceramic"], [/eggshell/i, "eggshell"], [/brick/i, "brick"], [/concrete|stone/i, "concrete"],
	[/phenolic|billiard/i, "phenolic"], [/celluloid|ping/i, "celluloid"], [/golf/i, "golf"], [/bowling/i, "bowling"], [/baseball/i, "baseball"],
	[/basketball|leather \(/i, "ballLeather"], [/synthetic leather|soccer|football/i, "ballSynthetic"], [/felt|tennis/i, "felt"], [/pvc|beach/i, "pvc"],
	[/solid rubber|superball/i, "rubber"], [/tyre|tire|rubber|urethane|trampoline|belt|vinyl/i, "softRubber"],
	[/cardboard/i, "cardboard"], [/paper|tissue/i, "paper"], [/foam|sponge/i, "foam"], [/carpet|fabric|cloth|felt/i, "fabric"], [/clay|putty/i, "clay"],
	[/fruit|apple|orange/i, "fruit"], [/wax|candle/i, "wax"], [/cork/i, "cork"], [/plastic|abs|polyprop|pet\b|nylon|acrylic|polyeth/i, "plastic"],
	[/wood|hardwood|domino|oak|pine|walnut|mahogany|plywood/i, "wood"],
]
const BY_LOOK = {
	wood: "wood", "light wood": "wood", "dark wood": "wood", rubber: "rubber", plastic: "plastic", clay: "clay", steel: "steel", glass: "glass", ice: "ice",
	foam: "foam", brick: "brick", carpet: "fabric", cork: "cork", cardboard: "cardboard", aluminium: "aluminium", concrete: "concrete", "rubber mat": "softRubber",
	"tennis felt": "felt", leather: "ballLeather", "synthetic leather": "ballSynthetic", celluloid: "celluloid", golf: "golf", baseball: "baseball", bowling: "bowling",
	marble: "glass", pvc: "pvc", phenolic: "phenolic", ceramic: "ceramic", fruit: "fruit", eggshell: "eggshell", paper: "paper", wax: "wax", fabric: "fabric",
	tyre: "softRubber", urethane: "softRubber", trampoline: "softRubber", belt: "softRubber",
}

/** The sound class of a solid: from its engine material name, else its look; "wood" when neither says. */
export function materialClass(material, look) {
	const name = String(material ?? "").replace(/\s*\[[^\]]*\]\s*$/, "")
	for (const [re, cls] of BY_NAME) if (re.test(name)) return cls
	return BY_LOOK[look] ?? "wood"
}

// ---------- bodies ----------

function polygonArea(points) {
	let a = 0
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j].x + points[i].x) * (points[j].y - points[i].y)
	return Math.abs(a) / 2
}

/** {cls, mass (kg), dims [thickness, width, length] (m), radius, hollow, rod, isStatic, density} of a doc solid. */
function bodyOf(solid, doc) {
	const cls = materialClass(solid.material, solid.look)
	const density = doc.materials?.[solid.material]?.density ?? 1000
	const b = solid.body ?? {}
	const out = { id: solid.id, cls, density, isStatic: solid.kind === "static", radius: 0, hollow: false, rod: false, dims: null, mass: 1, size: 0.1 }
	if (b.kind === "ball") {
		const r = Math.max(1e-4, b.radius ?? 0.02)
		out.radius = r
		if (solid.shape === "cylinder") {
			const len = Math.max(r, solid.depth3d ?? solid.length ?? 4 * r)
			out.rod = true
			out.dims = [2 * r, 2 * r, len]
			out.mass = density * Math.PI * r * r * len
			out.size = Math.max(len, 2 * r)
		} else {
			const w = b.wall
			out.hollow = Number.isFinite(w) && w > 0 && w < r
			const v = out.hollow ? (4 / 3) * Math.PI * (r ** 3 - (r - w) ** 3) : (4 / 3) * Math.PI * r ** 3
			out.mass = density * v
			out.size = 2 * r
		}
	} else if (b.kind === "slab") {
		const w = b.width ?? 0.1, h = b.height ?? 0.1, d = b.depth ?? 0.1
		out.dims = [w, h, d].sort((p, q) => p - q)
		out.mass = density * w * h * d * (b.taper ? (1 + b.taper) / 2 : 1)
		out.size = out.dims[2]
	} else if (b.kind === "polygon" && b.points?.length >= 3) {
		const xs = b.points.map((p) => p.x), ys = b.points.map((p) => p.y)
		const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), d = b.depth ?? 0.1
		const area = polygonArea(b.points)
		// A polygon's thickness for bending: its area over its longest side (a thin wedge is thin), never more than its smallest side.
		const len = Math.max(w, h, d)
		const thick = Math.min(w, h, d, area / Math.max(w, h))
		out.dims = [thick, [w, h, d].sort((p, q) => p - q)[1], len]
		out.mass = density * area * d
		out.size = len
	}
	out.mass = Math.max(1e-5, out.mass)
	// The mass that answers a knock: a big plate only moves near the hit, within about half a bending wavelength (at 500 Hz) of it.
	out.answering = out.mass
	out.coincidence = 0 // a bending plate or bar radiates poorly below its coincidence frequency (f_c = c²/(1.8·h·c_L))
	const E = CLASSES[cls].Eb
	if (out.dims && !out.radius && E && out.dims[1] > 2 * out.dims[0]) {
		const h = out.dims[0], m2 = density * h // mass per area
		const B = E * h ** 3 / (12 * (1 - NU * NU)) // bending stiffness
		const lambda = TAU * Math.pow(B / (m2 * (TAU * 500) ** 2), 0.25)
		out.answering = Math.min(out.mass, m2 * (lambda / 2) ** 2)
	}
	if (out.dims && !out.radius && E) out.coincidence = (C_AIR * C_AIR) / (1.8 * out.dims[0] * Math.sqrt(E / (density * (1 - NU * NU))))
	return out
}

const FREE_FREE = [1, 2.756, 5.404, 8.933, 13.344, 18.637, 24.812, 31.870] // (β_n/β_1)² of a free-free bar
const CANTILEVER = [1, 6.267, 17.548, 34.387] // (β_n/β_1)² of a clamped-free bar
const SPHERE = [1, 1.46, 1.84] // a solid sphere's lowest spheroidal modes (n = 2, 3, 4), relative
const CAVITY = [1, 1.606] // a spherical cavity's first two acoustic modes (ka = 2.0816, 3.3421)

/** A 32-bit hash of a string (FNV-1a): seeds a body's own mode pattern, so the same part sounds the same at every hit. */
function hashOf(text) {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
	return h >>> 0
}

/** The body's modes: [[f (Hz), weight, loss factor]]; only 20 Hz … 18 kHz. */
function modesOf(body) {
	const c = CLASSES[body.cls]
	const out = []
	const tan = c.tan * (body.isStatic ? 3 : 1) // a supported, static part loses its energy into its mounts
	const add = (f, w, t = tan) => { if (f >= 20 && f <= 18000 && w > 0) out.push([f, w, t]) }
	if (body.radius && !body.rod) {
		if (body.hollow && c.cav) {
			CAVITY.forEach((k, i) => add(113.6 / body.radius * k, c.cav[0] * (i ? 0.35 : 1), c.cav[1] * (i ? 1.5 : 1)))
		} else if (c.Eb) {
			const cs = Math.sqrt(c.Eb / (2 * body.density * (1 + NU)))
			SPHERE.forEach((k, i) => add(0.42 * cs / body.radius * k, 1 / (i + 1)))
		}
		return out
	}
	if (!body.dims || !c.Eb) return out
	const [h, w, L] = body.dims
	const cb = Math.sqrt(c.Eb / body.density)
	if (body.rod) { // a circular rod: radius of gyration r/2 instead of h/√12
		const f1 = (body.isStatic ? 0.5596 : 3.561) * (h / 4) * cb / (L * L)
		;(body.isStatic ? CANTILEVER : FREE_FREE.slice(0, 5)).forEach((k, i) => add(f1 * k, 1 / Math.pow(i + 1, 0.7)))
		return out
	}
	const f1 = 1.028 * h * cb / (L * L)
	FREE_FREE.forEach((k) => add(f1 * k, 1)) // struck at a random point, every mode moves about as fast (equal modal masses)
	if (w > 2 * h) {
		// A plate: besides the bending along its length, modes across it and mixed ones, as many per hertz as a plate of this area and
		// thickness has (n = √3·S/(h·c_L), Cremer), up to 12 kHz: what makes a struck board a knock and not a few tones. Their places are
		// this body's own (seeded by its id), their amplitude shared so a big plate is no louder than a small one.
		const fw = 1.028 * h * cb / (w * w)
		const cl = Math.sqrt(c.Eb / (body.density * (1 - NU * NU)))
		const density = Math.sqrt(3) * w * L / (h * cl)
		const lo = Math.max(fw, f1 * 1.5, 60), hi = 12000
		const count = Math.min(32, Math.round(density * (hi - lo)))
		const rand = rng(hashOf(body.id))
		const each = 1 / Math.sqrt(1 + count / 8)
		for (let i = 0; i < count; i++) add(lo + (hi - lo) * (i + rand()) / count, each)
	}
	return out
}

// ---------- randomness (seeded by the impact index) ----------

function rng(seed) {
	let s = (seed >>> 0) || 0x9e3779b9
	return () => {
		s = (s + 0x6d2b79f5) >>> 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// ---------- one impact ----------

const contactSpectrum = (f, tau) => 1 / Math.sqrt(1 + Math.pow(1.4 * f * tau, 4)) // a Hertz force pulse of length τ, smoothed (no nulls)
const radiation = (f, size) => { const ka = TAU * f * (size / 2) / C_AIR; return (ka * ka) / (1 + ka * ka) } // efficiency (power); pressure ∝ √

/** Adds a·e^(−αt)·sin(2πft) from time t0 (s) into out (a mono buffer), until it is 70 dB down or the buffer ends. */
function addMode(out, sr, t0, f, a, alpha, attack) {
	const n0 = Math.max(0, Math.ceil(t0 * sr))
	if (n0 >= out.length) return
	const w = TAU * f / sr
	const r = Math.exp(-alpha / sr)
	const end = Math.min(out.length, n0 + Math.ceil(Math.min(4, 8.06 / alpha) * sr)) // e^(-αt) = 70 dB down
	const t1 = n0 / sr - t0 // the first sample's time after the impact (0 … 1/sr)
	// a·e^(−αt)·sin(ωt) by the two-term recursion y[n] = 2r·cos(w)·y[n−1] − r²·y[n−2]
	let y1 = a * Math.exp(-alpha * t1) * Math.sin(TAU * f * t1)
	let y0 = a * Math.exp(-alpha * (t1 - 1 / sr)) * Math.sin(TAU * f * (t1 - 1 / sr))
	const k1 = 2 * r * Math.cos(w), k2 = r * r
	const na = Math.max(1, Math.round(attack * sr))
	for (let n = n0; n < end; n++) {
		const i = n - n0
		out[n] += i < na ? y1 * (0.5 - 0.5 * Math.cos(Math.PI * (i + t1 * sr) / na)) : y1
		const y = k1 * y1 - k2 * y0
		y0 = y1
		y1 = y
	}
}

/** The contact click: the radiated pressure of a force sin^1.5(πt/τ), i.e. its derivative, from t0; plus a little noise of the same length. */
function addClick(out, sr, t0, tau, a, noise, rand) {
	const n0 = Math.max(0, Math.ceil(t0 * sr))
	const len = Math.max(2, Math.ceil(tau * sr))
	let lp = 0
	const cut = Math.min(0.45, (0.7 / tau) / sr) // the noise's one-pole low-pass at about the contact's corner frequency
	const coef = 1 - Math.exp(-TAU * cut)
	const nlen = len + Math.ceil(0.004 * sr)
	for (let i = 0; i < nlen && n0 + i < out.length; i++) {
		const t = (n0 + i) / sr - t0
		let v = 0
		if (t < tau) {
			const ph = Math.PI * t / tau
			v = a * Math.sqrt(Math.max(0, Math.sin(ph))) * Math.cos(ph) // ∝ d/dt sin^1.5: starts at 0, + then −
		}
		lp += coef * ((rand() * 2 - 1) - lp)
		const env = Math.exp(-t / (tau + 0.0015)) * Math.min(1, t / Math.max(1e-5, tau * 0.25))
		out[n0 + i] += v + noise * a * lp * env
	}
}

// ---------- the mix ----------

function stageOf(doc, opts, solids) {
	if (Number.isFinite(opts.stage?.x0) && Number.isFinite(opts.stage?.x1) && opts.stage.x1 > opts.stage.x0) return opts.stage
	const cam = doc.camera
	if (cam?.pixelsPerMeter > 0 && cam.canvas?.width > 0) {
		const x0 = (cam.origin?.x ?? 0) - (cam.pixel?.x ?? 0) / cam.pixelsPerMeter
		return { x0, x1: x0 + cam.canvas.width / cam.pixelsPerMeter }
	}
	const xs = solids.map((s) => s.at?.x).filter(Number.isFinite)
	return xs.length ? { x0: Math.min(...xs) - 0.2, x1: Math.max(...xs) + 0.2 } : { x0: -1, x1: 1 }
}

/**
 * The impact sounds as two Float32Arrays (dry, unlimited). Pure: no Web Audio. events: [{t, a, b, speed, classes, tau, amp, pan}] (what was made).
 */
export function renderImpacts(impacts, doc, opts = {}) {
	const sr = opts.sampleRate ?? 48000
	const duration = Math.max(0, opts.duration ?? 0)
	const length = Math.max(1, Math.ceil(duration * sr))
	const left = new Float32Array(length), right = new Float32Array(length)
	const solids = doc?.solids ?? []
	const byId = new Map(solids.map((s) => [s.id, s]))
	const bodies = new Map()
	const body = (id) => {
		if (!bodies.has(id)) { const s = byId.get(id); bodies.set(id, s ? { ...bodyOf(s, doc), solid: s, modes: null } : null) }
		const b = bodies.get(id)
		if (b && !b.modes) b.modes = modesOf(b)
		return b
	}
	const stage = stageOf(doc ?? {}, opts, solids)
	const gain = (opts.gain ?? 1) * 0.12 // a fixed calibration (a bowling ball dropped 1 m onto the table peaks near −3 dBFS); synthesizeImpacts sets the level
	const events = []
	let scratch = new Float64Array(0)
	const list = [...(impacts ?? [])].map((im, index) => ({ ...im, index })).filter((im) => Number.isFinite(im.t) && im.t >= 0 && im.t < duration && im.speed > 0)
	for (const im of list) {
		const A = body(im.a), B = body(im.b)
		if (!A || !B) continue
		const rand = rng(Math.imul(im.index + 1, 0x9e3779b1) ^ 0x5bd1e995)
		const v = Math.max(0.02, im.speed)
		const mA = A.isStatic ? Infinity : A.mass, mB = B.isStatic ? Infinity : B.mass
		const mEff = !Number.isFinite(mA) && !Number.isFinite(mB) ? Math.min(A.mass, B.mass) : !Number.isFinite(mA) ? mB : !Number.isFinite(mB) ? mA : (mA * mB) / (mA + mB)
		const cA = CLASSES[A.cls], cB = CLASSES[B.cls]
		// Contact: the radius of curvature (a ball or rod on a face: its own; two balls: both; two flat things: an edge or corner, about 1 cm),
		// the stiffness, then the contact time.
		const R = A.radius && B.radius ? (A.radius * B.radius) / (A.radius + B.radius) : A.radius || B.radius || 0.01
		const Estar = 1 / ((1 - NU * NU) / cA.Ec + (1 - NU * NU) / cB.Ec)
		const tau = Math.min(0.04, Math.max(3e-5, 2.87 * Math.pow((mEff * mEff) / (R * Estar * Estar * v), 0.2)))
		const amp = gain * Math.pow(v, 0.8) * Math.pow(Math.min(50, Math.max(1e-4, mEff)) / 0.1, 0.3) * (0.9 + 0.2 * rand())
		// Where: the moving body's place at that moment (the lighter one when both move).
		const mover = !A.isStatic && (B.isStatic || A.mass <= B.mass) ? A : B
		let x = mover.solid.at?.x ?? 0
		let y = mover.solid.at?.y ?? 0
		if (opts.track?.frames?.length) { const p = placementsAt(opts.track, im.t)[mover.id]; if (p) { x = p.x; y = p.y } }
		let seen = null
		if (typeof opts.panAt === "function") { try { const v = opts.panAt(im.t, x, y); seen = typeof v === "number" ? v : null } catch { seen = null } }
		const pan = Math.max(-0.8, Math.min(0.8, Number.isFinite(seen) ? seen : ((x - stage.x0) / (stage.x1 - stage.x0)) * 2 - 1))
		// The sound in mono, then panned: render into a scratch buffer as long as the longest ring.
		let longest = tau + 0.01
		const parts = []
		for (const bd of [A, B]) {
			const c = CLASSES[bd.cls]
			// How much this body is set ringing: its velocity change goes as the impulse over the mass that answers the knock (a big plate's
			// near the hit), softened (a big board radiates well even when it barely moves): a ping-pong ball hardly sounds a plank, a bowling
			// ball does; the lighter body rings fully.
			const share = Math.max(0.06, Math.min(1, Math.pow(mEff / bd.answering, 0.3)))
			for (const [f, w, tan] of bd.modes) {
				const isCavity = bd.hollow && !!c.cav
				const excite = isCavity ? Math.sqrt(contactSpectrum(f, tau * 0.25)) : contactSpectrum(f, tau)
				const below = bd.coincidence ? 1 / (1 + (bd.coincidence / f) ** 2) : 1 // radiation efficiency below coincidence
				const a = amp * c.ring * share * w * excite * Math.sqrt(radiation(f, bd.size) * below) * (0.55 + 0.45 * rand())
				if (a < 1e-6) continue
				const alpha = Math.PI * f * tan + (bd.isStatic ? 14 : 2) // + a floor: nothing rings for ever, a mounted part's low modes least
				const fr = f * (1 + (rand() - 0.5) * 0.01) // ±0.5 %: no two hits exactly alike
				parts.push([fr, a, alpha])
				longest = Math.max(longest, Math.min(4, 8.06 / alpha))
			}
		}
		const n = Math.ceil((longest + 0.01) * sr) + 2
		if (scratch.length < n) scratch = new Float64Array(n)
		const buf = scratch.subarray(0, n)
		buf.fill(0)
		const frac = im.t * sr - Math.floor(im.t * sr) // render on the impact's own sub-sample grid, then add at its sample
		const t0 = frac / sr
		const clickA = amp * 0.5 * Math.min(cA.click, cB.click) * Math.min(2.5, Math.pow(0.0005 / tau, 0.7))
		addClick(buf, sr, t0, tau, clickA, 0.6, rand)
		for (const [f, a, alpha] of parts) addMode(buf, sr, t0, f, a, alpha, Math.min(tau, 0.004))
		const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4)
		const start = Math.floor(im.t * sr)
		const m = Math.min(n, length - start)
		for (let i = 0; i < m; i++) { const s = buf[i]; left[start + i] += s * gl; right[start + i] += s * gr }
		events.push({ t: im.t, a: im.a, b: im.b, speed: im.speed, classes: [A.cls, B.cls], tau, amp, pan })
	}
	// the waves module's tones (a fork, a drum, a string, a buzzer…: web/export/tones.js), panned as a hit there would be; nothing in a run without them
	if (opts.tones !== false && (doc?.processes ?? []).some((p) => p.kind === "sound")) {
		const panOf = (t, x, y) => {
			let seen = null
			if (typeof opts.panAt === "function") { try { const v = opts.panAt(t, x, y); seen = typeof v === "number" ? v : null } catch { seen = null } }
			return Number.isFinite(seen) ? seen : ((x - stage.x0) / (stage.x1 - stage.x0)) * 2 - 1
		}
		for (const e of addTones(doc, opts.track, left, right, sr, panOf)) events.push(e)
	}
	highPass(left, sr, 60)
	highPass(right, sr, 60)
	return { left, right, sampleRate: sr, events }
}

/** A 2nd-order Butterworth high-pass in place (no rumble a speaker can't play, and no headroom spent on it). */
function highPass(x, sr, fc) {
	const w = TAU * fc / sr, cw = Math.cos(w), al = Math.sin(w) / Math.SQRT2
	const a0 = 1 + al
	const b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0
	for (let i = 0; i < x.length; i++) {
		const x0 = x[i]
		const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1; x1 = x0; y2 = y1; y1 = y0
		x[i] = y0
	}
}

// ---------- the room ----------

/** A short stereo room response (deterministic): a few early reflections, then decorrelated noise decaying with RT60 ≈ 0.35 s, darker as it goes. */
function roomResponse(sr) {
	const n = Math.round(sr * 0.6)
	const ch = [new Float32Array(n), new Float32Array(n)]
	for (let c = 0; c < 2; c++) {
		const rand = rng(c ? 0xa5a5a5a5 : 0x1234567)
		const out = ch[c]
		let lp = 0
		for (let i = Math.round(sr * 0.008); i < n; i++) {
			const t = i / sr
			const env = Math.exp(-6.91 * t / 0.35)
			const coef = 0.6 * Math.exp(-t / 0.15) + 0.08 // high frequencies die first
			lp += coef * ((rand() * 2 - 1) - lp)
			out[i] = lp * env
		}
		for (const [ms, g] of [[11, 0.5], [17, -0.35], [23, 0.3], [31, -0.22], [38, 0.18]]) out[Math.round(sr * (ms + c * 1.3) / 1000)] += g
		let e = 0
		for (let i = 0; i < n; i++) e += out[i] * out[i]
		const k = 1 / Math.sqrt(e || 1)
		for (let i = 0; i < n; i++) out[i] *= k
	}
	return ch
}

// ---------- loudness (ITU-R BS.1770) and true peak ----------

/** The two biquads of BS.1770's K-weighting for this sample rate (a high shelf, +4 dB above ~1.7 kHz; a 38 Hz high-pass), each [b0, b1, b2, a1, a2]:
 *  the standard's 48 kHz coefficients, from their analogue prototypes (as pyloudnorm and libebur128 derive them for other rates). */
function kWeighting(sr) {
	let K = Math.tan(Math.PI * 1681.974450955533 / sr)
	const Vh = 10 ** (3.999843853973347 / 20)
	const Vb = Vh ** 0.4996667741545416
	const Q1 = 0.7071752369554196
	let a0 = 1 + K / Q1 + K * K
	const shelf = [(Vh + Vb * K / Q1 + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q1 + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q1 + K * K) / a0]
	K = Math.tan(Math.PI * 38.13547087602444 / sr)
	const Q2 = 0.5003270373238773
	a0 = 1 + K / Q2 + K * K
	return [shelf, [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0]]
}

/** Per sample, the K-weighted signal squared, summed over the channels (each channel weighs 1: left and right), of chs[c][i] × (gain?.[i] ?? 1). */
function kPower(chs, sr, gain = null) {
	const n = chs[0].length
	const p = new Float64Array(n)
	const [[a0, a1, a2, a3, a4], [, , , b3, b4]] = kWeighting(sr)
	for (const x of chs) {
		let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0
		for (let i = 0; i < n; i++) {
			const x0 = gain ? x[i] * gain[i] : x[i]
			const y0 = a0 * x0 + a1 * x1 + a2 * x2 - a3 * y1 - a4 * y2
			const z0 = y0 - 2 * y1 + y2 - b3 * z1 - b4 * z2
			x2 = x1; x1 = x0; z2 = z1; z1 = z0; y2 = y1; y1 = y0
			p[i] += z0 * z0
		}
	}
	return p
}

/** The loudest momentary loudness of a kPower() series scaled by `level` (LUFS: −0.691 + 10·log10 of the K-weighted mean square over 400 ms, BS.1770's "M",
 *  every window looked at, not only every 100 ms); −Infinity for silence. A sound shorter than 400 ms counts as one in 400 ms of silence. */
function maxMomentary(p, sr, level = 1) {
	const N = Math.max(1, Math.round(0.4 * sr))
	let s = 0
	let best = 0
	for (let i = 0; i < p.length; i++) {
		s += p[i]
		if (i >= N) s -= p[i - N]
		if (s > best) best = s
	}
	return best > 0 ? -0.691 + 10 * Math.log10((best * level * level) / N) : -Infinity
}

// The true peak (BS.1770-4 Annex 2): the signal 4× oversampled by a 96-tap Blackman-windowed sinc interpolator (24 taps a phase; it reads what ffmpeg's ebur128
// meter reads to 0.05 dB, where a 12-tap one read 0.2 dB low), so a peak between two samples, which a decoder and a DAC reconstruct, is seen.
const OS = 4
const OS_TAPS = 24
const OS_PHASES = (() => {
	const out = []
	for (let k = 1; k < OS; k++) {
		const h = new Float64Array(OS_TAPS)
		let sum = 0
		for (let j = 0; j < OS_TAPS; j++) {
			const d = j - (OS_TAPS / 2 - 1) - k / OS // the tap's sample (i − 11 … i + 12) less the point's place (i + k/4)
			const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)
			const u = Math.PI * d / (OS_TAPS / 2 + 0.5)
			h[j] = sinc * (0.42 + 0.5 * Math.cos(u) + 0.08 * Math.cos(2 * u)) // Blackman
			sum += h[j]
		}
		for (let j = 0; j < OS_TAPS; j++) h[j] /= sum
		out.push(h)
	}
	return out
})()

/** Per sample i, the largest magnitude of any channel from sample i up to (not including) sample i + 1, 4× oversampled. */
function truePeaks(chs) {
	const n = chs[0].length
	const env = new Float32Array(n)
	const back = OS_TAPS / 2 - 1
	for (const x of chs) {
		for (let i = 0; i < n; i++) {
			let m = Math.abs(x[i])
			for (const h of OS_PHASES) {
				let v = 0
				const j0 = i - back
				if (j0 >= 0 && j0 + OS_TAPS <= n) for (let j = 0; j < OS_TAPS; j++) v += h[j] * x[j0 + j]
				else for (let j = 0; j < OS_TAPS; j++) { const q = j0 + j; if (q >= 0 && q < n) v += h[j] * x[q] }
				const a = Math.abs(v)
				if (a > m) m = a
			}
			if (m > env[i]) env[i] = m
		}
	}
	return env
}

/** The gain (per sample, 0 … 1) a look-ahead limiter applies so that peaks × level × gain never pass `ceiling`: the gain is down 2 ms before a peak (it is offline:
 *  nothing is delayed), comes down smoothly into it, and recovers over `release` s. Linked: one gain for both channels, so nothing moves in the stereo picture. */
function limiterGain(peaks, level, ceiling, sr, release = LIMIT_RELEASE) {
	const n = peaks.length
	const g = new Float32Array(n)
	const ahead = Math.max(1, Math.round(0.002 * sr))
	// the lowest gain needed in the next `ahead` samples (a sliding minimum, backwards)
	const need = (i) => { const p = peaks[i] * level; return p > ceiling ? ceiling / p : 1 }
	const dq = new Int32Array(n)
	const nv = new Float32Array(n)
	for (let i = 0; i < n; i++) nv[i] = need(i)
	let h = 0, tl = 0
	for (let i = n - 1; i >= 0; i--) {
		while (tl > h && nv[dq[tl - 1]] >= nv[i]) tl--
		dq[tl++] = i
		while (dq[h] > i + ahead) h++
		g[i] = nv[dq[h]]
	}
	// release: rise at most e^(1/release) per sample
	const rel = Math.exp(-1 / (release * sr))
	let cur = 1
	for (let i = 0; i < n; i++) {
		cur = Math.min(g[i], 1 - (1 - cur) * rel)
		g[i] = cur
	}
	// attack: never fall faster than over about `ahead` samples toward a dip
	let next = 1
	for (let i = n - 1; i >= 0; i--) {
		next = Math.min(g[i], next + (1 - next) / ahead)
		g[i] = next
	}
	return g
}

/** A look-ahead true-peak limiter on both channels at once (linked), in place: nothing above `ceiling` (also between the samples); see limiterGain. */
export function limitStereo(left, right, sr, ceiling = TP_CEILING) {
	const g = limiterGain(truePeaks([left, right]), 1, ceiling, sr)
	for (let i = 0; i < left.length; i++) { left[i] *= g[i]; right[i] *= g[i] }
	const tp = truePeaks([left, right]).reduce((a, b) => Math.max(a, b), 0)
	if (tp > ceiling) { const k = ceiling / tp; for (let i = 0; i < left.length; i++) { left[i] *= k; right[i] *= k } }
	return { left, right }
}

/**
 * The export's sound track: impacts → AudioBuffer (stereo, `sampleRate`, `duration` long), mixed with a small room, its loudest moment at TARGET_LUFS (where
 * MAX_BOOST_DB and MAX_LIMIT_DB allow) and its true peak at or under −2 dBTP.
 */
export async function synthesizeImpacts(impacts, doc, opts = {}) {
	const sr = opts.sampleRate ?? 48000
	const duration = Math.max(1 / sr, opts.duration ?? 0)
	const length = Math.max(1, Math.ceil(duration * sr))
	const dry = renderImpacts(impacts, doc, { ...opts, sampleRate: sr, duration })
	let dryPeak = 0
	for (let i = 0; i < length; i++) dryPeak = Math.max(dryPeak, Math.abs(dry.left[i]), Math.abs(dry.right[i]))
	const room = Math.max(0, Math.min(1, opts.room ?? 0.22))
	const Ctx = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
	if (!Ctx) throw new Error("This browser has no OfflineAudioContext, so it can't make the sound track.")
	const ctx = new Ctx({ numberOfChannels: 2, length, sampleRate: sr })
	const src = ctx.createBuffer(2, length, sr)
	src.copyToChannel(dry.left, 0)
	src.copyToChannel(dry.right, 1)
	const node = ctx.createBufferSource()
	node.buffer = src
	node.connect(ctx.destination) // dry: sample for sample
	if (room > 0) {
		const ir = roomResponse(sr)
		const irBuf = ctx.createBuffer(2, ir[0].length, sr)
		irBuf.copyToChannel(ir[0], 0)
		irBuf.copyToChannel(ir[1], 1)
		const conv = ctx.createConvolver()
		conv.normalize = false
		conv.buffer = irBuf
		const wet = ctx.createGain()
		wet.gain.value = room * 0.5
		node.connect(conv).connect(wet).connect(ctx.destination)
	}
	node.start(0)
	const out = await ctx.startRendering()
	const L = out.getChannelData(0), R = out.getChannelData(1)
	for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i])) L[i] = 0; if (!Number.isFinite(R[i])) R[i] = 0 }
	// Level, like a recordist setting the gain for the scene: its loudest 400 ms at TARGET_LUFS (raised by at most MAX_BOOST_DB, so a scene of only foam and felt
	// stays quiet), every hit keeping its loudness relative to the others. The limiter takes the few sharp peaks above the ceiling (a click's first millisecond),
	// and the level is raised again by what that took from the loudest moment (a few passes), so the loudest moments of scenes match; but never so far that the
	// limiter would take more than MAX_LIMIT_DB off a peak. normalize: false keeps the fixed calibration (still limited).
	const peaks = truePeaks([L, R])
	const before = maxMomentary(kPower([L, R], sr), sr)
	const cap = 10 ** (MAX_BOOST_DB / 20)
	const normalize = opts.normalize !== false && Number.isFinite(before)
	let maxPeak = 0
	for (const v of peaks) if (v > maxPeak) maxPeak = v
	const top = Math.min(cap, maxPeak > 0 ? (TP_CEILING * 10 ** (MAX_LIMIT_DB / 20)) / maxPeak : cap) // (the limiter takes at most MAX_LIMIT_DB off any peak)
	let level = normalize ? Math.min(top, 10 ** ((TARGET_LUFS - before) / 20)) : 1
	let g = limiterGain(peaks, level, TP_CEILING, sr)
	let loudest = Number.isFinite(before) ? maxMomentary(kPower([L, R], sr, g), sr, level) : -Infinity
	for (let pass = 0; normalize && pass < 4 && TARGET_LUFS - loudest > 0.2 && level < top; pass++) {
		level = Math.min(top, level * 10 ** ((TARGET_LUFS - loudest) / 20))
		g = limiterGain(peaks, level, TP_CEILING, sr)
		loudest = maxMomentary(kPower([L, R], sr, g), sr, level)
	}
	let reduction = 1
	for (let i = 0; i < L.length; i++) { const k = level * g[i]; L[i] *= k; R[i] *= k; if (g[i] < reduction) reduction = g[i] }
	let truePeak = 0
	for (const v of truePeaks([L, R])) if (v > truePeak) truePeak = v
	if (truePeak > TP_CEILING) { const k = TP_CEILING / truePeak; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k } truePeak = TP_CEILING; loudest += 20 * Math.log10(k) }
	const db = (v) => (v > 0 ? Math.round(2000 * Math.log10(v)) / 100 : -Infinity)
	out.info = { events: dry.events, dryPeak, level, room, loudness: { target: TARGET_LUFS, before: Math.round(before * 100) / 100, loudest: Math.round(loudest * 100) / 100, truePeak: db(truePeak), limited: -db(reduction) } }
	return out
}
