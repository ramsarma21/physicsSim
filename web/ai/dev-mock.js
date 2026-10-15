// Development only: canned answers for /api/ai/* so the panel can be worked on (and demoed offline) without the gateway. The page uses it only
// with ?aimock=1 (panel.js); real builds never load this file. Plans are hand-written against the real catalog; the critic returns one round
// of patches then approves, so every part of the timeline and the report shows.
const wait = (ms, signal) =>
	new Promise((res, rej) => {
		const t = setTimeout(res, ms)
		signal?.addEventListener("abort", () => (clearTimeout(t), rej(new DOMException("Cancelled", "AbortError"))), { once: true })
	})

const PLANS = {
	rube: () => ({
		title: "Ramp, dominoes and a drop",
		seconds: 5,
		items: [
			{ id: "stand", type: "cardboard-box", name: "Stand", place: { on: "table", x: 0.05 } },
			{ id: "ramp", type: "plank", name: "Ramp", place: { lean: { from: { on: "stand", x: 0.0 }, to: { on: "table", x: 0.85 } } } },
			{ id: "ball", type: "billiard-ball", name: "Cue ball", held: true, place: { on: "ramp", x: 0.12 } },
			{ id: "row", type: "domino-row", name: "Dominoes", props: { count: 7, first_height: 0.06 }, place: { on: "table", right_of: { id: "ramp", gap_m: 0.12 } } },
			{ id: "ledge", type: "brick", name: "Ledge", fixed: true, props: { width: 0.3, height: 0.12 }, place: { on: "table", right_of: { id: "row", gap_m: 0.03 } } },
			{ id: "ball2", type: "tennis-ball", name: "Tennis ball", place: { on: "ledge", x: 1.55 } },
			{ id: "box", type: "box", name: "Target box", props: { hung: false, width: 0.3 }, place: { on: "table", right_of: { id: "ledge", gap_m: 0.05 } } }
		],
		missing: [],
		goals: [{ label: "The tennis ball drops into the box", item: "ball2", container: "box" }],
		tune: [{ id: "box", param: "x", min: 1.7, max: 2.3 }],
		notes: ["The ledge is a fixed brick so the last domino can push the ball off it."]
	}),
	bowling: () => ({
		title: "Bowling down a ramp",
		seconds: 5,
		items: [
			{ id: "ramp", type: "plank", name: "Ramp", props: { length: 1.4, depth: 0.3 }, place: { on: "table", x: 0.35, angle_deg: -14 } },
			{ id: "bowl", type: "bowling-ball", name: "Bowling ball", held: true, place: { on: "ramp", x: -0.1 } },
			...Array.from({ length: 10 }, (_, i) => ({ id: `pin${i + 1}`, type: "bowling-pin", name: `Pin ${i + 1}`, place: i ? { on: "table", right_of: { id: `pin${i}`, gap_m: 0.06 } } : { on: "table", x: 1.5 } }))
		],
		missing: [{ asked: "a bowling lane", reason: "not in the library", substitute_type: "plank" }],
		goals: [],
		notes: ["The pins stand in one row: the physics runs in one plane, so a triangle of pins becomes a line."]
	}),
	car: () => ({
		title: "Toy car into dominoes",
		seconds: 6,
		items: [
			{ id: "ramp", type: "plank", name: "Ramp", place: { on: "table", x: 0.6, angle_deg: -18 } },
			{ id: "car", type: "toy-car", name: "Toy car", place: { on: "ramp", x: 0.2 } },
			{ id: "row", type: "domino-row", name: "Dominoes", props: { count: 12, first_height: 0.06, growth: 1.12 }, place: { on: "table", right_of: { id: "ramp", gap_m: 0.25 } } }
		],
		missing: [],
		goals: [],
		notes: []
	}),
	photo: () => ({
		title: "From your photo",
		seconds: 4.5,
		items: [
			{ id: "book1", type: "hardcover-book", name: "Book", place: { on: "table", x: 1.0 } },
			{ id: "book2", type: "hardcover-book", name: "Book 2", place: { on: "book1" } },
			{ id: "mug", type: "coffee-mug", name: "Mug", place: { on: "book2" } },
			{ id: "ball", type: "tennis-ball", name: "Ball", held: true, place: { on: "air", x: 0.6, y_m: 0.5 } }
		],
		missing: [{ asked: "a cat", reason: "no animals in the library", substitute_type: null }],
		goals: [],
		notes: ["Sizes were judged from the mug (about 9.5 cm tall)."]
	})
}

function pick(text) {
	const t = String(text ?? "").toLowerCase()
	if (/bowl|pin/.test(t)) return PLANS.bowling()
	if (/car|vehicle/.test(t)) return PLANS.car()
	if (/photo|picture|image/.test(t)) return PLANS.photo()
	return PLANS.rube()
}

/** wraps the app's api(): /api/ai/* answered here, everything else passed through. ?aimock=1&aibusy=1 also plays a full server: each step
 *  first waits in the queue (its place counts down), the first plan is turned away once (429 with Retry-After), then runs. */
export function withMock(api) {
	let refineRound = 0
	const busy = new URLSearchParams(globalThis.location?.search ?? "").get("aibusy") === "1"
	let turnedAway = false
	const inflight = new Map() // requestId -> {step, t0, queue: ms in the queue}
	return async (path, body, signal) => {
		if (!String(path).startsWith("/api/ai/")) return api(path, body, signal)
		const step = path.slice("/api/ai/".length)
		if (step.startsWith("progress")) {
			// the server's word on a step in flight: its place in the queue, then the model's thinking and writing as it grows
			const id = new URLSearchParams(step.split("?")[1] ?? "").get("id")
			const f = inflight.get(id)
			if (!f) throw Object.assign(new Error("no such AI request"), { status: 404 })
			const ms = performance.now() - f.t0
			if (ms < f.queue) return { ok: true, id, state: "waiting", step: f.step, position: Math.max(1, Math.ceil((f.queue - ms) / 700)), elapsed_ms: Math.round(ms) }
			const run = ms - f.queue
			return { ok: true, id, state: "running", step: f.step, model: "mock/opus", attempt: 1, phase: run < 900 ? "thinking" : "writing", tokens: Math.round(run * 0.6), ms: Math.round(run), elapsed_ms: Math.round(ms) }
		}
		const p = body?.payload ?? {}
		const t0 = performance.now()
		const rid = body?.client?.requestId
		if (busy && step === "plan" && !turnedAway) {
			turnedAway = true
			await wait(600, signal)
			throw Object.assign(new Error("the AI is busy"), { status: 429, body: { ok: false, code: "busy", error: "the AI is busy", retryable: true }, retryAfter: 2 })
		}
		const queue = busy ? 2100 : 0
		if (rid) inflight.set(rid, { step, t0, queue })
		try {
			if (queue) await wait(queue, signal)
		} catch (e) {
			inflight.delete(rid)
			throw e
		}
		let result
		if (step === "observe") {
			await wait(1400, signal)
			result = { objects: [{ label: "book", count: 2, bbox: [0.3, 0.5, 0.6, 0.8], est_size_m: { w: 0.23, h: 0.035 }, material: "paper", color: "blue", state: "resting", supports: "table" }], relations: [], motion_story: ["nothing moves until the ball drops"], view: "side", scale_hint: "a mug, about 9.5 cm", uncertain: ["the ball's size"] }
		} else if (step === "plan") {
			await wait(2200, signal)
			refineRound = 0
			result = pick(p.text)
		} else if (step === "refine") {
			await wait(1300, signal)
			refineRound++
			result = refineRound === 1 && p.plan?.items?.some((i) => i.id === "row")
				? { done: false, score_0_10: 6, issues: ["The dominoes start a little far from the foot of the ramp"], patches: [{ op: "move", id: "row", dx: -0.04 }] }
				: { done: true, score_0_10: 8, issues: [], patches: [] }
		} else if (step === "edit") {
			await wait(1500, signal)
			const t = String(p.text ?? "").toLowerCase()
			const ramp = p.plan?.items?.find((i) => /plank/.test(i.type))
			const row = p.plan?.items?.find((i) => i.type === "domino-row")
			if (/steep/.test(t) && ramp) result = { patches: [{ op: "set_place", id: ramp.id, place: { ...ramp.place, angle_deg: (ramp.place?.angle_deg ?? -12) * 1.5 } }], reply: "Made the ramp half again as steep." }
			else if (/domino/.test(t) && row) result = { patches: [{ op: "set_props", id: row.id, props: { count: Math.min(30, (row.props?.count ?? 7) + 5) } }], reply: "Added five more dominoes." }
			else if (/\?$/.test(t)) result = { mode: "patch", reply: "(mock) That needs no change to the scene.", patches: [] }
			else result = { patches: [{ op: "add", item: { id: "extra-ball", type: "superball", name: "Superball", held: true, place: { on: "air", x: 1.3, y_m: 0.8 } } }], reply: "Added a superball held above the middle of the table." }
		} else return { ok: false, error: `no step ${step}` }
		inflight.delete(rid)
		// (next edits to offer, as the server's plan and edit answers carry them: ai/DESIGN.md §13.9)
		if ((step === "plan" || step === "edit") && result && !Array.isArray(result.suggestions)) result.suggestions = [{ label: "Make the ramp steeper", prompt: "Make the ramp steeper" }, { label: "Add five more dominoes", prompt: "Add five more dominoes" }]
		return { ok: true, result, model: `mock/${step}`, ms: Math.round(performance.now() - t0), usage: null }
	}
}
