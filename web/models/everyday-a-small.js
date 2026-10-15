// Small solids: ruler, chopstick, eraser, coins, die, brick, puzzle cube, pillow. (helpers: everyday-a-lib.js)
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, rich, normalTex, dataTex, mat, colorTex, withRepeat, loftX, rrectPts, rr, fibres, pixels, spaced, plate, rrect, circleHole, mergeGeos, rbShare } = L
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const SERIF = "Georgia, 'Times New Roman', serif"
	const deepen = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getStyle()
	const sm = (t) => t * t * (3 - 2 * t)

	// ------------------------------------------------------------- ruler: tinted plastic with a printed cm / inch scale and a hanging hole
	addModel("ruler", "body", ({ w, h, d, color }) => {
		const tone = blend(color || "#7fd0e8", "#ffffff", 0.28) // a clear tinted plastic: the tint lives in the material colour (it multiplies what is seen through), the printed map is near white
		const deep = rich(color || "#7fd0e8", 1.3, 0.7) // how deep it goes where the plastic is thick (the edges)
		const bev = Math.min(0.00045, h / 4)
		const PXMM = 10
		const CW = Math.round(w * 1000 * PXMM)
		const CH = Math.round(d * 1000 * PXMM)
		const x0mm = 2.5 // where the zero mark sits, from the left end (so 30 cm lands 2.5 mm from the other end)
		const topTex = colorTex(`ruler2|${tone}|${CW}x${CH}`, CW, CH, (g, W, H) => {
			const r = rng(61)
			const gr = g.createLinearGradient(0, 0, 0, H)
			gr.addColorStop(0, "#ffffff")
			gr.addColorStop(0.5, "#fbfeff")
			gr.addColorStop(1, "#e4f3f8")
			g.fillStyle = gr
			g.fillRect(0, 0, W, H)
			fibres(g, W, H, 5, { n: 1600, alpha: 0.04, len: 5 })
			// a darker bevel along the measuring edge
			const bg = g.createLinearGradient(0, H * 0.9, 0, H)
			bg.addColorStop(0, "rgba(0,40,60,0)")
			bg.addColorStop(1, "rgba(0,40,60,0.16)")
			g.fillStyle = bg
			g.fillRect(0, H * 0.9, W, H * 0.1)
			g.fillStyle = "#101418"
			g.strokeStyle = "#101418"
			g.textAlign = "center"
			// centimetres along the front (bottom) edge
			for (let mm = 0; mm <= 300; mm++) {
				const x = (x0mm + mm) * PXMM
				const len = mm % 10 === 0 ? 8.5 : mm % 5 === 0 ? 5.6 : 3.4
				g.fillRect(x - (mm % 10 === 0 ? 1.4 : 1), H - len * PXMM - 0.4 * PXMM * 0, mm % 10 === 0 ? 2.8 : 2, len * PXMM)
			}
			g.textBaseline = "alphabetic"
			g.font = `600 ${3.6 * PXMM}px ${SANS}`
			for (let cm = 1; cm <= 30; cm++) {
				g.textAlign = cm === 30 ? "right" : "center" // the last label stays on the ruler
				g.fillText(String(cm), (x0mm + cm * 10 + (cm === 30 ? 1.8 : 0)) * PXMM, H - 11 * PXMM)
			}
			g.textAlign = "left"
			g.font = `700 ${3.2 * PXMM}px ${SANS}`
			g.fillText("cm", (x0mm - 3.2) * PXMM, H - 11 * PXMM)
			// inches along the back (top) edge
			g.textAlign = "center"
			for (let i = 0; i <= 12 * 16; i++) {
				const x = (x0mm + i * 1.5875) * PXMM
				if (x > W - 4 * PXMM) break
				const len = i % 16 === 0 ? 8 : i % 8 === 0 ? 6.4 : i % 4 === 0 ? 4.8 : i % 2 === 0 ? 3.6 : 2.4
				g.fillRect(x - 1, 0, i % 16 === 0 ? 2.8 : 2, len * PXMM)
			}
			g.textBaseline = "top"
			g.font = `600 ${3.2 * PXMM}px ${SANS}`
			for (let n = 1; n <= 12; n++) g.fillText(String(n), (x0mm + n * 25.4) * PXMM, 9.5 * PXMM)
			g.textAlign = "left"
			g.font = `700 ${2.8 * PXMM}px ${SANS}`
			g.fillText("in", (x0mm - 3.2) * PXMM, 9.5 * PXMM)
			g.textAlign = "center"
			g.textBaseline = "middle"
			g.font = `italic 600 ${2.1 * PXMM}px ${SANS}`
			g.fillStyle = "rgba(16,20,24,0.6)"
			g.fillText("SANDBOX  30 cm", 150 * PXMM, 14.05 * PXMM) // the empty band between the two scales
		})
		const tag = `${w.toFixed(4)}|${d.toFixed(4)}`
		const topMat = mat(`ruler-top2|${tone}|${tag}`, { map: withRepeat(topTex, 1 / w, 1 / d, 0.5, 0.5), color: tone, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08, transmission: 1, thickness: 0.003, ior: 1.5, attenuationColor: new THREE.Color(deep), attenuationDistance: 0.03 })
		const edgeMat = mat(`ruler-edge2|${tone}`, { color: tone, roughness: 0.08, metalness: 0, clearcoat: 0.6, transmission: 1, thickness: 0.003, ior: 1.5, attenuationColor: new THREE.Color(deep), attenuationDistance: 0.012 })
		const geo = plate(rrect(w - 2 * bev, d - 2 * bev, 0.0012), -h / 2, h / 2, { bevel: bev, holes: [circleHole(0.0022 + bev, w / 2 - 0.0055, 0.008)] }) // the hanging hole sits in the empty end of the inch band
		return kit.group(kit.mesh(geo, [topMat, edgeMat]))
	})

	// ------------------------------------------------------------- chopstick: lacquered, tapering to a round tip
	// the y range of a convex outline (points {x, y}) along the vertical line at x
	const polyRange = (pts, x) => {
		let lo = Infinity, hi = -Infinity
		for (let i = 0; i < pts.length; i++) {
			const a = pts[i], b = pts[(i + 1) % pts.length]
			if (a.x === b.x) { if (a.x === x) { lo = Math.min(lo, a.y, b.y); hi = Math.max(hi, a.y, b.y) } continue }
			if ((a.x - x) * (b.x - x) <= 0) { const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y); lo = Math.min(lo, y); hi = Math.max(hi, y) }
		}
		return [lo, hi]
	}
	addModel("chopstick", "body", ({ body, d }) => {
		// the outline (the physics polygon): flat underneath, the top level to the kink then sloping down to the tip; the stick's section is a rounded square
		// as high as the outline there (so it fills the outline's side view) and as wide as it is high (or as deep as it may be)
		const pts = body.points
		const x0 = Math.min(...pts.map((p) => p.x))
		const x1 = Math.max(...pts.map((p) => p.x))
		const w = x1 - x0
		const yb = Math.min(...pts.map((p) => p.y))
		const kink = pts.filter((p) => p.x > x0 + 0.01 * w && p.x < x1 - 0.01 * w).map((p) => (p.x - x0) / w) // where the top changes slope
		const N = 44
		const sm = (t) => t * t * (3 - 2 * t)
		const ts = Array.from({ length: N + 1 }, (_, i) => i / N)
		for (const k of kink) ts.push(k)
		ts.sort((p, q) => p - q)
		const rings = []
		for (const t of ts) {
			const x = x0 + t * w
			const hy = (polyRange(pts, x)[1] - yb) / 2
			const hz = Math.min(hy, d / 2) // as wide as it is high, unless the depth is less
			const rr0 = mix(0.0007, Math.min(hy, hz) * 0.97, sm(clamp((t - 0.2) / 0.5)))
			rings.push({ x, pts: rrectPts(hy, hz, rr0, 4, yb + hy, 0) })
		}
		const geo = loftX(rings)
		const CW = 2048
		const CH = 64
		const paint = (layer) => (g, W, H) => {
			const col = (c, m, rg, cc) => (layer === "color" ? c : layer === "metal" ? m : layer === "clear" ? cc : rg)
			const bandA = 0.4
			const bandB = 0.435
			g.fillStyle = col("#17100c", "#000", "#1a1a1a", "#fff") // black lacquer: glossy
			g.fillRect(0, 0, W * bandA, H)
			g.fillStyle = col("#c8952f", "#fff", "#4a4a4a", "#fff") // gold band
			g.fillRect(W * bandA, 0, W * (bandB - bandA), H)
			g.fillRect(W * 0.06, 0, W * 0.006, H)
			g.fillRect(W * 0.08, 0, W * 0.003, H)
			g.fillStyle = col("#d9b27a", "#000", "#a0a0a0", "#161616") // bare wood: rough, hardly any clearcoat
			g.fillRect(W * bandB, 0, W * (1 - bandB), H)
			if (layer === "color") {
				const r = rng(88)
				for (let i = 0; i < 240; i++) {
					g.strokeStyle = r() < 0.5 ? `rgba(120,70,25,${0.15 + 0.3 * r()})` : `rgba(255,236,190,${0.15 + 0.3 * r()})`
					g.lineWidth = 0.8
					const y = r() * H
					g.beginPath(); g.moveTo(W * bandB, y); for (let x = W * bandB; x <= W; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 1.2); g.stroke()
				}
				g.fillStyle = "rgba(255,255,255,0.04)"
				for (let i = 0; i < 120; i++) g.fillRect(r() * W * bandA, r() * H, 20 + r() * 60, 1)
			}
		}
		const m = mat("chopstick2", {
			map: colorTex("chopstick|c2", CW, CH, paint("color")), metalnessMap: dataTex("chopstick|m2", CW, CH, paint("metal")), roughnessMap: dataTex("chopstick|r2", CW, CH, paint("rough")),
			clearcoatMap: dataTex("chopstick|cc2", CW, CH, paint("clear")), color: "#ffffff", metalness: 1, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.06,
		})
		// the two flat ends sample their own part of the print (the lacquered grip end, the bare wood tip), not the whole strip squeezed onto them
		{
			const uvs = geo.attributes.uv
			const posn = geo.attributes.position
			const sideVerts = rings.length * (rings[0].pts.length + 1)
			for (let i = sideVerts; i < uvs.count; i++) uvs.setX(i, posn.getX(i) < x0 + w / 2 ? 0.02 : 0.99)
			uvs.needsUpdate = true
		}
		return kit.group(kit.mesh(geo, [m, m]))
	})

	// ------------------------------------------------------------- eraser: pink rubber in a printed paper sleeve
	addModel("eraser", "body", ({ w, h, d, color }) => {
		const pink = rich(color || "#f0b8c0", 1.5, 0.88)
		const rubber = mat(`eraser-rubber|${pink}`, {
			color: pink, roughness: 0.86, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: "#ffd9e0",
			normalMap: normalTex("rubber-speckle", 256, 256, (g, W, H) => pixels(g, W, H, (x, y) => { const v = 120 + 70 * fbm(x / 3, y / 3, 3, 8, 85); return [v, v, v] }), { strength: 1.1 }), normalScale: new THREE.Vector2(0.6, 0.6),
		})
		const group = kit.group()
		const body = kit.mesh(kit.box(w, h - 0.0005, d - 0.0005, 0.0013, 3), rubber)
		group.add(body)
		// the sleeve: a closed rounded ring around the middle of the block, printed
		const sw = w * 0.72
		const seg = 3
		const pts = rrectPts(h / 2, d / 2, 0.0014, seg)
		const arc = [0]
		for (let i = 1; i <= pts.length; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i % pts.length][0] - pts[i - 1][0], pts[i % pts.length][1] - pts[i - 1][1])
		const P = arc[pts.length]
		const q = seg + 1
		const vr = { front: [arc[4 * q - 1] / P, 1], top: [arc[q - 1] / P, arc[q] / P], back: [arc[2 * q - 1] / P, arc[2 * q] / P], bottom: [arc[3 * q - 1] / P, arc[3 * q] / P] }
		const PX = 22
		const CW = Math.round(sw * 1000 * PX)
		const CHt = Math.round(P * 1000 * PX)
		const sleeveTex = colorTex(`eraser-sleeve|${CW}x${CHt}`, CW, CHt, (g, W, H) => {
			g.fillStyle = "#f6f4ee"
			g.fillRect(0, 0, W, H)
			const band = (v0, v1, fn, flip = false) => {
				const y0 = (1 - v1) * H
				const y1 = (1 - v0) * H
				g.save()
				g.beginPath(); g.rect(0, y0, W, y1 - y0); g.clip()
				g.translate(W / 2, (y0 + y1) / 2)
				if (flip) g.rotate(Math.PI)
				g.translate(-W / 2, -(y1 - y0) / 2)
				fn(W, y1 - y0)
				g.restore()
			}
			const face = (W2, H2) => {
				g.fillStyle = "#1c4fb0"
				g.fillRect(0, H2 * 0.1, W2, H2 * 0.4)
				g.fillStyle = "#e23b3b"
				g.fillRect(0, H2 * 0.5, W2, H2 * 0.05)
				g.fillStyle = "#ffffff"
				g.font = `800 ${H2 * 0.3}px ${SANS}`
				g.textAlign = "center"
				g.textBaseline = "middle"
				spaced(g, "ERASER", W2 / 2, H2 * 0.31, H2 * 0.02)
				g.fillStyle = "#1c4fb0"
				g.font = `700 ${H2 * 0.15}px ${SANS}`
				g.fillText("SOFT \u00B7 NON-DUST \u00B7 VINYL", W2 / 2, H2 * 0.78)
			}
			band(vr.front[0], vr.front[1], face)
			band(vr.back[0], vr.back[1], face, true)
			band(vr.top[0], vr.top[1], (W2, H2) => {
				g.fillStyle = "#1c4fb0"
				g.fillRect(0, 0, W2, H2 * 0.16)
				g.fillRect(0, H2 * 0.84, W2, H2 * 0.16)
				g.fillStyle = "#e23b3b"
				g.fillRect(0, H2 * 0.2, W2, H2 * 0.04)
				g.fillStyle = "#1c4fb0"
				g.font = `800 ${H2 * 0.3}px ${SANS}`
				g.textAlign = "center"
				g.textBaseline = "middle"
				g.fillText("SANDBOX", W2 / 2, H2 * 0.55)
			})
			fibres(g, W, H, 17, { n: 2500, alpha: 0.04, len: 5 })
		})
		const sleeveMat = mat(`eraser-sleeve|${CW}x${CHt}`, { map: sleeveTex, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 })
		const rings = [{ x: -sw / 2, pts }, { x: sw / 2, pts }]
		const sleeve = loftX(rings, { caps: false })
		group.add(kit.mesh(sleeve, sleeveMat))
		return group
	})

	// ------------------------------------------------------------- coins: a generic silver quarter, reeded edge, raised 25
	const coinBuilder = (R, T) => {
		const key = `${R.toFixed(5)}|${T.toFixed(5)}`
		const relief = 0.00022 // how far the field sits below the rim
		const rimW = 0.0013
		const Rin = R - rimW
		const SZ = 768
		const arcText = (g, str, cx, cy, rad, ang, size, space, inward) => {
			g.save()
			g.translate(cx, cy)
			g.font = `800 ${size}px ${SERIF}`
			g.textAlign = "center"
			g.textBaseline = "middle"
			const widths = [...str].map((c) => g.measureText(c).width + space)
			const total = widths.reduce((a, b) => a + b, 0)
			let a = ang - (total / rad) / 2 * (inward ? -1 : 1)
			;[...str].forEach((c, i) => {
				const step = (widths[i] / rad) * (inward ? -1 : 1)
				const am = a + step / 2
				g.save()
				g.rotate(am)
				g.translate(0, inward ? rad : -rad)
				g.fillText(c, 0, 0)
				g.restore()
				a += step
			})
			g.restore()
		}
		const star = (g, x, y, rad) => {
			g.beginPath()
			for (let i = 0; i < 10; i++) {
				const rr0 = i % 2 ? rad * 0.42 : rad
				const a = -Math.PI / 2 + (i * Math.PI) / 5
				g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * rr0, y + Math.sin(a) * rr0)
			}
			g.closePath()
			g.fill()
		}
		/** The design of a face, as ink: draws the raised parts with `fill` (g.fillStyle already set by the caller) */
		const design = (g, W, side) => {
			const c = W / 2
			const rad = W / 2
			g.textAlign = "center"
			g.textBaseline = "middle"
			if (side === 0) {
				arcText(g, "SANDBOX MINT", c, c, rad * 0.8, 0, rad * 0.14, rad * 0.016, false)
				arcText(g, "QUARTER", c, c, rad * 0.8, 0, rad * 0.12, rad * 0.02, true)
				g.font = `900 ${rad * 0.62}px ${SERIF}`
				g.fillText("25", c, c - rad * 0.02)
				g.font = `700 ${rad * 0.1}px ${SERIF}`
				g.fillText("2026", c, c + rad * 0.4)
				for (const a of [-1.25, 1.25]) star(g, c + Math.sin(a) * rad * 0.8, c - Math.cos(a) * rad * 0.8, rad * 0.045)
				// laurel sprigs: a curved stem, almond leaves with a midrib in pairs about 25 degrees off the stem
				const sprig = () => {
					const rho = rad * 0.62
					const p0 = Math.PI / 2 + 0.2, p1 = Math.PI + 0.95
					g.lineCap = "round"
					g.lineWidth = rad * 0.014
					g.beginPath(); g.arc(c, c, rho, p0 - 0.08, p1 + 0.05); g.stroke()
					const leaf = (x, y, ang, len) => {
						g.save()
						g.translate(x, y)
						g.rotate(ang)
						g.beginPath()
						g.moveTo(0, 0)
						g.quadraticCurveTo(len * 0.5, -len * 0.3, len, 0)
						g.quadraticCurveTo(len * 0.5, len * 0.3, 0, 0)
						g.fill()
						g.save()
						g.strokeStyle = "rgba(0,0,0,0.4)" // the midrib, engraved
						g.lineWidth = Math.max(1, rad * 0.006)
						g.beginPath(); g.moveTo(len * 0.08, 0); g.lineTo(len * 0.86, 0); g.stroke()
						g.restore()
						g.restore()
					}
					for (let i = 0; i < 8; i++) {
						const t = i / 7
						const phi = p0 + (p1 - p0) * t
						const x = c + Math.cos(phi) * rho, y = c + Math.sin(phi) * rho
						const tang = phi + Math.PI / 2 // along the stem, toward its tip
						const len = rad * (0.15 - 0.06 * t)
						leaf(x, y, tang + 0.44, len)
						leaf(x, y, tang - 0.44, len)
					}
				}
				for (const flip of [false, true]) {
					g.save()
					if (flip) { g.translate(2 * c, 0); g.scale(-1, 1) }
					sprig()
					g.restore()
				}
			} else {
				g.font = `900 ${rad * 0.13}px ${SERIF}`
				arcText(g, "SANDBOX MINT", c, c, rad * 0.8, 0, rad * 0.14, rad * 0.016, false)
				arcText(g, "E PLURIBUS", c, c, rad * 0.8, 0, rad * 0.12, rad * 0.02, true)
				star(g, c, c - rad * 0.04, rad * 0.4)
				g.beginPath(); g.arc(c, c - rad * 0.04, rad * 0.5, 0, TAU); g.lineWidth = rad * 0.04; g.stroke()
				g.font = `700 ${rad * 0.1}px ${SERIF}`
				g.fillText("25 CENTS", c, c + rad * 0.64)
			}
		}
		const heightTex = (side) =>
			normalTex(`coin-h|${side}`, SZ, SZ, (g, W, H) => {
				g.fillStyle = "#6a6a6a"
				g.fillRect(0, 0, W, H)
				g.fillStyle = "#f0f0f0"
				g.strokeStyle = "#f0f0f0"
				g.lineWidth = W * 0.012
				design(g, W, side)
				g.strokeStyle = "#f0f0f0"
				g.lineWidth = W * 0.014
				g.beginPath(); g.arc(W / 2, H / 2, (Rin / R) * (W / 2) * 0.985, 0, TAU); g.stroke()
			}, { strength: 2.4, wrap: false, blur: 1.2 })
		const colorMap = (side) =>
			colorTex(`coin-c|${side}`, SZ, SZ, (g, W, H) => {
				const r = rng(300 + side)
				const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2)
				gr.addColorStop(0, "#d0d4d7")
				gr.addColorStop(1, "#b9bdc1")
				g.fillStyle = gr
				g.fillRect(0, 0, W, H)
				for (let i = 0; i < 4000; i++) { g.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1) }
				g.fillStyle = "#e4e7e9"
				g.strokeStyle = "#e4e7e9"
				g.lineWidth = W * 0.012
				design(g, W, side)
			})
		const roughMap = (side) =>
			dataTex(`coin-r|${side}`, SZ, SZ, (g, W, H) => {
				g.fillStyle = "#6e6e6e"
				g.fillRect(0, 0, W, H)
				g.fillStyle = "#303030"
				g.strokeStyle = "#363636"
				g.lineWidth = W * 0.012
				design(g, W, side)
			})
		const faceMat = (side) => mat(`coin-face|${side}`, { map: colorMap(side), normalMap: heightTex(side), normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: roughMap(side), metalness: 1, roughness: 1, color: "#ffffff" })
		const stripe = colorTex("coin-edge", 16, 64, (g, W, H) => {
			g.fillStyle = "#c9cdd0"; g.fillRect(0, 0, W, H)
			g.fillStyle = "#b9743c"; g.fillRect(0, H * 0.3, W, H * 0.4)
		})
		const edgeMat = mat("coin-edge", { map: stripe, metalness: 1, roughness: 0.34, color: "#ffffff" })
		const plain = mat("coin-plain", { color: "#c4c8cb", metalness: 1, roughness: 0.3 })

		const ringGeo = (r0, r1, y, uvR, segs = 96) => {
			const pos = [], uv = [], idx = []
			const rows = r0 === 0 ? 1 : 1
			for (let j = 0; j <= segs; j++) {
				const a = (j / segs) * TAU
				for (const rad of [r0, r1]) {
					const x = Math.cos(a) * rad, z = Math.sin(a) * rad
					pos.push(x, y, z)
					uv.push(x / uvR / 2 + 0.5, -z / uvR / 2 + 0.5)
				}
			}
			for (let j = 0; j < segs; j++) {
				const a = j * 2
				idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
			}
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			g.setIndex(idx)
			g.computeVertexNormals()
			// face up
			if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t } g.computeVertexNormals() }
			return g
		}
		const wall = (r, y0, y1, segs = 96) => new THREE.CylinderGeometry(r, r, y1 - y0, segs, 1, true).translate(0, (y0 + y1) / 2, 0)
		const top = kit.group()
		const yR = T / 2
		const yF = T / 2 - relief
		top.add(kit.mesh(ringGeo(0, Rin, yF, R), faceMat(0)))
		top.add(kit.mesh(ringGeo(Rin, R - 0.00018, yR, R), faceMat(0)))
		top.add(kit.mesh(wall(Rin, yF, yR), plain))
		top.add(kit.mesh(new THREE.CylinderGeometry(R - 0.00018, R, 0.00018, 96, 1, true).translate(0, yR - 0.00009, 0), plain))
		const group = kit.group(top)
		const bottom = top.clone()
		bottom.rotation.x = Math.PI
		bottom.traverse((o) => { if (o.isMesh && o.material === faceMat(0)) o.material = faceMat(1) })
		group.add(bottom)
		// the reeded edge: 119 reeds, silver clad over a copper core
		const REEDS = 119
		const SEG = REEDS * 4
		const pos = [], uv = [], idx = []
		const rows = 5
		const y0 = -yR + 0.00018, y1 = yR - 0.00018
		for (let k = 0; k < rows; k++) {
			const v = k / (rows - 1)
			for (let j = 0; j <= SEG; j++) {
				const a = (j / SEG) * TAU
				const reed = 0.00011 * (0.5 - 0.5 * Math.cos(a * REEDS))
				const rad = R - reed
				pos.push(Math.cos(a) * rad, mix(y0, y1, v), Math.sin(a) * rad)
				uv.push(j / SEG, v)
			}
		}
		for (let k = 0; k < rows - 1; k++) for (let j = 0; j < SEG; j++) {
			const a = k * (SEG + 1) + j
			const b = a + 1
			const c = a + SEG + 1
			idx.push(a, c, b, b, c, a + SEG + 2)
		}
		const eg = new THREE.BufferGeometry()
		eg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		eg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
		eg.setIndex(idx)
		eg.computeVertexNormals()
		group.add(kit.mesh(eg, edgeMat))
		// the core between the faces (so no light leaks through)
		group.add(kit.mesh(new THREE.CylinderGeometry(R - 0.0004, R - 0.0004, 2 * (yF - 0.0001), 48), plain))
		return group
	}
	addModel("coin-flat", "body", ({ w, h }) => coinBuilder(w / 2, h))
	addModel("coin-edge", "body", ({ r, solid, props }) => {
		const T = solid.depth3d ?? solid.length ?? props.length ?? 0.00175
		const inner = coinBuilder(r, T)
		inner.rotation.x = Math.PI / 2 // the faces look toward the camera (+z), the top of the picture up
		return kit.group(inner)
	})

	// ------------------------------------------------------------- die: ivory plastic, rounded, recessed black pips
	addModel("die", "body", ({ w, h, d }) => {
		const size = Math.min(w, h, d)
		const rad = size * 0.14
		const a = rbShare(size, rad)
		const SZ = 512
		const flat = size - 2 * rad
		const pipR = 0.0013
		const sp = 0.0037
		const layouts = {
			1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
			5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
		}
		// the uv of a face maps its flat part linearly to [a, 1 - a]
		const toPx = (mmv) => (0.5 + (mmv / flat) * (1 - 2 * a)) * SZ
		const pxPer = (SZ * (1 - 2 * a)) / flat
		const faceTex = (n) => {
			const pips = layouts[n]
			const draw = (g, W, H, mode) => {
				if (mode === "c") { g.fillStyle = "#f4f0e4"; g.fillRect(0, 0, W, H) } else { g.fillStyle = "#b0b0b0"; g.fillRect(0, 0, W, H) }
				for (const [px, py] of pips) {
					const cx = toPx(px * sp)
					const cy = toPx(py * sp)
					const pr = pipR * pxPer
					if (mode === "c") { // a hard-edged black pip with a touch of depth toward its middle
						const gr = g.createRadialGradient(cx - pr * 0.25, cy - pr * 0.25, 0, cx, cy, pr)
						gr.addColorStop(0, "#0c0c10")
						gr.addColorStop(1, "#010102")
						g.fillStyle = gr
						g.beginPath(); g.arc(cx, cy, pr, 0, TAU); g.fill()
					} else { // height: the drilled hole sits low, with a thin bright lip (0.15 mm) on its rim
						g.fillStyle = "#202020"
						g.beginPath(); g.arc(cx, cy, pr, 0, TAU); g.fill()
						g.strokeStyle = "#e4e4e4"
						g.lineWidth = Math.max(1.5, 0.00015 * pxPer)
						g.beginPath(); g.arc(cx, cy, pr + g.lineWidth * 0.5, 0, TAU); g.stroke()
					}
				}
			}
			const m = mat(`die-face|${n}|${size.toFixed(4)}`, {
				map: colorTex(`die-c|${n}|${size.toFixed(4)}`, SZ, SZ, (g, W, H) => draw(g, W, H, "c")),
				normalMap: normalTex(`die-n|${n}|${size.toFixed(4)}`, SZ, SZ, (g, W, H) => draw(g, W, H, "n"), { strength: 3, wrap: false, blur: 0 }),
				normalScale: new THREE.Vector2(1, 1), roughness: 0.3, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.2,
			})
			return m
		}
		const faces = L.faces({ px: faceTex(3), nx: faceTex(4), py: faceTex(1), ny: faceTex(6), pz: faceTex(2), nz: faceTex(5) })
		return kit.group(kit.mesh(kit.box(w, h, d, rad, 4), faces))
	})

	// ------------------------------------------------------------- brick: red ABS 2 x 4, the body fills its box, the studs stand 1.7 mm above it
	addModel("lego-brick", "body", ({ w, h, d, color }) => {
		const tone = rich(color || "#d6322c", 1.1, 0.62)
		const plastic = mat(`brick2|${tone}`, {
			color: tone, roughness: 0.3, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3,
			normalMap: normalTex("abs-grain", 256, 256, (g, W, H) => pixels(g, W, H, (x, y) => { const v = 128 + 60 * (fbm(x / 4, y / 4, 3, 5, 64) - 0.5); return [v, v, v] }), { strength: 0.8 }), normalScale: new THREE.Vector2(0.25, 0.25),
		})
		const studH = 0.0017 // real studs are 1.7 mm: thin details may stand out of the physics box
		const group = kit.group()
		const body = kit.mesh(kit.box(w, h, d, 0.00035, 3), plastic)
		group.add(body)
		const pitch = 0.008
		const studR = 0.0024
		const fil = 0.00015 // a tiny fillet where the stud meets the top
		const stud = new THREE.LatheGeometry([[0, 0], [studR + fil, 0], [studR + fil * 0.3, fil * 0.35], [studR, fil], [studR, studH - 0.0002], [studR - 0.0003, studH], [0, studH]].map(([r, y]) => new THREE.Vector2(r, y)), 32)
		const cols = Math.max(1, Math.round(w / pitch))
		const rows = Math.max(1, Math.round(d / pitch))
		const list = []
		for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) list.push(stud.clone().translate((i - (cols - 1) / 2) * pitch, h / 2 - 0.00002, (j - (rows - 1) / 2) * pitch))
		group.add(kit.mesh(mergeGeos(list, `studs2|${cols}x${rows}|${h.toFixed(4)}`), plastic))
		return group
	})

	// ------------------------------------------------------------- Rubik's cube: 26 black cubies with layer grooves, raised stickers
	addModel("rubiks-cube", "body", ({ w, h, d }) => {
		const size = Math.min(w, h, d)
		const p = size / 3 // pitch of a layer
		const gap = 0.00035
		const cub = p - gap // a cubie
		const SK = 0.00015 // a sticker stands this proud
		const skSize = cub * 0.86
		const colors = { w: "#f6f6f0", y: "#f7cf0c", r: "#d4141f", o: "#f26a0a", b: "#1250b8", g: "#0a9a3a" }
		const blk = mat("rubik-abs", { color: "#0d0d0f", roughness: 0.3, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35 })
		const group = kit.group()
		group.add(kit.mesh(kit.box(size - 0.0024, size - 0.0024, size - 0.0024, 0.001, 1), blk)) // the core, 1.2 mm under the skin: the layer gaps are 1.2 mm deep and opaque
		const cubGeo = kit.box(cub, cub, cub, 0.0009, 2)
		const cubies = []
		const stickers = {}
		const skGeo = plate(rrect(skSize - 0.00008, skSize - 0.00008, cub * 0.13 - 0.00004), 0, SK, { bevel: 0.00004, curve: 3 })
		const faces = [["r", [1, 0, 0]], ["o", [-1, 0, 0]], ["w", [0, 1, 0]], ["y", [0, -1, 0]], ["g", [0, 0, 1]], ["b", [0, 0, -1]]] // red right, orange left, white up, yellow down, green toward us, blue back
		const up = new THREE.Vector3(0, 1, 0)
		for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
			if (!i && !j && !k) continue
			const c = new THREE.Vector3(i * p, j * p, k * p)
			cubies.push(cubGeo.clone().translate(c.x, c.y, c.z))
			for (const [key, n] of faces) {
				const nv = new THREE.Vector3(...n)
				if (nv.x * i + nv.y * j + nv.z * k !== 1) continue // only outer faces of this cubie
				const q = new THREE.Quaternion().setFromUnitVectors(up, nv)
				const m = new THREE.Matrix4().compose(c.clone().addScaledVector(nv, cub / 2 - 0.00002), q, new THREE.Vector3(1, 1, 1))
				;(stickers[key] ??= []).push(skGeo.clone().applyMatrix4(m))
			}
		}
		group.add(kit.mesh(mergeGeos(cubies, `rubik-cubies|${size.toFixed(4)}`), blk))
		for (const [key, list] of Object.entries(stickers)) {
			const sm = mat(`rubik-sticker|${key}`, { color: rich(colors[key], 1.25, 0.82), roughness: 0.38, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4 })
			group.add(kit.mesh(mergeGeos(list, `rubik-stk|${key}|${size.toFixed(4)}`), sm))
		}
		return group
	})

	// ------------------------------------------------------------- pillow: white cotton, a domed top and a flat-bottomed underside meeting at a piped seam, thin pinched corners
	// The side outline is the physics outline (machines/catalog_everyday.py PILLOW_PIECES, mm about the centre of the 660 x 120 box, right half):
	//   crown  y = -22 + 82 (1 - u^3)^0.75,  belly  y = -22 - min(38, 60 (1 - u^2.8)^0.7),  u = |x| / 330, the seam at (330, -22).
	// The cloth is a product of that profile along x and along z, so the surface is as thick as the outline along the middle line and thins to the seam toward every edge, and the
	// four corners (where both factors are small) are flat, pointed ears. The plan is a rounded rectangle with its long sides drawn in a little between the corners.
	addModel("pillow", "body", ({ body, props, color }) => {
		const bp = body.points // the physics body is only the middle piece (the rest are welded to it): the size comes from the props
		const W = props?.width ?? Math.max(...bp.map((p) => Math.abs(p.x))) / 0.1875
		const H = props?.height ?? Math.max(...bp.map((p) => p.y)) - Math.min(...bp.map((p) => p.y))
		const D = props?.depth ?? body.depth ?? 0.51
		const sy = H / 0.12
		const a = W / 2, c = D / 2
		const tone = blend(color || "#f3f1ec", "#f3f1ec", 0.6) // warm white cotton
		const Y0 = -0.022 * sy // the seam's height
		const TOP = 0.082 * sy, BOT = 0.06 * sy, CAP = 0.038 * sy // crown above the seam; belly (and its flat floor) below it
		const crown = (u) => Math.pow(Math.max(0, 1 - u * u * u), 0.75)
		const belly = (u) => Math.pow(Math.max(0, 1 - Math.pow(u, 2.8)), 0.7)
		const pr = Math.min(0.003, 0.025 * H, 0.01 * W) // the piping cord: its outer side sits on the outline
		const aT = a - pr, cT = c - pr // the cord's path
		const aE = aT + Math.min(0.0015, pr / 2), cE = cT + Math.min(0.0015, pr / 2) // where the two shells end: over the cord
		const uMax = aE / a, vMax = cE / c
		const NB = 16 // plan corner exponent: nearly square corners
		const KZ = 0.02 // the long sides are drawn in this much between the corners
		// plan point on the way to the seam at square position q = [qu, qv] (on the unit square's boundary) and ring s (0 = centre, 1 = the shells' edge)
		const planAt = (qu, qv, s) => {
			const g = Math.pow(Math.pow(Math.abs(qu), NB) + Math.pow(Math.abs(qv), NB), -1 / NB)
			return [s * g * qu * aE, s * g * qv * cE * (1 - KZ * Math.pow(Math.max(0, 1 - qu * qu), 1.3) * Math.pow(s, 6))]
		}
		// the boundary samples: the four sides of the unit square counter-clockwise, finer toward the corners
		const sides = (NS) => {
			const q = []
			for (let k = 0; k < 4 * NS; k++) {
				const side = Math.floor(k / NS)
				const w = -1 + (2 * (k % NS)) / NS
				const r = 0.5 * w + 0.5 * Math.sin((Math.PI * w) / 2)
				const t = side * 40 + ((w + 1) / 2) * 40 // the place along the boundary, in the 40-per-side table of the seam's arc lengths
				q.push(side === 0 ? [1, r, t] : side === 1 ? [-r, 1, t] : side === 2 ? [-1, -r, t] : [r, -1, t])
			}
			return q
		}
		const loopMax = (() => {
			let mz = 0
			for (const [qu, qv] of sides(40)) mz = Math.max(mz, Math.abs(planAt(qu, qv, 1)[1]))
			return mz
		})()
		const zk = cE / loopMax // so the loop reaches exactly cE across
		const plan = (qu, qv, s) => { const p = planAt(qu, qv, s); return [p[0], p[1] * zk] }
		// the seam's arc length (for the puckers: the cloth is gathered along it) and the corners' places
		const Q40 = sides(40)
		const loop = Q40.map(([qu, qv]) => plan(qu, qv, 1))
		const arcs = [0]
		for (let i = 1; i <= loop.length; i++) arcs.push(arcs[i - 1] + Math.hypot(loop[i % loop.length][0] - loop[i - 1][0], loop[i % loop.length][1] - loop[i - 1][1]))
		const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([qu, qv]) => plan(qu, qv, 1))
		const arcAt = (t) => { const i = Math.floor(t) % Q40.length; return arcs[i] + (arcs[i + 1] - arcs[i]) * (t - Math.floor(t)) } // the seam's arc length at a place in the table
		// soft wrinkles: creases that fan out from each pinched corner, and a broad ridged fold noise
		const folds = (x, z) => {
			let s = 0
			for (const [cx, cz] of corners) {
				const dx = x - cx, dz = z - cz
				const dist = Math.hypot(dx, dz)
				const ang = Math.atan2(dz, dx)
				s += Math.exp(-dist / 0.15) * Math.abs(Math.sin(ang * 8 + 3 * fbm(dist * 8, ang * 2, 2, 7)))
			}
			return s
		}
		const ridge = (x, z) => 1 - Math.abs(2 * fbm(x * 7 + 3, z * 7 + 7, 4, 41) - 1)
		const PK = 0.001 * Math.min(1, sy) // puckers along the seam: ripples about 30 mm apart that die out 25 mm inside it
		const sP = 1 - 0.025 / aE
		const pucker = (qu, qv, s, t) => {
			const ends = qu * qu * (1 - sm(clamp(Math.abs(qv) / 0.25))) // none where the end of the outline's middle line meets the seam
			const L = arcAt(t)
			const irr = 0.55 + 0.9 * vnoise(L * 23, 3.1, 61) // the ripples vary in height and spacing, as gathered cloth does
			return PK * Math.sin((L / 0.03) * TAU + 0.7 + 2.2 * vnoise(L * 17, 8.3, 29)) * irr * sm(clamp((s - sP) / (1 - sP))) * (1 - ends)
		}
		// the rings, finer toward the seam
		const ringsOf = (N) => Array.from({ length: N + 1 }, (_, i) => 1 - Math.pow(1 - i / N, 1.8))
		const TILE = 0.064 // the crinkle texture repeats every 64 mm
		const build = (top) => {
			const NS = 48 // both shells use the cord's samples, so their edges meet it
			const S = ringsOf(top ? 30 : 16)
			const Q = sides(NS)
			const NA = Q.length
			const pos = [], uv = [], uv1 = [], col = [], idx = []
			// the stretch of the surface along the middle line, ring by ring (so the texture is not drawn longer on the steep shoulder)
			const kStretch = [1]
			{
				let arc = 0
				let px = 0, py = 0
				for (let i = 0; i < S.length; i++) {
					const uu = S[i] * uMax
					const yy = top ? TOP * crown(uu) : -Math.min(CAP, BOT * belly(uu))
					const xx = S[i] * aE
					if (i) arc += Math.hypot(xx - px, yy - py)
					px = xx; py = yy
					if (i) kStretch.push(arc / xx)
				}
			}
			for (let i = 0; i < S.length; i++) {
				const s = S[i]
				for (let j = 0; j < NA; j++) {
					const [qu, qv, qt] = Q[j]
					const [x, z] = plan(qu, qv, s)
					const uu = s * Math.abs(qu) * uMax, vv = s * Math.abs(qv) * vMax
					let y
					let sh
					const pk = pucker(qu, qv, s, qt)
					const tuckW = sm(clamp((s - (1 - 0.0035 / (0.5 * (aE + cE)))) / (0.0035 / (0.5 * (aE + cE))))) // the last 3.5 mm: the cloth turns in over the cord, so no slit shows between them
					if (top) {
						const th0 = TOP * crown(uu) * crown(vv)
						const th = th0 + (Math.min(th0, 0.75 * pr) - th0) * tuckW
						y = Y0 + th + pk
						const rv = ridge(x, z)
						const fo = Math.min(1, folds(x, z))
						const env = sm(clamp((1 - s) / 0.15)) * sm(clamp(Math.abs(z) / (0.12 * c))) * sm(clamp(th0 / (0.25 * TOP)))
						y -= env * sy * (0.004 * (1 - rv) + 0.011 * fo * (0.4 + 0.6 * rv))
						sh = (0.72 + 0.28 * sm(clamp((1 - s) / 0.3))) * (1 - 0.3 * fo * env) * (0.9 + 0.1 * rv)
					} else {
						const d0 = Math.min(CAP, BOT * belly(uu) * belly(vv))
						y = Y0 - (d0 + (Math.min(d0, 0.75 * pr) - d0) * tuckW) + pk
						sh = 0.8 + 0.1 * sm(clamp((1 - s) / 0.3))
					}
					pos.push(x, y, z)
					const k = kStretch[i]
					uv.push((x * k) / TILE, (z * k) / TILE)
					uv1.push(0.5 + (0.5 * x) / aE, 0.5 + (0.5 * z) / cE) // the plan, for the stitching
					col.push(sh, sh, sh)
				}
			}
			for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < NA; j++) {
				const p = i * NA + j, q = i * NA + ((j + 1) % NA), p2 = p + NA, q2 = q + NA
				idx.push(p, q, p2, q, q2, p2)
			}
			const g = new THREE.BufferGeometry()
			g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2))
			g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
			g.setIndex(idx)
			g.computeVertexNormals()
			// the outer face of each shell: the top faces up, the bottom down (flip the winding if the first guess was the other way)
			const mid = Math.floor(S.length / 2) * NA + 3
			if ((g.attributes.normal.getY(mid) > 0) !== top) {
				const ix = g.index.array
				for (let t = 0; t < ix.length; t += 3) { const u = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = u }
				g.computeVertexNormals()
			}
			// the centre ring is one point: give its vertices the mean normal of the next ring
			{
				const nr = g.attributes.normal
				let nx = 0, ny = 0, nz = 0
				for (let j = 0; j < NA; j++) { nx += nr.getX(NA + j); ny += nr.getY(NA + j); nz += nr.getZ(NA + j) }
				const l = Math.hypot(nx, ny, nz) || 1
				for (let j = 0; j < NA; j++) nr.setXYZ(j, nx / l, ny / l, nz / l)
			}
			return g
		}
		// the cloth's weave (fine) and creases (soft, a few mm across), drawn once as one normal map; and the weave alone for the cord
		const weave = (x, y) => (((x >> 2) + (y >> 2)) & 1 ? 0.5 + 0.5 * Math.cos(((x & 3) / 4) * TAU) : 0.5 + 0.5 * Math.cos(((y & 3) / 4) * TAU))
		const crinkleN = normalTex("pillow-crinkle2", 256, 256, (g, W, H) => pixels(g, W, H, (x, y) => {
			const ridgeN = 1 - Math.abs(2 * fbm(x / 32, y / 32, 3, 91, 8) - 1)
			const soft = fbm(x / 64 + 5, y / 64 + 9, 2, 17, 4)
			const v = (0.12 * weave(x, y) + 0.55 * ridgeN + 0.33 * soft) * 255
			return [v, v, v]
		}), { strength: 4.5 })
		const weaveN = normalTex("pillow-weave", 128, 128, (g, W, H) => pixels(g, W, H, (x, y) => {
			const v = (0.3 + 0.55 * weave(x, y) + (vnoise(x * 0.3, y * 0.3, 2, 38) - 0.5) * 0.15) * 255
			return [v, v, v]
		}), { strength: 1.4 })
		// the printed colour: the cotton with a row of top-stitching a centimetre inside the piping (drawn on the plan, so it follows the rounded rectangle)
		const SW = 1536, SH = 1152
		const stitchTex = colorTex(`pillow-stitch2|${tone}|${aE.toFixed(3)}|${cE.toFixed(3)}`, SW, SH, (g, W, H) => {
			g.fillStyle = tone
			g.fillRect(0, 0, W, H)
			fibres(g, W, H, 33, { n: 4000, alpha: 0.03, len: 4 })
			g.strokeStyle = "rgba(95,105,125,0.5)"
			g.lineWidth = 1.7
			g.lineCap = "round"
			const sc = 1 - 0.011 / aE
			const N = 1600
			const toPx = (i) => {
				const k = (i / N) * 4 * 40
				const k0 = Math.floor(k) % (4 * 40), f = k - Math.floor(k)
				const A = Q40[k0], B = Q40[(k0 + 1) % (4 * 40)]
				const qu = A[0] + (B[0] - A[0]) * f, qv = A[1] + (B[1] - A[1]) * f
				const [x, z] = plan(qu, qv, sc)
				return [x, z, W / 2 + (x / aE) * (W / 2), H / 2 + (z / cE) * (H / 2)]
			}
			let run = 0
			let [px, pz, ppx, ppy] = toPx(0)
			for (let i = 1; i <= N; i++) {
				const [x, z, qx, qy] = toPx(i)
				const phase = run % 0.0048 // 3.2 mm stitches, 1.6 mm apart
				if (phase < 0.0032) { g.beginPath(); g.moveTo(ppx, ppy); g.lineTo(qx, qy); g.stroke() }
				run += Math.hypot(x - px, z - pz)
				px = x; pz = z; ppx = qx; ppy = qy
			}
		}, { wrap: false })
		stitchTex.channel = 1
		const fab = mat(`pillow-fabric5|${tone}|${aE.toFixed(3)}|${cE.toFixed(3)}`, {
			color: "#ffffff", map: stitchTex, vertexColors: true, roughness: 1, metalness: 0, sheen: 0.6, sheenRoughness: 0.55, sheenColor: shade(tone, 1.15),
			normalMap: crinkleN, normalScale: new THREE.Vector2(0.85, 0.85), emissive: tone, emissiveIntensity: 0.03,
		})
		const group = kit.group(kit.mesh(build(true), fab), kit.mesh(build(false), fab))
		// the piping: a woven cord on the seam, the same plan curve as the shells' edge so it stays proud all the way round
		const path = []
		let len = 0
		for (const [qu, qv, qt] of sides(48)) { // the same samples as the top shell's edge, so the cord stays with the cloth
			const [x, z] = plan(qu, qv, 1)
			path.push(new THREE.Vector3(x * (aT / aE), Y0 + pucker(qu, qv, 1, qt), z * (cT / cE)))
			if (path.length > 1) len += path[path.length - 1].distanceTo(path[path.length - 2])
		}
		const NC = path.length
		const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, true, "centripetal"), NC, pr, 10, true)
		const pipeMat = mat(`pillow-pipe4|${tone}|${len.toFixed(2)}`, { color: shade(tone, 0.95), roughness: 1, metalness: 0, sheen: 0.8, sheenRoughness: 0.5, sheenColor: shade(tone, 1.1), emissive: tone, emissiveIntensity: 0.03, normalMap: withRepeat(weaveN, len / 0.008, (TAU * pr) / 0.008), normalScale: new THREE.Vector2(1.0, 1.0) })
		group.add(kit.mesh(tube, pipeMat))
		return group
	})
	// the pillow's other physics pieces (welded to the body, see machines/catalog_everyday.py) are drawn by its body model
	for (const part of ["arch", "slope", "rim", "nose"]) for (const side of ["r", "l"]) addModel("pillow", `${part}-${side}`, null)
}
