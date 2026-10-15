// Helpers for the mechanisms models (mechanisms.js): seeded noise, wood / metal / rubber / fabric surfaces drawn on canvases,
// normal maps from height drawings, boxes whose texture follows the grain at true scale, plates with bevels, small hardware
// (screws, washers, eyes). Everything is built once (the kit caches textures, materials and geometries by key); no per-frame code.
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"

export function makeLib(kit, THREE) {
	const T = THREE
	const TAU = Math.PI * 2
	const f5 = (v) => Number(v).toFixed(5)
	const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
	const mix = (a, b, t) => a + (b - a) * t
	const SAT = 1.0 // (the colour grade is applied by the material: see grade())

	// ------------------------------------------------------------- noise (seeded: the same picture every time)
	const hash = (x, y, s = 0) => {
		let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0
		h = Math.imul(h ^ (h >>> 13), 1274126177)
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296
	}
	const sm = (t) => t * t * (3 - 2 * t)
	/** Value noise in 0..1; period > 0 makes it tile every `period` cells. */
	function vnoise(x, y, s = 0, period = 0, periodY = period) {
		const xi = Math.floor(x)
		const yi = Math.floor(y)
		const fx = sm(x - xi)
		const fy = sm(y - yi)
		const wx = (i) => (period ? ((i % period) + period) % period : i)
		const wy = (i) => (periodY ? ((i % periodY) + periodY) % periodY : i)
		const a = hash(wx(xi), wy(yi), s)
		const b = hash(wx(xi + 1), wy(yi), s)
		const c = hash(wx(xi), wy(yi + 1), s)
		const d = hash(wx(xi + 1), wy(yi + 1), s)
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
	}
	const hashStr = (str) => {
		let h = 2166136261
		for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
		return h >>> 0
	}
	const rng = (seed) => {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6d2b79f5) >>> 0
			let t = Math.imul(a ^ (a >>> 15), 1 | a)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}

	// ------------------------------------------------------------- colours (sRGB 0..255 for canvas drawing)
	const rgb = (hex) => {
		const c = new T.Color(hex).convertLinearToSRGB()
		return [c.r * 255, c.g * 255, c.b * 255]
	}
	const css = (r, g, b) => `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`
	const shadeHex = (hex, k) => {
		const [r, g, b] = rgb(hex)
		return css(r * k, g * k, b * k)
	}

	// ------------------------------------------------------------- textures
	/** A tangent-space normal map from a height function h(x, y) in 0..1 over a W x H canvas (tileable if h is). */
	function normalTex(key, W, H, height, { strength = 2, wrap = true, repeat = null } = {}) {
		return kit.tex(`mechN|${key}|${repeat}`, W, H, (g) => {
			const hgt = new Float32Array(W * H)
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y * W + x] = height(x, y)
			const at = (x, y) => hgt[(((y % H) + H) % H) * W + (((x % W) + W) % W)]
			const out = g.createImageData(W, H)
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength
					const dy = (at(x, y - 1) - at(x, y + 1)) * 0.5 * strength
					const il = 1 / Math.hypot(dx, dy, 1)
					const o = (y * W + x) * 4
					out.data[o] = (-dx * il * 0.5 + 0.5) * 255
					out.data[o + 1] = (-dy * il * 0.5 + 0.5) * 255
					out.data[o + 2] = (il * 0.5 + 0.5) * 255
					out.data[o + 3] = 255
				}
			}
			g.putImageData(out, 0, 0)
		}, { data: true, wrap, repeat })
	}

	/** Flat-sawn timber, grain along the u axis of the texture (u spans 0.24 m, v 0.12 m at true scale); tiles. Baked once per colour at 512 x 256
	 *  (about 2100 px/m, 0.47 mm a pixel): the parts of one colour differ by where the texture is placed (uvBox / woodGeo shift it by their seed), not by a bake of their own. */
	function woodTex(color) {
		return kit.tex(`mechWood2|${color}`, 512, 256, (g, W, H) => {
			const [r0, g0, b0] = rgb(color)
			const img = g.createImageData(W, H)
			const s1 = 8
			const D = img.data
			for (let y = 0; y < H; y++) {
				const t = y / H
				for (let x = 0; x < W; x++) {
					const s = x / W
					const w1 = vnoise(s * 2, t * 3, s1, 2, 3)
					const warp = w1 * 2.4 + vnoise(s * 5, t * 12, s1 + 3, 5, 12) * 0.7
					const f = t * 36 + warp
					const r = f - Math.floor(f)
					const late = r * r * r // early wood is pale, the late wood at the end of each ring dark
					const fibre = vnoise(s * 4, t * 220, s1 + 9, 4, 220) - 0.5
					const fine = vnoise(s * 12, t * 250, s1 + 11, 12, 250) - 0.5
					const k = 1.04 - 0.17 * late + 0.13 * fibre + 0.06 * fine + 0.14 * (w1 - 0.5)
					const o = (y * W + x) * 4
					D[o] = clamp(r0 * k, 0, 255)
					D[o + 1] = clamp(g0 * k * (1 - 0.04 * late), 0, 255)
					D[o + 2] = clamp(b0 * k * (1 - 0.1 * late), 0, 255)
					D[o + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
			// pores: short dark streaks along the grain, soft at both ends (thin ellipses, not hard-edged dashes)
			const R = rng(36)
			g.globalAlpha = 0.2
			g.fillStyle = css(r0 * 0.35, g0 * 0.3, b0 * 0.25)
			for (let i = 0; i < 700; i++) {
				const len = 3 + R() * 15
				g.beginPath()
				g.ellipse(R() * W, R() * H, len / 2, 0.45 + R() * 0.3, 0, 0, TAU)
				g.fill()
			}
			g.globalAlpha = 1
		})
	}
	function woodNormal() {
		return normalTex("wood2", 256, 128, (x, y) => {
			const s = x / 256
			const t = y / 128
			return 0.55 * vnoise(s * 5, t * 150, 5, 5, 150) + 0.35 * vnoise(s * 40, t * 150, 7, 40, 150) + 0.1 * vnoise(s * 3, t * 7, 1, 3, 7)
		}, { strength: 1.4 })
	}
	/** End grain: growth rings round a centre, a few radial checks. Baked at 256 x 256 (0.4 mm a pixel on the 0.1 m tile), each ring's dark late wood
	 *  fading back to pale over a few pixels instead of cutting off, so the rings are smooth close up. */
	function endTex(color, seed) {
		return kit.tex(`mechEnd2|${color}|${seed}`, 256, 256, (g, W, H) => {
			const [r0, g0, b0] = rgb(color)
			const img = g.createImageData(W, H)
			const cx = 0.3 + 0.4 * hash(seed, 1)
			const cy = 0.7 + 0.5 * hash(seed, 2)
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const s = x / W
					const t = y / H
					const d = Math.hypot(s - cx, (t - cy) * 1.1) * 16 + 0.8 * vnoise(s * 6, t * 6, seed, 6)
					const r = d - Math.floor(d)
					const late = r * r * (0.35 + 0.65 * r) * (r > 0.94 ? (1 - r) / 0.06 : 1) // dark late wood, then a soft step back to pale
					const k = 0.78 - 0.2 * late + 0.1 * (vnoise(s * 40, t * 40, seed + 5, 40) - 0.5)
					const o = (y * W + x) * 4
					const lum = 0.2126 * r0 * k + 0.7152 * g0 * k + 0.0722 * b0 * k
					img.data[o] = clamp(lum + (r0 * k - lum) * SAT, 0, 255)
					img.data[o + 1] = clamp(lum + (g0 * k - lum) * SAT, 0, 255)
					img.data[o + 2] = clamp(lum + (b0 * k * 0.95 - lum) * SAT, 0, 255)
					img.data[o + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		})
	}
	/** Fine brushing lines along u as a roughness map around `rough` (a data texture; the material's roughness stays 1). */
	function brushedTex(rough) {
		return kit.tex(`mechBrushed|${rough}`, 512, 512, (g, W, H) => {
			const R = rng(Math.round(rough * 1000) + 3)
			for (let y = 0; y < H; y++) {
				const k = clamp(rough * (0.88 + 0.24 * R()), 0, 1)
				g.fillStyle = css(k * 255, k * 255, k * 255)
				g.fillRect(0, y, W, 1)
			}
			g.globalAlpha = 0.35
			for (let i = 0; i < 400; i++) {
				const k = clamp(rough * (0.8 + 0.4 * R()), 0, 1)
				g.fillStyle = css(k * 255, k * 255, k * 255)
				g.fillRect(R() * W, R() * H, 40 + R() * 200, 1)
			}
		}, { data: true })
	}
	/** Rough, hammered scale on forged steel: a normal map from layered blotches. */
	function forgedNormal() {
		return normalTex("forged", 512, 512, (x, y) => {
			const s = x / 512
			const t = y / 512
			return 0.5 * vnoise(s * 12, t * 12, 21, 12) + 0.3 * vnoise(s * 36, t * 36, 22, 36) + 0.2 * vnoise(s * 110, t * 110, 23, 110)
		}, { strength: 2.2 })
	}
	function forgedRough() {
		return kit.tex("mechForgedR", 512, 512, (g, W, H) => {
			const img = g.createImageData(W, H)
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const s = x / W
					const t = y / H
					const k = clamp(0.52 + 0.3 * (vnoise(s * 9, t * 9, 31, 9) - 0.5) + 0.2 * (vnoise(s * 50, t * 50, 32, 50) - 0.5), 0, 1)
					const o = (y * W + x) * 4
					img.data[o] = img.data[o + 1] = img.data[o + 2] = k * 255
					img.data[o + 3] = 255
				}
			}
			g.putImageData(img, 0, 0)
		}, { data: true })
	}

	// ------------------------------------------------------------- materials
	/** The view's colour grade (a little saturation before tone mapping, uSat = 1.3 in view3d.js) so these surfaces match the ones it draws itself. */
	const GRADE = "{ float gl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)); outgoingLight = max(vec3(0.0), mix(vec3(gl), outgoingLight, 1.3)); }"
	function grade(m) {
		if (m.userData.mechGraded) return m
		m.userData.mechGraded = true
		m.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", GRADE + "\n#include <opaque_fragment>")
		}
		m.customProgramCacheKey = () => "mech-grade"
		return m
	}
	const MAT = (key, params) => grade(kit.mat(`mech|${key}`, params))

	/** Varnished wood: colour map + pore normal map under a clear coat. `end` = the end-grain version for the faces cut across the grain. The side material
	 *  and its textures are the same for every seed (one bake per colour); only the end grain's rings differ. */
	function woodSide(color) {
		return MAT(`wood|${color}`, { map: woodTex(color), normalMap: woodNormal(), normalScale: new T.Vector2(0.35, 0.35), roughness: 0.62, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.12 })
	}
	function woodSet(color, seed = 1) {
		const side = woodSide(color)
		const end = MAT(`woodEnd|${color}|${seed}`, { map: endTex(color, seed), roughness: 0.8, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3 })
		return { side, end }
	}
	function metal(name, color, rough, extra = {}) {
		return MAT(`metal|${name}|${color}|${rough}`, { color, metalness: 1, roughness: 1, roughnessMap: brushedTex(rough), ...extra })
	}
	const steel = (color = "#c6cbd0") => metal("steel", color, 0.28)
	const zinc = () => metal("zinc", "#d4d8dc", 0.34)
	const brass = () => metal("brass", "#e3b457", 0.24)
	const chrome = () => MAT("chrome", { color: "#e9ecef", metalness: 1, roughness: 0.07 })
	const alu = (color = "#d3d8dd") => metal("alu", color, 0.32)
	const darkSteel = () => MAT("darkSteel", { color: "#5b5e63", metalness: 1, roughness: 0.42 })
	const forged = () => MAT("forgedSteel", { color: "#6a6d72", metalness: 1, roughness: 1, roughnessMap: forgedRough(), normalMap: forgedNormal(), normalScale: new T.Vector2(0.9, 0.9) })
	/** A colour with more saturation and a little less light: the view grades its own surfaces that way, so painted parts match them. */
	const rich = (hex) => {
		const c = new T.Color(hex)
		const o = {}
		c.getHSL(o)
		return c.setHSL(o.h, o.s, o.l)
	}
	const richCss = (hex) => rich(hex).getStyle() // the same colour as a canvas fill
	const rubberMat = (color = "#1c1c1e") => MAT(`rubber|${color}`, { color: rich(color), roughness: 0.88, metalness: 0 })
	const plasticMat = (color = "#cccccc") => MAT(`plastic|${color}`, { color: rich(color), roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 })
	const paint = (color, gloss = 0.5) => MAT(`paint|${color}|${gloss}`, { color: rich(color), roughness: 0.5 - 0.3 * gloss, metalness: 0, clearcoat: 0.6 * gloss, clearcoatRoughness: 0.18 })

	/** The surface of a part according to its look (wood / steel / aluminium / rubber / ...): {kind, side, end, main}. */
	function skin(ctx, { seed = null } = {}) {
		const look = ctx.solid.look ?? ""
		const sd = seed ?? 1 + (hashStr(ctx.solid.id ?? "x") % 3) // a few grain variants, so a scene builds few textures
		if (/wood/.test(look) || look === "") {
			const s = woodSet(ctx.color, sd)
			return { kind: "wood", side: s.side, end: s.end, main: s.side }
		}
		if (look === "steel") return { kind: "metal", side: steel(), end: steel(), main: steel() }
		if (look === "aluminium") return { kind: "metal", side: alu(), end: alu(), main: alu() }
		if (look === "rubber") return { kind: "rubber", side: rubberMat(ctx.color), end: rubberMat(ctx.color), main: rubberMat(ctx.color) }
		const p = plasticMat(ctx.color)
		return { kind: "other", side: p, end: p, main: p }
	}

	// ------------------------------------------------------------- geometry
	/** Re-map a rounded box's uv to true scale: along the grain (axis 0 = x, 1 = y, 2 = z) u = position / tu, across v = position / tv (the side wood tiles, so these
	 *  wrap freely). The faces cut across the grain show end grain, whose tile does NOT repeat seamlessly (its rings would jump along the wrap line), so an end face
	 *  never wraps: it takes the tile's scale te, or a larger one (1.05 x its bigger side) when it is bigger than the tile, and a seeded place inside the tile. */
	function uvBox(g, grain, tu, tv, te, seed) {
		const pos = g.attributes.position
		const uv = g.attributes.uv
		const o0 = (seed * 0.6180339) % 1
		const o1 = (seed * 0.3819661) % 1
		g.computeBoundingBox()
		const mn = [g.boundingBox.min.x, g.boundingBox.min.y, g.boundingBox.min.z]
		const ext = [g.boundingBox.max.x - mn[0], g.boundingBox.max.y - mn[1], g.boundingBox.max.z - mn[2]]
		const a1 = (grain + 1) % 3
		const a2 = (grain + 2) % 3
		const teF = Math.max(te, 1.05 * Math.max(ext[a1], ext[a2]))
		const e0 = o0 * (1 - ext[a1] / teF)
		const e1 = o1 * (1 - ext[a2] / teF)
		const p = [0, 0, 0]
		for (const grp of g.groups) {
			const face = grp.materialIndex >> 1
			for (let i = grp.start; i < grp.start + grp.count; i++) {
				p[0] = pos.getX(i)
				p[1] = pos.getY(i)
				p[2] = pos.getZ(i)
				if (face === grain) uv.setXY(i, (p[a1] - mn[a1]) / teF + e0, (p[a2] - mn[a2]) / teF + e1)
				else uv.setXY(i, p[grain] / tu + o0, p[3 - grain - face] / tv + o1)
			}
		}
		uv.needsUpdate = true
	}
	/** A rounded box centred on the origin (radius r), uv at true scale along the grain axis. Faces in three's box order: +x -x +y -y +z -z. */
	function rbox(w, h, d, r = 0.001, { grain = 0, tu = 0.24, tv = 0.12, te = 0.1, seed = 1, seg = 3, uv = true } = {}) {
		const rr = Math.max(1e-5, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6, d / 2 - 1e-6))
		return kit.geo(`mrbox|${f5(w)}|${f5(h)}|${f5(d)}|${f5(rr)}|${grain}|${tu}|${tv}|${te}|${seed}|${seg}|${uv}`, () => {
			const g = new RoundedBoxGeometry(w, h, d, seg, rr)
			if (uv) uvBox(g, grain, tu, tv, te, seed)
			return g
		})
	}
	/** The six face materials of a box: the faces cut across `grain` get `end`. */
	const faces = (side, end, grain = 0) => [0, 1, 2, 3, 4, 5].map((i) => ((i >> 1) === grain ? end : side))

	/** Rounded rectangle outline (x-y). */
	function roundRect(w, h, r) {
		const s = new T.Shape()
		const x = -w / 2
		const y = -h / 2
		r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6)
		s.moveTo(x + r, y)
		s.lineTo(x + w - r, y)
		s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
		s.lineTo(x + w, y + h - r)
		s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
		s.lineTo(x + r, y + h)
		s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
		s.lineTo(x, y + r)
		s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
		return s
	}
	/** A shape extruded through z (centred), the cap faces at the shape and a rounded bevel growing the outline by `bevel`; so give the shape
	 *  `bevel` less than the final size. depth = the final thickness. */
	function extrudeShape(key, shape, depth, bevel = 0.0005, segs = 10) {
		return kit.geo(`mext|${key}|${f5(depth)}|${f5(bevel)}|${segs}`, () => {
			const dd = Math.max(1e-5, depth - 2 * bevel)
			const g = new T.ExtrudeGeometry(shape, { depth: dd, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: segs })
			g.translate(0, 0, -dd / 2)
			return toCreasedNormals(g, 0.75)
		})
	}

	/** The same, but extruded along y (centred): the shape's x stays x and its y becomes -z (so +y of the shape points to the back). */
	function extrudeShapeY(key, shape, height, bevel = 0.0005, segs = 32) {
		return kit.geo(`mextY|${key}|${f5(height)}|${f5(bevel)}|${segs}`, () => {
			const dd = Math.max(1e-5, height - 2 * bevel)
			const g = new T.ExtrudeGeometry(shape, { depth: dd, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: segs })
			g.translate(0, 0, -dd / 2)
			g.rotateX(-Math.PI / 2)
			return toCreasedNormals(g, 0.75)
		})
	}

	/** A flat disc (axis y) with a raised rim: washers, spring seats. */
	function washer(R, h = 0.0008, hole = 0) {
		return kit.geo(`mwash|${f5(R)}|${f5(h)}|${f5(hole)}`, () => new T.LatheGeometry([[hole, 0], [R - h * 0.5, 0], [R, h * 0.5], [R - h * 0.5, h], [hole, h]].map(([r, y]) => new T.Vector2(r, y)), 28))
	}
	/** A cylinder-head screw standing on +y: dome head of radius r and height ~0.55 r, with a slot cut as a dark groove (second geometry). */
	function screwHead(r) {
		return kit.geo(`mscrew|${f5(r)}`, () => {
			const prof = [new T.Vector2(0, 0), new T.Vector2(r, 0)]
			const n = 4
			for (let i = 1; i <= n; i++) {
				const a = (i / n) * (Math.PI / 2)
				prof.push(new T.Vector2(r * Math.cos(a), 0.5 * r * Math.sin(a)))
			}
			return new T.LatheGeometry(prof, 14)
		})
	}
	/** A countersunk screw head standing on +y: nearly flush (0.3 mm proud), for faces whose depth the part must not exceed. */
	function csHead(r) {
		return kit.geo(`mcsunk|${f5(r)}`, () => new T.LatheGeometry([[0, 0], [r, 0], [r, 0.00012], [r * 0.88, 0.0003], [0, 0.0003]].map(([x, y]) => new T.Vector2(x, y)), 14))
	}
	const slotBox = (r) => kit.geo(`mslot|${f5(r)}`, () => new T.BoxGeometry(2 * r * 0.78, 0.0003, r * 0.22))
	/** A dome-head screw (radius r, 0.5 r tall) standing on +y with its slot really cut across it (along x, 0.22 r wide, down to the surface): the head is two half domes
	 *  (rings of the dome's profile, each ending where the slot's walls cut it) and the slot's two walls and floor are a second, dark geometry. {head, inner}. */
	function slotScrew(r) {
		const s = 0.11 * r
		const m = 4
		const seg = 8
		const aMax = Math.acos(s / r)
		const ring = (i) => {
			const a = (aMax * i) / m
			return [r * Math.cos(a), 0.5 * r * Math.sin(a)]
		}
		const head = kit.geo(`mscrewS|${f5(r)}`, () => {
			const P = []
			const I = []
			for (const half of [1, -1]) {
				const base = P.length / 3
				for (let i = 0; i <= m; i++) {
					const [rho, y] = ring(i)
					const p0 = Math.asin(Math.min(1, s / rho))
					for (let j = 0; j <= seg; j++) {
						const ph = p0 + ((Math.PI - 2 * p0) * j) / seg
						P.push(rho * Math.cos(ph), y, half * rho * Math.sin(ph))
					}
				}
				for (let i = 0; i < m; i++)
					for (let j = 0; j < seg; j++) {
						const A = base + i * (seg + 1) + j
						const B = A + seg + 1
						if (half > 0) I.push(A, B, A + 1, B, B + 1, A + 1)
						else I.push(A, A + 1, B, B, A + 1, B + 1)
					}
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.BufferAttribute(new Float32Array(P), 3))
			g.setIndex(I)
			g.computeVertexNormals()
			return g
		})
		const inner = kit.geo(`mscrewSI|${f5(r)}`, () => {
			const f = 0.00004
			const top = []
			for (let i = 0; i <= m; i++) { const [rho, y] = ring(i); top.push([-Math.sqrt(Math.max(0, rho * rho - s * s)), Math.max(y, f)]) }
			for (let i = m - 1; i >= 0; i--) { const [rho, y] = ring(i); top.push([Math.sqrt(Math.max(0, rho * rho - s * s)), Math.max(y, f)]) }
			const P = []
			const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d)
			for (const z of [-s, s])
				for (let k = 0; k + 1 < top.length; k++) quad([top[k][0], f, z], [top[k + 1][0], f, z], [top[k + 1][0], top[k + 1][1], z], [top[k][0], top[k][1], z])
			const X = top[top.length - 1][0]
			quad([-X, f, -s], [X, f, -s], [X, f, s], [-X, f, s])
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.BufferAttribute(new Float32Array(P), 3))
			g.computeVertexNormals()
			return g
		})
		return { head, inner }
	}
	/** A slotted dome-head screw as one group (the slot turned `spin` radians about the screw's axis). */
	function slottedScrew(r, spin = 0) {
		const { head, inner } = slotScrew(r)
		const g = kit.group(kit.mesh(head, steel("#9aa0a6")), kit.mesh(inner, MAT("screwSlot", { color: "#17181b", roughness: 0.6, metalness: 0.6, side: T.DoubleSide }), { cast: false }))
		g.rotation.y = spin
		return g
	}

	/** Group helper: a mesh at a position / rotation. */
	function put(m, x = 0, y = 0, z = 0, rx, ry, rz) {
		m.position.set(x, y, z)
		if (rx !== undefined || ry !== undefined || rz !== undefined) m.rotation.set(rx ?? 0, ry ?? 0, rz ?? 0)
		return m
	}
	/** A decal: a thin shell over a surface carrying a transparent drawing (text, stamped numbers). */
	function decalMat(key, w, h, draw) {
		return MAT(`decal|${key}`, { map: kit.tex(`mechDecal|${key}`, w, h, draw, { wrap: false }), transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
	}

	/** A round wire of radius r along a smooth path through the points [[x, y, z], ...] (cached under key). */
	function wire(key, pts, r, { closed = false, radial = 10, per = 8 } = {}) {
		return kit.geo(`mwire|${key}|${f5(r)}|${closed}|${radial}|${per}`, () => {
			const curve = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(p[0], p[1], p[2] ?? 0)), closed, "centripetal")
			return new T.TubeGeometry(curve, Math.max(4, pts.length * per), r, radial, closed)
		})
	}
	/** A stadium outline (two half circles joined by straight sides): total width w (x) and depth d (y of the shape), w >= d. */
	function stadium(w, d, inset = 0) {
		const r = d / 2 - inset
		const a = w / 2 - d / 2
		const s = new T.Shape()
		s.moveTo(-a, -r)
		s.lineTo(a, -r)
		s.absarc(a, 0, r, -HALFPI, HALFPI, false)
		s.lineTo(-a, r)
		s.absarc(-a, 0, r, HALFPI, 3 * HALFPI, false)
		return s
	}
	const HALFPI = Math.PI / 2
	/** A non-indexed geometry (an extrusion, say) given true-scale wood uv by each triangle's facing, and two material groups: 0 = the long faces,
	 *  1 = the faces cut across `grain` (axis 0 = x, 1 = y, 2 = z). Cached under key. */
	function woodGeo(key, make, { grain = 1, tu = 0.24, tv = 0.12, te = 0.1, seed = 1 } = {}) {
		return kit.geo(`mwoodGeo|${key}|${grain}|${tu}|${tv}|${te}|${seed}`, () => {
			let g = make()
			if (g.index) g = g.toNonIndexed()
			const pos = g.attributes.position
			const nor = g.attributes.normal
			const n = pos.count
			const o0 = (seed * 0.6180339) % 1
			const o1 = (seed * 0.3819661) % 1
			const faceOf = (i) => {
				const ax = Math.abs(nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2))
				const ay = Math.abs(nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2))
				const az = Math.abs(nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2))
				return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
			}
			const side = []
			const end = []
			for (let i = 0; i < n; i += 3) (faceOf(i) === grain ? end : side).push(i)
			// the end faces never wrap (the end-grain tile does not repeat seamlessly): the tile's scale, or 1.05 x the bigger side when that is larger, from the faces' own corner
			const a1 = (grain + 1) % 3
			const a2 = (grain + 2) % 3
			const lo = [Infinity, Infinity, Infinity]
			const hi = [-Infinity, -Infinity, -Infinity]
			const gp = [0, 0, 0]
			for (const i of end) for (let k = 0; k < 3; k++) {
				gp[0] = pos.getX(i + k); gp[1] = pos.getY(i + k); gp[2] = pos.getZ(i + k)
				for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], gp[q]); hi[q] = Math.max(hi[q], gp[q]) }
			}
			const teF = end.length ? Math.max(te, 1.05 * Math.max(hi[a1] - lo[a1], hi[a2] - lo[a2])) : te
			const e0 = end.length ? o0 * (1 - (hi[a1] - lo[a1]) / teF) : 0
			const e1 = end.length ? o1 * (1 - (hi[a2] - lo[a2]) / teF) : 0
			const order = [...side, ...end]
			const P = new Float32Array(n * 3)
			const N = new Float32Array(n * 3)
			const U = new Float32Array(n * 2)
			const p = [0, 0, 0]
			let w = 0
			for (const i of order) {
				const face = faceOf(i)
				for (let k = 0; k < 3; k++, w++) {
					p[0] = pos.getX(i + k)
					p[1] = pos.getY(i + k)
					p[2] = pos.getZ(i + k)
					P.set(p, w * 3)
					N[w * 3] = nor.getX(i + k)
					N[w * 3 + 1] = nor.getY(i + k)
					N[w * 3 + 2] = nor.getZ(i + k)
					if (face === grain) { U[w * 2] = (p[a1] - lo[a1]) / teF + e0; U[w * 2 + 1] = (p[a2] - lo[a2]) / teF + e1 }
					else { U[w * 2] = p[grain] / tu + o0; U[w * 2 + 1] = p[3 - grain - face] / tv + o1 }
				}
			}
			const out = new T.BufferGeometry()
			out.setAttribute("position", new T.BufferAttribute(P, 3))
			out.setAttribute("normal", new T.BufferAttribute(N, 3))
			out.setAttribute("uv", new T.BufferAttribute(U, 2))
			out.addGroup(0, side.length * 3, 0)
			out.addGroup(side.length * 3, end.length * 3, 1)
			return out
		})
	}

	const creased = (g, a = 0.75) => toCreasedNormals(g, a)

	return {
		wire, stadium, woodGeo, creased,
		T, TAU, f5, clamp, mix, hash, hashStr, rng, vnoise, rgb, css, shadeHex,
		normalTex, woodTex, woodSide, woodSet, endTex, brushedTex, forgedNormal,
		MAT, metal, steel, zinc, brass, chrome, alu, darkSteel, forged, rubberMat, plasticMat, paint, rich, richCss, grade, skin,
		uvBox, rbox, faces, roundRect, extrudeShape, extrudeShapeY, washer, screwHead, csHead, slotBox, slottedScrew, put, decalMat,
		mergeGeometries,
	}
}
