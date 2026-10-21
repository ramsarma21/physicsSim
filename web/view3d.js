// The "realistic look": a real-time three.js scene meant to read like a phone video of a real wooden tabletop machine.
// It mirrors the offline Blender renderer (machines/render_3d.py): the same materials, legs, cords, pull pin, room wall,
// key light and cameras. It draws ANY scene of catalog items (CONTRACT.md v2): everything comes from the solids' own
// fields (body, look, color, pattern, shape, legs, hidden_3d ...), never from ids. Plain ES module, three.js only through
// the importmap.
//
// Coordinates: sim x right, y up, the machine's mid-plane is z = 0, +z is toward the default camera.
// Each solid is a mesh at (x, y, 0) rotated about z by its angle (radians CCW, same sign as the sim).
//
// The app calls load() ~20 times a second while the user drags an item, so everything that does not change between two
// loads (materials, textures, geometries) is cached by what makes it unique (look + colour, shape + size) and reused.
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { frameIndex, placementsAt } from "./track.js"
import { animates, collectHooks, framePlugins, startPlugins, stopPlugins } from "./view-plugins.js"
import { buildModel, beginRun, endRun, modelFor, modelKey, isModelCached, pinModel, gradeShader, gradeKeyFor, gradeSat, isPlainPaint, prebake, stealPrebake, prebakeReady, stopPrebake } from "./models3d.js"
import { makeGate } from "./start-gate.js"

// ---------------------------------------------------------------------------------------------------------------------
// Constants (all lengths in meters)
// ---------------------------------------------------------------------------------------------------------------------
const SKIN = 0.001 // the engine keeps bodies ~1 mm apart; render meshes are grown by this to hide the gap
const TABLE_DEPTH = 1.6 // front-to-back depth of the tabletop when a scene has none to measure
const TABLE_TOP = 0.001 // the grown tabletop's surface
// Three wood tones (linear RGB, dark -> light), like render_3d.py; tile = meters one texture tile covers along / across the grain.
const WOODS = {
	wood: { dark: [0.3, 0.17, 0.08], light: [0.52, 0.32, 0.16] },
	table: { dark: [0.16, 0.075, 0.03], light: [0.3, 0.16, 0.075] },
	domino: { dark: [0.42, 0.26, 0.12], light: [0.62, 0.42, 0.22] },
}
const TILES = { wood: { u: 0.9, v: 0.14 }, table: { u: 1.7, v: 0.5 }, domino: { u: 0.3, v: 0.07 } }
// The shipped looks, used until the app hands over GET /api/catalog's `looks` with setOptions({looks}).
const DEFAULT_LOOKS = {
	wood: { fill: "#c8955a", shade: "#a8743f", roughness: 0.5, metalness: 0, clearcoat: 1, grain: true },
	"light wood": { fill: "#d7a86e", shade: "#b07a42", roughness: 0.5, metalness: 0, clearcoat: 0.6, grain: true },
	rubber: { fill: "#dd2222", shade: "#aa1111", roughness: 0.42, metalness: 0, clearcoat: 0 },
	plastic: { fill: "#f2c230", shade: "#c99a10", roughness: 0.22, metalness: 0, clearcoat: 0.4 },
	clay: { fill: "#5a9b4a", shade: "#3f7434", roughness: 0.65, metalness: 0, clearcoat: 0 },
	steel: { fill: "#9aa3ab", shade: "#6b737a", roughness: 0.25, metalness: 1, clearcoat: 0 },
}
// How a ball's mottled paint is drawn, per look: colour mottling amplitude, roughness-map range, noise seed, tint, bump strength.
const MOTTLE = {
	rubber: { mottle: 0.2, rough: [0.62, 1.0], seed: 40, tint: 0.6, bump: 0.35 },
	plastic: { mottle: 0.09, rough: [0.75, 1.0], seed: 50, tint: 0.65, bump: 0.12 },
	clay: { mottle: 0.26, rough: [0.7, 1.0], seed: 60, tint: 0.65, bump: 1.4 },
}
const MOTTLE_DEFAULT = { mottle: 0.1, rough: [0.7, 1.0], seed: 70, tint: 0.65, bump: 0.3 }
const MOTTLE_SMOOTH = { mottle: 0.03, rough: [0.85, 1.0], seed: 80, tint: 1, bump: 0.08 } // metal and glass: a clean surface, a hint of variation so spin still shows
const BALL_ROUGH_K = 1.22 // the mottle map multiplies roughness down (0.62-1.0), so the look's value is scaled up to land where the tuned balls were
const PAINT_TINT = 0.68 // plain painted surfaces: the bright saturated paints otherwise clip toward white in AgX and read pink / cream
const HFOV_26MM = 2 * Math.atan(18 / 26) // horizontal fov of a 26 mm full-frame lens
const HFOV_35MM = 2 * Math.atan(18 / 35)
const FRAME_SIDE = 0.05 // wide shot: the machine's real 3D extent keeps this fraction of the width clear on each side (~10 % to spare in all)
const FRAME_TOP_UI = 56 // css px kept clear at the top for the Wide / Follow / Orbit / Fit buttons and the hint
const FRAME_TOP = 0.02 // and this much more of the height above the machine
const FRAME_BOTTOM = 0.04 // fraction of the height kept clear under it
const WIDE_PITCH = 0.12 // the wide camera sits this much of its distance above the machine's centre, looking down at it
const FRAME_X = [-1.5, 4.5] // what a falling mover may drag the shot out to
const FRAME_Y = [-0.02, 3]
const FOLLOW_HZ = 60
const FOLLOW_SMOOTH = 0.1 // exponential smoothing per 1/60 s step
const WALL_LEVEL = 1.0 // the wall paint as specified (0.62, 0.60, 0.56): with the key at 4.0 it lands on the EEVEE reference
const MAX_PIXELS = 8.6e6 // cap the drawing buffer (a 4K+ window on a 2x screen would otherwise cost 4x a 1080p one)
const AO_OPACITY = 0.5 // soft contact shading under things that touch the tabletop
const ROUND_BAND = 0.0005 // m: a round body (a ball, a roll, a coin on edge) whose body sinks less than this into what it rests on is drawn lifted onto it ...
const ROUND_FADE = 0.001 // ... fading out by this depth (a ball the engine pressed deeper keeps its place)
const FOLLOW_DIST = 1.15
const FOLLOW_LIFT = 0.18
const MAT_CAP = 64 // cached materials (with their textures) kept between loads
const GEO_CAP = 220 // cached geometries kept between loads
const REFL_SKIP = 2 // layer of the meshes the planar reflection leaves out while things move (see renderReflection); the real cameras draw layers 0 and 2
const TINY_REFL = 0.006 // m: a part whose bounding sphere is smaller than this is a blur in the reflection
const FLOW_GAP_MS = 120 // two draws of different moments this close are an animation playing, not a seek
const SLOW_MS = 8 // a playing scene whose draws average more than this loses the planar reflection until it stops
const PANE_LAYER = 3 // the see-through safety walls (drawn as faint acrylic while their item is selected / hovered): the real cameras draw them, the table's mirror never does
const LENS_LAYER = 4 // the see-through parts inside a glass item (a marble's cat's eye, a bottle's water line, ice's core): mirrored by the table in a pass of their own (see renderReflection)
const REST_BAND = 0.002 // m: a slab or polygon whose lowest point hovers less than this above what it rests on (the tabletop, a static slab) is lowered onto it ...
const REST_FADE = 0.0035 // ... and the lowering fades out by this height, so a part that lifts off never pops (the engine's contact skin keeps resting bodies 1.5-2 mm apart)
const REST_SINK = 0.0021 // m: a part drawn up to this far INTO what it rests on is raised onto it (the meshes are grown by the contact skin: a slab standing exactly on the table, as in the editor, sinks 2 mm)
// Quality tiers (see setQuality): pr = the most device pixels per css pixel, shadow = the key light's shadow map side, refl = the planar reflection
// ("adaptive": while playing, as fast as the machine allows; "paused": only while the clock is stopped; "off": never), glass = glass and ice keep their transmission pass,
// chrome = the side (px) of the cube render of the real scene a mirror ball reflects, made while the picture holds still (0: none, the studio with a tabletop floor
// instead: applyLowChrome; see "chrome" below),
// chromeMax = how many balls get one of their own (the others share the nearest one's), lod = the share of the coils' and chains' triangle budgets the canvas
// may use (an export frame always has the whole: see applyLods).
const TIERS = {
	high: { pr: 2, shadow: 4096, refl: "adaptive", glass: true, chrome: 128, chromeMax: 6, lod: 1 },
	medium: { pr: 1.5, shadow: 2048, refl: "paused", glass: true, chrome: 64, chromeMax: 6, lod: 0.5 },
	low: { pr: 1, shadow: 1024, refl: "off", glass: false, chrome: 0, chromeMax: 0, lod: 0.25 },
}
const TIER_ORDER = ["high", "medium", "low"]
const SOFT_PR = 0.75 // a software renderer (SwiftShader, llvmpipe) at the low tier draws 0.75 device px per css px (about half the pixels; the browser scales the picture
// up): every pixel is shaded by the CPU there, and at 1 px it played the starter at 15 fps (4x slower CPU), the busy table at 12
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|swrast|software|basic render|mesa offscreen/i // a renderer string that names a CPU rasteriser
const ADAPT_WINDOW_MS = 1000 // auto quality: frames are averaged over this long
const ADAPT_SLOW_MS = 20 // ... and a window whose draws are further apart than this steps down a tier
const ADAPT_BUSY_MS = 11 // ... but only when a drawn frame, timed whole (CPU and GPU), costs more than this: a machine that draws faster is not the one pacing the frames (a 30 Hz display, battery saver, a busy tab)
const ADAPT_LIMIT = 0.75 // ... and more than this share of the window's average gap (a cost far below the gap says the display, not the machine, spaces the frames)
const ADAPT_FAST_MS = 17.8 // a window at (nearly) every vsync counts towards stepping up once ...
const ADAPT_UP_WINDOWS = 4 // ... this many follow one another (each tier change also waits ADAPT_SETTLE_MS) and a drawn frame, finished, costs under ADAPT_UP_COST_MS
const ADAPT_UP_COST_MS = 8 // (a tier lost to a transient slowdown has to be able to come back: a lower tier costs up to about half as much as the one above)
const ADAPT_SETTLE_MS = 1500
const ADAPT_BAN_MS = 20000 // a step up that has to be undone within this long is not tried again (no oscillation)
const STARVED_MS = 250 // progressive build: this long without a slice of work and the next one runs whatever idle time there is
const BUSY_MS = 300 // progressive build: the clock played (a new moment drawn), the camera moved or an item was dragged this recently ...
const BUSY_UNIT_MS = 100 // ... and the machine builds a model slower than this (a unit of work cannot be cut short): then no model is built until it stops, but in idle time that covers one (see pump)
const CHUNK_MS = 12 // progressive build: the longest slice of idle time it takes at once (a single model's build is one slice and may run longer)
const DEFER_MS = 40 // a load whose missing models are estimated to cost more than this builds them after its first frame
// How much slower than the machine the build costs were tuned on this one runs JavaScript: a 3 ms loop there (Apple M5 Pro; 8 ms with the CPU slowed 4x,
// 14 ms at 6x), timed once a page. Until a model build has been timed, the estimate of one is 12 ms times this when it is 2 or more: a page whose first scene
// has a few cold models (the wrecking ball: 433 ms of them at 4x) drew nothing until they were built; it now draws stand-ins first. A fast machine keeps 12 ms.
let slowness = null
function cpuSlowness() {
	if (slowness !== null) return slowness
	const t0 = performance.now()
	let h = 0
	const f = new Float32Array(256)
	for (let i = 0; i < 300000; i++) {
		h = Math.imul(h ^ i, 0x9e3779b1) + (h >>> 7)
		f[i & 255] += Math.sin(i * 0.001)
	}
	slowness = Math.max(1, (performance.now() - t0) / 3) + (h & f[0] & 0) // (the result is used, so the loop is not optimised away)
	return slowness
}
const TRANS_EVERY = 3 // a drag on a slow machine redraws the glass's transmission pass on every 3rd frame (see `trans` in createView3D) ...
const TRANS_SLOW_MS = 12 // ... where a draw costs more than this (ms of main thread, running average)
const PREBAKE_WAIT_MS = 5000 // progressive build: a model whose bake worker has not answered in this long is built on the page alone (models3d.js prebake) ...
const STEAL_IDLE_MS = 400 // ... and when the page has had nothing to build for this long (the workers are behind: a busy device), it builds the next one no worker has taken
const CHAIN_INNER_LEN = 3 // a chain link's inner opening, in wire diameters (= the chain's pitch, centre to centre) ...
const CHAIN_INNER_WID = 1.55 // ... and its inner width

// ---------------------------------------------------------------------------------------------------------------------
// Procedural textures (module level: drawn once, shared by every view)
// ---------------------------------------------------------------------------------------------------------------------
function hash(ix, iy, seed) {
	let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= h >>> 16
	return (h >>> 0) / 4294967296
}

/** Value noise that tiles with period (px, py) lattice cells. */
function vnoise(x, y, px, py, seed) {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const sx = fx * fx * (3 - 2 * fx)
	const sy = fy * fy * (3 - 2 * fy)
	const xa = ((x0 % px) + px) % px
	const ya = ((y0 % py) + py) % py
	const xb = (xa + 1) % px
	const yb = (ya + 1) % py
	const a = hash(xa, ya, seed)
	const b = hash(xb, ya, seed)
	const c = hash(xa, yb, seed)
	const d = hash(xb, yb, seed)
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}
const srgbOf = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const TAU = Math.PI * 2

/** A small deterministic random stream (textures must look the same every time). */
function rng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const GW = 1024
const GH = 512
let grainCache = null
let grainJob = null // the grain field being worked out (in slices when a progressive load asks): {f, y, sum, sum2}
/** Advance the grain field by rows until `budgetMs` has passed (Infinity: to the end); true once it is complete. */
function grainFieldStep(budgetMs = Infinity) {
	if (grainCache) return true
	const job = (grainJob ??= { f: new Float32Array(GW * GH), y: 0, sum: 0, sum2: 0 })
	const f = job.f
	const t0 = performance.now()
	while (job.y < GH) {
		const y = job.y
		const V = y / GH
		for (let x = 0; x < GW; x++) {
			const U = x / GW
			const warp =
				1.3 * vnoise(U * 2, V * 5, 2, 5, 1) + 0.45 * vnoise(U * 4, V * 17, 4, 17, 2) + 0.12 * vnoise(U * 9, V * 60, 9, 60, 3)
			const ring = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (V * 6 + warp))
			const streak = vnoise(U * 3, V * 34, 3, 34, 4)
			const fibre = vnoise(U * 7, V * 150, 7, 150, 5)
			const fine = vnoise(U * 14, V * 400, 14, 400, 6)
			let v = 0.36 * ring + 0.26 * streak + 0.2 * fibre + 0.12 * fine
			const pore = vnoise(U * 48, V * 220, 48, 220, 7)
			if (pore > 0.8) v -= (pore - 0.8) * 0.9
			f[y * GW + x] = v
			job.sum += v // (in the order of the one-pass version: the same bits)
			job.sum2 += v * v
		}
		job.y++
		if (performance.now() - t0 >= budgetMs) break
	}
	if (job.y < GH) return false
	const n = GW * GH
	const mean = job.sum / n
	const sd = Math.sqrt(Math.max(1e-9, job.sum2 / n - mean * mean))
	for (let i = 0; i < n; i++) f[i] = Math.min(1, Math.max(0, 0.5 + (f[i] - mean) / (5 * sd)))
	grainCache = f
	grainJob = null
	return true
}
/** A tileable grain field in 0..1: long fibres along u (x), flowing growth lines, pores. */
function grainField() {
	grainFieldStep(Infinity)
	return grainCache
}

/** Grain as a ramp from `ratio` (per channel: the dark end as a share of the light end) to 1, in linear light, drawn in sRGB.
 *  The material's colour (the tone's light end) multiplies it, so one texture serves every wood colour of the same contrast. */
const ratioKey = (ratio) => ratio.map((v) => v.toFixed(2)).join(",")
const grainCanvases = new Map()
const grainCanvasJobs = new Map() // contrast -> {canvas, ctx, img, ramp, i}: a canvas being drawn in slices
/** Advance the grain canvas of this contrast by pixels until `budgetMs` has passed (the field first, when it is not worked out yet); the canvas once it is complete, else null. */
function grainCanvasStep(ratio, budgetMs = Infinity) {
	const key = ratioKey(ratio)
	const done = grainCanvases.get(key)
	if (done) return done
	const t0 = performance.now()
	if (!grainFieldStep(budgetMs)) return null
	let job = grainCanvasJobs.get(key)
	if (!job) {
		const canvas = document.createElement("canvas")
		canvas.width = GW
		canvas.height = GH
		const ctx = canvas.getContext("2d")
		const ramp = new Uint8ClampedArray(256 * 3)
		for (let i = 0; i < 256; i++) {
			const k = smoothstep(0.1, 0.9, i / 255)
			for (let c = 0; c < 3; c++) ramp[i * 3 + c] = Math.round(255 * srgbOf(ratio[c] + (1 - ratio[c]) * k))
		}
		job = { canvas, ctx, img: ctx.createImageData(GW, GH), ramp, i: 0 }
		grainCanvasJobs.set(key, job)
	}
	const { img, ramp } = job
	const field = grainCache
	const N = GW * GH
	while (job.i < N) {
		const end = Math.min(N, job.i + 16384)
		for (let i = job.i; i < end; i++) {
			const r = Math.min(255, Math.max(0, Math.round(field[i] * 255))) * 3
			img.data[i * 4] = ramp[r]
			img.data[i * 4 + 1] = ramp[r + 1]
			img.data[i * 4 + 2] = ramp[r + 2]
			img.data[i * 4 + 3] = 255
		}
		job.i = end
		if (job.i < N && performance.now() - t0 >= budgetMs) return null
	}
	job.ctx.putImageData(img, 0, 0)
	grainCanvases.set(key, job.canvas)
	grainCanvasJobs.delete(key)
	return job.canvas
}
function grainCanvas(ratio) {
	return grainCanvasStep(ratio, Infinity)
}

/** End grain for the flat ends of a log: off-centre growth rings, a little wobble, one radial check. Same neutral ramp. */
const endCanvases = new Map()
function endGrainCanvas(ratio) {
	const key = ratioKey(ratio)
	let canvas = endCanvases.get(key)
	if (canvas) return canvas
	const S = 512
	canvas = document.createElement("canvas")
	canvas.width = canvas.height = S
	const ctx = canvas.getContext("2d")
	const img = ctx.createImageData(S, S)
	const cx = 0.44 * S
	const cy = 0.56 * S
	for (let y = 0; y < S; y++)
		for (let x = 0; x < S; x++) {
			const dx = x - cx
			const dy = y - cy
			const r = Math.hypot(dx, dy) / S
			const ang = Math.atan2(dy, dx)
			const wob = 0.05 * (vnoise(x / 70, y / 70, 8, 8, 11) - 0.5) + 0.012 * Math.sin(ang * 3 + 1)
			const ring = 0.5 + 0.5 * Math.sin(TAU * (r + wob) * 15)
			const fine = vnoise(x / 3, y / 3, 170, 170, 12)
			let v = 0.82 * smoothstep(0.1, 0.9, ring) + 0.18 * fine
			let da = Math.abs(ang - 0.7)
			da = Math.min(da, TAU - da)
			if (da < 0.014 * (1 + 3 * (1 - Math.min(1, r * 3))) && r < 0.46) v *= 0.4
			const i = (y * S + x) * 4
			for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(255 * srgbOf(ratio[c] + (1 - ratio[c]) * v))
			img.data[i + 3] = 255
		}
	ctx.putImageData(img, 0, 0)
	endCanvases.set(key, canvas)
	return canvas
}

/** Equirectangular mottling for a ball: colour map + a grayscale map used for roughness and bump, so spin is visible. */
function mottleCanvases(base, style) {
	const W = 512
	const H = 256
	const cc = document.createElement("canvas")
	cc.width = W
	cc.height = H
	const gc = document.createElement("canvas")
	gc.width = W
	gc.height = H
	const cctx = cc.getContext("2d")
	const gctx = gc.getContext("2d")
	const ci = cctx.createImageData(W, H)
	const gi = gctx.createImageData(W, H)
	const { mottle, rough, seed } = style
	for (let y = 0; y < H; y++) {
		const V = y / H
		for (let x = 0; x < W; x++) {
			const U = x / W
			const blot = vnoise(U * 5, V * 3, 5, 3, seed)
			const mid = vnoise(U * 13, V * 7, 13, 7, seed + 1)
			const fine = vnoise(U * 64, V * 32, 64, 32, seed + 2)
			const speck = vnoise(U * 150, V * 75, 150, 75, seed + 3)
			const n = 0.5 * blot + 0.3 * mid + 0.2 * fine
			const m = 1 + mottle * (n - 0.5) * 2.4 - (speck > 0.86 ? 0.07 : 0)
			const i = (y * W + x) * 4
			ci.data[i] = Math.min(255, base[0] * m)
			ci.data[i + 1] = Math.min(255, base[1] * m)
			ci.data[i + 2] = Math.min(255, base[2] * m)
			ci.data[i + 3] = 255
			const g = Math.round(255 * (rough[0] + (rough[1] - rough[0]) * (0.35 * mid + 0.4 * fine + 0.25 * speck)))
			gi.data[i] = gi.data[i + 1] = gi.data[i + 2] = g
			gi.data[i + 3] = 255
		}
	}
	cctx.putImageData(ci, 0, 0)
	gctx.putImageData(gi, 0, 0)
	return { color: cc, gray: gc }
}

// ----- ball patterns (equirectangular canvases) -----------------------------------------------------------------------
// The sphere's poles are on y and u = 0.25 faces +z (the camera), exactly three's SphereGeometry. Canvas row 0 is the +y pole.
const PW = 1024
const PH = 512
const WHITE = [244, 243, 238]
const BLACK = [24, 22, 20]
const rgbCss = (c, k = 1, a = 1) => `rgba(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))},${a})`
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const lumaOf = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
const norm3 = (v) => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1
	return [v[0] / l, v[1] / l, v[2] / l]
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function canvasOf(w, h) {
	const c = document.createElement("canvas")
	c.width = w
	c.height = h
	return [c, c.getContext("2d")]
}
/** Pixel (x, y) of a unit direction on a W x H equirectangular canvas. */
function pxOf(d, W, H) {
	let phi = Math.atan2(d[2], -d[0])
	if (phi < 0) phi += TAU
	return [(phi / TAU) * W, (Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI) * H]
}
/** Stroke a path of unit directions; the path is unwrapped across the seam and drawn three times so it never breaks. */
function strokeDirs(ctx, dirs, W, H) {
	const pts = []
	let prev = null
	let off = 0
	for (const d of dirs) {
		const p = pxOf(d, W, H)
		if (prev !== null) {
			const dx = p[0] + off - prev
			if (dx > W / 2) off -= W
			else if (dx < -W / 2) off += W
		}
		p[0] += off
		prev = p[0]
		pts.push(p)
	}
	for (const o of [-W, 0, W]) {
		ctx.beginPath()
		pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + o, p[1]) : ctx.moveTo(p[0] + o, p[1])))
		ctx.stroke()
	}
}
/** A round spot of angular radius `rho` (radians) around unit direction d, drawn as the ellipse it is on the equirect map. */
function spot(ctx, d, rho, W, H, fill) {
	const [px, py] = pxOf(d, W, H)
	const lat = Math.asin(Math.max(-1, Math.min(1, d[1])))
	const rx = ((rho / Math.max(Math.cos(lat), 0.12)) * W) / TAU
	const ry = (rho * H) / Math.PI
	for (const o of [-W, 0, W]) {
		if (px + o + rx < 0 || px + o - rx > W) continue
		ctx.save()
		ctx.translate(px + o, py)
		ctx.scale(rx, ry)
		ctx.beginPath()
		ctx.arc(0, 0, 1, 0, TAU)
		ctx.fillStyle = typeof fill === "function" ? fill(ctx) : fill
		ctx.fill()
		ctx.restore()
	}
}
const radial = (stops) => (ctx) => {
	const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
	for (const [t, c] of stops) g.addColorStop(t, c)
	return g
}
function speckle(ctx, W, H, n, seed, light, dark, a) {
	const r = rng(seed)
	for (let i = 0; i < n; i++) {
		ctx.fillStyle = r() < 0.5 ? rgbCss(light, 1, a) : rgbCss(dark, 1, a)
		ctx.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5)
	}
}
/** The baseball / tennis seam: one closed curve with two lobes up and two down, circling the pole axis. */
function seamDirs(n, b = 0.3) {
	const c = 2 * Math.sqrt(b) // c^2 = 4ab keeps every point on one sphere
	const out = []
	for (let i = 0; i <= n; i++) {
		const t = (i / n) * TAU
		const x = Math.cos(t) + b * Math.cos(3 * t)
		const y = Math.sin(t) - b * Math.sin(3 * t)
		const z = c * Math.sin(2 * t)
		out.push(norm3([x, z, y])) // wavy ring around the y pole axis
	}
	return out
}

const PATTERNS = {
	superball(base) {
		return { mottle: true, base }
	},
	pingpong(base) {
		const [c, g] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(base)
		g.fillRect(0, 0, PW, PH)
		speckle(g, PW, PH, 9000, 5, mixRgb(base, WHITE, 0.5), mixRgb(base, BLACK, 0.2), 0.05)
		// the moulding seam, and the printed three-star mark
		g.strokeStyle = rgbCss(mixRgb(base, BLACK, 0.2), 1, 0.35)
		g.lineWidth = 3
		strokeDirs(g, Array.from({ length: 65 }, (_, i) => [Math.cos((i / 64) * TAU), Math.sin((i / 64) * TAU), 0.001]), PW, PH)
		const ink = lumaOf(base) > 0.55 ? [38, 66, 140] : WHITE
		g.strokeStyle = rgbCss(ink, 1, 0.9)
		g.lineWidth = 5
		const ring = Array.from({ length: 41 }, (_, i) => {
			const a = (i / 40) * TAU
			return norm3([0.22 * Math.cos(a), 0.22 * Math.sin(a), 1]) // a ring around +z, the side facing the camera
		})
		strokeDirs(g, ring, PW, PH)
		g.fillStyle = rgbCss(ink, 1, 0.9)
		g.font = "bold 46px sans-serif"
		g.textAlign = "center"
		g.textBaseline = "middle"
		g.fillText("★★★", PW * 0.25, PH * 0.5)
		return { color: c }
	},
	tennis(base) {
		const [c, g] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(base)
		g.fillRect(0, 0, PW, PH)
		speckle(g, PW, PH, 26000, 6, mixRgb(base, WHITE, 0.35), mixRgb(base, BLACK, 0.3), 0.1)
		const seam = seamDirs(160)
		g.lineCap = "round"
		g.lineJoin = "round"
		g.strokeStyle = rgbCss(BLACK, 1, 0.18)
		g.lineWidth = 24
		strokeDirs(g, seam, PW, PH)
		g.strokeStyle = rgbCss(WHITE)
		g.lineWidth = 15
		strokeDirs(g, seam, PW, PH)
		return { color: c }
	},
	golf(base) {
		const [c, g] = canvasOf(PW, PH)
		const [b, bg] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(base)
		g.fillRect(0, 0, PW, PH)
		bg.fillStyle = "rgb(205,205,205)"
		bg.fillRect(0, 0, PW, PH)
		const N = 340
		const rho = 0.088
		for (let i = 0; i < N; i++) {
			const y = 1 - (2 * (i + 0.5)) / N
			const r = Math.sqrt(1 - y * y)
			const l = i * 2.399963
			const d = [r * Math.cos(l), y, r * Math.sin(l)]
			spot(g, d, rho, PW, PH, radial([[0, rgbCss(BLACK, 1, 0.2)], [0.75, rgbCss(BLACK, 1, 0.1)], [1, rgbCss(BLACK, 1, 0)]]))
			spot(bg, d, rho, PW, PH, radial([[0, "rgb(30,30,30)"], [0.65, "rgb(60,60,60)"], [1, "rgb(205,205,205)"]]))
		}
		return { color: c, bump: b, bumpScale: 3 }
	},
	baseball(base) {
		const [c, g] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(base)
		g.fillRect(0, 0, PW, PH)
		speckle(g, PW, PH, 9000, 8, WHITE, mixRgb(base, BLACK, 0.3), 0.05)
		const N = 216 // two rows of 108 stitches
		const seam = seamDirs(N)
		g.strokeStyle = rgbCss(mixRgb(base, BLACK, 0.35), 1, 0.7)
		g.lineWidth = 3
		strokeDirs(g, seam, PW, PH)
		g.strokeStyle = "rgb(178,32,40)"
		g.lineWidth = 3.2
		g.lineCap = "round"
		const P = seamDirs(N * 4)
		for (let i = 0; i < N; i++) {
			const a = P[i * 4]
			const nxt = P[i * 4 + 1]
			const tan = norm3([nxt[0] - a[0], nxt[1] - a[1], nxt[2] - a[2]])
			const side = norm3(cross3(a, tan))
			for (const s of [-1, 1]) {
				const p0 = norm3([a[0] + s * side[0] * 0.012, a[1] + s * side[1] * 0.012, a[2] + s * side[2] * 0.012])
				const p1 = norm3([a[0] + s * side[0] * 0.062 + tan[0] * 0.012, a[1] + s * side[1] * 0.062 + tan[1] * 0.012, a[2] + s * side[2] * 0.062 + tan[2] * 0.012])
				strokeDirs(g, [p0, p1], PW, PH)
			}
		}
		return { color: c }
	},
	basketball(base) {
		const [c, g] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(base)
		g.fillRect(0, 0, PW, PH)
		speckle(g, PW, PH, 30000, 9, mixRgb(base, WHITE, 0.3), mixRgb(base, BLACK, 0.45), 0.18)
		g.strokeStyle = rgbCss([22, 14, 8])
		g.lineWidth = 11
		g.lineCap = "round"
		const meridian = (lam) => Array.from({ length: 65 }, (_, i) => {
			const th = 0.004 + (i / 64) * (Math.PI - 0.008)
			return [-Math.cos(lam) * Math.sin(th), Math.cos(th), Math.sin(lam) * Math.sin(th)]
		})
		strokeDirs(g, Array.from({ length: 129 }, (_, i) => [-Math.cos((i / 128) * TAU), 0, Math.sin((i / 128) * TAU)]), PW, PH) // equator
		strokeDirs(g, meridian(0), PW, PH)
		strokeDirs(g, meridian(Math.PI), PW, PH)
		// the two curved channels, one each side
		for (const side of [0.25, 0.75])
			for (const s of [-1, 1]) {
				const arc = Array.from({ length: 65 }, (_, i) => {
					const th = 0.12 + (i / 64) * (Math.PI - 0.24)
					const lam = side * TAU + s * 0.62 * Math.sin(th) ** 1.5 * (side === 0.25 ? 1 : -1)
					return [-Math.cos(lam) * Math.sin(th), Math.cos(th), Math.sin(lam) * Math.sin(th)]
				})
				strokeDirs(g, arc, PW, PH)
			}
		return { color: c }
	},
	soccer(base) {
		const phi = (1 + Math.sqrt(5)) / 2
		const ico = []
		for (const a of [-1, 1])
			for (const b of [-1, 1]) {
				ico.push(norm3([0, a, b * phi]), norm3([a, b * phi, 0]), norm3([b * phi, 0, a]))
			}
		const adj = (a, b) => Math.abs(dot3(a, b) - 1 / Math.sqrt(5)) < 0.01
		const faces = []
		for (let i = 0; i < 12; i++)
			for (let j = i + 1; j < 12; j++)
				for (let k = j + 1; k < 12; k++) if (adj(ico[i], ico[j]) && adj(ico[j], ico[k]) && adj(ico[i], ico[k])) faces.push(norm3([ico[i][0] + ico[j][0] + ico[k][0], ico[i][1] + ico[j][1] + ico[k][1], ico[i][2] + ico[j][2] + ico[k][2]]))
		// the pentagon/hexagon edge sits where a pentagon's score equals its neighbour hexagon's: weight the pentagons by that gap
		const A = ico[0]
		const nb = ico.filter((v) => adj(A, v))
		const B = nb[0]
		const C = nb.find((v) => adj(B, v))
		const m = norm3([(2 * A[0] + B[0]) / 3 + (2 * A[0] + C[0]) / 3, (2 * A[1] + B[1]) / 3 + (2 * A[1] + C[1]) / 3, (2 * A[2] + B[2]) / 3 + (2 * A[2] + C[2]) / 3])
		const H0 = norm3([A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]])
		const bias = dot3(m, A) - dot3(m, H0)
		const centres = [...ico, ...faces]
		const W = PW
		const H = PH
		const [c, g] = canvasOf(W, H)
		const img = g.createImageData(W, H)
		const sinT = new Float32Array(H)
		const cosT = new Float32Array(H)
		for (let y = 0; y < H; y++) {
			const th = ((y + 0.5) / H) * Math.PI
			sinT[y] = Math.sin(th)
			cosT[y] = Math.cos(th)
		}
		const lit = base
		const seamCol = mixRgb(base, [90, 90, 90], 0.6)
		for (let x = 0; x < W; x++) {
			const ph = ((x + 0.5) / W) * TAU
			const cp = -Math.cos(ph)
			const sp = Math.sin(ph)
			for (let y = 0; y < H; y++) {
				const dx = cp * sinT[y]
				const dy = cosT[y]
				const dz = sp * sinT[y]
				let best = -9
				let second = -9
				let bi = 0
				for (let k = 0; k < 32; k++) {
					const cc = centres[k]
					const s = dx * cc[0] + dy * cc[1] + dz * cc[2] - (k < 12 ? bias : 0)
					if (s > best) {
						second = best
						best = s
						bi = k
					} else if (s > second) second = s
				}
				const gap = best - second
				const edge = 1 - smoothstep(0.003, 0.016, gap)
				const col = bi < 12 ? BLACK : lit
				const i = (y * W + x) * 4
				img.data[i] = col[0] + (seamCol[0] - col[0]) * edge * (bi < 12 ? 0.25 : 0.8)
				img.data[i + 1] = col[1] + (seamCol[1] - col[1]) * edge * (bi < 12 ? 0.25 : 0.8)
				img.data[i + 2] = col[2] + (seamCol[2] - col[2]) * edge * (bi < 12 ? 0.25 : 0.8)
				img.data[i + 3] = 255
			}
		}
		g.putImageData(img, 0, 0)
		return { color: c }
	},
	bowling(base) {
		const [c, g] = canvasOf(PW, PH)
		g.fillStyle = rgbCss(mixRgb(base, BLACK, 0.2))
		g.fillRect(0, 0, PW, PH)
		// pearly swirls
		for (let k = 0; k < 7; k++) {
			g.strokeStyle = rgbCss(mixRgb(base, WHITE, 0.25 + 0.04 * k), 1, 0.2)
			g.lineWidth = 26 + 12 * (k % 3)
			g.beginPath()
			for (let x = -10; x <= PW + 10; x += 6) {
				const y = PH * (0.18 + 0.64 * ((k + 0.5) / 7)) + PH * 0.1 * Math.sin((x / PW) * TAU * 2 + k * 1.7)
				x === -10 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
			g.stroke()
		}
		// three finger holes, facing the camera
		const hole = radial([[0, "rgb(4,4,4)"], [0.8, "rgb(10,10,10)"], [1, "rgba(0,0,0,0.0)"]])
		for (const [dx, dy, r] of [[-0.16, 0.2, 0.11], [0.16, 0.2, 0.11], [0, -0.2, 0.125]]) spot(g, norm3([dx, dy, 1]), r, PW, PH, hole)
		return { color: c }
	},
	marble(base) {
		const [c, g] = canvasOf(PW, PH)
		const grad = g.createLinearGradient(0, 0, 0, PH)
		grad.addColorStop(0, rgbCss(mixRgb(base, BLACK, 0.1)))
		grad.addColorStop(0.5, rgbCss(mixRgb(base, WHITE, 0.15)))
		grad.addColorStop(1, rgbCss(mixRgb(base, BLACK, 0.1)))
		g.fillStyle = grad
		g.fillRect(0, 0, PW, PH)
		g.lineCap = "round"
		const bands = [mixRgb(base, WHITE, 0.85), mixRgb(base, BLACK, 0.45), mixRgb(base, WHITE, 0.5)]
		bands.forEach((col, b) => {
			g.strokeStyle = rgbCss(col, 1, 0.9)
			g.lineWidth = 34 + 12 * b
			g.beginPath()
			for (let x = -10; x <= PW + 10; x += 5) {
				const y = PH * 0.5 + PH * 0.3 * Math.sin((x / PW) * TAU * 2 + b * 2.1) + PH * 0.06 * Math.sin((x / PW) * TAU * 5 + b)
				x === -10 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
			g.stroke()
		})
		return { color: c }
	},
	beach(base) {
		const [c, g] = canvasOf(PW, PH)
		const pal = [base, WHITE, [242, 194, 48], WHITE, [47, 127, 216], WHITE]
		pal.forEach((col, i) => {
			g.fillStyle = rgbCss(col)
			g.fillRect((i * PW) / 6 - 0.5, 0, PW / 6 + 1, PH)
		})
		g.fillStyle = rgbCss(WHITE)
		g.fillRect(0, 0, PW, PH * 0.07)
		g.fillRect(0, PH * 0.93, PW, PH * 0.07)
		g.fillStyle = rgbCss([40, 40, 40], 1, 0.5)
		g.fillRect(0, PH * 0.07 - 1, PW, 2)
		g.fillRect(0, PH * 0.93 - 1, PW, 2)
		return { color: c }
	},
	billiard(base, number = 8) {
		const [c, g] = canvasOf(PW, PH)
		const striped = number > 8
		g.fillStyle = rgbCss(striped ? WHITE : base)
		g.fillRect(0, 0, PW, PH)
		if (striped) {
			g.fillStyle = rgbCss(base)
			g.fillRect(0, PH * 0.27, PW, PH * 0.46)
		}
		for (const u of [0.25, 0.75]) {
			const d = [-Math.cos(u * TAU), 0, Math.sin(u * TAU)]
			spot(g, d, 0.42, PW, PH, rgbCss(WHITE))
			g.fillStyle = "rgb(20,20,20)"
			g.font = "bold 76px sans-serif"
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.fillText(String(number), PW * u, PH * 0.5 + 4)
		}
		return { color: c }
	},
	wooden(base) {
		// a turned wooden ball: growth rings are lines of latitude around the pole axis, wobbling a little with the grain
		const [c, g] = canvasOf(PW, PH)
		const img = g.createImageData(PW, PH)
		const dark = mixRgb(base, BLACK, 0.4)
		const light = mixRgb(base, WHITE, 0.14)
		for (let y = 0; y < PH; y++)
			for (let x = 0; x < PW; x++) {
				const wob = 0.9 * vnoise(x / 120, y / 90, 9, 6, 21) + 0.15 * vnoise(x / 14, y / 10, 74, 52, 22)
				const ring = 0.5 + 0.5 * Math.sin(TAU * ((y / PH) * 16 + wob))
				const k = smoothstep(0.15, 0.85, ring)
				const i = (y * PW + x) * 4
				img.data[i] = dark[0] + (light[0] - dark[0]) * k
				img.data[i + 1] = dark[1] + (light[1] - dark[1]) * k
				img.data[i + 2] = dark[2] + (light[2] - dark[2]) * k
				img.data[i + 3] = 255
			}
		g.putImageData(img, 0, 0)
		return { color: c }
	},
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------------------------------
/** Deterministic 0..1 value from a string (per-part grain offsets, so no two planks look cut from the same spot). */
function hashString(s, k) {
	let h = 2166136261 ^ k
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/** Wood UVs for a box-like mesh: the grain runs along the part's longest axis on every face. */
function mapBoxGrain(geo, dims, tile, id) {
	const { u: tileU, v: tileV } = tile
	const pos = geo.attributes.position
	const nor = geo.attributes.normal
	const uv = new Float32Array(pos.count * 2)
	const L = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2
	const ou = hashString(id, 1)
	const ov = hashString(id, 2)
	const p = [0, 0, 0]
	const n = [0, 0, 0]
	for (let i = 0; i < pos.count; i++) {
		p[0] = pos.getX(i)
		p[1] = pos.getY(i)
		p[2] = pos.getZ(i)
		n[0] = Math.abs(nor.getX(i))
		n[1] = Math.abs(nor.getY(i))
		n[2] = Math.abs(nor.getZ(i))
		const a = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2
		let u
		let v
		if (a === L) {
			// end grain: use the two cross axes
			const o = [0, 1, 2].filter((k) => k !== L)
			u = p[o[0]]
			v = p[o[1]]
		} else {
			const m = [0, 1, 2].find((k) => k !== a && k !== L)
			u = p[L]
			v = p[m]
		}
		uv[i * 2] = u / tileU + ou
		uv[i * 2 + 1] = v / tileV + ov
	}
	geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
}

/** A wooden dowel of unit length along y (scale it to the length you need; rotate it afterwards): grain along its length. */
function dowelGeometry(radius, tone, id, radial = 24) {
	const g = new THREE.CylinderGeometry(radius, radius, 1, radial, 1)
	const { u: tileU, v: tileV } = TILES[tone]
	const pos = g.attributes.position
	const nor = g.attributes.normal
	const uv0 = g.attributes.uv
	const uv = new Float32Array(pos.count * 2)
	const ou = hashString(id, 3)
	const ov = hashString(id, 4)
	const circ = 2 * Math.PI * radius
	for (let i = 0; i < pos.count; i++) {
		if (Math.abs(nor.getY(i)) > 0.9) {
			uv[i * 2] = (pos.getX(i) / tileU) * 0.5 + ou
			uv[i * 2 + 1] = pos.getZ(i) / tileV + ov
		} else {
			uv[i * 2] = (uv0.getY(i) - 0.5) / tileU + ou
			uv[i * 2 + 1] = (uv0.getX(i) * circ) / tileV + ov
		}
	}
	g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
	return g
}

/** A round body that is a cylinder along z (a log, a wheel seen end-on): grain along its length, flat ends. */
function logGeometry(radius, length, tile, id, grain) {
	const g = new THREE.CylinderGeometry(radius, radius, length, 56, 1)
	if (grain) {
		const pos = g.attributes.position
		const nor = g.attributes.normal
		const uv0 = g.attributes.uv
		const uv = new Float32Array(pos.count * 2)
		const ou = hashString(id, 5)
		const ov = hashString(id, 6)
		const circ = 2 * Math.PI * radius
		for (let i = 0; i < pos.count; i++) {
			if (Math.abs(nor.getY(i)) > 0.9) {
				uv[i * 2] = uv0.getX(i) // the end-grain disc is laid out by the stock cap UVs
				uv[i * 2 + 1] = uv0.getY(i)
			} else {
				uv[i * 2] = ((uv0.getY(i) - 0.5) * length) / tile.u + ou
				uv[i * 2 + 1] = (uv0.getX(i) * circ) / tile.v + ov
			}
		}
		g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
	}
	g.rotateX(Math.PI / 2) // the axis from y to z
	return g
}

/** A slab: a rounded box, or (with body.taper) the trapezoid whose bottom is that fraction of its width. Depth is body.depth. */
function slabGeometry(body, tile, id, grain) {
	const w = body.width + 2 * SKIN
	const h = body.height + 2 * SKIN
	const depth = depthOf(body)
	let g
	if (body.taper !== undefined && Math.abs(body.taper - 1) > 1e-6) {
		const hw = w / 2
		const hh = h / 2
		const tp = body.taper
		const shape = new THREE.Shape([new THREE.Vector2(-hw * tp, -hh), new THREE.Vector2(hw * tp, -hh), new THREE.Vector2(hw, hh), new THREE.Vector2(-hw, hh)])
		g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
		g.translate(0, 0, -depth / 2)
	} else {
		const r = Math.min(0.0015, h / 4, w / 4, depth / 4)
		g = new RoundedBoxGeometry(w, h, depth, 3, r)
	}
	if (grain) mapBoxGrain(g, [w, h, depth], tile, id)
	return g
}

/**
 * A polygon solid (body.points, counter-clockwise, its own frame): the outline grown by SKIN like a slab's box, extruded
 * through body.depth, with a small bevel that keeps the silhouette and the depth exact (the bevel is cut inward). Wood
 * grain runs along its longest side-view axis, as on a slab, so a sloped face shows long grain and a steep one end grain.
 */
function polyGeometry(body, tile, id, grain) {
	const pts = body.points
	const n = pts.length
	const depth = depthOf(body)
	const normal = (a, b) => {
		const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
		return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len } // outward, for a counter-clockwise outline
	}
	// every side moved out by SKIN: each corner along its bisector
	const grown = pts.map((p, i) => {
		const n1 = normal(pts[(i + n - 1) % n], p)
		const n2 = normal(p, pts[(i + 1) % n])
		const k = SKIN / Math.max(0.05, 1 + n1.x * n2.x + n1.y * n2.y)
		return new THREE.Vector2(p.x + (n1.x + n2.x) * k, p.y + (n1.y + n2.y) * k)
	})
	let side = Infinity
	let perimeter = 0
	let area = 0
	for (let i = 0; i < n; i++) {
		const a = grown[i]
		const b = grown[(i + 1) % n]
		side = Math.min(side, a.distanceTo(b))
		perimeter += a.distanceTo(b)
		area += (a.x * b.y - b.x * a.y) / 2
	}
	const bevel = Math.min(0.0015, side / 4, depth / 4, area / perimeter / 2) // inradius / 2: the inset outline never folds over
	const core = depth - 2 * bevel
	const g = new THREE.ExtrudeGeometry(new THREE.Shape(grown), {
		depth: core,
		steps: 1,
		curveSegments: 1,
		bevelEnabled: bevel > 1e-5,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: -bevel,
		bevelSegments: 2,
	})
	g.translate(0, 0, -core / 2)
	if (grain) {
		const xs = grown.map((p) => p.x)
		const ys = grown.map((p) => p.y)
		mapBoxGrain(g, [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), depth], tile, id)
	}
	return g
}

/** Where a turned polygon solid touches down: x of its lowest corners, their x spread and their height above the tabletop. */
function polyFoot(points, q, out) {
	const c = Math.cos(q.angle)
	const s = Math.sin(q.angle)
	let ymin = Infinity
	for (const p of points) ymin = Math.min(ymin, q.y + p.x * s + p.y * c)
	let x0 = Infinity
	let x1 = -Infinity
	for (const p of points) {
		if (q.y + p.x * s + p.y * c > ymin + 0.004) continue
		const x = q.x + p.x * c - p.y * s
		x0 = Math.min(x0, x)
		x1 = Math.max(x1, x)
	}
	out.x = (x0 + x1) / 2
	out.span = x1 - x0
	out.h = Math.max(0, ymin - TABLE_TOP)
	return out
}

const _fx = [0, 0, 0, 0]
const _fy = [0, 0, 0, 0]
/** Where a rotated slab touches down: x of its lowest edge, the x spread of that edge and its height above the tabletop. */
function slabFoot(hw, hh, q, out) {
	const c = Math.cos(q.angle)
	const s = Math.sin(q.angle)
	let ymin = Infinity
	let k = 0
	for (const sx of [-1, 1])
		for (const sy of [-1, 1]) {
			_fx[k] = q.x + sx * hw * c - sy * hh * s
			_fy[k] = q.y + sx * hw * s + sy * hh * c
			ymin = Math.min(ymin, _fy[k])
			k++
		}
	let x0 = Infinity
	let x1 = -Infinity
	for (let i = 0; i < 4; i++)
		if (_fy[i] <= ymin + 0.004) {
			x0 = Math.min(x0, _fx[i])
			x1 = Math.max(x1, _fx[i])
		}
	out.x = (x0 + x1) / 2
	out.span = x1 - x0
	out.h = Math.max(0, ymin - TABLE_TOP)
	return out
}

/** A soft round falloff, black with alpha: the contact shading ("ambient occlusion") laid on the table under things that touch it. */
let blobCanvas = null
function blobCanvasOnce() {
	if (blobCanvas) return blobCanvas
	const c = document.createElement("canvas")
	c.width = c.height = 128
	const g = c.getContext("2d")
	const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
	grad.addColorStop(0, "rgba(0,0,0,1)")
	grad.addColorStop(0.3, "rgba(0,0,0,0.62)")
	grad.addColorStop(0.62, "rgba(0,0,0,0.18)")
	grad.addColorStop(1, "rgba(0,0,0,0)")
	g.fillStyle = grad
	g.fillRect(0, 0, 128, 128)
	blobCanvas = c
	return c
}

const hexRgb = (h) => {
	const c = new THREE.Color(h)
	const s = c.getHexString(THREE.SRGBColorSpace)
	const n = parseInt(s, 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const normHex = (h) => "#" + new THREE.Color(h).getHexString(THREE.SRGBColorSpace)

const isRound = (s) => s.body.kind === "ball"
const depthOf = (body) => body.depth ?? 0.1 // front-to-back size of a slab (the contract always gives it; a missing one gets a plank's 10 cm)
/** The tabletop: the broad static slab whose top is the floor of the machine (y = 0). */
const isTableSolid = (s) => s.kind === "static" && s.body.kind === "slab" && s.body.depth >= 1.2 && Math.abs(s.at.y + s.body.height / 2) < 0.03

// ---------------------------------------------------------------------------------------------------------------------
// Joint hardware (CONTRACT.md Phase 2): textures and geometry. Module level, drawn once, shared by every view.
// Everything that stretches (a spring, a rope) is built at unit length and scaled along its axis; see the vertex hooks.
// ---------------------------------------------------------------------------------------------------------------------
const ROPE_PITCH = 0.016 // meters of rope per braid repeat
const BELT_PERIOD = 0.04 // meters of belt per rib
const TREAD_LUGS = 18 // lugs around a tyre

/** A w x h canvas painted per pixel by f(u, v) -> [r, g, b] (0..255). */
function paintCanvas(w, h, f) {
	const [c, g] = canvasOf(w, h)
	const img = g.createImageData(w, h)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const px = f(x / w, y / h)
			const i = (y * w + x) * 4
			img.data[i] = px[0]
			img.data[i + 1] = px[1]
			img.data[i + 2] = px[2]
			img.data[i + 3] = 255
		}
	g.putImageData(img, 0, 0)
	return c
}
const frac = (x) => x - Math.floor(x)
const once = (make) => {
	let v
	return () => (v ??= make())
}

/** Three-strand rope: diagonal strands that tile around (u) and along (v) the rope. */
const ropeCanvas = once(() =>
	paintCanvas(64, 64, (u, v) => {
		const p = 0.5 - 0.5 * Math.cos(TAU * frac(u * 3 + v))
		const k = (0.3 + 0.7 * Math.pow(p, 0.7)) * (0.86 + 0.28 * vnoise(u * 16, v * 16, 16, 16, 91))
		return [208 * k, 172 * k, 112 * k]
	}),
)
/** Rubber belt: dark, finely mottled, with a raised rib across it once per period (u runs along the belt). */
const beltCanvas = once(() =>
	paintCanvas(128, 64, (u, v) => {
		const rib = smoothstep(0, 0.03, u) * (1 - smoothstep(0.1, 0.13, u)) * smoothstep(0.02, 0.05, v) * (1 - smoothstep(0.95, 0.98, v))
		const k = 30 + 9 * vnoise(u * 32, v * 16, 32, 16, 92) + 44 * rib
		return [k, k, k * 1.06]
	}),
)
/** Tyre tread: chevron lugs; u runs around the wheel, v across the tread. */
const treadCanvas = once(() =>
	paintCanvas(64, 64, (u, v) => {
		const f = frac(u + 0.5 * Math.abs(v - 0.5))
		const lug = smoothstep(0, 0.07, f) * (1 - smoothstep(0.56, 0.63, f))
		const k = 22 + 34 * lug + 5 * vnoise(u * 32, v * 32, 32, 32, 93)
		return [k, k, k * 1.04]
	}),
)

/** A coil of `turns` turns and radius R (wire radius w) along y from 0 to 1, tapering onto the axis at both ends. The wire's own
 *  size is in meters; aAxis holds each vertex's point on the wire's centre line, so the vertex hook can stretch the axis alone.
 *  `cuts` straight pieces per turn and `radial` sides round the wire: chosen by the coil's size in the picture (see coilLevel). */
function coilGeometry(turns, R, w, cuts = 18, radial = 8) {
	const N = Math.max(16, Math.round(turns * cuts))
	const Rc = R * roundOut(cuts) // (polygons as wide on average as the circles they stand for: the coil and the wire look the same at every level)
	const curve = new THREE.Curve()
	curve.getPoint = (t, out = new THREE.Vector3()) => {
		const env = smoothstep(0, 0.06, t) * smoothstep(0, 0.06, 1 - t)
		const a = TAU * turns * t
		return out.set(Rc * env * Math.cos(a), t, Rc * env * Math.sin(a))
	}
	curve.getUtoTmapping = (u) => u
	const RS = radial
	const g = new THREE.TubeGeometry(curve, N, w * roundOut(radial), RS, false)
	const pos = g.attributes.position
	const axis = new Float32Array(pos.count * 3)
	for (let i = 0; i <= N; i++) {
		let cx = 0
		let cy = 0
		let cz = 0
		for (let j = 0; j < RS; j++) {
			const k = i * (RS + 1) + j
			cx += pos.getX(k)
			cy += pos.getY(k)
			cz += pos.getZ(k)
		}
		for (let j = 0; j <= RS; j++) {
			const k = (i * (RS + 1) + j) * 3
			axis[k] = cx / RS
			axis[k + 1] = cy / RS
			axis[k + 2] = cz / RS
		}
	}
	g.setAttribute("aAxis", new THREE.BufferAttribute(axis, 3))
	return g
}

/** A conveyor belt as one closed band round a stadium of size w x h, depth `depth` along z. Group 0 is the band (u along the belt,
 *  a whole number of `period`s round it; v across), group 1 the two flat sides. */
function beltGeometry(w, h, depth, period) {
	const r = h / 2
	const hw = Math.max(0, (w - h) / 2)
	const ARC = 14
	const pts = [[-hw, r, 0, 1]]
	for (let k = 0; k <= ARC; k++) {
		const th = Math.PI / 2 - (Math.PI * k) / ARC
		pts.push([hw + r * Math.cos(th), r * Math.sin(th), Math.cos(th), Math.sin(th)])
	}
	for (let k = 0; k <= ARC; k++) {
		const th = -Math.PI / 2 - (Math.PI * k) / ARC
		pts.push([-hw + r * Math.cos(th), r * Math.sin(th), Math.cos(th), Math.sin(th)])
	}
	const n = pts.length
	const s = new Float64Array(n)
	for (let k = 1; k < n; k++) s[k] = s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
	const perimeter = s[n - 1]
	const unit = perimeter / Math.max(1, Math.round(perimeter / period))
	const pos = []
	const nor = []
	const uv = []
	const idx = []
	for (let k = 0; k < n; k++)
		for (const z of [-depth / 2, depth / 2]) {
			pos.push(pts[k][0], pts[k][1], z)
			nor.push(pts[k][2], pts[k][3], 0)
			uv.push(s[k] / unit, z > 0 ? 1 : 0)
		}
	for (let k = 0; k + 1 < n; k++) {
		const a = k * 2
		const b = a + 1
		const c = a + 2
		const d = a + 3
		idx.push(a, b, d, a, d, c)
	}
	const bandCount = idx.length
	// the two flat sides: a fan round the centre
	for (const z of [depth / 2, -depth / 2]) {
		const centre = pos.length / 3
		pos.push(0, 0, z)
		nor.push(0, 0, Math.sign(z))
		uv.push(0.5, 0.5)
		const ring = pos.length / 3
		for (let k = 0; k < n; k++) {
			pos.push(pts[k][0], pts[k][1], z)
			nor.push(0, 0, Math.sign(z))
			uv.push(0.5, 0.5)
		}
		for (let k = 0; k + 1 < n; k++) {
			if (z > 0) idx.push(centre, ring + k + 1, ring + k)
			else idx.push(centre, ring + k, ring + k + 1)
		}
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
	g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
	g.setIndex(idx)
	g.addGroup(0, bandCount, 0)
	g.addGroup(bandCount, idx.length - bandCount, 1)
	g.userData.unit = unit // meters of belt per texture repeat
	return g
}

/** A tyre of outer radius R and width W: a rounded rubber ring round the z axis, u round it, v across the tread. */
function tyreGeometry(R, W) {
	const rIn = 0.64 * R
	const c = Math.min(0.28 * W, 0.14 * R)
	const pts = [new THREE.Vector2(rIn, -W / 2), new THREE.Vector2(R - c, -W / 2)]
	for (let k = 1; k <= 4; k++) {
		const a = (k / 4) * (Math.PI / 2)
		pts.push(new THREE.Vector2(R - c + c * Math.sin(a), -W / 2 + c * (1 - Math.cos(a))))
	}
	for (let k = 0; k <= 4; k++) {
		const a = (k / 4) * (Math.PI / 2)
		pts.push(new THREE.Vector2(R - c + c * Math.cos(a), W / 2 - c + c * Math.sin(a)))
	}
	pts.push(new THREE.Vector2(rIn, W / 2))
	return new THREE.LatheGeometry(pts, 56).rotateX(Math.PI / 2)
}

/** The wheel's steel: a hub through it and five spokes laid on both faces, so turning shows. */
function wheelSteelGeometry(R, W) {
	const parts = [new THREE.CylinderGeometry(0.2 * R, 0.2 * R, W * 1.06, 20).rotateX(Math.PI / 2)]
	for (const side of [-1, 1])
		for (let k = 0; k < 5; k++) {
			const bar = new THREE.BoxGeometry(0.1 * R, 0.5 * R, 0.1 * W)
			bar.translate(0, 0.4 * R, 0)
			bar.rotateZ((k / 5) * TAU)
			bar.translate(0, 0, side * W * 0.46)
			parts.push(bar)
		}
	return mergeGeometries(parts)
}

/** A grooved pulley wheel (outer radius Rw, rope radius rho, groove floor Rw - 3 rho) round the z axis: a rim with the groove, a web recessed on both faces, a hub
*  boss and six raised ribs between hub and rim (the ribs turn with it, so a turning wheel shows). userData.half = half the rim's thickness. */
function pulleyGeometry(Rw, rho) {
	const B = 1.3 * rho
	const A = B + 0.00175
	const rg = Rw - 3 * rho
	const e = Math.min(0.0004, 0.02 * Rw)
	const hubR = 0.24 * Rw
	const rimIn = Math.max(hubR + 0.004, Math.min(rg - 0.002, 0.64 * Rw))
	const webZ = 0.5 * A
	const half = [[hubR, A], [hubR, webZ], [rimIn, webZ], [rimIn, A], [Rw - e, A], [Rw, A - e], [Rw, B], [rg, 0.9 * rho]] // (the +z half, from the hub out to the groove floor)
	const P = [[0, -A]] // (the profile runs from the axis at the -z face out over that face, the rim and the groove, and back over the +z face)
	for (const q of half) P.push([q[0], -q[1]])
	for (let i = half.length - 1; i >= 0; i--) P.push(half[i])
	P.push([0, A])
	const parts = [new THREE.LatheGeometry(P.map(([x, y]) => new THREE.Vector2(x, y)), 56).rotateX(Math.PI / 2)]
	const len = rimIn - hubR + 0.002
	const rz = A - webZ - 0.0004 // the ribs stand this far off the recessed web, a little under the rim's face
	for (const side of [-1, 1])
		for (let k = 0; k < 6; k++) {
			const rib = new THREE.BoxGeometry(len, Math.max(0.0015, 0.09 * Rw), rz + 0.0008)
			rib.translate((hubR + rimIn) / 2 - 0.001, 0, 0)
			rib.rotateZ((k / 6) * TAU)
			rib.translate(0, 0, side * (webZ + rz / 2 - 0.0004))
			parts.push(rib)
		}
	const g = mergeGeometries(parts)
	g.userData.half = A
	return g
}
/** A length of rope laid on a wheel: radius rc round the z axis, from angle a0 counter-clockwise to a1, in whole steps of about 1.5 degrees (WRAP_STEP). The rope on a wheel is always a
 *  part of it: the view draws the part that is wrapped (setWrap), so the rope leaves the wheel at the tangent point whatever the hanging run's slant. The braid runs round the rope in u and
 *  along it (metres) in v, as the rope pieces' own. The index buffer lists the tubular segments in order, 6 x WRAP_RADIAL indices each (setWrap relies on it). Not cached: it has its own draw range. */
const WRAP_STEP = 0.0262
const WRAP_RADIAL = 10
function ropeWrapGeometry(rc, rho, a0, a1) {
	const n = Math.max(2, Math.ceil((a1 - a0) / WRAP_STEP))
	const step = (a1 - a0) / n
	const curve = new THREE.Curve()
	curve.getPoint = (t, out = new THREE.Vector3()) => out.set(rc * Math.cos(a0 + (a1 - a0) * t), rc * Math.sin(a0 + (a1 - a0) * t), 0)
	curve.getUtoTmapping = (u) => u
	const g = new THREE.TubeGeometry(curve, n, rho, WRAP_RADIAL, false)
	const uv = g.attributes.uv
	const along = rc * (a1 - a0)
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * along)
	g.userData.wrap = { a0, a1, n, step }
	return g
}
/** The marks on a belt roller's two ends (a bar across each), which turn with it. */
function rollerMarksGeometry(rr, len) {
	const bar = (z) => new THREE.BoxGeometry(1.5 * rr, 0.28 * rr, 0.0016).translate(0, 0, z)
	return mergeGeometries([bar(len / 2 + 0.0008), bar(-len / 2 - 0.0008)])
}

/** How much a regular n-gon's corners stand out from the circle it stands for so that it is as wide as the circle on average (its perimeter's): a wire drawn with few
 *  sides is no thinner than one drawn with many (4 sides: 1.11, 8: 1.026, 16: 1.006). */
const roundOut = (n) => Math.PI / n / Math.sin(Math.PI / n)

/** One chain link: a wire of radius rw bent into a stadium (straight sides, round ends) in the x-y plane, its long axis along y. The inner
 *  opening is CHAIN_INNER_LEN x CHAIN_INNER_WID wire diameters, so a chain's pitch (centre to centre of neighbours) is CHAIN_INNER_LEN diameters.
 *  `ends` cuts round each end, ONE along each straight side (a straight wire needs no more: the cuts go where the wire bends), `radial` sides round
 *  the wire: (2 ends + 2) x radial x 2 triangles (chosen by the link's size in the picture, see chainLevel). */
function chainLinkGeometry(rw, ends = 16, radial = 8) {
	const d = 2 * rw
	const rho = (CHAIN_INNER_WID * d) / 2 + rw // the wire's centre line: half the stadium's width
	const half = (CHAIN_INNER_LEN * d) / 2 + rw // and half its length
	const st = half - rho // half the straight sides
	const S = 2 * ends + 2 // pieces round the link: side, end, side, end
	const curve = new THREE.Curve()
	curve.getPoint = (t, target = new THREE.Vector3()) => {
		let k = t * S
		if (k < 1) return target.set(rho, -st + 2 * st * k, 0) // right side, going up
		k -= 1
		if (k < ends) return target.set(rho * Math.cos((k / ends) * Math.PI), st + rho * Math.sin((k / ends) * Math.PI), 0) // the top end
		k -= ends
		if (k < 1) return target.set(-rho, st - 2 * st * k, 0) // left side, going down
		k -= 1
		const a = Math.PI + (Math.min(k, ends) / ends) * Math.PI // the bottom end
		return target.set(rho * Math.cos(a), -st + rho * Math.sin(a), 0)
	}
	curve.getUtoTmapping = (u) => u // (each piece is one segment of the tube: the samples land on the joins)
	return new THREE.TubeGeometry(curve, S, rw * roundOut(radial), radial, true)
}

// Detail by size in the picture (coils, chains): a curve cut into N straight pieces shows its corners once they stand more than a fraction of a pixel off the true
// curve, i.e. r (1 - cos(pi / N)) ~ r pi^2 / (2 N^2) px for a circle r px across, so N grows as the square root of the size on screen. The level is a pure function
// of the camera and the picture's height (the canvas's drawing buffer, an export's frame), never of what was drawn before: an export frame is the same whatever
// came before it, and the canvas's picture equals the export's "live" frame.
const LOD_SAG = 0.5 // device px: the most a cut curve may stand off the true one (MSAA and the smooth normals hide that much)
const COIL_CUTS = [8, 12, 16, 24, 32, 40, 48] // pieces per turn a coil may have
const WIRE_SIDES = [4, 6, 8, 10, 12, 16, 20, 24] // sides round a wire (20 and 24: a link or a coil seen from a few cm at 2 device px per css px)
const levelOf = (need, levels) => {
	for (const v of levels) if (v >= need) return v
	return levels[levels.length - 1]
}
/** Pieces per full circle that keep a circle of radius r px within LOD_SAG of its polygon. */
const piecesFor = (rPx) => Math.PI * Math.sqrt(Math.max(0, rPx) / (2 * LOD_SAG))
/** A coil's pieces per turn and wire sides for a coil of radius R and wire radius w (m) seen at `ppm` px per metre. `budget`: the triangles it may have (a row of coils
 *  shares one), the wire's sides then the cuts step down until it fits. */
function coilLevel(R, w, ppm, turns, budget = Infinity) {
	let ci = COIL_CUTS.indexOf(levelOf(piecesFor(R * ppm), COIL_CUTS))
	let wi = WIRE_SIDES.indexOf(levelOf(piecesFor(w * ppm), WIRE_SIDES))
	while (turns * COIL_CUTS[ci] * WIRE_SIDES[wi] * 2 > budget && (ci > 0 || wi > 0)) {
		if (wi > 0 && (WIRE_SIDES[wi] >= COIL_CUTS[ci] / 3 || ci === 0)) wi--
		else ci--
	}
	return { cuts: COIL_CUTS[ci], radial: WIRE_SIDES[wi] }
}
const COIL_TRIS = 60000 // the most triangles a single coil may have (an 80-turn hanging spring seen from 18 cm: 41k) ...
const COIL_ROW_TRIS = 200000 // ... and a row of them together (a trampoline's ten seen from 30 cm) ...
const CHAIN_TRIS = 40000 // ... and a chain's links together (the wrecking ball's 36 seen from 30 cm)
const LOD_CLOSE = 0.25 // m: a coil or chain whose nearest point is nearer than this to the camera (a close-up) may have twice those
const CHAIN_ENDS = [3, 4, 6, 8, 12, 16, 20, 24] // cuts round a link's end
const LOD_PENDING = new THREE.BufferGeometry() // a coil's or chain's geometry until a draw has picked its level (empty: three.js draws nothing of it)
/** A chain link's cuts round each end and wire sides for wire radius rw (m) at `ppm` px per metre; `budget`: the triangles the n links may have together (the wire's
 *  sides, then the cuts, step down until they fit). */
function chainLevel(rw, ppm, n, budget = Infinity) {
	const rho = (CHAIN_INNER_WID * rw + rw) * ppm // the end's radius, px
	let ei = CHAIN_ENDS.indexOf(levelOf(piecesFor(rho) / 2, CHAIN_ENDS))
	let wi = WIRE_SIDES.indexOf(levelOf(piecesFor(rw * ppm), WIRE_SIDES))
	while (n * (2 * CHAIN_ENDS[ei] + 2) * WIRE_SIDES[wi] * 2 > budget && (ei > 0 || wi > 0)) {
		if (wi > 0 && (WIRE_SIDES[wi] >= CHAIN_ENDS[ei] || ei === 0)) wi--
		else ei--
	}
	return { ends: CHAIN_ENDS[ei], radial: WIRE_SIDES[wi] }
}

// ---------------------------------------------------------------------------------------------------------------------
// Resting gap (visual only). Box2D's contact skin keeps a resting slab or polygon 1.5-2 mm above what it stands on; a model is drawn at its exact
// outline, so it seemed to hover. A slab or polygon whose lowest point is within REST_BAND above the tabletop or the top of a static slab under it
// is drawn lowered onto it (fading out by REST_FADE: a part that lifts off does not pop), and one that the grown meshes sink into it (up to REST_SINK,
// as at the editor's start pose) is raised onto it. A part that stands on another mover takes that mover's offset (the gap between them stays the
// physics'); a hinged part is not moved. Models are not scaled; only the holder moves.
// ---------------------------------------------------------------------------------------------------------------------
const _part = { x: 0, y: 0, angle: 0 } // (updateParts' scratch pose)
const _gx = new Float64Array(8)
const _gy = new Float64Array(8)
const _probe = { gap: Infinity, c: 1, sup: null }
/** What the part `rest` standing at pose q ({x, y, angle}) rests on among `supports` ({id, x, y, c, s, hw, hh, grow, ...}: the top faces of slabs,
 *  c = cos, s = sin of their angle): into _probe, the gap (m, perpendicular to that face; Infinity when there is none), its cos and the support.
 *  rest = {id, pts | hw, hh, grow}; grow = how far the drawn mesh sticks out of its outline. */
function probeRest(rest, q, supports) {
	const c = Math.cos(q.angle)
	const s = Math.sin(q.angle)
	let n = 0
	let ymin = Infinity
	if (rest.pts) {
		const pts = rest.pts
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i]
			_gx[n] = q.x + p.x * c - p.y * s
			_gy[n] = q.y + p.x * s + p.y * c
			if (_gy[n] < ymin) ymin = _gy[n]
			n++
		}
	} else {
		for (let i = 0; i < 4; i++) {
			const sx = i & 1 ? 1 : -1
			const sy = i & 2 ? 1 : -1
			_gx[n] = q.x + sx * rest.hw * c - sy * rest.hh * s
			_gy[n] = q.y + sx * rest.hw * s + sy * rest.hh * c
			if (_gy[n] < ymin) ymin = _gy[n]
			n++
		}
	}
	let best = Infinity // the smallest height of a lowest corner above the top face under it
	let bestC = 1
	let bestSup = null
	for (let k = 0; k < n; k++) {
		if (_gy[k] > ymin + 0.0015) continue // only the corners that touch down
		for (let i = 0; i < supports.length; i++) {
			const sp = supports[i]
			if (sp.c < 0.5 || sp.id === rest.id) continue // a face that does not look up, or the part itself
			const dx = _gx[k] - sp.x
			const dy = _gy[k] - sp.y
			const lx = dx * sp.c + dy * sp.s
			if (lx < -sp.hw || lx > sp.hw) continue
			const g = -dx * sp.s + dy * sp.c - sp.hh - sp.grow - rest.grow
			if (g > -REST_SINK && g < best) {
				best = g
				bestC = sp.c
				bestSup = sp
			}
		}
	}
	_probe.gap = best
	_probe.c = bestC
	_probe.sup = bestSup
}

/** How far (m) to draw the part `rest` at pose q lowered onto what it stands on (a negative number: raised, where the grown meshes sink into it): 0 when
 *  it stands on nothing within REST_FADE. */
function restLowering(rest, q, supports) {
	probeRest(rest, q, supports)
	const best = _probe.gap
	if (best >= REST_FADE) return 0 // (Infinity: nothing under it)
	if (best <= 0) return best / _probe.c
	let k = 1
	if (best > REST_BAND) {
		const u = (best - REST_BAND) / (REST_FADE - REST_BAND)
		k = 1 - u * u * (3 - 2 * u)
	}
	return (best * k) / _probe.c // straight down: a gap measured square to a sloped face is longer vertically
}

/** The part groups' final offsets: the largest lowering of any part in the group, else the largest raising (a welded item moves as one). */
function settleGroups(groups) {
	for (let i = 0; i < groups.length; i++) groups[i].off = groups[i].hi > 0 ? groups[i].hi : groups[i].lo
}

/** How far (m, straight up) to draw a round body at (x, y) with body radius Rb, whose mesh is `grow` m bigger than that, so that it stands ON what it rests on:
 *  the engine rests a ball 0.5-1 mm above y = 0 (its contact skin) but the tabletop is drawn at 1 mm, so the mesh sank 0.1-1 mm into it (a coin on its edge showed a 5 mm flat
 *  chord). Looks at every static slab top in `supports` (the table is one) under the body's centre; 0 where the body is not within ROUND_FADE of one. No allocation. */
function roundLift(x, y, Rb, grow, supports) {
	let best = 0
	for (let i = 0; i < supports.length; i++) {
		const sp = supports[i]
		if (sp.c < 0.5) continue // (a face that does not look up)
		const dx = x - sp.x
		const dy = y - sp.y
		const lx = dx * sp.c + dy * sp.s
		if (lx < -sp.hw || lx > sp.hw) continue
		const sink = Rb + grow - (-dx * sp.s + dy * sp.c - sp.hh - sp.grow) // how far the drawn body is inside the top face (square to it)
		if (sink <= 0) continue
		const u = (sink - grow - ROUND_BAND) / (ROUND_FADE - ROUND_BAND)
		const k = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u)
		const lift = (sink * k) / sp.c // straight up: a depth measured square to a sloped face is longer vertically
		if (lift > best) best = lift
	}
	return best
}

const _ext = { x0: 0, x1: 0, y0: 0, y1: 0 }
/** The box of a body (slab, polygon or ball) at pose q, into _ext. */
function extentOf(body, q) {
	if (body.kind === "ball") {
		_ext.x0 = q.x - body.radius
		_ext.x1 = q.x + body.radius
		_ext.y0 = q.y - body.radius
		_ext.y1 = q.y + body.radius
		return _ext
	}
	const c = Math.cos(q.angle)
	const s = Math.sin(q.angle)
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	if (body.kind === "polygon") {
		for (const p of body.points) {
			const x = q.x + p.x * c - p.y * s
			const y = q.y + p.x * s + p.y * c
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (y < y0) y0 = y
			if (y > y1) y1 = y
		}
	} else {
		const hw = body.width / 2
		const hh = body.height / 2
		const ex = Math.abs(c) * hw + Math.abs(s) * hh
		const ey = Math.abs(s) * hw + Math.abs(c) * hh
		x0 = q.x - ex
		x1 = q.x + ex
		y0 = q.y - ey
		y1 = q.y + ey
	}
	_ext.x0 = x0
	_ext.x1 = x1
	_ext.y0 = y0
	_ext.y1 = y1
	return _ext
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
const _sq = new THREE.Quaternion()
/** A model part marked userData.spin = {axis: "x" | "y" | "z" (its own, default "z"), rps (turns per second, counter-clockwise about +axis), from? (s)}:
 *  it turns by the clock from `from` on (spinParts). A record, or null when it would not turn. */
function spinOf(o) {
	const sp = o.userData.spin
	const rps = Number(sp.rps)
	if (!Number.isFinite(rps) || rps === 0) return null
	return { obj: o, axis: sp.axis === "x" ? 0 : sp.axis === "y" ? 1 : 2, rate: TAU * rps, from: Number.isFinite(sp.from) ? sp.from : 0, q0: o.quaternion.clone() }
}

/** Vertex hooks. A scaled mesh's y scale is `length(modelMatrix[1].xyz)`; these undo it where it must not apply. */
const coilVertex = (shader) => {
	// the wire keeps its true size: only the centre line stretches; the normals ignore the stretch too
	shader.vertexShader = shader.vertexShader
		.replace("#include <common>", "#include <common>\nattribute vec3 aAxis;")
		.replace("#include <beginnormal_vertex>", "float jSy = max(1e-4, length(modelMatrix[1].xyz));\n#include <beginnormal_vertex>\nobjectNormal *= vec3(1.0, jSy, 1.0);")
		.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = aAxis + (position - aAxis) * vec3(1.0, 1.0 / jSy, 1.0);")
}
const coilDepthVertex = (shader) => {
	shader.vertexShader = shader.vertexShader
		.replace("#include <common>", "#include <common>\nattribute vec3 aAxis;")
		.replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat jSy = max(1e-4, length(modelMatrix[1].xyz));\ntransformed = aAxis + (position - aAxis) * vec3(1.0, 1.0 / jSy, 1.0);")
}
const ropeVertex = (shader) => {
	// the braid repeats every ROPE_PITCH meters whatever the rope's length: v (0..1 along a unit mesh) becomes meters
	shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y *= length(modelMatrix[1].xyz);\n#endif")
}

// ---------------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------------
export function createView3D(container) {
	let renderer
	let gpuName = ""
	let softwareGL = false
	try {
		renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
		try {
			const gl = renderer.getContext()
			const ext = gl.getExtension("WEBGL_debug_renderer_info")
			gpuName = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "")
		} catch {}
		softwareGL = SOFTWARE_GL.test(gpuName)
		if (softwareGL) stopPrebake() // (a CPU rasteriser draws the bake workers' canvases too: they would only hold the page up; see models3d.js)
		if (softwareGL) {
			// a CPU rasteriser pays for every multisampled pixel: the context is made again without MSAA (the one setting a context cannot change later)
			try {
				const plain = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" })
				renderer.dispose()
				renderer.forceContextLoss()
				renderer = plain
			} catch {} // (the multisampled one stays when a second context cannot be had)
		}
	} catch (err) {
		const msg = document.createElement("div")
		msg.style.cssText = "padding:24px;font:14px system-ui;color:#888"
		msg.textContent = "3D view needs WebGL, which is not available here."
		container.appendChild(msg)
		const none = () => null
		return {
			load() {}, render() {}, setOptions() {}, resize() {}, dispose: () => msg.remove(), pick: none, surfaceAt: none, setHighlight() {}, toWorld: none, toScreen: none, pxPerMeter: () => 0, setEditing() {}, frame() {}, setQuality() {}, getQuality: () => ({ mode: "auto", tier: "low", reason: "no WebGL" }),
			whenSettled: () => Promise.resolve(), renderFrame: () => Promise.reject(new Error("3D view needs WebGL, which is not available here")), endExport() {}, exportProject: none,
			exportInfo: () => ({ ready: false, reason: "no WebGL", settled: true, left: 0, runId: 0, duration: 0, trackFps: 0, impacts: 0, recommended: { width: 1280, height: 720, fps: 30, camera: "wide", motionBlur: 0 }, maxSize: 0, samples: 0, cameras: [], exporting: false, tier: "low", gpu: "", softwareGL: true, lastFrameMs: 0 }),
		}
	}
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.AgXToneMapping
	renderer.toneMappingExposure = 1.0
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.shadowMap.autoUpdate = false // refreshed only when something moved (see draw)
	// Opaque draw order: front to back, then the objects' own order, never by material id. three.js's default groups by material id, a page-wide counter, so the
	// materials kept from scenes shown earlier (the kit's, the cached ones) came in another order than in a fresh page, and where two faces meet at exactly the same
	// depth the one drawn last wins: a picture (an export frame) depended on what the page had shown before (1-10 pixels a frame). Cost: 0.1-0.4 ms of CPU a frame at
	// 230-400 draw calls (Apple M5 Pro); front to back also spares the GPU some overdraw.
	renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.z - b.z || a.id - b.id)
	// Drags on a slow machine: three.js's transmission pass (glass, ice and water refract the scene behind them: every opaque thing is drawn a second time, into a
	// target of its own, half of a busy scene's frame) and the key light's shadow map are redrawn on every TRANS_EVERY-th frame of a drag only, while a draw costs
	// more than TRANS_SLOW_MS; in between, the glass refracts the picture of the last redraw and the shadows are the last ones drawn (up to TRANS_EVERY - 1 frames
	// late, only during the drag; 150 ms after such a frame a full one is drawn, so a pointer that stops leaves the whole picture).
	// The pass is held by leaving its target alone: no clear, nothing drawn into it (its camera sees no layer meanwhile), so three.js resolves and filters the same
	// picture again. A fast machine, a still picture, playback and every export frame redraw it every time.
	const trans = { hold: false, cam: null, held: null, n: 0, key: "", force: false, timer: 0 }
	{
		const setRT = renderer.setRenderTarget.bind(renderer)
		const clear = renderer.clear.bind(renderer)
		const isTransmission = (rt) => !!rt && rt.samples === 4 && rt.resolveDepthBuffer === false && rt.texture?.generateMipmaps === true && rt.texture.minFilter === THREE.LinearMipmapLinearFilter
		renderer.setRenderTarget = function (rt, ...rest) {
			if (trans.held) {
				trans.held.layers.mask = trans.held.mask
				trans.held = null
			} else if (trans.hold && trans.cam && isTransmission(rt)) {
				trans.held = { layers: trans.cam.layers, mask: trans.cam.layers.mask }
				trans.cam.layers.mask = 0
			}
			return setRT(rt, ...rest)
		}
		renderer.clear = function (...a) {
			if (trans.held) return
			return clear(...a)
		}
	}
	const canvas = renderer.domElement
	canvas.style.cssText = "display:block;width:100%;height:100%;outline:none"
	container.appendChild(canvas)
	const aniso = renderer.capabilities.getMaxAnisotropy()

	// ----- scene: environment, lights, room -----------------------------------------------------------------------
	const scene = new THREE.Scene()
	scene.background = new THREE.Color().setRGB(198 / 255, 196 / 255, 192 / 255, THREE.SRGBColorSpace) // what the lit wall looks like, in case anything ever shows past the room
	const pmrem = new THREE.PMREMGenerator(renderer)
	const makeEnvironment = () => {
		const room = new RoomEnvironment()
		const target = pmrem.fromScene(room, 0.04)
		room.dispose()
		return target
	}
	let envTarget = makeEnvironment() // GPU-only content: rebuilt after a WebGL context restore (see onContextRestored)
	scene.environment = envTarget.texture
	scene.environmentIntensity = 0.5

	const key = new THREE.DirectionalLight(new THREE.Color(1, 0.97, 0.92), 4.0)
	key.castShadow = true
	key.shadow.mapSize.set(4096, 4096)
	key.shadow.bias = -0.0002
	key.shadow.normalBias = 0.0025
	scene.add(key, key.target)
	const fill = new THREE.HemisphereLight(0xfff4e6, 0x6b4a2f, 0.3)
	scene.add(fill)
	for (const l of [key, fill]) l.layers.enable(LENS_LAYER) // (three.js lights only what a camera's layers see: the mirror's pass of the lens parts sees LENS_LAYER alone)

	// the room: a painted wall behind the table
	const wallGeo = new THREE.PlaneGeometry(26, 5.2, 26, 34) // wide enough that no edge shows when orbiting
	{
		const p = wallGeo.attributes.position
		const col = new Float32Array(p.count * 3)
		for (let i = 0; i < p.count; i++) {
			const y = 1.85 + p.getY(i) // world height (the wall spans y = -0.75 .. 4.45)
			const under = 0.5 + 0.5 * smoothstep(-0.75, -0.2, y) // a little darker where the wall meets the floor
			const side = 1.07 - 0.17 * smoothstep(-0.5, 4.5, 1.3 + p.getX(i)) // the window is on the left: the wall falls off to the right
			const f = under * (0.9 + 0.1 * smoothstep(0, 2.5, y)) * side
			col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f
		}
		wallGeo.setAttribute("color", new THREE.BufferAttribute(col, 3))
	}
	const wallMat = new THREE.MeshStandardMaterial({
		// the spec's paint (0.62, 0.60, 0.56), scaled down: the key light is strong enough for the wood to glow, the wall is only in its spill
		color: new THREE.Color().setRGB(0.62 * WALL_LEVEL, 0.6 * WALL_LEVEL, 0.56 * WALL_LEVEL, THREE.LinearSRGBColorSpace),
		roughness: 0.85,
		vertexColors: true,
	})
	const wall = new THREE.Mesh(wallGeo, wallMat)
	wall.position.set(1.3, 1.85, -0.801)
	wall.receiveShadow = true
	// the floor, and the dark cabinet the tabletop sits on (only seen when the frame is tall enough to look below the table)
	const floorGeo = new THREE.PlaneGeometry(30, 14, 60, 28).rotateX(-Math.PI / 2)
	{
		const p = floorGeo.attributes.position
		const col = new Float32Array(p.count * 3)
		for (let i = 0; i < p.count; i++) {
			const x = 1.3 + p.getX(i)
			const z = 2 + p.getZ(i)
			const dx = Math.max(-0.55 - x, 0, x - 3.15)
			const dz = Math.max(-0.8 - z, 0, z - 0.8)
			col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.25 + 0.75 * smoothstep(0, 1.8, Math.hypot(dx, dz)) // contact shade around the cabinet
		}
		floorGeo.setAttribute("color", new THREE.BufferAttribute(col, 3))
	}
	const roomFloor = new THREE.Mesh(
		floorGeo,
		new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.03, 0.026, 0.022, THREE.LinearSRGBColorSpace), roughness: 0.9, vertexColors: true }),
	)
	roomFloor.position.set(1.3, -0.75, 2)
	const cabinetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.012, 0.007, 0.004, THREE.LinearSRGBColorSpace), roughness: 0.55 })
	const cabinet = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.6, 1.54), cabinetMat) // fitted under the tabletop of each run (see fitCabinet)
	cabinet.position.set(1.3, -0.45, 0)
	// the rest of the room (side walls, ceiling, the wall behind the camera), same paint: an orbit never looks out into a void.
	// Its back face sits 1 mm behind the wall above, and its floor 1 cm under the dark floor, so nothing fights.
	const shellMat = new THREE.MeshStandardMaterial({
		color: new THREE.Color().setRGB(0.62 * WALL_LEVEL, 0.6 * WALL_LEVEL, 0.56 * WALL_LEVEL, THREE.LinearSRGBColorSpace),
		roughness: 0.85,
		side: THREE.BackSide,
	})
	const shell = new THREE.Mesh(new THREE.BoxGeometry(26, 5.21, 11.2), shellMat)
	shell.position.set(1.3, 1.845, -0.802 + 5.6)
	scene.add(shell, wall, roomFloor, cabinet)
	let roomWanted = true // (a module's view plugin may leave the room out for a run: applyEnvironment)
	let tableWanted = true // (and the table top: it still collides)
	const setRoomVisible = (v) => {
		shell.visible = wall.visible = roomFloor.visible = cabinet.visible = v && roomWanted
	}
	const ROOM_BACKGROUND = scene.background
	/** A module's view plugin may ask for another world round the machine for its run (web/view-plugins.js `environment`: space scenes leave out
	 *  the room and the table top, show a starry sky and dim the room's lights); every run without one gets the room back as it was. */
	const applyEnvironment = (r) => {
		const env = r?.plugins?.find((p) => p.environment)?.environment ?? null
		roomWanted = env?.room !== false
		setRoomVisible(true)
		cabinet.visible = cabinetWanted && roomWanted
		tableWanted = env?.table !== false
		if (r?.tableMesh) r.tableMesh.visible = tableWanted
		scene.background = env?.background ?? ROOM_BACKGROUND
		key.intensity = env?.key ?? 4.0
		fill.intensity = env?.fill ?? 0.3
		scene.environmentIntensity = env?.envIntensity ?? 0.5
	}
	let cabinetWanted = true
	const fitCabinet = (table) => {
		// the cabinet is the tabletop's base: as wide and deep as the table (a little inside), its top at the table's underside
		cabinetWanted = !!table
		if (!table) return
		const b = table.body
		cabinet.scale.set(Math.max(0.1, b.width - 0.08) / 3.62, 1, Math.max(0.1, b.depth - 0.06) / 1.54)
		cabinet.position.set(table.at.x, table.at.y - b.height / 2 - 0.3, 0)
		cabinet.updateMatrixWorld()
	}

	// ----- looks and materials (cached; the app hands over the catalog's looks with setOptions({looks})) -------------------
	let looks = { ...DEFAULT_LOOKS }
	let looksJson = JSON.stringify(looks)
	let buildNo = 0
	const matCache = new Map() // key -> {mat, tex: [owned textures], used}
	const geoCache = new Map() // key -> {geo, used}
	const ENV_K = 0.35 // how much of the room environment the wood and balls pick up (more washes the colours out)

	const lookOf = (s) => looks[s.look] ?? { fill: s.placeholder?.fill ?? "#c8955a", shade: s.render?.shade ?? "#a8743f", roughness: 0.5, metalness: 0, clearcoat: 0 }
	/** The share of the usual contact shading a surface keeps: a clear one (glass, ice, acrylic: transmission, or opacity under 1) shows the table through it, so the dark blot
	*  drawn under an opaque thing reads as a smudge. (1 - transmission)^2 x opacity: 1 for paint and wood, 0.2 for frosted ice (0.55), 0.01 for glass (0.9), 0 for fully clear. */
	const keepOf = (transmission, opacity) => {
		const open = 1 - Math.min(1, Math.max(0, transmission))
		return open * open * Math.min(1, Math.max(0, opacity))
	}
	const lookKeep = (L) => keepOf(L.transmission ?? 0, L.opacity ?? 1)
	const clearOf = (m) => {
		const one = (x) => Math.max(x.transmission > 0 ? x.transmission : 0, x.transparent && x.opacity < 1 ? 1 - x.opacity : 0)
		return Array.isArray(m) ? Math.min(...m.map(one)) : one(m)
	}
	const _mkBox = new THREE.Box3()
	/** The same for a model: what its lowest meshes (those within 2 mm of its underside: the ones that touch the table) are made of decides, not the look's name. */
	function modelKeep(mdl, L) {
		const lows = []
		const walk = (o, m) => {
			o.updateMatrix()
			const mm = new THREE.Matrix4().multiplyMatrices(m, o.matrix)
			if (o.isMesh && !o.isInstancedMesh && o.visible && o.geometry) {
				o.geometry.boundingBox ?? o.geometry.computeBoundingBox()
				_mkBox.copy(o.geometry.boundingBox).applyMatrix4(mm)
				if (!_mkBox.isEmpty()) lows.push(_mkBox.min.y, o.material)
			}
			for (const c of o.children) walk(c, mm)
		}
		walk(mdl, new THREE.Matrix4())
		if (!lows.length) return lookKeep(L)
		let lowest = Infinity
		for (let i = 0; i < lows.length; i += 2) lowest = Math.min(lowest, lows[i])
		let clear = 1
		for (let i = 0; i < lows.length; i += 2) if (lows[i] <= lowest + 0.002) clear = Math.min(clear, clearOf(lows[i + 1]))
		return keepOf(clear, 1)
	}
	const linOf = (hex) => {
		const c = new THREE.Color(hex)
		return [c.r, c.g, c.b]
	}
	const lin3 = (a, k = 1) => new THREE.Color().setRGB(a[0] * k, a[1] * k, a[2] * k, THREE.LinearSRGBColorSpace)

	/** A little saturation before tone mapping: three's AgX is flatter than the Blender "AgX - Medium High Contrast" look the renders use. */
	const sat = { uSat: gradeSat }
	const GRADE = "{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(0.0), mix(vec3(gl), outgoingLight, uSat)); }"
	const satify = (m, vertexHook = null, tag = "look-sat") => {
		// every plain look and plain paint shares one program (gradeShader in models3d.js: `paint` says which this one is); a material with its own vertex code needs its own: `tag` keeps it apart
		const paint = !vertexHook && isPlainPaint(m) // (plain paint (no texture, not metal, not glass): its hue and saturation survive AgX, which washed a pure bright paint toward cream)
		const hook = (shader) => {
			gradeShader(shader, paint)
			if (vertexHook) vertexHook(shader)
		}
		m.onBeforeCompile = hook
		m.customProgramCacheKey = vertexHook ? () => tag : gradeKeyFor(hook)
		return m
	}

	/** What a look asks of the surface besides its colour: roughness, metal, clearcoat, glass / ice (transmission), opacity. */
	const surfaceOf = (L) => {
		const p = {
			roughness: L.roughness ?? 0.5,
			metalness: L.metalness ?? 0,
			clearcoat: L.clearcoat ?? 0,
			clearcoatRoughness: L.grain ? 0.12 : 0.05, // varnish is softer than a plastic's gloss
			envMap: envTarget.texture,
			envMapIntensity: (L.metalness ?? 0) > 0.5 ? 1 : ENV_K,
		}
		if ((L.transmission ?? 0) > 0) {
			p.transmission = L.transmission
			p.thickness = L.thickness ?? 0.03
			p.ior = L.ior ?? 1.45
			p.envMapIntensity = 1
		}
		if (L.opacity !== undefined && L.opacity < 1) {
			p.transparent = true
			p.opacity = L.opacity
		}
		return p
	}

	function touch(map, key) {
		const e = map.get(key)
		if (e) {
			map.delete(key)
			map.set(key, e) // most recently used last
			e.used = buildNo
		}
		return e
	}
	function trimCaches() {
		for (const [k, e] of matCache) {
			if (matCache.size <= MAT_CAP) break
			if (e.used >= buildNo) continue
			e.mat.dispose()
			for (const t of e.tex) t.dispose()
			matCache.delete(k)
		}
		for (const [k, e] of geoCache) {
			if (geoCache.size <= GEO_CAP) break
			if (e.used >= buildNo) continue
			e.geo.dispose()
			geoCache.delete(k)
		}
	}
	const clearMaterials = () => {
		for (const e of matCache.values()) {
			e.mat.dispose()
			for (const t of e.tex) t.dispose()
		}
		matCache.clear()
	}
	/** A geometry by shape + size (never rebuilt while the user only moves things). */
	function geometry(k, make) {
		let e = touch(geoCache, k)
		if (!e) {
			e = { geo: make(), used: buildNo }
			e.geo.userData.shared = true
			geoCache.set(k, e)
		}
		return e.geo
	}
	function material(k, make) {
		let e = touch(matCache, k)
		if (!e) {
			const { mat, tex = [] } = make()
			e = { mat, tex, used: buildNo }
			matCache.set(k, e)
		}
		return e.mat
	}
	/** A texture of a drawn canvas; `wrap`: "both" (tiling wood), "s" (equirect: round the ball, clamped at the poles), "none". */
	const canvasTexture = (canvas, srgb, wrap = "s") => {
		const t = new THREE.CanvasTexture(canvas)
		if (srgb) t.colorSpace = THREE.SRGBColorSpace
		if (wrap !== "none") t.wrapS = THREE.RepeatWrapping
		if (wrap === "both") t.wrapT = THREE.RepeatWrapping
		t.anisotropy = Math.min(aniso, 8)
		return t
	}
	// the wood canvases are shared by every material of the same contrast: one texture object each, kept for the view's lifetime
	const sharedTextures = new Map()
	const sharedTexture = (k, make) => {
		let t = sharedTextures.get(k)
		if (!t) sharedTextures.set(k, (t = make()))
		return t
	}
	// While a progressive load is under way (see load) the wood grain, a few hundred ms of noise on a slow machine, is not worked out for the first frame:
	// the materials that need it show a flat stand-in of the wood's mean colour, and the grain is drawn in idle slices and swapped in (the same `map` slot of
	// the same programs: no shader is compiled again).
	let lazyGrain = false
	const grainWait = new Map() // "grain<ratio>" -> {ratio, mats: Set, ph (the stand-in texture)}
	function placeholderMap(ratio) {
		const c = document.createElement("canvas")
		c.width = c.height = 2
		const g = c.getContext("2d")
		g.fillStyle = `rgb(${[0, 1, 2].map((i) => Math.round(255 * srgbOf(ratio[i] + (1 - ratio[i]) * 0.5))).join(",")})`
		g.fillRect(0, 0, 2, 2)
		const t = new THREE.CanvasTexture(c)
		t.colorSpace = THREE.SRGBColorSpace
		t.wrapS = t.wrapT = THREE.RepeatWrapping
		return t
	}
	/** The grain colour map of this contrast for material `mat`: the real texture, or (lazy loads) the stand-in until the grain is drawn. */
	function grainMapFor(ratio, mat) {
		const k = "grain" + ratioKey(ratio)
		const have = sharedTextures.get(k)
		if (have) return have
		if (!lazyGrain) return sharedTexture(k, () => canvasTexture(grainCanvas(ratio), true, "both"))
		let w = grainWait.get(k)
		if (!w) grainWait.set(k, (w = { ratio, mats: new Set(), ph: placeholderMap(ratio) }))
		w.mats.add(mat)
		return w.ph
	}
	/** Draw the waiting grain textures for up to `budgetMs`, then hand each to its materials; true while some are still to do. */
	function stepGrain(budgetMs) {
		const t0 = performance.now()
		for (const [k, w] of grainWait) {
			const left = budgetMs - (performance.now() - t0)
			if (left <= 0.5) return true
			const canvas = grainCanvasStep(w.ratio, left)
			if (!canvas) return true
			const real = sharedTexture(k, () => canvasTexture(canvas, true, "both"))
			for (const m of w.mats) m.map = real
			w.ph.dispose()
			grainWait.delete(k)
			requestRedraw() // (drawn even when nobody calls render(): a layout preview is not drawn by the app's clock)
		}
		return false
	}

	/** The wood a grain look is made of: its light colour (linear), the dark end as a share of it, and which tile size to lay it in. */
	function grainTone(s, L, isTable) {
		const tile = isTable ? "table" : s.look === "light wood" ? "domino" : "wood"
		const known = !s.color && (isTable ? WOODS.table : s.look === "wood" ? WOODS.wood : s.look === "light wood" ? WOODS.domino : null)
		if (known) {
			return { light: known.light, ratio: [0, 1, 2].map((c) => known.dark[c] / known.light[c]), tile }
		}
		return { light: linOf(s.color ?? L.fill).map((v) => v * 0.95), ratio: [0.55, 0.55, 0.55], tile }
	}

	// the planar reflection of the machine in the varnished tabletop (its shader hook is set on the table's material)
	const refl = {
		enabled: true,
		rt: new THREE.WebGLRenderTarget(16, 16, {
			type: renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float") ? THREE.HalfFloatType : THREE.UnsignedByteType,
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: true,
		}),
		matrix: new THREE.Matrix4(),
		k: { value: 1 },
		blur: { value: 2.2 }, // mip bias: the varnish mirrors softly
		sheen: new THREE.Color().setRGB(0.14, 0.135, 0.125, THREE.LinearSRGBColorSpace), // what the varnish mirrors of the room (the wall itself is left out)
		cam: new THREE.PerspectiveCamera(),
	}
	const reflUniforms = { tReflect: { value: refl.rt.texture }, uReflMatrix: { value: refl.matrix }, uReflK: refl.k, uReflBlur: refl.blur }
	// the mirror the table shows: `full` in the picture, `base` (the same without the lens parts) in three.js's transmission pass, the one pass that draws with tone mapping off
	// (renderTransmissionPass): what a glass item bends is the table without the mirror images of see-through things it never shows itself (see renderReflection)
	const reflTex = { full: refl.rt.texture, base: refl.rt.texture }
	const tableBeforeRender = (r) => {
		reflUniforms.tReflect.value = r.toneMapping === THREE.NoToneMapping ? reflTex.base : reflTex.full
	}
	const tableCompile = (shader) => {
		Object.assign(shader.uniforms, reflUniforms, sat)
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflUv;\nvarying float vReflUp;")
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvReflUv = uReflMatrix * (modelMatrix * vec4(transformed, 1.0));\nvReflUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;",
			)
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform sampler2D tReflect;\nuniform float uReflK;\nuniform float uReflBlur;\nuniform float uSat;\nvarying vec4 vReflUv;\nvarying float vReflUp;",
			)
			.replace(
				"#include <opaque_fragment>",
				`if (vReflUp > 0.9 && uReflK > 0.0 && vReflUv.w > 0.0) {
	vec3 rc = textureProj(tReflect, vReflUv, uReflBlur).rgb;
	float cosT = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
	float fr = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
	outgoingLight += rc * fr * uReflK;
}
${GRADE}
#include <opaque_fragment>`,
			)
	}

	/** Slab material by look + colour. Grain looks are procedural wood; the table's has the planar reflection. */
	function slabMaterial(s, isTable) {
		const L = lookOf(s)
		const color = s.color ? normHex(s.color) : ""
		return material(`slab|${s.look}|${color}|${isTable ? "T" : ""}`, () => {
			const tex = []
			if (L.grain) {
				const tone = grainTone(s, L, isTable)
				const mat = new THREE.MeshPhysicalMaterial({ ...surfaceOf(L), color: lin3(tone.light) })
				mat.map = grainMapFor(tone.ratio, mat)
				if (isTable) {
					mat.vertexColors = true // the tabletop's edge faces are a touch darker (its top is lit, its sides are not)
					mat.envMapIntensity = 0.3
					mat.onBeforeCompile = tableCompile
					mat.customProgramCacheKey = () => "table-planar-reflection"
					mat.onBeforeRender = tableBeforeRender
					return { mat, tex }
				}
				return { mat: satify(mat), tex }
			}
			const metal = (L.metalness ?? 0) > 0.5
			const mat = new THREE.MeshPhysicalMaterial({ ...surfaceOf(L), color: lin3(linOf(color || L.fill), metal || L.transmission > 0 ? 1 : PAINT_TINT) })
			return { mat: satify(mat), tex }
		})
	}

	/** A ball's surface: a pattern drawn on its equirect map, or the look's mottled paint. */
	function ballMaterial(s) {
		const L = lookOf(s)
		const hex = normHex(s.color ?? L.fill)
		const pattern = PATTERNS[s.pattern] && s.pattern !== "superball" ? s.pattern : null
		const number = s.pattern === "billiard" ? (s.number ?? 8) : 0
		return material(`ball|${s.look}|${hex}|${pattern ?? ""}|${number}`, () => {
			const tex = []
			const base = hexRgb(hex)
			const metal = (L.metalness ?? 0) > 0.5
			if (pattern) {
				const art = PATTERNS[pattern](base, number)
				const mat = new THREE.MeshPhysicalMaterial({
					...surfaceOf(L),
					color: lin3([1, 1, 1], metal ? 1 : 0.7),
					map: canvasTexture(art.color, true),
				})
				tex.push(mat.map)
				if (art.bump) {
					mat.bumpMap = canvasTexture(art.bump, false)
					mat.bumpScale = art.bumpScale ?? 1
					tex.push(mat.bumpMap)
				}
				return { mat: satify(mat), tex }
			}
			const style = metal || L.transmission > 0 ? MOTTLE_SMOOTH : (MOTTLE[s.look] ?? MOTTLE_DEFAULT)
			const art = mottleCanvases(base, style)
			const gray = canvasTexture(art.gray, false)
			const p = surfaceOf(L)
			const mat = new THREE.MeshPhysicalMaterial({
				...p,
				roughness: Math.min(1, p.roughness * BALL_ROUGH_K),
				color: lin3([1, 1, 1], metal ? 1 : style.tint),
				map: canvasTexture(art.color, true),
				roughnessMap: gray,
				bumpMap: gray,
				bumpScale: style.bump,
			})
			return { mat: satify(mat), tex: [mat.map, gray] }
		})
	}

	/** [side, end cap, end cap] for a cylinder; grain looks get end grain on the flat ends. */
	function logMaterials(s) {
		const L = lookOf(s)
		if (!L.grain) {
			const m = ballMaterialPlain(s, L)
			return [m, m, m]
		}
		const side = slabMaterial(s, false)
		const tone = grainTone(s, L, false)
		const color = s.color ? normHex(s.color) : ""
		const cap = material(`cap|${s.look}|${color}`, () => {
			const mat = new THREE.MeshPhysicalMaterial({
				...surfaceOf(L),
				color: lin3(tone.light),
				map: sharedTexture("end" + ratioKey(tone.ratio), () => canvasTexture(endGrainCanvas(tone.ratio), true, "none")),
			})
			return { mat: satify(mat), tex: [] }
		})
		return [side, cap, cap]
	}
	const ballMaterialPlain = (s, L) =>
		material(`plain|${s.look}|${s.color ? normHex(s.color) : ""}`, () => {
			const metal = (L.metalness ?? 0) > 0.5
			return { mat: satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf(L), color: lin3(linOf(s.color ?? L.fill), metal || L.transmission > 0 ? 1 : PAINT_TINT) })), tex: [] }
		})

	/** Dowels and cords for scenery (wood from the "wood" look). */
	const sceneryWood = () => slabMaterial({ look: "wood" }, false)
	const cordMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.05, 0.05, 0.05, THREE.LinearSRGBColorSpace), roughness: 0.7 })

	// ----- joint hardware materials: steel, rope, coil, tyre, dark metal (cached with the rest, so they follow looks and the env map) ----
	const steelMaterial = () => slabMaterial({ look: "steel" }, false)
	const darkMetalMaterial = () =>
		material("j|dark", () => ({ mat: satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf({ roughness: 0.42, metalness: 0.8 }), color: lin3([0.05, 0.052, 0.058]) })), tex: [] }))
	const ropeMaterial = () =>
		material("j|rope", () => {
			const map = canvasTexture(ropeCanvas(), true, "both")
			map.repeat.set(1, 1 / ROPE_PITCH)
			const mat = new THREE.MeshPhysicalMaterial({ ...surfaceOf({ roughness: 0.85 }), color: lin3([1, 1, 1], 0.8), map })
			mat.envMapIntensity = 0.25
			return { mat: satify(mat, ropeVertex, "rope"), tex: [map] }
		})
	const coilMaterial = () =>
		material("j|coil", () => {
			const L = lookOf({ look: "steel" })
			return { mat: satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf(L), color: lin3(linOf(L.fill)) }), coilVertex, "coil"), tex: [] }
		})
	const tyreMaterial = () =>
		material("j|tyre", () => {
			const map = canvasTexture(treadCanvas(), true, "both")
			map.repeat.set(TREAD_LUGS, 1)
			return { mat: satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf({ roughness: 0.88 }), color: lin3([1, 1, 1], 0.9), map })), tex: [map] }
		})
	const beltCapMaterial = () => material("j|beltcap", () => ({ mat: satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf({ roughness: 0.7 }), color: lin3([0.02, 0.02, 0.024]) })), tex: [] }))
	/** The safety walls' acrylic: clear, faintly blue, glossy, with a thin bright edge. Low opacity rather than transmission (no extra pass). */
	const paneMaterial = () =>
		(paneMat ??= new THREE.MeshPhysicalMaterial({
			color: 0xa9d6ff,
			roughness: 0.04,
			metalness: 0,
			clearcoat: 1,
			clearcoatRoughness: 0.03,
			envMap: envTarget.texture,
			envMapIntensity: 1.6,
			transparent: true,
			opacity: 0.22,
			depthWrite: false,
			side: THREE.FrontSide, // (both faces would stack to a milky 40%)
		}))
	const paneEdgeMaterial = () => (paneEdgeMat ??= new THREE.LineBasicMaterial({ color: 0x6fbcff, transparent: true, opacity: 0.95, depthWrite: false }))

	// the shadow of a coil must be stretched like the coil itself
	const coilDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
	coilDepth.onBeforeCompile = coilDepthVertex
	coilDepth.customProgramCacheKey = () => "coil-depth"

	// ----- placeholders: the cheap stand-ins a progressive load shows until a part's realistic model is built -----------------------
	/** A plain colour, no texture: the look's fill. One shader program for all of them (and glass a see-through one: no transmission pass). */
	function placeholderMaterial(s, L) {
		const hex = normHex(s.color ?? L.fill)
		const metal = (L.metalness ?? 0) > 0.5
		const glass = (L.transmission ?? 0) > 0
		return material(`ph|${hex}|${metal ? "m" : ""}${glass ? "g" : ""}`, () => {
			const m = new THREE.MeshStandardMaterial({
				color: lin3(linOf(hex), metal ? 1 : PAINT_TINT),
				roughness: Math.max(0.35, L.roughness ?? 0.5),
				metalness: metal ? 0.6 : 0,
				envMap: envTarget.texture,
				envMapIntensity: metal ? 1 : ENV_K,
			})
			if (glass) {
				m.transparent = true
				m.opacity = 0.55
				m.depthWrite = false
			}
			return { mat: satify(m), tex: [] }
		})
	}
	/** The stand-in for solid `s` in a model's frame: its outline (a sphere / cylinder for a round body, a box, the extruded polygon) at its depth. */
	function placeholderMesh(s, L) {
		const b = s.body
		let g
		if (b.kind === "ball") {
			const R = b.radius + SKIN * 0.5
			if (s.shape === "cylinder") {
				const len = s.depth3d ?? 2 * b.radius
				g = geometry(`phcyl|${R.toFixed(5)}|${len.toFixed(4)}`, () => new THREE.CylinderGeometry(R, R, len, 24, 1).rotateX(Math.PI / 2))
			} else g = geometry(`phsph|${R.toFixed(5)}`, () => new THREE.SphereGeometry(R, 20, 12))
		} else if (b.kind === "polygon") {
			g = geometry(`phpoly|${b.points.map((p) => p.x + "," + p.y).join(" ")}|${depthOf(b)}`, () => polyGeometry(b, TILES.wood, s.id, false))
		} else {
			g = geometry(`phslab|${b.width}|${b.height}|${depthOf(b)}|${b.taper ?? ""}`, () =>
				b.taper !== undefined && Math.abs(b.taper - 1) > 1e-6 ? slabGeometry(b, TILES.wood, s.id, false) : new THREE.BoxGeometry(b.width + 2 * SKIN, b.height + 2 * SKIN, depthOf(b)),
			)
		}
		const m = new THREE.Mesh(g, placeholderMaterial(s, L))
		m.castShadow = true
		m.receiveShadow = true
		return m
	}
	/** Rough size of a part in the picture (m²): the nearest / largest are built first. */
	const areaOf = (b) => {
		if (b.kind === "ball") return 4 * b.radius * b.radius
		if (b.kind === "polygon") {
			let x0 = Infinity
			let x1 = -Infinity
			let y0 = Infinity
			let y1 = -Infinity
			for (const p of b.points) {
				x0 = Math.min(x0, p.x)
				x1 = Math.max(x1, p.x)
				y0 = Math.min(y0, p.y)
				y1 = Math.max(y1, p.y)
			}
			return (x1 - x0) * (y1 - y0)
		}
		return b.width * b.height
	}

	// ----- cameras ---------------------------------------------------------------------------------------------------
	const vfovFor = (hfov, aspect) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect))
	const wideCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80)
	const followCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80)
	const orbitCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 80)
	for (const c of [wideCam, followCam, orbitCam]) {
		c.layers.enable(REFL_SKIP)
		c.layers.enable(PANE_LAYER)
		c.layers.enable(LENS_LAYER)
	}
	const wideTarget = new THREE.Vector3(1.3, 0.3, 0)
	let controls = null
	let orbitStarted = false
	let followPlaced = false
	let editing = false
	let frameSpec = null // what the wide shot was last fitted to (frameOf(run), kept while the user edits)
	let lastFrame = null // where that put the machine in the picture (for dev pages and tests)
	let fixedShown = false // the wide shot shows a scene's fixed camera (doc.view.camera): a new load frames afresh even when the camera is kept
	let mode = "wide"

	// ----- state -------------------------------------------------------------------------------------------------------
	let run = null // {sim, doc, track, group, parts, pickables, pins, table, tableMesh, bounds, follow (lazy), serial}
	let lastT = 0
	let width = 0
	let height = 0
	let sizedW = 0
	let sizedH = 0
	let disposed = false
	let redrawQueued = 0
	let drawCount = 0
	let runSerial = 0
	let shadowKey = ""
	let dirty = true // something changed that a redraw at the same moment would show (render() skips the draw otherwise)
	let lastDrawAt = 0 // performance.now() of the last draw
	let drawCost = 0 // ms of main thread a draw takes (running average): the progressive build redraws for its swaps no more often than a few of these apart (swapRedraw)
	let swapAt = 0
	let swapTimer = 0
	let flowN = 0 // consecutive draws of new moments (an animation playing)
	let flowMs = 0 // their average cost
	let reflOff = false // too slow to mirror while the clock runs (measured afresh at every start of it)
	let reflStale = false // the last draw reused an older reflection: draw once more when things stop
	let reflValid = false // the reflection target holds a picture
	const drawnPos = new THREE.Vector3() // the orbit camera as last drawn
	const drawnQuat = new THREE.Quaternion()
	const stats = { draws: 0, reflDraws: 0, reflSkipped: 0, lensPasses: 0, loadsMoved: 0, loadsBuilt: 0, modelsDeferred: 0, modelsSwapped: 0 } // (for dev pages and tests)
	const hl = { selected: null, hover: null } // the item ids the app marks (setHighlight): their see-through walls are drawn
	let paneMat = null // the safety walls' acrylic and its edge lines: made once, kept for the view's life (their shader programs stay compiled)
	let paneEdgeMat = null
	let panesCompiled = false
	let restFix = true // the resting-gap fix (a dev handle turns it off to measure what it does)
	// quality (see "quality tiers" below) and progressive building (see "progressive build"): their state
	const Q = { mode: "auto", tier: "high", reason: "", ceiling: "high", since: 0, applied: false }
	const adapt = { sum: 0, n: 0, t0: 0, healthy: 0, costs: [], probe: false, holdoff: 0, upAt: -1e9 }
	const probePx = new Uint8Array(4)
	const J = { timer: 0, preTimer: 0, idle: false, compiling: 0, settled: [], ema: cpuSlowness() >= 2 ? 12 * cpuSlowness() : 12, lastWork: 0, playAt: -1e9, userAt: -1e9 } // the build slices' timer, the shader compiles in flight, who waits for it all, ms per model build (running average)
	// the export session (renderFrame: see "export" below): while `active` the canvas is not drawn, resized or re-tiered; `saved` = the canvas's own tier
	const xp = { active: false, starting: null, serial: 0, saved: null, timer: 0, queue: Promise.resolve(), missed: false, resized: false, mode: null, gen: 0 }

	const aspect = () => (height > 0 ? width / height : 16 / 9)

	const _v1 = new THREE.Vector3()
	const _v2 = new THREE.Vector3()
	const _v3 = new THREE.Vector3()
	const _q = new THREE.Matrix4()
	const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

	/** A copy of a mirror target's picture (level 0, texel for texel) into `dst` (same size; its mipmaps are made by three.js after the pass). */
	let mirrorCopy = null
	function copyMirror(src, dst) {
		const q = (mirrorCopy ??= (() => {
			const mat = new THREE.RawShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader: "precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
				fragmentShader: "precision highp float;\nprecision highp sampler2D;\nuniform sampler2D tSrc;\nout vec4 outColor;\nvoid main() { outColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0); }",
				uniforms: { tSrc: { value: null } },
				depthTest: false,
				depthWrite: false,
			})
			const geo = new THREE.BufferGeometry()
			geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
			const mesh = new THREE.Mesh(geo, mat)
			mesh.frustumCulled = false
			const sc = new THREE.Scene()
			sc.add(mesh)
			return { sc, mat, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
		})())
		q.mat.uniforms.tSrc.value = src.texture
		renderer.setRenderTarget(dst)
		renderer.render(q.sc, q.cam)
	}
	/** A mirror target's twin for the picture without the lens parts (see renderReflection). */
	const mirrorBase = (rt) =>
		new THREE.WebGLRenderTarget(rt.width, rt.height, { type: rt.texture.type, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false })

	/** Mirror `cam` in the plane y = TABLE_TOP and render the scene without the table into the reflection target.
	 *  `fast` (an animation playing): the meshes on layer REFL_SKIP (glass and ice, which cost a transmission pass of their own, and tiny parts)
	 *  stay out, and the shadow map is left to the main pass, which draws every layer (this pass would leave those meshes' shadows out).
	 *  The export (renderFrame) draws its own mirror into its own target, matrix and camera (rt, matrix, mc); the canvas's stay as they are.
	 *  Lens parts (LENS_LAYER: the see-through parts inside a glass item, which three.js draws in its transparent pass) are mirrored LAST, into `rt` over a copy of the
	 *  picture without them (`base`): the table shows `rt` in the picture, but `base` in the transmission pass, the picture of what is behind glass that a glass item
	 *  bends. That picture holds only opaque things, so it must not hold their mirror images either: a marble's lens would show its own cat's eye's image in the table,
	 *  upside down, as a coloured streak at the top of the glass, with the eye itself left out (reflTex; the table's material chooses by the pass it is drawn in). */
	function renderReflection(cam, fast, rt = refl.rt, matrix = refl.matrix, mc = refl.cam, base = null) {
		if (fast) mc.layers.disable(REFL_SKIP)
		else mc.layers.enable(REFL_SKIP)
		const shadowDue = renderer.shadowMap.needsUpdate
		if (fast) renderer.shadowMap.needsUpdate = false
		cam.updateMatrixWorld()
		const camPos = _v1.setFromMatrixPosition(cam.matrixWorld)
		mc.position.set(camPos.x, 2 * TABLE_TOP - camPos.y, camPos.z)
		const fwd = _v2.set(0, 0, -1).transformDirection(cam.matrixWorld) // world forward
		mc.up.set(0, 1, 0).transformDirection(cam.matrixWorld)
		mc.up.y = -mc.up.y
		_v3.set(camPos.x + fwd.x, 2 * TABLE_TOP - (camPos.y + fwd.y), camPos.z + fwd.z)
		mc.lookAt(_v3)
		mc.updateMatrixWorld()
		mc.projectionMatrix.copy(cam.projectionMatrix)
		mc.projectionMatrixInverse.copy(cam.projectionMatrixInverse)
		mc.far = cam.far
		matrix.copy(bias).multiply(mc.projectionMatrix).multiply(_q.copy(mc.matrixWorld).invert())
		if (run?.tableMesh) run.tableMesh.visible = false
		// only the machine is mirrored (the wall and floor stay out: the room's sheen comes from the environment reflection instead)
		const prevBg = scene.background
		scene.background = refl.sheen
		setRoomVisible(false)
		if (run?.blobs) run.blobs.visible = false
		const prevRt = renderer.getRenderTarget()
		renderer.setRenderTarget(rt)
		renderer.render(scene, mc)
		reflTex.full = reflTex.base = rt.texture
		if (base && !fast && run?.lens > 0 && run.left === 0) {
			// (not until the progressive build is done: the draws it asks for meanwhile skip the extra pass and its copy)
			// the lens parts, in a pass of their own over the picture without them (kept in `base` first): the depth of the rest still hides what it should
			if (base.width !== rt.width || base.height !== rt.height) base.setSize(rt.width, rt.height)
			const due = renderer.shadowMap.needsUpdate
			renderer.shadowMap.needsUpdate = false // (the map is drawn: this pass sees only the lens parts, and they cast none)
			copyMirror(rt, base)
			const mask = mc.layers.mask
			const autoClear = renderer.autoClear
			mc.layers.set(LENS_LAYER)
			renderer.autoClear = false
			scene.background = null // (a colour background makes three.js clear the target whatever autoClear says)
			renderer.setRenderTarget(rt)
			renderer.render(scene, mc)
			scene.background = refl.sheen
			renderer.autoClear = autoClear
			mc.layers.mask = mask
			renderer.shadowMap.needsUpdate = due
			reflTex.base = base.texture
			stats.lensPasses++
		}
		renderer.setRenderTarget(prevRt)
		if (fast) renderer.shadowMap.needsUpdate = shadowDue
		if (rt === refl.rt) reflValid = true
		setRoomVisible(true)
		cabinet.visible = cabinetWanted && roomWanted
		if (run?.blobs) run.blobs.visible = true
		scene.background = prevBg
		if (run?.tableMesh) run.tableMesh.visible = tableWanted
	}

	// ----- chrome: the real room in a mirror ball (high tier) ----------------------------------------------------------------------------
	// A ball that is a mirror (metalness 1, roughness under 0.1: the steel ball) reflects only the baked studio, the same wherever it lies. On the high tier its mesh gets a material
	// of its own (a clone: the kit's is shared with the catalog photos) whose envMap is a 128 px cube render of the scene itself, the ball hidden, from the ball's centre: the table,
	// the balls and rods beside it are in the chrome. The room round the machine (its walls, ceiling and the wall behind) is NOT drawn into it: what the room leaves out is the studio,
	// the very environment the metals reflected before (its window and soft boxes, at full strength), so the chrome keeps its lights and has no seam where a lit wall met an unlit one.
	// Made once after the picture is up and every model and mount is in (a load, a layout change or a model swap), not per frame, not while the clock plays or an item is dragged, and
	// at most every MIRROR_GAP_MS; at most 6 balls (TIERS chromeMax) get a cube map of their own, the others (a cradle of nine) share the nearest one's. The clone's shader variant is
	// compiled in the background before its first capture. The medium tier does the same with 64 px maps (TIERS chrome), so a steel ball is not grey plastic underneath there
	// (the same 6 balls: which balls an export captures never depends on the canvas's tier); low makes no captures: the studio with a tabletop floor (applyLowChrome).
	const MIRROR_SIZE = 128 // the high tier's (an export's first round too)
	const MIRROR_GAP_MS = 250
	const mirrors = { list: [], follow: [], pool: new Map(), scan: false, dirty: false, at: -1e9, capT: NaN, timer: 0, ms: 0, captures: 0, faces: 0, sceneCompiled: false }
	const isMirrorMat = (m) => !Array.isArray(m) && (m.isMeshPhysicalMaterial || m.isMeshStandardMaterial) && m.metalness >= 0.95 && m.roughness <= 0.1 && !(m.transmission > 0) && !m.transparent
	let mirrorProbe = null
	const _mp = new THREE.Vector3()
	const _mq = new THREE.Vector3()
	/** A chrome ball's own copy of its material, the cube map `env` in place of the studio. Material.copy (three r170) leaves out the shader hooks: they are carried over
	 *  (onBeforeCompile, customProgramCacheKey, onBeforeRender) and userData is the original's own object, as seeThrough's copies, so a graded or hooked mirror material
	 *  keeps its grade on the high tier and in an export. */
	function chromeCopy(orig, env) {
		const ud = orig.userData
		orig.userData = {} // (a clone copies userData through JSON: the copy shares the original's object instead)
		const mat = orig.clone()
		orig.userData = ud
		mat.userData = ud
		mat.onBeforeCompile = orig.onBeforeCompile
		mat.customProgramCacheKey = orig.customProgramCacheKey
		mat.onBeforeRender = orig.onBeforeRender
		mat.envMap = env
		mat.envMapIntensity = 1
		return mat
	}
	/** A chrome ball's cube camera sees what the real cameras see (but the panes the app marks): glass and ice and tiny parts (REFL_SKIP) and the lens parts inside
	 *  glass (LENS_LAYER) too, so a steel ball beside a jar shows the jar. Its six cameras share its layers. */
	function chromeLayers(cam) {
		cam.layers.enable(REFL_SKIP)
		cam.layers.enable(LENS_LAYER)
		return cam
	}
	/** While cube faces are drawn: glass and ice wear their see-through copies (seeThrough: the low tier's glass), so no face needs a transmission pass of its own
	 *  (three.js would keep a target for every face's camera, for good). Returns what puts them back (null when the run has none). */
	function cubeGlass() {
		if (!run) return null
		const swapped = []
		const glassy = (m) => m.transmission > 0
		run.group.traverse((o) => {
			if (!o.isMesh) return
			const m = o.material
			if (!(Array.isArray(m) ? m.some(glassy) : glassy(m))) return
			swapped.push(o, m)
			o.material = Array.isArray(m) ? m.map((x) => (glassy(x) ? seeThrough(x) : x)) : seeThrough(m)
		})
		if (!swapped.length) return null
		return () => {
			for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1]
		}
	}
	// A captured cube is made into the blurred levels a material reads (PMREM) by a generator of ITS size: three.js's own conversion (an env map that is a cube target)
	// shares one generator, which rebuilds its working targets and blur only for a target it allocates itself, so cubes of two sizes through it (the canvas's 128, an
	// export's 256, the medium tier's 64) blurred with the wrong levels: dark rims round every ball. The material's envMap is the converted texture itself.
	const chromePmrem = new Map() // cube side -> PMREMGenerator
	/** Convert cube target `rt` (just captured) into `uv` (its own converted target; null: allocate it). Returns the converted target. */
	function chromeUV(rt, uv) {
		let gen = chromePmrem.get(rt.width)
		if (!gen) chromePmrem.set(rt.width, (gen = new THREE.PMREMGenerator(renderer)))
		if (!uv) renderer.initRenderTarget(rt) // (a target never drawn yet: black until its first capture)
		return gen.fromCubemap(rt.texture, uv)
	}
	/** A chrome cube of `size` px: its target, camera (chromeLayers), converted target (chromeUV) and a copy of `orig` reading it. */
	function chromeCube(orig, size) {
		const rt = new THREE.WebGLCubeRenderTarget(size, {
			type: renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float") ? THREE.HalfFloatType : THREE.UnsignedByteType,
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter,
		})
		const uv = chromeUV(rt, null)
		return { rt, uv, cam: chromeLayers(new THREE.CubeCamera(0.01, 30, rt)), mat: chromeCopy(orig, uv.texture) }
	}
	/** Capture cube c ({rt, uv, cam}) from the centre of mirror entry e (its part hidden) and convert it. */
	function captureChrome(e, c) {
		e.root.visible = false
		e.mesh.updateWorldMatrix(true, false)
		c.cam.position.setFromMatrixPosition(e.mesh.matrixWorld)
		c.cam.update(renderer, scene)
		e.root.visible = true
		chromeUV(c.rt, c.uv)
	}
	/** A mirror ball's entry: its cube (`size` px: the tier's; chromeCube) and own material (pooled by material and size, kept for the next run). */
	function mirrorEntry(orig, size) {
		const key = `${orig.uuid}|${size}`
		const e = mirrors.pool.get(key)?.pop()
		if (e) return e
		return { key, size, ...chromeCube(orig, size), mesh: null, root: null, orig: null, state: "new", applied: false }
	}
	// The low tier makes no captures (a CPU rasteriser would stall compiling the faces' shaders): a mirror ball there reflects the studio with a floor of the tabletop's
	// colour (LOW_FLOOR, linear: matched to what the high tier's captures show of the table), so its lower half is wood, not grey plastic (on a GPU: see applyLowChrome).
	const LOW_FLOOR = [0.3, 0.165, 0.083]
	const LOW_SHEEN = [0.43, 0.3, 0.21] // (and nearer the horizon: matched to the high tier's steel ball, side on)
	let lowEnv = null // (made on first need, from the studio's own room: the same size, so the same shaders)
	const lowChromeMats = new Map() // the original material -> its copy reading lowEnv
	const lowChromeOn = new WeakMap() // a mesh -> {orig, low}
	function lowChromeEnv() {
		if (lowEnv) return lowEnv
		const room = new RoomEnvironment()
		// the floor: a disc just under the studio's camera filling the lower half (as a tabletop under a ball does), its rings packed toward the middle, wood-coloured
		// with a few soft streaks along x, lightening toward the horizon (the varnish mirrors the room at a glancing angle)
		const geo = new THREE.RingGeometry(0, 1, 48, 24)
		const pos = geo.attributes.position
		const col = new Float32Array(pos.count * 3)
		const uv = geo.attributes.uv
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i)
			const y = pos.getY(i)
			const rho = Math.hypot(x, y)
			const r = 60 * rho * rho * rho
			const k = rho > 0 ? r / rho : 0
			pos.setXY(i, x * k, y * k)
			uv.setXY(i, (x * k) / 0.6, (y * k) / 0.6)
			const g = smoothstep(0.3, 1.2, r) // (45 to 14 degrees below the horizon)
			for (let c = 0; c < 3; c++) col[i * 3 + c] = (LOW_FLOOR[c] + (LOW_SHEEN[c] - LOW_FLOOR[c]) * g) / 0.89 // (the streaks average 0.89)
		}
		geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
		const cv = document.createElement("canvas")
		cv.width = 64
		cv.height = 4
		const cx = cv.getContext("2d")
		for (let x = 0; x < 64; x++) {
			const v = Math.round(255 * srgbOf(0.78 + 0.22 * vnoise(x / 4, 0, 16, 1, 9)))
			cx.fillStyle = `rgb(${v},${v},${v})`
			cx.fillRect(x, 0, 1, 4)
		}
		const streaks = new THREE.CanvasTexture(cv)
		streaks.colorSpace = THREE.SRGBColorSpace
		streaks.wrapS = streaks.wrapT = THREE.RepeatWrapping
		const floor = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, map: streaks, side: THREE.DoubleSide }))
		floor.rotation.x = -Math.PI / 2
		floor.position.y = -0.3
		room.add(floor)
		lowEnv = pmrem.fromScene(room, 0.04)
		room.dispose() // (its meshes' geometries and materials, the floor's too)
		streaks.dispose()
		return lowEnv
	}
	/** On the low tier, every mirror ball (as scanMirrors finds them) under root wears its copy reading lowChromeEnv; on the others its own material again. Not on a CPU
	 *  rasteriser: making the env there (a PMREM pass) stalls 0.7-1.6 s (SwiftShader; 15-25 ms on a GPU), so its balls keep the kit's own studio. */
	function applyLowChrome(root, roundIds) {
		const low = Q.tier === "low" && !softwareGL
		root.traverse((o) => {
			if (!o.isMesh || o.isInstancedMesh) return
			let on = lowChromeOn.get(o)
			if (on && o.material !== on.low) {
				lowChromeOn.delete(o) // (something put another material on it since)
				on = null
			}
			if (!low) {
				if (on) {
					o.material = on.orig
					lowChromeOn.delete(o)
				}
				return
			}
			if (on || !roundIds?.has(o.userData.solidId) || !isMirrorMat(o.material)) return
			o.geometry.boundingSphere ?? o.geometry.computeBoundingSphere()
			if (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) < 0.006) return
			let m = lowChromeMats.get(o.material)
			if (!m) {
				m = chromeCopy(o.material, lowChromeEnv().texture) // (at strength 1, as a capture's: the upper half is the high tier's studio)
				lowChromeMats.set(o.material, m)
			}
			lowChromeOn.set(o, { orig: o.material, low: m })
			o.material = m
		})
	}
	/** Give every mirror ball its original material back (tier change, lost context) and, with `drop`, forget them all (their targets and clones are kept for the next run). */
	function releaseMirrors(drop) {
		for (const f of mirrors.follow) {
			if (f.applied && f.mesh) f.mesh.material = f.orig
			f.applied = false
		}
		if (drop) mirrors.follow.length = 0
		for (const e of mirrors.list) {
			if (e.applied && e.mesh && e.orig) e.mesh.material = e.orig
			e.applied = false
			if (drop) {
				e.mesh = e.root = e.orig = null
				e.state = "new"
				if (!mirrors.pool.has(e.key)) mirrors.pool.set(e.key, [])
				mirrors.pool.get(e.key).push(e)
			}
		}
		if (drop) mirrors.list.length = 0
	}
	/** Find the round parts of the run that are mirrors and are not tracked yet; start compiling the shader variant of their own material. */
	function scanMirrors() {
		mirrors.scan = false
		const size = TIERS[Q.tier].chrome
		if (!run || !size) return
		const have = new Set(mirrors.list.map((e) => e.mesh))
		for (const f of mirrors.follow) have.add(f.mesh)
		const found = []
		run.group.traverse((o) => {
			if (!o.isMesh || o.isInstancedMesh || have.has(o) || !run.roundIds.has(o.userData.solidId) || !isMirrorMat(o.material)) return
			o.geometry.boundingSphere ?? o.geometry.computeBoundingSphere()
			if (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) >= 0.006) found.push(o)
		})
		for (const o of found) {
			if (mirrors.list.length >= TIERS[Q.tier].chromeMax) {
				// no cube map of its own: it takes the nearest tracked ball's (a neighbour sees almost the same room)
				o.getWorldPosition(_mp)
				let lead = null
				let best = Infinity
				for (const e of mirrors.list) {
					e.mesh.getWorldPosition(_mq)
					const dd = _mp.distanceToSquared(_mq)
					if (dd < best) {
						best = dd
						lead = e
					}
				}
				mirrors.follow.push({ mesh: o, orig: o.material, lead, applied: false })
				continue
			}
			const e = mirrorEntry(o.material, size)
			e.mesh = o
			e.orig = o.material
			e.root = o
			while (e.root.parent && e.root.parent !== run.group) e.root = e.root.parent // (the part's holder: all of it is hidden while its own reflection is drawn)
			e.state = "compiling"
			mirrors.list.push(e)
			const probe = (mirrorProbe ??= new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6)))
			probe.material = e.mat
			const done = () => {
				if (e.state !== "compiling") return
				e.state = "ready"
				mirrors.dirty = true
				requestRedraw()
			}
			const waits = [renderer.compileAsync(probe, activeCamera(), scene)]
			if (!mirrors.sceneCompiled) {
				// the cube faces draw the whole room (the table and the wall the planar mirror leaves out) into a target with other settings: those variants too, once
				// (glass as the faces draw it: its see-through copy)
				mirrors.sceneCompiled = true
				const back = cubeGlass()
				renderer.setRenderTarget(e.rt)
				waits.push(renderer.compileAsync(scene, activeCamera(), scene))
				renderer.setRenderTarget(null)
				back?.()
			}
			Promise.all(waits).then(done, done)
			setTimeout(done, 5000) // (a driver that never says: it is made anyway)
		}
	}
	/** Called by draw() before the picture: re-render the cube map of every ready mirror ball when the scene changed (and the clock is stopped, and the picture is up). */
	function refreshMirrors(quiet) {
		if (!mirrors.scan && !mirrors.dirty) return
		// the picture comes first: nothing is scanned, compiled or captured until every model and mount of the run is in (the last one to come asks for a redraw itself) and
		// two frames have been drawn
		if (!run || run.cancelled || run.left > 0 || run.late.length > 0) return
		if (drawCount - run.drawAt < 2) {
			if (!mirrors.timer && !disposed)
				mirrors.timer = setTimeout(() => {
					mirrors.timer = 0
					requestRedraw()
				}, 60)
			return
		}
		if (mirrors.scan) scanMirrors()
		if (!mirrors.dirty || !mirrors.list.length) return
		const now = performance.now()
		if (!quiet || now - mirrors.at < MIRROR_GAP_MS) {
			// (the clock plays, an item is dragged, or it was done a moment ago: later, when it stops, without waiting for something else to draw)
			if (!mirrors.timer && !disposed)
				mirrors.timer = setTimeout(() => {
					mirrors.timer = 0
					if (mirrors.dirty || mirrors.scan) requestRedraw() // (unless a draw meanwhile made it: the redraw when the clock stops does)
				}, MIRROR_GAP_MS + 50)
			return
		}
		const ready = mirrors.list.filter((e) => e.state === "ready")
		if (!ready.length) return
		mirrors.dirty = false
		mirrors.at = now
		mirrors.capT = lastT // (the moment the parts stand at: draw() posed them before it asked)
		const k = refl.k.value
		refl.k.value = 0 // (the table's planar mirror belongs to the main camera: not in a cube face)
		// the room is left out of the cube (see above): the studio shows where it was, at the strength the metals' own env map has (1)
		const bg = scene.background
		const bgI = scene.backgroundIntensity
		const shellOn = shell.visible
		const wallOn = wall.visible
		scene.background = envTarget.texture
		scene.backgroundIntensity = 1
		shell.visible = wall.visible = false
		const back = cubeGlass()
		// two rounds, as an export frame makes its own: the first gives every ball a map of this moment, the second makes each one again with its neighbours wearing
		// those, so a ball shows its neighbours as chrome of this moment (not the studio's grey of a first capture, nor the room where they stood at the last one)
		const rounds = 2
		for (let round = 0; round < rounds; round++) {
			for (const e of ready) {
				captureChrome(e, e)
				if (!e.applied) {
					e.mesh.material = e.mat
					e.applied = true
				}
			}
			for (const f of mirrors.follow) {
				if (!f.applied && f.lead.applied && f.mesh) {
					f.mesh.material = f.lead.mat
					f.applied = true
				}
			}
		}
		back?.()
		scene.background = bg
		scene.backgroundIntensity = bgI
		shell.visible = shellOn
		wall.visible = wallOn
		refl.k.value = k
		renderer.shadowMap.needsUpdate = true // (the first face drew the shadow map without the ball: the picture draws it again)
		mirrors.ms = performance.now() - now
		mirrors.captures++
		mirrors.faces += 6 * ready.length * rounds
	}

	// ----- loading a run ------------------------------------------------------------------------------------------------
	function disposeRun() {
		if (!run) return
		run.cancelled = true // (its stand-ins' models are not built any more; what was built stays kept)
		run.jobs.length = 0
		run.ready.length = 0
		run.late.length = 0
		releaseMirrors(true)
		stopPlugins(run)
		scene.remove(run.group)
		run.group.traverse((o) => {
			if (o.userData.blob) blobPool.push(o.material) // geometries and materials belong to the caches; the blobs' materials go back to the pool
		})
		for (const o of run.owned) o.dispose() // the joint hardware's own: a slack rope's buffer, a belt's texture and material
		run = null
	}

	const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
	const blobTex = new THREE.CanvasTexture(blobCanvasOnce())
	blobTex.colorSpace = THREE.SRGBColorSpace
	// The contact shades' materials are pooled, never disposed between runs: disposing them all drops the blob shader program's use count
	// to zero, so three.js deletes the program and relinks it (a synchronous ~200 ms stall here) at the next load.
	const blobPool = []
	const blobMaterial = (opacity) => {
		const m =
			blobPool.pop() ??
			new THREE.MeshBasicMaterial({
				map: blobTex,
				transparent: true,
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: -2,
				polygonOffsetUnits: -2,
			})
		m.opacity = opacity
		return m
	}
	const foot = { x: 0, span: 0, h: 0 }

	/** Soft contact shading on the tabletop, centred at (x, z), w along x and d along z. */
	function addBlob(group, x, z, w, d, opacity) {
		const m = new THREE.Mesh(blobGeo, blobMaterial(opacity))
		m.userData.blob = true
		m.position.set(x, TABLE_TOP + 0.0003, z)
		m.scale.set(w, 1, d)
		m.renderOrder = 1
		m.visible = opacity > 0.01
		group.add(m)
		return m
	}

	function addMesh(group, geo, mat, { castShadow = true } = {}) {
		const m = new THREE.Mesh(geo, mat)
		m.castShadow = castShadow
		m.receiveShadow = true
		group.add(m)
		return m
	}
	const freeze = (mesh) => {
		mesh.updateMatrix()
		mesh.matrixAutoUpdate = false
	}

	// ----- joints (doc.joints, wheels, conveyors, hinge motors): built once per run, posed again at every render(t) ----------------
	// Nothing here rebuilds geometry per frame: springs, ropes and pulley rope runs are prebuilt meshes scaled and turned between their
	// anchors, a belt scrolls its texture, a slack rope refills one fixed vertex buffer.
	const cur = { fa: null, fb: null, u: 0 } // the moment being drawn: the two track frames around it and the way between them
	const _pose = { x: 0, y: 0, angle: 0 }
	/** The pose of solid `id` at the drawn moment, into `out`; false when the track has no such solid. */
	function poseAt(id, out) {
		const p = cur.fa[id]
		if (!p) return false
		const n = cur.fb[id] ?? p
		out.x = p.x + (n.x - p.x) * cur.u
		out.y = p.y + (n.y - p.y) * cur.u
		out.angle = p.angle + (n.angle - p.angle) * cur.u
		return true
	}
	/** The world point of anchor `a` in solid `id`'s frame (a world point itself when id is null), and that side's angle, into `out`. */
	function anchorAt(id, a, out) {
		if (id === null || id === undefined) {
			out.x = a.x
			out.y = a.y
			out.angle = 0
			return true
		}
		if (!poseAt(id, _pose)) return false
		const c = Math.cos(_pose.angle)
		const s = Math.sin(_pose.angle)
		out.x = _pose.x + a.x * c - a.y * s
		out.y = _pose.y + a.x * s + a.y * c
		out.angle = _pose.angle
		return true
	}
	/** Where a rope from P touches the circle (C, r) when that circle lies on side `s` of its travel (1 = right, clockwise); into `out`. */
	function tangentFrom(P, C, r, s, out) {
		const vx = C.x - P.x
		const vy = C.y - P.y
		const dist = Math.max(Math.hypot(vx, vy), r + 1e-6)
		const th = Math.atan2(vy, vx) + s * Math.asin(r / dist)
		const len = Math.sqrt(dist * dist - r * r)
		out.x = P.x + len * Math.cos(th)
		out.y = P.y + len * Math.sin(th)
	}
	/** Where a rope leaves the circle (C, r), still wrapped on side `s`, on its way to Q; into `out`. */
	function tangentTo(Q, C, r, s, out) {
		const vx = Q.x - C.x
		const vy = Q.y - C.y
		const dist = Math.max(Math.hypot(vx, vy), r + 1e-6)
		const th = Math.atan2(vy, vx) - s * Math.asin(r / dist)
		const len = Math.sqrt(dist * dist - r * r)
		out.x = Q.x - len * Math.cos(th)
		out.y = Q.y - len * Math.sin(th)
	}
	/** A unit-length mesh stood between two points (it is a cylinder or coil along y: turn it to the line, stretch it to its length). */
	function stretchBetween(m, x1, y1, x2, y2) {
		const dx = x2 - x1
		const dy = y2 - y1
		const d = Math.hypot(dx, dy)
		if (d < 1e-5) {
			m.visible = false
			return
		}
		m.visible = true
		m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0)
		m.rotation.z = Math.atan2(-dx, dy)
		m.scale.y = d
	}
	let solidById = new Map() // the building run's solids by id (set by buildRun)
	/** Front-to-back size of solid `id` (0 for the world / unknown). */
	const bodyDepth = (id) => {
		const s = id === null || id === undefined ? null : solidById.get(id)
		if (!s) return 0
		if (s.body.kind === "slab" || s.body.kind === "polygon") return depthOf(s.body)
		return s.shape === "cylinder" ? (s.depth3d ?? 4 * s.body.radius) : 2 * s.body.radius
	}

	/** One straight rope piece: a unit cylinder of radius rho, braided texture whose pitch stays put as it stretches. */
	function ropePiece(group, rho) {
		return addMesh(group, geometry(`rope|${rho.toFixed(5)}`, () => new THREE.CylinderGeometry(rho, rho, 1, 10, 1)), ropeMaterial())
	}
	const eyelet = (group, r) => addMesh(group, geometry(`eyelet|${r.toFixed(5)}`, () => new THREE.SphereGeometry(r, 12, 8)), steelMaterial())

	/** A slack rope: one tube of fixed topology (20 pieces x 6 sides) whose vertices are refilled while the rope is slack. */
	function slackRope(group, rho, owned) {
		const N = 20
		const RS = 6
		const g = new THREE.BufferGeometry()
		const pos = new Float32Array((N + 1) * (RS + 1) * 3)
		const nor = new Float32Array(pos.length)
		const uv = new Float32Array((N + 1) * (RS + 1) * 2)
		const idx = []
		for (let j = 1; j <= N; j++)
			for (let i = 1; i <= RS; i++) {
				const a = (RS + 1) * (j - 1) + (i - 1)
				const b = (RS + 1) * j + (i - 1)
				const c = (RS + 1) * j + i
				const d = (RS + 1) * (j - 1) + i
				idx.push(a, b, d, b, c, d)
			}
		g.setIndex(idx)
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
		g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
		g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
		owned.push(g)
		const mesh = addMesh(group, g, ropeMaterial())
		mesh.frustumCulled = false
		const px = new Float64Array(N + 1)
		const py = new Float64Array(N + 1)
		return {
			mesh,
			/** Lay the rope from (x1, y1) to (x2, y2) as a parabola sagging h below the chord (sideways when the chord is upright). */
			fill(x1, y1, x2, y2, h) {
				const dx = x2 - x1
				const dy = y2 - y1
				const d = Math.hypot(dx, dy)
				const cx = d > 1e-6 ? dx / d : 0
				const cy = d > 1e-6 ? dy / d : -1
				let bx = cx * cy // gravity's part across the chord: (0, -1) minus its part along it
				let by = cy * cy - 1
				const bl = Math.hypot(bx, by)
				if (bl < 1e-3) {
					bx = 1
					by = 0
				} else {
					bx /= bl
					by /= bl
				}
				for (let k = 0; k <= N; k++) {
					const u = k / N
					const w = 4 * h * u * (1 - u)
					px[k] = x1 + dx * u + bx * w
					py[k] = y1 + dy * u + by * w
				}
				let arc = 0
				for (let k = 0; k <= N; k++) {
					const k0 = Math.max(0, k - 1)
					const k1 = Math.min(N, k + 1)
					let tx = px[k1] - px[k0]
					let ty = py[k1] - py[k0]
					const tl = Math.hypot(tx, ty) || 1
					tx /= tl
					ty /= tl
					if (k > 0) arc += Math.hypot(px[k] - px[k - 1], py[k] - py[k - 1])
					for (let i = 0; i <= RS; i++) {
						const v = (i / RS) * TAU
						const sn = Math.sin(v)
						const nx = sn * ty // TubeGeometry's rule with N = (0, 0, 1), B = T x N = (ty, -tx, 0): normal = -cos v N + sin v B
						const ny = -sn * tx
						const nz = -Math.cos(v)
						const o = k * (RS + 1) + i
						pos[o * 3] = px[k] + rho * nx
						pos[o * 3 + 1] = py[k] + rho * ny
						pos[o * 3 + 2] = rho * nz
						nor[o * 3] = nx
						nor[o * 3 + 1] = ny
						nor[o * 3 + 2] = nz
						uv[o * 2] = i / RS
						uv[o * 2 + 1] = arc // meters: ropeVertex multiplies by the mesh's y scale, 1 here
					}
				}
				g.attributes.position.needsUpdate = true
				g.attributes.normal.needsUpdate = true
				g.attributes.uv.needsUpdate = true
			},
		}
	}

	function buildSpring(group, j, owned, updaters) {
		const R = j.coilRadius ?? 0.02
		const turns = j.coils ?? 10
		const w = Math.min(0.0035, Math.max(0.0007, 0.08 * R))
		// render {rows: n}: n coils side by side across the depth of the body they pull (a trampoline's mat is held by a row of springs), the same x-y anchors
		// at z_k = -d/2 + (k + 0.5) d / n, where the frame's hooks and the mat's V-rings stand: one shared geometry, one InstancedMesh (its instances only move in z,
		// so the vertex hook's stretch, read from the mesh's own matrix, is the same for all)
		const rows = Math.min(64, Math.max(1, Math.round(Number(j.render?.rows) || 1)))
		const d = rows > 1 ? bodyDepth(j.a) || bodyDepth(j.b) : 0
		const many = rows > 1 && d > 0
		// its detail follows its size in the picture (coilLevel, picked before every picture: updaters.lods, applyLods): a trampoline's coils in the wide shot are 12
		// pieces a turn on a 4-sided wire (3.6k triangles each; 6.2k at 14 x 6 before), 24 on a 10-sided one seen from 16 cm, a hanging spring seen from 18 cm 32 on an
		// 8-sided one; a row shares COIL_ROW_TRIS
		const geoOf = (lv) => geometry(`coil|${turns}|${R.toFixed(5)}|${w.toFixed(5)}|${lv.cuts}|${lv.radial}`, () => coilGeometry(turns, R, w, lv.cuts, lv.radial))
		const geo = LOD_PENDING // (the first picture picks its level: every draw does before it renders)
		let m
		if (many) {
			m = new THREE.InstancedMesh(geo, coilMaterial(), rows)
			m.castShadow = true
			m.receiveShadow = true
			const put = new THREE.Matrix4()
			for (let k = 0; k < rows; k++) m.setMatrixAt(k, put.makeTranslation(0, 0, -d / 2 + ((k + 0.5) * d) / rows))
			m.instanceMatrix.needsUpdate = true
			group.add(m)
			owned.push(m)
		} else m = addMesh(group, geo, coilMaterial())
		m.customDepthMaterial = coilDepth
		m.frustumCulled = false
		const p1 = { x: 0, y: 0, angle: 0 }
		const p2 = { x: 0, y: 0, angle: 0 }
		let lv = null
		;(updaters.lods ??= []).push((C, k, share) => {
			if (!m.visible) return false
			// the nearest point of the coil (its axis between the anchors; a row's across its depth) sets the level
			const dx = p2.x - p1.x
			const dy = p2.y - p1.y
			const l2 = dx * dx + dy * dy
			const u = l2 > 0 ? Math.min(1, Math.max(0, ((C.x - p1.x) * dx + (C.y - p1.y) * dy) / l2)) : 0
			const zh = many ? d / 2 : 0
			const dist = Math.max(0.02, Math.hypot(p1.x + dx * u - C.x, p1.y + dy * u - C.y, Math.min(zh, Math.max(-zh, C.z)) - C.z) - R)
			const next = coilLevel(R, w, k / dist, turns, ((many ? COIL_ROW_TRIS / rows : COIL_TRIS) * share * (dist < LOD_CLOSE ? 2 : 1)))
			if (lv && next.cuts === lv.cuts && next.radial === lv.radial) return false
			lv = next
			m.geometry = geoOf(lv)
			return true
		})
		updaters.push(() => {
			if (!anchorAt(j.a, j.anchorA, p1) || !anchorAt(j.b, j.anchorB, p2)) {
				m.visible = false
				return
			}
			const dx = p2.x - p1.x
			const dy = p2.y - p1.y
			m.visible = true
			m.position.set(p1.x, p1.y, 0) // the coil runs from y = 0 to 1 in its own frame: its foot is the first anchor
			m.rotation.z = Math.atan2(-dx, dy)
			m.scale.y = Math.max(1e-4, Math.hypot(dx, dy))
		})
	}

	function buildRope(group, j, owned, updaters) {
		const rho = THREE.MathUtils.clamp((j.thickness ?? 0.004) / 2, 0.0008, 0.008)
		const straight = ropePiece(group, rho)
		const slack = slackRope(group, rho, owned)
		const e1 = eyelet(group, 1.7 * rho)
		const e2 = eyelet(group, 1.7 * rho)
		const p1 = { x: 0, y: 0, angle: 0 }
		const p2 = { x: 0, y: 0, angle: 0 }
		updaters.push(() => {
			const ok = anchorAt(j.a, j.anchorA, p1) && anchorAt(j.b, j.anchorB, p2)
			straight.visible = slack.mesh.visible = e1.visible = e2.visible = ok
			if (!ok) return
			const d = Math.hypot(p2.x - p1.x, p2.y - p1.y)
			const extra = j.length - d - Math.max(0.002, 0.004 * j.length) // slack beyond a little play (so a taut rope never flickers)
			if (extra > 0) {
				slack.fill(p1.x, p1.y, p2.x, p2.y, Math.min(0.6 * j.length, Math.sqrt((3 * Math.max(d, 0.02) * extra) / 8))) // parabola: arc = d + 8h^2 / 3d
				straight.visible = false
			} else {
				stretchBetween(straight, p1.x, p1.y, p2.x, p2.y)
				slack.mesh.visible = false
			}
			e1.position.set(p1.x, p1.y, 0)
			e2.position.set(p2.x, p2.y, 0)
		})
	}

	/** A rope joint with render {style: "chain"}: steel links, alternately face-on and edge-on to the camera, spread evenly along the rope's current line
	 *  (straight when taut, the same sagging parabola as a slack rope otherwise). One InstancedMesh of one shared link geometry; each frame only the
	 *  instance matrices are rewritten, straight into the buffer. */
	function buildChain(group, j, owned, updaters) {
		const d = THREE.MathUtils.clamp(1.5 * (j.thickness ?? 0.004), 0.004, 0.012) // wire diameter
		const rw = d / 2
		const pitch0 = CHAIN_INNER_LEN * d
		const n = 2 * THREE.MathUtils.clamp(Math.round(j.length / (2 * pitch0)), 1, 200) // an even count: the first link is face-on and the last edge-on, so each hooks through the face-on eye at its end
		// its detail follows the nearest link's size in the picture (chainLevel, picked before every picture: updaters.lods, applyLods): the wrecking ball's links are
		// 120-224 triangles each in the wide shot (4.3k-8k for its 36; 1024 each before, 37k, 53k for 52), up to 1088 seen from a few cm within CHAIN_TRIS (one cut
		// along each straight side, the cuts where the wire bends)
		const geoOf = (lv) => geometry(`chainlink|${rw.toFixed(5)}|${lv.ends}|${lv.radial}`, () => chainLinkGeometry(rw, lv.ends, lv.radial))
		const geo = LOD_PENDING // (the first picture picks its level: every draw does before it renders)
		const mesh = new THREE.InstancedMesh(geo, steelMaterial(), n)
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		mesh.castShadow = true
		mesh.receiveShadow = true
		mesh.frustumCulled = false // (its bounds are those of one link at the origin)
		group.add(mesh)
		owned.push(mesh)
		const arr = mesh.instanceMatrix.array
		/** Link i: centre (x, y), its long axis along the unit vector (tx, ty), stretched by sy along it; odd links stand edge-on to the camera. */
		const put = (i, x, y, tx, ty, sy) => {
			const o = i * 16
			const c = ty
			const s = -tx
			if (i & 1) {
				arr[o] = 0
				arr[o + 1] = 0
				arr[o + 2] = -1
				arr[o + 8] = c
				arr[o + 9] = s
				arr[o + 10] = 0
			} else {
				arr[o] = c
				arr[o + 1] = s
				arr[o + 2] = 0
				arr[o + 8] = 0
				arr[o + 9] = 0
				arr[o + 10] = 1
			}
			arr[o + 3] = 0
			arr[o + 4] = -s * sy
			arr[o + 5] = c * sy
			arr[o + 6] = 0
			arr[o + 7] = 0
			arr[o + 11] = 0
			arr[o + 12] = x
			arr[o + 13] = y
			arr[o + 14] = 0
			arr[o + 15] = 1
		}
		const M = 24 // samples along a slack chain
		const px = new Float64Array(M + 1)
		const py = new Float64Array(M + 1)
		const tx = new Float64Array(M + 1)
		const ty = new Float64Array(M + 1)
		const cum = new Float64Array(M + 1)
		const p1 = { x: 0, y: 0, angle: 0 }
		const p2 = { x: 0, y: 0, angle: 0 }
		const reach = (CHAIN_INNER_LEN * d) / 2 + rw // half a link's length
		let lv = null
		;(updaters.lods ??= []).push((C, k, share) => {
			if (!mesh.visible) return false
			let best = Infinity
			for (let i = 0; i < n; i++) {
				const o = i * 16
				const dd = (arr[o + 12] - C.x) ** 2 + (arr[o + 13] - C.y) ** 2 + C.z * C.z
				if (dd < best) best = dd
			}
			const dist = Math.max(0.02, Math.sqrt(best) - reach)
			const next = chainLevel(rw, k / dist, n, CHAIN_TRIS * share * (dist < LOD_CLOSE ? 2 : 1))
			if (lv && next.ends === lv.ends && next.radial === lv.radial) return false
			lv = next
			mesh.geometry = geoOf(lv)
			return true
		})
		updaters.push(() => {
			const ok = anchorAt(j.a, j.anchorA, p1) && anchorAt(j.b, j.anchorB, p2)
			mesh.visible = ok
			if (!ok) return
			const dx = p2.x - p1.x
			const dy = p2.y - p1.y
			const dd = Math.hypot(dx, dy)
			const cx = dd > 1e-6 ? dx / dd : 0
			const cy = dd > 1e-6 ? dy / dd : -1
			const extra = j.length - dd - Math.max(0.002, 0.004 * j.length) // as buildRope: slack beyond a little play
			if (extra <= 0) {
				const sy = THREE.MathUtils.clamp(dd / (n * pitch0), 0.8, 1.25)
				for (let i = 0; i < n; i++) {
					const f = (i + 0.5) / n
					put(i, p1.x + dx * f, p1.y + dy * f, cx, cy, sy)
				}
			} else {
				const h = Math.min(0.6 * j.length, Math.sqrt((3 * Math.max(dd, 0.02) * extra) / 8))
				let bx = cx * cy // gravity's part across the chord
				let by = cy * cy - 1
				const bl = Math.hypot(bx, by)
				if (bl < 1e-3) {
					bx = 1
					by = 0
				} else {
					bx /= bl
					by /= bl
				}
				for (let k = 0; k <= M; k++) {
					const u = k / M
					const w = 4 * h * u * (1 - u)
					px[k] = p1.x + dx * u + bx * w
					py[k] = p1.y + dy * u + by * w
					if (k) cum[k] = cum[k - 1] + Math.hypot(px[k] - px[k - 1], py[k] - py[k - 1])
					else cum[0] = 0
				}
				for (let k = 0; k <= M; k++) {
					const k0 = Math.max(0, k - 1)
					const k1 = Math.min(M, k + 1)
					const ux = px[k1] - px[k0]
					const uy = py[k1] - py[k0]
					const ul = Math.hypot(ux, uy) || 1
					tx[k] = ux / ul
					ty[k] = uy / ul
				}
				const arc = cum[M]
				const sy = THREE.MathUtils.clamp(arc / (n * pitch0), 0.8, 1.25)
				let k = 0
				for (let i = 0; i < n; i++) {
					const s = ((i + 0.5) / n) * arc
					while (k < M - 1 && cum[k + 1] < s) k++
					const seg = cum[k + 1] - cum[k]
					const f = seg > 1e-9 ? Math.min(1, Math.max(0, (s - cum[k]) / seg)) : 0
					let ax = tx[k] + (tx[k + 1] - tx[k]) * f
					let ay = ty[k] + (ty[k + 1] - ty[k]) * f
					const al = Math.hypot(ax, ay) || 1
					ax /= al
					ay /= al
					put(i, px[k] + (px[k + 1] - px[k]) * f, py[k] + (py[k + 1] - py[k]) * f, ax, ay, sy)
				}
			}
			mesh.instanceMatrix.needsUpdate = true
		})
	}

	/** A hinge: a steel axle through the parts' depth with a hex head each end, turning with the moving side; with a motor, a
	 *  housing on the front, fixed to the still side. `at` = [solid id (or null), anchor] gives the hinge's place. */
	function buildHinge(group, { atId, atAnchor, aId, bId, depth, motor }, updaters) {
		const D = depth > 0 ? depth : 0.04
		const r = 0.004
		const steel = steelMaterial()
		const holder = new THREE.Group()
		group.add(holder)
		const front = motor ? D / 2 + 0.003 + 0.04 + 0.0015 : D / 2 + 0.0035
		const extra = motor ? 0.0435 : 0
		const axle = addMesh(holder, geometry(`axle|${r}|${D.toFixed(4)}|${extra}`, () => new THREE.CylinderGeometry(r, r, D + 0.004 + extra, 16).rotateX(Math.PI / 2)), steel)
		axle.position.z = extra / 2
		const turn = new THREE.Group() // the heads turn with the hinge's moving side, so a turning hinge shows
		holder.add(turn)
		const head = geometry(`bolt|${r}`, () => new THREE.CylinderGeometry(1.8 * r, 1.8 * r, 0.003, 6).rotateX(Math.PI / 2))
		addMesh(turn, head, steel).position.z = front
		addMesh(turn, head, steel).position.z = -(D / 2 + 0.0035)
		let stator = null
		if (motor) {
			const dark = darkMetalMaterial()
			stator = new THREE.Group()
			holder.add(stator)
			const housing = addMesh(stator, geometry("motor|housing", () => new THREE.CylinderGeometry(0.018, 0.018, 0.04, 28).rotateX(Math.PI / 2)), dark)
			housing.position.z = D / 2 + 0.003 + 0.02
			const plate = addMesh(stator, geometry("motor|plate", () => new THREE.CylinderGeometry(0.0195, 0.0195, 0.004, 28).rotateX(Math.PI / 2)), steel)
			plate.position.z = D / 2 + 0.003 + 0.002
			const box = addMesh(stator, geometry("motor|box", () => new RoundedBoxGeometry(0.014, 0.012, 0.02, 2, 0.002)), dark) // the terminal box: shows the housing's turn
			box.position.set(0, 0.019, D / 2 + 0.003 + 0.026)
		}
		const p = { x: 0, y: 0, angle: 0 }
		const q = { x: 0, y: 0, angle: 0 }
		updaters.push(() => {
			if (!anchorAt(atId, atAnchor, p)) {
				holder.visible = false
				return
			}
			holder.visible = true
			holder.position.set(p.x, p.y, 0)
			turn.rotation.z = bId !== null && poseAt(bId, q) ? q.angle : 0
			if (stator) stator.rotation.z = aId !== null && poseAt(aId, q) ? q.angle : 0
		})
	}

	/** The underside (y) of the lowest static slab that stands over the world point x within `reach` above y, or null: what a pulley's bracket hangs from. */
	function overheadOf(x, y, reach) {
		let best = null
		for (const s of solidById.values()) {
			if (s.kind !== "static" || s.body.kind !== "slab" || s.hidden_3d || isTableSolid(s)) continue
			const e = extentOf(s.body, poseIn(cur.fa, s))
			if (x < e.x0 - 0.002 || x > e.x1 + 0.002 || e.y0 < y - 0.002 || e.y0 > y + reach) continue
			if (best === null || e.y0 < best) best = e.y0
		}
		return best
	}

	/** A pulley: grooved wheels on brackets at the ground points and the rope over them. The engine's rope runs straight down at groundA and groundB and over a run between them at
	*  the ground points' height (the physics' pulley is a point), so the wheels are centred at that height and INBOARD of the ground points by the rope's radius on them: an outer run
	*  hangs straight from the wheel's side (the engine's own end of the run) to the body's anchor. Where the wheels would touch or overlap (an Atwood machine: the two weights hang a
	*  wheel's diameter apart) or `render: {wheel: "single"}`, ONE wheel spans both runs, as on the real apparatus; `{wheel: "double"}` forces two. A wheel is never taller than the bar
	*  over it leaves room for (the lowest static slab within 30 cm above): a single wheel under a low bar is smaller than the weights are apart and the runs lean in to it a little.
	*  The brackets hang from the bar (or a hanging eye when nothing is over a wheel). A body that swings leaves the wheel at the tangent point: both runs are tangents from the body's
	*  anchor to the wheel, found at every draw, and the rope's wrap on the wheel (a part of a rope laid round it, see setWrap) runs from the top line (or the other run) to that point. */
	function buildPulley(group, j, owned, updaters) {
		const rho = 0.002
		const swap = j.groundB.x < j.groundA.x
		const GL = swap ? j.groundB : j.groundA // the ground points left and right: the rope goes over the tops from the left run to the right one
		const GR = swap ? j.groundA : j.groundB
		const dx = GR.x - GL.x
		const rcw = Math.max(0.004, (j.wheelRadius ?? 0.02) - 2 * rho) // the rope's radius on a wheel of the stated size
		const kind = j.render?.wheel
		// one wheel when the hint says so, or when two wheels would touch or stand less than 1 cm apart (the weights of an Atwood machine hang about a wheel's diameter apart, however heavy)
		const mode = dx < 1e-3 ? "one" : kind === "single" || (kind !== "double" && dx < 4 * rcw + 4 * rho + 0.01) ? "single" : "two"
		// the rope's radius a wheel centred at (x, y) can have under the bar over it (the wheel's rim is 2 rho further out, and keeps 1.5 mm off the bar)
		const room = (x, y) => {
			const bar = overheadOf(x, y, 0.3)
			return bar === null ? Infinity : bar - y - 0.0015 - 2 * rho
		}
		let wheelsAt // [{cx, cy, rc}]: the rope's radius on each wheel, its centre
		if (mode === "one") wheelsAt = [{ cx: GL.x, cy: GL.y, rc: Math.max(0.004, Math.min(rcw, room(GL.x, GL.y))) }]
		else if (mode === "single") {
			const cx = (GL.x + GR.x) / 2
			const cy = (GL.y + GR.y) / 2
			// (the rim stops 0.5 mm inside the weights' own span: bodies hung a wheel's diameter apart at most graze a wheel that fills it)
			wheelsAt = [{ cx, cy, rc: Math.max(0.006, Math.min(dx / 2 - 2 * rho - 0.0005, room(cx, cy))) }]
		} else {
			const rc = Math.max(0.004, Math.min(rcw, room(GL.x + rcw, GL.y), room(GR.x - rcw, GR.y)))
			wheelsAt = [{ cx: GL.x + rc, cy: GL.y, rc }, { cx: GR.x - rc, cy: GR.y, rc }]
		}
		const steel = steelMaterial()
		const wheels = []
		let A = 0.004
		for (const w of wheelsAt) {
			const Rout = w.rc + 2 * rho
			const wheelGeo = geometry(`pulley|${Rout.toFixed(5)}|${rho}`, () => pulleyGeometry(Rout, rho))
			A = wheelGeo.userData.half
			const wm = addMesh(group, wheelGeo, steel)
			wm.position.set(w.cx, w.cy, 0)
			wheels.push(wm)
			// the bracket: a steel plate behind the wheel from just under its axle up to the bar above (or a hanging eye when nothing is over it), the axle's bolt and nut
			const zp = -(A + 0.0016)
			const bar = overheadOf(w.cx, w.cy, 0.3)
			const top = bar !== null ? bar + 0.0015 : w.cy + 1.7 * Rout
			const bottom = w.cy - 0.55 * Rout
			const pw = Math.min(1.5 * Rout, 0.08)
			const plate = addMesh(group, geometry(`pulleyplate|${pw.toFixed(5)}|${(top - bottom).toFixed(5)}`, () => new RoundedBoxGeometry(pw, top - bottom, 0.003, 2, 0.0015)), steel)
			plate.position.set(w.cx, (top + bottom) / 2, zp)
			freeze(plate)
			const bolt = Math.max(0.0016, 0.1 * Rout)
			const axle = addMesh(group, geometry(`pulleyaxle|${bolt.toFixed(5)}|${A.toFixed(5)}`, () => new THREE.CylinderGeometry(bolt, bolt, 2 * A + 0.0076, 14).rotateX(Math.PI / 2)), steel)
			axle.position.set(w.cx, w.cy, -0.0008)
			freeze(axle)
			const hex = geometry(`pulleyhex|${bolt.toFixed(5)}`, () => new THREE.CylinderGeometry(1.9 * bolt, 1.9 * bolt, 0.003, 6).rotateX(Math.PI / 2))
			for (const z of [A + 0.0015, zp - 0.003]) { // (the bolt's head on the front face, its nut behind the plate)
				const h = addMesh(group, hex, steel)
				h.position.set(w.cx, w.cy, z)
				freeze(h)
			}
			if (bar === null) {
				const eye = addMesh(group, geometry(`pulleyeye|${Rout.toFixed(5)}`, () => new THREE.TorusGeometry(0.24 * Rout, 0.06 * Rout, 8, 18)), steel)
				eye.position.set(w.cx, top + 0.2 * Rout, zp)
				freeze(eye)
			}
		}
		const w0 = wheelsAt[0]
		const w1 = wheelsAt[wheelsAt.length - 1]
		const C0 = { x: w0.cx, y: w0.cy }
		const C1 = { x: w1.cx, y: w1.cy }
		const segs = [ropePiece(group, rho), ropePiece(group, rho), ropePiece(group, rho)] // left run, top line, right run
		const hooks = [eyelet(group, 1.25 * rho), eyelet(group, 1.25 * rho)]
		const T1 = { x: 0, y: 0 } // where the left run meets the wheel, where the top line starts and ends, where the right run leaves the wheel
		const T2 = { x: 0, y: 0 }
		const T3 = { x: 0, y: 0 }
		const T4 = { x: 0, y: 0 }
		// the rope's wrap: one length of rope laid on each wheel, over the angles the wrap can have (a hanging run leaves it within 85 degrees of the side it hangs from), of which setWrap draws
		// the part between the wrap's two ends. One wheel (single, one): from the right run's end up over the top to the left run's; two: each wheel from its run's end to the top line.
		const PI = Math.PI
		const REACH = 1.5
		let th = 0 // the top line's slope (two wheels): it leaves both wheels square to it
		let topA = PI / 2 // the angle of the top line's tangent point on both wheels
		if (mode === "two") {
			th = Math.atan2(w1.cy - w0.cy, w1.cx - w0.cx)
			topA = th + PI / 2
			T2.x = w0.cx - Math.sin(th) * w0.rc
			T2.y = w0.cy + Math.cos(th) * w0.rc
			T3.x = w1.cx - Math.sin(th) * w1.rc
			T3.y = w1.cy + Math.cos(th) * w1.rc
			stretchBetween(segs[1], T2.x, T2.y, T3.x, T3.y)
			freeze(segs[1])
		}
		const ranges = mode === "two" ? [[topA, PI + REACH], [-REACH, topA]] : [[-REACH, PI + REACH]]
		const wraps = wheelsAt.map((w, k) => {
			const [a0, a1] = ranges[k]
			const geo = ropeWrapGeometry(w.rc, rho, a0, a1)
			owned.push(geo)
			const m = addMesh(group, geo, ropeMaterial())
			m.position.set(w.cx, w.cy, 0)
			freeze(m)
			return { m, geo, a0, a1, n: geo.userData.wrap.n, step: geo.userData.wrap.step }
		})
		/** Draw the part of wheel k's rope between angles `from` and `to` (counter-clockwise, radians), to the nearest step. */
		const setWrap = (k, from, to) => {
			const wr = wraps[k]
			const k0 = Math.max(0, Math.min(wr.n, Math.round((from - wr.a0) / wr.step)))
			const k1 = Math.max(0, Math.min(wr.n, Math.round((to - wr.a0) / wr.step)))
			wr.m.visible = k1 > k0
			wr.geo.setDrawRange(k0 * 6 * WRAP_RADIAL, Math.max(0, k1 - k0) * 6 * WRAP_RADIAL)
		}
		const unwrap = (a, ref) => a - 2 * PI * Math.floor((a - ref) / (2 * PI)) // a, turned into [ref, ref + 2 pi)
		const P = { x: 0, y: 0, angle: 0 }
		const Q = { x: 0, y: 0, angle: 0 }
		const st = { ok: false, okL: false, okR: false, upL: false, upR: false, la: 0, lb: 0, aL: 0, aR: 0 }
		const L = { x: 0, y: 0 }
		const R = { x: 0, y: 0 }
		const solve = () => {
			st.ok = anchorAt(j.a, j.anchorA, P) && anchorAt(j.b, j.anchorB, Q)
			if (!st.ok) return
			const pl = swap ? Q : P // the anchors of the bodies on the left and right runs
			const pr = swap ? P : Q
			L.x = pl.x
			L.y = pl.y
			R.x = pr.x
			R.y = pr.y
			tangentFrom(L, C0, w0.rc, 1, T1) // (the rope goes round each wheel clockwise: up the left run, over the top, down the right one)
			tangentTo(R, C1, w1.rc, 1, T4)
			// a body above its wheel's top (thrown up: the engine's pulley still holds it at its rope's length from the ground point) would need a run that goes DOWN to the
			// wheel: its rope leaves the wheel where the wrap on that side ends (the top line's point on it, the top of a single wheel) and runs straight up to the body; only a
			// body inside the wheel's rim has no run drawn
			st.upL = !(T1.y > L.y + 1e-4)
			st.upR = !(T4.y > R.y + 1e-4)
			if (st.upL) {
				T1.x = w0.cx + Math.cos(topA) * w0.rc
				T1.y = w0.cy + Math.sin(topA) * w0.rc
			}
			if (st.upR) {
				T4.x = w1.cx + Math.cos(topA) * w1.rc
				T4.y = w1.cy + Math.sin(topA) * w1.rc
			}
			st.la = Math.hypot(L.x - T1.x, L.y - T1.y)
			st.lb = Math.hypot(R.x - T4.x, R.y - T4.y)
			st.okL = !st.upL || Math.hypot(L.x - w0.cx, L.y - w0.cy) > w0.rc + 2 * rho
			st.okR = !st.upR || Math.hypot(R.x - w1.cx, R.y - w1.cy) > w1.rc + 2 * rho
			st.aL = st.upL ? topA : Math.min(PI + REACH, unwrap(Math.atan2(T1.y - C0.y, T1.x - C0.x), mode === "two" ? topA : -REACH))
			st.aR = st.upR ? topA : Math.max(-REACH, unwrap(Math.atan2(T4.y - C1.y, T4.x - C1.x), (mode === "two" ? topA : PI + REACH) - 2 * PI))
		}
		solve()
		const la0 = st.la
		const lb0 = st.lb
		updaters.push(() => {
			solve()
			segs[0].visible = st.okL
			segs[2].visible = st.okR
			hooks[0].visible = st.ok && st.okL
			hooks[1].visible = st.ok && st.okR
			segs[1].visible = st.ok && mode === "two"
			if (!st.ok) {
				for (let k = 0; k < wraps.length; k++) wraps[k].m.visible = false
				return
			}
			if (st.okL) stretchBetween(segs[0], L.x, L.y, T1.x, T1.y)
			if (st.okR) stretchBetween(segs[2], T4.x, T4.y, R.x, R.y)
			hooks[0].position.set(L.x, L.y, 0)
			hooks[1].position.set(R.x, R.y, 0)
			if (mode === "two") {
				setWrap(0, topA, st.okL ? st.aL : PI)
				setWrap(1, st.okR ? st.aR : 0, topA)
			} else setWrap(0, st.okR ? st.aR : 0, st.okL ? st.aL : PI) // (a run that is not drawn: the wrap stops at that side's own point)
			wheels[0].rotation.z = (st.la - la0) / w0.rc // rope paid out on the left run: the wheel turns that way (counter-clockwise: its top moves left)
			if (mode === "two") wheels[1].rotation.z = -(st.lb - lb0) / w1.rc
		})
	}

	const beltPool = []
	const belts = [] // every band material made (pooled or in a run): the environment map and disposal reach them all
	const makeBelt = () => {
		const tex = canvasTexture(beltCanvas(), true, "both")
		const band = satify(new THREE.MeshPhysicalMaterial({ ...surfaceOf({ roughness: 0.88 }), color: lin3([1, 1, 1], 0.95), map: tex, bumpMap: tex, bumpScale: 1.2 }))
		const pair = { tex, band }
		belts.push(pair)
		return pair
	}
	/** The material, geometry and fittings of a conveyor belt (a solid with surfaceSpeed): a rubber band with ribs that run at the
	 *  belt's speed round a steel roller at each end. */
	function beltKit(s, owned, updaters) {
		const body = s.body
		const w = body.width + 2 * SKIN
		const h = body.height + 2 * SKIN
		const D = depthOf(body)
		const geo = geometry(`belt|${w.toFixed(4)}|${h.toFixed(4)}|${D.toFixed(4)}`, () => beltGeometry(w, h, D, BELT_PERIOD))
		const unit = geo.userData.unit
		// a band material and its own texture object (its offset is this belt's), taken from the pool of the earlier runs' belts: a material
		// that is disposed with its run takes its shader programs with it, and three.js relinks them at the next load
		const pair = beltPool.pop() ?? makeBelt()
		const { tex, band } = pair
		owned.push({ dispose: () => beltPool.push(pair) })
		const rr = Math.max(0.3 * h, h / 2 - 0.003)
		const len = D + 0.016
		return {
			geo,
			mats: [band, beltCapMaterial()],
			finish(mesh) {
				const steel = steelMaterial()
				const rollGeo = geometry(`roller|${rr.toFixed(4)}|${len.toFixed(4)}`, () => new THREE.CylinderGeometry(rr, rr, len, 28).rotateX(Math.PI / 2))
				const marks = geometry(`rollermarks|${rr.toFixed(4)}|${len.toFixed(4)}`, () => rollerMarksGeometry(rr, len))
				const rollers = []
				for (const sx of [-1, 1]) {
					const r = addMesh(mesh, rollGeo, steel)
					r.position.set((sx * Math.max(0, w - h)) / 2, 0, 0)
					addMesh(r, marks, darkMetalMaterial())
					rollers.push(r)
				}
				updaters.push((t) => {
					tex.offset.x = frac((-s.surfaceSpeed * t) / unit) // the top runs +x at surfaceSpeed (its own frame)
					for (const r of rollers) r.rotation.z = (-s.surfaceSpeed * t) / rr
				})
			},
		}
	}

	/** Where solid `s` starts: its placement in the track's first frame (its own `at` when the track has none). */
	const poseIn = (frame0, s) => {
		const q = frame0[s.id]
		return { x: q ? q.x : s.at.x, y: q ? q.y : s.at.y, angle: q ? q.angle : (s.angle ?? 0) }
	}
	/** Everything a built run depends on except where its solids stand: when two sims agree on this, the live run can be moved instead of rebuilt. */
	const runSig = (sim) => {
		const d = sim.doc
		return JSON.stringify([
			d.solids.map(({ at, angle, ...rest }) => rest),
			d.joints ?? null,
			(d.animated ?? []).map(({ at, ...rest }) => rest),
			d.release ?? null,
			sim.resolved ?? null,
		])
	}

	function buildRun(sim, progressive = false) {
		const { doc, track } = sim
		const serial = ++runSerial
		buildNo++
		const group = new THREE.Group()
		group.name = "run"
		beginRun() // (the model prototypes this run draws are kept until the next run replaces it: see models3d.js)
		const parts = [] // every moving part: {id, mesh, round?, R, blob}
		const pickables = [] // the solid meshes the editor can hit (mesh.userData.solidId)
		const blobs = new THREE.Group() // contact shading on the tabletop (hidden in the table's reflection)
		group.add(blobs)
		const frame0 = track.frames[0].placements
		const solids = doc.solids.filter((s) => !s.hidden_3d)
		// Progressive: when the models still to be built are estimated to cost more than DEFER_MS (kept ones are only cloned), those parts are drawn as plain stand-ins now
		// and built in idle slices afterwards (see runJobs). The rest is built at once, as ever.
		const jobs = []
		const late = [] // work for the idle time after the first frame (a progressive build: the mounts' first build): functions, run by the pump
		let defer = false
		if (progressive) {
			const missing = new Set()
			for (const s of solids) {
				const props = sim.resolved?.[s.item] ?? {}
				if (typeof modelFor(s) === "function" && !isModelCached(s, props)) missing.add(modelKey(s, props))
			}
			defer = missing.size > 0 && missing.size * Math.max(J.ema, 4) > DEFER_MS
		}
		// What depends on where a STATIC solid stands (its frozen mesh, contact shade, legs, held ball's pin): placers[id](pose) sets it. A drag that only
		// moves things calls them again on the live run (see retarget) instead of building it all anew. Dynamic solids are posed by updateParts.
		const placers = new Map()
		const aoRecs = new Map() // solid id -> {ao: {k}, L, s}: the contact shading's share of a part whose model is still to come (the stand-in's look says, the finished model's materials do)
		const staticRound = [] // the static round parts {holder, x, y, dy, Rb, grow}: lifted onto what they stand on (settleStatics)
		const restRound = (holder, Rb, grow, dy) => {
			const E = { holder, x: 0, y: 0, dy, Rb, grow }
			staticRound.push(E)
			return (p) => {
				E.x = p.x
				E.y = p.y
			}
		}
		const addPlacer = (id, fn) => {
			const prev = placers.get(id)
			placers.set(id, prev ? (p) => (prev(p), fn(p)) : fn)
		}
		/** A static solid's contact shade (one blob, w along x, d along z): shade(x, w, opacity) makes it, moves it, or hides it as the shade fades. */
		const shadeOf = (d) => {
			let blob = null
			return (x, w, o) => {
				if (o > 0.03) {
					blob ??= addBlob(blobs, x, 0, w, d, o)
					blob.position.x = x
					blob.scale.x = w
					blob.material.opacity = o
					blob.visible = true
				} else if (blob) blob.visible = false
			}
		}
		const cords = [] // {mesh, ai, pz}: the cords of hung items, at doc.animated[ai].at
		const scenery = [] // the legs, pins and posts: in the wide shot besides the solids (the cords are not)
		cur.fa = cur.fb = frame0 // the joint builders read the starting moment
		cur.u = 0
		solidById = new Map(doc.solids.map((o) => [o.id, o]))
		const owned = [] // geometries, textures and materials that belong to this run alone (disposed with it)
		const updaters = [] // (t) => pose the joint hardware at moment t
		const wheelOf = new Map() // wheel solid id -> its wheel joint: drawn as tyres on an axle
		for (const j of doc.joints ?? []) if (j.kind === "wheel" && j.wheel) wheelOf.set(j.wheel, j)
		const poseOf = (s) => poseIn(frame0, s)
		const table = solids.find(isTableSolid) ?? null
		let tableMesh = null
		// Resting gap (see restLowering). supports: the top faces of the static slabs, kept current by their placers. A slab / polygon part gets `rest`;
		// the parts of one welded item share a group so they are lowered together. Movers are lowered at every draw (updateParts), statics once (settleStatics).
		const supports = []
		const staticRest = [] // {mesh, rest, x, y, angle}: the static slabs and polygons that can be lowered
		const dynGroups = []
		const staticGroups = []
		const groupsByRoot = new Map()
		const rootOf = (s) => {
			let root = s
			for (let i = 0; i < 8 && root.parent && !root.pivot; i++) root = solidById.get(root.parent) ?? root
			return root
		}
		const groupOf = (s, list) => {
			const root = rootOf(s)
			const key = (list === staticGroups ? "s|" : "d|") + root.id
			let g = groupsByRoot.get(key)
			if (!g) {
				g = { off: 0, lo: 0, hi: 0 } // (off: what the group is drawn lowered by; hi / lo: the largest lowering / raising any part of it asked for)
				groupsByRoot.set(key, g)
				list.push(g)
			}
			return g
		}
		/** The resting-gap record of slab / polygon solid s whose drawn mesh sticks `grow` m out of its outline. */
		const restOf = (s, grow, list) => {
			const b = s.body
			return { id: s.id, grow, pts: b.kind === "polygon" ? b.points : null, hw: (b.width ?? 0) / 2, hh: (b.height ?? 0) / 2, grp: groupOf(s, list), x: 0, y: 0, angle: 0, sup: null, dep: null }
		}
		const moverSupports = [] // the dynamic slabs, as supports for the parts that lie on them (posed at every draw)
		/** The record of dynamic slab / polygon s, or null for a hinged one (it turns about its pivot, so it is not moved straight down) and what is welded to it.
		 *  A slab is also a support: a part resting on it is drawn with its offset, so the gap between the two stays what the physics has. */
		const dynRest = (s, grow) => {
			if (rootOf(s).pivot) return null
			const rest = restOf(s, grow, dynGroups)
			if (s.body.kind === "slab") {
				const q = poseOf(s)
				rest.sup = { id: s.id, x: q.x, y: q.y, c: Math.cos(q.angle), s: Math.sin(q.angle), hw: rest.hw, hh: rest.hh, grow, grp: rest.grp }
				moverSupports.push(rest.sup)
			}
			return rest
		}
		/** A static slab (a support for the parts above) and/or a static part that can be lowered: returns at(pose), which records where it stands. */
		const restStatic = (s, mesh, grow, lowers = true) => {
			const rest = restOf(s, grow, staticGroups)
			const E = { mesh, rest, x: 0, y: 0, angle: 0 }
			if (lowers) staticRest.push(E)
			const sup = s.body.kind === "slab" ? { id: s.id, x: 0, y: 0, c: 1, s: 0, hw: rest.hw, hh: rest.hh, grow } : null
			if (sup) supports.push(sup)
			return (p) => {
				E.x = p.x
				E.y = p.y
				E.angle = p.angle
				if (sup) {
					sup.x = p.x
					sup.y = p.y
					sup.c = Math.cos(p.angle)
					sup.s = Math.sin(p.angle)
				}
			}
		}
		const spinners = [] // model parts that turn: {obj, axis, rate, from, q0}
		const frameHooks = [] // model parts a module's frame hook redraws by the clock (web/view-plugins.js: a glow, a dial, a level)
		const helpers = [] // while models are deferred: the parts a model covers for its whole welded item (a jar's walls, a cone's collar), which get no stand-in of their own in the loop
		for (const s of solids) {
			const body = s.body
			const L = lookOf(s)
			const q = poseOf(s)
			const keep = lookKeep(L) // (how much contact shading it casts on the table: none to speak of for glass)
			// a catalog item with its own realistic model (web/models/*.js): drawn in place of the plain shape below
			const props = sim.resolved?.[s.item] ?? {}
			let mdl
			let standIn = false
			const mf = modelFor(s)
			if (defer && typeof mf === "function" && !isModelCached(s, props)) {
				mdl = placeholderMesh(s, L)
				standIn = true
			} else {
				const b0 = performance.now()
				mdl = buildModel(s, { props, look: L })
				if (typeof mf === "function") noteBuild(performance.now() - b0)
			}
			if (mdl !== undefined) {
				if (mdl === null) {
					placers.set(s.id, () => {})
					if (defer) helpers.push({ s, L }) // (its item's model is still to come: see the stand-ins of the helper parts, below)
					continue // a helper part its item's model already covers
				}
				const holder = new THREE.Group()
				holder.name = s.id
				holder.add(mdl)
				if (standIn) jobs.push({ s, props, L, holder, ph: mdl, mdl: null, area: areaOf(body) })
				holder.traverse((o) => {
					if (o.isMesh) {
						o.userData.solidId = s.id
						pickables.push(o)
					}
					if (o.userData.spin) {
						const sp = spinOf(o) // a model part that turns about its own axis (a fan's blades): turned by t in updateParts
						if (sp) spinners.push(sp)
					}
					if (o.userData.frame) collectHooks(o, s.id, frameHooks)
				})
				holder.position.set(q.x, q.y, 0)
				holder.rotation.z = q.angle
				group.add(holder)
				const round = isRound(s)
				const hw = round ? body.radius : (body.width ?? 0.05) / 2
				const hh = round ? body.radius : (body.height ?? 0.05) / 2
				const dz = round ? (s.depth3d ?? 2 * body.radius) : depthOf(body)
				const pts = body.kind === "polygon" ? body.points : null // a polygon touches down on its outline's lowest corners
				const ao = { k: standIn ? keep : Math.min(keep, modelKeep(mdl, L)) } // (a clear look or a clear model: a model may finish its glass only at its first draw, so the look speaks too)
				aoRecs.set(s.id, { ao, L, s })
				if (s.kind === "dynamic") {
					if (round) parts.push({ id: s.id, mesh: holder, round: true, R: body.radius, grow: 0, ao, blob: addBlob(blobs, 0, 0, 3 * body.radius, dz + 0.05, 0) })
					else parts.push({ id: s.id, mesh: holder, hw, hh, pts, ao, blob: addBlob(blobs, 0, 0, 0.06, dz + 0.05, 0), rest: dynRest(s, 0) })
				} else {
					const shade = round ? null : shadeOf(dz + 0.05)
					const at = round ? restRound(holder, body.radius, 0, 0) : restStatic(s, holder, 0)
					const place = (p) => {
						holder.position.set(p.x, p.y, 0)
						holder.rotation.z = p.angle
						freeze(holder)
						at(p)
						if (!shade) return
						if (pts) polyFoot(pts, p, foot)
						else slabFoot(hw, hh, p, foot)
						shade(foot.x, Math.max(0.05, foot.span + 0.05), AO_OPACITY * ao.k * Math.exp(-foot.h / 0.012))
					}
					addPlacer(s.id, place)
					place(q)
				}
				continue
			}
			if (isRound(s)) {
				const R = body.radius + SKIN * 0.5
				const wj = wheelOf.get(s.id)
				if (wj) {
					// a wheel on a joint: rubber tyres (one each side of the chassis) round a hub with spokes, on a steel axle
					const W = s.depth3d ?? Math.max(0.01, 0.55 * R)
					const cd = bodyDepth(wj.chassis)
					const zc = cd > 0 ? cd / 2 + W / 2 + 0.003 : 0
					const holder = new THREE.Group()
					holder.name = s.id
					const tyreGeo = geometry(`tyre|${R.toFixed(5)}|${W.toFixed(5)}`, () => tyreGeometry(R, W))
					const discGeo = geometry(`wdisc|${R.toFixed(5)}|${W.toFixed(5)}`, () => new THREE.CylinderGeometry(0.66 * R, 0.66 * R, 0.9 * W, 40).rotateX(Math.PI / 2))
					const steelGeo = geometry(`wsteel|${R.toFixed(5)}|${W.toFixed(5)}`, () => wheelSteelGeometry(R, W))
					for (const z of zc > 0 ? [-zc, zc] : [0]) {
						const tyre = addMesh(holder, tyreGeo, tyreMaterial())
						const disc = addMesh(holder, discGeo, logMaterials(s))
						const hub = addMesh(holder, steelGeo, steelMaterial())
						for (const m of [tyre, disc, hub]) m.position.z = z
						for (const m of [tyre, disc]) {
							m.userData.solidId = s.id
							pickables.push(m)
						}
					}
					if (zc > 0) {
						const ar = Math.max(0.0025, 0.08 * R)
						addMesh(holder, geometry(`waxle|${ar.toFixed(5)}|${zc.toFixed(5)}`, () => new THREE.CylinderGeometry(ar, ar, 2 * zc, 16).rotateX(Math.PI / 2)), steelMaterial())
					}
					holder.position.set(q.x, q.y, 0)
					holder.rotation.z = q.angle
					group.add(holder)
					if (s.kind === "dynamic") parts.push({ id: s.id, mesh: holder, round: true, R, grow: SKIN * 0.5, ao: { k: 1 }, blob: addBlob(blobs, 0, 0, 3 * R, 2 * zc + W + 0.05, 0) })
					else {
						const place = (p) => {
							holder.position.set(p.x, p.y, 0)
							holder.rotation.z = p.angle
							freeze(holder)
						}
						addPlacer(s.id, place)
						place(q)
					}
					continue
				}
				if (s.shape === "cylinder") {
					const len = s.depth3d ?? 4 * body.radius
					const tone = s.look === "light wood" ? "domino" : "wood"
					const geo = geometry(`log|${R.toFixed(5)}|${len.toFixed(4)}|${tone}|${L.grain ? s.id : ""}`, () => logGeometry(R, len, TILES[tone], s.id, !!L.grain))
					const mesh = addMesh(group, geo, logMaterials(s))
					mesh.userData.solidId = s.id
					mesh.position.set(q.x, q.y, 0)
					mesh.rotation.z = q.angle
					pickables.push(mesh)
					if (s.kind === "dynamic") parts.push({ id: s.id, mesh, round: true, R, grow: SKIN * 0.5, ao: { k: keep }, blob: addBlob(blobs, 0, 0, 3 * R, len + 0.05, 0) })
					else {
						const shade = shadeOf(len + 0.05)
						const at = restRound(mesh, body.radius, SKIN * 0.5, 0)
						const place = (p) => {
							mesh.position.set(p.x, p.y, 0)
							mesh.rotation.z = p.angle
							freeze(mesh)
							at(p)
							shade(p.x, 3 * R, AO_OPACITY * keep * Math.exp(-Math.max(0, p.y - R - TABLE_TOP) / (1.1 * R)))
						}
						addPlacer(s.id, place)
						place(q)
					}
					continue
				}
				const holder = new THREE.Group() // origin at the ball's lowest point, so a clay squash dents it from the top
				holder.name = s.id
				const geo = geometry(`sphere|${R.toFixed(5)}`, () => new THREE.SphereGeometry(R, 64, 32))
				const mesh = addMesh(holder, geo, ballMaterial(s))
				mesh.userData.solidId = s.id
				mesh.position.set(0, R, 0)
				group.add(holder)
				holder.position.set(q.x, q.y - R, 0)
				mesh.rotation.z = q.angle
				pickables.push(mesh)
				if (s.kind === "dynamic") parts.push({ id: s.id, ball: true, holder, mesh, R, grow: SKIN * 0.5, ao: { k: keep }, blob: addBlob(blobs, 0, 0, 3.6 * R, 3.6 * R, 0) })
				else {
					const shade = shadeOf(3.6 * R)
					const at = restRound(holder, body.radius, SKIN * 0.5, -R)
					const place = (p) => {
						holder.position.set(p.x, p.y - R, 0)
						mesh.rotation.z = p.angle
						at(p)
						shade(p.x, 3.6 * R, AO_OPACITY * keep * Math.exp(-Math.max(0, p.y - R - TABLE_TOP) / (1.1 * R)))
					}
					addPlacer(s.id, place)
					place(q)
				}
				continue
			}
			if (body.kind === "polygon") {
				// a polygon solid: its outline extruded through its depth (small bevelled edges), its surface from its look (+ colour)
				const tone = s.look === "light wood" ? "domino" : "wood"
				const geo = geometry(`poly|${body.points.map((p) => p.x + "," + p.y).join(" ")}|${depthOf(body)}|${L.grain ? tone + "|" + s.id : ""}`, () =>
					polyGeometry(body, TILES[tone], s.id, !!L.grain),
				)
				const mesh = addMesh(group, geo, slabMaterial(s, false))
				mesh.userData.solidId = s.id
				mesh.position.set(q.x, q.y, 0)
				mesh.rotation.z = q.angle
				pickables.push(mesh)
				if (s.kind === "dynamic") parts.push({ id: s.id, mesh, pts: body.points, ao: { k: keep }, blob: addBlob(blobs, 0, 0, 0.06, depthOf(body) + 0.05, 0), rest: dynRest(s, SKIN) })
				else {
					// a static one resting on the table gets its contact shading once
					const shade = shadeOf(depthOf(body) + 0.05)
					const at = restStatic(s, mesh, SKIN)
					const place = (p) => {
						mesh.position.set(p.x, p.y, 0)
						mesh.rotation.z = p.angle
						freeze(mesh)
						at(p)
						polyFoot(body.points, p, foot)
						shade(foot.x, Math.max(0.05, foot.span + 0.05), AO_OPACITY * keep * Math.exp(-foot.h / 0.012))
					}
					addPlacer(s.id, place)
					place(q)
				}
				continue
			}
			// a slab: its depth is body.depth, its surface comes from its look (+ colour)
			const isTable = s === table
			const tile = isTable ? "table" : s.look === "light wood" ? "domino" : "wood"
			const belt = !isTable && s.surfaceSpeed !== undefined ? beltKit(s, owned, updaters) : null // a conveyor: drawn as a running belt
			const geo = belt?.geo ?? geometry(
				`slab|${body.width}|${body.height}|${depthOf(body)}|${body.taper ?? ""}|${L.grain ? tile + "|" + s.id : ""}${isTable ? "|T" : ""}`,
				() => {
					const g = slabGeometry(body, TILES[tile], s.id, !!L.grain)
					if (isTable) {
						const nor = g.attributes.normal
						const col = new Float32Array(nor.count * 3)
						for (let i = 0; i < nor.count; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.abs(nor.getY(i)) > 0.7 ? 1 : 0.95
						g.setAttribute("color", new THREE.BufferAttribute(col, 3))
					}
					return g
				},
			)
			const mesh = addMesh(group, geo, belt ? belt.mats : slabMaterial(s, isTable))
			mesh.userData.solidId = s.id
			mesh.position.set(q.x, q.y, 0)
			mesh.rotation.z = q.angle
			belt?.finish(mesh)
			pickables.push(mesh)
			if (isTable) tableMesh = mesh
			if (s.kind === "dynamic") parts.push({ id: s.id, mesh, hw: body.width / 2, hh: body.height / 2, ao: { k: keep }, blob: addBlob(blobs, 0, 0, 0.06, depthOf(body) + 0.05, 0), rest: dynRest(s, SKIN) })
			else if (isTable) {
				freeze(mesh) // (the table has no placer: moving it rebuilds the run)
				restStatic(s, mesh, SKIN, false)(q) // it only supports what stands on it
			} else {
				// a static slab that rests on the table (a ramp's low end, a fulcrum) gets its contact shading once
				const shade = shadeOf(depthOf(body) + 0.05)
				const at = restStatic(s, mesh, SKIN)
				const place = (p) => {
					mesh.position.set(p.x, p.y, 0)
					mesh.rotation.z = p.angle
					freeze(mesh)
					at(p)
					slabFoot(body.width / 2, body.height / 2, p, foot)
					shade(foot.x, Math.max(0.05, foot.span + 0.05), AO_OPACITY * keep * Math.exp(-foot.h / 0.012))
				}
				addPlacer(s.id, place)
				place(q)
			}
		}

		const solidRoots = group.children.slice(1) // (the first child is the contact shades): every solid's mesh or holder, the table's too
		// ----- joints: springs, ropes, hinges (+ motors), pulleys (wheels and belts were drawn with their solids above) ----------
		for (const j of doc.joints ?? []) {
			if (j.kind === "spring") buildSpring(group, j, owned, updaters)
			else if (j.kind === "rope") (j.render?.style === "chain" ? buildChain : buildRope)(group, j, owned, updaters)
			else if (j.kind === "pulley" && j.render?.draw !== "none") buildPulley(group, j, owned, updaters) // (render.draw "none": a module draws its own rope: an edge pulley's string, a block and tackle's strands)
			else if (j.kind === "pin" && j.render?.hinge !== "none") { // a joint may say its own model draws the pivot (a pinball flipper), with no generic hinge or motor can
				const at = j.b !== null ? [j.b, j.anchorB] : [j.a, j.anchorA]
				if (at[0] !== null) buildHinge(group, { atId: at[0], atAnchor: at[1], aId: j.a, bId: j.b, depth: Math.max(bodyDepth(j.a), bodyDepth(j.b)), motor: j.motor }, updaters)
			}
		}
		for (const s of doc.solids) if (s.pivot && s.motor) buildHinge(group, { atId: s.id, atAnchor: s.pivot, aId: s.parent ?? null, bId: s.id, depth: bodyDepth(s.id), motor: s.motor }, updaters) // a motorised pivot

		// ----- the see-through safety walls (hidden_3d solids): a faint acrylic pane, drawn only while their item is selected or hovered ------
		const panes = []
		for (const s of doc.solids) {
			if (!s.hidden_3d) continue
			const b = s.body
			if (b.kind === "ball") {
				placers.set(s.id, () => {})
				continue
			}
			const d = depthOf(b)
			const geo = geometry(`pane|${b.kind === "polygon" ? b.points.map((p) => p.x + "," + p.y).join(" ") : b.width + "x" + b.height}|${d}`, () =>
				b.kind === "polygon"
					? new THREE.ExtrudeGeometry(new THREE.Shape(b.points.map((p) => new THREE.Vector2(p.x, p.y))), { depth: d, bevelEnabled: false, steps: 1 }).translate(0, 0, -d / 2)
					: new THREE.BoxGeometry(b.width, b.height, d),
			)
			const mesh = new THREE.Mesh(geo, paneMaterial())
			mesh.layers.set(PANE_LAYER)
			mesh.renderOrder = 2
			mesh.userData.solidId = s.id
			mesh.userData.pane = true // (pick() prefers anything drawn behind it)
			const edges = new THREE.LineSegments(geometry(`paneedge|${geo.uuid}`, () => new THREE.EdgesGeometry(geo, 30)), paneEdgeMaterial())
			edges.layers.set(PANE_LAYER)
			edges.renderOrder = 3
			mesh.add(edges)
			mesh.visible = !!s.item && (s.item === hl.selected || s.item === hl.hover)
			group.add(mesh)
			panes.push({ mesh, item: s.item })
			const place = (p) => {
				mesh.position.set(p.x, p.y, 0)
				mesh.rotation.z = p.angle
				freeze(mesh)
			}
			if (s.kind === "static") addPlacer(s.id, place)
			else placers.set(s.id, () => {}) // (a walking wall is drawn where it starts)
			place(poseOf(s))
		}

		// ----- render-only scenery, outside the motion plane --------------------------------------------------------------
		const wood = sceneryWood()
		const dowel = (radius, k, id) => geometry(`dowel|${radius}|${k}|${id}`, () => dowelGeometry(radius, "wood", id, radius < 0.006 ? 16 : 24))
		// legs under every static solid with legs: true, at both ends (an end under 3 cm needs none)
		for (const s of solids) {
			if (!s.legs || s.body.kind !== "slab" || s.kind !== "static") continue
			const hw = s.body.width / 2
			const hh = s.body.height / 2
			const reach = hw - Math.min(0.04, hw * 0.5)
			const legs = [] // both ends, front and back; an end that sits on the table has none (hidden)
			for (const sx of [-1, 1])
				for (const pz of [-0.375, 0.375]) {
					const z = pz * depthOf(s.body)
					const leg = addMesh(group, dowel(0.008, "leg", `${s.id}-leg${sx}${pz}`), wood)
					scenery.push(leg)
					legs.push({ sx, z, leg, blob: addBlob(blobs, 0, z, 0.05, 0.05, AO_OPACITY) })
				}
			const place = (p) => {
				const c = Math.cos(p.angle)
				const sn = Math.sin(p.angle)
				for (const { sx, z, leg, blob } of legs) {
					const ex = p.x + sx * reach * c + hh * sn
					const ey = p.y + sx * reach * sn - hh * c
					leg.visible = blob.visible = ey >= 0.03
					if (ey < 0.03) continue
					const len = ey + 0.006 // sunk a little into the slab so a tilted underside never shows a gap
					leg.scale.y = len
					leg.position.set(ex, len / 2, z)
					freeze(leg)
					blob.position.x = ex
				}
			}
			addPlacer(s.id, place)
			place(poseOf(s))
		}
		// Mounts: a static part held in mid-air with nothing under it (a hanger's bar, a peg, a bumper, a peg board's panel) floats, so a believable support is drawn behind it, out
		// of the motion plane (z < -depth/2, and never nearer than 7.5 cm to it) where nothing moves: "post" = a retort stand (a steel rod on a heavy foot on the table, a boss head
		// and an arm to the part's back), "panel" = an upright of plywood with two stabilising feet, "wall" = a wooden bracket from the room's wall (for a mount high up).
		// `solid.stand` = "post" | "panel" | "wall" says which; without it the view works it out: a static solid that carries a hinge or a joint (a joint names it, a pivot or a
		// world anchor sits on it) gets a post (a wall bracket above 1.3 m), the static balls of an item (pegs, bumpers: only a board can hold them) a post, or a panel for two or more.
		// It is drawn only while nothing stands under the part (a static within 3 cm below it, or the table), picks as the part (userData.mount: the surface under the cursor is
		// never the support), follows the part when it is dragged and is left out of the wide shot's framing (so every shot frames as it did). Built on first need (after the first
		// frame of a progressive load). A post whose foot would hang past the tabletop's end is a wall bracket there; every support stands behind the deepest mover that passes by
		// (moversDepth), and an arm that lands on a drawn panel is carried by it.
		const mountPose = new Map() // static solid id -> its pose now (kept by a placer)
		const supporters = solids.filter((o) => o.kind === "static")
		for (const o of supporters) {
			mountPose.set(o.id, poseOf(o))
			if (o !== table && placers.has(o.id)) addPlacer(o.id, (p) => mountPose.set(o.id, p))
		}
		const mountBox = { x0: 0, x1: 0, y0: 0, y1: 0 }
		const boxOfStatic = (s, out) => {
			const e = extentOf(s.body, mountPose.get(s.id))
			out.x0 = e.x0
			out.x1 = e.x1
			out.y0 = e.y0
			out.y1 = e.y1
			return out
		}
		const depthOfSolid = (s) => (isRound(s) ? (s.depth3d ?? 2 * s.body.radius) : depthOf(s.body))
		/** True when nothing stands under the static solid s: no other static within 3 cm below its underside (and reaching up to its top) across its width, no tabletop. */
		const heldUp = (s) => {
			const b = boxOfStatic(s, mountBox)
			if (!table && b.y0 <= 0.03) return false
			for (const o of supporters) {
				if (o === s || (isRound(s) && isRound(o) && o.item === s.item)) continue // (the pegs of one board do not hold one another)
				const f = extentOf(o.body, mountPose.get(o.id))
				if (f.x1 < b.x0 - 0.005 || f.x0 > b.x1 + 0.005) continue
				if (f.y1 >= b.y0 - 0.03 && f.y0 <= b.y1) return false
			}
			return true
		}
		const carriers = new Set() // ids of the solids a joint is made fast to
		const hingePts = [] // world points where something hinges or hangs from the world: a pivot, a rope's or spring's world end, a pulley's rope
		for (const j of doc.joints ?? []) {
			for (const id of [j.a, j.b, j.chassis, j.wheel]) if (id) carriers.add(id)
			if (j.kind === "pulley") hingePts.push(j.groundA, j.groundB)
			else if (j.kind !== "wheel") {
				if (j.a === null || j.a === undefined) hingePts.push(j.anchorA)
				if (j.b === null || j.b === undefined) hingePts.push(j.anchorB)
			}
		}
		for (const d of doc.solids) {
			if (!d.pivot) continue
			if (d.parent) carriers.add(d.parent)
			else {
				const q = poseOf(d)
				hingePts.push({ x: q.x + d.pivot.x * Math.cos(q.angle) - d.pivot.y * Math.sin(q.angle), y: q.y + d.pivot.x * Math.sin(q.angle) + d.pivot.y * Math.cos(q.angle) })
			}
		}
		const carries = (s) => {
			if (carriers.has(s.id)) return true
			const b = boxOfStatic(s, mountBox)
			for (const h of hingePts) if (h.x >= b.x0 - 0.04 && h.x <= b.x1 + 0.04 && h.y >= b.y0 - 0.04 && h.y <= b.y1 + 0.04) return true
			return false
		}
		const hintOf = (s) => (s.stand === "post" || s.stand === "panel" || s.stand === "wall" ? s.stand : null)
		const MOUNT_TALL = 1.3 // a detected mount whose underside is higher than this is held by a bracket from the wall, not a rod from the table
		const plans = []
		const byItem = new Map()
		for (const s of supporters) {
			if (s === table || isTableSolid(s) || s.stand === "none") continue // ("none": drawn in mid-air with no support, as a body in space)
			if (!byItem.has(s.item)) byItem.set(s.item, [])
			byItem.get(s.item).push(s)
		}
		for (const list of byItem.values()) {
			const balls = list.filter(isRound)
			if (balls.length) {
				const kind = balls.map(hintOf).find(Boolean) ?? (balls.length > 1 ? "panel" : "post")
				if (kind === "panel") plans.push({ kind, members: balls })
				else for (const b of balls) plans.push({ kind, members: [b] })
			}
			for (const s of list) {
				if (isRound(s)) continue
				const kind = hintOf(s)
				if (kind) plans.push({ kind, members: [s] })
				else if (carries(s)) plans.push({ kind: boxOfStatic(s, mountBox).y0 > MOUNT_TALL ? "wall" : "post", members: [s] })
			}
		}
		plans.sort((a, b) => (a.kind === "panel" ? 0 : 1) - (b.kind === "panel" ? 0 : 1)) // (the panels are placed first: a hanger's arm that lands on one is held by it)
		// How deep the movers are where a support stands: a stand's rod, foot and a panel stay BEHIND the deepest mover (a bowling ball, a box, a laptop, a swing's seat) that
		// passes within 6 cm of it along x anywhere in the run, so nothing moving meets them. The sweeps are worked out once, on the first need.
		let sweeps = null
		const moversDepth = (x0, x1) => {
			if (!sweeps) {
				sweeps = []
				const frames = track.frames
				const stride = Math.max(1, Math.floor(frames.length / 160))
				for (const s of solids) {
					if (s.kind !== "dynamic") continue
					const half = depthOfSolid(s) / 2
					if (half <= 0.03) continue // (nothing thinner than a peg's own depth can come in front of a stand or a panel)
					let lo = Infinity
					let hi = -Infinity
					for (let k = 0; k < frames.length + stride - 1; k += stride) {
						const q = frames[Math.min(k, frames.length - 1)].placements[s.id]
						if (!q) continue
						const e = extentOf(s.body, q)
						if (e.x0 < lo) lo = e.x0
						if (e.x1 > hi) hi = e.x1
					}
					if (hi >= lo) sweeps.push({ half, lo, hi })
				}
			}
			let h = 0
			for (const w of sweeps) if (w.hi >= x0 - 0.06 && w.lo <= x1 + 0.06 && w.half > h) h = w.half
			return h
		}
		/** How deep the STATIC parts are that stand where a support goes (across x0..x1, anywhere from the table up to yTop): a panel's sheet, legs and feet and a stand's
		 *  rod and foot stay behind them too (a conveyor or a basket under a raised board, a deep block beside a hanger), as behind the movers. `skip`: the parts the
		 *  support holds; the tabletop never counts. */
		const staticsDepth = (x0, x1, yTop, skip) => {
			let h = 0
			for (const o of supporters) {
				if (o === table || skip.has(o) || isTableSolid(o)) continue
				const f = extentOf(o.body, mountPose.get(o.id))
				if (f.x1 < x0 - 0.005 || f.x0 > x1 + 0.005 || f.y0 > yTop || f.y1 < TABLE_TOP - 0.005) continue
				const half = depthOfSolid(o) / 2
				if (half > h) h = half
			}
			return h
		}
		/** The x of each rod of a part's post: one in the middle, or one near each end of a wide bar (over 26 cm: a swing's). */
		const rodsOf = (s) => {
			const { x0, x1 } = boxOfStatic(s, mountBox)
			return x1 - x0 > 0.26 ? [x0 + 0.05, x1 - 0.05] : [(x0 + x1) / 2]
		}
		const tableBox = table ? boxOfStatic(table, { x0: 0, x1: 0, y0: 0, y1: 0 }) : null
		/** True when a retort stand's foot (11 cm wide) at x stands on the tabletop (no table in the scene: the floor, anywhere). */
		const onTable = (x) => !tableBox || (x - 0.055 >= tableBox.x0 + 0.005 && x + 0.055 <= tableBox.x1 - 0.005)
		const panelRects = [] // the panels drawn now: {x0, x1, y1, z} (z: their front face), so a stand's arm that lands on one is carried by it
		const plywood = () => slabMaterial({ look: "light wood" }, false)
		const mountMesh = (inst, geo, mat) => {
			const m = addMesh(group, geo, mat)
			m.userData.solidId = inst.members[0].id // (a click on the support picks the part it holds)
			m.userData.mount = true
			pickables.push(m)
			inst.meshes.push(m)
			return m
		}
		const putAt = (m, x, y, z) => {
			m.position.set(x, y, z)
			freeze(m)
		}
		/** A box of wood (grain along its longest side, as a plank's) from the shared geometry cache, sizes to the millimetre. */
		const woodBox = (w, h, d, id) => {
			const q = (v) => Math.round(v * 1000) / 1000
			return geometry(`mountbox|${q(w)}|${q(h)}|${q(d)}`, () => slabGeometry({ width: q(w), height: q(h), depth: q(d) }, TILES.wood, id, true))
		}
		const rodGeo = (r) => geometry(`mountrod|${r}`, () => new THREE.CylinderGeometry(r, r, 1, 18))
		const bossGeo = geometry("mountboss", () => new RoundedBoxGeometry(0.028, 0.028, 0.028, 2, 0.003))
		const footGeo = geometry("mountfoot", () => new RoundedBoxGeometry(0.11, 0.02, 0.22, 2, 0.005))
		const knobGeo = geometry("mountknob", () => new THREE.SphereGeometry(0.0075, 14, 10))
		const screwGeo = geometry("mountscrew", () => new THREE.CylinderGeometry(0.0033, 0.0033, 0.02, 10).rotateZ(Math.PI / 2))
		const capGeo = geometry("mountcap", () => new THREE.SphereGeometry(0.0067, 14, 10))
		const MOUNT_FOOT = 0.02 // the retort stand's foot, m
		const PANEL_RAISE = 0.3 // m: a panel whose parts leave more than this clear under the sheet stands on two legs
		// Each plan has one INSTANCE per kind it has been drawn as: a post that would stand off the tabletop's end is held by a bracket from the wall instead (the rod's foot
		// would hang in the air), and goes back to the post when it is dragged on again. An instance is {kind, members, meshes, fit}, made on first need.
		const mountBuilders = {
			post(inst) {
				const s = inst.members[0]
				const wide = rodsOf(s).length > 1 // a wide bar (a swing's) is held at both ends
				const steel = steelMaterial()
				const dark = darkMetalMaterial()
				const parts = []
				for (let k = 0; k < (wide ? 2 : 1); k++)
					parts.push({
						rod: mountMesh(inst, rodGeo(0.0065), steel),
						cap: mountMesh(inst, capGeo, steel),
						foot: mountMesh(inst, footGeo, dark),
						boss: mountMesh(inst, bossGeo, dark),
						screw: mountMesh(inst, screwGeo, steel),
						knob: mountMesh(inst, knobGeo, dark),
						arm: mountMesh(inst, rodGeo(0.005), steel),
						blob: addBlob(blobs, 0, 0, 0.17, 0.3, AO_OPACITY),
					})
				inst.meshes.push(...parts.map((q) => q.blob))
				const own = new Set([s])
				inst.fit = () => {
					const b = boxOfStatic(s, mountBox)
					const { y0, y1 } = b
					const xs = rodsOf(s)
					const d = depthOfSolid(s)
					const top = TABLE_TOP + MOUNT_FOOT
					const yTop = y1 + 0.012
					// the rod stands behind the deepest mover that passes by, the deepest static part its rod or foot would meet (a block, a conveyor beside the hanger) and the
					// part's own back: out of the motion plane, never nearer than 7.5 cm
					const xa = Math.min(...xs) - 0.06
					const xb = Math.max(...xs) + 0.06
					const zf = -(Math.max(d / 2, moversDepth(xa, xb), staticsDepth(xa, xb, yTop, own), 0.075) + 0.016)
					const zEnd = -d / 2 + 0.001 // the arm ends in the part's back face
					const len = Math.max(0.02, yTop - top)
					const ya = Math.min(Math.max((y0 + y1) / 2, top + 0.025), Math.max(top + 0.025, yTop - 0.012))
					parts.forEach((q, k) => {
						const xr = xs[k]
						// a panel standing here carries the arm itself (a hanger on a peg board): only the boss and the arm, from the panel's front face
						let zb = zf
						let held = null
						for (const pr of panelRects) if (xr >= pr.x0 - 0.01 && xr <= pr.x1 + 0.01 && ya >= pr.y0 - 0.01 && ya <= pr.y1 + 0.01) held = pr
						if (held) zb = Math.min(held.z, zEnd - 0.004) // (the panel's front face, unless it is nearer than the part's back)
						else {
							// a rod that would stand in a panel's way (its sheet, its legs and feet: under a board on legs, or over a low board's top) stands behind all of it,
							// its arm reaching forward under the sheet; a leg of a board on legs that the arm would pass through steps aside along the sheet's back (dodge),
							// and where no place under the sheet clears every such arm, the arm is clamped to that leg's front instead (no rod, no foot)
							for (const pr of panelRects) if (xr >= pr.x0 - 0.065 && xr <= pr.x1 + 0.065) zb = Math.min(zb, pr.z - 0.18)
							for (const pr of panelRects) {
								if (!(xr >= pr.x0 - 0.065 && xr <= pr.x1 + 0.065) || pr.dodge(xr, ya)) continue
								held = pr
								zb = Math.min(pr.z - 0.018, zEnd - 0.004) // (the leg's front face)
							}
						}
						q.rod.visible = q.cap.visible = q.foot.visible = q.blob.visible = !held
						if (!held) {
							q.rod.scale.y = len
							putAt(q.rod, xr, top + len / 2, zb)
							putAt(q.cap, xr, top + len, zb)
							putAt(q.foot, xr, TABLE_TOP + MOUNT_FOOT / 2, zb - 0.1) // (the foot runs from just in front of the rod to 21 cm behind it: never into the motion plane)
							q.blob.position.set(xr, TABLE_TOP + 0.0003, zb - 0.1)
							q.blob.scale.set(0.17, 1, 0.3)
						}
						const zc = held ? zb + 0.014 : zb // (on a panel the boss sits on its front face, not in it)
						putAt(q.boss, xr, ya, zc)
						putAt(q.screw, xr + 0.02, ya, zc)
						putAt(q.knob, xr + 0.032, ya, zc)
						q.arm.rotation.x = Math.PI / 2
						q.arm.scale.y = Math.max(0.004, zEnd - zc)
						putAt(q.arm, xr, ya, (zc + zEnd) / 2)
					})
				}
			},
			panel(inst) {
				const members = inst.members
				const balls = members.every(isRound)
				const ply = plywood()
				let nn = 0 // the spacing of a grid of pegs (the model's painted panel reaches one spacing past the outer ones)
				if (balls && members.length > 1) {
					nn = Infinity
					const a = members[0]
					for (const o of members) if (o !== a) nn = Math.min(nn, Math.hypot(mountPose.get(o.id).x - mountPose.get(a.id).x, mountPose.get(o.id).y - mountPose.get(a.id).y))
				}
				const board = mountMesh(inst, woodBox(1, 1, 0.018, members[0].id), ply)
				const feet = [mountMesh(inst, woodBox(0.06, 0.03, 0.15, members[0].id + "f"), ply), mountMesh(inst, woodBox(0.06, 0.03, 0.15, members[0].id + "f"), ply)]
				// a board that hangs high (its sheet's lower edge more than PANEL_RAISE over the table) is a sheet just round its parts on two legs (3.5 cm battens behind
				// it, standing on the feet), not a sheet from the table up: a sign on its stand, not a wall
				const legs = [mountMesh(inst, woodBox(0.035, 1, 0.035, members[0].id + "l"), ply), mountMesh(inst, woodBox(0.035, 1, 0.035, members[0].id + "l"), ply)]
				const legH = [0, 0]
				const blobsF = [addBlob(blobs, 0, 0, 0.1, 0.2, AO_OPACITY), addBlob(blobs, 0, 0, 0.1, 0.2, AO_OPACITY)]
				inst.meshes.push(...blobsF)
				// where the panel stands further back than the parts it holds (a deep mover passes in front of it), a short steel standoff joins each of the first 30 to it
				const standoffs = []
				const sh = { w: 0, h: 0 }
				// rect: what the posts see of it (a hanger's arm that lands on the sheet is carried by it; one that passes under a sheet on legs makes a leg step aside):
				// the sheet's x0..x1, y0..y1, its front face z, and on legs: where each leg stands (legs), where it would (home), the legs' top, the arms passing under
				const rect = { x0: 0, x1: 0, y0: 0, y1: 0, z: 0, raised: false, legTop: 0, legs: [0, 0], home: [0, 0], arms: [], dodge: null }
				inst.rect = rect
				const memberSet = new Set(members)
				/** Foot k (and on legs its leg) at x = xf, behind the sheet whose front face is at zFront. */
				const placeLeg = (k, xf) => {
					rect.legs[k] = xf
					putAt(feet[k], xf, TABLE_TOP + 0.015, rect.z - 0.018 - 0.075)
					blobsF[k].position.set(xf, TABLE_TOP + 0.0003, rect.z - 0.018 - 0.075)
					if (rect.raised) putAt(legs[k], xf, TABLE_TOP + 0.03 + legH[k] / 2, rect.z - 0.018 - 0.0175)
				}
				const LEG_HALF = 0.0175 // a leg's half-width ...
				const ARM_CLEAR = LEG_HALF + 0.005 + 0.005 // ... and how far a stand's arm (5 mm radius) keeps from a leg's middle: 5 mm of air between
				/** Where leg k stands clear of every arm registered: its home, else the nearest place beside an arm, under the sheet and with its foot on the tabletop
				 *  (where there is none, it stays where it is: clear of the arms before this one, whose stands were told so). */
				const legSpot = (k) => {
					const home = rect.home[k]
					const clear = (v) => rect.arms.every((a) => Math.abs(v - a) >= ARM_CLEAR - 1e-9)
					if (clear(home)) return home
					let lo = rect.x0 + LEG_HALF
					let hi = rect.x1 - LEG_HALF
					if (tableBox) {
						lo = Math.max(lo, tableBox.x0 + 0.035)
						hi = Math.min(hi, tableBox.x1 - 0.035)
					}
					let best = rect.legs[k]
					let bd = Infinity
					for (const a of rect.arms) {
						for (const v of [a - ARM_CLEAR, a + ARM_CLEAR]) {
							if (v < lo - 1e-9 || v > hi + 1e-9 || !clear(v) || Math.abs(v - home) >= bd) continue
							best = v
							bd = Math.abs(v - home)
						}
					}
					return best
				}
				/** A stand's arm passes under the sheet at x, height y (from behind the panel to the part in front): the legs step aside along the sheet's back where it would
				 *  pass through one. False when a leg cannot (the arm is then clamped to that leg). */
				rect.dodge = (x, y) => {
					if (!rect.raised || y < TABLE_TOP + 0.025 || y > rect.legTop + 0.005) return true
					rect.arms.push(x)
					let ok = true
					for (let k = 0; k < 2; k++) {
						const v = legSpot(k)
						if (v !== rect.legs[k]) placeLeg(k, v)
						if (Math.abs(v - x) < ARM_CLEAR - 1e-9) ok = false
					}
					return ok
				}
				inst.fit = () => {
					let x0 = Infinity
					let x1 = -Infinity
					let y0 = Infinity
					let y1 = -Infinity
					let d = 0
					let r = 0
					for (const s of members) {
						const b = boxOfStatic(s, mountBox)
						x0 = Math.min(x0, b.x0)
						x1 = Math.max(x1, b.x1)
						y0 = Math.min(y0, b.y0)
						y1 = Math.max(y1, b.y1)
						d = Math.max(d, depthOfSolid(s))
						if (isRound(s)) r = Math.max(r, s.body.radius)
					}
					const mx = balls ? (members.length > 1 ? Math.max(0.03, nn) + 0.015 : 0.05 + 1.2 * r) : 0.025 // (the margin round the parts the panel reaches)
					const W = Math.max(0.1, x1 - x0 + 2 * mx)
					const yb = y0 - mx > TABLE_TOP + PANEL_RAISE ? y0 - mx : TABLE_TOP // (the sheet's lower edge: the table, or just under the parts on legs)
					const H = Math.max(0.1, y1 + mx - yb)
					const cx = (x0 + x1) / 2
					// behind the part's own back board (a peg's plywood, a peg board's panel), every mover that passes by and every static part standing under or in front
					// of the sheet, its legs or feet (a conveyor, a basket, a hanger under a board on legs: their models reach 1.2 cm behind their depth at most)
					const zFront = -Math.max(d / 2 + 0.016, moversDepth(x0 - mx, x1 + mx) + 0.012, staticsDepth(cx - W / 2, cx + W / 2, yb + H, memberSet) + 0.016)
					if (Math.abs(W - sh.w) > 0.0004 || Math.abs(H - sh.h) > 0.0004) {
						sh.w = W
						sh.h = H
						board.geometry = geometry(`mountpanel|${Math.round(W * 200)}|${Math.round(H * 200)}`, () => slabGeometry({ width: W, height: H, depth: 0.018 }, TILES.domino, members[0].id, true))
					}
					putAt(board, cx, yb + H / 2, zFront - 0.009)
					rect.x0 = cx - W / 2
					rect.x1 = cx + W / 2
					rect.y0 = yb
					rect.y1 = yb + H
					rect.z = zFront
					const raised = yb > TABLE_TOP
					rect.raised = raised
					rect.arms.length = 0 // (the posts fitted after it say where their arms pass: dodge)
					// from the foot's top to 2 cm under the sheet's top edge, against its back
					const h = Math.round((yb + H - 0.02 - (TABLE_TOP + 0.03)) * 200) / 200
					rect.legTop = TABLE_TOP + 0.03 + h
					for (let k = 0; k < 2; k++) {
						let xf = cx + (k === 0 ? -1 : 1) * Math.max(0.0, W / 2 - (raised ? 0.0525 : 0.09)) // (on legs: under the legs, 3.5 cm in from the sheet's sides)
						if (tableBox) xf = Math.min(Math.max(xf, tableBox.x0 + 0.035), tableBox.x1 - 0.035) // (the feet stand on the tabletop)
						rect.home[k] = xf
						const leg = legs[k]
						leg.visible = raised
						if (raised && h !== legH[k]) {
							legH[k] = h
							leg.geometry = geometry(`mountleg|${Math.round(h * 200)}`, () => slabGeometry({ width: 0.035, height: h, depth: 0.035 }, TILES.wood, members[0].id + "l", true))
						}
						placeLeg(k, xf)
					}
					const n = Math.min(30, members.length)
					for (let k = 0; k < n; k++) {
						const s = members[k]
						const p = mountPose.get(s.id)
						const back = -depthOfSolid(s) / 2
						const gap = back - zFront
						if (gap < 0.006) {
							if (standoffs[k]) standoffs[k].visible = false
							continue
						}
						standoffs[k] ??= mountMesh(inst, rodGeo(0.004), steelMaterial())
						const so = standoffs[k]
						so.visible = true
						so.rotation.x = Math.PI / 2
						so.scale.y = gap
						putAt(so, p.x, p.y, (back + zFront) / 2)
					}
				}
			},
			wall(inst) {
				const s = inst.members[0]
				const wood = sceneryWood()
				const id = s.id
				// the cleat on the wall is as tall as the brace's foot needs: 6 cm over the beam to 24 cm under it
				const plate = mountMesh(inst, woodBox(0.09, 0.3, 0.02, id + "p"), wood)
				const beam = mountMesh(inst, woodBox(0.03, 0.03, 0.5, id + "b"), wood)
				const brace = mountMesh(inst, woodBox(0.022, 0.4, 0.022, id + "c"), wood)
				const WALL_Z = -0.8
				inst.fit = () => {
					const { x0, x1, y0, y1 } = boxOfStatic(s, mountBox)
					const d = depthOfSolid(s)
					const xr = (x0 + x1) / 2
					const ya = (y0 + y1) / 2
					const zEnd = -d / 2 + 0.001
					const zWall = WALL_Z + 0.02 // the cleat's front face on the wall
					const L = Math.max(0.05, zEnd - zWall)
					beam.geometry = woodBox(0.03, 0.03, L, id + "b")
					putAt(plate, xr, ya - 0.09, WALL_Z + 0.01) // (spans ya - 0.24 to ya + 0.06)
					putAt(beam, xr, ya, (zEnd + zWall) / 2)
					const bz = Math.min(0.3, 0.45 * L) // the brace runs from the cleat, 22 cm down, out along the beam
					const bl = Math.hypot(0.22, bz)
					brace.geometry = woodBox(0.022, bl, 0.022, id + "c")
					brace.rotation.x = Math.atan2(bz, 0.22)
					putAt(brace, xr, ya - 0.015 - 0.11, zWall + bz / 2)
				}
			},
		}
		const setInst = (inst, v) => {
			for (const m of inst.meshes) m.visible = v
		}
		for (const plan of plans) {
			plan.insts = {}
			plan.on = null // the kind drawn now, or null
			plan.show = () => {
				// draw it while the part is held up by nothing; made on first need. A post whose rods would not stand on the tabletop is a wall bracket
				let want = plan.members.some(heldUp) ? plan.kind : null
				if (want === "post" && !rodsOf(plan.members[0]).every(onTable)) want = "wall"
				if (plan.on && plan.on !== want) {
					setInst(plan.insts[plan.on], false)
					if (plan.on === "panel") panelRects.splice(panelRects.indexOf(plan.insts.panel.rect), 1)
				}
				if (want) {
					let inst = plan.insts[want]
					if (!inst) {
						inst = plan.insts[want] = { kind: want, members: plan.members, meshes: [], fit: null }
						mountBuilders[want](inst)
					}
					if (plan.on !== want) {
						setInst(inst, true)
						if (want === "panel") panelRects.push(inst.rect)
					}
					inst.fit()
				}
				plan.on = want
			}
		}
		const mountFits = () => {
			for (const plan of plans) plan.show()
			shadowKey = ""
		}
		// (their first build waits for the idle time after the first frame (see pump), one plan at a time and in this order: the panels first, a hanger's arm that
		// lands on one is held by it; a busy scene's mounts are 200 ms of work on a slow phone, which in one piece held up the first picture's frame)
		if (progressive)
			for (const plan of plans)
				late.push(() => {
					plan.show()
					shadowKey = ""
				})
		else mountFits()

		// the cords of every hung item: two thin cylinders 3 m up, at the item's front and back faces
		const cordGeo = geometry("cord", () => new THREE.CylinderGeometry(0.0012, 0.0012, 1, 8, 1))
		for (const [ai, a] of (doc.animated ?? []).entries()) {
			if (a.sprite !== "cord") continue
			let depth = 0
			for (const s of doc.solids) if (s.item === a.item && (s.body.kind === "slab" || s.body.kind === "polygon")) depth = Math.max(depth, depthOf(s.body))
			const z = depth > 0 ? depth / 2 - 0.01 : 0.05
			for (const pz of [-z, z]) {
				const cord = addMesh(group, cordGeo, cordMaterial, { castShadow: false })
				cord.scale.y = 3
				cord.position.set(a.at.x, a.at.y + 1.5, pz)
				freeze(cord)
				cords.push({ mesh: cord, ai, pz })
			}
		}
		// A wooden pull pin under every held ITEM (one per item, not one per part), on a post standing on the table behind the machine, instead of the drawn hand.
		// Which part it holds (postPart): a part that hangs (it turns about a pivot, or hangs on a rope, spring or pin from the world or a static part) is held only
		// while it is swung out of its hanging line (a Newton's cradle's lifted ball, a pendulum or a wrecking ball pulled back; the balls that hang at rest need
		// nothing), the lowest swung part of the item; an item that does not hang, by its lowest part (a car by a wheel, the nearest the item's middle).
		// The post never passes through anything (fitPosts): it stands behind everything drawn whose outline comes within its reach in the machine plane, the statics
		// where they stand, the movers wherever they go over the whole run (the held part itself as it falls after the release: a basketball fell through its own
		// post), the mounts' supports and the rows of springs, measured on what is drawn (the models, not the physics outlines), with POST_GAP of air.
		const POST_R = 0.012 // the post's radius (dowel below)
		const POST_GAP = 0.015 // air between the post and anything in front of it
		const pins = []
		const gates = [] // starting gates (web/start-gate.js) of the items doc.view.gates names (machines/mod_staging.py start_gate), drawn instead of their pins
		const postFits = [] // (pose of a solid, obstacles) => one post and pin placed again
		const hangOf = (o) => {
			// the world point a part hangs from (its pivot, a rope's, spring's or pin's end on the world or on a static part), or null
			const root = rootOf(o)
			if (root.pivot) {
				const q = poseOf(root)
				return { x: q.x + root.pivot.x * Math.cos(q.angle) - root.pivot.y * Math.sin(q.angle), y: q.y + root.pivot.x * Math.sin(q.angle) + root.pivot.y * Math.cos(q.angle) }
			}
			for (const j of doc.joints ?? []) {
				if (j.kind !== "rope" && j.kind !== "spring" && j.kind !== "pin") continue
				for (const [me, other, oa] of [[j.b, j.a, j.anchorA], [j.a, j.b, j.anchorB]]) {
					if (me !== o.id && me !== root.id) continue
					if (other === null || other === undefined) return { x: oa.x, y: oa.y }
					const os = solidById.get(other)
					if (os?.kind !== "static") continue
					const q = poseOf(os)
					return { x: q.x + oa.x * Math.cos(q.angle) - oa.y * Math.sin(q.angle), y: q.y + oa.x * Math.sin(q.angle) + oa.y * Math.cos(q.angle) }
				}
			}
			return null
		}
		const bottomOf = (o, p) =>
			isRound(o)
				? o.body.radius
				: o.body.kind === "polygon"
					? Math.max(...o.body.points.map((q) => -(q.x * Math.sin(p.angle) + q.y * Math.cos(p.angle))))
					: Math.abs(Math.cos(p.angle)) * o.body.height / 2 + Math.abs(Math.sin(p.angle)) * o.body.width / 2
		const postPart = (list) => {
			const low = (o) => poseOf(o).y - bottomOf(o, poseOf(o))
			const hanging = list.filter((o) => hangOf(o))
			let pick = hanging.length
				? hanging.filter((o) => {
						const h = hangOf(o)
						const q = poseOf(o)
						return h.y - q.y > -0.005 && Math.atan2(Math.abs(q.x - h.x), Math.max(1e-6, h.y - q.y)) > (3 * Math.PI) / 180
					})
				: list
			if (!pick.length) return null // (it hangs at rest: nothing to hold)
			const lowest = Math.min(...pick.map(low))
			pick = pick.filter((o) => low(o) < lowest + 0.005)
			const mid = list.reduce((sum, o) => sum + poseOf(o).x, 0) / list.length
			return pick.sort((a, b) => Math.abs(poseOf(a).x - mid) - Math.abs(poseOf(b).x - mid))[0]
		}
		const heldByItem = new Map()
		for (const id of doc.release?.parts ?? []) {
			const o = solids.find((x) => x.id === id)
			if (!o) continue
			if (!heldByItem.has(o.item)) heldByItem.set(o.item, [])
			heldByItem.get(o.item).push(o)
		}
		const gated = new Set(doc.view?.gates ?? [])
		const gateStatics = gated.size ? solids.filter((o) => o.kind === "static" && !o.hidden_3d) : []
		for (const list of heldByItem.values()) {
			const s = postPart(list)
			if (!s) continue
			const id = s.id
			const gate = gated.has(s.item) ? makeGate({ list, addMesh, steel: steelMaterial() }) : null
			if (gate && gate.layout(poseOf, track, doc.release?.at ?? 0.5, gateStatics)) {
				// a starting gate: the pin's post, a boom on its top whose stop touches the item's front; it lifts at the release (gate.at in updateParts)
				const post = addMesh(group, dowel(POST_R, "post", `post-${id}`), wood)
				post.castShadow = false // (standing behind the track, its shadow fell on the room's back wall beside the ramp: a ghost of the gate)
				group.add(gate.root)
				gates.push(gate)
				scenery.push(gate.root, post)
				for (const m of [post, ...gate.meshes]) {
					m.userData.solidId = id
					m.userData.stand = true
					pickables.push(m)
				}
				const postBlob = addBlob(blobs, 0, -0.09, 0.07, 0.07, AO_OPACITY)
				postFits.push((pf) => {
					// the post stands just behind the item's path, on what is under it there (the ramp, a carpet, the table): start-gate.js layout
					const L = gate.layout(pf, postTrack, doc.release?.at ?? 0.5, gateStatics)
					post.visible = !!L
					postBlob.visible = !!L && Math.abs(L.footY) < 0.003 // (the contact shade lies on the tabletop)
					if (!L) return gate.hide()
					const top = L.P.y + L.rs + 0.006
					post.scale.y = top - L.foot
					post.position.set(L.P.x, (top + L.foot) / 2, L.zPost)
					freeze(post)
					postBlob.position.set(L.P.x, postBlob.position.y, L.zPost)
					gate.place(L)
				})
				continue
			}
			const pin = addMesh(group, dowel(0.004, "pin", `pin-${id}`), wood)
			pin.scale.y = 0.16
			pin.rotation.x = Math.PI / 2
			pin.position.z = -0.02 // behind the machine: render_3d.py's +y is away from the camera, i.e. three -z
			pin.userData.extra = 0 // how much further back than usual the post stands (updateParts slides the pin from it)
			pins.push(pin)
			const post = addMesh(group, dowel(POST_R, "post", `post-${id}`), wood)
			scenery.push(pin, post)
			for (const m of [pin, post]) {
				m.userData.solidId = id // the post and the pin that hold a ball belong to the ball's item: a click on them picks it, while the ball is still held
				m.userData.stand = true // (and the surface under the cursor is never the stand)
				pickables.push(m)
			}
			const postBlob = addBlob(blobs, 0, -0.09, 0.07, 0.07, AO_OPACITY)
			const fit = (pf, obs) => {
				const p = pf(s)
				const r = bottomOf(s, p)
				const postH = p.y - r - 0.004 + 0.03
				// 9 cm behind the machine's plane at least, and behind whatever is drawn in the post's way (see fitPosts)
				const back = Math.min(0.75, Math.max(0.09, postDepth(obs, p.x, postH) + POST_R + POST_GAP))
				const extra = back - 0.09
				pin.userData.extra = extra
				pin.scale.y = 0.16 + extra
				pin.position.set(p.x, p.y - r - 0.004, -(0.02 + extra / 2)) // (its z slides with the clock: updateParts)
				post.scale.y = postH
				post.position.set(p.x, postH / 2, -back)
				freeze(post)
				postBlob.position.set(p.x, postBlob.position.y, -back)
			}
			postFits.push(fit)
		}
		/** What a post must stand behind: [{kind, ...}] for postDepth. Solids: their drawn box in their own frame (models, stand-ins and wheels as drawn: z is the same
		 *  whatever the part's angle) and, for a mover, every pose of the run; legs and mounts as they stand; rows of springs across a body's depth between their ends. */
		const postBoxes = new WeakMap() // a solid's drawn root -> {stamp, box (in its own frame)}
		const _pm = new THREE.Matrix4()
		const _pi = new THREE.Matrix4()
		const _pb = new THREE.Box3()
		const drawnBox = (root) => {
			const stamp = root.children.map((c) => c.id).join(",")
			let e = postBoxes.get(root)
			if (e && e.stamp === stamp) return e.box
			root.updateMatrixWorld(true)
			_pi.copy(root.matrixWorld).invert()
			const box = new THREE.Box3()
			const add = (o) => {
				if (!o.visible || o.userData.blob || o.userData.stand) return
				if (o.isMesh) {
					let gb
					if (o.isInstancedMesh) {
						o.computeBoundingBox()
						gb = o.boundingBox
					} else {
						if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
						gb = o.geometry.boundingBox
					}
					if (gb && !gb.isEmpty()) box.union(_pb.copy(gb).applyMatrix4(_pm.multiplyMatrices(_pi, o.matrixWorld)))
				}
				for (const c of o.children) add(c)
			}
			add(root)
			postBoxes.set(root, { stamp, box })
			return box
		}
		const postObstacles = (pf) => {
			const obs = []
			for (const root of group.children) {
				if (root === blobs || root.userData.stand || root.userData.mount) continue
				const sid = root.name || root.userData.solidId
				const o = sid ? solidById.get(sid) : null
				if (!o || o === table || o.hidden_3d) continue
				const box = drawnBox(root)
				if (box.isEmpty()) continue
				obs.push({ o, box, legs: !!o.legs && o.kind === "static", move: o.kind === "dynamic", pf })
			}
			for (const m of group.children) {
				if (!m.isMesh || !m.visible || m.userData.stand) continue
				if (!m.userData.mount && !scenery.includes(m)) continue // (the legs and the mounts' supports: they stand where they are)
				m.updateMatrixWorld(true)
				obs.push({ world: new THREE.Box3().setFromObject(m) })
			}
			for (const j of doc.joints ?? []) {
				const rows = Math.round(j.render?.rows ?? 1)
				if (rows <= 1) continue
				const half = Math.max(depthOfId(j.a), depthOfId(j.b)) / 2
				obs.push({ joint: j, half, R: (j.coilRadius ?? 0.01) + 0.004 })
			}
			return obs
		}
		const depthOfId = (id) => {
			const o = id ? solidById.get(id) : null
			return !o ? 0 : isRound(o) ? (o.depth3d ?? 2 * o.body.radius) : depthOf(o.body)
		}
		const _pp = { x: 0, y: 0, angle: 0 }
		/** How far behind the machine plane (m) the deepest thing drawn in the column of a post at x reaching from the table to height h reaches. */
		let postTrack = track // (the run's track; a drag's layout has one frame)
		const postDepth = (obs, x, h) => {
			const x0 = x - POST_R - POST_GAP
			const x1 = x + POST_R + POST_GAP
			let deep = 0
			const inCol = (b, q, legs) => {
				// the box b of a part at pose q (x, y, angle) in the machine plane: does its outline come into the column?
				const c = Math.cos(q.angle)
				const sn = Math.sin(q.angle)
				let ax0 = Infinity
				let ax1 = -Infinity
				let ay0 = Infinity
				let ay1 = -Infinity
				for (const bx of [b.min.x, b.max.x])
					for (const by of [b.min.y, b.max.y]) {
						const wx = q.x + bx * c - by * sn
						const wy = q.y + bx * sn + by * c
						if (wx < ax0) ax0 = wx
						if (wx > ax1) ax1 = wx
						if (wy < ay0) ay0 = wy
						if (wy > ay1) ay1 = wy
					}
				if (legs) ay0 = 0
				return ax1 >= x0 && ax0 <= x1 && ay0 <= h && ay1 >= 0.002
			}
			for (const e of obs) {
				if (e.world) {
					if (e.world.max.x >= x0 && e.world.min.x <= x1 && e.world.min.y <= h && e.world.max.y >= 0.002) deep = Math.max(deep, -e.world.min.z)
					continue
				}
				if (e.joint) {
					const j = e.joint
					for (const f of postTrack.frames) {
						const A = anchorIn(f, j.a, j.anchorA)
						const B = anchorIn(f, j.b, j.anchorB)
						if (!A || !B) break
						if (Math.max(A.x, B.x) + e.R >= x0 && Math.min(A.x, B.x) - e.R <= x1 && Math.min(A.y, B.y) - e.R <= h) {
							deep = Math.max(deep, e.half)
							break
						}
						if (postTrack.frames.length > 1 && j.a && j.b && solidById.get(j.a)?.kind === "static" && solidById.get(j.b)?.kind === "static") break
					}
					continue
				}
				const behind = -e.box.min.z
				if (behind <= deep) continue // (nothing it could add)
				if (!e.move) {
					if (inCol(e.box, e.pf(e.o), e.legs)) deep = behind
					continue
				}
				// a mover: wherever it goes in the run (a quick reach test first: the box's corners lie within rr of the part's origin)
				const b = e.box
				const rr = Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.y, b.max.y))
				const first = e.pf(e.o)
				const poses = postTrack.frames.length > 1 ? postTrack.frames : null
				const test = (q) => Math.abs(q.x - x) <= rr + POST_R + POST_GAP && q.y - rr <= h && inCol(b, q, false)
				if (test(first)) {
					deep = behind
					continue
				}
				if (poses)
					for (const f of poses) {
						const q = f.placements[e.o.id]
						if (!q) continue
						_pp.x = q.x
						_pp.y = q.y
						_pp.angle = q.angle ?? 0
						if (test(_pp)) {
							deep = behind
							break
						}
					}
			}
			return deep
		}
		/** The world point of anchor a on solid id (null: a is a world point) in track frame f, or null. */
		const anchorIn = (f, id, a) => {
			if (id === null || id === undefined) return a
			const o = solidById.get(id)
			const q = f.placements[id] ?? (o ? poseOf(o) : null)
			if (!q) return null
			const c = Math.cos(q.angle ?? 0)
			const sn = Math.sin(q.angle ?? 0)
			return { x: q.x + a.x * c - a.y * sn, y: q.y + a.x * sn + a.y * c }
		}
		/** Place every post and pin again (after a load, a move, the mounts, the models coming in): pf = the pose of a solid at the start, trk = the run's track. */
		const fitPosts = (pf = poseOf, trk = track) => {
			if (!postFits.length) return
			postTrack = trk
			group.updateMatrixWorld(true)
			const obs = postObstacles(pf)
			for (const f of postFits) f(pf, obs)
			shadowKey = ""
		}
		// A deferred model draws its whole welded item, so the item's other parts (the helpers, which have no model of their own) are drawn as stand-ins too, as children of the
		// stand-in of the part that carries the model, at their starting pose relative to it; they are picked as themselves, and go with it when the model swaps in.
		for (const { s, L } of helpers) {
			const root = rootOf(s) // (a static item's parts are not welded to one another: they all stand where they stand)
			const job = jobs.find((j) => j.s.item === s.item && (s.kind === "static" ? j.s.kind === "static" : rootOf(j.s) === root))
			if (!job) continue
			const q = poseOf(s)
			const p0 = poseOf(job.s)
			const c = Math.cos(p0.angle)
			const sn = Math.sin(p0.angle)
			const dx = q.x - p0.x
			const dy = q.y - p0.y
			const m = placeholderMesh(s, L)
			m.position.set(dx * c + dy * sn, dy * c - dx * sn, 0)
			m.rotation.z = q.angle - p0.angle
			m.userData.solidId = s.id
			job.ph.add(m)
			pickables.push(m)
		}
		fitPosts() // (with the stand-ins; again once the models and the mounts are in: see postsLate)
		markReflSkip(group)
		let lens = 0
		for (const h of group.children) lens += markLens(h)
		applyGlass(group)
		const roundIds = new Set(solids.filter(isRound).map((o) => o.id))
		applyLowChrome(group, roundIds)
		scene.add(group)
		if (panes.length && !panesCompiled) {
			panesCompiled = true
			renderer.compile(panes[0].mesh, activeCamera(), scene) // (the acrylic's shader now, not as a stall the first time a wall is selected)
		}
		trimCaches()
		endRun()
		jobs.sort((a, b) => b.area - a.area) // the largest parts first
		const poses = new Map()
		for (const s of doc.solids) poses.set(s.id, poseOf(s)) // (the hidden walls too: retarget moves their panes)
		const moverRoots = new Set(parts.map((p) => p.holder ?? p.mesh))
		const framed = {
			still: [...solidRoots.filter((o) => !moverRoots.has(o) && o !== tableMesh), ...scenery],
			movers: parts.map((p) => moverBox(p, poses.get(p.id))), // (the group's matrices are those of the first frame: updateParts has not run)
			fixed: fixedPoints(doc.joints ?? []),
			table,
		}
		const itemOf = new Map()
		for (const s of doc.solids) itemOf.set(s.id, s.item)
		const r = {
			framed,
			frame: null,
			sim,
			doc,
			track,
			group,
			parts,
			restParts: parts.filter((p) => p.rest),
			restGroups: dynGroups,
			supports,
			moverSupports,
			depParts: new Array(parts.filter((p) => p.rest).length),
			postFits,
			fitPosts, // (pf, track): place the posts again
			postsFinal: !progressive || !postFits.length, // the posts were placed with every model and mount in (see postsLate)
			staticRest,
			staticRound,
			aoRecs,
			roundIds,
			mountFits,
			mounts: plans,
			staticGroups,
			spinners,
			frameHooks,
			plugins: [], // the modules' view plugins (web/view-plugins.js startPlugins, below)
			panes,
			itemOf,
			pickables,
			pins,
			gates,
			table,
			tableMesh,
			lens, // how many lens parts it has (markLens): the table's mirror draws them in a pass of their own
			blobs,
			jobs, // the parts still drawn as stand-ins, not yet being built: {s, props, L, holder, ph, mdl, area}
			late,
			ready: [], // built and compiled, waiting to be swapped in (each with its textures still to upload)
			left: jobs.length, // stand-ins not yet replaced
			drawAt: drawCount, // (draws made before this run: the chrome waits until two have been made for it)
			cancelled: false,
			serial,
			owned,
			placers,
			cords,
			poses,
			sig: runSig(sim),
			pulleys: (doc.joints ?? []).some((j) => j.kind === "pulley"), // (a pulley's rope lengths are taken from the starting poses: it is rebuilt after a move)
			joints: updaters,
			lods: updaters.lods ?? [], // (C, pxPerMetreAt1m) => the coils' and chains' detail for a camera at C (applyLods)
			tRelease: doc.release?.at ?? 0.5,
			bounds: sceneBounds(solids, track, doc.joints),
			follow: null, // built on first use: the camera paths take a moment and a drag never needs them
		}
		settleStatics(r)
		r.plugins = startPlugins(r)
		return r
	}

	/** What the planar reflection leaves out while things move: glass and ice (a transmission pass of their own), parts too small to show. */
	function markReflSkip(root) {
		root.traverse((o) => {
			if (!o.isMesh || o.userData.blob || !o.frustumCulled) return // (a mesh that is never culled has a buffer that is filled at draw time: it has no size yet)
			const m = o.material
			let skip = Array.isArray(m) ? m.some((x) => x.transmission > 0) : m.transmission > 0
			if (!skip) {
				o.geometry.boundingSphere ?? o.geometry.computeBoundingSphere()
				skip = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) < TINY_REFL
			}
			if (skip) o.layers.set(REFL_SKIP)
		})
	}
	/** The lens parts of one part's model (its holder or the model): when it has glass (a material with transmission), every part of it that three.js draws in its transparent
	 *  pass (all its materials transparent, none with transmission: a marble's cat's eye and its gloss shell, a bottle's water line, ice's core, bubbles and frost) and casts no
	 *  shadow goes on LENS_LAYER, which the table's mirror draws in a pass of its own (renderReflection). Returns how many. (A part that casts a shadow stays: the mirror pass
	 *  draws the shadow map with its own layers.) */
	function markLens(root) {
		let glass = false
		root.traverse((o) => {
			if (o.isMesh && (Array.isArray(o.material) ? o.material.some((m) => m.transmission > 0) : o.material.transmission > 0)) glass = true
		})
		if (!glass) return 0
		let n = 0
		root.traverse((o) => {
			if (!o.isMesh || o.castShadow || o.userData.blob || o.userData.mount) return
			const pass = (m) => m.transparent === true && !(m.transmission > 0)
			if (!(Array.isArray(o.material) ? o.material.length > 0 && o.material.every(pass) : pass(o.material))) return
			o.layers.set(LENS_LAYER)
			n++
		})
		return n
	}

	// ----- progressive build ------------------------------------------------------------------------------------------------
	// A load that has models to build (not kept yet: see buildRun) draws plain stand-ins at once and builds the real models afterwards, a few ms of idle time
	// at a time, largest part first; each is compiled in the background (compileAsync) and its textures uploaded before it replaces its stand-in in the same
	// holder, so the picture never jumps and picking and shadows keep working. A new load drops the jobs of the run it replaces (what was built stays kept).
	const noteBuild = (ms) => {
		if (ms > 2) J.ema += 0.35 * (ms - J.ema) // (a kept model is only cloned: that says nothing about what a build costs)
	}
	const isSettled = () => !(run && !run.cancelled && (run.left > 0 || run.late.length > 0)) && grainWait.size === 0
	function checkSettled() {
		if (!J.settled.length || !isSettled()) return
		for (const done of J.settled.splice(0)) done()
	}
	// The bake workers (models3d.js prebake) work out the models' textures off the main thread, the stand-ins' models queued for them at once, largest first.
	// The page builds a model once its worker has answered (then only the geometry is left: the textures come as their finished bytes); while the workers are
	// still starting, or have kept it waiting for STEAL_IDLE_MS (a device whose cores are busy), it builds the next one no worker has taken itself
	// (stealPrebake), as it did before there were workers, rather than wait.
	function prebakeRun(r) {
		if (!r.jobs.length) return
		const now = performance.now()
		const pre = prebake(r.jobs.map((j) => ({ solid: j.s, props: j.props, look: j.L })))
		r.jobs.forEach((j, i) => {
			if (!pre[i]) return
			j.pre = pre[i]
			j.preAt = now
			pre[i].promise.then(() => {
				if (run === r && !r.cancelled) schedule()
			})
		})
	}
	/** The index of the next stand-in whose model can be built now: its bakes are here (or it needs none, or its worker took too long), else, while no worker
	 *  has started yet or the page has waited STEAL_IDLE_MS, the first one none has taken; -1 when every one left waits for a worker. */
	function nextJob(r) {
		const now = performance.now()
		const i = r.jobs.findIndex((j) => !j.pre || j.pre.state === "done" || j.pre.state === "stolen" || now - j.preAt > PREBAKE_WAIT_MS)
		return i >= 0 || (prebakeReady() && now - Math.max(J.lastWork, r.openAt ?? 0) < STEAL_IDLE_MS) ? i : r.jobs.findIndex((j) => j.pre.state === "queued")
	}
	const hasWork = () => (!!run && !run.cancelled && !run.gate && ((run.jobs.length > 0 && nextJob(run) >= 0) || run.ready.length > 0 || run.late.length > 0)) || grainWait.size > 0
	function schedule() {
		if (J.timer || disposed) return
		if (!hasWork()) {
			if (run && !run.cancelled && !run.gate && run.jobs.length && !J.preTimer) {
				// every model left waits for its bake worker: look again when the page would build one itself anyway (an answer schedules sooner)
				const first = Math.min(...run.jobs.map((j) => j.preAt ?? 0)) + PREBAKE_WAIT_MS
				const idle = Math.max(J.lastWork, run.openAt ?? 0) + STEAL_IDLE_MS
				J.preTimer = setTimeout(() => {
					J.preTimer = 0
					schedule()
				}, Math.max(50, Math.min(first, idle) + 20 - performance.now()))
			}
			checkSettled()
			return
		}
		J.idle = typeof requestIdleCallback === "function"
		J.timer = J.idle ? requestIdleCallback(pump, { timeout: 150 }) : setTimeout(pump, holdBack() ? 100 : 12)
	}
	/** The clock is playing (or was seeked), the camera is moving or an item is being dragged, and this machine takes long to build a model: nothing may block the page now. */
	const holdBack = () => (editing || performance.now() - Math.max(J.playAt, J.userAt) < BUSY_MS) && J.ema > BUSY_UNIT_MS
	/** Every texture the object's materials use (one upload each, before the model is shown, instead of inside the first frame that draws it). */
	function texturesOf(obj) {
		const set = new Set()
		obj.traverse((o) => {
			if (!o.isMesh) return
			for (const m of Array.isArray(o.material) ? o.material : [o.material])
				for (const k in m) {
					const v = m[k]
					if (v?.isTexture && !v.isRenderTargetTexture) set.add(v)
				}
		})
		return [...set]
	}
	/** Build the model of the next stand-in, put it in its holder (hidden) and start compiling its shaders (the table's mirror pass draws into a target with other settings
	 *  and so needs its own variants: both are compiled). */
	function startJob(r, i = 0) {
		const job = r.jobs.splice(i, 1)[0]
		const b0 = performance.now()
		let mdl
		try {
			mdl = buildModel(job.s, { props: job.props, look: job.L })
		} catch (e) {
			console.warn("model", job.s.id, "failed:", e)
		}
		noteBuild(performance.now() - b0)
		pinModel(job.s, job.props) // (the run's kept list was closed when it was built: this model joins it)
		if (!mdl) {
			// the stand-in stays when the build failed (undefined); nothing at all is drawn for a part the model says is empty (null)
			if (mdl === null) dropStandIn(r, job)
			finishJob(r)
			return
		}
		mdl.visible = false
		job.holder.add(mdl)
		markReflSkip(mdl)
		r.lens += markLens(mdl)
		applyGlass(mdl)
		applyLowChrome(mdl, r.roundIds)
		job.mdl = mdl
		job.tex = texturesOf(mdl)
		const cam = activeCamera()
		const waits = [renderer.compileAsync(mdl, cam, scene)]
		if (refl.enabled && TIERS[Q.tier].refl !== "off") {
			renderer.setRenderTarget(refl.rt)
			waits.push(renderer.compileAsync(mdl, cam, scene))
			renderer.setRenderTarget(null)
		}
		J.compiling++
		let fired = false
		const done = () => {
			if (fired) return
			fired = true
			J.compiling--
			if (run === r && !r.cancelled) {
				r.ready.push(job)
				schedule()
			}
		}
		Promise.all(waits).then(done, done)
		setTimeout(done, 20000) // (a driver that never says its shaders are ready: the model goes in anyway)
	}
	function dropStandIn(r, job) {
		job.holder.remove(job.ph)
		const gone = new Set()
		job.ph.traverse((o) => gone.add(o))
		for (let i = r.pickables.length - 1; i >= 0; i--) if (gone.has(r.pickables[i])) r.pickables.splice(i, 1)
	}
	function finishJob(r) {
		r.left--
		mirrors.scan = mirrors.dirty = true // (a mirror ball's model may have just come in)
		postsLate(r)
		swapRedraw(r) // (a swap is drawn even when nobody calls render(): a layout preview is not drawn by the app's clock)
		shadowKey = ""
	}
	/** A progressive build's posts are placed again once every model and mount is in (they were placed with the stand-ins: a model may be drawn deeper). */
	function postsLate(r) {
		if (r.postsFinal || r.left > 0 || r.late.length) return
		r.postsFinal = true
		r.fitPosts((o) => r.poses.get(o.id) ?? poseIn(r.track.frames[0].placements, o), r.track)
	}
	/** Draw the models swapped in so far: on the next frame, but while more are still to come on a machine where a draw is slow, no sooner than four draws'
	 *  worth after the last such redraw (each swap would otherwise cost a whole frame, shadows and mirror included, and the build took that much longer); the last
	 *  swap is drawn at once. A fast machine (a draw of a few ms) redraws on every frame, as before. */
	function swapRedraw(r) {
		const last = r !== run || (r.left <= 0 && !r.late.length)
		const wait = last ? 0 : swapAt + Math.min(300, 4 * drawCost) - performance.now()
		if (wait <= 0) {
			clearTimeout(swapTimer)
			swapTimer = 0
			swapAt = performance.now()
			requestRedraw()
		} else if (!swapTimer) {
			swapTimer = setTimeout(() => {
				swapTimer = 0
				swapAt = performance.now()
				requestRedraw()
			}, wait)
		}
	}
	/** Upload the next ready model's textures (as many as the slice allows), then swap it in for its stand-in; false when it ran out of time before the last. */
	function installStep(r, budgetMs) {
		const job = r.ready[0]
		const t0 = performance.now()
		if (!job.lazyDone) {
			// A model may do work at its first draw (a per-instance variant of its material, picked by the solid's id, with textures of its own): run it here, in idle time, so the first frame that shows the model does not
			job.lazyDone = true
			job.mdl.traverse((o) => {
				if (!o.isMesh) return
				o.userData.solidId = job.s.id
				if (Object.prototype.hasOwnProperty.call(o, "onBeforeRender")) {
					try {
						o.onBeforeRender(renderer, scene, activeCamera(), o.geometry, o.material, null)
					} catch (e) {
						console.warn("model", job.s.id, "first-draw work failed:", e)
					}
				}
			})
			applyGlass(job.mdl) // (a per-instance variant of a glass material that was just made)
			applyLowChrome(job.mdl, r.roundIds)
			job.tex = texturesOf(job.mdl)
		}
		while (job.tex.length) {
			renderer.initTexture(job.tex.pop())
			if (job.tex.length && performance.now() - t0 >= budgetMs) return false
		}
		r.ready.shift()
		dropStandIn(r, job)
		job.mdl.visible = true
		job.mdl.traverse((o) => {
			if (o.isMesh) {
				o.userData.solidId = job.s.id
				r.pickables.push(o)
			}
			if (o.userData.spin) {
				const sp = spinOf(o)
				if (sp) r.spinners.push(sp)
			}
			if (o.userData.frame) collectHooks(o, job.s.id, r.frameHooks)
		})
		stats.modelsSwapped++
		const rec = r.aoRecs.get(job.s.id) // the finished model's own materials decide how much contact shading it casts (the stand-in went by the look)
		if (rec) {
			const k = Math.min(lookKeep(rec.L), modelKeep(job.mdl, rec.L))
			if (k !== rec.ao.k) {
				rec.ao.k = k
				const place = job.s.kind === "static" ? r.placers.get(job.s.id) : null
				const pose = r.poses.get(job.s.id)
				if (place && pose) {
					place(pose)
					settleStatics(r)
				}
			}
		}
		finishJob(r)
		return true
	}
	function pump(deadline) {
		J.timer = 0
		if (disposed) return
		if (run?.gate) return // (the first picture of a run is on screen before anything else is built: see prebakeRun's caller)
		const t0 = performance.now()
		// While the clock plays or the user drags (the camera or an item) on a machine where a model takes more than BUSY_UNIT_MS to build, only real idle time is used, and a
		// model is built only when that covers what one costs: a build is one unit that takes 0.4 to 2.4 s on a slow machine, and one every 150 ms would freeze the picture
		// again and again. The forced slices resume when it stops.
		const busy = holdBack()
		if (busy && (!deadline || deadline.didTimeout)) {
			schedule()
			return
		}
		// starved: no idle time came in a while (or there is no requestIdleCallback): one unit of work regardless
		const starved = !busy && (!deadline || deadline.didTimeout || t0 - J.lastWork > STARVED_MS)
		const elapsed = () => performance.now() - t0
		const left = () => (starved ? CHUNK_MS : deadline.timeRemaining())
		let did = false
		// A unit of work (a texture upload, a model build ...) may start while this slice has taken less than CHUNK_MS and the idle time has a few ms left; a unit that
		// costs next to nothing (a model already built for another part) may go on a while longer. (A model's build is one unit and may run well past the slice.)
		const may = (min, cheap = false) => (starved && !did) || (left() > min && elapsed() < (cheap ? 3 * CHUNK_MS : CHUNK_MS))
		if (grainWait.size && may(1)) {
			did = true
			stepGrain(Math.max(1, Math.min(CHUNK_MS - elapsed(), left() - 1)))
		}
		const r = run && !run.cancelled ? run : null
		if (r) {
			while (r.late.length && may(1.5, true)) {
				did = true
				r.late.shift()()
				postsLate(r)
				swapRedraw(r)
			}
			while (r.ready.length && may(2)) {
				did = true
				if (!installStep(r, Math.max(1, Math.min(CHUNK_MS - elapsed(), left() - 1)))) break
			}
			while (r.jobs.length) {
				const i = nextJob(r)
				if (i < 0) break // (each one left is in a bake worker's hands)
				const job = r.jobs[i]
				const cached = isModelCached(job.s, job.props)
				// (on a slow machine that is interacting, a build starts only when the idle time left covers what one costs: it cannot be cut short)
				if (!may(cached ? 0.5 : busy ? Math.max(4, J.ema) : 4, cached)) break
				if (job.pre?.state === "queued") stealPrebake(job.pre)
				did = true
				startJob(r, i)
			}
		}
		if (did) {
			J.lastWork = performance.now()
			adapt.holdoff = Math.max(adapt.holdoff, J.lastWork + 400) // (the frames around a build slice say nothing about how fast the machine draws)
		}
		schedule()
		checkSettled()
	}

	// ----- quality tiers ------------------------------------------------------------------------------------------------------
	// high = the full look. medium = at most 1.5 device pixels per css pixel, the shadow map halved, the table's reflection only while the clock is stopped.
	// low = 1 device pixel per css pixel, no planar reflection, a 1024 shadow map, glass and ice drawn as plain see-through surfaces (no transmission pass; the
	// context also has no multisampling when it is a software one). `auto` starts from hints (the renderer string, device memory, cores, a phone-size window) and steps
	// by the frame times it measures while the app's clock runs or the camera orbits; setQuality("high" | "medium" | "low") fixes one.
	function hintTier() {
		if (softwareGL) return ["low", `software renderer (${gpuName.match(SOFTWARE_GL)?.[0] ?? "software"})`]
		if (Math.min(window.innerWidth || 1e9, window.innerHeight || 1e9) <= 500) return ["medium", "phone-size viewport"]
		const mem = navigator.deviceMemory
		if (mem && mem <= 4) return ["medium", `${mem} GB device memory`]
		const cores = navigator.hardwareConcurrency
		if (cores && cores <= 4) return ["medium", `${cores} CPU cores`]
		return ["high", "no slow-device hints"]
	}
	/** The highest tier Auto may step up to: medium on a phone-size window or a device with 2 GB of memory or less (the high tier's 2x pixels, 4096 shadow map
	 *  and 128 px chrome cubes cost about 150 MB more there, on the devices that have least of it: a phone that keeps up is still drawn at medium); else high.
	 *  High stays one tap away (setQuality("high")). */
	function autoCeiling() {
		const mem = Number(navigator.deviceMemory) || 0
		return Math.min(window.innerWidth || 1e9, window.innerHeight || 1e9) <= 500 || (mem > 0 && mem <= 2) ? "medium" : "high"
	}
	const getQuality = () => ({ mode: Q.mode, tier: xp.saved ? xp.saved.tier : Q.tier, reason: Q.reason }) // (during an export: the canvas's tier, not the export's forced high)
	/** Glass and ice without the transmission pass (low): a see-through surface with the same gloss, on a copy of the material that only this view's meshes use (the kit's materials
	 *  are shared with the catalog photos and stay as they are); the meshes get their own material back for the other tiers. Applies to every mesh under `root`. */
	const glassLow = new WeakMap() // a material -> its see-through copy
	const glassOn = new WeakMap() // a mesh -> {orig, low}: what it had before and the see-through material(s) set in its place
	function seeThrough(m) {
		let c = glassLow.get(m)
		if (c) return c
		const ud = m.userData
		m.userData = {} // (a clone copies it through JSON: it shares the original's object instead)
		c = m.clone()
		m.userData = ud
		c.userData = ud
		c.onBeforeCompile = m.onBeforeCompile
		c.customProgramCacheKey = m.customProgramCacheKey
		c.onBeforeRender = m.onBeforeRender
		c.opacity *= Math.min(0.7, 0.2 + 0.5 * (1 - m.transmission)) // (clear glass 0.2, frosted ice about 0.4)
		c.envMapIntensity *= 1.5 // (the sky in it, which the see-through look would otherwise lose with its opacity)
		c.transmission = 0
		c.transparent = true
		c.depthWrite = false
		glassLow.set(m, c)
		return c
	}
	function applyGlass(root) {
		const low = !TIERS[Q.tier].glass
		root.traverse((o) => {
			if (!o.isMesh) return
			let on = glassOn.get(o)
			if (on && o.material !== on.low) on = null // (something put another material on it since: a model's per-instance variant)
			if (!low) {
				if (on) o.material = on.orig
				glassOn.delete(o)
				return
			}
			if (on) return
			const orig = o.material
			const glassy = (m) => m.transmission > 0
			if (!(Array.isArray(orig) ? orig.some(glassy) : glassy(orig))) return
			const lowMat = Array.isArray(orig) ? orig.map((m) => (glassy(m) ? seeThrough(m) : m)) : seeThrough(orig)
			glassOn.set(o, { orig, low: lowMat })
			o.material = lowMat
		})
	}
	function applyTier(next, why) {
		const changed = next !== Q.tier || !Q.applied
		Q.tier = next
		Q.reason = why
		if (changed) {
			Q.applied = true
			Q.since = performance.now()
			const T = TIERS[next]
			if (key.shadow.mapSize.x !== T.shadow) {
				key.shadow.mapSize.set(T.shadow, T.shadow)
				key.shadow.map?.dispose() // (made again, at the new size, by the next shadow pass)
				key.shadow.map = null
				key.shadow.mapPass?.dispose()
				key.shadow.mapPass = null
			}
			shadowKey = ""
			if (width > 0 && height > 0) sizeTargets(width, height)
			reflValid = false
			if (run) applyGlass(run.group)
			if (TIERS[next].chrome) {
				if (mirrors.list.some((e) => e.size !== TIERS[next].chrome)) releaseMirrors(true) // (made again at this tier's size)
				mirrors.scan = mirrors.dirty = true
			} else releaseMirrors(false) // (low makes no captures: the studio with the table's floor, applyLowChrome)
			if (run) applyLowChrome(run.group, run.roundIds)
			dirty = true
			adapt.n = adapt.sum = adapt.healthy = 0
			adapt.costs.length = 0
			adapt.probe = false
			adapt.holdoff = performance.now() + ADAPT_SETTLE_MS
		}
		container.dispatchEvent(new CustomEvent("quality", { detail: getQuality() }))
	}
	function setQuality(mode) {
		if (disposed || !["auto", "high", "medium", "low"].includes(mode)) return
		if (xp.active) {
			xp.mode = mode // (the export holds the high tier: the canvas's own tier is set when it ends)
			return
		}
		Q.mode = mode
		if (mode === "auto") {
			const [tier, why] = hintTier()
			Q.ceiling = softwareGL ? tier : autoCeiling()
			applyTier(tier, `auto: ${why}`)
		} else applyTier(mode, "chosen")
		if (run && width > 0 && height > 0) draw(lastT)
	}
	/** Auto quality, called at the start of every draw of the app's clock: average the gaps between draws over ADAPT_WINDOW_MS; a window slower than ADAPT_SLOW_MS steps down
	 *  a tier, ADAPT_UP_WINDOWS fast ones in a row (and a measured, finished frame that costs little) step up. A step up that has to be undone soon is never tried again. */
	function adaptQuality(now, gap) {
		const a = adapt
		if (now < a.holdoff || gap <= 0 || gap > 400) {
			a.n = a.sum = a.healthy = 0 // (a pause, a build, a resize, a change of tier: not a measurement)
			a.t0 = now
			return
		}
		if (a.n === 0) a.t0 = now - gap
		a.sum += gap
		a.n++
		if (now - a.t0 < ADAPT_WINDOW_MS) return
		const avg = a.sum / a.n
		const n = a.n
		a.sum = a.n = 0
		a.t0 = now
		const at = TIER_ORDER.indexOf(Q.tier)
		if (n >= 2 && avg > ADAPT_SLOW_MS) {
			a.healthy = 0
			const lower = TIER_ORDER[at + 1]
			if (!lower) return
			const c = a.costs[a.costs.length - 1]
			if (!c || now - c.at > 3000) {
				a.probe = true // is it this machine that is slow? (one finished, timed frame: a pipeline stall, only while the frames are slow anyway)
				return
			}
			if (c.ms < Math.max(ADAPT_BUSY_MS, ADAPT_LIMIT * avg)) return // (frames come as slowly as they do because of the machine only when drawing one takes most of the gap: a 30 Hz display or battery saver spaces them out, a tier lost to it would not come back)
			if (now - a.upAt < ADAPT_BAN_MS) Q.ceiling = lower // the tier above was just tried and did not hold: not again
			applyTier(lower, `auto: frames took ${avg.toFixed(0)} ms (drawing one takes ${c.ms.toFixed(0)}), stepped down`)
			return
		}
		if (n < 20 || avg > ADAPT_FAST_MS) {
			a.healthy = 0
			return
		}
		a.healthy++
		const up = TIER_ORDER[at - 1]
		const canUp = !!up && at - 1 >= TIER_ORDER.indexOf(Q.ceiling)
		a.probe = canUp && a.healthy >= 2 // one finished, timed frame (a pipeline stall) per second, only while a step up is possible
		if (!canUp || a.healthy < ADAPT_UP_WINDOWS || a.costs.length < 2 || now - Q.since < 4000) return
		const cost = a.costs.reduce((x, c) => x + c.ms, 0) / a.costs.length
		if (cost > ADAPT_UP_COST_MS) return
		a.upAt = now
		applyTier(up, `auto: frames took ${avg.toFixed(1)} ms and cost ${cost.toFixed(1)} ms, stepped up`)
	}

	/** The static slabs and polygons lowered onto what they rest on (once per build or move: see restLowering); a welded item is lowered as one. */
	function settleStatics(r) {
		for (const e of r.staticRound) {
			// a static ball, roll or coin lifted onto the table or the static slab it stands on (the same rule as the movers': roundLift)
			e.holder.position.y = e.y + e.dy + (restFix ? roundLift(e.x, e.y, e.Rb, e.grow, r.supports) : 0)
			freeze(e.holder)
		}
		if (!r.staticRest.length) return
		for (const g of r.staticGroups) g.off = g.lo = g.hi = 0
		for (const e of r.staticRest) {
			const o = restFix ? restLowering(e.rest, e, r.supports) : 0
			const g = e.rest.grp
			if (o > g.hi) g.hi = o
			else if (o < g.lo) g.lo = o
		}
		settleGroups(r.staticGroups)
		for (const e of r.staticRest) {
			e.mesh.position.y = e.y - e.rest.grp.off
			freeze(e.mesh)
		}
	}

	/** Whether moving solid s (to pose p) changes what a pulley of the live run was built from: one of the bodies on its rope (its rope lengths and the
	 *  wheel's turn are measured from where they start), or a static slab that is, or comes to be, a bar its brackets may hang from (overheadOf: a slab over a
	 *  wheel's centre, which lies between the ground points, whose underside is less than 30 cm above it; checked here with a centimetre to spare). Anything
	 *  else that moves leaves the pulley exactly as it was built, so a drag elsewhere moves in place. */
	function pulleyMoved(s, p) {
		for (const j of run.doc.joints ?? []) {
			if (j.kind !== "pulley") continue
			if (s.id === j.a || s.id === j.b) return true
			if (s.kind !== "static" || s.body.kind !== "slab" || s.hidden_3d) continue
			const x0 = Math.min(j.groundA.x, j.groundB.x) - 0.01
			const x1 = Math.max(j.groundA.x, j.groundB.x) + 0.01
			const y0 = Math.min(j.groundA.y, j.groundB.y) - 0.01
			const y1 = Math.max(j.groundA.y, j.groundB.y) + 0.31
			for (const q of [run.poses.get(s.id), p]) {
				if (!q) return true
				const e = extentOf(s.body, q)
				if (e.x1 >= x0 && e.x0 <= x1 && e.y0 >= y0 && e.y0 <= y1) return true
			}
		}
		return false
	}
	/** A layout while dragging whose solids, bodies, looks, props and joints are those of the live run, only standing elsewhere: move what is
	 *  built (static solids through their placers, the cords, the held balls' pins; movers follow the new track) instead of building it all
	 *  anew. False (nothing touched) when anything else differs, or the table or something a pulley was built from moved (pulleyMoved): load()
	 *  then rebuilds. */
	function retarget(sim) {
		if (!run || sim.key !== "layout" || sim.doc.solids.length !== run.doc.solids.length) return false
		const { doc, track } = sim
		if (runSig(sim) !== run.sig) return false
		const f0 = track.frames[0].placements
		const visible = doc.solids.filter((s) => !s.hidden_3d)
		if ((visible.find(isTableSolid)?.id ?? null) !== (run.table?.id ?? null)) return false // (what counts as the tabletop depends on where it stands)
		const poses = new Map()
		const moved = []
		for (const s of doc.solids) {
			const p = poseIn(f0, s)
			poses.set(s.id, p)
			const o = run.poses.get(s.id)
			if (!o || o.x !== p.x || o.y !== p.y || o.angle !== p.angle) moved.push([s, p])
		}
		if (moved.length && run.pulleys && moved.some(([s, p]) => pulleyMoved(s, p))) return false
		for (const [s] of moved) if (s.kind === "static" && !run.placers.has(s.id)) return false // the table
		for (const [s, p] of moved) run.placers.get(s.id)?.(p)
		if (moved.length) {
			settleStatics(run)
			const pf = (o) => poses.get(o.id)
			run.mountFits() // (the supports of mounts that hang in mid-air follow, or appear and go as something is moved under them)
			run.fitPosts(pf, track) // (after the mounts: a post stands behind them too)
		}
		for (const c of run.cords) {
			const a = doc.animated[c.ai]
			c.mesh.position.set(a.at.x, a.at.y + 1.5, c.pz)
			freeze(c.mesh)
		}
		run.sim = sim
		run.doc = doc
		run.track = track
		run.poses = poses
		run.follow = null
		run.frame = null
		run.xa = null
		run.tRelease = doc.release?.at ?? 0.5
		run.bounds = sceneBounds(visible, track, doc.joints)
		run.serial = ++runSerial // (the shadow map is drawn again)
		return true
	}

	/** Bounds (x0,x1,y0,y1) of every visible solid (statics in place, movers over the whole track) in the motion plane. */
	function sceneBounds(solids, track, joints = []) {
		const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
		const grow = (x0, x1, y0, y1) => {
			b.x0 = Math.min(b.x0, x0)
			b.x1 = Math.max(b.x1, x1)
			b.y0 = Math.min(b.y0, y0)
			b.y1 = Math.max(b.y1, y1)
		}
		const extent = (s, q) => {
			if (s.body.kind === "ball") return [s.body.radius, s.body.radius]
			if (s.body.kind === "polygon") {
				const c = Math.cos(q.angle)
				const sn = Math.sin(q.angle)
				let ex = 0
				let ey = 0
				for (const p of s.body.points) {
					ex = Math.max(ex, Math.abs(p.x * c - p.y * sn))
					ey = Math.max(ey, Math.abs(p.x * sn + p.y * c))
				}
				return [ex, ey]
			}
			const hw = s.body.width / 2
			const hh = s.body.height / 2
			const c = Math.abs(Math.cos(q.angle))
			const sn = Math.abs(Math.sin(q.angle))
			return [c * hw + sn * hh, sn * hw + c * hh]
		}
		for (const s of solids) {
			if (isTableSolid(s)) {
				grow(Infinity, -Infinity, 0, 0) // the tabletop only contributes its surface height: the table is wider than the machine
				continue
			}
			const frames = s.kind === "dynamic" ? track.frames : [track.frames[0]]
			for (const f of frames) {
				const q = f.placements[s.id]
				if (!q) continue
				const [ex, ey] = extent(s, q)
				grow(q.x - ex, q.x + ex, q.y - ey, q.y + ey)
			}
		}
		// the hardware fixed in the world (a spring's or rope's hanging point, a pulley and its bracket) belongs in the shot too
		const at = (p, m) => grow(p.x - m, p.x + m, p.y - m, p.y + m)
		for (const j of joints) {
			if (j.kind === "pulley") {
				at(j.groundA, (j.wheelRadius ?? 0.02) * 2)
				at(j.groundB, (j.wheelRadius ?? 0.02) * 2)
			} else if (j.kind !== "wheel") {
				if (j.a === null) at(j.anchorA, 0.02)
				if (j.b === null) at(j.anchorB, 0.02)
			}
		}
		if (!isFinite(b.x0)) return { x0: -0.2, x1: 3.1, y0: 0, y1: 0.8 }
		b.x0 = Math.max(b.x0, -1.5)
		b.x1 = Math.min(b.x1, 4.5)
		b.y0 = Math.max(b.y0, -0.02) // things that fall off the table leave the frame instead of dragging the shot down to the cabinet
		b.y1 = Math.min(b.y1, 3)
		if (b.x1 <= b.x0) b.x1 = b.x0 + 0.2
		return b
	}

	/** The follow camera's focus, smoothed deterministically at 60 Hz from t = 0: the body that began moving most recently
	 *  (the action passes from one thing to the next: the ball, the first domino, the next, the seesaw ...). */
	function buildFollow(doc, track) {
		const movers = doc.solids.filter((s) => s.kind === "dynamic" && !s.hidden_3d && !(s.parent && !s.pivot))
		const m = movers.length
		const n = Math.ceil((doc.seconds ?? track.frames[track.frames.length - 1].t) * FOLLOW_HZ) + 1
		const out = new Float32Array(n * 2)
		const b = run?.bounds ?? { x0: 0, x1: 1, y0: 0, y1: 0.5 }
		if (!m) {
			for (let k = 0; k < n; k++) {
				out[k * 2] = (b.x0 + b.x1) / 2
				out[k * 2 + 1] = Math.max(0.15, (b.y0 + b.y1) / 2)
			}
			return out
		}
		const pos = new Float32Array(n * m * 3)
		for (let k = 0; k < n; k++) {
			const p = placementsAt(track, k / FOLLOW_HZ)
			for (let j = 0; j < m; j++) {
				const q = p[movers[j].id] ?? track.frames[0].placements[movers[j].id]
				pos[(k * m + j) * 3] = q.x
				pos[(k * m + j) * 3 + 1] = q.y
				pos[(k * m + j) * 3 + 2] = q.angle
			}
		}
		// the first step at which each body has moved (> 2 cm) or turned (> 0.08 rad) from where it began
		const act = new Array(m).fill(Infinity)
		for (let j = 0; j < m; j++)
			for (let k = 1; k < n; k++) {
				const i = (k * m + j) * 3
				if (Math.hypot(pos[i] - pos[j * 3], pos[i + 1] - pos[j * 3 + 1]) > 0.02 || Math.abs(pos[i + 2] - pos[j * 3 + 2]) > 0.08) {
					act[j] = k
					break
				}
			}
		let first = 0
		for (let j = 1; j < m; j++) if (act[j] < act[first]) first = j
		let sx = 0
		let sy = 0
		for (let k = 0; k < n; k++) {
			let cur = first
			let at = act[first]
			for (let j = 0; j < m; j++)
				if (act[j] <= k && (act[j] > at || at > k)) {
					cur = j
					at = act[j]
				}
			const fx = pos[(k * m + cur) * 3]
			const fy = Math.max(0.15, pos[(k * m + cur) * 3 + 1])
			if (k === 0) {
				sx = fx
				sy = fy
			} else {
				sx += FOLLOW_SMOOTH * (fx - sx)
				sy += FOLLOW_SMOOTH * (fy - sy)
			}
			out[k * 2] = sx
			out[k * 2 + 1] = sy
		}
		return out
	}

	function followAt(t) {
		run.follow ??= buildFollow(run.doc, run.track)
		const f = run.follow
		const n = f.length / 2
		if (n < 2) return [f[0], f[1]]
		const u = Math.min(n - 1, Math.max(0, t * FOLLOW_HZ))
		const i = Math.min(n - 2, Math.floor(u))
		const w = u - i
		return [f[i * 2] + (f[i * 2 + 2] - f[i * 2]) * w, f[i * 2 + 1] + (f[i * 2 + 3] - f[i * 2 + 1]) * w]
	}

	// ----- cameras & framing ---------------------------------------------------------------------------------------------
	function setFov(cam, hfov) {
		cam.aspect = aspect()
		cam.fov = vfovFor(hfov, cam.aspect)
		cam.updateProjectionMatrix()
	}

	/** Phone on a tripod: a 26 mm lens on +z, a little above the machine's centre, looking slightly down. It frames the machine's real 3D extent
	 *  (every mesh of the run but the table, the room, the invisible walls and the cords of hung things: statics where they stand, movers over
	 *  the whole track), not just its outline in the motion plane: the distance is solved so that all of it, projected, lies inside the picture
	 *  less FRAME_SIDE each side, FRAME_TOP_UI px (the buttons) + FRAME_TOP at the top and FRAME_BOTTOM at the bottom, and it is centred in that.
	 *  Where there is height to spare (a tall window) it then sinks until the tabletop's front edge reaches the bottom: no dark cabinet under it. */
	function frameWide() {
		// the framing maths projects points through the camera, so work without any view offset (the dev page's crop() sets one), then put it back
		const vo = wideCam.view?.enabled ? { ...wideCam.view } : null
		wideCam.clearViewOffset()
		const fixed = run?.doc?.view?.camera // (machines/mod_staging.py settings.camera: x0..x1 across the picture at height y, whatever the run)
		fixedShown = !!fixed
		if (fixed) {
			const fp = fixedPose(fixed)
			setPose(wideCam, fp.px, fp.py, fp.pz, fp.tx, fp.ty, 0, fp.hfov, aspect())
			wideCam.near = fp.near
			wideCam.far = fp.far
			wideCam.updateProjectionMatrix()
			wideTarget.set(fp.tx, fp.ty, 0)
			lastFrame = { box: null, rect: null, size: [width > 0 ? width : 1600, height > 0 ? height : 900], d: fp.d, tx: fp.tx, ty: fp.ty, steps: 0, fixed: { ...fixed } }
			if (vo) wideCam.setViewOffset(vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height)
			return
		}
		wideCam.near = 0.05 // (as made: a fixed camera far away moves them)
		wideCam.far = 80
		setFov(wideCam, HFOV_26MM)
		const spec = frameSpec ?? (run ? frameOf(run) : null)
		const W = width > 0 ? width : 1600
		const H = height > 0 ? height : 900
		const f = fitWide(spec, W, H, Math.min(FRAME_TOP_UI + FRAME_TOP * H, 0.4 * H))
		wideTarget.set(f.tx, f.ty, 0)
		wideCam.position.set(f.tx, f.ty + WIDE_PITCH * f.d, f.d) // render_3d's (1.45, 0.62, 2.5) -> (1.45, 0.32, 0)
		wideCam.lookAt(wideTarget)
		wideCam.updateMatrixWorld()
		lastFrame = { box: f.box, rect: f.rect, size: [W, H], d: f.d, tx: f.tx, ty: f.ty, steps: f.steps }
		if (vo) wideCam.setViewOffset(vo.fullWidth, vo.fullHeight, vo.offsetX, vo.offsetY, vo.width, vo.height)
	}
	/** The wide shot's fit (frameWide's maths, a pure function): for a W x H picture with T px kept clear at the top and a lens of horizontal field `hfov`, the target
	 *  (tx, ty, 0) and distance d of a camera at (tx, ty + WIDE_PITCH d, d) that holds every point of `spec` inside the picture less its margins. */
	function fitWide(spec, W, H, T, hfov = HFOV_26MM) {
		const pts = spec?.pts ?? Float32Array.of(-0.2, 0, 0, 3.1, 0, 0, -0.2, 0.8, 0, 3.1, 0.8, 0)
		const tanH = Math.tan(hfov / 2)
		const tanV = tanH / (W / H)
		const L = FRAME_SIDE * W
		const R = W - L
		const B = H - FRAME_BOTTOM * H
		// the camera looks from (tx, ty + WIDE_PITCH d, d) at (tx, ty, 0): forward (0, -sin, -cos), up (0, cos, -sin), right +x
		const cosP = 1 / Math.sqrt(1 + WIDE_PITCH * WIDE_PITCH)
		const sinP = WIDE_PITCH * cosP
		const box = { x0: 0, x1: 0, y0: 0, y1: 0 }
		const px = (x, y, z, tx, ty, d, out) => {
			const vy = y - (ty + WIDE_PITCH * d)
			const vz = z - d
			const depth = Math.max(0.05, -vy * sinP - vz * cosP)
			out.x = (((x - tx) / (depth * tanH)) * 0.5 + 0.5) * W
			out.y = ((-(vy * cosP - vz * sinP) / (depth * tanV)) * 0.5 + 0.5) * H
		}
		const p = { x: 0, y: 0 }
		const project = (tx, ty, d) => {
			box.x0 = box.y0 = Infinity
			box.x1 = box.y1 = -Infinity
			for (let i = 0; i < pts.length; i += 3) {
				px(pts[i], pts[i + 1], pts[i + 2], tx, ty, d, p)
				box.x0 = Math.min(box.x0, p.x)
				box.x1 = Math.max(box.x1, p.x)
				box.y0 = Math.min(box.y0, p.y)
				box.y1 = Math.max(box.y1, p.y)
			}
		}
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			x0 = Math.min(x0, pts[i])
			x1 = Math.max(x1, pts[i])
			y0 = Math.min(y0, pts[i + 1])
			y1 = Math.max(y1, pts[i + 1])
		}
		let tx = (x0 + x1) / 2
		let ty = (y0 + y1) / 2
		let d = Math.max(((x1 - x0) / 2 / tanH) * (W / (R - L)), ((y1 - y0) / 2 / tanV) * (H / (B - T)), 0.5)
		const perM = () => W / (2 * tanH * d * 1.007) // pixels per metre across the target
		let steps = 0
		for (let i = 0; i < 40; i++) {
			steps++
			project(tx, ty, d)
			const ratio = Math.max((box.x1 - box.x0) / (R - L), (box.y1 - box.y0) / (B - T))
			const dx = (box.x0 + box.x1) / 2 - (L + R) / 2
			const dy = (box.y0 + box.y1) / 2 - (T + B) / 2
			tx += dx / perM()
			ty -= dy / (perM() * cosP)
			d *= THREE.MathUtils.clamp(ratio, 0.6, 1.6)
			if (Math.abs(ratio - 1) < 1e-3 && Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) break
		}
		const tf = spec?.tableFront
		if (tf) {
			// sink the shot (keeping everything inside) until the tabletop's front edge reaches the bottom of the picture
			for (let i = 0; i < 6; i++) {
				project(tx, ty, d)
				px(tf.x, tf.y, tf.z, tx, ty, d, p)
				const sink = Math.min(H - p.y, B - box.y1)
				if (sink < 0.5) break
				ty += sink / (perM() * cosP)
			}
		}
		project(tx, ty, d)
		return { tx, ty, d, box: { ...box }, rect: [L, T, R, B], steps }
	}

	// ----- what the wide shot frames ---------------------------------------------------------------------------------------
	const _cv = new THREE.Vector3()
	/** The world corners of the box of every visible mesh under `root`, as it stands now, appended to `out` as x, y, z. */
	function boxCorners(root, out) {
		root.updateWorldMatrix(true, true)
		root.traverse((o) => {
			if (!o.isMesh || !o.visible || o.userData.blob) return
			o.geometry.boundingBox ?? o.geometry.computeBoundingBox()
			const b = o.geometry.boundingBox
			if (b.isEmpty()) return
			for (let i = 0; i < 8; i++) {
				_cv.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld)
				out.push(_cv.x, _cv.y, _cv.z)
			}
		})
	}
	/** A mover's box in its own frame (from where it stands now, its first frame), or its radius: what moves over the track in frameOf(). */
	function moverBox(part, p0) {
		const pts = []
		boxCorners(part.holder ?? part.mesh, pts)
		if (!pts.length) return null
		let z0 = Infinity
		let z1 = -Infinity
		for (let i = 2; i < pts.length; i += 3) {
			z0 = Math.min(z0, pts[i])
			z1 = Math.max(z1, pts[i])
		}
		if (part.R !== undefined) return { id: part.id, round: part.R, z0, z1 }
		const c = Math.cos(p0.angle)
		const s = Math.sin(p0.angle)
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			const dx = pts[i] - p0.x
			const dy = pts[i + 1] - p0.y
			const lx = dx * c + dy * s
			const ly = -dx * s + dy * c
			x0 = Math.min(x0, lx)
			x1 = Math.max(x1, lx)
			y0 = Math.min(y0, ly)
			y1 = Math.max(y1, ly)
		}
		return { id: part.id, x0, x1, y0, y1, z0, z1 }
	}
	/** The hardware fixed in the world (a spring's or rope's hanging point, a pulley and its bracket), as boxes at z = 0. */
	function fixedPoints(joints) {
		const out = []
		const at = (q, m) => out.push(q.x - m, q.y - m, 0, q.x + m, q.y - m, 0, q.x - m, q.y + m, 0, q.x + m, q.y + m, 0)
		for (const j of joints) {
			if (j.kind === "pulley") {
				at(j.groundA, (j.wheelRadius ?? 0.02) * 2)
				at(j.groundB, (j.wheelRadius ?? 0.02) * 2)
			} else if (j.kind !== "wheel") {
				if (j.a === null) at(j.anchorA, 0.02)
				if (j.b === null) at(j.anchorB, 0.02)
			}
		}
		return out
	}
	/** moverBox measured in the part's own frame, wherever the canvas has it now and whatever rest offset it is drawn with: the numbers moverBox gives
	 *  at build time (where the part stands at its first frame, with no offset). */
	const _inv = new THREE.Matrix4()
	const _lv = new THREE.Vector3()
	function moverBoxLocal(part) {
		const root = part.holder ?? part.mesh
		const pts = []
		boxCorners(root, pts) // (updates the world matrices)
		if (!pts.length) return null
		_inv.copy(root.matrixWorld).invert()
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		let z0 = Infinity
		let z1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			_lv.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(_inv)
			x0 = Math.min(x0, _lv.x)
			x1 = Math.max(x1, _lv.x)
			y0 = Math.min(y0, _lv.y)
			y1 = Math.max(y1, _lv.y)
			z0 = Math.min(z0, _lv.z)
			z1 = Math.max(z1, _lv.z)
		}
		if (part.R !== undefined) return { id: part.id, round: part.R, z0, z1 }
		return { id: part.id, x0, x1, y0, y1, z0, z1 }
	}
	/** frameOf for the export's shots: measured once the run is settled (every model in, the mounts too), with everything where it stands at t = 0 (the movers
	 *  measured in their own frame). frameOf(run) is measured when the run is built, from whatever stands there then: on a load that deferred a part's model
	 *  that is its stand-in, and how many are deferred depends on how busy the page was, so two loads of the same run framed it a hair apart (a cold browser's
	 *  first load moved every edge by a fraction of a pixel). The canvas keeps its own (it is on screen: re-framing it once the models land would jump). */
	function exportFrameOf(r) {
		if (r.exportFrame) return r.exportFrame
		if (r !== run) return frameOf(r)
		updateParts(0) // (the pull pins in, every mover at its first frame)
		const keepFrame = r.frame
		const keepFramed = r.framed
		try {
			r.frame = null
			r.framed = { ...keepFramed, movers: r.parts.map((p) => moverBoxLocal(p)) }
			r.exportFrame = frameOf(r)
		} finally {
			r.frame = keepFrame
			r.framed = keepFramed
			updateParts(lastT) // (picking and the editor see the parts where the canvas shows them)
		}
		return r.exportFrame
	}
	/** What the wide shot fits (cached on the run): {pts: x, y, z triples, tableFront: the tabletop's front edge, bottom}. */
	function frameOf(r) {
		if (r.frame) return r.frame
		const f = r.framed
		const out = []
		// (a long floor reaches the shot's sides: a lane, a display over it (ghost solids) or a static slab 4.5 m long or more widens the x range
		// a falling mover may drag the shot to, so a 12 m race is framed whole; a scene without them frames as it always did)
		let fx0 = FRAME_X[0]
		let fx1 = FRAME_X[1]
		for (const s of r.doc.solids) {
			if (s.kind !== "static" || !(s.itemType === "lane" || s.ghost === true || ((s.body.kind === "slab" || s.body.kind === "polygon") && (s.body.width ?? 0) >= 4.5 && s.itemType !== "table"))) continue
			const half = s.body.kind === "ball" ? s.body.radius : (s.body.width ?? 0.1) / 2
			fx0 = Math.min(fx0, s.at.x - half)
			fx1 = Math.max(fx1, s.at.x + half)
		}
		const put = (x, y, z) => out.push(Math.min(fx1, Math.max(fx0, x)), Math.min(FRAME_Y[1], Math.max(FRAME_Y[0], y)), z) // (what falls off the table leaves the shot)
		const tmp = []
		for (const root of f.still) {
			if (!root.visible) continue
			tmp.length = 0
			boxCorners(root, tmp)
			for (let i = 0; i < tmp.length; i += 3) put(tmp[i], tmp[i + 1], tmp[i + 2])
		}
		const frames = r.track.frames
		for (const m of f.movers) {
			if (!m) continue
			let x0 = Infinity
			let x1 = -Infinity
			let y0 = Infinity
			let y1 = -Infinity
			for (const fr of frames) {
				const q = fr.placements[m.id]
				if (!q) continue
				if (m.round !== undefined) {
					x0 = Math.min(x0, q.x - m.round)
					x1 = Math.max(x1, q.x + m.round)
					y0 = Math.min(y0, q.y - m.round)
					y1 = Math.max(y1, q.y + m.round)
					continue
				}
				const c = Math.cos(q.angle)
				const s = Math.sin(q.angle)
				for (let k = 0; k < 4; k++) {
					const lx = k & 1 ? m.x1 : m.x0
					const ly = k & 2 ? m.y1 : m.y0
					const x = q.x + lx * c - ly * s
					const y = q.y + lx * s + ly * c
					x0 = Math.min(x0, x)
					x1 = Math.max(x1, x)
					y0 = Math.min(y0, y)
					y1 = Math.max(y1, y)
				}
			}
			if (x0 === Infinity) continue
			for (let k = 0; k < 8; k++) put(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? m.z1 : m.z0)
		}
		for (let i = 0; i < f.fixed.length; i += 3) put(f.fixed[i], f.fixed[i + 1], f.fixed[i + 2])
		if (!out.length) {
			const b = r.bounds
			for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) put(x, y, 0)
		}
		const t = f.table
		r.frame = {
			pts: Float32Array.from(out),
			// (a scene a long floor widened is framed round its content: sinking it until the table's front edge meets the picture's bottom would
			// leave a 12 m race in a strip along the bottom under metres of bare wall)
			tableFront: t && fx0 === FRAME_X[0] && fx1 === FRAME_X[1] ? { x: t.at.x, y: t.at.y - t.body.height / 2, z: depthOf(t.body) / 2 } : null,
		}
		return r.frame
	}

	function ensureControls() {
		if (controls) return
		controls = new OrbitControls(orbitCam, canvas)
		controls.enabled = mode === "orbit" && !editing
		controls.enableDamping = true
		controls.dampingFactor = 0.09
		controls.minDistance = 0.12
		controls.maxDistance = 9
		controls.maxPolarAngle = Math.PI * 0.495 // stay above the table
		controls.minAzimuthAngle = -1.45 // and in front of the wall: the machine stands against it
		controls.maxAzimuthAngle = 1.45
		controls.addEventListener("change", () => {
			J.userAt = performance.now()
			requestRedraw()
		})
	}

	function startOrbitFromWide() {
		ensureControls()
		setFov(orbitCam, HFOV_26MM)
		orbitCam.position.copy(wideCam.position)
		orbitCam.quaternion.copy(wideCam.quaternion)
		controls.target.copy(wideTarget)
		controls.update()
		orbitStarted = true
	}

	function setMode(next) {
		if (next !== "wide" && next !== "follow" && next !== "orbit") return
		dirty = true
		mode = next
		if (controls) controls.enabled = mode === "orbit" && !editing
		canvas.style.touchAction = mode === "orbit" ? "none" : ""
	}

	const activeCamera = () => (mode === "orbit" ? orbitCam : mode === "follow" ? followCam : wideCam)

	// ----- drawing ---------------------------------------------------------------------------------------------------------
	function updateParts(t) {
		const fr = run.track.frames
		const i = frameIndex(run.track, t)
		const fa = fr[i].placements
		const fb = fr[Math.min(i + 1, fr.length - 1)].placements
		const span = fr[Math.min(i + 1, fr.length - 1)].t - fr[i].t
		const u = span > 0 ? Math.min(1, Math.max(0, (t - fr[i].t) / span)) : 0
		cur.fa = fa
		cur.fb = fb
		cur.u = u
		const q = _part
		if (run.restParts.length && restFix) {
			// resting gap: every slab / polygon part that hovers just above what it rests on is drawn lowered onto it (a welded item as one)
			for (const g of run.restGroups) g.off = g.lo = g.hi = 0
			for (const part of run.restParts) {
				const p = fa[part.id]
				if (!p) continue
				const n = fb[part.id] ?? p
				q.x = p.x + (n.x - p.x) * u
				q.y = p.y + (n.y - p.y) * u
				q.angle = p.angle + (n.angle - p.angle) * u
				const rest = part.rest
				rest.x = q.x
				rest.y = q.y
				rest.angle = q.angle
				const sp = rest.sup
				if (sp) {
					sp.x = q.x
					sp.y = q.y
					sp.c = Math.cos(q.angle)
					sp.s = Math.sin(q.angle)
				}
				const o = restLowering(rest, q, run.supports)
				const g = rest.grp
				if (o > g.hi) g.hi = o
				else if (o < g.lo) g.lo = o
			}
			settleGroups(run.restGroups)
			if (run.moverSupports.length) restOnMovers(run)
		}
		for (const part of run.parts) {
			const p = fa[part.id]
			if (!p) continue
			const n = fb[part.id] ?? p
			q.x = p.x + (n.x - p.x) * u
			q.y = p.y + (n.y - p.y) * u
			q.angle = p.angle + (n.angle - p.angle) * u
			let o
			if (part.ball) {
				// (a round body that rests on the table or a static slab is drawn lifted onto it: see roundLift)
				const lift = restFix ? roundLift(q.x, q.y, part.R - part.grow, part.grow, run.supports) : 0
				part.holder.position.set(q.x, q.y - part.R + lift, 0)
				part.holder.scale.y = p.squash ?? 1 // clay dents: squash about the lowest point, along world y
				part.mesh.rotation.z = q.angle
				part.blob.position.x = q.x
				o = AO_OPACITY * part.ao.k * Math.exp(-Math.max(0, q.y - part.R - TABLE_TOP) / (1.1 * part.R))
			} else if (part.round) {
				const lift = restFix ? roundLift(q.x, q.y, part.R - part.grow, part.grow, run.supports) : 0
				part.mesh.position.set(q.x, q.y + lift, 0)
				part.mesh.rotation.z = q.angle
				part.blob.position.x = q.x
				o = AO_OPACITY * part.ao.k * Math.exp(-Math.max(0, q.y - part.R - TABLE_TOP) / (1.1 * part.R))
			} else {
				part.mesh.position.set(q.x, q.y - (part.rest && restFix ? part.rest.grp.off : 0), 0)
				part.mesh.rotation.z = q.angle
				if (part.pts) polyFoot(part.pts, q, foot)
				else slabFoot(part.hw, part.hh, q, foot)
				part.blob.position.x = foot.x
				part.blob.scale.x = Math.max(0.05, foot.span + 0.05)
				o = AO_OPACITY * part.ao.k * Math.exp(-foot.h / 0.012)
			}
			part.blob.material.opacity = o
			part.blob.visible = o > 0.01
			if (p.scale !== undefined) {
				// (a body a module resized, melting ice or a filling balloon: its model shrinks or grows about the solid's origin; gone at 0)
				const k = p.scale + ((n.scale ?? p.scale) - p.scale) * u
				part.mesh.scale.setScalar(Math.max(1e-4, k))
				part.mesh.visible = k > 1e-3
				if (k <= 1e-3) part.blob.visible = false
			}
		}
		for (const pose of run.joints) pose(t)
		for (const sp of run.spinners) sp.obj.quaternion.copy(sp.q0).multiply(_sq.setFromAxisAngle(AXES[sp.axis], sp.rate * Math.max(0, t - sp.from)))
		if (run.frameHooks.length || run.plugins.length) framePlugins(run, t) // (a module's glows, dials, beams, labels)
		if (run.pins.length) {
			const u2 = Math.min(1, Math.max(0, (t - (run.tRelease - 0.01)) / 0.07))
			for (const pin of run.pins) pin.position.z = -(0.02 + pin.userData.extra / 2 + (0.13 - 0.02) * u2) // slides out backwards, away from the camera
		}
		for (const g of run.gates) g.at(t, run.tRelease) // (the starting gates swing up at the release)
	}

	/** A part that stands on no static support but on another mover is drawn with that mover's offset (the gap between the two stays the physics' own;
	 *  a stack of blocks is lowered as one). A few passes settle a stack whatever order the parts come in. */
	function restOnMovers(r) {
		let n = 0
		for (const part of r.restParts) {
			const rest = part.rest
			rest.dep = null
			const g = rest.grp
			if (g.hi !== 0 || g.lo !== 0) continue // it stands on the table or a static slab: that sets its offset
			probeRest(rest, rest, r.moverSupports)
			const sp = _probe.sup
			if (!sp || _probe.gap >= REST_FADE || sp.grp === g) continue
			rest.dep = sp.grp
			r.depParts[n++] = rest
		}
		for (let pass = 0; pass < 4 && n > 0; pass++) {
			let changed = false
			for (let i = 0; i < n; i++) {
				const rest = r.depParts[i]
				if (rest.grp.off !== rest.dep.off) {
					rest.grp.off = rest.dep.off
					changed = true
				}
			}
			if (!changed) break
		}
	}

	/** The coils' and chains' detail for camera `cam` drawing a picture `pxH` device pixels tall (coilLevel, chainLevel): true when any changed (the shadow map then
	 *  needs drawing again, so it holds the geometry the picture shows). The parts must be posed at the moment drawn (updateParts). */
	const _lodC = new THREE.Vector3()
	const _lodSize = new THREE.Vector2()
	function applyLods(cam, pxH, share = 1) {
		if (!run?.lods.length) return false
		cam.updateMatrixWorld()
		_lodC.setFromMatrixPosition(cam.matrixWorld)
		const k = pxH / (2 * Math.tan(THREE.MathUtils.degToRad(cam.getEffectiveFOV()) / 2)) // px per metre at 1 m
		let changed = false
		for (const f of run.lods) if (f(_lodC, k, share)) changed = true
		return changed
	}

	function draw(t, stepped = false, live = false) {
		if (disposed || !run) return
		if (xp.active) {
			// an export is drawing (renderFrame): the canvas keeps its picture untouched until it ends, then this draw is made
			xp.missed = true
			dirty = true
			return
		}
		if (!Number.isFinite(t)) t = 0
		if (container.clientWidth !== width || container.clientHeight !== height) resize()
		if (width === 0 || height === 0) return
		let t0 = performance.now()
		if (live && Q.mode === "auto") adaptQuality(t0, t0 - lastDrawAt) // (the app's clock or the orbit camera drawing on: the tier follows how fast that goes)
		const probing = adapt.probe && live
		if (probing) {
			// one frame in a second, timed whole: first let the GPU finish what it has queued, then draw this one and wait for it
			adapt.probe = false
			const gl = renderer.getContext()
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePx)
			t0 = performance.now()
		}
		if (live && t !== lastT) J.playAt = t0 // (a new moment, however slowly the frames come: the progressive build keeps out of the way)
		const flowing = live && t !== lastT && t0 - lastDrawAt < FLOW_GAP_MS // a new moment right after the last draw: the app's clock is running
		const moved = live && t !== lastT // (a new moment from the app's clock: the first frame of a play looks like a seek)
		flowN = flowing ? flowN + 1 : 0
		if (flowN === 1) reflOff = TIERS[Q.tier].refl === "paused" // every run of the clock measures itself again (the medium tier mirrors only while stopped)
		lastT = t
		lastDrawAt = t0
		drawCount++
		stats.draws++
		updateParts(t)
		if (mode === "follow") {
			if (!editing || !followPlaced) {
				const [fx, fy] = followAt(t)
				followCam.position.set(fx, fy + FOLLOW_LIFT, FOLLOW_DIST)
				followCam.lookAt(fx, fy, 0)
				followPlaced = true
			}
		} else if (mode === "orbit") {
			if (!orbitStarted) startOrbitFromWide() // the first time: continue from the wide shot as framed for this run
			if (!stepped) controls.update()
			drawnPos.copy(orbitCam.position)
			drawnQuat.copy(orbitCam.quaternion)
		}
		dirty = false // (a damping step just now already moved the camera this draw uses)
		const camera = activeCamera()
		if (applyLods(camera, renderer.getDrawingBufferSize(_lodSize).y, TIERS[Q.tier].lod)) shadowKey = "" // (the shadow map is drawn again with the coils and chains the picture shows)
		// A drag on a slow machine redraws the transmission pass and the shadow map on every TRANS_EVERY-th frame only (see `trans` above); a frame that held them
		// asks for a full redraw shortly after, so a pointer that stops mid-drag leaves the full picture.
		const tkey = `${camera.id}|${width}|${height}|${Q.tier}`
		trans.n = editing && drawCost > TRANS_SLOW_MS && tkey === trans.key && !trans.force ? trans.n + 1 : 0
		trans.force = false
		trans.key = tkey
		const hold = trans.n % TRANS_EVERY !== 0
		clearTimeout(trans.timer)
		if (hold)
			trans.timer = setTimeout(() => {
				trans.force = true
				requestRedraw()
			}, 150)
		// the shadow map only needs redrawing when something moved (a new moment or a new run), not while the camera orbits
		const sk = runSerial + ":" + t
		renderer.shadowMap.needsUpdate = sk !== shadowKey && !hold
		if (!hold) shadowKey = sk
		if (TIERS[Q.tier].chrome) {
			// a chrome ball shows the room as it stood at its last capture: a new moment (the clock ran, or was seeked) is captured again once it holds still, i.e. when
			// the same moment is drawn again (the redraw when the clock stops, which the mirror asks for anyway) or after MIRROR_GAP_MS; never while it plays
			if (mirrors.list.length && t !== mirrors.capT) mirrors.dirty = true
			refreshMirrors(!flowing && !editing && !probing && !moved)
		}
		// The planar reflection. Paused, seeking, after a load: always, in full. While the clock runs it is drawn on every other new moment
		// (the table keeps showing the last one in between) without the layer-REFL_SKIP meshes, and not at all when that is still too slow
		// (the table then goes without it until the clock stops); during a drag the last one stands. Whenever a draw settles for less than
		// a full reflection, reflStale makes render() draw once more when things stop.
		const mirror = refl.enabled && TIERS[Q.tier].refl !== "off" && run.tableMesh
		let doRefl = !!mirror
		if (doRefl && reflValid) {
			if (editing) doRefl = false
			else if (flowing && (reflOff || flowN % 2 === 0)) doRefl = false
		}
		refl.k.value = mirror && !(flowing && reflOff) ? 1 : 0
		reflStale = !!mirror && !(doRefl && !flowing)
		if (doRefl) {
			stats.reflDraws++
			renderReflection(camera, flowing, refl.rt, refl.matrix, refl.cam, run.lens > 0 ? (refl.base ??= mirrorBase(refl.rt)) : null) // (a full pass refreshes the shadow map, the main one reuses it)
		} else if (mirror) stats.reflSkipped++
		trans.hold = hold // (the transmission pass held: see `trans` above)
		trans.cam = camera
		try {
			renderer.render(scene, camera)
		} finally {
			trans.hold = false
			if (trans.held) { // (three.js always ends its pass by setting the target back: this is only a safety net)
				trans.held.layers.mask = trans.held.mask
				trans.held = null
			}
		}
		if (probing) {
			const gl = renderer.getContext()
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePx) // waits for the GPU: the whole cost of this frame
			adapt.costs.push({ ms: performance.now() - t0, at: performance.now() })
			if (adapt.costs.length > 4) adapt.costs.shift()
		} else drawCost += 0.3 * (Math.min(200, performance.now() - t0) - drawCost)
		if (flowing) {
			const ms = Math.min(40, performance.now() - t0)
			flowMs = flowN <= 1 ? ms : flowMs + 0.12 * (ms - flowMs)
			if (flowN >= 24 && flowMs > SLOW_MS) reflOff = true
		}
	}

	/** Is the caller app.js (its clock calls render() every animation frame, running or not)? Anyone else (the dev pages, tests) reads the canvas
	 *  or changes the scene by hand around render(): they always get a full draw, as ever. Unrecognised callers count as "anyone else". */
	const fromApp = () => /\bapp\.js\b/.test((new Error().stack ?? "").split("\n").slice(1, 7).join("\n"))

	/** The app's clock: draw only when the picture can have changed (a new moment, or anything marked dirty: a load, a resize, a camera, the
	 *  orbit controls). Orbit damping still steps every frame. */
	function render(t) {
		if (disposed || !run) return
		if (!Number.isFinite(t)) t = 0
		if (!fromApp()) return draw(t)
		let stepped = false
		if (mode === "orbit" && orbitStarted && controls) {
			controls.update() // (a camera that moved fires "change": dirty)
			stepped = true
			// (it fires only for moves over ~1 mm: the tail of the damping must still reach the screen)
			if (orbitCam.position.distanceToSquared(drawnPos) > 1e-9 || orbitCam.quaternion.angleTo(drawnQuat) > 3e-5) dirty = true
		}
		if (!dirty && t === lastT && !(reflStale && !editing)) return
		draw(t, stepped, true)
	}

	/** Orbit dragging and damping while the app's clock is paused: draw again on the next frame (unless someone already did). */
	function requestRedraw() {
		dirty = true
		if (redrawQueued || disposed) return
		const stamp = drawCount
		redrawQueued = requestAnimationFrame(() => {
			redrawQueued = 0
			if (drawCount === stamp) draw(lastT) // a draw in between ran controls.update() itself and re-requests if still moving
		})
	}

	/** Cover the table with the key light's shadow map, as tightly as the light's direction allows. */
	function fitShadow() {
		const b = run?.bounds
		const topY = Math.max(1.6, (b?.y1 ?? 0.8) + 0.2)
		const tb = run?.table?.body
		const half = (tb?.depth ?? TABLE_DEPTH) / 2 + 0.05
		const box = new THREE.Box3(new THREE.Vector3(-0.8, -0.2, -half), new THREE.Vector3(3.5, topY, half))
		if (run?.table) {
			box.min.x = Math.min(box.min.x, run.table.at.x - tb.width / 2 - 0.25)
			box.max.x = Math.max(box.max.x, run.table.at.x + tb.width / 2 + 0.25)
		}
		const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, 0.3, 0)
		key.target.position.copy(centre)
		key.position.set(centre.x - 1.9, 2.7, 1.7) // front-left-above, like the Blender window light
		key.target.updateMatrixWorld()
		key.updateMatrixWorld()
		const tmp = new THREE.OrthographicCamera()
		tmp.position.copy(key.position)
		tmp.lookAt(key.target.position)
		tmp.updateMatrixWorld()
		const inv = tmp.matrixWorldInverse
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		let z0 = Infinity
		let z1 = -Infinity
		for (const x of [box.min.x, box.max.x])
			for (const y of [box.min.y, box.max.y])
				for (const z of [box.min.z, box.max.z]) {
					const v = new THREE.Vector3(x, y, z).applyMatrix4(inv)
					x0 = Math.min(x0, v.x)
					x1 = Math.max(x1, v.x)
					y0 = Math.min(y0, v.y)
					y1 = Math.max(y1, v.y)
					z0 = Math.min(z0, v.z)
					z1 = Math.max(z1, v.z)
				}
		const cam = key.shadow.camera
		cam.left = x0
		cam.right = x1
		cam.bottom = y0
		cam.top = y1
		cam.near = Math.max(0.1, -z1 - 0.3)
		cam.far = -z0 + 0.3
		cam.updateProjectionMatrix()
	}

	// ----- public interface ------------------------------------------------------------------------------------------------
	function sizeTargets(w, h) {
		const T = TIERS[Q.tier]
		const pr = softwareGL && Q.tier === "low" ? SOFT_PR : T.pr // (a CPU rasteriser pays for every pixel it shades: see SOFT_PR)
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr, Math.sqrt(MAX_PIXELS / (w * h))))
		renderer.setSize(w, h, false)
		const dpr = renderer.getPixelRatio()
		if (T.refl === "off") refl.rt.setSize(2, 2) // (no mirror in this tier: no half-size target either)
		else refl.rt.setSize(Math.max(2, Math.floor((w * dpr) / 2)), Math.max(2, Math.floor((h * dpr) / 2)))
		refl.base?.setSize(refl.rt.width, refl.rt.height)
	}

	/** Everything that depends on the container's size: drawing buffer, wide framing, and all three lenses. */
	function applySize(w, h) {
		sizeTargets(w, h)
		reflValid = false // (the reflection target was reallocated)
		dirty = true
		sizedW = w
		sizedH = h
		frameWide()
		setFov(followCam, HFOV_35MM)
		setFov(orbitCam, HFOV_26MM)
	}

	function resize() {
		if (xp.active) {
			xp.resized = true // (resizing the drawing buffer clears the canvas: done when the export ends)
			return
		}
		const w = container.clientWidth
		const h = container.clientHeight
		if (w === 0 || h === 0) {
			width = w
			height = h
			return
		}
		const changed = w !== width || h !== height
		const resized = w !== sizedW || h !== sizedH // (opening the floating settings panel changes nothing here: the picture is not re-framed)
		width = w
		height = h
		if (resized) {
			applySize(w, h)
			adapt.holdoff = Math.max(adapt.holdoff, performance.now() + 1000)
		}
		if ((changed || resized) && run && !disposed) draw(lastT) // setSize cleared the canvas
	}

	/** Show a run. The first load frames the wide shot; later loads with opts.keepCamera (a drag, a re-run after an edit) keep every camera.
	 *  A layout that only moves things is moved in place (see retarget); opts.rebuild = true builds it anew anyway (tests). */
	function load(sim, previous, opts = {}) {
		if (disposed) return
		endExport() // (a new run during an export: the export is over; its next renderFrame with the old runId is refused)
		dirty = true
		mirrors.scan = mirrors.dirty = true // (the chrome balls' cube maps are made again, once the picture is drawn and things are still)
		if (!opts?.rebuild && retarget(sim)) stats.loadsMoved++
		else {
			stats.loadsBuilt++
			disposeRun()
			// The app's loads build progressively (see buildRun: stand-ins now, the models in idle time); any other caller (dev pages, tests) gets everything built before load() returns, as ever
			const progressive = !!(opts?.progressive ?? fromApp())
			lazyGrain = progressive
			try {
				run = buildRun(sim, progressive)
			} finally {
				lazyGrain = false
			}
			adapt.holdoff = Math.max(adapt.holdoff, performance.now() + 1000)
			stats.modelsDeferred += run.left
			J.lastWork = performance.now()
			if (progressive) {
				// nothing more is built, and no bake worker asked, until the frame with this run's first picture has gone out (an idle slice could otherwise come
				// first and hold it up; starting the workers costs the page a little too)
				const r = run
				r.gate = true
				const open = () => {
					if (!r.gate) return
					r.gate = false
					if (run !== r || r.cancelled) return
					r.openAt = performance.now()
					prebakeRun(r)
					schedule()
				}
				requestAnimationFrame(() => requestAnimationFrame(open))
				setTimeout(open, 500) // (a tab in the background draws no frames)
			}
			schedule() // (the stand-ins' models, and the wood grain)
		}
		fitCabinet(run.table)
		cabinet.visible = cabinetWanted
		applyEnvironment(run)
		const keep = !!opts?.keepCamera && !!frameSpec && !sim.doc?.view?.camera && !fixedShown
		if (!keep) {
			frameSpec = frameOf(run)
			orbitStarted = false
			followPlaced = false
		}
		width = container.clientWidth
		height = container.clientHeight
		if (width > 0 && height > 0) {
			if (width !== sizedW || height !== sizedH) applySize(width, height) // (frames the wide shot too)
			else if (!keep) frameWide()
		}
		fitShadow()
		// (a layout is one frame: the app draws it at 0 right after, so do that, and let that call see nothing left to do)
		if (width > 0 && height > 0) draw(sim.track.frames.length > 1 ? Math.min(lastT, sim.doc.seconds ?? lastT) : 0)
	}

	function setOptions(opts = {}) {
		dirty = true
		if (opts.looks && typeof opts.looks === "object") {
			const json = JSON.stringify(opts.looks)
			if (json !== looksJson) {
				looksJson = json
				looks = { ...DEFAULT_LOOKS, ...opts.looks }
				endExport() // (the run is built again: a new runId)
				if (run) {
					const sim = run.sim
					disposeRun()
					clearMaterials() // the cached materials were made from the old looks
					run = buildRun(sim)
					fitCabinet(run.table)
					applyEnvironment(run)
					fitShadow()
				} else clearMaterials()
			}
		}
		if (opts.camera) setMode(opts.camera)
		if (typeof opts.reflections === "boolean") refl.enabled = opts.reflections
		if (typeof opts.exposure === "number") renderer.toneMappingExposure = opts.exposure
		if (run && width > 0 && height > 0) draw(lastT)
	}

	// ----- editing hooks (coordinates: CLIENT px in, CONTAINER px out) -----------------------------------------------------
	const ray = new THREE.Raycaster()
	ray.layers.enable(REFL_SKIP) // (glass, ice and tiny parts can be picked too)
	ray.layers.enable(PANE_LAYER) // (and a safety wall's pane while it is drawn)
	ray.layers.enable(LENS_LAYER) // (and the see-through parts inside glass)
	const ndc = new THREE.Vector2()
	const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
	const hit = new THREE.Vector3()
	function rayAt(clientX, clientY) {
		if (disposed || !run || width === 0 || height === 0) return null
		const r = canvas.getBoundingClientRect()
		if (!r.width || !r.height) return null
		ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1))
		const cam = activeCamera()
		cam.updateMatrixWorld()
		ray.setFromCamera(ndc, cam)
		return ray
	}
	/** The id of the solid drawn nearest to the viewer at this point (client px), or null. A safety wall's pane only when nothing else is there; the
	 *  post and pin of a held ball only while the ball is still held (a drag after the release would shift the ball by what it has travelled). */
	function pick(clientX, clientY) {
		const rr = rayAt(clientX, clientY)
		if (!rr) return null
		run.group.updateMatrixWorld()
		let list = run.pickables
		const shown = run.panes.filter((pn) => pn.mesh.visible) // (a wall can be grabbed while its pane is drawn)
		if (shown.length) list = [...list, ...shown.map((pn) => pn.mesh)]
		let pane = null
		for (const h of rr.intersectObjects(list, false)) {
			const u = h.object.userData
			if (u.pane) {
				pane ??= u.solidId ?? null
				continue
			}
			if (u.stand && lastT >= run.tRelease) continue
			return u.solidId ?? null
		}
		return pane
	}
	const down = new THREE.Raycaster() // (surfaceAt's straight-down ray in the machine plane)
	down.layers.mask = ray.layers.mask
	down.ray.direction.set(0, -1, 0)
	const _bb = new THREE.Box3()
	const _sn = new THREE.Vector3()
	const _nm = new THREE.Matrix3()
	/** The surface under this point (client px), where a dropped thing would stand: x is the cursor's place in the machine plane (z = 0); y is the top of the
	 *  first drawn solid straight below, from just above what the camera ray meets (so a hit on a front or side face reports that solid's top at that x, and the
	 *  table in front of or behind the plane reads the same as in it). Never the room, a safety wall's pane, a cord or the stand of a held ball.
	 *  {x, y, solidId, itemId, normal {x, y, z} (world, facing up from the surface)}, or null. */
	function surfaceAt(clientX, clientY) {
		const rr = rayAt(clientX, clientY)
		if (!rr) return null
		const p0 = rr.ray.intersectPlane(plane, hit)
		if (!p0) return null
		const px = p0.x
		run.group.updateMatrixWorld()
		const ok = (k) => k.object.visible && !k.object.userData.stand && !k.object.userData.mount
		const h = rr.intersectObjects(run.pickables, false).find(ok)
		if (!h) return null
		down.ray.origin.set(px, _bb.setFromObject(h.object).max.y + 0.01, 0)
		const d = down.intersectObjects(run.pickables, false).find(ok)
		if (!d) return null
		const solidId = d.object.userData.solidId ?? null
		const n = d.face ? _sn.copy(d.face.normal).applyNormalMatrix(_nm.getNormalMatrix(d.object.matrixWorld)) : _sn.set(0, 1, 0)
		if (n.dot(down.ray.direction) > 0) n.negate()
		return { x: px, y: d.point.y, solidId, itemId: run.itemOf.get(solidId) ?? null, normal: { x: n.x, y: n.y, z: n.z } }
	}
	/** The app tells which items it marks: {selected, hover} item ids (or null). The see-through walls of those items are drawn as faint acrylic. */
	function setHighlight(h = {}) {
		const sel = h?.selected ?? null
		const hov = h?.hover ?? null
		if (sel === hl.selected && hov === hl.hover) return
		hl.selected = sel
		hl.hover = hov
		if (!run) return
		let changed = false
		for (const pn of run.panes) {
			const on = !!pn.item && (pn.item === sel || pn.item === hov)
			if (pn.mesh.visible !== on) {
				pn.mesh.visible = on
				changed = true
			}
		}
		if (changed) requestRedraw()
	}
	/** Where the camera ray through this point (client px) meets the machine plane z = 0: {x, y} m, or null. */
	function toWorld(clientX, clientY) {
		const rr = rayAt(clientX, clientY)
		if (!rr) return null
		const p = rr.ray.intersectPlane(plane, hit)
		return p ? { x: p.x, y: p.y } : null
	}
	/** css px relative to the container for the world point (x, y, 0), or null if it is behind the camera. */
	function toScreen(x, y) {
		if (disposed || width === 0 || height === 0) return null
		const cam = activeCamera()
		cam.updateMatrixWorld()
		const v = _v1.set(x, y, 0).applyMatrix4(cam.matrixWorldInverse)
		if (v.z >= -cam.near) return null
		v.set(x, y, 0).project(cam)
		return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height }
	}
	/** css px per meter at the world point (x, y, 0), across the view. */
	function pxPerMeter(x, y) {
		const a = toScreen(x, y)
		if (!a) return Math.max(1, width / 4)
		const cam = activeCamera()
		const right = _v2.setFromMatrixColumn(cam.matrixWorld, 0) // 0.1 m along the camera's right: a length across the view, whatever the angle
		const p1 = _v3.set(x + right.x * 0.1, y + right.y * 0.1, right.z * 0.1).project(cam)
		const sx = (p1.x * 0.5 + 0.5) * width
		const sy = (-p1.y * 0.5 + 0.5) * height
		return Math.hypot(sx - a.x, sy - a.y) / 0.1
	}
	/** While the user drags: the follow camera stays where it is and orbiting is off. */
	function setEditing(on) {
		editing = !!on
		dirty = true
		if (controls) controls.enabled = mode === "orbit" && !editing
	}
	/** Re-fit the wide camera to everything now (and send an orbit back to that shot). */
	function frame() {
		if (!run) return
		dirty = true
		frameSpec = frameOf(run)
		orbitStarted = false
		if (width > 0 && height > 0) {
			frameWide()
			draw(lastT)
		}
	}

	const onContextLost = (e) => e.preventDefault() // let the browser restore the context
	const onContextRestored = () => {
		if (disposed) return
		// the environment map is GPU-only content (a PMREM render target): it came back empty, so make it again and point every material at it
		envTarget = makeEnvironment() // (the old target's GPU objects died with the old context: nothing to free)
		scene.environment = envTarget.texture
		for (const e of matCache.values()) if (e.mat.envMap) e.mat.envMap = envTarget.texture
		for (const b of belts) b.band.envMap = envTarget.texture // (a belt's own band material)
		releaseMirrors(false) // (the cube maps died with the context: the studio until they are drawn again)
		if (lowEnv) {
			lowEnv = null // (the low tier's mirror env died too: made again, and every copy pointed at it)
			const env = lowChromeEnv()
			for (const m of lowChromeMats.values()) m.envMap = env.texture
		}
		for (const e of mirrors.list) e.state = "ready"
		mirrors.dirty = true
		if (paneMat) paneMat.envMap = envTarget.texture
		shadowKey = ""
		reflValid = false
		dirty = true
		if (run && width > 0 && height > 0) draw(lastT)
	}
	canvas.addEventListener("webglcontextlost", onContextLost)
	canvas.addEventListener("webglcontextrestored", onContextRestored)

	let ro = null
	if (typeof ResizeObserver !== "undefined") {
		ro = new ResizeObserver(() => resize())
		ro.observe(container)
	}

	function dispose() {
		if (disposed) return
		endExport()
		disposed = true
		if (J.timer) {
			if (J.idle) cancelIdleCallback(J.timer)
			else clearTimeout(J.timer)
			J.timer = 0
		}
		clearTimeout(J.preTimer)
		clearTimeout(swapTimer)
		clearTimeout(trans.timer)
		for (const done of J.settled.splice(0)) done()
		for (const w of grainWait.values()) w.ph.dispose()
		grainWait.clear()
		if (redrawQueued) cancelAnimationFrame(redrawQueued)
		if (ro) ro.disconnect()
		canvas.removeEventListener("webglcontextlost", onContextLost)
		canvas.removeEventListener("webglcontextrestored", onContextRestored)
		disposeRun()
		if (mirrors.timer) clearTimeout(mirrors.timer)
		for (const list of mirrors.pool.values()) for (const e of list) (e.rt.dispose(), e.uv.dispose(), e.mat.dispose())
		for (const e of mirrors.list) (e.rt.dispose(), e.uv.dispose(), e.mat.dispose())
		mirrors.pool.clear()
		mirrors.list.length = 0
		for (const m of blobPool) m.dispose()
		blobPool.length = 0
		for (const b of belts) {
			b.tex.dispose()
			b.band.dispose()
		}
		belts.length = 0
		beltPool.length = 0
		if (controls) controls.dispose()
		clearMaterials()
		for (const t of sharedTextures.values()) t.dispose()
		sharedTextures.clear()
		cordMaterial.dispose()
		coilDepth.dispose()
		paneMat?.dispose()
		paneEdgeMat?.dispose()
		for (const e of geoCache.values()) e.geo.dispose()
		geoCache.clear()
		blobGeo.dispose()
		blobTex.dispose()
		wallGeo.dispose()
		wallMat.dispose()
		shell.geometry.dispose()
		shellMat.dispose()
		wall.geometry.dispose()
		floorGeo.dispose()
		roomFloor.material.dispose()
		cabinet.geometry.dispose()
		cabinetMat.dispose()
		refl.rt.dispose()
		refl.base?.dispose()
		if (mirrorCopy) {
			mirrorCopy.mat.dispose()
			mirrorCopy.sc.children[0].geometry.dispose()
		}
		envTarget.dispose()
		pmrem.dispose()
		for (const gen of chromePmrem.values()) gen.dispose()
		lowEnv?.dispose()
		for (const m of lowChromeMats.values()) m.dispose()
		key.shadow.map?.dispose()
		renderer.dispose()
		renderer.forceContextLoss()
		canvas.remove()
	}

	// ----- export: the finished scene, frame by frame, for a video (renderFrame; CONTRACT.md "Export") ---------------------------------------------------
	// renderFrame(t, {width, height, camera, motionBlur}) draws moment t at exactly width x height into the view's own targets, never the canvas, always at the high
	// tier whatever the canvas's (shadow map 4096, glass with its transmission pass, chrome), with the table's mirror, the key light's shadow map and the chrome
	// balls' cube maps all made afresh for that moment, and reads it back into an OffscreenCanvas a VideoEncoder takes. The main pass draws into a target three.js
	// treats as it treats the canvas (an "XR" target holding sRGB bytes): every material compiles as for the canvas (AgX and the sRGB encoding in the shader, the
	// paints' own tone curve) and shares the canvas's programs, so the colours are the canvas's. Nothing in it reads the wall clock and the cameras are pure functions
	// of t built from the track: the same t and options give the same pixels. While an export runs the canvas is not drawn, resized or re-tiered (it keeps its
	// picture; anything asked meanwhile is done when it ends); it ends at endExport(), at a new load, or EXPORT_IDLE_MS after the last frame.
	const EXPORT_IDLE_MS = 4000
	const EXPORT_MIRROR = 256 // cube map side of a chrome ball in an export (the canvas's are 128)
	const EXPORT_CAMERAS = ["wide", "follow", "orbit", "director", "live", "fixed"] // fixed: the scene's fixed camera (doc.view.camera), else the wide shot
	const BLUR_MAX = 32 // most sub-frames a blurred frame takes
	const DIRECTOR_PEAK = 2400 // px/s across a 1920 px picture: the director's moves stay under this at their fastest point (the picture's edge as it zooms; ~1.25 widths a second)
	const BLUR_STEP_PX = 2 // ... and as many as keep anything from moving more than this between two of them (no visible steps)
	const XWIDE = { side: FRAME_SIDE, top: FRAME_TOP + 0.03, bottom: FRAME_BOTTOM } // the export's wide shot: no buttons over the picture
	let xg = null // the export's GPU side: targets, cameras, readback (made at its first frame, freed when it ends)
	let glMax = 0
	const xstats = { frames: 0, lastMs: 0, ms: 0, sessions: 0, readMs: 0, split: null }
	const canExport = () => !!run && !run.cancelled && run.track.frames.length > 1
	const exportDuration = () => {
		const fr = run.track.frames
		return Math.max(0, run.doc.seconds ?? fr[fr.length - 1].t)
	}
	const exportMaxSize = () => {
		if (!glMax) {
			const gl = renderer.getContext()
			glMax = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 8192)
		}
		return glMax
	}
	/** MSAA samples an export frame takes by default: 8 up to 1440p, 4 above (a 4K target at 8 x would hold half a gigabyte), never more than the GPU has. */
	const exportSamples = (W = 1920, H = 1080) => Math.min(W * H > 2560 * 1440 ? 4 : 8, renderer.capabilities.maxSamples ?? 4)
	const mirrorsFresh = () => !run || !TIERS[Q.tier].chrome || (!mirrors.scan && (!mirrors.list.length || (!mirrors.dirty && mirrors.list.every((e) => e.applied))))

	/** Resolves once the progressive build has swapped every stand-in for its model (and the mounts and the wood grain are in), and, on the high tier, the canvas's
	 *  chrome balls have their cube maps of this run (at most 3 s more: they are made on a still, drawn picture). A new load meanwhile is waited for too. */
	function whenSettled() {
		return new Promise((resolve) => {
			let since = 0
			const step = () => {
				if (disposed) return resolve()
				if (!isSettled()) {
					since = 0
					J.settled.push(step)
					schedule()
					return
				}
				since ||= performance.now()
				// the models are in: look for the chrome balls now (the canvas waits for two quiet draws), and let the canvas draw (the same picture) so it makes their cube maps
				if (run && mirrors.scan && TIERS[Q.tier].chrome && !xp.active) scanMirrors()
				if (mirrorsFresh() || performance.now() - since > 3000) return resolve()
				if (!xp.active) requestRedraw()
				setTimeout(step, 50)
			}
			step()
		})
	}

	/** What an export of the run shown can be: duration, recommended size, whether it is settled, the camera names, limits. */
	function exportInfo() {
		const ok = canExport()
		const low = softwareGL
		return {
			ready: ok, // a finished run is shown (not a one-frame layout preview, not nothing)
			settled: isSettled() && mirrorsFresh(),
			left: run && !run.cancelled ? run.left : 0, // stand-ins still to be replaced by their models
			runId: run ? run.serial : 0, // pass it to renderFrame: a frame of another run is refused
			duration: ok ? exportDuration() : 0, // s (the scene's seconds): frames at t = i / fps for i = 0 .. round(duration * fps)
			trackFps: ok ? run.track.fps : 0,
			impacts: ok ? (run.track.impacts?.length ?? 0) : 0,
			recommended: { width: low ? 1280 : 1920, height: low ? 720 : 1080, fps: low ? 30 : 60, camera: "wide", motionBlur: low ? 0 : 6 },
			maxSize: exportMaxSize(),
			samples: exportSamples(),
			cameras: EXPORT_CAMERAS.slice(),
			exporting: xp.active,
			tier: xp.saved ? xp.saved.tier : Q.tier, // the canvas's (an export always draws high)
			gpu: gpuName,
			softwareGL,
			lastFrameMs: xstats.lastMs,
			fixed: ok ? (run.doc.view?.camera ?? null) : null, // the scene's fixed camera {x0, x1, y, pitch, hfov} (the wide and fixed cameras), or null
		}
	}

	function exportOptions(o) {
		o = o ?? {}
		const W = Math.round(Number(o.width ?? 1920))
		const H = Math.round(Number(o.height ?? 1080))
		const max = exportMaxSize()
		if (!(W >= 16 && H >= 16 && W <= max && H <= max)) throw new RangeError(`renderFrame: width and height must be whole numbers from 16 to ${max} (got ${o.width} x ${o.height})`)
		const camera = o.camera ?? "wide"
		if (!EXPORT_CAMERAS.includes(camera)) throw new RangeError(`renderFrame: camera must be one of ${EXPORT_CAMERAS.join(", ")} (got ${camera})`)
		const mb = o.motionBlur
		const n = mb === true ? 6 : typeof mb === "number" ? mb : mb && typeof mb === "object" ? (mb.samples ?? 6) : 1
		const blur = Number.isFinite(n) && n > 1 ? Math.min(BLUR_MAX, Math.round(n)) : 1
		const most = mb && typeof mb === "object" && Number.isFinite(Number(mb.max)) ? Math.min(BLUR_MAX, Math.max(blur, Math.round(Number(mb.max)))) : BLUR_MAX
		const fps = Number(o.fps ?? 60) > 0 ? Number(o.fps ?? 60) : 60
		const angle = Number((mb && typeof mb === "object" ? mb.shutter : undefined) ?? o.shutter ?? 180)
		const open = (Math.min(360, Math.max(0, Number.isFinite(angle) ? angle : 180)) / 360) / fps // s the shutter stays open
		const samples = Math.max(0, Math.min(renderer.capabilities.maxSamples ?? 4, Math.round(Number(o.samples ?? exportSamples(W, H)))))
		return { W, H, camera, blur, most, open, samples, runId: o.runId, output: o.output === "imagedata" ? "imagedata" : "canvas" }
	}

	/** The canvas's tier state on the GPU side (applyTier's, without the drawing buffer, the event and the auto-quality bookkeeping): for the export's hold on high. */
	function tierGpu() {
		const T = TIERS[Q.tier]
		if (key.shadow.mapSize.x !== T.shadow) {
			key.shadow.mapSize.set(T.shadow, T.shadow)
			key.shadow.map?.dispose()
			key.shadow.map = null
			key.shadow.mapPass?.dispose()
			key.shadow.mapPass = null
		}
		shadowKey = ""
		if (run) applyGlass(run.group)
		if (!T.chrome) releaseMirrors(false)
		else if (!xp.active && mirrors.list.some((e) => e.size !== T.chrome)) {
			releaseMirrors(true) // (an export's end on a medium canvas whose balls were first found by the export: made again at this tier's size)
			mirrors.scan = mirrors.dirty = true
		}
		if (run) applyLowChrome(run.group, run.roundIds)
	}

	/** Start an export session: the models in, the high tier held, the chrome balls found and their shaders compiled, the programs the export's passes need compiled. */
	function beginExport() {
		if (xp.active) return Promise.resolve()
		xp.starting ??= (async () => {
			await whenSettled()
			if (disposed || !canExport()) throw new Error("renderFrame: no finished run to export (run the scene first)")
			if (xp.active) return
			xp.active = true // from here on the canvas is left alone
			const gen = ++xp.gen
			xp.serial = run.serial
			xp.saved = { tier: Q.tier }
			xstats.sessions++
			if (Q.tier !== "high") {
				Q.tier = "high"
				tierGpu()
			}
			scanMirrors() // (the chrome balls: compiled in the background, then ready)
			const t0 = performance.now()
			while (mirrors.list.some((e) => e.state === "compiling") && performance.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 25))
			for (const e of mirrors.list) if (e.state === "compiling") e.state = "ready" // (a driver that never said: made anyway, as the canvas does)
			if (!xp.active || xp.gen !== gen) throw new Error("renderFrame: the scene changed while the export was starting")
			// compile what the passes will draw (the main pass shares the canvas's programs; the mirror, the cube faces and a transmission pass draw linear), so the
			// first frames do not stall on it: a small target of each kind, the export's chrome materials on their balls meanwhile
			const g = exportGpu()
			const probeXr = exportTarget(16, 16, 0, true)
			const probeLin = new THREE.WebGLRenderTarget(16, 16, { type: refl.rt.texture.type })
			const live = mirrors.list.filter((e) => e.state === "ready" && e.mesh)
			for (const e of live) e.mesh.material = exportMirror(g, e).mat
			const waits = []
			try {
				for (const rt of [probeXr, probeLin]) {
					renderer.setRenderTarget(rt)
					waits.push(renderer.compileAsync(scene, g.cam, scene).catch(() => {}))
				}
			} finally {
				renderer.setRenderTarget(null)
				restoreMirrors()
			}
			await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 15000))])
			probeXr.dispose()
			probeLin.dispose()
			if (!xp.active || xp.gen !== gen) throw new Error("renderFrame: the scene changed while the export was starting")
		})().finally(() => {
			xp.starting = null
		})
		return xp.starting
	}

	/** End the export session (if one runs): its targets freed, the canvas's own tier back, and anything asked of the canvas meanwhile (a draw, a resize, a quality) done. */
	function endExport() {
		if (!xp.active) return
		clearTimeout(xp.timer)
		xp.timer = 0
		xp.active = false
		xp.gen++
		const g = xg
		xg = null
		if (g) {
			try {
				if (run && !renderer.getContext().isContextLost()) {
					// three.js keeps a transmission target per camera at the size it last drew: one 1 x 1 draw with each of the export's cameras shrinks them
					const autoUpdate = renderer.shadowMap.needsUpdate
					renderer.shadowMap.needsUpdate = false
					renderer.setRenderTarget(g.tiny)
					renderer.render(scene, g.cam)
					renderer.render(scene, g.reflCam)
					renderer.setRenderTarget(null)
					renderer.shadowMap.needsUpdate = autoUpdate
				}
			} catch {}
			for (const rt of [g.rt, g.out, g.acc, g.refl, g.reflBase, g.tiny]) rt?.dispose()
			for (const x of g.mirrors.values()) {
				for (const c of [x, x.pre]) {
					c.rt.dispose()
					c.uv.dispose()
					c.mat.dispose()
				}
			}
			chromePmrem.get(EXPORT_MIRROR)?.dispose() // (the export's own size: its working targets go with the session)
			chromePmrem.delete(EXPORT_MIRROR)
			if (g.quad) {
				g.quad.mesh.geometry.dispose()
				for (const m of [g.quad.copy, g.quad.acc, g.quad.enc]) m.dispose()
			}
		}
		restoreMirrors()
		if (xp.saved) {
			const tier = xp.saved.tier
			xp.saved = null
			if (Q.tier !== tier) {
				Q.tier = tier
				tierGpu()
			}
		}
		shadowKey = ""
		if (xp.mode) {
			const m = xp.mode
			xp.mode = null
			setQuality(m)
		}
		if (xp.resized) {
			xp.resized = false
			resize()
		}
		if (xp.missed) {
			xp.missed = false
			requestRedraw()
		}
	}

	/** An off-screen colour target: RGBA8 (raw bytes); `xr` = the main pass's (three.js then tone-maps and encodes sRGB in the shader, as for the canvas). */
	function exportTarget(W, H, samples, xr) {
		const rt = new THREE.WebGLRenderTarget(W, H, {
			type: THREE.UnsignedByteType,
			colorSpace: xr ? THREE.SRGBColorSpace : THREE.NoColorSpace,
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			generateMipmaps: false,
			depthBuffer: xr,
			stencilBuffer: false,
			samples,
		})
		rt.texture.internalFormat = "RGBA8" // (an sRGB colour space would otherwise make it SRGB8_ALPHA8, and the MSAA resolve needs both sides the same)
		if (xr) rt.isXRRenderTarget = true // (three.js: tone mapping and output colour space as for the canvas, the bytes stored as written)
		return rt
	}
	function exportGpu() {
		if (xg) return xg
		const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 80)
		cam.layers.enable(REFL_SKIP)
		cam.layers.enable(PANE_LAYER)
		cam.layers.enable(LENS_LAYER)
		const nullCam = new THREE.PerspectiveCamera(1, 1, 1e5, 1e5 + 1) // sees nothing: a pass that only draws the shadow map
		nullCam.layers.enable(REFL_SKIP) // (the casters it draws: those of the canvas's paused mirror pass, which draws the shadow map there)
		xg = { W: 0, H: 0, samples: -1, rt: null, out: null, acc: null, refl: null, tiny: new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }), canvas: null, ctx: null, img: null, buf: null, quad: null, mirrors: new Map(), shots: new Map(), cam, reflCam: new THREE.PerspectiveCamera(), nullCam, matrix: new THREE.Matrix4() }
		return xg
	}
	function exportTargets(g, o) {
		if (g.W === o.W && g.H === o.H && g.samples === o.samples) return
		for (const rt of [g.rt, g.out, g.acc, g.refl, g.reflBase]) rt?.dispose()
		g.reflBase = null // (made with the first frame that has lens parts: renderReflection)
		g.W = o.W
		g.H = o.H
		g.samples = o.samples
		g.rt = exportTarget(o.W, o.H, o.samples, true)
		g.out = exportTarget(o.W, o.H, 0, false)
		g.acc = null // (made by the first frame with motion blur)
		g.refl = new THREE.WebGLRenderTarget(Math.max(2, Math.floor(o.W / 2)), Math.max(2, Math.floor(o.H / 2)), {
			type: refl.rt.texture.type,
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: true,
		}) // (as the canvas's: half the picture's size, mipmapped for the varnish's blur)
		g.canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(o.W, o.H) : Object.assign(document.createElement("canvas"), { width: o.W, height: o.H })
		g.ctx = g.canvas.getContext("2d", { alpha: false })
		g.img = new ImageData(o.W, o.H)
		g.buf = new Uint8Array(g.img.data.buffer)
	}
	/** Read g.out (RGBA8, rows already top-down) into g.img: through a pixel-pack buffer kept for the export (in Chrome 3 to 4 times faster than readPixels into
	 *  script memory), the framebuffer bound through three.js's state so its cache stays right. */
	function exportRead(g) {
		const gl = renderer.getContext()
		const bytes = g.W * g.H * 4
		if (!g.pbo || g.pboBytes !== bytes) {
			if (g.pbo) gl.deleteBuffer(g.pbo)
			g.pbo = gl.createBuffer()
			g.pboBytes = bytes
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo)
			gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
			gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
		}
		renderer.state.bindFramebuffer(gl.FRAMEBUFFER, renderer.properties.get(g.out).__webglFramebuffer)
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo)
		gl.readPixels(0, 0, g.W, g.H, gl.RGBA, gl.UNSIGNED_BYTE, 0)
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, g.buf)
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
	}
	/** Full-screen passes on raw bytes: copy (flipped to top-down rows), accumulate a sub-frame in linear light (sRGB decoded exactly), encode the sum back to sRGB. */
	function exportQuad(g) {
		if (g.quad) return g.quad
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
		const vertexShader = "precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }"
		const head = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D tSrc;
uniform int uH;
uniform float uW;
out vec4 outColor;
vec3 dec(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(1.0 / 0.41666)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045)))); }
vec3 enc(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
ivec2 flipped() { ivec2 p = ivec2(gl_FragCoord.xy); p.y = uH - 1 - p.y; return p; }
`
		const mat = (body) =>
			new THREE.RawShaderMaterial({
				glslVersion: THREE.GLSL3,
				vertexShader,
				fragmentShader: head + body,
				uniforms: { tSrc: { value: null }, uH: { value: 1 }, uW: { value: 1 } },
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
			})
		// (the sRGB curve is three.js's own, sRGBTransferOETF, and dec its exact inverse: an unmoving pixel comes back to the very byte it was)
		const copy = mat("void main() { outColor = vec4(texelFetch(tSrc, flipped(), 0).rgb, 1.0); }")
		const acc = mat("void main() { outColor = vec4(dec(texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0).rgb) * uW, uW); }")
		acc.blending = THREE.CustomBlending
		acc.blendEquation = THREE.AddEquation
		acc.blendSrc = THREE.OneFactor
		acc.blendDst = THREE.OneFactor
		const enc = mat("void main() { outColor = vec4(enc(texelFetch(tSrc, flipped(), 0).rgb), 1.0); }")
		const mesh = new THREE.Mesh(geo, copy)
		mesh.frustumCulled = false
		const sc = new THREE.Scene()
		sc.add(mesh)
		g.quad = { scene: sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh, copy, acc, enc }
		return g.quad
	}
	function quadPass(g, mat, src, target, blend, weight = 1) {
		const q = exportQuad(g)
		mat.uniforms.tSrc.value = src
		mat.uniforms.uH.value = g.H
		mat.uniforms.uW.value = weight
		if (blend !== undefined) mat.blending = blend
		q.mesh.material = mat
		const autoClear = renderer.autoClear
		renderer.autoClear = false
		renderer.setRenderTarget(target)
		renderer.render(q.scene, q.cam)
		renderer.autoClear = autoClear
	}

	/** A chrome ball's export cube map (EXPORT_MIRROR px) and its own clone of the ball's material (made as the canvas makes its own: mirrorEntry), and the smaller
	 *  first-round map (`pre`, the canvas's size) its neighbours see it wearing while their own are made. */
	function exportMirror(g, e) {
		let x = g.mirrors.get(e)
		if (!x) {
			x = chromeCube(e.orig, EXPORT_MIRROR)
			x.pre = chromeCube(e.orig, MIRROR_SIZE)
			g.mirrors.set(e, x)
		}
		return x
	}
	/** The chrome balls' cube maps for the moment the parts stand at now, in the export's own targets (the canvas's stay as they are), in two rounds: first a small map
	 *  of each with every mirror ball in the studio, then the frame's own maps, each made with the other balls wearing their first-round maps, so a ball shows its
	 *  neighbours as chrome (as the canvas, whose neighbours wear their last capture) and not as dull grey. Both rounds depend on the moment alone: what a ball shows
	 *  never depends on what was drawn before. */
	function exportMirrors(g) {
		const list = mirrors.list.filter((e) => e.state === "ready" && e.mesh)
		if (!list.length) return
		for (const e of mirrors.list) if (e.mesh) e.mesh.material = e.orig
		for (const f of mirrors.follow) if (f.mesh) f.mesh.material = f.orig
		const k = refl.k.value
		const bg = scene.background
		const bgI = scene.backgroundIntensity
		const shellOn = shell.visible
		const wallOn = wall.visible
		refl.k.value = 0 // (the table's planar mirror belongs to the main camera: not in a cube face)
		scene.background = envTarget.texture // (the room left out, the studio in its place: as the canvas's chrome)
		scene.backgroundIntensity = 1
		shell.visible = wall.visible = false
		const back = cubeGlass()
		try {
			for (const e of list) captureChrome(e, exportMirror(g, e).pre)
			for (const e of list) e.mesh.material = g.mirrors.get(e).pre.mat
			for (const f of mirrors.follow) {
				const x = f.lead && g.mirrors.get(f.lead)
				if (f.mesh && x) f.mesh.material = x.pre.mat
			}
			for (const e of list) captureChrome(e, g.mirrors.get(e))
		} finally {
			back?.()
			scene.background = bg
			scene.backgroundIntensity = bgI
			shell.visible = shellOn
			wall.visible = wallOn
			refl.k.value = k
		}
		for (const e of list) e.mesh.material = g.mirrors.get(e).mat
		for (const f of mirrors.follow) {
			const x = f.lead && g.mirrors.get(f.lead)
			if (f.mesh && x) f.mesh.material = x.mat
		}
	}
	/** Every mirror ball's material back to what the canvas draws it with. */
	function restoreMirrors() {
		for (const e of mirrors.list) if (e.mesh) e.mesh.material = e.applied ? e.mat : e.orig
		for (const f of mirrors.follow) if (f.mesh) f.mesh.material = f.applied && f.lead ? f.lead.mat : f.orig
	}

	/** Pose everything at moment t and draw the key light's shadow map for it, as the canvas's paused mirror pass draws it (the table, the room and the contact shades
	 *  left out), in a pass that draws nothing else. Every later pass of the frame (cube faces, mirror, picture) uses this one map. */
	function exportPose(g, t) {
		updateParts(t)
		const tm = run.tableMesh
		if (tm) tm.visible = false
		setRoomVisible(false)
		if (run.blobs) run.blobs.visible = false
		renderer.shadowMap.needsUpdate = true
		renderer.setRenderTarget(g.tiny)
		renderer.render(scene, g.nullCam)
		renderer.shadowMap.needsUpdate = false
		setRoomVisible(true)
		cabinet.visible = cabinetWanted && roomWanted
		if (run.blobs) run.blobs.visible = true
		if (tm) tm.visible = tableWanted
	}

	/** How many sub-frames frame t needs: o.blur at least; more (up to o.most) where the image moves so far while the shutter is open that o.blur would show steps
	 *  (BLUR_STEP_PX at most between two); one where nothing in the picture moves at all (then it is the sharp frame). The image motion: the corners of every moving
	 *  body (its reach either way, turned with it, front face) and a grid over the picture, each seen by the camera at the shutter's opening and at its closing. */
	function blurCount(g, t, o, shot) {
		const dur = exportDuration()
		const t0 = Math.max(0, t - o.open / 2)
		const t1 = Math.min(dur, t + o.open / 2)
		if (!(t1 > t0)) return 1
		const A = exportAnalysis()
		const ca = (g.camA ??= new THREE.PerspectiveCamera())
		const cb = (g.camB ??= new THREE.PerspectiveCamera())
		shot.at(t0, ca)
		shot.at(t1, cb)
		const va = _v1
		const vb = _v2
		let px = 0
		const move = (xa, ya, za, xb, yb, zb) => {
			va.set(xa, ya, za).project(ca)
			vb.set(xb, yb, zb).project(cb)
			if (va.z > 1 || vb.z > 1) return // (behind the camera)
			px = Math.max(px, Math.hypot(((vb.x - va.x) * g.W) / 2, ((vb.y - va.y) * g.H) / 2))
		}
		const pa = placementsAt(run.track, t0)
		const pb = placementsAt(run.track, t1)
		for (let j = 0; j < A.m; j++) {
			if (!A.sig[j]) continue
			const id = A.movers[j].id
			const a = pa[id]
			const b = pb[id]
			if (!a || !b) continue
			const e = A.ext[j]
			for (let c = 0; c < 4; c++) {
				const ang = (c * Math.PI) / 2
				move(a.x + e * Math.cos(a.angle + ang), a.y + e * Math.sin(a.angle + ang), A.hz[j], b.x + e * Math.cos(b.angle + ang), b.y + e * Math.sin(b.angle + ang), A.hz[j])
			}
		}
		// the camera's own motion: the points of the machine plane under a 3 x 3 grid of the picture
		ca.updateMatrixWorld()
		for (let i = 0; i < 9; i++) {
			_v3.set((i % 3) - 1, Math.floor(i / 3) - 1, 0.5).unproject(ca).sub(ca.position)
			if (Math.abs(_v3.z) < 1e-9) continue
			const k = -ca.position.z / _v3.z
			if (!(k > 0)) continue
			const x = ca.position.x + _v3.x * k
			const y = ca.position.y + _v3.y * k
			move(x, y, 0, x, y, 0)
		}
		// what moves without being a body: a turning fan or rotor, a running belt, the pull pins sliding out at the release (no shortcut to one sub-frame then)
		const busy = run.spinners.length > 0 || animates(run) || run.doc.solids.some((s) => s.surfaceSpeed) || (run.pins.length > 0 && Math.abs(t - run.tRelease) < 0.1) || (run.gates.length > 0 && t > run.tRelease - 0.02 && t < run.tRelease + 0.2)
		if (px < 0.5 && !busy) return 1
		return Math.min(o.most, Math.max(o.blur, Math.ceil(px / BLUR_STEP_PX)))
	}
	/** Draw one export frame into g.out (top-down rows), then read it into g.img. Restores every state the canvas's picture depends on. */
	function exportDraw(g, t, o, shot) {
		const r = run
		const dur = exportDuration()
		const prevRt = renderer.getRenderTarget()
		const autoClear = renderer.autoClear
		const panes = r.panes.filter((pn) => pn.mesh.visible) // (a selected item's see-through walls: the app's marking, not the scene)
		const tex = reflUniforms.tReflect.value
		const mtx = reflUniforms.uReflMatrix.value
		const full = reflTex.full
		const base = reflTex.base
		const k = refl.k.value
		try {
			for (const pn of panes) pn.mesh.visible = false
			reflUniforms.tReflect.value = g.refl.texture
			reflUniforms.uReflMatrix.value = g.matrix
			refl.k.value = refl.enabled ? 1 : 0 // (setOptions({reflections: false}) turns the table's mirror off in exports too)
			const N = o.blur > 1 ? blurCount(g, t, o, shot) : 1
			xstats.blurN = N
			// the coils' and chains' detail, for the camera at moment t (as the canvas picks it for its own camera and drawing buffer), before the shadow map is drawn
			updateParts(t)
			shot.at(t, g.cam)
			applyLods(g.cam, g.H)
			exportPose(g, t)
			exportMirrors(g) // (once a frame, at its moment: a sub-frame's ball moves, its picture of the room is the moment's)
			if (N > 1 && !g.acc) {
				g.acc = new THREE.WebGLRenderTarget(g.W, g.H, {
					type: renderer.extensions.has("EXT_float_blend") ? THREE.FloatType : THREE.HalfFloatType,
					minFilter: THREE.NearestFilter,
					magFilter: THREE.NearestFilter,
					generateMipmaps: false,
					depthBuffer: false,
					stencilBuffer: false,
				})
			}
			for (let i = 0; i < N; i++) {
				// motion blur: N moments spread evenly over the open shutter, centred on t (a 180 degree shutter at 60 fps: t - 1/240 .. t + 1/240)
				const ti = N > 1 ? Math.min(dur, Math.max(0, t + ((i + 0.5) / N - 0.5) * o.open)) : t
				if (N > 1) exportPose(g, ti)
				shot.at(ti, g.cam)
				if (refl.enabled) renderReflection(g.cam, false, g.refl, g.matrix, g.reflCam, r.lens > 0 ? (g.reflBase ??= mirrorBase(g.refl)) : null)
				renderer.setRenderTarget(g.rt)
				renderer.render(scene, g.cam)
				if (N > 1) quadPass(g, exportQuad(g).acc, g.rt.texture, g.acc, i === 0 ? THREE.NoBlending : THREE.CustomBlending, 1 / N)
			}
			const q = exportQuad(g)
			if (N > 1) quadPass(g, q.enc, g.acc.texture, g.out)
			else quadPass(g, q.copy, g.rt.texture, g.out)
			let tr = performance.now()
			if (xstats.probe) {
				renderer.readRenderTargetPixels(g.out, 0, 0, 1, 1, g.probe ??= new Uint8Array(4))
				xstats.gpuMs = performance.now() - tr
				tr = performance.now()
			}
			exportRead(g)
			xstats.readMs = performance.now() - tr
		} finally {
			renderer.autoClear = autoClear
			renderer.setRenderTarget(prevRt)
			reflUniforms.tReflect.value = tex
			reflUniforms.uReflMatrix.value = mtx
			reflTex.full = full
			reflTex.base = base
			refl.k.value = k
			for (const pn of panes) pn.mesh.visible = true
			restoreMirrors()
			renderer.shadowMap.needsUpdate = false
			shadowKey = "" // (the shadow map is the export's: the canvas's next draw makes its own)
			if (run === r) updateParts(lastT) // (picking and the editor see the parts where the canvas shows them)
		}
	}

	/** Draw moment t of the run at exactly width x height (see "export" above). Resolves to an OffscreenCanvas (an HTMLCanvasElement without OffscreenCanvas) holding
	 *  the frame, reused by the next call: make the VideoFrame from it before asking for another. Calls are queued (one frame at a time). */
	function renderFrame(t, opts) {
		const job = xp.queue.then(() => renderFrameNow(t, opts))
		xp.queue = job.then(
			() => {},
			() => {},
		)
		return job
	}
	async function renderFrameNow(t, opts) {
		if (disposed) throw new Error("renderFrame: the view is disposed")
		const o = exportOptions(opts)
		const check = () => {
			if (!canExport()) throw new Error("renderFrame: no finished run to export (run the scene first)")
			if (o.runId !== undefined && o.runId !== run.serial) throw new Error(`renderFrame: the scene changed since the export began (runId ${o.runId}, now ${run.serial})`)
		}
		check()
		if (!xp.active) await beginExport()
		if (disposed) throw new Error("renderFrame: the view is disposed")
		check()
		if (!xp.active || run.serial !== xp.serial) throw new Error("renderFrame: the scene changed while the export was starting")
		if (renderer.getContext().isContextLost()) throw new Error("renderFrame: the GPU context was lost")
		clearTimeout(xp.timer)
		xp.timer = setTimeout(endExport, EXPORT_IDLE_MS)
		const t0 = performance.now()
		const g = exportGpu()
		exportTargets(g, o)
		const shot = exportShot(g, o.camera, o.W, o.H)
		const T = Math.min(exportDuration(), Math.max(0, Number.isFinite(t) ? t : 0))
		const t1 = performance.now()
		exportDraw(g, T, o, shot)
		if (renderer.getContext().isContextLost()) throw new Error("renderFrame: the GPU context was lost")
		const t2 = performance.now()
		g.ctx.putImageData(g.img, 0, 0)
		xstats.frames++
		xstats.lastMs = performance.now() - t0
		xstats.split = { prep: t1 - t0, draw: t2 - t1 - xstats.readMs, read: xstats.readMs, put: performance.now() - t2 }
		xstats.ms += xstats.lastMs
		if (o.output === "imagedata") return new ImageData(new Uint8ClampedArray(g.img.data), g.W, g.H)
		return g.canvas
	}

	// ----- export cameras: each a pure function of t (and the track), built once per run, camera and size ------------------------------------------------
	const smoother = (x) => {
		const s = Math.min(1, Math.max(0, x))
		return s * s * s * (s * (s * 6 - 15) + 10)
	}
	/** Catmull-Rom through the samples a[0..n-1] at fractional index u. */
	function curveAt(a, u) {
		const n = a.length
		if (n === 1) return a[0]
		u = Math.min(n - 1, Math.max(0, u))
		const i = Math.min(n - 2, Math.floor(u))
		const f = u - i
		const p0 = a[Math.max(0, i - 1)]
		const p1 = a[i]
		const p2 = a[i + 1]
		const p3 = a[Math.min(n - 1, i + 2)]
		return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
	}
	/** Zero-phase critically damped smoothing of a series sampled at hz: a critically damped spring (natural frequency omega rad/s, solved exactly per step) follows
	 *  it forward, a second one follows that backward. No lag, no overshoot, no jerk. */
	function dampSeries(src, omega, hz) {
		const out = Float64Array.from(src)
		const n = out.length
		if (n < 3) return out
		const dt = 1 / hz
		const e = Math.exp(-omega * dt)
		const pass = (from, to, step) => {
			let x = out[from]
			let v = 0
			for (let i = from + step; i !== to + step; i += step) {
				const y0 = x - out[i]
				const c = v + omega * y0
				x = out[i] + (y0 + c * dt) * e
				v = (v - omega * c * dt) * e
				out[i] = x
			}
		}
		pass(0, n - 1, 1)
		pass(n - 1, 0, -1)
		return out
	}
	/** The largest (max) or smallest value within w samples either side. */
	function slideExtreme(src, w, max) {
		const n = src.length
		const out = new Float64Array(n)
		for (let i = 0; i < n; i++) {
			let v = src[i]
			for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) v = max ? Math.max(v, src[j]) : Math.min(v, src[j])
			out[i] = v
		}
		return out
	}
	/** A Hann-window average over w samples either side. After slideExtreme with the same w it never crosses the original: max -> never below it, min -> never above. */
	function hannSeries(src, w) {
		const n = src.length
		if (w < 1) return Float64Array.from(src)
		const k = new Float64Array(2 * w + 1)
		for (let j = -w; j <= w; j++) k[j + w] = 0.5 * (1 + Math.cos((Math.PI * j) / (w + 1)))
		const out = new Float64Array(n)
		for (let i = 0; i < n; i++) {
			let s = 0
			let ws = 0
			for (let j = -w; j <= w; j++) {
				const ii = i + j
				if (ii < 0 || ii >= n) continue
				s += src[ii] * k[j + w]
				ws += k[j + w]
			}
			out[i] = s / ws
		}
		return out
	}
	/** Is every point (x, y, z triples) inside a picture of aspect asp and horizontal field hfov, less margins m {side, top, bottom} (fractions), seen from P looking at T (up +y)? */
	function shotTester(asp, hfov) {
		const tanH = Math.tan(hfov / 2)
		const tanV = tanH / asp
		return (P, T, pts, m) => {
			let fx = T[0] - P[0]
			let fy = T[1] - P[1]
			let fz = T[2] - P[2]
			const fl = Math.hypot(fx, fy, fz)
			fx /= fl
			fy /= fl
			fz /= fl
			let rx = -fz // right = forward x up
			let rz = fx
			const rl = Math.hypot(rx, rz)
			rx /= rl
			rz /= rl
			const ux = -rz * fy // up = right x forward
			const uy = rz * fx - rx * fz
			const uz = rx * fy
			const x0 = -1 + 2 * m.side
			const x1 = 1 - 2 * m.side
			const y0 = -1 + 2 * m.bottom
			const y1 = 1 - 2 * m.top
			for (let i = 0; i < pts.length; i += 3) {
				const vx = pts[i] - P[0]
				const vy = pts[i + 1] - P[1]
				const vz = pts[i + 2] - P[2]
				const z = vx * fx + vy * fy + vz * fz
				if (z < 0.05) return false
				const sx = (vx * rx + vz * rz) / (z * tanH)
				const sy = (vx * ux + vy * uy + vz * uz) / (z * tanV)
				if (sx < x0 || sx > x1 || sy < y0 || sy > y1) return false
			}
			return true
		}
	}
	function setPose(cam, px, py, pz, tx, ty, tz, hfov, asp) {
		cam.position.set(px, py, pz)
		cam.up.set(0, 1, 0)
		cam.lookAt(tx, ty, tz)
		cam.aspect = asp
		cam.fov = vfovFor(hfov, asp)
		cam.near = 0.02
		cam.far = 80
		cam.updateProjectionMatrix()
		cam.updateMatrixWorld()
	}

	/** The run's motion for the moving cameras (once per run): the movers (dynamic bodies, welded parts with their root, that really move: 5 cm or 0.3 rad), their poses at
	 *  60 Hz, sizes, the step each starts moving (2 cm or 0.08 rad), how fast each goes (a turning body's rim counts), and the impacts mapped to them. All from the track. */
	function exportAnalysis() {
		if (run.xa) return run.xa
		const HZ = 60
		const doc = run.doc
		const track = run.track
		const dur = exportDuration()
		const n = Math.max(2, Math.ceil(dur * HZ - 1e-9) + 1)
		const byId = new Map(doc.solids.map((s) => [s.id, s]))
		const rootOf = (s) => {
			let r = s
			for (let i = 0; i < 8 && r.parent && !r.pivot && byId.has(r.parent); i++) r = byId.get(r.parent)
			return r
		}
		const movers = doc.solids.filter((s) => s.kind === "dynamic" && !s.hidden_3d && !(s.parent && !s.pivot))
		const m = movers.length
		const index = new Map(movers.map((s, j) => [s.id, j]))
		const moverOf = (id) => {
			const s = byId.get(id)
			return s && s.kind === "dynamic" ? (index.get(rootOf(s).id) ?? -1) : -1
		}
		const ext = new Float64Array(m)
		const hz = new Float64Array(m)
		const outline = [] // per mover: its side outline round its origin, [x, y, ...] (a ball: its square; turned with the body except a ball's)
		movers.forEach((s, j) => {
			const b = s.body
			let pts
			if (b.kind === "ball") pts = [-b.radius, -b.radius, b.radius, -b.radius, b.radius, b.radius, -b.radius, b.radius]
			else if (b.kind === "polygon") pts = b.points.flatMap((p) => [p.x, p.y])
			else {
				const hw = ((b.width ?? 0.05) / 2) * Math.max(1, b.taper ?? 1)
				const hh = (b.height ?? 0.05) / 2
				pts = [-hw, -hh, hw, -hh, hw, hh, -hw, hh]
			}
			outline.push(Float64Array.from(pts))
			let e = 0
			for (let i = 0; i < pts.length; i += 2) e = Math.max(e, Math.hypot(pts[i], pts[i + 1]))
			ext[j] = b.kind === "ball" ? b.radius : e
			hz[j] = (b.kind === "ball" ? (s.depth3d ?? (s.shape === "cylinder" ? 4 : 2) * b.radius) : depthOf(b)) / 2
		})
		const pos = new Float64Array(n * m * 3)
		const f0 = track.frames[0].placements
		for (let k = 0; k < n; k++) {
			const p = placementsAt(track, Math.min(dur, k / HZ))
			for (let j = 0; j < m; j++) {
				const s = movers[j]
				const q = p[s.id] ?? f0[s.id] ?? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 }
				const i = (k * m + j) * 3
				pos[i] = q.x
				pos[i + 1] = q.y
				pos[i + 2] = q.angle
			}
		}
		const spd = new Float64Array(n * m)
		const sig = new Uint8Array(m)
		const act = new Float64Array(m).fill(Infinity)
		for (let j = 0; j < m; j++) {
			for (let k = 0; k < n; k++) {
				const a = Math.max(0, k - 1)
				const b = Math.min(n - 1, k + 1)
				const ia = (a * m + j) * 3
				const ib = (b * m + j) * 3
				const span = (b - a) / HZ
				spd[k * m + j] = (Math.hypot(pos[ib] - pos[ia], pos[ib + 1] - pos[ia + 1]) + Math.abs(pos[ib + 2] - pos[ia + 2]) * ext[j]) / span
				const i = (k * m + j) * 3
				const disp = Math.hypot(pos[i] - pos[j * 3], pos[i + 1] - pos[j * 3 + 1])
				const rot = Math.abs(pos[i + 2] - pos[j * 3 + 2])
				if (disp > 0.05 || rot > 0.3) sig[j] = 1
				if (act[j] === Infinity && (disp > 0.02 || rot > 0.08)) act[j] = k
			}
			if (!sig[j]) act[j] = Infinity
		}
		const imps = []
		for (const im of track.impacts ?? []) {
			if (!(im.t >= 0 && im.t <= dur) || !(im.speed >= 0.12)) continue
			const ia = moverOf(im.a)
			const ib = moverOf(im.b)
			if (!(ia >= 0 && sig[ia]) && !(ib >= 0 && sig[ib])) continue
			const p = placementsAt(track, im.t)
			let x = 0
			let y = 0
			let c = 0
			for (const id of [im.a, im.b]) {
				if (byId.get(id)?.kind !== "dynamic" || !p[id]) continue
				x += p[id].x
				y += p[id].y
				c++
			}
			if (c) imps.push({ t: im.t, ia: ia >= 0 && sig[ia] ? ia : -1, ib: ib >= 0 && sig[ib] ? ib : -1, x: x / c, y: y / c, speed: im.speed })
		}
		imps.sort((a, b) => a.t - b.t)
		run.xa = { HZ, n, dur, m, movers, pos, spd, ext, hz, outline, sig, act, imps }
		return run.xa
	}
	/** Push mover j's outline at sample k (where it stands, turned as it is), at its front and back faces: x, y, z triples. */
	function moverCorners(A, out, j, k) {
		const i = (Math.min(A.n - 1, Math.max(0, k)) * A.m + j) * 3
		const x = A.pos[i]
		const y = A.pos[i + 1]
		const ball = A.movers[j].body.kind === "ball"
		const c = ball ? 1 : Math.cos(A.pos[i + 2])
		const sn = ball ? 0 : Math.sin(A.pos[i + 2])
		const o = A.outline[j]
		const z = A.hz[j]
		for (let p = 0; p < o.length; p += 2) {
			const px = x + o[p] * c - o[p + 1] * sn
			const py = y + o[p] * sn + o[p + 1] * c
			out.push(px, py, z, px, py, -z)
		}
	}
	/** The distance (dMin .. dMax) a camera at (cx, cy + lift d, d) looking at (cx, cy, 0) needs to hold every point inside margins m. */
	function needDistance(fits, cx, cy, lift, pts, m, dMin, dMax) {
		const P = [cx, 0, 0]
		const T = [cx, cy, 0]
		const ok = (d) => {
			P[1] = cy + lift * d
			P[2] = d
			return fits(P, T, pts, m)
		}
		if (!pts.length || ok(dMin)) return dMin
		if (!ok(dMax)) return dMax
		let lo = Math.log(dMin)
		let hi = Math.log(dMax)
		for (let i = 0; i < 24; i++) {
			const mid = (lo + hi) / 2
			if (ok(Math.exp(mid))) hi = mid
			else lo = mid
		}
		return Math.exp(hi)
	}
	const boundsOf = (pts) => {
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			x0 = Math.min(x0, pts[i])
			x1 = Math.max(x1, pts[i])
			y0 = Math.min(y0, pts[i + 1])
			y1 = Math.max(y1, pts[i + 1])
		}
		return [x0, x1, y0, y1]
	}
	const bboxCentre = (pts) => {
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			x0 = Math.min(x0, pts[i])
			x1 = Math.max(x1, pts[i])
			y0 = Math.min(y0, pts[i + 1])
			y1 = Math.max(y1, pts[i + 1])
		}
		return [(x0 + x1) / 2, (y0 + y1) / 2]
	}
	/** A shot that follows a smooth path of (cx, cy, log d) samples at hz: camera at (cx, cy + lift d, d) looking at (cx, cy, 0). */
	function pathShot(kind, hz, sx, sy, sd, lift, hfov, asp, extra = {}) {
		return {
			kind,
			hz,
			series: { x: sx, y: sy, logD: sd },
			...extra,
			at(t, cam) {
				const u = t * hz
				const x = curveAt(sx, u)
				const y = curveAt(sy, u)
				const d = Math.exp(curveAt(sd, u))
				setPose(cam, x, y + lift * d, d, x, y, 0, hfov, asp)
			},
		}
	}
	function staticShot(kind, px, py, pz, tx, ty, tz, hfov, asp) {
		return { kind, at: (t, cam) => setPose(cam, px, py, pz, tx, ty, tz, hfov, asp) }
	}
	/** A scene's fixed camera c = doc.view.camera {x0, x1, y, pitch, hfov} (machines/mod_staging.py) as a pose: d = (x1 - x0) / 2 / tan(hfov / 2) in front of
	 *  the machine plane (z = d), at the height y + d tan(pitch), looking at ((x0 + x1) / 2, y, 0) with +y up and a horizontal field of hfov degrees: at pitch 0
	 *  the plane spans exactly x0..x1 across the picture at height y (its centre line); tilted, 1 / cos(pitch) of that. Nothing else goes into it, so every run
	 *  with the same c is filmed from the same place: lanes run apart line up pixel for pixel. (lesson-regen/compositor/camera.py camera_pose, cy = y.) */
	function fixedPose(c) {
		const hfov = THREE.MathUtils.degToRad(c.hfov)
		const d = (c.x1 - c.x0) / 2 / Math.tan(hfov / 2)
		const tx = (c.x0 + c.x1) / 2
		return { tx, ty: c.y, px: tx, py: c.y + d * Math.tan(THREE.MathUtils.degToRad(c.pitch)), pz: d, d, hfov, near: Math.max(0.02, Math.min(0.5, d / 200)), far: Math.max(80, 4 * d) }
	}
	function fixedShot(kind, c, W, H) {
		const f = fixedPose(c)
		return {
			kind,
			fixed: { ...c },
			at(t, cam) {
				setPose(cam, f.px, f.py, f.pz, f.tx, f.ty, 0, f.hfov, W / H)
				cam.near = f.near
				cam.far = f.far
				cam.updateProjectionMatrix()
			},
		}
	}

	/** 'wide': the wide shot, fitted to this picture (no buttons over it); the scene's fixed camera when it has one (doc.view.camera). */
	function wideShot(W, H) {
		if (run.doc.view?.camera) return fixedShot("wide", run.doc.view.camera, W, H)
		const w = fitWide(exportFrameOf(run), W, H, XWIDE.top * H)
		return staticShot("wide", w.tx, w.ty + WIDE_PITCH * w.d, w.d, w.tx, w.ty, 0, HFOV_26MM, W / H)
	}
	/** 'orbit': a slow arc (8 degrees a second of the run, 30 to 60 in all, eased at both ends) round the wide shot's target, at the wide distance or as much farther as
	 *  keeps all of the machine in the picture at every angle. */
	function orbitShot(W, H) {
		const asp = W / H
		const fits = shotTester(asp, HFOV_26MM)
		const spec = exportFrameOf(run)
		const w = fitWide(spec, W, H, XWIDE.top * H)
		const dur = exportDuration()
		const arc = THREE.MathUtils.degToRad(Math.min(60, Math.max(30, 8 * dur)))
		const m = { side: XWIDE.side * 0.8, top: XWIDE.top * 0.8, bottom: XWIDE.bottom * 0.8 }
		const T = [w.tx, w.ty, 0]
		const P = [0, 0, 0]
		const ok = (R, phi) => {
			P[0] = w.tx + R * Math.sin(phi)
			P[1] = w.ty + WIDE_PITCH * R
			P[2] = R * Math.cos(phi)
			return fits(P, T, spec.pts, m)
		}
		let R = w.d
		for (let i = 0; i <= 30; i++) {
			const phi = -arc / 2 + (arc * i) / 30
			if (ok(R, phi)) continue
			let lo = R
			let hi = R * 1.25
			for (let j = 0; j < 20 && !ok(hi, phi); j++) {
				lo = hi
				hi *= 1.25
			}
			for (let j = 0; j < 30; j++) {
				const mid = (lo + hi) / 2
				if (ok(mid, phi)) hi = mid
				else lo = mid
			}
			R = hi
		}
		R *= 1.005
		return {
			kind: "orbit",
			arc,
			radius: R,
			at(t, cam) {
				const s = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0
				const phi = -arc / 2 + (arc * (1 - Math.cos(Math.PI * s))) / 2
				setPose(cam, w.tx + R * Math.sin(phi), w.ty + WIDE_PITCH * R, R * Math.cos(phi), w.tx, w.ty, 0, HFOV_26MM, asp)
			},
		}
	}
	/** 'follow': a 35 mm camera on the action. At each 1/60 s: the lead (the body that began moving most recently, with any that began within 50 ms of it), where it
	 *  is going (0.3 s on), what it is about to hit (its next two impacts within 0.8 s: both bodies, now and at the impact), and whatever moves faster than 25 cm/s
	 *  within 40 cm of it. The centre of that is smoothed with a
	 *  zero-phase critically damped spring; the distance is what holds all of it in the picture around the SMOOTHED centre, held 0.6 s either side and eased, so the
	 *  camera never cuts it off and never jerks. Between the whole machine (the wide extent in this lens) and 45 cm. */
	function followShot(W, H) {
		const A = exportAnalysis()
		const { HZ, n, m, sig, act, imps } = A
		const asp = W / H
		const hfov = HFOV_35MM
		const fits = shotTester(asp, hfov)
		const lift = FOLLOW_LIFT / FOLLOW_DIST
		const mg = { side: 0.1, top: 0.12, bottom: 0.12 }
		const whole = fitWide(exportFrameOf(run), W, H, XWIDE.top * H, hfov)
		const dMax = Math.max(0.6, whole.d)
		const dMin = Math.min(0.45, dMax)
		if (!sig.some((v) => v)) return staticShot("follow", whole.tx, whole.ty + WIDE_PITCH * whole.d, whole.d, whole.tx, whole.ty, 0, hfov, asp)
		const sets = new Array(n)
		const cx = new Float64Array(n)
		const cy = new Float64Array(n)
		const ahead = Math.round(0.3 * HZ)
		for (let k = 0; k < n; k++) {
			const tau = k / HZ
			let best = -1
			for (let j = 0; j < m; j++) if (sig[j] && act[j] <= k && (best < 0 || act[j] > act[best])) best = j
			if (best < 0) for (let j = 0; j < m; j++) if (sig[j] && (best < 0 || act[j] < act[best])) best = j // (nothing moves yet: the first that will)
			const G = []
			for (let j = 0; j < m; j++) if (sig[j] && Math.abs(act[j] - act[best]) <= 3 && (act[j] <= k || act[best] > k)) G.push(j)
			const pts = []
			for (const j of G) {
				moverCorners(A, pts, j, k)
				moverCorners(A, pts, j, k + ahead)
			}
			// action right beside it (a swinging wrecking ball by the bricks it knocked down): what moves faster than 25 cm/s within 40 cm of the lead
			const [gx0, gx1, gy0, gy1] = boundsOf(pts)
			for (let j = 0; j < m; j++) {
				if (!sig[j] || G.includes(j) || A.spd[k * m + j] < 0.25) continue
				const i = (k * m + j) * 3
				const gap = Math.max(gx0 - A.pos[i], A.pos[i] - gx1, gy0 - A.pos[i + 1], A.pos[i + 1] - gy1, 0) - A.ext[j]
				if (gap < 0.4) moverCorners(A, pts, j, k)
			}
			let c = 0
			for (const im of imps) {
				if (im.t <= tau) continue
				if (im.t > tau + 0.8) break
				if (!G.includes(im.ia) && !G.includes(im.ib)) continue
				const ki = Math.round(im.t * HZ)
				for (const jj of [im.ia, im.ib]) {
					if (jj < 0) continue
					moverCorners(A, pts, jj, ki)
					moverCorners(A, pts, jj, k)
				}
				if (++c >= 2) break
			}
			sets[k] = Float64Array.from(pts)
			;[cx[k], cy[k]] = bboxCentre(sets[k])
		}
		const sx = dampSeries(cx, 4.5, HZ)
		const sy = dampSeries(cy, 4.5, HZ)
		for (let k = 0; k < n; k++) sy[k] = Math.max(0, sy[k])
		// (keeping it all in may take the camera past the whole machine's distance for a moment, while the centre is still on its way: up to 1.6 x that)
		const need = new Float64Array(n)
		for (let k = 0; k < n; k++) need[k] = Math.log(needDistance(fits, sx[k], sy[k], lift, sets[k], mg, dMin, 1.6 * dMax))
		const w = Math.round(0.6 * HZ)
		const sd = hannSeries(slideExtreme(need, w, true), w)
		// (is everything the camera keeps at sample k inside the picture, edge to edge, on paths x, y, logD?)
		const edge = { side: 0, top: 0, bottom: 0 }
		const inside = (k, x, y, ld) => {
			const d = Math.exp(ld)
			return fits([x, y + lift * d, d], [x, y, 0], sets[k], edge)
		}
		// Still at the start: the smoothing (which looks ahead) would set the camera moving at once. It holds until 0.35 s before the first thing moves, framing
		// everything it must hold by the end of its ease into the path (smootherstep over 0.6 s: no jump in speed); where that cannot hold everything the hold
		// ends earlier (the camera then moves from the start, as the action needs).
		let first = Infinity
		for (let j = 0; j < m; j++) if (sig[j]) first = Math.min(first, act[j])
		const b = Math.round(0.6 * HZ)
		for (let kh = Math.min(n - 1, Math.round(first - 0.35 * HZ)); kh > 0; kh -= 6) {
			const end = Math.min(n - 1, kh + b)
			const union = []
			for (let k = 0; k <= end; k++) for (const v of sets[k]) union.push(v)
			const hd = Math.max(sd[kh], Math.log(needDistance(fits, sx[kh], sy[kh], lift, union, mg, dMin, 1.6 * dMax)))
			const hx = Float64Array.from(sx)
			const hy = Float64Array.from(sy)
			const hl = Float64Array.from(sd)
			holdStart([hx, hy, hl], kh, b, [sx[kh], sy[kh], hd])
			let ok = true
			for (let k = 0; k <= end && ok; k++) ok = inside(k, hx[k], hy[k], hl[k])
			if (!ok) continue
			sx.set(hx)
			sy.set(hy)
			sd.set(hl)
			break
		}
		const contains = (k) => inside(k, sx[k], sy[k], sd[k])
		return pathShot("follow", HZ, sx, sy, sd, lift, hfov, asp, { contains })
	}
	/** Hold paths (arrays of samples) at `held` (default: their values at sample kh) until kh, then ease from it into the path over b samples:
	 *  p' = h + (p - h) smootherstep((k - kh) / b), so the speed starts from nothing and joins the path's own without a jump. */
	function holdStart(paths, kh, b, held) {
		if (!(kh > 0)) return
		paths.forEach((a, i) => {
			const h = held ? held[i] : a[Math.min(kh, a.length - 1)]
			for (let k = 0; k < Math.min(a.length, kh + b); k++) a[k] = k <= kh ? h : h + (a[k] - h) * smoother((k - kh) / b)
		})
	}
	/** 'director': holds the wide shot, then (when the action is somewhere clearly smaller than the machine) eases in toward the region where the next impacts happen
	 *  and back out. The region at each 1/60 s: the impacts from 0.4 s ago to 1.2 s ahead, with the bodies they involve as they stand now (smoothed like follow's).
	 *  The timing: the wide shot for the first ~1 s; moves (eases in and out, smootherstep) of 0.9 to 1.6 s; no two moves start less than 1.5 s apart; back to wide
	 *  for the last moments. The camera travels a straight dolly line between the two shots (the centre moves with the distance), and the close shot is no closer
	 *  than keeps the picture's fastest motion under DIRECTOR_PEAK, with the region it closes in on near the middle of the picture (else it stays wide). It never loses the action: everything moving faster than 20 cm/s (that the wide
	 *  shot holds) and every impact within 0.1 s stays in the picture; where the close shot would leave some out it eases back toward wide (a limit held 0.75 s
	 *  either side and eased, so no faster than the rest). */
	function directorShot(W, H) {
		const A = exportAnalysis()
		const { HZ, n, m, sig, spd, imps, dur } = A
		const asp = W / H
		const hfov = HFOV_26MM
		const fits = shotTester(asp, hfov)
		const p = WIDE_PITCH
		const spec = exportFrameOf(run)
		const w = fitWide(spec, W, H, XWIDE.top * H)
		const lw = Math.log(w.d)
		const tanH = Math.tan(hfov / 2)
		const tanV = tanH / asp
		const wide = { ...staticShot("director", w.tx, w.ty + p * w.d, w.d, w.tx, w.ty, 0, hfov, asp), segments: [], mag: 1, peak: 0 }
		const mg = { side: 0.1, top: 0.12, bottom: 0.12 }
		// the timing (seconds): the wide shot first, eases, the shortest hold, the wide shot last
		const E = Math.min(1.3, Math.max(0.9, 0.2 * dur))
		const OPEN = Math.min(1.6, Math.max(0.7, 0.15 * dur))
		const END = Math.min(1, Math.max(0.3, 0.08 * dur))
		const HOLD = Math.max(0.7, 1.5 - E) // (a move and the hold after it: at least 1.5 s before the next move starts)
		// the action that must stay in: what moves faster than 20 cm/s and the impacts within 0.1 s (what even the wide shot cannot hold is left out: off the table)
		const am = { side: 0.03, top: 0.03, bottom: 0.03 }
		const edge = { side: 0, top: 0, bottom: 0 }
		const WP = [w.tx, w.ty + p * w.d, w.d]
		const WT = [w.tx, w.ty, 0]
		const action = new Array(n)
		const actionPts = (k) => {
			if (action[k]) return action[k]
			const tau = k / HZ
			const pts = []
			const one = []
			for (let j = 0; j < m; j++) {
				if (!sig[j] || spd[k * m + j] < 0.2) continue
				one.length = 0
				moverCorners(A, one, j, k)
				if (fits(WP, WT, one, am)) pts.push(...one)
			}
			for (const im of imps) {
				if (im.t < tau - 0.1) continue
				if (im.t > tau + 0.1) break
				one.length = 0
				for (let c = 0; c < 4; c++) one.push(im.x + (c & 1 ? 0.03 : -0.03), im.y + (c & 2 ? 0.03 : -0.03), 0)
				if (fits(WP, WT, one, am)) pts.push(...one)
			}
			return (action[k] = pts)
		}
		const path = (mag, slack) => {
			const dMin = Math.max(Math.min(0.5, w.d), w.d / mag)
			// 1. the region where the next impacts happen
			const fx = new Float64Array(n)
			const fy = new Float64Array(n)
			const fd = new Float64Array(n)
			const valid = new Uint8Array(n)
			const rx = new Float64Array(n) // (where the region's centre really is: for judging the close shot's composition)
			for (let k = 0; k < n; k++) {
				const tau = k / HZ
				const pts = []
				for (const im of imps) {
					if (im.t < tau - 0.4) continue
					if (im.t > tau + 1.2) break
					const ki = Math.round(im.t * HZ)
					for (const jj of [im.ia, im.ib]) {
						if (jj < 0) continue
						moverCorners(A, pts, jj, ki)
						moverCorners(A, pts, jj, k)
					}
				}
				if (!pts.length) continue
				valid[k] = 1
				;[fx[k], fy[k]] = bboxCentre(pts)
				rx[k] = fx[k]
				fd[k] = Math.log(needDistance(fits, fx[k], fy[k], p, pts, mg, dMin, w.d))
				// a punch-in within the wide shot: the close frame stays inside the wide one but for `slack` of its own half (the move is mostly a zoom toward a point
				// of the picture, not a pan beyond it)
				for (let it = 0; it < 4; it++) {
					const d = Math.exp(fd[k])
					const mx = Math.max(0, tanH * (w.d - d + slack * d))
					const my = Math.max(0, tanV * (w.d - d))
					const cx = Math.min(w.tx + mx, Math.max(w.tx - mx, fx[k]))
					const cy = Math.min(w.ty + my, Math.max(w.ty - my, fy[k]))
					if (cx === fx[k] && cy === fy[k]) break
					fx[k] = cx
					fy[k] = cy
					fd[k] = Math.log(needDistance(fits, cx, cy, p, pts, mg, dMin, w.d))
				}
			}
			if (!valid.some((v) => v)) return null
			// (no region between two: the way from the one to the other; before the first and after the last: theirs. The focus never jumps.)
			let prev = -1
			for (let k = 0; k <= n; k++) {
				if (k < n && !valid[k]) continue
				const from = prev >= 0 ? prev : k
				const to = k < n ? k : prev
				for (let i = prev + 1; i < Math.min(k, n); i++) {
					const u = to === from ? 0 : (i - from) / (to - from)
					fx[i] = fx[from] + (fx[to] - fx[from]) * u
					fy[i] = fy[from] + (fy[to] - fy[from]) * u
					fd[i] = fd[from] + (fd[to] - fd[from]) * u
				}
				prev = k
			}
			const sx = dampSeries(fx, 3, HZ)
			const sy = dampSeries(fy, 3, HZ)
			const sd = dampSeries(fd, 3, HZ)
			// 2. when to be in: where the region is clearly tighter than the wide shot, shaped into moves no faster than ~1.5 s apart
			let segs = []
			for (let k = 0; k < n; k++) {
				if (!(valid[k] && fd[k] < lw + Math.log(0.72))) continue
				const a = k / HZ
				while (k + 1 < n && valid[k + 1] && fd[k + 1] < lw + Math.log(0.72)) k++
				segs.push({ a, b: k / HZ })
			}
			const latest = dur - END - E // (the last moment an ease out may start)
			const shape = (list) => {
				const out = []
				for (const sg0 of list) {
					const sg = { a: Math.max(sg0.a, OPEN), b: Math.min(sg0.b, latest), until: sg0.until ?? sg0.b }
					// a hold too short is lengthened (lingering on what just happened) when the camera gets there while the action is still on, and it fits
					if (sg.b - (sg.a + E) < HOLD && sg.a + E <= sg.until) sg.b = Math.min(latest, sg.a + E + HOLD)
					const last = out[out.length - 1]
					if (last && sg.a < last.b + E + HOLD) {
						last.b = Math.max(last.b, sg.b) // (too soon to go out and in again: stay in)
						last.until = Math.max(last.until, sg.until)
					} else out.push(sg)
				}
				const kept = out.filter((sg) => sg.b - (sg.a + E) >= HOLD - 1e-9)
				// the way out takes the time there is before the next move (or the closing wide shot), up to 1.8 s: slower is calmer
				kept.forEach((sg, i) => {
					const room = (i + 1 < kept.length ? kept[i + 1].a - HOLD : dur - END) - sg.b
					sg.out = Math.min(1.8, Math.max(E, room))
				})
				return kept
			}
			const zOf = (list) => {
				const z = new Float64Array(n)
				for (let k = 0; k < n; k++) {
					const tau = k / HZ
					let v = 0
					for (const sg of list) {
						if (tau < sg.a || tau > sg.b + sg.out) continue
						v = Math.max(v, tau < sg.a + E ? smoother((tau - sg.a) / E) : tau <= sg.b ? 1 : 1 - smoother((tau - sg.b) / sg.out))
					}
					z[k] = v
				}
				return z
			}
			segs = shape(segs)
			if (!segs.length) return null
			let z = zOf(segs)
			// the pose a share zz of the way in: the distance eased in log (the scale changes evenly), the centre in step with the distance (a straight dolly line)
			const at = (k, zz, out) => {
				const ld = lw + (sd[k] - lw) * zz
				const dF = Math.exp(sd[k])
				const g = w.d - dF > 1e-6 ? (w.d - Math.exp(ld)) / (w.d - dF) : zz
				out[0] = w.tx + (sx[k] - w.tx) * g
				out[1] = w.ty + (sy[k] - w.ty) * g
				out[2] = ld
				return out
			}
			const q = [0, 0, 0]
			const inside = (k, c, pts, mm) => {
				const d = Math.exp(c[2])
				return fits([c[0], c[1] + p * d, d], [c[0], c[1], 0], pts, mm)
			}
			// 3. never lose the action: at each moment, the share of the way in that still holds it (1: all of it)
			const ratioOf = (z) => {
				const ratio = new Float64Array(n).fill(1)
				for (let k = 0; k < n; k++) {
					if (z[k] <= 0) continue
					const pts = actionPts(k)
					if (!pts.length || inside(k, at(k, z[k], q), pts, am)) continue
					let lo = 0
					let hi = z[k]
					for (let i = 0; i < 20; i++) {
						const mid = (lo + hi) / 2
						if (inside(k, at(k, mid, q), pts, am)) lo = mid
						else hi = mid
					}
					ratio[k] = lo / z[k]
				}
				return ratio
			}
			let ratio = ratioOf(z)
			// a move in that the action would turn back half way (a ball still flying in from afar) starts once it would not: just after the last such moment
			for (let pass = 0; pass < 4; pass++) {
				let moved = false
				const next = []
				for (const sg of segs) {
					let lastBad = -1
					for (let k = Math.round(sg.a * HZ); k <= Math.min(n - 1, Math.round((sg.a + E + HOLD) * HZ)); k++) if (ratio[k] < 0.9) lastBad = k
					if (lastBad >= 0) {
						moved = true
						next.push({ ...sg, a: lastBad / HZ + 0.1 })
					} else next.push(sg)
				}
				if (!moved) break
				segs = shape(next)
				if (!segs.length) return null
				z = zOf(segs)
				ratio = ratioOf(z)
			}
			const wl = Math.round(0.75 * HZ)
			const lim = hannSeries(slideExtreme(ratio, wl, false), wl)
			const ox = new Float64Array(n)
			const oy = new Float64Array(n)
			const od = new Float64Array(n)
			const zf = new Float64Array(n)
			for (let k = 0; k < n; k++) {
				zf[k] = z[k] * Math.min(1, lim[k])
				at(k, zf[k], q)
				ox[k] = q[0]
				oy[k] = q[1]
				od[k] = q[2]
			}
			const { peak, at: peakAt } = peakImageSpeed(n, HZ, asp, hfov, (k, P, T) => {
				const d = Math.exp(od[k])
				P[0] = ox[k]
				P[1] = oy[k] + p * d
				P[2] = d
				T[0] = ox[k]
				T[1] = oy[k]
				T[2] = 0
			})
			// composition: once in (nearly) all the way, how far off the picture's centre the region's own centre sits, in half-widths
			let off = 0
			for (let k = 0; k < n; k++) if (zf[k] >= 0.95 && valid[k]) off = Math.max(off, Math.abs(rx[k] - ox[k]) / (tanH * Math.exp(od[k])))
			const contains = (k) => inside(k, [ox[k], oy[k], od[k]], actionPts(k), edge)
			return { ox, oy, od, zf, segs, peak, peakAt, off, mag, slack, contains }
		}
		// the closest that stays calm: from what the eases allow (the scale changing at most 1.5 / s at their fastest, 2.5 x at most), less until the picture's
		// fastest motion is under DIRECTOR_PEAK; a close shot that cannot be had calmly is not had (the wide shot holds)
		// (tighter first; as tight, the subject more nearly centred: the close frame overhanging the wide one by up to half its own half-width)
		let r = null
		const tries = []
		search: for (let mag = Math.min(2.5, Math.exp((1.5 * E) / 1.875)); mag > 1.39; mag = 1 + (mag - 1) * 0.8) {
			for (const slack of [0.5, 0.25, 0]) {
				const c = path(mag, slack)
				tries.push(c ? { mag: +mag.toFixed(3), slack, peak: Math.round(c.peak), off: +c.off.toFixed(2), at: +c.peakAt.toFixed(2), segs: c.segs.map((sg) => [+sg.a.toFixed(2), +sg.b.toFixed(2), +sg.out.toFixed(2)]) } : { mag: +mag.toFixed(3), slack, none: true })
				if (!c) break search // (no close shot at this magnification: none looser either)
				if (c.peak <= DIRECTOR_PEAK && c.off <= 0.55) {
					r = c
					break search
				}
			}
		}
		wide.tries = tries
		if (!r) return wide
		return pathShot("director", HZ, r.ox, r.oy, r.od, p, hfov, asp, { segments: r.segs, z: r.zf, mag: r.mag, slack: r.slack, peak: r.peak, tries, contains: r.contains })
	}
	/** The fastest image motion along a path of poses (pose(k, P, T) fills camera position and target at sample k of n, hz apart), in px/s across a 1920 px picture:
	 *  points of the machine plane under the picture's centre and toward its corners, each seen from the poses either side. -> {peak, at (s)} */
	function peakImageSpeed(n, hz, asp, hfov, pose) {
		const tanH = Math.tan(hfov / 2)
		const tanV = tanH / asp
		const P0 = [0, 0, 0]
		const T0 = [0, 0, 0]
		const P1 = [0, 0, 0]
		const T1 = [0, 0, 0]
		const P = [0, 0, 0]
		const T = [0, 0, 0]
		const ndc = (P, T, x, y, z, out) => {
			let fx = T[0] - P[0]
			let fy = T[1] - P[1]
			let fz = T[2] - P[2]
			const fl = Math.hypot(fx, fy, fz)
			fx /= fl
			fy /= fl
			fz /= fl
			let rx = -fz
			let rz = fx
			const rl = Math.hypot(rx, rz)
			rx /= rl
			rz /= rl
			const ux = -rz * fy
			const uy = rz * fx - rx * fz
			const uz = rx * fy
			const vx = x - P[0]
			const vy = y - P[1]
			const vz = z - P[2]
			const dz = Math.max(1e-6, vx * fx + vy * fy + vz * fz)
			out[0] = (vx * rx + vz * rz) / (dz * tanH)
			out[1] = (vx * ux + vy * uy + vz * uz) / (dz * tanV)
		}
		const a = [0, 0]
		const b = [0, 0]
		let peak = 0
		let at = 0
		for (let k = 1; k < n - 1; k++) {
			pose(k, P, T)
			pose(k - 1, P0, T0)
			pose(k + 1, P1, T1)
			const dist = Math.hypot(P[0] - T[0], P[1] - T[1], P[2] - T[2])
			const hw = 0.8 * dist * tanH
			const hh = 0.8 * dist * tanV
			for (let i = 0; i < 5; i++) {
				const x = T[0] + (i === 0 ? 0 : i & 1 ? hw : -hw)
				const y = T[1] + (i === 0 ? 0 : i & 2 ? hh : -hh)
				ndc(P0, T0, x, y, 0, a)
				ndc(P1, T1, x, y, 0, b)
				const v = (Math.hypot((b[0] - a[0]) * 960, ((b[1] - a[1]) * 960) / asp) * hz) / 2
				if (v > peak) {
					peak = v
					at = k / hz
				}
			}
		}
		return { peak, at }
	}
	/** 'live': the camera the canvas draws with now, held for the whole export (for comparing a frame with the canvas). */
	function liveShot(W, H) {
		const c = activeCamera()
		c.updateMatrixWorld()
		const pos = c.position.clone()
		const q = c.quaternion.clone()
		const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * c.aspect)
		const near = c.near
		const far = c.far
		const asp = W / H
		return {
			kind: "live",
			at(t, cam) {
				cam.position.copy(pos)
				cam.quaternion.copy(q)
				cam.aspect = asp
				cam.fov = vfovFor(hfov, asp)
				cam.near = near
				cam.far = far
				cam.updateProjectionMatrix()
				cam.updateMatrixWorld()
			},
		}
	}
	/** The export's shot for this camera and picture size: renderFrame's and exportProject's are the same object. A path of the run (wide, follow, orbit, director)
	 *  is made once per run; 'live' (the canvas's camera as it is) once per export session (g), else afresh. */
	const xshots = { serial: -1, map: new Map() }
	function exportShot(g, kind, W, H) {
		if (kind === "live") {
			const k = `live|${W}x${H}|${run.serial}`
			let s = g?.shots.get(k)
			if (!s) {
				s = liveShot(W, H)
				g?.shots.set(k, s)
			}
			return s
		}
		if (xshots.serial !== run.serial) {
			xshots.serial = run.serial
			xshots.map.clear()
		}
		const k = `${kind}|${W}x${H}`
		let s = xshots.map.get(k)
		if (!s) {
			s = kind === "follow" ? followShot(W, H) : kind === "orbit" ? orbitShot(W, H) : kind === "director" ? directorShot(W, H) : wideShot(W, H) // (fixed: wideShot is it)
			xshots.map.set(k, s)
		}
		return s
	}
	/** Where the machine-plane point (x, y, 0) m shows across an export's picture at run time t, with this camera and picture size: -1 at the left edge, 1 at the
	 *  right (beyond: off the picture); null when it is behind the camera or no finished run is shown. The export's own shot (as renderFrame draws), so the impact
	 *  sounds can be panned to where each hit is seen (web/export/audio.js panAt). o: {camera (as renderFrame; default 'wide'), width, height (default 1920 x 1080)}.
	 *  null too until the run is settled (whenSettled()): the shots are measured on the finished models. */
	const xproj = { cam: null, v: null }
	function exportProject(t, x, y, o) {
		if (disposed || !canExport() || !isSettled() || !Number.isFinite(x) || !Number.isFinite(y)) return null // (before the models are in, the shots can't be measured yet: whenSettled first)
		const W = Math.round(Number(o?.width ?? 1920))
		const H = Math.round(Number(o?.height ?? 1080))
		if (!(W > 0 && H > 0)) return null
		const kind = EXPORT_CAMERAS.includes(o?.camera) ? o.camera : "wide"
		const shot = exportShot(xg, kind, W, H)
		const cam = (xproj.cam ??= new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 80))
		const v = (xproj.v ??= new THREE.Vector3())
		shot.at(Math.min(exportDuration(), Math.max(0, Number.isFinite(t) ? t : 0)), cam)
		cam.updateMatrixWorld()
		const z = Number.isFinite(o?.z) ? o.z : 0
		v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse)
		if (v.z >= -cam.near) return null
		v.set(x, y, z).project(cam)
		if (o?.xy) return Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null // (both: -1 at the left / bottom edge, 1 at the right / top)
		return Number.isFinite(v.x) ? v.x : null
	}

	// debugging handle for dev pages
	const api = { load, render, setOptions, resize, dispose, pick, surfaceAt, setHighlight, toWorld, toScreen, pxPerMeter, setEditing, frame, setQuality, getQuality, whenSettled, renderFrame, exportInfo, endExport, exportProject }
	{
		const q = new URLSearchParams(location.search).get("quality") // (a page can be opened with ?quality=high|medium|low|auto)
		setQuality(["auto", "high", "medium", "low"].includes(q) ? q : "auto")
	}
	Object.defineProperty(api, "_debug", {
		value: {
			THREE,
			scene,
			renderer,
			key,
			get run() {
				return run
			},
			get controls() {
				return controls
			},
			wideCam,
			followCam,
			orbitCam,
			refl,
			stats,
			get lastFrame() {
				return lastFrame
			},
			get flow() {
				return { flowN, flowMs, reflOff, reflStale, reflValid, dirty }
			},
			matCache,
			geoCache,
			patterns: PATTERNS,
			/** Resolves once every stand-in of the run on screen is replaced by its model and the wood grain is drawn (at once for a load that built everything). */
			settled: () => new Promise((resolve) => (isSettled() ? resolve() : J.settled.push(resolve))),
			get progress() {
				return { left: run?.left ?? 0, queued: run?.jobs.length ?? 0, ready: run?.ready.length ?? 0, compiling: J.compiling, grainWaiting: grainWait.size, buildMs: J.ema }
			},
			get mirrors() {
				return { count: mirrors.list.length, applied: mirrors.list.filter((e) => e.applied).length, state: mirrors.list.map((e) => e.state), ms: mirrors.ms, captures: mirrors.captures, faces: mirrors.faces, dirty: mirrors.dirty, targets: mirrors.list.map((e) => e.rt) }
			},
			get quality() {
				return { ...getQuality(), ceiling: Q.ceiling, softwareGL, gpuName, adapt: { ...adapt, costs: adapt.costs.map((c) => c.ms) }, pixelRatio: renderer.getPixelRatio(), shadowMap: key.shadow.mapSize.x }
			},
			setRestFix(on) {
				restFix = !!on
				if (run) settleStatics(run)
				dirty = true
			},
			/** The export: its state, and any camera's shot for a picture size (shot.at(t, cam) poses a camera; follow and director carry their sampled path). */
			export: {
				get state() {
					return { active: xp.active, serial: xp.serial, saved: xp.saved, stats: { ...xstats, split: xstats.split && { ...xstats.split } }, gpu: xg ? { W: xg.W, H: xg.H, samples: xg.samples, mirrors: xg.mirrors.size, acc: xg.acc?.texture.type ?? null } : null }
				},
				shot(kind, W = 1920, H = 1080) {
					if (!canExport()) return null
					return kind === "follow" ? followShot(W, H) : kind === "orbit" ? orbitShot(W, H) : kind === "director" ? directorShot(W, H) : kind === "live" ? liveShot(W, H) : wideShot(W, H)
				},
				analysis: () => (canExport() ? exportAnalysis() : null),
				probe(on) {
					xstats.probe = !!on
				},
				fitWide: (W, H, topPx) => (run ? fitWide(frameOf(run), W, H, topPx) : null),
			},
		},
	})
	return api
}
