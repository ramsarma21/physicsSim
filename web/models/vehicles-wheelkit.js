// Wheel parts shared by the vehicle models: rubber tyres with tread, alloy and steel rims, spoked wooden wheels.
// A wheel is built about the z axis with its outer face toward +z (a pair is the same wheel turned half a turn about y for the far side).
export function makeWheelKit(L, kit) {
	const T = L.THREE
	const { TAU, mix, fbm, rng, normalMap, mat, revolveZ, roundedProfile, roundPoly, put } = L
	const dedupe = (pts) => pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6)

	/**
	 * A rubber tyre: a rounded-rectangle section from the rim radius out to R, width w, shoulders rounded by c.
	 * tread: "road" (angled blocks and a centre groove), "lug" (big chevron lugs), "slick" (a few fine grooves), "none".
	 * -> {geo, mat}
	 */
	function tyre({ R, rimR, w, c = 0.4 * (R - rimR), blocks = 26, tread = "road", color = "#17181a", rough = 0.86, normalScale = 1.1, segments = 64, key = "" }) {
		const prof = roundedProfile([[rimR, -w / 2], [R, -w / 2, c], [R, w / 2, c], [rimR, w / 2]], 3)
		const L1 = R - c - rimR
		const arcLen = (Math.PI / 2) * c
		const total = 2 * (L1 + arcLen) + (w - 2 * c)
		const v0 = (L1 + arcLen) / total
		const v1 = v0 + (w - 2 * c) / total
		const nk = `tread|${tread}|${blocks}|${v0.toFixed(3)}`
		const N = normalMap(nk, 512, 128, (x, y) => {
			const u = x / 512
			const v = y / 128
			let h = 0.55 + 0.1 * (fbm(x / 2.5, y / 2.5, 2, 4, 0) - 0.5)
			const inTread = v > v0 - 0.005 && v < v1 + 0.005
			if (tread === "road" && inTread) {
				const ph = (((u * blocks + (v - 0.5) * 1.1) % 1) + 1) % 1
				if (ph < 0.2) h -= 0.38
				if (Math.abs(v - 0.5) < 0.015) h -= 0.3
				if (Math.abs(v - 0.5) > 0.3) h -= 0.12 * Math.sin(u * blocks * TAU)
			} else if (tread === "lug" && inTread) {
				// chevrons: lugs slanting from the centre to each shoulder, gaps between
				const t = (v - 0.5) * 2 // -1..1 across the tread
				const ph = (((u * blocks + Math.abs(t) * 0.55) % 1) + 1) % 1
				if (ph < 0.34) h -= 0.5
				if (Math.abs(t) < 0.05) h -= 0.12
				if (Math.abs(t) > 0.93) h += 0.1
			} else if (tread === "slick" && inTread) {
				const t = (v - v0) / (v1 - v0)
				if (Math.abs(((t * 5) % 1) - 0.5) > 0.46) h -= 0.2
			}
			if (tread !== "none" && (Math.abs(v - 0.1) < 0.008 || Math.abs(v - 0.9) < 0.008)) h += 0.12 // a bead line on each sidewall
			return h
		}, { strength: 2.2 })
		return {
			geo: revolveZ(prof, { segments, key: `tyre|${key}|${R.toFixed(5)}|${rimR.toFixed(5)}|${w.toFixed(5)}|${c.toFixed(5)}`, creaseDeg: 60 }),
			mat: mat(`tyre|${nk}|${color}|${rough}|${normalScale}`, { color, roughness: rough, metalness: 0, normalMap: N, normalScale: new T.Vector2(normalScale, normalScale) }),
		}
	}

	/** A flat disc of spokes with `n` windows between them (alloy-wheel style): outer radius Ro, hub r0, window outer r1; spoke half-widths hw0 (hub) hw1 (rim). */
	function starPlate({ Ro, r0, r1, n, hw0, hw1, depth, bevel = 0, round = 0.0016, stepDeg = 45, dev = 0.0004, key = "" }) {
		return kit.geo(`veh|star|${key}|${stepDeg}|${dev}|${Ro.toFixed(5)}|${r0.toFixed(5)}|${r1.toFixed(5)}|${n}|${hw0.toFixed(5)}|${hw1.toFixed(5)}|${depth.toFixed(5)}`, () => {
			const sh = new T.Shape()
			sh.absarc(0, 0, Ro, 0, TAU, false)
			const a = (r, hw) => Math.asin(Math.min(0.99, hw / r))
			for (let k = 0; k < n; k++) {
				const th = ((k + 0.5) / n) * TAU
				const lo = th - TAU / n / 2
				const hi = th + TAU / n / 2
				// the window: two straight radial sides and two arcs (one mid point each: the sag is a tenth of a millimetre). Few, long sides, so its four corners can take a real radius
				const gap = []
				for (const i of [0, 1]) {
					const r = i ? r1 : r0
					const t = lo + a(r, i ? hw1 : hw0)
					gap.push([r * Math.cos(t), r * Math.sin(t)])
				}
				{
					const t = mix(lo + a(r1, hw1), hi - a(r1, hw1), 0.5)
					gap.push([r1 * Math.cos(t), r1 * Math.sin(t)])
				}
				for (const i of [1, 0]) {
					const r = i ? r1 : r0
					const t = hi - a(r, i ? hw1 : hw0)
					gap.push([r * Math.cos(t), r * Math.sin(t)])
				}
				{
					const t = mix(hi - a(r0, hw0), lo + a(r0, hw0), 0.5)
					gap.push([r0 * Math.cos(t), r0 * Math.sin(t)])
				}
				const hole = roundPoly(dedupe(gap), { dev, maxR: round, stepDeg })
				sh.holes.push(new T.Path(hole.map(([x, y]) => new T.Vector2(x, y))))
			}
			const g = new T.ExtrudeGeometry(sh, { depth: Math.max(1e-5, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 6 })
			g.translate(0, 0, -(depth - 2 * bevel) / 2)
			return g
		})
	}

	return { tyre, starPlate, dedupe }
}
