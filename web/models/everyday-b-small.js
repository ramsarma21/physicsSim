// Small objects with a real silhouette: egg, bowling pin, traffic cone, stapler, pencil, rubber duck. (helpers: everyday-b-lib.js)
// Each fills the outline its physics solids draw (machines/catalog_everyday.py) to within about a millimetre; the 3D shape is the true curve through it.
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, rich, normalTex, dataTex, mat, colorTex, withRepeat, rr, fibres, spaced, latheLin, loftX, rrectPts, spline, roundedPolyline, roundedPolygon, chordAt, superRing, flutedLathe, disc, pixels, satify, meshSDF, smin } = L
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const sm = (t) => t * t * (3 - 2 * t)
	const M = (a) => a / 1000

	// ============================================================= egg: a hen's egg lying on its side, blunt end to the left
	addModel("egg", "egg", ({ props, color }) => {
		// (no egg is wider than it is long, nor narrower than 0.55 of its length, past the most elongated birds' eggs: machines/catalog_everyday.py builds a width outside
		// that as the nearer limit (EGG_MIN_WIDTH), and resolves the item's width to it)
		const Lr = props.length ?? 0.057, B = Math.min(Math.max(props.width ?? 0.044, 0.55 * Lr), Lr)
		const L0 = 57, B0 = 44, w0 = 4.5 // mm: the Hugelschaffer egg, widest 4.5 mm blunt-side of the middle
		const prof = (x) => (B0 / 2) * Math.sqrt(Math.max(0, L0 * L0 - 4 * x * x) / (L0 * L0 + 8 * w0 * x + 4 * w0 * w0))
		const pts = []
		const N = 48 // 48 rings x 96 round: about 9k triangles
		for (let i = 0; i <= N; i++) {
			const a = (i / N) * Math.PI
			const x = (-L0 / 2) * Math.cos(a)
			pts.push(new THREE.Vector2(Math.max(0, prof(x)) / 1000, x / 1000))
		}
		const geo = new THREE.LatheGeometry(pts, 96).rotateZ(-Math.PI / 2)
		const base = color || "#efe2cb"
		const W = 512, H = 256
		const shell = colorTex(`eb-egg-shell|${base}`, W, H, (g) => {
			const c = new THREE.Color(base).convertLinearToSRGB()
			pixels(g, W, H, (x, y) => {
				const u = x / W, v = y / H
				const big = fbm(u * 6, v * 4, 3, 11, 6) // blotchy tone
				const fine = vnoise(x / 1.5, y / 1.5, 5) // chalky grain
				const k = 0.93 + 0.1 * big + 0.03 * fine
				const warm = 0.012 * (big - 0.5)
				return [clamp(c.r * k + warm) * 255, clamp(c.g * k) * 255, clamp(c.b * k - warm) * 255]
			})
			// fine brown freckles, thicker toward the blunt end (v = 0 is the blunt pole)
			const r = rng(77)
			for (let i = 0; i < 700; i++) {
				const v = Math.pow(r(), 1.6)
				g.fillStyle = `rgba(120,84,50,${0.05 + 0.12 * r()})`
				g.beginPath()
				g.ellipse(r() * W, (1 - v) * H, 0.8 + r() * 1.4, 0.6 + r() * 1.0, 0, 0, TAU)
				g.fill()
			}
		})
		const pores = normalTex("eb-egg-pores", 256, 128, (g, Wc, Hc) => pixels(g, Wc, Hc, (x, y) => { const v = 110 + 120 * fbm(x / 1.3, y / 1.3, 2, 21, 197); return [v, v, v] }), { strength: 1.1 })
		const m = mat(`eb-egg|${base}`, { map: shell, normalMap: pores, normalScale: new THREE.Vector2(0.28, 0.28), roughness: 0.52, metalness: 0, clearcoat: 0.16, clearcoatRoughness: 0.45, sheen: 0.25, sheenRoughness: 0.5, sheenColor: "#fff1da" })
		const mesh = kit.mesh(geo, m)
		mesh.scale.set(Lr / 0.057, B / 0.044, B / 0.044)
		const out = kit.group(mesh)
		// lying on a side the shell reaches below the physics' resting flat, a chord just inside the curve, by the flat's inset: a view that lowers a resting polygon onto the table by
		// its gap should lower it this much less (web/view3d.js lowers a model by its polygon's gap alone, so the shell sits that far into the tabletop). machines/catalog_everyday.py:
		// a hen's egg (its blunt end a top: (sy / sx)^2 below 1.115) has the flat 0.52 mm x sqrt(sx sy) inside; a rounder one (up to as wide as long) is made of balls 0.5 mm
		// outside the shell (the shell's own piece never rests on the table, so this is not used)
		const sx = Lr / 0.057, sy = B / 0.044, k = (sy * sy) / (sx * sx)
		const bluntTop = (-28.5 + 1.7961) * 2304 * 2304 - 242 * k * (116964 - 759240 + 116964) <= 0
		out.userData.restGrow = bluntTop ? 0.00052 * Math.sqrt(sx * sy) : 0
		return out
	})
	// (the egg's other physics pieces: the ball that is its blunt end, the pointed tip and the blunt cap; a round egg's balls. The shell above is one mesh, drawn on the piece "egg",
	// whose frame is the egg's own: centred, blunt end to the left)
	for (const part of ["egg-end", "egg-tip", "egg-cap", "egg-b1", "egg-b2", "egg-b3", "egg-b4"]) addModel("egg", part, null)

	// ============================================================= bowling pin: glossy white, two red bands on the neck
	// [y above the foot, radius] in mm: a cubic spline through the USBC Equipment Specifications' diameter-by-height table (0 flat 2.031 in across; 3/4 in up 2.828; 2-1/4: 3.906; 3-3/8: 4.510;
	// 4-1/2: 4.766; 5-7/8: 4.563; 7-1/4: 3.703; 8-5/8: 2.472; 9-3/8: 1.965; 10: 1.797; 10-7/8: 1.870; 11-3/4: 2.094; 12-5/8: 2.406; 13-1/2: 2.547) sampled every 6 mm, then the crown arc of
	// radius 1.273 in (32.34 mm) centred 348.7 mm up. The six physics pieces' chords (machines/catalog_everyday.py) stay within 0.8 mm of it.
	const PIN = [[0, 25.80], [1.5, 26.63], [3, 27.47], [5, 28.58], [7.5, 29.96], [10, 31.31], [13, 32.90], [16, 34.43], [19.05, 35.92], [24, 38.16], [30, 40.62], [36, 42.85], [42, 44.90], [48, 46.82], [54, 48.66], [60, 50.46], [66, 52.24], [72, 53.95], [78, 55.52], [84, 56.92], [90, 58.09], [96, 59.02], [102, 59.73], [108, 60.22], [114, 60.52], [120, 60.62], [126, 60.52], [132, 60.20], [138, 59.65], [144, 58.86], [150, 57.80], [156, 56.47], [162, 54.88], [168, 53.05], [174, 50.99], [180, 48.72], [186, 46.25], [192, 43.61], [198, 40.87], [204, 38.10], [210, 35.35], [216, 32.70], [222, 30.20], [228, 27.95], [234, 26.03], [240, 24.54], [246, 23.52], [252, 22.93], [258, 22.73], [264, 22.85], [270, 23.21], [276, 23.73], [282, 24.34], [288, 25.04], [294, 25.88], [300, 26.86], [306, 27.98], [312, 29.12], [318, 30.16], [324, 30.98], [330, 31.55], [336, 31.97], [342.9, 32.35], [348.7, 32.34], [352, 32.17], [355, 31.71], [358, 30.97], [361, 29.90], [364, 28.49], [367, 26.66], [370, 24.33], [372.5, 21.89], [375, 18.81], [377, 15.64], [378.5, 12.55], [380, 8.11], [380.6, 5.28], [381, 1.49]]
	addModel("bowling-pin", "foot", () => {
		const H = 0.381
		const prof = PIN.map(([y, r]) => [M(r), M(y)])
		prof.push([0, H]) // the dome closes on the axis
		const W = 512, Hh = 2048
		const tex = colorTex("eb-pin-wrap", W, Hh, (g) => {
			const bg = g.createLinearGradient(0, 0, 0, Hh)
			bg.addColorStop(0, "#f6f4ee")
			bg.addColorStop(0.7, "#f8f6f0")
			bg.addColorStop(1, "#f0ecdf")
			g.fillStyle = bg
			g.fillRect(0, 0, W, Hh)
			// two red bands on the neck, a thin dark line each side of them
			const yPx = (mmY) => (1 - mmY / 381) * Hh
			for (const [a, b] of [[258, 268], [276, 286]]) {
				g.fillStyle = "#c4161f"
				g.fillRect(0, yPx(b), W, yPx(a) - yPx(b))
				g.fillStyle = "rgba(60,10,10,0.35)"
				g.fillRect(0, yPx(b) - 1.5, W, 2)
				g.fillRect(0, yPx(a) - 0.5, W, 2)
			}
			// the plastic coating's age: faint scuffs, hairline dings and a duller band where balls hit (belly)
			const r = rng(31)
			for (let i = 0; i < 70; i++) {
				const y = Hh * (0.52 + 0.3 * r())
				const x = W * r()
				g.strokeStyle = `rgba(90,80,70,${0.04 + 0.1 * r()})`
				g.lineWidth = 1 + r() * 2
				g.beginPath()
				g.moveTo(x, y)
				g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 14)
				g.stroke()
			}
			for (let i = 0; i < 400; i++) {
				g.fillStyle = `rgba(110,100,85,${0.02 + 0.04 * r()})`
				g.fillRect(r() * W, Hh * (0.5 + 0.4 * r()), 1 + r() * 3, 1 + r() * 2)
			}
		})
		const white = mat("eb-pin-gloss", { map: tex, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })
		const g = kit.group()
		g.add(kit.mesh(latheLin(prof.map(([r, y]) => [r, y]), 112, 0, H), white))
		// the head is a smooth dome to the tip (no disc), the foot a bare flat
		g.add(kit.mesh(disc(M(25.8), 0, 64).rotateX(Math.PI), mat("eb-pin-foot", { color: "#d8d0bf", roughness: 0.7 })))
		g.position.y = -H / 2
		return kit.group(g)
	})
	for (const part of ["belly", "shoulder", "waist", "neck", "head"]) addModel("bowling-pin", part, null)

	// ============================================================= traffic cone: orange cone with white reflective bands on a black rubber base
	addModel("traffic-cone", "base", ({ props, color }) => {
		const W = props.width ?? 0.305, H = props.height ?? 0.457, D = props.depth ?? 0.305
		const m = Math.min(W, D)
		const hb = 0.0656 * H
		const rb = 0.34 * m
		const rt = (0.025 * m) / 0.305 // (the physics: machines/catalog_everyday.py build_cone) the top, the collar and the rim keep their proportions as the cone is resized
		const kx = m / 0.305, ky = H / 0.457 // the cone's scale across and up, from the 305 x 457 mm cone the details are drawn for
		const g = kit.group()
		const rubber = mat("eb-cone-rubber", { color: "#1c1c1e", roughness: 0.88, metalness: 0, normalMap: normalTex("eb-cone-grain", 256, 256, (c, Wc, Hc) => pixels(c, Wc, Hc, (x, y) => { const v = 90 + 140 * vnoise(x / 1.7, y / 1.7, 3); return [v, v, v] }), { strength: 1.4 }), normalScale: new THREE.Vector2(0.5, 0.5) })
		const baseGeo = kit.box(W, hb, D, Math.min(0.0026, 0.3 * hb, 0.0085 * m), 4)
		const base = kit.mesh(baseGeo, rubber)
		base.position.y = -H / 2 + hb / 2
		g.add(base)
		// the base's top: a diamond tread moulded into the rubber, a plain rim round it
		{
			const tread = normalTex("eb-cone-tread", 128, 128, (c, Wc, Hc) => {
				c.fillStyle = "#808080"
				c.fillRect(0, 0, Wc, Hc)
				c.strokeStyle = "#e8e8e8"
				c.lineWidth = 9
				for (let k = -2; k <= 4; k++) { c.beginPath(); c.moveTo(k * 64, 0); c.lineTo(k * 64 + 128, 128); c.stroke(); c.beginPath(); c.moveTo(k * 64, 128); c.lineTo(k * 64 + 128, 0); c.stroke() }
			}, { strength: 2.6, blur: 0.8 })
			const side = m - 0.036 * kx
			const pitch = 0.0155 * Math.min(1, Math.max(0.35, kx)) // the diamonds' pitch: 15.5 mm, finer on a small cone
			const nRep = Math.max(1, Math.round(side / pitch))
			const m2 = mat(`eb-cone-treadmat|${nRep}`, { color: "#1a1a1c", roughness: 0.9, metalness: 0, normalMap: withRepeat(tread, nRep, nRep), normalScale: new THREE.Vector2(0.9, 0.9) })
			const top = kit.mesh(new THREE.PlaneGeometry(side, side).rotateX(-Math.PI / 2), m2)
			top.castShadow = false
			top.position.y = -H / 2 + hb + 0.00015
			g.add(top)
		}
		// the cone: a straight-sided hollow cone, glossy PVC, the foot flaring a hair into the base, a rolled top rim
		const tone = "#d84f08"
		const orange = mat(`eb-cone-pvc|${tone}`, { color: tone, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22, toneMapped: false })
		const y0 = -H / 2 + hb, y1 = H / 2
		const rAt = (y) => mix(rb, rt, (y - y0) / (y1 - y0))
		const kr = rt / 0.025 // the rolled rim and the inside drawn for the 50 mm top, scaled with it
		const kf = Math.min(kx, ky) // the foot's flare into the collar
		const pts = [[rb + 0.0016 * kf, y0], [rb + 0.0004 * kf, y0 + 0.0014 * kf], [rb, y0 + 0.003 * kf]]
		// the rolled top rim: a round of 2.8 mm (scaled with the top) tangent to the slope and to the top, so its outer face stays on the slope's line on a squat cone too
		{
			const rho = 0.0028 * kr
			const beta = Math.atan2(rb - rt, y1 - y0) // the slope's lean from upright
			const cx = rAt(y1 - rho) - rho / Math.cos(beta), cy = y1 - rho
			for (let k = 0; k <= 6; k++) { const a = beta + (k / 6) * (Math.PI / 2 - beta); pts.push([cx + rho * Math.cos(a), cy + rho * Math.sin(a)]) }
		}
		pts.push([rt * 0.72, y1], [rt * 0.72 - 0.0008 * kr, y1 - 0.0016 * kr], [rt * 0.7 - 0.001 * kr, y1 - 0.02 * kr])
		g.add(kit.mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 128), orange))
		// the moulded collar round the cone's foot (a physics piece of its own: 12.5 mm out, 6 mm tall on the 305 x 457 mm cone, scaled with it)
		{
			const rw = 0.0125 * kx, rh = 0.006 * ky
			const X = (v) => v * kx, Y = (v) => v * ky
			const ring = [[rb + rw, y0], [rb + rw, y0 + Y(0.0008)], [rb + rw - X(0.0001), y0 + Y(0.0026)], [rb + rw - X(0.0007), y0 + Y(0.0041)], [rb + rw - X(0.0022), y0 + Y(0.0054)], [rb + rw - X(0.0042), y0 + rh - Y(0.0001)], [rb + rw - X(0.0075), y0 + rh], [rb + X(0.0006), y0 + rh - Y(0.0003)], [rb - X(0.0006), y0 + rh - Y(0.0008)]]
			g.add(kit.mesh(new THREE.LatheGeometry(ring.map(([r, y]) => new THREE.Vector2(r, y)), 128), rubber))
		}
		// the dark inside seen down the open top
		g.add(kit.mesh(disc(rt * 0.68, y1 - 0.018 * kr, 32), mat("eb-cone-in", { color: "#3a1608", roughness: 0.9 })))
		// the reflective collars: white sleeves with a micro-prism texture, 0.6 mm proud of the cone
		// retroreflective sheeting: a fine honeycomb of micro-prisms (a strong small normal map) with a faint brightness change from cell to cell, bright white and glossy
		const cells = (c, Wc, Hc, fn) => {
			for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) fn(c, (i + (j % 2) * 0.5 + 0.5) * (Wc / 8), (j + 0.5) * (Hc / 8), i, j)
		}
		const prism = normalTex("eb-cone-prism2", 128, 128, (c, Wc, Hc) => {
			c.fillStyle = "#808080"
			c.fillRect(0, 0, Wc, Hc)
			cells(c, Wc, Hc, (cc, cx, cy) => {
				const gr = cc.createRadialGradient(cx, cy, 0, cx, cy, Wc / 12)
				gr.addColorStop(0, "#f2f2f2")
				gr.addColorStop(1, "#606060")
				cc.fillStyle = gr
				cc.beginPath(); cc.arc(cx, cy, Wc / 13, 0, TAU); cc.fill()
			})
		}, { strength: 3.2, blur: 0.3 })
		const sparkle = colorTex("eb-cone-sparkle", 128, 128, (c, Wc, Hc) => {
			c.fillStyle = "#e9ebe9"
			c.fillRect(0, 0, Wc, Hc)
			const r = rng(19)
			cells(c, Wc, Hc, (cc, cx, cy) => {
				const k = 232 + Math.round(23 * r())
				cc.fillStyle = `rgb(${k},${k},${Math.min(255, k + 2)})`
				cc.beginPath(); cc.arc(cx, cy, Wc / 14, 0, TAU); cc.fill()
			})
		}, { wrap: true })
		const bandMat = mat("eb-cone-band2", { color: "#ffffff", map: withRepeat(sparkle, 120, 24), metalness: 0.12, roughness: 0.22, clearcoat: 0.2, clearcoatRoughness: 0.25, normalMap: withRepeat(prism, 120, 24), normalScale: new THREE.Vector2(0.9, 0.9) })
		for (const [f0, f1] of [[0.62, 0.8], [0.5, 0.575]]) {
			const lo = -H / 2 + f0 * H, hi = -H / 2 + f1 * H
			const e = 0.0006 * Math.min(1, Math.max(0.4, kr)), eh = 0.0008 * Math.min(1, ky) // the sheeting stands 0.6 mm proud
			const bp = [[rAt(lo) + e * 0.4, lo], [rAt(lo) + e, lo + eh]]
			for (let k = 1; k < 4; k++) { const y = mix(lo, hi, k / 4); bp.push([rAt(y) + e, y]) }
			bp.push([rAt(hi) + e, hi - eh], [rAt(hi) + e * 0.4, hi])
			g.add(kit.mesh(new THREE.LatheGeometry(bp.map(([r, y]) => new THREE.Vector2(r, y)), 128), bandMat))
		}
		return kit.group(g)
	})
	addModel("traffic-cone", "cone", null)
	addModel("traffic-cone", "collar", null)

	// ============================================================= stapler: black base, red arm hinged at the rear, steel magazine channel under it, the paper throat between
	// Silhouette = the three physics polygons of machines/catalog_everyday.py (design mm, nose to the right, origin bottom-left; the physics origin is (77.5, 25)).
	addModel("stapler", "body", ({ props }) => {
		const W = props.width ?? 0.155, H = props.height ?? 0.05, D = props.depth ?? 0.045
		const sx = W / 0.155, sy = H / 0.05, sz = D / 0.045
		const ox = 77.5, oy = 25
		const g = kit.group()
		const red = "#a81c15"
		const redMat = mat(`eb-stapler-red|${red}`, { color: red, roughness: 0.26, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.1, toneMapped: false })
		const black = mat("eb-stapler-black2", { color: "#1d1e22", roughness: 0.42, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35 })
		const rubberMat = mat("eb-stapler-rubber", { color: "#0e0e10", roughness: 0.9, metalness: 0 })
		const steel = mat("eb-stapler-steel", { color: "#c4c9d0", roughness: 0.22, metalness: 1 })
		const padMat = mat("eb-stapler-pad2", { color: "#141416", roughness: 0.65, metalness: 0, normalMap: withRepeat(normalTex("eb-stapler-ridges2", 64, 64, (c, Wc, Hc) => { c.fillStyle = "#808080"; c.fillRect(0, 0, Wc, Hc); c.fillStyle = "#f4f4f4"; c.fillRect(6, 0, 20, Hc); c.fillRect(38, 0, 20, Hc) }, { strength: 3, blur: 0.8 }), 14, 1), normalScale: new THREE.Vector2(1, 1) })
		// the arm's outline (the union of its two physics pieces), its corners eased
		const ARM = [[3, 10], [30, 10], [75, 14.8], [153.2, 17.5], [153.8, 22], [153.8, 28.5], [150, 34], [100, 44], [75, 47.3], [45, 50], [14, 47], [3, 40], [1, 26]]
		const armOutline = roundedPolygon(ARM, 3, 6)
		const XA0 = 1.4, XA1 = 153.7
		const chordMemo = new Map()
		const chord = (x) => { const k = Math.round(x * 1000); let c = chordMemo.get(k); if (!c) { c = chordAt(armOutline, clamp(x, XA0, XA1)) ?? [14, 30]; chordMemo.set(k, c) } return c }
		const topMemo = new Map()
		const yTopRaw = (x) => chord(x)[1]
		const yTopCalc = (x) => { let t = 0; for (let k = -6; k <= 6; k++) t += yTopRaw(clamp(x + k, XA0, XA1)); return mix(yTopRaw(x), t / 13, sm(clamp((x - 12) / 10)) * (1 - sm(clamp((x - 144) / 8)))) } // the outline's top eased over about 12 mm along the dome (it is convex, so this stays inside it; the ends keep the exact outline): no kinks in the dome's highlight
		const yTop = (x) => { const k = Math.round(x * 1000); let v = topMemo.get(k); if (v === undefined) { v = yTopCalc(x); topMemo.set(k, v) } return v }
		const yBot = (x) => chord(x)[0]
		// plan half-width of the arm (mm): 17 at the rear tapering to 12.6 at the nose, both ends rounded in plan
		const taper = (x) => mix(17, 12.6, clamp((x - 14) / 128))
		const ends = (x, x0, x1, rr, rn) => { // 0..1 factor: a quarter-ellipse closing the rear (length rr) and the nose (length rn)
			const a = clamp((x - x0) / rr), b = clamp((x1 - x) / rn)
			return Math.sqrt(Math.max(0, 1 - (1 - a) * (1 - a))) * Math.sqrt(Math.max(0, 1 - (1 - b) * (1 - b)))
		}
		const hzArm = (x) => Math.max(0.0015, taper(x) * ends(x, XA0, XA1, 13, 11.5))
		const yCover = (x) => { const lo = yBot(x) + 4 * sm(clamp((x - 24) / 10)); return mix(lo, 23.5, sm(clamp((x - 122) / 30))) } // the red cover's lower edge: 4 mm over the channel, up to the exit plate at the nose
		const sectionRing = (y0, y1, hz, rb, rt, seg = 6) => {
			const pts = []
			const arc = (cy, cz, r, a0, a1) => { for (let k = 0; k <= seg; k++) { const a = mix(a0, a1, k / seg); pts.push([cy + r * Math.sin(a), cz + r * Math.cos(a)]) } }
			const lim = Math.max(1e-4, Math.min((y1 - y0) / 2, hz) - 1e-4)
			rb = Math.max(1e-4, Math.min(rb, lim)); rt = Math.max(1e-4, Math.min(rt, lim))
			arc(y1 - rt, hz - rt, rt, 0, Math.PI / 2)
			arc(y1 - rt, -(hz - rt), rt, Math.PI / 2, Math.PI)
			arc(y0 + rb, -(hz - rb), rb, Math.PI, Math.PI * 1.5)
			arc(y0 + rb, hz - rb, rb, Math.PI * 1.5, TAU)
			return pts
		}
		const stations = (x0, x1, n) => Array.from({ length: n + 1 }, (_, k) => mix(x0, x1, 0.5 - 0.5 * Math.cos((Math.PI * k) / n)))
		const rtFor = (hz, x = null) => (x === null ? 0.88 * hz : smin(0.88 * hz, 0.95 * (yTop(x) - 0.02 - yCover(x)) / 2, 8)) // the domed top: its radius is most of the half-width (a 12 mm dome at the crest), eased where the cover thins toward the nose
		// the red cover: domed, tapering in plan, closed at both ends by the plan rounding (no flat caps)
		{
			const rings = stations(XA0, XA1, 110).map((x) => { const hz = hzArm(x); return { x: x - ox, pts: sectionRing(yCover(x) - oy, yTop(x) - 0.02 - oy, hz, 2.0, rtFor(hz, x), 8) } })
			g.add(kit.mesh(loftX(rings, { caps: false }), redMat))
		}
		// the steel magazine channel under the cover, and at the nose the staple-exit plate
		{
			const XC0 = 28, XC1 = 153.2
			const rings = stations(XC0, XC1, 90).map((x) => { const hz = Math.max(0.0015, (taper(x) - 2.0) * ends(x, XC0 - 1, XC1, 3, 10)); return { x: x - ox, pts: sectionRing(yBot(x) - oy, yCover(x) + 0.5 - oy, hz, 0.9, 0.9, 4) } })
			g.add(kit.mesh(loftX(rings, { caps: false }), steel))
		}
		// the ridged grip pad pressed into the dome on the hump (a patch of the dome's own surface, 0.5 mm proud)
		{
			const NX = 34, NZ = 20, x0 = 56, x1 = 114, hp = 10.2
			const domeDrop = (x, z) => { const hz = hzArm(x), lim = Math.max(1e-4, Math.min((yTop(x) - 0.02 - yCover(x)) / 2, hz) - 1e-4), rt = Math.max(1e-4, Math.min(rtFor(hz, x), lim)), dz = Math.max(0, Math.abs(z) - (hz - rt)); return rt - Math.sqrt(Math.max(0, rt * rt - dz * dz)) }
			const pos = [], uv = [], idx = []
			for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
				const x = mix(x0, x1, i / NX), z = mix(-hp, hp, j / NZ)
				const edge = 1 - Math.pow(Math.abs(z) / hp, 6) * Math.pow(Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2)), 6)
				pos.push(x - ox, yTop(x) - 0.02 - domeDrop(x, z) + 0.55 * Math.sqrt(Math.max(0, edge)) - oy, z)
				uv.push((i / NX), j / NZ)
			}
			for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = i * (NZ + 1) + j, b = a + 1, c = a + NZ + 1, d = c + 1; idx.push(a, c, b, b, c, d) }
			const pg = new THREE.BufferGeometry()
			pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			pg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			pg.setIndex(idx)
			pg.computeVertexNormals()
			if (pg.attributes.normal.getY(Math.floor(pos.length / 6)) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t } pg.setIndex(idx); pg.computeVertexNormals() }
			g.add(kit.mesh(pg, padMat, { cast: false }))
		}
		// the base: a black plate, stadium-shaped in plan (rounded at both ends), on a thin rubber sole, with the steel anvil under the nose
		{
			const BX0 = 2.2, BX1 = 152.9, BW = 36
			g.add(kit.mesh(L.rrPlate((BX1 - BX0), BW, BW / 2, 1.1, 10, { bevel: 2.4, curve: 24, bevelSegments: 4 }), black).translateX((BX0 + BX1) / 2 - ox).translateY(-oy))
			g.add(kit.mesh(L.rrPlate((BX1 - BX0) - 3.2, BW - 3.2, BW / 2 - 1.6, 0, 1.3, { bevel: 0.5, curve: 20 }), rubberMat).translateX((BX0 + BX1) / 2 - ox).translateY(-oy))
			const anvilMat = mat("eb-stapler-anvil", { color: "#c4c9d0", roughness: 0.22, metalness: 1, normalMap: withRepeat(normalTex("eb-stapler-crimp", 192, 128, (c, Wc, Hc) => {
				c.fillStyle = "#808080"; c.fillRect(0, 0, Wc, Hc)
				c.fillStyle = "#101010" // two shallow crimp grooves the staple legs fold in (each a rounded slot along the anvil)
				for (const yy of [0.34, 0.66]) { c.beginPath(); c.roundRect(Wc * 0.18, Hc * (yy - 0.07), Wc * 0.64, Hc * 0.14, Hc * 0.07); c.fill() }
			}, { strength: 2.2, blur: 1.2, wrap: false }), 1 / 24, 1 / 15, 0.5, 0.5), normalScale: new THREE.Vector2(1, 1) })
			const anvil = kit.mesh(new THREE.ExtrudeGeometry(L.rrect(24, 15, 5), { depth: 0.9, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2), anvilMat)
			anvil.position.set(138 - ox, 10 - oy, 0)
			g.add(anvil)
			// the hinge pin at the rear, its heads showing either side of the arm
			const pin = kit.mesh(kit.cylinderZ(2.3, 2 * taper(14) * 0.97 + 1.0, 24), steel)
			pin.position.set(15 - ox, 21 - oy, 0)
			g.add(pin)
		}
		const out = kit.group(g)
		g.scale.setScalar(0.001)
		out.scale.set(sx, sy, sz)
		return out
	})
	addModel("stapler", "arm", null)
	addModel("stapler", "nose", null)

	// ============================================================= pencil: hexagonal yellow lacquer, sharpened wood cone with a graphite tip, ferrule and eraser
	addModel("pencil", "body", ({ props, color }) => {
		const Wd = props.width ?? 0.19, Ht = props.height ?? 0.007, Dp = props.depth ?? 0.0081
		const a = 3.5, c = a / Math.cos(Math.PI / 6) // apothem and circumradius, mm
		const X0 = -76.5, X1 = 91.5, XT = 95, tipW = 0.49, coneStart = 95 - 17.1
		const paintTone = "#dfac00"
		const flatAngles = [0, 1, 2, 3, 4, 5].map((k) => Math.PI / 6 + (k * Math.PI) / 3)
		const hexR = (th) => { // a rounded hexagon's radius toward the angle th (soft-min over the six flats)
			let s = 0
			for (const f of flatAngles) { const d = Math.cos(th - f); if (d > 0.05) s += Math.pow(a / d, -26) }
			return Math.pow(s, -1 / 26)
		}
		const slope = (a - tipW) / (XT - coneStart)
		const coneR = (x) => tipW + slope * (XT - x) // the sharpened cone: radius 3.5 at coneStart, 0.49 at the point
		const NT = 120
		const hexJ = Array.from({ length: NT + 1 }, (_, j) => hexR((j / NT) * TAU)) // the hexagon's radius at each vertex angle, once
		const stations = [X0, X0 + 1, coneStart - 8]
		for (let x = coneStart - 7.5; x < X1; x += 0.8) stations.push(x)
		stations.push(X1)
		const pos = [], uv = [], idx = []
		for (let i = 0; i < stations.length; i++) {
			const x = stations[i]
			const cr = x > coneStart - 4.5 ? coneR(x) : 1e9
			for (let j = 0; j <= NT; j++) {
				const th = (j / NT) * TAU
				const r = cr > 1e8 ? hexJ[j] : Math.pow(Math.pow(hexJ[j], -26) + Math.pow(cr, -26), -1 / 26)
				pos.push(M(x), M(r * Math.sin(th)), M(r * Math.cos(th)))
				uv.push((x - X0) / (X1 - X0), j / NT)
			}
		}
		for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < NT; j++) {
			const p = i * (NT + 1) + j, q = p + 1, r2 = p + NT + 1, s2 = r2 + 1
			idx.push(p, r2, q, q, r2, s2)
		}
		const geo = new THREE.BufferGeometry()
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		geo.setIndex(idx)
		geo.computeVertexNormals()
		// the colour and roughness maps are baked: lacquer on the faces (flat paint plus a faint blotch), raw wood where the cone cut through the paint. Only the columns
		// past the start of the cone are painted pixel by pixel; the hexagon's radius is worked out once per row and the cone's once per column.
		const TW = 2048, TH = 384
		const wood = new THREE.Color("#e6c48c").convertLinearToSRGB()
		const paint = new THREE.Color(paintTone).convertLinearToSRGB()
		const rowHex = (n) => Float32Array.from({ length: n }, (_, py) => hexR((1 - (py + 0.5) / n) * TAU))
		const colCone = (n) => Float32Array.from({ length: n }, (_, px) => coneR(X0 + ((px + 0.5) / n) * (X1 - X0)))
		const colTex = colorTex(`eb-pencil-col2|${paintTone}`, TW, TH, (g) => {
			g.fillStyle = `rgb(${Math.round(paint.r * 255)},${Math.round(paint.g * 255)},${Math.round(paint.b * 255)})`
			g.fillRect(0, 0, TW, TH)
			{ // a faint blotchy variation in the lacquer: a small noise picture stretched over the whole map
				const nc = document.createElement("canvas")
				nc.width = 128; nc.height = 24
				const ng = nc.getContext("2d")
				const r = rng(9)
				for (let j = 0; j < 24; j++) for (let i = 0; i < 128; i++) { ng.fillStyle = r() < 0.5 ? "#000" : "#fff"; ng.globalAlpha = 0.012 + 0.03 * r(); ng.fillRect(i, j, 1, 1) }
				g.imageSmoothingEnabled = true
				g.drawImage(nc, 0, 0, TW, TH)
			}
			const hexRow = rowHex(TH), coneCol = colCone(TW)
			const x0px = Math.max(0, Math.floor(((coneStart - 4.5 - X0) / (X1 - X0)) * TW) - 1), w = TW - x0px
			const img = g.getImageData(x0px, 0, w, TH)
			for (let py = 0; py < TH; py++) {
				const th = (1 - py / TH) * TAU, hr = hexRow[py]
				for (let k = 0; k < w; k++) {
					const px = x0px + k
					const dd = hr - coneCol[px]
					if (dd <= 0.012) continue
					// raw wood: growth lines along the cone, a darker thin rim where the lacquer ends
					const edge = clamp(1 - dd / 0.07)
					const grain = 0.9 + 0.12 * Math.sin(th * 9 + vnoise(px / 40, py / 4, 3) * 6) + 0.05 * (vnoise(px / 3.5, py / 2, 7) - 0.5)
					const kk = grain * (1 - 0.35 * edge)
					const o = (py * w + k) * 4
					img.data[o] = wood.r * 255 * kk; img.data[o + 1] = wood.g * 255 * kk; img.data[o + 2] = wood.b * 255 * kk; img.data[o + 3] = 255
				}
			}
			g.putImageData(img, x0px, 0)
			// the stamped name on the face that looks toward the camera (a flat centred on 30 degrees, v = 1/12)
			g.save()
			g.translate(TW * 0.1, TH * (1 - 0.0833))
			g.fillStyle = "#6a3a10"
			g.textBaseline = "middle"
			g.font = `700 ${TH * 0.072}px ${SANS}`
			spaced(g, "SANDBOX  ·  No. 2  ·  HB  ·  SOFT  ·  SANDBOX  ·  No. 2  ·  HB", 0, 0, TH * 0.012)
			g.restore()
			// a thin darker line down each edge of the faces
			g.fillStyle = "rgba(120,80,0,0.18)"
			for (let k = 0; k < 6; k++) g.fillRect(0, TH * (k / 6) - 1, TW * 0.9, 2)
		})
		const roughTex = dataTex("eb-pencil-rough2", 512, 96, (g, Wc, Hc) => {
			const hexRw = rowHex(Hc), coneC = colCone(Wc)
			pixels(g, Wc, Hc, (px, py) => { const v = coneC[px] < hexRw[py] - 0.012 ? 0.78 : 0.26; return [v * 255, v * 255, v * 255] })
		})
		const bodyMat = mat(`eb-pencil2|${paintTone}`, { map: colTex, roughnessMap: roughTex, roughness: 1, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.12, toneMapped: false })
		const g = kit.group()
		g.add(kit.mesh(geo, bodyMat))
		// the graphite point
		const tipPts = []
		for (let k = 0; k <= 6; k++) { const x = mix(X1, XT, k / 6); tipPts.push([M(coneR(x)), M(x)]) }
		const tipGeo = new THREE.LatheGeometry(tipPts.map(([r, y]) => new THREE.Vector2(r, y)), 24).rotateZ(-Math.PI / 2)
		g.add(kit.mesh(tipGeo, mat("eb-graphite", { color: "#3d3f44", roughness: 0.32, metalness: 0.75 })))
		// the aluminium ferrule: a smooth cylinder with two groups of three crisp crimped rings (0.25 mm deep, 0.35 mm wide), a plain band between, necked in a hair where it
		// grips the wood (and reaching 0.3 mm into it). Sampled finely only across the crimps.
		const fer = []
		{
			const rings = [-87.6, -87.0, -86.4, -84.1, -83.5, -82.9]
			const keys = new Set()
			for (const cx of rings) for (const d of [-0.25, -0.21, -0.175, -0.14, 0, 0.14, 0.175, 0.21, 0.25]) keys.add(+(cx + d).toFixed(3))
			for (let x = -89.5; x < -81.8; x += 0.6) keys.add(+x.toFixed(3))
			for (let x = -81.8; x < X0; x += 1.5) keys.add(+x.toFixed(3))
			keys.add(-89.5); keys.add(X0 + 0.3)
			const groove = (x) => rings.reduce((acc, cx) => acc + 0.25 * (1 - sm(clamp((Math.abs(x - cx) - 0.14) / 0.07))), 0)
			for (const x of [...keys].sort((p, q) => p - q)) {
				const neck = 0.1 * sm(clamp((x - (X0 - 1.4)) / 1.4))
				fer.push([M(3.55 - Math.min(0.25, groove(x)) - neck), M(x)])
			}
		}
		const ferGeo = new THREE.LatheGeometry(fer.map(([r, y]) => new THREE.Vector2(r, y)), 48).rotateZ(-Math.PI / 2)
		g.add(kit.mesh(ferGeo, mat("eb-ferrule2", { color: "#cfd3d8", roughness: 0.4, metalness: 1, clearcoat: 0 })))
		// ferrule end rings
		g.add(kit.mesh(new THREE.LatheGeometry([[0, -89.5], [3.55, -89.5]].map(([r, y]) => new THREE.Vector2(M(r), M(y))), 24).rotateZ(-Math.PI / 2), mat("eb-ferrule2", { color: "#cfd3d8", roughness: 0.4, metalness: 1 })))
		// the eraser: pink rubber with a rounded end
		const er = [[0, -95], [2.9, -95], [3.3, -94.7], [3.42, -94.2], [3.42, -89.4], [3.0, -89.4], [0, -89.4]]
		g.add(kit.mesh(new THREE.LatheGeometry(er.map(([r, y]) => new THREE.Vector2(M(r), M(y))), 40).rotateZ(-Math.PI / 2), mat("eb-eraser-pink", { color: "#e8a0a6", roughness: 0.72, metalness: 0, sheen: 0.4, sheenColor: "#ffd9dc" })))
		g.scale.set(Wd / 0.19, Ht / 0.007, Dp / 0.0081)
		return kit.group(g)
	})

	// ============================================================= rubber duck
	// One moulded vinyl body: an implicit surface (smooth union of shapes inflated from the physics outline's polygons) polygonised once, so the neck, the tail and the wings
	// blend into the body the way moulded vinyl does. Silhouette (design mm, facing right, origin of the design at the bottom-left): body, tail, head and bill polygons of
	// machines/catalog_everyday.py; plan view: a teardrop (half-width 25 mm at the chest, narrowing to the tail), a round head, a flat bill that flares toward its tip.
	const duckGeo = new Map()
	addModel("rubber-duck", "body", ({ props, color }) => {
		const W = props.width ?? 0.076, H = props.height ?? 0.065, D = props.depth ?? 0.058
		const sx = W / 0.076, sy = H / 0.065, sz = D / 0.058
		const HEAD = [49.5, 51.5, 13.5]
		// ellipsoid with half sizes (a, b, c) about (cx, cy, 0), rotated by ang (deg) in the x-y plane; a distance-like value (negative inside)
		const ell = (x, y, z, cx, cy, a, b, c, ang = 0) => {
			const r = (ang * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r)
			const dx = x - cx, dy = y - cy
			return (Math.hypot((dx * co + dy * si) / a, (-dx * si + dy * co) / b, z / c) - 1) * Math.min(a, b, c)
		}
		/** a capsule-like cone from p0 (radius r0) to p1 (radius r1), its section squashed across z by kz0 at p0 and kz1 at p1 (kz > 1: wider across z than it is thick) */
		const cone = (x, y, z, x0, y0, r0, x1, y1, r1, kz0, kz1 = kz0) => {
			const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy
			const t = clamp(((x - x0) * vx + (y - y0) * vy) / l2)
			return Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy), z / mix(kz0, kz1, t)) - mix(r0, r1, t)
		}
		const fBody = (x, y, z) => {
			let f = smin(ell(x, y, z, 29, 20.6, 27, 24.2, 25), ell(x, y, z, 43, 22.8, 16, 20.6, 22), 6)
			return Math.max(f, -y) // a broad flat belly (31 mm of the 59 mm body): the lower ellipsoid reaches 3.6 mm below the table plane that cuts it
		}
		const fHead = (x, y, z) => Math.hypot(x - HEAD[0], y - HEAD[1], z) - HEAD[2]
		const fTail = (x, y, z) => cone(x, y, z, 11.5, 29.5, 5.5, 3.4, 42.0, 2.8, 1.45, 2.1) // an upswept flick: thin in the side view, wide and blunt across
		const fBill = (x, y, z) => { const zr = 6.5 + 4 * clamp((x - 61) / 15); return (Math.hypot((x - 67.5) / 8.6, (y - 47) / 3.7, z / zr) - 1) * 3.7 }
		// the wings: low-relief teardrops on the flanks, pointing back and up
		const wing = (x, y, z) => ell(x, y, Math.abs(z) - 20.9, 27, 22, 12.5, 6.8, 4.6, 165)
		const field = (x, y, z) => {
			let f = smin(fBody(x, y, z), fHead(x, y, z), 9)
			f = smin(f, fTail(x, y, z), 9)
			f = smin(f, fBill(x, y, z), 2.2)
			return smin(f, wing(x, y, z), 3.5)
		}
		// the polygonised vinyl (a few tens of ms): the same whatever the duck's size (the model is scaled afterwards), so it is made once per colour
		let geo = duckGeo.get(color || "")
		if (!geo) {
			geo = meshSDF(field, [-3, -2, -28, 79, 68, 28], 1.17) // 1.17 mm cells: the vertices sit on the surface and the normals come from the field, so it reads smooth, and it stays under 30k triangles
			// paint: yellow vinyl, an orange bill (the colour changes where the bill's own surface takes over)
			const yel = new THREE.Color(color || "#dfae00"), org = new THREE.Color("#e8620a")
			const p = geo.attributes.position
			const col = new Float32Array(p.count * 3)
			const c = new THREE.Color()
			for (let i = 0; i < p.count; i++) {
				const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
				const others = Math.min(fBody(x, y, z), fHead(x, y, z), fTail(x, y, z))
				const k = clamp(0.5 + (others - fBill(x, y, z)) / 1.6)
				c.copy(yel).lerp(org, sm(clamp((k - 0.35) / 0.3)))
				col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
			}
			geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
			duckGeo.set(color || "", geo)
		}
		const vinyl = satify(mat("eb-duck-vinyl2", { color: "#ffffff", vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18, sheen: 0.15, sheenColor: "#fff2a0", toneMapped: false }), 1.0)
		const g = kit.group()
		g.add(kit.mesh(geo, vinyl))
		// eyes (glossy black beads set into the head), two nostrils and the mouth line along the bill's seam
		const black = mat("eb-duck-eye", { color: "#0d0d10", roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 })
		const glint = mat("eb-duck-glint", { color: "#ffffff", roughness: 0.1, emissive: "#ffffff", emissiveIntensity: 0.5 })
		const dark = mat("eb-duck-seam", { color: "#8a3306", roughness: 0.5, metalness: 0 })
		const bisect = (fn, lo, hi) => { for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fn(m) < 0) lo = m; else hi = m } return (lo + hi) / 2 }
		for (const z of [-1, 1]) {
			const ex = 56.4, ey = 54.8
			const zs = bisect((zz) => field(ex, ey, zz) , 0, 20) // the head's surface at the eye
			const eye = kit.mesh(kit.sphere(1.95, 28, 18), black)
			eye.position.set(ex, ey, z * (zs - 0.7))
			g.add(eye)
			const gl = kit.mesh(kit.sphere(0.5, 10, 8), glint)
			gl.position.set(ex + 0.7, ey + 0.8, z * (zs + 0.55))
			g.add(gl)
			const nx2 = 70.5
			const yTop = (() => { let lo = 45, hi = 52; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (field(nx2, m, z * 2.6) < 0) lo = m; else hi = m } return (lo + hi) / 2 })()
			const nos = kit.mesh(kit.sphere(0.6, 12, 8), dark)
			nos.position.set(nx2, yTop - 0.2, z * 2.6)
			g.add(nos)
		}
		{
			// the mouth: a thin dark line round the bill at its mid-height, as the seam between the two halves of the mould
			const half = []
			for (let x = 62.6; x <= 75.7; x += 0.5) {
				const top = 51.5 - (2 * (x - 61)) / 15, bot = 43 + (1.5 * (x - 61)) / 15
				const ym = (top + bot) / 2 - 0.1
				let lo = 0, hi = 20
				for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (field(x, ym, m) < 0) lo = m; else hi = m }
				half.push([x, ym, (lo + hi) / 2])
			}
			const loop = [...half.map(([x, y, z]) => new THREE.Vector3(x, y, z)), ...half.slice().reverse().map(([x, y, z]) => new THREE.Vector3(x, y, -z))]
			g.add(kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loop, true), 120, 0.3, 6, true), dark, { cast: false }))
		}
		const mm = kit.group(g)
		g.position.set(-38, -32.5, 0)
		const scaled = kit.group(mm)
		mm.scale.setScalar(0.001)
		scaled.scale.set(sx, sy, sz)
		return scaled
	})
	for (const part of ["body-up", "tail", "head", "bill"]) addModel("rubber-duck", part, null)
}
