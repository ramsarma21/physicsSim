// How well an observation of a concept picture found the cast the picture was asked to show (no ground truth for generated concepts:
// the cast IS the intended content). Each observed object is assigned to the cast type whose name, key or tag it matches best (the longest
// matching phrase); recall = cast types found, exact = cast types whose observed count equals the asked count, extras = observed objects
// that match no cast type (tables, backdrops, arrows, labels, pins and posts are not counted).
import { catalogInfo } from "./catalog-info.mjs"

const info = await catalogInfo()
const IGNORE = /\b(table|tabletop|backdrop|background|wall|floor|arrow|arrows|label|labels|number|text|pin|post|peg holder|shadow|surface|desk)\b/i
const norm = (s) => ` ${String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `

function terms(type) {
	const t = info.types.get(type)
	const raw = info.cat.index.types[type]
	const out = new Set([type.replace(/-/g, " "), t?.name?.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/,.*$/, "") ?? ""])
	for (const tag of raw?.tags ?? []) out.add(String(tag).toLowerCase())
	return [...out].filter((x) => x && x.length >= 3)
}

export function castMatch(observation, prepass) {
	const objs = Array.isArray(observation?.objects) ? observation.objects : []
	const cast = prepass?.cast ?? []
	const T = cast.map((c) => ({ type: c.type, count: c.count, terms: terms(c.type), seen: 0, objs: 0 }))
	let extras = 0
	for (const o of objs) {
		const label = norm(`${o.label} ${o.material ?? ""}`)
		let best = null
		let bestLen = 0
		for (const x of T)
			for (const term of x.terms)
				if (label.includes(` ${term} `) && term.length > bestLen) {
					best = x
					bestLen = term.length
				}
		if (best) {
			best.seen += Number.isInteger(o.count) && o.count > 0 ? o.count : 1
			best.objs++
		} else if (!IGNORE.test(String(o.label))) extras++
	}
	const n = T.length || 1
	return {
		recall: T.filter((x) => x.seen > 0).length / n,
		exact: T.filter((x) => x.seen === x.count).length / n,
		extras,
		objects: objs.length,
		side: /side/i.test(String(observation?.view?.camera ?? "")),
		camera: observation?.view?.camera ?? null,
		uncertain: Array.isArray(observation?.uncertain) ? observation.uncertain.length : 0,
		story: Array.isArray(observation?.motion_story) ? observation.motion_story.length : 0,
		perType: T.map((x) => ({ type: x.type, want: x.count, seen: x.seen }))
	}
}
