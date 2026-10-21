// A person's hand where a person acts in a scene (web/CONTRACT.md "Hands"). Render only: the engine is never told. A held item is held exactly
// still until the scene's release (doc.release), a pusher pushes with its own force, a pitcher is tipped by its own process; the hand shows who does it.
//   holding    a held item (held: true) whose `hand` prop is set: a pinch (thumb and finger), an open palm under it, a fingertip pressing it down or the
//              whole hand round it, in place of the pull pin on its post (or a starting gate). At the release the fingers open (0.08 s) and the hand
//              goes out of the picture along its arm; it never passes through the thing it let go (it is kept clear of it frame by frame, from the
//              track). A thing that leaves moving (start_speed: a throw) is followed through first.
//   fixed      a fixed item whose `hand` prop is set (a magnet held in a fist) is held for the whole run, in place of its stand.
//   pushing    a pusher whose `hand` is finger | hand | two hands | fist: the hand stands at the paddle's face and moves with it (the paddle is the
//              engine's push); housing, rod and paddle are not drawn.
//   pouring    a pitcher whose `hand` is "hand": the hand grips its handle (a cup round its body) and tips with it.
// Every hand is real size (a child's of about nine, 14.5 cm from the wrist crease to the middle fingertip: the hand the engine's document names,
// "a child's hand and forearm in a blue sleeve") whatever the push: a harder push is the pusher's force and time, never a bigger hand. Skin a
// neutral mid tone, a plain sleeve; the arm runs out of the picture (no person, nothing else).
//   const H = makeHands({doc, track, resolved, mode, holdPart, boxOf})   (web/view3d.js buildRun; mode "scene" | "all" | "off")
//   H.group           add it to the run's group          H.pickables      meshes the editor may pick (userData.solidId; `stand` while held)
//   H.holds(item)     no pin, post or gate for it         H.hides(id)      a pusher part under a hand skin: not drawn
//   H.noMount(id)     a fixed part held by a hand: no stand   H.at(t)      pose every hand for moment t
//   H.busy(t)         a hand moves at t                    H.fit(pf, trk)  place them again (things were moved; the models came in)
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js"
import { gradeKeyFor, gradeShader } from "./models3d.js"
import { completeTrack, frameIndex } from "./track.js"

export const HAND_MODES = ["scene", "all", "off"]
export const HOLD_GRIPS = ["auto", "pinch", "palm", "press", "grip"]
export const PUSH_SKINS = ["finger", "hand", "two hands", "fist"]
export const OPEN_S = 0.08 // the fingers open at the release (doc.release.holder: holding -> opening 0.08 s -> open)
const WA = 30 // m/s²: a hand pulled away from what it let go (a quick flick of the forearm; a cork rises from rest at under 20 m/s² in water)
const WV = 1.4 // m/s: ... and its speed out of the picture
const D2R = Math.PI / 180
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const smooth = (u) => {
	const x = clamp(u, 0, 1)
	return x * x * (3 - 2 * x)
}

// ---------------------------------------------------------------- the hand's measures (m)
// The hand is modelled at an adult's 17.5 cm from the wrist crease to the middle fingertip (HL) and drawn at SIZE of it (a child's of about nine,
// 14.5 cm: Snyder et al. 1977, "Anthropometry of infants, children and youths", UM-HSRI-77-17, hand length at 9 years). The bones' lengths are in proportion to the hand's length
// (Buchholz, Armstrong & Goldstein 1992, "Anthropometric data for describing the kinematics of the human hand", Ergonomics 35:261): phalanges
// index 0.245 / 0.143 / 0.097 HL, middle 0.266 / 0.170 / 0.108, ring 0.244 / 0.165 / 0.107, little 0.204 / 0.117 / 0.093, thumb 0.251 (metacarpal) /
// 0.196 / 0.158; each distal one 3 mm longer for the pad beyond the bone. The frame: the wrist joint at the origin, +x toward the fingers, +y the back
// of the hand (the palm faces -y), +z the thumb's side. This is a left hand; a right hand is it mirrored (scale z = -1).
export const HL = 0.175
export const SIZE = 0.83 // (drawn: 0.83 x 17.5 = 14.5 cm)
const PALM_T = 0.026 // the palm's thickness
const PALM_W = 0.08 // ... and width across the knuckles
const PALM_X0 = 0.006 // the palm runs from just past the wrist joint ...
const PALM_X1 = 0.077 // ... to just past the knuckles
const FINGERS = [
	// knuckle (x, z), the three phalanges' lengths, the radius at the knuckle
	{ x: 0.0655, z: 0.0258, L: [0.245 * HL, 0.143 * HL, 0.097 * HL + 0.003], r: 0.0089 },
	{ x: 0.0675, z: 0.0086, L: [0.266 * HL, 0.17 * HL, 0.108 * HL + 0.003], r: 0.0092 },
	{ x: 0.0645, z: -0.0087, L: [0.244 * HL, 0.165 * HL, 0.107 * HL + 0.003], r: 0.0086 },
	{ x: 0.0585, z: -0.0252, L: [0.204 * HL, 0.117 * HL, 0.093 * HL + 0.003], r: 0.0076 }
]
const TAPER = [1, 0.92, 0.85, 0.8] // a finger's radius at its knuckle, middle joints and tip
const THUMB = { at: [0.0095, -0.0045, 0.0205], L: [0.251 * HL, 0.196 * HL, 0.158 * HL + 0.003], r: [0.0118, 0.0102, 0.0096, 0.0088] }
const ARM_R = 0.034 // the sleeve's radius at its cuff

// ---------------------------------------------------------------- poses
// {f: four fingers' [spread, knuckle, middle, end] bends (degrees; spread + toward the thumb, bends toward the palm), t: the thumb's [swing (- out
// to the thumb's side), lift (- toward the palm's side), twist (its pad turned toward the fingers), knuckle, end]}
const pose = (f, t) => ({ f: f.map((r) => [...r]), t: [...t] })
export const POSES = {
	flat: pose([[5, 2, 5, 3], [0, 2, 4, 2], [-4, 2, 5, 3], [-10, 3, 6, 3]], [-40, -12, 88, 6, 6]),
	relaxed: pose([[6, 14, 20, 10], [0, 16, 24, 12], [-4, 18, 26, 12], [-10, 20, 28, 12]], [-42, -20, 90, 10, 10]),
	// (curled fingers: the knuckle about 80 degrees and the middle joint 112, so the tips come back to the palm, as in a real fist)
	fist: pose([[-2, 80, 112, 70], [0, 82, 114, 70], [2, 82, 114, 68], [6, 80, 110, 66]], [-12, -38, 100, 34, 28]),
	point: pose([[0, 2, 4, 2], [0, 80, 112, 68], [2, 82, 112, 66], [6, 80, 108, 64]], [-14, -36, 98, 30, 22]),
	pinch: pose([[2, 32, 40, 14], [0, 60, 96, 60], [2, 70, 104, 62], [6, 74, 106, 62]], [-24, -46, 112, 14, 6]),
	cup: pose([[6, 6, 8, 4], [0, 6, 8, 4], [-4, 6, 8, 4], [-10, 6, 8, 4]], [-44, -14, 88, 6, 4])
}
const FLEX_MAX = [
	[95, 110, 85],
	[95, 110, 85],
	[95, 110, 85],
	[95, 110, 85]
]
export function lerpPose(a, b, k, out = pose(a.f, a.t)) {
	for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.f[i][j] = a.f[i][j] + (b.f[i][j] - a.f[i][j]) * k
	for (let j = 0; j < 5; j++) out.t[j] = a.t[j] + (b.t[j] - a.t[j]) * k
	return out
}
const copyPose = (p) => pose(p.f, p.t)

// ---------------------------------------------------------------- materials (one set for every view; the view's own looks are graded the same way)
const SKIN = "#c69273" // a neutral mid skin tone
const SLEEVE = "#7187a5" // a plain blue-grey sleeve
let mats = null
function handMats() {
	if (mats) return mats
	const graded = (m) => {
		// (the view's plain looks get a little saturation before AgX, gradeShader in models3d.js: the skin is graded as they are)
		const hook = (shader) => gradeShader(shader, false)
		m.onBeforeCompile = hook
		m.customProgramCacheKey = gradeKeyFor(hook)
		return m
	}
	mats = {
		skin: graded(new THREE.MeshPhysicalMaterial({ color: SKIN, roughness: 0.58, metalness: 0, sheen: 0.35, sheenColor: new THREE.Color("#ffd2bf"), sheenRoughness: 0.55, specularIntensity: 0.45, clearcoat: 0.06, clearcoatRoughness: 0.6 })),
		nail: graded(new THREE.MeshPhysicalMaterial({ color: "#d6a690", roughness: 0.34, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, specularIntensity: 0.55 })),
		sleeve: graded(new THREE.MeshPhysicalMaterial({ color: SLEEVE, roughness: 0.9, metalness: 0, sheen: 0.9, sheenColor: new THREE.Color("#c9d6e8"), sheenRoughness: 0.75, specularIntensity: 0.2 })),
		cuff: graded(new THREE.MeshPhysicalMaterial({ color: "#62789a", roughness: 0.88, metalness: 0, sheen: 0.8, sheenColor: new THREE.Color("#c2cfe3"), sheenRoughness: 0.75, specularIntensity: 0.2 }))
	}
	return mats
}

// ---------------------------------------------------------------- geometry (built once, shared by every hand)
const geos = new Map()
const geo = (key, make) => {
	let g = geos.get(key)
	if (!g) {
		g = make()
		g.userData.shared = true
		geos.set(key, g)
	}
	return g
}
/** A capsule tapering from radius r0 at x = 0 to r1 at x = len (the end caps reach r0 behind 0 and r1 past len): a finger's bone with its flesh. */
function taper(r0, r1, len, radial = 14, cap = 6) {
	return geo(`taper|${r0.toFixed(5)}|${r1.toFixed(5)}|${len.toFixed(5)}|${radial}|${cap}`, () => {
		const th = Math.asin(clamp((r0 - r1) / Math.max(len, 1e-6), -0.99, 0.99))
		const pts = []
		for (let i = 0; i <= cap; i++) {
			const a = -Math.PI / 2 + ((th + Math.PI / 2) * i) / cap
			pts.push(new THREE.Vector2(Math.max(0, r0 * Math.cos(a)), r0 * Math.sin(a)))
		}
		for (let i = 0; i <= cap; i++) {
			const a = th + ((Math.PI / 2 - th) * i) / cap
			pts.push(new THREE.Vector2(Math.max(0, r1 * Math.cos(a)), len + r1 * Math.sin(a)))
		}
		return new THREE.LatheGeometry(pts, radial).rotateZ(-Math.PI / 2)
	})
}
const ellipsoid = () => geo("ellipsoid", () => new THREE.SphereGeometry(1, 28, 20))
/** The palm: a smooth slab (a superellipsoid: flat faces, round edges), narrower toward the wrist and fuller at its heel, its knuckle line arched
 *  (the middle knuckle furthest out). */
function palmGeometry() {
	return geo("palm", () => {
		const len = PALM_X1 - PALM_X0
		const g = new THREE.SphereGeometry(1, 40, 28)
		const p = g.attributes.position
		const v = new THREE.Vector3()
		const sp = (a, e) => Math.sign(a) * Math.abs(a) ** e
		for (let i = 0; i < p.count; i++) {
			v.fromBufferAttribute(p, i)
			// (the sphere's y axis is the palm's length here: its poles are the wrist end and the knuckle end)
			let x = sp(v.y, 0.5) * (len / 2)
			let y = -sp(v.x, 0.8) * (PALM_T / 2) // (x <- y, y <- -x: a turn, not a mirror, so the faces stay outward)
			let z = sp(v.z, 0.5) * (PALM_W / 2)
			const u = (x + len / 2) / len // 0 at the wrist, 1 at the knuckles
			const w = z / (PALM_W / 2) // -1 the little finger's side .. 1 the index's
			z *= 0.8 + 0.2 * smooth(u / 0.7)
			if (u > 0.6) x -= 0.0065 * ((u - 0.6) / 0.4) * w * w // (the knuckle line arches back at the sides)
			if (y < 0) y *= 1 + 0.22 * (1 - u) // (a fuller heel of the hand)
			y *= 1 + 0.08 * (1 - Math.abs(w)) // (a little domed across)
			p.setXYZ(i, x + (PALM_X0 + PALM_X1) / 2, y, z)
		}
		g.computeVertexNormals()
		return g
	})
}

const mesh = (g, m) => {
	const o = new THREE.Mesh(g, m)
	o.castShadow = true
	o.receiveShadow = true
	return o
}
const ell = (m, sx, sy, sz, x, y, z) => {
	const o = mesh(ellipsoid(), m)
	o.scale.set(sx, sy, sz)
	o.position.set(x, y, z)
	return o
}

/** One hand (left; `right` mirrors it) and its arm: {root (the hand, at the wrist joint), arm (placed at the wrist along the arm), f: [{mcp, pip, dip}],
 *  t: {cmc, mcp, ip}, spheres: [{obj, p: Vector3 (in obj's frame), r, link}], meshes, side}. */
export function makeRig(side = "left") {
	const M = handMats()
	const root = new THREE.Group()
	root.name = `hand-${side}`
	root.scale.set(SIZE, SIZE, side === "right" ? -SIZE : SIZE)
	const spheres = []
	const meshes = []
	const add = (parent, o) => {
		parent.add(o)
		meshes.push(o)
		return o
	}
	const sph = (obj, x, y, z, r, link) => spheres.push({ obj, p: new THREE.Vector3(x, y, z), r, link })
	add(root, mesh(palmGeometry(), M.skin))
	// the little finger's side of the palm (the hypothenar), the webs between the fingers' roots, the wrist, the joint's roundness
	add(root, ell(M.skin, 0.03, 0.0085, 0.011, 0.032, -0.0062, -0.0215))
	for (let i = 0; i < 3; i++) {
		const A = FINGERS[i]
		const B = FINGERS[i + 1]
		add(root, ell(M.skin, 0.0085, 0.0062, 0.0075, (A.x + B.x) / 2 - 0.0005, -0.0028, (A.z + B.z) / 2))
	}
	const wrist = add(root, mesh(taper(0.0168, 0.0168, 0.02, 32, 10), M.skin))
	wrist.position.x = -0.004
	wrist.scale.z = 1.45
	add(root, ell(M.skin, 0.0162, 0.0158, 0.0228, 0, -0.0005, 0)) // (inside the wrist and the forearm: it only fills the bend between them)
	for (const [x, z] of [[0.022, 0.02], [0.022, -0.02], [0.046, 0.022], [0.046, -0.022], [0.068, 0.024], [0.068, 0], [0.068, -0.024], [0.044, 0]]) sph(root, x, 0, z, PALM_T / 2, "palm")
	sph(root, -0.004, 0, 0, 0.02, "wrist")
	const f = []
	FINGERS.forEach((F, i) => {
		const mcp = new THREE.Group()
		mcp.position.set(F.x, 0, F.z)
		root.add(mcp)
		const joints = [mcp]
		let parent = mcp
		for (let k = 0; k < 3; k++) {
			const r0 = F.r * TAPER[k]
			const r1 = F.r * TAPER[k + 1]
			const L = F.L[k]
			const last = k === 2
			const seg = add(parent, mesh(taper(r0, r1, last ? L - r1 : L), M.skin))
			seg.scale.set(1, last ? 0.88 : 0.9, 1.04) // (a finger is a little flatter than it is wide)
			sph(parent, 0, 0, 0, r0, `f${i}.${k}`)
			sph(parent, L * 0.5, 0, 0, (r0 + r1) / 2, `f${i}.${k}`)
			sph(parent, last ? L - r1 : L, 0, 0, r1, `f${i}.${k}`)
			if (last) {
				const nail = add(parent, ell(M.nail, 0.0066, 0.0021, r1 * 0.74, L - r1 - 0.0042, r1 * 0.66, 0))
				nail.rotation.z = -0.1
			} else {
				const j = new THREE.Group()
				j.position.x = L
				parent.add(j)
				joints.push(j)
				parent = j
			}
		}
		f.push({ mcp: joints[0], pip: joints[1], dip: joints[2] })
	})
	// the thumb: its metacarpal inside the ball of the thumb (the thenar), then two phalanges
	const cmc = new THREE.Group()
	cmc.position.set(...THUMB.at)
	root.add(cmc)
	add(cmc, ell(M.skin, THUMB.L[0] * 0.62, 0.0132, 0.0152, THUMB.L[0] * 0.42, -0.003, -0.002))
	sph(cmc, THUMB.L[0] * 0.3, -0.002, 0, 0.0135, "t.0")
	sph(cmc, THUMB.L[0] * 0.75, -0.002, 0, 0.012, "t.0")
	const tm = new THREE.Group()
	tm.position.x = THUMB.L[0]
	cmc.add(tm)
	add(tm, mesh(taper(THUMB.r[1], THUMB.r[2], THUMB.L[1]), M.skin)).scale.y = 0.95
	sph(tm, 0, 0, 0, THUMB.r[1], "t.1")
	sph(tm, THUMB.L[1] * 0.5, 0, 0, (THUMB.r[1] + THUMB.r[2]) / 2, "t.1")
	const ti = new THREE.Group()
	ti.position.x = THUMB.L[1]
	tm.add(ti)
	add(ti, mesh(taper(THUMB.r[2], THUMB.r[3], THUMB.L[2] - THUMB.r[3]), M.skin)).scale.y = 0.9
	add(ti, ell(M.nail, 0.0072, 0.0022, THUMB.r[3] * 0.76, THUMB.L[2] - THUMB.r[3] - 0.0048, THUMB.r[3] * 0.7, 0)).rotation.z = -0.1
	sph(ti, 0, 0, 0, THUMB.r[2], "t.2")
	sph(ti, THUMB.L[2] * 0.5, 0, 0, (THUMB.r[2] + THUMB.r[3]) / 2, "t.2")
	sph(ti, THUMB.L[2] - THUMB.r[3], 0, 0, THUMB.r[3], "t.2")
	// the arm: the skin of the forearm out of the wrist, a cuff and the sleeve to `length` (set by setArm)
	const arm = new THREE.Group()
	arm.name = `arm-${side}`
	arm.scale.setScalar(SIZE)
	const fore = add(arm, mesh(taper(0.0163, 0.0205, 0.05, 32, 10), M.skin))
	fore.scale.z = 1.42
	const cuff = add(arm, mesh(geo("cuff", () => new THREE.TorusGeometry(ARM_R, 0.0042, 10, 36).rotateY(Math.PI / 2)), M.cuff))
	cuff.position.x = 0.046
	cuff.scale.set(1, 1, 1.12)
	const sleeve = add(arm, mesh(geo("sleeve", () => new THREE.CylinderGeometry(1, 1, 1, 28, 1, false).rotateZ(-Math.PI / 2).translate(0.5, 0, 0)), M.sleeve))
	sleeve.position.x = 0.044
	const rig = { root, arm, f, t: { cmc, mcp: tm, ip: ti }, spheres, meshes, side, sleeve, cuff, pose: copyPose(POSES.relaxed), length: 0.6 }
	setArm(rig, 0.6)
	applyPose(rig, rig.pose)
	return rig
}

/** The sleeve runs from the cuff to `length` m from the wrist (out of the picture), widening a little. */
export function setArm(rig, length) {
	rig.length = length
	const L = Math.max(0.06, length / SIZE - 0.044) // (in the arm's own, scaled frame)
	rig.sleeve.scale.set(L, ARM_R + 0.0015, (ARM_R + 0.0015) * 1.1)
}

/** Put pose P on the rig's joints (degrees). */
export function applyPose(rig, P) {
	if (P !== rig.pose) {
		for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) rig.pose.f[i][j] = P.f[i][j]
		for (let j = 0; j < 5; j++) rig.pose.t[j] = P.t[j]
	}
	const Q = rig.pose
	for (let i = 0; i < 4; i++) {
		const F = rig.f[i]
		const [a, m, p, d] = Q.f[i]
		F.mcp.rotation.set(0, -a * D2R, -m * D2R, "YZX")
		F.pip.rotation.set(0, 0, -p * D2R)
		F.dip.rotation.set(0, 0, -d * D2R)
	}
	const [sw, li, tw, tmc, tip] = Q.t
	rig.t.cmc.rotation.set(tw * D2R, sw * D2R, li * D2R, "YZX")
	rig.t.mcp.rotation.set(0, 0, -tmc * D2R)
	rig.t.ip.rotation.set(0, 0, -tip * D2R)
}

/** Place the hand: its wrist at world point W with its axes x (to the fingers) and y (the back of the hand) along world directions X and Y (unit,
 *  orthogonal); z follows (x × y: the thumb's side of a left hand; a right hand's thumb is on -z). */
const _m = new THREE.Matrix4()
const _xa = new THREE.Vector3()
const _ya = new THREE.Vector3()
const _za = new THREE.Vector3()
export function placeHand(rig, W, X, Y) {
	_xa.copy(X).normalize()
	_ya.copy(Y).addScaledVector(_xa, -Y.dot(_xa)).normalize()
	_za.crossVectors(_xa, _ya)
	_m.makeBasis(_xa, _ya, _za)
	rig.root.quaternion.setFromRotationMatrix(_m)
	rig.root.position.copy(W)
}
/** Place the arm at the hand's wrist, along world direction A (from the wrist toward the elbow), its width across the hand's z. */
export function placeArm(rig, A) {
	rig.root.updateMatrixWorld(true)
	_xa.copy(A).normalize()
	_za.setFromMatrixColumn(rig.root.matrixWorld, 2).normalize() // (a mirrored hand's z column points to its thumb's other side: the arm is symmetric)
	_za.addScaledVector(_xa, -_za.dot(_xa))
	if (_za.lengthSq() < 1e-8) _za.set(0, 0, 1).addScaledVector(_xa, -_xa.z)
	_za.normalize()
	_ya.crossVectors(_za, _xa)
	_m.makeBasis(_xa, _ya, _za)
	rig.arm.quaternion.setFromRotationMatrix(_m)
	rig.arm.position.copy(rig.root.position)
}

// ---------------------------------------------------------------- the things a hand holds, as distance fields (m; negative inside)
const _p = new THREE.Vector3()
/** The signed distance from world point p to one doc solid standing at pose q, zh its half-depth (front to back). */
function solidDistance(s, q, zh, p) {
	const c = Math.cos(q.angle ?? 0)
	const sn = Math.sin(q.angle ?? 0)
	const dx = p.x - q.x
	const dy = p.y - q.y
	const lx = dx * c + dy * sn
	const ly = -dx * sn + dy * c
	const b = s.body
	if (b.kind === "ball") {
		if (s.shape === "cylinder") return capped(Math.hypot(lx, ly) - b.radius, Math.abs(p.z) - zh)
		return Math.hypot(lx, ly, p.z) - b.radius
	}
	if (b.kind === "slab") {
		const qx = Math.abs(lx) - b.width / 2
		const qy = Math.abs(ly) - b.height / 2
		const qz = Math.abs(p.z) - zh
		return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0)
	}
	// a polygon: its convex hull's farthest edge line (exact inside, never more than the true distance outside: safe for clearance)
	const H = hullOf(s)
	let d = -Infinity
	for (const e of H) d = Math.max(d, (lx - e.x) * e.nx + (ly - e.y) * e.ny)
	return capped(d, Math.abs(p.z) - zh)
}
const capped = (d2, dz) => Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0)
const hulls = new WeakMap()
function hullOf(s) {
	let H = hulls.get(s)
	if (H) return H
	const pts = s.body.points.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	const lo = []
	for (const p of pts) {
		while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop()
		lo.push(p)
	}
	const up = []
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i]
		while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop()
		up.push(p)
	}
	const h = [...lo.slice(0, -1), ...up.slice(0, -1)] // counter-clockwise
	H = []
	for (let i = 0; i < h.length; i++) {
		const a = h[i]
		const b = h[(i + 1) % h.length]
		const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
		H.push({ x: a[0], y: a[1], nx: (b[1] - a[1]) / L, ny: -(b[0] - a[0]) / L })
	}
	hulls.set(s, H)
	return H
}
/** A solid's half-depth as drawn: its model's own box when the view has one (a wine cork is drawn 44 mm long), else what the document says. */
function halfDepth(s, boxOf) {
	const b = boxOf?.(s.id)
	if (b && !b.isEmpty()) return Math.max(0.0005, Math.max(-b.min.z, b.max.z))
	if (s.body.kind === "ball") return s.shape === "cylinder" ? (s.length ?? s.depth3d ?? 4 * s.body.radius) / 2 : (s.depth3d ?? 2 * s.body.radius) / 2
	return (s.body.depth ?? 0.1) / 2
}
/** The field of a set of solids at their poses (pf(s) -> {x, y, angle}): d(p) = the least distance to any of them. */
function fieldOf(list, pf, boxOf) {
	const items = list.map((s) => ({ s, zh: halfDepth(s, boxOf) }))
	const at = (poses) => (p) => {
		let d = Infinity
		for (let i = 0; i < items.length; i++) d = Math.min(d, solidDistance(items[i].s, poses[i], items[i].zh, p))
		return d
	}
	const poses = list.map(pf)
	const start = at(poses)
	start.items = items
	start.at = at
	start.pose0 = poses
	return start
}
/** Where a ray from o along unit dir first meets the field (sphere tracing), or null within `max` m. */
function hitAlong(d, o, dir, max = 1.5) {
	let s = 0
	for (let i = 0; i < 200 && s < max; i++) {
		_p.copy(o).addScaledVector(dir, s)
		const v = d(_p)
		if (v < 2e-5) return s
		s += Math.max(v, 1e-4)
	}
	return null
}

// ---------------------------------------------------------------- a hand round a thing: close the fingers until they touch it
const _w = new THREE.Vector3()
/** The least clearance (m) between the rig's spheres of the given links and the field d (the rig's matrices must be current). */
function clearance(rig, d, links = null) {
	let m = Infinity
	for (const S of rig.spheres) {
		if (links && !links(S.link)) continue
		_w.copy(S.p).applyMatrix4(S.obj.matrixWorld)
		m = Math.min(m, d(_w) - S.r * SIZE)
	}
	return m
}
/** Close one finger (i 0..3, or "t" the thumb) from its pose in rig.pose toward its limits, all its joints together, each stopping where the part
 *  beyond it touches the field (within `gap`); `most` caps the bends (degrees, per joint). Underactuated closing, as a gripper's fingers close. */
function closeFinger(rig, d, i, { gap = 0.0006, most = null, step = 1.5 } = {}) {
	const P = rig.pose
	const isT = i === "t"
	const acc = isT
		? [
				{ get: () => -P.t[1], set: (v) => (P.t[1] = -v), max: most?.[0] ?? 62, k: 0.7, link: "t.0" },
				{ get: () => P.t[3], set: (v) => (P.t[3] = v), max: most?.[1] ?? 55, k: 1, link: "t.1" },
				{ get: () => P.t[4], set: (v) => (P.t[4] = v), max: most?.[2] ?? 70, k: 1, link: "t.2" }
			]
		: [0, 1, 2].map((j) => ({ get: () => P.f[i][j + 1], set: (v) => (P.f[i][j + 1] = v), max: most?.[j] ?? FLEX_MAX[i][j], k: [1, 1.15, 0.75][j], link: `f${i}.${j}` }))
	const top = isT ? rig.t.cmc : rig.f[i].mcp
	const links = acc.map((a) => a.link)
	const touching = (j) => {
		applyPose(rig, P)
		top.updateMatrixWorld(true)
		return clearance(rig, d, (l) => links.indexOf(l) >= j) < gap
	}
	rig.root.updateMatrixWorld(true)
	// (already in it: open it until it is not, then stop)
	if (touching(0)) {
		for (let n = 0; n < 60 && touching(0); n++) for (const a of acc) a.set(a.get() - 2)
		return
	}
	let active = 0 // joints before this one are stopped
	for (let n = 0; n < 200 && active < acc.length; n++) {
		const prev = acc.map((a) => a.get())
		let moved = false
		for (let j = active; j < acc.length; j++) {
			const a = acc[j]
			const v = Math.min(a.max, a.get() + step * a.k)
			if (v > a.get() + 1e-9) moved = true
			a.set(v)
		}
		if (!moved) break
		applyPose(rig, P)
		top.updateMatrixWorld(true)
		// which part touches first, from the tip back: it stops its own joint and the ones before it
		let hit = -1
		for (let j = acc.length - 1; j >= active; j--) {
			if (clearance(rig, d, (l) => l === acc[j].link) < gap) {
				hit = j
				break
			}
		}
		if (hit >= 0) {
			for (let j = active; j <= hit; j++) acc[j].set(prev[j])
			active = hit + 1
		}
	}
	applyPose(rig, P)
}

// ---------------------------------------------------------------- the hand's own reference points (with the root at the origin)
const ref = { built: false }
function refs() {
	if (ref.built) return ref
	const r = makeRig("left")
	r.root.position.set(0, 0, 0)
	r.root.quaternion.identity()
	r.root.scale.set(1, 1, 1) // (points in the hand's own frame)
	const tipOf = (rig, i) => {
		rig.root.updateMatrixWorld(true)
		const o = i === "t" ? rig.t.ip : rig.f[i].dip
		const L = i === "t" ? THUMB.L[2] - THUMB.r[3] : FINGERS[i].L[2] - FINGERS[i].r * TAPER[3]
		return new THREE.Vector3(L, 0, 0).applyMatrix4(o.matrixWorld)
	}
	applyPose(r, POSES.pinch)
	const it = tipOf(r, 0)
	const tt = tipOf(r, "t")
	ref.pinchAt = it.clone().add(tt).multiplyScalar(0.5)
	ref.pinchAxis = it.clone().sub(tt).normalize() // (from the thumb's pad to the index's)
	applyPose(r, POSES.point)
	ref.pointTip = tipOf(r, 0).add(new THREE.Vector3(FINGERS[0].r * TAPER[3], 0, 0)) // (the index's very tip)
	// a fist's front: the farthest point along +x of its fingers' spheres (the flats of the first bones)
	applyPose(r, POSES.fist)
	r.root.updateMatrixWorld(true)
	let fx = -Infinity
	for (const S of r.spheres) {
		if (!S.link.startsWith("f")) continue
		_w.copy(S.p).applyMatrix4(S.obj.matrixWorld)
		fx = Math.max(fx, _w.x + S.r)
	}
	ref.fistFront = fx
	ref.built = true
	return ref
}

// ---------------------------------------------------------------- where the picture ends (the arm runs out of it; a hand that lets go leaves it)
/** A function exit(p, dir) -> m along unit dir from world point p to beyond the picture: the scene's fixed camera (doc.view.camera, filmed at up to
 *  4:3) when it has one, else a box round everything drawn (as the wide shot frames it). */
function frameExit(doc, bounds) {
	const C = doc.view?.camera
	if (C) {
		const hf = (C.hfov ?? 69.39) * D2R
		const pitch = (C.pitch ?? 6.843) * D2R
		const d = (C.x1 - C.x0) / 2 / Math.tan(hf / 2)
		const cx = (C.x0 + C.x1) / 2
		const cam = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan(hf / 2) / (4 / 3)) / D2R, 4 / 3, 0.01, 100)
		cam.position.set(cx, (C.y ?? 0.3) + d * Math.tan(pitch), d)
		cam.lookAt(cx, C.y ?? 0.3, 0)
		cam.updateMatrixWorld(true)
		cam.updateProjectionMatrix()
		const v = new THREE.Vector3()
		const out = (p) => {
			v.copy(p).applyMatrix4(cam.matrixWorldInverse)
			if (v.z > -0.02) return true
			v.copy(p).project(cam)
			return Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02
		}
		return (p, dir) => march(out, p, dir)
	}
	const b = bounds ?? { x0: -0.5, x1: 3, y0: 0, y1: 0.8 }
	const W = (b.x1 - b.x0) * 1.15 + 0.3
	const H = Math.max((b.y1 - b.y0) * 1.15 + 0.3, (W * 9) / 16)
	const cx = (b.x0 + b.x1) / 2
	const cy = Math.max((b.y0 + b.y1) / 2, H / 2 - 0.05)
	const out = (p) => Math.abs(p.x - cx) > W / 2 || Math.abs(p.y - cy) > H / 2
	return (p, dir) => march(out, p, dir)
}
const _q = new THREE.Vector3()
function march(out, p, dir) {
	let s = 0
	for (; s < 5; s += 0.02) if (out(_q.copy(p).addScaledVector(dir, s))) break
	let lo = Math.max(0, s - 0.02)
	let hi = s
	for (let i = 0; i < 12; i++) {
		const m = (lo + hi) / 2
		if (out(_q.copy(p).addScaledVector(dir, m))) hi = m
		else lo = m
	}
	return hi
}

// ---------------------------------------------------------------- the run's hands
/** A solid's pose at moment t in the track (linear between its frames; the first frame's for a static). */
function poseAt(track, id, t, out = { x: 0, y: 0, angle: 0 }) {
	completeTrack(track)
	const f = track.frames
	const i = frameIndex(track, t)
	const a = f[i].placements[id]
	if (!a) return null
	const j = Math.min(i + 1, f.length - 1)
	const b = f[j].placements[id] ?? a
	const span = f[j].t - f[i].t
	const u = span > 0 ? clamp((t - f[i].t) / span, 0, 1) : 0
	out.x = a.x + (b.x - a.x) * u
	out.y = a.y + (b.y - a.y) * u
	out.angle = a.angle + (b.angle - a.angle) * u
	return out
}

/** Which way a held thing goes once let go (its first 3 mm within 0.6 s of the release: a unit {x, y}), its speed just after the release (m/s, from the
 *  first 1/60 s) and its velocity then; null when it does not move. */
function firstMove(list, track, tR) {
	const f = track?.frames ?? []
	if (f.length < 2) return null
	const mean = (t) => {
		let x = 0
		let y = 0
		let n = 0
		for (const s of list) {
			const q = poseAt(track, s.id, t)
			if (!q) continue
			x += q.x
			y += q.y
			n++
		}
		return n ? { x: x / n, y: y / n } : null
	}
	const a = mean(tR)
	if (!a) return null
	const b = mean(tR + 1 / 60)
	const v = b ? { x: (b.x - a.x) * 60, y: (b.y - a.y) * 60 } : { x: 0, y: 0 }
	for (let t = tR + 1 / 120; t <= tR + 0.6; t += 1 / 120) {
		const q = mean(t)
		if (!q) break
		const d = Math.hypot(q.x - a.x, q.y - a.y)
		if (d >= 0.003) return { x: (q.x - a.x) / d, y: (q.y - a.y) / d, v, speed: Math.hypot(v.x, v.y) }
	}
	return null
}

/** The extent of the field along the machine plane: {x0, x1, y0, y1, cx, cy} from sampling its solids' outlines (posed by pf). */
function extentOf(list, pf) {
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	const grow = (x, y) => {
		x0 = Math.min(x0, x)
		x1 = Math.max(x1, x)
		y0 = Math.min(y0, y)
		y1 = Math.max(y1, y)
	}
	for (const s of list) {
		const q = pf(s)
		const c = Math.cos(q.angle ?? 0)
		const sn = Math.sin(q.angle ?? 0)
		const at = (lx, ly) => grow(q.x + lx * c - ly * sn, q.y + lx * sn + ly * c)
		const b = s.body
		if (b.kind === "ball") {
			grow(q.x - b.radius, q.y - b.radius)
			grow(q.x + b.radius, q.y + b.radius)
		} else if (b.kind === "slab") {
			for (const sx of [-1, 1]) for (const sy of [-1, 1]) at((sx * b.width) / 2, (sy * b.height) / 2)
		} else for (const p of b.points) at(p.x, p.y)
	}
	return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}

/** The liquid surfaces of the run (the liquids module's containers): [{x0, x1, floor, top, layers: [{y0, y1, density}]}] (world m, kg/m³). */
function liquidsOf(doc) {
	const out = []
	for (const p of doc.processes ?? []) {
		if (p.kind !== "liquid" || !Array.isArray(p.layers)) continue
		let y = p.floor
		const layers = []
		for (const l of p.layers) {
			layers.push({ y0: y, y1: y + (l.height ?? 0), density: l.density ?? 1000 })
			y += l.height ?? 0
		}
		out.push({ x0: p.x0, x1: p.x1, floor: p.floor, top: y, layers })
	}
	return out
}
/** The mean density of a thing's solids (kg/m³, by volume: outline area x depth), from the document's materials; null when it has none. */
function densityOf(list, doc) {
	let m = 0
	let v = 0
	for (const s of list) {
		const rho = doc.materials?.[s.material]?.density
		if (!Number.isFinite(rho)) continue
		const b = s.body
		const area = b.kind === "ball" ? Math.PI * b.radius * b.radius : b.kind === "slab" ? b.width * b.height : Math.abs(b.points.reduce((a, p, i, P) => a + p.x * P[(i + 1) % P.length].y - P[(i + 1) % P.length].x * p.y, 0)) / 2
		const dv = area * (b.kind === "ball" ? (s.shape === "cylinder" ? (s.length ?? 4 * b.radius) : (4 / 3) * b.radius) : (b.depth ?? 0.1))
		m += rho * dv
		v += dv
	}
	return v > 0 ? m / v : null
}

/** Statics (not of the item) whose outline comes within `reach` above / below the thing's extent E across its width: {above: gap or Infinity, below}. */
function roomAround(E, statics, pf, reach = 0.15) {
	let above = Infinity
	let below = Infinity
	for (const s of statics) {
		const e = extentOf([s], pf)
		if (e.x1 < E.x0 + 0.002 || e.x0 > E.x1 - 0.002) continue
		if (e.y0 >= E.y1 - 0.001) above = Math.min(above, e.y0 - E.y1)
		if (e.y1 <= E.y0 + 0.004) below = Math.min(below, E.y0 - e.y1)
	}
	return { above: above <= reach ? above : Infinity, below: below <= reach ? below : Infinity }
}

/** The grip a held thing gets for `auto`: from its size, whether it is in a liquid, which way it goes once let go and what is round it. */
export function autoGrip({ E, move, inWater, room, depth = Infinity }) {
	const size = Math.max(E.w, E.h)
	const thin = Math.min(E.w, E.h, depth) <= 0.015 && size <= 0.2 // (a nail, a pencil, a clip, a washer: held between thumb and finger)
	const rises = !!move && move.y > 0.5
	if (inWater) return rises ? (size <= 0.065 ? "press" : "grip") : size <= 0.045 || thin ? "pinch" : "grip"
	if (rises && room.above === Infinity) return size <= 0.065 ? "press" : "grip"
	if (size <= 0.045 || thin) return "pinch"
	if (room.below < 0.004) return "grip" // (it rests on something: held from above)
	return "palm"
}

const V = (x, y, z) => new THREE.Vector3(x, y, z)
/** A direction of the hand's model frame (a left hand's) as the hand's turn sees it for a rig of this side: a right hand is the left mirrored in z
 *  (its root's scale), so its turn (X, Y and X × Y) must carry the mirrored direction. Only for directions that set the turn: a point of the model
 *  goes through offsetOf, whose matrix holds the mirror already. */
const sided = (rig, v) => (rig.side === "right" ? V(v.x, v.y, -v.z) : v.clone())
/** Where a point of the rig's model frame is (world, less the wrist's place) once the hand is turned to world axes X (fingers) and Y (back of the hand). */
function offsetOf(rig, local, X, Y) {
	placeHand(rig, V(0, 0, 0), X, Y)
	rig.root.updateMatrixWorld(true)
	return local.clone().applyMatrix4(rig.root.matrixWorld)
}
const sideFrom = (move) => (move && Math.abs(move.x) > 0.3 ? (move.x > 0 ? "left" : "right") : "left")
/** Where the arm comes from for a grip: hand_from when it is one the grip can take, else the grip's own way. */
export function fromFor(grip, from, { move, inWater, room }) {
	if (grip === "press") return "above"
	if (grip === "palm") return from === "left" || from === "right" ? from : sideFrom(move)
	if (from === "left" || from === "right" || from === "above") return from
	if (grip === "grip") return "above"
	return (inWater || room.below < 0.004) && room.above === Infinity ? "above" : sideFrom(move) // (pinch)
}

/** The hold of one thing: {rig, wrist, X, Y, armDir, exit: [{dir, len}] (the way out once it is let go: straight lines, the last one open-ended),
 *  pose} with the fingers closed round it (field d, its extent E, its first move). */
function solveHold(grip, from, d, E, move) {
	const R = refs()
	const side = from === "right" ? -1 : 1 // (from the side: +1 the arm comes from the left and the hand reaches to +x)
	const falls = !!move && move.y < 0.3 // (what it does once let go: the fingers never wrap under a thing that will drop out of them)
	let rig
	const W = new THREE.Vector3()
	let X
	let Y
	let A
	let exit = null
	let pace = null // the way out's start and speed (m/s², m/s), else WA and WV
	let close = []
	if (grip === "press") {
		// one fingertip on its top, pressing it down; the palm turned to the camera; the arm straight up
		rig = makeRig("left")
		const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
		const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
		X = V(0, -1, 0)
		Y = V(-0.45, 0, -0.89)
		applyPose(rig, POSES.point)
		W.copy(T).sub(offsetOf(rig, R.pointTip, X, Y)).add(V(0, 0.0004, 0))
		A = V(0.05, 1, -0.12)
		rig.pose = copyPose(POSES.point)
	} else if (grip === "pinch") {
		// thumb and finger on either side of it, across the way it will go (it slides out from between them); from above, or from the side
		const above = from === "above"
		rig = makeRig(above ? "left" : side > 0 ? "left" : "right")
		const approach = above ? V(0, -1, 0) : V(side, 0, 0)
		const mv = move ? V(move.x, move.y, 0) : V(0, -1, 0)
		const inPlane = V(-mv.y, mv.x, 0).normalize()
		// the pinch's axis: across its first move in the picture's plane when it is thin that way (the fingers on its two sides), else front to back
		let n = V(0, 0, 1)
		if (Math.abs(inPlane.dot(approach)) < 0.7) {
			const across = Math.abs(inPlane.x) > Math.abs(inPlane.y) ? E.w : E.h
			if (across <= Math.max(0.03, halfZ(d) * 2 + 0.002)) n = inPlane.clone()
		}
		// the pinch point: on the thing, near the hand's side (from the side, 7 mm in from its end; from above, its middle)
		const P = above ? V(E.cx, E.cy, 0) : V(side > 0 ? E.x0 + Math.min(0.008, E.w * 0.3) : E.x1 - Math.min(0.008, E.w * 0.3), E.cy, 0)
		// the hand turned so its wrist-to-pinch line runs along the approach and its thumb-to-index line along n (front to back: the thumb in front)
		const toP = sided(rig, R.pinchAt).normalize()
		const ax = sided(rig, R.pinchAxis)
		const nn = n.z > 0.5 ? n.clone().negate() : n.clone()
		const frame = (u, v) => {
			const a = u.clone().normalize()
			const b = v.clone().addScaledVector(a, -v.dot(a)).normalize()
			return new THREE.Matrix4().makeBasis(a, b, a.clone().cross(b))
		}
		const Rm = frame(approach, nn).multiply(frame(toP, ax).invert())
		const q = new THREE.Quaternion().setFromRotationMatrix(Rm)
		X = V(1, 0, 0).applyQuaternion(q)
		Y = V(0, 1, 0).applyQuaternion(q)
		applyPose(rig, POSES.pinch)
		W.copy(P).sub(offsetOf(rig, R.pinchAt, X, Y))
		A = above ? V(0.08, 1, -0.2) : V(-side * 0.9, 0.35, -0.25)
		rig.pose = copyPose(POSES.pinch)
		// open the two a little, then close them onto it
		rig.pose.f[0][1] -= 18
		rig.pose.f[0][2] -= 18
		rig.pose.t[1] += 14
		rig.pose.t[3] -= 10
		close = [[0], ["t"]]
	} else if (grip === "palm") {
		// it rests on the open palm, the fingers cupped round it; the arm from the side, a little low. Let go, the hand drops away from under it
		// and out to its side faster than it falls (the clearance below keeps it so)
		rig = makeRig(side > 0 ? "right" : "left") // (the thumb toward the camera)
		const bottom = hitAlong(d, V(E.cx, E.y0 - 0.3, 0), V(0, 1, 0), 0.6)
		let B = V(E.cx, bottom === null ? E.y0 : E.y0 - 0.3 + bottom, 0)
		X = V(side, 0, 0)
		Y = V(0, -1, 0)
		const ball = sphereOf(d)
		if (ball) {
			// under a ball the palm rolls 20 degrees toward the camera, tangent to it there, so its cupped palm shows
			const n = V(0, -Math.cos(20 * D2R), Math.sin(20 * D2R))
			B = ball.c.clone().addScaledVector(n, ball.r)
			Y = n.clone()
		}
		applyPose(rig, POSES.cup)
		W.copy(B).sub(offsetOf(rig, V(0.046, -PALM_T / 2 - 0.0003, 0), X, Y))
		A = V(-side * 0.94, -0.22, 0.18)
		// (let go, a hand drops straight down from under it, faster than it falls, then out to its side and down)
		exit = [{ dir: V(0, -1, 0), len: 0.05 }, { dir: V(-side * 0.95, -0.3, 0.06), len: Infinity }]
		pace = { a: 40, v: 2.5 } // (a whip away: it falls at g, and a hand left under it would be seen to carry it)
		rig.pose = copyPose(POSES.cup)
		close = [[0, { most: [30, 35, 25] }], [1, { most: [30, 35, 25] }], [2, { most: [30, 35, 25] }], [3, { most: [30, 35, 25] }], ["t", { most: [20, 20, 20] }]]
	} else {
		// "grip": the whole hand round it, from above (the fingers draped down its front) or from a side (the palm on that side, the fingers round its
		// front); a thin bar lies across the base of the fingers, a big thing under the middle of the palm
		const zSize = halfZ(d) * 2
		const at = 0.044 + 0.018 * clamp((0.05 - zSize) / 0.035, 0, 1)
		// (a long thin thing lying across, a fist round it: a magnet, a ruler, a rod; a toy car is not one)
		const bar = E.w > Math.max(0.05, 4 * halfZ(d)) && E.h <= 0.04 && 2 * halfZ(d) <= 0.04
		if (from === "above") {
			const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
			const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
			Y = V(0, 1, 0)
			if (bar) {
				// a fist round a bar: the bar across the palm, the fingers curled round its front and under it
				rig = makeRig("left")
				X = V(0, 0, 1)
				A = V(0, 0.93, -0.36)
			} else {
				// the hand on top, its fingers draped down one side (toward the camera a little) and the thumb round its back, so its front shows
				const gs = move && move.x > 0.3 ? -1 : 1
				rig = makeRig(gs > 0 ? "right" : "left")
				X = V(gs * Math.cos(25 * D2R), 0, Math.sin(25 * D2R))
				A = V(-gs * 0.32, 0.92, -0.22)
			}
			applyPose(rig, POSES.flat)
			W.copy(T).sub(offsetOf(rig, V(bar ? at : 0.046, -PALM_T / 2 - 0.0003, 0), X, Y))
		} else {
			rig = makeRig(side > 0 ? "right" : "left") // (the thumb on top)
			const hit = hitAlong(d, V(side > 0 ? E.x0 - 0.3 : E.x1 + 0.3, E.cy, 0), V(side, 0, 0), 0.6)
			const S = V(side > 0 ? (hit === null ? E.x0 : E.x0 - 0.3 + hit) : hit === null ? E.x1 : E.x1 + 0.3 - hit, E.cy, 0)
			X = V(0, 0, 1)
			Y = V(-side, 0, 0)
			applyPose(rig, POSES.flat)
			W.copy(S).sub(offsetOf(rig, V(at, -PALM_T / 2 - 0.0003, 0), X, Y))
			A = V(-side * 0.82, 0.35, -0.45)
		}
		rig.pose = copyPose(POSES.flat)
		// (the thumb starts clear of it and closes round its other side: under a bar from behind it, or down a round thing's back)
		rig.pose.t = bar ? [-10, -55, 95, 5, 5] : [-50, 15, 90, 5, 5]
		// (a thing that will drop: the fingers stop at its widest; one held down, or held fixed, is gripped round)
		const most = falls && from === "above" ? [58, 45, 25] : null
		close = [[0, { most }], [1, { most }], [2, { most }], [3, { most }], ["t", {}]]
	}
	placeHand(rig, W, X, Y)
	applyPose(rig, rig.pose)
	rig.root.updateMatrixWorld(true)
	for (const [i, o] of close) closeFinger(rig, d, i, o ?? {})
	A.normalize()
	const way = (exit ?? [{ dir: A, len: Infinity }]).map((e) => ({ dir: e.dir.clone().normalize(), len: e.len }))
	return { rig, wrist: W.clone(), X: X.clone(), Y: Y.clone(), armDir: A, exit: way, pace: pace ?? { a: WA, v: WV }, pose: copyPose(rig.pose) }
}
/** The field's sphere when it is one ball (not a cylinder): {c, r}, else null. */
function sphereOf(d) {
	const it = d.items ?? []
	if (it.length !== 1 || it[0].s.body.kind !== "ball" || it[0].s.shape === "cylinder") return null
	const q = d.pose0?.[0]
	return q ? { c: V(q.x, q.y, 0), r: it[0].s.body.radius } : null
}
/** The field's half-depth where it is deepest (the drawn half-depths of its solids). */
const halfZ = (d) => Math.max(0.001, ...(d.items ?? []).map((i) => i.zh))

/** The pose a hand opens to at the release: each bend eased off toward the relaxed hand. */
function openOf(P) {
	const o = copyPose(POSES.relaxed)
	for (let i = 0; i < 4; i++) o.f[i][0] = P.f[i][0]
	return lerpPose(P, o, 0.85)
}

/** The run's hands. opts: {doc, track, resolved, mode, holdPart(list) -> the part a pin would hold (or null), boxOf(id) -> drawn Box3 | null,
 *  bounds (the scene's extent, for a run without a fixed camera)}. */
export function makeHands({ doc, track, resolved = {}, mode = "scene", holdPart = null, boxOf = null, bounds = null }) {
	const group = new THREE.Group()
	group.name = "hands"
	const H = { group, rigs: [], pickables: [], held: new Set(), hidden: new Set(), unmounted: new Set(), mode }
	if (mode === "off" || !doc?.solids?.length) return finish(H)
	const solidById = new Map(doc.solids.map((s) => [s.id, s]))
	const byItem = new Map()
	for (const s of doc.solids) {
		if (s.hidden_3d) continue
		if (!byItem.has(s.item)) byItem.set(s.item, [])
		byItem.get(s.item).push(s)
	}
	const tR = doc.release?.at ?? 0.5
	const heldIds = new Set(doc.release?.parts ?? [])
	const heldItems = new Map()
	for (const id of heldIds) {
		const s = solidById.get(id)
		if (!s || s.hidden_3d) continue
		if (!heldItems.has(s.item)) heldItems.set(s.item, [])
		heldItems.get(s.item).push(s)
	}
	const propOf = (item, k) => resolved?.[item]?.[k]
	const want = (item, fallback) => {
		const v = propOf(item, "hand")
		if (typeof v === "string" && v !== "none") return v
		return mode === "all" ? fallback : null
	}
	const plans = []
	for (const [item, list] of heldItems) {
		const grip = want(item, "auto")
		if (!grip || !HOLD_GRIPS.includes(grip)) continue
		plans.push({ kind: "hold", item, list, grip, from: propOf(item, "hand_from") ?? "auto" })
	}
	for (const [item, list] of byItem) {
		const type = list[0].itemType
		if (type === "pusher") {
			const skin = want(item, "hand")
			if (skin && PUSH_SKINS.includes(skin)) plans.push({ kind: "push", item, list, skin })
		} else if (type === "pitcher") {
			if (want(item, "hand") === "hand") plans.push({ kind: "pour", item, list })
		} else if (!heldItems.has(item) && list.every((s) => s.kind === "static")) {
			// a fixed thing (a dynamic type set fixed: its `hand` is listed only on dynamic types) held in a hand the whole run
			const grip = propOf(item, "hand")
			if (typeof grip === "string" && grip !== "none" && HOLD_GRIPS.includes(grip)) plans.push({ kind: "fixed", item, list, grip, from: propOf(item, "hand_from") ?? "auto" })
		}
	}
	if (!plans.length) return finish(H)
	const statics = doc.solids.filter((s) => s.kind === "static" && !s.hidden_3d)
	const ctx = { doc, track, tR, boxOf, bounds, statics, liquids: liquidsOf(doc), resolved, holdPart }
	for (const p of plans) {
		if (p.kind === "hold") H.held.add(p.item)
		if (p.kind === "push") for (const s of p.list) H.hidden.add(s.id)
		if (p.kind === "fixed") for (const s of p.list) H.unmounted.add(s.id)
	}
	H.plans = plans
	H.ctx = ctx
	return finish(H) // (the hands are built by H.fit, once the view has drawn what they hold)
}

const poseIn = (track, s) => {
	const q = track?.frames?.[0]?.placements?.[s.id]
	return { x: q ? q.x : s.at.x, y: q ? q.y : s.at.y, angle: q ? q.angle : (s.angle ?? 0) }
}

/** (Re)build every rig of H for the start poses pf and the track. */
function build(H, pf, track) {
	for (const r of H.rigs) for (const g of r.rigs ?? [r.rig]) H.group.remove(g.root, g.arm)
	H.rigs = []
	H.pickables.length = 0
	const C = H.ctx
	C.track = track
	C.exit = frameExit(C.doc, typeof C.bounds === "function" ? C.bounds() : C.bounds)
	for (const p of H.plans) {
		let r = null
		try {
			if (p.kind === "hold") {
				// the part a pin would hold (the lowest; of a thing that hangs, only one swung out of its hanging line: none when it hangs at rest)
				p.part = C.holdPart ? C.holdPart(p.list) : p.list[0]
				if (!p.part) continue
			}
			if (p.kind === "hold" || p.kind === "fixed") r = holdRig(p, pf, C)
			else if (p.kind === "push") r = pushRig(p, pf, C)
			else if (p.kind === "pour") r = pourRig(p, pf, C)
		} catch (e) {
			console.warn(`hands: ${p.item} could not be posed:`, e)
		}
		if (!r) continue
		for (const g of r.rigs ?? [r.rig]) {
			H.group.add(g.root, g.arm)
			for (const m of g.meshes) {
				m.userData.solidId = r.solidId
				m.userData.hand = true
				// (picked as the item: a held thing's hand only while it holds it, like the pin; never the surface under the cursor, as a stand never is)
				if (p.kind === "hold") m.userData.stand = true
				else m.userData.mount = true
				H.pickables.push(m)
			}
		}
		H.rigs.push(r)
	}
}

function finish(H) {
	H.holds = (item) => H.held.has(item)
	H.hides = (id) => H.hidden.has(id)
	H.noMount = (id) => H.unmounted.has(id)
	H.at = (t) => {
		for (const r of H.rigs) r.at(t)
	}
	H.busy = (t) => H.rigs.some((r) => r.busy?.(t))
	H.fit = (pf, track) => {
		if (!H.plans?.length) return
		build(H, pf, track ?? H.ctx.track)
		H.at(H.last ?? 0)
	}
	const at = H.at
	H.at = (t) => {
		H.last = t
		at(t)
	}
	return H
}

// ---------------------------------------------------------------- holding (held, or fixed for the whole run)
function holdRig(p, pf, C) {
	const list = p.list
	const d = fieldOf(list, pf, C.boxOf)
	const E = extentOf(list, pf)
	let move = p.kind === "hold" ? firstMove(list, C.track, C.tR) : null
	const water = C.liquids.find((L) => E.cx > L.x0 && E.cx < L.x1 && E.cy < L.top && E.cy > L.floor - 0.01) ?? null
	const inWater = !!water
	if (p.kind === "hold" && !move) {
		// it is let go after the run ends (a still) or does not move: which way it would go: up through its liquid if it is lighter, else down
		const rho = densityOf(list, C.doc)
		const layer = water?.layers.find((l) => E.cy >= l.y0 - 1e-9 && E.cy <= l.y1 + 1e-9) ?? water?.layers.at(-1)
		const up = !!layer && rho !== null && rho < layer.density
		move = { x: 0, y: up ? 1 : -1, v: { x: 0, y: 0 }, speed: 0, guess: true }
	}
	const others = C.statics.filter((s) => s.item !== p.item)
	const room = roomAround(E, others, pf)
	const grip = p.grip === "auto" ? autoGrip({ E, move, inWater, room, depth: 2 * halfZ(d) }) : p.grip
	const from = fromFor(grip, p.from ?? "auto", { move, inWater, room })
	if (p.kind === "fixed" && grip === "grip") {
		// a fist round a fixed bar: at its end away from what moves (a magnet held by its far end)
		const movers = C.doc.solids.filter((s) => s.kind === "dynamic" && !s.hidden_3d)
		const mx = movers.length ? movers.reduce((a, s) => a + pf(s).x, 0) / movers.length : E.cx
		if (E.w > 0.07) {
			const end = mx > E.cx ? E.x0 : E.x1
			const at = end + (mx > E.cx ? 1 : -1) * 0.045
			E.cx = at
		}
	}
	const S = solveHold(grip, from, d, E, move)
	const rig = S.rig
	const W0 = S.wrist
	const hold = S.pose
	const open = openOf(hold)
	// the arm runs out of the picture; a hand that lets go goes out the same way
	const armDir = S.armDir.clone()
	// the way out: a polyline from the hold (pathAt(s): the wrist's offset s m along it)
	const way = S.exit
	const pathAt = (sv, out) => {
		out.set(0, 0, 0)
		let left = sv
		for (const e of way) {
			const k = Math.min(left, e.len)
			out.addScaledVector(e.dir, k)
			left -= k
			if (left <= 0) break
		}
		return out
	}
	const last = way[way.length - 1]
	const before = way.slice(0, -1).reduce((a, e) => a + e.len, 0)
	const _o = new THREE.Vector3()
	setArm(rig, clamp(C.exit(W0, armDir) + 0.3, 0.45, 3.2))
	const gone = before + C.exit(_o.copy(W0).add(pathAt(before, new THREE.Vector3())), last.dir) + HL * SIZE + 0.08 // (how far it goes to be out of the picture)
	const solidId = p.part?.id ?? list[0].id
	const tEnd = C.track?.frames?.at(-1)?.t ?? 0
	if (p.kind === "fixed" || C.tR >= tEnd) {
		// held the whole run: a fixed thing, or one let go only after the run ends (a still)
		placeHand(rig, W0, S.X, S.Y)
		applyPose(rig, hold)
		placeArm(rig, armDir)
		return { item: p.item, rig, solidId, grip, from, at() {}, busy: () => false }
	}
	// after the release: a throw is followed through, the fingers open, the hand withdraws along its arm, and is pushed further out wherever the thing
	// it let go would otherwise be in it (from the track: s(t) is the larger of the planned way out and what keeps it clear; it never comes back)
	const tR = C.tR
	const v = move?.v ? V(move.v.x, move.v.y, 0) : V(0, 0, 0)
	const thrown = v.length() > 0.35
	const FT = 0.1 // the follow-through's time
	const follow = (tau) => {
		if (!thrown || tau <= 0) return 0
		const u = Math.min(tau, FT)
		return 0.6 * v.length() * (u - (u * u) / (2 * FT)) // (it starts at 0.6 of the thing's speed and stops at FT)
	}
	const vdir = thrown ? v.clone().normalize() : V(0, 0, 0)
	// the way out: a brisk start (WA, faster than a floater shoots up or a dropped thing falls, so the hand is seen to leave it, never to lift or
	// carry it) to a steady WV, out of the picture
	const T0 = thrown ? FT * 0.6 : 0
	const { a: PA, v: PV } = S.pace
	const tA = PV / PA
	const TW = tA + Math.max(0, gone - 0.5 * PA * tA * tA) / PV
	const plan = (tau) => {
		const u = tau - T0
		if (u <= 0) return 0
		return u < tA ? 0.5 * PA * u * u : 0.5 * PA * tA * tA + PV * (u - tA)
	}
	const N = Math.ceil((T0 + TW + 0.05) * 120)
	const sTab = new Float32Array(N + 1)
	const posesAt = (t) => list.map((s) => poseAt(C.track, s.id, t) ?? pf(s))
	const tmpPose = copyPose(hold)
	const base = new THREE.Vector3()
	let sMax = 0
	for (let k = 0; k <= N; k++) {
		const tau = k / 120
		lerpPose(hold, open, smooth(tau / OPEN_S), tmpPose)
		const dt = d.at(posesAt(tR + tau))
		base.copy(W0).addScaledVector(vdir, follow(tau))
		let s = Math.max(plan(tau), sMax)
		const clear = (sv) => {
			placeHand(rig, _w.copy(base).add(pathAt(sv, _o)), S.X, S.Y)
			applyPose(rig, tmpPose)
			rig.root.updateMatrixWorld(true)
			return clearance(rig, dt) > 0.0008
		}
		if (tau > 0 && !clear(s)) {
			let lo = s
			let hi = s + 0.02
			while (!clear(hi) && hi < s + 1.5) {
				lo = hi
				hi += 0.04
			}
			for (let i = 0; i < 12; i++) {
				const m = (lo + hi) / 2
				if (clear(m)) hi = m
				else lo = m
			}
			s = hi
		}
		sMax = s
		sTab[k] = s
	}
	const P = copyPose(hold)
	const Wt = new THREE.Vector3()
	return {
		item: p.item,
		rig,
		solidId,
		grip,
		from,
		thrown,
		tGone: tR + T0 + TW,
		at(t) {
			const tau = t - tR
			if (tau <= 0) {
				placeHand(rig, W0, S.X, S.Y)
				applyPose(rig, hold)
				placeArm(rig, armDir)
				rig.root.visible = rig.arm.visible = true
				return
			}
			const k = Math.min(N, tau * 120)
			const i = Math.floor(k)
			const s = i >= N ? sTab[N] : sTab[i] + (sTab[i + 1] - sTab[i]) * (k - i)
			lerpPose(hold, open, smooth(tau / OPEN_S), P)
			Wt.copy(W0).addScaledVector(vdir, follow(tau)).add(pathAt(s, _o))
			placeHand(rig, Wt, S.X, S.Y)
			applyPose(rig, P)
			placeArm(rig, armDir)
			const out = s >= gone - 1e-4
			rig.root.visible = rig.arm.visible = !out
		},
		busy: (t) => t > tR - 0.02 && t < tR + T0 + TW + 0.02
	}
}

// ---------------------------------------------------------------- pushing: the hand is the paddle
function pushRig(p, pf, C) {
	const R = refs()
	const rod = p.list.find((s) => s.part === "rod")
	const paddle = p.list.find((s) => s.part === "paddle")
	if (!rod || !paddle) return null
	const P = C.resolved?.[p.item] ?? {}
	const pad = paddle.body
	const q0 = pf(paddle)
	const u0 = V(Math.cos(q0.angle ?? 0), Math.sin(q0.angle ?? 0), 0) // the push's way
	// what it pushes: the nearest thing in front of the paddle (a ball's curve is met by the hands round its middle)
	const face0 = V(q0.x, q0.y, 0).addScaledVector(u0, pad.width / 2)
	let target = null
	let best = 0.04
	for (const s of C.doc.solids) {
		if (s.item === p.item || s.kind !== "dynamic" || s.hidden_3d) continue
		const d = fieldOf([s], pf, C.boxOf)
		const g = d(face0)
		if (g < best) {
			best = g
			target = { s, d }
		}
	}
	const skin = p.skin
	// a ball pushed by open hands: each palm lies flat on it where it touches it (tangent there), a single hand a little toward the camera
	const ball = target && (skin === "hand" || skin === "two hands") ? sphereOf(target.d) : null
	const hands =
		skin === "two hands"
			? [{ side: "left", dz: -0.041 * SIZE, dy: 0.022 * SIZE }, { side: "right", dz: 0.041 * SIZE, dy: -0.022 * SIZE }]
			: [{ side: "left", dz: ball ? Math.min(0.04, 0.35 * ball.r) : 0, dy: 0 }]
	const rigs = []
	const lay = []
	const up = V(0, 1, 0)
	for (const h of hands) {
		const rig = makeRig(h.side)
		let X
		let Y
		let at // the hand's point that meets the paddle's face, in its own frame
		let pz
		let A
		const k = (deg) => [Math.cos(deg * D2R), Math.sin(deg * D2R)]
		if (skin === "finger" || skin === "fist") {
			// the index's tip (or the flat of the fist's first bones) at the face; the forearm behind it, rising a little
			X = u0.clone()
			Y = up.clone()
			pz = copyPose(skin === "finger" ? POSES.point : POSES.fist)
			at = skin === "finger" ? R.pointTip.clone() : V(R.fistFront, -0.004, 0.006)
			const [c, sn] = k(skin === "finger" ? 14 : 10)
			A = u0.clone().multiplyScalar(-c).addScaledVector(up, sn)
		} else {
			// a flat hand, its palm to the push, the fingers up: on a ball, tangent to it where it touches; else leaning 15 degrees into the push; the
			// forearm level behind it (the wrist bent back 80 degrees, as a hand pushing low is)
			const [c, sn] = k(15)
			X = u0.clone().multiplyScalar(sn).addScaledVector(up, c)
			Y = u0.clone().multiplyScalar(-c).addScaledVector(up, sn)
			pz = copyPose(POSES.flat)
			at = V(0.05, -PALM_T / 2, 0)
			const [c2, s2] = k(5)
			A = u0.clone().multiplyScalar(-c2).addScaledVector(up, s2)
		}
		A.add(V(0, 0, h.dz * 1.5)).normalize()
		// where on the thing the hand meets it, as an offset from the paddle's face (which carries it): a hand beside a ball's middle stands where the
		// ball's back is at its height and depth, a little ahead of the face
		let off = V(0, h.dy, h.dz)
		if (ball) {
			const along = u0.clone()
			const across = V(0, 0, 1)
			const side3 = across.clone().cross(along) // (up in the push's frame)
			const r2 = ball.r * ball.r - h.dy * h.dy - h.dz * h.dz
			const P = ball.c.clone().addScaledVector(along, -Math.sqrt(Math.max(0, r2))).addScaledVector(side3, h.dy).addScaledVector(across, h.dz)
			const n = ball.c.clone().sub(P).normalize() // (into the ball)
			Y = n.clone().negate()
			X = up.clone().addScaledVector(n, -up.dot(n)).normalize()
			// (less the air the paddle's face starts with in front of it, so the palm meets the ball when the paddle does)
			const gap = hitAlong(target.d, face0.clone().addScaledVector(u0, -0.2), u0, 0.5)
			off = P.sub(face0).addScaledVector(u0, -(gap === null ? 0 : clamp(gap - 0.2, 0, 0.05)))
		} else if (target && (h.dz || h.dy)) {
			const o = V(q0.x, q0.y, 0).add(V(0, h.dy, h.dz)).addScaledVector(u0, -0.2)
			const hit = hitAlong(target.d, o, u0, 0.5)
			if (hit !== null) off.addScaledVector(u0, clamp(hit - (0.2 + pad.width / 2), 0, 0.03))
		}
		applyPose(rig, pz)
		const atW = offsetOf(rig, at, X, Y)
		rigs.push(rig)
		lay.push({ rig, X, Y, atW, pose: pz, off, A })
	}
	const reach = Math.max(...lay.map((l) => C.exit(V(q0.x, q0.y, 0), l.A)))
	for (const r of rigs) setArm(r, clamp(reach + 0.3 + (P.stroke ?? 0.15), 0.45, 3.2))
	const q = { x: 0, y: 0, angle: 0 }
	const W = new THREE.Vector3()
	const at = (t) => {
		const pp = poseAt(C.track, paddle.id, t, q) ?? q0
		const u = V(Math.cos(pp.angle ?? 0), Math.sin(pp.angle ?? 0), 0)
		const face = V(pp.x, pp.y, 0).addScaledVector(u, pad.width / 2)
		for (const l of lay) {
			W.copy(face).add(l.off).addScaledVector(u, 0.0004).sub(l.atW)
			placeHand(l.rig, W, l.X, l.Y)
			applyPose(l.rig, l.pose)
			placeArm(l.rig, l.A)
		}
	}
	at(0)
	return { item: p.item, rig: rigs[0], rigs, solidId: paddle.id, skin, at, busy: () => false }
}

// ---------------------------------------------------------------- pouring: a hand on the pitcher's handle (a cup's body), tipping with it
const VESSELS = {
	// inner width, inner height, wall (machines/mod_flow.py VESSELS); the model's handle loop (web/models/mod-flow.js): radius 0.3 h at (w + t, -0.45 h)
	pitcher: [0.1, 0.17, 0.003],
	jug: [0.13, 0.22, 0.0025],
	"measuring cup": [0.095, 0.12, 0.0025],
	cup: [0.07, 0.095, 0.002]
}
function pourRig(p, pf, C) {
	const lip = p.list.find((s) => s.part === "lip")
	if (!lip) return null
	const P = C.resolved?.[p.item] ?? {}
	const [w, h, t] = VESSELS[P.vessel] ?? VESSELS.pitcher
	const side = P.pour_to === "left" ? -1 : 1
	const q0 = pf(lip)
	const cup = P.vessel === "cup"
	// in the vessel's own frame (origin at the lip, upright): a vertical bar to wrap, the palm against it from the outside, the fingers round its front
	const R = w / 2 + t
	const bar = cup ? { x: -side * w / 2, r: R, y0: -0.8 * h, y1: -0.2 * h } : { x: -side * (w + t + 0.3 * h), r: 0.0058, y0: -0.45 * h - 0.17 * h, y1: -0.45 * h + 0.17 * h }
	const dBar = (pt) => {
		// a vertical capsule (the handle's outer side) or a cylinder (the cup's body), in the vessel frame
		const y = clamp(pt.y, bar.y0, bar.y1)
		return Math.hypot(pt.x - bar.x, pt.y - y, pt.z) - bar.r
	}
	const rig = makeRig(side > 0 ? "right" : "left")
	// the hand frame in the vessel's frame: the fingers toward the camera, the palm facing the vessel (+side x)
	const X = V(0, 0, 1)
	const Y = V(-side, 0, 0)
	const ym = (bar.y0 + bar.y1) / 2 + (cup ? 0 : 0.004)
	const contact = V(bar.x - side * bar.r, ym, 0)
	const W = contact.clone().sub(offsetOf(rig, V(0.05, -PALM_T / 2 - 0.0003, 0), X, Y))
	placeHand(rig, W, X, Y)
	rig.pose = copyPose(POSES.flat)
	if (cup) rig.pose.t = [0, -30, 120, 10, 10] // (round a cup the thumb lies by its rim, not up in the air)
	applyPose(rig, rig.pose)
	rig.root.updateMatrixWorld(true)
	for (const i of [0, 1, 2, 3]) closeFinger(rig, dBar, i)
	closeFinger(rig, dBar, "t")
	const hold = copyPose(rig.pose)
	const Wv = W.clone()
	// the arm: back from the handle and up, turning half as far as the pitcher tips (the wrist takes the rest)
	const A0 = V(-side * 0.72, 0.56, -0.41).normalize()
	const toWorld = (ang) => {
		const m = new THREE.Matrix4().makeRotationZ(ang)
		m.setPosition(q0.x, q0.y, 0)
		return m
	}
	const base0 = q0.angle ?? 0
	const Mw0 = toWorld(base0)
	const reach = C.exit(Wv.clone().applyMatrix4(Mw0), A0.clone().applyAxisAngle(V(0, 0, 1), base0))
	setArm(rig, clamp(reach + 0.35, 0.45, 3.2))
	const Xw = new THREE.Vector3()
	const Yw = new THREE.Vector3()
	const Ww = new THREE.Vector3()
	const Aw = new THREE.Vector3()
	const tiltAt = (tt) => {
		// the flow module's reading (web/models/mod-flow.js "flow:tip": the model turns by -side * tilt_deg)
		const v = C.track?.state?.[p.item]?.tilt_deg
		if (!Array.isArray(v) || !v.length) return 0
		const f = C.track.frames
		const i = frameIndex(C.track, tt)
		const j = Math.min(i + 1, f.length - 1)
		const a = v[i] ?? v[v.length - 1]
		const b = v[j] ?? a
		const span = f[j].t - f[i].t
		const u = span > 0 ? clamp((tt - f[i].t) / span, 0, 1) : 0
		return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * u : 0
	}
	const at = (tt) => {
		const ang = base0 + -side * tiltAt(tt) * D2R
		const Mw = toWorld(ang)
		Ww.copy(Wv).applyMatrix4(Mw)
		Xw.copy(X).applyAxisAngle(V(0, 0, 1), ang)
		Yw.copy(Y).applyAxisAngle(V(0, 0, 1), ang)
		placeHand(rig, Ww, Xw, Yw)
		applyPose(rig, hold)
		Aw.copy(A0).applyAxisAngle(V(0, 0, 1), base0 + (ang - base0) * 0.5)
		placeArm(rig, Aw)
	}
	at(0)
	return { item: p.item, rig, solidId: lip.id, at, busy: () => false }
}
