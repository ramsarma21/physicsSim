// 3D models of the softbody module (machines/mod_softbody.py): squashy clay, inflated and foam balls that flatten where they press, bending
// rulers, springboards and planks, the rubber-band launcher and the band wound on a rubber-band car.
//  - Round soft things are drawn as spheres flattened every frame where the engine says they are flat (frame hook "softbody:shape": the run's
//    series "shape" of the item, [angle, depth, ...] in the ball's own frame: clay's permanent flats and every contact's squash). The sphere
//    grows a little as it flattens, so clay keeps its volume (an inflated ball's gas gives a little: half that).
//  - A beam is its rigid segments, each drawn as its own piece of the board or ruler (a ruler's centimetre ticks run on across them), so its
//    bend is the engine's (a joint turns a few tenths of a degree under a lesson's loads: no seam shows).
//  - The launcher's board carries its two posts; the band's strands are drawn every frame from the posts to the pouch (view plugin
//    "softbody:bands"; a snapped band hangs limp from its posts), as is the band wound on a rubber-band car's rear axle (it shrinks as it
//    unwinds).
import { frameIndex } from "../track.js"
import { makeLib } from "./surfaces-lib.js"

/** The run on screen (its track: the series of each soft ball's shape), set by the view plugin when a run loads. */
let RUN = null

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const T = THREE
	const M = L.M

	// ------------------------------------------------------------- materials
	const clayMat = (hex) => {
		const t = L.bake("sb-clay2", 256, 256, (u, v, o) => {
			// a kneaded surface: soft lumps and the fine smears of fingers
			const lump = L.pfbm(u, v, 6, 6, 501, 4)
			const smear = L.pn(u * 3 + 0.4 * v, v * 0.6, 40, 12, 502)
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.35 * (lump - 0.5) + 0.12 * (smear - 0.5)
			o.rough = 0.8
		}, { normal: 1.0, blur: 1 })
		return M(`sb-clay|${hex}`, { color: hex, normalMap: t.normalMap, normalScale: L.V2(0.35), roughness: 0.72, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new T.Color("#ffffff") })
	}
	const pvcMat = (hex) => M(`sb-pvc|${hex}`, { color: hex, roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.2, sheenRoughness: 0.5, sheenColor: new T.Color("#ffffff") })
	const leather = () => L.rubber("#5b3b22", 1, { roughness: 0.9 })
	const bandMat = (hex) => M(`sb-band|${hex}`, { color: hex, roughness: 0.62, metalness: 0, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new T.Color("#f3d6b8") })
	const tickMat = () => M("sb-tick", { color: "#1d1d1f", roughness: 0.6, metalness: 0 })

	// ------------------------------------------------------------- deformable balls
	const SEG = 56
	function ball(ctx, mat, { R = ctx.r, seams = 0 } = {}) {
		const geo = new T.SphereGeometry(R, SEG, Math.round(SEG * 0.75))
		const m = kit.mesh(geo, mat)
		m.userData.frame = { hook: "softbody:shape", R, bulge: ctx.solid.itemType === "soft-clay" ? 1 : 0.5 }
		const g = kit.group(m)
		if (seams > 0) {
			// an inflated ball's moulding seams: thin raised rings (they flatten with it: drawn on the same sphere as faint lines in the texture would be
			// lost; a ring a hair proud of the surface reads at a distance)
			for (let k = 0; k < seams; k++) {
				const ring = kit.mesh(new T.TorusGeometry(R * 1.001, R * 0.008, 6, 96), M("sb-seam", { color: "#ffffff", roughness: 0.5, metalness: 0, transparent: true, opacity: 0.35 }))
				ring.rotation.y = (k * Math.PI) / seams
				ring.userData.frame = { hook: "softbody:ring", R }
				g.add(ring)
			}
		}
		return g
	}
	const colorOf = (ctx, fallback) => ctx.solid.color ?? fallback
	addModel("soft-clay", "clay", (ctx) => ball(ctx, clayMat(colorOf(ctx, "#4f9a5a"))))
	addModel("playground-ball", "ball", (ctx) => ball(ctx, L.rubber(colorOf(ctx, "#d6342b"), 1 / Math.max(0.05, ctx.r)), { seams: 2 }))
	addModel("exercise-ball", "ball", (ctx) => ball(ctx, pvcMat(colorOf(ctx, "#3a7bd5")), { seams: 3 }))
	addModel("foam-ball", "ball", (ctx) => ball(ctx, L.foamMat(colorOf(ctx, "#f5c433"))))

	/** The shape of an item at time t: [angle, depth, ...] in its own frame, from the run's series (none: round). */
	const shapeAt = (item, t) => {
		const tr = RUN
		const list = tr?.series?.[item]?.shape
		if (!Array.isArray(list) || !list.length) return null
		const i = frameIndex(tr, t)
		return list[Math.min(i, list.length - 1)] ?? null
	}
	addFrameHook("softbody:shape", (obj, f, a) => {
		const shape = shapeAt(f.item, f.t)
		const key = shape ? shape.join(",") : ""
		if (obj.userData.sbKey === key) return
		obj.userData.sbKey = key
		if (!obj.userData.sbBase) {
			// (the model's sphere is shared by every clone: this one gets its own to bend)
			obj.geometry = obj.geometry.clone()
			obj.userData.sbBase = Float32Array.from(obj.geometry.attributes.position.array)
		}
		const pos = obj.geometry.attributes.position
		const base = obj.userData.sbBase
		const R = a.R
		// the sphere grows as its flats take volume away (clay keeps its volume; a ball's gas gives half of it)
		let cut = 0
		const flats = []
		for (let k = 0; shape && k + 1 < shape.length; k += 2) {
			const d = Math.max(0, Math.min(0.9 * R, shape[k + 1]))
			if (d < 1e-5) continue
			flats.push([Math.cos(shape[k]), Math.sin(shape[k]), R - d])
			cut += (Math.PI * d * d * (3 * R - d)) / 3
		}
		const V0 = (4 / 3) * Math.PI * R * R * R
		const s = flats.length ? Math.cbrt(V0 / Math.max(V0 * 0.3, V0 - cut * a.bulge)) : 1
		for (let i = 0; i < pos.count; i++) {
			let x = base[3 * i] * s
			let y = base[3 * i + 1] * s
			const z = base[3 * i + 2] * s
			for (const [ux, uy, lim] of flats) {
				const p = x * ux + y * uy
				if (p > lim) {
					x -= (p - lim) * ux
					y -= (p - lim) * uy
				}
			}
			pos.setXYZ(i, x, y, z)
		}
		pos.needsUpdate = true
		obj.geometry.computeVertexNormals()
		obj.geometry.computeBoundingSphere()
	})
	// (a seam ring hides while the ball is squashed: it would poke out through the flat)
	addFrameHook("softbody:ring", (obj, f) => {
		const shape = shapeAt(f.item, f.t)
		let deepest = 0
		for (let k = 1; shape && k < shape.length; k += 2) deepest = Math.max(deepest, shape[k])
		obj.visible = deepest < 0.002
	})

	// ------------------------------------------------------------- beams
	const BEAM_TYPES = ["flex-ruler", "springboard", "flex-plank"]
	/** A piece of a beam: a board of its look (acrylic: clear plastic), with a ruler's centimetre ticks on its top along its front edge. */
	function piece(ctx) {
		const look = ctx.solid.look ?? ""
		const w = ctx.w
		const h = ctx.h
		const d = ctx.d
		let body
		if (look === "acrylic") {
			// a clear acrylic ruler: tinted where it is thick (seen along its width) and bright on its polished edges
			body = kit.mesh(kit.box(w, h, d, Math.min(0.0006, h * 0.3)), M(`sb-acrylic|${ctx.solid.color ?? ""}`, {
				color: ctx.solid.color ?? "#cfe6f7", roughness: 0.12, metalness: 0, transmission: 0.55, thickness: 0.03, ior: 1.49,
				attenuationColor: new T.Color(ctx.solid.color ?? "#6fb2e3"), attenuationDistance: 0.02, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1
			}))
		} else body = L.board(ctx, { r: Math.min(0.0006, h * 0.3) })
		const g = kit.group(body)
		if (ctx.solid.itemType === "flex-ruler") {
			// where this piece lies along the ruler, from its clamped end: a segment's index × its length, after the clamped part
			const P = ctx.props ?? {}
			const L0 = P.length ?? 0.3
			const over = Math.min(P.overhang ?? 0.2, L0 - 0.04)
			const held = L0 - over
			const s = (P.facing ?? "right") === "right" ? 1 : -1
			const part = ctx.solid.part ?? ""
			const k = /^seg(\d+)$/.exec(part)
			const from = part === "held" ? 0 : k ? held + (Number(k[1]) - 1) * w : 0
			const ticks = []
			for (let mm = Math.ceil(from * 1000); mm <= Math.floor((from + w) * 1000); mm++) {
				if (mm <= 0 || mm >= L0 * 1000) continue
				const cmTick = mm % 10 === 0
				const half = mm % 5 === 0
				// (millimetre ticks only on a ruler of 40 cm or less: a metre stick shows centimetres and halves)
				if (!half && L0 > 0.4) continue
				const len = cmTick ? 0.006 : half ? 0.0045 : 0.003
				// (the piece's middle is `from + w/2` along the ruler; facing left, the ruler runs to −x)
				const x = s * (mm / 1000 - from - w / 2)
				const tick = kit.mesh(kit.box(cmTick ? 0.00035 : 0.00022, 0.00012, len, 0.00005), tickMat(), { cast: false })
				tick.position.set(x, h / 2 + 0.00004, d / 2 - len / 2 - 0.0008)
				ticks.push(tick)
			}
			if (ticks.length) g.add(...ticks)
		}
		return g
	}
	for (const type of BEAM_TYPES) {
		addModel(type, "held", piece)
		for (let i = 1; i <= 16; i++) addModel(type, `seg${i}`, piece)
	}
	// the ruler's clamp and the board's: a small steel C-clamp block (a screw and its pad on top)
	const clampModel = (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const d = ctx.d
		const steel = L.darkSteel()
		const body = kit.mesh(kit.box(w, h, d, Math.min(0.002, h * 0.3)), steel)
		const screw = kit.mesh(new T.CylinderGeometry(w * 0.12, w * 0.12, h * 1.4, 16), L.stainless())
		screw.position.y = h * 0.5
		const knob = kit.mesh(new T.CylinderGeometry(w * 0.28, w * 0.28, h * 0.25, 20), M("sb-knob", { color: "#d83a2c", roughness: 0.4, metalness: 0 }))
		knob.position.y = h * 1.2
		return kit.group(body, screw, knob)
	}
	addModel("flex-ruler", "clamp", clampModel)
	addModel("springboard", "clamp", clampModel)

	// ------------------------------------------------------------- the rubber-band launcher
	addModel("band-launcher", "board", (ctx) => {
		const P = ctx.props ?? {}
		const g = kit.group(L.board(ctx, { r: 0.0012 }))
		const spread = Math.max(P.spread ?? 0.1, 0.09)
		const H = P.height ?? 0.03
		// (the posts stand at the item's anchor: the board's middle is 2.5 cm behind it)
		const px = 0.025
		const top = H + 0.02
		for (const z of [-spread / 2, spread / 2]) {
			const post = kit.mesh(new T.CylinderGeometry(0.006, 0.006, top + ctx.h, 20), L.woodSet("#b98a52", 7).side)
			post.position.set(px, (top + ctx.h) / 2 - ctx.h / 2, z)
			const foot = kit.mesh(kit.box(0.03, 0.012, 0.016, 0.002), L.darkSteel())
			foot.position.set(px, -ctx.h / 2 + 0.006, z)
			const hook = kit.mesh(new T.TorusGeometry(0.004, 0.0009, 8, 20, Math.PI * 1.4), L.stainless())
			hook.position.set(px, top - ctx.h / 2 - 0.02 + ctx.h, z)
			g.add(post, foot, hook)
		}
		return g
	})
	addModel("band-launcher", "pouch", (ctx) => kit.mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0008), leather()))
	addModel("band-launcher", "flap1", (ctx) => kit.mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0008), leather()))
	addModel("band-launcher", "flap2", (ctx) => kit.mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0008), leather()))

	// ------------------------------------------------------------- bands drawn each frame (launchers' strands, rubber-band cars' bands)
	const UP = new T.Vector3(0, 1, 0)
	const DIR = new T.Vector3()
	/** A strand of rubber between two world points (it thins as it stretches: the rubber keeps its volume). */
	function strand(group, radius, mat) {
		const geo = new T.CylinderGeometry(1, 1, 1, 8, 1)
		const mesh = kit.mesh(geo, mat)
		group.add(mesh)
		return {
			set(a, b, rest) {
				DIR.set(b.x - a.x, b.y - a.y, b.z - a.z)
				const len = DIR.length()
				mesh.visible = len > 1e-5
				if (!mesh.visible) return
				mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
				mesh.quaternion.setFromUnitVectors(UP, DIR.divideScalar(len))
				const thin = rest > 0 ? Math.sqrt(Math.min(1, rest / len)) : 1
				mesh.scale.set(radius * thin, len, radius * thin)
			},
			dispose: () => geo.dispose()
		}
	}
	// (drawn a little thicker than the strands are, flat 0.8 mm bands seen from 1-2 m: so the band shows in a lesson's wide shot)
const BAND_R = { thin: 0.0012, medium: 0.0018, thick: 0.0025 }
	addViewPlugin({
		name: "softbody:bands",
		load(ctx) {
			RUN = ctx.track ?? null
			const recs = (ctx.doc?.processes ?? []).filter((r) => r.kind === "softbody" && (r.role === "band" || r.role === "motor"))
			if (!recs.length) return null
			const parts = []
			for (const r of recs) {
				if (r.role === "band") {
					const item = (ctx.doc.solids ?? []).find((s) => s.id === r.pad)
					const P = ctx.resolved?.[r.item] ?? {}
					const size = P.band ?? "medium"
					const mat = bandMat("#d9a066")
					const n = Math.max(1, r.n ?? 1)
					const lines = []
					for (const side of [-1, 1]) for (let k = 0; k < n; k++) lines.push({ side, k, s: strand(ctx.group, BAND_R[size] ?? 0.0011, mat) })
					parts.push({
						frame(t) {
							const p = ctx.placementAt(r.pad, t)
							if (!p || !item) return
							// the band meets the pouch at its back, across its width; the posts' hooks at the anchor, either side of the board
							const half = (r.spread ?? 0.1) / 2
							// (snapped: each strand hangs limp from its post, 3 cm, as a broken band does)
							const snapped = (ctx.stateAt(r.item, "broken", t) ?? 0) >= 1
							for (const { side, k, s } of lines) {
								const dz = (k - (n - 1) / 2) * 0.0035
								if (snapped) s.set({ x: r.anchor.x, y: r.anchor.y, z: side * half + dz }, { x: r.anchor.x - 0.004, y: r.anchor.y - 0.03, z: side * half + dz }, 0)
								else s.set({ x: r.anchor.x, y: r.anchor.y, z: side * half + dz }, { x: p.x, y: p.y, z: side * 0.012 + dz }, r.l0)
							}
						},
						dispose() {
							for (const { s } of lines) s.dispose()
						}
					})
				} else {
					// a rubber-band car: the band from a hook under the front of its body to its rear axle, and the turns wound on the axle
					const P = ctx.resolved?.[r.item] ?? {}
					const mat = bandMat("#c9875a")
					const radius = BAND_R[P.band_size ?? "medium"] ?? 0.0011
					const a = strand(ctx.group, radius, mat)
					const b = strand(ctx.group, radius, mat)
					const coilGeo = new T.CylinderGeometry(1, 1, 1, 18, 1, true)
					const coil = kit.mesh(coilGeo, mat)
					coil.rotation.x = Math.PI / 2
					ctx.group.add(coil)
					const chassis = (ctx.doc.solids ?? []).find((s) => s.id === r.chassis)
					const halfLen = chassis?.body?.width ? chassis.body.width / 2 : 0.1
					parts.push({
						frame(t) {
							const c = ctx.placementAt(r.chassis, t)
							const w = ctx.placementAt(r.wheel, t)
							if (!c || !w) return
							const turns = Math.max(0, ctx.stateAt(r.item, "band_turns", t) ?? r.turns ?? 0)
							const ca = Math.cos(c.angle)
							const sa = Math.sin(c.angle)
							// (the hook: 80 % of the way to the body's front, at the axle's height in the body's frame)
							const ly = -(w.x - c.x) * sa + (w.y - c.y) * ca
							const hx = c.x + 0.8 * halfLen * ca - ly * sa
							const hy = c.y + 0.8 * halfLen * sa + ly * ca
							for (const [s, z] of [[a, -0.004], [b, 0.004]]) s.set({ x: hx, y: hy, z }, { x: w.x, y: w.y, z }, 0)
							const R = (r.r ?? 0.0025) + turns * radius * 0.35
							coil.visible = turns > 0.05
							coil.position.set(w.x, w.y, 0)
							coil.scale.set(R, Math.max(0.006, radius * 6), R)
						},
						dispose() {
							a.dispose()
							b.dispose()
							coilGeo.dispose()
						}
					})
				}
			}
			return {
				frame(t) {
					for (const p of parts) p.frame(t)
				},
				dispose() {
					for (const p of parts) p.dispose()
				}
			}
		}
	})
	// (a run of soft balls only, without bands: the plugin above still records the run for the shape hook)
	addViewPlugin({
		name: "softbody:run",
		load(ctx) {
			RUN = ctx.track ?? null
			return null
		}
	})
	void ownMaterial
}
