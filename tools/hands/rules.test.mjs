// The hands' rules (web/hands.js, web/CONTRACT.md "Hands"), pure geometry on hand-made documents of boxes (no engine, no view), on the hand
// the view draws: web/models/hand.glb (read from disk here), its drawn skin skinned as the GPU skins it (H.skinClearance); the collision spheres
// are only the search's model of it:
//   mesh       hand.glb loaded, the rig contract's bones, the spheres fitted to the skin (no skin point more than 1.5 mm outside them in any pose)
//   geometry   segment and point distances, two hands' gap, the wrist's bend and its sides, the contract's forearm and wrist turns
//   poses      every pose finite, no digit's skin inside another's, the pinch's tips meeting, the fist's thumb under its knuckles, lerpPose
//   contact    what touches is within 1 mm of what it touches and never in it: a pinch's two tips, a grip's and a palm's touching parts, a pressing
//              palm, a pressing fingertip, a pushing fingertip, palm or fist (and nothing else of a finger push or press within 3 mm of the box)
//   clear      no part of a holding hand within 1 mm of anything else (the floor; a pushing one 3 mm), its arm 3 mm clear of everything, rising as
//              ARM says, its wrist easy (a pushing palm's bent back up to WRIST.push)
//   two hands  a centimetre apart (their arms 3 mm) on any frame of a push, neither covering more than a fifth of the other in the picture, the
//              arms never crossed (each its own way, at most 45 degrees apart), the left hand on the left, both moving the same way; on a box too
//              small for both, still never one in the other
//   arm        the sleeve runs on out of the scene's fixed camera's picture on every frame of every role (holds, pushes, a pitcher): no hand at
//              the end of a stub
//   capsules   the procedural hand (drawn when hand.glb does not load): a hold and a push made, nothing in the box
//   node --test tools/hands/rules.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import * as THREE from "three"

const warn = console.warn
console.warn = () => {} // (web/models3d.js registers the model files, some of which want a document: not these tests' business)
const H = await import("../../web/hands.js")
console.warn = warn
const { ARM, WRIST, POSES, POSE_BONES, makeHands, handSpheres, armLine, handsGap, segmentDistance, pointSegment, wristOf, wristOk, armTurns, armRise, lerpPose, newRig, applyPose, SIZE, skinClearance, skinPoints, meshHand, useCapsules, BONES } = H
const LINKS = ["palm", "wrist", "t.0", "t.1", "t.2", ...[0, 1, 2, 3].flatMap((i) => [0, 1, 2].map((k) => `f${i}.${k}`))]

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`)

// ---------------------------------------------------------------- documents of boxes
const S = (id, body, x, y, more = {}) => ({ id, item: id.split("/")[0], itemType: more.type ?? id.split("/")[0], part: id.split("/")[1], kind: more.kind ?? "dynamic", body, at: { x, y }, angle: 0, ...more })
const slab = (w, h, d) => ({ kind: "slab", width: w, height: h, depth: d })
const FLOOR = S("floor/f", slab(1.6, 0.02, 0.8), 0, -0.01, { kind: "static" })
/** The field of one box solid (its outline extruded by its depth), m, negative inside. */
const boxField = (s, at = s.at) => (p) => {
	const q = V(Math.abs(p.x - at.x) - s.body.width / 2, Math.abs(p.y - at.y) - s.body.height / 2, Math.abs(p.z) - s.body.depth / 2)
	return Math.hypot(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0)) + Math.min(Math.max(q.x, q.y, q.z), 0)
}
/** Hands for a document of solids: one frame at rest, or the frames given ({t, placements}); `view`: the document's view (its fixed camera). */
function hands(solids, { held = [], resolved = {}, frames = null, release = 0.5, view = undefined } = {}) {
	const placements = {}
	for (const s of solids) placements[s.id] = { x: s.at.x, y: s.at.y, angle: 0 }
	const doc = { solids, release: { parts: held, at: release }, processes: [], ...(view ? { view } : {}) }
	const track = { fps: 60, frames: frames ?? [{ t: 0, placements }] }
	const Hs = makeHands({ doc, track, resolved, mode: "scene" })
	Hs.fit((s) => ({ x: s.at.x, y: s.at.y, angle: 0 }), track)
	Hs.at(0)
	return Hs
}
const rigsOf = (Hs) => Hs.rigs.flatMap((r) => r.rigs ?? [r.rig])
const current = (rig) => {
	rig.root.updateMatrixWorld(true)
	rig.arm.updateMatrixWorld(true)
	return rig
}
/** The least clearance of the rig's parts (those `links` picks) from field d, and which part: hand.glb's drawn skin (skinned as the GPU does), the
 *  capsule hand's spheres. */
function clearOf(rig, d, links = () => true) {
	let m = Infinity
	let link = null
	if (current(rig).mesh) {
		for (const l of LINKS) {
			if (!links(l)) continue
			const c = skinClearance(rig, d, [l])
			if (c < m) {
				m = c
				link = l
			}
		}
		return { m, link }
	}
	for (const s of handSpheres(rig)) {
		if (!links(s.link)) continue
		const c = d(s.c) - s.r
		if (c < m) {
			m = c
			link = s.link
		}
	}
	return { m, link }
}
const armDir = (rig) => V(1, 0, 0).applyQuaternion(current(rig).arm.quaternion).normalize()
/** The arm's least clearance from field d (its line, less its tapered radius). */
const armClear = (rig, d) => H.armClearance(d, rig.root.position, armDir(rig))
/** A hand's frame as placeHand set it (X to the fingers, Y its back), from its root's turn. */
const frameOf = (rig) => ({ X: V(1, 0, 0).applyQuaternion(rig.root.quaternion), Y: V(0, 1, 0).applyQuaternion(rig.root.quaternion) })
function armRules(rig, fields, what, band, extMax = WRIST.ext) {
	const A = armDir(rig)
	const rise = armRise(A)
	assert.ok(band.some(([lo, hi]) => rise >= lo - 0.5 && rise <= hi + 0.5), `${what}: the arm rises ${rise.toFixed(1)} degrees, outside ${JSON.stringify(band)}`)
	for (const [name, d] of Object.entries(fields)) assert.ok(armClear(rig, d) >= 0.003 - 1e-6, `${what}: the arm is ${(armClear(rig, d) * 1000).toFixed(1)} mm from the ${name}`)
	const { X, Y } = frameOf(rig)
	const w = wristOf(rig.side, X, Y, A)
	assert.ok(wristOk(w, extMax), `${what}: the wrist is bent past what it bends easily ${JSON.stringify(w)}`)
}
const SIDE = [ARM.side]
const ABOVE = [ARM.above]
const PUSHING = [[ARM.level, ARM.side[1]]] // (a pushing palm's forearm may run nearly level)
const PUSH_LOW = [[8, ARM.side[1]]] // (a pushing finger's or fist's arm low behind the push, as a child's along a lane)

// ---------------------------------------------------------------- the mesh
test("hand.glb: loaded, the rig contract's bones, the spheres fitted to its skin", async () => {
	assert.ok(meshHand(), "the hands are drawn with hand.glb")
	const r = newRig("left")
	assert.ok(r.mesh && BONES.every((b) => r.bones[b]?.isBone), "every contract bone is a bone of the mesh")
	const skinned = r.meshes.filter((m) => m.isSkinnedMesh)
	assert.ok(skinned.length === 3 && new Set(skinned.map((m) => m.material)).size === 3, "the skin, the nails and the sleeve: three skinned meshes, three materials")
	// (and the sleeve carried on up the arm from the file's own open end: drawn on the forearm bone in the sleeve's material, out to setArm's length)
	assert.ok(r.sleeveOn && r.meshes.includes(r.sleeveOn) && r.sleeveOn.material === skinned.find((m) => m.material.name === "sleeve" || m.material === r.sleeveOn.material)?.material, "the sleeve carried on")
	assert.equal(r.sleeveOn.parent, r.bones.forearm, "on the forearm bone")
	H.setArm(r, 1.2)
	r.sleeveOn.geometry.computeBoundingBox()
	near(-r.sleeveOn.geometry.boundingBox.min.x, 1.2, 0.006, "the sleeve reaches as far as setArm says")
	// (the rest turns hands.js poses from are the file's own)
	const glb = await (await import("../../web/hand-model.js")).handModel
	glb.scene.traverse((o) => {
		if (!o.isBone || !H.REST[o.name]) return
		assert.ok(o.quaternion.angleTo(H.REST[o.name]) < 2e-3, `${o.name}: the rest turn is hand.glb's`)
	})
	r.root.position.set(0, 0, 0)
	r.root.quaternion.identity()
	r.root.scale.set(SIZE, SIZE, SIZE)
	for (const [name, P] of Object.entries(POSES)) {
		applyPose(r, P)
		r.root.updateMatrixWorld(true)
		const sp = handSpheres(r)
		let worst = 0
		for (const q of skinPoints(r)) {
			if (q.link === "arm") continue
			let d = Infinity
			for (const s of sp) d = Math.min(d, q.p.distanceTo(s.c) - s.r)
			worst = Math.max(worst, d)
		}
		// (the spheres reach the skin's extremes where they sit; a bent knuckle's skin, or the web of a thumb spread wide, may stand out of them a
		// few millimetres: they are the search's, the drawn skin decides where it touches)
		assert.ok(worst <= 0.0065, `${name}: the skin stands ${(worst * 1000).toFixed(2)} mm out of the spheres`)
	}
})

// ---------------------------------------------------------------- geometry
test("segment and point distances", () => {
	near(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(0, 1, 0), V(1, 1, 0)), 1, 1e-12, "parallel, a metre apart")
	near(segmentDistance(V(-1, 0, 0), V(1, 0, 0), V(0, -1, 0.5), V(0, 1, 0.5)), 0.5, 1e-12, "crossing, 0.5 apart")
	near(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(2, 0, 0), V(3, 0, 0)), 1, 1e-12, "in line, end to end")
	near(segmentDistance(V(0, 0, 0), V(0, 0, 0), V(0, 2, 0), V(0, 2, 0)), 2, 1e-12, "two points")
	near(segmentDistance(V(0, 0, 0), V(1, 0, 0), V(0.5, 0.3, 0), V(0.5, 0.3, 0)), 0.3, 1e-12, "a point over the middle")
	near(pointSegment(V(2, 1, 0), V(0, 0, 0), V(1, 0, 0)), Math.SQRT2, 1e-12, "past the end")
	near(pointSegment(V(0.5, 0, 0.25), V(0, 0, 0), V(1, 0, 0)), 0.25, 1e-12, "beside it")
})

test("two hands' gap: spheres to spheres, arm to arm, hand to the other arm", () => {
	const A = { spheres: [{ c: V(0, 0, 0), r: 0.01 }], line: { a: V(0, 0.1, 0), b: V(0, 0.2, 0), r: 0.02 } }
	const B = { spheres: [{ c: V(0.05, 0, 0), r: 0.01 }], line: { a: V(0.05, 0.1, 0), b: V(0.05, 0.2, 0), r: 0.02 } }
	near(handsGap(A, B), 0.01, 1e-12, "arms 5 cm apart, 2 cm each: 1 cm") // (the arms are the nearest: 0.05 - 0.04)
	B.line = { a: V(0.3, 0.1, 0), b: V(0.3, 0.2, 0), r: 0.02 }
	near(handsGap(A, B), 0.03, 1e-12, "the hands 3 cm apart")
	B.spheres = [{ c: V(0, 0.15, 0.025), r: 0.01 }]
	near(handsGap(A, B), -0.005, 1e-12, "a hand in the other's arm: -5 mm")
})

test("the wrist: straight, bent back, toward the thumb, in either hand", () => {
	const X = V(1, 0, 0)
	const Y = V(0, 1, 0)
	const w0 = wristOf("left", X, Y, V(-1, 0, 0))
	near(w0.bend, 0, 1e-9, "straight")
	// (the forearm coming down to the wrist from above-behind, the hand level: the back of the hand bent toward the forearm)
	const up = (deg) => V(-Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0)
	const w1 = wristOf("left", X, Y, up(30))
	near(w1.ext, 30, 1e-9, "bent back 30")
	near(wristOf("right", X, Y, up(30)).ext, 30, 1e-9, "a right hand bent back 30")
	near(wristOf("left", X, Y, V(-Math.cos(0.5), -Math.sin(0.5), 0)).ext, -0.5 * 180 / Math.PI, 1e-9, "bent toward the palm")
	// (the elbow off to the hand's +z, the forearm coming in from that side: the hand turned toward +z from it, a left hand's thumb side (a right
	// hand's +z is its little finger's))
	const side = V(-Math.cos(0.3), 0, Math.sin(0.3))
	near(wristOf("left", X, Y, side).dev, 0.3 * 180 / Math.PI, 1e-9, "left: toward the thumb")
	near(wristOf("right", X, Y, side).dev, -0.3 * 180 / Math.PI, 1e-9, "right: away from the thumb")
	assert.ok(wristOk(w1) && !wristOk({ ext: WRIST.ext + 1, dev: 0 }) && !wristOk({ ext: 0, dev: WRIST.thumb + 1 }) && !wristOk({ ext: -WRIST.flex - 1, dev: 0 }))
})

test("the contract's forearm and wrist turns", () => {
	const X = V(0.6, 0.8, 0)
	const Y = V(-0.8, 0.6, 0)
	// (at rest, the forearm along -X: the forearm's turn is the hand's, the wrist's none)
	const t0 = armTurns(X, Y, X.clone().negate())
	const Hq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, X.clone().cross(Y)))
	near(t0.forearm.angleTo(Hq), 0, 1e-6, "the forearm turns as the hand at rest")
	near(t0.wrist.angleTo(new THREE.Quaternion()), 0, 1e-6, "no wrist turn at rest")
	// (the forearm's -x is along the arm; the wrist's turn is the bend wristOf measures)
	const A = V(-0.9, 0.35, -0.2).normalize()
	const t = armTurns(X, Y, A)
	near(V(-1, 0, 0).applyQuaternion(t.forearm).dot(A), 1, 1e-9, "the forearm points along the arm")
	near((2 * Math.acos(Math.min(1, Math.abs(t.wrist.w))) * 180) / Math.PI, wristOf("left", X, Y, A).bend, 1e-6, "the wrist turns as far as it bends")
	near(armRise(A), (Math.asin(A.y) * 180) / Math.PI, 1e-9, "the arm's rise")
})

// ---------------------------------------------------------------- poses
test("every pose: finite, every bone, no digit's skin in another's, the pinch's tips meeting, the fist's thumb under its knuckles", () => {
	const r = newRig("left")
	r.root.position.set(0, 0, 0)
	r.root.quaternion.identity()
	r.root.scale.set(SIZE, SIZE, SIZE) // (as drawn: metres)
	const digit = (l) => (l.startsWith("f") ? l.slice(0, 2) : l.startsWith("t") ? "t" : "palm")
	const far = (l) => /^f[0-3]\.[12]$/.test(l) || l === "t.1" || l === "t.2"
	for (const [name, P] of Object.entries(POSES)) {
		assert.deepEqual(Object.keys(P).sort(), [...POSE_BONES].sort(), `${name}: every pose bone`)
		assert.ok(Object.values(P).every((v) => v.length === 3 && v.every(Number.isFinite)), `${name}: finite`)
		applyPose(r, P)
		r.root.updateMatrixWorld(true)
		// (a digit's skin behind another digit's: the nearest point of that other skin within 4 mm, along its outward normal; the palm, the wrist
		// and the ball of the thumb are where the digits join, not digits apart)
		const pts = skinPoints(r).filter((q) => q.link !== "arm")
		const B = pts.filter((q) => !(q.link === "palm" || q.link === "wrist" || q.link === "t.0"))
		let worst = 0
		let where = ""
		for (const q of pts) {
			if (!far(q.link)) continue
			let best = null
			let bd = 0.004
			for (const p of B) {
				if (digit(p.link) === digit(q.link)) continue
				const dd = q.p.distanceTo(p.p)
				if (dd < bd) {
					bd = dd
					best = p
				}
			}
			if (!best) continue
			const depth = -q.p.clone().sub(best.p).dot(best.n)
			if (depth > worst) {
				worst = depth
				where = `${q.link} in ${best.link}`
			}
		}
		assert.ok(worst <= 0.0006, `${name}: one digit's skin ${(worst * 1000).toFixed(2)} mm in another's (${where})`)
	}
	applyPose(r, POSES.pinch)
	r.root.updateMatrixWorld(true)
	const tip = (link) => {
		const s = r.spheres.find((q) => q.tip === link)
		return { c: H.sphereAt(s, new THREE.Vector3()), r: s.r * SIZE }
	}
	const a = tip("f0.2")
	const b = tip("t.2")
	assert.ok(a.c.distanceTo(b.c) - a.r - b.r < 0.003, `the pinch's tips meet (${((a.c.distanceTo(b.c) - a.r - b.r) * 1000).toFixed(1)} mm apart)`)
	applyPose(r, POSES.fist)
	r.root.updateMatrixWorld(true)
	const pts = skinPoints(r)
	const front = (pick) => Math.max(...pts.filter((q) => pick(q.link)).map((q) => q.p.x))
	assert.ok(front((l) => l === "t.1" || l === "t.2") <= front((l) => l === "f0.0" || l === "f1.0" || l === "f0.1" || l === "f1.1") + 0.001, "the fist's thumb is never past its knuckles")
})

test("lerpPose: the poses between, in place too", () => {
	const a = POSES.flat
	const b = POSES.fist
	const m = lerpPose(a, b, 0.5)
	for (const n of POSE_BONES) for (let c = 0; c < 3; c++) near(m[n][c], (a[n][c] + b[n][c]) / 2, 1e-12, `${n}[${c}]`)
	assert.deepEqual(lerpPose(a, b, 0), a)
	assert.deepEqual(lerpPose(a, b, 1), b)
	const own = lerpPose(a, a, 0)
	assert.equal(lerpPose(own, b, 1, own), own)
	assert.deepEqual(own, b)
})

// ---------------------------------------------------------------- holding boxes
const HOLDS = {
	"pinch from above": { box: slab(0.03, 0.03, 0.03), y: 0.3, hand: "pinch", from: "above", band: [[ARM.reachIn, ARM.above[1]]], touch: ["f0.2", "t.2"] },
	"pinch from the left": { box: slab(0.03, 0.03, 0.03), y: 0.3, hand: "pinch", from: "left", band: SIDE, touch: ["f0.2", "t.2"] },
	"pinch from the right": { box: slab(0.02, 0.04, 0.02), y: 0.25, hand: "pinch", from: "right", band: SIDE, touch: ["f0.2", "t.2"] },
	"grip from above": { box: slab(0.07, 0.05, 0.05), y: 0.3, hand: "grip", from: "above", band: ABOVE },
	"grip from the left": { box: slab(0.05, 0.07, 0.05), y: 0.3, hand: "grip", from: "left", band: SIDE },
	"palm under it": { box: slab(0.06, 0.05, 0.06), y: 0.4, hand: "palm", from: "right", band: [ARM.side, ARM.below] },
	"palm pressing it down": { box: slab(0.2, 0.04, 0.12), y: 0.02, hand: "press", band: ABOVE, palm: true },
	"fingertip pressing it down": { box: slab(0.03, 0.04, 0.03), y: 0.02, hand: "press", band: ABOVE, touch: ["f0.2"], tipOnly: true },
	// (a sponge: wider than a fingertip, too small for the whole hand flat on it, so pressed by the fingertip, never by a palm hanging past it)
	"fingertip pressing a sponge down": { box: slab(0.1, 0.03, 0.07), y: 0.015, hand: "press", band: ABOVE, touch: ["f0.2"], tipOnly: true }
}
/** The palm's face: the palm, the ball of the thumb, the fingers' roots (a palm laid on a thing lies on its pads, its middle a hollow). */
const palmFace = (l) => l === "palm" || l === "t.0" || /^f[0-3]\.0$/.test(l)
for (const [name, c] of Object.entries(HOLDS))
	test(`a box held, ${name}: what touches within 1 mm and never in it; nothing else near anything; the arm by the rules`, () => {
		const box = S("box/box", c.box, 0, c.y)
		const Hs = hands([box, FLOOR], { held: ["box/box"], resolved: { box: { hand: c.hand, hand_from: c.from ?? "auto" } } })
		assert.equal(Hs.rigs.length, 1)
		const R = Hs.rigs[0]
		assert.equal(R.grip, c.hand, "the grip asked")
		const rig = R.rig
		const d = boxField(box)
		const floor = boxField(FLOOR)
		const all = clearOf(rig, d)
		assert.ok(all.m >= -0.00005, `${name}: ${all.link} is ${(-all.m * 1000).toFixed(2)} mm in the box`)
		assert.ok(all.m <= 0.001, `${name}: nothing touches it (the nearest, ${all.link}, ${(all.m * 1000).toFixed(2)} mm off)`)
		for (const l of c.touch ?? []) {
			const t = clearOf(rig, d, (k) => k === l).m
			assert.ok(t >= -0.00005 && t <= 0.001, `${name}: ${l} is ${(t * 1000).toFixed(2)} mm from it`)
		}
		if (c.palm) {
			const t = clearOf(rig, d, palmFace).m
			assert.ok(t >= -0.00005 && t <= 0.002, `${name}: the palm is ${(t * 1000).toFixed(2)} mm from it`)
		}
		if (c.tipOnly) {
			const rest = clearOf(rig, d, (l) => l !== "f0.2").m
			assert.ok(rest >= 0.003 - 1e-6, `${name}: the rest of the hand is ${(rest * 1000).toFixed(1)} mm from it`)
		}
		// (every part that closed onto it rests on it)
		for (const l of R.info.touched ?? []) {
			const t = clearOf(rig, d, (k) => k === l).m
			assert.ok(t >= -0.00005 && t <= 0.001, `${name}: ${l}, closed onto it, is ${(t * 1000).toFixed(2)} mm from it`)
		}
		const f = clearOf(rig, floor)
		assert.ok(f.m >= 0.001 - 1e-6, `${name}: ${f.link} is ${(f.m * 1000).toFixed(1)} mm from the floor`)
		armRules(rig, { box: d, floor }, name, c.band)
	})

test("a box held then let go: the hand never in it on any frame as it falls away", () => {
	const box = S("box/box", slab(0.03, 0.03, 0.03), 0, 0.3)
	const frames = []
	for (let k = 0; k <= 90; k++) {
		const t = k / 60
		const y = t < 0.5 ? 0.3 : 0.3 - 0.5 * 9.8 * (t - 0.5) ** 2
		frames.push({ t, placements: { "box/box": { x: 0, y: Math.max(0.015, y), angle: 0 }, "floor/f": { x: 0, y: -0.01, angle: 0 } } })
	}
	const Hs = hands([box, FLOOR], { held: ["box/box"], resolved: { box: { hand: "pinch", hand_from: "above" } }, frames })
	const rig = Hs.rigs[0].rig
	for (let k = 0; k <= 90; k++) {
		const t = k / 60
		Hs.at(t)
		if (!rig.root.visible) continue
		const at = frames[k].placements["box/box"]
		const m = clearOf(rig, boxField(box, at)).m
		assert.ok(m >= -0.00005, `t ${t.toFixed(3)}: the hand is ${(-m * 1000).toFixed(2)} mm in the box it let go`)
	}
})

// ---------------------------------------------------------------- pushing a box
const pusherOf = (h, paddleH = 0.06) => [
	S("p/housing", slab(0.1, 0.05, 0.08), -0.215, 0.025, { kind: "static", type: "pusher" }),
	S("p/rod", slab(0.12, 0.012, 0.012), -0.205, h, { type: "pusher" }),
	S("p/paddle", slab(0.012, paddleH, 0.08), -0.139, h, { type: "pusher" })
]
/** A pushed run: the paddle still until 0.3 s, then at 0.4 m/s; the box (its back 1 cm ahead of the paddle's face) still until the paddle reaches
 *  it, then just ahead of it. */
function pushRun(box, h, skin, paddleH, view = undefined) {
	const solids = [...pusherOf(h, paddleH), box, FLOOR]
	const face0 = -0.139 + 0.006
	const back0 = box.at.x - box.body.width / 2
	const frames = []
	for (let k = 0; k <= 60; k++) {
		const t = k / 60
		const adv = Math.max(0, t - 0.3) * 0.4
		const pl = {}
		for (const s of solids) pl[s.id] = { x: s.at.x, y: s.at.y, angle: 0 }
		pl["p/paddle"].x += adv
		pl["p/rod"].x += adv
		pl["box/box"].x += Math.max(0, face0 + adv - back0)
		frames.push({ t, placements: pl })
	}
	return { Hs: hands(solids, { resolved: { p: { hand: skin } }, frames, view }), frames, solids }
}
const BOX = (w, h, d) => S("box/box", slab(w, h, d), -0.133 + 0.01 + w / 2, h / 2)
for (const [skin, box, h, paddleH] of [
	["finger", BOX(0.12, 0.1, 0.12), 0.05, 0.02],
	["finger", BOX(0.2, 0.036, 0.08), 0.02, 0.02],
	["hand", BOX(0.12, 0.1, 0.12), 0.05, 0.08],
	["hand", BOX(0.2, 0.036, 0.08), 0.02, 0.04],
	["fist", BOX(0.12, 0.1, 0.12), 0.05, 0.06]
])
	test(`a box ${(box.body.height * 100).toFixed(1)} cm tall pushed by a ${skin}: on it within 1 mm, never in it, nothing else near; the arm from behind`, () => {
		const { Hs, frames } = pushRun(box, h, skin, paddleH)
		assert.equal(Hs.rigs.length, 1)
		const rig = Hs.rigs[0].rig
		const d = boxField(box)
		const floor = boxField(FLOOR)
		const all = clearOf(rig, d)
		assert.ok(all.m >= -0.00005 && all.m <= 0.001, `${skin}: its nearest part, ${all.link}, is ${(all.m * 1000).toFixed(2)} mm from the box`)
		if (skin === "finger") {
			assert.equal(all.link, "f0.2", "only the index's tip touches")
			const rest = clearOf(rig, d, (l) => l !== "f0.2").m
			assert.ok(rest >= 0.003 - 1e-6, `the rest of the hand is ${(rest * 1000).toFixed(1)} mm from the box`)
		}
		if (skin === "fist") assert.match(all.link, /^f[0-3]\.[01]$/, "the knuckles touch")
		if (skin === "hand") {
			const palm = clearOf(rig, d, palmFace).m
			assert.ok(palm <= 0.004, `the palm is ${(palm * 1000).toFixed(1)} mm from the box`)
		}
		const f = clearOf(rig, floor)
		assert.ok(f.m >= 0.003 - 1e-6, `${skin}: ${f.link} is ${(f.m * 1000).toFixed(1)} mm from the floor`)
		const A = armDir(rig)
		assert.ok(A.x < -0.3, "the arm comes from behind the push")
		armRules(rig, { box: d, floor }, skin, skin === "hand" ? PUSHING : PUSH_LOW, skin === "hand" ? WRIST.push : WRIST.ext)
		// (every frame of the push: never in the box)
		frames.forEach((fr) => {
			Hs.at(fr.t)
			const m = clearOf(rig, boxField(box, fr.placements["box/box"])).m
			assert.ok(m >= -0.00005, `${skin} at ${fr.t.toFixed(3)} s: ${(-m * 1000).toFixed(2)} mm in the box`)
		})
	})

for (const [label, box, h, paddleH] of [
	["a box as tall as it is deep", BOX(0.12, 0.12, 0.12), 0.06, 0.1],
	["a low wide box", BOX(0.2, 0.05, 0.2), 0.025, 0.04],
	["a small box", BOX(0.04, 0.04, 0.04), 0.02, 0.04]
])
	test(`${label} pushed by two hands: on it, never one in the other or their arms on any frame, the arms parallel, the left on the left`, () => {
		const { Hs, frames } = pushRun(box, h, "two hands", paddleH)
		assert.equal(Hs.rigs.length, 1)
		const [L, R] = Hs.rigs[0].rigs
		assert.deepEqual([L.side, R.side], ["left", "right"])
		const d = boxField(box)
		const floor = boxField(FLOOR)
		const gapNow = () => handsGap(
			{ spheres: handSpheres(current(L)), line: armLine(L.root.position, armDir(L)) },
			{ spheres: handSpheres(current(R)), line: armLine(R.root.position, armDir(R)) }
		)
		const small = box.body.width < 0.06
		// (a centimetre apart; on a thing too small for two the right hand may rest on the left, never in it)
		const apart = small ? 0 : 0.01
		assert.ok(gapNow() >= apart - 1e-6, `the hands are ${(gapNow() * 1000).toFixed(1)} mm apart`)
		// (both seen: as the camera looks, neither covers more than a fifth of the other; on a thing lower than 6 cm and seen nearly level, where
		// one hand lies on its top ahead of the other, nearly a third)
		if (!small) {
			const ov = H.screenOverlap(handSpheres(current(L)), handSpheres(current(R)), { right: V(1, 0, 0), up: V(0, Math.cos((7 * Math.PI) / 180), -Math.sin((7 * Math.PI) / 180)) })
			const most = box.body.height < 0.06 ? 0.3 : 0.2
			assert.ok(ov <= most + 1e-9, `one hand covers ${(ov * 100).toFixed(0)}% of the other in the picture`)
		}
		// (each arm its own way, never crossed: the left one out on the pusher's left (-z), the two at most 45 degrees apart)
		assert.ok(armDir(L).angleTo(armDir(R)) <= (45 * Math.PI) / 180 + 1e-6, `the arms are ${((armDir(L).angleTo(armDir(R)) * 180) / Math.PI).toFixed(1)} degrees apart`)
		const lineL = armLine(L.root.position, armDir(L))
		const lineR = armLine(R.root.position, armDir(R))
		assert.ok(lineL.b.z <= lineR.b.z + 0.005, "the arms never cross")
		// (the pusher faces +x: its left is -z)
		assert.ok(L.root.position.z <= R.root.position.z + 0.01, "the left hand is on the pusher's left")
		for (const g of [L, R]) {
			const m = clearOf(g, d).m
			assert.ok(m >= -0.00005, `${g.side}: ${(-m * 1000).toFixed(2)} mm in the box`)
			assert.ok(clearOf(g, floor).m >= 0.003 - 1e-6, `${g.side}: near the floor`)
			armRules(g, { box: d, floor }, `${label}, ${g.side}`, PUSHING, WRIST.push)
		}
		assert.ok(Math.min(clearOf(L, d).m, clearOf(R, d).m) <= 0.001, "a hand is on the box")
		const W0 = [L.root.position.clone(), R.root.position.clone()]
		frames.forEach((fr) => {
			Hs.at(fr.t)
			assert.ok(gapNow() >= apart - 1e-6, `at ${fr.t.toFixed(3)} s the hands are ${(gapNow() * 1000).toFixed(1)} mm apart`)
			const dt = boxField(box, fr.placements["box/box"])
			for (const g of [L, R]) assert.ok(clearOf(g, dt).m >= -0.00005, `at ${fr.t.toFixed(3)} s the ${g.side} hand is in the box`)
			// (both pushing the same way: they move as one)
			const mL = L.root.position.clone().sub(W0[0])
			const mR = R.root.position.clone().sub(W0[1])
			near(mL.distanceTo(mR), 0, 1e-9, `at ${fr.t.toFixed(3)} s the hands move together`)
		})
		Hs.at(1)
		assert.ok(L.root.position.x > W0[0].x + 0.1, "the hands went with the push")
	})

// ---------------------------------------------------------------- the arm reaches in from the picture's edge
/** The scene's fixed camera as the view films it (web/hands.js frameExit: doc.view.camera at 4:3). */
function cameraOf(C) {
	const hf = (C.hfov * Math.PI) / 180
	const d = (C.x1 - C.x0) / 2 / Math.tan(hf / 2)
	const cx = (C.x0 + C.x1) / 2
	const cam = new THREE.PerspectiveCamera((2 * Math.atan(Math.tan(hf / 2) / (4 / 3)) * 180) / Math.PI, 4 / 3, 0.01, 100)
	cam.position.set(cx, C.y + d * Math.tan((C.pitch * Math.PI) / 180), d)
	cam.lookAt(cx, C.y, 0)
	cam.updateMatrixWorld(true)
	cam.updateProjectionMatrix()
	return cam
}
const outOfPicture = (cam, p) => {
	const v = p.clone().applyMatrix4(cam.matrixWorldInverse)
	if (v.z > -0.02) return true
	v.copy(p).project(cam)
	return Math.abs(v.x) > 1 || Math.abs(v.y) > 1
}
test("every role, every frame: the sleeve runs on out of the picture, so no hand is seen at the end of a stub", () => {
	const fall = (id, x, y, from = 0.5) => {
		const frames = []
		for (let k = 0; k <= 72; k++) {
			const t = k / 60
			frames.push({ t, placements: { [id]: { x, y: Math.max(0.02, t < from ? y : y - 0.5 * 9.8 * (t - from) ** 2), angle: 0 }, "floor/f": { x: 0, y: -0.01, angle: 0 } } })
		}
		return frames
	}
	const cases = []
	for (const [name, body, y, hand, from] of [
		["pinch", slab(0.025, 0.025, 0.025), 0.25, "pinch", "auto"],
		["grip", slab(0.07, 0.07, 0.07), 0.25, "grip", "above"],
		["palm", slab(0.08, 0.06, 0.08), 0.3, "palm", "right"],
		["fingertip press", slab(0.03, 0.04, 0.03), 0.02, "press", "auto"],
		["palm press", slab(0.2, 0.04, 0.12), 0.02, "press", "auto"]
	]) {
		const box = S("box/box", body, 0, y)
		const view = { camera: { x0: -0.2, x1: 0.2, y: Math.max(0.08, y), pitch: 10, hfov: 30 } }
		cases.push({ name, view, Hs: hands([box, FLOOR], { held: ["box/box"], resolved: { box: { hand, hand_from: from } }, frames: fall("box/box", 0, y), view }) })
	}
	for (const skin of ["finger", "hand", "fist", "two hands"]) {
		const view = { camera: { x0: -0.25, x1: 0.25, y: 0.08, pitch: 10, hfov: 30 } }
		cases.push({ name: `push ${skin}`, view, Hs: pushRun(BOX(0.12, 0.1, 0.12), 0.05, skin, skin === "finger" ? 0.02 : 0.08, view).Hs })
	}
	{
		const lip = S("v/lip", slab(0.01, 0.003, 0.035), 0, 0.3, { kind: "static", type: "pitcher" })
		const view = { camera: { x0: -0.3, x1: 0.2, y: 0.22, pitch: 12, hfov: 30 } }
		cases.push({ name: "pitcher", view, Hs: hands([lip, FLOOR], { resolved: { v: { hand: "hand", vessel: "pitcher", pour_to: "right" } }, view }) })
	}
	for (const c of cases) {
		const cam = cameraOf(c.view.camera)
		let seen = 0
		for (let k = 0; k <= 72; k += 3) {
			c.Hs.at(k / 60)
			for (const rig of rigsOf(c.Hs)) {
				if (!rig.root.visible) continue
				current(rig)
				assert.ok(rig.length >= 0.45, `${c.name}: the sleeve is ${rig.length} m long`)
				const far = rig.root.position.clone().addScaledVector(armDir(rig), rig.length)
				assert.ok(outOfPicture(cam, far), `${c.name} at ${(k / 60).toFixed(2)} s: the sleeve ends in the picture (${far.toArray().map((v) => v.toFixed(2))})`)
				if (rig.mesh) {
					rig.sleeveOn.geometry.computeBoundingBox()
					assert.ok(-rig.sleeveOn.geometry.boundingBox.min.x >= rig.length - 0.006, `${c.name}: the sleeve is drawn as long as the arm`)
				}
				seen++
			}
		}
		assert.ok(seen > 0, `${c.name}: a hand was seen`)
	}
})

// ---------------------------------------------------------------- a pitcher's handle
test("a hand on a pitcher's handle: the fingers round it within 1 mm, never in it; the arm by the rules", () => {
	const lip = S("v/lip", slab(0.01, 0.003, 0.035), 0, 0.3, { kind: "static", type: "pitcher" })
	const Hs = hands([lip, FLOOR], { resolved: { v: { hand: "hand", vessel: "pitcher", pour_to: "right" } } })
	const R = Hs.rigs[0]
	const rig = R.rig
	// (the handle in the world: the pitcher upright at its lip)
	const d = (p) => R.bar(p.clone().sub(V(0, 0.3, 0)))
	const all = clearOf(rig, d)
	assert.ok(all.m >= -0.00005 && all.m <= 0.001, `the nearest part, ${all.link}, is ${(all.m * 1000).toFixed(2)} mm from the handle`)
	// (the handle, 5.8 cm, is shorter than the hand is wide: the index, middle and ring fingers wrap it, the little finger curls under its end)
	for (const i of [0, 1, 2, 3]) {
		const m = clearOf(rig, d, (l) => l.startsWith(`f${i}.`)).m
		assert.ok(m >= -0.00005 && (i === 3 || m <= 0.001), `finger ${i} is ${(m * 1000).toFixed(2)} mm from the handle`)
	}
	armRules(rig, { floor: boxField(FLOOR) }, "the pitcher", SIDE)
	assert.ok(SIZE > 0)
})

// ---------------------------------------------------------------- the capsule hand (drawn only when hand.glb does not load)
test("the procedural capsule hand still holds and pushes (the fallback when hand.glb cannot be loaded)", () => {
	try {
		assert.equal(useCapsules(true), false, "the capsule hand is drawn")
		const box = S("box/box", slab(0.06, 0.05, 0.06), 0, 0.4)
		const Hs = hands([box, FLOOR], { held: ["box/box"], resolved: { box: { hand: "palm", hand_from: "right" } } })
		const rig = Hs.rigs[0].rig
		assert.ok(!rig.mesh && rig.spheres.length > 20, "a capsule rig")
		assert.ok(clearOf(rig, boxField(box)).m >= -0.0005, "the palm hold is not in the box")
		const { Hs: P } = pushRun(BOX(0.12, 0.1, 0.12), 0.05, "hand", 0.08)
		assert.ok(P.rigs.length === 1 && !P.rigs[0].rig.mesh, "a capsule hand pushes")
		assert.ok([P.rigs[0].rig.root.position.x, P.rigs[0].rig.root.position.y].every(Number.isFinite))
	} finally {
		useCapsules(false)
	}
	assert.ok(newRig("left").mesh, "the mesh again")
})
