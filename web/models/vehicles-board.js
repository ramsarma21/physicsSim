// The skateboard: a seven-ply maple deck with kicktails (one smooth bent plank: the catalog's flat middle and two kicks), black grip tape on top,
// a printed graphic underneath, ply edges; two cast-aluminium trucks (baseplate, bushing block, hanger and axle) and four urethane wheels
// (a pair on each axle) with printed sidewalls and chrome axle nuts. The nose and tail parts and the trucks' outlines are covered by the deck and truck models.
const G = 9.81

export default function register(addModel, L, kit) {
	const T = L.THREE
	const { TAU, mix, rng, fbm, shade, put, mat, decalMat, quadGeo, normalMap, M, roundPoly, offsetPoly, clipPoly, sculpt, revolveZ, roundedProfile, bounds } = L
	const clamp = L.clamp

	// ----------------------------------------------------------------- the deck
	/** The neutral line's height at x: flat in the middle, rising at tan(kick) beyond a, joined by a circular arc of radius Rb (the model stays within ~1 mm of the polygons). */
	function bend(a, tanK, Rb) {
		const kick = Math.atan(tanK)
		const T0 = Rb * Math.tan(kick / 2)
		const x1 = a - T0 // where the arc starts
		const x2 = x1 + Rb * Math.sin(kick)
		const y2 = Rb - Rb * Math.cos(kick)
		return (x) => {
			const u = Math.abs(x)
			if (u <= x1) return 0
			if (u <= x2) return Rb - Math.sqrt(Math.max(0, Rb * Rb - (u - x1) * (u - x1)))
			return y2 + (u - x2) * tanK
		}
	}
	const PLY = ["#e8cfa0", "#d9b87e", "#ead3a6", "#c79d62", "#e6cb9b", "#d6b277", "#eed7ac"]
	const plyTex = () => kit.tex("veh|plies", 64, 256, (g, W, H) => {
		const r = rng(5)
		const n = 7
		for (let i = 0; i < n; i++) {
			const y0 = Math.round((i / n) * H)
			const y1 = Math.round(((i + 1) / n) * H)
			g.fillStyle = i === 2 || i === 4 ? "#b9803f" : PLY[i % PLY.length]
			g.fillRect(0, y0, W, y1 - y0)
			g.fillStyle = "rgba(60,35,10,0.35)"
			g.fillRect(0, y0, W, 2) // the glue line
			for (let k = 0; k < 40; k++) {
				g.fillStyle = `rgba(90,55,20,${0.05 + 0.1 * r()})`
				g.fillRect(r() * W, y0 + 3 + r() * (y1 - y0 - 5), 3 + r() * 18, 1)
			}
		}
	}, { wrap: true })

	function deck(ctx) {
		// the middle piece is ctx.body; the nose and tail are drawn here too (the catalog's two kicks, 17 degrees over a fifth of the length each)
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const b = bounds(pts)
		const t = b.y1 - b.y0
		const a = b.x1 // half length of the flat part
		const Lc = ctx.props.length ?? 0.8
		const half = Lc / 2
		const tanK = Math.tan((17 * Math.PI) / 180)
		const hzMax = ctx.d / 2
		const yN = bend(a, tanK, 0.07)
		// plan outline: straight sides, semi-elliptical ends
		const endA = 0.088
		const xe0 = half - endA
		const hzAt = (x) => {
			const u = Math.abs(x)
			if (u <= xe0) return hzMax
			const q = (u - xe0) / endA
			return hzMax * Math.sqrt(Math.max(0, 1 - q * q))
		}
		// slices along x: dense toward the tips
		const NM = 50
		const NE = 16
		const slices = []
		for (let i = NE; i >= 1; i--) slices.push(-(xe0 + endA * Math.sin((i / NE) * (Math.PI / 2))))
		for (let i = 0; i <= NM; i++) slices.push(-xe0 + (2 * xe0 * i) / NM)
		for (let i = 1; i <= NE; i++) slices.push(xe0 + endA * Math.sin((i / NE) * (Math.PI / 2)))
		// the bend is a circular arc of radius 70 mm (about 20 mm long): enough slices across it that the deck reads as one smoothly bent plank, not a fold with a seam in its edge
		{
			const kick = Math.atan(tanK)
			const xs1 = a - 0.07 * Math.tan(kick / 2)
			const xs2 = xs1 + 0.07 * Math.sin(kick)
			const near = (v) => slices.some((q) => Math.abs(q - v) < 0.0008)
			for (let i = 0; i <= 12; i++) {
				const u = xs1 - 0.004 + ((xs2 - xs1 + 0.008) * i) / 12
				for (const v of [u, -u]) if (!near(v)) slices.push(v)
			}
			slices.sort((p, q) => p - q)
		}
		const g = kit.group()
		const geos = kit.geo(`veh|deckgeo|${Lc}|${ctx.d}|${t}|${a}`, () => {
			const rt = 0.0032
			const rb = 0.0024
			const NF = 10
			const NC = 3
			const NS = 2
			const T2 = t / 2
			// the section ring (y, z, region): top flat, top-right corner, right side, bottom-right corner, bottom, bottom-left, left side, top-left (regions: 0 top, 1 edge, 2 bottom)
			const CONC = 0.0036 // the deck's concave: the plies bend up toward the rails by this much (the rails reach the outline's top, the middle of the top sits CONC lower)
			const topY = (z, hz) => T2 - CONC * (1 - (z / hz) * (z / hz)) * Math.min(1, hz / hzMax * 1.5)
			const botY = (z, hz) => -T2 + CONC * (z / hz) * (z / hz) * Math.min(1, hz / hzMax * 1.5)
			const ringAt = (hz) => {
				const r1 = Math.min(rt, hz * 0.45, t * 0.3)
				const r2 = Math.min(rb, hz * 0.45, t * 0.3)
				const R = []
				for (let i = 0; i <= NF; i++) {
					const z = mix(-(hz - r1), hz - r1, i / NF)
					R.push([topY(z, hz), z, 0])
				}
				for (let i = 1; i <= NC; i++) {
					const q = (i / NC) * (Math.PI / 2)
					R.push([T2 - r1 + r1 * Math.cos(q), hz - r1 + r1 * Math.sin(q), 1])
				}
				for (let i = 1; i < NS; i++) R.push([mix(T2 - r1, botY(hz, hz) + r2, i / NS), hz, 1])
				for (let i = 0; i <= NC; i++) {
					const q = (i / NC) * (Math.PI / 2)
					R.push([botY(hz, hz) + r2 - r2 * Math.sin(q), hz - r2 + r2 * Math.cos(q), 1])
				}
				for (let i = 1; i < NF; i++) {
					const z = mix(hz - r2, -(hz - r2), i / NF)
					R.push([botY(z, hz), z, 2])
				}
				for (let i = 0; i <= NC; i++) {
					const q = (i / NC) * (Math.PI / 2)
					R.push([botY(-hz, hz) + r2 - r2 * Math.cos(q), -(hz - r2) - r2 * Math.sin(q), 1])
				}
				for (let i = 1; i < NS; i++) R.push([mix(botY(-hz, hz) + r2, T2 - r1, i / NS), -hz, 1])
				for (let i = 1; i < NC; i++) {
					const q = (i / NC) * (Math.PI / 2)
					R.push([T2 - r1 + r1 * Math.sin(q), -(hz - r1) - r1 * Math.cos(q), 1])
				}
				return R
			}
			const n = ringAt(hzMax).length
			const P = []
			const REG = []
			const SA = []
			let sAlong = 0
			let prev = null
			for (const x of slices) {
				const hz = Math.max(0.0004, hzAt(x))
				const R = ringAt(hz)
				const y0 = yN(x)
				if (prev !== null) sAlong += Math.hypot(x - prev.x, y0 - prev.y, hz - prev.hz) // along the edge, round the plan's rounded tip too: the ply stripes keep an even grain there
				prev = { x, y: y0, hz }
				for (let i = 0; i < n; i++) {
					P.push(x, y0 + R[i][0], R[i][1])
					REG.push(R[i][2])
					SA.push(sAlong)
				}
			}
			const tris = [[], [], []]
			for (let si = 0; si < slices.length - 1; si++) {
				for (let i = 0; i < n; i++) {
					const j = (i + 1) % n
					const va = si * n + i
					const vb = si * n + j
					const vc = (si + 1) * n + j
					const vd = (si + 1) * n + i
					const rr = REG[va] === REG[vb] ? REG[va] : 1
					tris[rr].push(va, vb, vc, va, vc, vd)
				}
			}
			// close both tips: a fan round each end ring's middle (the open end showed a dark crack). The fan has vertices of its own with the ply edge's uv (a shared ring vertex carries the
			// top's or the bottom's uv: the sliver showed as a light line across the tip)
			for (const [si, flip] of [[0, true], [slices.length - 1, false]]) {
				let cy = 0
				let cz = 0
				for (let i = 0; i < n; i++) {
					cy += P[(si * n + i) * 3 + 1] / n
					cz += P[(si * n + i) * 3 + 2] / n
				}
				const base = P.length / 3
				for (let i = 0; i < n; i++) {
					P.push(P[(si * n + i) * 3], P[(si * n + i) * 3 + 1], P[(si * n + i) * 3 + 2])
					REG.push(1)
					SA.push(SA[si * n])
				}
				const ci = P.length / 3
				P.push(slices[si], cy, cz)
				REG.push(1)
				SA.push(SA[si * n])
				for (let i = 0; i < n; i++) {
					const va = base + i
					const vb = base + ((i + 1) % n)
					if (flip) tris[1].push(ci, vb, va)
					else tris[1].push(ci, va, vb)
				}
			}
			const out = new T.BufferGeometry()
			out.setAttribute("position", new T.Float32BufferAttribute(P, 3))
			const U2 = new Float32Array((P.length / 3) * 2)
			for (let v = 0; v < P.length / 3; v++) {
				const x = P[v * 3]
				const y = P[v * 3 + 1]
				const z = P[v * 3 + 2]
				if (REG[v] === 1) {
					U2[v * 2] = SA[v] * 7
					U2[v * 2 + 1] = (y - yN(x) + T2) / t
				} else if (REG[v] === 0) {
					U2[v * 2] = x * 5
					U2[v * 2 + 1] = z * 5
				} else {
					U2[v * 2] = (x + half) / (2 * half)
					U2[v * 2 + 1] = (z + hzMax) / (2 * hzMax)
				}
			}
			out.setAttribute("uv", new T.BufferAttribute(U2, 2))
			out.setIndex([...tris[0], ...tris[1], ...tris[2]])
			out.addGroup(0, tris[0].length, 0)
			out.addGroup(tris[0].length, tris[1].length, 1)
			out.addGroup(tris[0].length + tris[1].length, tris[2].length, 2)
			return L.creased(out, 50)
		})
		const grit = normalMap("grit", 256, 256, (x, y) => L.hash(x, y, 3) * 0.7 + fbm(x / 2.5, y / 2.5, 2, 6, 0) * 0.3, { strength: 2.2 })
		const grip = mat("griptape", { color: "#141516", roughness: 0.97, metalness: 0, normalMap: grit, normalScale: new T.Vector2(1.5, 1.5), sheen: 0.4, sheenRoughness: 0.5, sheenColor: new T.Color("#5a5d63") })
		const edge = mat("ply-edge", { map: plyTex(), roughness: 0.55, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3 })
		const bottom = mat("deck-graphic", { map: graphic(), roughness: 0.32, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.12 })
		g.add(put(geos, [grip, edge, bottom]))
		return g
	}
	/** The printed graphic under the deck: a sun and waves, a wordmark (u across the length, v across the width). */
	function graphic() {
		return kit.tex("veh|deck-graphic", 2048, 512, (c, W, H) => {
			c.fillStyle = "#f0dcb0"
			c.fillRect(0, 0, W, H)
			// background bands
			const grd = c.createLinearGradient(0, 0, W, 0)
			grd.addColorStop(0, "#14606b")
			grd.addColorStop(0.5, "#1d8a8f")
			grd.addColorStop(1, "#14606b")
			c.fillStyle = grd
			c.fillRect(0, 0, W, H)
			// a big sun
			c.fillStyle = "#f2a900"
			c.beginPath()
			c.arc(W / 2, H * 0.92, H * 0.78, Math.PI, TAU)
			c.fill()
			c.fillStyle = "#e24a1f"
			c.beginPath()
			c.arc(W / 2, H * 0.92, H * 0.52, Math.PI, TAU)
			c.fill()
			c.fillStyle = "#f7e2b4"
			c.beginPath()
			c.arc(W / 2, H * 0.92, H * 0.26, Math.PI, TAU)
			c.fill()
			// waves
			c.strokeStyle = "#f7e2b4"
			c.lineWidth = 9
			for (let r = 0; r < 4; r++) {
				c.beginPath()
				for (let x = 0; x <= W; x += 8) {
					const y = H * (0.12 + r * 0.045) + Math.sin(x * 0.03 + r) * 10
					x ? c.lineTo(x, y) : c.moveTo(x, y)
				}
				c.stroke()
			}
			c.fillStyle = "#f7e2b4"
			c.font = "900 110px ui-sans-serif, Helvetica, Arial, sans-serif"
			c.textAlign = "center"
			c.textBaseline = "middle"
			c.fillText("SANDBOX", W * 0.21, H * 0.42)
			c.fillText("SKATE CO.", W * 0.79, H * 0.42)
		}, { wrap: false })
	}

	// ----------------------------------------------------------------- the trucks
	// A real skateboard truck, drawn inside the catalog's trapezoid (deck bottom down to just over the wheels): a cast baseplate on the deck with four nuts, a pivot cup, the kingpin
	// leaning ~50 degrees toward the board's middle with two urethane bushings (a cone over a barrel) in cup washers and a nut, and the cast hanger: a web from the bushing seat
	// down through a narrow neck to the axle housing, which is drawn with the wheels (a taper from 20 mm to 14 mm toward them).
	const cast = () => mat("alu-cast", { color: "#bfc4cb", roughness: 0.42, metalness: 1, normalMap: L.grainNormal("cast", { size: 128, cell: 8, strength: 0.8 }), normalScale: new T.Vector2(0.45, 0.45) })
	function truck(ctx) {
		const pts = ctx.body.points.map((p) => [p.x, p.y])
		const b = bounds(pts)
		const cx = (b.x0 + b.x1) / 2
		const o = cx > 0 ? 1 : -1 // outward: toward the wheels' end of the board
		const g = kit.group()
		const alu = cast()
		const steel = M.steel("#9da3ab", 0.3)
		const dark = M.steel("#4a4e55", 0.4)
		const P = ctx.props
		const r = (P.wheel_diameter ?? 0.054) / 2
		const top = b.y1 // the deck's underside
		const wy = b.y0 - r - 0.0035 // the axle's height in the deck's frame (the outline stops 3.5 mm over the wheels' tops)
		const to = (X, y, z = 0) => [cx + o * X, y, z] // a point in truck coordinates: X outward from the middle of the truck
		// ---- the baseplate: a 6 mm plate, 90 x 62, with four nuts
		const bp = kit.geo("veh|baseplate", () => {
			const sh = new T.Shape(L.roundPoly([[-0.045, -0.031], [0.045, -0.031], [0.045, 0.031], [-0.045, 0.031]], { dev: 0.001, maxR: 0.006 }).map(([x, z]) => new T.Vector2(x, z)))
			const geo = new T.ExtrudeGeometry(sh, { depth: 0.0054, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 1, curveSegments: 4 })
			geo.rotateX(Math.PI / 2) // the plate lies in x-z, thickness down from y = 0 (shape y -> -z)
			return geo
		})
		g.add(put(bp, alu, cx, top - 0.0003, 0))
		const hexN = kit.geo("veh|baseplatenut", () => new T.CylinderGeometry(0.0037, 0.0037, 0.0024, 6))
		for (const X of [-0.027, 0.027]) for (const zz of [-0.02, 0.02]) {
			g.add(put(hexN, steel, cx + X, top - 0.0069, zz))
			g.add(put(kit.cylinderY(0.0014, 0.0022, 10), steel, cx + X, top - 0.0004, zz))
		}
		// ---- the kingpin: from a boss under the plate, leaning 50 degrees down toward the board's middle
		const ang = (50 * Math.PI) / 180
		const B = [-0.004, top - 0.0068] // where the kingpin leaves the baseplate (X outward, y)
		const dir = [-Math.cos(ang), -Math.sin(ang)] // toward the middle and down
		const at = (t0) => [B[0] + dir[0] * t0, B[1] + dir[1] * t0]
		const alongAxis = (geom, mt, t0, extra = null) => {
			const [X, y] = at(t0)
			const m = put(geom, mt, cx + o * X, y, 0)
			// the cylinder's axis is y: lay it along the kingpin (toward `dir`)
			const phi = Math.atan2(dir[0] * o, dir[1]) // rotation about z that takes +y to the axis direction in world x (outward sign o)
			m.rotation.z = -phi
			return m
		}
		const kp = alongAxis(kit.cylinderY(0.0021, 0.0215, 14), steel, 0.01075)
		g.add(kp)
		g.add(alongAxis(kit.cylinderY(0.0072, 0.0048, 20, 0.0055), alu, 0.0024)) // the boss
		const bushT = mat("bushing-a", { color: "#e0a000", roughness: 0.4, metalness: 0, clearcoat: 0.4 })
		const bushB = mat("bushing-b", { color: "#c9301c", roughness: 0.4, metalness: 0, clearcoat: 0.4 })
		const barrel = kit.cylinderY(0.0058, 0.0058, 24)
		const cone = kit.cylinderY(0.0058, 0.0044, 24, 0.0036)
		const cup = kit.cylinderY(0.0069, 0.0014, 24, 0.0069)
		g.add(alongAxis(barrel, bushT, 0.0078), alongAxis(cone, bushT, 0.0115)) // the upper bushing (board side): a barrel under a cone
		g.add(alongAxis(cup, steel, 0.0051)) // its cup washer
		g.add(alongAxis(kit.cylinderY(0.0078, 0.0036, 24, 0.0078), alu, 0.0148)) // the hanger's seat
		g.add(alongAxis(barrel, bushB, 0.0194), alongAxis(cone, bushB, 0.0231))
		g.add(alongAxis(cup, steel, 0.0175))
		g.add(alongAxis(kit.cylinderY(0.0078, 0.0014, 24), steel, 0.0258)) // the washer
		g.add(alongAxis(new T.CylinderGeometry(0.0054, 0.0054, 0.0046, 6), steel, 0.0289)) // the nut
		// ---- the pivot: a steel cup on the baseplate's outer end, the hanger's pin
		g.add(put(kit.cylinderZ(0.0045, 0.014, 20), steel, cx + o * 0.0285, top - 0.0098, 0))
		g.add(put(kit.cylinderZ(0.0021, 0.019, 12), dark, cx + o * 0.0285, top - 0.0098, 0))
		// ---- the hanger: a cast web from the pivot and the bushing seat down a narrow neck to the axle housing
		const web = [[-0.0145, top - 0.0105], [0.0295, top - 0.0072], [0.0105, top - 0.0242], [0.0072, wy + 0.0085], [-0.0072, wy + 0.0085], [-0.0105, top - 0.0242]]
		const wpts = web.map(([X, y]) => [o * X, y]) // mirrored for the far truck: keep the polygon counter-clockwise
		const poly = o > 0 ? wpts.slice().reverse() : wpts // counter-clockwise
		const webGeo = L.sculpt(poly.map(([x, y]) => [x, y]), 0.0085, { key: `trweb2|${o}|${wy.toFixed(5)}|${top.toFixed(5)}`, shape: () => ({ a: 0.0012, b: 0.0016 }), steps: 3, crease: 45 })
		g.add(put(webGeo, alu, cx, 0, 0))
		return g
	}

	// ----------------------------------------------------------------- the wheels: a pair on each axle, with the hanger between them
	function wheelPair(ctx) {
		const R = ctx.r
		const k = R / 0.027
		const w = 0.032 * k
		const zOuter = ctx.d / 2 - 0.0026
		const zc = zOuter - w / 2
		const g = kit.group()
		const rb = 0.0138 * k // the core
		const c = 0.0078 * k
		const prof = roundedProfile([[rb, -w / 2], [R, -w / 2, c], [R, w / 2, c], [rb, w / 2]], 8)
		const geo = revolveZ(prof, { segments: 72, key: `skatewheel|${R.toFixed(5)}|${w.toFixed(5)}` })
		const urethane = mat("urethane-amber", { color: ctx.solid.color ?? "#f0a006", roughness: 0.36, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, sheen: 0.3, sheenColor: new T.Color("#ffd27a"), sheenRoughness: 0.5 })
		const core = mat("skate-core", { color: "#e9e7e0", roughness: 0.5, metalness: 0, clearcoat: 0.3 })
		const band = R - c // the flat sidewall between the core and the rounded shoulder
		const faceTex = kit.tex(`veh|wheelface|${(rb / band).toFixed(3)}`, 1024, 1024, (cc, W, H) => {
			cc.clearRect(0, 0, W, H)
			cc.translate(W / 2, H / 2)
			cc.fillStyle = "rgba(255,248,230,0.97)"
			cc.font = "800 70px ui-sans-serif, Helvetica, Arial, sans-serif"
			cc.textAlign = "center"
			cc.textBaseline = "middle"
			const txt = "SANDBOX  54mm  99A  "
			const rad = ((rb + band) / 2 / band) * (W / 2)
			const n = txt.length
			for (let i = 0; i < n; i++) {
				const a = ((i + 0.5) / n) * TAU - Math.PI / 2
				cc.save()
				cc.rotate(a + Math.PI / 2)
				cc.translate(0, -rad)
				cc.fillText(txt[i], 0, 0)
				cc.restore()
			}
		}, { wrap: false })
		const faceMat = mat(`skate-face|${(rb / band).toFixed(3)}`, { map: faceTex, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
		const ring = kit.geo(`veh|skatering|${R.toFixed(5)}|${rb.toFixed(5)}`, () => new T.RingGeometry(rb * 0.99, band, 72, 1))
		const nutGeo = kit.geo(`veh|skatenut|${k.toFixed(3)}`, () => new T.CylinderGeometry(0.0058 * k, 0.0058 * k, 0.0014, 6).rotateX(Math.PI / 2))
		const wheel = () => {
			const wg = kit.group()
			wg.add(put(geo, urethane))
			// the core and bearing
			wg.add(put(kit.cylinderZ(rb + 0.0004, w - 0.0022 * k, 36), core, 0, 0, 0))
			wg.add(put(kit.torus(0.0098 * k, 0.0010 * k, 8, 40), M.steel("#b8bec6", 0.25), 0, 0, w / 2 - 0.0013 * k))
			wg.add(put(kit.cylinderZ(0.0086 * k, 0.0012 * k, 40), mat("bearing-dark", { color: "#2b2e33", roughness: 0.4, metalness: 0.9 }), 0, 0, w / 2 - 0.0008 * k))
			const decal = put(ring, faceMat, 0, 0, w / 2 + 0.0002, null, { cast: false })
			wg.add(decal)
			wg.add(put(kit.cylinderZ(0.0074 * k, 0.0011, 32), M.steel("#c7ccd3", 0.2), 0, 0, w / 2 + 0.00055)) // washer
			wg.add(put(nutGeo, M.steel("#c3c8cf", 0.22), 0, 0, w / 2 + 0.0018))
			return wg
		}
		const right = wheel()
		right.position.z = zc
		const left = wheel()
		left.rotation.y = Math.PI
		left.position.z = -zc
		g.add(right, left)
		// the axle and the hanger's axle housing between the wheels: a taper from 20 mm across in the middle to 14 mm toward the wheels, speed washers on the axle's ends
		const zE = zc - w / 2 - 0.0002
		g.add(put(kit.cylinderZ(0.0042 * k, 2 * zOuter, 16), M.steel("#8f959c", 0.3)))
		const alu = mat("alu-cast", { color: "#bfc4cb", roughness: 0.42, metalness: 1, normalMap: L.grainNormal("cast", { size: 128, cell: 8, strength: 0.8 }), normalScale: new T.Vector2(0.45, 0.45) })
		const housing = revolveZ([[0.0044 * k, -zE], [0.0070 * k, -zE], [0.0100 * k, 0], [0.0070 * k, zE], [0.0044 * k, zE]], { segments: 32, key: `skatehousing|${k.toFixed(3)}|${zE.toFixed(5)}`, creaseDeg: 50 })
		g.add(put(housing, alu))
		for (const sz of [1, -1]) {
			g.add(put(kit.cylinderZ(0.0062 * k, 0.0012, 20), M.steel("#c7ccd3", 0.2), 0, 0, sz * (zc - w / 2 + 0.0004))) // the speed washer on the inside of the wheel
		}
		return g
	}

	addModel("skateboard", "chassis", deck)
	addModel("skateboard", "nose", null)
	addModel("skateboard", "tail", null)
	addModel("skateboard", "truck1", truck)
	addModel("skateboard", "truck2", truck)
	addModel("skateboard", "front", wheelPair)
	addModel("skateboard", "rear", wheelPair)
}
