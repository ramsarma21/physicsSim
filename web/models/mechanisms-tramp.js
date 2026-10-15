// Trampoline: two steel end-frames (a tube frame of the mat's depth: two uprights, a top rail with a spring hook for every spring, a foot tube in rubber boots)
// standing on an open floor, and a thin black woven jumping mat with a stitched webbing hem and a steel V-ring at every spring (every mat texture is size-free: see "the jumping mat").
// (The springs between the mat and the frames are drawn by the view, one per row: the joints carry render.rows.)
export default function register({ addModel, kit, THREE, L, P }) {
	const T = THREE
	const { f5, put } = L
	const { mesh, group, HALF, sideOf, screwOn } = P

	/** How many springs run across the depth (the catalog's render.rows): a real mat is held by one every 5-8 cm along each end, at most 12 are drawn (a 2 m mat has one every 17 cm). */
	const rowsOf = (d) => Math.max(2, Math.min(12, Math.round(d / 0.06)))
	/** The detail of the small hooks and V-rings (one per row on each side, so a wide mat has dozens): [wire segments, ring segments], coarser as the rows multiply (up to 192 triangles each at 10 rows, 64 past 24). */
	const ringDetail = (n) => (n <= 12 ? [6, 16] : n <= 24 ? [5, 10] : [4, 8])
	/** The z of spring k's row: the rows split the depth evenly, a spring in the middle of each share. */
	const rowZ = (k, n, d) => -d / 2 + ((k + 0.5) * d) / n

	// ------------------------------------------------------------- the end frame: the leg's outline is its 40 mm tube, the full height and depth
	const tramLeg = (ctx) => {
		const { w, h, d } = ctx
		const sx = sideOf(ctx) // -1: the left frame (the mat is on its +x side), +1: the right
		const R = w / 2 // the tube's radius: the upright fills the outline's width
		const steel = L.steel("#c9ced3")
		const rubber = L.rubberMat("#17181b")
		const zc = d / 2 - R // the uprights' z (the corner centres)
		const out = []
		const tubeZ = (len) => kit.cylinderZ(R, len, 40)
		const tubeY = (len) => kit.cylinderY(R, len, 40)
		// the top rail (its top is the outline's top), the foot tube on the floor, the two uprights between them
		const yTop = h / 2 - R
		const yFoot = -h / 2 + R
		if (d < 4 * R + 0.02) {
			// a frame under ~10 cm deep: its two uprights would stand less than 2 cm apart and merge into one fat pill, so it is drawn as one upright in the middle under the top
			// rail, standing on a flat steel foot plate across the depth (the outline's width, 5 mm thick, edges eased) on a 2 mm rubber sole, welded on with a collar.
			// (A tube across the depth with rubber ends read as a caster wheel under the post.)
			out.push(put(mesh(tubeZ(d), steel), 0, yTop, 0))
			const sole = 0.002
			const plate = 0.005
			const yPlate = -h / 2 + sole + plate // the plate's top
			out.push(put(mesh(L.rbox(w - 0.0006, sole, d - 0.0006, 0.0008, { seg: 2 }), rubber), 0, -h / 2 + sole / 2, 0))
			out.push(put(mesh(L.rbox(w, plate, d, 0.0015, { seg: 2 }), steel), 0, -h / 2 + sole + plate / 2, 0))
			out.push(put(mesh(tubeY(yTop - yPlate), steel), 0, (yTop + yPlate) / 2, 0))
			out.push(put(mesh(kit.cylinderY(R + 0.0015, 0.004, 40), steel), 0, yPlate + 0.002, 0)) // the weld collar
			if (d / 2 - 0.006 >= R + 0.0045) for (const sz of [-1, 1]) out.push(screwOn(0, yPlate, sz * (d / 2 - 0.006), 0.0024, "+y", sz)) // where the plate shows past the tube
		} else {
			out.push(put(mesh(tubeZ(2 * zc), steel), 0, yTop, 0))
			out.push(put(mesh(tubeZ(2 * zc), steel), 0, yFoot, 0))
			for (const sz of [-1, 1]) {
				out.push(put(mesh(tubeY(yTop - yFoot), steel), 0, (yTop + yFoot) / 2, sz * zc))
				out.push(put(mesh(kit.sphere(R, 20, 12), steel), 0, yTop, sz * zc)) // the rounded top corners
				// the rubber boot over each bottom corner: a sleeve up the upright and a round foot
				out.push(put(mesh(kit.cylinderY(R + 0.0003, 0.05, 32), rubber), 0, yFoot + 0.025 + 0.0003, sz * zc))
				out.push(put(mesh(kit.sphere(R + 0.0003, 20, 12), rubber), 0, yFoot + 0.0003, sz * zc))
			}
		}
		// the hooks the springs go on: a welded eye on the inner face of the top rail at every row
		const n = rowsOf(d)
		const [hr, ht] = ringDetail(n)
		const hook = mesh(kit.torus(0.0031, 0.0011, hr, ht), L.steel("#aab0b6"))
		const lug = mesh(L.rbox(0.0034, 0.0042, 0.003, 0.0006, { seg: 1 }), L.steel("#aab0b6"))
		for (let k = 0; k < n; k++) {
			const z = rowZ(k, n, d)
			const hk = hook.clone()
			hk.position.set(-sx * (R + 0.0008), yTop, z)
			out.push(hk)
			const lg = lug.clone()
			lg.position.set(-sx * (R - 0.0006), yTop, z)
			out.push(lg)
		}
		return group(out)
	}
	addModel("trampoline", "leg1", tramLeg)
	addModel("trampoline", "leg2", tramLeg)

	// ------------------------------------------------------------- the jumping mat
	// Every texture here is SIZE-FREE (no key holds the mat's width or depth, so dragging the width / depth sliders bakes nothing new): a tileable fabric tile
	// and a tileable weave bump on the top face at true scale (uv in 60 mm tiles), the webbing hem as four mitred strips (one tileable 60 x 30 mm webbing +
	// stitching texture, uv in metres along each strip), and the centre ring as one small decal.
	const TILE = 0.06 // the fabric tile's size, m (the uv unit of the top face and of the hem's run)
	const HEM = 0.03 // the webbing hem's width on a full-size mat, m (the hem texture's across-direction)
	/** The woven polypropylene: near black, the tape lines (1.5 mm wide, running front to back) just showing, a little slub in the tape. 256 px over 60 mm; tiles. */
	const fabricTile = () => kit.tex("tramFabric", 256, 256, (g, W, H) => {
		const img = g.createImageData(W, H)
		const D = img.data
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const tape = Math.floor((x / W) * 40) % 2 // 40 tape lines in 60 mm: 1.5 mm each
				const slub = L.vnoise((x / W) * 40, (y / H) * 7, 5, 40, 7) - 0.5 // short thick-and-thin streaks along the tape
				const k = (tape ? 0.075 : 0.052) + 0.016 * slub
				const o = (y * W + x) * 4
				D[o] = D[o + 1] = 255 * k * 1.02
				D[o + 2] = 255 * k * 1.08
				D[o + 3] = 255
			}
		g.putImageData(img, 0, 0)
	}, {})
	/** The weave: a plain-weave bump, 4 px a thread, one tile = 6 mm (the texture's own repeat is 10 over the 60 mm uv tile). */
	const weaveNormal = () => L.normalTex("tramWeave", 64, 64, (x, y) => {
		const over = ((x >> 2) + (y >> 2)) & 1
		return over ? 0.5 + 0.5 * Math.sin((Math.PI * ((x % 4) + 0.5)) / 4) : 0.5 + 0.5 * Math.sin((Math.PI * ((y % 4) + 0.5)) / 4)
	}, { strength: 1.5, repeat: [TILE / 0.006, TILE / 0.006] })
	/** The webbing hem: a folded band ribbed across (every 2 mm), its inner edge, a zig-zag stitch line 6.5 mm in (16 stitches in the 60 mm run) and a dashed
	 *  one 23.5 mm in. u runs along the strip (60 mm), v across (the outer edge at the top, v = 1; 30 mm). */
	const hemMat = () => {
		const map = kit.tex("tramHem", 512, 256, (g, W, H) => {
			const px = W / TILE // px per metre (8533): the same across, 256 px over 30 mm
			g.fillStyle = "#17181c"
			g.fillRect(0, 0, W, H)
			for (let t = 0; t < W; t += 0.002 * px) { // the ribs: a pale ridge with a shadow beside it, 30 to a tile
				g.fillStyle = "rgba(255,255,255,0.05)"
				g.fillRect(t, 0, 0.0007 * px, H)
				g.fillStyle = "rgba(0,0,0,0.28)"
				g.fillRect(t + 0.0011 * px, 0, 0.0005 * px, H)
			}
			g.strokeStyle = "#050506" // the hem's inner edge, where it is sewn to the fabric
			g.lineWidth = 0.0005 * px
			g.beginPath(); g.moveTo(0, H - 0.0003 * px); g.lineTo(W, H - 0.0003 * px); g.stroke()
			g.strokeStyle = "#8d8f96"
			g.lineWidth = 0.00065 * px
			g.lineJoin = "round"
			g.beginPath()
			const pitch = W / 16
			for (let i = -1; i <= 17; i++) {
				const x = i * pitch, y = 0.0065 * px + (i % 2 ? 1 : -1) * 0.0016 * px
				i === -1 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
			g.stroke()
			g.strokeStyle = "#7c7e85"
			g.lineWidth = 0.0006 * px
			g.setLineDash([0.011 * px, 0.004 * px])
			g.beginPath(); g.moveTo(0, 0.0235 * px); g.lineTo(W, 0.0235 * px); g.stroke()
			g.setLineDash([])
		}, {})
		return L.MAT("tramHem", { map, roughness: 0.82, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new T.Color("#3a3c44"), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
	}
	/** The hem on the top face: four strips mitred at the corners (they join into one frame, the stitching turning each corner), `hem` wide, from `inset` in from the
	 *  mat's edge, lying 0.2 mm above the top face at height y. uv = (distance along the strip / 60 mm, 1 - the distance in from its outer edge / 30 mm), exact on any triangulation. */
	const hemGeo = (w, d, hem, inset, y) =>
		kit.geo(`tramHemRing|${f5(w)}|${f5(d)}|${f5(hem)}|${f5(inset)}|${f5(y)}`, () => {
			const hx = w / 2 - inset, hz = d / 2 - inset
			const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] // round the top face, each side runs from one corner to the next
			const P = [], U = []
			for (let k = 0; k < 4; k++) {
				const A = corners[k], B = corners[(k + 1) % 4]
				const len = Math.hypot(B[0] - A[0], B[1] - A[1])
				const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]
				const n = [-dir[1], dir[0]] // the way in (the loop runs the way that makes this inward)
				const sgn = n[0] * -A[0] + n[1] * -A[1] > 0 ? 1 : -1
				const ni = [n[0] * sgn, n[1] * sgn]
				const pt = (s, t) => [A[0] + dir[0] * s + ni[0] * t, A[1] + dir[1] * s + ni[1] * t] // s along the side, t in from its outer edge
				const quad = [pt(0, 0), pt(len, 0), pt(len - hem, hem), pt(hem, hem)]
				const st = [[0, 0], [len, 0], [len - hem, hem], [hem, hem]]
				for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
					let idx = [i0, i1, i2]
					const a = quad[idx[0]], b = quad[idx[1]], c = quad[idx[2]]
					if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) idx = [i0, i2, i1] // wind so the face points up (+y)
					for (const i of idx) { P.push(quad[i][0], y, quad[i][1]); U.push(st[i][0] / TILE, 1 - st[i][1] / HEM) }
				}
			}
			const g = new T.BufferGeometry()
			g.setAttribute("position", new T.BufferAttribute(new Float32Array(P), 3))
			g.setAttribute("normal", new T.BufferAttribute(Float32Array.from({ length: P.length }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3))
			g.setAttribute("uv", new T.BufferAttribute(new Float32Array(U), 2))
			return g
		})
	/** The jump-circle mark: a thin ring and a small cross, stitched in grey, on one fixed 256 px tile (the ring's radius is 100 px of its 128). */
	const centreMat = () => L.decalMat("tramCentre", 256, 256, (g, W, H) => {
		g.clearRect(0, 0, W, H)
		g.strokeStyle = "rgba(190,192,198,0.5)"
		g.lineWidth = 3
		g.beginPath()
		g.arc(W / 2, H / 2, 100, 0, Math.PI * 2)
		g.stroke()
		g.beginPath()
		g.moveTo(W / 2 - 33, H / 2); g.lineTo(W / 2 + 33, H / 2); g.moveTo(W / 2, H / 2 - 33); g.lineTo(W / 2, H / 2 + 33)
		g.stroke()
	})
	addModel("trampoline", "mat", (ctx) => {
		const { w, h, d } = ctx
		const bev = Math.min(0.0045, h * 0.45)
		const hem = Math.min(HEM, 0.3 * Math.min(w, d)) // a full 30 mm hem, less on a very small mat
		const topMat = L.MAT("tramTop", { map: fabricTile(), normalMap: weaveNormal(), normalScale: new T.Vector2(0.5, 0.5), roughness: 0.78, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new T.Color("#3a3c44") })
		const edge = L.MAT("tramEdge", { color: "#121316", roughness: 0.9, metalness: 0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new T.Color("#30323a") })
		const body = mesh(L.rbox(w, h, d, bev, { grain: 0, tu: TILE, tv: TILE, te: TILE, seed: 3 }), [edge, edge, topMat, edge, edge, edge])
		const out = [body]
		out.push(mesh(hemGeo(w, d, hem - bev, bev, h / 2 + 0.0002), hemMat(), { cast: false }))
		const R = 0.1 * Math.min(w, d)
		if (R > 0.003) {
			const S = R * 1.28
			out.push(put(mesh(kit.geo(`tramCentre|${f5(S)}`, () => new T.PlaneGeometry(2 * S, 2 * S).rotateX(-HALF)), centreMat(), { cast: false }), 0, h / 2 + 0.0003, 0))
		}
		// a steel V-ring through the webbing at each spring (the springs hook into them), a zinc reinforcing plate over each
		const n = rowsOf(d)
		const [rr, rt] = ringDetail(n)
		const ring = mesh(kit.torus(0.0024, 0.0009, rr, rt), L.steel("#aab0b6"))
		const plate = mesh(L.rbox(0.006, 0.0014, 0.012, 0.0004, { seg: 1 }), L.zinc())
		for (const sx of [-1, 1])
			for (let k = 0; k < n; k++) {
				const z = rowZ(k, n, d)
				const r = ring.clone()
				r.position.set(sx * (w / 2 - 0.0016), 0, z)
				out.push(r)
				const pl = plate.clone()
				pl.position.set(sx * (w / 2 - 0.009), h / 2 + 0.0002, z)
				out.push(pl)
			}
		return group(out)
	})
}
