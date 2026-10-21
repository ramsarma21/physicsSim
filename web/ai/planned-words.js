// "What I planned", kept true after tuning (core-ai, 20 Oct). The planner's reply is written before any run; the stage tuner, the critic's
// patches and the goal tuner may then change a setting it states ("Only one has a 60 cm parachute" over a box whose canopy tuning made 150 cm,
// "The band is pulled back 6 cm" over a 5 cm pull: vfy-sbfr FR3, SB7). Each such setting's number in the text becomes the one on the table, in
// the unit and the style the text wrote it in; the rest of the text is left as it is. A number that another thing on the table still has (two
// 200 N/m springs, one tuned) is left alone: the text can't tell which one it means.
// Pure, no imports: the catalog's prop specs come in as propSpec(type, key) and propKeys(type) (web/ai/solver.js).
//   refreshPlanned(text, fromPlan, toPlan, {propSpec, propKeys}) -> {text, changed: [{id, key, from, to}]}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const fin = (v) => typeof v === "number" && Number.isFinite(v)
const t = (v, d) => String(Number(v.toFixed(d)))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The ways a number of this unit may be written: [[as written before, as it is now, unit pattern]]. */
function forms(unit, a, b) {
	const out = []
	if (unit === "m") {
		out.push([t(a * 100, 1), t(b * 100, 1), "\\s?-?(?:cm|centimet(?:re|er)s?)"], [t(a * 1000, 0), t(b * 1000, 0), "\\s?-?(?:mm|millimet(?:re|er)s?)"])
		if (a >= 0.995 || b >= 0.995) out.push([t(a, 2), t(b, 2), "\\s?-?(?:m|met(?:re|er)s?)(?![a-z²³/])"])
	} else if (unit === "kg") out.push([t(a, 2), t(b, 2), "\\s?-?(?:kg|kilograms?)"], [t(a * 1000, 0), t(b * 1000, 0), "\\s?-?(?:g|grams?)(?![a-z])"])
	else if (unit === "°" || unit === "deg") out.push([t(a, 0), t(b, 0), "\\s?(?:°|degrees?)"])
	else if (typeof unit === "string" && unit.trim()) out.push([t(a, 3), t(b, 3), `\\s?-?${esc(unit.trim())}(?![a-z])`])
	return out.filter(([x, y]) => x !== y)
}

/** How a value of this unit is written, in each of its forms. */
const spelled = (unit, v) => forms(unit, v, v + 1).map(([x]) => x)

/** Each numeric setting that differs between the two plans, item by item (same id, same type): {id, key, unit, from, to}. Props (the type's
 *  default where a plan leaves one out), a held thing's height (place.y_m) and its angle (place.angle_deg). */
function settingChanges(fromPlan, toPlan, propSpec) {
	const before = new Map((fromPlan?.items ?? []).filter(isObj).map((i) => [i.id, i]))
	const out = []
	for (const it of (toPlan?.items ?? []).filter(isObj)) {
		const was = before.get(it.id)
		if (!was || was.type !== it.type) continue
		const keys = new Set([...Object.keys(isObj(was.props) ? was.props : {}), ...Object.keys(isObj(it.props) ? it.props : {})])
		for (const k of keys) {
			let spec = null
			try {
				spec = propSpec?.(it.type, k) ?? null
			} catch {}
			if (!spec || (spec.kind !== "number" && spec.kind !== "int")) continue
			const a = was.props?.[k] ?? spec.default
			const b = it.props?.[k] ?? spec.default
			if (fin(a) && fin(b) && Math.abs(a - b) > 1e-9) out.push({ id: it.id, key: k, unit: spec.unit ?? "", from: a, to: b })
		}
		const p0 = isObj(was.place) ? was.place : {}
		const p1 = isObj(it.place) ? it.place : {}
		if (p0.on === "air" && p1.on === "air" && fin(p0.y_m) && fin(p1.y_m) && Math.abs(p0.y_m - p1.y_m) > 1e-9) out.push({ id: it.id, key: "y_m", unit: "m", from: p0.y_m, to: p1.y_m })
		if (fin(p0.angle_deg) && fin(p1.angle_deg) && Math.abs(p0.angle_deg - p1.angle_deg) > 1e-9) out.push({ id: it.id, key: "angle_deg", unit: "°", from: p0.angle_deg, to: p1.angle_deg })
	}
	return out
}

/** Every value of this unit that a thing on the table has now (each prop of its type, the default where the plan leaves it out; heights and
 *  angles), but the setting `skip` itself. */
function valuesNow(toPlan, propSpec, propKeys, unit, skip) {
	const out = []
	for (const it of (toPlan?.items ?? []).filter(isObj)) {
		const own = isObj(it.props) ? it.props : {}
		let keys = null
		try {
			keys = propKeys?.(it.type) ?? null
		} catch {}
		for (const k of new Set([...(keys ? [...keys] : []), ...Object.keys(own)])) {
			if (skip.id === it.id && skip.key === k) continue
			let spec = null
			try {
				spec = propSpec?.(it.type, k) ?? null
			} catch {}
			const v = own[k] ?? spec?.default
			if (spec && (spec.unit ?? "") === unit && fin(v)) out.push(v)
		}
		const pl = isObj(it.place) ? it.place : {}
		if (unit === "m" && fin(pl.y_m) && !(skip.id === it.id && skip.key === "y_m")) out.push(pl.y_m)
		if (unit === "°" && fin(pl.angle_deg) && !(skip.id === it.id && skip.key === "angle_deg")) out.push(pl.angle_deg)
	}
	return out
}

export function refreshPlanned(text, fromPlan, toPlan, { propSpec, propKeys } = {}) {
	let s = typeof text === "string" ? text : ""
	const changed = []
	if (!s.trim() || !fromPlan || !toPlan) return { text: s, changed }
	for (const c of settingChanges(fromPlan, toPlan, propSpec)) {
		// (the same number on another thing still on the table: the text may mean that one)
		const others = valuesNow(toPlan, propSpec, propKeys, c.unit, c).flatMap((v) => spelled(c.unit, v))
		let hit = false
		for (const [from, to, unit] of forms(c.unit, c.from, c.to)) {
			const re = new RegExp(`(^|[^\\d.,])${esc(from)}(${unit})(?![\\d.,]*\\d)`, "gi")
			if (!re.test(s) || others.includes(from)) continue
			re.lastIndex = 0
			s = s.replace(re, (_, pre, u) => `${pre}${to}${u}`)
			hit = true
		}
		if (hit) changed.push({ id: c.id, key: c.key, from: c.from, to: c.to })
	}
	return { text: s, changed }
}
