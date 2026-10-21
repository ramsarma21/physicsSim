// The mechanics module's 3D models (machines/mod_mechanics.py's types) and its view plug-ins (web/view-plugins.js):
//   gear-train      spur gears with real teeth (their count from the item's props), a hub and spokes, so their turning shows
//   wheel-and-axle  a spoked wooden wheel with its thin axle drum in front (the rope round the axle winds there)
//   coaster-track   its polygon pieces are not drawn: the "mechanics:track" plug-in draws the true arcs as a smooth rail channel
//   screw-jack      a cast-iron base (a cone frustum), a knurled cap, a threaded screw (its helix at the item's pitch) and a tommy bar that the
//                   "mechanics:jackbar" hook turns round the screw by 2π × the lift ÷ the pitch (the turning the lift took)
// Plug-ins: "mechanics:cords" (a winch's cord and a wheel and axle's ropes, wound from their drums to what they hold; the edge pulley's string over
// its wheel; a lever's cord over its pulley; a block and tackle's strands), "mechanics:track" (the coaster track), "mechanics:balloon" (the balloon
// on its straw, shrinking as its air goes, and the string between the posts), "mechanics:egg" (a fragile egg's splat once it breaks),
// "mechanics:glow" (a soft halo round every solid of an item set to glow), "mechanics:meters" (a force meter's reading over a puller's drum and an
// edge pulley: the pull in its cord or string, as a lab meter shows it), "mechanics:arrows" (force arrows: an item's `forces` record's readings,
// each kind its own fixed colour and a label "gravity 6.4 N", gravity and the net from the centre of mass, contact and rope forces from where they
// act; a scene's arrows share one scale), "mechanics:energy" (an energy-bars board's bars, and small bars over an item set to show_energy: kinetic,
// potential, spring, heat and sound, as the run plays).
// Nothing here draws for a run without these items (each plug-in returns null).
import { registerClayLump } from "./clay-lump.js"

const ROPE = "#6b5a45"
/** Force arrows' colours and words, the same everywhere in the app (FORCE_KINDS of tooling/src/sim/mechanics.ts; tension1.. use tension's). */
export const ARROW_COLOR = { gravity: "#2563eb", support: "#16a34a", push: "#f59e0b", friction: "#dc2626", tension: "#7c3aed", spring: "#db2777", air: "#0ea5e9", buoyancy: "#0d9488", magnetic: "#c026d3", applied: "#ea580c", net: "#111827" }
const ARROW_WORD = { gravity: "gravity", support: "support", push: "push", friction: "friction", tension: "pull", spring: "spring", air: "air resistance", buoyancy: "buoyancy", magnetic: "magnetic", applied: "applied", net: "net force" }
const PLACED = new Set(["support", "push", "friction", "tension", "spring"])
/** Energy bars' colours: kinetic, potential, spring, heat and sound. */
export const ENERGY_COLOR = { kinetic: "#f97316", potential: "#2563eb", spring: "#16a34a", heat: "#dc2626" }
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
/** A force's size as its label says it: one decimal from 1 N, two figures under it. */
const newtons = (v) => (v >= 1 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toPrecision(2))

export default function register({ addModel, addViewPlugin, addFrameHook, kit, THREE }) {
	// (the lump of clay: a hand-pressed lump, web/models/clay-lump.js)
	registerClayLump({ addModel, kit, THREE })
	const steel = kit.steel()
	const plasticOf = (color) => kit.plastic(color, { gloss: 0.45, key: "mechanics" })
	const rope = kit.mat("mechanics|rope", { color: ROPE, roughness: 0.9, metalness: 0 })
	const string = kit.mat("mechanics|string", { color: "#f2efe6", roughness: 0.8, metalness: 0 })

	// ============================================================== gears
	/** A spur gear's outline (teeth with sloped flanks and flat tops), extruded d deep, its pitch circle radius r. */
	const gearGeometry = (n, r, d) =>
		kit.geo(`mechanics|gear|${n}|${r.toFixed(5)}|${d.toFixed(4)}`, () => {
			const m = (2 * r) / n // module
			const ra = r + m // addendum
			const rd = r - 1.25 * m // dedendum
			const shape = new THREE.Shape()
			const step = (2 * Math.PI) / n
			for (let k = 0; k < n; k++) {
				const a = k * step
				const pts = [
					[rd, a - step * 0.5],
					[rd, a - step * 0.27],
					[ra, a - step * 0.14],
					[ra, a + step * 0.14],
					[rd, a + step * 0.27]
				]
				for (const [rr, aa] of pts) {
					const x = rr * Math.cos(aa)
					const y = rr * Math.sin(aa)
					if (k === 0 && rr === rd && aa === a - step * 0.5) shape.moveTo(x, y)
					else shape.lineTo(x, y)
				}
			}
			shape.closePath()
			const hole = new THREE.Path()
			hole.absarc(0, 0, Math.max(0.002, Math.min(0.006, rd * 0.25)), 0, Math.PI * 2, true)
			shape.holes.push(hole)
			const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: Math.min(0.0008, d * 0.08), bevelSize: Math.min(0.0006, m * 0.15), bevelSegments: 1, curveSegments: 8 })
			g.translate(0, 0, -d / 2)
			return g
		})
	const GEAR_COLORS = ["#d94a2b", "#2f6db5", "#e0a91b"]
	for (const [k, part] of ["gear-a", "gear-b", "gear-c"].entries()) {
		addModel("gear-train", part, ({ r, d, props }) => {
			const P = props ?? {}
			const n = Math.max(6, Math.round(Number(P[`teeth_${"abc"[k]}`]) || 12))
			const g = new THREE.Group()
			const body = new THREE.Mesh(gearGeometry(n, r, d * 0.8), plasticOf(GEAR_COLORS[k]))
			body.castShadow = true
			body.receiveShadow = true
			g.add(body)
			// a white mark from the hub to the rim: its turning is plain to see
			const mark = new THREE.Mesh(kit.geo(`mechanics|gearmark|${r.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.BoxGeometry(r * 0.7, Math.max(0.002, r * 0.08), d * 0.86)), plasticOf("#f4f4f0"))
			mark.position.x = r * 0.45
			g.add(mark)
			const hub = new THREE.Mesh(kit.geo(`mechanics|gearhub|${r.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.CylinderGeometry(Math.max(0.004, r * 0.18), Math.max(0.004, r * 0.18), d * 1.3, 20).rotateX(Math.PI / 2)), steel)
			g.add(hub)
			return g
		})
	}

	// ============================================================== wheel and axle
	addModel("wheel-and-axle", "wheel", ({ r, d, props }) => {
		const P = props ?? {}
		const ra = Math.max(0.006, Number(P.axle_radius) || 0.03)
		const g = new THREE.Group()
		const wood = kit.mat("mechanics|wheelwood", { color: "#b07a42", roughness: 0.55, metalness: 0 })
		const rim = new THREE.Mesh(kit.geo(`mechanics|wrim|${r.toFixed(4)}|${d.toFixed(4)}`, () => new THREE.TorusGeometry(r - 0.008, 0.008, 10, 64)), wood)
		rim.scale.z = (d / 0.016) * 0.8
		g.add(rim)
		const groove = new THREE.Mesh(kit.geo(`mechanics|wgroove|${r.toFixed(4)}`, () => new THREE.TorusGeometry(r, 0.0025, 6, 64)), rope)
		g.add(groove)
		for (let k = 0; k < 6; k++) {
			const s = new THREE.Mesh(kit.geo(`mechanics|wspoke|${r.toFixed(4)}`, () => new THREE.BoxGeometry(r - 0.01, 0.008, 0.008)), wood)
			const a = (k * Math.PI) / 3
			s.position.set(((r - 0.01) / 2) * Math.cos(a), ((r - 0.01) / 2) * Math.sin(a), 0)
			s.rotation.z = a
			g.add(s)
		}
		// the axle: a drum of its own radius in front of the wheel, where the load's rope winds
		const drum = new THREE.Mesh(kit.geo(`mechanics|wdrum|${ra.toFixed(4)}`, () => new THREE.CylinderGeometry(ra, ra, 0.05, 32).rotateX(Math.PI / 2)), kit.mat("mechanics|drumwood", { color: "#8a5a2b", roughness: 0.6, metalness: 0 }))
		drum.position.z = 0.03 + d / 2
		g.add(drum)
		g.traverse((o) => {
			if (o.isMesh) {
				o.castShadow = true
				o.receiveShadow = true
			}
		})
		return g
	})

	// ============================================================== coaster track: the pieces are the plug-in's to draw
	addModel("coaster-track", "*", () => null)

	// ============================================================== screw jack
	const iron = kit.mat("mechanics|castiron", { color: "#3b3f45", roughness: 0.62, metalness: 0.55 })
	const grip = kit.rubber("#b3261e")
	const shadowed = (g) => {
		g.traverse((o) => {
			if (o.isMesh) {
				o.castShadow = true
				o.receiveShadow = true
			}
		})
		return g
	}
	// the base: a cone frustum as the physics trapezoid (its bottom 14 cm across, its top 7 cm, 12 cm tall: the outline exactly), a lip at its foot
	addModel("screw-jack", "housing", ({ solid }) => {
		const pts = solid.body.points
		const bottom = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
		const top = Math.abs(pts[2].x - pts[3].x)
		const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
		const y0 = Math.min(...pts.map((p) => p.y))
		const body = kit.mesh(kit.lathe([[0, 0], [bottom / 2, 0], [bottom / 2, 0.008], [bottom / 2 - 0.004, 0.012], [top / 2, h - 0.006], [top / 2 - 0.003, h], [0, h]], 48, `jackbase|${bottom.toFixed(4)}|${top.toFixed(4)}|${h.toFixed(4)}`), iron)
		body.position.y = y0
		return shadowed(kit.group(body))
	})
	// the cap: a round knurled head as wide as the physics slab
	addModel("screw-jack", "cap", ({ w, h }) => {
		const r = w / 2
		const head = kit.mesh(kit.cylinderY(r, h * 0.7, 40), steel)
		head.position.y = -h * 0.15
		const top = kit.mesh(kit.cylinderY(r * 0.96, h * 0.3, 40, r * 0.88), kit.metal("#8e949b", { roughness: 0.5, key: "knurl" }))
		top.position.y = h * 0.35
		return shadowed(kit.group(head, top))
	})
	// the screw: a rod with its thread, one turn every pitch (a helix tube round the core)
	addModel("screw-jack", "screw", ({ w, h, props }) => {
		const pitch = Math.max(0.0005, (Number(props?.pitch) || 5) / 1000)
		const r = w / 2
		const core = kit.mesh(kit.cylinderY(r * 0.82, h, 24), steel)
		const turns = Math.max(1, Math.min(400, Math.round(h / pitch)))
		const thread = kit.mesh(
			kit.geo(`mechanics|jackthread|${r.toFixed(4)}|${h.toFixed(4)}|${pitch.toFixed(5)}`, () => {
				class Helix extends THREE.Curve {
					getPoint(u, out = new THREE.Vector3()) {
						const a = u * turns * 2 * Math.PI
						return out.set(r * 0.86 * Math.cos(a), -h / 2 + u * h, r * 0.86 * Math.sin(a))
					}
				}
				return new THREE.TubeGeometry(new Helix(), turns * 16, Math.min(r * 0.18, pitch * 0.3), 6, false)
			}),
			steel
		)
		return shadowed(kit.group(core, thread))
	})
	// the tommy bar through the cap: a steel bar with red grips at its ends, turned round the screw by the hook
	addModel("screw-jack", "bar", ({ w, h, props }) => {
		const L = w / 2
		const bar = kit.mesh(kit.geo(`mechanics|jackbar|${w.toFixed(4)}|${h.toFixed(4)}`, () => new THREE.CylinderGeometry(h / 2, h / 2, w, 16).rotateZ(Math.PI / 2)), steel)
		const g = kit.group(bar)
		for (const sx of [-1, 1]) {
			const knob = kit.mesh(kit.geo(`mechanics|jackgrip|${h.toFixed(4)}`, () => new THREE.CylinderGeometry(h * 0.8, h * 0.8, Math.min(0.06, L * 0.3), 16).rotateZ(Math.PI / 2)), grip)
			knob.position.x = sx * (L - Math.min(0.03, L * 0.15))
			g.add(knob)
		}
		g.userData.frame = { hook: "mechanics:jackbar", pitch: Math.max(0.0005, (Number(props?.pitch) || 5) / 1000) }
		return shadowed(g)
	})
	addFrameHook("mechanics:jackbar", (obj, f, args) => {
		const pitch = Number(args?.pitch) > 0 ? Number(args.pitch) : 0.005
		const lift = Number(f.state?.lift) || 0
		obj.rotation.y = ((2 * Math.PI * lift) / pitch) % (2 * Math.PI)
	})

	// ---------------------------------------------------------------- helpers for the plug-ins
	const tube = (radius, material) => {
		const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
		const mesh = new THREE.Mesh(geo, material)
		mesh.castShadow = true
		const up = new THREE.Vector3(0, 1, 0)
		const dir = new THREE.Vector3()
		return {
			mesh,
			set(a, b) {
				dir.set(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0))
				const len = dir.length()
				mesh.visible = len > 1e-5
				if (!mesh.visible) return
				mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, ((a.z ?? 0) + (b.z ?? 0)) / 2)
				mesh.quaternion.setFromUnitVectors(up, dir.divideScalar(len))
				mesh.scale.set(radius, len, radius)
			},
			dispose: () => geo.dispose()
		}
	}
	/** A point fixed in a solid (its own frame) in the world at t. */
	const pointOf = (ctx, id, local, t) => {
		const p = ctx.placementAt(id, t)
		if (!p) return null
		const c = Math.cos(p.angle)
		const s = Math.sin(p.angle)
		return { x: p.x + local.x * c - local.y * s, y: p.y + local.x * s + local.y * c }
	}

	// ============================================================== cords and strings
	addViewPlugin({
		name: "mechanics:cords",
		load(ctx) {
			const procs = (ctx.doc.processes ?? []).filter((p) => p.kind === "mechanics" && p.role === "spool")
			const pulleys = (ctx.doc.joints ?? []).filter((j) => j.kind === "pulley" && j.render?.draw === "none")
			if (!procs.length && !pulleys.length) return null
			const parts = []
			const solid = (id) => ctx.doc.solids.find((s) => s.id === id)
			for (const sp of procs) {
				const drum = solid(sp.drum)
				const b = sp.b === null ? null : solid(sp.b)
				if (!drum || !b) continue
				// (a record may say where its cord runs: the energy module's spool on a waterwheel's axle, in front of its paddles)
				const z = typeof sp.z === "number" ? sp.z : drum.itemType === "wheel-and-axle" && sp.radius < (drum.body.radius ?? 0) - 1e-6 ? 0.03 + (drum.depth3d ?? 0.02) / 2 : 0
				const t = tube(sp.radius > 0.05 ? 0.0025 : 0.0015, sp.radius > 0.05 ? rope : string)
				ctx.group.add(t.mesh)
				parts.push({ t, frame: (tt) => {
					const O = pointOf(ctx, drum.id, sp.center ?? { x: 0, y: 0 }, tt)
					const P = pointOf(ctx, b.id, sp.anchorB ?? { x: 0, y: 0 }, tt)
					if (!O || !P) return
					// the cord leaves the drum at its tangent point on its winding side
					const dx = P.x - O.x
					const dy = P.y - O.y
					const d = Math.hypot(dx, dy)
					if (d <= sp.radius) return
					const beta = Math.atan2(dy, dx) + (sp.sense ?? 1) * Math.atan2(Math.sqrt(d * d - sp.radius * sp.radius), sp.radius)
					t.set({ x: O.x + sp.radius * Math.cos(beta), y: O.y + sp.radius * Math.sin(beta), z }, { x: P.x, y: P.y, z })
				} })
			}
			for (const j of pulleys) {
				const n = Math.max(1, Math.round(Number(j.render?.strands ?? j.ratio ?? 1)))
				const runs = []
				const a = tube(0.0012, string)
				ctx.group.add(a.mesh)
				runs.push(a)
				for (let k = 0; k < n; k++) {
					const t = tube(0.0012, string)
					ctx.group.add(t.mesh)
					runs.push(t)
				}
				parts.push({ t: runs[0], extra: runs.slice(1), frame: (tt) => {
					const A = j.a === null ? j.anchorA : pointOf(ctx, j.a, j.anchorA, tt)
					const B = j.b === null ? j.anchorB : pointOf(ctx, j.b, j.anchorB, tt)
					if (!A || !B) return
					runs[0].set({ x: j.groundA.x, y: j.groundA.y, z: 0 }, { x: A.x, y: A.y, z: 0 })
					// the other run, or a block and tackle's n strands spread across its blocks
					for (let k = 0; k < n; k++) {
						const off = n === 1 ? 0 : (k - (n - 1) / 2) * 0.012
						runs[1 + k].set({ x: j.groundB.x + off, y: j.groundB.y, z: 0 }, { x: B.x + off, y: B.y, z: 0 })
					}
				} })
			}
			return {
				frame: (t) => {
					for (const p of parts) p.frame(t)
				},
				dispose: () => {
					for (const p of parts) {
						p.t.dispose()
						for (const e of p.extra ?? []) e.dispose()
					}
				}
			}
		}
	})

	// ============================================================== the coaster track: a smooth channel along its true arcs
	addViewPlugin({
		name: "mechanics:track",
		load(ctx) {
			const items = ctx.itemsOfType("coaster-track")
			if (!items.length) return null
			const arcs = new Map((ctx.doc.processes ?? []).filter((p) => p.kind === "mechanics" && p.role === "arc").map((p) => [p.solid, p]))
			const rail = kit.metal("#b9c0c7", { roughness: 0.3, key: "mechanics-rail" })
			const bed = kit.mat("mechanics|trackbed", { color: "#3b4a5c", roughness: 0.5, metalness: 0.2 })
			const meshes = []
			for (const iid of items) {
				const P = ctx.resolved[iid] ?? {}
				const d = Number(P.depth) || 0.05
				const pieces = ctx.solidsOf(iid).filter((s) => s.part !== "stop")
				for (const s of pieces) {
					// the riding face of each piece as points in the world: an arc's sampled, a straight piece's top edge
					const pts = []
					const arc = arcs.get(s.id)
					const pose = { x: s.at.x, y: s.at.y, a: s.angle ?? 0 }
					const toWorld = (x, y) => ({ x: pose.x + x * Math.cos(pose.a) - y * Math.sin(pose.a), y: pose.y + x * Math.sin(pose.a) + y * Math.cos(pose.a) })
					if (arc) {
						for (let k = 0; k <= 8; k++) {
							const ang = arc.from + ((arc.to - arc.from) * k) / 8
							pts.push(toWorld(arc.center.x + arc.radius * Math.cos(ang), arc.center.y + arc.radius * Math.sin(ang)))
						}
					} else if (s.body.kind === "slab") {
						pts.push(toWorld(-s.body.width / 2, s.body.height / 2), toWorld(s.body.width / 2, s.body.height / 2))
					} else if (s.body.kind === "polygon") {
						// a sloped piece: its riding face is the side whose outward normal points most upward
						const q = s.body.points
						let best = -2
						let face = null
						for (let k = 0; k < q.length; k++) {
							const a = q[k]
							const b = q[(k + 1) % q.length]
							const len = Math.hypot(b.x - a.x, b.y - a.y)
							if (len < 1e-6) continue
							const ny = -(b.x - a.x) / len // (the outward normal of a counter-clockwise side, (dy, -dx)/len, its y)
							if (ny > best) {
								best = ny
								face = [a, b]
							}
						}
						if (face) pts.push(...[toWorld(face[0].x, face[0].y), toWorld(face[1].x, face[1].y)].sort((a, b) => a.x - b.x))
					}
					if (pts.length < 2) continue
					for (let k = 0; k + 1 < pts.length; k++) {
						const a = pts[k]
						const b = pts[k + 1]
						for (const z of [-d / 2 + 0.003, d / 2 - 0.003]) {
							const t = tube(0.003, rail)
							t.set({ x: a.x, y: a.y + 0.002, z }, { x: b.x, y: b.y + 0.002, z })
							ctx.group.add(t.mesh)
							meshes.push(t)
						}
						// the channel's floor: a thin plate under the rails
						const len = Math.hypot(b.x - a.x, b.y - a.y)
						const plate = new THREE.Mesh(new THREE.BoxGeometry(len + 0.001, 0.004, d), bed)
						plate.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.002, 0)
						plate.rotation.z = Math.atan2(b.y - a.y, b.x - a.x)
						plate.castShadow = true
						plate.receiveShadow = true
						ctx.group.add(plate)
						meshes.push({ mesh: plate, dispose: () => plate.geometry.dispose() })
					}
				}
			}
			return { dispose: () => meshes.forEach((m) => m.dispose()) }
		}
	})

	// ============================================================== the balloon rocket
	addViewPlugin({
		name: "mechanics:balloon",
		load(ctx) {
			const items = ctx.itemsOfType("balloon-rocket")
			if (!items.length) return null
			const parts = []
			for (const iid of items) {
				const jet = (ctx.doc.processes ?? []).find((p) => p.kind === "mechanics" && p.role === "balloon" && p.item === iid)
				const line = (ctx.doc.processes ?? []).find((p) => p.kind === "mechanics" && p.role === "slider" && p.item === iid)
				if (!jet || !line) continue
				const P = ctx.resolved[iid] ?? {}
				const L = Number(P.string) || 4
				// the string, taut between the posts' tops
				const s = tube(0.0008, string)
				s.set({ x: line.anchorA.x - 0.1, y: line.anchorA.y, z: 0 }, { x: line.anchorA.x + L + 0.05, y: line.anchorA.y, z: 0 })
				ctx.group.add(s.mesh)
				const color = new THREE.Color(P.color && P.color !== "none" ? { red: "#d62828", blue: "#1f5fbf", green: "#2e9e44", yellow: "#f2c230", orange: "#f07f1a", purple: "#7b3fb0", pink: "#ec6fa5" }[P.color] ?? "#d62828" : "#d62828")
				const mat = kit.mat(`mechanics|balloon|${color.getHexString()}`, { color, roughness: 0.25, metalness: 0, clearcoat: 0.8, transparent: true, opacity: 0.92 })
				const ball = new THREE.Mesh(kit.geo("mechanics|balloon", () => {
					// a balloon's shape: a sphere drawn out a little toward its neck
					const g = new THREE.SphereGeometry(1, 32, 24)
					const p = g.attributes.position
					for (let i = 0; i < p.count; i++) if (p.getX(i) < 0) p.setX(i, p.getX(i) * 1.25)
					g.computeVertexNormals()
					return g
				}), mat)
				ball.castShadow = true
				ctx.group.add(ball)
				const r0 = jet.diameter / 2
				const rest = (jet.rest ?? 0.06) / 2
				parts.push({ s, ball, iid, jet, r0, rest })
			}
			if (!parts.length) return null
			return {
				frame: (t) => {
					for (const q of parts) {
						const v = ctx.stateAt(q.iid, "volume", t)
						const r = Number.isFinite(v) && v > 0 ? Math.cbrt((3 * v) / (4 * Math.PI)) : q.r0
						const c = pointOf(ctx, q.jet.solid, { x: 0.02, y: -0.004 - r }, t)
						if (!c) continue
						q.ball.position.set(c.x, c.y, 0)
						q.ball.scale.set(r, r * 0.95, r * 0.95)
					}
				},
				dispose: () => parts.forEach((q) => q.s.dispose())
			}
		}
	})

	// ============================================================== a fragile egg's splat
	addViewPlugin({
		name: "mechanics:egg",
		load(ctx) {
			const eggs = (ctx.doc.processes ?? []).filter((p) => p.kind === "mechanics" && p.role === "fragile")
			if (!eggs.length) return null
			const yolk = kit.mat("mechanics|yolk", { color: "#f2b01e", roughness: 0.25, metalness: 0, clearcoat: 1 })
			const white = kit.mat("mechanics|eggwhite", { color: "#f4f1e6", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.75, clearcoat: 1 })
			const shell = kit.mat("mechanics|shellbits", { color: "#efe2cc", roughness: 0.7, metalness: 0 })
			const parts = []
			for (const e of eggs) {
				const g = new THREE.Group()
				const puddle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.004, 28), white)
				g.add(puddle)
				const y = new THREE.Mesh(new THREE.SphereGeometry(0.016, 20, 12), yolk)
				y.scale.y = 0.45
				y.position.y = 0.004
				g.add(y)
				for (let k = 0; k < 6; k++) {
					const bit = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.002, 0.01), shell)
					const a = k * 1.1
					bit.position.set(0.035 * Math.cos(a), 0.003, 0.03 * Math.sin(a))
					bit.rotation.set(0.4 * Math.sin(a), a, 0.3 * Math.cos(a))
					g.add(bit)
				}
				g.visible = false
				ctx.group.add(g)
				parts.push({ e, g, holder: null })
			}
			return {
				frame: (t) => {
					for (const q of parts) {
						const broken = (ctx.stateAt(q.e.item, "broken", t) ?? 0) >= 0.5
						q.holder ??= ctx.group.parent?.getObjectByName(q.e.solid) ?? null
						if (q.holder) q.holder.visible = !broken
						q.g.visible = broken
						if (!broken) continue
						const p = ctx.placementAt(q.e.solid, t)
						if (p) q.g.position.set(p.x, p.y - 0.02, 0)
					}
				},
				dispose: () => parts.forEach((q) => q.g.traverse((o) => o.geometry?.dispose?.()))
			}
		}
	})

	// ============================================================== meters: a force meter's reading by a puller's drum and an edge pulley
	addViewPlugin({
		name: "mechanics:meters",
		load(ctx) {
			const shown = []
			for (const [type, part, dy] of [["puller", "drum", 0.06], ["edge-pulley", "wheel", 0.06]]) {
				for (const id of ctx.itemsOfType(type)) {
					if (!ctx.track?.state?.[id]?.newtons) continue
					const s = ctx.solidsOf(id).find((q) => q.part === part)
					if (!s) continue
					const l = ctx.label({ text: "0.00 N", height: 0.05 })
					l.sprite.position.set(s.at.x, s.at.y + dy + 0.01, 0.06)
					ctx.group.add(l.sprite)
					shown.push({ l, id })
				}
			}
			if (!shown.length) return null
			return {
				frame(t) {
					for (const s of shown) {
						const v = ctx.stateAt(s.id, "newtons", t)
						if (Number.isFinite(v)) s.l.set(`${v < 10 ? v.toFixed(2) : v.toFixed(1)} N`)
					}
				},
				dispose() {
					for (const s of shown) s.l.dispose?.()
				}
			}
		}
	})

	// ============================================================== force arrows: the forces record's readings, as the run plays
	addViewPlugin({
		name: "mechanics:arrows",
		load(ctx) {
			const recs = (ctx.doc.processes ?? []).filter((p) => p.kind === "mechanics" && p.role === "forces" && Array.isArray(p.show) && p.show.length)
			const track = ctx.track
			const fr = track?.frames ?? []
			if (!recs.length || !fr.length) return null
			const rel = ctx.doc.release?.at ?? 0.5
			const arrows = []
			let fmax = 0
			// the scene's extent at the start (what the wide camera frames: its things and boards, not the table): the auto scale's arrow length
			// (a fifth of it, 3-40 cm) and the labels' size
			let x0 = Infinity
			let x1 = -Infinity
			let y0 = Infinity
			let y1 = -Infinity
			for (const s of ctx.doc.solids) {
				if (s.itemType === "table" || s.hidden_3d) continue
				const b = s.body
				const c = Math.abs(Math.cos(s.angle ?? 0))
				const sn = Math.abs(Math.sin(s.angle ?? 0))
				const [hx, hy] = b.kind === "ball" ? [b.radius, b.radius] : b.kind === "slab" ? [(b.width * c + b.height * sn) / 2, (b.width * sn + b.height * c) / 2] : [Math.max(...b.points.map((q) => Math.hypot(q.x, q.y))), Math.max(...b.points.map((q) => Math.hypot(q.x, q.y)))]
				// (where it goes in the run too: the wide camera frames the motion, a parachute's whole fall)
				const step = Math.max(1, Math.floor(fr.length / 40))
				for (let k = 0; k < fr.length; k += step) {
					const q = s.kind === "dynamic" ? fr[k].placements[s.id] : null
					const px = q?.x ?? s.at.x
					const py = q?.y ?? s.at.y
					x0 = Math.min(x0, px - hx)
					x1 = Math.max(x1, px + hx)
					y0 = Math.min(y0, py - hy)
					y1 = Math.max(y1, py + hy)
					if (s.kind !== "dynamic") break
				}
			}
			const W = Number.isFinite(x0) ? Math.max(x1 - x0, (y1 - y0) * 1.78, 0.1) : 1
			const target = Math.min(0.4, Math.max(0.03, 0.2 * W))
			const labelH = Math.min(0.07, Math.max(0.012, 0.035 * W))
			for (const r of recs) {
				const st = track.state?.[r.item]
				if (!st) continue
				// each kind it shows; a rope's or spring's own arrows (f_tension1...) in place of their sum when it has two or more
				const keys = []
				for (const kind of r.show) {
					const own = Object.keys(st).filter((k) => new RegExp(`^f_${kind}\\d+_x$`).test(k)).map((k) => k.slice(2, -2))
					if ((kind === "tension" || kind === "spring") && own.length) for (const k of own) keys.push({ kind, key: k })
					else keys.push({ kind, key: kind })
				}
				// how far in front of the item the arrows are (its moving solids' depth)
				let z = 0.02
				for (const s of ctx.solidsOf(r.item).filter((q) => q.kind === "dynamic")) z = Math.max(z, (s.body.kind === "ball" ? s.body.radius : (s.body.depth ?? 0.05) / 2) + 0.015)
				for (const { kind, key } of keys) {
					const xs = st[`f_${key}_x`]
					const ys = st[`f_${key}_y`]
					if (!Array.isArray(xs) || !Array.isArray(ys)) continue
					// its typical size: the 90th percentile over the run after the release (a collision's spike of a frame or two does not shrink the rest)
					const sizes = []
					for (let k = 0; k < xs.length; k++) if ((fr[k]?.t ?? 0) > rel) sizes.push(Math.hypot(xs[k], ys[k]))
					sizes.sort((a, b) => a - b)
					const top = sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(0.9 * sizes.length))] : 0
					if (!r.scale) fmax = Math.max(fmax, top)
					const color = ARROW_COLOR[kind] ?? "#444"
					const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false })
					const net = kind === "net"
					const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), mat)
					const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), mat)
					for (const m of [shaft, head]) {
						m.renderOrder = 20
						m.layers.set(ctx.HUD_LAYER)
						m.visible = false
						ctx.group.add(m)
					}
					const label = ctx.label({ text: "", height: labelH })
					label.sprite.renderOrder = 21
					label.sprite.material.depthTest = false
					label.sprite.visible = false
					ctx.group.add(label.sprite)
					arrows.push({ r, kind, key, xs, ys, top, shaft, head, mat, label, net, z: z + (net ? 0.004 : 0), placed: PLACED.has(kind) })
				}
			}
			if (!arrows.length) return null
			// one scale for the scene's auto arrows: its biggest typical force a quarter of the scene's width (5-50 cm); a spike is drawn at most 1.6 times that
			const auto = fmax > 0 ? target / fmax : 0
			const up = new THREE.Vector3(0, 1, 0)
			const dir = new THREE.Vector3()
			/** The item's centre's velocity (m/s) at t, from its readings: whether the air's push is against its motion (resistance) or with it (wind). */
			const velocity = (item, t) => {
				const dt = 0.02
				const a = { x: ctx.stateAt(item, "f_cx", t - dt), y: ctx.stateAt(item, "f_cy", t - dt) }
				const b = { x: ctx.stateAt(item, "f_cx", t), y: ctx.stateAt(item, "f_cy", t) }
				return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
			}
			return {
				frame(t) {
					for (const a of arrows) {
						const fx = ctx.stateAt(a.r.item, `f_${a.key}_x`, t) ?? 0
						const fy = ctx.stateAt(a.r.item, `f_${a.key}_y`, t) ?? 0
						const m = Math.hypot(fx, fy)
						const scale = a.r.scale > 0 ? a.r.scale : auto
						const len = Math.min(m * scale, a.r.scale > 0 ? Infinity : 1.6 * target)
						const ox = a.placed ? ctx.stateAt(a.r.item, `f_${a.key}_px`, t) : ctx.stateAt(a.r.item, "f_cx", t)
						const oy = a.placed ? ctx.stateAt(a.r.item, `f_${a.key}_py`, t) : ctx.stateAt(a.r.item, "f_cy", t)
						const show = t > rel && m > Math.max(0.002, 0.01 * a.top) && len > 0.004
						a.shaft.visible = a.head.visible = show
						// (a balanced net force: no arrow, its label says 0 N beside the centre)
						const zeroNet = a.net && t > rel && !show
						a.label.sprite.visible = show || zeroNet
						if (zeroNet) {
							a.label.set("net force 0 N", { color: ARROW_COLOR.net, background: "rgba(255,255,255,0.85)" })
							a.label.sprite.position.set(ox + labelH * 3, oy, a.z + 0.01)
						}
						if (!show) continue
						const ux = fx / m
						const uy = fy / m
						const radius = Math.max(0.0025, 0.02 * target) * (a.net ? 1.4 : 1)
						const headLen = Math.min(0.4 * len, 0.03)
						const shaftLen = len - headLen
						dir.set(ux, uy, 0)
						a.shaft.quaternion.setFromUnitVectors(up, dir)
						a.head.quaternion.copy(a.shaft.quaternion)
						a.shaft.scale.set(radius, Math.max(1e-4, shaftLen), radius)
						a.shaft.position.set(ox + (ux * shaftLen) / 2, oy + (uy * shaftLen) / 2, a.z)
						a.head.scale.set(radius * 2.6, headLen, radius * 2.6)
						a.head.position.set(ox + ux * (shaftLen + headLen / 2), oy + uy * (shaftLen + headLen / 2), a.z)
						let word = ARROW_WORD[a.kind] ?? a.kind
						if (a.kind === "air") {
							const v = velocity(a.r.item, t)
							if (fx * v.x + fy * v.y > 0) word = "wind"
						}
						a.label.set(`${word} ${newtons(m)} N`, { color: a.kind === "net" ? "#111827" : ARROW_COLOR[a.kind], background: "rgba(255,255,255,0.85)" })
						// (the label past the arrow's tip; a vertical arrow's beside it, so the labels of opposite arrows do not sit on the thing)
						a.label.sprite.position.set(ox + ux * (len + labelH) + (Math.abs(uy) > 0.7 ? labelH * 2.2 : 0), oy + uy * (len + labelH * 0.8), a.z + 0.01)
					}
				},
				dispose() {
					for (const a of arrows) {
						a.shaft.geometry.dispose()
						a.head.geometry.dispose()
						a.mat.dispose()
						a.label.dispose?.()
					}
				}
			}
		}
	})

	// ============================================================== energy bars: a board's (energy-bars) and an item's own small ones (show_energy)
	const energyBoard = ({ w, h }) => {
		const g = kit.group()
		g.add(kit.mesh(kit.box(w, h, 0.018, 0.004), kit.plastic("#fafaf8", { gloss: 0.35, key: "mechanics-board" })))
		const frame = kit.metal("#b9bec4", { roughness: 0.35, key: "mechanics-boardframe" })
		for (const [bw, bh, x, y] of [[w + 0.03, 0.02, 0, h / 2 + 0.01], [w + 0.03, 0.02, 0, -h / 2 - 0.01], [0.02, h + 0.02, w / 2 + 0.01, 0], [0.02, h + 0.02, -w / 2 - 0.01, 0]]) {
			const m = kit.mesh(kit.box(bw, bh, 0.024, 0.004), frame)
			m.position.set(x, y, 0)
			g.add(m)
		}
		return g
	}
	addModel("energy-bars", "board", energyBoard)
	addViewPlugin({
		name: "mechanics:energy",
		load(ctx) {
			const track = ctx.track
			const fr = track?.frames ?? []
			const recs = (ctx.doc.processes ?? []).filter((p) => p.kind === "mechanics" && p.role === "energy")
			if (!recs.length || !fr.length) return null
			const series = (item) => {
				const st = track.state?.[item]
				if (!st || !Array.isArray(st.e_kinetic)) return null
				const low = Math.min(...st.e_potential)
				let top = 1e-9
				for (let k = 0; k < st.e_kinetic.length; k++) top = Math.max(top, st.e_kinetic[k] + st.e_potential[k] - low + Math.max(0, st.e_spring[k]) + st.e_heat[k])
				return { st, low, top }
			}
			const nameOf = (id) => ctx.sim?.summary?.stories?.find?.((q) => q.item === id)?.name ?? ctx.sim?.scene?.items?.find?.((q) => q.id === id)?.name ?? id
			const draws = []
			/** Bars on a canvas: kinetic, potential, spring, heat and sound, and the total, at t (zero: potential from the lowest point or the floor). */
			const paint = (g, W, H, item, se, t, zero, title) => {
				g.fillStyle = "#ffffff"
				g.fillRect(0, 0, W, H)
				const ke = Math.max(0, ctx.stateAt(item, "e_kinetic", t) ?? 0)
				const peRaw = ctx.stateAt(item, "e_potential", t) ?? 0
				const pe = zero === "floor" ? peRaw : peRaw - se.low
				const sp = Math.max(0, ctx.stateAt(item, "e_spring", t) ?? 0)
				const heat = Math.max(0, ctx.stateAt(item, "e_heat", t) ?? 0)
				const top = zero === "floor" ? se.top + se.low : se.top
				const bars = [["kinetic", ke, ENERGY_COLOR.kinetic], ["potential", pe, ENERGY_COLOR.potential], ["spring", sp, ENERGY_COLOR.spring], ["heat &|sound", heat, ENERGY_COLOR.heat], ["total", ke + pe + sp + heat, "#6b7280"]]
				const L = W * 0.06
				const T = H * (title ? 0.24 : 0.14)
				const B = H * 0.76
				const bw = (W - 2 * L) / bars.length
				if (title) {
					g.fillStyle = "#111"
					g.font = `700 ${Math.round(H * 0.09)}px ${SANS}`
					g.textAlign = "center"
					g.fillText(title, W / 2, H * 0.11)
				}
				g.strokeStyle = "#333"
				g.lineWidth = Math.max(2, H * 0.006)
				g.beginPath()
				g.moveTo(L, B)
				g.lineTo(W - L, B)
				g.stroke()
				bars.forEach(([name, v, color], i) => {
					const hgt = top > 0 ? Math.max(0, Math.min(1, v / top)) * (B - T) : 0
					const x = L + i * bw + bw * 0.15
					g.fillStyle = color
					g.fillRect(x, B - hgt, bw * 0.7, hgt)
					g.fillStyle = "#111"
					// (the font as big as fits the bar's width: "potential" is the longest word)
					const fs = Math.round(Math.min(H * 0.07, (bw * 0.95) / 5))
					g.font = `600 ${fs}px ${SANS}`
					g.textAlign = "center"
					name.split("|").forEach((line, j) => g.fillText(line, x + bw * 0.35, B + fs * (1.15 + 1.1 * j)))
					g.fillText(`${v < 0.1 ? v.toFixed(3) : v.toFixed(2)} J`, x + bw * 0.35, B - hgt - fs * 0.4)
				})
			}
			// the boards
			for (const id of ctx.itemsOfType("energy-bars")) {
				const P = ctx.resolved?.[id] ?? {}
				const s = ctx.solidsOf(id)[0]
				if (!s || typeof P.watch !== "string") continue
				const se = series(P.watch)
				if (!se) continue
				const bw = s.body.width ?? 0.6
				const bh = s.body.height ?? 0.5
				const W = 1024
				const H = Math.round((W * bh) / bw)
				const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
				const tex = new THREE.CanvasTexture(canvas)
				tex.colorSpace = THREE.SRGBColorSpace
				const plane = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.96, bh * 0.94), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }))
				plane.position.set(s.at.x, s.at.y, 0.0105)
				ctx.group.add(plane)
				// its stand: two legs down to the table top or the room's floor
				const table = ctx.doc.solids.find((q) => q.itemType === "table" && q.part === "top")
				const onTable = table && Math.abs(s.at.x - table.at.x) <= table.body.width / 2
				const ground = onTable ? table.at.y + table.body.height / 2 : -0.75
				const legLen = s.at.y - bh / 2 - ground
				if (legLen > 0.01)
					for (const dx of [-bw * 0.35, bw * 0.35]) {
						const leg = kit.mesh(kit.cylinderY(0.006, legLen, 12), steel)
						leg.position.set(s.at.x + dx, ground + legLen / 2, -0.02)
						ctx.group.add(leg)
					}
				draws.push({ item: P.watch, se, canvas, tex, W, H, zero: P.zero === "floor" ? "floor" : "lowest", title: `Energy of ${nameOf(P.watch)}`, shown: -1, plane })
			}
			// an item's own small bars (show_energy), over it
			for (const r of recs) {
				if (r.bars !== true) continue
				const se = series(r.item)
				if (!se) continue
				const W = 512
				const H = 256
				const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H })
				const tex = new THREE.CanvasTexture(canvas)
				tex.colorSpace = THREE.SRGBColorSpace
				const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
				sprite.scale.set(0.24, 0.12, 1)
				sprite.renderOrder = 22
				sprite.layers.set(ctx.HUD_LAYER)
				ctx.group.add(sprite)
				// beside the item (to the right of its moving solids, at their middle's height), as big as a third of the scene's width allows
				const parts = ctx.solidsOf(r.item).filter((q) => q.kind === "dynamic")
				const reach = parts.reduce((a, q) => Math.max(a, q.body.kind === "ball" ? q.body.radius : q.body.kind === "slab" ? Math.max(q.body.width, q.body.height) / 2 : Math.max(...q.body.points.map((v) => Math.hypot(v.x, v.y)))), 0.02)
				let sx0 = Infinity
				let sx1 = -Infinity
				for (const q of ctx.doc.solids) if (q.itemType !== "table" && !q.hidden_3d) {
					sx0 = Math.min(sx0, q.at.x)
					sx1 = Math.max(sx1, q.at.x)
				}
				const wide = Math.min(0.32, Math.max(0.1, 0.3 * (Number.isFinite(sx0) ? Math.max(0.3, sx1 - sx0 + 2 * reach) : 1)))
				sprite.scale.set(wide, wide / 2, 1)
				// (above and to the right: clear of its force arrows' labels beside it)
				draws.push({ item: r.item, se, canvas, tex, W, H, zero: "lowest", title: null, shown: -1, sprite, parts, dx: reach + wide * 0.55, dy: reach + wide * 0.3 })
			}
			if (!draws.length) return null
			return {
				frame(t) {
					for (const d of draws) {
						if (d.sprite && d.parts.length) {
							let x = 0
							let y = 0
							let n = 0
							for (const q of d.parts) {
								const p = ctx.placementAt(q.id, t)
								if (!p) continue
								x += p.x
								y += p.y
								n++
							}
							if (n) d.sprite.position.set(x / n + d.dx, y / n + d.dy, 0.05)
						}
						const key = Math.round(t * 60)
						if (key === d.shown) continue
						d.shown = key
						paint(d.canvas.getContext("2d"), d.W, d.H, d.item, d.se, t, d.zero, d.title)
						d.tex.needsUpdate = true
					}
				},
				dispose() {
					for (const d of draws) {
						d.tex.dispose()
						d.plane?.geometry.dispose()
						d.sprite?.material.dispose()
					}
				}
			}
		}
	})

	// ============================================================== glow: a soft halo round an item's solids
	addViewPlugin({
		name: "mechanics:glow",
		load(ctx) {
			const glowing = ctx.doc.solids.filter((s) => s.glow === true && !s.hidden_3d)
			if (!glowing.length) return null
			const halo = new THREE.MeshBasicMaterial({ color: "#ffd84a", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
			const parts = []
			for (const s of glowing) {
				const b = s.body
				let geo
				const grow = 0.015
				if (b.kind === "ball") geo = new THREE.SphereGeometry(b.radius + grow, 24, 16)
				else {
					const pts = b.kind === "polygon" ? b.points : [{ x: -b.width / 2, y: -b.height / 2 }, { x: b.width / 2, y: -b.height / 2 }, { x: b.width / 2, y: b.height / 2 }, { x: -b.width / 2, y: b.height / 2 }]
					const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
					const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
					const shape = new THREE.Shape(pts.map((p) => {
						const dx = p.x - cx
						const dy = p.y - cy
						const n = Math.hypot(dx, dy) || 1
						return new THREE.Vector2(p.x + (dx / n) * grow, p.y + (dy / n) * grow)
					}))
					const depth = (b.depth ?? 0.05) + 2 * grow
					geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
					geo.translate(0, 0, -depth / 2)
				}
				const mesh = new THREE.Mesh(geo, halo)
				mesh.renderOrder = 5
				mesh.layers.set(ctx.HUD_LAYER)
				ctx.group.add(mesh)
				parts.push({ s, mesh })
			}
			return {
				frame: (t) => {
					halo.opacity = 0.22 + 0.1 * Math.sin(t * 2 * Math.PI * 0.8)
					for (const q of parts) {
						const p = ctx.placementAt(q.s.id, t) ?? { x: q.s.at.x, y: q.s.at.y, angle: q.s.angle ?? 0 }
						q.mesh.position.set(p.x, p.y, 0)
						q.mesh.rotation.z = p.angle
					}
				},
				dispose: () => {
					for (const q of parts) q.mesh.geometry.dispose()
					halo.dispose()
				}
			}
		}
	})

	// ============================================================== holders from above: a thing held in a liquid (holdFrom "above")
	// A cork held down on a tank's floor, a grape held under the water: a grey plastic rod comes straight down from a steel arm over the tank
	// and its two-pronged foot holds the thing's top; the arm runs along the tank, over its rim, to a wooden post standing on the table just
	// past the tank's nearer end (the view's pull pin and post are not drawn for it: web/view3d.js). At the release the arm, rod and foot slide
	// up the post at once (ease-out, 0.15 s) until the foot is 2 cm over the liquid and the rim, and stay there: what was held floats up or
	// sinks on its own. Render only (machines/mod_mechanics.py _holds).
	const holderPlastic = kit.plastic("#d4d8dd", { gloss: 0.35, key: "mechanics|holder" })
	const holderWood = kit.wood("#b07a45")
	const LIFT_S = 0.15
	addViewPlugin({
		name: "mechanics:holders",
		load(ctx) {
			const held = new Set(ctx.doc.release?.parts ?? [])
			const marked = ctx.doc.solids.filter((s) => s.holdFrom === "above" && held.has(s.id))
			if (!marked.length) return null
			const at0 = (s) => ctx.placementAt(s.id, 0) ?? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 }
			/** a body's outline's reach up, down and to the sides from its middle at angle a (m) */
			const extent = (s, a) => {
				const b = s.body
				if (b.kind === "ball") return { up: b.radius, down: b.radius, half: b.radius }
				const pts = b.kind === "polygon" ? b.points.map((p) => [p.x, p.y]) : [[-b.width / 2, -b.height / 2], [b.width / 2, -b.height / 2], [b.width / 2, b.height / 2], [-b.width / 2, b.height / 2]]
				const c = Math.cos(a)
				const n = Math.sin(a)
				const xs = pts.map(([x, y]) => x * c - y * n)
				const ys = pts.map(([x, y]) => x * n + y * c)
				return { up: Math.max(...ys), down: -Math.min(...ys), half: (Math.max(...xs) - Math.min(...xs)) / 2 }
			}
			const liquids = (ctx.doc.processes ?? []).filter((p) => p.kind === "liquid")
			const tAt = ctx.doc.release?.at ?? 0.5
			const rigs = []
			for (const item of [...new Set(marked.map((s) => s.item))]) {
				const mine = marked.filter((s) => s.item === item)
				// (it holds the item's top: the held part whose outline reaches highest)
				const top = mine.map((s) => ({ s, p: at0(s), e: extent(s, at0(s).angle) })).sort((a, b) => b.p.y + b.e.up - (a.p.y + a.e.up))[0]
				const x = top.p.x
				const foot = top.p.y + top.e.up
				const liq = liquids.find((q) => q.x0 < x && x < q.x1) ?? null
				const surface = liq ? liq.floor + (liq.layers ?? []).reduce((a, l) => a + l.height, 0) : foot
				const clear = Math.max(surface, liq?.rim ?? surface) + 0.02
				const lift = Math.max(0, clear - foot)
				const armY = Math.max(foot, clear) + 0.06
				// (the post stands on the table 4 cm past the container's nearer end wall, a hair behind the machine plane; its foot where the container's is)
				const walls = liq ? ctx.solidsOf(liq.item) : []
				const outer = (sx) => walls.reduce((m, s) => (sx < 0 ? Math.min(m, s.at.x - (s.body?.width ?? 0) / 2) : Math.max(m, s.at.x + (s.body?.width ?? 0) / 2)), sx < 0 ? x : x)
				const side = liq && x - liq.x0 > liq.x1 - x ? 1 : -1
				const xPost = liq ? outer(side) + side * 0.04 : x - 0.1
				const zPost = -0.02
				const base = walls.length ? walls.reduce((m, s) => Math.min(m, s.at.y - (s.body?.height ?? 0) / 2), Infinity) : 0
				const r = Math.max(0.006, Math.min(0.016, top.e.half * 0.7))
				const g = new THREE.Group()
				g.name = `holder:${item}`
				const rodLen = armY - foot
				const rod = kit.mesh(kit.cylinderY(0.004, rodLen, 20), holderPlastic)
				rod.position.set(0, rodLen / 2, 0)
				const pad = kit.mesh(kit.cylinderY(r, 0.003, 28), holderPlastic)
				pad.position.set(0, 0.0015, 0)
				g.add(rod, pad)
				// a fork over its top: a yoke across it and two tines down its sides to its middle's height, at most 2.5 cm (they hold a thing that
				// sinks, as the pad holds one that floats)
				const deep = Math.min(0.012, 2 * r)
				const yoke = kit.mesh(kit.box(2 * top.e.half + 0.009, 0.003, deep), holderPlastic)
				yoke.position.set(0, 0.0015, 0)
				g.add(yoke)
				const tine = Math.min(0.025, top.e.up)
				for (const sx of [-1, 1]) {
					const p = kit.mesh(kit.box(0.003, tine + 0.003, deep), holderPlastic)
					p.position.set(sx * (top.e.half + 0.003), 0.003 - tine / 2, 0)
					g.add(p)
				}
				// (the arm along x from the rod's top to the post, behind the rod by its own width)
				const armLen = Math.abs(xPost - x) + 0.012
				const arm = kit.mesh(kit.box(armLen, 0.012, 0.012, 0.002), kit.steel())
				arm.position.set((xPost - x) / 2, rodLen + 0.006, zPost)
				g.add(arm)
				g.position.set(x, foot, 0)
				const postH = armY + lift + 0.04 - base
				const post = kit.mesh(kit.cylinderY(0.009, postH, 20), holderWood)
				post.position.set(xPost, base + postH / 2, zPost)
				ctx.group.add(g, post)
				rigs.push({ g, x, foot, lift })
			}
			return {
				frame: (t) => {
					for (const q of rigs) {
						const u = Math.min(1, Math.max(0, (t - tAt) / LIFT_S))
						q.g.position.set(q.x, q.foot + q.lift * (1 - (1 - u) * (1 - u)), 0)
					}
				}
			}
		}
	})
}
