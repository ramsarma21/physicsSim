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

/** A model instance for this solid, or null (draw nothing), or undefined (no model). */
export function buildModel(solid, { props = {}, look = {} } = {}) {
	const build = modelFor(solid)
	if (build === undefined) return undefined
	if (build === null) return null
	const key = `${solid.itemType}|${solid.part}|${keyOf(solid.body)}|${solid.color ?? ""}|${solid.look ?? ""}|${keyOf(props)}`
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
		trim()
	} else {
		built.delete(key)
		built.set(key, proto) // most recently used last
		pending?.add(key)
	}
	return proto ? proto.clone() : null
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
	return cached(texs, key, () => {
		const c = document.createElement("canvas")
		c.width = w
		c.height = h
		draw(c.getContext("2d"), w, h)
		const t = new THREE.CanvasTexture(c)
		if (!data) t.colorSpace = THREE.SRGBColorSpace
		if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping
		if (repeat) t.repeat.set(repeat[0], repeat[1])
		t.anisotropy = 8
		return t
	})
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

// ---------------------------------------------------------------- the model files
const GROUPS = ["blocks"]
const loaded = await Promise.allSettled(GROUPS.map((g) => import(`./${g}.js`)))
loaded.forEach((r, i) => {
	if (r.status === "fulfilled" && typeof r.value.default === "function") {
		try {
			r.value.default({ addModel, kit, THREE })
		} catch (e) {
			console.warn(`models/${GROUPS[i]}.js failed to register:`, e)
		}
	} else if (r.status === "rejected" && !String(r.reason).includes("Failed to fetch") && !String(r.reason).includes("404")) {
		console.warn(`models/${GROUPS[i]}.js:`, r.reason)
	}
})
export const MODEL_GROUPS = GROUPS
