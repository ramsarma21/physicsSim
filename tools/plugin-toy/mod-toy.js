// The toy module's 3D side (what web/models/mod-toy.js would be; a test, never registered by web/models/modules.js): a wax cube model whose
// frame hook warms its colour with its temperature reading and glows as it melts, and a view plugin that labels each cube's temperature.
export default function register({ addModel, addFrameHook, addViewPlugin, ownMaterial, THREE }) {
	addModel("toy-cube", "wax", (ctx) => {
		const geo = new THREE.BoxGeometry(ctx.w, ctx.h, ctx.d)
		const mat = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.6, metalness: 0 })
		const mesh = new THREE.Mesh(geo, mat)
		mesh.userData.frame = { hook: "toy:warm", cold: "#f3ead2", hot: "#ff7a1a" }
		return mesh
	})
	addFrameHook("toy:warm", (obj, f, args) => {
		const m = ownMaterial(obj)
		const T = f.state.temperature ?? 20
		const u = Math.min(1, Math.max(0, (T - 20) / 38))
		m.color.set(args.cold).lerp(new THREE.Color(args.hot), u)
		m.emissive.set(args.hot)
		m.emissiveIntensity = 0.4 * (f.state.melted ?? 0)
		globalThis.__toyHook = { calls: (globalThis.__toyHook?.calls ?? 0) + 1, u, scale: f.scale, color: m.color.getHexString() }
	})
	addViewPlugin({
		name: "toy-labels",
		load(ctx) {
			const cubes = ctx.itemsOfType("toy-cube")
			if (!cubes.length) return null
			const labels = cubes.map((item) => {
				const l = ctx.label({ text: "", height: 0.04 })
				ctx.group.add(l.sprite)
				// (a graph of its temperature over the run, and a heat "beam" from its pad while it is warming)
				const g = ctx.graph({ title: "Temperature", unit: "°C", ymin: 0, ymax: 70 })
				g.mesh.position.set(1.32, 0.17, -0.12)
				ctx.group.add(g.mesh)
				const b = ctx.beam({ color: "#ff5a00", radius: 0.002 })
				ctx.group.add(b.mesh)
				return { item, l, g, b, solid: ctx.solidsOf(item)[0].id, points: ctx.series(item, "temperature") }
			})
			return {
				frame(t) {
					for (const { item, l, g, b, solid, points } of labels) {
						const p = ctx.placementAt(solid, t)
						if (p) l.sprite.position.set(p.x, p.y + 0.06, 0.05)
						const T = ctx.stateAt(item, "temperature", t)
						l.set(T === null ? "" : `${T.toFixed(1)} °C`)
						g.draw(points, t)
						if (p) b.set({ x: p.x, y: 0.0 }, { x: p.x, y: p.y }, (ctx.stateAt(item, "melted", t) ?? 0) < 1 ? 0.8 : 0)
						globalThis.__toyLabel = `${item}: ${T === null ? "" : T.toFixed(1)}`
						globalThis.__toyGraph = points.filter((q) => q.t <= t).length
					}
				},
				dispose() {
					for (const { l, g, b } of labels) {
						l.dispose()
						g.dispose()
						b.dispose()
					}
				}
			}
		}
	})
}
