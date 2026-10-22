// A person's hand where a person acts in a scene (web/CONTRACT.md "Hands"). Render only: the engine is never told. A held item is held exactly
// still until the scene's release (doc.release), a pusher pushes with its own force, a pitcher is tipped by its own process; the hand shows who does it.
//   holding    a held item (held: true) whose `hand` prop is set: a pinch (thumb and finger tips on it), an open palm under it, a fingertip (a small
//              thing) or the palm pressing it down, or the whole hand round it, in place of the pull pin on its post (or a starting gate). At the
//              release the fingers open (0.08 s)
//              and the hand goes out of the picture along its arm (a press lifts just off, slides off it, then rises calmly); it never passes through
//              the thing it let go (it is kept clear of it frame by frame, from the track). A thing that leaves moving (start_speed: a throw) is
//              followed through first.
//   fixed      a fixed item whose `hand` prop is set (a magnet held in a fist) is held for the whole run, in place of its stand.
//   pushing    a pusher whose `hand` is finger | hand | two hands | fist: the hand rests on the thing it pushes and moves with the paddle's face
//              once that reaches it (the paddle is the engine's push), kept clear of it every frame; housing, rod and paddle are not drawn; a palm
//              stands flat on its back, fingers up (leaning over a low thing); two hands on its back a centimetre apart, both seen (neither
//              covering more than a fifth of the other in the picture), the left on the left, each arm its own way out of its hand, never crossed.
//   pouring    a pitcher whose `hand` is "hand": the hand grips its handle (a cup round its body) and tips with it.
// Every hand is real size (a child's of about nine, 14.5 cm from the wrist crease to the middle fingertip: the hand the engine's document names,
// "a child's hand and forearm in a blue sleeve") whatever the push: a harder push is the pusher's force and time, never a bigger hand. It is
// web/models/hand.glb (tools/hands/build_hand.py; loaded with the page by web/hand-model.js), a skinned child's hand and sleeved forearm,
// cloned for each hand (the procedural capsule hand only if the file does not load). Skin a neutral mid tone, a plain sleeve; the arm reaches in
// from the picture's edge, its sleeve carried on from hand.glb's out of the picture (ARM, setArm: never a hand at the end of a stub, no elbow, no
// person), leaving the hand from the picture's nearer edge or from above as a child's wrist bends easily, through nothing. Every placement is tried every way its grip or skin allows, on collision spheres fitted to the mesh's skin, and the
// cleanest kept; then where it touches is fitted on the drawn skin itself: what touches is 0.4 mm from what it touches, never in it; nothing else
// of the hand within 1 mm of anything (3 mm wanted), its arm 3 mm clear.
//   const H = makeHands({doc, track, resolved, mode, holdPart, boxOf})   (web/view3d.js buildRun; mode "scene" | "all" | "off")
//   H.group           add it to the run's group          H.pickables      meshes the editor may pick (userData.solidId; `stand` while held)
//   H.holds(item)     no pin, post or gate for it         H.hides(id)      a pusher part under a hand skin: not drawn
//   H.noMount(id)     a fixed part held by a hand: no stand   H.at(t)      pose every hand for moment t
//   H.busy(t)         a hand moves at t                    H.fit(pf, trk)  place them again (things were moved; the models came in)
//   meshHand()        hand.glb is drawn                     skinClearance(rig, d, links)  the drawn skin's least clearance from field d
import { handModel } from "./hand-model.js" // (first: its file is fetched while web/models3d.js loads its model groups)
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js"
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js"
import { gradeKeyFor, gradeShader } from "./models3d.js"
import { completeTrack, frameIndex } from "./track.js"

export const HAND_MODES = ["scene", "all", "off"]
export const HOLD_GRIPS = ["auto", "pinch", "palm", "press", "grip"]
export const PUSH_SKINS = ["finger", "hand", "two hands", "fist"]
export const OPEN_S = 0.08 // the fingers open at the release (doc.release.holder: holding -> opening 0.08 s -> open)
// a thing pressed down is pressed by the pointing finger's tip (a cork, a grape, a sponge), unless its top can take the whole hand flat on it (at
// least PALM_TOP[0] one way and PALM_TOP[1] the other, as drawn): then by the palm, the fingers on it too, none past its edge
const PALM_TOP = [0.15, 0.085]
const PALM_ROOM = 0.04 // m under a thing for a palm to go under it (the hand 2.2 cm thick, and air), else it is held from above
// two hands pushing: as the camera looks, neither covers more than this of the other (OVERLAP; side by side across a low thing's back, seen from
// its side, the near hand may cover the far one up to OVERLAP_LOW: the far one stands a little higher, its fingers and the top of its palm seen)
const OVERLAP = 0.2
const OVERLAP_LOW = 0.85
const OVERLAP_BALL = 0.35 // (round a ball the far hand on its rear half beside the near one, a little higher: up to this much of it behind the near hand)
// how far apart two pushing hands keep, every part of one from every part of the other: a centimetre; side by side across a low thing's narrow back,
// where their fingers close onto its top toward each other, half that (each is outlined as its own in the lesson look)
const APART = (low) => (low ? 0.005 : 0.01)
const LOW_THING = 0.09 // m: a thing lower than this (a toy car) is pushed by a palm on its back with its fingers over its top
const PALM_ROLL = 32 // degrees: a ball held on the open palm, the palm rolled toward the camera
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
	thumb_1: [0.4141, -0.3265, 0.1087, 0.8427],
	thumb_2: [0.0521, 0.1097, -0.092, 0.9883],
	thumb_3: [0.0159, 0.0515, -0.0502, 0.9973],
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
// the middle, ring and little fingers folded into the palm as a closed fist, each a little more than the one before it (at the knuckle 84, 90 and 95
// degrees: no gap between them), and the thumb lying along the folded middle finger under the index, its side against the index's root and its pad
// on the middle finger (each 0.6 to 1.2 mm off: nothing to see through between them; fitted on hand.glb's skin): a pointing hand's and a pressing
// fingertip's other digits, and a pinch's tucked fingers
const FOLD = {
	middle: [[0, 0, -84], [0, 0, -108], [0, 0, -80]],
	ring: [[0, 1, -90], [0, 0, -110], [0, 0, -82]],
	pinky: [[0, 3, -95], [0, 0, -110], [0, 0, -84]],
	thumb: [[58.4, 9.4, -25], [-4.8, -13, 1.9], [-1.9, -7.1, -36.2]]
}
const TAP_THUMB = [[64.3, 10.8, -26.8], [-4.8, -12.7, 5.4], [-1.9, -7.1, -36.4]] // (the same, fitted to the pressing index a little more bent)
export const POSES = {
	// the fingers straight (barely bent) and a little apart to their tips, the thumb out beside the index in the palm's plane, its nail to the side
	flat: digits({
		index: [[0, -2.5, -2], [0, 0, -4], [0, 0, -2]],
		middle: [[0, 0, -2], [0, 0, -3], [0, 0, -2]],
		ring: [[0, 1.5, -2], [0, 0, -4], [0, 0, -2]],
		pinky: [[0, 4, -3], [0, 0, -5], [0, 0, -2]],
		thumb: [[9.2, -1.1, -3.4], [-4.8, -12.6, 6.2], [-1.5, -6, 0.8]]
	}),
	// a hand at ease: each finger a little more curled than the one before it, apart, the thumb loosely in front of the index
	relaxed: digits({
		index: [[0, -1, -16], [0, 0, -24], [0, 0, -12]],
		middle: [[0, 0, -20], [0, 0, -28], [0, 0, -14]],
		ring: [[0, 1, -24], [0, 0, -33], [0, 0, -16]],
		pinky: [[0, 2, -28], [0, 0, -38], [0, 0, -18]],
		thumb: [[20.2, -6.1, -10], [-4.8, -12.9, 3.2], [-1.5, -6, -2.2]]
	}),
	// closed: the knuckles a rounded row, the fingers into the palm, the thumb across the outside over the index's middle bone (fitted on
	// hand.glb's skin: no digit in another, nothing past the knuckles)
	fist: digits({
		index: [[0, -2, -82], [0, 0, -110], [0, 0, -78]],
		middle: [[0, 0, -84], [0, 0, -110], [0, 0, -78]],
		ring: [[0, 1, -88], [0, 0, -110], [0, 0, -78]],
		pinky: [[0, 3, -90], [0, 0, -110], [0, 0, -76]],
		thumb: [[51.1, -27.6, -22.1], [-5.1, -15, -21.1], [-1.6, -6.4, -16.6]]
	}),
	// the index straight ahead with a slight natural bend, the others folded into the palm as a closed fist, the thumb along them under the index
	// (FOLD)
	point: digits({
		index: [[0, 0, -3], [0, 0, -8], [0, 0, -5]],
		...FOLD
	}),
	// pressing down with a fingertip: the index nearly straight along the press, a slight bend at each joint (never a hook), the others folded as
	// the pointing hand's (FOLD)
	tap: digits({
		index: [[0, 0, -5], [0, 0, -9], [0, 0, -6]],
		...FOLD,
		thumb: TAP_THUMB
	}),
	// pressing with the palm: the fingers flat and a little apart, a slight bend at the knuckles, the thumb out beside them flat in the palm's plane
	press: digits({
		index: [[0, -2, -10], [0, 0, -8], [0, 0, -4]],
		middle: [[0, 0, -10], [0, 0, -8], [0, 0, -4]],
		ring: [[0, 1.5, -11], [0, 0, -8], [0, 0, -4]],
		pinky: [[0, 3.5, -12], [0, 0, -9], [0, 0, -4]],
		thumb: [[9.3, 0.5, -2.2], [-4.8, -12.5, 7.2], [-1.5, -5.9, 1.8]]
	}),
	// the thumb's and the index's pads meeting (their skins 0.6 mm apart, facing), an O between them; the other fingers folded into the palm behind
	// the index (FOLD's), out of the O and out of the way (fitted on hand.glb)
	pinch: digits({
		index: [[0, -6, -50], [0, 0, -51.4], [0, 0, -29.8]],
		middle: FOLD.middle,
		ring: FOLD.ring,
		pinky: FOLD.pinky,
		thumb: [[13.5, -6.8, -33.8], [-4.8, -12.2, 11.1], [-1.5, -5.8, 5.8]]
	}),
	// the pinch opened, its tips 4.5 cm apart, the pads still facing each other all the way between (fitted on hand.glb): a pinch round a thing w
	// across is the pinch opened toward this until its tips are w apart (pinchFor)
	pinchOpen: digits({
		index: [[0, -6, -30], [0, 0, -38.4], [0, 0, -1.1]],
		middle: FOLD.middle,
		ring: FOLD.ring,
		pinky: FOLD.pinky,
		thumb: [[78.4, -24.1, -37.3], [-5.1, -11.3, 20.9], [-1.7, -5.3, 22.9]]
	}),
	// the fingers curved as round a cup or a handle, together side by side (each 0.2 to 1.2 mm from the next: no slots between them), the thumb
	// across from them
	cup: digits({
		index: [[0, 4.5, -30], [0, 0, -40], [0, 0, -22]],
		middle: [[0, 0, -32], [0, 0, -42], [0, 0, -23]],
		ring: [[0, -6.5, -34], [0, 0, -44], [0, 0, -24]],
		pinky: [[0, -13, -37], [0, 0, -46], [0, 0, -24]],
		thumb: [[32.2, -21.9, -31.3], [-4.8, -12.6, 6.2], [-1.5, -6, 0.8]]
	}),
	// a thing resting on the open palm: the fingers a little curved up, the thumb alongside the index (never across the palm)
	hold: digits({
		index: [[0, -3, -10], [0, 0, -12], [0, 0, -6]],
		middle: [[0, 0, -12], [0, 0, -15], [0, 0, -8]],
		ring: [[0, 2.5, -14], [0, 0, -18], [0, 0, -9]],
		pinky: [[0, 5, -17], [0, 0, -22], [0, 0, -10]],
		thumb: [[15, 0.2, -5], [-4.8, -12.6, 6.2], [-1.5, -6, 0.8]]
	}),
	// a palm upright on a low thing's back, its fingers together and bent forward at the knuckles to reach over its top (they close onto it from
	// here, closeHand), the thumb laid along the index, against it from its root to its tip (0.5 mm: nothing to see through between them), so it
	// stands out sideways no further than the palm does (two hands side by side never meet at their thumbs) (fitted on hand.glb)
	hook: digits({
		index: [[0, 1.5, -35], [0, 0, -15], [0, 0, -8]],
		middle: [[0, 0, -36], [0, 0, -16], [0, 0, -8]],
		ring: [[0, -1.5, -37], [0, 0, -17], [0, 0, -9]],
		pinky: [[0, -3.5, -38], [0, 0, -18], [0, 0, -9]],
		thumb: [[12.5, 11, -17.1], [-4.9, -14.2, -12.4], [-1.5, -6.2, -7.1]]
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

// ---------------------------------------------------------------- the mesh hand: web/models/hand.glb (web/hand-model.js loads it with the page)
// The glTF is the rig contract's left hand at its own size (14.5 cm), in metres. A rig holds a clone of it (SkeletonUtils: its own bones, the
// geometry shared) inside the hand's root at 1 / SIZE, so the root's model frame is the same adult-scaled frame the rules and the capsule hand use.
// Its collision spheres are fitted to its own skin (meshProxies): every rule (closing, sliding, clearance, two hands) reads the mesh as drawn.
// Should the file not load, the capsule hand below is drawn instead (and everything else is the same).
const GLB = await handModel
const DIGIT_LINKS = { thumb_1: "t.0", thumb_2: "t.1", thumb_3: "t.2", palm: "palm", wrist: "wrist" }
DIGITS.forEach((d, i) => [1, 2, 3].forEach((j) => (DIGIT_LINKS[`${d}_${j}`] = `f${i}.${j - 1}`)))
const SKIN_LINKS = [...new Set(Object.values(DIGIT_LINKS))]
const MESH = GLB ? prepareMesh(GLB.scene) : null
let capsulesOnly = false
/** Whether the hands are drawn with hand.glb (else the procedural capsule hand: the file did not load, or useCapsules(true)). */
export const meshHand = () => !!MESH && !capsulesOnly
/** Draw the procedural capsule hand even though hand.glb loaded (true), or the mesh again (false): for the tests and the dev sheet. Rigs made
 *  before keep what they are. -> whether the mesh is drawn now. */
export function useCapsules(on = true) {
	capsulesOnly = !!on
	ref.built = false
	for (const k of Object.keys(scratchRigs)) delete scratchRigs[k]
	return meshHand()
}

/** The template: the glTF's scene, its bones by name, its measures (the root node's extras), its collision spheres. Null when it is not the
 *  contract's hand (a bone missing). */
function prepareMesh(scene) {
	scene.updateMatrixWorld(true)
	const bones = {}
	const meshes = []
	let measures = null
	scene.traverse((o) => {
		if (o.isBone) bones[o.name] = o
		if (o.isSkinnedMesh) meshes.push(o)
		if (o.userData?.hand_length) measures = o.userData
	})
	const missing = BONES.filter((b) => !bones[b])
	if (missing.length || !meshes.length) {
		console.warn(`hands: hand.glb is not the rig contract's hand (missing ${missing.join(", ") || "its meshes"}): the procedural hand is drawn`)
		return null
	}
	const proxies = meshProxies(meshes, bones)
	return { scene, bones, meshes, measures: measures ?? {}, proxies, skin: skinData(meshes) }
}

/** The skin's and the nails' vertices for skinning on the CPU (skinClearance): per mesh {mesh (its index in the rig's meshes), n, pos, idx, w
 *  (4 bones a vertex), inv (each bone's inverse bind, 3 x 4), all (every vertex but the forearm's past the wrist), byLink {link: [vertex]}}. */
function skinData(meshes) {
	const out = []
	meshes.forEach((m, k) => {
		if (m.material?.name === "sleeve") return
		const g = m.geometry
		const n = g.attributes.position.count
		const pos = new Float64Array(n * 3)
		const idx = new Uint8Array(n * 4)
		const w = new Float64Array(n * 4)
		const names = m.skeleton.bones.map((b) => b.name)
		const all = []
		const byLink = {}
		const v = new THREE.Vector3()
		for (let i = 0; i < n; i++) {
			v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(m.bindMatrix)
			pos[i * 3] = v.x
			pos[i * 3 + 1] = v.y
			pos[i * 3 + 2] = v.z
			let bi = 0
			let bw = -1
			for (let j = 0; j < 4; j++) {
				idx[i * 4 + j] = g.attributes.skinIndex.getComponent(i, j)
				w[i * 4 + j] = g.attributes.skinWeight.getComponent(i, j)
				if (w[i * 4 + j] > bw) {
					bw = w[i * 4 + j]
					bi = idx[i * 4 + j]
				}
			}
			const link = DIGIT_LINKS[names[bi]] ?? (v.x > -0.006 ? "wrist" : "arm")
			if (link === "arm") continue
			all.push(i)
			;(byLink[link] ??= []).push(i)
			// (skin a digit carries that is not its own: the ball of the thumb on the thumb's base, the palm's skin by a knuckle; "carried:<digit>")
			for (const dg of [...DIGITS, "thumb"]) {
				const own = dg === "thumb" ? ["thumb_1", "thumb_2", "thumb_3"] : [1, 2, 3].map((j) => `${dg}_${j}`)
				const mine = dg === "thumb" ? ["t.1", "t.2"] : [0, 1, 2].map((j) => `f${DIGITS.indexOf(dg)}.${j}`)
				if (mine.includes(link)) continue
				let wsum = 0
				for (let j = 0; j < 4; j++) if (own.includes(names[idx[i * 4 + j]])) wsum += w[i * 4 + j]
				if (wsum >= 0.1) (byLink[`carried:${dg}`] ??= []).push(i)
			}
		}
		const inv = m.skeleton.boneInverses.map((b) => b.elements.slice())
		out.push({ mesh: k, n, pos, idx, w, inv, all: Int32Array.from(all), byLink: Object.fromEntries(Object.entries(byLink).map(([l, a]) => [l, Int32Array.from(a)])) })
	})
	return out
}
const _sk = new THREE.Vector3()
const _sg = new THREE.Vector3()
const _bm = []
/** The drawn skin's (and nails') least clearance from field d, skinned as the GPU skins it (the rig's matrices must be current): of the parts in
 *  `links` (an array of part names; null: every part, not the forearm past the wrist, which is the arm capsule's). A capsule rig: its spheres'. */
export function skinClearance(rig, d, links = null, at = null) {
	if (!rig.mesh) return clearance(rig, d, links ? (l) => links.includes(l) : null)
	let best = Infinity
	for (const D of MESH.skin) {
		const bones = rig.meshes[D.mesh].skeleton.bones
		for (let b = 0; b < bones.length; b++) {
			const e = bones[b].matrixWorld.elements
			const v = D.inv[b]
			const M = (_bm[b] ??= new Float64Array(12))
			// (matrixWorld x inverse bind, the 3 x 4 that matters; column-major elements)
			for (let r = 0; r < 3; r++)
				for (let c = 0; c < 4; c++) M[r * 4 + c] = e[r] * v[c * 4] + e[4 + r] * v[c * 4 + 1] + e[8 + r] * v[c * 4 + 2] + (c === 3 ? e[12 + r] : 0)
		}
		const lists = links ? links.map((l) => D.byLink[l]).filter(Boolean) : [D.all]
		for (const list of lists)
			for (let q = 0; q < list.length; q++) {
				const i = list[q]
				const px = D.pos[i * 3]
				const py = D.pos[i * 3 + 1]
				const pz = D.pos[i * 3 + 2]
				let x = 0
				let y = 0
				let z = 0
				for (let j = 0; j < 4; j++) {
					const wt = D.w[i * 4 + j]
					if (!wt) continue
					const M = _bm[D.idx[i * 4 + j]]
					x += wt * (M[0] * px + M[1] * py + M[2] * pz + M[3])
					y += wt * (M[4] * px + M[5] * py + M[6] * pz + M[7])
					z += wt * (M[8] * px + M[9] * py + M[10] * pz + M[11])
				}
				const c = d(_sk.set(x, y, z))
				if (c < best) {
					best = c
					at?.set(x, y, z) // (where: the nearest point, when asked)
				}
			}
	}
	return best
}
/** A placed hand moved along unit `dir` (toward the thing of field d) until its own skin's nearest point (of `links`) is `gap` from it, never into
 *  field `others` (a step that would bring it within 1 mm of that is not taken): the collision spheres are the search's, the drawn skin says
 *  where it truly touches (a fist's knuckles lie a few millimetres inside their spheres). -> how far it moved (m). */
function seatOnSkin(rig, d, dir, { gap = 0.0004, links = null, others = null, square = 0.3, arm = null } = {}) {
	if (!rig.mesh) return 0
	let moved = 0
	rig.root.updateMatrixWorld(true)
	const o0 = others ? Math.min(0.001, skinClearance(rig, others)) : -Infinity // (never nearer than 1 mm to anything else, nor than it was)
	// (and its arm, along unit `arm` from the wrist, never nearer than 3 mm to anything else, nor than it was)
	const a0 = others && arm ? Math.min(0.003, armClearance(others, rig.root.position, arm)) : -Infinity
	const bad = () => others && (skinClearance(rig, others) < o0 - 1e-5 || (arm && armClearance(others, rig.root.position, arm) < a0 - 1e-7))
	const q = new THREE.Vector3()
	const g = new THREE.Vector3()
	const e = 1e-4
	for (let n = 0; n < 6; n++) {
		rig.root.updateMatrixWorld(true)
		const c = skinClearance(rig, d, links, q)
		let step = c - gap
		if (!Number.isFinite(step) || Math.abs(step) < 5e-5) break
		// (along the thing's own normal where the skin is nearest it, when that is toward it from where the hand came: a palm on a low box's top
		// edge is set down onto its top, not pushed along it)
		g.set(d(_sg.copy(q).setX(q.x + e)) - d(_sg.copy(q).setX(q.x - e)), d(_sg.copy(q).setY(q.y + e)) - d(_sg.copy(q).setY(q.y - e)), d(_sg.copy(q).setZ(q.z + e)) - d(_sg.copy(q).setZ(q.z - e)))
		const way = g.lengthSq() > 1e-12 && -g.dot(dir) / g.length() > square ? g.normalize().negate() : dir
		rig.root.position.addScaledVector(way, step)
		rig.root.updateMatrixWorld(true)
		// (a step toward it that would bring it nearer something else is halved until it does not)
		for (let i = 0; i < 8 && step > 0 && bad(); i++) {
			step /= 2
			rig.root.position.addScaledVector(way, -step)
			rig.root.updateMatrixWorld(true)
		}
		if (step > 0 && bad()) {
			rig.root.position.addScaledVector(way, -step)
			rig.root.updateMatrixWorld(true)
			break
		}
		moved += step
	}
	rig.root.updateMatrixWorld(true)
	return moved
}
/** A digit (0..3 a finger, "t" the thumb) closed or opened, all its joints together as it closes (closers), until its own drawn skin is `gap`
 *  from field d: a small last turn after the spheres' closing (closeFinger), at most 25 degrees each way. */
function closeOnSkin(rig, d, i, { most = null, gap = 0.0004 } = {}) {
	if (!rig.mesh) return
	const P = rig.pose
	const acc = closers(P, i, most)
	const links = i === "t" ? ["t.1", "t.2"] : [0, 1, 2].map((j) => `f${i}.${j}`)
	const top = i === "t" ? rig.t.cmc : rig.f[i].mcp
	const was = acc.map((a) => a.get())
	const at = (u) => {
		acc.forEach((a, j) => a.set(Math.min(Math.max(a.max, was[j]), was[j] + u * a.k)))
		applyPose(rig, P)
		top.updateMatrixWorld(true)
	}
	// (the skin it carries that is not its own, the ball of the thumb, the palm by a knuckle, never into it, nor nearer than it was if it was:
	// where that would be, the turn counts as touching)
	const carried = [`carried:${i === "t" ? "thumb" : DIGITS[i]}`]
	at(0)
	const k0 = Math.min(0.0001, skinClearance(rig, d, carried)) - 1e-5
	const c = (u) => {
		at(u)
		const own = skinClearance(rig, d, links)
		return skinClearance(rig, d, carried) < k0 ? Math.min(own, gap - 1e-4) : own
	}
	const c0 = c(0)
	if (!Number.isFinite(c0) || (c0 >= gap - 0.0002 && c0 <= gap + 0.0003)) return at(0)
	let lo
	let hi
	if (c0 > gap) {
		// (closer: the furthest turn that keeps it `gap` off)
		if (c(25) >= gap) return at(25)
		lo = 0
		hi = 25
	} else {
		// (in it or too near: the least opening that takes it `gap` off)
		if (c(-25) < gap) return at(0)
		lo = -25
		hi = 0
	}
	for (let k = 0; k < 12; k++) {
		const m = (lo + hi) / 2
		if (c(m) >= gap) lo = m
		else hi = m
	}
	at(lo)
}

/** The skin's and the nails' triangles at rest (the hand's frame, m), each corner with its normal, its strongest bone and its weights: {P:
 *  [Vector3], N: [Vector3], bone: [name], W: [{bone: weight}], tri: [[i, j, k]]}. */
function restSurface(meshes) {
	const P = []
	const N = []
	const bone = []
	const W = []
	const tri = []
	for (const m of meshes) {
		if (m.material?.name === "sleeve") continue // (the sleeve is the arm's: its capsule, ARM)
		const g = m.geometry
		const pos = g.attributes.position
		const SI = g.attributes.skinIndex
		const SW = g.attributes.skinWeight
		const names = m.skeleton.bones.map((b) => b.name)
		const base = P.length
		const nrm = g.attributes.normal
		for (let i = 0; i < pos.count; i++) {
			let bi = 0
			let bw = -1
			const ws = {}
			for (let k = 0; k < 4; k++) {
				const w = SW.getComponent(i, k)
				if (w > 0) ws[names[SI.getComponent(i, k)]] = (ws[names[SI.getComponent(i, k)]] ?? 0) + w
				if (w > bw) {
					bw = w
					bi = SI.getComponent(i, k)
				}
			}
			P.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix))
			N.push(nrm ? new THREE.Vector3().fromBufferAttribute(nrm, i).normalize() : new THREE.Vector3(0, 1, 0))
			bone.push(names[bi])
			W.push(ws)
		}
		const idx = g.index
		const n = idx ? idx.count : pos.count
		for (let i = 0; i + 2 < n; i += 3) tri.push(idx ? [base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2)] : [base + i, base + i + 1, base + i + 2])
	}
	return { P, N, bone, W, tri }
}

/** The collision spheres fitted to hand.glb's skin (the search's model of it), each in the rest frame of its own bone (m): [{bone, p: [x, y, z],
 *  r, link, mix: [{bone, p, w}] (skinned as the skin round it is), tip, root}]. They are fitted to the surface itself (its triangles), so each
 *  reaches the skin where it sits and lies a little inside it between its neighbours:
 *    a digit: its bones' cross-sections every 6.5 mm (one circle round each, two side by side, or one over the other, where it is clearly wider than
 *    thick or thicker than wide), the last one on the end bone reaching to the fingertip;
 *    the palm, the ball of the thumb and the wrist (the skin up to the knuckles): rows across it every 8.5 mm, each sphere from the skin's front to
 *    its back where it stands, the outermost set in to reach its sides;
 *    then a small one wherever the skin at rest is still more than 1.2 mm outside them all. */
function meshProxies(meshes, bones) {
	const S = restSurface(meshes)
	const inv = new Map()
	for (const [n, b] of Object.entries(bones)) inv.set(n, b.matrixWorld.clone().invert())
	const out = []
	const put = (bone, c, r) => out.push({ bone, p: [c.x, c.y, c.z], r, link: DIGIT_LINKS[bone] })
	// (a point's x along a bone, at rest: behind a finger's knuckle is the palm's)
	const along = (n, p) => p.clone().applyMatrix4(inv.get(n)).x

	// ---- the digits: the plane x = xs of each bone cut through its chain's triangles (the thumb: its two phalanges)
	/** The section of triangles `tris` (their corners in the bone's frame, Q) by the plane x = xs: [[y, z]]. */
	const cut = (Q, tris, xs) => {
		const pts = []
		for (const [a, b, c] of tris) {
			const T = [Q[a], Q[b], Q[c]]
			for (let e = 0; e < 3; e++) {
				const u = T[e]
				const v = T[(e + 1) % 3]
				if ((u.x - xs) * (v.x - xs) > 0 || u.x === v.x) continue
				const k = (xs - u.x) / (v.x - u.x)
				if (k < 0 || k > 1) continue
				pts.push([u.y + (v.y - u.y) * k, u.z + (v.z - u.z) * k])
			}
		}
		return pts
	}
	/** One or two circles round section points `pts` (y, z): [{y, z, r}]. */
	const circles = (pts) => {
		let y0 = Infinity
		let y1 = -Infinity
		let z0 = Infinity
		let z1 = -Infinity
		for (const [y, z] of pts) {
			y0 = Math.min(y0, y)
			y1 = Math.max(y1, y)
			z0 = Math.min(z0, z)
			z1 = Math.max(z1, z)
		}
		const hy = (y1 - y0) / 2
		const hz = (z1 - z0) / 2
		const yc = (y0 + y1) / 2
		const zc = (z0 + z1) / 2
		// (wider than thick: two side by side; thicker than wide: one over the other; else one)
		const cs = hz > hy * 1.12 ? [-1, 1].map((s) => ({ y: yc, z: zc + s * (hz - hy), s, k: 1 })) : hy > hz * 1.12 ? [-1, 1].map((s) => ({ y: yc + s * (hy - hz), z: zc, s, k: 0 })) : [{ y: yc, z: zc, s: 0 }]
		for (const c of cs) {
			c.r = 0
			for (const [y, z] of pts) {
				const off = c.k === 1 ? z - zc : y - yc
				if (c.s === 0 || Math.sign(off) === c.s || Math.abs(off) < 1e-9) c.r = Math.max(c.r, Math.hypot(y - c.y, z - c.z))
			}
		}
		return cs
	}
	const STEP = 0.0065
	for (const d of [...DIGITS, "thumb"]) {
		const chain = d === "thumb" ? ["thumb_2", "thumb_3"] : [1, 2, 3].map((j) => `${d}_${j}`)
		const first = chain[0]
		// (the chain's triangles: any corner on one of its bones and none behind its first knuckle)
		const tris = S.tri.filter((t) => t.some((i) => chain.includes(S.bone[i])) && t.every((i) => along(first, S.P[i]) > -0.003))
		for (const [j, n] of chain.entries()) {
			const Q = S.P.map((p) => p.clone().applyMatrix4(inv.get(n)))
			const last = j === chain.length - 1
			const L = last ? (bones[n].userData.tip?.[0] ?? 0.018) : (bones[n].userData.length ?? bones[chain[j + 1]].position.x)
			const station = (xs) => {
				const pts = cut(Q, tris, xs)
				return pts.length >= 6 ? circles(pts) : null
			}
			if (!last) {
				const k = Math.max(2, Math.ceil(L / STEP))
				for (let s = 0; s < k; s++) {
					const xs = (s * L) / k
					for (const c of station(xs) ?? []) put(n, new THREE.Vector3(xs, c.y, c.z), c.r)
				}
				continue
			}
			// the end bone: its last circle where its far side is the fingertip (x + r = the tip), the stations before it evenly to there
			let xe = L - 0.005
			let ce = null
			for (let i = 0; i < 6; i++) {
				const c = station(xe)
				if (!c) break
				ce = c
				const r = Math.max(...c.map((q) => q.r))
				const nx = L - r
				if (Math.abs(nx - xe) < 1e-5) break
				xe = Math.max(0.002, nx)
			}
			const k = Math.max(1, Math.ceil(xe / STEP))
			for (let s = 0; s < k; s++) {
				const xs = (s * xe) / k
				for (const c of station(xs) ?? []) put(n, new THREE.Vector3(xs, c.y, c.z), c.r)
			}
			for (const c of ce ?? []) put(n, new THREE.Vector3(xe, c.y, c.z), Math.max(c.r, L - xe))
			if (ce?.length) out.at(-1).tip = DIGIT_LINKS[n] // (the fingertip's: the pinch's and the pointing finger's own point)
		}
	}

	// ---- the palm, the ball of the thumb and the wrist: vertical lines (along y) through the skin up to the knuckles
	const body = (i) => {
		const b = S.bone[i]
		const p = S.P[i]
		if (b === "palm" || b === "wrist" || b === "thumb_1") return true
		if (b === "forearm") return p.x > -0.016
		if (b.endsWith("_1") || b === "thumb_2") return along(b, p) < 0.001 // (behind a knuckle: the palm's skin)
		return false
	}
	const btris = S.tri.filter((t) => t.some(body))
	// (the triangles in 4 mm cells of (x, z) by their bounds: a line looks only in its own cell)
	const CELL = 0.004
	const cells = new Map()
	const key = (i, k) => i * 100003 + k
	for (const t of btris) {
		const xs = t.map((i) => S.P[i].x)
		const zs = t.map((i) => S.P[i].z)
		for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
			for (let k = Math.floor(Math.min(...zs) / CELL); k <= Math.floor(Math.max(...zs) / CELL); k++) {
				const q = key(i, k)
				if (!cells.has(q)) cells.set(q, [])
				cells.get(q).push(t)
			}
	}
	/** Where the line through (x, z) along y meets the body's skin: {y0 (front), y1 (back), bone (the one most of the skin there moves with)}. */
	const hit = (x, z) => {
		let y0 = Infinity
		let y1 = -Infinity
		const votes = {}
		for (const t of cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
			const a = S.P[t[0]]
			const b = S.P[t[1]]
			const c = S.P[t[2]]
			const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
			if (Math.abs(den) < 1e-14) continue
			const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den
			const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den
			const l3 = 1 - l1 - l2
			if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
			const y = l1 * a.y + l2 * b.y + l3 * c.y
			y0 = Math.min(y0, y)
			y1 = Math.max(y1, y)
			for (const i of t) votes[S.bone[i]] = (votes[S.bone[i]] ?? 0) + 1
		}
		if (!(y1 - y0 > 0.003)) return null
		let bone = "palm"
		let best = -1
		for (const [b, v] of Object.entries(votes)) {
			const own = b === "thumb_1" || b === "thumb_2" ? "thumb_1" : b === "wrist" || b === "forearm" ? "wrist" : "palm"
			const w = (own === "thumb_1" ? 1.05 : 1) * v // (a tie: the ball of the thumb's)
			if (w > best) {
				best = w
				bone = own
			}
		}
		return { y0, y1, bone }
	}
	const ROW = 0.0085
	for (let x = -0.006; x <= 0.0665 + 1e-9; x += ROW) {
		// (the row's reach in z: where its lines meet the skin, every millimetre)
		const zs = []
		for (let z = -0.045; z <= 0.06 + 1e-9; z += 0.001) if (hit(x, z)) zs.push(z)
		if (!zs.length) continue
		// (its runs of skin: the thumb's ball may stand apart from the palm in a row)
		const runs = []
		for (const z of zs) {
			const run = runs.at(-1)
			if (run && z - run[1] < 0.0015) run[1] = z
			else runs.push([z, z])
		}
		for (const [zmin, zmax] of runs) {
			const at = (z) => hit(x, z)
			// (the outermost spheres set in so that each one's far side is the skin's side)
			let za = zmin
			let zb = zmax
			for (let i = 0; i < 5; i++) {
				const a = at(za)
				const b = at(zb)
				za = Math.min(zmin + (a ? (a.y1 - a.y0) / 2 : 0), (zmin + zmax) / 2)
				zb = Math.max(zmax - (b ? (b.y1 - b.y0) / 2 : 0), (zmin + zmax) / 2)
			}
			const n = Math.max(1, Math.round((zb - za) / ROW) + 1)
			for (let i = 0; i < n; i++) {
				const z = n === 1 ? (za + zb) / 2 : za + ((zb - za) * i) / (n - 1)
				const h = at(z)
				if (!h) continue
				const c = new THREE.Vector3(x, (h.y0 + h.y1) / 2, z)
				put(h.bone, c.applyMatrix4(inv.get(h.bone)), (h.y1 - h.y0) / 2)
			}
		}
	}

	// ---- each sphere moves as the skin round it does: its middle skinned with the mean weights of the skin it reaches (within 1.5 mm of it), so a
	// knuckle's sphere follows the knuckle's skin as the finger bends (one bone alone where that bone carries nine tenths of it). Its part (`link`)
	// is a digit station's own bone's, else the most distal bone that carries a quarter of that skin: a finger's sphere stops that finger's closing
	// where it touches.
	const restOf = (q) => new THREE.Vector3(...q.p).applyMatrix4(bones[q.bone].matrixWorld)
	const depth = (b) => {
		let n = 0
		for (let o = bones[b]; o?.isBone; o = o.parent) n++
		return n
	}
	const skinned = (c, r, fixed) => {
		const ws = {}
		for (let i = 0; i < S.P.length; i++) {
			if (S.P[i].distanceTo(c) > r + 0.0015) continue
			for (const [b, w] of Object.entries(S.W[i])) if (bones[b]) ws[b] = (ws[b] ?? 0) + w
		}
		const tot = Object.values(ws).reduce((x, y) => x + y, 0)
		if (!tot) ws[fixed ?? "palm"] = 1
		const T = tot || 1
		let own = fixed
		if (!own) {
			own = "palm"
			let best = [-1, -1]
			for (const [b, w] of Object.entries(ws)) {
				if (w / T < 0.25) continue
				const key = [depth(b), w]
				if (key[0] > best[0] || (key[0] === best[0] && key[1] > best[1])) {
					best = key
					own = b
				}
			}
		}
		let list = Object.entries(ws).filter(([, w]) => w / T >= 0.06)
		if (!list.length) list = [[own, 1]]
		const sum = list.reduce((x, [, w]) => x + w, 0)
		list = list.map(([b, w]) => [b, w / sum]).sort((x, y) => y[1] - x[1]).slice(0, 4)
		if (list[0][1] >= 0.9) list = [[list[0][0], 1]]
		const sum2 = list.reduce((x, [, w]) => x + w, 0)
		return { own, mix: list.map(([b, w]) => ({ bone: b, p: c.clone().applyMatrix4(inv.get(b)).toArray(), w: w / sum2 })) }
	}
	const settle = (q, fixed) => {
		const c = restOf(q)
		const k = skinned(c, q.r, fixed)
		q.bone = k.own
		q.p = c.clone().applyMatrix4(inv.get(k.own)).toArray()
		q.mix = k.mix
		q.link = DIGIT_LINKS[k.own] ?? q.link
		// (a finger's root, within 8 mm of its knuckle, is part of the palm's face: a palm laid on a thing lies on it too)
		q.root = q.link?.startsWith("f") && q.link.endsWith(".0") && q.p[0] < 0.008
	}
	for (const q of out) settle(q, q.link?.startsWith("f") || q.link === "t.1" || q.link === "t.2" ? q.bone : null)

	// ---- what is still left out at rest (a rounded edge, a knuckle's side): a small sphere just inside the skin at each point more than 1.2 mm
	// outside every sphere, skinned as that point is, until none is (the forearm beyond the wrist is the arm's capsule's). The spheres are the
	// search's: where the hand truly touches is fitted on the drawn skin itself afterwards (seatOnSkin, closeOnSkin)
	const world = out.map((q) => ({ c: restOf(q), r: q.r }))
	const outside = (p) => {
		let d = Infinity
		for (const w of world) d = Math.min(d, p.distanceTo(w.c) - w.r)
		return d
	}
	const RHO = 0.006
	const left = []
	for (let i = 0; i < S.P.length; i++) {
		const b = S.bone[i]
		if (b === "forearm" ? S.P[i].x < -0.006 : !DIGIT_LINKS[b]) continue
		const d = outside(S.P[i])
		if (d > 0.0012) left.push({ i, d })
	}
	left.sort((x, y) => y.d - x.d)
	for (const { i } of left) {
		const p = S.P[i]
		if (outside(p) <= 0.0012) continue
		const c = p.clone().addScaledVector(S.N[i], -RHO)
		const own = S.bone[i] === "forearm" ? "wrist" : S.bone[i]
		world.push({ c, r: RHO })
		const q = { bone: own, p: c.clone().applyMatrix4(inv.get(own)).toArray(), r: RHO, link: DIGIT_LINKS[own] }
		settle(q, null)
		out.push(q)
	}
	return out
}

/** A rig of hand.glb (see makeRig): its root (scale SIZE, mirrored for a right hand) holds the clone at 1 / SIZE; rig.arm is the arm's frame as
 *  placeArm sets it (the forearm bone turns with it). */
function meshRig(side) {
	const M = handMats()
	const root = new THREE.Group()
	root.name = `hand-${side}`
	root.scale.set(SIZE, SIZE, side === "right" ? -SIZE : SIZE)
	const inner = cloneSkinned(MESH.scene)
	inner.name = "hand-mesh"
	inner.scale.setScalar(1 / SIZE)
	root.add(inner)
	const B = {}
	const meshes = []
	inner.traverse((o) => {
		if (o.isBone) B[o.name] = o
		if (o.isSkinnedMesh) {
			o.material = M[o.material?.name] ?? M.skin
			o.castShadow = true
			o.receiveShadow = true
			o.frustumCulled = false // (its bones move it far from its bind pose's bounds)
			meshes.push(o)
		}
	})
	const arm = new THREE.Group()
	arm.name = `arm-${side}`
	const bones = Object.fromEntries(BONES.map((n) => [n, B[n]]))
	const rig = { root, arm, mesh: true, inner, bones, f: DIGITS.map((d) => ({ mcp: B[`${d}_1`], pip: B[`${d}_2`], dip: B[`${d}_3`] })), t: { cmc: B.thumb_1, mcp: B.thumb_2, ip: B.thumb_3 }, spheres: [], meshes, side, pose: copyPose(POSES.relaxed), length: ARM.len, sleeveOn: null }
	// the sleeve on up the arm from where the file's own ends (on the forearm bone, so it moves as that sleeve does; after the skinned meshes, whose
	// order the skin's data keeps)
	rig.bendAt = 90
	const tube = sleeveTube(ARM.len, rig.bendAt)
	if (tube) {
		const on = new THREE.Mesh(tube, M.sleeve)
		on.name = "sleeve-on"
		on.castShadow = true
		on.receiveShadow = true
		B.forearm.add(on)
		meshes.push(on)
		rig.sleeveOn = on
	}
	applyPose(rig, rig.pose)
	return rig
}

/** The skin's (and the nails') points as drawn now, skinned as the GPU skins them (world m; the rig's matrices must be current): every
 *  `every`th vertex, [{p, n (its normal, outward), bone (strongest), link}]. A capsule rig has none ([]). For the tests and the dev sheet. */
export function skinPoints(rig, every = 1) {
	if (!rig.mesh) return []
	const out = []
	const m4 = new THREE.Matrix4()
	const n3 = new THREE.Matrix3()
	for (const m of rig.meshes) {
		if (m.material === handMats().sleeve) continue
		const P = m.geometry.attributes.position
		const NR = m.geometry.attributes.normal
		const SI = m.geometry.attributes.skinIndex
		const SW = m.geometry.attributes.skinWeight
		const bs = m.skeleton.bones
		const mats = bs.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, m.skeleton.boneInverses[i]).multiply(m.bindMatrix))
		const v = new THREE.Vector3()
		const nv = new THREE.Vector3()
		const acc = new THREE.Vector3()
		const nacc = new THREE.Vector3()
		const t = new THREE.Vector3()
		for (let i = 0; i < P.count; i += every) {
			v.fromBufferAttribute(P, i)
			if (NR) nv.fromBufferAttribute(NR, i)
			acc.set(0, 0, 0)
			nacc.set(0, 0, 0)
			let bi = 0
			let bw = -1
			for (let k = 0; k < 4; k++) {
				const w = SW.getComponent(i, k)
				if (!w) continue
				const j = SI.getComponent(i, k)
				m4.copy(mats[j])
				acc.addScaledVector(t.copy(v).applyMatrix4(m4), w)
				if (NR) nacc.addScaledVector(t.copy(nv).applyMatrix3(n3.getNormalMatrix(m4)), w)
				if (w > bw) {
					bw = w
					bi = j
				}
			}
			out.push({ p: acc.clone(), n: nacc.clone().normalize(), bone: bs[bi].name, link: DIGIT_LINKS[bs[bi].name] ?? "arm" })
		}
	}
	return out
}

/** One hand (left; `right` mirrors it) and its arm: {root (the hand, at the wrist joint), arm (placed at the wrist along the arm), f: [{mcp, pip, dip}],
 *  t: {cmc, mcp, ip}, spheres: [{obj, p: Vector3 (in obj's frame), r, link}], meshes, side, mesh (hand.glb's, else the capsule hand)}. */
export function makeRig(side = "left") {
	return meshHand() ? meshRig(side) : capsuleRig(side)
}

/** The procedural hand (the capsule hand drawn before hand.glb; drawn when the file does not load). */
function capsuleRig(side = "left") {
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
	// (the sleeve on from the elbow, turned there toward the upright by placeArm, and a ball of sleeve over the joint)
	const upper = add(arm, mesh(sleeve.geometry, M.sleeve))
	upper.position.x = ARM.elbow / SIZE
	const joint = add(arm, mesh(geo("joint", () => new THREE.SphereGeometry(1, 24, 16)), M.sleeve))
	joint.position.x = ARM.elbow / SIZE
	const rig = { root, arm, f, t: { cmc, mcp: tm, ip: ti }, spheres, meshes, side, sleeve, upper, joint, cuff, pose: copyPose(POSES.relaxed), length: 0.6 }
	setArm(rig, 0.6)
	applyPose(rig, rig.pose)
	return rig
}

// ---------------------------------------------------------------- the arm: the forearm in its sleeve, from the wrist out of the picture
// The arm reaches in from the picture's edge to the wrist (no elbow, no person): the skin of the forearm out of the wrist, the sleeve's knit cuff
// (hand.glb's, 2.85 cm up the forearm) and the sleeve carried on up the arm out of the picture (setArm: as far as the picture's edge along it and
// 30 cm more), so a hand is never seen floating at the end of a stub. It leaves the hand from the picture's nearer edge (or the side the hold or
// the push says) rising ARM.side degrees over the level (ARM.above from above: 15 to 35 off the upright; a small thing pinched from above is
// reached for from the picture's nearer edge, its arm rising from ARM.reachIn, so its sleeve is seen coming in), never along the floor or a table, never
// through anything (its line ARM.reach long, armR round it), its wrist bent no further than a child's goes easily (WRIST: the back of the hand
// toward the forearm up to 75 degrees, the palm toward it 60; toward the thumb 22, away from it 32). A hand with a thing on its open palm may have
// its forearm slope down to the elbow as much instead (ARM.below: a tray held out), with room under it. Its clearance is a tapered capsule round
// its line, from ARM.from m out of the wrist (the hand's own wrist sphere covers the rest) at ARM.r0 to the sleeve's cuff end at ARM.r1
// (hand.glb's: the forearm 4.9 cm across 2 cm from the wrist, the sleeve 6.1 cm across 7.75 cm from the wrist; round, so a little more than the
// arm's own height), the sleeve then widening by ARM.flare toward the elbow; ARM.r where an arm's first stretch meets another arm.
export const ARM = { len: 0.6, reach: 0.45, from: 0.02, cuff: 0.0775, r0: 0.0245, r1: 0.0315, flare: 0.12, r: 0.0315, side: [15, 35], above: [55, 75], reachIn: 35, below: [-30, -5], level: 5, elbow: 0.21, bend: 12, arc: 0.03 }
// The elbow (ARM.elbow m up the arm from the wrist, a nine-year-old's forearm) bends the sleeve ARM.bend degrees toward the upright, softly over
// ARM.arc m of it, so the arm reads as an arm on its way to a shoulder above it, never a straight pole (the upper arm rises more steeply than the
// forearm, as a child's does reaching down to a thing).
const _bu = new THREE.Vector3()
/** The upper arm's way for a forearm along unit A (from the wrist toward the elbow): A turned ARM.bend degrees toward the upright (toward -z,
 *  away from the camera, when A is itself upright). */
export function upperArm(A, out = new THREE.Vector3()) {
	_bu.set(0, 1, 0).addScaledVector(A, -A.y)
	if (_bu.lengthSq() < 1e-4) _bu.set(0, 0, -1).addScaledVector(A, -A.z)
	_bu.normalize()
	return out.copy(A).multiplyScalar(Math.cos(ARM.bend * D2R)).addScaledVector(_bu, Math.sin(ARM.bend * D2R)).normalize()
}
const _ua = new THREE.Vector3()
/** The point s m up the arm of a hand at wrist W whose forearm leaves along unit A: along A to the elbow, then along the upper arm (upperArm). */
export function armAt(W, A, s, out = new THREE.Vector3()) {
	if (s <= ARM.elbow) return out.copy(W).addScaledVector(A, s)
	return out.copy(W).addScaledVector(A, ARM.elbow).addScaledVector(upperArm(A, _ua), s - ARM.elbow)
}
/** How far up the arm (m) from wrist W along forearm A to be out of the picture (exit: frameExit's), the arm bent at its elbow. */
export function armExit(exit, W, A) {
	const s = exit(W, A)
	if (s <= ARM.elbow) return s
	return ARM.elbow + exit(armAt(W, A, ARM.elbow), upperArm(A))
}
/** The arm's radius s m up it from the wrist, as its clearance reads it: ARM.r0 at ARM.from, growing to ARM.r1 at the end of hand.glb's own
 *  sleeve, then the sleeve widening by ARM.flare over 25 cm toward the elbow (setArm draws it so). */
export const armR = (s) => (s <= ARM.from ? ARM.r0 : s <= ARM.cuff ? ARM.r0 + ((ARM.r1 - ARM.r0) * (s - ARM.from)) / (ARM.cuff - ARM.from) : ARM.r1 * (1 + ARM.flare * smooth((s - ARM.cuff) / 0.25)))
// (a palm pushing a thing has its wrist bent back further, up to WRIST.push, and its forearm may run nearly level, from ARM.level degrees: the push
// bends it back, as an arm pushing a wall is; so the hand stands flat on the thing's back, its fingers up)
export const WRIST = { ext: 75, flex: 60, thumb: 22, away: 32, push: 88 }
/** The sleeve to `length` m from the wrist (out of the picture: the way to the picture's edge along the arm and 30 cm more, at least 45 cm).
 *  hand.glb's own sleeve ends open 7.75 cm up the forearm; the rest of it is drawn on from that end's very section (sleeveOn). */
export function setArm(rig, length = ARM.len) {
	rig.length = Math.max(length, ARM.reach)
	if (rig.mesh) {
		if (rig.sleeveOn) {
			rig.sleeveOn.geometry = sleeveTube(rig.length, rig.bendAt ?? 90)
			rig.sleeveOn.visible = true
		}
		return
	}
	// (the capsule arm: its sleeve to the elbow, and on from there, turned at the elbow as placeArm says, a ball of sleeve over the joint)
	const E = ARM.elbow / SIZE
	const r = ARM_R + 0.0015
	rig.sleeve.scale.set(Math.max(0.01, E - 0.044), r, r * 1.1)
	rig.upper.scale.set(Math.max(0.06, (rig.length - ARM.elbow) / SIZE), r, r * 1.1)
	rig.joint.scale.set(r, r, r * 1.1)
}
/** hand.glb's sleeve carried on from its open end out to `length` m from the wrist, in the forearm bone's frame (its -x up the arm): its end's own
 *  section (the glTF's extras), widening by ARM.flare over 25 cm and then straight, bent at the elbow ARM.bend degrees toward `bendAt` (degrees
 *  round the bone's -x from its +y toward its +z: the upright as placeArm finds it in the bone's frame), rings closer where it bends. Shared by
 *  every arm of that length (to the centimetre) and bend (to 3 degrees). Null when the file's sleeve is closed (an older hand.glb). */
function sleeveTube(length, bendAt = 90) {
	const S = MESH?.measures?.sleeve
	if (!S?.open || !Array.isArray(S.ring) || S.ring.length < 8) return null
	const L = Math.round(Math.max(length, ARM.reach) * 100) / 100
	const th = (((Math.round(bendAt / 3) * 3) % 360) + 360) % 360
	return geo(`sleeveOn|${L}|${th}`, () => {
		const ring = S.ring
		const n = ring.length
		const x0 = S.end_x ?? -ARM.cuff
		let cy = 0
		let cz = 0
		for (const [y, z] of ring) {
			cy += y / n
			cz += z / n
		}
		const run = Math.max(0.05, L + x0) // (from the open end to the far end, m)
		// (the elbow's soft bend, along the arm from the open end: its arc's start and end)
		const ue = ARM.elbow + x0
		const a0 = ue - ARM.arc / 2
		const a1 = ue + ARM.arc / 2
		const steps = [0, 0.01, 0.025, 0.045, 0.07, 0.1].filter((u) => u < a0 - 0.004)
		for (let k = 0; k <= 6; k++) steps.push(a0 + ((a1 - a0) * k) / 6)
		for (const u of [0.14, 0.19, 0.25]) if (u > a1 + 0.01 && u < run - 0.02) steps.push(u)
		for (let u = 0.35; u < run - 0.02; u += 0.1) if (u > a1 + 0.01) steps.push(u)
		steps.push(run)
		steps.sort((a, b) => a - b)
		// (the centre line: straight up the arm (-x), turned in the plane of -x and the bend's way B by phi(u), 0 before the arc and ARM.bend after it)
		const by = Math.cos(th * D2R)
		const bz = Math.sin(th * D2R)
		const beta = ARM.bend * D2R
		const phi = (u) => (u <= a0 ? 0 : u >= a1 ? beta : (beta * (u - a0)) / (a1 - a0))
		const centre = (u) => {
			// (integrated along the arc: straight, an arc of radius arc/beta, straight)
			const R = (a1 - a0) / beta
			let x = 0
			let b = 0
			if (u <= a0) x = -u
			else if (u <= a1) {
				const p = phi(u)
				x = -a0 - R * Math.sin(p)
				b = R * (1 - Math.cos(p))
			} else {
				x = -a0 - R * Math.sin(beta) - (u - a1) * Math.cos(beta)
				b = R * (1 - Math.cos(beta)) + (u - a1) * Math.sin(beta)
			}
			return { x: x0 + x, y: cy + b * by, z: cz + b * bz }
		}
		const pos = []
		for (const u of steps) {
			const f = 1 + ARM.flare * smooth(u / 0.25)
			const p = phi(u)
			const c = centre(u)
			for (const [y, z] of ring) {
				// (the ring's offset from the centre, its part along B turned with the centre line, its part across it as it is)
				const oy = (y - cy) * f
				const oz = (z - cz) * f
				const ob = oy * by + oz * bz
				const on = -oy * bz + oz * by
				// B turned by p in the plane of -x and B: B -> B cos p + x sin p (the line bends from -x toward B, so B tips back toward +x)
				const bx = Math.sin(p)
				const bb = Math.cos(p)
				pos.push(c.x + ob * bx, c.y + ob * bb * by - on * bz, c.z + ob * bb * bz + on * by)
			}
		}
		const idx = []
		for (let i = 0; i + 1 < steps.length; i++)
			for (let j = 0; j < n; j++) {
				const a = i * n + j
				const b = i * n + ((j + 1) % n)
				const c = (i + 1) * n + ((j + 1) % n)
				const d = (i + 1) * n + j
				idx.push(a, b, c, a, c, d)
			}
		const g = new THREE.BufferGeometry()
		g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
		g.setIndex(idx)
		g.computeVertexNormals()
		// (outward: the ring runs round so its faces may look in; turned when they do)
		const nrm = g.attributes.normal
		const p0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, n * 2)
		const n0 = new THREE.Vector3().fromBufferAttribute(nrm, n * 2)
		const c2 = centre(steps[2])
		if (n0.dot(new THREE.Vector3(0, p0.y - c2.y, p0.z - c2.z)) < 0) {
			for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]]
			g.setIndex(idx)
			g.computeVertexNormals()
		}
		// (the first ring's normals square to the ring in its own plane, as the file's own sleeve has them where it ends: no seam)
		for (let j = 0; j < n; j++) {
			const [ya, za] = ring[(j + n - 1) % n]
			const [yb, zb] = ring[(j + 1) % n]
			const v = new THREE.Vector3(0, zb - za, -(yb - ya)).normalize()
			if (v.y * (ring[j][0] - cy) + v.z * (ring[j][1] - cz) < 0) v.negate()
			nrm.setXYZ(j, v.x, v.y, v.z)
		}
		nrm.needsUpdate = true
		g.computeBoundingSphere()
		return g
	})
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
	if (rig.mesh) {
		// (hand.glb's own: fitted to its skin once, meshProxies; their radii in the model frame, as the root scales them)
		rig.spheres = MESH.proxies.map((q, i) => {
			const S = { obj: B[q.bone], p: new THREE.Vector3(...q.p), r: q.r / SIZE, link: q.link, mix: null, tip: q.tip ?? null, root: !!q.root, g: 0 }
			if (q.mix.length > 1) S.mix = q.mix.map((m) => ({ obj: B[m.bone], p: new THREE.Vector3(...m.p), w: m.w }))
			else if (q.mix[0].bone !== q.bone) {
				S.obj = B[q.mix[0].bone]
				S.p = new THREE.Vector3(...q.mix[0].p)
			}
			return S
		})
		// (and their groups, one a bone, each with a bound that holds however the hand is posed: clearance looks into a group only when its bound
		// could come nearer than the best yet)
		MESH.groups ??= sphereGroups(rig)
		rig.groups = MESH.groups.map((g, k) => {
			const spheres = g.idx.map((i) => rig.spheres[i])
			for (const S of spheres) S.g = k
			return { obj: B[g.bone], c: new THREE.Vector3(...g.c), R: g.R, spheres, db: 0 }
		})
		return rig.spheres
	}
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
/** hand.glb's spheres grouped by the bone they sit on, each group's bound in that bone's frame (m): the farthest of its spheres' reach from their
 *  middle, and for a sphere skinned across bones as far again as it strays from that bone in any pose and any wrist bend (plus a millimetre):
 *  [{bone, c, R, idx}]. Measured once on a rig of the mesh. */
function sphereGroups(rig) {
	const S = rig.spheres
	const dev = S.map(() => 0)
	rig.root.position.set(0, 0, 0)
	rig.root.quaternion.identity()
	rig.root.scale.set(SIZE, SIZE, SIZE)
	const a = new THREE.Vector3()
	const b = new THREE.Vector3()
	const arms = [V(-1, 0, 0), ...[[90, 0], [-60, 0], [0, 30], [0, -30], [75, 25], [75, -25], [-50, 20]].map(([e, dv]) => V(-Math.cos(e * D2R) * Math.cos(dv * D2R), Math.sin(e * D2R), Math.sin(dv * D2R) * Math.cos(e * D2R)).normalize())]
	for (const P of [pose(), ...Object.values(POSES)])
		for (const A of arms) {
			applyPose(rig, P)
			placeArm(rig, A)
			rig.root.updateMatrixWorld(true)
			S.forEach((s, i) => {
				if (!s.mix) return
				sphereAt(s, a)
				b.copy(s.p).applyMatrix4(s.obj.matrixWorld)
				dev[i] = Math.max(dev[i], a.distanceTo(b))
			})
		}
	const by = new Map()
	S.forEach((s, i) => {
		const n = s.obj.name
		if (!by.has(n)) by.set(n, [])
		by.get(n).push(i)
	})
	const out = []
	for (const [bone, idx] of by) {
		const c = new THREE.Vector3()
		for (const i of idx) c.add(S[i].p)
		c.multiplyScalar(1 / idx.length)
		let R = 0
		for (const i of idx) R = Math.max(R, S[i].p.distanceTo(c) + S[i].r * SIZE + 1.5 * dev[i] + 0.001)
		out.push({ bone, c: c.toArray(), R, idx })
	}
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
	// (the elbow's way: the upright square to the arm, as the arm's own frame or the forearm bone's sees it)
	upperArm(_xa, _ub)
	_ub.addScaledVector(_xa, -_ub.dot(_xa))
	if (rig.mesh) {
		// hand.glb's forearm bone: its -x along the arm, in the hand's own (left, model) frame, the least turn from the hand's (armTurns), the wrist
		// bone turned back by as much so the hand stays as placed; the skin between bends as the wrist does
		rig.root.updateMatrix()
		_im.copy(rig.root.matrix).invert() // (A is in the hands' frame, the root's parent's)
		_al.copy(A).transformDirection(_im)
		const t = armTurns(_x1, _y1, _al)
		rig.bones.forearm.quaternion.copy(t.forearm)
		rig.bones.wrist.quaternion.copy(t.wrist)
		// (the sleeve bent at the elbow toward the upright: the way in the bone's own frame, the geometry for it to 3 degrees)
		if (rig.sleeveOn) {
			const bone = rig.bones.forearm
			bone.updateMatrixWorld(true)
			const e = bone.matrixWorld.elements
			const yb = _yb.set(e[4], e[5], e[6]).normalize()
			const zb = _zb.set(e[8], e[9], e[10]).normalize()
			const at = Math.atan2(_ub.dot(zb), _ub.dot(yb)) / D2R
			if (Math.abs((((at - (rig.bendAt ?? 90) + 540) % 360) - 180)) > 1.5) {
				rig.bendAt = at
				rig.sleeveOn.geometry = sleeveTube(rig.length, at)
			}
		}
	} else if (rig.upper) {
		// (the capsule arm: its sleeve on from the elbow turned toward the upright in the arm's own frame)
		_ub.normalize()
		const ly = _ub.dot(_ya)
		const lz = _ub.dot(_za)
		_bq.setFromUnitVectors(_x1, _bl.set(Math.cos(ARM.bend * D2R), Math.sin(ARM.bend * D2R) * ly, Math.sin(ARM.bend * D2R) * lz).normalize())
		rig.upper.quaternion.copy(_bq)
	}
}
const _ub = new THREE.Vector3()
const _yb = new THREE.Vector3()
const _zb = new THREE.Vector3()
const _bl = new THREE.Vector3()
const _bq = new THREE.Quaternion()
const _im = new THREE.Matrix4()
const _al = new THREE.Vector3()
const _x1 = new THREE.Vector3(1, 0, 0)
const _y1 = new THREE.Vector3(0, 1, 0)

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
const _sw = new THREE.Vector3()
/** Where collision sphere S is now (world; its bones' matrices must be current): on its bone, or (hand.glb's spheres where the skin blends
 *  between bones) skinned as that skin is. -> out. */
export function sphereAt(S, out) {
	if (!S.mix) return out.copy(S.p).applyMatrix4(S.obj.matrixWorld)
	out.set(0, 0, 0)
	for (const m of S.mix) out.addScaledVector(_sw.copy(m.p).applyMatrix4(m.obj.matrixWorld), m.w)
	return out
}
/** The least clearance (m) between the rig's spheres of the given links and the field d (the rig's matrices must be current). */
function clearance(rig, d, links = null) {
	let m = Infinity
	const G = rig.groups
	if (!G) {
		for (const S of rig.spheres) {
			if (links && !links(S.link, S)) continue
			sphereAt(S, _w)
			m = Math.min(m, d(_w) - S.r * SIZE)
		}
		return m
	}
	// (hand.glb: the groups nearest first; one whose bound is no nearer than the best yet holds nothing nearer)
	for (const g of G) g.db = d(_w.copy(g.c).applyMatrix4(g.obj.matrixWorld)) - g.R * g.obj.matrixWorld.getMaxScaleOnAxis()
	_gs.length = 0
	for (const g of G) _gs.push(g)
	_gs.sort((x, y) => x.db - y.db)
	for (const g of _gs) {
		if (g.db >= m) break
		for (const S of g.spheres) {
			if (links && !links(S.link, S)) continue
			sphereAt(S, _w)
			const c = d(_w) - S.r * SIZE
			if (c < m) m = c
		}
	}
	return m
}
const _gs = []
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
	// (the parts the digit carries that are not its own: the ball of the thumb on the thumb's base; on hand.glb, the skin of the palm by a knuckle
	// that moves a little with its finger. The closing never takes them into it, nor nearer than they were if they were in it already)
	const own = new Set(isT ? [rig.t.cmc, rig.t.mcp, rig.t.ip] : [rig.f[i].mcp, rig.f[i].pip, rig.f[i].dip])
	const carried = (l, S) => !links.includes(l) && (S.mix ? S.mix.some((m) => own.has(m.obj)) : own.has(S.obj))
	const t0 = Math.min(isT && !rig.mesh ? gap : 0, clearance(rig, d, carried)) - 1e-5
	const hitAt = (j, upTo = j) => {
		for (let k = active; k <= upTo; k++) if (clearance(rig, d, linkOf(k)) < gap) return true
		return clearance(rig, d, carried) < t0
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
		if (hit < 0 && clearance(rig, d, carried) < t0) hit = active
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
			if (!(parts(S.link) || carried(S.link, S))) continue
			sphereAt(S, _w)
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
	// (a fingertip: the middle of its tip sphere, the last on its end bone; the capsule hand's, its tip capsule's end)
	const tipOf = (rig, i) => {
		rig.root.updateMatrixWorld(true)
		const o = i === "t" ? rig.t.ip : rig.f[i].dip
		if (rig.mesh) {
			const S = rig.spheres.find((s) => s.tip === (i === "t" ? "t.2" : `f${i}.2`))
			return sphereAt(S, new THREE.Vector3())
		}
		const L = i === "t" ? THUMB.L[2] - THUMB.r[3] : FINGERS[i].L[2] - FINGERS[i].r * TAPER[3]
		return new THREE.Vector3(L, 0, 0).applyMatrix4(o.matrixWorld)
	}
	applyPose(r, POSES.pinch)
	const it = tipOf(r, 0)
	const tt = tipOf(r, "t")
	ref.pinchAt = it.clone().add(tt).multiplyScalar(0.5)
	ref.pinchAxis = it.clone().sub(tt).normalize() // (from the thumb's pad to the index's)
	applyPose(r, POSES.point)
	r.root.updateMatrixWorld(true)
	const dip = r.f[0].dip
	// (the index's very tip: hand.glb's own tip point on its end bone)
	ref.pointTip = r.mesh ? new THREE.Vector3(...(dip.userData.tip ?? [0.016, 0, 0])).applyMatrix4(dip.matrixWorld) : tipOf(r, 0).add(new THREE.Vector3(FINGERS[0].r * TAPER[3], 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(dip.matrixWorld)))
	// (the pressing fingertip: tap's index tip, and the way its end bone points, in the hand's own frame)
	applyPose(r, POSES.tap)
	r.root.updateMatrixWorld(true)
	ref.tapTip = r.mesh ? new THREE.Vector3(...(dip.userData.tip ?? [0.016, 0, 0])).applyMatrix4(dip.matrixWorld) : tipOf(r, 0).add(new THREE.Vector3(FINGERS[0].r * TAPER[3], 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(dip.matrixWorld)))
	ref.tapDir = new THREE.Vector3(1, 0, 0).transformDirection(dip.matrixWorld)
	// the palm's front (its skin, at rest) under (x, z) of the hand's frame: the lowest of the palm's, the thumb ball's and the wrist's spheres there
	applyPose(r, pose())
	r.root.updateMatrixWorld(true)
	const under = r.spheres.filter((s) => s.link === "palm" || s.link === "t.0" || s.link === "wrist").map((s) => ({ c: sphereAt(s, new THREE.Vector3()), r: s.r }))
	ref.palmAt = (x, z = 0) => {
		if (!r.mesh) return new THREE.Vector3(x, -PALM_T / 2 - 0.0003, z)
		let y = Infinity
		for (const s of under) {
			const d = Math.hypot(x - s.c.x, z - s.c.z)
			if (d < s.r) y = Math.min(y, s.c.y - Math.sqrt(s.r * s.r - d * d))
		}
		return new THREE.Vector3(x, (Number.isFinite(y) ? y : -PALM_T / 2) - 0.0003, z)
	}
	// the palm's middle and its heel (the ball of the hand over the wrist), on its surface: where a palm presses and where a pushing hand meets
	ref.palmC = ref.palmAt(0.046)
	ref.heel = ref.palmAt(0.022, -0.004)
	// (a palm's width across its knuckles, m as drawn)
	ref.palmW = r.mesh ? (MESH.measures.palm_width ?? PALM_W * SIZE) : PALM_W * SIZE
	// the pinch opened by k toward pinchOpen (0: the tips meeting): its tips' gap (m as drawn), their midpoint and the thumb-to-index axis (the hand's
	// own frame), every 0.05 of k
	ref.pinchTab = []
	for (let k = 0; k <= 1.3 + 1e-9; k += 0.05) {
		applyPose(r, lerpPose(POSES.pinch, POSES.pinchOpen, k))
		const it = tipOf(r, 0)
		const tt = tipOf(r, "t")
		const ra = r.mesh ? r.spheres.find((q) => q.tip === "f0.2").r : FINGERS[0].r * TAPER[3]
		const rb = r.mesh ? r.spheres.find((q) => q.tip === "t.2").r : THUMB.r[3]
		ref.pinchTab.push({ k, gap: (it.distanceTo(tt) - ra - rb) * SIZE, at: it.clone().add(tt).multiplyScalar(0.5), axis: it.clone().sub(tt).normalize() })
	}
	// a fist's front: the farthest point along +x of its fingers' spheres (the flats of the first bones)
	applyPose(r, POSES.fist)
	r.root.updateMatrixWorld(true)
	let fx = -Infinity
	for (const S of r.spheres) {
		if (!S.link.startsWith("f")) continue
		sphereAt(S, _w)
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
	return rig.spheres.map((S) => ({ c: sphereAt(S, new THREE.Vector3()), r: S.r * SIZE, link: S.link, root: !!S.root, g: S.g }))
}
/** The arm's line out of wrist W along unit A (toward the elbow), from ARM.from to `reach` m (ARM.reach: as far as the rules look along it), bent
 *  at the elbow (armAt): {a, b (its far end), r: ARM.r, segs: [{a, b, r}]: the forearm to the end of hand.glb's own sleeve, ARM.r round it, then
 *  the sleeve on to the elbow and on up the arm, as wide as it widens to (armR)}. */
export const armLine = (W, A, reach = ARM.reach) => {
	const c = W.clone().addScaledVector(A, ARM.cuff)
	const a = W.clone().addScaledVector(A, ARM.from)
	const b = armAt(W, A, reach)
	if (reach <= ARM.elbow) return { a, b, r: ARM.r, segs: [{ a, b: c, r: ARM.r }, { a: c, b, r: armR(reach) }] }
	const e = armAt(W, A, ARM.elbow)
	return { a, b, r: ARM.r, segs: [{ a, b: c, r: ARM.r }, { a: c, b: e, r: armR(ARM.elbow) }, { a: e, b, r: armR(reach) }] }
}
/** An arm line's stretches ({a, b, r}): its segs, or the line itself. */
const segsOf = (line) => line.segs ?? [line]
/** The least gap between two arm lines (armLine), their radii taken off. */
export function linesGap(P, Q) {
	let g = Infinity
	for (const p of segsOf(P)) for (const q of segsOf(Q)) g = Math.min(g, segmentDistance(p.a, p.b, q.a, q.b) - p.r - q.r)
	return g
}
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
	const SA = segsOf(A.line)
	const SB = segsOf(B.line)
	let g = Infinity
	for (const p of SA) for (const q of SB) g = Math.min(g, segmentDistance(p.a, p.b, q.a, q.b) - p.r - q.r)
	for (const s of A.spheres) {
		for (const q of SB) g = Math.min(g, pointSegment(s.c, q.a, q.b) - s.r - q.r)
		for (const t of B.spheres) g = Math.min(g, s.c.distanceTo(t.c) - s.r - t.r)
	}
	for (const t of B.spheres) for (const p of SA) g = Math.min(g, pointSegment(t.c, p.a, p.b) - t.r - p.r)
	return g
}
const _ap = new THREE.Vector3()
/** The arm's least clearance from field d (its line sampled every 1.2 cm to the cuff and 2.5 cm on, less its radius there, armR): out of wrist W
 *  along A, bent at its elbow (armAt), as far as `upTo` m up it. */
export function armClearance(d, W, A, upTo = ARM.reach) {
	let m = Infinity
	for (let s = ARM.from; ; s += s < ARM.cuff ? 0.012 : 0.025) {
		const sv = Math.min(s, upTo)
		armAt(W, A, sv, _ap)
		m = Math.min(m, d(_ap) - armR(sv))
		if (sv >= upTo) break
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
export const wristOk = (w, extMax = WRIST.ext) => w.ext <= extMax && w.ext >= -WRIST.flex && w.dev <= WRIST.thumb && w.dev >= -WRIST.away
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
 *  way toward the camera, rise, ext, dev, way: a level unit the arm should go along from above, riseMin: the least rise tried, below: a palm's arm
 *  may slope down}). -> {A, rise, phi, wrist, clear, ok, cost}. */
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
	const em = prefer.extMax ?? WRIST.ext // (a pushing palm's: WRIST.push)
	const ok = wristOk(w, em)
	// (a wrist past what it bends easily is a fault, weighed by how far: the least faulty stands if nothing is clean)
	const wf = ok ? 0 : Math.max(w.ext - em, -WRIST.flex - w.ext, w.dev - WRIST.thumb, -WRIST.away - w.dev, 0) / 10 + 1
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
		for (let e = prefer.riseMin ?? ARM.above[0]; e <= ARM.above[1] + 1e-9; e += 5)
			for (let k = 0; k < 24; k++) {
				const h = V(Math.cos(k * 15 * D2R), 0, Math.sin(k * 15 * D2R))
				const off = pw ? Math.acos(clamp(h.dot(pw), -1, 1)) / D2R : 0
				// (from above: rising to the upright less 25 degrees, along the way asked, a little behind rather than toward the camera)
				way(h, e, k * 15, ((e - (prefer.rise ?? 65)) / 12) ** 2 + (off / 45) ** 2 + (h.z > 0 ? (h.z / 0.7) ** 2 : 0))
			}
	} else {
		const base = from === "left" ? V(-1, 0, 0) : from === "right" ? V(1, 0, 0) : from.way.clone().setY(0).normalize()
		for (let e = prefer.riseMin ?? ARM.side[0]; e <= ARM.side[1] + 1e-9; e += 5)
			for (let phi = -60; phi <= 40; phi += 10) way(towardCamera(base, phi), e, phi, ((e - (prefer.rise ?? 25)) / 12) ** 2 + ((phi - (prefer.phi ?? -20)) / 30) ** 2)
		// (under a thing on the palm: sloping down to the elbow instead, a little less wanted than rising)
		if (prefer.below)
			for (let e = ARM.below[0]; e <= ARM.below[1] + 1e-9; e += 5)
				for (let phi = -60; phi <= 40; phi += 10) way(towardCamera(base, phi), e, phi, (prefer.rise !== undefined && prefer.rise < 0 ? 0 : 0.5) + ((e - Math.min(prefer.rise ?? -15, -5)) / 12) ** 2 + ((phi - (prefer.phi ?? -20)) / 30) ** 2)
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
	const sp = handSpheres(tryHand(side, W, X, Y, P)).filter((S) => !links || links(S.link, S))
	// (its spheres in bunches, each with its bound: a bunch whose bound is no nearer than the best yet holds nothing nearer)
	const bunches = boundsOf(sp)
	let s = 0
	for (let i = 0; i < 80; i++) {
		let m = Infinity
		let link = null
		for (const b of bunches) b.db = d(_w.copy(b.c).addScaledVector(u, s)) - b.r
		bunches.sort((x, y) => x.db - y.db)
		for (const b of bunches) {
			if (b.db >= m) break
			for (const S of b.list) {
				_w.copy(S.c).addScaledVector(u, s)
				const c = d(_w) - S.r
				if (c < m) {
					m = c
					link = S.link
				}
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
/** The side an arm comes from: away from where the thing goes, else from the picture's nearer edge (a row of held things are held from both
 *  sides, their arms never crossing one another). */
const sideFrom = (move, near = "left") => (move && Math.abs(move.x) > 0.3 ? (move.x > 0 ? "left" : "right") : near)
/** Where the arm comes from for a grip: hand_from when it is one the grip can take, else the grip's own way. */
export function fromFor(grip, from, { move, inWater, room, near = "left", E = null, depth = Infinity }) {
	if (grip === "press") return "above"
	if (grip === "palm") return from === "left" || from === "right" ? from : sideFrom(move, near)
	if (from === "left" || from === "right" || from === "above") return from
	if (grip === "grip") return "above"
	// (pinch: from a side only with room under the hand; a small round thing that will drop, a grape, from above, held at its upper half between
	// the thumb and the index on its two sides, the opening between them toward the camera)
	const round = !!E && Math.min(E.w, E.h, depth) > 0.015 && Math.max(E.w, E.h) <= 0.045
	if (round && (!move || move.y < -0.5) && room.above === Infinity) return "above"
	return (inWater || room.below < PINCH_ROOM) && room.above === Infinity ? "above" : sideFrom(move, near)
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
/** The thumb that best closes onto field d (the rig placed, its fingers as they are): each start (thumbTurns' [swing, lift, twist, knuckle,
 *  end]) set and closed onto it (closeFinger, then closeOnSkin on hand.glb's skin); kept: the one whose end touches it (0-1 mm), in none of the
 *  fingers, that `judge(rig)` likes best (lower is better). -> {t, score} (the thumb's turns put on the rig), or null (the thumb as it was). */
function fitThumb(rig, d, starts, judge = () => 0, most = null) {
	const P = rig.pose
	const was = { thumb_1: [...P.thumb_1], thumb_2: [...P.thumb_2], thumb_3: [...P.thumb_3] }
	let best = null
	const fingerS = rig.spheres.filter((S) => S.link.startsWith("f"))
	const thumbS = rig.spheres.filter((S) => S.link === "t.1" || S.link === "t.2")
	const _a = new THREE.Vector3()
	const _b = new THREE.Vector3()
	for (const t of starts) {
		Object.assign(P, thumbTurns(t))
		applyPose(rig, P)
		rig.root.updateMatrixWorld(true)
		closeFinger(rig, d, "t", most ? { most } : {})
		if (rig.mesh) closeOnSkin(rig, d, "t", { most })
		rig.root.updateMatrixWorld(true)
		const c = rig.mesh ? skinClearance(rig, d, ["t.2"]) : clearance(rig, d, (l) => l === "t.2")
		// (no part of the thumb in it, the ball of the thumb neither)
		const into = rig.mesh ? skinClearance(rig, d, ["t.0", "t.1", "t.2"]) : clearance(rig, d, (l) => l.startsWith("t."))
		// (never in a finger: the thumb's spheres and the fingers', 1 mm of give)
		let inF = Infinity
		for (const A of thumbS) {
			sphereAt(A, _a)
			for (const B of fingerS) inF = Math.min(inF, _a.distanceTo(sphereAt(B, _b)) - (A.r + B.r) * SIZE)
		}
		const score = (c >= -0.0001 && c <= 0.001 ? 0 : 5 + Math.abs(c) * 500) + (into >= -0.0001 ? 0 : 20 + -into * 2000) + (inF >= -0.001 ? 0 : 5 + -inF * 1000) + judge(rig)
		if (!best || score < best.score) best = { score, t: { thumb_1: [...P.thumb_1], thumb_2: [...P.thumb_2], thumb_3: [...P.thumb_3] } }
	}
	Object.assign(P, best?.t ?? was)
	applyPose(rig, P)
	rig.root.updateMatrixWorld(true)
	return best
}
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
/** The fingers a pinch does not use (the middle, ring and little), out of what it holds and of everything else (field d) by `gap`: each one in
 *  the way curled further toward the palm, else opened a little after the index, whichever clears it first (a 3 cm thing pinched is wider than the
 *  curled fingers leave room for). -> P. */
function tuck(side, W, X, Y, P, d, gap = 0.0015) {
	for (const i of [1, 2, 3]) {
		const links = new Set([`f${i}.0`, `f${i}.1`, `f${i}.2`])
		const clear = () => clearance(tryHand(side, W, X, Y, P), d, (l) => links.has(l)) >= gap
		if (clear()) continue
		const dg = DIGITS[i]
		const was = [1, 2, 3].map((j) => P[`${dg}_${j}`][2])
		let ok = false
		for (let n = 0; n < 6 && !ok; n++) {
			;[1, 2, 3].forEach((j) => (P[`${dg}_${j}`][2] = Math.max(-FLEX_MAX[j - 1], P[`${dg}_${j}`][2] - 5)))
			ok = clear()
		}
		if (ok) continue
		;[1, 2, 3].forEach((j) => (P[`${dg}_${j}`][2] = was[j - 1]))
		for (let n = 0; n < 8 && !ok; n++) {
			;[1, 2, 3].forEach((j) => (P[`${dg}_${j}`][2] = Math.min(0, P[`${dg}_${j}`][2] + 7)))
			ok = clear()
		}
		if (!ok) [1, 2, 3].forEach((j) => (P[`${dg}_${j}`][2] = was[j - 1]))
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
		if (clearance(r, column) >= gap && (!A || armClearance(column, w, A, 0.15) >= gap)) return s
	}
	return null
}

/** A pinch closed onto field d: the index's rows and the thumb's each taken from the pinch opened by k (pinchFor's path: the pads coming
 *  together, not each joint curling on its own), each the least k from k0 that keeps that digit `gap` from it (on hand.glb its own drawn skin, on
 *  the capsule hand its spheres). -> the parts that touch. */
function closePinch(rig, d, k0, gap = 0.0004) {
	const P = rig.pose
	const touched = []
	for (const [rows, links] of [
		[["index_1", "index_2", "index_3"], ["f0.0", "f0.1", "f0.2"]],
		[["thumb_1", "thumb_2", "thumb_3"], ["t.0", "t.1", "t.2"]]
	]) {
		const set = (k) => {
			const Q = lerpPose(POSES.pinch, POSES.pinchOpen, k)
			for (const b of rows) P[b] = [...Q[b]]
			applyPose(rig, P)
			rig.root.updateMatrixWorld(true)
		}
		const c = (k) => {
			set(k)
			return rig.mesh ? skinClearance(rig, d, links) : clearance(rig, d, (l) => links.includes(l))
		}
		let lo = 0
		let hi = k0
		if (c(k0) < gap) {
			// (in it or on it where it was set: opened further until it is not, as little as that takes; failing that, as it was)
			if (c(1.3) < gap) {
				set(k0)
				continue
			}
			lo = k0
			hi = 1.3
		} else if (c(0) >= gap) {
			// (closing right up without meeting it: closed)
			set(0)
			continue
		}
		for (let n = 0; n < 14; n++) {
			const m = (lo + hi) / 2
			if (c(m) >= gap) hi = m
			else lo = m
		}
		set(hi)
		touched.push(links.at(-1))
	}
	return touched
}
/** The gap between the pinch's tips (m as drawn) when it is opened by k toward pinchOpen (refs' pinchTab, between its rows). */
function pinchGap(k) {
	const T = refs().pinchTab
	const i = clamp(Math.floor(k / 0.05), 0, T.length - 2)
	const u = clamp((k - T[i].k) / Math.max(1e-9, T[i + 1].k - T[i].k), 0, 1)
	return T[i].gap + (T[i + 1].gap - T[i].gap) * u
}
/** The pinch whose tips are `w` m apart (a thing w across between them): {P (the pose), at (the tips' midpoint), axis (thumb to index), k}, in
 *  the hand's own frame (refs' pinchTab, between its rows). */
function pinchFor(w) {
	const T = refs().pinchTab
	let i = 0
	while (i < T.length - 2 && T[i + 1].gap < w) i++
	const a = T[i]
	const b = T[i + 1]
	const u = clamp((w - a.gap) / Math.max(1e-6, b.gap - a.gap), 0, 1)
	const k = a.k + (b.k - a.k) * u
	return { k, P: lerpPose(POSES.pinch, POSES.pinchOpen, k), at: a.at.clone().lerp(b.at, u), axis: a.axis.clone().lerp(b.axis, u).normalize() }
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
	let thumbFit = null // (a grip whose thumb is fitted onto it apart from the fingers: fitThumb's starts)
	/** One way to hold it: scratch rig `rs` at W, X, Y in pose P; `keep`: the parts that may not be in the thing (the rest close onto it). */
	let seatDir = null // (the way the hand was set down onto it, if it was: its drawn skin is seated along it once it is chosen)
	let pinchK = null // (a pinch: how far open it was set round it, pinchFor's k; it closes from there)
	const tryHold = (rs, W, X, Y, P, pref, keep = null, armPrefer = {}) => {
		const r = tryHand(rs, W, X, Y, P)
		const inThing = clearance(r, d, keep)
		// (near something else by the spheres: by the drawn skin, which they cover a little generously)
		let inOthers = others ? clearance(r, others) : Infinity
		const lim = 0.001
		if (r.mesh && inOthers < 0.003) inOthers = skinClearance(r, others)
		// (in the thing, or within 1 mm of anything else drawn, is a fault; nearer than 3 mm to anything else is only less wanted)
		const fault = (inThing >= -0.0002 ? 0 : 1 + -inThing * 500) + (inOthers >= lim ? 0 : 1 + (lim - inOthers) * 500)
		const soft = pref + (inOthers < 0.003 ? (0.003 - Math.max(inOthers, lim)) * 300 : 0)
		if (best && fault * 100 + soft >= best.cost) return // (it cannot win, whatever its arm)
		const arm = chooseArm(rs, W, X, Y, armFrom, all, armPrefer)
		const cost = fault * 100 + arm.cost + soft
		if (!best || cost < best.cost) best = { side: rs, W: W.clone(), X: X.clone(), Y: Y.clone(), P: copyPose(P), A: arm.A, arm, cost, fault, inThing, inOthers, seat: seatDir?.clone() ?? null, pinchK }
	}
	const palmOnly = (l) => l === "palm" || l === "wrist"
	const palmParts = (l, S) => palmOnly(l) || l === "t.0" || !!S?.root // (the palm, the ball of the thumb and the fingers' roots: its face)
	/** The wrist that seats the palm on it: W (the palm's point on its surface) set back 4 cm against unit `dir` and slid along it until the palm's
	 *  nearest part (or the ball of the thumb) is 0.4 mm from it, so no part of the palm is ever in it: a flat palm on a round or uneven top
	 *  meets it where it first touches. Unslid (W itself) when nothing is met. */
	const seat = (rs, W, X, Y, P, dir) => {
		seatDir = dir
		return slideTo(rs, W.clone().addScaledVector(dir, -0.04), X, Y, P, d, dir, 0.0004, 0.1, palmParts)?.W ?? W
	}
	const palmFits = Math.max(E.w, 2 * halfZ(d)) >= PALM_TOP[0] && Math.min(E.w, 2 * halfZ(d)) >= PALM_TOP[1]
	if (grip === "press" && !palmFits) {
		// the pointing finger's tip on its top, pressing it down, the finger nearly straight along the press (tap) and its end bone nearly upright,
		// the other fingers curled; the hand above it and the arm from above (15 to 35 degrees off the upright, a little behind rather than toward
		// the camera); seen from the side, the thumb's side toward the camera, as a pointing hand is seen: the thumb over the curled fingers, never
		// the open curls (and the gaps in them) of the little finger's side. Every heading
		// round the upright, how steeply the hand points down and how it is rolled is tried, slid down until the tip is 0.4 mm from its top, the
		// rest of the hand 3 mm clear of it and of everything else. Let go, as a palm: the finger lifts off it, the hand slides off it to a side with
		// room and rises out of the picture
		const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
		const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
		const P = copyPose(POSES.tap)
		const tipOnly = (l) => l !== "f0.2"
		const psi0 = near === "left" ? 0 : 180
		for (const dpsi of [0, -30, 30, -60, 60, -90, 90, -120, 120, 180])
			for (const pitch of [20, 30, 40, 50, 60])
				for (const roll of [0, -30, 30, -60, 60, -90, 90])
					for (const rs of ["left", "right"]) {
						const psi = (psi0 + dpsi) * D2R
						const h = V(Math.cos(psi), 0, Math.sin(psi)) // (the way the hand leans, seen from above)
						const X = h.clone().multiplyScalar(Math.cos(pitch * D2R)).addScaledVector(UP, -Math.sin(pitch * D2R)).normalize()
						const Y = UP.clone().addScaledVector(X, -UP.dot(X)).normalize().applyAxisAngle(X, roll * D2R)
						const W0 = T.clone().sub(offsetOf(scratchRig(rs), R.tapTip, X, Y)).addScaledVector(UP, 0.03)
						const sl = slideTo(rs, W0, X, Y, P, d, V(0, -1, 0), 0.0004, 0.1)
						if (!sl) continue
						seatDir = V(0, -1, 0)
						const r = tryHand(rs, sl.W, X, Y, P)
						const rest = clearance(r, d, tipOnly)
						// (only the fingertip on it; its end bone near upright; the thumb's side toward the camera, the hand leaning away from it rather
						// than toward it)
						const end = offsetOf(scratchRig(rs), R.tapTip, X, Y).sub(offsetOf(scratchRig(rs), R.tapTip.clone().addScaledVector(R.tapDir, -0.01), X, Y)).normalize()
						const th = X.clone().cross(Y).multiplyScalar(rs === "left" ? 1 : -1)
						const pref = (sl.link === "f0.2" ? 0 : 3) + (rest >= 0.003 ? 0 : 1 + (0.003 - rest) * 300) + (1 + end.y) * 6 + (1 - th.z) * 0.6 + (dpsi / 90) ** 2 * 0.3 + (h.z > 0 ? h.z : 0)
						tryHold(rs, sl.W, X, Y, P, pref, tipOnly, { way: h.clone().negate() })
					}
	} else if (grip === "press") {
		// a bigger thing: the palm on its top, pressing it down, the fingers flat and together (bent a little at the knuckles, never into it or what is
		// under it); the fingers away from the picture's nearer edge and the arm from above toward it. Let go, the hand slides off it to a side with
		// room (clear of the column over it: a floater shoots up) and rises calmly out of the picture, so it is seen to leave it, never to lift it or
		// ride on it
		const top = hitAlong(d, V(E.cx, E.y1 + 0.3, 0), V(0, -1, 0), 0.6)
		const T = V(E.cx, top === null ? E.y1 : E.y1 + 0.3 - top, 0)
		const psi0 = near === "left" ? 0 : 180
		for (const dpsi of [0, -20, 20, -40, 40, -60, 60, -90, 90]) {
			const psi = (psi0 + dpsi) * D2R
			const X0 = V(Math.cos(psi), 0, Math.sin(psi))
			for (const tilt of Math.abs(X0.x) > 0.5 ? [0, 12, -8, 6] : [0, -8, 8])
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
						seatDir = V(0, -1, 0)
						const r = tryHand(rs, sl.W, X, Y, P)
						// (the palm itself on it, not only the ball of the thumb: its nearest part within 2 mm)
						const palm = clearance(r, d, (l, S) => l === "palm" || !!S?.root)
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
		// the folded fingers would meet its top)
		const P0s = above ? [V(E.cx, E.cy, 0), V(E.cx, Math.max(E.cy, E.y1 - Math.min(0.01, E.h * 0.3)), 0)] : [V(side > 0 ? E.x0 + Math.min(0.008, E.w * 0.3) : E.x1 - Math.min(0.008, E.w * 0.3), E.cy, 0)]
		const nn = n.z > 0.5 ? n.clone().negate() : n.clone() // (front to back: the thumb in front)
		let a0 = approach0.clone().addScaledVector(nn, -approach0.dot(nn))
		if (a0.lengthSq() < 1e-6) a0 = V(0, -1, 0).addScaledVector(nn, nn.y)
		a0.normalize()
		const closing = new Set(["f0.1", "f0.2", "t.1", "t.2"])
		const rs0 = above ? "left" : side > 0 ? "left" : "right"
		const round = Math.min(E.w, E.h, 2 * halfZ(d)) > 0.015
		// (a small round thing pinched from above: the hand reaching in from the picture's nearer edge and down onto it, its sleeved arm seen coming
		// from that edge, leaning over it as far as its arm leans, the line between thumb and index tipped with it; the opening between them toward
		// the camera)
		const lean = near === "left" ? 1 : -1
		const tilts = above && round && Math.abs(nn.z) < 0.5 ? [50, 35, 60, 20] : [0]
		for (const tilt of tilts)
			P0s.forEach((P0, k) => {
				const nt = nn.clone().applyAxisAngle(FRONT, lean * tilt * D2R)
				const at = a0.clone().applyAxisAngle(FRONT, lean * tilt * D2R)
				// (the pinch opened to the thing's width across its axis there, and its tips set either side of it, on its middle line: they then close
				// the last millimetres onto it, pad to pad)
				const ha = hitAlong(d, P0.clone().addScaledVector(nt, 0.15), nt.clone().negate(), 0.3)
				const hb = hitAlong(d, P0.clone().addScaledVector(nt, -0.15), nt, 0.3)
				const w = ha === null || hb === null ? 0.02 : Math.max(0.002, 0.3 - ha - hb)
				const PW = pinchFor(w)
				const open = pinchFor(w + 0.006)
				const pre = open.P
				// (the thumb in front, else behind: the hand turned the other way up, as it must be under a thing close above)
				for (const flip of [1, -1])
					for (const psi of [0, -15, 15, -30, 30, -45, 45, -60, 60, -80, 80]) {
						const ax = nt.clone().multiplyScalar(flip)
						const approach = at.clone().applyAxisAngle(ax, psi * D2R)
						for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
							const rr = scratchRig(rs)
							const q = frameTurn(approach, ax, sided(rr, PW.at).normalize(), sided(rr, PW.axis))
							const X = V(1, 0, 0).applyQuaternion(q)
							const Y = V(0, 1, 0).applyQuaternion(q)
							const W = P0.clone().sub(offsetOf(rr, PW.at, X, Y))
							seatDir = null
							pinchK = open.k
							// (at its middle: the thumb's and the index's pads on either side of its widest line, the equator of a round thing; the back of the
							// hand toward the camera, so the thumb, the index and the thing between them show, the other fingers folded behind them)
							const where = k * 0.3
							const pref = (psi / 45) ** 2 + (rs === rs0 ? 0 : 0.15) + where + (flip < 0 ? 0.5 : 0) + (1 - Y.dot(FRONT)) * 0.4 + (tilts.length > 1 ? ((tilt - 50) / 25) ** 2 : 0)
							tryHold(rs, W, X, Y, tuck(rs, W, X, Y, copyPose(pre), all), pref, (l) => !closing.has(l), tilts.length > 1 ? { way: V(-lean, 0, 0), rise: 42, riseMin: ARM.reachIn } : {})
						}
					}
			})
		close = [] // (closePinch: along the pinch's own path)
	} else if (grip === "palm") {
		// it rests on the open palm, the fingers cupped round it; the arm from the side, rising to the elbow. Let go, the hand drops away from under
		// it and out to its side faster than it falls (the clearance below keeps it so)
		const bottom = hitAlong(d, V(E.cx, E.y0 - 0.3, 0), V(0, 1, 0), 0.6)
		let B = V(E.cx, bottom === null ? E.y0 : E.y0 - 0.3 + bottom, 0)
		let Y = V(0, -1, 0)
		const ball = sphereOf(d)
		if (ball) {
			// under a ball the palm rolls 32 degrees, its thumb's side toward the camera, tangent to it there, so the ball sits in the palm's bowl, the
			// fingers round it and the thumb's tip rising by it show
			const n = V(0, -Math.cos(PALM_ROLL * D2R), Math.sin(PALM_ROLL * D2R))
			B = ball.c.clone().addScaledVector(n, ball.r)
			Y = n.clone()
		}
		const X0 = V(side, 0, 0).addScaledVector(Y, -side * Y.x).normalize()
		// (the fingers a little curved up, the thumb out beside the index in the palm's plane: it closes up onto the thing's side, never across the
		// palm under it)
		const pre = copyPose(POSES.hold)
		const rs0 = side > 0 ? "right" : "left" // (the thumb toward the camera)
		const under = Y.clone().negate() // (the palm's way to it)
		// (a ball over the middle of the palm, 4.6 cm from the wrist, the thumb's side toward the camera; a thing that is not a ball on the palm's
		// middle or nearer the fingers)
		const xcs = ball ? [0.056, 0.046, 0.064] : [0.046, 0.056]
		const xcPref = (xc) => (ball ? Math.abs(xc - 0.056) * 30 : (xc - 0.046) * 20)
		for (const psi of [0, -15, 15, -30, 30, -45, 45])
			for (const xc of xcs)
				for (const pitch of [0, 10]) {
					// (the ball of it on the palm's middle or nearer the fingers, the fingers a little up: the wrist clear of it)
					const X1 = X0.clone().applyAxisAngle(Y, psi * D2R)
					const Zc = X1.clone().cross(Y).normalize()
					const X = X1.clone().applyAxisAngle(Zc, -pitch * D2R)
					const Yp = Y.clone().applyAxisAngle(Zc, -pitch * D2R)
					for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
						const W0 = B.clone().sub(offsetOf(scratchRig(rs), R.palmAt(xc), X, Yp)).addScaledVector(under, -0.04)
						const sl = slideTo(rs, W0, X, Yp, pre, d, under, 0.0004, 0.12, palmParts) ?? { W: W0.clone().addScaledVector(under, 0.04) }
						seatDir = under
						const palm = clearance(tryHand(rs, sl.W, X, Yp, pre), d, palmFace)
						tryHold(rs, sl.W, X, Yp, pre, (psi / 40) ** 2 + (rs === rs0 ? 0 : ball ? 1.5 : 0.15) + xcPref(xc) + pitch / 40 + (palm <= 0.003 ? 0 : 1 + (palm - 0.003) * 300), palmParts, { below: true, riseMin: ARM.level, rise: room.below < 0.4 ? 8 : -12, phi: 15 })
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
						const W = seat(rs, T.clone().sub(offsetOf(scratchRig(rs), R.palmAt(at), X, Y)), X, Y, pre, V(0, -1, 0))
						tryHold(rs, W, X, Y, pre, (psi / 30) ** 2 + (rs === "left" ? 0 : 0.15), palmParts, { way: X.clone().negate() })
					}
				}
			} else {
				// the hand on top, its fingers draped down one side and the thumb down the other, the side toward the camera, so the grip shows (a left
				// hand reaching to the right, a right hand to the left); the hand tipped a little down that way over its shoulder, so the wrist is not
				// bent hard back
				const gs = move && move.x > 0.3 ? -1 : 1
				const rs0 = gs > 0 ? "left" : "right"
				for (const dpsi of [0, -15, 15, -30, 30])
					for (const pitch of [0, 15, 30]) {
						const psi = ((gs > 0 ? 0 : 180) + dpsi) * D2R
						const X0 = V(Math.cos(psi), 0, Math.sin(psi))
						const Zc = X0.clone().cross(UP).normalize()
						const X = X0.clone().applyAxisAngle(Zc, -pitch * D2R)
						const Yp = UP.clone().applyAxisAngle(Zc, -pitch * D2R)
						for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
							const W = seat(rs, T.clone().sub(offsetOf(scratchRig(rs), R.palmC, X, Yp)).addScaledVector(Yp, 0.0), X, Yp, pre, Yp.clone().negate())
							tryHold(rs, W, X, Yp, pre, (dpsi / 35) ** 2 + (rs === rs0 ? 0 : 0.6) + ((pitch - 15) / 25) ** 2, palmParts, { way: X0.clone().negate() })
						}
					}
				thumbFit = { starts: [[-45, -45, 100, 10, 10], [-35, -55, 110, 10, 10], [-50, -35, 95, 10, 10], [-30, -65, 120, 15, 10], [-55, -50, 105, 5, 5]], away: true }
			}
		} else {
			const hit = hitAlong(d, V(side > 0 ? E.x0 - 0.3 : E.x1 + 0.3, E.cy, 0), V(side, 0, 0), 0.6)
			const S = V(side > 0 ? (hit === null ? E.x0 : E.x0 - 0.3 + hit) : hit === null ? E.x1 : E.x1 + 0.3 - hit, E.cy, 0)
			const Y = V(-side, 0, 0)
			const rs0 = side > 0 ? "right" : "left" // (the thumb on top)
			for (const psi of [0, -20, 20, -40, 40]) {
				const X = V(0, 0, 1).applyAxisAngle(Y, psi * D2R)
				for (const rs of [rs0, rs0 === "left" ? "right" : "left"]) {
					const W = seat(rs, S.clone().sub(offsetOf(scratchRig(rs), R.palmAt(at), X, Y)), X, Y, pre, V(side, 0, 0))
					tryHold(rs, W, X, Y, pre, (psi / 30) ** 2 + (rs === rs0 ? 0 : 0.15), palmParts, { rise: 20, phi: -30 })
				}
			}
		}
		// (a thing that will drop: the index and the middle finger stop at its widest, each a little more curled than the one before it, and the
		// ring and little fingers, further round it, close on until their pads are on it (they open as it is let go); one held down, or held fixed,
		// is gripped round)
		const most = (i) => (falls && from === "above" ? (i < 2 ? [50 + 4 * i, 38 + 4 * i, 20 + 3 * i] : [78 + 4 * i, 70 + 4 * i, 40]) : null)
		close = [[0, { most: most(0) }], [1, { most: most(1) }], [2, { most: most(2) }], [3, { most: most(3) }], ...(thumbFit ? [] : [["t", {}]])]
	}
	const rig = newRig(best.side)
	rig.pose = copyPose(best.P)
	placeHand(rig, best.W, best.X, best.Y)
	applyPose(rig, rig.pose)
	placeArm(rig, best.A) // (hand.glb: the wrist bent as it will be drawn, its skin with it)
	rig.root.updateMatrixWorld(true)
	const touched = []
	for (const [i, o] of close) touched.push(...closeFinger(rig, d, i, o ?? {}))
	if (grip === "pinch") touched.push(...closePinch(rig, d, best.pinchK ?? 0.6))
	if (thumbFit) {
		// (the thumb round the far side from the fingers: its tip as far from the middle finger's as it goes, low on the thing, never sticking out)
		const tipAt = (link) => sphereAt(rig.spheres.find((S) => S.tip === link), new THREE.Vector3())
		fitThumb(rig, d, thumbFit.starts, (r) => {
			r.root.updateMatrixWorld(true)
			const a = tipAt("t.2")
			const b = tipAt("f1.2")
			return -a.distanceTo(b) * 40 + Math.max(0, a.y - E.cy) * 60
		})
	}
	if (rig.mesh) {
		// (hand.glb: the hand seated, and each digit that closed onto it closed the last little way, by its own drawn skin; what touches is what
		// its skin is on)
		if (best.seat) seatOnSkin(rig, d, best.seat, { others })
		for (const [i, o] of close) closeOnSkin(rig, d, i, { most: o?.most ?? null })
		rig.root.updateMatrixWorld(true)
		touched.length = 0
		for (const l of SKIN_LINKS) if (skinClearance(rig, d, [l]) <= 0.001) touched.push(l)
	}
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
		const W1 = rig.root.position.clone().addScaledVector(UP, lift)
		let flick = null
		for (const dir of ways) {
			const s = flickClear(best.side, W1, best.X, best.Y, openOf(rig.pose, "press"), E, zh, dir, others, A)
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
	return { rig, wrist: rig.root.position.clone(), X: best.X.clone(), Y: best.Y.clone(), armDir: A, exit: way, pace: pace ?? { a: WA, v: WV }, pose: copyPose(rig.pose), arm: best.arm, fault: best.fault, inThing: best.inThing, inOthers: best.inOthers, touched, pinchK: grip === "pinch" ? (best.pinchK ?? null) : null }
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
 *  the fingers' spread kept). A thrown thing's hand opens further, its fingers following through after it; a hand that gripped round a thing
 *  opens out of the curl it held (never a claw left hanging); a pinch opens its thumb and index along its own path (pinchOut) and a pressing
 *  fingertip lifts off as it pressed, their folded fingers kept folded. */
function openOf(P, grip = null, thrown = false, pinchOut = null) {
	// (a pinch opens its thumb and index along the pinch's own path, about 1.5 cm wider than it held (pinchOut: the pose that far open), and a
	// fingertip that pressed lifts off with its finger as it pressed; the folded fingers of both stay folded as they were, closed: never a claw
	// hanging under the hand, nor a gap opening between them)
	const tap = grip === "press" && P.middle_1[2] < -40
	if (tap || (grip === "pinch" && pinchOut)) {
		const o = copyPose(P)
		if (!tap) for (const b of ["index_1", "index_2", "index_3", "thumb_1", "thumb_2", "thumb_3"]) o[b] = [...pinchOut[b]]
		return o
	}
	const o = thrown || grip === "grip" ? lerpPose(POSES.relaxed, POSES.flat, grip === "grip" ? 0.85 : 0.6) : copyPose(POSES.relaxed)
	for (const d of DIGITS) {
		o[`${d}_1`][1] = P[`${d}_1`][1]
		for (let j = 1; j <= 3; j++) o[`${d}_${j}`][2] = Math.max(o[`${d}_${j}`][2], P[`${d}_${j}`][2])
	}
	// (a palm that pressed it down keeps its thumb as it was: out in its plane, it never drops onto what it let go)
	if (grip === "press") for (const b of ["thumb_1", "thumb_2", "thumb_3"]) o[b] = [...P[b]]
	return lerpPose(P, o, thrown ? 0.9 : 0.85)
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
	let handNo = 0
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
			const no = handNo++
			for (const m of g.meshes) {
				m.userData.solidId = r.solidId
				m.userData.hand = true
				m.userData.handNo = no // (each hand, with its arm, a thing of its own to the lesson look's outlines: two hands are never drawn as one)
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
const holdInfo = (S) => ({ side: S.rig.side, thumb: S.X.clone().cross(S.Y).multiplyScalar(S.rig.side === "left" ? 1 : -1).toArray().map((v) => +v.toFixed(2)), rise: S.arm.rise, phi: S.arm.phi, wrist: S.arm.wrist, clear: S.arm.clear, armOk: S.arm.ok, fault: S.fault, inThing: S.inThing, inOthers: S.inOthers, touched: S.touched, exit: S.exit.map((e) => ({ dir: e.dir.toArray().map((v) => +v.toFixed(3)), len: e.len })) })
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
	let from = fromFor(grip, p.from ?? "auto", { move, inWater, room, near, E, depth: 2 * halfZ(d) })
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
	// (an auto hold whose hand comes within 3 mm of something else drawn, a pinch's finger along the magnet just over what it pinches, looks for a
	// cleaner one too)
	const faulty = (h) => h.fault > 0 || !h.arm.ok || (p.grip === "auto" && h.inOthers < 0.003)
	const rank = (h) => h.fault * 1000 + (h.arm.ok ? 0 : 100 + Math.max(0, 0.003 - h.arm.clear) * 1e4) + Math.max(0, 0.003 - h.inOthers) * 1000 + h.arm.cost
	if (faulty(S) && (p.grip === "auto" || grip === "palm"))
		for (const g2 of ["grip", "pinch", "palm"]) {
			if (g2 === grip) continue
			const f2 = fromFor(g2, p.from ?? "auto", { move, inWater, room, near, E, depth: 2 * halfZ(d) })
			const S2 = solveHold(g2, f2, d, E, move, room, near, others3)
			// (every other grip is tried and the cleanest kept: which is tried first decides nothing)
			if (rank(S2) < rank(S)) {
				S = S2
				grip = g2
				from = f2
			}
		}
	const rig = S.rig
	const W0 = S.wrist
	const hold = S.pose
	// (a thing that leaves moving, start_speed: a throw)
	const v = move?.v ? V(move.v.x, move.v.y, 0) : V(0, 0, 0)
	const thrown = v.length() > 0.35
	// (a pinch lets go by opening its thumb and index about 1.5 cm wider than they held it, along the pinch's path)
	const pinchOut = grip === "pinch" && S.pinchK !== null ? pinchFor(pinchGap(S.pinchK) + 0.009).P : null
	const open = openOf(hold, grip, thrown, pinchOut)
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
	// (the sleeve out of the picture along the arm and 30 cm more: a hand that lets go goes out the same way, so its arm is never seen to end)
	setArm(rig, clamp(armExit(C.exit, W0, armDir) + 0.3, 0.45, 3.2))
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
	const FT = 0.1 // the follow-through's time
	const follow = (tau) => {
		if (!thrown || tau <= 0) return 0
		const u = Math.min(tau, FT)
		return 0.6 * v.length() * (u - (u * u) / (2 * FT)) // (it starts at 0.6 of the thing's speed and stops at FT)
	}
	const vdir = thrown ? v.clone().normalize() : V(0, 0, 0)
	// (a throw's wrist flicks forward and up after the thing, 28 degrees in 0.12 s, the fingers opening as it leaves them: the hand turned about its
	// wrist, its fingers toward the way the thing goes)
	let flickAxis = thrown ? S.X.clone().cross(vdir) : null
	if (flickAxis && flickAxis.lengthSq() < 1e-6) flickAxis = S.X.clone().cross(S.Y)
	flickAxis?.normalize()
	const _fq = new THREE.Quaternion()
	const Xt = new THREE.Vector3()
	const Yt = new THREE.Vector3()
	const turnAt = (tau) => {
		const a = thrown && tau > 0 ? 28 * D2R * smooth(tau / 0.12) : 0
		_fq.setFromAxisAngle(flickAxis ?? UP, a)
		Xt.copy(S.X).applyQuaternion(_fq)
		Yt.copy(S.Y).applyQuaternion(_fq)
	}
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
	// (kept as clear of it as it held it at the least, 0.8 mm when it held it further off: hand.glb's spheres may lie a little inside it where its
	// drawn skin is just off it)
	placeHand(rig, W0, S.X, S.Y)
	applyPose(rig, hold)
	rig.root.updateMatrixWorld(true)
	const keepOff = Math.min(0.0008, clearance(rig, d.at(posesAt(tR))) - 0.0001)
	const tmpPose = copyPose(hold)
	const base = new THREE.Vector3()
	let sMax = 0
	for (let k = 0; k <= N; k++) {
		const tau = k / 120
		lerpPose(hold, open, smooth(tau / OPEN_S), tmpPose)
		const dt = d.at(posesAt(tR + tau))
		base.copy(W0).addScaledVector(vdir, follow(tau))
		let s = Math.max(plan(tau), sMax)
		// (and once it is let go, 1.5 mm more: the drawn skin stands a little out of the spheres where a finger or the thumb is bent, and the
		// fingers open as it goes)
		const need = keepOff + (tau > 0 ? 0.0015 : 0)
		const clear = (sv) => {
			turnAt(tau)
			placeHand(rig, _w.copy(base).add(pathAt(sv, _o)), Xt, Yt)
			applyPose(rig, tmpPose)
			rig.root.updateMatrixWorld(true)
			return clearance(rig, dt) > need
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
			turnAt(tau)
			placeHand(rig, Wt, Xt, Yt)
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
/** The palm's own face: its spheres, the ball of the thumb and the fingers' roots (hand.glb: within 8 mm of each knuckle); a palm laid on a thing
 *  lies on its heel, the ball of the thumb and the pads at the fingers' roots (its middle is a hollow). */
const palmFace = (l, S) => l === "palm" || l === "t.0" || !!S?.root
/** Every way one hand of push skin `skin` may meet the thing it pushes, placed: [{side, W, X, Y, P, link, spheres, pref, fault, at (where it
 *  meets it)}]. A finger: the index's tip on it, the finger level with the push (tipped down only as far as the floor and the thing need), a left
 *  hand's thumb toward the camera and its curled fingers showing under the index; nothing else of the hand within 3 mm of it or of anything else;
 *  a fist: its knuckles on it, upright (its thumb on top, across the outside of its curled fingers, which face the camera); a hand: the heel of its
 *  palm on it, flat on a flat back (leaning over a low one, so its fingertips stand no more than one height of it over its top), tangent to a ball's
 *  (the fingers closing onto it afterwards), turned so the back of the hand shows to the camera. Each slides along the push until it is 0.4 mm from
 *  the thing: on it, never in it. K: {u (the push's way), v (its up), c (across it, toward the camera), face (the paddle's face at the start), td (the
 *  thing's field), ball, others, E, zs (the depths to try, across), hs (the heights, along v from the face), two}. */
function pushCands(skin, K) {
	const R = refs()
	const out = []
	const { u, v, c, td, others } = K
	let how = null // (the candidate's own angles, for the record)
	const keep = (rs, W, X, Y, P, link, at, pref, rule) => {
		const r = tryHand(rs, W, X, Y, P)
		let near = others ? clearance(r, others) : Infinity
		// (by the drawn skin, which the spheres cover a little generously: only where that could change the verdict)
		if (r.mesh && near < 0.004 && near > -0.002) near = skinClearance(r, others)
		let fault = near >= 0.003 ? 0 : 1 + (0.003 - near) * 300
		fault += rule(r)
		// (its spheres where it lies: made when a pair of hands needs them)
		const cd = { side: rs, W: W.clone(), X: X.clone(), Y: Y.clone(), P: copyPose(P), link, at, pref, fault, how, _sp: null }
		Object.defineProperty(cd, "spheres", { get: () => (cd._sp ??= handSpheres(tryHand(cd.side, cd.W, cd.X, cd.Y, cd.P))), set: (v) => (cd._sp = v), enumerable: true, configurable: true })
		out.push(cd)
	}
	/** The way a hand's thumb points (a left hand's z, a right hand's -z: the right hand is the left mirrored). */
	const thumbOf = (rs, X, Y) => X.clone().cross(Y).multiplyScalar(rs === "left" ? 1 : -1)
	const sides = ["left", "right"]
	if (skin === "finger" || skin === "fist") {
		const P = skin === "finger" ? POSES.point : POSES.fist
		const front = skin === "finger" ? R.pointTip : V(R.fistFront, -0.004, 0.006)
		const touches = skin === "finger" ? (l) => l === "f0.2" : (l) => FIST_FRONT.has(l)
		const free = skin === "finger" ? 0.003 : 0.001 // (all but the fingertip clear of it by 3 mm; a fist's thumb may lie nearer)
		for (const h of K.hs)
			for (const rs of sides)
				for (const p of skin === "finger" ? [0, 6, 12, 20, 30, 42] : [0, 10, 20, 32])
					for (const q of [0, 10, 20, -10])
						for (const rho of skin === "finger" ? [0, -20, -40, 20] : [-90, -70, -45, 0, 30]) {
							const d1 = u.clone().multiplyScalar(Math.cos(q * D2R)).addScaledVector(c, Math.sin(q * D2R))
							const X = d1.multiplyScalar(Math.cos(p * D2R)).addScaledVector(v, -Math.sin(p * D2R)).normalize()
							const Y = v.clone().addScaledVector(X, -v.dot(X)).normalize().applyAxisAngle(X, rho * D2R)
							const o = K.face.clone().addScaledVector(v, h).addScaledVector(u, -0.04)
							const W0 = o.sub(offsetOf(scratchRig(rs), front, X, Y))
							const sl = slideTo(rs, W0, X, Y, P, td, u)
							if (!sl) continue
							// (how it reads: a pointing finger level, its hand's thumb toward the camera, the palm a little toward it so the curled fingers show
							// under the index; a fist upright, its thumb on top and its curled fingers toward the camera)
							const th = thumbOf(rs, X, Y)
							const palm = Y.clone().negate()
							const look = skin === "finger" ? (1 - th.dot(c)) * 1.5 + ((palm.dot(c) - 0.3) / 0.5) ** 2 * 0.3 : (1 - th.dot(v)) * 1.5 + (1 - palm.dot(c)) * 1.2
							const pref = (p / (skin === "finger" ? 18 : 25)) ** 2 + ((q - 6) / 20) ** 2 + look + (h / 0.03) ** 2
							how = { pitch: p, yaw: q, roll: rho, h }
							keep(rs, sl.W, X, Y, P, sl.link, null, pref, (r) => (touches(sl.link) ? 0 : 2) + Math.max(0, free - clearance(r, td, (l) => !touches(l))) * 300)
						}
		return out
	}
	// a hand: the heel of the palm on it, the fingers up along it, a little apart, the thumb out beside the index in the palm's plane (two hands
	// side by side meet at their thumbs, never through them)
	const P = copyPose(POSES.flat)
	const others3 = (r) => {
		// (the palm and the thumb's ball never in it; the fingers and the thumb close onto it, or open out of it, afterwards)
		const g = clearance(r, td, (l, S) => PALM_LINKS.has(l) || l === "t.0" || !!S?.root)
		return g >= -0.0002 ? 0 : 1 + -g * 400
	}
	if (K.ball) {
		const { c: ctr, r: rad } = K.ball
		// (round a ball the fingers are tried already a little curved, as they will follow its curve (closeHand): two hands are kept apart as
		// they will lie)
		const PB = lerpPose(P, POSES.relaxed, 0.8)
		for (const d of DIGITS) PB[`${d}_1`][1] = P[`${d}_1`][1]
		for (const b of ["thumb_1", "thumb_2", "thumb_3"]) PB[b] = [...P[b]]
		for (const beta of K.two ? [0, 10, 20, 26, 32, 42] : [0, 8, 16, 24, 32, 42])
			for (const gamma of K.gammas)
				for (const alpha of K.two ? [-30, -15, 0] : [-30, -15, 0, 15])
					for (const rs of sides) {
						// (behind it, turned gamma toward the camera; beta up from its middle; the palm tangent there, its heel on it, the fingers up over it)
						const h = towardCamera(u.clone().negate(), gamma)
						const n = h.multiplyScalar(Math.cos(beta * D2R)).addScaledVector(v, Math.sin(beta * D2R)).normalize()
						const at = ctr.clone().addScaledVector(n, rad)
						const Y = n.clone()
						const X = v.clone().addScaledVector(Y, -v.dot(Y)).normalize().applyAxisAngle(Y, alpha * D2R)
						// (set down onto it along its normal from 3 cm out: the heel, or the ball of the thumb beside it, 0.4 mm from it)
						const W0 = at.clone().sub(offsetOf(scratchRig(rs), R.heel, X, Y)).addScaledVector(n, 0.03)
						const sl = slideTo(rs, W0, X, Y, PB, td, n.clone().negate(), 0.0004, 0.08, (l, S) => PALM_LINKS.has(l) || l === "t.0" || !!S?.root)
						if (!sl) continue
						// (the heel on its back a little above its middle, the fingers up it, leaning with it so the wrist is not bent hard back; never a hand
						// over its top; two hands side by side on its back, round it from each other)
						// (two hands: both palms on its rear half, either side of the push line round it, the right one, nearer the camera, low on its back
						// and round toward the camera, the left one a little higher on its back and round the other way, so both are seen and their arms part)
						const pair = rs === "right" ? ((gamma - 30) / 15) ** 2 + ((beta - 5) / 12) ** 2 : ((gamma + 20) / 15) ** 2 + ((beta - 24) / 5) ** 2
						const pref = (K.two ? pair : ((beta - 4) / 10) ** 2) + ((alpha + 5) / 20) ** 2
						how = { beta, gamma, alpha }
						keep(rs, sl.W, X, Y, PB, sl.link, at, pref, others3)
					}
		return out
	}
	// a thing lower than a palm and its fingers can reach over (under 9 cm, a toy car): the palm stands on its back, leaning 12 to 44 degrees over it (about 24), its
	// heel as low on the back as the arm leaves room for over the floor, the fingers together and bent forward at the knuckles over its top (hook)
	// to close onto it there (closeHand): just over its top edge, never a hand lying over it or waving above it; one hand turned toward the camera
	// so the back of the hand, its fingers and its thumb show; two hands side by side across its back, each on a back corner
	if (K.E.h < LOW_THING) {
		const PH = copyPose(POSES.hook)
		for (const tau of [12, 18, 24, 30, 36, 44])
			for (const turn of K.two ? [0, 8, 16] : [15, 25, 35])
				for (const alpha of K.two ? [0, -8, 8, -16, 16] : [0, -10, 10])
					for (const [k, h] of K.hsLow.entries())
						for (const z of K.two ? K.zs : [0, 0.008, -0.008])
							for (const rs of sides) {
								// (of two hands, the left one on the pusher's left of the middle, the right one on its right)
								if (K.two && (rs === "left" ? z > 0.012 : z < -0.012)) continue
								const n0 = u.clone().multiplyScalar(Math.cos(tau * D2R)).addScaledVector(v, -Math.sin(tau * D2R))
								const nIn = n0.multiplyScalar(Math.cos(turn * D2R)).addScaledVector(c, -Math.sin(turn * D2R)).normalize()
								const Y = nIn.clone().negate()
								const X = v.clone().addScaledVector(nIn, -v.dot(nIn)).normalize().applyAxisAngle(nIn, alpha * D2R)
								const o = K.face.clone().addScaledVector(v, h).addScaledVector(c, z).addScaledVector(u, -0.12)
								const W0 = o.sub(offsetOf(scratchRig(rs), R.heel, X, Y))
								// (set onto it by its palm: the fingers bent over its top then close onto what is under them, or open out of it, afterwards)
								const sl = slideTo(rs, W0, X, Y, PH, td, u, 0.0004, 0.6, palmFace)
								if (!sl) continue
								// (the heel low on its back, nearly upright, the back of the hand toward the camera)
								// (two hands side by side: their fingers turned a little in toward each other over its top, the hands as near together as a
								// centimetre between them allows, so the fingers lie on it rather than off its sides)
								const inward = K.two ? (rs === "left" ? 10 : -10) : 0
								const pref = ((tau - 24) / 10) ** 2 + (K.two ? (turn / 16) ** 2 * 0.5 + ((Math.abs(z) - 0.038) / 0.006) ** 2 * 0.3 : ((turn - 25) / 12) ** 2) + ((alpha - inward) / 12) ** 2 + k * 0.35 + (Math.abs(z) > 0 && !K.two ? 0.2 : 0)
								how = { tau, turn, alpha, h, z, low: true }
								const rule = (r) => {
									// (it meets it with its palm: the palm within 4 mm of it, the wrist never first)
									const palm = clearance(r, td, palmFace)
									return (palm <= 0.004 ? 0 : 1 + (palm - 0.004) * 200) + (sl.link === "wrist" ? 1 : 0) + others3(r)
								}
								keep(rs, sl.W, X, Y, PH, sl.link, null, pref, rule)
							}
		return out
	}
	// a taller thing: the palm flat on its back, upright, the fingers up along it
	for (const tau of K.two ? [0, 20, 40, 60, 75] : [0, 15, 30, 40, 50, 60, 70, 80])
		for (const turn of K.two ? [0, 20] : [0, 15, 25, 35])
			for (const alpha of K.two ? [0, -15, 15] : [0, -20, 20])
				for (const h of K.two ? K.hs2 : K.hs)
					for (const z of K.zs)
						for (const rs of sides) {
							// (of two hands, the left one on the pusher's left of the middle, the right one on its right)
							if (K.two && (rs === "left" ? z > 0.012 : z < -0.012)) continue
							// (the palm turned tau from square to the push toward facing down, and `turn` round the upright, the palm from the camera, so the
							// back of the hand, its fingers and its thumb are seen)
							const n0 = u.clone().multiplyScalar(Math.cos(tau * D2R)).addScaledVector(v, -Math.sin(tau * D2R))
							const nIn = n0.multiplyScalar(Math.cos(turn * D2R)).addScaledVector(c, -Math.sin(turn * D2R)).normalize()
							const Y = nIn.clone().negate()
							const X = v.clone().addScaledVector(nIn, -v.dot(nIn)).normalize().applyAxisAngle(nIn, alpha * D2R)
							const o = K.face.clone().addScaledVector(v, h).addScaledVector(c, z).addScaledVector(u, -0.12)
							const W0 = o.sub(offsetOf(scratchRig(rs), R.heel, X, Y))
							const sl = slideTo(rs, W0, X, Y, P, td, u, 0.0004, 0.6)
							if (!sl) continue
							// (how a placement at wrist W reads: the palm on it, not a corner of it (how much of the palm lies within 6 mm of the thing))
							const lies = (W) => {
								let on = 0
								let n = 0
								for (const S of handSpheres(tryHand(rs, W, X, Y, P))) {
									if (S.link !== "palm") continue
									n++
									if (td(S.c) - S.r <= 0.006) on++
								}
								return (1 - on / Math.max(1, n)) * 1.5
							}
							const base = (tau / 30) ** 2 + (K.two ? (turn / 30) ** 2 * 0.5 : ((turn - 25) / 15) ** 2) + (alpha / 30) ** 2
							const pref = base + lies(sl.W)
							how = { tau, turn, alpha, h, z }
							const rule = (r) => {
								// (it meets it with its palm, or flat: the palm within 4 mm of it, the wrist never first)
								const palm = clearance(r, td, palmFace)
								return (palm <= 0.004 ? 0 : 1 + (palm - 0.004) * 200) + (sl.link === "wrist" ? 1 : 0) + others3(r)
							}
							keep(rs, sl.W, X, Y, P, sl.link, null, pref, rule)
						}
	return out
}

/** The picture's axes where a scene's hands are, as its camera looks along -z (the scene's fixed camera's pitch, else the wide shot's 7 degrees
 *  down): {right, up} (unit, world). */
function pictureAxes(doc) {
	const pitch = (doc?.view?.camera?.pitch ?? 7) * D2R
	return { right: V(1, 0, 0), up: V(0, Math.cos(pitch), -Math.sin(pitch)) }
}
/** A hand's picture: its spheres ({c, r}, world) as discs on the picture's plane (axes, pictureAxes), the cells (`cell` m, on a grid fixed in
 *  that plane) they cover, sorted: Float64Array of cell keys. */
export function pictureCells(S, axes, cell = 0.003) {
	const P = S.map((s) => [s.c.dot(axes.right), s.c.dot(axes.up), s.r])
	let I0 = Infinity
	let I1 = -Infinity
	let J0 = Infinity
	let J1 = -Infinity
	for (const [x, y, r] of P) {
		I0 = Math.min(I0, Math.floor((x - r) / cell))
		I1 = Math.max(I1, Math.floor((x + r) / cell))
		J0 = Math.min(J0, Math.floor((y - r) / cell))
		J1 = Math.max(J1, Math.floor((y + r) / cell))
	}
	if (!Number.isFinite(I0)) return new Float64Array(0)
	const nx = I1 - I0 + 1
	const ny = J1 - J0 + 1
	const bits = new Uint8Array(nx * ny)
	for (const [x, y, r] of P) {
		const i0 = Math.floor((x - r) / cell)
		const i1 = Math.floor((x + r) / cell)
		const j0 = Math.floor((y - r) / cell)
		const j1 = Math.floor((y + r) / cell)
		for (let j = j0; j <= j1; j++) {
			const yc = (j + 0.5) * cell - y
			for (let i = i0; i <= i1; i++) {
				const xc = (i + 0.5) * cell - x
				if (xc * xc + yc * yc <= r * r) bits[(j - J0) * nx + (i - I0)] = 1
			}
		}
	}
	// (each cell a key on a grid fixed in the picture's plane, in rising order: rows of j, then i)
	let n = 0
	for (let k = 0; k < bits.length; k++) n += bits[k]
	const out = new Float64Array(n)
	let m = 0
	for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (bits[j * nx + i]) out[m++] = (j + J0 + 100000) * 200000 + (i + I0 + 100000)
	return out
}
/** How much of the smaller of two pictures (pictureCells) the other covers (0 .. 1). */
export function cellsOverlap(A, B) {
	let i = 0
	let j = 0
	let n = 0
	while (i < A.length && j < B.length) {
		if (A[i] === B[j]) {
			n++
			i++
			j++
		} else if (A[i] < B[j]) i++
		else j++
	}
	return n / Math.max(1, Math.min(A.length, B.length))
}
/** How much of the smaller of two hands' pictures the other covers (0 .. 1): their spheres ({c, r}, world) as discs on the picture's plane (axes,
 *  pictureAxes), counted on 2 mm cells. */
export function screenOverlap(SA, SB, axes, cell = 0.002) {
	const proj = (S) => S.map((s) => ({ x: s.c.dot(axes.right), y: s.c.dot(axes.up), r: s.r }))
	const A = proj(SA)
	const B = proj(SB)
	const box = (L) => L.reduce((b, s) => [Math.min(b[0], s.x - s.r), Math.max(b[1], s.x + s.r), Math.min(b[2], s.y - s.r), Math.max(b[3], s.y + s.r)], [Infinity, -Infinity, Infinity, -Infinity])
	const ba = box(A)
	const bb = box(B)
	if (ba[1] <= bb[0] || bb[1] <= ba[0] || ba[3] <= bb[2] || bb[3] <= ba[2]) return 0 // (apart in the picture)
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	for (const s of A.concat(B)) {
		x0 = Math.min(x0, s.x - s.r)
		x1 = Math.max(x1, s.x + s.r)
		y0 = Math.min(y0, s.y - s.r)
		y1 = Math.max(y1, s.y + s.r)
	}
	const nx = Math.max(1, Math.ceil((x1 - x0) / cell))
	const ny = Math.max(1, Math.ceil((y1 - y0) / cell))
	if (nx * ny > 4e6) return 0
	const grid = new Uint8Array(nx * ny)
	const fill = (L, bit) => {
		for (const s of L) {
			const i0 = Math.max(0, Math.floor((s.x - s.r - x0) / cell))
			const i1 = Math.min(nx - 1, Math.floor((s.x + s.r - x0) / cell))
			const j0 = Math.max(0, Math.floor((s.y - s.r - y0) / cell))
			const j1 = Math.min(ny - 1, Math.floor((s.y + s.r - y0) / cell))
			for (let j = j0; j <= j1; j++) {
				const yc = y0 + (j + 0.5) * cell - s.y
				for (let i = i0; i <= i1; i++) {
					const xc = x0 + (i + 0.5) * cell - s.x
					if (xc * xc + yc * yc <= s.r * s.r) grid[j * nx + i] |= bit
				}
			}
		}
	}
	fill(A, 1)
	fill(B, 2)
	let a = 0
	let b = 0
	let ab = 0
	for (let k = 0; k < grid.length; k++) {
		const g = grid[k]
		if (g & 1) a++
		if (g & 2) b++
		if (g === 3) ab++
	}
	return ab / Math.max(1, Math.min(a, b))
}

/** A pushing hand's fingers laid on what it pushes (field d): they bend at the knuckles to meet it and a little more beyond, never curled round it;
 *  a finger with nothing there to meet (above a low thing's top) stays as it was, straight. On a ball (`round`) they bend as far as its curve
 *  asks, so their pads lie on it up its back, not standing off it above its top. */
function closeHand(rig, d, round = false, low = false) {
	const met = []
	const keep = (i, f) => {
		const bones = i === "t" ? ["thumb_1", "thumb_2", "thumb_3"] : [1, 2, 3].map((j) => `${DIGITS[i]}_${j}`)
		const was = bones.map((b) => [...rig.pose[b]])
		if (!f().length) {
			bones.forEach((b, k) => (rig.pose[b] = was[k]))
			applyPose(rig, rig.pose)
		} else if (i !== "t") met.push(i)
	}
	// (over a low thing's top the fingers, bent forward at the knuckles, close on until they rest on it)
	// (round a ball they follow its curve, each joint bent as far as it asks)
	for (const i of [0, 1, 2, 3]) keep(i, () => closeFinger(rig, d, i, { most: low ? [70, 45, 25] : round ? [50, 28, 14] : [32, 22, 10] }))
	if (low && met.length) {
		// (a finger with nothing under it, past the thing's side, is held as the nearest one that rests on it is, a little more bent the further it is
		// toward the little finger: the fingers together, never one standing off the others; opened out of anything it would be in)
		for (const i of [0, 1, 2, 3]) {
			if (met.includes(i)) continue
			const j = met.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a))
			for (let k = 1; k <= 3; k++) rig.pose[`${DIGITS[i]}_${k}`][2] = clamp(rig.pose[`${DIGITS[j]}_${k}`][2] - (i - j) * 2, -FLEX_MAX[k - 1], 0)
			applyPose(rig, rig.pose)
			rig.root.updateMatrixWorld(true)
			const links = new Set([`f${i}.0`, `f${i}.1`, `f${i}.2`])
			for (let n = 0; n < 12 && clearance(rig, d, (l) => links.has(l)) < 0.0005; n++) {
				for (let k = 1; k <= 3; k++) rig.pose[`${DIGITS[i]}_${k}`][2] = Math.min(0, rig.pose[`${DIGITS[i]}_${k}`][2] + 3)
				applyPose(rig, rig.pose)
				rig.root.updateMatrixWorld(true)
			}
		}
	}
	// (the thumb laid along the index of a palm on a low thing's back stays as it is: closing it would lift the ball of the thumb off the thing)
	if (!low) keep("t", () => closeFinger(rig, d, "t", { most: [12, 15, 15] }))
}
/** World spheres ({c, r, g}) in bunches by their group (g; the capsule hand's in bunches of eight), each bunch with a sphere round it: [{c, r, list}]. */
function boundsOf(sp) {
	const by = new Map()
	sp.forEach((S, i) => {
		const k = S.g ?? (i >> 3)
		if (!by.has(k)) by.set(k, [])
		by.get(k).push(S)
	})
	return [...by.values()].map((list) => ({ ...boundOf(list), list, db: 0 }))
}
/** The least gap between two hands' spheres, by their bunches (boundsOf): only bunches whose bounds are near are looked into. */
function bunchGap(A, B, under = -Infinity) {
	let g = Infinity
	for (const a of A)
		for (const b of B) {
			if (a.c.distanceTo(b.c) - a.r - b.r >= g) continue
			for (const s of a.list)
				for (const t of b.list) {
					const e = s.c.distanceTo(t.c) - s.r - t.r
					if (e < g) {
						g = e
						if (g < under) return g // (nearer than asked about: no need to know how much)
					}
				}
		}
	return g
}
/** The least gap between a hand's sphere bunches and an arm's line (armLine: its stretches, each its own radius round it), no more than `upTo`. */
function lineGap(A, line, upTo = Infinity) {
	let g = upTo
	for (const q of segsOf(line))
		for (const a of A) {
			if (pointSegment(a.c, q.a, q.b) - a.r - q.r >= g) continue
			for (const s of a.list) g = Math.min(g, pointSegment(s.c, q.a, q.b) - s.r - q.r)
		}
	return g
}
/** The field of a set of spheres ({c, r, g}): by their bunches (boundsOf), a bunch looked into only when it could hold a nearer one. */
const sphereField = (sp) => {
	const B = boundsOf(sp)
	return (pt) => {
		let m = Infinity
		for (const b of B) {
			if (pt.distanceTo(b.c) - b.r >= m) continue
			for (const s of b.list) {
				const e = pt.distanceTo(s.c) - s.r
				if (e < m) m = e
			}
		}
		return m
	}
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
	// (a thing lower than LOW_THING, a toy car: a palm stands on its back, its fingers bent over its top; two hands side by side across it)
	const low = !ball && E.h < LOW_THING
	const two = skin === "two hands"
	// the heights to try (along the push's up from the face's middle): the thing's back from near its foot to its top
	const lo = E.y0 - face0.y + 0.006
	const hi = E.y1 - face0.y + (skin === "finger" || skin === "fist" ? -0.004 : 0.01)
	const hs = skin === "finger" || skin === "fist" ? [0, ...[0.25, 0.5, 0.75].map((k) => lo + (hi - lo) * k)].filter((h) => h >= lo - 1e-9 && h <= hi + 1e-9) : [0.15, 0.35, 0.55, 0.75, 0.95].map((k) => lo + (hi - lo) * k)
	const palmW = refs().palmW
	// (two hands across it: their middles from touching (a palm's width apart, the thumbs in between kept clear by the pair's check) to where a
	// third of each palm is still on its back)
	const zs = two ? [0, ...[0.5, 0.54, 0.58, 0.65, 0.8, 1, 1.25].flatMap((k) => [-(palmW * k + 0.004), palmW * k + 0.004])].filter((z) => Math.abs(z) <= Math.max(zh + palmW * 0.17, palmW * 0.58 + 0.004) + 1e-9) : [0]
	// (two hands' heels from near its foot to four fifths up its back: a heel on its top edge would be set down onto its top, under the other; on a
	// low thing both heels on its back, the upper one just under its top edge, so the two lean over it alike, one above the other)
	const hs2 = [0.15, 0.55, 0.95].map((k) => lo + (hi - lo) * k)
	// (a palm upright on a low thing's back: its heel from near the foot of the back up to three quarters of the way up it, the lowest the arm
	// allows over the floor wanted)
	const hsLow = [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.64, 0.76].map((k) => lo + (hi - lo) * k)
	const K = { u: u0, v: v0, c: c0, face: face0, td, ball, others, E, two, hs: hs.length ? hs : [0], hs2, hsLow, zs, gammas: two ? [-45, -30, -15, 0, 15, 30, 45] : [0, 15, 30, 45] }
	const cands = pushCands(two ? "hand" : skin, K)
	const behind = u0.clone().negate()
	// (a pushing palm has its wrist bent back, as a hand pushing a wall has, the bend spread over a forearm rising a little, never a hard kink; a
	// fingertip or a fist pushes with the wrist nearly straight; the arm low behind the push, as a child's reaching along a lane, a little toward
	// the camera or away from it)
	// (on a low thing the arm rises a little more from behind it, as a child's leaning over a toy on the floor or a table)
	const armPref = skin === "hand" || two ? { phi: 10, ext: 55, extMax: WRIST.push, riseMin: ARM.level, rise: low ? 20 : 12 } : { phi: 10, ext: 10, riseMin: ARM.level, rise: 12 }
	const ways = armWays({ way: behind }, armPref)
	// a hand's own cost (+ its arm's for way w): one hand's wish is the back of the hand toward the camera (a hand on a ball turned ~42 degrees
	// round it, so the palm's width, its four fingers and its thumb are seen), a fingertip a little toward the camera
	const own = (cd) => cd.fault * 100 + cd.pref + (cd.at && !two ? (((Math.atan2(cd.at.clone().sub(ball.c).dot(c0), -cd.at.clone().sub(ball.c).dot(u0)) / D2R) - 42) / 20) ** 2 : 0)
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
		// (both hands seen: as the camera looks, neither covers more than a fifth of the other, so the two never read as one hand with extra fingers)
		const axes = pictureAxes(C.doc)
		// (and the left hand, the further from the camera, a little the higher in the picture, as its arm is: the two arms then part from each other
		// in the picture as they leave the hands)
		// (side by side across a low thing's back the two alike, as a mirror of each other: the same lean, the same height on its back, turned in
		// alike; the far one is seen the higher by its depth alone)
		const layoutOf = (cl, cr) => {
			const dW = cl.W.clone().sub(cr.W)
			const up = dW.dot(axes.up)
			const alike = low && cl.how && cr.how ? ((cl.how.tau - cr.how.tau) / 6) ** 2 + ((cl.how.h - cr.how.h) / 0.006) ** 2 + ((cl.how.turn - cr.how.turn) / 8) ** 2 + ((cl.how.alpha + cr.how.alpha) / 8) ** 2 : 0
			return (low ? alike : clamp((0.04 - up) / 0.04, 0, 2) * 1.2) + (dW.dot(right) > 0.01 ? 100 + dW.dot(right) * 1000 : 0) // (the left hand never on the right: crossed hands are a fault)
		}
		const ovMost = low ? OVERLAP_LOW : ball ? OVERLAP_BALL : OVERLAP
		const overlapOf = (cl, cr) => {
			const ov = cellsOverlap((cl.cells ??= pictureCells(cl.spheres, axes)), (cr.cells ??= pictureCells(cr.spheres, axes)))
			return ov > ovMost ? 15 + (ov - ovMost) * 50 : ov * (low ? 0.5 : 2)
		}
		const crossed = (cl, cr) => cl.W.clone().sub(cr.W).dot(right) > 0.01
		/** The best pair of left entries Ls and right entries Rs whose hands are `apart` m apart at the least (their arms 3 mm), the left hand on the
		 *  person's left unless `anyway`, or null. Each side's 90 cheapest places are paired; how much one hand covers the other in the picture is
		 *  looked at only for a pair that could still win. */
		const pairUp = (Ls, Rs, field, apart, anyway = false) => {
			// (each side's cheapest places, and the cheapest of those on a low thing's top: the second hand that keeps the two apart in the picture)
			const top = (E) => {
				const by = [...E].sort((a, b) => a.proxy - b.proxy)
				return [...by.filter((e) => !e.cd.how?.top).slice(0, 90), ...by.filter((e) => e.cd.how?.top).slice(0, 30)]
			}
			const pairs = []
			for (const L of top(Ls))
				for (const Rh of top(Rs)) {
					if (!anyway && crossed(L.cd, Rh.cd)) continue
					const layout = layoutOf(L.cd, Rh.cd)
					pairs.push({ L, R: Rh, layout, pre: L.proxy + Rh.proxy + layout })
				}
			pairs.sort((a, b) => a.pre - b.pre)
			// (the five cheapest pairs, best first: the hands' last fitting, their fingers laid on the thing and their skin seated, may bring one in
			// front of the other after all, and then the next is taken)
			const res = []
			let onTop = null // (and the cheapest with a hand on a low thing's top, which a side-by-side pair may turn out to need)
			const isTop = (pr) => !!(pr.L.cd.how?.top || pr.R.cd.how?.top)
			const bound = (pr) => Math.max(res.length < 4 ? Infinity : res[3].cost, isTop(pr) && !onTop ? Infinity : -Infinity, isTop(pr) && onTop ? onTop.cost : -Infinity)
			let tried = 0
			for (const pr of pairs) {
				if (pr.pre >= bound(pr)) {
					if (!isTop(pr) && (onTop || !pairs.some((q) => isTop(q)))) break
					continue
				}
				const cl = pr.L.cd
				const cr = pr.R.cd
				let gh = Infinity
				const bl = (cl.bound ??= boundOf(cl.spheres))
				const br = (cr.bound ??= boundOf(cr.spheres))
				if (bl.c.distanceTo(br.c) - bl.r - br.r < 0.01) gh = bunchGap((cl.bunches ??= boundsOf(cl.spheres)), (cr.bunches ??= boundsOf(cr.spheres)), apart)
				if (gh < apart) continue // (never a hand in the other)
				const ov = overlapOf(cl, cr)
				if (pr.pre + ov >= bound(pr)) continue
				pr.layout += ov
				if (++tried > 300) break
				// (each arm its own way out of its hand, the two as near parallel as their hands allow (hands round a ball turn from each other, and so
				// do their forearms), never crossing: the left arm runs out on the left; each pair's two wrists first, their lines only while the pair
				// could still win)
				// (each hand's own cheapest ways, as its side wants them: the left arm turned away from the camera, the right toward it)
				// (a hand lying on the other one has its arm out over the other's, rising more)
				const best8 = (c) =>
					ways
						.map((w) => wristPart(c.side, c.X, c.Y, w, c.how?.over ? { ...armPref, rise: 30, phi: 15 } : { ...armPref, phi: c.side === "left" ? -5 : 25 }))
						.sort((a, b) => a.base - b.base)
						.slice(0, c.how?.over ? 30 : 14)
				const wl = best8(cl)
				const wr = best8(cr)
				// (each from its own side: the left arm out away from the camera, the right one toward it, splayed about 20 degrees, never crossed)
				const both = []
				for (const eL of wl)
					for (const eR of wr) {
						const spread = eL.c.A.angleTo(eR.c.A) / D2R
						if (spread > 45) continue
						const sideL = eL.c.A.dot(c0) - eR.c.A.dot(c0) < 0 ? 0 : 3 // (the left arm the further from the camera)
						// (release 2's arms turned apart: the left one 15 degrees away from the camera, the right one 15 toward it, and the left one rising a
						// little more, so in the picture it leaves up and away and the right one low)
						const rises = cr.how?.over ? 0 : ((eL.c.rise - eR.c.rise - 8) / 8) ** 2 + ((eL.c.phi + 5) / 20) ** 2 + ((eR.c.phi - 25) / 20) ** 2
						both.push({ eL, eR, base: pr.L.base + pr.R.base + eL.base + eR.base + pr.layout + ((spread - 20) / 10) ** 2 + sideL + rises })
					}
				both.sort((a, b) => a.base - b.base)
				let mine = null
				for (const b of both) {
					if (b.base >= Math.min(bound(pr), mine?.cost ?? Infinity)) break
					const aL = withClearance(b.eL, cl.W, field)
					const aR = withClearance(b.eR, cr.W, field)
					const lineL = armLine(cl.W, aL.A)
					const lineR = armLine(cr.W, aR.A)
					if (!anyway && lineL.b.clone().sub(lineR.b).dot(right) > 0.005) continue // (the arms crossed)
					let g = linesGap(lineL, lineR)
					g = Math.min(g, lineGap((cl.bunches ??= boundsOf(cl.spheres)), lineR, g), lineGap((cr.bunches ??= boundsOf(cr.spheres)), lineL, g))
					if (g < 0.003) continue
					const cost = b.base - (b.eL.base + b.eR.base) + aL.cost + aR.cost
					if (!mine || cost < mine.cost) mine = { cost, gap: Math.min(g, gh), hands: [{ ...cl, A: aL.A, arm: aL }, { ...cr, A: aR.A, arm: aR }] }
				}
				if (mine) {
					if (isTop(pr) && (!onTop || mine.cost < onTop.cost)) onTop = mine
					res.push(mine)
					res.sort((a, b) => a.cost - b.cost)
					if (res.length > 4) res.pop()
				}
			}
			if (onTop && !res.includes(onTop)) res.push(onTop)
			if (!res.length) return null
			res[0].alts = res
			return res[0]
		}
		const E1 = entries(cands, all)
		// (a centimetre apart at the least, every part of the one from every part of the other)
		lay = pairUp(E1.left, E1.right, all, APART(low))
		// (a fault in the best pair, a wrist past its easy bend or a hand in something: the fallback below is tried too, and the cheaper kept)
		if ((!lay || lay.cost >= 100) && E1.left.length) {
			const lay1 = lay
			// too small for two hands on it apart: the right hand lies on the left one (one above the other), never in it: the left hand as it best
			// lies on it, the right one set down on the thing or on that hand, whichever it meets first, its arm parallel and clear
			const L0 = E1.left.reduce((a, b) => (b.proxy < a.proxy ? b : a))
			// (the left hand as it will lie: its fingers closed onto the thing, then the right one set on that)
			const rl = tryHand("left", L0.cd.W, L0.cd.X, L0.cd.Y, L0.cd.P)
			closeHand(rl, td, !!ball)
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
			// (the right hand: its own places as they were, those clear of the left hand pass the pair's check, and the ones lying on the left hand)
			const E2 = { right: [...E1.right, ...entries(over, all2).right] }
			lay = pairUp([L], E2.right, all, 0.0003)
			if (lay1 && (!lay || lay1.cost <= lay.cost)) lay = lay1
			// (and failing that, nearer than a centimetre, or crossed hands rather than one in the other)
			lay ??= pairUp(E1.left, E1.right, all, 0.003) ?? pairUp(E1.left, E1.right, all, 0.003, true) ?? pairUp([L], E2.right, all, 0.0003, true)
		}
	}
	if (!lay) return null
	// the hands as chosen, their fingers closed onto a ball (or a curved thing) they lie on, or onto the other hand, never into it
	// (each sleeve out of the picture along its arm and 30 cm more, and as far again as the push carries the hand)
	const P2 = C.resolved?.[p.item] ?? {}
	// (one rig a side, posed again for each pair tried: the one kept is posed last)
	const rigOf = {}
	const fitted = (L) => {
		L.hands = L.hands.map((h) => ({ ...h }))
		for (const h of L.hands) {
			const rig = (rigOf[h.side] ??= newRig(h.side))
			setArm(rig, clamp(armExit(C.exit, h.W, h.A) + 0.3 + (P2.stroke ?? 0.15), 0.45, 3.2))
			rig.pose = copyPose(h.P)
			placeHand(rig, h.W, h.X, h.Y)
			applyPose(rig, rig.pose)
			placeArm(rig, h.A) // (hand.glb: the wrist bent as it will be drawn, its skin with it)
			rig.root.updateMatrixWorld(true)
			h.rig = rig
		}
		// (a palm on a low thing's back is seated on it by its palm first, its heel 0.4 mm off: the fingers bent over its top then close onto it, or
		// open out of it, from there)
		if (low && (skin === "hand" || two))
			for (const h of L.hands)
				if (h.rig.mesh && !h.how?.over) {
					current(h.rig)
					seatOnSkin(h.rig, td, u0, { others, square: 0.95, arm: h.A, links: ["palm", "t.0"] })
					h.W = h.rig.root.position.clone()
				}
		// (a pair with one hand lying on the other: the lower one's fingers were closed onto the thing before the other was laid on it, and the upper
		// one lies flat on it as it is)
		const resting = L.hands.some((h) => h.how?.over)
		if ((skin === "hand" || two) && !resting)
			L.hands.forEach((h, k) => {
				// (never into the other hand; a finger that closing brought nearer the other hand than the two keep apart (APART) is eased back
				// toward where it was until it is that far off, or as it was)
				const other = L.hands[1 - k]?.rig
				const sf = other ? sphereField(handSpheres(current(other))) : null
				const f = sf ? fieldMin(td, sf) : td
				current(h.rig)
				const was = copyPose(h.rig.pose)
				closeHand(h.rig, f, !!ball, low)
				if (!sf) return
				const shut = copyPose(h.rig.pose)
				for (const i of [0, 1, 2, 3]) {
					const links = new Set([`f${i}.0`, `f${i}.1`, `f${i}.2`])
					const bones = [1, 2, 3].map((j) => `${DIGITS[i]}_${j}`)
					for (let n = 1; n <= 8 && clearance(current(h.rig), sf, (l) => links.has(l)) < APART(low) + 0.0005; n++) {
						for (const b of bones) h.rig.pose[b] = lerpPose(shut, was, n / 8)[b]
						applyPose(h.rig, h.rig.pose)
					}
				}
			})
		// (hand.glb: each hand seated on what it pushes by its own drawn skin, along the push: a fist's knuckles lie inside their spheres; a hand
		// resting on the other is left as it lies, or goes with the one it rests on)
		for (const h of L.hands)
			if (h.rig.mesh && !h.how?.over) {
				current(h.rig)
				// (along the push, or down onto a low thing's top edge where the heel rests on it: anything but back from it)
				const w0 = h.rig.root.position.clone()
				seatOnSkin(h.rig, td, u0, { others, square: -0.05, arm: h.A })
				h.W = h.rig.root.position.clone()
				for (const o of L.hands)
					if (o !== h && o.how?.over) {
						o.rig.root.position.add(h.W.clone().sub(w0))
						o.W = o.rig.root.position.clone()
						current(o.rig)
					}
			}
		for (const h of L.hands) h.fit = { W: h.rig.root.position.clone(), pose: copyPose(h.rig.pose) }
		if (L.hands.length < 2) return L
		// (as drawn now: how much one covers the other in the picture, how far apart they and their arms are)
		const [hl, hr] = L.hands
		const sl = handSpheres(current(hl.rig))
		const sr = handSpheres(current(hr.rig))
		L.ov = screenOverlap(sl, sr, pictureAxes(C.doc))
		L.gap = handsGap({ spheres: sl, line: armLine(hl.W, hl.A) }, { spheres: sr, line: armLine(hr.W, hr.A) })
		return L
	}
	if (two) {
		// (the first of the cheapest pairs that, fitted one after the other, keeps both seen and a centimetre apart; else the one that hides the
		// least)
		const tries = []
		// (a hand lying on the other one is meant to touch it)
		const ovMost = low ? OVERLAP_LOW : ball ? OVERLAP_BALL : OVERLAP
		const good = (L) => L.ov <= ovMost && L.gap >= (L.hands.some((h) => h.how?.over) ? 0 : APART(low) - 1e-6)
		for (const L of lay.alts ?? [lay]) {
			tries.push(fitted(L))
			if (good(L)) break
		}
		lay = tries.find(good) ?? tries.find((L) => L.ov <= ovMost && L.gap >= 0) ?? tries.reduce((a, b) => (b.ov + Math.max(0, -b.gap) * 50 < a.ov + Math.max(0, -a.gap) * 50 ? b : a))
		// (the rigs as the pair kept left them)
		for (const h of lay.hands) {
			setArm(h.rig, clamp(armExit(C.exit, h.W, h.A) + 0.3 + (P2.stroke ?? 0.15), 0.45, 3.2))
			h.rig.pose = copyPose(h.fit.pose)
			placeHand(h.rig, h.fit.W, h.X, h.Y)
			applyPose(h.rig, h.rig.pose)
			placeArm(h.rig, h.A)
			current(h.rig)
		}
	} else lay = fitted(lay)
	const rigs = lay.hands.map((h) => h.rig)
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
	// (how far each frame's hands are from the thing: a palm's fingers ease open once it has gone from them)
	const away = new Float32Array(N + 1).fill(Infinity)
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
			const c0 = clearAt(dt, 0)
			away[k] = c0
			if (c0 >= thr) continue
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
			away[k] = thr
		}
	}
	// a palm that pushed (a hand, two hands) eases its fingers open once the thing has gone from it (more than 1.2 cm off from then on): it is not
	// seen to clutch the air where the thing was
	let tGone = Infinity
	if (skin === "hand" || two) {
		let k = N
		while (k >= 0 && away[k] > 0.012) k--
		if (k < N && k >= 0) tGone = (k + 1) / HZ
	}
	const RELAX = 0.25 // s
	for (const h of lay.hands) h.open = lerpPose(h.pose, POSES.flat, 0.6)
	const _rp = copyPose(lay.hands[0].pose)
	const Wt = new THREE.Vector3()
	const at = (t) => {
		faceAt(t, shift)
		const k = clamp(t * HZ, 0, N)
		const i = Math.floor(k)
		const s = i >= N ? back[N] : back[i] + (back[i + 1] - back[i]) * (k - i)
		const e = t > tGone ? smooth((t - tGone) / RELAX) : 0
		for (const h of lay.hands) {
			Wt.copy(h.W).add(shift).addScaledVector(u0, -s)
			placeHand(h.rig, Wt, h.X, h.Y)
			applyPose(h.rig, e > 0 ? lerpPose(h.pose, h.open, e, _rp) : h.pose)
			placeArm(h.rig, h.A)
		}
	}
	at(0)
	const info = { skin, hands: lay.hands.map((h) => ({ side: h.side, link: h.link, how: h.how, rise: h.arm.rise, phi: h.arm.phi, wrist: h.arm.wrist, clear: h.arm.clear, fault: h.fault })), gap: lay.gap ?? null, cost: lay.cost, overlap: lay.hands.length > 1 ? screenOverlap(handSpheres(current(lay.hands[0].rig)), handSpheres(current(lay.hands[1].rig)), pictureAxes(C.doc)) : null }
	return { item: p.item, rig: rigs[0], rigs, solidId: paddle.id, skin, at, busy: (t) => t > tGone - 0.02 && t < tGone + RELAX + 0.02, info, lay, target, u0 }
}
// ---------------------------------------------------------------- pouring: a hand on the pitcher's handle (a cup's body), tipping with it
// a cup's thumb, the starts fitThumb closes onto its far side from ([swing, lift, twist, knuckle, end], found on hand.glb round the cup)
const CUP_THUMBS = [[-50, 10, 90, 10, 10], [-65, 15, 80, 15, 15], [-40, 5, 100, 10, 10], [-75, 10, 70, 20, 20], [-30, 0, 110, 10, 10], [-55, 20, 100, 10, 20], [-20, 10, 120, 5, 10]]
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
	const W = contact.clone().sub(offsetOf(rig, refs().palmAt(0.05), X, Y))
	placeHand(rig, W, X, Y)
	rig.pose = copyPose(POSES.cup)
	// (round a cup the thumb lies by its rim, not up in the air; round a handle it starts open, clear of the handle, and closes over it after the
	// fingers, fitThumb)
	if (cup) Object.assign(rig.pose, thumbTurns([0, -30, 120, 10, 10]))
	else Object.assign(rig.pose, thumbTurns([-50, 15, 90, 5, 5]))
	applyPose(rig, rig.pose)
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
	const arm = chooseArm(rs, W, X, Y, side > 0 ? "left" : "right", dAll, { phi: -30, rise: 34 })
	const A0 = arm.A.clone()
	// (the sleeve out of the picture along the arm and 35 cm more: the arm turns as the vessel tips)
	setArm(rig, clamp(armExit(C.exit, W.clone().applyMatrix4(Mw0), A0.clone().applyAxisAngle(V(0, 0, 1), base0)) + 0.35, 0.45, 3.2))
	placeArm(rig, A0) // (hand.glb: the wrist bent as it will be drawn, its skin with it)
	rig.root.updateMatrixWorld(true)
	for (const i of [0, 1, 2, 3]) closeFinger(rig, dBar, i)
	// (round a cup the palm is seated on it first, the ball of the thumb on its curve, so the thumb is fitted to the hand as it will hold it)
	if (cup && rig.mesh) seatOnSkin(rig, dBar, Y.clone().negate(), { links: ["palm", "t.0", "f0.0", "f1.0", "f2.0", "f3.0"] })
	const tipOf = (link) => sphereAt(rig.spheres.find((S) => S.tip === link), new THREE.Vector3())
	const knuckle = () => new THREE.Vector3().setFromMatrixPosition(rig.bones?.index_1?.matrixWorld ?? rig.f[0].mcp.matrixWorld)
	if (cup) {
		// round a cup the thumb closes onto it across from the fingers, as far round its far side as it reaches, its pad on it (seen through the
		// glass), never standing up off the grip nor over the rim, the end joint a little bent
		fitThumb(rig, dBar, CUP_THUMBS, (r) => {
			r.root.updateMatrixWorld(true)
			const t = tipOf("t.2")
			return Math.max(0, t.z + 0.005) * 150 + Math.max(0, t.y + 0.006) * 400 + Math.max(0, t.y - (knuckle().y + 0.01)) * 600
		}, [55, 45, 30])
	} else {
		// the thumb closed over the handle opposite the fingers, as round a bar in a fist: on the curled index, never standing up off the grip; its pad
		// on the handle, the end joint bent softly (about 20 degrees, never a hook)
		fitThumb(rig, dBar, [[-38.7, -39.8, 110.7, 32.4, 19.6], [-30, -45, 110, 25, 20], [-45, -35, 100, 20, 15], [-20, -50, 120, 30, 20], [-35, -30, 95, 15, 10], [-50, -20, 90, 15, 15]], (r) => {
			r.root.updateMatrixWorld(true)
			return Math.max(0, tipOf("t.2").y - (knuckle().y + 0.008)) * 300
		}, [50, 50, 24])
	}
	if (rig.mesh) {
		// (hand.glb: the palm seated on the handle and each digit closed the last little way by its own drawn skin)
		seatOnSkin(rig, dBar, Y.clone().negate(), { links: ["palm", "t.0", "f0.0", "f1.0", "f2.0", "f3.0"] })
		for (const i of [0, 1, 2, 3, "t"]) closeOnSkin(rig, dBar, i, { most: i === "t" ? (cup ? [55, 45, 30] : [50, 50, 24]) : null })
		W.copy(rig.root.position)
	}
	const hold = copyPose(rig.pose)
	const Wv = W.clone()
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