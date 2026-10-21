// The filming module (web/export/shots.js): the executor on synthetic runs (holds at the size asked, follows that keep their subject in every frame,
// pushes that are smooth and land on their end framing, travels that rest at each stop, cuts and glides, one camera for every lane, the safety net
// catching what it must, films that are pure functions of plan and run and survive JSON), the design's twelve worked plans on this repository's
// scenes and the lesson compositor's lanes (web/export/test/scenes; every check of the safety net passing), and the automatic plan on the 12
// built-in scenarios and 10 gallery scenes. Plans are checked against the shot-plan language with the director's own validator (ai/shot-plan.mjs).
//   node --test web/export/test/shots.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import * as X from "../shots.js"
import { checkShotPlanSchema } from "../../../ai/shot-plan.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..")
const FPS = 30
const W = 1920
const H = 1080

// ------------------------------------------------------------------------------------------------ a synthetic run
/** A run made by hand: a 5 s track at 60 Hz of things moving as given ({id: (t) -> {x, y, angle?}}), still things in frames[0] only (as the
 *  engine sends them), and the recognizer's answer given (so these tests do not depend on it). */
function synth({ solids, moves, seconds = 5, impacts = [], events = [], state = {}, recog }) {
	const frames = []
	for (let k = 0; k <= seconds * 60; k++) {
		const t = k / 60
		const placements = {}
		for (const s of solids) {
			if (moves[s.id]) placements[s.id] = { angle: 0, ...moves[s.id](t) }
			else if (k === 0) placements[s.id] = { x: s.at.x, y: s.at.y, angle: s.angle ?? 0 }
		}
		frames.push({ t, placements })
	}
	const doc = { id: "synthetic", seconds, release: { at: 0.5 }, solids, processes: [] }
	const track = { fps: 60, frames, impacts, events, state }
	return { run: { doc, track, summary: { goals: [] } }, recog }
}
const slab = (id, item, x, y, w, h, d = 0.1, kind = "static") => ({ id, item, itemType: item, kind, body: { kind: "slab", width: w, height: h, depth: d }, at: { x, y }, angle: 0 })
const ball = (id, item, x, y, r) => ({ id, item, itemType: "ball", kind: "dynamic", body: { kind: "ball", radius: r }, depth3d: 2 * r, at: { x, y }, angle: 0 })
const recogOf = (primary, moments, extra = {}) => ({ primary, context: [], scenery: [{ item: "table" }], others: [], subjects: primary.map((id) => ({ item: id, rank: "primary", extent: "whole", roles: [] })), moments, lanes: null, pairs: null, variable: [], readables: [], ...extra })
// a ball rolling at 0.5 m/s from x 0 (t 0.5) to x 2 (t 4.5) past a block on a shelf
const roll = () =>
	synth({
		solids: [slab("table/top", "table", 1.3, -0.075, 3.7, 0.15, 1.6), slab("block/block", "block", 1.2, 0.3, 0.1, 0.1), ball("ball/ball", "ball", 0, 0.03, 0.03)],
		moves: { "ball/ball": (t) => ({ x: Math.min(2, Math.max(0, 0.5 * (t - 0.5))), y: 0.03 }) },
		impacts: [{ t: 3.7, a: "ball/ball", b: "block/block", speed: 0.5 }],
		events: [{ t: 4.0, items: ["ball"], kind: "lands", text: "the ball lands" }],
		state: { block: { count: Array.from({ length: 301 }, (_, k) => (k / 60 < 2 ? 0 : 1)) } },
		recog: recogOf(["ball", "block"], [
			{ kind: "setup", t: 0, t_end: 0.5, hold: ["ball", "block"] },
			{ kind: "start", item: "ball", t: 0.52 },
			{ kind: "stop", item: "ball", t: 4.5 },
			{ kind: "result", t: 4.5, hold: ["ball"] },
		]),
	})
const worldOf = (s) => X.makeWorld({ run: s.run, recog: s.recog })
const plan1 = (shots, extra = {}) => ({ version: 1, about: "a test of the executor", story: [{ id: "b", kind: "action", says: "test" }, { id: "s", kind: "setup", says: "test" }], shots: shots.map((s, i) => ({ id: `s${i + 1}`, beat: "b", intent: "a test shot of the executor", audit: { question: "Can a child see it in this test?" }, ...s })), ...extra })
const film = (plan, world) => X.compile(plan, world, { width: W, height: H, fps: FPS })
const P = (a) => ({ L: [a[0], a[1], a[2]], d: a[3], yaw: a[4], pitch: a[5], hfov: a[6] })
/** where a world point shows in a band's picture: x, y in -1..1 */
function project(pose, asp, X3) {
	const c = X.cameraOf(pose)
	const f = [c.target[0] - c.position[0], c.target[1] - c.position[1], c.target[2] - c.position[2]]
	const fl = Math.hypot(...f)
	const fn = f.map((v) => v / fl)
	const rl = Math.hypot(fn[2], fn[0])
	const r = [-fn[2] / rl, 0, fn[0] / rl]
	const up = [r[1] * fn[2] - r[2] * fn[1], r[2] * fn[0] - r[0] * fn[2], r[0] * fn[1] - r[1] * fn[0]]
	const v = [X3[0] - c.position[0], X3[1] - c.position[1], X3[2] - c.position[2]]
	const z = v[0] * fn[0] + v[1] * fn[1] + v[2] * fn[2]
	const t = Math.tan(pose.hfov / 2)
	return { x: (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (z * t), y: ((v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / (z * t)) * asp }
}
const check = (rep, name) => rep.checks.filter((c) => c.check === name)

test("a hold frames its subject at the size asked, still", () => {
	const w = worldOf(roll())
	const f = film(plan1([{ run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" }, frame: { size: 0.5 }, view: "side", lens: 50 }]), w)
	const rep = X.measure(f)
	assert.equal(f.frameCount, 45)
	const z = rep.shots[0].size[0]
	assert.ok(Math.abs(Math.max(z.w, z.h) - 0.5) < 0.004, `the block's larger side ${Math.max(z.w, z.h)} of the picture (0.5 asked)`)
	assert.equal(rep.shots[0].peakPanWps, 0)
	assert.ok(rep.ok, rep.failed.join("; "))
	// and a fit: the subject and what is kept, centred, 10 % (snug) inside the edges
	const g = film(plan1([{ run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { items: ["ball", "block"] }, frame: { fit: "snug" } }]), w)
	const gs = X.measure(g).shots[0].size[0]
	assert.ok(Math.abs(gs.margin - 0.1) < 0.003, `snug margin ${gs.margin}`)
	assert.ok(Math.abs(gs.cx) < 0.003 && Math.abs(gs.cy) < 0.003, `centred (${gs.cx}, ${gs.cy})`)
})

test("a follow keeps its subject in every frame, inside the comfort limits", () => {
	const w = worldOf(roll())
	// (a follow, then the still it comes to rest in: a video ends on a still camera, and a critically damped follow eases into a stop over about 1.5 s)
	const f = film(plan1([{ run: { from: "release", to: "stop:ball" }, move: "follow", subject: { item: "ball" }, frame: { width: 0.6 }, view: "eye", follow: { axis: "x", lead: 0.15 } }, { in: "continue", run: { freeze: "stop:ball", seconds: 2 }, move: "hold", subject: { item: "ball" } }]), w)
	const rep = X.measure(f)
	const asp = W / H
	let worst = 0
	let steady = 0
	for (let i = 0; i < f.shots[0].n; i++) {
		const fr = X.frameAt(f, i / FPS)
		const pose = fr.bands[0].pose
		for (const X3 of w.main.itemPts("ball", null, fr.t)) {
			const q = project(pose, asp, X3)
			worst = Math.max(worst, Math.abs(q.x), Math.abs(q.y))
			if (fr.t > 1.5 && fr.t < 3.5) steady = Math.max(steady, Math.abs(q.x))
		}
		// the horizon is steady on a follow along x
		assert.ok(Math.abs(pose.L[1] - P(f.frames[0].b[0]).L[1]) < 1e-9)
	}
	// (whole in the picture at every frame; near the middle, a little behind it for the room ahead, while it rolls steadily: zero-phase damping
	// has no lag at a steady speed, and eases the camera into a start or a stop about 1/omega early)
	assert.ok(worst < 0.96, `the ball is whole in the picture at every frame (farthest ${worst})`)
	assert.ok(steady < 0.3, `the ball rides near the middle while it rolls steadily (farthest ${steady})`)
	assert.ok(check(rep, "speed")[0].ok, check(rep, "speed")[0].why)
	// (every check but the fill of the still it rests in: a small ball at the follow's width, which is what this test films)
	assert.deepEqual(rep.failed.filter((f) => !/^\S+ fill:/.test(f)), [])
})

test("a push glides on a straight dolly line, slows into its end framing and rests there", () => {
	const w = worldOf(roll())
	const f = film(plan1([{ run: { freeze: "start", seconds: 5, hold_after: 0 }, move: "push", subject: { items: ["ball", "block"] }, frame: { fit: "snug" }, end: { subject: { item: "block" }, frame: { size: 0.3 } }, move_seconds: 4 }]), w)
	const ld = f.frames.map((fr) => Math.log(fr.b[0][3]))
	for (let i = 1; i < ld.length; i++) assert.ok(ld[i] <= ld[i - 1] + 1e-12, "the camera only moves in")
	// smooth: the speed changes gently from frame to frame (smootherstep), from rest to rest
	const v = ld.slice(1).map((x, i) => x - ld[i])
	const peak = Math.max(...v.map(Math.abs))
	for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < 0.12 * peak, `no jerk at frame ${i}`)
	assert.ok(Math.abs(v[0]) < 0.02 * peak && Math.abs(v[v.length - 1]) < 1e-12, "it starts and ends at rest")
	const rep = X.measure(f)
	const end = rep.shots[0].size[0]
	assert.ok(Math.abs(Math.max(end.w, end.h) - 0.3) < 0.005, `it lands on the end framing (${Math.max(end.w, end.h)})`)
	// (every check but the fill of its first, wide framing, which this test asks for)
	assert.deepEqual(rep.failed.filter((f) => !/^\S+ fill:/.test(f)), [])
})

test("a travel goes along its path at a walking pace and rests at each stop", () => {
	const w = worldOf(roll())
	const pts = [[0, 0.1], [0.6, 0.1], [0.6, 0.5]]
	const f = film(plan1([{ run: { freeze: "start", seconds: 4 }, move: "travel", subject: { item: "block" }, travel: { path: { through: pts.map((p) => ({ point: p })) }, dwell: 0.5 }, frame: { width: 0.5 }, view: "eye" }]), w)
	const L = f.frames.map((fr) => fr.b[0].slice(0, 2))
	assert.deepEqual(L[0], pts[0])
	// the camera passes through every stop and rests there for its dwell
	for (const p of pts.slice(1)) {
		const at = L.map((q, i) => [Math.hypot(q[0] - p[0], q[1] - p[1]), i]).filter(([d]) => d < 1e-9)
		assert.ok(at.length >= Math.floor(0.5 * FPS) - 1, `it rests at (${p}) for ${at.length} frames`)
	}
	const rep = X.measure(f)
	assert.ok(check(rep, "speed")[0].ok, check(rep, "speed")[0].why)
})

test("joins: a cut changes the picture at once, continue and ease glide from where the last shot ended", () => {
	const w = worldOf(roll())
	const f = film(plan1([
		{ run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" }, frame: { size: 0.4 } },
		{ in: "cut", run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "ball" }, frame: { width: 0.9 } },
		{ in: { ease: 1.5 }, run: { freeze: "start", seconds: 2 }, move: "hold", subject: { items: ["ball", "block"] }, frame: { fit: "snug" } },
		{ in: "continue", run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" } },
	]), w)
	const step = (i) => {
		const a = P(f.frames[i - 1].b[0])
		const b = P(f.frames[i].b[0])
		return Math.hypot(b.L[0] - a.L[0], b.L[1] - a.L[1], b.L[2] - a.L[2]) / (2 * b.d * Math.tan(b.hfov / 2)) + Math.abs(Math.log(b.d / a.d))
	}
	const [s1, s2, s3, s4] = f.shots
	assert.ok(step(s2.i0) > 0.25, "the cut jumps")
	for (let i = s1.i0 + 1; i < s1.i0 + s1.n; i++) assert.equal(step(i), 0)
	// the glide starts exactly where the cut shot ended and stays under the jump limit
	for (let i = s3.i0; i < s3.i0 + s3.n; i++) assert.ok(step(i) * FPS < X.NET.jumpWps, `glide frame ${i}: ${step(i) * FPS}`)
	assert.ok(step(s3.i0) < 0.01, "the glide's first frame is one frame on from where the cut shot ended")
	assert.deepEqual(f.frames[s3.i0 + s3.n - 1].b[0], f.frames[s3.i0 + s3.n - 2].b[0], "after the glide: the shot's own still framing")
	// continue with no framing of its own: exactly where the glide ended
	assert.deepEqual(f.frames[s4.i0].b[0], f.frames[s4.i0 - 1].b[0])
	const rep = X.measure(f)
	assert.ok(check(rep, "cut").every((c) => c.ok), check(rep, "cut").map((c) => c.why).join("; "))
})

test("lanes: one camera for every band, shifted by its lane's offset; each band leaves the other lanes out", () => {
	const s = synth({
		solids: [slab("table/top", "table", 1.3, -0.075, 3.7, 0.15, 1.6), slab("p1/p", "p1", 0.5, 0.01, 0.4, 0.02), slab("p2/p", "p2", 0.5, 0.51, 0.4, 0.02), ball("b1/b", "b1", 0.4, 0.05, 0.03), ball("b2/b", "b2", 0.4, 0.55, 0.03)],
		moves: { "b1/b": (t) => ({ x: 0.4 + 0.1 * Math.max(0, t - 0.5), y: 0.05 }), "b2/b": (t) => ({ x: 0.4 + 0.05 * Math.max(0, t - 0.5), y: 0.55 }) },
		recog: recogOf(["b1", "b2", "p1", "p2"], [{ kind: "result", t: 5, hold: ["b1", "b2"] }]),
	})
	const w = X.makeWorld({ run: s.run, recog: s.recog })
	const lanes = { arrange: "rows", list: [{ id: "one", label: "fast", cast: { ball: "b1", plate: "p1" } }, { id: "two", label: "slow", cast: { ball: "b2", plate: "p2" } }] }
	const f = film(plan1([{ layout: "split", run: { from: "release", to: "end" }, move: "hold", subject: { role: "ball" }, keep: [{ role: "plate" }], frame: { fit: "snug" }, annotate: [{ kind: "label", on: { role: "ball" }, text: "{label}" }] }], { lanes }), w)
	const sh = f.shots[0]
	assert.deepEqual(sh.bands.map((b) => b.rect), [[0, 0, W, H / 2], [0, H / 2, W, H / 2]])
	for (const fr of f.frames) {
		const [a, b] = fr.b
		assert.ok(Math.abs(b[1] - a[1] - 0.5) < 1e-12 && Math.abs(b[0] - a[0]) < 1e-12, "band two is band one shifted by the lane offset (0, 0.5)")
		assert.deepEqual(a.slice(3), b.slice(3), "one scale for both lanes")
	}
	assert.deepEqual(sh.hide, [["b2", "p2"], ["b1", "p1"]])
	const rep = X.measure(f)
	assert.ok(rep.ok, rep.failed.join("; "))
	assert.ok(rep.shots[0].parity <= 1.01, `one scale (parity ${rep.shots[0].parity})`)
	// the marks: each band its own lane's label over its own ball
	const m = f.marks[0]
	assert.deepEqual(m.map((prims) => prims.map((q) => q.text)), [["fast"], ["slow"]])
})

test("an arc turns round its subject; an inset is its own still picture in a corner; together frames every lane in one picture", () => {
	const w = worldOf(roll())
	const f = film(plan1([{ run: { freeze: "start", seconds: 6 }, move: "arc", subject: { item: "block" }, frame: { size: 0.4 }, view: { yaw: -20, pitch: 10 }, end: { view: { yaw: 20, pitch: 10 } }, inset: { subject: { item: "ball" }, corner: "bottom-left", size: 0.25 } }]), w)
	const yaw = f.frames.map((fr) => (fr.b[0][4] * 180) / Math.PI)
	assert.ok(Math.abs(yaw[0] + 20) < 1e-9 && Math.abs(yaw[yaw.length - 1] - 20) < 0.05, `the arc turns from -20 to 20 degrees (${yaw[0]} .. ${yaw[yaw.length - 1]})`)
	for (let i = 1; i < yaw.length; i++) assert.ok(yaw[i] >= yaw[i - 1] - 1e-12)
	const sh = f.shots[0]
	assert.equal(sh.bands.length, 2)
	assert.ok(sh.bands[1].inset)
	const [x, y, iw, ih] = sh.bands[1].rect
	assert.ok(x > 0 && x < W / 4 && y + ih < H && y > H / 2 && Math.abs(ih - 0.25 * H) <= 1, `bottom-left, a quarter of the height (${sh.bands[1].rect})`)
	assert.deepEqual(f.frames[0].b[1], f.frames[f.frameCount - 1].b[1], "the inset's camera is still")
	const rep = X.measure(f)
	assert.ok(check(rep, "turn-rate")[0].ok, check(rep, "turn-rate")[0].why)
	// together: one picture of every lane's copies
	const s2 = synth({
		solids: [slab("table/top", "table", 1.3, -0.075, 3.7, 0.15, 1.6), ball("b1/b", "b1", 0.4, 0.05, 0.03), ball("b2/b", "b2", 0.9, 0.05, 0.03)],
		moves: {},
		recog: recogOf(["b1", "b2"], []),
	})
	const w2 = X.makeWorld({ run: s2.run, recog: s2.recog })
	const lanes = { list: [{ id: "one", cast: { ball: "b1" } }, { id: "two", cast: { ball: "b2" } }] }
	const g = film(plan1([{ layout: "together", run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { role: "ball" }, frame: { fit: "snug" } }], { lanes }), w2)
	assert.equal(g.shots[0].bands.length, 1)
	const z = X.measure(g).shots[0].size[0]
	assert.ok(Math.abs(z.margin - 0.1) < 0.005, `both balls in one snug picture (${z.margin})`)
})

test("per_lane: each band follows its own lane's copy at one distance", () => {
	const s = synth({
		solids: [slab("table/top", "table", 1.3, -0.075, 3.7, 0.15, 1.6), ball("b1/b", "b1", 0.2, 0.05, 0.03), ball("b2/b", "b2", 0.2, 0.55, 0.03)],
		moves: { "b1/b": (t) => ({ x: 0.2 + 0.3 * Math.max(0, t - 0.5), y: 0.05 }), "b2/b": (t) => ({ x: 0.2 + 0.15 * Math.max(0, t - 0.5), y: 0.55 }) },
		recog: recogOf(["b1", "b2"], []),
	})
	const w = X.makeWorld({ run: s.run, recog: s.recog })
	const lanes = { list: [{ id: "one", cast: { ball: "b1" } }, { id: "two", cast: { ball: "b2" } }] }
	const f = film(plan1([{ layout: "split", run: { from: "release", to: "t=4" }, move: "follow", subject: { role: "ball" }, frame: { width: 0.5 }, follow: { per_lane: true, lead: 0 } }], { lanes }), w)
	const last = f.frames[f.frameCount - 1]
	assert.equal(last.b[0][3], last.b[1][3], "one distance in both bands")
	// at 4 s the balls are 0.525 m apart in x (0.3 against 0.15 m/s for 3.5 s): each band centred on its own
	assert.ok(Math.abs(last.b[0][0] - last.b[1][0] - 0.525) < 0.03, `${last.b[0][0]} vs ${last.b[1][0]}`)
	const rep = X.measure(f)
	assert.ok(check(rep, "keep-in").every((c) => c.ok), check(rep, "keep-in").map((c) => c.why).join("; "))
})

test("a film is a pure function of plan, run and picture: the same bytes again, in another process too", () => {
	const plan = plan1([
		{ run: { freeze: "start", seconds: 1 }, move: "hold", subject: { item: "block" }, frame: { size: 0.4 } },
		{ in: "cut", run: { from: "release", to: "stop:ball", rate: 0.5 }, label: "Slow motion: 2 times slower", move: "follow", subject: { item: "ball" }, frame: { width: 0.5 } },
		{ in: { ease: 0.8 }, run: { freeze: "stop:ball", seconds: 2 }, move: "pull", subject: { item: "ball" }, end: { subject: { items: ["ball", "block"] }, frame: { fit: "snug" } } },
	])
	const s = roll()
	const a = JSON.stringify(film(plan, X.makeWorld({ run: s.run, recog: s.recog })))
	const b = JSON.stringify(film(plan, X.makeWorld({ run: roll().run, recog: roll().recog })))
	assert.equal(a, b)
	const hash = createHash("sha256").update(a).digest("hex")
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import * as X from ${JSON.stringify(new URL("../shots.js", import.meta.url).href)}
		import { createHash } from "node:crypto"
		const { synthRoll, plan } = JSON.parse(process.env.FIXTURE)
		const frames = []
		for (let k = 0; k <= 300; k++) {
			const t = k / 60
			const placements = { "ball/ball": { x: Math.min(2, Math.max(0, 0.5 * (t - 0.5))), y: 0.03, angle: 0 } }
			if (k === 0) for (const s of synthRoll.solids) if (s.kind === "static") placements[s.id] = { x: s.at.x, y: s.at.y, angle: 0 }
			frames.push({ t, placements })
		}
		const run = { doc: { id: "synthetic", seconds: 5, release: { at: 0.5 }, solids: synthRoll.solids, processes: [] }, track: { fps: 60, frames, impacts: synthRoll.impacts, events: synthRoll.events, state: synthRoll.state }, summary: { goals: [] } }
		const f = X.compile(plan, X.makeWorld({ run, recog: synthRoll.recog }), { width: ${W}, height: ${H}, fps: ${FPS} })
		process.stdout.write(createHash("sha256").update(JSON.stringify(f)).digest("hex"))
	`], { env: { ...process.env, FIXTURE: JSON.stringify({ synthRoll: { solids: s.run.doc.solids, impacts: s.run.track.impacts, events: s.run.track.events, state: s.run.track.state, recog: s.recog }, plan }) }, encoding: "utf8" })
	assert.equal(child.status, 0, child.stderr)
	assert.equal(child.stdout, hash, "the same film in a fresh process")
})

test("a film survives JSON (filmFromJSON), and frameAt never blends across a cut", () => {
	const w = worldOf(roll())
	const f = film(plan1([
		{ run: { freeze: "start", seconds: 1 }, move: "hold", subject: { item: "block" }, frame: { size: 0.4 } },
		{ in: "cut", run: { from: "release", to: "t=2" }, move: "follow", subject: { item: "ball" }, frame: { width: 0.6 } },
	]), w)
	const g = X.filmFromJSON(JSON.parse(JSON.stringify(f)))
	for (const tau of [0, 0.37, 1.0, 1.21, 2.5]) assert.deepEqual(X.frameAt(g, tau), X.frameAt(f, tau))
	const s2 = f.shots[1]
	const before = X.frameAt(f, s2.tau0 - 0.25 / FPS)
	assert.deepEqual(before.bands[0].pose, P(f.frames[s2.i0 - 1].b[0]), "half a frame before the cut: the first shot's last pose, never a blend")
	assert.equal(X.frameAt(f, s2.tau0).shot, 1)
	assert.throws(() => X.filmFromJSON({ version: 1, shots: [], frames: [{}], frameCount: 1, fps: 30 }), /film/)
})

test("video time and run time: slow motion, freezes, the impacts' sounds", () => {
	const w = worldOf(roll())
	const f = film(plan1([
		{ run: { freeze: "start", seconds: 1 }, move: "hold", subject: { item: "block" } },
		{ in: "cut", run: { from: "t=3", to: "t=4", rate: 0.5 }, label: "Slow motion: 2 times slower", move: "hold", subject: { item: "ball" } },
	]), w)
	assert.ok(Math.abs(f.duration - 3) < 1e-9)
	assert.ok(Math.abs(X.runTimeAt(f, 0.5) - 0) < 1e-12, "a freeze holds its moment")
	assert.ok(Math.abs(X.runTimeAt(f, 2) - 3.5) < 1e-9, "1 s into a half-speed stretch from 3 s: 3.5 s")
	assert.deepEqual(X.videoTimesOf(f, 3.7).map((v) => Math.round(v * 1e9) / 1e9), [2.4])
	assert.deepEqual(X.videoTimesOf(f, 0.2), [], "a frozen moment makes no sound")
	const r = X.retime(f, w.main.track.impacts)
	assert.equal(r.length, 1)
	assert.ok(Math.abs(r[0].t - 2.4) < 1e-9 && r[0].rate === 0.5 && r[0].runT === 3.7)
})

test("resolution: what the run does not have is named, with the nearest ids", () => {
	const w = worldOf(roll())
	const r = X.resolvePlan(plan1([
		{ run: { freeze: "start", seconds: 1 }, move: "hold", subject: { item: "blok" } },
		{ run: { from: "contact:ball+blok", to: "end" }, move: "hold", subject: { item: "ball" } },
		{ run: { freeze: "start", seconds: 1 }, move: "hold", subject: { beam: "laser", bounce: 1 } },
		{ run: { freeze: "start", seconds: 1 }, move: "travel", subject: { item: "ball" } },
	]), w)
	assert.equal(r.ok, false)
	const at = (k) => r.errors.find((e) => e.at.startsWith(k))
	assert.match(at("shots[0] (s1).subject").message, /blok is not in the scene/)
	assert.ok(at("shots[0] (s1).subject").nearest.includes("block"))
	assert.match(at("shots[1] (s2).run.from").message, /contact:ball\+blok is not in the run/)
	assert.ok(at("shots[1] (s2).run.from").nearest.includes("contact:ball+block"))
	assert.match(at("shots[2] (s3).subject").message, /laser is not a light source/)
	assert.match(at("shots[3] (s4).travel").message, /travel needs travel.path/)
	// a window past the run's end films as asked (the run held at its end) and says so
	const ok = X.resolvePlan(plan1([{ run: { from: "t=4", to: { at: "end", plus: 0.5 } }, move: "hold", subject: { item: "ball" } }]), w)
	assert.ok(ok.ok && ok.warnings.length === 1, JSON.stringify(ok))
})

test("the safety net catches what it must", () => {
	const w = worldOf(roll())
	const fails = (shots, check) => {
		const rep = X.measure(film(plan1(shots), w))
		return rep.checks.filter((c) => c.check === check && !c.ok)
	}
	// a push from the whole to a close-up in half a second: too fast a zoom
	assert.equal(fails([{ run: { freeze: "start", seconds: 2 }, move: "push", subject: { items: ["ball", "block"] }, end: { subject: { item: "ball" }, frame: { size: 0.6 } }, move_seconds: 0.5 }], "zoom-rate").length, 1)
	// the ball 0.06 m across a 5 m window: too small
	assert.equal(fails([{ run: { freeze: "start", seconds: 2 }, move: "hold", subject: { item: "ball" }, frame: { width: 5 } }], "subject-size").length, 1)
	// a cut to almost the same picture: a jump cut
	assert.equal(fails([{ run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" }, frame: { size: 0.4 } }, { in: "cut", run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" }, frame: { size: 0.36 } }], "cut").length, 1)
	// slow motion with no badge
	assert.equal(fails([{ run: { from: "t=1", to: "t=2", rate: 0.5 }, move: "hold", subject: { item: "block" } }], "label").length, 1)
	// a still too short to read
	assert.equal(fails([{ run: { freeze: "start", seconds: 0.5 }, move: "hold", subject: { item: "block" } }], "hold-length").length, 1)
	// a follow so tight the background races past
	assert.equal(fails([{ run: { from: "release", to: "stop:ball" }, move: "follow", subject: { item: "ball" }, frame: { width: 0.2 } }], "speed").length, 1)
	// a kept thing that leaves the picture: a continue that keeps the last framing while the ball rolls away
	assert.equal(fails([{ run: { freeze: "release", seconds: 1 }, move: "hold", subject: { items: ["ball", "block"] }, frame: { fit: "snug" } }, { in: "continue", run: { from: "release", to: "stop:ball" }, move: "hold", subject: { item: "block" }, keep: [{ item: "ball" }] }], "keep-in").length, 1)
})

test("the safety net sees an empty picture, a subject gone from it and the same still twice; small_because lowers a detail's floor", () => {
	const w = worldOf(roll())
	const rep = (shots) => X.measure(film(plan1(shots), w))
	const one = (r, name) => r.checks.filter((c) => c.check === name)
	// the ball and the block 1.2 m apart in one picture: most of it backdrop, the two far apart in it
	const apart = rep([{ run: { freeze: "start", seconds: 2 }, move: "hold", subject: { items: ["ball", "block"] }, frame: { fit: "snug" } }])
	assert.equal(one(apart, "fill")[0].ok, false)
	assert.match(one(apart, "fill")[0].why, /of the picture is backdrop \(at most 0\.82\); what the shot names covers 0\.\d+ of the box round it/)
	assert.ok(apart.shots[0].fill[0].backdrop > 0.82 && apart.shots[0].fill[0].cover < 0.6)
	// the same two with the gap between them named (the distance is the point): the box round them is what the shot is about
	assert.equal(one(rep([{ run: { freeze: "start", seconds: 2 }, move: "hold", subject: { items: ["ball", "block"] }, context: [{ gap: ["ball", "block"] }], frame: { fit: "snug" } }]), "fill")[0].ok, true)
	// one thing close: its own box spans the picture
	assert.equal(one(rep([{ run: { freeze: "start", seconds: 2 }, move: "hold", subject: { item: "block" }, frame: { size: 0.6 } }]), "fill")[0].ok, true)
	// a reveal of a whole after its parts is not asked to fill
	const reveal = X.measure(film(plan1([{ beat: "r", run: { freeze: "start", seconds: 2 }, move: "hold", subject: { items: ["ball", "block"] }, frame: { fit: "snug" } }], { story: [{ id: "r", kind: "reveal", says: "test" }] }), w))
	assert.equal(one(reveal, "fill").length, 0)
	// a hold framed where the ball was let go, while it rolls away: the picture is empty of it for seconds
	const gone = rep([{ run: { from: "release", to: "stop:ball" }, move: "hold", subject: { item: "ball", when: "release" }, frame: { size: 0.3 } }])
	assert.equal(one(gone, "present")[0].ok, false)
	assert.match(one(gone, "present")[0].why, /leaves the picture and is gone for [\d.]+ s/)
	// ... and a shot that waits for the ball to come into a picture of where it is going, briefly: fine; for long: not
	const waitShort = rep([{ run: { from: { at: "stop:ball", plus: -1 }, to: "stop:ball" }, move: "hold", subject: { item: "ball", when: "stop:ball" }, frame: { size: 0.3 } }])
	assert.equal(one(waitShort, "present")[0].ok, true, one(waitShort, "present")[0].why)
	const waitLong = rep([{ run: { from: { at: "stop:ball", plus: -3 }, to: "stop:ball" }, move: "hold", subject: { item: "ball", when: "stop:ball" }, frame: { size: 0.3 } }])
	assert.match(one(waitLong, "present")[0].why, /the picture waits [\d.]+ s for the subject/)
	// the very same still picture twice in a row; a mark that appears in the second makes it a new beat
	const still = { run: { freeze: "start", seconds: 1.5 }, move: "hold", subject: { item: "block" }, frame: { size: 0.5 } }
	assert.equal(one(rep([still, { ...still, in: "cut" }]), "repeat").length, 1)
	assert.equal(one(rep([still, { ...still, in: "cut", annotate: [{ kind: "label", on: { item: "block" }, text: "block" }] }]), "repeat").length, 0)
	// a small detail: under its floor, unless small_because (with min_size) says the smallness is the point
	const wide = { run: { freeze: "start", seconds: 2 }, move: "hold", subject: { items: ["ball", "block"] }, context: [{ gap: ["ball", "block"] }], frame: { width: 2.4 }, view: "eye" }
	const plain = rep([{ ...wide, audit: { question: "Can a child see the ball and the block?", details: [{ item: "ball" }] } }])
	assert.equal(one(plain, "must-see")[0].ok, false)
	assert.match(one(plain, "must-see")[0].why, /\{"item":"ball"\} \(a detail\) s 0\.\d+ \(floor 0\.045\)/)
	const small = rep([{ ...wide, audit: { question: "Can a child see the ball and the block?", details: [{ item: "ball" }], min_size: 0.03, small_because: "the ball is small next to the block: that is the point" } }])
	assert.ok(plain.shots[0].must[0].s >= 0.03 && plain.shots[0].must[0].s < 0.045, `the ball as a detail: s ${plain.shots[0].must[0].s}`)
	assert.equal(one(small, "must-see")[0].ok, true, one(small, "must-see")[0].why)
})

test("specOf: a square-on pose is the scene's fixed-camera spec (camera.py projects it exactly)", () => {
	const pose = { L: [1.2, 0.3, 0], d: 2.5, yaw: 0, pitch: 0.12, hfov: 0.8 }
	const s = X.specOf(pose)
	// machines/mod_staging.py fixed camera: d = (x1 - x0) / 2 / tan(hfov / 2) in front of the plane, at y + d tan(pitch), looking at ((x0 + x1) / 2, y, 0)
	const hf = (s.hfov * Math.PI) / 180
	const d = (s.x1 - s.x0) / 2 / Math.tan(hf / 2)
	const cam = X.cameraOf(pose)
	const pos = [(s.x0 + s.x1) / 2, s.y + d * Math.tan((s.pitch * Math.PI) / 180), d]
	for (let i = 0; i < 3; i++) assert.ok(Math.abs(pos[i] - cam.position[i]) < 1e-12, `${pos} vs ${cam.position}`)
	assert.equal(X.specOf({ ...pose, yaw: 0.3 }), null)
})

// ------------------------------------------------------------------------------------------------ the design's twelve plans, on real runs
const index = JSON.parse(readFileSync(join(HERE, "plans", "index.json"), "utf8")).plans
const sceneFile = (p) => join(ROOT, p)

test("the design's twelve worked plans: valid, resolved, every check of the safety net passing", async () => {
	const { simulate, catalog, plugins } = await import("./sim-node.mjs")
	const { registryOf } = await import("../subjects.js")
	const cat = catalog()
	const reg = registryOf(plugins())
	let done = 0
	for (const [name, runs] of Object.entries(index)) {
		const files = Object.fromEntries(Object.entries(runs).map(([lane, p]) => [lane, sceneFile(p)]))
		assert.ok(Object.values(files).every((f) => existsSync(f)), `${name}: its scenes ${Object.values(files).join(", ")}`)
		const plan = JSON.parse(readFileSync(join(HERE, "plans", `${name}.json`), "utf8"))
		assert.deepEqual(checkShotPlanSchema(plan), [], `${name}: valid against shot-plan.schema.json`)
		let world
		if (files[""]) {
			const scene = JSON.parse(readFileSync(files[""], "utf8"))
			world = X.makeWorld({ run: simulate(scene), scene, catalog: cat, registry: reg })
		} else world = X.makeWorld({ runs: Object.fromEntries(Object.entries(files).map(([lane, f]) => [lane, { sim: simulate(JSON.parse(readFileSync(f, "utf8"))), scene: JSON.parse(readFileSync(f, "utf8")) }])), catalog: cat, registry: reg })
		const r = X.checkPlan(plan, world, { width: W, height: H, fps: FPS })
		assert.ok(r.ok, `${name}: ${r.messages.join("; ")}`)
		// each shot as long as its plan says, to the frame
		const S = r.film.shots
		plan.shots.forEach((sh, i) => {
			const want = sh.run.freeze !== undefined ? (sh.run.seconds ?? S[i].T - (sh.run.hold_after ?? 0)) + (sh.run.hold_after ?? 0) : (S[i].t1 - S[i].t0) / (sh.run.rate ?? 1) + (sh.run.hold_after ?? 0)
			assert.ok(Math.abs(S[i].T - Math.max(1, Math.round(want * FPS)) / FPS) < 1e-9, `${name} ${sh.id}: ${S[i].T} s (${want} s asked)`)
		})
		done++
	}
	assert.equal(done, 12)
})

// ------------------------------------------------------------------------------------------------ the automatic plan (camera "focus")
test("the automatic plan on the 12 scenarios and 10 gallery scenes: valid, video time is run time, every motion and comfort check passing", async () => {
	const { simulate, catalog, plugins } = await import("./sim-node.mjs")
	const { registryOf } = await import("../subjects.js")
	const cat = catalog()
	const reg = registryOf(plugins())
	const files = [...JSON.parse(readFileSync(join(ROOT, "web", "scenario-list.json"), "utf8")).map((s) => join(ROOT, "web", "scenarios", `${s.id}.json`)), ...JSON.parse(readFileSync(join(ROOT, "web", "gallery", "index.json"), "utf8")).map((g) => join(ROOT, "web", g.scene))]
	assert.equal(files.length, 22)
	const MOTION = ["keep-in", "speed", "zoom-rate", "turn-rate", "no-jump", "cut", "still", "settled", "shot-length", "hold-length", "label"]
	let allPass = 0
	for (const f of files) {
		const scene = JSON.parse(readFileSync(f, "utf8"))
		const world = X.makeWorld({ run: simulate(scene), scene, catalog: cat, registry: reg })
		const plan = X.autoPlan(world, { width: W, height: H, fps: FPS })
		assert.deepEqual(checkShotPlanSchema(plan), [], `${f}: the automatic plan is valid`)
		const r = X.checkPlan(plan, world, { width: W, height: H, fps: FPS, kind: "focus" })
		assert.ok(r.film, `${f}: ${r.messages.join("; ")}`)
		const dur = world.main.dur
		for (let i = 0; i < r.film.frameCount; i++) assert.ok(Math.abs(X.frameAt(r.film, i / FPS).t - Math.min(dur, i / FPS)) < 1e-9, `${f}: frame ${i} shows run time ${i / FPS}`)
		const bad = r.report.checks.filter((c) => !c.ok && MOTION.includes(c.check))
		assert.deepEqual(bad, [], `${f}: ${bad.map((c) => `${c.shot} ${c.check}: ${c.why}`).join("; ")}`)
		// a hero below its floor is said in the plan's notes (framing-infeasible: a smaller thing or a shorter stretch is the scene's to change)
		for (const c of r.report.checks.filter((c) => !c.ok && c.check === "subject-size")) assert.match(plan.notes, /framing-infeasible|faster than a calm/, `${f}: ${c.shot}`)
		if (r.report.ok) allPass++
	}
	assert.ok(allPass >= 10, `${allPass} of 22 automatic plans pass every check, sizes too`)
})
