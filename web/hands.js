// A person's hand where a person acts in a scene (web/CONTRACT.md "Hands"). Render only: the engine is never told. A held item is held exactly
// still until the scene's release (doc.release), a pusher pushes with its own force, a pitcher is tipped by its own process; the hand shows who does it.
//   holding    a held item (held: true) whose `hand` prop is set: a pinch (thumb and finger tips on it), an open palm under it, the palm pressing it
//              down or the whole hand round it, in place of the pull pin on its post (or a starting gate). At the release the fingers open (0.08 s)
//              and the hand goes out of the picture along its arm (a press lifts just off, slides off it, then rises calmly); it never passes through
//              the thing it let go (it is kept clear of it frame by frame, from the track). A thing that leaves moving (start_speed: a throw) is
//              followed through first.
//   fixed      a fixed item whose `hand` prop is set (a magnet held in a fist) is held for the whole run, in place of its stand.
//   pushing    a pusher whose `hand` is finger | hand | two hands | fist: the hand rests on the thing it pushes and moves with the paddle's face
//              once that reaches it (the paddle is the engine's push), kept clear of it every frame; housing, rod and paddle are not drawn; two
//              hands one above the other (side by side across a wide thing), their arms parallel and apart.
//   pouring    a pitcher whose `hand` is "hand": the hand grips its handle (a cup round its body) and tips with it.
// Every hand is real size (a child's of about nine, 14.5 cm from the wrist crease to the middle fingertip: the hand the engine's document names,
// "a child's hand and forearm in a blue sleeve") whatever the push: a harder push is the pusher's force and time, never a bigger hand. Skin a
// neutral mid tone, a plain sleeve; a short forearm to its cuff (ARM), leaving the hand from the picture's nearer edge or from above as a child's
// wrist bends easily, through nothing (no person, no sleeve out of the picture). Every placement is tried every way its grip or skin allows and
// the cleanest kept: what touches is 0.4-0.5 mm from what it touches, never in it; nothing else of the hand within 1 mm of anything (3 mm
// wanted), its arm 3 mm clear.
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
const PALM_ROOM = 0.04 // m under a thing for a palm to go under it (the hand 2.2 cm thick, and air), else it is held from above
const PINCH_ROOM = 0.03 // ... for a pinch from the side (the curled fingers hang below it), else from above
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

// ---------------------------------------------------------------- the rig contract and the poses
// The hand is one LEFT hand in metres, its wrist at the origin, the fingers along +x, the back of the hand +y (the palm faces -y), the thumb toward
// +z; a right hand is it mirrored (the root's scale z = -1). Its bones (web/models/hand.glb, skinned to them by name): forearm (the root, at the
// wrist, pointing -x), wrist (the hand's root), palm, thumb_1 thumb_2 thumb_3, index_1 index_2 index_3, middle_1 .. 3, ring_1 .. 3, pinky_1 .. 3.
// Each finger bone's local x runs along the bone, its local z is the joint's bend axis (the thumb's side at rest: a turn of -a about z curls the
// finger a degrees toward the palm) and its local y the spread axis (+ toward the little finger). The thumb's bones are turned about themselves at
// rest (REST below: the nail to the side, the pad toward the fingers), so their local z too is their bend axis.
// A pose is each bone's turn from the rest pose (hand.glb's: a relaxed flat hand, the fingers a little apart): {bone: [x, y, z]} in degrees, put
// on as bone.quaternion = rest × Euler(x, y, z, "YZX") (tools/hands/README.md's order: x the twist, y = -spread, z = -flex). The forearm and wrist
// bones are not in a pose: the hand's placement turns them (placeArm, armTurns).
export const DIGITS = ["index", "middle", "ring", "pinky"]
export const POSE_BONES = ["palm", "thumb_1", "thumb_2", "thumb_3", ...DIGITS.flatMap((d) => [`${d}_1`, `${d}_2`, `${d}_3`])]
export const BONES = ["forearm", "wrist", ...POSE_BONES]
// The rest pose's turn of each bone in its parent's frame: web/models/hand.glb's (tools/hands/build_hand.py), as quaternions [x, y, z, w], so a
// pose is the same joint turns on it and on the procedural hand below. The fingers a little apart (the index 3.5 degrees toward the thumb, the
// ring 3 and the little finger 7 away), straight; the thumb's metacarpal 40 degrees out from the index, in the palm's plane, its nail turned 60
// degrees from the back of the hand, its two joints a little bent toward the fingers.
const REST_TURNS = {
	palm: [0, 0, 0, 1],
	thumb_1: [0.4169, -0.3146, 0.1351, 0.842],
	thumb_2: [0.0472, 0.0943, -0.1038, 0.989],
	thumb_3: [0.0138, 0.0439, -0.0549, 0.9974],
	index_1: [0, -0.0305, 0, 0.9995],
	index_2: [0, 0, 0, 1],
	index_3: [0, 0, 0, 1],
	middle_1: [0, 0, 0, 1],
	middle_2: [0, 0, 0, 1],
	middle_3: [0, 0, 0, 1],
	ring_1: [0, 0.0262, 0, 0.9997],
	ring_2: [0, 0, 0, 1],
	ring_3: [0, 0, 0, 1],
	pinky_1: [0, 0.061, 0, 0.9981],
	pinky_2: [0, 0, 0, 1],
	pinky_3: [0, 0, 0, 1]
}
const _eu = new THREE.Euler()
const turnQ = (v, out = new THREE.Quaternion(), order = "YZX") => out.setFromEuler(_eu.set(v[0] * D2R, v[1] * D2R, v[2] * D2R, v[3] ?? order))
export const REST = Object.fromEntries(Object.entries(REST_TURNS).map(([b, q]) => [b, new THREE.Quaternion(...q).normalize()]))
const ZERO3 = [0, 0, 0]
/** A full pose (every pose bone, [x, y, z] degrees from the rest pose) from the bones given. */
const pose = (turns = {}) => Object.fromEntries(POSE_BONES.map((b) => [b, [...(turns[b] ?? ZERO3)]]))
// Each digit's joints: z bends it (− toward the palm), y spreads it (+ toward the little finger), x twists it. Read the rows as [knuckle, middle
// joint, end joint] for a finger and [base (the metacarpal, in the ball of the thumb), knuckle, end] for the thumb.
const digits = (rows) => {
	const o = {}
	for (const [d, js] of Object.entries(rows)) js.forEach((v, j) => (o[`${d}_${j + 1}`] = v))
	return pose(o)
}
export const POSES = {
	// the fingers straight (barely bent) and a little apart, the thumb out beside the index, its nail turned to the side
	flat: digits({
		index: [[0, -1.5, -2], [0, 0, -5], [0, 0, -3]],
		middle: [[0, 0, -2], [0, 0, -4], [0, 0, -2]],
		ring: [[0, 1, -2], [0, 0, -5], [0, 0, -3]],
		pinky: [[0, 3, -3], [0, 0, -6], [0, 0, -3]],
		thumb: [[35.6, -7.9, -6.1], [-4.3, -10.9, 6.4], [-1.3, -5.1, 0.4]]
	}),
	// a hand at ease: each finger a little more curled than the one before it, the thumb loosely in
	relaxed: digits({
		index: [[0, -1.5, -16], [0, 0, -23], [0, 0, -11]],
		middle: [[0, 0, -19], [0, 0, -26], [0, 0, -12]],
		ring: [[0, 0, -22], [0, 0, -30], [0, 0, -14]],
		pinky: [[0, 0, -27], [0, 0, -34], [0, 0, -15]],
		thumb: [[37.4, -15.5, -9.5], [-4.2, -11.3, 0.4], [-1.3, -5.2, -5.6]]
	}),
	// closed, the thumb outside, lying across the index's and the middle finger's middle bones under the knuckles, never past the fist's front (the
	// knuckle about 86 degrees and the middle joint 109, so the tips come back to the palm, as in a real fist; the fingers drawn together)
	fist: digits({
		index: [[0, 5.5, -86], [0, 0, -109], [0, 0, -63]],
		middle: [[0, 0, -88], [0, 0, -110], [0, 0, -62]],
		ring: [[0, -5, -88], [0, 0, -109], [0, 0, -61]],
		pinky: [[0, -13, -85], [0, 0, -106], [0, 0, -59]],
		thumb: [[10.9, -36.4, -19], [-4.8, -13.6, -27.5], [-2.4, -7.1, -56.6]]
	}),
	// the index straight ahead, the others curled to the palm, the thumb tucked over the middle finger's middle bone
	point: digits({
		index: [[0, 3.5, -2], [0, 0, -7], [0, 0, -4]],
		middle: [[0, 0, -88], [0, 0, -110], [0, 0, -62]],
		ring: [[0, -5, -88], [0, 0, -109], [0, 0, -61]],
		pinky: [[0, -13, -85], [0, 0, -106], [0, 0, -59]],
		thumb: [[17.4, -33.9, -31.9], [-4.7, -13.4, -25.5], [-1.4, -5.5, -17.6]]
	}),
	// pressing with the palm: the fingers flat and together, a slight bend at the knuckles, the thumb alongside in the palm's plane
	press: digits({
		index: [[0, 1.5, -14], [0, 0, -11], [0, 0, -6]],
		middle: [[0, 0, -15], [0, 0, -10], [0, 0, -5]],
		ring: [[0, -1, -16], [0, 0, -12], [0, 0, -6]],
		pinky: [[0, -2, -18], [0, 0, -14], [0, 0, -6]],
		thumb: [[36.3, -1.1, -8.7], [-4.2, -11.2, 1.4], [-1.3, -5.2, -3.6]]
	}),
	// the thumb's and the index's tips meeting (each closes onto what it holds), the other fingers curled out of the way
	pinch: digits({
		index: [[0, 1.5, -32], [0, 0, -40], [0, 0, -14]],
		middle: [[0, 0, -60], [0, 0, -96], [0, 0, -60]],
		ring: [[0, -5, -70], [0, 0, -104], [0, 0, -62]],
		pinky: [[0, -13, -74], [0, 0, -106], [0, 0, -62]],
		thumb: [[36.8, -13.4, -39.9], [-4.2, -11, 4.4], [-1.3, -5.1, 0.4]]
	}),
	// the fingers curved as round a cup or a handle, the thumb across from them
	cup: digits({
		index: [[0, 0.5, -34], [0, 0, -47], [0, 0, -25]],
		middle: [[0, 0, -36], [0, 0, -49], [0, 0, -26]],
		ring: [[0, -1, -38], [0, 0, -51], [0, 0, -27]],
		pinky: [[0, -2, -41], [0, 0, -54], [0, 0, -27]],
		thumb: [[33.6, -31.1, -23.1], [-4.2, -11.3, 0.4], [-1.3, -5.4, -11.6]]
	})
}

// how far each finger joint may bend from the rest pose (degrees): the knuckle, the middle joint, the end joint
const FLEX_MAX = [95, 110, 85]
/** The pose k of the way from a to b (each bone's turn component by component; out may be a). */
export function lerpPose(a, b, k, out = copyPose(a)) {
	for (const n of POSE_BONES) {
		const A = a[n] ?? ZERO3
		const B = b[n] ?? ZERO3
		const O = (out[n] ??= [0, 0, 0])
		for (let c = 0; c < 3; c++) O[c] = A[c] * (1 - k) + B[c] * k // (exactly a at 0 and b at 1)
	}
	return out
}
const copyPose = (p) => pose(p)

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

// ---------------------------------------------------------------- the arm: a short forearm to its cuff, never a sleeve out of the picture
// The forearm is seen from the wrist to the sleeve's cuff and a hand's breadth of sleeve beyond it (ARM.len from the wrist), no more: it leaves
// the hand from the picture's nearer edge (or from above) rising ARM.side degrees over the level (ARM.above from above: 15 to 35 off the
// upright), never along the floor or a table, never through anything (ARM.r round its line), its wrist bent no further than a child's goes
// easily (WRIST: the back of the hand toward the forearm up to 75 degrees, the palm toward it 60; toward the thumb 22, away from it 32). A hand
// with a thing on its open palm may have its forearm slope down to the elbow as much instead (ARM.below: a tray held out), with room under it. Its
// clearance is a tapered capsule round its line, from ARM.from m out of the wrist (the hand's own wrist sphere covers the rest) at ARM.r0 to the
// sleeve's end at ARM.r1 (a child's forearm 3.8 cm thick near the wrist, the sleeve over it 5.6 cm); ARM.r, the most, where arms meet arms.
export const ARM = { len: 0.09, from: 0.02, r0: 0.019, r1: 0.028, r: 0.028, side: [15, 35], above: [55, 75], below: [-35, -15] }
export const WRIST = { ext: 75, flex: 60, thumb: 22, away: 32 }
/** The sleeve to `length` m from the wrist (ARM.len: a short arm whatever is asked; the picture's edge is never reached for). */
export function setArm(rig, length = ARM.len) {
	rig.length = Math.min(length, ARM.len)
	const L = Math.max(0.01, rig.length / SIZE - 0.044) // (in the arm's own, scaled frame)
	rig.sleeve.scale.set(L, ARM_R + 0.0015, (ARM_R + 0.0015) * 1.1)
}

/** The rig's bones by the contract's names (the procedural hand's joints; a palm bone it has none of). */
export function bonesOf(rig) {
	if (rig.bones) return rig.bones
	const B = { forearm: rig.arm, wrist: rig.root, palm: null, thumb_1: rig.t.cmc, thumb_2: rig.t.mcp, thumb_3: rig.t.ip }
	DIGITS.forEach((d, i) => {
		B[`${d}_1`] = rig.f[i].mcp
		B[`${d}_2`] = rig.f[i].pip
		B[`${d}_3`] = rig.f[i].dip
	})
	rig.bones = B
	return B
}
/** The spheres every rule reads (clearance, closing, sliding, the tests), on the rig's bones by the contract's names and in the hand's own measures
 *  (model units, as the rig's root scales them): the palm's slab, the wrist (flush with the palm, never under it), three along each finger bone, the
 *  ball of the thumb and its two bones: [{obj, p, r, link}] (link: "palm", "wrist", "f<finger>.<bone>", "t.<bone>"). A hand.glb rig gets the same
 *  on its own bones. */
export function fitProxies(rig) {
	const B = bonesOf(rig)
	const out = []
	const sph = (obj, x, y, z, r, link) => out.push({ obj, p: new THREE.Vector3(x, y, z), r, link })
	for (const [x, z] of [[0.022, 0.02], [0.022, -0.02], [0.046, 0.022], [0.046, -0.022], [0.068, 0.024], [0.068, 0], [0.068, -0.024], [0.044, 0]]) sph(B.wrist, x, 0, z, PALM_T / 2, "palm")
	sph(B.wrist, -0.004, 0, 0.011, 0.0135, "wrist")
	sph(B.wrist, -0.004, 0, -0.011, 0.0135, "wrist")
	FINGERS.forEach((F, i) => {
		for (let k = 0; k < 3; k++) {
			const o = B[`${DIGITS[i]}_${k + 1}`]
			const r0 = F.r * TAPER[k]
			const r1 = F.r * TAPER[k + 1]
			const L = F.L[k]
			sph(o, 0, 0, 0, r0, `f${i}.${k}`)
			sph(o, L * 0.5, 0, 0, (r0 + r1) / 2, `f${i}.${k}`)
			sph(o, k === 2 ? L - r1 : L, 0, 0, r1, `f${i}.${k}`)
		}
	})
	// (the ball of the thumb round its metacarpal: a palm laid flat lies on it too, 2-3 mm under the palm's middle)
	sph(B.thumb_1, THUMB.L[0] * 0.3, 0, 0, 0.0115, "t.0")
	sph(B.thumb_1, THUMB.L[0] * 0.75, 0, 0, 0.0105, "t.0")
	sph(B.thumb_2, 0, 0, 0, THUMB.r[1], "t.1")
	sph(B.thumb_2, THUMB.L[1] * 0.5, 0, 0, (THUMB.r[1] + THUMB.r[2]) / 2, "t.1")
	sph(B.thumb_3, 0, 0, 0, THUMB.r[2], "t.2")
	sph(B.thumb_3, THUMB.L[2] * 0.5, 0, 0, (THUMB.r[2] + THUMB.r[3]) / 2, "t.2")
	sph(B.thumb_3, THUMB.L[2] - THUMB.r[3], 0, 0, THUMB.r[3], "t.2")
	rig.spheres = out
	return out
}
/** A rig for the rules: makeRig's hand with its collision spheres on its bones (fitProxies). */
export function newRig(side = "left") {
	const r = makeRig(side)
	fitProxies(r)
	return r
}
const _pq = new THREE.Quaternion()
/** Put pose P (each bone's turn from the rest pose, degrees) on the rig's bones. */
export function applyPose(rig, P) {
	if (P !== rig.pose) {
		const Q = (rig.pose ??= pose())
		for (const n of POSE_BONES) {
			const v = P[n] ?? ZERO3
			const o = (Q[n] ??= [0, 0, 0])
			o[0] = v[0]
			o[1] = v[1]
			o[2] = v[2]
		}
	}
	const B = bonesOf(rig)
	for (const n of POSE_BONES) {
		const o = B[n]
		if (o) o.quaternion.copy(REST[n]).multiply(turnQ(rig.pose[n], _pq))
	}
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
/** For a rig skinned to the contract's bones: the forearm bone's turn (in the hand's parent frame: world) for an arm along A, the bone pointing
 *  -x so its x is -A, the hand turned the least way that takes its x there (the forearm takes the hand's roll: no twist at the wrist), and the wrist bone's
 *  turn in the forearm's frame (the bend wristOf measures). X, Y: the hand's axes as placeHand takes them (a left hand's model frame; for a
 *  right hand, the left mirrored by its root, give them as its left twin would have them). -> {forearm, wrist} (Quaternions). */
export function armTurns(X, Y, A) {
	const x = X.clone().normalize()
	const y = Y.clone().addScaledVector(x, -Y.dot(x)).normalize()
	const z = x.clone().cross(y)
	const fx = A.clone().normalize().negate()
	const Hq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
	// (the forearm is the hand turned the least way that takes its x along the arm: the wrist only bends, its roll is the forearm's)
	const F = new THREE.Quaternion().setFromUnitVectors(x, fx).multiply(Hq)
	return { forearm: F, wrist: F.clone().invert().multiply(Hq) }
}
/** Place the arm at the hand's wrist, along world direction A (from the wrist toward the elbow), its width across the hand's z (the procedural
 *  arm's own x runs along A; the contract's forearm bone points the other way: armTurns). */
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
/** The bends that close one digit (i 0..3 a finger, "t" the thumb), each {get, set, max (most degrees), k (its share of a step), link (the part it
 *  carries)}: a finger's three joints about their z; the thumb's base toward the palm's side (about its y) and its two joints about their z. */
function closers(P, i, most) {
	if (i === "t")
		return [
			// (the thumb's metacarpal is the ball of the thumb, part of the palm: a thing resting on the palm touches it, so it is not a part that stops
			// the closing; the thumb's swing toward the palm stops where its phalanges touch)
			{ get: () => -P.thumb_1[1], set: (v) => (P.thumb_1[1] = -v), max: most?.[0] ?? 50, k: 0.7, link: "t.1" },
			{ get: () => -P.thumb_2[2], set: (v) => (P.thumb_2[2] = -v), max: most?.[1] ?? 50, k: 1, link: "t.1" },
			{ get: () => -P.thumb_3[2], set: (v) => (P.thumb_3[2] = -v), max: most?.[2] ?? 65, k: 1, link: "t.2" }
		]
	const d = DIGITS[i]
	return [1, 2, 3].map((j) => ({ get: () => -P[`${d}_${j}`][2], set: (v) => (P[`${d}_${j}`][2] = -v), max: most?.[j - 1] ?? FLEX_MAX[j - 1], k: [1, 1.15, 0.75][j - 1], link: `f${i}.${j - 1}` }))
}
/** Close one finger (i 0..3, or "t" the thumb) from its pose in rig.pose toward its limits, all its joints together, each stopping where the part
 *  beyond it touches the field (`gap` m from it: the last step is halved until it is within a tenth of a millimetre of that); `most` caps the bends
 *  (degrees from the rest pose, per joint). Underactuated closing, as a gripper's fingers close. -> the parts that touch ([link]). */
function closeFinger(rig, d, i, { gap = 0.0005, most = null, step = 1.5 } = {}) {
	const P = rig.pose
	const isT = i === "t"
	const acc = closers(P, i, most)
	const top = isT ? rig.t.cmc : rig.f[i].mcp
	const links = isT ? ["t.1", "t.2"] : acc.map((a) => a.link)
	const pose1 = () => {
		applyPose(rig, P)
		top.updateMatrixWorld(true)
	}
	const gapNow = () => {
		pose1()
		return clearance(rig, d, (l) => links.includes(l))
	}
	rig.root.updateMatrixWorld(true)
	const g0 = gapNow()
	// (already in it: open it a little until it is not, at most 30 degrees a joint, and close it onto it again from there; failing that it stays as it
	// was; already on it: it stays)
	if (g0 < 0) {
		const was = acc.map((a) => a.get())
		for (let n = 0; n < 15 && gapNow() < 0; n++) for (const a of acc) a.set(a.get() - 2)
		if (gapNow() < 0) {
			acc.forEach((a, j) => a.set(was[j]))
			applyPose(rig, P)
			return []
		}
	} else if (g0 < gap) {
		applyPose(rig, P)
		return links.filter((l) => clearance(rig, d, (k) => k === l) < gap)
	}
	const linkOf = (j) => (l) => l === acc[j].link || (isT && j === 0 && l === "t.2")
	// (the thumb's base carries the ball of the thumb: it never takes that nearer than it was, nor nearer than `gap`)
	const t0 = isT ? Math.min(gap, clearance(rig, d, (l) => l === "t.0")) - 1e-5 : 0
	const hitAt = (j, upTo = j) => {
		for (let k = active; k <= upTo; k++) if (clearance(rig, d, linkOf(k)) < gap) return true
		return isT && active === 0 && clearance(rig, d, (l) => l === "t.0") < t0
	}
	const touched = []
	let active = 0 // joints before this one are stopped
	for (let n = 0; n < 200 && active < acc.length; n++) {
		const prev = acc.map((a) => a.get())
		const next = acc.map((a, j) => (j < active ? a.get() : Math.max(a.get(), Math.min(a.max, a.get() + step * a.k))))
		if (next.every((v, j) => v <= prev[j] + 1e-9)) break
		const at = (u) => {
			for (let j = active; j < acc.length; j++) acc[j].set(prev[j] + (next[j] - prev[j]) * u)
			pose1()
		}
		at(1)
		// which part touches first, from the tip back: it stops its own joint and the ones before it (the ball of the thumb stops the thumb's base)
		let hit = -1
		for (let j = acc.length - 1; j >= active; j--) {
			if (clearance(rig, d, linkOf(j)) < gap) {
				hit = j
				break
			}
		}
		if (hit < 0 && isT && active === 0 && clearance(rig, d, (l) => l === "t.0") < t0) hit = 0
		if (hit < 0) continue
		// (the step that reached it, halved until that part, and every one before it, is just `gap` from it)
		const upTo = hit
		const parts = (l) => {
			for (let j = active; j <= upTo; j++) if (linkOf(j)(l)) return true
			return false
		}
		let lo = 0
		let hi = 1
		for (let k = 0; k < 10; k++) {
			const m = (lo + hi) / 2
			at(m)
			if (hitAt(upTo)) hi = m
			else lo = m
		}
		at(lo)
		// (the part that touches: the nearest of those it stopped)
		let tl = acc[hit].link
		let tc = Infinity
		for (const S of rig.spheres) {
			if (!(parts(S.link) || (isT && active === 0 && S.link === "t.0"))) continue
			_w.copy(S.p).applyMatrix4(S.obj.matrixWorld)
			const c = d(_w) - S.r * SIZE
			if (c < tc) {
				tc = c
				tl = S.link
			}
		}
		touched.push(tl)
		active = hit + 1
	}
	applyPose(rig, P)
	return touched
}

// ---------------------------------------------------------------- the hand's own reference points (with the root at the origin)
const ref = { built: false }
function refs() {
	if (ref.built) return ref
	const r = newRig("left")
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
	ref.pointTip = tipOf(r, 0).add(new THREE.Vector3(FINGERS[0].r * TAPER[3], 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(r.f[0].dip.matrixWorld))) // (the index's very tip)
	// the palm's middle and its heel (the ball of the hand over the wrist), on its surface: where a palm presses and where a pushing hand meets
	ref.palmC = new THREE.Vector3(0.046, -PALM_T / 2 - 0.0003, 0)
	ref.heel = new THREE.Vector3(0.022, -PALM_T / 2 - 0.0003, -0.004)
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

// ---------------------------------------------------------------- the rules' geometry: the hand's spheres, the arm's line, how far apart, the wrist
const UP = new THREE.Vector3(0, 1, 0)
const FRONT = new THREE.Vector3(0, 0, 1) // (toward the camera: every view looks along -z)
/** The rig's spheres in world space as it stands now: [{c, r, link}] (its matrices must be current). */
export function handSpheres(rig) {
	return rig.spheres.map((S) => ({ c: S.p.clone().applyMatrix4(S.obj.matrixWorld), r: S.r * SIZE, link: S.link }))
}
/** The forearm's line out of wrist W along unit A (toward the elbow): from ARM.from to ARM.len m, ARM.r round it. */
export const armLine = (W, A) => ({ a: W.clone().addScaledVector(A, ARM.from), b: W.clone().addScaledVector(A, ARM.len), r: ARM.r })
const _sa = new THREE.Vector3()
const _sb = new THREE.Vector3()
const _sc = new THREE.Vector3()
/** The least distance between segments p0 p1 and q0 q1 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistance(p0, p1, q0, q1) {
	const d1 = _sa.subVectors(p1, p0)
	const d2 = _sb.subVectors(q1, q0)
	const r = _sc.subVectors(p0, q0)
	const a = d1.dot(d1)
	const e = d2.dot(d2)
	const f = d2.dot(r)
	let s = 0
	let t = 0
	if (a <= 1e-14 && e <= 1e-14) return p0.distanceTo(q0)
	if (a <= 1e-14) t = clamp(f / e, 0, 1)
	else {
		const c = d1.dot(r)
		if (e <= 1e-14) s = clamp(-c / a, 0, 1)
		else {
			const b = d1.dot(d2)
			const den = a * e - b * b
			s = den > 1e-14 ? clamp((b * f - c * e) / den, 0, 1) : 0
			t = (b * s + f) / e
			if (t < 0) {
				t = 0
				s = clamp(-c / a, 0, 1)
			} else if (t > 1) {
				t = 1
				s = clamp((b - c) / a, 0, 1)
			}
		}
	}
	return Math.hypot(r.x + d1.x * s - d2.x * t, r.y + d1.y * s - d2.y * t, r.z + d1.z * s - d2.z * t)
}
/** The distance from point p to segment a b. */
export function pointSegment(p, a, b) {
	const ab = _sa.subVectors(b, a)
	const L = ab.lengthSq()
	const t = L > 1e-14 ? clamp(_sb.subVectors(p, a).dot(ab) / L, 0, 1) : 0
	return _sc.copy(a).addScaledVector(ab, t).distanceTo(p)
}
/** The least gap (m; negative where they overlap) between two placed hands, each {spheres (handSpheres), line (armLine)}: hand to hand, arm to arm
 *  and each hand to the other's arm. */
export function handsGap(A, B) {
	let g = segmentDistance(A.line.a, A.line.b, B.line.a, B.line.b) - A.line.r - B.line.r
	for (const s of A.spheres) {
		g = Math.min(g, pointSegment(s.c, B.line.a, B.line.b) - s.r - B.line.r)
		for (const t of B.spheres) g = Math.min(g, s.c.distanceTo(t.c) - s.r - t.r)
	}
	for (const t of B.spheres) g = Math.min(g, pointSegment(t.c, A.line.a, A.line.b) - t.r - A.line.r)
	return g
}
const _ap = new THREE.Vector3()
/** The arm's least clearance from field d (its line sampled, less its radius there): out of wrist W along A. */
export function armClearance(d, W, A, n = 7) {
	let m = Infinity
	for (let i = 0; i <= n; i++) {
		_ap.copy(W).addScaledVector(A, ARM.from + ((ARM.len - ARM.from) * i) / n)
		m = Math.min(m, d(_ap) - (ARM.r0 + ((ARM.r1 - ARM.r0) * i) / n))
	}
	return m
}
/** How the wrist is bent for a hand of `side` turned X (to the fingers), Y (its back) whose arm leaves along A (to the elbow), degrees: {bend (the
 *  whole), ext (the back of the hand toward the forearm +, the palm toward it -), dev (toward the thumb +, away -)}. */
export function wristOf(side, X, Y, A) {
	const f = _sa.copy(A).negate()
	const c = clamp(f.dot(X), -1, 1)
	const bend = Math.acos(c) / D2R
	const s = _sb.crossVectors(f, X)
	const L = s.length()
	if (L < 1e-9) return { bend, ext: c > 0 ? 0 : 180, dev: 0 }
	s.multiplyScalar(1 / L)
	const z = _sc.crossVectors(X, Y) // (a left hand's thumb's side, a right hand's little finger's)
	return { bend, ext: bend * s.dot(z), dev: bend * s.dot(Y) * (side === "right" ? 1 : -1) }
}
export const wristOk = (w) => w.ext <= WRIST.ext && w.ext >= -WRIST.flex && w.dev <= WRIST.thumb && w.dev >= -WRIST.away
/** An arm's rise over the level (degrees). */
export const armRise = (A) => Math.asin(clamp(A.y / (A.length() || 1), -1, 1)) / D2R
/** Unit horizontal h turned `deg` degrees toward the camera (+z) about the upright. */
function towardCamera(h, deg) {
	const c = FRONT.clone().addScaledVector(h, -FRONT.dot(h))
	if (c.lengthSq() < 1e-9) return h.clone()
	c.normalize()
	return h.clone().multiplyScalar(Math.cos(deg * D2R)).addScaledVector(c, Math.sin(deg * D2R)).normalize()
}
/** The arm's way out of a hand of `side` placed at wrist W, turned X (to the fingers) and Y (its back): `from` "left" (the arm runs to -x), "right"
 *  (+x), "above", or a unit level way {way} (behind a push); rising as ARM says (from above: 15 to 35 degrees off the upright), every one tried
 *  with its wrist (WRIST) and its line clear of field d by `margin`; the easiest wrist and the way nearest `prefer` win ({phi: degrees off the side's
 *  way toward the camera, rise, ext, dev, way: a level unit the arm should go along from above}). -> {A, rise, phi, wrist, clear, ok, cost}. */
export function chooseArm(side, W, X, Y, from, d, prefer = {}, margin = 0.003) {
	return bestArm(side, W, X, Y, armWays(from, prefer), d, prefer, margin)
}
/** The cheapest of arm ways `ways` for a hand of `side` at W, X, Y (wristPart, withClearance), trying their lines against field d cheapest wrist
 *  first: a line is only tried while it could still win. */
function bestArm(side, W, X, Y, ways, d, prefer = {}, margin = 0.003) {
	const pre = ways.map((c) => wristPart(side, X, Y, c, prefer)).sort((a, b) => a.base - b.base)
	let best = null
	for (const e of pre) {
		if (best && e.base >= best.cost) break
		const r = withClearance(e, W, d, margin)
		if (!best || r.cost < best.cost) best = r
	}
	return best
}
/** An arm way's wrist and preference, before its line is tried: {c, w, ok, wf, base}. */
function wristPart(side, X, Y, c, prefer = {}) {
	const w = wristOf(side, X, Y, c.A)
	const ok = wristOk(w)
	// (a wrist past what it bends easily is a fault, weighed by how far: the least faulty stands if nothing is clean)
	const wf = ok ? 0 : Math.max(w.ext - WRIST.ext, -WRIST.flex - w.ext, w.dev - WRIST.thumb, -WRIST.away - w.dev, 0) / 10 + 1
	return { c, w, ok, wf, base: wf * 100 + ((w.ext - (prefer.ext ?? 20)) / 30) ** 2 + ((w.dev - (prefer.dev ?? -6)) / 15) ** 2 + c.pref }
}
/** ... with its line tried against field d: {A, rise, phi, wrist, clear, ok, fault, cost} (an arm through something is a fault, by how far). */
function withClearance(e, W, d, margin = 0.003) {
	const clear = d ? armClearance(d, W, e.c.A) : Infinity
	const cf = clear >= margin ? 0 : 1 + (margin - clear) * 200
	return { A: e.c.A.clone(), rise: e.c.rise, phi: e.c.phi, wrist: e.w, clear, ok: e.wf + cf === 0, fault: e.wf + cf, cost: e.base + cf * 100 }
}
/** The ways an arm may leave a hand (see chooseArm): [{A, rise, phi, pref}]. */
export function armWays(from, prefer = {}) {
	const out = []
	const way = (h, e, phi, pref) => out.push({ A: h.clone().multiplyScalar(Math.cos(e * D2R)).addScaledVector(UP, Math.sin(e * D2R)).normalize(), rise: e, phi, pref })
	if (from === "above") {
		const pw = prefer.way ? prefer.way.clone().setY(0).normalize() : null
		for (let e = ARM.above[0]; e <= ARM.above[1] + 1e-9; e += 5)
			for (let k = 0; k < 24; k++) {
				const h = V(Math.cos(k * 15 * D2R), 0, Math.sin(k * 15 * D2R))
				const off = pw ? Math.acos(clamp(h.dot(pw), -1, 1)) / D2R : 0
				// (from above: rising to the upright less 25 degrees, along the way asked, a little behind rather than toward the camera)
				way(h, e, k * 15, ((e - (prefer.rise ?? 65)) / 12) ** 2 + (off / 45) ** 2 + (h.z > 0 ? (h.z / 0.7) ** 2 : 0))
			}
	} else {
		const base = from === "left" ? V(-1, 0, 0) : from === "right" ? V(1, 0, 0) : from.way.clone().setY(0).normalize()
		for (let e = ARM.side[0]; e <= ARM.side[1] + 1e-9; e += 5)
			for (let phi = -60; phi <= 40; phi += 10) way(towardCamera(base, phi), e, phi, ((e - (prefer.rise ?? 25)) / 12) ** 2 + ((phi - (prefer.phi ?? -20)) / 30) ** 2)
		// (under a thing on the palm: sloping down to the elbow instead, a little less wanted than rising)
		if (prefer.below)
			for (let e = ARM.below[0]; e <= ARM.below[1] + 1e-9; e += 5)
				for (let phi = -60; phi <= 40; phi += 10) way(towardCamera(base, phi), e, phi, 0.5 + ((e + 25) / 12) ** 2 + ((phi - (prefer.phi ?? -20)) / 30) ** 2)
	}
	return out
}
/** A field that is the least of several (each may be null). */
const fieldMin = (...fs) => {
	const L = fs.filter(Boolean)
	return L.length === 1 ? L[0] : (p) => {
		let m = Infinity
		for (const f of L) m = Math.min(m, f(p))
		return m
	}
}
const scratchRigs = {}
/** A rig of `side` for trying placements (never drawn). */
const scratchRig = (side) => (scratchRigs[side] ??= newRig(side))
/** Place scratch rig `side` at W, X, Y in pose P, its matrices current. */
function tryHand(side, W, X, Y, P) {
	const r = scratchRig(side)
	placeHand(r, W, X, Y)
	applyPose(r, P)
	r.root.updateMatrixWorld(true)
	return r
}
/** Slide a hand (scratch rig `side`, turned X, Y, in pose P, its wrist at W) along unit u until its nearest part is `gap` from field d: -> the wrist
 *  (W moved) and that part's link, or null when nothing is met within `max`. */
function slideTo(side, W, X, Y, P, d, u, gap = 0.0004, max = 0.6, links = null) {
	// (the hand only moves along u: its spheres once, then moved with it; `links`: only those parts count)
	const sp = handSpheres(tryHand(side, W, X, Y, P)).filter((S) => !links || links(S.link))
	let s = 0
	for (let i = 0; i < 80; i++) {
		let m = Infinity
		let link = null
		for (const S of sp) {
			_w.copy(S.c).addScaledVector(u, s)
			const c = d(_w) - S.r
			if (c < m) {
				m = c
				link = S.link
			}
		}
		const step = m - gap
		if (Math.abs(step) < 5e-5) return { W: W.clone().addScaledVector(u, s), link, clear: m }
		if (s + step > max) return null
		s += step * (step > 0 ? 0.97 : 1)
	}
	return null
}

// ---------------------------------------------------------------- where the picture ends (a hand that lets go leaves it; its nearer edge)
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

/** Statics (not of the item) over or under the thing's extent E across its width: {above: the gap to the nearest within 15 cm, or Infinity; below: the
 *  gap to the nearest within 50 cm, or Infinity}. */
function roomAround(E, statics, pf, reach = 0.15, reachBelow = 0.5) {
	let above = Infinity
	let below = Infinity
	let left = Infinity
	let right = Infinity
	for (const s of statics) {
		const e = extentOf([s], pf)
		if (e.y1 > E.y0 + 0.002 && e.y0 < E.y1 + 0.1) {
			// (beside it, up to as high as a hand on it reaches: a tank's wall)
			if (e.x1 <= E.x0 + 0.002) left = Math.min(left, E.x0 - e.x1)
			if (e.x0 >= E.x1 - 0.002) right = Math.min(right, e.x0 - E.x1)
		}
		if (e.x1 < E.x0 + 0.002 || e.x0 > E.x1 - 0.002) continue
		if (e.y0 >= E.y1 - 0.001) above = Math.min(above, e.y0 - E.y1)
		if (e.y1 <= E.y0 + 0.004) below = Math.min(below, E.y0 - e.y1)
	}
	return { above: above <= reach ? above : Infinity, below: below <= reachBelow ? below : Infinity, left, right }
}

/** The grip a held thing gets for `auto`: from its size, whether it is in a liquid, which way it goes once let go and what is round it. */
export function autoGrip({ E, move, inWater, room, depth = Infinity }) {
	const size = Math.max(E.w, E.h)
	const thin = Math.min(E.w, E.h, depth) <= 0.015 && size <= 0.2 // (a nail, a pencil, a clip, a washer: held between thumb and finger)
	const rises = !!move && move.y > 0.5
	if (inWater) return rises ? (size <= 0.065 ? "press" : "grip") : size <= 0.045 || thin ? "pinch" : "grip"
	if (rises && room.above === Infinity) return size <= 0.065 ? "press" : "grip"
	if (size <= 0.045 || thin) return "pinch"
	if (room.below < PALM_ROOM) return "grip" // (it rests on something, or a hand would not fit under it: held from above)
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
/** The side an arm comes from: away from where the thing goes, else from the picture's nearer edge (a short arm; a row of held things are held from
 *  both sides, their arms never crossing one another). */
const sideFrom = (move, near = "left") => (move && Math.abs(move.x) > 0.3 ? (move.x > 0 ? "left" : "right") : near)
/** Where the arm comes from for a grip: hand_from when it is one the grip can take, else the grip's own way. */
export function fromFor(grip, from, { move, inWater, room, near = "left" }) {
	if (grip === "press") return "above"
	if (grip === "palm") return from === "left" || from === "right" ? from : sideFrom(move, near)
	if (from === "left" || from === "right" || from === "above") return from
	if (grip === "grip") return "above"
	return (inWater || room.below < PINCH_ROOM) && room.above === Infinity ? "above" : sideFrom(move, near) // (pinch: from a side only with room under the hand)
}

/** A thumb given as joint angles ([swing (- out to its side), lift (- toward the palm's side), twist (its pad toward the fingers), knuckle, end],
 *  degrees: its metacarpal turned Euler(twist, swing, lift, "YZX") in the palm's frame, its two joints bent about their own z) as its bones' turns
 *  from rest. */
function thumbTurns([sw, li, tw, mcp, ip]) {
	const of = (n, q) => {
		const e = new THREE.Euler().setFromQuaternion(REST[n].clone().invert().multiply(q), "YZX")
		return [e.x / D2R, e.y / D2R, e.z / D2R]
	}
	const bend = (a) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -a * D2R)
	return { thumb_1: of("thumb_1", turnQ([tw, sw, li])), thumb_2: of("thumb_2", bend(mcp)), thumb_3: of("thumb_3", bend(ip)) }
}
const withThumb = (P, t) => Object.assign(copyPose(P), thumbTurns(t))
/** Ease each finger of pose P (on scratch rig `side` at W, X, Y) toward straight until it is clear of field d by `gap`: a palm flat on a thing
 *  whose fingers would bend into it or into what is under it. */
function unbend(side, W, X, Y, P, d, gap = 0.002) {
	for (let i = 0; i < 4; i++) {
		const links = new Set([`f${i}.0`, `f${i}.1`, `f${i}.2`])
		for (let n = 0; n < 8; n++) {
			const r = tryHand(side, W, X, Y, P)
			if (clearance(r, d, (l) => links.has(l)) >= gap) break
			for (let j = 1; j <= 3; j++) P[`${DIGITS[i]}_${j}`][2] *= 0.6
		}
	}
	return P
}
/** The rotation taking frame (u, v) onto frame (a, b) (each: its first axis, the second made square to it). */
function frameTurn(a, b, u, v) {
	const F = (p, q) => {
		const x = p.clone().normalize()
		const y = q.clone().addScaledVector(x, -q.dot(x)).normalize()
		return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y))
	}
	return new THREE.Quaternion().setFromRotationMatrix(F(a, b).multiply(F(u, v).invert()))
}
/** Where a thing let go from a palm on its top is clear of the hand: the least s along unit `dir` from wrist W (scratch rig `side`, X, Y, pose P)
 *  that keeps the hand `gap` out of the column over the thing's outline (it may shoot up), and never into field `others`; null when none within 15 cm. */
function flickClear(side, W, X, Y, P, E, zh, dir, others, A = null, gap = 0.004) {
	const hw = (E.x1 - E.x0) / 2
	const column = (p) => Math.hypot(Math.max(Math.abs(p.x - E.cx) - hw, 0), Math.max(Math.abs(p.z) - zh, 0)) + Math.min(Math.max(Math.abs(p.x - E.cx) - hw, Math.abs(p.z) - zh), 0)
	for (let s = 0.02; s <= 0.15 + 1e-9; s += 0.005) {
		const w = W.clone().addScaledVector(dir, s)
		const r = tryHand(side, w, X, Y, P)
		if (others && clearance(r, others) < 0.002) return null
		// (the hand and its forearm out of the column: what shoots up passes beside them)
		if (clearance(r, column) >= gap && (!A || armClearance(column, w, A) >= gap)) return s
	}
	return null
}

/** The hold of one thing: {rig, wrist, X, Y, armDir, exit: [{dir, len}] (the way out once it is let go: straight lines, the last one open-ended),
 *  pose, arm (its rise, wrist, clearance)} with the fingers closed round it (field d, its extent E, its first move; `others`: the field of everything
 *  else drawn, which neither hand nor arm may enter). Every way the grip allows is tried (the hand turned about what holds it, either hand) with the
 *  arm's best way out (chooseArm): the wrist easiest, nothing passed through, nearest the grip's own way. */
function solveHold(grip, from, d, E, move, room = { above: Infinity, below: Infinity }, near = "left", others = null) {
	const R = refs()
	const side = from === "right" ? -1 : 1 // (from the side: +1 the arm comes from the left and the hand reaches to +x)
	const falls = !!move && move.y < 0.3 // (what it does once let go: the fingers never wrap under a thing that will drop out of them)
	const all = fieldMin(d, others)
	const armFrom = from === "above" ? "above" : from === "right" ? "right" : "left"
	let best = null
	let close = []
	/** One way to hold it: scratch rig `rs` at W, X, Y in pose P; `keep`: the parts that may not be in the thing (the rest close onto it). */
	const tryHold = (rs, W, X, Y, P, pref, keep = null, armPrefer = {}) => {
		const r = tryHand(rs, W, X, Y, P)
		const inThing = clearance(r, d, keep)
		const inOthers = others ? clearance(r, others) : Infinity
		// (in the thing, or within 1 mm of anything else drawn, is a fault; nearer than 3 mm to anything else is only less wanted)
		const fault = (inThing >= -0.0002 ? 0 : 1 + -inThing * 500) + (inOthers >= 0.001 ? 0 : 1 + (0.001 - inOthers) * 500)
		const soft = pref + (inOthers < 0.003 ? (0.003 - Math.max(inOthers, 0.001)) * 300 : 0)
		if (best && fault * 100 + soft >= best.cost) return // (it cannot win, whatever its arm)
		const arm = chooseArm(rs, W, X, Y, armFrom, all, armPrefer)
		const cost = fault * 100 + arm.cost + soft
		if (!best || cost < best.cost) best = { side: rs, W: W.clone(), X: X.clone(), Y: Y.clone(), P: copyPose(P), A: arm.A, arm, cost, fault, inThing, inOthers }
	}
	const palmOnly = (l) => l === "palm" || l === "wrist"
	const palmParts = (l) => palmOnly(l) || l === "t.0"
	/** The wrist that seats the palm on it: W (the palm's point on its surface) set back 4 cm against unit `dir` and slid along it until the palm's
	 *  nearest part (or the ball of the thumb) is 0.4 mm from it, so no part of the palm is ever in it: a flat palm on a round or uneven top
	 *  meets it where it first touches. Unslid (W itself) when nothing is met. */
	const seat = (rs, W, X, Y, P, dir) => slideTo(rs, W.clone().addScaledVector(dir, -0.04), X, Y, P, d, dir, 0.0004, 0.1, palmParts)?.W ?? W
	if (grip === "press") {
		// the palm on its top, pressing it down, the fingers flat and together (bent a little at the knuckles, never into it or what is under it); the
		// fingers away from the picture's nearer edge and the arm from above toward it. Let go, the hand slides off it to a side with room (clear of
		// the column over it: a floater shoots up) and rises calmly out of the picture, so it is seen to leave it, never to lift it or ride on it
		const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
		const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
		const psi0 = near === "left" ? 0 : 180
		for (const dpsi of [0, -20, 20, -40, 40, -60, 60, -90, 90]) {
			const psi = (psi0 + dpsi) * D2R
			const X0 = V(Math.cos(psi), 0, Math.sin(psi))
			for (const tilt of Math.abs(X0.x) > 0.5 ? [0, 12] : [0])
				for (const pitch of [0, 7]) {
					// (its back tipped toward the camera a little: more of it is seen; the heel a little up, so the palm is what meets it)
					const Y0 = UP.clone().applyAxisAngle(X0, tilt * D2R * Math.sign(X0.x || 1))
					const Zc = X0.clone().cross(Y0).normalize()
					const X = X0.clone().applyAxisAngle(Zc, -pitch * D2R)
					const Y = Y0.clone().applyAxisAngle(Zc, -pitch * D2R)
					for (const rs of ["left", "right"]) {
						const P = copyPose(POSES.press)
						const W0 = T.clone().sub(offsetOf(scratchRig(rs), R.palmC, X, Y)).addScaledVector(UP, 0.05)
						unbend(rs, W0.clone().addScaledVector(UP, -0.05), X, Y, P, all)
						const sl = slideTo(rs, W0, X, Y, P, d, V(0, -1, 0), 0.0004, 0.2) ?? { W: W0.clone().addScaledVector(UP, -0.05) }
						const r = tryHand(rs, sl.W, X, Y, P)
						// (the palm on it: its nearest part within 2 mm)
						const palm = clearance(r, d, (l) => l === "palm")
						tryHold(rs, sl.W, X, Y, P, (dpsi / 50) ** 2 + (tilt ? 0 : 0.1) + pitch / 30 + (palm <= 0.002 ? 0 : 1 + (palm - 0.002) * 300), null, { way: X0.clone().negate() })
					}
				}
		}
	} else if (grip === "pinch") {
		// thumb and finger on either side of it, across the way it will go (it slides out from between them), turned about that line as the arm
		// goes best: from above, or from the side
		const above = from === "above"
		const approach0 = above ? V(0, -1, 0) : V(side, 0, 0)
		const mv = move ? V(move.x, move.y, 0) : V(0, -1, 0)
		const inPlane = V(-mv.y, mv.x, 0).normalize()
		// the pinch's axis: across its first move in the picture's plane when it is thin that way (the fingers on its two sides), else front to back
		let n = V(0, 0, 1)
		if (Math.abs(inPlane.dot(approach0)) < 0.7) {
			const across = Math.abs(inPlane.x) > Math.abs(inPlane.y) ? E.w : E.h
			if (across <= Math.max(0.03, halfZ(d) * 2 + 0.002)) n = inPlane.clone()
		}
		// the pinch point: on the thing, near the hand's side (from the side, 7 mm in from its end; from above, its middle, or nearer its top where
		// the curled fingers would meet its top)
		const P0s = above ? [V(E.cx, E.cy, 0), V(E.cx, Math.max(E.cy, E.y1 - Math.min(0.01, E.h * 0.3)), 0)] : [V(side > 0 ? E.x0 + Math.min(0.008, E.w * 0.3) : E.x1 - Math.min(0.008, E.w * 0.3), E.cy, 0)]
		const nn = n.z > 0.5 ? n.clone().negate() : n.clone() // (front to back: the thumb in front)
		let a0 = approach0.clone().addScaledVector(nn, -approach0.dot(nn))
		if (a0.lengthSq() < 1e-6) a0 = V(0, -1, 0).addScaledVector(nn, nn.y)
		a0.normalize()
		const pre = copyPose(POSES.pinch)
		// (opened a little, to close onto it)
		pre.index_1[2] += 18
		pre.index_2[2] += 18
		pre.thumb_1[1] += 14
		pre.thumb_2[2] += 10
		const closing = new Set(["f0.1", "f0.2", "t.1", "t.2"])
		const rs0 = above ? "left" : side > 0 ? "left" : "right"
		P0s.forEach((P0, k) => {
			for (const psi of [0, -15, 15, -30, 30, -45, 45, -60, 60, -80, 80]) {
				const approach = a0.clone().applyAxisAngle(nn, psi * D2R)
				for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
					const rr = scratchRig(rs)
					const q = frameTurn(approach, nn, sided(rr, R.pinchAt).normalize(), sided(rr, R.pinchAxis))
					const X = V(1, 0, 0).applyQuaternion(q)
					const Y = V(0, 1, 0).applyQuaternion(q)
					const W = P0.clone().sub(offsetOf(rr, R.pinchAt, X, Y))
					tryHold(rs, W, X, Y, pre, (psi / 45) ** 2 + (rs === rs0 ? 0 : 0.15) + k * 0.3, (l) => !closing.has(l))
				}
			}
		})
		close = [[0], ["t"]]
	} else if (grip === "palm") {
		// it rests on the open palm, the fingers cupped round it; the arm from the side, rising to the elbow. Let go, the hand drops away from under
		// it and out to its side faster than it falls (the clearance below keeps it so)
		const bottom = hitAlong(d, V(E.cx, E.y0 - 0.3, 0), V(0, 1, 0), 0.6)
		let B = V(E.cx, bottom === null ? E.y0 : E.y0 - 0.3 + bottom, 0)
		let Y = V(0, -1, 0)
		const ball = sphereOf(d)
		if (ball) {
			// under a ball the palm rolls 20 degrees toward the camera, tangent to it there, so its cupped palm shows
			const n = V(0, -Math.cos(20 * D2R), Math.sin(20 * D2R))
			B = ball.c.clone().addScaledVector(n, ball.r)
			Y = n.clone()
		}
		const X0 = V(side, 0, 0).addScaledVector(Y, -side * Y.x).normalize()
		// (the thumb a little below the palm, so it closes up onto the thing's side however wide its base)
		const pre = withThumb(lerpPose(POSES.flat, POSES.cup, 0.25), [-50, 12, 88, 4, 4])
		const rs0 = side > 0 ? "right" : "left" // (the thumb toward the camera)
		const under = Y.clone().negate() // (the palm's way to it)
		for (const psi of [0, -15, 15, -30, 30, -45, 45])
			for (const xc of [0.046, 0.056])
				for (const pitch of [0, 10]) {
					// (the ball of it on the palm's middle or nearer the fingers, the fingers a little up: the wrist clear of it)
					const X1 = X0.clone().applyAxisAngle(Y, psi * D2R)
					const Zc = X1.clone().cross(Y).normalize()
					const X = X1.clone().applyAxisAngle(Zc, -pitch * D2R)
					const Yp = Y.clone().applyAxisAngle(Zc, -pitch * D2R)
					for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
						const W0 = B.clone().sub(offsetOf(scratchRig(rs), V(xc, -PALM_T / 2 - 0.0003, 0), X, Yp)).addScaledVector(under, -0.04)
						const sl = slideTo(rs, W0, X, Yp, pre, d, under, 0.0004, 0.12, palmParts) ?? { W: W0.clone().addScaledVector(under, 0.04) }
						const palm = clearance(tryHand(rs, sl.W, X, Yp, pre), d, (l) => l === "palm")
						tryHold(rs, sl.W, X, Yp, pre, (psi / 40) ** 2 + (rs === rs0 ? 0 : 0.15) + (xc - 0.046) * 20 + pitch / 40 + (palm <= 0.003 ? 0 : 1 + (palm - 0.003) * 300), palmParts, { below: true })
					}
				}
		close = [[0, { most: [28, 31, 22] }], [1, { most: [28, 31, 22] }], [2, { most: [28, 31, 22] }], [3, { most: [28, 31, 22] }], ["t", { most: [12, 14, 14] }]]
	} else {
		// "grip": the whole hand round it, from above (the fingers draped down its front) or from a side (the palm on that side, the fingers round its
		// front); a thin bar lies across the base of the fingers, a big thing under the middle of the palm
		const zSize = halfZ(d) * 2
		const at = 0.044 + 0.018 * clamp((0.05 - zSize) / 0.035, 0, 1)
		// (a long thin thing lying across, a fist round it: a magnet, a ruler, a rod; a toy car is not one)
		const bar = E.w > Math.max(0.05, 4 * halfZ(d)) && E.h <= 0.04 && 2 * halfZ(d) <= 0.04
		// (the thumb starts clear of it and closes round its other side: under a bar from behind it, or down a round thing's back)
		const pre = withThumb(POSES.flat, bar ? [-10, -55, 95, 5, 5] : [-50, 15, 90, 5, 5])
		if (from === "above") {
			const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
			const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
			const Y = UP.clone()
			if (bar) {
				// a fist round a bar: the bar across the palm, the fingers curled round its front and under it, the arm from above and behind
				for (const psi of [0, -15, 15, -30, 30]) {
					const X = V(0, 0, 1).applyAxisAngle(UP, psi * D2R)
					for (const rs of ["left", "right"]) {
						const W = seat(rs, T.clone().sub(offsetOf(scratchRig(rs), V(at, -PALM_T / 2 - 0.0003, 0), X, Y)), X, Y, pre, V(0, -1, 0))
						tryHold(rs, W, X, Y, pre, (psi / 30) ** 2 + (rs === "left" ? 0 : 0.15), palmParts, { way: X.clone().negate() })
					}
				}
			} else {
				// the hand on top, its fingers draped down one side (toward the camera a little) and the thumb round its back, so its front shows
				const gs = move && move.x > 0.3 ? -1 : 1
				const rs0 = gs > 0 ? "right" : "left"
				for (const dpsi of [0, -15, 15, -30, 30, -45, 45]) {
					const psi = ((gs > 0 ? 25 : 155) + dpsi) * D2R
					const X = V(Math.cos(psi), 0, Math.sin(psi))
					for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
						const W = seat(rs, T.clone().sub(offsetOf(scratchRig(rs), V(0.046, -PALM_T / 2 - 0.0003, 0), X, Y)), X, Y, pre, V(0, -1, 0))
						tryHold(rs, W, X, Y, pre, (dpsi / 35) ** 2 + (rs === rs0 ? 0 : 0.15), palmParts, { way: X.clone().negate() })
					}
				}
			}
		} else {
			const hit = hitAlong(d, V(side > 0 ? E.x0 - 0.3 : E.x1 + 0.3, E.cy, 0), V(side, 0, 0), 0.6)
			const S = V(side > 0 ? (hit === null ? E.x0 : E.x0 - 0.3 + hit) : hit === null ? E.x1 : E.x1 + 0.3 - hit, E.cy, 0)
			const Y = V(-side, 0, 0)
			const rs0 = side > 0 ? "right" : "left" // (the thumb on top)
			for (const psi of [0, -20, 20, -40, 40]) {
				const X = V(0, 0, 1).applyAxisAngle(Y, psi * D2R)
				for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
					const W = seat(rs, S.clone().sub(offsetOf(scratchRig(rs), V(at, -PALM_T / 2 - 0.0003, 0), X, Y)), X, Y, pre, V(side, 0, 0))
					tryHold(rs, W, X, Y, pre, (psi / 30) ** 2 + (rs === rs0 ? 0 : 0.15), palmParts)
				}
			}
		}
		// (a thing that will drop: the fingers stop at its widest; one held down, or held fixed, is gripped round)
		const most = falls && from === "above" ? [56, 41, 22] : null
		close = [[0, { most }], [1, { most }], [2, { most }], [3, { most }], ["t", {}]]
	}
	const rig = newRig(best.side)
	rig.pose = copyPose(best.P)
	placeHand(rig, best.W, best.X, best.Y)
	applyPose(rig, rig.pose)
	rig.root.updateMatrixWorld(true)
	const touched = []
	for (const [i, o] of close) touched.push(...closeFinger(rig, d, i, o ?? {}))
	const A = best.A.clone().normalize()
	let exit = null
	let pace = null // the way out's start and speed (m/s², m/s), else WA and WV
	if (grip === "press") {
		// let go: the palm lifts just off it (1.2 cm, far quicker than a floater rises), slides off it level across the picture (away from where it
		// goes, else toward more room to a wall, else toward the picture's nearer edge; else the other way, else away from the camera, never toward
		// it while another way is clear) as far as clears the column over it for the hand and its forearm (it may shoot up) and meets nothing, then
		// rises calmly along its arm out of the picture: what it held is seen to leave it, never lifted or ridden up by it
		const fs = move && Math.abs(move.x) > 0.3 ? -Math.sign(move.x) : Math.abs(room.left - room.right) > 0.01 ? (room.right > room.left ? 1 : -1) : near === "left" ? -1 : 1
		const lift = 0.012
		const ways = [V(fs, 0, 0), V(-fs, 0, 0), V(0, 0, -1), V(0, 0, 1)].map((v) => v.setY(0.08).normalize())
		const zh = halfZ(d)
		const W1 = best.W.clone().addScaledVector(UP, lift)
		let flick = null
		for (const dir of ways) {
			const s = flickClear(best.side, W1, best.X, best.Y, openOf(rig.pose), E, zh, dir, others, A)
			if (s !== null) {
				flick = { dir, len: s }
				break
			}
		}
		flick ??= { dir: ways[0], len: 0.08 }
		exit = [{ dir: UP.clone(), len: lift }, flick, { dir: A.clone(), len: Infinity, calm: true }]
		pace = { a: 60, v: 1.6 }
	} else if (grip === "palm") {
		// (let go, a hand drops straight down from under it, faster than it falls, then out along its arm's way, level, and down; never into what is
		// under it: the drop is what the room under the thing leaves, and the way out is level when that is under 40 cm)
		const drop = clamp(room.below - 0.027, 0.005, 0.05)
		const level = V(A.x, 0, A.z).normalize()
		exit = [{ dir: V(0, -1, 0), len: drop }, { dir: level.multiplyScalar(0.95).add(V(0, room.below < 0.4 ? 0 : -0.3, 0)), len: Infinity }]
		pace = { a: 40, v: 2.5 } // (a whip away: it falls at g, and a hand left under it would be seen to carry it)
	}
	const way = (exit ?? [{ dir: A, len: Infinity }]).map((e) => ({ dir: e.dir.clone().normalize(), len: e.len, calm: !!e.calm }))
	return { rig, wrist: best.W.clone(), X: best.X.clone(), Y: best.Y.clone(), armDir: A, exit: way, pace: pace ?? { a: WA, v: WV }, pose: copyPose(rig.pose), arm: best.arm, fault: best.fault, inThing: best.inThing, inOthers: best.inOthers, touched }
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

/** The pose a hand opens to at the release: each bend eased off toward the relaxed hand, never further bent than it held (a flat hand stays flat;
 *  the fingers' spread kept). */
function openOf(P) {
	const o = copyPose(POSES.relaxed)
	for (const d of DIGITS) {
		o[`${d}_1`][1] = P[`${d}_1`][1]
		for (let j = 1; j <= 3; j++) o[`${d}_${j}`][2] = Math.max(o[`${d}_${j}`][2], P[`${d}_${j}`][2])
	}
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
	// (everything drawn, which a hand and its arm keep out of: not the pushers' parts a hand stands for)
	ctx.drawn = doc.solids.filter((s) => !s.hidden_3d && !H.hidden.has(s.id))
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
/** What a hold came to (tests, the dev sheet): its arm's rise and wrist, its faults, the parts that touch. */
const holdInfo = (S) => ({ rise: S.arm.rise, phi: S.arm.phi, wrist: S.arm.wrist, clear: S.arm.clear, armOk: S.arm.ok, fault: S.fault, inThing: S.inThing, inOthers: S.inOthers, touched: S.touched, exit: S.exit.map((e) => ({ dir: e.dir.toArray().map((v) => +v.toFixed(3)), len: e.len })) })
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
	// (a palm asked for where no hand fits under the thing is a grip from above: a hand never goes through what it stands on)
	let grip = p.grip === "auto" ? autoGrip({ E, move, inWater, room, depth: 2 * halfZ(d) }) : p.grip === "palm" && room.below < PALM_ROOM ? "grip" : p.grip
	const P0 = V(E.cx, E.cy, 0)
	const near = C.exit(P0, V(-1, 0.25, -0.15).normalize()) <= C.exit(P0, V(1, 0.25, -0.15).normalize()) + 1e-6 ? "left" : "right"
	let from = fromFor(grip, p.from ?? "auto", { move, inWater, room, near })
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
	// (what else is drawn near it: what it stands on, a wall, a tank's floor; neither hand nor arm goes through any of it)
	const reach = 0.45
	const near3 = C.drawn.filter((s) => {
		if (s.item === p.item) return false
		const e = extentOf([s], pf)
		return e.x1 > E.x0 - reach && e.x0 < E.x1 + reach && e.y1 > E.y0 - reach && e.y0 < E.y1 + reach
	})
	const others3 = near3.length ? fieldOf(near3, pf, C.boxOf) : null
	let S = solveHold(grip, from, d, E, move, room, near, others3)
	// (a grip that cannot hold it cleanly, its hand or arm in something or its wrist past its easy bend: an auto hold, or a palm, tries the others
	// and keeps the cleanest)
	const faulty = (h) => h.fault > 0 || !h.arm.ok
	const rank = (h) => h.fault * 1000 + (h.arm.ok ? 0 : 100 + Math.max(0, 0.003 - h.arm.clear) * 1e4) + h.arm.cost
	if (faulty(S) && (p.grip === "auto" || grip === "palm"))
		for (const g2 of ["grip", "pinch", "palm"]) {
			if (g2 === grip) continue
			const f2 = fromFor(g2, p.from ?? "auto", { move, inWater, room, near })
			const S2 = solveHold(g2, f2, d, E, move, room, near, others3)
			if (rank(S2) < rank(S)) {
				S = S2
				grip = g2
				from = f2
			}
			if (!faulty(S)) break
		}
	const rig = S.rig
	const W0 = S.wrist
	const hold = S.pose
	const open = openOf(hold)
	// the arm leaves the hand by the rules (ARM: from the picture's nearer edge or from above, short); a hand that lets go goes out along it
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
	setArm(rig)
	const gone = before + C.exit(_o.copy(W0).add(pathAt(before, new THREE.Vector3())), last.dir) + HL * SIZE + 0.08 // (how far it goes to be out of the picture)
	const solidId = p.part?.id ?? list[0].id
	const tEnd = C.track?.frames?.at(-1)?.t ?? 0
	if (p.kind === "fixed" || C.tR >= tEnd) {
		// held the whole run: a fixed thing, or one let go only after the run ends (a still)
		placeHand(rig, W0, S.X, S.Y)
		applyPose(rig, hold)
		placeArm(rig, armDir)
		return { item: p.item, rig, solidId, grip, from, at() {}, busy: () => false, info: holdInfo(S) }
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
	// the way out: a brisk start (the pace's a, faster than a floater shoots up or a dropped thing falls, so the hand is seen to leave it, never to
	// lift or carry it) to a steady speed (WV; a palm's whip; a press's calm rise once its flick has taken it clear), out of the picture
	const T0 = thrown ? FT * 0.6 : 0
	const { a: PA, v: PV } = S.pace
	// (a calm stretch, the press's rise after its flick: 0.3 m/s, out of the picture in 0.9 s at most; it is entered at its speed at once)
	const calmV = Math.max(0.3, (gone - before) / 0.9)
	const vOf = (sv) => {
		let acc = 0
		for (const e of way) {
			acc += e.len
			if (sv < acc - 1e-9) return e.calm ? calmV : PV
		}
		return last.calm ? calmV : PV
	}
	const planTab = [0] // (s at 1/120 s steps from T0: PA up to each stretch's speed)
	for (let sv = 0, vel = 0; sv < gone && planTab.length < 2400; ) {
		for (let i = 0; i < 10; i++) {
			vel = Math.min(vel + PA / 1200, vOf(sv))
			sv += vel / 1200
		}
		planTab.push(sv)
	}
	const TW = (planTab.length - 1) / 120
	const plan = (tau) => {
		const u = (tau - T0) * 120
		if (u <= 0) return 0
		const i = Math.floor(u)
		if (i >= planTab.length - 1) return planTab[planTab.length - 1] + ((u - planTab.length + 1) / 120) * vOf(Infinity)
		return planTab[i] + (planTab[i + 1] - planTab[i]) * (u - i)
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
		info: holdInfo(S),
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
const FIST_FRONT = new Set(["f0.0", "f0.1", "f1.0", "f1.1", "f2.0", "f2.1", "f3.0", "f3.1"]) // (a fist's knuckles and the flats of its fingers' bones)
const PALM_LINKS = new Set(["palm", "wrist"])
/** Every way one hand of push skin `skin` may meet the thing it pushes, placed: [{side, W, X, Y, P, link, spheres, pref, fault, at (where it
 *  meets it)}]. A finger: the index's tip on it (pointing a little down and toward the camera as the floor and the thing leave room), nothing else of
 *  the hand within 3 mm of it or of anything else; a fist: its knuckles on it; a hand: the heel of its palm on it, flat on a flat back, tangent to a
 *  ball's (the fingers closing onto it afterwards). Each slides along the push until it is 0.4 mm from the thing: on it, never in it. K: {u (the
 *  push's way), v (its up), c (across it, toward the camera), face (the paddle's face at the start), td (the thing's field), ball, others, E, zs
 *  (the depths to try, across), hs (the heights, along v from the face)}. */
function pushCands(skin, K) {
	const R = refs()
	const out = []
	const { u, v, c, td, others } = K
	let how = null // (the candidate's own angles, for the record)
	const keep = (rs, W, X, Y, P, link, at, pref, rule) => {
		const r = tryHand(rs, W, X, Y, P)
		const near = others ? clearance(r, others) : Infinity
		let fault = near >= 0.003 ? 0 : 1 + (0.003 - near) * 300
		fault += rule(r)
		out.push({ side: rs, W: W.clone(), X: X.clone(), Y: Y.clone(), P: copyPose(P), link, at, pref, fault, spheres: handSpheres(r), how })
	}
	const sides = ["left", "right"]
	if (skin === "finger" || skin === "fist") {
		const P = skin === "finger" ? POSES.point : POSES.fist
		const front = skin === "finger" ? R.pointTip : V(R.fistFront, -0.004, 0.006)
		const touches = skin === "finger" ? (l) => l === "f0.2" : (l) => FIST_FRONT.has(l)
		const free = skin === "finger" ? 0.003 : 0.001 // (all but the fingertip clear of it by 3 mm; a fist's thumb may lie nearer)
		for (const h of K.hs)
			for (const rs of sides)
				for (const p of skin === "finger" ? [0, 10, 20, 30, 40, 52] : [0, 10, 20, 32])
					for (const q of [0, 12, 24, -12])
						for (const rho of skin === "finger" ? [0, 25, -25, 50] : [0, 45, 90, -30]) {
							const d1 = u.clone().multiplyScalar(Math.cos(q * D2R)).addScaledVector(c, Math.sin(q * D2R))
							const X = d1.multiplyScalar(Math.cos(p * D2R)).addScaledVector(v, -Math.sin(p * D2R)).normalize()
							const Y = v.clone().addScaledVector(X, -v.dot(X)).normalize().applyAxisAngle(X, rho * D2R)
							const o = K.face.clone().addScaledVector(v, h).addScaledVector(u, -0.04)
							const W0 = o.sub(offsetOf(scratchRig(rs), front, X, Y))
							const sl = slideTo(rs, W0, X, Y, P, td, u)
							if (!sl) continue
							const pref = (p / 45) ** 2 + ((q - 10) / 25) ** 2 + (rho / 50) ** 2 + (h / 0.03) ** 2
							how = { pitch: p, yaw: q, roll: rho, h }
							keep(rs, sl.W, X, Y, P, sl.link, null, pref, (r) => (touches(sl.link) ? 0 : 2) + Math.max(0, free - clearance(r, td, (l) => !touches(l))) * 300)
						}
		return out
	}
	// a hand: the heel of the palm on it, the fingers up along it, a little apart, the thumb in beside the index (two hands side by side meet
	// at their thumbs, never through them)
	const P = copyPose(POSES.flat)
	P.thumb_1 = [36.4, 7.7, -7.2] // (in the palm's plane, 28 degrees out from the index)
	const others3 = (r) => {
		// (the palm and the thumb's ball never in it; the fingers and the thumb close onto it, or open out of it, afterwards)
		const g = clearance(r, td, (l) => PALM_LINKS.has(l) || l === "t.0")
		return g >= -0.0002 ? 0 : 1 + -g * 400
	}
	if (K.ball) {
		const { c: ctr, r: rad } = K.ball
		for (const beta of [26, 34, 42, 50, 58, 66])
			for (const gamma of K.gammas)
				for (const alpha of [-45, -30, -15, 0, 15])
					for (const rs of sides) {
						// (behind it, turned gamma toward the camera; beta up from its middle; the palm tangent there, its heel on it, the fingers up over it)
						const h = towardCamera(u.clone().negate(), gamma)
						const n = h.multiplyScalar(Math.cos(beta * D2R)).addScaledVector(v, Math.sin(beta * D2R)).normalize()
						const at = ctr.clone().addScaledVector(n, rad)
						const Y = n.clone()
						const X = v.clone().addScaledVector(Y, -v.dot(Y)).normalize().applyAxisAngle(Y, alpha * D2R)
						// (set down onto it along its normal from 3 cm out: the heel, or the ball of the thumb beside it, 0.4 mm from it)
						const W0 = at.clone().sub(offsetOf(scratchRig(rs), R.heel, X, Y)).addScaledVector(n, 0.03)
						const sl = slideTo(rs, W0, X, Y, P, td, n.clone().negate(), 0.0004, 0.08, (l) => PALM_LINKS.has(l) || l === "t.0")
						if (!sl) continue
						// (the heel on its back a little above its middle, the fingers up it: a hand pushing a big ball, its wrist bent well back)
						// (the fingers turned a little away from the camera, spread across its back: the back of the hand is seen, never a hand over its top;
						// two hands, one above the other, may lie higher and lower)
						const pref = (K.two ? ((beta - 40) / 25) ** 2 + ((gamma - 20) / 30) ** 2 : ((beta - 32) / 12) ** 2) + ((alpha + 32) / 20) ** 2
						how = { beta, gamma, alpha }
						keep(rs, sl.W, X, Y, P, sl.link, at, pref, others3)
					}
		return out
	}
	for (const tau of [0, 20, 40, 60, 75])
		for (const alpha of K.two ? [0] : [0, -25, 25])
			for (const h of K.two ? K.hs.filter((x, i) => i % 2 === 0) : K.hs)
				for (const z of K.zs)
					for (const rs of sides) {
						// (the palm turned tau from square to the push toward facing down: a low thing is pushed by the heel on its top edge, the hand over it)
						const nIn = u.clone().multiplyScalar(Math.cos(tau * D2R)).addScaledVector(v, -Math.sin(tau * D2R)).normalize()
						const Y = nIn.clone().negate()
						const X = v.clone().addScaledVector(nIn, -v.dot(nIn)).normalize().applyAxisAngle(nIn, alpha * D2R)
						const o = K.face.clone().addScaledVector(v, h).addScaledVector(c, z).addScaledVector(u, -0.12)
						const W0 = o.sub(offsetOf(scratchRig(rs), R.heel, X, Y))
						const sl = slideTo(rs, W0, X, Y, P, td, u)
						if (!sl) continue
						const pref = (tau / 45) ** 2 + (alpha / 30) ** 2
						how = { tau, alpha, h, z }
						keep(rs, sl.W, X, Y, P, sl.link, null, pref, (r) => {
							// (it meets it with its palm, or flat: the palm within 4 mm of it, the wrist never first)
							const palm = clearance(r, td, (l) => l === "palm")
							return (palm <= 0.004 ? 0 : 1 + (palm - 0.004) * 200) + (sl.link === "wrist" ? 1 : 0) + others3(r)
						})
					}
	return out
}

/** A pushing hand's fingers laid on what it pushes (field d): they bend at the knuckles to meet it and a little more beyond, never curled round it. */
function closeHand(rig, d) {
	for (const i of [0, 1, 2, 3]) closeFinger(rig, d, i, { most: [32, 22, 10] })
	closeFinger(rig, d, "t", { most: [12, 15, 15] })
}
/** The field of a set of spheres ({c, r}). */
const sphereField = (sp) => (pt) => {
	let m = Infinity
	for (const s of sp) m = Math.min(m, pt.distanceTo(s.c) - s.r)
	return m
}
const current = (rig) => {
	rig.root.updateMatrixWorld(true)
	return rig
}
/** A sphere round a set of spheres: {c, r}. */
function boundOf(sp) {
	const c = new THREE.Vector3()
	for (const s of sp) c.add(s.c)
	c.multiplyScalar(1 / Math.max(1, sp.length))
	let r = 0
	for (const s of sp) r = Math.max(r, s.c.distanceTo(c) + s.r)
	return { c, r }
}
/** The run's hand(s) on a pusher: the hand rests on the thing it pushes while the paddle crosses the air its face starts with, then moves with the
 *  paddle's face (the paddle is the engine's push); every frame it is kept clear of that thing (pushed back along the push where the thing would
 *  reach it). Two hands are a left and a right, one above the other on the thing's back (side by side across it when it is wider than it is tall),
 *  their arms parallel and apart: no part of one in the other, on any frame (they move together). */
function pushRig(p, pf, C) {
	const rod = p.list.find((s) => s.part === "rod")
	const paddle = p.list.find((s) => s.part === "paddle")
	if (!rod || !paddle) return null
	const pad = paddle.body
	const q0 = pf(paddle)
	const u0 = V(Math.cos(q0.angle ?? 0), Math.sin(q0.angle ?? 0), 0) // the push's way
	// what it pushes: the nearest thing in front of the paddle
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
	// a thing of several solids (a toy car: chassis, cabin, wheels) is met as all of them
	if (target) {
		const parts = C.doc.solids.filter((s) => s.item === target.s.item && !s.hidden_3d && s.kind === "dynamic")
		target.d = fieldOf(parts, pf, C.boxOf)
		target.parts = parts
	}
	// the air the paddle's face starts with in front of the thing at o (on the face's plane): a hand rests on the thing while the paddle crosses
	// that air, then goes with the paddle (the thing does not move before it is reached)
	const gapAt = (o) => {
		if (!target) return 0
		const hit = hitAlong(target.d, o.clone().addScaledVector(u0, -0.2), u0, 0.5)
		return hit === null ? 0 : clamp(hit - 0.2, 0, 0.05)
	}
	const gap = gapAt(face0)
	const v0 = FRONT.clone().cross(u0).normalize() // (up in the push's frame)
	const c0 = FRONT.clone().addScaledVector(u0, -FRONT.dot(u0)).normalize() // (across it, toward the camera)
	// no thing in front of it: a stand-in wall at the paddle's face, so the hand still has a face to rest on
	const td = target?.d ?? ((pt) => face0.dot(u0) - pt.dot(u0))
	const othersList = C.drawn.filter((s) => s.item !== p.item && !(target?.parts ?? []).includes(s))
	const others = othersList.length ? fieldOf(othersList, pf, C.boxOf) : null
	const all = fieldMin(td, others)
	const E = target ? extentOf(target.parts, pf) : { x0: face0.x, x1: face0.x, y0: face0.y - 0.05, y1: face0.y + 0.05, cx: face0.x, cy: face0.y, w: 0, h: 0.1 }
	const zh = target ? Math.max(...target.parts.map((s) => halfDepth(s, C.boxOf))) : 0.04
	const ball = target && target.parts.length === 1 ? sphereOf(target.d) : null
	const two = skin === "two hands"
	// the heights to try (along the push's up from the face's middle): the thing's back from near its foot to its top
	const lo = E.y0 - face0.y + 0.006
	const hi = E.y1 - face0.y + (skin === "finger" || skin === "fist" ? -0.004 : 0.01)
	const hs = skin === "finger" || skin === "fist" ? [0, ...[0.25, 0.5, 0.75].map((k) => lo + (hi - lo) * k)].filter((h) => h >= lo - 1e-9 && h <= hi + 1e-9) : [0.15, 0.35, 0.55, 0.75, 0.95].map((k) => lo + (hi - lo) * k)
	const wide = 2 * zh > 1.5 * E.h + 0.005 // (clearly wider across than tall: two hands side by side)
	const palmW = PALM_W * SIZE
	// (two hands across it: their middles from touching (a palm's width apart, the thumbs in between kept clear by the pair's check) to a hand's
	// breadth beyond its sides)
	const zs = two ? [0, ...[0.5, 0.75, 1, 1.25].flatMap((k) => [-(palmW * k + 0.004), palmW * k + 0.004])].filter((z) => Math.abs(z) <= zh + palmW * 0.5 + 0.012) : [0]
	const K = { u: u0, v: v0, c: c0, face: face0, td, ball, others, E, two, hs: hs.length ? hs : [0], zs, gammas: two ? [-60, -45, -30, -15, 0, 15, 30, 45, 60] : [0, 15, 30, 45] }
	const cands = pushCands(two ? "hand" : skin, K)
	const behind = u0.clone().negate()
	// (a pushing palm has its wrist bent well back, as a hand pushing a wall has; a fingertip or a fist pushes with the wrist nearly straight)
	const armPref = skin === "hand" || two ? { phi: -15, ext: 55 } : { phi: -15, ext: 15 }
	const ways = armWays({ way: behind }, armPref)
	// a hand's own cost (+ its arm's for way w): one hand's wish is the back of the hand toward the camera (a hand on a ball turned ~30 degrees
	// round it), a fingertip a little toward the camera
	const own = (cd) => cd.fault * 100 + cd.pref + (cd.at && !two ? (((Math.atan2(cd.at.clone().sub(ball.c).dot(c0), -cd.at.clone().sub(ball.c).dot(u0)) / D2R) - 30) / 25) ** 2 : 0)
	let lay = null
	if (!two) {
		for (const cd of cands.map((c) => ({ c, base: own(c) })).sort((a, b) => a.base - b.base)) {
			if (lay && cd.base >= lay.cost) break
			const a = bestArm(cd.c.side, cd.c.W, cd.c.X, cd.c.Y, ways, all, armPref)
			const cost = cd.base + a.cost
			if (!lay || cost < lay.cost) lay = { cost, hands: [{ ...cd.c, A: a.A, arm: a }] }
		}
	} else {
		// two hands, a left and a right: each one's best way to lie on it at every place (and its own best arm: a lower bound on any arm it shares);
		// every pair of places, cheapest first, until none could still win: the pair must be apart (3 mm at the least between every part of the two,
		// hands and arms), one above the other (side by side when the thing is wide), the left hand on the person's left; then the one arm way both
		// take (parallel arms), its wrists and lines tried for both
		const right = u0.clone().cross(UP).normalize() // (the pusher's right, facing the push)
		const cell = (cd) => JSON.stringify({ ...cd.how, alpha: undefined })
		const entries = (list, field) => {
			const at = { left: new Map(), right: new Map() }
			for (const cd of list) {
				const base = own(cd)
				const a = bestArm(cd.side, cd.W, cd.X, cd.Y, ways, field, armPref)
				const e = { cd, proxy: base + a.cost, base }
				const m = at[cd.side]
				const k = cell(cd)
				if (!m.has(k) || e.proxy < m.get(k).proxy) m.set(k, e)
			}
			return { left: [...at.left.values()], right: [...at.right.values()] }
		}
		const layoutOf = (cl, cr) => {
			const dW = cl.W.clone().sub(cr.W)
			const dv = Math.abs(dW.dot(v0))
			const dz = Math.abs(dW.dot(c0))
			const stacked = dv / (dv + dz + 1e-6)
			// (and both seen: apart as the camera looks, about along -z a little from above, by a hand's breadth or more)
			const seen = Math.hypot(dW.x, dW.y * 0.93 - dW.z * 0.37, 0)
			return (wide ? stacked : 1 - stacked) * 0.8 + clamp(1 - seen / 0.06, 0, 1) * 0.6 + (dW.dot(right) > 0.01 ? 100 + dW.dot(right) * 1000 : 0) // (the left hand never on the right: crossed hands are a fault)
		}
		const crossed = (cl, cr) => cl.W.clone().sub(cr.W).dot(right) > 0.01
		/** The best pair of left entries Ls and right entries Rs whose hands are `apart` m apart at the least (their arms 3 mm), the left hand on the
		 *  person's left unless `anyway`, or null. */
		const pairUp = (Ls, Rs, field, apart, anyway = false) => {
			const pairs = []
			for (const L of Ls) for (const Rh of Rs) {
				if (!anyway && crossed(L.cd, Rh.cd)) continue
				const layout = layoutOf(L.cd, Rh.cd)
				pairs.push({ L, R: Rh, layout, pre: L.proxy + Rh.proxy + layout })
			}
			pairs.sort((a, b) => a.pre - b.pre)
			let found = null
			let tried = 0
			for (const pr of pairs) {
				if (found && pr.pre >= found.cost) break
				const cl = pr.L.cd
				const cr = pr.R.cd
				let gh = Infinity
				const bl = (cl.bound ??= boundOf(cl.spheres))
				const br = (cr.bound ??= boundOf(cr.spheres))
				if (bl.c.distanceTo(br.c) - bl.r - br.r < 0.01) for (const s of cl.spheres) for (const t of cr.spheres) gh = Math.min(gh, s.c.distanceTo(t.c) - s.r - t.r)
				if (gh < apart) continue // (never a hand in the other)
				if (++tried > 300) break
				// (the one way both arms go: each way's two wrists first, their lines only while the pair could still win)
				const both = ways.map((w) => {
					const eL = wristPart(cl.side, cl.X, cl.Y, w, armPref)
					const eR = wristPart(cr.side, cr.X, cr.Y, w, armPref)
					return { eL, eR, base: pr.L.base + pr.R.base + eL.base + eR.base + pr.layout }
				})
				both.sort((a, b) => a.base - b.base)
				for (const b of both) {
					if (found && b.base >= found.cost) break
					const aL = withClearance(b.eL, cl.W, field)
					const aR = withClearance(b.eR, cr.W, field)
					const lineL = armLine(cl.W, aL.A)
					const lineR = armLine(cr.W, aR.A)
					let g = segmentDistance(lineL.a, lineL.b, lineR.a, lineR.b) - 2 * ARM.r
					for (const s of cl.spheres) g = Math.min(g, pointSegment(s.c, lineR.a, lineR.b) - s.r - ARM.r)
					for (const s of cr.spheres) g = Math.min(g, pointSegment(s.c, lineL.a, lineL.b) - s.r - ARM.r)
					if (g < 0.003) continue
					const cost = pr.L.base + pr.R.base + aL.cost + aR.cost + pr.layout
					if (!found || cost < found.cost) found = { cost, gap: Math.min(g, gh), hands: [{ ...cl, A: aL.A, arm: aL }, { ...cr, A: aR.A, arm: aR }] }
				}
			}
			return found
		}
		const E1 = entries(cands, all)
		lay = pairUp(E1.left, E1.right, all, 0.003)
		// (a fault in the best pair, a wrist past its easy bend or a hand in something: the fallback below is tried too, and the cheaper kept)
		if ((!lay || lay.cost >= 100) && E1.left.length) {
			const lay1 = lay
			// too small for two hands on it apart: the right hand lies on the left one (one above the other), never in it: the left hand as it best
			// lies on it, the right one set down on the thing or on that hand, whichever it meets first, its arm parallel and clear
			const L0 = E1.left.reduce((a, b) => (b.proxy < a.proxy ? b : a))
			// (the left hand as it will lie: its fingers closed onto the thing, then the right one set on that)
			const rl = tryHand("left", L0.cd.W, L0.cd.X, L0.cd.Y, L0.cd.P)
			closeHand(rl, td)
			const L = { ...L0, cd: { ...L0.cd, P: copyPose(rl.pose), spheres: handSpheres(rl), bound: undefined } }
			const handField = sphereField(L.cd.spheres)
			const td2 = fieldMin(td, handField)
			const all2 = fieldMin(all, handField)
			// (the right hand palm down, its fingers forward, set down from above onto the left hand or the thing, a hand's length ahead of the left
			// wrist or so: its forearm then clears the other)
			const over = []
			const R = refs()
			const P = copyPose(POSES.press)
			for (const ds of [0.05, 0.07, 0.09, 0.11])
				for (const dz of [0, 0.02, -0.02])
					for (const alpha of [0, -20, 20]) {
						const X = u0.clone().applyAxisAngle(v0, alpha * D2R)
						const Y = v0.clone()
						const top = L.cd.W.clone().addScaledVector(u0, ds).addScaledVector(c0, dz).addScaledVector(v0, 0.15)
						const W0 = top.sub(offsetOf(scratchRig("right"), R.palmC, X, Y))
						const sl = slideTo("right", W0, X, Y, P, td2, v0.clone().negate(), 0.0004, 0.4, (l) => l !== "wrist")
						if (!sl) continue
						const r = tryHand("right", sl.W, X, Y, P)
						const nearO = others ? clearance(r, others) : Infinity
						over.push({ side: "right", W: sl.W, X, Y, P: copyPose(P), link: sl.link, at: null, pref: (alpha / 30) ** 2 + ds * 5, fault: nearO >= 0.003 ? 0 : 1 + (0.003 - nearO) * 300, spheres: handSpheres(r), how: { over: ds, dz, alpha } })
					}
			const E2 = entries([...pushCands("hand", { ...K, td: td2 }).filter((c) => c.side === "right"), ...over], all2)
			lay = pairUp([L], E2.right, all, 0.0003)
			if (lay1 && (!lay || lay1.cost <= lay.cost)) lay = lay1
			// (and failing that, crossed hands rather than one in the other)
			lay ??= pairUp(E1.left, E1.right, all, 0.003, true) ?? pairUp([L], E2.right, all, 0.0003, true)
		}
	}
	if (!lay) return null
	// the hands as chosen, their fingers closed onto a ball (or a curved thing) they lie on, or onto the other hand, never into it
	const rigs = []
	for (const h of lay.hands) {
		const rig = newRig(h.side)
		setArm(rig)
		rig.pose = copyPose(h.P)
		placeHand(rig, h.W, h.X, h.Y)
		applyPose(rig, rig.pose)
		rig.root.updateMatrixWorld(true)
		h.rig = rig
		rigs.push(rig)
	}
	if (skin === "hand" || two)
		lay.hands.forEach((h, k) => {
			const other = lay.hands[1 - k]?.rig
			const f = other ? fieldMin(td, sphereField(handSpheres(current(other)))) : td
			current(h.rig)
			closeHand(h.rig, f)
		})
	for (const h of lay.hands) h.pose = copyPose(h.rig.pose)
	// every frame: the paddle's face, the hands with it (after it has crossed its air), pushed back along the push where the thing would reach them
	const tEnd = C.track?.frames?.at(-1)?.t ?? 0
	const HZ = 60
	const N = Math.max(1, Math.ceil(tEnd * HZ))
	const q = { x: 0, y: 0, angle: 0 }
	const faceAt = (t, out) => {
		const pp = poseAt(C.track, paddle.id, t, q) ?? q0
		const u = V(Math.cos(pp.angle ?? 0), Math.sin(pp.angle ?? 0), 0)
		out.copy(V(pp.x, pp.y, 0)).addScaledVector(u, pad.width / 2)
		const adv = out.clone().sub(face0).dot(u0)
		return out.sub(face0).addScaledVector(u, -Math.min(adv, gap)) // (the hands' shift from where they rest: none until the paddle reaches the thing)
	}
	const back = new Float32Array(N + 1)
	const shift = new THREE.Vector3()
	if (target) {
		const posesAt = (t) => target.parts.map((s) => poseAt(C.track, s.id, t) ?? pf(s))
		const handC = lay.hands.map((h) => h.rig.root.position.clone())
		const clearAt = (dt, s) => {
			let m = Infinity
			for (const h of lay.hands) {
				placeHand(h.rig, _w.copy(h.W).add(shift).addScaledVector(u0, -s), h.X, h.Y)
				applyPose(h.rig, h.pose)
				h.rig.root.updateMatrixWorld(true)
				m = Math.min(m, clearance(h.rig, dt))
			}
			return m
		}
		// (kept as clear as they rest on it, at the least: a finger laid on it a tenth of a millimetre off is not pushed away)
		shift.set(0, 0, 0)
		const thr = Math.min(0.0002, clearAt(target.d, 0) - 0.00005)
		for (let k = 0; k <= N; k++) {
			const t = k / HZ
			const dt = target.d.at(posesAt(t))
			faceAt(t, shift)
			// (the thing far from every hand: nothing to keep it out of)
			if (handC.every((c) => dt(_w.copy(c).add(shift)) > 0.2)) continue
			if (clearAt(dt, 0) >= thr) continue
			let a = 0
			let b = 0.002
			while (clearAt(dt, b) < thr && b < 0.5) {
				a = b
				b *= 2
			}
			for (let i = 0; i < 14; i++) {
				const m = (a + b) / 2
				if (clearAt(dt, m) < thr) a = m
				else b = m
			}
			back[k] = b
		}
	}
	const Wt = new THREE.Vector3()
	const at = (t) => {
		faceAt(t, shift)
		const k = clamp(t * HZ, 0, N)
		const i = Math.floor(k)
		const s = i >= N ? back[N] : back[i] + (back[i + 1] - back[i]) * (k - i)
		for (const h of lay.hands) {
			Wt.copy(h.W).add(shift).addScaledVector(u0, -s)
			placeHand(h.rig, Wt, h.X, h.Y)
			applyPose(h.rig, h.pose)
			placeArm(h.rig, h.A)
		}
	}
	at(0)
	const info = { skin, hands: lay.hands.map((h) => ({ side: h.side, link: h.link, how: h.how, rise: h.arm.rise, phi: h.arm.phi, wrist: h.arm.wrist, clear: h.arm.clear, fault: h.fault })), gap: lay.gap ?? null, cost: lay.cost }
	return { item: p.item, rig: rigs[0], rigs, solidId: paddle.id, skin, at, busy: () => false, info, lay, target, u0 }
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
	// (the vessel's body, for the arm: a cylinder half its width behind the lip, as the model draws it)
	const dBody = (pt) => {
		const r = Math.hypot(pt.x + side * (w / 2), pt.z) - R
		const dy = Math.max(pt.y, -h - pt.y)
		return Math.hypot(Math.max(r, 0), Math.max(dy, 0)) + Math.min(Math.max(r, dy), 0)
	}
	const rs = side > 0 ? "right" : "left"
	const rig = newRig(rs)
	setArm(rig)
	// the hand frame in the vessel's frame: the fingers toward the camera, the palm facing the vessel (+side x)
	const X = V(0, 0, 1)
	const Y = V(-side, 0, 0)
	const ym = (bar.y0 + bar.y1) / 2 + (cup ? 0 : 0.004)
	const contact = V(bar.x - side * bar.r, ym, 0)
	const W = contact.clone().sub(offsetOf(rig, V(0.05, -PALM_T / 2 - 0.0003, 0), X, Y))
	placeHand(rig, W, X, Y)
	rig.pose = copyPose(POSES.cup)
	if (cup) Object.assign(rig.pose, thumbTurns([0, -30, 120, 10, 10])) // (round a cup the thumb lies by its rim, not up in the air)
	applyPose(rig, rig.pose)
	rig.root.updateMatrixWorld(true)
	for (const i of [0, 1, 2, 3]) closeFinger(rig, dBar, i)
	closeFinger(rig, dBar, "t")
	const hold = copyPose(rig.pose)
	const Wv = W.clone()
	const toWorld = (ang) => {
		const m = new THREE.Matrix4().makeRotationZ(ang)
		m.setPosition(q0.x, q0.y, 0)
		return m
	}
	const base0 = q0.angle ?? 0
	const Mw0 = toWorld(base0)
	// the arm: back from the handle (or the cup) and up, away from the camera, by the rules (chooseArm: in the vessel's frame, clear of its body
	// and of everything drawn about it); it turns half as far as the pitcher tips (the wrist takes the rest)
	const others = C.drawn.filter((s) => s.item !== p.item)
	const fw = others.length ? fieldOf(others, pf, C.boxOf) : null
	const _x = new THREE.Vector3()
	const dAll = (pt) => Math.min(dBody(pt), dBar(pt), fw ? fw(_x.copy(pt).applyMatrix4(Mw0)) : Infinity)
	const arm = chooseArm(rs, Wv, X, Y, side > 0 ? "left" : "right", dAll, { phi: -35 })
	const A0 = arm.A.clone()
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
	return { item: p.item, rig, solidId: lip.id, at, busy: () => false, info: { rise: arm.rise, phi: arm.phi, wrist: arm.wrist, clear: arm.clear }, bar: dBar, Mw0 }
}