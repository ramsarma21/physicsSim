// Flat things: cutting board, sponge, smartphone, closed laptop, TV remote. (helpers: everyday-a-lib.js)
export default function register(addModel, L) {
	const { THREE, kit, TAU, rng, vnoise, fbm, clamp, mix, shade, blend, rich, normalTex, dataTex, mat, colorTex, withRepeat, loftX, rr, fibres, pixels, spaced, plate, rrect, rrectHole, circleHole, rrPlate, notchedRRect, mergeGeos } = L
	const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
	const deepen = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getStyle()
	/** Rotates the drawing so a portrait picture reads upright on a landscape face whose canvas is W x H (picture top = canvas left). */
	const rotPortrait = (g, W, H, draw) => {
		g.save()
		g.translate(0, H)
		g.rotate(-Math.PI / 2)
		draw(g, H, W)
		g.restore()
	}

	// ------------------------------------------------------------- cutting board: maple strips with walnut accents, end grain at the ends, a coved juice groove
	addModel("cutting-board", "body", ({ w, h, d }) => {
		const bev = 0.0007
		const R0 = 0.019 // plan corner radius
		const g0 = 0.0145 // groove: distance of its outer edge from the board edge
		const gw = 0.0075 // groove width
		const gd = 0.0034 // groove depth below the top
		const maple = ["#e0b774", "#d8ac66", "#e4c080", "#d4a65f", "#dcb26e"]
		const walnut = ["#6a4128", "#5b3623"]
		// the strips (fractions of the depth, back to front): the same layout is painted on top and on the end grain
		const NSTRIP = 15
		const strips = (() => {
			const r = rng(78)
			const out = []
			let y = 0
			for (let i = 0; i < NSTRIP && y < 1; i++) {
				const dark = i === 6 || i === 8
				const sw = dark ? (1 / NSTRIP) * 0.7 : ((1 - (1 / NSTRIP) * 1.4) / (NSTRIP - 2)) * (0.85 + 0.3 * r())
				const base = dark ? walnut[i % 2] : maple[Math.floor(r() * maple.length)]
				const y1 = i === NSTRIP - 1 ? 1 : Math.min(1, y + sw)
				out.push({ y0: y, y1, dark, base })
				y = y1
			}
			return out
		})()
		const topTex = colorTex("board-top2", 2048, 1536, (g, W, H) => {
			const r = rng(77)
			strips.forEach((st) => {
				const y = st.y0 * H, y1 = st.y1 * H
				const dark = st.dark
				g.fillStyle = st.base
				g.fillRect(0, y, W, y1 - y)
				const n = Math.round(((y1 - y) / 4) * (dark ? 1.4 : 1))
				for (let k = 0; k < n; k++) { // long grain lines with a slow wobble
					const yy = y + r() * (y1 - y)
					g.strokeStyle = dark ? (r() < 0.5 ? "rgba(20,8,2,0.35)" : "rgba(160,100,60,0.22)") : r() < 0.6 ? `rgba(120,80,35,${0.1 + 0.26 * r()})` : `rgba(255,244,214,${0.12 + 0.2 * r()})`
					g.lineWidth = 0.8 + r() * 1.4
					g.beginPath()
					const ph = r() * 9
					const amp = 1 + r() * 2.5
					for (let x = 0; x <= W; x += 24) g[x === 0 ? "moveTo" : "lineTo"](x, yy + Math.sin(x * 0.004 + ph) * amp + (vnoise(x * 0.01, yy * 0.05, 3) - 0.5) * 3)
					g.stroke()
				}
				for (let k = 0; k < 4; k++) { // a darker cloud in the strip (cathedral figure of the grain)
					const cx = r() * W
					const gr = g.createRadialGradient(cx, (y + y1) / 2, 2, cx, (y + y1) / 2, 300)
					gr.addColorStop(0, `rgba(150,100,45,${dark ? 0.05 : 0.1})`)
					gr.addColorStop(1, "rgba(150,100,45,0)")
					g.save()
					g.beginPath(); g.rect(0, y, W, y1 - y); g.clip()
					g.fillStyle = gr
					g.fillRect(cx - 300, y, 600, y1 - y)
					g.restore()
				}
				g.fillStyle = "rgba(70,40,15,0.55)" // the glue line
				g.fillRect(0, y1 - 1.5, W, 1.5)
			})
			for (let k = 0; k < 70; k++) { // knife marks from use
				const x = r() * W
				const yy = r() * H
				const a = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.6
				const len = 60 + r() * 260
				g.strokeStyle = r() < 0.6 ? "rgba(90,55,20,0.14)" : "rgba(255,248,230,0.16)"
				g.lineWidth = 1
				g.beginPath(); g.moveTo(x, yy); g.lineTo(x + Math.cos(a) * len, yy + Math.sin(a) * len); g.stroke()
			}
		})
		// the walls: one picture round the whole outline. Long faces show the side grain, the two ends the end grain of every strip.
		const A = w / 2, B = d / 2, Rr = R0
		const Ls = 2 * (A - Rr), Le = 2 * (B - Rr), Ac = (Math.PI * Rr) / 2
		const P = 2 * Ls + 2 * Le + 4 * Ac
		const sRightEnd = Ls + Ac // where the right end's flat part starts (z from +(B-R) down to -(B-R))
		const sLeftEnd = 2 * Ls + Le + 3 * Ac // the left end's (z from -(B-R) up to +(B-R))
		const sOf = (x, z) => {
			const ax = Math.abs(x), az = Math.abs(z)
			const cx = ax > A - Rr, cz = az > B - Rr
			if (cx && cz) {
				const phi = Math.atan2(az - (B - Rr), ax - (A - Rr)) // 0 on the end side, pi/2 on the long side
				if (x > 0 && z > 0) return Ls + Rr * (Math.PI / 2 - phi)
				if (x > 0) return sRightEnd + Le + Rr * phi
				if (z < 0) return sRightEnd + Le + Ac + Ls + Rr * (Math.PI / 2 - phi)
				return sLeftEnd + Le + Rr * phi
			}
			if (cx) return x > 0 ? sRightEnd + (B - Rr - z) : sLeftEnd + (z + B - Rr)
			return z > 0 ? x + A - Rr : sRightEnd + Le + Ac + (A - Rr - x)
		}
		const WCW = 6144, WCH = 192
		const wallTex = colorTex(`board-wall2|${w.toFixed(4)}|${d.toFixed(4)}|${h.toFixed(4)}`, WCW, WCH, (g, W, H) => {
			const r = rng(79)
			const pxS = W / P // px per metre along the outline
			const pxV = H / h // px per metre of height
			g.fillStyle = "#cfa263"
			g.fillRect(0, 0, W, H)
			for (let k = 0; k < 420; k++) { // side grain on the long faces and corners
				g.strokeStyle = r() < 0.6 ? `rgba(120,80,35,${0.1 + 0.25 * r()})` : `rgba(255,244,214,${0.1 + 0.2 * r()})`
				g.lineWidth = 0.8 + r() * 1.5
				const y = r() * H
				g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.006 + k) * 2); g.stroke()
			}
			// end grain: every strip is a block of the full thickness; its growth rings run as arcs, pores speckle it, glue lines divide the blocks
			const endGrain = (sStart, dir) => {
				strips.forEach((st, i) => {
					const z0 = -B + st.y0 * d, z1 = -B + st.y1 * d
					const sa = dir < 0 ? sStart + (B - Rr - z1) : sStart + (z0 + B - Rr)
					const sb = dir < 0 ? sStart + (B - Rr - z0) : sStart + (z1 + B - Rr)
					const x0 = sa * pxS, x1 = sb * pxS
					const rr0 = rng(500 + i)
					g.save()
					g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip()
					g.fillStyle = shade(st.base, st.dark ? 0.82 : 0.9)
					g.fillRect(x0, 0, x1 - x0, H)
					// growth rings: arcs about a pith somewhere above or below the block
					const cxp = (x0 + x1) / 2 + (rr0() - 0.5) * (x1 - x0) * 0.8
					const cyp = rr0() < 0.5 ? -H * (0.1 + rr0() * 0.9) : H * (1.1 + rr0() * 0.9)
					g.lineWidth = 1.1
					for (let rad = 14; rad < H * 4; rad += 20 + rr0() * 16) {
						g.strokeStyle = st.dark ? `rgba(25,10,4,${0.25 + 0.25 * rr0()})` : `rgba(110,68,28,${0.2 + 0.3 * rr0()})`
						g.beginPath(); g.ellipse(cxp, cyp, rad * 0.44, rad, 0, 0, TAU); g.stroke()
					}
					for (let k = 0; k < (x1 - x0) * H * 0.0035; k++) { // pores
						g.fillStyle = `rgba(70,40,15,${0.25 + 0.35 * rr0()})`
						g.fillRect(x0 + rr0() * (x1 - x0), rr0() * H, 1.2 + rr0() * 1.6, 1 + rr0() * 2)
					}
					g.restore()
					g.fillStyle = "rgba(60,32,12,0.5)" // the glue line between this block and the next
					g.fillRect(x1 - 1, 0, 2, H)
				})
			}
			endGrain(sRightEnd, -1)
			endGrain(sLeftEnd, 1)
			void pxV
		})
		const tag = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`
		const topMat = mat(`board-top2|${tag}`, { map: withRepeat(topTex, 1 / w, 1 / d, 0.5, 0.5), roughness: 0.52, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.4 })
		const sideMat = mat(`board-side2|${tag}`, { map: wallTex, roughness: 0.62, metalness: 0 })
		const grooveMat = mat(`board-groove2|${tag}`, { map: withRepeat(topTex, 1 / w, 1 / d, 0.5, 0.5), color: "#cdc6be", roughness: 0.78, metalness: 0 })
		const group = kit.group()
		// the rim: full height, with a hole where the groove and the middle sit; its walls take the wall picture
		const rim = plate(rrect(w - 2 * bev, d - 2 * bev, R0 - bev), -h / 2, h / 2, {
			bevel: bev, holes: [rrectHole(w - 2 * g0 + 2 * bev, d - 2 * g0 + 2 * bev, Math.max(0.003, R0 - g0) + bev)],
		})
		{ // uv of the walls = (distance round the outline / P, height from the bottom / h)
			const grp = rim.groups.find((q) => q.materialIndex === 1)
			const pa = rim.attributes.position
			const uv = rim.attributes.uv
			for (let i = grp.start; i < grp.start + grp.count; i += 3) {
				const ss = [0, 1, 2].map((k) => sOf(pa.getX(i + k), pa.getZ(i + k)))
				const mx = Math.max(...ss)
				for (let k = 0; k < 3; k++) {
					const s2 = mx - ss[k] > P / 2 ? ss[k] + P : ss[k]
					uv.setXY(i + k, s2 / P, (pa.getY(i + k) + h / 2) / h)
				}
			}
		}
		group.add(kit.mesh(rim, [topMat, sideMat]))
		// the middle island
		const gi = g0 + gw
		const isl = plate(rrect(w - 2 * gi - 2 * bev, d - 2 * gi - 2 * bev, Math.max(0.003, R0 - gi)), h / 2 - gd - 0.0002, h / 2, { bevel: bev })
		group.add(kit.mesh(isl, [topMat, sideMat]))
		// the juice groove: a half-round cove swept round the outline (its ends meet the rim and the island wall, both vertical)
		{
			const K = 14
			const yT = h / 2 - bev
			const D = gd - bev
			const ringAt = (o) => {
				const hx = A - o, hz = B - o, r = Math.max(0.0008, Rr - o)
				const pts = []
				const arcs = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]] // shape coordinates (x, y = -z), counter-clockwise
				for (const [cx, cy, a0] of arcs) for (let q = 0; q <= 8; q++) {
					const a = a0 + (q / 8) * (Math.PI / 2)
					pts.push([cx + r * Math.cos(a), -(cy + r * Math.sin(a))])
				}
				return pts
			}
			const pos = [], uv = [], idx = []
			let N = 0
			for (let k = 0; k <= K; k++) {
				const u = (k / K) * 2 - 1
				const o = g0 + gw * (0.5 + u * 0.5)
				const y = yT - D * Math.sqrt(Math.max(0, 1 - u * u))
				const ring = ringAt(o)
				N = ring.length
				for (const [x, z] of ring) { pos.push(x, y, z); uv.push(x, -z) }
			}
			for (let k = 0; k < K; k++) for (let j = 0; j < N; j++) {
				const a = k * N + j, b = k * N + ((j + 1) % N), c = a + N, e = b + N
				idx.push(a, c, b, b, c, e)
			}
			const gg = new THREE.BufferGeometry()
			gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
			gg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
			gg.setIndex(idx)
			gg.computeVertexNormals()
			{ // face up
				const ny = gg.attributes.normal.getY(Math.floor(N * (K / 2)) + 3)
				if (ny < 0) { const ix = gg.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t } gg.computeVertexNormals() }
			}
			group.add(kit.mesh(gg, grooveMat))
		}
		return group
	})

	// ------------------------------------------------------------- sponge: yellow foam with a green scouring layer
	addModel("sponge", "body", ({ w, h, d }) => {
		const scourT = 0.0036
		const bodyH = h - scourT
		const TILE = 0.02 // metres a texture tile covers
		const poreKey = "sponge-pores8"
		const pores = (g, W, H, mode) => {
			// mode "h": a height drawing (white = high); "c": colour. An open-cell foam: a dense web of small dark irregular cells (0.2-0.8 mm), a few big pores (1-2.5 mm), pale thin walls between
			const r = rng(404)
			if (mode === "h") { g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, W, H) }
			else {
				// kitchen-sponge yellow with soft mottling, evaluated every other texel and smoothed up (the noise is slow: this is a quarter of the work)
				const half = document.createElement("canvas")
				half.width = W / 2
				half.height = H / 2
				pixels(half.getContext("2d"), W / 2, H / 2, (hx, hy) => {
					const x = 2 * hx, y = 2 * hy
					const n = fbm(x / 64, y / 64, 3, 12, 8)
					const m = fbm(x / 9, y / 9, 2, 5, 57)
					return [clamp(0.9 + 0.03 * (n - 0.5) - 0.03 * m) * 247, clamp(0.78 + 0.1 * (n - 0.5) - 0.05 * m) * 241, clamp(0.15 + 0.05 * (n - 0.5)) * 257]
				})
				g.imageSmoothingEnabled = true
				g.drawImage(half, 0, 0, W, H)
			}
			// one soft hole drawn once (no pale rim: it would wash the yellow toward cream) and stamped, stretched and turned, everywhere
			const st = document.createElement("canvas")
			st.width = st.height = 64
			const sg = st.getContext("2d")
			const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32)
			if (mode === "h") { gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.6, "rgba(30,30,30,0.95)"); gr.addColorStop(0.88, "rgba(110,110,110,0.4)"); gr.addColorStop(1, "rgba(200,200,200,0)") }
			else { gr.addColorStop(0, "rgba(150,92,0,0.8)"); gr.addColorStop(0.55, "rgba(190,128,0,0.5)"); gr.addColorStop(0.86, "rgba(225,175,10,0.14)"); gr.addColorStop(1, "rgba(225,175,10,0)") }
			sg.fillStyle = gr
			sg.fillRect(0, 0, 64, 64)
			const drawPore = (x, y, rx, ry, rot) => {
				for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
					const px = x + ox, py = y + oy
					if (px < -rx * 2 || px > W + rx * 2 || py < -rx * 2 || py > H + rx * 2) continue
					g.save()
					g.translate(px, py)
					g.rotate(rot)
					g.drawImage(st, -rx, -ry, 2 * rx, 2 * ry)
					g.restore()
				}
			}
			for (let i = 0; i < 3300; i++) { // a tile is 20 mm over 512 px: 1 px = 0.04 mm
				const big = i < 55
				const rx = big ? 13 + r() * 17 : 2.4 + r() * r() * 9
				drawPore(r() * W, r() * H, rx, rx * (0.55 + 0.45 * r()), r() * TAU)
			}
		}
		const foamC = colorTex(poreKey + "|c", 512, 512, (g, W, H) => pores(g, W, H, "c"), { wrap: true })
		const foamN = normalTex(poreKey, 512, 512, (g, W, H) => pores(g, W, H, "h"), { strength: 4, blur: 0.7 })
		const fibreH = (g, W, H, mode) => {
			const r = rng(505)
			g.fillStyle = mode === "h" ? "#808080" : "#2a8a3c"
			g.fillRect(0, 0, W, H)
			for (let i = 0; i < 2600; i++) {
				const x = r() * W, y = r() * H, a = r() * Math.PI, len = 18 + r() * 60
				const col = mode === "h" ? (r() < 0.5 ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)") : r() < 0.5 ? `rgba(14,70,26,${0.35 + 0.4 * r()})` : `rgba(120,210,120,${0.25 + 0.3 * r()})`
				g.strokeStyle = col
				g.lineWidth = 1 + r() * 2
				const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len
				for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { // the copies that wrap round the tile: only where the fibre crosses an edge
					if (Math.max(x, ex) + ox < -2 || Math.min(x, ex) + ox > W + 2 || Math.max(y, ey) + oy < -2 || Math.min(y, ey) + oy > H + 2) continue
					g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(ex + ox, ey + oy); g.stroke()
				}
			}
		}
		const scourC = colorTex("sponge-scour|c", 512, 512, (g, W, H) => fibreH(g, W, H, "c"), { wrap: true })
		const scourN = normalTex("sponge-scour", 512, 512, (g, W, H) => fibreH(g, W, H, "h"), { strength: 2.2, blur: 0.5 })
		const foam = (rx, ry, tag) => kit.mat(`sponge-foam5|${tag}|${rx}|${ry}`, { map: withRepeat(foamC, rx, ry), normalMap: withRepeat(foamN, rx, ry), normalScale: new THREE.Vector2(1, 1), roughness: 0.95, metalness: 0, toneMapped: false }) // AgX would pale a saturated yellow toward cream (B > 100): the foam skips it (and the lib's saturation grade, which zeroes the blue of a light yellow), as the duck's vinyl does
		const scour = (rx, ry, tag) => mat(`sponge-scour|${tag}|${rx}|${ry}`, { map: withRepeat(scourC, rx, ry), normalMap: withRepeat(scourN, rx, ry), normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.9, metalness: 0 })
		const t = (len) => Math.max(1, Math.round(len / TILE))
		const group = kit.group()
		const fm = L.faces({
			px: foam(t(d), t(bodyH), "e"), nx: foam(t(d), t(bodyH), "e"), py: foam(t(w), t(d), "t"), ny: foam(t(w), t(d), "t"),
			pz: foam(t(w), t(bodyH), "s"), nz: foam(t(w), t(bodyH), "s"),
		})
		const body = kit.mesh(kit.box(w, bodyH, d, 0.0018, 4), fm)
		body.position.y = -h / 2 + bodyH / 2
		const sm = L.faces({
			px: scour(t(d), 1, "e"), nx: scour(t(d), 1, "e"), py: scour(t(w), t(d), "t"), ny: scour(t(w), t(d), "t"),
			pz: scour(t(w), 1, "s"), nz: scour(t(w), 1, "s"),
		})
		const top = kit.mesh(kit.box(w, scourT, d, 0.0004, 2), sm)
		top.position.y = h / 2 - scourT / 2
		group.add(body, top)
		return group
	})

	// ------------------------------------------------------------- smartphone lying on its back (screen up)
	addModel("smartphone", "body", ({ w, h, d, color }) => {
		const tone = color || "#5b6577"
		const outerR = 0.0105
		const frameW = 0.0013
		const bevF = 0.00045
		const dz = d - 0.0003 // the side buttons sit in the 0.15 mm each side so nothing leaves the depth
		const frameCol = blend(tone, "#eceff3", 0.5)
		const alu = mat(`phone-alu|${frameCol}`, { color: frameCol, metalness: 1, roughness: 0.32, anisotropy: 0.35 })
		const group = kit.group()
		const frame = plate(rrect(w - 2 * bevF, dz - 2 * bevF, outerR - bevF), -h / 2, h / 2, {
			bevel: bevF, holes: [rrectHole(w - 2 * frameW + 2 * bevF, dz - 2 * frameW + 2 * bevF, outerR - frameW + bevF)],
		})
		group.add(kit.mesh(frame, [alu, alu]))
		const gW = w - 2 * frameW - 0.0002
		const gD = dz - 2 * frameW - 0.0002
		const gR = outerR - frameW - 0.0001
		const black = mat("phone-black", { color: "#050506", roughness: 0.3, metalness: 0 })
		// the screen: black glass, a faintly different display area, a pill for the camera at the top (left, -x) end
		const screenTex = colorTex("phone-screen", 1536, 731, (g, W, H) => {
			g.fillStyle = "#020203"
			g.fillRect(0, 0, W, H)
			const bez = (0.0034 / gW) * W
			const gr = g.createLinearGradient(0, 0, W, H)
			gr.addColorStop(0, "#07080c")
			gr.addColorStop(0.5, "#040507")
			gr.addColorStop(1, "#06070a")
			g.fillStyle = gr
			rr(g, bez, bez, W - 2 * bez, H - 2 * bez, (0.0072 / gW) * W)
			g.fill()
			// a faint diagonal glint, as a lit room mirrors in black glass
			const sg = g.createLinearGradient(0, H, W, 0)
			sg.addColorStop(0, "rgba(255,255,255,0)")
			sg.addColorStop(0.5, "rgba(255,255,255,0)")
			sg.addColorStop(0.58, "rgba(255,255,255,0.07)")
			sg.addColorStop(0.66, "rgba(255,255,255,0)")
			sg.addColorStop(1, "rgba(255,255,255,0.02)")
			g.fillStyle = sg
			rr(g, bez, bez, W - 2 * bez, H - 2 * bez, (0.0072 / gW) * W)
			g.fill()
			g.fillStyle = "#010101"
			const pw = (0.0036 / gD) * H
			rr(g, bez + 0.012 * W, H / 2 - (0.0058 / gD) * H, pw, (0.0116 / gD) * H, pw / 2)
			g.fill()
			g.fillStyle = "rgba(30,40,70,0.5)"
			g.beginPath(); g.arc(bez + 0.012 * W + pw / 2, H / 2 + (0.0026 / gD) * H, (0.0009 / gD) * H, 0, TAU); g.fill()
		})
		const screenMat = mat("phone-screen2", { map: withRepeat(screenTex, 1 / gW, 1 / gD, 0.5, 0.5), color: "#ffffff", roughness: 0.02, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.01, ior: 1.5, specularIntensity: 0.45 }) // black glass: it mirrors the room only faintly
		const glass = plate(rrect(gW - 0.0003, gD - 0.0003, gR - 0.00015), h / 2 - 0.0009, h / 2 - 0.00008, { bevel: 0.00015 })
		group.add(kit.mesh(glass, [screenMat, black]))
		// the back: frosted glass in the body colour, a camera plateau at the top corner
		const camX = -0.0505
		const camZ = -0.0178
		const backTex = colorTex(`phone-back|${tone}`, 1536, 731, (g, W, H) => {
			g.fillStyle = blend(tone, "#ffffff", 0.08)
			g.fillRect(0, 0, W, H)
			fibres(g, W, H, 3, { n: 6000, alpha: 0.05, len: 3 })
		})
		const backMat = mat(`phone-back|${tone}`, { map: withRepeat(backTex, 1 / gW, 1 / gD, 0.5, 0.5), roughness: 0.38, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.35 })
		const back = plate(rrect(gW - 0.0003, gD - 0.0003, gR - 0.00015), -h / 2 + 0.0005, -h / 2 + 0.0013, { bevel: 0.00015 })
		group.add(kit.mesh(back, [backMat, black]))
		const core = plate(rrect(gW - 0.0005, gD - 0.0005, gR - 0.0003), -h / 2 + 0.0009, h / 2 - 0.0008, { bevel: 0 })
		group.add(kit.mesh(core, [black, black]))
		// the camera plateau: a raised glass plate that reaches down to the frame's rim (never below the table), three lenses in aluminium rings
		const plateau = plate(rrect(0.037 - 0.0006, 0.037 - 0.0006, 0.0075, camX, -camZ), -h / 2 + 0.0001, -h / 2 + 0.0013, { bevel: 0.0003 })
		const plateauMat = mat(`phone-plateau|${tone}`, { color: blend(tone, "#000000", 0.45), roughness: 0.12, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.08 })
		group.add(kit.mesh(plateau, [plateauMat, plateauMat]))
		const lensTex = colorTex("phone-lens-tex", 128, 128, (g, W, H) => {
			g.fillStyle = "#000"
			g.fillRect(0, 0, W, H)
			const gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2)
			gr.addColorStop(0, "#06080f")
			gr.addColorStop(0.3, "#0a1226")
			gr.addColorStop(0.5, "#101c3d")
			gr.addColorStop(0.64, "#2a2f6a") // the coated element glints blue-violet
			gr.addColorStop(0.74, "#07080e")
			gr.addColorStop(0.9, "#14181f")
			gr.addColorStop(1, "#000")
			g.fillStyle = gr
			g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, TAU); g.fill()
			g.strokeStyle = "rgba(150,170,255,0.55)"
			g.lineWidth = 2
			g.beginPath(); g.arc(W / 2, H / 2, W * 0.36, 3.6, 4.7); g.stroke()
			g.fillStyle = "rgba(255,255,255,0.85)"
			g.beginPath(); g.ellipse(W * 0.38, H * 0.36, W * 0.07, H * 0.04, -0.7, 0, TAU); g.fill()
		})
		const lensGlass = mat("phone-lens", { map: lensTex, color: "#ffffff", roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 })
		const lensDisc = kit.geo("phone-lens-disc", () => new THREE.CircleGeometry(0.0047, 36)) // the three lenses share one geometry
		for (const [dx, dzz] of [[-0.0052, -0.0052], [-0.0052, 0.0052], [0.0052, 0]]) {
			const ring = kit.mesh(kit.torus(0.0053, 0.0006, 10, 28), alu)
			ring.rotation.x = Math.PI / 2
			ring.position.set(camX + dx, -h / 2 + 0.0006, camZ + dzz)
			group.add(ring)
			const disc = kit.mesh(lensDisc, lensGlass)
			disc.rotation.x = Math.PI / 2
			disc.rotation.z = Math.PI
			disc.position.set(camX + dx, -h / 2 + 0.00004, camZ + dzz)
			disc.castShadow = false
			group.add(disc)
		}
		// the flash, a small warm disc beside the lenses
		const flash = kit.mesh(new THREE.CircleGeometry(0.0021, 20), mat("phone-flash", { color: "#f3e6b8", roughness: 0.35 }))
		flash.rotation.x = Math.PI / 2
		flash.position.set(camX + 0.0105, -h / 2 + 0.00004, camZ + 0.0105)
		flash.castShadow = false
		group.add(flash)
		// side buttons (power on the front long side, volume on the back one) and the port and speaker holes at the +x end
		const btn = (len, x, z) => {
			const b = kit.mesh(kit.box(len, 0.0032, 0.0006, 0.0003, 2), alu)
			b.position.set(x, 0.0004, z)
			return b
		}
		group.add(btn(0.017, -0.018, d / 2 - 0.0003), btn(0.008, -0.026, -d / 2 + 0.0003), btn(0.0125, -0.0405, -d / 2 + 0.0003), btn(0.0125, -0.0555, -d / 2 + 0.0003))
		const holeMat = mat("phone-hole", { color: "#0a0b0d", roughness: 0.7 })
		const port = new THREE.Mesh(new THREE.ShapeGeometry(rrect(0.0084, 0.0026, 0.0013), 12), mat("phone-port", { color: "#08090b", roughness: 0.6 })) // the USB-C opening, a stadium
		port.rotation.y = Math.PI / 2
		port.position.set(w / 2 + 0.00005, 0, 0)
		group.add(port)
		const dots = [] // the 12 speaker holes are one merged geometry
		for (const s of [-1, 1]) for (let i = 0; i < 6; i++) dots.push(new THREE.CircleGeometry(0.00055, 8).rotateY(Math.PI / 2).translate(w / 2 + 0.00005, 0, s * (0.0095 + i * 0.0022)))
		const dotMesh = new THREE.Mesh(mergeGeos(dots, `phone-dots|${w.toFixed(4)}`), holeMat)
		dotMesh.receiveShadow = true
		group.add(dotMesh)
		return group
	})

	// ------------------------------------------------------------- closed laptop: bead-blasted aluminium lid and base, a dark seam, a hinge at the back, rubber feet
	addModel("laptop-closed", "body", ({ w, h, d }) => {
		const alu = "#d9dbde"
		const lidT = 0.0052
		const gap = 0.0005 // the seam between lid and base
		const feetH = 0.0009
		const lidY0 = h / 2 - lidT
		const baseY1 = lidY0 - gap
		const baseY0 = -h / 2 + feetH
		const inset = 0.0066 // the hinge recess at the back of the base
		const hingeHalf = 0.105
		const R = 0.0085
		const bLid = 0.0011 // lid edges rounded about 1.1 mm
		const bBase = 0.0015 // the base's lower edge rounded about 1.5 mm
		// the lid's finish: very fine isotropic bead-blast, not brushed
		const beadN = normalTex("laptop-bead", 512, 512, (g, W, H) => pixels(g, W, H, (x, y) => { const v = 128 + 70 * (fbm(x / 1.5, y / 1.5, 2, 61, 341) - 0.5) + 40 * (Math.random() - 0.5); return [v, v, v] }), { strength: 1.6 })
		const lidMat = mat(`laptop-alu2|${alu}`, { color: alu, metalness: 1, roughness: 0.38, normalMap: withRepeat(beadN, 1 / 0.05, 1 / 0.05, 0, 0), normalScale: new THREE.Vector2(0.18, 0.18) })
		const sideMat = mat(`laptop-edge2|${alu}`, { color: alu, metalness: 1, roughness: 0.3 })
		const dark = mat("laptop-dark2", { color: "#18191b", metalness: 0.2, roughness: 0.6 })
		const baseShape = (notch) => {
			const x0 = -w / 2 + bBase, x1 = w / 2 - bBase, y0 = -d / 2 + bBase, y1 = d / 2 - bBase // y_shape = -z: y0 is the front (+z), y1 the back
			const r = R - bBase
			const sh = new THREE.Shape()
			sh.moveTo(x0 + r, y0)
			if (notch) {
				sh.lineTo(-notch, y0)
				sh.absarc(0, y0, notch, Math.PI, 0, true)
			}
			sh.lineTo(x1 - r, y0)
			sh.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false)
			sh.lineTo(x1, y1 - r)
			sh.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false)
			sh.lineTo(hingeHalf, y1)
			sh.lineTo(hingeHalf, y1 - inset)
			sh.lineTo(-hingeHalf, y1 - inset)
			sh.lineTo(-hingeHalf, y1)
			sh.lineTo(x0 + r, y1)
			sh.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false)
			sh.lineTo(x0, y0 + r)
			sh.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false)
			return sh
		}
		const group = kit.group()
		// the lid: a full rounded slab (no cut-outs), edges rounded top and bottom
		group.add(kit.mesh(L.rrPlate(w, d, R, lidY0, h / 2, { bevel: bLid }), [lidMat, sideMat]))
		// the base, with the hinge recess cut into it and a finger notch at the front
		group.add(kit.mesh(plate(baseShape(0.0135), baseY0, baseY1, { bevel: bBase }), [sideMat, sideMat]))
		// the seam: a dark band 0.6 mm in from the edge, as tall as the gap
		const sIn = 0.0006 + bLid * 0.5
		const seam = plate(rrect(w - 2 * sIn, d - 2 * sIn - inset, R - sIn), baseY1 - 0.0002, lidY0 + 0.0002, { bevel: 0 })
		seam.translate(0, 0, inset / 2)
		group.add(kit.mesh(seam, [dark, dark]))
		// the hinge barrel, seen in the recess under the lid's back edge
		const hinge = kit.mesh(kit.cylinderY(inset / 2, 2 * hingeHalf, 28).clone().rotateZ(Math.PI / 2), dark)
		hinge.position.set(0, (lidY0 + baseY1) / 2 - 0.0004, -d / 2 + inset / 2)
		group.add(hinge)
		for (const sx of [-1, 1]) { // the two end caps of the hinge, bright metal
			const cap = kit.mesh(kit.cylinderY(inset / 2 + 0.0002, 0.0012, 24).clone().rotateZ(Math.PI / 2), sideMat)
			cap.position.set(sx * (hingeHalf + 0.0006), (lidY0 + baseY1) / 2 - 0.0004, -d / 2 + inset / 2)
			group.add(cap)
		}
		// a plain polished emblem on the lid (a neutral stand-in: a disc in a thin ring)
		const emblem = kit.mesh(kit.cylinderY(0.0105, 0.00018, 48), mat("laptop-emblem", { color: "#f6f7f9", metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1 }))
		emblem.position.set(0, h / 2 + 0.00006, d * 0.06)
		group.add(emblem)
		// rubber feet
		const foot = kit.cylinderY(0.0062, feetH, 24)
		const footMat = kit.rubber("#1b1b1e")
		for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
			const f = kit.mesh(foot, footMat)
			f.position.set(sx * (w / 2 - 0.034), -h / 2 + feetH / 2, sz * (d / 2 - 0.026))
			group.add(f)
		}
		return group
	})

	// ------------------------------------------------------------- TV remote: black plastic body, rubber buttons, a printed key legend
	addModel("tv-remote", "body", ({ w, h, d, color }) => {
		const bodyCol = blend(color || "#6b7280", "#08090b", 0.86)
		const plastic = mat(`remote-body|${bodyCol}`, { color: bodyCol, roughness: 0.42, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.35 })
		const rubber = mat("remote-rubber", { color: "#2a2d33", roughness: 0.72, metalness: 0 })
		const hy = (h - 0.0008) / 2
		const hz = d / 2
		const cy = -0.0004
		const topY = cy + hy
		// the body: a bar with a crowned top and softer back, rounded at both ends
		const section = (inset) => {
			const yy = hy - inset, zz = hz - inset
			const rt = Math.max(0.0005, 0.0075 - inset * 0.5), rb = Math.max(0.0005, 0.0045 - inset * 0.5)
			const pts = []
			const corner = (cyy, czz, r, a0) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); pts.push([cy + cyy + r * Math.sin(a), czz + r * Math.cos(a)]) } }
			corner(yy - rt, zz - rt, rt, 0)
			corner(yy - rt, -(zz - rt), rt, Math.PI / 2)
			corner(-(yy - rb), -(zz - rb), rb, Math.PI)
			corner(-(yy - rb), zz - rb, rb, Math.PI * 1.5)
			return pts
		}
		const rings = [
			{ x: -w / 2, pts: section(0.0010) }, { x: -w / 2 + 0.0007, pts: section(0.0004) }, { x: -w / 2 + 0.0016, pts: section(0) },
			{ x: w / 2 - 0.0016, pts: section(0) }, { x: w / 2 - 0.0007, pts: section(0.0004) }, { x: w / 2, pts: section(0.0010) },
		]
		const group = kit.group(kit.mesh(loftX(rings), [plastic, plastic]))
		// the infrared window at the -x end
		const ir = kit.mesh(kit.box(0.0016, 0.0075, 0.021, 0.0006, 2), mat("remote-ir", { color: "#2b0509", roughness: 0.16, metalness: 0, clearcoat: 1 }))
		ir.position.set(-w / 2 + 0.0006, cy, 0)
		group.add(ir)
		// keys: [x from the -x end (mm), z (mm, + toward the front), size along x, size along z]
		const mm = 0.001
		const ZS = -1 // keys are listed as seen from the holder (IR end pointing away): his left is +z, so every z is mirrored once, here
		const X = (xm) => -w / 2 + xm * mm
		const keys = []
		const rect = (xm, zm, lx, lz, rad = 0.0006) => keys.push(kit.box(lx * mm, 0.0012, lz * mm, rad, 2).clone().translate(X(xm), topY + 0.0002, ZS * zm * mm))
		const roundKey = (xm, zm, rd, hgt = 0.0012) => keys.push(kit.cylinderY(rd * mm, hgt, 24).clone().translate(X(xm), topY + hgt / 2 - 0.0004, ZS * zm * mm))
		for (const zr of [-1, 0, 1]) for (let row = 0; row < 4; row++) rect(122 + row * 10.5, zr * 11, 8.6, 8.8, 0.0014) // number pad
		rect(76, -11, 7.5, 5.2, 0.0016); rect(76, 0, 7.5, 5.2, 0.0016); rect(76, 11, 7.5, 5.2, 0.0016) // back, home, menu
		for (const dx of [-5.2, 5.2]) { rect(98 + dx, -10.5, 8.8, 9, 0.0012); rect(98 + dx, 10.5, 8.8, 9, 0.0012) } // volume and channel rockers
		roundKey(98, 0, 3.2)
		const ring = new THREE.LatheGeometry([[6.4, 0], [6.4, 0.9], [7.2, 1.2], [13.2, 1.2], [14.2, 0.9], [14.2, 0]].map(([r, y]) => new THREE.Vector2(r * mm, (y - 0.4) * mm)), 40)
		keys.push(ring.translate(X(46), topY, 0))
		const keyGeo = mergeGeos(keys, `remote-keys|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}`)
		group.add(kit.mesh(keyGeo, rubber))
		// OK button, power, input, and colour keys
		const ok = kit.mesh(kit.cylinderY(5.6 * mm, 0.0013, 28), mat("remote-ok", { color: "#3a3e46", roughness: 0.6 }))
		ok.position.set(X(46), topY + 0.00005, 0) // its top at topY + 0.7 mm, under the legend (so the OK shows)
		group.add(ok)
		const power = kit.mesh(kit.cylinderY(5.2 * mm, 0.0012, 28), mat("remote-power", { color: "#b3261e", roughness: 0.5, clearcoat: 0.3 }))
		power.position.set(X(19), topY + 0.0002, ZS * -12 * mm)
		group.add(power)
		const src = kit.mesh(kit.cylinderY(4 * mm, 0.0012, 24), rubber)
		src.position.set(X(19), topY + 0.0002, ZS * 12 * mm)
		group.add(src)
		const colors = ["#c62828", "#2e9d3f", "#e2b91b", "#2763c9"]
		colors.forEach((c, i) => {
			const k = kit.mesh(kit.box(5 * mm, 0.0011, 3.2 * mm, 0.0005, 2), mat(`remote-c|${c}`, { color: c, roughness: 0.55 }))
			k.position.set(X(165), topY + 0.00015, ZS * (i - 1.5) * 8 * mm)
			group.add(k)
		})
		// the printed legends, upright for someone reading with the IR end to the left: one on the key tops, one on the body between the keys
		const LW = 2048
		const LH = Math.round((LW * d) / w)
		const drawLegend = (g, W, H, onBody) => {
			g.clearRect(0, 0, W, H)
			const pxm = W / (w / mm) // px per mm
			rotPortrait(g, W, H, (g2) => {
				// portrait: x = d/2 - z (mm), y = distance from the IR end
				const P = (xm, zm) => [((d / 2) / mm - ZS * zm) * pxm, xm * pxm]
				g2.fillStyle = "#e9e9ec"
				g2.textAlign = "center"
				g2.textBaseline = "middle"
				const digit = (s0, xm, zm, size = 4.6) => { g2.font = `700 ${size * pxm}px ${SANS}`; const [px, py] = P(xm, zm); g2.fillText(s0, px, py) }
				if (onBody) {
					digit("VOL", 84.2, -10.5, 2.3); digit("CH", 84.2, 10.5, 2.3)
					return
				}
				const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
				let i = 0
				for (let row = 0; row < 4; row++) for (const zr of [-1, 0, 1]) digit(digits[i++], 122 + row * 10.5, zr * 11)
				// power symbol
				const [ppx, ppy] = P(19, -12)
				g2.strokeStyle = "#fff"; g2.lineWidth = 0.7 * pxm
				g2.beginPath(); g2.arc(ppx, ppy, 2.4 * pxm, -Math.PI / 2 + 0.6, -Math.PI / 2 - 0.6 + TAU, false); g2.stroke()
				g2.beginPath(); g2.moveTo(ppx, ppy - 3.2 * pxm); g2.lineTo(ppx, ppy - 0.4 * pxm); g2.stroke()
				digit("\u2192]", 19, 12, 3.2)
				digit("+", 92.8, -10.5, 5.6); digit("\u2212", 103.2, -10.5, 5.6); digit("+", 92.8, 10.5, 5.6); digit("\u2212", 103.2, 10.5, 5.6)
				digit("\u25C0", 76, -11, 3); digit("\u2302", 76, 0, 3.4); digit("\u2261", 76, 11, 3.4)
				digit("OK", 46, 0, 3.6)
				for (const [dxm, dzm, s0] of [[-10, 0, "\u25B2"], [10, 0, "\u25BC"], [0, -10, "\u25C0"], [0, 10, "\u25B6"]]) digit(s0, 46 + dxm, dzm, 3.2)
				digit("\u266A", 98, 0, 3)
			})
		}
		const legKeys = colorTex("remote-legend-keys", LW, LH, (g, W, H) => drawLegend(g, W, H, false))
		const legBody = colorTex("remote-legend-body", LW, LH, (g, W, H) => drawLegend(g, W, H, true))
		const legOf = (key, map) => mat(key, { map, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
		group.add(L.decal("+y", w, d, legOf("remote-legend-keys", legKeys), h / 2 + 0.00002))
		group.add(L.decal("+y", w, d, legOf("remote-legend-body", legBody), topY + 0.00002)) // printed on the plastic itself
		return group
	})
}
