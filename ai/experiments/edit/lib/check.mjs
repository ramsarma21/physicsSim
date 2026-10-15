// Hard checks of one edit result (the case specs are documented in cases.mjs).
//   const B = await prepareCase(c)                  // the case's starting scene, plan, run, digest and "still works" checks
//   const r = await evaluate(c, B, {scene, reply, notes})   // {pass, pass_byte, checks: {...: true|false|null}, fail: [words], ...}
// "untouched" = every item the case does not name (nor allow) is the same as before: type, props, held, fixed, and its anchor and angle
// within 3 mm / 0.5° (pass: nothing a viewer could see; the solver's re-seating at its resting distance moves a thing 0.5-1.5 mm); "untouched_byte" asks for the exact same numbers (1e-6: the request's "byte-identical").
import fs from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { frozen, OUT } from "./env.mjs"
import { simPool, withSlot } from "./pool.mjs"
import { loadBases } from "../bases.mjs"
import { MUTATIONS } from "../cases.mjs"

const clone = (o) => JSON.parse(JSON.stringify(o))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const real = (s) => (s?.items ?? []).filter((i) => i && !safety(i))
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const inR = (v, r) => Number.isFinite(v) && v >= r[0] - 1e-9 && v <= r[1] + 1e-9
const re = (s) => new RegExp(s, "i")
export const LOOSE = { m: 0.003, deg: 0.5 }

/** The in-goals of a check list added to the scene's goals, so the engine's summary checks them. */
function withGoals(scene, checks) {
	const s = clone(scene)
	s.goals = Array.isArray(s.goals) ? s.goals : []
	for (const g of checks)
		if ((g.kind ?? "in") === "in" && g.item && g.container && !s.goals.some((x) => x.item === g.item && x.container === g.container))
			s.goals.push({ kind: "in", item: g.item, container: g.container, label: g.label ?? `${g.item} in ${g.container}` })
	return s
}
async function runChecks(scene, checks) {
	const F = await frozen()
	const ids = new Set(scene.items.map((i) => i.id))
	const live = checks.filter((g) => F.goals.goalRefs(g).every((id) => ids.has(id)))
	const s = withGoals(scene, live)
	s.goals = s.goals.filter((g) => ids.has(g.item) && ids.has(g.container))
	const sim = await simPool().simulate(s)
	return { sim, results: F.goals.checkGoals(live, { doc: sim.doc, track: sim.track, summary: sim.summary }), live }
}

const cache = new Map()
/** The case's starting point: {scene, plan, sim, digest, checks (the goals and story that pass on the unbroken base), resolved} */
export function prepareCase(c) {
	const key = JSON.stringify(c.base)
	if (cache.has(key)) return cache.get(key)
	const p = (async () => {
		const F = await frozen()
		const cat = await F.catalog.getCatalog()
		const bases = await loadBases()
		const b = bases[typeof c.base === "string" ? c.base : c.base.from]
		if (!b) throw new Error(`no base ${JSON.stringify(c.base)}`)
		const goals = [...(b.plan?.goals ?? b.scene.goals ?? []), ...(b.story ?? [])].map((g) => ({ ...g, kind: g.kind ?? "in" }))
		const intact = await runChecks(b.scene, goals)
		const checks = intact.live.filter((g, i) => intact.results[i].ok === true)
		let scene = clone(b.scene)
		let plan = b.plan ? clone(b.plan) : null
		if (typeof c.base === "object" && c.base.mutate) {
			MUTATIONS[c.base.mutate](scene)
			scene.id = `${scene.id ?? "scene"}-${c.base.mutate}`
			plan = null // (a scene changed by hand: the plan no longer made it)
		}
		const run = await runChecks(scene, checks)
		const digest = await F.sceneDigest.sceneDigest(scene, cat.index)
		return { base: b, scene, plan, sim: run.sim, checks, before: run.results, digest, rests: restsMap(digest) }
	})()
	cache.set(key, p)
	return p
}
const restsMap = (d) => new Map(d.items.map((r) => [r.id, r.rests_on ?? null]))

function propVal(item, k, resolved, T) {
	const r = resolved?.[item.id]
	if (r && r[k] !== undefined && (!r._type || r._type === item.type)) return r[k]
	if (item.props?.[k] !== undefined) return item.props[k]
	return T?.props?.[k]?.default
}
/** The props an item is built with: its own, else the type's defaults (the app and the solver drop a prop equal to its default, so
 *  {width: 0.26} and {} are the same box); an auto prop (a ball's mass) only when the item sets it. */
let TYPES = null
function effective(item) {
	const T = TYPES?.[item.type]
	const out = {}
	for (const [k, v] of Object.entries(item.props ?? {})) if (v !== undefined && v !== null) out[k] = v
	if (T) for (const [k, p] of Object.entries(T.props ?? {})) if (out[k] === undefined && !p.auto && p.default !== undefined) out[k] = p.default
	return out
}
function sameProps(a, b) {
	const ea = effective(a)
	const eb = effective(b)
	const keys = new Set([...Object.keys(ea), ...Object.keys(eb)])
	for (const k of keys) {
		const x = ea[k]
		const y = eb[k]
		if (typeof x === "number" && typeof y === "number") {
			if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x))) return false
		} else if (JSON.stringify(x) !== JSON.stringify(y)) return false
	}
	return true
}
/** How an item differs: null when the same; else the words. tol: {m, deg}. */
export function itemDiff(a, b, tol = { m: 1e-6, deg: 1e-6 }) {
	const bits = []
	if (a.type !== b.type) bits.push(`type ${a.type} → ${b.type}`)
	else if (!sameProps(a, b)) bits.push(`props ${JSON.stringify(effective(a))} → ${JSON.stringify(effective(b))}`)
	const dx = num(b.x) - num(a.x)
	const dy = num(b.y) - num(a.y)
	const da = num(b.angle) - num(a.angle)
	if (Math.abs(dx) > tol.m || Math.abs(dy) > tol.m) bits.push(`moved (${(dx * 100).toFixed(2)}, ${(dy * 100).toFixed(2)}) cm`)
	if (Math.abs(da) > tol.deg) bits.push(`turned ${da.toFixed(2)}°`)
	if (!!a.held !== !!b.held) bits.push(`held ${!!a.held} → ${!!b.held}`)
	if (!!a.fixed !== !!b.fixed) bits.push(`fixed ${!!a.fixed} → ${!!b.fixed}`)
	return bits.length ? bits.join(", ") : null
}

/** One target spec on the item (before a, after b: null when gone). -> [problems] */
function checkTarget(id, spec, a, b, ctx) {
	const P = []
	if (spec.anyOf) {
		const alts = spec.anyOf.map((s) => checkTarget(id, s, a, b, ctx))
		return alts.some((x) => !x.length) ? [] : [`${id}: none of the accepted outcomes (${alts.map((x) => x.join("; ")).join(" | ")})`]
	}
	if (spec.removed) return b ? [`${id} should be removed`] : []
	if (!b) return [`${id} is gone`]
	if (spec.unchanged) {
		const d = a ? itemDiff(a, b, LOOSE) : "new"
		if (d) P.push(`${id} should stay as it was (${d})`)
	}
	if (spec.reply && !re(spec.reply).test(ctx.reply ?? "")) P.push(`the reply should say so (/${spec.reply}/)`)
	if (spec.type) {
		const ok = [].concat(spec.type)
		if (!ok.includes(b.type)) P.push(`${id} is ${b.type}, not ${ok.join("|")}`)
	}
	if (spec.props)
		for (const [k, want] of Object.entries(spec.props)) {
			const Ta = ctx.T[a?.type]
			const Tb = ctx.T[b.type]
			const va = a ? propVal(a, k, ctx.resA, Ta) : undefined
			const vb = propVal(b, k, ctx.resB, Tb)
			if (want.eq !== undefined && vb !== want.eq) P.push(`${id}.${k} = ${vb}, not ${want.eq}`)
			if (want.ratio && !(typeof va === "number" && typeof vb === "number" && va !== 0 && inR(vb / va, want.ratio))) P.push(`${id}.${k}: ${va} → ${vb} (ratio ${typeof va === "number" && va ? (vb / va).toFixed(3) : "?"}, wanted ${want.ratio.join("…")})`)
			if (want.delta && !(typeof va === "number" && typeof vb === "number" && inR(vb - va, want.delta))) P.push(`${id}.${k}: ${va} → ${vb} (change ${typeof va === "number" && typeof vb === "number" ? (vb - va).toFixed(3) : "?"}, wanted ${want.delta.join("…")})`)
			if (want.min !== undefined && !(vb >= want.min)) P.push(`${id}.${k} = ${vb} < ${want.min}`)
			if (want.max !== undefined && !(vb <= want.max)) P.push(`${id}.${k} = ${vb} > ${want.max}`)
			if (want.changed && JSON.stringify(va) === JSON.stringify(vb)) P.push(`${id}.${k} unchanged (${vb})`)
		}
	const dx = num(b.x) - num(a?.x)
	const dy = num(b.y) - num(a?.y)
	const da = num(b.angle) - num(a?.angle)
	if (spec.dx && !inR(dx, spec.dx)) P.push(`${id} moved ${(dx * 100).toFixed(1)} cm in x (wanted ${spec.dx.map((v) => (v * 100).toFixed(1)).join("…")})`)
	if (spec.dy && !inR(dy, spec.dy)) P.push(`${id} moved ${(dy * 100).toFixed(1)} cm in y (wanted ${spec.dy.map((v) => (v * 100).toFixed(1)).join("…")})`)
	if (spec.da && !inR(da, spec.da)) P.push(`${id} turned ${da.toFixed(1)}° (wanted ${spec.da.join("…")})`)
	if (spec.x && !inR(num(b.x), spec.x)) P.push(`${id} at x ${num(b.x).toFixed(3)} (wanted ${spec.x.join("…")})`)
	if (spec.y && !inR(num(b.y), spec.y)) P.push(`${id} at y ${num(b.y).toFixed(3)} (wanted ${spec.y.join("…")})`)
	if (spec.a && !inR(num(b.angle), spec.a)) P.push(`${id} at ${num(b.angle).toFixed(1)}° (wanted ${spec.a.join("…")})`)
	if (spec.held !== undefined && !!b.held !== spec.held) P.push(`${id} held ${!!b.held} (wanted ${spec.held})`)
	if (spec.rests) {
		const want = spec.rests === "same" ? ctx.restsA.get(id) : spec.rests
		const got = ctx.restsB.get(id)
		if (got !== want) P.push(`${id} rests on ${got} (wanted ${want})`)
	}
	return P
}

/** The grader's one question when a check stopped passing: does the reply (or the card's notes) tell the user? -> true|false|null */
const GRADES = join(OUT, "grade-cache.json")
let grades = null
async function saysWhy(c, broken, text) {
	if (!text.trim()) return false
	grades ??= fs.existsSync(GRADES) ? JSON.parse(fs.readFileSync(GRADES, "utf8")) : {}
	const key = createHash("sha1").update(JSON.stringify([c.text, broken, text])).digest("hex")
	if (grades[key] !== undefined) return grades[key]
	const said = await saysWhy1(c, broken, text)
	if (said !== null) {
		grades[key] = said
		fs.mkdirSync(OUT, { recursive: true })
		fs.writeFileSync(GRADES, JSON.stringify(grades))
	}
	return said
}
async function saysWhy1(c, broken, text) {
	const F = await frozen()
	const routing = { version: 2, defaults: { retries: 2, backoffMs: 1500, maxBackoffMs: 20000, timeoutMs: 90000, budgetMs: 240000, minAttemptMs: 8000, idleTimeoutMs: 90000 }, models: { "claude-group/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] } }, steps: { grade: { model: "claude-group/claude-opus-5-5", fallbacks: [], params: { max_tokens: 2000, reasoning_effort: "low" }, timeoutMs: 90000, budgetMs: 240000, retries: 2 } } }
	const content = `A user asked a physics-sandbox assistant to change their scene: "${c.text}".\nAfter the change, these outcomes that used to happen no longer happen in the physics run:\n${broken.map((b) => `- ${b}`).join("\n")}\n\nEverything the user was shown about the change (the assistant's reply and the notes on its result card):\n"""\n${text}\n"""\n\nDoes what the user was shown tell them, in any words, that (some of) these outcomes no longer happen or may fail (or why)? Answer ONE JSON object: {"said": true|false, "quote": "the words that say it, or empty"}`
	try {
		const out = await withSlot(() => F.core.callModel("grade", { system: "You grade one thing precisely and answer only with JSON.", content, routing, fetch: F.fetchH1, validate: (v) => ({ ok: typeof v?.said === "boolean", errors: typeof v?.said === "boolean" ? [] : ["said must be true or false"], warnings: [], value: v }) }))
		return out.result.said
	} catch {
		return null
	}
}

/** Evaluate a result: final = {scene (what is on the table after), reply, notes (other words the card shows)}. */
export async function evaluate(c, B, final, { grade = true } = {}) {
	const F = await frozen()
	const cat = await F.catalog.getCatalog()
	const T = cat.index.types
	TYPES = T
	const after = final.scene ?? B.scene
	const run = await runChecks(after, B.checks)
	const digest = await F.sceneDigest.sceneDigest(after, cat.index)
	const A = new Map(real(B.scene).map((i) => [i.id, i]))
	const Bm = new Map(real(after).map((i) => [i.id, i]))
	const ctx = { T, resA: B.sim.resolved, resB: run.sim.resolved, restsA: B.rests, restsB: restsMap(digest), reply: final.reply ?? "" }
	const checks = {}
	const fail = []
	const say = (k, ok, why) => {
		checks[k] = ok
		if (ok === false && why) fail.push(`${k}: ${why}`)
	}
	// what changed at all
	const changed = []
	const changedLoose = []
	for (const [id, a] of A) {
		const b = Bm.get(id)
		if (!b) {
			changed.push(id)
			changedLoose.push(id)
			continue
		}
		if (itemDiff(a, b) || (a.name ?? null) !== (b.name ?? null)) changed.push(id)
		if (itemDiff(a, b, LOOSE)) changedLoose.push(id)
	}
	const added = [...Bm.values()].filter((i) => !A.has(i.id))
	const sceneSame = ["seconds", "release"].every((k) => num(after[k] ?? (k === "seconds" ? 4.5 : 0.5)) === num(B.scene[k] ?? (k === "seconds" ? 4.5 : 0.5)))
	if (c.noChange) {
		const same = !changed.length && !added.length && sceneSame
		say("noChange", same, same ? null : `changed ${[...changed, ...added.map((i) => `+${i.id}`)].join(", ") || "the scene's timing"}`)
		if (!(final.reply ?? "").trim()) say("reply", false, "no answer")
		if (c.ask) {
			const r = final.reply ?? ""
			const named = c.ask.candidates.filter((x) => re(x).test(r)).length
			say("ask", /\?/.test(r) && named >= c.ask.min, `the reply should ask which one, naming ≥ ${c.ask.min} (named ${named}${/\?/.test(r) ? "" : ", no question"})`)
		}
		if (c.answer) say("answer", re(c.answer).test(final.reply ?? ""), `the answer should match /${c.answer}/`)
	} else {
		// the asked change, exactly
		const branches = c.anyOf ?? [{ t: c.t, scene: c.scene }]
		const branchProblems = branches.map((br) => {
			const P = []
			for (const [id, spec] of Object.entries(br.t ?? {})) P.push(...checkTarget(id, spec, A.get(id) ?? null, Bm.get(id) ?? null, ctx))
			for (const [k, r] of Object.entries(br.scene ?? {})) {
				const v = num(after[k] ?? (k === "seconds" ? 4.5 : 0.5))
				if (!inR(v, r)) P.push(`scene ${k} = ${v} (wanted ${r.join("…")})`)
			}
			return P
		})
		const okBranch = branchProblems.findIndex((p) => !p.length)
		const exactP = okBranch >= 0 ? [] : branchProblems.reduce((a, b) => (b.length < a.length ? b : a))
		// new items
		const pool = [...added]
		for (const want of c.added ?? []) {
			const types = [].concat(want.type ?? want.types)
			const mine = pool.filter((i) => types.includes(i.type))
			const [lo, hi] = Array.isArray(want.count) ? want.count : [want.count, want.count]
			if (mine.length < lo || mine.length > hi) exactP.push(`added ${mine.length} × ${types.join("|")} (wanted ${lo === hi ? lo : `${lo}…${hi}`})`)
			for (const i of mine) {
				pool.splice(pool.indexOf(i), 1)
				if (want.restsOn && ctx.restsB.get(i.id) !== want.restsOn) exactP.push(`new ${i.id} rests on ${ctx.restsB.get(i.id)} (wanted ${want.restsOn})`)
				if (want.x && !inR(num(i.x), want.x)) exactP.push(`new ${i.id} at x ${num(i.x).toFixed(3)} (wanted ${want.x.join("…")})`)
				if (want.near) {
					const o = A.get(want.near[0])
					const d = Math.hypot(num(i.x) - num(o?.x), num(i.y) - num(o?.y))
					if (!(d <= want.near[1])) exactP.push(`new ${i.id} is ${(d * 100).toFixed(0)} cm from ${want.near[0]} (wanted ≤ ${want.near[1] * 100} cm)`)
				}
			}
		}
		if (c.stackOn) {
			const blocks = added.filter((i) => i.type === "wooden-block")
			let top = c.stackOn
			for (let k = 0; k < blocks.length; k++) {
				const nxt = blocks.find((i) => ctx.restsB.get(i.id) === top)
				if (!nxt) {
					exactP.push(`the new blocks are not stacked on ${top}`)
					break
				}
				top = nxt.id
			}
		}
		if (c.counts) {
			const all = real(after)
			for (const [type, n] of Object.entries(c.counts)) {
				const k = all.filter((i) => i.type === type).length
				if (k !== n) exactP.push(`${k} × ${type} (wanted ${n})`)
			}
			const stackType = Object.entries(c.counts).find(([, n]) => n > 1)?.[0]
			if (c.base === "wrecking-ball") {
				const col = all.filter((i) => i.type === stackType)
				const onTable = col.filter((i) => ctx.restsB.get(i.id) === "table").length
				const onEach = col.filter((i) => col.some((o) => o.id === ctx.restsB.get(i.id))).length
				if (onTable !== 1 || onEach !== col.length - 1) exactP.push(`the ${stackType}s are not one stack (${onTable} on the table, ${onEach} on another)`)
			}
			if (c.base === "ai-m4-conveyor-oranges") for (const i of all.filter((x) => x.type === stackType)) if (ctx.restsB.get(i.id) !== "belt") exactP.push(`${i.id} rests on ${ctx.restsB.get(i.id)}, not the belt`)
		}
		say("exact", !exactP.length, exactP.join("; "))
		// everything else as it was
		const named = new Set([...branches.flatMap((br) => Object.keys(br.t ?? {})), ...(c.allow ?? [])])
		if (c.allowAny) {
			const keepBad = (c.keep ?? []).filter((id) => changedLoose.includes(id))
			const n = changedLoose.length
			say("untouched", n <= (c.maxChanged ?? 99) && !keepBad.length, `${n} items changed (at most ${c.maxChanged})${keepBad.length ? `; ${keepBad.join(", ")} should stay` : ""}: ${changedLoose.join(", ")}`)
			say("untouched_byte", checks.untouched, null)
		} else {
			const loose = changedLoose.filter((id) => !named.has(id))
			const strict = changed.filter((id) => !named.has(id))
			say("untouched", !loose.length, loose.map((id) => `${id} ${Bm.has(id) ? itemDiff(A.get(id), Bm.get(id), { m: 0.001, deg: 0.1 }) : "removed"}`).join("; "))
			say("untouched_byte", !strict.length, strict.map((id) => `${id} ${Bm.has(id) ? itemDiff(A.get(id), Bm.get(id)) ?? `renamed “${A.get(id).name}” → “${Bm.get(id).name}”` : "removed"}`).join("; "))
			if (pool.length && !c.counts) say("extra", false, `unasked new items: ${pool.map((i) => `${i.id} (${i.type})`).join(", ")}`)
			else checks.extra = true
		}
		// nothing starts inside anything new
		const wasW = new Set((B.sim.warnings ?? []).map((w) => w.text))
		const newW = (run.sim.warnings ?? []).filter((w) => !wasW.has(w.text))
		say("overlap", !newW.length, newW.map((w) => w.text).join("; "))
		if (c.answer) say("answer", re(c.answer).test(final.reply ?? ""), `the reply should match /${c.answer}/`)
	}
	// the machine still works (or the card says why); "fix": the goals the break stopped work again
	const res = run.results
	const lost = res.filter((r) => r.ok !== true).map((r) => `${r.label} (${r.detail ?? "fails"})`)
	if (c.works === "fix") {
		say("works", !lost.length, `still failing: ${lost.join("; ")}`)
	} else if (c.works !== "none") {
		const beforeOk = new Map(B.before.map((r) => [r.label, r.ok]))
		const newly = res.filter((r) => r.ok !== true && beforeOk.get(r.label) === true).map((r) => `${r.label} (${r.detail ?? "fails"})`)
		checks.works = !newly.length
		if (newly.length) {
			const said = grade ? await saysWhy(c, newly, [final.reply ?? "", ...(final.notes ?? [])].join("\n")) : null
			say("works_or_said", said === true, `no longer: ${newly.join("; ")}; the card ${said === null ? "could not be graded" : "does not say so"}`)
			checks.said = said
		} else checks.works_or_said = true
		checks.lost = newly
	}
	const hard = ["exact", "untouched", "extra", "overlap", "works_or_said", "works", "noChange", "ask", "answer", "reply"].filter((k) => checks[k] !== undefined && !(k === "works" && c.works !== "fix"))
	const pass = hard.every((k) => checks[k] !== false)
	return { pass, pass_byte: pass && checks.untouched_byte !== false, checks, fail, changed: changedLoose, changedByte: changed, added: added.map((i) => `${i.id}:${i.type}`), lost, finalSim: { warnings: run.sim.warnings, goals: res } }
}
