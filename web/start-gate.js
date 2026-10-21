// A starting gate for a held item: what web/view3d.js draws instead of the wooden pull pin when the document names the item in doc.view.gates
// (machines/mod_staging.py: the item's start_gate prop). A boom barrier: a red-and-white arm on a pivot at the top of a wooden post, reaching back
// along the item's way to a white stop (a dowel across the track) that touches the item's front, its downhill side, at about its middle height.
// The post stands just behind the item's own path, on whatever is under it there (the ramp's plank, a carpet strip, the table), so the stop only
// spans the item's width. At the release the arm swings up about the pivot (LIFT_DEG in LIFT_S, easing out): its first frame after the release
// has lifted the stop a few centimetres while the item has moved a fraction of a millimetre, so nothing is ever seen to push or pass through it.
// Render only: the engine holds the item exactly still until the release (doc.release.parts) and lets it go from rest; the gate shows what holds it.
//   const gate = makeGate({ list, addMesh, steel })     list: the item's held solids (doc solids)
//   gate.layout(pf, track, tRelease, statics)           -> {P (pivot), S (stop), foot, zPost, ...} or null (no way down to block: draw the pin)
//   gate.place(L)                                       the arm, stop and bolt for that layout
//   gate.at(t, tRelease)                                the swing at the run's time t
import * as THREE from "three"

export const LIFT_DEG = 75
export const LIFT_S = 0.25
export const POST_R = 0.012 // view3d.js's post (a 24 mm dowel): the arm's pivot is on its front face

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** The outline of a solid at pose q ({x, y, angle}) in the machine plane, appended to out as x, y pairs. */
function outline(s, q, out) {
	const c = Math.cos(q.angle ?? 0)
	const sn = Math.sin(q.angle ?? 0)
	const add = (lx, ly) => out.push(q.x + lx * c - ly * sn, q.y + lx * sn + ly * c)
	const b = s.body
	if (b.kind === "ball") for (let k = 0; k < 48; k++) add(b.radius * Math.cos((k / 48) * 2 * Math.PI), b.radius * Math.sin((k / 48) * 2 * Math.PI))
	else if (b.kind === "polygon") for (const p of b.points) add(p.x, p.y)
	else if (b.kind === "slab") {
		const w = b.width / 2
		const h = b.height / 2
		add(-w, -h)
		add(w, -h)
		add(w, h)
		add(-w, h)
	}
}
const depthOfSolid = (s) => (s.body.kind === "ball" ? (s.depth3d ?? 2 * s.body.radius) : (s.body.depth ?? 0.1))

/** Which way the item goes once let go: a unit vector. From the run (its parts' mean position, the first time it is 3 mm from where it stood,
 *  within 0.6 s of the release), else the slope of the static surface right under it (a layout has no motion yet), else null. */
export function gateDirection(list, pf, track, tRelease, statics) {
	let x0 = 0
	let y0 = 0
	for (const o of list) {
		const q = pf(o)
		x0 += q.x / list.length
		y0 += q.y / list.length
	}
	const fr = track?.frames ?? []
	if (fr.length > 1) {
		for (const f of fr) {
			if (f.t < tRelease) continue
			if (f.t > tRelease + 0.6) break
			let x = 0
			let y = 0
			let n = 0
			for (const o of list) {
				const q = f.placements[o.id]
				if (!q) continue
				x += q.x
				y += q.y
				n++
			}
			if (n < list.length) continue
			const dx = x / n - x0
			const dy = y / n - y0
			const d = Math.hypot(dx, dy)
			if (d >= 0.003) return { x: dx / d, y: dy / d }
		}
	}
	// the surface it rests on: the highest static edge under its lowest point (within 1 cm), sloping (the way down)
	const pts = []
	for (const o of list) outline(o, pf(o), pts)
	let lx = 0
	let ly = Infinity
	for (let i = 0; i < pts.length; i += 2)
		if (pts[i + 1] < ly) {
			ly = pts[i + 1]
			lx = pts[i]
		}
	let best = null
	for (const s of statics ?? []) {
		const e = []
		outline(s, pf(s), e)
		const n = e.length / 2
		if (n < 3) continue
		for (let k = 0; k < n; k++) {
			const ax = e[2 * k]
			const ay = e[2 * k + 1]
			const bx = e[(2 * k + 2) % e.length]
			const by = e[(2 * k + 3) % e.length]
			if (Math.abs(bx - ax) < 1e-6 || lx < Math.min(ax, bx) || lx > Math.max(ax, bx)) continue
			const y = ay + ((lx - ax) / (bx - ax)) * (by - ay)
			if (y > ly + 0.01 || y < ly - 0.01 || (best && y <= best.y)) continue
			best = { y, dx: bx - ax, dy: by - ay }
		}
	}
	if (!best) return null
	const d = Math.hypot(best.dx, best.dy)
	let u = { x: best.dx / d, y: best.dy / d }
	if (u.y > 0) u = { x: -u.x, y: -u.y }
	return u.y < -0.01 ? u : null
}

/** The top of whatever static thing is under the point (x, z) and below y (its top edge there, the highest), and its slope; the table's (0) if none. */
function footAt(statics, pf, x, z, y) {
	let best = null
	for (const s of statics) {
		if (Math.abs(z) > depthOfSolid(s) / 2) continue
		const e = []
		outline(s, pf(s), e)
		const n = e.length / 2
		if (n < 3) continue
		for (let k = 0; k < n; k++) {
			const ax = e[2 * k]
			const ay = e[2 * k + 1]
			const bx = e[(2 * k + 2) % e.length]
			const by = e[(2 * k + 3) % e.length]
			if (Math.abs(bx - ax) < 1e-6 || x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue
			const yy = ay + ((x - ax) / (bx - ax)) * (by - ay)
			if (yy > y || (best && yy <= best.y)) continue
			best = { y: yy, slope: (by - ay) / (bx - ax) }
		}
	}
	return best ?? { y: 0, slope: 0 }
}

let paints = null
function gatePaints() {
	if (paints) return paints
	// the arm: white with red bands (a boom barrier), so it reads as a gate from across the room and is never taken for a leg of the ramp
	const W = 256
	const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, 8) : Object.assign(document.createElement("canvas"), { width: W, height: 8 })
	const g = cv.getContext("2d")
	for (let k = 0; k < 8; k++) {
		g.fillStyle = k % 2 ? "#e9e6df" : "#b3262b"
		g.fillRect((k * W) / 8, 0, W / 8, 8)
	}
	const tex = new THREE.CanvasTexture(cv)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.anisotropy = 4
	paints = {
		arm: new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
		stop: new THREE.MeshPhysicalMaterial({ color: "#e9e6df", roughness: 0.55, metalness: 0, clearcoat: 0.2 }),
	}
	return paints
}
const box = new THREE.BoxGeometry(1, 1, 1)
const rod = new THREE.CylinderGeometry(1, 1, 1, 28, 1)

/** The gate of one held item (list: its held solids). addMesh(group, geo, mat) as view3d's (shadows on); steel: the view's steel material. */
export function makeGate({ list, addMesh, steel }) {
	const P = gatePaints()
	const root = new THREE.Group() // at the pivot: it swings about its z axis
	root.name = `gate-${list[0].item}`
	root.userData.stand = true // (view3d: the post and the gate are not obstacles of a post; picked only while the item is held)
	const arm = addMesh(root, box, P.arm)
	const stop = addMesh(root, rod, P.stop)
	stop.rotation.x = Math.PI / 2
	const bolt = addMesh(root, rod, steel)
	bolt.rotation.x = Math.PI / 2
	const meshes = [arm, stop, bolt]
	for (const m of meshes) m.userData.stand = true
	let side = 1 // +1: the item goes to the right (the arm reaches back to the left of its pivot)
	return {
		root,
		meshes,
		/** The gate in the machine plane for the item standing at its start poses pf, or null when there is no way down to block. */
		layout(pf, track, tRelease, statics) {
			const u = gateDirection(list, pf, track, tRelease, statics)
			if (!u || Math.abs(u.x) < 0.2) return null
			const n = u.x > 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x } // (the side of the way that is up)
			const pts = []
			for (const o of list) outline(o, pf(o), pts)
			let front = -Infinity
			let rear = Infinity
			let base = Infinity
			let top = -Infinity
			for (let i = 0; i < pts.length; i += 2) {
				const a = pts[i] * u.x + pts[i + 1] * u.y
				const b = pts[i] * n.x + pts[i + 1] * n.y
				front = Math.max(front, a)
				rear = Math.min(rear, a)
				base = Math.min(base, b)
				top = Math.max(top, b)
			}
			let hs = Infinity
			for (let i = 0; i < pts.length; i += 2) {
				if (pts[i] * u.x + pts[i + 1] * u.y < front - 0.002) continue
				hs = Math.min(hs, pts[i] * n.x + pts[i + 1] * n.y)
			}
			const H = top - base
			const rs = clamp(0.1 * H, 0.003, 0.03) // the stop's radius
			// it meets the item's front low, where the front is lowest (a bumper's foot, a ball just under its equator), kept off the surface and below
			// the item's top: a low gate holds the toy without its arm crossing the toy's body in every picture of the setup
			const hS = clamp(hs, base + rs + 0.002, base + Math.max(rs + 0.002, 0.8 * H))
			const sa = front + rs + 0.0003
			const S = { x: sa * u.x + hS * n.x, y: sa * u.y + hS * n.y }
			const La = clamp(0.6 * Math.max(front - rear, H), 0.08, 0.3) // the arm, from the stop to the pivot: level, on the way-down side, short
			side = u.x > 0 ? 1 : -1
			let half = 0
			for (const o of list) half = Math.max(half, depthOfSolid(o) / 2)
			const P = { x: S.x + side * La, y: S.y }
			const zPost = -(half + POST_R + 0.006) // just behind the item's own path (its widest part, and 6 mm of air)
			// the post stands on what is under it there, sunk by the slope across its foot (a post on a ramp never hovers on its low side)
			const f = footAt(statics ?? [], pf, P.x, zPost, P.y - 0.01)
			return { u, n, S, P, La, rs, side, zFront: half + 0.004, zPost, foot: f.y - POST_R * Math.abs(f.slope), footY: f.y, rise: top - hS }
		},
		/** Put the arm, stop and bolt for layout L (the post's own place is L.P.x, L.foot .. L.P.y, L.zPost: view3d draws it). */
		place(L) {
			side = L.side
			root.position.set(L.P.x, L.P.y, 0)
			root.rotation.z = 0
			const t = clamp(L.rs * 1.1, 0.004, 0.025) // the arm's thickness (front to back) and height
			const h = clamp(L.rs * 1.4, 0.006, 0.04)
			const zArm = L.zPost + POST_R + t / 2 + 0.001
			arm.scale.set(L.La + h / 2, h, t)
			arm.position.set((-side * L.La) / 2, 0, zArm)
			const z0 = zArm - t / 2
			const z1 = Math.max(L.zFront, z0 + 0.01)
			stop.scale.set(L.rs, z1 - z0, L.rs)
			stop.position.set(-side * L.La, 0, (z0 + z1) / 2)
			const br = clamp(L.rs * 0.55, 0.002, 0.006)
			const b0 = L.zPost
			const b1 = zArm + t / 2 + 0.003
			bolt.scale.set(br, b1 - b0, br)
			bolt.position.set(0, 0, (b0 + b1) / 2)
			root.visible = true
		},
		hide() {
			root.visible = false
		},
		/** The arm's swing at the run's time t: shut until the release, then up through LIFT_DEG in LIFT_S (fast at first, easing out). Shut, the arm
		 *  shadows the track it lies across; lifted, it casts none: high over the track its shadow fell on the room's back wall, a grey shape
		 *  standing apart from everything (a ghost of the gate). */
		at(t, tRelease) {
			const s = clamp((t - tRelease) / LIFT_S, 0, 1)
			const e = 1 - (1 - s) * (1 - s) * (1 - s)
			root.rotation.z = -side * ((LIFT_DEG * Math.PI) / 180) * e
			for (const m of meshes) m.castShadow = s <= 0
		},
	}
}
