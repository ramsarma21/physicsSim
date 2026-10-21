// A shot plan's moments resolved against a timeline digest (web/export/digest.js): the run seconds of a moment id, and of a reading's edge.
// Pure and import-free: the shot-plan validator (ai/shot-plan.mjs) loads it with every AI step, and the engine's modules stay out of that load.
const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const MOMENT_RE = /^(.*?)(?:@([A-Za-z0-9_-]+))?$/
/**
 * Run seconds of a moment: an id ("release", "contact:a+b#2", "t=1.6", "reading:sw.running:settles", "stop:car@blue") or {at, plus}, resolved
 * as the plan executor resolves it (web/export/shots.js scopeOf momentT). lane picks one lane's run; with neither a lane nor @lane, every run
 * that has the moment counts and the latest wins. A lanes cast role in a moment id (start:car, stop:car, contact:pad+egg, event:cracks:egg)
 * is each lane's own item, the latest of them. lanesBlock: the plan's lanes. undefined when no run has it.
 */
export function momentTime(digest, m, lane = null, lanesBlock = null) {
	if (m === undefined || m === null) return undefined
	const id0 = typeof m === "string" ? m : m.at
	const plus = typeof m === "string" ? 0 : num(m.plus, 0)
	if (typeof id0 !== "string") return undefined
	const lanes = Array.isArray(lanesBlock?.list) && lanesBlock.list.length ? lanesBlock.list.map((l) => ({ ...l, cast: l.cast ?? {} })) : null
	const runKeys = Object.keys(digest.runs)
	const one = digest.runs[""] ?? null
	let base = id0
	let ln = lane
	const at = /^(.*)@([A-Za-z0-9_-]+)$/.exec(id0)
	if (at && (lanes ? lanes.some((l) => l.id === at[2]) : runKeys.includes(at[2]))) {
		base = at[1]
		ln = at[2]
	}
	if (/^t=/.test(base)) {
		const t = Number(base.slice(2))
		return Number.isFinite(t) ? t + plus : undefined
	}
	const runOf = (l) => one ?? digest.runs[l] ?? null
	const allRuns = () => (one ? [one] : lanes ? lanes.map((l) => digest.runs[l.id]).filter(Boolean) : runKeys.map((k) => digest.runs[k]))
	const rs = ln !== null && ln !== undefined && (lanes || !one) ? [runOf(ln)].filter(Boolean) : allRuns()
	const lanesFor = ln !== null && ln !== undefined && lanes ? [ln] : (lanes ?? []).map((l) => l.id)
	const isRole = (name) => !!lanes && lanes.some((l) => l.cast[name] !== undefined)
	const roleIds = (role, lid) => [].concat((lanes?.find((l) => l.id === lid) ?? lanes?.[0])?.cast[role] ?? [])
	const momentOf = (r, id) => {
		if (r.index[id] !== undefined) return r.index[id]
		const rm = /^reading:([^.]+)\.([A-Za-z0-9_]+):(.+)$/.exec(id)
		return rm ? readingEdge(r, rm[1], rm[2], rm[3]) : undefined
	}
	const vals = []
	for (const r of rs) {
		let t = momentOf(r, base)
		if (t === undefined && lanes) {
			const parts = /^(start|stop|exit|landing|apex|turn):([^#]+)(#[0-9]+)?$/.exec(base) ?? /^(contact):([^+]+)\+([^#]+)(#[0-9]+)?$/.exec(base) ?? /^(event:[A-Za-z0-9_:-]+?):([^:#]+)(#[0-9]+)?$/.exec(base)
			if (parts) {
				const ts = []
				for (const lid of lanesFor) {
					const swap = (name) => (isRole(name) ? roleIds(name, lid) : [name])
					if (parts[1] === "contact") {
						for (const a of swap(parts[2])) for (const b of swap(parts[3])) {
							const v = momentOf(r, `contact:${a}+${b}${parts[4] ?? ""}`)
							if (v !== undefined) ts.push(v)
						}
					} else
						for (const a of swap(parts[2])) {
							const v = momentOf(r, `${parts[1]}:${a}${parts[3] ?? ""}`)
							if (v !== undefined) ts.push(v)
						}
				}
				if (ts.length) t = Math.max(...ts)
			}
		}
		if (t !== undefined) vals.push(t)
	}
	return vals.length ? Math.max(...vals) + plus : undefined
}

/** The time of a reading's edge (starts, settles, peak, max, min, crosses=v), as the compiler finds it; undefined when it has none. */
export function readingEdge(runDigest, item, key, edge) {
	const vs = runDigest.series?.[`${item}.${key}`]
	if (!vs || !vs.length) return undefined
	const v0 = vs[0][1], vf = vs[vs.length - 1][1]
	let lo = Infinity, hi = -Infinity
	for (const [, v] of vs) {
		if (v < lo) lo = v
		if (v > hi) hi = v
	}
	const span = hi - lo || 1
	if (edge === "starts") return vs.find(([, v]) => Math.abs(v - v0) > 0.05 * span)?.[0]
	if (edge === "settles") {
		for (let i = vs.length - 1; i >= 0; i--) if (Math.abs(vs[i][1] - vf) > 0.02 * span) return vs[Math.min(vs.length - 1, i + 1)][0]
		return 0
	}
	if (edge === "peak" || edge === "max") return vs.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
	if (edge === "min") return vs.reduce((a, b) => (b[1] < a[1] ? b : a))[0]
	const c = /^crosses=(-?[0-9.]+)$/.exec(edge)
	if (c) {
		const x = Number(c[1])
		for (let i = 1; i < vs.length; i++) if ((vs[i - 1][1] - x) * (vs[i][1] - x) <= 0 && vs[i - 1][1] !== vs[i][1]) return vs[i][0]
	}
	return undefined
}
