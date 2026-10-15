// The post-edit verifier: the exact diff of the scene (before -> after, every item) and a fast model check of "did it do exactly what was
// asked, no more, no less?". -> {ok, problems: [text], ms, usage}
import { frozen } from "./env.mjs"
import { withSlot } from "./pool.mjs"

const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const cm = (m) => `${(m * 100).toFixed(1)} cm`
/** Every difference, item by item, in plain exact words (the app's describeDiff misses props equal by default and rounds small moves). */
export async function exactDiff(a, b) {
	const F = await frozen()
	const cat = await F.catalog.getCatalog()
	const T = cat.index.types
	const A = new Map(a.items.filter((i) => !safety(i)).map((i) => [i.id, i]))
	const B = new Map(b.items.filter((i) => !safety(i)).map((i) => [i.id, i]))
	const eff = (it) => {
		const out = {}
		for (const [k, p] of Object.entries(T[it.type]?.props ?? {})) if (!p.auto && p.default !== undefined) out[k] = p.default
		return { ...out, ...(it.props ?? {}) }
	}
	const lines = []
	for (const [id, x] of A) {
		const y = B.get(id)
		const nm = `${id} (“${x.name ?? T[x.type]?.name ?? x.type}”, ${x.type})`
		if (!y) {
			lines.push(`${nm}: REMOVED`)
			continue
		}
		const bits = []
		if (x.type !== y.type) bits.push(`kind ${x.type} → ${y.type}`)
		else {
			const ea = eff(x)
			const eb = eff(y)
			for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) if (JSON.stringify(ea[k]) !== JSON.stringify(eb[k])) bits.push(`${k} ${ea[k] ?? "default"} → ${eb[k] ?? "default"}`)
		}
		const dx = (y.x ?? 0) - (x.x ?? 0)
		const dy = (y.y ?? 0) - (x.y ?? 0)
		const da = (y.angle ?? 0) - (x.angle ?? 0)
		if (Math.abs(dx) > 5e-4) bits.push(`moved ${cm(Math.abs(dx))} ${dx > 0 ? "right" : "left"}`)
		if (Math.abs(dy) > 5e-4) bits.push(`moved ${cm(Math.abs(dy))} ${dy > 0 ? "up" : "down"}`)
		if (Math.abs(da) > 0.05) bits.push(`angle ${(x.angle ?? 0).toFixed(1)}° → ${(y.angle ?? 0).toFixed(1)}°`)
		if (!!x.held !== !!y.held) bits.push(y.held ? "now held until the release" : "no longer held")
		if (!!x.fixed !== !!y.fixed) bits.push(y.fixed ? "now fixed" : "no longer fixed")
		if ((x.name ?? null) !== (y.name ?? null)) bits.push(`renamed “${x.name}” → “${y.name}”`)
		if (bits.length) lines.push(`${nm}: ${bits.join("; ")}`)
	}
	for (const [id, y] of B) if (!A.has(id)) lines.push(`${id} (“${y.name ?? T[y.type]?.name ?? y.type}”, ${y.type}): ADDED at x ${y.x?.toFixed(3)}, y ${y.y?.toFixed(3)}${y.held ? ", held" : ""}`)
	for (const k of ["seconds", "release"]) if ((a[k] ?? null) !== (b[k] ?? null)) lines.push(`scene ${k} ${a[k]} → ${b[k]}`)
	return lines
}

const SYSTEM = `You check one edit made by a physics-sandbox assistant. You get the user's request (and the conversation before it), which items the assistant decided the request means, the EXACT list of everything that changed in the scene (computed by the app, item by item), and the assistant's reply.
Check, strictly:
1. Every change the user asked for happened, to the item(s) they meant (a colour or look in the request picks the item that has it), by the amount and in the direction asked (numbers given are exact; "left" is negative x, "up" positive y), and nothing asked for is missing.
2. Nothing else changed. Allowed besides the asked change: a renamed item whose name had become untrue; things resting on a moved item moving with it by the same amount; a swapped or resized thing moving up or down a little to stay seated on its support; a neighbour moved the least amount to make room ("to make room" is said). Anything else that changed is a problem, even if it would help the machine work, UNLESS the user asked to make it work / fix it (then changes that serve that are fine, but the things the user chose must stay).
3. A question, a hypothetical ("what would happen if..."), or a request that does not say which of several look-alike items it means must change NOTHING (the reply answers or asks).
4. The reply does not claim anything that the change list contradicts.
Answer ONE JSON object only: {"ok": true|false, "problems": ["one short sentence each: what is wrong and what the right change would be (item id, amount)"]}`

export async function verifyEdit({ text, history = [], targets = [], diff, reply, kind }) {
	const F = await frozen()
	const content = [
		history.length ? `# The conversation before\n${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`).join("\n")}` : null,
		`# The request\n"""\n${text}\n"""`,
		`# What the assistant decided it means (${kind ?? "change"})\n${targets.length ? targets.map((t) => `- “${t.says}” → ${(t.ids ?? []).join(", ")}${t.because ? ` (${t.because})` : ""}`).join("\n") : "(nothing named)"}`,
		`# Everything that changed in the scene\n${diff.length ? diff.map((l) => `- ${l}`).join("\n") : "(nothing changed)"}`,
		`# The reply\n"""\n${reply ?? ""}\n"""`,
		"Check it and answer as one JSON object."
	].filter(Boolean).join("\n\n")
	const routing = { version: 2, defaults: { retries: 2, backoffMs: 1500, maxBackoffMs: 20000, timeoutMs: 60000, budgetMs: 150000, minAttemptMs: 8000, idleTimeoutMs: 60000 }, models: { "claude-group/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"], stream: true }, "aws-bedrock/global.anthropic.claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] } }, steps: { verify: { model: "claude-group/claude-opus-5-5", fallbacks: ["aws-bedrock/global.anthropic.claude-opus-5-5"], params: { max_tokens: 3000, reasoning_effort: "low" }, timeoutMs: 60000, budgetMs: 150000, retries: 1, stream: true } } }
	const validate = (v) => {
		const errors = []
		if (typeof v?.ok !== "boolean") errors.push("ok must be true or false")
		if (!Array.isArray(v?.problems)) errors.push("problems must be a list")
		return { ok: !errors.length, errors, warnings: [], value: { ok: v?.ok, problems: (v?.problems ?? []).map(String).slice(0, 8) } }
	}
	const out = await withSlot(() => F.core.callModel("verify", { system: SYSTEM, content, routing, fetch: F.fetchH1, validate }))
	return { ...out.result, ms: out.ms, usage: out.usage, model: out.model }
}
