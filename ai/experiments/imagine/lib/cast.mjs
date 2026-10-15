// The quick pre-pass of a text request against the catalog: which catalog items would build it (the "cast", with counts and true sizes),
// what is not in the library, and a short left-to-right description of the START of the scene laid out so the story physically works.
// It feeds the concept-image prompt (lib/prompts.mjs) so the picture only shows things the builder can build, at their true sizes.
//   const r = await castFor("a ball rolls down a ramp into a cup", { model: "opus-low" })
//   // {ok, result: {cast: [{type, count, role, size}], missing, layout, story}, ms, usage, model} | {ok: false, error}
import { callConfig } from "../../../bench/lib/gateway.mjs"
import { getCatalog } from "../../../catalog-digest.mjs"
import { catalogInfo, sizePhrase } from "./catalog-info.mjs"
import { gated } from "./sem.mjs"

const OPUS = "claude-group/claude-opus-5-5"
export const CAST_CONFIGS = {
	"opus-low": { id: "opus-low", model: OPUS, params: { max_tokens: 6000, reasoning_effort: "low" } },
	"haiku": { id: "haiku", model: "claude-group/claude-haiku-5-5", params: { max_tokens: 4000 } },
	"sonnet-low": { id: "sonnet-low", model: "claude-group/claude-sonnet-5-5", params: { max_tokens: 6000, reasoning_effort: "low" } }
}

const SYSTEM = (brief) => `You prepare a concept picture for a physics-sandbox scene builder. The builder can only use the catalog below (true sizes, one line per type: key (name; static|dyn; outline width×height at its defaults; mass)). Everything happens on one long table (3.7 m, its top is y = 0) and ALL motion is in one vertical plane: left-right along the table and up-down, seen from the side. There are no people, animals, liquids, cloth, fire or breaking.

Given the user's request, answer with ONE JSON object:
{"cast": [{"type": catalog key, "count": n, "role": "what it does in the story, ≤ 12 words"}],
 "missing": [{"asked": "a thing the request names that the catalog lacks", "substitute_type": key or null}],
 "layout": "the START of the scene, left to right, ≤ 110 words: what stands where, what rests on what (with heights in cm where it matters), what is held up at the start, angles of ramps, gaps. Use the catalog's own sizes.",
 "story": ["what happens, in order, one short sentence per stage"]}

Rules:
- Only catalog keys in cast. Use the plainest items that do the job; counts exactly as the request says (a row of dominoes: "domino" with its count; a ramp is a "plank" (or a sheet, board or beam) leaning on a support or on its own legs).
- Lay it out so it would REALLY work in physics: a thing that must fall INTO a container drops in from above (the container's opening is below where it leaves a ramp or ledge; a ball rolling along the table into a standing cup only hits its side); a domino row is spaced about 60 % of a domino's height; a ball waiting on a slope or in the air is held by a thin pin until the start; ramps are steep enough (≥ 15°) for things to roll or slide; the chain reads left to right.
- Keep true relative sizes (a 1 m plank is 15× a 6.7 cm tennis ball).
- Build exactly what the request asks, no more: no extra targets, props, decorations or stages it does not ask for (only a vague request like "something fun" gets a lively version of your choice). A plank ramp stands on its own wooden legs: add books, blocks or boxes under it only when the request names them or the story needs a raised ledge.
- A thing held at the start (in the air, on a slope) is simply "held": never list a peg, pin, post or stand for it (the builder draws its own pull pin), and never list the stand of a pendulum (it is part of the pendulum).
- Write the final layout only, as plain statements of fact (one fact per sentence): no corrections, alternatives, instructions or second thoughts.
- Vague requests: choose a lively, concrete version with the things the request names.

# Catalog
${brief}`

function validate(v, types) {
	const errors = []
	const warnings = []
	if (!v || typeof v !== "object") return { ok: false, errors: ["answer must be a JSON object"], warnings }
	const cast = Array.isArray(v.cast) ? v.cast : []
	const kept = []
	for (const c of cast) {
		if (!c || typeof c.type !== "string") continue
		if (!types.has(c.type)) {
			warnings.push(`cast type "${c.type}" is not a catalog key: dropped`)
			continue
		}
		kept.push({ type: c.type, count: Number.isInteger(c.count) && c.count > 0 ? Math.min(c.count, 60) : 1, role: String(c.role ?? "").slice(0, 140) })
	}
	if (!kept.length) errors.push('"cast" must list at least one catalog key (exact keys from the catalog)')
	if (typeof v.layout !== "string" || v.layout.trim().length < 10) errors.push('"layout" must describe the start of the scene')
	if (errors.length) return { ok: false, errors, warnings }
	return {
		ok: true,
		errors,
		warnings,
		value: {
			cast: kept,
			missing: (Array.isArray(v.missing) ? v.missing : []).filter((m) => m && typeof m === "object").map((m) => ({ asked: String(m.asked ?? "").slice(0, 120), substitute_type: types.has(m.substitute_type) ? m.substitute_type : null })),
			layout: String(v.layout).slice(0, 1200),
			story: (Array.isArray(v.story) ? v.story : []).map((s) => String(s).slice(0, 200)).slice(0, 10)
		}
	}
}

export async function castFor(request, { model = "opus-low", signal } = {}) {
	const cat = await getCatalog()
	const info = await catalogInfo()
	const cfg = CAST_CONFIGS[model] ?? CAST_CONFIGS["opus-low"]
	const r = await gated(() =>
		callConfig("prepass", cfg, { system: SYSTEM(cat.brief), content: `# The request\n"""\n${request}\n"""\n\nAnswer as one JSON object.`, validate: (v) => validate(v, info.types), signal, timeoutMs: 90000, budgetMs: 150000 })
	)
	if (r.ok) for (const c of r.result.cast) c.size = sizePhrase(info.types.get(c.type))
	return r
}
