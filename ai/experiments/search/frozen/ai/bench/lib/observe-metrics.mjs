// Direct quality of an observation (the observe step's answer) against a ground-truth render (gt/<id>.meta.json: every item's true box in the
// picture, 0..1 from the top-left). Labels are free text, so matching is by place: an observed object matches a ground-truth item when their boxes
// overlap well (IoU ≥ 0.3), or — for an object the model reported as a group (count > 1: "7 dominoes") — when its box covers most of the item.
//   const m = observeMetrics(observation, meta, "gt/rube-goldberg.png", gtScene)
//   // {gt_items, found, recall, recall_iou50, mean_best_iou, precision, false_objects, units: {gt, observed, abs_err}, groups: [...], ...}
const ENV = /^(the )?((wooden|wood|white|grey|gray|light|dark|brown|plain|long|large) )*(table|table ?top|tabletop|floor|ground|wall|walls|background|back ?wall|backdrop|room|shadow|shadows|stage|scene|desk ?top|desk|surface|work ?surface|counter|countertop)( surface| top| edge)?$/i
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const iou = (a, b) => {
	const i = inter(a, b)
	const u = area(a) + area(b) - i
	return u > 0 ? i / u : 0
}
const cover = (obs, g) => (area(g) > 0 ? inter(obs, g) / area(g) : 0) // how much of g lies inside obs
const MULTI = { "domino-row": "count", "newtons-cradle": "count" }
const PART = /\b(frame|stands?|base|support|supports|holders?|legs?|string|strings|rope|rod|arm|posts?|poles?|pegs?|hanger|pivot|axle|plate|wire|wires|cable|cables)\b/i
const MULTI_DEFAULT = { "domino-row": 7, "newtons-cradle": 5 }
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)

function okBox(b) {
	return Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && Number.isFinite(v)) && b[2] > b[0] && b[3] > b[1]
}

/** catalog (optional): score.mjs loadCatalog() — for the defaults of a multi-unit item's count when its props leave it out. */
export function observeMetrics(obs, meta, file, gtScene, catalog = null) {
	const items = (meta.items ?? [])
		.filter((it) => it.type !== "table" && it.type !== "wall" && okBox(it.image_box?.[file]))
		.map((it) => {
			const props = gtScene?.items?.find((x) => x.id === it.id)?.props ?? it.props ?? {}
			const dflt = catalog?.types?.get?.(it.type)?.defaults?.[MULTI[it.type]] ?? MULTI_DEFAULT[it.type] ?? 1
			return { id: it.id, type: it.type, box: it.image_box[file], units: MULTI[it.type] ? Math.round(props[MULTI[it.type]] ?? dflt) : 1 }
		})
	const objs = (Array.isArray(obs?.objects) ? obs.objects : [])
		.filter((o) => (o.image ?? 0) === 0 && okBox(o.bbox) && !ENV.test(String(o.label ?? "").trim()))
		.map((o, i) => ({ i, label: String(o.label ?? ""), count: Number.isFinite(o.count) ? Math.max(1, Math.round(o.count)) : 1, box: o.bbox.map((v) => Math.max(0, Math.min(1, v))) }))
	const envCount = (Array.isArray(obs?.objects) ? obs.objects : []).length - objs.length
	const match = (o, g) => iou(o.box, g.box) >= 0.3 || ((o.count > 1 || g.units > 1) && cover(o.box, g.box) >= 0.6 && area(o.box) <= 25 * area(g.box) * Math.max(1, o.count))
	const insideOf = (o, g) => area(o.box) > 0 && inter(o.box, g.box) / area(o.box) >= 0.6
	const isPart = (o) => PART.test(o.label)
	const union = (os) => os.reduce((b, o) => [Math.min(b[0], o.box[0]), Math.min(b[1], o.box[1]), Math.max(b[2], o.box[2]), Math.max(b[3], o.box[3])], [1, 1, 0, 0])
	// a ground-truth item is found by an object that matches it, or — for a multi-unit item (a domino row, a Newton's cradle) — by the objects
	// inside it that together cover it (each domino of a growing row reported on its own, as the prompt asks for things that differ)
	const perItem = items.map((g) => {
		const best = objs.reduce((m, o) => Math.max(m, iou(o.box, g.box)), 0)
		const direct = objs.filter((o) => match(o, g))
		const parts = g.units > 1 ? objs.filter((o) => insideOf(o, g) && !isPart(o)) : []
		const viaParts = parts.length > 0 && iou(union(parts), g.box) >= 0.3
		const counted = [...new Set([...direct.filter((o) => !isPart(o)), ...(g.units > 1 ? parts : [])])]
		return { g, id: g.id, type: g.type, units: g.units, best_iou: r3(best), found: direct.length > 0 || viaParts, by: [...new Set([...direct, ...(viaParts ? parts : [])])].map((o) => o.label), counted }
	})
	// an object that matches nothing is "false" unless it overlaps a ground-truth item or lies mostly inside one (a part of a compound item: the
	// Atwood machine's pulley wheel, a pendulum's string, a plank's legs)
	// (stands, posts and holders the app draws under held things count as parts too)
	const used = new Set(objs.filter((o) => isPart(o) || items.some((g) => match(o, g) || iou(o.box, g.box) >= 0.1 || insideOf(o, g))).map((o) => o.i))
	const falseObjs = objs.filter((o) => !used.has(o.i))
	// counted things: each group of same-type ground-truth units (a domino row's dominoes, five separate bricks...) vs the counts reported by the
	// objects that cover them (frames, stands and strings left out)
	const byType = new Map()
	for (const p of perItem) {
		const e = byType.get(p.type) ?? { type: p.type, gt: 0, objs: new Set() }
		e.gt += p.units
		for (const o of p.counted) e.objs.add(o)
		byType.set(p.type, e)
	}
	const groups = [...byType.values()].filter((e) => e.gt >= 2).map((e) => {
		const os = [...e.objs]
		const n = os.reduce((s, o) => s + o.count, 0)
		return { type: e.type, gt: e.gt, observed: n, exact: n === e.gt, labels: os.map((o) => `${o.label}×${o.count}`) }
	})
	const unitsGT = groups.reduce((s, g) => s + g.gt, 0)
	const unitsObs = groups.reduce((s, g) => s + g.observed, 0)
	const found = perItem.filter((p) => p.found).length
	return {
		gt_items: items.length,
		found,
		recall: items.length ? r3(found / items.length) : null,
		recall_iou50: items.length ? r3(perItem.filter((p) => p.best_iou >= 0.5).length / items.length) : null,
		mean_best_iou: items.length ? r3(perItem.reduce((s, p) => s + p.best_iou, 0) / items.length) : null,
		objects: objs.length,
		environment_objects: envCount,
		precision: objs.length ? r3(1 - falseObjs.length / objs.length) : null,
		false_objects: falseObjs.map((o) => o.label),
		units: { gt: unitsGT, observed: unitsObs, abs_err: Math.abs(unitsGT - unitsObs), rel_err: unitsGT ? r3(Math.abs(unitsGT - unitsObs) / unitsGT) : null }, // (multi-unit groups only)
		groups,
		groups_exact: groups.length ? r3(groups.filter((g) => g.exact).length / groups.length) : null,
		missed: perItem.filter((p) => !p.found).map((p) => `${p.id} (${p.type})`),
		per_item: perItem.map(({ g, counted, ...p }) => p)
	}
}
