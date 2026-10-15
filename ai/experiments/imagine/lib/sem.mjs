// One process-wide cap on model calls in flight for this experiment (text, vision AND image generation together): the gateway
// politeness rule is at most 4 at once. Every gateway call this experiment makes goes through `gated()`. A `track` object, when given,
// adds up the time spent waiting for a slot (waitMs) and inside the call (callMs), so a build's latency can be reported without the
// queueing this cap adds (a real user's build does not queue behind 5 other bench builds).
//   import { gated, setLimit, gateStats } from "./sem.mjs"
//   const t = { waitMs: 0, callMs: 0, n: 0 }; const out = await gated(() => runConfigWithRouting(...), t)
let limit = 4
let active = 0
let peak = 0
const waiters = []

export function setLimit(n) {
	limit = Math.max(1, Math.min(4, n | 0))
}
async function acquire() {
	if (active < limit) {
		active++
		peak = Math.max(peak, active)
		return
	}
	await new Promise((r) => waiters.push(r))
	active++
	peak = Math.max(peak, active)
}
function release() {
	active--
	const w = waiters.shift()
	if (w) w()
}
export async function gated(fn, track = null) {
	const t0 = Date.now()
	await acquire()
	const t1 = Date.now()
	try {
		return await fn()
	} finally {
		release()
		if (track) {
			track.waitMs = (track.waitMs ?? 0) + (t1 - t0)
			track.callMs = (track.callMs ?? 0) + (Date.now() - t1)
			track.n = (track.n ?? 0) + 1
		}
	}
}
export const gateStats = () => ({ active, waiting: waiters.length, limit, peak })
