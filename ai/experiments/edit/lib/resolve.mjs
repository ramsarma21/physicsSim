// A separate reference-resolution pass (for the A/B against resolving inside the edit call): which items does the request mean, and is it
// truly ambiguous? A small, fast call (Opus 5.5 low, no catalog: the rich digest and the conversation only).
//   const r = await resolveRefs({text, history, digestText})   // {targets: [{says, ids, because}], kind, ambiguous, question, ms, usage}
import { frozen } from "./env.mjs"
import { withSlot } from "./pool.mjs"

const SYSTEM = `You read one chat request about a physics-sandbox scene and say which items in the scene it refers to. The user sees the scene, not ids: they name things by colour, look, kind, size, place (left / middle / right, higher / lower, on what), role in the run ("the ball that starts it", "the thing it lands in"), names, or "it" (what the conversation was just about).
For every phrase in the request that refers to scene items, list the item ids it means. Then decide:
- kind: "question" (asks something, including "what would happen if…", "would it still…", "why…": nothing is to change), "change", "fix" (make it work / fix it), "undo", or "new" (a different scene).
- ambiguous: true ONLY when a phrase fits two or more items equally well and nothing in the request or the conversation picks one (e.g. "the ball" with a red and a yellow ball and no other hint). A plural ("the balls", "both", "all the cups") is never ambiguous. A phrase that fits one item better than the others (colour, size, place, role, name, or the conversation) is not ambiguous. A question is never ambiguous for this purpose.
- question: when ambiguous, ONE short question that names the candidates the way the user sees them ("Which ball: the red one at the top of the first ramp, or the yellow one on the seesaw?"); else "".
Answer ONE JSON object only: {"targets": [{"says": "the yellow ball", "ids": ["ball2"], "because": "the only yellow ball"}], "kind": "change", "ambiguous": false, "question": ""}`

export async function resolveRefs({ text, history = [], digestText }) {
	const F = await frozen()
	const content = [`# The scene on screen\n${digestText}`, history.length ? `# The conversation so far\n${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`).join("\n")}` : null, `# The request\n"""\n${text}\n"""`, "Answer as one JSON object."].filter(Boolean).join("\n\n")
	const routing = { version: 2, defaults: { retries: 2, backoffMs: 1500, maxBackoffMs: 20000, timeoutMs: 60000, budgetMs: 150000, minAttemptMs: 8000, idleTimeoutMs: 60000 }, models: { "claude-group/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"], stream: true }, "aws-bedrock/global.anthropic.claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] } }, steps: { resolve: { model: "claude-group/claude-opus-5-5", fallbacks: ["aws-bedrock/global.anthropic.claude-opus-5-5"], params: { max_tokens: 3000, reasoning_effort: "low" }, timeoutMs: 60000, budgetMs: 150000, retries: 1, stream: true } } }
	const validate = (v) => {
		const errors = []
		if (!Array.isArray(v?.targets)) errors.push("targets must be a list")
		if (typeof v?.ambiguous !== "boolean") errors.push("ambiguous must be true or false")
		return { ok: !errors.length, errors, warnings: [], value: { targets: v?.targets ?? [], kind: v?.kind ?? "change", ambiguous: !!v?.ambiguous, question: String(v?.question ?? "") } }
	}
	const out = await withSlot(() => F.core.callModel("resolve", { system: SYSTEM, content, routing, fetch: F.fetchH1, validate }))
	return { ...out.result, ms: out.ms, usage: out.usage, model: out.model }
}
