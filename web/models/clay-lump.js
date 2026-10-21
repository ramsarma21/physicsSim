// The mechanics module's lump of modelling clay (machines/mod_mechanics.py clay-lump), drawn as a hand-pressed lump: round where the generic
// drawing extruded its side outline into a flat-topped six-sided prism, which on a car's roof read as a roof box. Its side outline is the
// physics' (CLAY_SHAPE: a flat foot as wide as the lump, sides sloping in to a narrow top), so what is seen is what touches: a solid of
// revolution about its upright through that outline (round seen from above, as wide as it is deep), its corners softened, its top a low
// dome, its surface dented by fingers and smeared (a baked normal map) and a little uneven all round (pressed in, never out of the outline).
// mod-mechanics.js registers it.
import { makeLib } from "./surfaces-lib.js"

/** The lump's half-width at height y (the polygon's outline in its own frame), from its points. */
function halfWidthAt(pts, y) {
	let best = 0
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const a = pts[i]
		const b = pts[(i + 1) % n]
		if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue
		const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
		best = Math.max(best, Math.abs(x))
	}
	return best
}

export function registerClayLump({ addModel, kit, THREE }) {
	const L = makeLib(kit, THREE)
	const T = THREE
	const clayMat = (hex) => {
		const t = L.bake("mech-claylump1", 256, 256, (u, v, o) => {
			// thumb-pressed dents, soft lumps and the fine smears of fingers
			const lump = L.pfbm(u, v, 5, 5, 611, 4)
			const dent = L.pfbm(u, v, 3, 3, 612, 2)
			const smear = L.pn(u * 3 + 0.4 * v, v * 0.6, 40, 12, 613)
			o.r = o.g = o.b = 255
			o.h = 0.5 + 0.3 * (lump - 0.5) - 0.25 * Math.max(0, dent - 0.62) + 0.1 * (smear - 0.5)
			o.rough = 0.8
		}, { normal: 1.2, blur: 1 })
		return L.M(`mech-claylump|${hex}`, { color: hex, normalMap: t.normalMap, normalScale: L.V2(0.45), roughness: 0.74, metalness: 0, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new T.Color("#ffffff") })
	}
	addModel("clay-lump", "clay", (ctx) => {
		const pts = ctx.body?.points
		if (!Array.isArray(pts) || pts.length < 3) return undefined
		const ys = pts.map((p) => p.y)
		const y0 = Math.min(...ys)
		const y1 = Math.max(...ys)
		const h = y1 - y0
		const W = 2 * Math.max(...pts.map((p) => Math.abs(p.x)))
		const key = `mech-claylump|${pts.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(";")}|${(ctx.d ?? W).toFixed(5)}`
		const geo = kit.geo(key, () => {
			// the profile: the outline's half-width up its height, its foot's edge rounded (a lump pressed on a surface curls under a little),
			// its top a low dome; scaled across to its depth (the polygon's depth is the lump's width: round from above)
			const N = 28
			const foot = Math.min(0.18 * h, 0.06 * W)
			const cap = 0.22 * h
			const prof = []
			for (let i = 0; i <= N; i++) {
				const s = i / N
				const y = y0 + h * (0.5 - 0.5 * Math.cos(Math.PI * s)) // (denser near the foot and the top)
				let r = halfWidthAt(pts, Math.min(y1 - 1e-6, Math.max(y0 + 1e-6, y)))
				if (y < y0 + foot) {
					const u = (y0 + foot - y) / foot
					r -= foot * (1 - Math.sqrt(Math.max(0, 1 - u * u)))
				}
				if (y > y1 - cap) {
					const u = (y - (y1 - cap)) / cap
					r *= Math.sqrt(Math.max(0, 1 - u * u * u))
				}
				prof.push(new T.Vector2(Math.max(0, r), y))
			}
			const g = new T.LatheGeometry(prof, 48)
			// uneven all round: pressed in by up to 10 % here and there and its top thumbed down by up to 15 % of its height (never out of the
			// side outline: only in and down), the foot left flat
			const p = g.attributes.position
			const zk = (ctx.d ?? W) / W
			for (let i = 0; i < p.count; i++) {
				const x = p.getX(i)
				const y = p.getY(i)
				const z = p.getZ(i)
				const a = Math.atan2(z, x)
				const rr = Math.hypot(x, z) / (W / 2)
				const up = Math.min(1, Math.max(0, (y - y0) / (0.25 * h)))
				const n = 0.5 + 0.5 * Math.sin(3 * a + 1.3) * Math.sin(2.2 * (y / h) * Math.PI + 0.7) + 0.25 * Math.sin(5 * a + 4 * (y / h))
				const k = 1 - 0.1 * up * Math.min(1, Math.max(0, n))
				// thumb dents on the top: two soft hollows and a ridge between them
				const top = Math.min(1, Math.max(0, (y - (y0 + 0.55 * h)) / (0.45 * h)))
				const tx = x / (W / 2)
				const tz = z / (W / 2)
				const dent = Math.exp(-((tx - 0.25) ** 2 + (tz + 0.15) ** 2) / 0.08) + 0.8 * Math.exp(-((tx + 0.3) ** 2 + (tz - 0.2) ** 2) / 0.06)
				const dy = -0.15 * h * top * Math.min(1, dent) * Math.min(1, 1.5 - rr)
				p.setXYZ(i, x * k, y + Math.min(0, dy), z * k * zk)
			}
			g.computeVertexNormals()
			return g
		})
		return kit.group(kit.mesh(geo, clayMat(ctx.color ?? "#5a9b4a")))
	})
}
