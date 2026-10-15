// Per-type facts for concept-image prompts: name, true size at the defaults (the outline box, w × h in metres), what it looks like (the
// digest's "Looks:" line, else the first sentence of its description), from the app's own catalog digest (ai/catalog-digest.mjs).
//   const info = await catalogInfo(); info.get("tennis-ball") -> {key, name, w, h, looks, desc, dynamic}
import { getCatalog } from "../../../catalog-digest.mjs"

let cached = null
export async function catalogInfo() {
	if (cached) return cached
	const cat = await getCatalog()
	const blocks = new Map()
	for (const b of cat.text.split("\n### ").slice(1)) {
		const key = b.slice(0, b.indexOf(" "))
		blocks.set(key, b)
	}
	const out = new Map()
	for (const [key, t] of Object.entries(cat.index.types)) {
		if (key === "table") continue
		const b = blocks.get(key) ?? ""
		const looks = /\nLooks: ([^\n]+)/.exec(b)?.[1]?.trim() ?? null
		const o = t.outline ?? {}
		const w = Number.isFinite(o.x1 - o.x0) ? o.x1 - o.x0 : null
		const h = Number.isFinite(o.y1 - o.y0) ? o.y1 - o.y0 : null
		const desc = String(t.description ?? "").split(/(?<=[.:])\s/)[0].replace(/:$/, "")
		out.set(key, { key, name: t.name, w, h, looks, desc, dynamic: !!t.dynamic, category: t.category, facts: t.facts ?? "" })
	}
	cached = { types: out, cat }
	return cached
}

/** "6.7 cm" / "1 m" */
export const fmtLen = (v) => (!Number.isFinite(v) ? "?" : v >= 1 ? `${+v.toFixed(2)} m` : v >= 0.1 ? `${Math.round(v * 100)} cm` : `${+(v * 100).toFixed(1)} cm`)
/** A size phrase for an image prompt: "6.7 cm across" for a ball, else "w × h". */
export function sizePhrase(t) {
	if (!t || !Number.isFinite(t.w) || !Number.isFinite(t.h)) return ""
	if (Math.abs(t.w - t.h) < 1e-6 && /ball|marble|Balls/i.test(`${t.name} ${t.category}`)) return `${fmtLen(t.w)} across`
	return `${fmtLen(t.w)} wide × ${fmtLen(t.h)} tall`
}
