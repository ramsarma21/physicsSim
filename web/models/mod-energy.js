// 3D models of the energy module (machines/mod_energy.py): a paper windmill (pinwheel) on its wooden post and straw axle, a model wind turbine
// (round base with its terminals, aluminium tower, nacelle, crimping hub and flat blades), a small generator on its base, the paper cup of
// pennies a spool lifts, a spool on a waterwheel's axle, and a battery car's yellow gear motor (circuits' motor that drives "wheels").
// A rotor's blades turn about its shaft along the wind, so the engine turns a hidden stand-in instead: the blades are drawn on the item's fixed
// post or nacelle and turned by the frame hook "energy:rotor" from the rotor's `angle` reading (above 450 rpm they blur into a disc, as a camera
// sees them). A generator's pulley turns with its `angle` ("energy:pulley"); the view plugin "energy:belts" draws the belt from the shaft it is
// coupled to (a pulley there that turns with it) to the generator's pulley. The thread is the mechanics module's spool cord (mechanics:cords).
const DEG = Math.PI / 180
const SAIL_COLORS = ["#e53935", "#fdd835", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa", "#00acc1", "#f06292"]
const BLADE_COLORS = { "corrugated plastic": "#e9eef3", cardboard: "#c9a26b", balsa: "#e6cf9e" }
const BLUR_FROM = 450 // rpm: from here the blades fade into a blur disc (fully above BLUR_FROM + 900)

export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const T = THREE
	const put = (o, x = 0, y = 0, z = 0) => (o.position.set(x, y, z), o)
	const mesh = (g, m, opt) => kit.mesh(g, m, opt)
	const group = (...c) => kit.group(...c)
	const f5 = (v) => Number(v).toFixed(5)
	const M = (key, p) => kit.mat(`energy|${key}`, p)
	const wood = () => kit.wood("#c99a64", { roughness: 0.55, varnish: 0.4 })
	const steel = () => kit.steel()
	const brass = () => M("brass", { color: "#d1aa4a", roughness: 0.28, metalness: 1 })
	const strawMat = () => M("straw", { color: "#f4f4f2", roughness: 0.35, metalness: 0, clearcoat: 0.4 })
	const paint = (hex, gloss = 0.4) => kit.plastic(hex, { gloss, key: "energy" })
	const side = (props) => (props?.facing === "right" ? -1 : 1)

	/** A twisted sail or blade: a thin ribbon from r0 to R along +y, chord c(r) straight from c0 to c1, pitched β(r) from the rotor's plane (y-z),
	 *  its leading edge toward +z (the way the rotor turns about +x) and upwind (−x); `bow` cups it a little (a paper sail's curve). */
	const ribbon = (r0, R, c0, c1, b0, b1, bow, key) =>
		kit.geo(`energy|ribbon|${key}`, () => {
			const n = 12
			const m = 5
			const pos = []
			const idx = []
			for (let i = 0; i <= n; i++) {
				const u = i / n
				const r = r0 + (R - r0) * u
				const c = c0 + (c1 - c0) * u
				const b = b0 + (b1 - b0) * u
				for (let j = 0; j <= m; j++) {
					const v = j / m - 0.5 // −½ trailing … +½ leading
					const camber = bow * c * (0.25 - v * v) // (a shallow arc, its belly downwind)
					pos.push(-Math.sin(b) * c * v + Math.cos(b) * camber, r, Math.cos(b) * c * v + Math.sin(b) * camber)
				}
			}
			for (let i = 0; i < n; i++)
				for (let j = 0; j < m; j++) {
					const a = i * (m + 1) + j
					const b = a + m + 1
					idx.push(a, b, a + 1, b, b + 1, a + 1)
				}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.Float32BufferAttribute(pos, 3))
			g.setIndex(idx)
			g.computeVertexNormals()
			return g
		})
	/** A rotor's head: what turns with it about its post or tower when it is turned `yaw` toward the camera (machines/mod_energy.py _head: the
	 *  spool and the thread move with it), its frame the item's (x along the picture before the turn). */
	const headGroup = (props) => {
		const g = new T.Group()
		g.rotation.y = side(props) * (props?.yaw ?? 0) * DEG
		return g
	}
	/** The rotor group: turned to face its wind, its spinning part (named "rotor") turned by the frame hook (put it in the head). */
	const rotorGroup = (props, spin, R, blurColor) => {
		const yaw = new T.Group()
		yaw.rotation.y = side(props) > 0 ? 0 : Math.PI
		spin.name = "rotor"
		yaw.add(spin)
		const blur = mesh(kit.cylinderY(R, 0.0008, 64).clone().rotateZ(Math.PI / 2), new T.MeshBasicMaterial({ color: new T.Color(blurColor), transparent: true, opacity: 0, depthWrite: false }), { cast: false })
		blur.name = "blur"
		yaw.add(blur)
		return yaw
	}
	addFrameHook("energy:rotor", (obj, f) => {
		const spin = obj.getObjectByName("rotor")
		if (!spin) return
		const ang = Number(f.state?.angle) || 0
		const rpm = Math.abs(Number(f.state?.rpm) || 0)
		const fast = Math.max(0, Math.min(1, (rpm - BLUR_FROM) / 900))
		// (fast blades: the eye and the camera see a disc, turning at a fraction of their speed)
		spin.rotation.x = fast > 0.95 ? ang * 0.03 : ang
		const blur = obj.getObjectByName("blur")
		if (blur) ownMaterial(blur).opacity = 0.32 * fast
		spin.traverse((o) => {
			if (o.isMesh && o.userData.blade) o.visible = fast < 0.98
		})
	})

	// ------------------------------------------------------------------ the paper windmill
	addModel("pinwheel", "foot", (ctx) => group(mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.0015), wood())))
	addModel("pinwheel", "hub", () => null)
	addModel("pinwheel", "post", (ctx) => {
		const P = ctx.props ?? {}
		const s = side(P)
		const H = P.height ?? 0.3
		const out = [mesh(kit.box(ctx.w, ctx.h, ctx.d, 0.001), wood())]
		// (the post's middle is its origin: the straw at the axle's height H)
		const cy = 0.012 + (H - 0.002) / 2 - 0.005
		const ay = H - cy
		const rx = -s * 0.04
		const sx = s * 0.08
		// the head, turned with the windmill toward you: the straw axle through the post's top, from the sails to the thread's end
		const head = put(headGroup(P), 0, ay, 0)
		out.push(head)
		const len = Math.abs(sx - rx) + 0.016
		head.add(put(mesh(kit.cylinderY(0.003, len, 20).clone().rotateZ(Math.PI / 2), strawMat()), (rx + sx) / 2 + s * 0.004, 0, 0))
		const mm = P.axle_mm ?? 6
		if (mm > 6.5) head.add(put(mesh(kit.cylinderY(mm / 2000, 0.02, 32).clone().rotateZ(Math.PI / 2), wood()), sx, 0, 0))
		else if (mm < 5.5) head.add(put(mesh(kit.cylinderY(mm / 2000, 0.03, 12).clone().rotateZ(Math.PI / 2), M("skewer", { color: "#d8b98a", roughness: 0.7 })), sx + s * 0.01, 0, 0))
		// the sails: B twisted paper sails round a bead, their solidity 0.3 (machines/mod_energy.py PIN_SOLIDITY, PIN_TWIST)
		const B = Math.max(2, Math.round(P.blades ?? 4))
		const R = (P.diameter ?? 0.2) / 2
		const r0 = 0.012
		const c0 = (0.3 * 2 * Math.PI * r0) / B
		const c1 = (0.3 * 2 * Math.PI * R) / B
		const pitch = P.pitch ?? 18
		const geo = ribbon(r0, R, c0, c1, Math.min(80, pitch + 15) * DEG, pitch * DEG, 0.18, `sail|${B}|${f5(R)}|${f5(pitch)}`)
		const spin = new T.Group()
		for (let b = 0; b < B; b++) {
			const sail = mesh(geo, M(`sail${b % SAIL_COLORS.length}`, { color: SAIL_COLORS[b % SAIL_COLORS.length], roughness: 0.75, metalness: 0, side: T.DoubleSide }))
			sail.userData.blade = true
			sail.rotation.x = (2 * Math.PI * b) / B
			spin.add(sail)
		}
		spin.add(mesh(kit.sphere(0.006, 20, 12), paint("#f5f5f5", 0.6)))
		spin.add(put(mesh(kit.cylinderY(0.0012, 0.03, 8).clone().rotateZ(Math.PI / 2), steel()), -0.008, 0, 0))
		head.add(put(rotorGroup(P, spin, R, "#e8a33c"), rx, 0, 0))
		const g = group(out)
		g.userData.frame = { hook: "energy:rotor" }
		return g
	})

	// ------------------------------------------------------------------ the paper cup of pennies a spool lifts (any machine's `load`)
	const cupModel = (zOff) => (ctx) => {
		const P = ctx.props ?? {}
		const H = 0.06
		const rb = 0.019
		const rt = 0.025
		const t = 0.0006
		const wall = [[0, -H / 2], [rb, -H / 2], [rb + 0.0005, -H / 2 + 0.002], [rt, H / 2 - 0.002], [rt + 0.0012, H / 2], [rt - t, H / 2], [rb - t + 0.0005, -H / 2 + 0.0025], [0, -H / 2 + 0.0025]]
		const out = [mesh(kit.lathe(wall, 40, "energyCup"), M("cup", { color: "#f7f3ea", roughness: 0.8, metalness: 0, side: T.DoubleSide }))]
		const load = Number(P.load_g ?? 0)
		const n = Math.min(40, Math.max(0, Math.trunc((load - 3) / 2.5)))
		const coin = kit.cylinderY(0.0095, 0.00152, 28)
		for (let k = 0; k < n; k++) {
			const m = mesh(coin, M("penny", { color: "#b46a3c", roughness: 0.35, metalness: 1 }))
			// (a loose stack: each a little off the last)
			put(m, Math.sin(k * 2.3) * 0.004, -H / 2 + 0.0035 + k * 0.0016, Math.cos(k * 1.7) * 0.004)
			m.rotation.z = Math.sin(k * 1.1) * 0.08
			out.push(m)
		}
		// the thread's wire bail across its rim
		const bail = mesh(kit.torus(rt, 0.0006, 6, 24, Math.PI), steel())
		put(bail, 0, H / 2, 0)
		out.push(bail)
		const g = group(out)
		g.position.z = zOff(P)
		return group(g)
	}
	// (behind the picture's plane by as much as the turned head took the spool: mod_energy.py _head)
	addModel("pinwheel", "load", cupModel((P) => -0.08 * Math.sin((P.yaw ?? 0) * DEG)))
	addModel("wind-turbine", "load", cupModel((P) => -0.11 * Math.sin((P.yaw ?? 0) * DEG)))
	addModel("waterwheel", "load", cupModel((P) => (P.paddle_depth ?? 0.06) / 2 + 0.02))
	addModel("waterwheel", "spool", (ctx) => {
		const z = (ctx.props?.paddle_depth ?? 0.06) / 2 + 0.02
		const r = ctx.r ?? 0.006
		const g = group(
			put(mesh(kit.cylinderZ(r, 0.016, 32), wood()), 0, 0, z),
			put(mesh(kit.cylinderZ(r * 1.8, 0.002, 32), wood()), 0, 0, z - 0.009),
			put(mesh(kit.cylinderZ(r * 1.8, 0.002, 32), wood()), 0, 0, z + 0.009),
			put(mesh(kit.cylinderZ(0.003, z + 0.012, 12), steel()), 0, 0, z / 2)
		)
		return g
	})

	// ------------------------------------------------------------------ the model wind turbine
	addModel("wind-turbine", "hub", () => null)
	addModel("wind-turbine", "base", (ctx) => group(mesh(kit.cylinderY(ctx.w / 2, ctx.h, 64), wood())))
	const terminalModel = (color) => (ctx) => {
		const { w, h } = ctx
		const r = w / 2
		return group(
			mesh(kit.lathe([[0, -h / 2], [r, -h / 2], [r, -h / 2 + 0.003], [r * 0.6, -h / 2 + 0.004], [r * 0.6, h / 2 - 0.003]], 20, `energyPost|${f5(w)}|${f5(h)}`), brass()),
			put(mesh(kit.cylinderY(r * 0.95, 0.004, 20), paint(color, 0.5)), 0, h / 2 - 0.002, 0)
		)
	}
	addModel("wind-turbine", "post_plus", terminalModel("#d32f2f"))
	addModel("wind-turbine", "post_minus", terminalModel("#212121"))
	addModel("wind-turbine", "tower", (ctx) => group(mesh(kit.cylinderY(0.0095, ctx.h, 32), kit.aluminium())))
	addModel("wind-turbine", "nacelle", (ctx) => {
		const P = ctx.props ?? {}
		const s = side(P)
		const { w, h, d } = ctx
		const nx = s * 0.02
		const sx = s * 0.11
		// the head turns about the tower (its axis 2 cm behind the nacelle's middle) when the turbine is turned toward you
		const head = put(headGroup(P), -nx, 0, 0)
		const out = [head]
		head.add(put(mesh(kit.box(w, h, d, 0.008), paint("#eef1f4", 0.5)), nx, 0, 0))
		// the generator's black end cap peeking out of its back, the tower's saddle under it
		head.add(put(mesh(kit.cylinderY(0.016, 0.006, 32).clone().rotateZ(Math.PI / 2), paint("#1f2328", 0.4)), nx + s * (w / 2 + 0.003), 0, 0))
		out.push(put(mesh(kit.cylinderY(0.012, 0.008, 24), paint("#9aa1a8", 0.3)), -nx, -h / 2 - 0.003, 0))
		// the shaft out of its back to the spool (when it lifts a load)
		if ((P.load_g ?? 0) > 0) {
			head.add(put(mesh(kit.cylinderY(0.002, Math.abs(sx - nx) - w / 2 + 0.01, 12).clone().rotateZ(Math.PI / 2), steel()), (nx + s * w / 2 + sx) / 2, 0, 0))
			const mm = (P.axle_mm ?? 6) / 2000
			head.add(put(mesh(kit.cylinderY(mm, 0.016, 32).clone().rotateZ(Math.PI / 2), M("spool", { color: "#d6b07a", roughness: 0.6 })), sx, 0, 0))
		}
		// the rotor: a black crimping hub and its nose, B flat blades on dowels at their pitch
		const B = Math.max(2, Math.round(P.blades ?? 3))
		const L = P.blade_length ?? 0.15
		const bw = P.blade_width ?? 0.06
		const r0 = 0.03
		const R = r0 + L
		const pitch = (P.pitch ?? 20) * DEG
		const color = BLADE_COLORS[P.blade_material] ?? BLADE_COLORS["corrugated plastic"]
		const bladeMat = P.blade_material === "balsa" ? kit.wood(color, { roughness: 0.7, varnish: 0.1 }) : M(`blade|${color}`, { color, roughness: 0.6, metalness: 0, side: T.DoubleSide })
		const geo = ribbon(r0 + 0.01, R, bw, bw, pitch, pitch, 0.0, `blade|${f5(L)}|${f5(bw)}|${f5(pitch)}`)
		const dowel = kit.cylinderY(0.003, L + 0.01, 10)
		const spin = new T.Group()
		for (let b = 0; b < B; b++) {
			const arm = new T.Group()
			arm.rotation.x = (2 * Math.PI * b) / B
			const blade = mesh(geo, bladeMat)
			blade.userData.blade = true
			const rod = put(mesh(dowel, M("dowel", { color: "#d8b98a", roughness: 0.7 })), 0.004, r0 + L / 2, 0)
			rod.userData.blade = true
			arm.add(blade, rod)
			spin.add(arm)
		}
		spin.add(mesh(kit.cylinderY(0.025, 0.016, 40).clone().rotateZ(Math.PI / 2), paint("#22262b", 0.5)))
		spin.add(put(mesh(kit.sphere(0.012, 24, 12), paint("#22262b", 0.6)), -0.01, 0, 0))
		head.add(put(rotorGroup(P, spin, R, "#cfd8e0"), -s * 0.07, 0, 0))
		const g = group(out)
		g.userData.frame = { hook: "energy:rotor" }
		return g
	})

	// ------------------------------------------------------------------ a small generator on its base, its pulley facing you
	addModel("generator", "rotor", () => null)
	addModel("generator", "base", (ctx) => {
		const { w, h, d } = ctx
		const out = [mesh(kit.box(w, h, d, 0.0015), wood())]
		for (const [x, c] of [[0.026, "#d32f2f"], [-0.026, "#212121"]]) {
			out.push(put(mesh(kit.cylinderY(0.0035, 0.008, 16), brass()), x, h / 2 + 0.004, 0))
			out.push(put(mesh(kit.cylinderY(0.004, 0.003, 16), paint(c, 0.5)), x, h / 2 + 0.008, 0))
		}
		return group(out)
	})
	addModel("generator", "can", (ctx) => {
		const P = ctx.props ?? {}
		const D = ctx.h
		const L = ctx.w
		const r = D / 2
		const z1 = Math.max(P.belt_z ?? 0.05, L / 2)
		// (lying on its base with its shaft toward you: the can from behind the base's middle out to the belt's plane)
		const len = z1 + 0.012
		const out = [
			put(mesh(kit.latheZ([[0, -len / 2], [r * 0.92, -len / 2], [r, -len / 2 + 0.002], [r, len / 2 - 0.003], [r * 0.85, len / 2], [0, len / 2]], 40, `energyCan|${f5(len)}|${f5(r)}`),
				M("can", { color: "#cfd3d8", roughness: 0.22, metalness: 1 })), 0, 0, z1 - len / 2 - 0.006)
		]
		const pulley = new T.Group()
		pulley.name = "pulley"
		pulley.add(mesh(kit.cylinderZ(0.006, 0.006, 24), paint("#e6e6e6", 0.4)), put(mesh(kit.box(0.0015, 0.008, 0.0062, 0.0003), paint("#d32f2f", 0.4)), 0, 0.002, 0))
		put(pulley, 0, 0, z1)
		out.push(pulley)
		const g = group(out)
		g.userData.frame = { hook: "energy:pulley" }
		return g
	})
	addFrameHook("energy:pulley", (obj, f) => {
		const p = obj.getObjectByName("pulley")
		if (p) p.rotation.z = Number(f.state?.angle) || 0
	})

	// ------------------------------------------------------------------ a battery car's gear motor (circuits' motor, drives "wheels")
	addModel("motor", "gearbox", (ctx) => {
		const { w, h, d } = ctx
		const geared = (ctx.props?.kind ?? "geared") === "geared"
		const out = []
		if (geared) {
			// a yellow 48:1 "TT" gearbox over the axle, its silver motor can behind it
			out.push(put(mesh(kit.box(w * 0.62, h, d, 0.002), paint("#f2c230", 0.5)), -w * 0.19, 0, 0))
			out.push(put(mesh(kit.cylinderY(h * 0.48, w * 0.36, 24).clone().rotateZ(Math.PI / 2), M("can", { color: "#cfd3d8", roughness: 0.22, metalness: 1 })), w * 0.31, 0, 0))
		} else out.push(mesh(kit.cylinderY(h / 2, w, 24).clone().rotateZ(Math.PI / 2), M("can", { color: "#cfd3d8", roughness: 0.22, metalness: 1 })))
		return group(out)
	})

	// ------------------------------------------------------------------ the belt from a shaft to its generator
	addViewPlugin({
		name: "energy:belts",
		load(ctx) {
			const gens = (ctx.doc.solids ?? []).filter((s) => s.itemType === "generator" && s.part === "rotor" && typeof s.parent === "string")
			if (!gens.length) return null
			const parts = []
			const beltMat = new T.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8, metalness: 0 })
			const pulleyMat = new T.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4, metalness: 0.2 })
			const makeRun = () => {
				const geo = new T.CylinderGeometry(1, 1, 1, 8, 1, true)
				const m = new T.Mesh(geo, beltMat)
				m.castShadow = true
				ctx.group.add(m)
				return { m, geo }
			}
			for (const r of gens) {
				const item = r.item
				const P = ctx.resolved?.[item] ?? {}
				const can = (ctx.doc.solids ?? []).find((s) => s.id === `${item}/can`)
				if (!can) continue
				const ratio = Math.max(1, Number(P.ratio) || 1)
				const z = Math.max(Number(P.belt_z) || 0.05, 0.03)
				const rg = 0.006
				const rs = rg * ratio
				// the shaft's pulley, turning with it
				const big = new T.Mesh(new T.CylinderGeometry(rs, rs, 0.006, 40).rotateX(Math.PI / 2), pulleyMat)
				big.castShadow = true
				ctx.group.add(big)
				const a = makeRun()
				const b = makeRun()
				const up = new T.Vector3(0, 1, 0)
				const dir = new T.Vector3()
				const lay = (run, p, q) => {
					dir.set(q.x - p.x, q.y - p.y, 0)
					const len = dir.length()
					run.m.visible = len > 1e-4
					if (!run.m.visible) return
					run.m.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, z)
					run.m.quaternion.setFromUnitVectors(up, dir.divideScalar(len))
					run.m.scale.set(0.0015, len, 0.0015)
				}
				parts.push({
					frame(t) {
						const s = ctx.placementAt(r.parent, t)
						const g = ctx.placementAt(can.id, t)
						if (!s || !g) return
						const gx = g.x
						const gy = g.y
						big.position.set(s.x, s.y, z)
						big.rotation.z = s.angle
						// (its two straight runs, tangent to both pulleys: an open belt)
						const dx = gx - s.x
						const dy = gy - s.y
						const d = Math.hypot(dx, dy)
						const coaxial = d < rs + rg + 0.005
						big.visible = !coaxial
						if (coaxial) {
							a.m.visible = false
							b.m.visible = false
							return
						}
						const ux = dx / d
						const uy = dy / d
						const sn = (rs - rg) / d
						const cs = Math.sqrt(Math.max(0, 1 - sn * sn))
						for (const [run, k] of [[a, 1], [b, -1]]) {
							const nx = ux * sn - k * uy * cs
							const ny = uy * sn + k * ux * cs
							lay(run, { x: s.x + rs * nx, y: s.y + rs * ny }, { x: gx + rg * nx, y: gy + rg * ny })
						}
					},
					dispose() {
						big.geometry.dispose()
						a.geo.dispose()
						b.geo.dispose()
					}
				})
			}
			return {
				frame: (t) => {
					for (const p of parts) p.frame(t)
				},
				dispose: () => {
					for (const p of parts) p.dispose()
					beltMat.dispose()
					pulleyMat.dispose()
				}
			}
		}
	})
}
