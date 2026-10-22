// The direct step's machinery (ai/steps.mjs runs it as the step "direct"): a shot plan for one video, written by the director model from the
// lesson or request and the run's timeline digest (web/export/digest.js), checked by the shot-plan validator (ai/shot-plan.mjs), then measured
// by the plan's executor (web/export/shots.js checkPlan: resolution, the compiler and the safety net, on the drawn models' boxes when the caller
// sends them). A plan that fails goes back to the director with the failed checks and what to do about them as a repair turn, at most
// REPAIR_TURNS times. A plan whose last failures are only of size and fill (soft: the picture is smaller or emptier than the net asks) is still
// the director's video, said in the warnings; one that still breaks a hard check (something cut off, too fast, a jump, a shot too short) is
// replaced by an automatic plan (the executor's autoPlan or safePlan here), which tells no story. Design: the scratchpad's director/DIRECTOR.md
// sections 2, 3, 5, 7 and 9.1; the language: web/export/shot-plan.schema.json.
//
//   directSource(payload, {clean}) -> the payload checked (400s) and normalised: {kind, text, lesson, concept, scenes: [{lane, scene}], lanes, hints, boxes, aspect, max_seconds,
//     look, one_frame, camera}
//   holdToSource(plan, src) -> the plan held to what the caller fixed: the lesson's one look on every shot, its lock (one frame through the pause,
//     its camera when given)
//   directUserTurn(src, digest) -> the user turn (the source, the video's wishes, the digest's text)
//   repairTurn(report, round) -> the repair turn for a measured failure
//   loadExecutor(o) / executorFrom(Shots) -> the executor: {measure(plan, ctx) -> report, safePlan, world, momentsOf} (o.executor: one in its place)
//   safePlan(digest, src) -> the automatic plan
//   runDirector({...}) -> {result, model, servedModel, ms, usage, attempts, warnings, repaired}
import { AIError, callModel, loadRouting, routeFor } from "./core.mjs"
import { SHOT_PLAN_SCHEMA, validateShotPlan } from "./shot-plan.mjs"
import { digestText } from "../web/export/digest.js"
import * as Shots from "../web/export/shots.js"
import { recognize as recognizeSubjects } from "../web/export/subjects.js"

export const REPAIR_TURNS = 3 // measured failures sent back to the director before its plan is judged as it stands
const REPAIR_MIN_MS = 45000 // a repair turn only starts with at least this much of the step's budget left
const ASPECTS = ["16:9", "4:3", "3:2", "1:1", "3:1"]
const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const MAX_TEXT = 8000
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const bad = (msg) => new AIError("bad_input", msg)

// ------------------------------------------------------------------------------------------------ the payload
function str(p, field, max, { required = false } = {}) {
	const v = p?.[field]
	if (v === undefined || v === null) {
		if (required) throw bad(`${field} is missing`)
		return ""
	}
	if (typeof v !== "string") throw bad(`${field} must be text`)
	if (v.length > max) throw bad(`${field} is too long (${v.length} characters; at most ${max})`)
	return v.trim()
}
/**
 * The direct step's payload, checked and normalised (scenes through clean(), web/sim's own checks). Fields:
 *   text      the request typed in the sandbox, or what the video should show (optional when lesson.question is given)
 *   lesson    {question, answer, words: [..], pauses: [{where: "setup"|"result", t?}], grade: 3..8}
 *   concept   what the lesson teaches, in a few words ("angle in equals angle out")
 *   kind      "lesson" | "request" | "demo" (default: lesson with a lesson, else request)
 *   scene     the scene (one run), or runs: {lane: scene} for a comparison filmed one run per lane (2 to 4 lanes)
 *   lanes     a plan's lanes block the caller already knows ({arrange, list: [{id, label, cast}]}): the director must keep it
 *   hints     {roles, brief, cues, subjects} (the physics-lesson-video skill's binding; web/export/subjects.js reads them)
 *   aspect    "16:9" (default) | "4:3" | "3:2" | "1:1" | "3:1";  max_seconds 2..60
 *   look      the lesson's one look ({backdrop, tone, ground, light, depth, vignette, labels}: the plan language's look): every shot of the plan
 *             takes it, whatever the director writes, so every screen of a lesson filmed with the same one looks alike (the five-lesson benchmark:
 *             one screen's table turned to wood, the next's set dark)
 *   one_frame "pause" (or true) | "end": one frame from the video's first frame through the lesson's last pause (or the whole video, a card that
 *             is a still picture): the plan's lock, which the engine pins and measures (no reframe between a screen's setup and its pause)
 *   camera    the lock's camera, [Lx, Ly, Lz, d, yaw, pitch, hfov] (a film frame's band pose, the screen before's result.lock.camera): screens of
 *             one lesson filmed from one camera (implies one_frame "pause" unless one_frame says otherwise)
 *   return_digest  true: the answer carries the digest's text too
 */
export async function directSource(p, { clean }) {
	const text = str(p, "text", MAX_TEXT)
	const concept = str(p, "concept", 300)
	let lesson = null
	if (p.lesson !== undefined && p.lesson !== null) {
		if (!isObj(p.lesson)) throw bad("lesson must be an object {question, answer, words, pauses, grade}")
		const L = p.lesson
		const words = L.words === undefined ? [] : L.words
		if (!Array.isArray(words) || words.length > 12 || words.some((w) => typeof w !== "string" || w.length > 300)) throw bad("lesson.words must be a list of at most 12 texts of at most 300 characters")
		const pauses = L.pauses === undefined ? [] : L.pauses
		if (!Array.isArray(pauses) || pauses.length > 4 || pauses.some((x) => !isObj(x) || !["setup", "result"].includes(x.where) || (x.t !== undefined && typeof x.t !== "number"))) throw bad('lesson.pauses must be a list of {where: "setup"|"result", t?}')
		if (L.grade !== undefined && !(Number.isInteger(L.grade) && L.grade >= 3 && L.grade <= 8)) throw bad("lesson.grade must be a whole number from 3 to 8")
		lesson = { question: str(L, "question", 300), answer: str(L, "answer", 300), words: words.map((w) => w.trim()).filter(Boolean), pauses, grade: L.grade ?? null }
	}
	if (!text && !lesson?.question && !concept) throw bad("text is missing (or give lesson.question): say what the video should show")
	const kind = p.kind === undefined ? (lesson ? "lesson" : "request") : p.kind
	if (!["lesson", "request", "demo"].includes(kind)) throw bad('kind must be "lesson", "request" or "demo"')
	if (p.scene !== undefined && p.runs !== undefined) throw bad("give scene (one run) or runs (one scene per lane), not both")
	const scenes = []
	if (p.runs !== undefined) {
		if (!isObj(p.runs)) throw bad("runs must be an object {lane: scene}")
		const lanes = Object.keys(p.runs)
		if (lanes.length < 2 || lanes.length > 4) throw bad("runs needs 2 to 4 lanes")
		for (const lane of lanes) {
			if (!LANE_RE.test(lane)) throw bad(`runs: "${lane.slice(0, 40)}" is not a lane id (letters, digits, _ and -)`)
			scenes.push({ lane, scene: await clean(p.runs[lane], `runs.${lane}`) })
		}
	} else scenes.push({ lane: "", scene: await clean(p.scene, "scene") })
	let lanes = null
	if (p.lanes !== undefined && p.lanes !== null) {
		if (!isObj(p.lanes) || !Array.isArray(p.lanes.list) || p.lanes.list.length < 2 || p.lanes.list.length > 4) throw bad("lanes must be {arrange?, list: [2 to 4 lanes {id, label?, cast: {role: id}}]}")
		for (const [i, l] of p.lanes.list.entries()) if (!isObj(l) || typeof l.id !== "string" || !LANE_RE.test(l.id) || !isObj(l.cast)) throw bad(`lanes.list[${i}] must be {id, label?, cast: {role: item id or [ids]}}`)
		lanes = JSON.parse(JSON.stringify(p.lanes))
	}
	let hints = {}
	if (p.hints !== undefined && p.hints !== null) {
		if (!isObj(p.hints)) throw bad("hints must be an object {roles, brief, cues, subjects}")
		const keep = ["roles", "brief", "cues", "subjects"]
		hints = Object.fromEntries(Object.entries(p.hints).filter(([k]) => keep.includes(k)))
		if (JSON.stringify(hints).length > 20000) throw bad("hints is too large (at most 20000 characters as JSON)")
	}
	const aspect = p.aspect === undefined ? "16:9" : p.aspect
	if (!ASPECTS.includes(aspect)) throw bad(`aspect must be one of ${ASPECTS.join(", ")}`)
	const max = p.max_seconds === undefined ? null : p.max_seconds
	if (max !== null && !(typeof max === "number" && max >= 2 && max <= 60)) throw bad("max_seconds must be a number of seconds from 2 to 60")
	const boxes = boxesOf(p.boxes, scenes.map((s) => s.lane))
	const look = lookOf(p.look)
	const camera = cameraOf(p.camera)
	const oneFrame = p.one_frame === undefined || p.one_frame === null || p.one_frame === false ? (camera ? "pause" : null) : p.one_frame === true ? "pause" : p.one_frame
	if (oneFrame !== null && !["pause", "end"].includes(oneFrame)) throw bad('one_frame must be "pause" (or true), "end" or false')
	return { kind, text, lesson, concept, scenes, lanes, hints, boxes, aspect, max_seconds: max, return_digest: p.return_digest === true, look, one_frame: oneFrame, camera }
}

const LOOK_DEF = SHOT_PLAN_SCHEMA.$defs.look
/** The caller's look: an object of the plan language's look (web/export/shot-plan.schema.json $defs.look), or null. */
function lookOf(v) {
	if (v === undefined || v === null) return null
	if (!isObj(v)) throw bad("look must be an object {backdrop, tone, ground, light, depth, vignette, labels}")
	const out = {}
	for (const [k, x] of Object.entries(v)) {
		const def = LOOK_DEF.properties[k]
		if (!def) throw bad(`look.${String(k).slice(0, 40)} is not a look field (${Object.keys(LOOK_DEF.properties).join(", ")})`)
		if (def.enum ? !def.enum.includes(x) : !(typeof x === "number" && Number.isFinite(x) && x >= (def.minimum ?? -Infinity) && x <= (def.maximum ?? Infinity))) throw bad(`look.${k} must be ${def.enum ? def.enum.join(", ") : `a number from ${def.minimum} to ${def.maximum}`}`)
		out[k] = x
	}
	return out
}
/** The caller's camera: a film frame's pose [Lx, Ly, Lz, d, yaw, pitch, hfov] (or {L: [x, y, z], d, yaw, pitch, hfov}), or null. */
function cameraOf(v) {
	if (v === undefined || v === null) return null
	const a = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.L) ? [...v.L, v.d, v.yaw, v.pitch, v.hfov] : null
	const ok = Array.isArray(a) && a.length === 7 && a.every((x) => typeof x === "number" && Number.isFinite(x)) && a[3] > 0 && a[6] > 0 && a[6] < Math.PI && Math.abs(a[5]) < Math.PI / 2
	if (!ok) throw bad("camera must be a camera pose [Lx, Ly, Lz, d, yaw, pitch, hfov] (metres and radians: the screen before's result.lock.camera)")
	return a.slice()
}

/**
 * A plan held to what the caller fixed (a copy): the lesson's one look on the plan and none of the shots' own (src.look), and its lock, one
 * frame through the lesson's last pause or the whole video, from the caller's camera when given (src.one_frame, src.camera); the plan's source
 * says the caller's kind. Applied to every plan the director writes and to the automatic ones, before the engine measures them.
 */
export function holdToSource(plan, src) {
	if (!isObj(plan) || !Array.isArray(plan.shots)) return plan
	const out = JSON.parse(JSON.stringify(plan))
	if (src?.look) {
		out.look = { ...src.look }
		for (const sh of out.shots) if (isObj(sh) && sh.look !== undefined) delete sh.look
	}
	if (src?.one_frame) out.lock = { until: src.one_frame, ...(src.camera ? { camera: src.camera.slice() } : {}) }
	if (src?.kind && (src.look || src.one_frame)) out.source = { ...(isObj(out.source) ? out.source : {}), kind: src.kind }
	return out
}

const BOX_KEYS = ["x0", "x1", "y0", "y1", "z0", "z1", "round"]
/**
 * The drawn models' boxes the caller's page measured (web/view3d.js exportBoxes(): {solid id: {x0, x1, y0, y1, z0, z1} | {round, z0, z1} |
 * {world: [x0, x1, y0, y1, z0, z1]}}), so the engine measures the plan on the shapes the video will show rather than physics outlines (a
 * sail, a fan's guard, a liquid are larger): one object for one run, or {lane: {...}} for one run per lane. -> {lane: boxes} or null
 */
function boxesOf(v, lanes) {
	if (v === undefined || v === null) return null
	if (!isObj(v)) throw bad("boxes must be an object {solid id: box} (one run) or {lane: {solid id: box}} (one run per lane)")
	if (JSON.stringify(v).length > 400000) throw bad("boxes is too large (at most 400000 characters as JSON)")
	const okBox = (b) => isObj(b) && (Array.isArray(b.world) ? b.world.length === 6 && b.world.every(Number.isFinite) : Object.entries(b).every(([k, x]) => BOX_KEYS.includes(k) && Number.isFinite(x)))
	const perLane = lanes.length > 1 || lanes[0] !== ""
	const sets = perLane ? v : { "": v }
	const out = {}
	for (const [lane, set] of Object.entries(sets)) {
		if (!lanes.includes(lane)) throw bad(`boxes.${lane}: no such lane (the lanes are ${lanes.join(", ")})`)
		if (!isObj(set)) throw bad(`boxes${lane ? `.${lane}` : ""} must be an object {solid id: box}`)
		for (const [id, b] of Object.entries(set)) if (!okBox(b)) throw bad(`boxes${lane ? `.${lane}` : ""}["${String(id).slice(0, 40)}"] must be {x0, x1, y0, y1, z0, z1}, {round, z0, z1} or {world: [6 numbers]}`)
		out[lane] = set
	}
	return out
}

/** The recognizer's hints for a source: the lesson's words and pauses, the skill's roles, brief and cues, the other lanes of a comparison. */
export function recognizerHints(src, lane = "") {
	const text = [src.lesson?.question, ...(src.lesson?.words ?? []), src.text, src.concept].filter((t) => typeof t === "string" && t)
	const h = { ...src.hints, ...(text.length ? { text } : {}), ...(src.lesson?.pauses?.length ? { pauses: src.lesson.pauses } : {}) }
	if (lane) h.pairs = src.scenes.filter((s) => s.lane !== lane).map((s) => ({ scene: s.scene }))
	return h
}

// ------------------------------------------------------------------------------------------------ the turns
const quote = (s) => `"${String(s).replace(/\s+/g, " ").trim()}"`
/** The user turn: the source (lesson or request), the video's wishes, the lanes the caller fixed, the skill's hints, then the digest. */
export function directUserTurn(src, digest) {
	const L = ["# The source"]
	L.push(`Kind: ${src.kind}.${src.lesson?.grade ? ` Grade ${src.lesson.grade}.` : ""}`)
	if (src.lesson?.question) L.push(`The question at this video's pause: ${quote(src.lesson.question)}`)
	if (src.lesson?.answer) L.push(`The answer the evidence must let a child reach (never shown; it decides what must be on screen at the pause): ${quote(src.lesson.answer)}`)
	if (src.lesson?.words?.length) L.push(`Words on screen: ${src.lesson.words.map(quote).join(" / ")}`)
	if (src.lesson?.pauses?.length) L.push(`The lesson pauses ${src.lesson.pauses.map((x) => (x.where === "setup" ? "at the setup (before anything happens)" : `at the result${typeof x.t === "number" ? ` (run ${x.t} s)` : ""}`)).join(", then ")}.`)
	if (src.concept) L.push(`The concept: ${quote(src.concept)}`)
	if (src.text) L.push(`${src.kind === "request" ? "The request" : "What the video should show"}:\n"""\n${src.text}\n"""`)
	const own = src.scenes.map((s) => s.scene).filter(Boolean)
	const names = [...new Set(own.map((s) => s.name).filter((n) => typeof n === "string" && n.trim()))]
	const goals = own.flatMap((s) => (Array.isArray(s.goals) ? s.goals : [])).map((g) => g?.label).filter((x) => typeof x === "string" && x.trim())
	if (names.length || goals.length) L.push(`The scene's own words: ${names.length ? `its name ${names.map(quote).join(", ")}` : ""}${names.length && goals.length ? "; " : ""}${goals.length ? `its goals ${[...new Set(goals)].map(quote).join(", ")}` : ""}.`)
	L.push("", "# The video")
	L.push(`Aspect ${src.aspect}${src.max_seconds ? `; at most ${src.max_seconds} s of video` : "; 8 to 20 s is usual for one idea"}.`)
	if (digest.lanes) L.push(`A comparison filmed one run per lane: ${digest.lanes.map((l) => `${l.id} = ${l.run}`).join(", ")}. Your lanes.list must have exactly these lane ids.`)
	if (src.lanes) L.push(`The caller's lanes (keep them as they are in your plan's lanes): ${JSON.stringify(src.lanes)}`)
	const h = src.hints ?? {}
	if (h.brief) L.push(`The lesson video's brief (its chain steps, roles, the comparison's variable, its goals): ${JSON.stringify(h.brief).slice(0, 4000)}`)
	if (h.roles) L.push(`Roles the brief binds to items: ${JSON.stringify(h.roles).slice(0, 2000)}`)
	if (Array.isArray(h.cues) && h.cues.length) L.push(`Caption cues (cue:<step> moments): ${JSON.stringify(h.cues).slice(0, 2000)}`)
	if (h.subjects) L.push(`What the caller says the video is about: ${JSON.stringify(h.subjects).slice(0, 1000)}`)
	if (src.one_frame || src.look) L.push("", "# The lesson's frame and look")
	if (src.one_frame) {
		L.push(
			src.one_frame === "end"
				? "ONE FRAME FOR THE WHOLE VIDEO (the lesson's card is a still picture): the engine films every shot from one camera (the plan's lock). Plan one framing that shows everything the screen needs, a still camera; no move, no follow, no cut to another picture. One held picture is one shot (two shots of the same moment in the same frame are the same still twice)."
				: "ONE FRAME FROM THE SETUP THROUGH THE PAUSE (a one-change screen of a lesson): the engine films every shot from the video's first frame through the lesson's last pause from one camera (the plan's lock), so nothing reframes between the setup and the pause (a reframe reads as a second change). Plan that one frame so the setup reads in it (what changed, the hand, the thing before it moves) and the pause's evidence reads in it; the run plays inside it; no push, pull, follow or cut before the pause. One held picture is one shot."
		)
		if (src.camera) {
			const [lx, ly, lz, d, yaw, pitch, hfov] = src.camera
			const width = 2 * d * Math.tan(hfov / 2)
			L.push(`The lesson's camera, the screen before's (the engine films the locked shots from it, whatever their framing says): it looks at (${lx.toFixed(3)}, ${ly.toFixed(3)}, ${lz.toFixed(3)}) m from ${d.toFixed(3)} m, ${(width).toFixed(3)} m across the picture there, yaw ${((yaw * 180) / Math.PI).toFixed(1)}°, pitch ${((pitch * 180) / Math.PI).toFixed(1)}°, a ${(18 / Math.tan(hfov / 2)).toFixed(0)} mm lens. Frame your locked shots the same (subject and keep what that frame holds) and judge the sizes in it.`)
		}
	}
	if (src.look) L.push(`The lesson's one look, the same on every screen of the lesson (the engine gives it to every shot; write no look of your own): ${JSON.stringify(src.look)}.`)
	L.push("", "# The timeline digest", digestText(digest), "", "Write the shot plan as one JSON object.")
	return L.join("\n")
}

/** The failed checks of a report, one sentence each ("roll speed: the picture's fastest point 0.639 widths/s (limit 0.5 for a pull)"). */
export function failedChecks(report) {
	const checks = Array.isArray(report?.checks) ? report.checks : Array.isArray(report) ? report : []
	const out = checks.filter((c) => c && c.ok === false).map((c) => `${c.shot ? `${c.shot} ` : ""}${c.check ?? "check"}: ${c.why ?? "failed"}`)
	if (Array.isArray(report?.failures)) out.push(...report.failures.map((f) => (typeof f === "string" ? f : `${f.shot ?? ""} ${f.check ?? ""}: ${f.why ?? ""}`.trim())))
	return [...new Set(out)]
}
const shotRow = (s) => {
	const bits = [`${s.id} (${s.move}${s.layout && s.layout !== "single" ? `, ${s.layout}` : ""})`]
	if (Array.isArray(s.video)) bits.push(`video ${s.video[0]}-${s.video[1]} s`)
	if (Array.isArray(s.heroes) && s.heroes.length) bits.push(`heroes ${s.heroes.map((h) => `${h.what}${h.lane ? "@" + h.lane : ""} s ${h.s}`).join("; ")}`)
	else if (Array.isArray(s.size) && s.size.length) bits.push(`size ${s.size.map((z) => z.s).join("/")}`)
	if (s.minKeep !== undefined && s.minKeep !== null) bits.push(`closest margin ${s.minKeep}`)
	if (s.peakPanWps !== undefined) bits.push(`fastest point ${s.peakPanWps} widths/s, zoom ${s.peakZoomPerS}/s, turn ${s.peakYawDegS} deg/s`)
	return `- ${bits.join("; ")}`
}
/** What to do about each kind of failed check: the ways a director can repair it without giving up the story. */
const REMEDY = {
	"subject-size": "a hero under its floor: frame closer (size, fit tight, a smaller width) or a longer lens; things that stand far apart get their own bands (layout split at one scale, or a director's comparison of two lanes: one thing per lane) or one shot each; when the smallness is the point (a whole after its parts), audit.small_because with min_size",
	"must-see": "a must-see thing or detail under its floor: frame closer or a longer lens; split far-apart things into bands, or show them one at a time; small_because with min_size (at least 0.03) lowers the floor for details too, when the smallness is the point",
	fill: "most of the picture is backdrop: frame closer, give far-apart things their own bands or one shot each, or name what belongs in the room around them (a gap between two things, the light a laser sends, the ramp a car rolls on) in context",
	present: "the subject is out of the picture too long: follow it, end the shot (its run's to) as it leaves, start later, or frame where it goes",
	"lanes-present": "a lane's own mover leaves its band (or never comes in) while the shot plays: every band shows its lane's copy of what the shot is about. Ride the pair (subject and keep the role: the camera rides their middle and widens only enough to hold both), follow.per_lane (each band rides its own at one width), cut ahead to where both arrive and wait, or end the shot as one leaves",
	"cut-scale": "a cut out to a much wider picture leaves the movers small: ride with them at a scale near the last picture's (a follow), widen in two steps, or glide (in: {ease: at least 1})",
	"stop-fill": "a band of the lesson's stop is mostly backdrop: frame closer on what the stop's question names, pan each band to its own lane's copy at one scale (align on that role), or look a little higher so the floor and the tank fill the band",
	"path-fill": "the path the shot is about is small in its picture: frame the path itself, tight (fit tight on the trail, or a width just over its reach), the mover kept whole",
	repeat: "the same still picture twice: make the two shots one (a mark can appear or change inside a shot: from, to), or change the picture (another subject, scale or place; layout single for one lane's thing)",
	"keep-in": "something kept is cut off: a wider frame or more room on that side, keep fewer things, or follow",
	speed: "the camera moves too fast: a longer move_seconds, a slower rate, a slower travel pace, or a cut instead of the move. A follow too fast for a size that keeps the mover big: cut ahead to where it is going and let it cross a still picture at its own scale (wait for it), rather than widening the follow until it is a speck",
	"zoom-rate": "the zoom is too fast: a longer move_seconds, a smaller change of scale, or a cut (over 2.5x is a cut)",
	"turn-rate": "the camera turns too fast: a longer move_seconds or a smaller turn",
	"no-jump": "the picture jumps at a join: a cut (in: cut) or a longer ease",
	cut: "a jump cut (almost the same picture): change the scale 1.6x, the place a quarter of the picture or the angle 20 deg, or glide (in: continue / ease) instead",
	still: "a hold that moves: in: cut, or let the move end (move_seconds) before the hold",
	settled: "a pause or the last shot still moving at its end: hold_after, or a shorter move_seconds",
	"shot-length": "a shot under 0.8 s: a longer run window, seconds or hold_after",
	"hold-length": "a still under 0.8 s: more seconds or hold_after",
	label: "a rate other than 1 needs its label",
	parity: "the lanes at different scales: one camera for every band (no per_lane), align on the role",
	face: "an instrument's face too small to read: frame closer on it (split columns side by side, align on it) or an inset",
	"beam-visible": "the light too thin to see: a narrower window (under the width the digest gives for its core)",
	"one-frame": "the camera moves, or the layout changes, between the setup and the pause: under the lesson's lock every shot through the pause is one frame. Make them holds of one framing (one held picture is one shot), the same layout; a move only after the last pause",
	"one-look": "the look changes between shots: one look for the whole video (write the look once, on the plan, and none on the shots)",
	"small-size": "a small thing (a grape, a marble, a clip: under 6.5 cm) at the lesson's stop is under 0.12 of the picture: frame the small thing itself, close (view macro, a 90 mm lens, frame.size 0.15 to 0.3 on it), the container cropped (a tank or a glass is context: keep only the part of it the question needs, the water line round a floater); small_because when its smallness is the point",
	resolve: "a name the run does not have: use the digest's ids (the nearest are given)",
	compile: "the engine could not film it: change the shot the message names"
}
/** The repair turn for a plan that failed the measured net: the failed checks, what the failing shots measured, and what to do. */
export function repairTurn(report, round, max = REPAIR_TURNS) {
	const failed = failedChecks(report)
	const bad = (report?.checks ?? []).filter((c) => c && c.ok === false)
	const failing = new Set(bad.map((c) => c.shot))
	const rows = (Array.isArray(report?.shots) ? report.shots : []).filter((s) => failing.has(s.id)).map(shotRow)
	const kinds = [...new Set(bad.map((c) => c.check))].filter((k) => REMEDY[k])
	return [
		`The engine compiled your plan and measured every frame. ${failed.length} check${failed.length === 1 ? "" : "s"} failed (repair ${round} of at most ${max}):`,
		...failed.slice(0, 40).map((f) => `- ${f}`),
		...(rows.length ? ["", "What those shots measured (sizes: the share of the picture, sqrt of width x height, at the shot's key moment):", ...rows] : []),
		...(kinds.length ? ["", "Ways to repair them:", ...kinds.map((k) => `- ${k}: ${REMEDY[k]}`)] : []),
		"",
		"Change the plan so that every check passes. Keep the story and every shot that passed; change only what the numbers name. Return the complete corrected plan as one JSON object (the whole plan, not just the changed shots)."
	].join("\n")
}

// ------------------------------------------------------------------------------------------------ the executor
/** The plan's executor: web/export/shots.js (o.executor: one in its place, for tests). */
export function loadExecutor(o = {}) {
	return o.executor ?? executorFrom(Shots)
}
/** The executor's input for the step's runs (web/export/shots.js makeWorld): one run, or one per lane, with their scenes, hints, recognition and
 *  the page's model boxes when the caller sent them. */
export function worldInput(ctx) {
	const lanes = Object.keys(ctx.runs ?? {})
	const one = (r) => ({ run: r.run, scene: r.scene, ...(r.hints ? { hints: r.hints } : {}), ...(r.recog ? { recog: r.recog } : {}), ...(r.boxes ? { boxes: r.boxes } : {}) })
	if (lanes.length === 1 && lanes[0] === "") return { ...one(ctx.runs[""]), catalog: ctx.catalog, registry: ctx.registry }
	return { runs: Object.fromEntries(lanes.map((l) => { const { run, ...rest } = one(ctx.runs[l]); return [l, { sim: run, ...rest }] })), catalog: ctx.catalog, registry: ctx.registry }
}
/** A report from web/export/shots.js checkPlan's answer ({ok, errors, report, messages}): its resolution errors as failed checks. */
function fromCheck(r) {
	if (r?.report) return { ...r.report, ok: !!r.ok && r.report.ok !== false }
	const errs = Array.isArray(r?.errors) ? r.errors : []
	return { ok: !!r?.ok, checks: errs.map((e) => ({ shot: null, check: "resolve", ok: false, why: `${e.at ?? "plan"}: ${e.message ?? e}${e.nearest?.length ? ` (nearest: ${e.nearest.join(", ")})` : ""}` })), shots: [] }
}
/**
 * The executor over web/export/shots.js (makeWorld, checkPlan, autoPlan): the step builds the run's world once, reads its moments (so the
 * digest's ids are the ones it resolves), and checks each plan with checkPlan (resolution, compile, the safety net); its autoPlan is one of the
 * automatic plans.
 */
export function executorFrom(m) {
	const worldOf = (ctx) => (ctx.world ??= m.makeWorld(worldInput(ctx)))
	const opts = (ctx) => ({ width: ctx.W ?? 1920, height: ctx.H ?? 1080, fps: ctx.fps ?? 30 })
	return {
		name: "web/export/shots.js",
		world: (input) => m.makeWorld(input),
		momentsOf: (w, lane) => {
			const R = w?.runs?.get?.(lane)
			return R?.M ? { index: Object.fromEntries(R.M), what: R.WHAT ? Object.fromEntries(R.WHAT) : {} } : null
		},
		measure: (plan, ctx) => fromCheck(m.checkPlan(plan, worldOf(ctx), opts(ctx))),
		safePlan: (digest, src, ctx) => m.autoPlan(worldOf(ctx), opts(ctx))
	}
}
/** A report in the one shape the loop reads: {ok, checks, shots, duration}; a thrown measure is a report with one failed check. */
async function measured(executor, plan, ctx) {
	let r
	try {
		r = await executor.measure(plan, ctx)
	} catch (e) {
		return { ok: false, checks: [{ shot: null, check: "compile", ok: false, why: `the engine could not film this plan: ${String(e?.message ?? e).slice(0, 300)}` }], shots: [], error: true }
	}
	if (Array.isArray(r)) r = { checks: r }
	if (!isObj(r)) return { ok: false, checks: [{ shot: null, check: "compile", ok: false, why: "the engine's measure gave no report" }], shots: [] }
	const checks = Array.isArray(r.checks) ? r.checks : []
	const ok = typeof r.ok === "boolean" ? r.ok && !checks.some((c) => c?.ok === false) : !checks.some((c) => c?.ok === false) && !(r.failures?.length > 0)
	return { ...r, ok, checks, shots: Array.isArray(r.shots) ? r.shots : [] }
}

// ------------------------------------------------------------------------------------------------ the automatic plan
const VIEW = { yaw: 0, pitch: 4 } // square on, a little above: lengths and heights read true
const ASPECT = { "16:9": 16 / 9, "4:3": 4 / 3, "3:2": 3 / 2, "1:1": 1, "3:1": 3 }
/** The picture a plan is measured on: 1080 high at the video's aspect (16:9 when none), so a 3:2 lesson's split bands are measured at 3:1, as
 *  the caller films them (sizes and margins are shares of each band; a 16:9 picture's bands would be 32:9). */
export function pictureOf(aspect) {
	const a = ASPECT[aspect] ?? 16 / 9
	return { W: Math.round(1080 * a), H: 1080 }
}
const SNUG = 0.1 // the snug fit's margin on each side
const r3 = (v) => Math.round(v * 1000) / 1000
const unite = (bs) => {
	const v = bs.filter(Boolean)
	return v.length ? [Math.min(...v.map((b) => b[0])), Math.max(...v.map((b) => b[1])), Math.min(...v.map((b) => b[2])), Math.max(...v.map((b) => b[3]))] : null
}
/** The share of the picture (sqrt of width x height, and of its height) a w x h thing fills in a snug framing of the box U (the compiler's fit). */
function sizeIn(U, w, h, asp) {
	const Uw = Math.max(1e-3, U[1] - U[0]), Uh = Math.max(1e-3, U[3] - U[2])
	const Wpic = Math.max(Uw, Uh * asp) / (1 - 2 * SNUG)
	const Hpic = Wpic / asp
	return { s: Math.sqrt((w / Wpic) * (h / Hpic)), h: h / Hpic, w: w / Wpic }
}
/**
 * The automatic plan, built from the digest without a director (DIRECTOR.md 7.4): the setup, then the run in stretches cut where something
 * starts, strikes or happens, each a still snug hold on what is moving then, then the result; square on, split at one scale for a comparison
 * filmed one run per lane, joined by cuts (two stretches that would frame almost the same picture are one). Things too small to read in a
 * stretch's picture stay in it whole (keep) without being its subject. Always valid against the schema and the digest; it tells no story.
 */
export function safePlan(digest, src = {}) {
	const runs = Object.values(digest.runs)
	const lanesIds = Object.keys(digest.runs).filter((k) => k)
	const perLane = lanesIds.length > 0
	const r0 = runs[0]
	const asp = (ASPECT[src.aspect] ?? 16 / 9) * (perLane ? lanesIds.length : 1) // (split rows: each band is n times as wide as it is tall)
	const inAll = (id) => runs.every((r) => !!r.items[id])
	const castOf = (id) => runs.map((r) => r.cast.find((c) => c.id === id)).filter(Boolean)
	const small = (c) => c.size[0] < 4 && c.size[1] < 4
	let heroes = [...new Set(runs.flatMap((r) => r.cast.filter((c) => c.rank === "primary" && small(c)).map((c) => c.id)))].filter(inAll)
	if (!heroes.length) heroes = [...new Set(runs.flatMap((r) => r.cast.filter((c) => c.rank !== "scenery" && small(c)).map((c) => c.id)))].filter(inAll).slice(0, 6)
	if (!heroes.length) heroes = Object.keys(r0.items).filter((id) => inAll(id) && r0.items[id].cast).slice(0, 4)
	const dur = Math.min(...runs.map((r) => r.seconds))
	const movers = heroes.filter((id) => castOf(id).some((c) => c.start !== null || c.scale))
	const release = Math.min(...runs.map((r) => r.release))
	const result = Math.min(dur, Math.max(...runs.map((r) => r.index.result ?? r.seconds)))
	// a thing's box at run time t, and over a stretch [a, b] (every run's, as one camera frames all the bands)
	const boxAt = (id, t) =>
		unite(
			runs.map((r) => {
				const P = r.paths?.[id]
				if (!P?.length) return r.cast.find((c) => c.id === id)?.box0 ?? null
				let best = P[0]
				for (const q of P) if (Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q
				return best.slice(1)
			})
		)
	const boxDuring = (id, a, b) => unite([boxAt(id, a), boxAt(id, b), ...runs.flatMap((r) => (r.paths?.[id] ?? []).filter((q) => q[0] >= a && q[0] <= b).map((q) => q.slice(1)))])
	const movesDuring = (id, a, b) => {
		const A = boxAt(id, a), B = boxAt(id, b)
		const span = boxDuring(id, a, b)
		return !!(A && B && span && (Math.abs(A[0] - B[0]) + Math.abs(A[2] - B[2]) > 0.01 || span[1] - span[0] > (A[1] - A[0]) + 0.01 || span[3] - span[2] > (A[3] - A[2]) + 0.01))
	}
	// a thing's own size (its largest at the start in any run: a mover's box over a stretch is its path, not its size)
	const ownSize = (id) => {
		const cs = castOf(id)
		return cs.length ? [Math.max(...cs.map((c) => c.size[0])), Math.max(...cs.map((c) => c.size[1]))] : null
	}
	/** A hold's subject and keep: the things that reach their floor in a snug picture of all of them are the subject, the rest stay whole in it. */
	const split = (ids, boxOf, floor) => {
		const U = unite(ids.map(boxOf))
		if (!U) return { subject: ids, keep: [], U: null }
		const big = ids.filter((id) => {
			const b = ownSize(id)
			if (!b) return false
			const z = sizeIn(U, b[0], b[1], asp)
			const flat = z.h < 0.3 * z.w || z.w < 0.3 * z.h
			return z.s >= floor * 1.12 && (floor < 0.09 || flat || z.h >= 0.11)
		})
		const area = (id) => {
			const z = ownSize(id)
			return z ? z[0] * z[1] : 0
		}
		const subject = big.length ? big : [ids.reduce((a, b) => (area(b) > area(a) ? b : a))]
		return { subject, keep: ids.filter((id) => !subject.includes(id)), U }
	}
	const similar = (U, V) => {
		if (!U || !V) return false
		const su = Math.max(U[1] - U[0], (U[3] - U[2]) * asp), sv = Math.max(V[1] - V[0], (V[3] - V[2]) * asp)
		const shift = Math.hypot((U[0] + U[1] - V[0] - V[1]) / 2, ((U[2] + U[3] - V[2] - V[3]) / 2) * asp) / Math.max(su, sv)
		// (a cut needs a clear change: the net calls one under 1.6x and a quarter of the picture a jump cut, and these boxes are estimates)
		return Math.max(su, sv) / Math.max(1e-3, Math.min(su, sv)) < 2 && shift < 0.35
	}
	const names = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(", ")} and the rest` : ids.join(", "))
	const lanes = perLane ? { arrange: "rows", list: lanesIds.map((lane) => ({ id: lane, label: lane, run: digest.runs[lane].key, cast: Object.fromEntries(heroes.map((id) => [id, id])) })) } : null
	const common = { move: "hold", frame: { fit: "snug" }, view: { ...VIEW }, lens: 50, ...(lanes ? { layout: "split" } : {}) }
	const tl = r0.time_lapse > 1 ? `Time-lapse: ${r0.time_lapse}x` : null
	const story = []
	const shots = []
	const beat = (id, kind, says) => {
		if (!story.some((b) => b.id === id)) story.push({ id, kind, says })
		return id
	}
	const hold = (id, b, run, sk, question, extra = {}) =>
		shots.push({ id, beat: b, intent: `The automatic camera: ${question.replace(/^Can a child see /, "").replace(/\?$/, "")}, in one still snug picture, square on.`.slice(0, 240), run, ...common, subject: { items: sk.subject }, ...(sk.keep.length ? { keep: [{ items: sk.keep }] } : {}), audit: { question: question.slice(0, 200), key: "end" }, ...extra })

	// the setup
	const setupSk = split(heroes, (id) => boxAt(id, 0), 0.045)
	hold("setup", beat("setup", "setup", "What is there before anything happens."), { freeze: "start", seconds: movers.length ? 2 : 2.5 }, setupSk, `Can a child see ${names(setupSk.subject)} before anything happens?`)
	let last = setupSk.U
	if (movers.length) {
		// the run, in stretches cut where something starts, strikes or happens
		const T0 = release >= 0.2 ? release - 0.2 : 0
		const T1 = Math.min(dur, result + 0.5)
		const span = T1 - T0
		const rate = span < 1 ? (span < 0.15 ? 0.05 : span < 0.3 ? 0.1 : span < 0.6 ? 0.25 : 0.5) : 1
		const minLen = 1.2 * rate, maxLen = 3.5 * rate
		const marks = new Set()
		for (const r of runs) {
			for (const c of r.cast) if (heroes.includes(c.id) && c.start !== null) marks.add(c.start)
			for (const c of r.contacts) if (heroes.includes(c.a) && heroes.includes(c.b) && c.speed >= 0.12) marks.add(c.t)
			for (const e of r.events) if (heroes.includes(e.item)) marks.add(e.t)
		}
		const cuts = [T0, ...[...marks].filter((t) => t > T0 + minLen && t < T1 - minLen).sort((a, b) => a - b), T1]
		let slices = []
		for (let i = 0; i + 1 < cuts.length; i++) {
			const a = slices.length ? slices.at(-1)[1] : cuts[i]
			const b = cuts[i + 1]
			if (b - a < minLen && i + 2 < cuts.length) continue // (too short: it joins the next)
			const pieces = Math.max(1, Math.ceil((b - a) / maxLen))
			for (let k = 0; k < pieces; k++) slices.push([a + ((b - a) * k) / pieces, a + ((b - a) * (k + 1)) / pieces])
		}
		if (slices.length > 1 && slices.at(-1)[1] - slices.at(-1)[0] < minLen) slices = [...slices.slice(0, -2), [slices.at(-2)[0], slices.at(-1)[1]]]
		// what moves in each, framed on where it is then; stretches that frame almost the same picture are one
		const planned = []
		for (const [a, b] of slices) {
			let act = movers.filter((id) => movesDuring(id, a, b))
			if (!act.length) act = movers
			const sk = split(act, (id) => boxDuring(id, a, b), 0.09)
			const prev = planned.at(-1)
			if (prev && similar(prev.sk.U, sk.U)) {
				const ids = [...new Set([...prev.ids, ...act])]
				prev.b = b
				prev.ids = ids
				prev.sk = split(ids, (id) => boxDuring(id, prev.a, b), 0.09)
			} else planned.push({ a, b, ids: act, sk })
		}
		if (planned.length && similar(last, planned[0].sk.U)) planned[0].join = true
		for (const [i, x] of planned.entries()) {
			const run = { from: `t=${r3(Math.max(0, x.a))}`, to: `t=${r3(Math.min(dur, x.b))}`, ...(rate !== 1 ? { rate } : {}) }
			hold(`run${planned.length > 1 ? i + 1 : ""}`, beat("action", "action", "What happens."), run, x.sk, `Can a child see ${names(x.sk.subject)} move?`, {
				...(x.join ? { in: { ease: 2.5 } } : {}), // (a slow glide out of a picture much like the last: at most about 0.3 widths a second)
				...(rate !== 1 ? { label: `Slow motion: ${Math.round(1 / rate)} times slower` } : tl ? { label: tl } : {})
			})
			last = x.sk.U
		}
		// the result: closer when it sits in a much smaller part of the last picture, else the last stretch holds still
		const holdR = [...new Set(runs.flatMap((r) => r.found?.holds?.result ?? []))].filter((id) => inAll(id) && heroes.includes(id))
		const endIds = holdR.length ? holdR : movers
		const endSk = split(endIds, (id) => boxAt(id, result), 0.09)
		if (endSk.U && !similar(last, endSk.U)) hold("result", beat("result", "result", "How it ends."), { freeze: "result", seconds: 2.5 }, endSk, `Can a child see how ${names(endSk.subject)} ended up?`)
		else shots.at(-1).run.hold_after = 2.5
	} else {
		// a still run: each thing too small for the whole picture gets a look of its own, then the whole
		const looks = heroes.filter((id) => !setupSk.subject.includes(id))
		let prevU = setupSk.U
		for (const id of looks.slice(0, 4)) {
			const sk = split([id], (x) => boxAt(x, 0), 0.09)
			if (similar(prevU, sk.U)) continue
			hold(`look-${id}`.slice(0, 64), beat("parts", "setup", "Each thing, close."), { freeze: "release", seconds: 1.6 }, sk, `Can a child see ${id} clearly?`)
			prevU = sk.U
		}
		for (const b of r0.beams.slice(0, 1)) {
			beat("light", "reveal", "Where the light goes.")
			shots.push({ id: "light", beat: "light", intent: "The automatic camera's look at the light: the whole beam, square on, still.", run: { freeze: "release", seconds: 3 }, move: "hold", subject: { beam: b.source }, frame: { fit: "snug" }, view: { yaw: 0, pitch: 1 }, lens: 50, audit: { question: "Can a child see where the light goes from start to end?", key: "end" } })
		}
		if (shots.length > 1 && shots.at(-1).id !== "light") shots.at(-1).run.hold_after = 1
	}
	return {
		version: 1,
		title: "Automatic camera",
		about: `The run as it happened, framed on ${names(heroes)}.`.slice(0, 240),
		...(src.lesson?.grade ? { grade: src.lesson.grade } : {}),
		source: { kind: src.kind ?? "demo", ...(src.lesson?.question ? { question: src.lesson.question.slice(0, 300) } : {}), ...(perLane ? { runs: Object.fromEntries(lanesIds.map((l) => [l, digest.runs[l].key])) } : { scene: String(r0.key).slice(0, 120) }) },
		story,
		output: { aspect: ASPECT[src.aspect] ? src.aspect : "16:9", fps: 60 },
		...(lanes ? { lanes } : {}),
		look: { backdrop: "studio", tone: r0.beams.length ? "dark" : "mid", ground: "sweep" },
		shots,
		notes: "Made without a director: the director's plan did not pass the engine's checks, or there was none."
	}
}

// ------------------------------------------------------------------------------------------------ the loop
/** Totals of usage objects (numbers added, nested objects too). */
export function sumUsage(...us) {
	const t = {}
	for (const u of us)
		for (const [k, v] of Object.entries(u ?? {}))
			if (typeof v === "number" && Number.isFinite(v)) t[k] = (t[k] ?? 0) + v
			else if (isObj(v)) t[k] = sumUsage(t[k], v)
	return t
}
const FALLBACK_CODES = new Set(["invalid_output", "budget", "timeout"])
/** The checks a plan may still fail and be filmed: the picture smaller or emptier than the net asks (a scene's layout can make that
 *  framing-infeasible). Every other failure breaks the video (cut off, too fast, a jump, a repeat, a name the run lacks). */
export const SOFT_CHECKS = new Set(["subject-size", "must-see", "fill", "face", "beam-visible", "stop-fill", "path-fill", "small-size"])
const hardOf = (report) => (report?.checks ?? []).filter((c) => c && c.ok === false && !SOFT_CHECKS.has(c.check))
const softOf = (report) => (report?.checks ?? []).filter((c) => c && c.ok === false && SOFT_CHECKS.has(c.check))
/** The better of two measured plans: fewer hard failures, then the director's story over an automatic plan, then fewer soft failures. */
const better = (a, b) => hardOf(a.report).length - hardOf(b.report).length || (a.director ? 0 : 1) - (b.director ? 0 : 1) || softOf(a.report).length - softOf(b.report).length
/**
 * Direct, check, repair, judge.
 *   step, system, user: the model call (models.json route `step`); digest; src (directSource's); runs: {lane: {scene, run, boxes?}} for the
 *   executor; executor (loadExecutor's); o: the step's options (signal, routing, env, fetch, params, budgetMs, onProgress, backoffScale, log)
 * After the repair turns, the director's best plan (the fewest hard failures, then soft) is the video when it breaks no hard check (its soft
 * failures are said in the warnings and result.soft); else the better of it and the automatic plans.
 * -> {result: {plan, source: "director"|"automatic", shots: [{id, beat, move, seconds, why}], report, measured, rounds, timing, digest_hash,
 *    soft?, fallback?}, model, servedModel, ms, usage, attempts, warnings, repaired}
 */
export async function runDirector({ step = "direct", system, user, digest, src, runs, executor, extra = {}, o = {} }) {
	const t0 = Date.now()
	// every turn shares the step's one budget (models.json budgetMs: the local server stops the step's process after it), capped by the host's
	const route = (() => {
		try {
			return routeFor(step, o.routing ?? loadRouting())
		} catch {
			return null
		}
	})()
	const deadline = t0 + Math.min(Number.isFinite(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : Infinity, Number.isFinite(route?.budgetMs) ? route.budgetMs : Infinity)
	// a repair turn starts only with time for a whole answer left (the route's attempt timeout, at most REPAIR_MIN_MS)
	const repairNeeds = Math.min(REPAIR_MIN_MS, Number.isFinite(route?.timeoutMs) ? route.timeoutMs : REPAIR_MIN_MS)
	const left = () => deadline - Date.now()
	const validate = (v) => validateShotPlan(v, { digest, lanes: src.lanes ?? null })
	// (what the executor reads: the runs, their digest, the picture at the video's own aspect; extra: the executor's world already built, the
	// catalog and registry)
	const ctx = { digest, runs, ...pictureOf(src.aspect), fps: 30, aspect: src.aspect, ...extra }
	const attempts = []
	const warnings = []
	let usage = {}
	const rounds = []
	let model = null, servedModel = null, repaired = false
	const call = async (convo, turn) => {
		const budget = Number.isFinite(left()) ? Math.max(1000, left()) : undefined
		const out = await callModel(step, {
			...(convo.messages ? { messages: convo.messages } : { system: convo.system, content: convo.user }),
			validate,
			signal: o.signal,
			routing: o.routing,
			env: o.env,
			fetch: o.fetch,
			log: o.log,
			backoffScale: o.backoffScale,
			params: o.params,
			...(budget !== undefined ? { budgetMs: budget } : {}),
			onProgress: o.onProgress ? (p) => o.onProgress({ ...p, turn }) : undefined
		})
		usage = sumUsage(usage, out.usage)
		attempts.push(...out.attempts.map((a) => ({ ...a, turn })))
		warnings.push(...out.warnings.map((w) => (turn ? `repair ${turn}: ${w}` : w)))
		model = out.model
		servedModel = out.servedModel
		repaired ||= !!out.repaired
		return out
	}
	const finish = (plan, report, source, more = {}) => {
		const v = validateShotPlan(plan, { digest })
		const timing = v.timing
		const secs = new Map((timing?.shots ?? []).map((s) => [s.id, s.seconds]))
		const why = plan.shots.map((s) => ({ id: s.id, beat: s.beat, move: s.move, seconds: secs.get(s.id) ?? null, why: s.intent }))
		// (the lock's camera as filmed: the next screen of the lesson passes it on as its camera)
		const lock = report?.lock ? { until: report.lock.until, upto: report.lock.upto, seconds: report.lock.seconds, camera: report.lock.camera } : null
		const result = { plan, source, shots: why, report: report ?? null, measured: !!report, rounds: rounds.map((r) => (r.plan === plan ? { ...r, plan: "(the plan above)" } : r)), timing, digest_hash: digest.hash, ...(lock ? { lock } : {}), ...more }
		if (src.return_digest) result.digest = { hash: digest.hash, text: digestText(digest) }
		return { result, model, servedModel, ms: Date.now() - t0, usage, attempts, warnings, repaired }
	}
	const fallback = async (reason, last) => {
		// the automatic plans: the executor's own (its focus camera) and this file's, measured; the director's best plan stays a candidate (its
		// story wins a tie on hard failures)
		const cands = []
		const auto = await Promise.resolve().then(() => executor.safePlan?.(digest, src, ctx)).catch(() => null)
		const va = auto ? validate(holdToSource(auto, src)) : null
		if (va?.ok) cands.push({ plan: va.value, by: "executor" })
		const vs = validate(holdToSource(safePlan(digest, src), src))
		if (vs.ok) cands.push({ plan: vs.value, by: "director.mjs" })
		else warnings.push(`the automatic plan has problems: ${vs.errors.slice(0, 3).join("; ")}`)
		if (!cands.length) cands.push({ plan: vs.value, by: "director.mjs" })
		for (const c of cands) c.report = await measured(executor, c.plan, ctx)
		if (last?.report) cands.push({ plan: last.plan, report: last.report, by: "director", director: true })
		const pick = [...cands].sort(better)[0]
		if (pick.director) {
			warnings.push(`the director's plan breaks ${hardOf(pick.report).length} check(s) of the net, and no automatic plan breaks fewer: ${failedChecks(pick.report).slice(0, 3).join("; ")}`)
			return finish(pick.plan, pick.report, "director", { soft: softOf(pick.report).map((c) => `${c.shot} ${c.check}: ${c.why}`), fallback: { reason, plan_by: "director" } })
		}
		if (!pick.report.ok) warnings.push(`the automatic plan fails the engine's checks too (framing-infeasible: the scene must change): ${failedChecks(pick.report).slice(0, 3).join("; ")}`)
		return finish(pick.plan, pick.report, "automatic", { fallback: { reason, plan_by: pick.by, ...(last ? { director_plan: last.plan, director_failed: failedChecks(last.report) } : {}) } })
	}

	// turn 0: the director's plan (callModel repairs a plan that does not validate once, then tries the next route)
	let out
	try {
		out = await call({ system, user }, 0)
	} catch (e) {
		if (e instanceof AIError && FALLBACK_CODES.has(e.code)) {
			if (e.usage) usage = sumUsage(usage, e.usage)
			attempts.push(...(e.attempts ?? []).map((a) => ({ ...a, turn: 0 })))
			warnings.push(`the director gave no usable plan (${e.code}: ${String(e.message).slice(0, 200)}): the automatic plan is used`)
			return fallback(`director: ${e.code}`, null)
		}
		throw e
	}
	let plan = holdToSource(out.result, src)
	// (each round keeps the plan it measured and what its model turn took, so a caller can see what the director tried)
	const roundOf = (turn, o2, rep, p) => ({ round: turn, ok: rep.ok, failed: failedChecks(rep), ms: o2.ms, usd: Number.isFinite(Number(o2.usage?.costInUSD)) ? Number(o2.usage.costInUSD) : null, plan: p })
	let report = await measured(executor, plan, ctx)
	rounds.push(roundOf(0, out, report, plan))
	const tried = [{ plan, report, director: true }]
	const convo = [{ role: "system", content: system }, { role: "user", content: user }]
	for (let turn = 1; !report.ok && turn <= REPAIR_TURNS; turn++) {
		if (left() < repairNeeds) {
			warnings.push(`no time left for repair ${turn} (${Math.round(left() / 1000)} s of the step's budget)`)
			break
		}
		convo.push({ role: "assistant", content: JSON.stringify(plan) }, { role: "user", content: repairTurn(report, turn) })
		try {
			out = await call({ messages: convo }, turn)
		} catch (e) {
			if (e instanceof AIError && FALLBACK_CODES.has(e.code)) {
				if (e.usage) usage = sumUsage(usage, e.usage)
				attempts.push(...(e.attempts ?? []).map((a) => ({ ...a, turn })))
				warnings.push(`repair ${turn} gave no usable plan (${e.code})`)
				break
			}
			throw e
		}
		plan = holdToSource(out.result, src)
		report = await measured(executor, plan, ctx)
		rounds.push(roundOf(turn, out, report, plan))
		tried.push({ plan, report, director: true })
	}
	if (report.ok) return finish(plan, report, "director")
	// the director's best try (the later one on a tie): its story, when what still fails is only the picture's size or fill
	const best = tried.reduceRight((a, b) => (better(b, a) < 0 ? b : a))
	if (!hardOf(best.report).length) {
		const soft = softOf(best.report).map((c) => `${c.shot} ${c.check}: ${c.why}`)
		warnings.push(`the director's plan is filmed with ${soft.length} size or fill check(s) under the net after ${rounds.length - 1} repair(s) (framing-infeasible there: a bigger thing or a closer layout is the scene's to change): ${soft.slice(0, 3).join("; ")}`)
		return finish(best.plan, best.report, "director", { soft })
	}
	return fallback("the director's plan still breaks the engine's checks", best)
}

/** The physics modules' goal kinds as web/export/subjects.js recognize() reads them (its registryOf), from web/sim/plugins.js's registry. */
export function registryFrom(reg) {
	const out = {}
	const goals = reg?.goals
	if (!goals || typeof goals.entries !== "function") return out
	for (const [kind, k] of goals.entries()) out[kind] = { module: k?.module ?? null, fields: k?.fields ?? {}, subject: k?.subject ?? null, compares: k?.compares ?? null }
	return out
}

/** The cast's recognizer: web/export/subjects.js recognize() (o.recognize: one in its place, or null for the digest's own ranking, for tests). */
export function loadRecognizer(o = {}) {
	return o.recognize !== undefined ? o.recognize : recognizeSubjects
}
