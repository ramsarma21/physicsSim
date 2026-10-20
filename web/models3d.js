// Realistic 3D models for catalog items, drawn by view3d.js in place of its plain boxes and spheres.
// The physics never sees these: a model only has to LOOK like the real object and fill its part's
// physics outline exactly (side view, the x-y plane), so what you see is what collides.
//
// Model files (web/models/<group>.js) export `default function register({ addModel, kit, THREE })`.
//   addModel(itemType, part, build)   part = a part name from the item's builder ("book", "body", "wheel1"...), or "*"
//   build(ctx) -> THREE.Object3D, or null to draw nothing for that part (e.g. a hidden helper part of a composite)
//   ctx = { solid, body, props, look, color, w, h, d, r, THREE, kit }
//     frame: origin = the solid's origin (a slab's centre, a ball's centre); +x along the body's width, +y along its
//     height, +z toward the camera (front to back = d). Slab: w = body.width, h = body.height, d = body.depth.
//     Ball: r = body.radius, d = solid.depth3d ?? 2r. props = the item's resolved props (sizes, colours, mass...).
//   The model's x-y silhouette must match the physics outline (within ~1 mm), and it must stay inside z ∈ [-d/2, d/2].
// Builds are cached by (type, part, body, props) and cloned, so a model is built once however often a scene reloads.
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { addFrameHook, addViewPlugin, ownMaterial } from "./view-plugins.js"
import { MODULE_GROUPS } from "./models/modules.js"

const models = new Map()
export function addModel(itemType, part, build) {
	models.set(`${itemType}|${part}`, build)
}
/** The model registered for this solid: a builder, null (draw nothing), or undefined (no model: the view's default). */
export function modelFor(solid) {
	if (!solid.itemType) return undefined
	const k1 = `${solid.itemType}|${solid.part}`
	if (models.has(k1)) return models.get(k1)
	const k2 = `${solid.itemType}|*`
	if (models.has(k2)) return models.get(k2)
	return undefined
}

// Builds are kept in a small least-recently-used cache: a slider drag asks for a new size at every step, and each size builds its own
// geometries. When a prototype is dropped, the geometries no other kept prototype draws are disposed (and leave the kit's `geos`).
const built = new Map() // key -> Object3D prototype (cloned for each use; geometry and materials shared), least recently used first
const BUILT_CAP = 60 // prototypes kept besides the ones the run on screen draws
const protoGeos = new Map() // prototype -> the BufferGeometries it draws
const geoRefs = new Map() // BufferGeometry -> how many kept prototypes draw it (clones share geometry with their prototype)
const geoKeys = new Map() // BufferGeometry -> its key in `geos` (when kit.geo made it)
let pinned = new Set() // keys of the prototypes the run on screen was built from: never dropped
let pending = null // keys of the run being built (beginRun .. endRun): never dropped either
let made = null // the kit geometries made by the build in progress (a merge's inputs end up in none of the prototypes)

/** The view calls this before it builds a run from buildModel() clones, and endRun() once it has: what the run uses is kept. */
export function beginRun() {
	pending = new Set()
}
export function endRun() {
	if (!pending) return
	pinned = pending
	pending = null
	trim()
}
/** A model built after its run's endRun() (the view's progressive build) joins the kept prototypes of the run on screen. */
export function pinModel(solid, props = {}) {
	pinned.add(modelKey(solid, props))
}
/** Cache sizes, for checking that nothing leaks. */
export function modelStats() {
	return { built: built.size, geos: geos.size, tracked: geoRefs.size, pinned: pinned.size }
}

const quantize = (v) => Math.round(v * 2000) / 2000 // 0.5 mm: slider steps in between reuse the model
const keyOf = (o) => JSON.stringify(o, (k, v) => (typeof v === "number" ? quantize(v) : v))
function drawnGeometries(proto) {
	const set = new Set()
	proto.traverse((o) => {
		if (o.geometry?.isBufferGeometry && !o.isSprite) set.add(o.geometry)
	})
	return set
}
function dropGeometry(g) {
	g.dispose()
	const k = geoKeys.get(g)
	if (k !== undefined && geos.get(k) === g) geos.delete(k)
	geoKeys.delete(g)
}
function trim() {
	const kept = (k) => pinned.has(k) || pending?.has(k)
	let spare = 0 // prototypes nothing on screen needs
	for (const k of built.keys()) if (!kept(k)) spare++
	for (const [k, proto] of built) {
		if (spare <= BUILT_CAP) break
		if (kept(k)) continue
		spare--
		built.delete(k)
		if (!proto) continue
		for (const g of protoGeos.get(proto) ?? []) {
			const n = (geoRefs.get(g) ?? 1) - 1
			if (n > 0) geoRefs.set(g, n)
			else {
				geoRefs.delete(g)
				dropGeometry(g)
			}
		}
		protoGeos.delete(proto)
	}
}

/** The cache key of the model build for this solid and its props (what buildModel keeps its prototype under). */
export function modelKey(solid, props = {}) {
	return `${solid.itemType}|${solid.part}|${keyOf(solid.body)}|${solid.color ?? ""}|${solid.look ?? ""}|${keyOf(props)}`
}
/** True when buildModel(solid, {props}) would only clone a kept prototype (no model building, no texture baking): the view builds such parts at once and defers the rest. */
export function isModelCached(solid, props = {}) {
	return built.has(modelKey(solid, props))
}

/** A model instance for this solid, or null (draw nothing), or undefined (no model). */
export function buildModel(solid, { props = {}, look = {} } = {}) {
	const build = modelFor(solid)
	if (build === undefined) return undefined
	if (build === null) return null
	const key = modelKey(solid, props)
	let proto = built.get(key)
	if (proto === undefined) {
		const body = solid.body
		const ball = body.kind === "ball"
		const ctx = {
			solid, body, props, look, THREE, kit,
			color: solid.color ?? look.fill ?? solid.placeholder?.fill ?? "#cccccc",
			w: ball ? 2 * body.radius : body.width, h: ball ? 2 * body.radius : body.height,
			d: ball ? solid.depth3d ?? 2 * body.radius : body.depth ?? 0.1, r: ball ? body.radius : undefined,
		}
		const outer = made
		made = []
		try {
			proto = build(ctx)
		} catch (e) {
			console.warn(`model ${solid.itemType}/${solid.part} failed:`, e)
			proto = undefined
		}
		const mine = made
		made = outer
		if (proto === undefined) {
			for (const g of mine) dropGeometry(g)
			return undefined
		}
		if (proto) proto.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true } })
		const drawn = proto ? drawnGeometries(proto) : new Set()
		for (const g of drawn) geoRefs.set(g, (geoRefs.get(g) ?? 0) + 1)
		if (proto) protoGeos.set(proto, drawn)
		for (const g of mine) if (!drawn.has(g) && !geoRefs.has(g)) dropGeometry(g) // made but never drawn (a merge's inputs)
		built.set(key, proto)
		pending?.add(key)
		dropLeftovers(key)
		trim()
	} else {
		built.delete(key)
		built.set(key, proto) // most recently used last
		pending?.add(key)
	}
	return proto ? proto.clone() : null
}

// ---------------------------------------------------------------- paint: colour that keeps its hue and saturation through AgX
// AgX tone-maps each channel on its own after an inset matrix, which washes a pure, bright paint toward cream (the truck's #ffc400 came out (216,188,121), a red toward brick):
// its hue and saturation are not the paint's. A plain painted surface (no texture, not metal, not glass) is therefore mapped by its PEAK channel alone, through the very curve AgX
// gives a grey, and keeps the ratios of its channels: hue exact, saturation what the paint says, brightness what AgX gives a grey of that level (so the picture is as bright as
// before). Only where the renderer tone-maps (the view's main pass, the catalog photos); the planar mirror and cube passes stay linear. A model that grades its own material
// (balls, blocks, everyday items) sets its own onBeforeCompile after the kit made the material, and keeps what it tuned.
// ONE shader program serves the plain paints and the view's other plain looks (view3d.js satify, which adds the saturation the Blender look has): a uniform `uPaint` says which a
// material is (1: its peak channel through AgX's grey curve, no per-channel tone mapping; 0: the saturation uSat, then the renderer's tone mapping), and they all carry the same
// customProgramCacheKey, so a scene of paint and plain looks compiles one variant per pass, not two.
const PAINT_GLSL = `#ifdef TONE_MAPPING
vec3 paintTone( vec3 c ) {
	float p = max( c.r, max( c.g, c.b ) );
	if ( p <= 1e-5 ) return c;
	return c * ( AgXToneMapping( vec3( p ) ).g / p );
}
#endif`
const GRADE_GLSL = `#ifdef TONE_MAPPING
if ( uPaint > 0.5 ) outgoingLight = paintTone( outgoingLight );
#endif
if ( uPaint < 0.5 ) { float gl = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) ); outgoingLight = max( vec3( 0.0 ), mix( vec3( gl ), outgoingLight, uSat ) ); }`
const TONEMAP_GLSL = `#if defined( TONE_MAPPING )
	if ( uPaint < 0.5 ) gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`
/** The saturation the view gives its plain looks before tone mapping, one uniform for all of them (view3d.js reads and may set .value; the paints do not use it). */
export const gradeSat = { value: 1.3 }
/** customProgramCacheKey for a material whose onBeforeCompile is `hook` (which calls gradeShader): they all answer "grade" and share one program; a material that has had another hook set since
 *  (a model that grades its own) answers with that hook's own text, as three.js does by default, so it never takes this program. */
export const gradeKeyFor = (hook) =>
	function () {
		return this.onBeforeCompile === hook ? "grade" : this.onBeforeCompile.toString()
	}
/** Put the shared grading into a material's shader (call it from its onBeforeCompile): `paint` true for a plain painted one. */
export function gradeShader(shader, paint) {
	shader.uniforms.uSat = gradeSat
	shader.uniforms.uPaint = { value: paint ? 1 : 0 }
	shader.fragmentShader = shader.fragmentShader
		.replace("#include <common>", "#include <common>\nuniform float uSat;\nuniform float uPaint;\n" + PAINT_GLSL)
		.replace("#include <opaque_fragment>", GRADE_GLSL + "\n#include <opaque_fragment>")
		.replace("#include <tonemapping_fragment>", TONEMAP_GLSL)
}
/** onBeforeCompile for a plain painted material: tone-map its peak channel with AgX's grey curve, keep its hue and saturation (set customProgramCacheKey = gradeKeyFor(paintHook) with it). */
export const paintHook = (shader) => gradeShader(shader, true)
/** True for a material that is plain paint: an untextured, opaque surface of a saturated colour that is not a bare metal (a painted rim, metalness 0.55, is paint; steel and brass, 0.85 and up, are not) (a pale or grey one is left to AgX, which keeps greys grey). */
export function isPlainPaint(m) {
	if (m.map || m.alphaMap || m.vertexColors || m.transmission > 0 || m.transparent || (m.metalness ?? 0) >= 0.7 || (m.opacity ?? 1) < 1 || !m.color) return false
	const c = m.color
	const mx = Math.max(c.r, c.g, c.b)
	const mn = Math.min(c.r, c.g, c.b)
	return mx > 0.02 && (mx - mn) / mx >= 0.25 // (linear light: a saturated sRGB colour is more so here)
}

// ---------------------------------------------------------------- the kit: shared, cached building blocks
const mats = new Map()
const texs = new Map()
const geos = new Map()
const cached = (map, key, make) => {
	let v = map.get(key)
	if (v === undefined) {
		v = make()
		map.set(key, v)
	}
	return v
}

/** A canvas texture drawn once by draw(ctx2d, w, h); sRGB colour unless {data: true} (normal/roughness maps). */
function tex(key, w, h, draw, { data = false, repeat = null, wrap = true } = {}) {
	return cached(texs, key, () => bakeScope(`tex|${key}`, () => {
		const c = document.createElement("canvas")
		c.width = w
		c.height = h
		draw(c.getContext("2d"), w, h)
		const t = new THREE.CanvasTexture(c)
		if (!data) t.colorSpace = THREE.SRGBColorSpace
		if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping
		if (repeat) t.repeat.set(repeat[0], repeat[1])
		t.anisotropy = 8
		texKeys.set(t, key)
		return t
	}))
}

/** Text on a canvas texture (labels, spines, keys): {bg, fg, font, size, w, h, align, rotate}. */
function text(key, str, { bg = "#ffffff", fg = "#111111", font = "600 72px ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif", w = 512, h = 128, align = "center", pad = 24 } = {}) {
	return tex(`text|${key}|${str}|${bg}|${fg}|${font}|${w}|${h}|${align}`, w, h, (g) => {
		g.fillStyle = bg
		g.fillRect(0, 0, w, h)
		g.fillStyle = fg
		g.font = font
		g.textBaseline = "middle"
		g.textAlign = align
		const x = align === "center" ? w / 2 : align === "left" ? pad : w - pad
		g.fillText(str, x, h / 2)
	}, { wrap: false })
}

/** A cached MeshPhysicalMaterial. params as three.js takes them (color as hex string or number). */
function mat(key, params = {}) {
	return cached(mats, `mat|${key}`, () => {
		const p = { ...params }
		if (typeof p.color === "string") p.color = new THREE.Color(p.color)
		if (typeof p.sheenColor === "string") p.sheenColor = new THREE.Color(p.sheenColor)
		const m = new THREE.MeshPhysicalMaterial(p)
		if (isPlainPaint(m)) {
			m.onBeforeCompile = paintHook // (a model that grades its material itself replaces this)
			m.customProgramCacheKey = gradeKeyFor(paintHook)
		}
		return m
	})
}

const geo = (key, make) => {
	const full = `geo|${key}`
	let g = geos.get(full)
	if (g === undefined) {
		g = make()
		geos.set(full, g)
		geoKeys.set(g, full)
		made?.push(g)
	}
	return g
}
const f5 = (v) => Number(v).toFixed(5)

const kit = {
	THREE,
	mat, tex, text, geo,
	/** bakeScope(key, compute): compute() (textures, pixel arrays, plain data) made by a bake worker ahead of time when it has (see "Bake scopes" below); key must say
	 *  everything the value depends on, as a cache key does. */
	bakeScope: (key, compute) => bakeScope(key, compute),
	/** A mesh that casts and receives shadows. */
	mesh(geometry, material, { cast = true } = {}) {
		const m = new THREE.Mesh(geometry, material)
		m.castShadow = cast
		m.receiveShadow = true
		return m
	},
	group(...children) {
		const g = new THREE.Group()
		for (const c of children.flat()) if (c) g.add(c)
		return g
	},
	/** Rounded box centred on the origin (radius r, clamped to fit). */
	box(w, h, d, r = 0.001, segments = 3) {
		const rr = Math.max(0.00001, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5))
		return geo(`box|${f5(w)}|${f5(h)}|${f5(d)}|${f5(rr)}|${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, rr))
	},
	/** A solid of revolution about the y axis from [[radius, y], ...] (bottom to top); segments around. */
	lathe(points, segments = 64, key = null) {
		return geo(`lathe|${key ?? JSON.stringify(points)}|${segments}`, () => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments))
	},
	/** The same, lying along the x axis (a can on its side, a rolling pin): y of the profile becomes x. */
	latheX(points, segments = 64, key = null) {
		return geo(`latheX|${key ?? JSON.stringify(points)}|${segments}`, () => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments).rotateZ(-Math.PI / 2))
	},
	/** The same, along the z axis (a coin on its edge, a wheel seen from the front): y of the profile becomes z. */
	latheZ(points, segments = 64, key = null) {
		return geo(`latheZ|${key ?? JSON.stringify(points)}|${segments}`, () => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments).rotateX(Math.PI / 2))
	},
	/** A 2D outline [[x, y], ...] in the x-y plane extruded through depth d (centred in z), with an optional bevel. */
	extrude(points, d, { bevel = 0, curveSegments = 12, key = null } = {}) {
		return geo(`extrude|${key ?? JSON.stringify(points)}|${f5(d)}|${f5(bevel)}`, () => {
			const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
			const depth = Math.max(1e-5, d - 2 * bevel)
			const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments })
			g.translate(0, 0, -depth / 2)
			return g
		})
	},
	/** A cylinder along z (axis toward the camera): wheels, coins on edge, pins through the depth. */
	cylinderZ(r, len, segments = 48) {
		return geo(`cylZ|${f5(r)}|${f5(len)}|${segments}`, () => new THREE.CylinderGeometry(r, r, len, segments).rotateX(Math.PI / 2))
	},
	/** A cylinder along y (standing). */
	cylinderY(r, len, segments = 48, rTop = r) {
		return geo(`cylY|${f5(r)}|${f5(rTop)}|${f5(len)}|${segments}`, () => new THREE.CylinderGeometry(rTop, r, len, segments))
	},
	sphere(r, w = 48, h = 24) {
		return geo(`sph|${f5(r)}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h))
	},
	torus(R, tube, radial = 16, tubular = 48, arc = Math.PI * 2) {
		return geo(`torus|${f5(R)}|${f5(tube)}|${radial}|${tubular}|${f5(arc)}`, () => new THREE.TorusGeometry(R, tube, radial, tubular, arc))
	},
	merge(list, key) {
		return geo(`merge|${key}`, () => mergeGeometries(list, false))
	},

	// ---- material presets (cached; pass a key suffix when the colour varies) ----
	plastic(color = "#e8e8e8", { gloss = 0.5, key = "" } = {}) {
		return mat(`plastic|${color}|${gloss}|${key}`, { color, roughness: 0.55 - 0.45 * gloss, metalness: 0, clearcoat: 0.3 * gloss, clearcoatRoughness: 0.2 })
	},
	rubber(color = "#1c1c1e") {
		return mat(`rubber|${color}`, { color, roughness: 0.85, metalness: 0 })
	},
	metal(color = "#c9ccd1", { roughness = 0.3, key = "" } = {}) {
		return mat(`metal|${color}|${roughness}|${key}`, { color, roughness, metalness: 1 })
	},
	aluminium(color = "#d6d9de") { return kit.metal(color, { roughness: 0.25 }) },
	steel(color = "#a9afb6") { return kit.metal(color, { roughness: 0.32 }) },
	glass(tint = "#ffffff", { thickness = 0.004, roughness = 0.03 } = {}) {
		return mat(`glass|${tint}|${thickness}|${roughness}`, { color: tint, roughness, metalness: 0, transmission: 1, thickness, ior: 1.5, transparent: true })
	},
	paper(color = "#f4efe3") {
		return mat(`paper|${color}`, { color, roughness: 0.9, metalness: 0 })
	},
	cardboard(color = "#c49a6c") {
		return mat(`cardboard|${color}`, { color, roughness: 0.92, metalness: 0 })
	},
	ceramic(color = "#f2f0eb") {
		return mat(`ceramic|${color}`, { color, roughness: 0.2, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08 })
	},
	fabric(color = "#888888") {
		return mat(`fabric|${color}`, { color, roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.6, sheenColor: color })
	},
	wood(color = "#b07a45", { roughness = 0.55, varnish = 0.6 } = {}) {
		return mat(`wood|${color}|${roughness}|${varnish}`, { color, roughness, metalness: 0, clearcoat: varnish, clearcoatRoughness: 0.15, map: kit.grainTexture(color) })
	},
	/** Wood grain along x, tinted around a base colour. */
	grainTexture(base = "#b07a45") {
		return tex(`grain|${base}`, 512, 256, (g, w, h) => {
			const c = new THREE.Color(base)
			for (let y = 0; y < h; y++) {
				const t = Math.sin(y * 0.21) * 0.5 + Math.sin(y * 0.047 + 1.3) * 0.35 + Math.sin(y * 0.9) * 0.1
				const k = 0.86 + 0.12 * t
				g.fillStyle = `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`
				g.fillRect(0, y, w, 1)
			}
			g.globalAlpha = 0.12
			for (let i = 0; i < 90; i++) {
				g.strokeStyle = i % 2 ? "#000" : "#fff"
				g.beginPath()
				const y0 = Math.random() * h
				g.moveTo(0, y0)
				for (let x = 0; x <= w; x += 32) g.lineTo(x, y0 + Math.sin(x * 0.01 + i) * 3)
				g.stroke()
			}
		})
	},
	/** A material whose colour map is a canvas texture drawn by draw(g, w, h) (a printed label, a cover). */
	printed(key, draw, { w = 1024, h = 512, roughness = 0.45, clearcoat = 0, metalness = 0, repeat = null } = {}) {
		return mat(`printed|${key}|${roughness}|${clearcoat}|${metalness}`, { map: tex(`printed|${key}`, w, h, draw, { repeat, wrap: !!repeat }), roughness, metalness, clearcoat, clearcoatRoughness: 0.15 })
	},
}
export { kit }

// ---------------------------------------------------------------- bake scopes: the slow part of a model build, done by a worker ahead of time
// A model's textures are worked out pixel by pixel in JavaScript (balls, blocks, timber, the everyday items' normal maps: 50 to 400 ms each on a slow
// phone), one unit of work the page cannot cut short. The model code keys every such bake as a cache (balls' memo, blocks' and surfaces' bake, kit.tex), and
// each of those keyed computations runs in a bake scope. A bake worker (models/bake-worker.js, running this very file and the model files) builds the
// models a scene is about to need (prebake) and sends back the value of every scope that took it a while: its textures as their final pixels (the exact
// RGBA bytes of their canvas, or a DataTexture's data, with their settings), its arrays and plain data as they are. When the page's own build reaches that
// scope, it makes the value from those bytes instead of working it out again: the same textures, byte for byte (a canvas is only replayed when every pixel's
// alpha is 0 or 255, where a canvas keeps the exact bytes it was given; a value holding anything else, or a texture made before the scope began, is never
// recorded and is worked out here as before). Without workers (no Worker, no OffscreenCanvas, a worker that fails to start) nothing changes.
const SCOPE_MIN_MS = 2 // a scope cheaper than this in the worker is not worth sending
const prebaked = new Map() // scope key -> recorded value (from a worker), taken by the first build that reaches the scope
const prebakedSize = new Map() // scope key -> its bytes; the records wait for their builds (a slow phone playing a scene builds nothing meanwhile) up to RECORDS_MB
let prebakedBytes = 0
const RECORDS_MB = () => (lowMemory() ? 64 : 192) // records kept waiting at most; past it the oldest go (their builds work them out themselves)
const sizeOf = (v) => (!v || typeof v !== "object" ? 0 : ArrayBuffer.isView(v) ? v.byteLength : Object.values(v).reduce((n, x) => n + sizeOf(x), 0))
function forget(key) {
	if (!prebaked.has(key)) return
	prebaked.delete(key)
	prebakedBytes -= prebakedSize.get(key) ?? 0
	prebakedSize.delete(key)
}
function remember(key, v) {
	forget(key)
	const n = sizeOf(v)
	prebaked.set(key, v)
	prebakedSize.set(key, n)
	prebakedBytes += n
	for (const k of prebaked.keys()) {
		if (prebakedBytes <= RECORDS_MB() * 1048576) break
		forget(k)
	}
}
const leftovers = new Map() // model key -> the scope keys its prebake brought (dropped once the model is built: what that build did not take is not needed)
const texKeys = new WeakMap() // texture -> its kit.tex key (a replayed texture joins the kit's cache under it)
let rec = null // (worker) the build being recorded: {list, depth, firstTex}
const TEX_PROPS = ["mapping", "channel", "wrapS", "wrapT", "magFilter", "minFilter", "anisotropy", "format", "internalFormat", "type", "rotation", "matrixAutoUpdate", "generateMipmaps", "premultiplyAlpha", "flipY", "unpackAlignment", "colorSpace", "name"]
const TEX_VECS = ["offset", "repeat", "center"]
const plainData = (v) => { try { return JSON.parse(JSON.stringify(v)) } catch { return {} } }
const NO = Symbol("not replayable")
/** (worker) The value of a scope as data a page can take and rebuild, or NO. */
function serialize(v, firstTex, seen = new Set()) {
	if (v === null || v === undefined || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v
	if (typeof v !== "object") return NO
	if (seen.has(v)) return NO // (a value that refers to itself, or shares a part twice: made here as before)
	seen.add(v)
	if (ArrayBuffer.isView(v)) return v.slice()
	if (Array.isArray(v)) {
		const out = []
		for (const x of v) {
			const s = serialize(x, firstTex, seen)
			if (s === NO) return NO
			out.push(s)
		}
		return out
	}
	if (typeof ImageData !== "undefined" && v instanceof ImageData) return { __img: [v.width, v.height, v.data.slice()] }
	if (v.isTexture) {
		if (v.id < firstTex || v.isRenderTargetTexture || v.isCompressedTexture || v.isVideoTexture) return NO // (made before this scope: another cache's)
		const props = {}
		for (const k of TEX_PROPS) props[k] = v[k]
		for (const k of TEX_VECS) props[k] = [v[k].x, v[k].y]
		const t = { props, userData: plainData(v.userData), kitKey: texKeys.get(v) ?? null }
		const img = v.image
		if (v.isDataTexture) {
			if (!img?.data || !ArrayBuffer.isView(img.data)) return NO
			return { __tex: "data", w: img.width, h: img.height, data: img.data.slice(), ...t }
		}
		if (typeof OffscreenCanvas === "undefined" || !(img instanceof OffscreenCanvas)) return NO
		if (img.width > 4096 || img.height > 4096) return NO // (a canvas this big is drawn another way on a page than in a worker: a few pixels came out otherwise)
		if (img.__text) return NO // (text: see bake-worker.js)
		const g = img.getContext("2d")
		if (!g) return NO
		const px = g.getImageData(0, 0, img.width, img.height).data
		for (let i = 3; i < px.length; i += 4) if (px[i] !== 255 && px[i] !== 0) return NO // (a canvas keeps partly transparent pixels premultiplied: they would not come back exact)
		return { __tex: "canvas", w: img.width, h: img.height, px, ...t }
	}
	if (Object.getPrototypeOf(v) !== Object.prototype) return NO // (materials, geometries, colours ... are made here)
	const out = {}
	for (const k of Object.keys(v)) {
		const s = serialize(v[k], firstTex, seen)
		if (s === NO) return NO
		out[k] = s
	}
	return out
}
/** (page) A recorded value made into what the scope returns: the same textures, from their bytes. */
function deserialize(s) {
	if (s === null || typeof s !== "object") return s
	if (ArrayBuffer.isView(s)) return s
	if (Array.isArray(s)) return s.map(deserialize)
	if (s.__img) return new ImageData(s.__img[2], s.__img[0], s.__img[1])
	if (s.__tex) {
		const have = s.kitKey !== null && texs.get(s.kitKey)
		if (have) return have
		let t
		if (s.__tex === "data") t = new THREE.DataTexture(s.data, s.w, s.h)
		else {
			const c = document.createElement("canvas")
			c.width = s.w
			c.height = s.h
			c.getContext("2d").putImageData(new ImageData(s.px, s.w, s.h), 0, 0)
			t = new THREE.CanvasTexture(c)
		}
		for (const k of TEX_PROPS) t[k] = s.props[k]
		for (const k of TEX_VECS) t[k].set(s.props[k][0], s.props[k][1])
		t.userData = s.userData
		t.needsUpdate = true
		if (s.kitKey !== null) {
			texKeys.set(t, s.kitKey)
			texs.set(s.kitKey, t)
		}
		return t
	}
	const out = {}
	for (const k of Object.keys(s)) out[k] = deserialize(s[k])
	return out
}
let texSerial = null // a texture made now tells the next texture id (three counts them page-wide)
const nextTexId = () => {
	texSerial = new THREE.Texture()
	return texSerial.id + 1
}
/** Run compute() as one bake scope (see above): recorded in a worker's build, replayed from its record in the page's. */
function bakeScope(key, compute) {
	if (rec) {
		const top = rec.depth === 0
		const firstTex = top ? nextTexId() : 0
		const t0 = performance.now()
		rec.depth++
		let v
		try {
			v = compute()
		} finally {
			rec.depth--
		}
		if (top && performance.now() - t0 >= SCOPE_MIN_MS) {
			const s = serialize(v, firstTex)
			if (s !== NO) rec.list.push([key, s])
		}
		return v
	}
	if (prebaked.has(key)) {
		const s = prebaked.get(key)
		forget(key)
		return deserialize(s)
	}
	return compute()
}
/** (worker) Build with every bake scope recorded: the [key, value] pairs a page can replay. What the build made besides is let go at once (a worker never
 *  draws: its prototypes, geometries, materials and the kit's textures would only hold memory; the model files' own caches keep what they keep). */
export function recordBakes(build) {
	rec = { list: [], depth: 0 }
	try {
		build()
		return rec.list
	} finally {
		rec = null
		for (const g of geos.values()) g.dispose()
		built.clear()
		protoGeos.clear()
		geoRefs.clear()
		geoKeys.clear()
		geos.clear()
		mats.clear()
		texs.clear()
	}
}
function dropLeftovers(modelKey) {
	const keys = leftovers.get(modelKey)
	if (!keys) return
	leftovers.delete(modelKey)
	for (const k of keys) forget(k)
}

// The pool of bake workers (the page only): up to 3, fewer on a device with few cores or little memory, started by the first prebake (a load with models to
// build: they load the model code while the page draws its first picture with stand-ins and builds the first models itself) and stopped after a while with
// nothing to do. Jobs wait in one queue, in the order asked (a catalog photo goes first: `front`); a worker holds
// up to POOL_DEPTH of them at a time (no round trip between two), so a job no worker has taken yet can still be built by the page itself instead
// (stealPrebake). A part whose build had nothing worth sending (a domino, a link of a chain, a cradle's ball: no slow bake) is not sent again: the next ones
// of that kind are left to the page (noBake).
const POOL_DEPTH = 3
const noBake = new Set() // itemType|part whose worker build sent nothing back and took next to no time
const pool = { list: [], off: typeof window === "undefined" || !!self.__BAKE_WORKER__ || typeof Worker !== "function" || typeof OffscreenCanvas !== "function", queue: [], byModel: new Map(), seq: 0, idle: 0 }
// a device short of memory (navigator.deviceMemory of 4 GB or less, or a phone-size window) has fewer workers, let go sooner (each holds the model code and
// what it last built: 40 to 70 MB)
const lowMemory = () => {
	try {
		const m = Number(navigator.deviceMemory) || 0
		return (m > 0 && m <= 4) || Math.min(window.innerWidth || 1e9, window.innerHeight || 1e9) <= 500
	} catch {
		return false
	}
}
const poolSize = () => {
	const n = Number(navigator.hardwareConcurrency) || 4
	const want = n <= 2 ? 1 : n <= 6 ? 2 : 3
	const mem = Number(navigator.deviceMemory) || 0
	return mem > 0 && mem <= 2 ? 1 : lowMemory() ? Math.min(2, want) : want
}
const POOL_IDLE_MS = () => (lowMemory() ? 1000 : 5000) // nothing to do this long: the workers stop (their canvases are drawn as the page's are, on the GPU: they
// must be, for the very same pixels; that memory, 100 to 400 MB after a busy scene, is given back when they stop) ...
const POOL_HELD_MB = () => (lowMemory() ? 48 : 128) // ... and a worker whose canvases hold more than this is retired once its jobs are done (a fresh one takes over)
function importMap() {
	const out = {}
	try {
		const map = JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || "{}").imports ?? {}
		for (const [k, v] of Object.entries(map)) out[k] = new URL(v, document.baseURI).href
	} catch {}
	return out
}
function spawnWorker() {
	const w = new Worker(new URL("./models/bake-worker.js", import.meta.url), { type: "module" })
	const ent = { w, jobs: [], ready: false }
	w.onmessage = (e) => {
		const m = e.data
		if (m?.type === "ready") {
			ent.ready = true
			feed()
		} else if (m?.type === "failed") poolFailed(`bake worker could not start: ${m.error}`)
		else if (m?.type === "baked") finishJob(ent, m)
	}
	w.onerror = (e) => {
		e.preventDefault?.()
		poolFailed(`bake worker error: ${e.message || "it could not be loaded"}`)
	}
	w.postMessage({ type: "init", models: import.meta.url, importmap: { imports: importMap() } })
	return ent
}
function startPool() {
	if (pool.off) return false
	clearTimeout(pool.idle)
	try {
		while (pool.list.length < poolSize()) pool.list.push(spawnWorker())
	} catch (e) {
		poolFailed(`bake worker could not start: ${e}`)
		return false
	}
	idleCheck()
	return true
}
function poolFailed(why) {
	if (pool.off) return
	console.warn(why, "(the models are baked on the page instead)")
	pool.off = true
	for (const ent of pool.list) {
		ent.w.terminate()
		for (const job of ent.jobs) settle(job)
	}
	pool.list = []
	for (const job of pool.queue) settle(job)
	pool.queue = []
}
function settle(job) {
	if (job.state === "done" || job.state === "stolen") return
	job.state = "done"
	job.resolve()
}
/** Give every started worker the next jobs in the queue, up to POOL_DEPTH each (the least loaded first); retire the ones that hold too much once they are
 *  done, and start fresh ones while jobs wait. */
function feed() {
	for (const ent of pool.list.filter((e) => e.retiring && !e.jobs.length)) {
		ent.w.terminate()
		pool.list.splice(pool.list.indexOf(ent), 1)
	}
	if (pool.queue.length && pool.list.length < poolSize()) startPool()
	for (;;) {
		const ent = pool.list.filter((e) => e.ready && !e.retiring && e.jobs.length < POOL_DEPTH).sort((a, b) => a.jobs.length - b.jobs.length)[0]
		if (!ent) break
		const job = pool.queue.shift()
		if (!job) break
		if (noBake.has(job.kind)) { // (its kind had nothing to send: the page builds it straight away)
			settle(job)
			continue
		}
		ent.jobs.push(job)
		job.state = "running"
		try {
			ent.w.postMessage(job.msg)
		} catch {
			ent.jobs.splice(ent.jobs.indexOf(job), 1)
			settle(job)
		}
	}
	idleCheck()
}
function finishJob(ent, m) {
	if (m.held > POOL_HELD_MB() * 1048576) ent.retiring = true // (it takes no more jobs: see feed)
	const at = ent.jobs.findIndex((j) => j.id === m.id)
	const job = at >= 0 ? ent.jobs.splice(at, 1)[0] : null
	if (job) {
		if (!m.records?.length && m.ms < 8 && !m.error) noBake.add(job.kind)
		if (!built.has(job.key)) { // (a build the page already made itself: its records are not needed)
			const keys = []
			for (const [k, v] of m.records ?? []) {
				remember(k, v)
				keys.push(k)
			}
			if (keys.length) leftovers.set(job.key, [...(leftovers.get(job.key) ?? []), ...keys])
		}
		job.ms = m.ms
		settle(job)
	}
	feed()
}
function idleCheck() {
	clearTimeout(pool.idle)
	if (pool.queue.length || pool.list.some((e) => e.jobs.length)) return
	pool.idle = setTimeout(() => {
		if (pool.queue.length || pool.list.some((e) => e.jobs.length)) return
		for (const ent of pool.list) ent.w.terminate()
		pool.list = []
		pool.byModel.clear() // (the records stay for their builds: see remember)
	}, POOL_IDLE_MS())
}
/** Have the bake workers build these models ahead of the page's own build: [{solid, props, look}] → a handle per item ({state: "queued" | "running" | "done" |
 *  "stolen", promise}: done once that model's bakes are here, or its worker gave up), or null where there is nothing to do (no workers, no model, built already).
 *  A model already asked for keeps its handle (`front` moves it to the front of the queue if no worker has it yet). */
export function prebake(items, { front = false } = {}) {
	if (pool.off || !startPool()) return items.map(() => null)
	const out = []
	const ahead = []
	for (const { solid, props = {}, look = {} } of items) {
		const build = modelFor(solid)
		const key = build ? modelKey(solid, props) : null
		if (!key || built.has(key) || noBake.has(`${solid.itemType}|${solid.part}`)) {
			out.push(null)
			continue
		}
		let job = pool.byModel.get(key)
		if (!job || job.state === "stolen") {
			job = { id: ++pool.seq, key, kind: `${solid.itemType}|${solid.part}`, state: "queued", ms: 0 }
			job.promise = new Promise((resolve) => (job.resolve = resolve))
			job.msg = { type: "bake", id: job.id, solid: JSON.parse(JSON.stringify(solid)), props: JSON.parse(JSON.stringify(props)), look: JSON.parse(JSON.stringify(look ?? {})) }
			pool.byModel.set(key, job)
			if (!front) pool.queue.push(job)
		}
		if (front && job.state === "queued") ahead.push(job)
		out.push(job)
	}
	if (ahead.length) {
		const set = new Set(ahead)
		pool.queue = [...ahead, ...pool.queue.filter((j) => !set.has(j))]
	}
	feed()
	return out
}
/** The page builds this model itself after all (no worker has started it): it leaves the queue. True when it did. */
export function stealPrebake(job) {
	if (!job || job.state !== "queued") return false
	job.state = "stolen"
	const i = pool.queue.indexOf(job)
	if (i >= 0) pool.queue.splice(i, 1)
	job.resolve()
	return true
}
/** No bake workers from now on (the page bakes everything itself, as before there were any): on a software renderer, whose canvases are drawn by the same CPU
 *  rasteriser the page's pictures wait for, workers drawing theirs meanwhile only slowed the page down (first picture 3.8 s → 7.7 s, SwiftShader). */
export function stopPrebake() {
	if (pool.off) return
	pool.off = true
	clearTimeout(pool.idle)
	for (const ent of pool.list) {
		ent.w.terminate()
		for (const job of ent.jobs) settle(job)
	}
	pool.list = []
	for (const job of pool.queue) settle(job)
	pool.queue = []
	for (const k of [...prebaked.keys()]) forget(k)
	leftovers.clear()
}
/** Whether a bake worker has started and can take jobs (until then a page with nothing else to do builds the next model itself). */
export const prebakeReady = () => pool.off || pool.list.some((e) => e.ready)
/** How the bake workers are doing (tests). */
export const prebakeStats = () => ({ off: pool.off, workers: pool.list.length, ready: pool.list.filter((e) => e.ready).length, queued: pool.queue.length, running: pool.list.reduce((n, e) => n + e.jobs.length, 0), records: prebaked.size, models: pool.byModel.size, noBake: noBake.size })

// ---------------------------------------------------------------- the model files
// (and the physics modules' model files, web/models/mod-<name>.js: web/models/modules.js lists them; they get the view hooks too, web/view-plugins.js)
const GROUPS = ["balls", "blocks", "surfaces", "containers", "rods", "everyday-a", "everyday-b", "vehicles", "mechanisms", ...MODULE_GROUPS]
const loaded = await Promise.allSettled(GROUPS.map((g) => import(`./models/${g}.js`)))
loaded.forEach((r, i) => {
	if (r.status === "fulfilled" && typeof r.value.default === "function") {
		try {
			r.value.default({ addModel, kit, THREE, addViewPlugin, addFrameHook, ownMaterial })
		} catch (e) {
			console.warn(`models/${GROUPS[i]}.js failed to register:`, e)
		}
	} else if (r.status === "rejected" && !String(r.reason).includes("Failed to fetch") && !String(r.reason).includes("404")) {
		console.warn(`models/${GROUPS[i]}.js:`, r.reason)
	}
})
export const MODEL_GROUPS = GROUPS
