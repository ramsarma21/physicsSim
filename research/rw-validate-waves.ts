// The waves module against real reference values (spec/modules/waves.md §4, W1-W11, and more): every scene is built by web/sim (the same
// documents as machines/items.py: tools/parity/waves.mjs) and run by the engine (tooling/src/sim, the bundle's math), as the app runs it.
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-waves.ts [W1 … W11 | extra | all]
// Exits 1 when any check fails. References: Kinsler, Frey, Coppens & Sanders, Fundamentals of Acoustics, 4th ed. (2000) [KIN]; Fletcher &
// Rossing, The Physics of Musical Instruments, 2nd ed. (1998) [FLETCHER]; Lamb, Hydrodynamics, 6th ed. (1932) [LAMB]; ISO 16:1975 [ISO16].
import { pathToFileURL } from "node:url"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..")
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const { renderImpacts } = await import(pathToFileURL(join(PG, "web/export/audio.js")).href)
const { soundsOf } = await import(pathToFileURL(join(PG, "web/sim/modules/waves.js")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const { slimExtras } = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
const { waterWave, airSpeed } = await import(pathToFileURL(join(PG, "tooling/src/sim/waves.ts")).href)

const only = process.argv[2] ?? "all"
let failed = 0
let passed = 0
const check = (cond: boolean, what: string, detail: string) => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}  (${detail})`)
	if (cond) passed++
	else failed++
}
const within = (v: number, ref: number, rel: number) => Math.abs(v - ref) <= rel * Math.abs(ref)
const fx = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : String(v))

type Item = { id: string; type: string; x: number; y: number; props?: Record<string, unknown>; held?: boolean; angle?: number }
type Track = { frames: { t: number; placements: Record<string, { x: number; y: number; angle: number }> }[]; impacts: { t: number; a: string; b: string; speed: number }[]; state?: Record<string, Record<string, number[]>> }
const round = (v: number, d: number) => Number(v.toFixed(d))
/** Builds a scene with web/sim and runs it in the engine (the server worker's slim track). */
const run = (items: Item[], { seconds = 3, release = 0.2, width = 3.7, tableX = 1.3, settings }: { seconds?: number; release?: number; width?: number; tableX?: number; settings?: Record<string, unknown> } = {}) => {
	const scene = sim.clean({
		version: 2, id: "v", name: "v", seconds, release, stage: { x0: tableX - width / 2 - 0.1, x1: tableX + width / 2 + 0.1, y0: -0.2, y1: 3 },
		items: [{ id: "table", type: "table", x: tableX, y: 0, props: { width } }, ...items], goals: [], ...(settings ? { settings } : {})
	})
	const lay = sim.layout(scene)
	const { scene: s } = admitDocument(lay.doc)
	const tr = simulate(s, 120)
	const track: Track = JSON.parse(JSON.stringify({ fps: tr.fps, frames: tr.frames.map((f: Track["frames"][number]) => ({ t: round(f.t, 6), placements: f.placements })), impacts: tr.impacts, ...slimExtras(tr, round) }))
	const last = (item: string, key: string) => (track.state?.[item]?.[key] ?? []).at(-1) as number
	const series = (item: string, key: string) => track.state?.[item]?.[key] ?? []
	return { scene, doc: lay.doc, track, last, series, T: track.frames.map((f) => f.t) }
}
const want = (name: string) => only === "all" || only === name

// ---------------------------------------------------------------- W1: a shorter ruler, a higher pitch
if (want("W1")) {
	// acrylic 3 mm, E 3.2 GPa, ρ 1190: f₁ = 1.875²/(2π)·(t/L²)·√(E/(12ρ)) ≈ 0.795/L² [FLETCHER §2.11; spec]: 15 cm → 35.3 Hz, 10 cm → 79.5 Hz
	const a = run([{ id: "r", type: "plucked-ruler", x: 0, y: 0, props: { overhang: 0.15 } }])
	const b = run([{ id: "r", type: "plucked-ruler", x: 0, y: 0, props: { overhang: 0.1 } }])
	const fa = a.last("r", "pitch")
	const fb = b.last("r", "pitch")
	check(within(fa, 0.795 / 0.0225, 0.01) && within(fb, 0.795 / 0.01, 0.01), "W1 ruler pitch = 0.795/L² (acrylic 3 mm)", `15 cm ${fx(fa, 2)} Hz (≈35), 10 cm ${fx(fb, 2)} Hz (≈79)`)
	check(within(fb / fa, 2.25, 0.02), "W1 pitch ratio (15/10)² = 2.25 ± 2 %", fx(fb / fa, 4))
	check(a.last("r", "struck") === 1 && b.last("r", "struck") === 1, "W1 each ruler is plucked once", `${a.last("r", "struck")}, ${b.last("r", "struck")}`)
}

// ---------------------------------------------------------------- W2: a harder hit, louder, and the rice jumps higher
if (want("W2")) {
	const drum = (strength: number) =>
		run([
			{ id: "d", type: "drum", x: 0.5, y: 0, props: { strength, strike_at: 0.8 } },
			{ id: "rice", type: "rice", x: 0.5, y: 0.16, props: { count: 1, spread: 0 } },
			{ id: "m", type: "sound-meter", x: 1.5, y: 0 }
		])
	const soft = drum(0.5)
	const hard = drum(1.0)
	const ds = soft.last("m", "peak:d")
	const dh = hard.last("m", "peak:d")
	check(Math.abs(dh - ds - 6.02) <= 0.5, "W2 twice the strength: +6 dB ± 0.5 at the same meter", `${fx(ds, 2)} → ${fx(dh, 2)} dB: +${fx(dh - ds, 2)}`)
	const rise = (r: ReturnType<typeof run>) => {
		const ys = r.track.frames.map((f) => f.placements["rice/grain1"]?.y).filter((v): v is number => v !== undefined)
		return Math.max(...ys) - ys[0]
	}
	const rs = rise(soft)
	const rh = rise(hard)
	// the grain leaves at the head's peak speed (amplitude × 2πf, ∝ strength): its hop ∝ strength² (×4), less the air's drag
	check(rh > rs && within(rh / rs, 4, 0.25), "W2 the rice jumps higher for the harder hit (hop ∝ strength²)", `${fx(rs * 1000, 1)} mm → ${fx(rh * 1000, 1)} mm (×${fx(rh / rs, 2)})`)
}

// ---------------------------------------------------------------- W3: farther, quieter; and later
if (want("W3")) {
	// a fork 1, 2 and 4 m from three meters, no walls; microphones at the height of the sound's point (−20·log10 r: −6.02 dB per doubling [KIN §5.11])
	// (a bare fork's sound comes from between its prongs, 14.07 cm over its base: block 2.5 + stem 5.5 + bend 0.8 + half a 440 Hz prong 5.27;
	// each meter's microphone at that height, d metres along)
	const items: Item[] = [{ id: "f", type: "tuning-fork", x: -0.4, y: 0, props: { box: false } }]
	for (const d of [1, 2, 4]) items.push({ id: `m${d}`, type: "sound-meter", x: -0.4 + d, y: 0, props: { height: 0.14072 + 0.011 } })
	const r = run(items, { width: 5.5, tableX: 2.2 })
	const p = [1, 2, 4].map((d) => r.last(`m${d}`, "peak:f"))
	check(Math.abs(p[0] - p[1] - 6.02) <= 0.2 && Math.abs(p[1] - p[2] - 6.02) <= 0.2, "W3 −6.0 dB per doubling of distance ± 0.2", `${p.map((v) => fx(v, 2)).join(" / ")} dB: ${fx(p[0] - p[1], 2)}, ${fx(p[1] - p[2], 2)}`)
	const at = [1, 2, 4].map((d) => (r.last(`m${d}`, "at:f") - 0.5) * 1000)
	const c = airSpeed(20)
	const ok = [1, 2, 4].every((d, i) => Math.abs(at[i] - (d / c) * 1000) <= 0.05)
	check(ok, "W3 arrival delays 2.9, 5.8, 11.7 ms (distance ÷ 343.2 m/s)", at.map((v) => `${fx(v, 2)} ms`).join(", "))
}

// ---------------------------------------------------------------- W4: an echo off a wall 17.15 m away
if (want("W4")) {
	// a clapper 17.15 m from a hard wall, the meter just behind it (farther from the wall): the echo returns 2d/c = 0.0999 s after the
	// direct sound [KIN]
	const r = run(
		[
			{ id: "clap", type: "clapper", x: 1, y: 0, props: { strike_at: 0.3 } },
			{ id: "m", type: "sound-meter", x: 0.7, y: 0, props: { height: 0.35 } },
			{ id: "wall", type: "wall", x: 18.15, y: 0, props: { height: 3, material: "steel" } }
		],
		{ width: 20, tableX: 9, seconds: 1 }
	)
	const echo = r.last("m", "echo")
	const want = (2 * 17.15) / airSpeed(20) - 0.0
	// (the meter stands 0.3 m behind the clapper, and the wall's face is its centre line minus half its 5 cm: the path difference is 2 × the
	// clapper's distance to the wall's centre line)
	check(Math.abs(echo - 0.1) <= 0.0005 + Math.abs(want - 0.1), "W4 echo 0.100 s ± 0.5 ms after the direct sound", `${fx(echo, 5)} s (2d/c = ${fx(want, 5)} s)`)
	const foam = run(
		[
			{ id: "clap", type: "clapper", x: 1, y: 0, props: { strike_at: 0.3 } },
			{ id: "m", type: "sound-meter", x: 0.7, y: 0, props: { height: 0.35 } },
			{ id: "p", type: "sound-panel", x: 18.15, y: 0, props: { height: 3, surface: "foam" } }
		],
		{ width: 20, tableX: 9, seconds: 1 }
	)
	check(foam.last("m", "echo") >= 0, "W4 a foam panel still sends back a (weaker) echo", `${fx(foam.last("m", "echo"), 5)} s`)
}

// ---------------------------------------------------------------- W5: a guitar string, then half as long
if (want("W5")) {
	// f = (1/2L)·√(T/μ) [KIN eq. 2.9.6]: L 0.648 m, μ 0.40 g/m, T 73 N → 329.6 Hz (E4); half as long → 659.3 Hz (E5)
	const a = run([{ id: "s", type: "monochord", x: 1, y: 0, props: { length: 0.648, gauge: 0.4, tension: 73 } }])
	const b = run([{ id: "s", type: "monochord", x: 1, y: 0, props: { length: 0.324, gauge: 0.4, tension: 73 } }])
	check(within(a.last("s", "pitch"), 329.63, 0.005), "W5 high E: 329.6 Hz ± 0.5 %", `${fx(a.last("s", "pitch"), 2)} Hz`)
	check(within(b.last("s", "pitch"), 659.26, 0.005), "W5 half as long: an octave up, 659 Hz ± 0.5 %", `${fx(b.last("s", "pitch"), 2)} Hz`)
}

// ---------------------------------------------------------------- W6: a pulse on a rope, and its reflection
if (want("W6")) {
	// v = √(T/μ) [KIN]: 10 N on 0.1 kg/m → 10 m/s: 4 m in 0.40 s; reflected upside down at a tied end
	const r = run([{ id: "rope", type: "wave-rope", x: 0, y: 0, props: { length: 4, tension: 10, weight: 0.1, frequency: 6, amplitude: 0.05, shake_at: 0.3, ribbon: 0 } }], { width: 5, tableX: 2, seconds: 1.6 })
	// the pulse's peak passes kept points 10 and 30 (1 m and 3 m along: 40 kept points over 4 m)
	const peakT = (k: number) => {
		const s = r.series("rope", `d${k}`)
		let best = 0
		let at = 0
		for (let i = 0; i < s.length && r.T[i] < 0.3 + 0.1 + 0.35; i++)
			if (Math.abs(s[i]) > best) {
				best = Math.abs(s[i])
				at = r.T[i]
			}
		return at
	}
	const v = 2 / (peakT(30) - peakT(10))
	check(within(v, 10, 0.02), "W6 the pulse runs at √(T/μ) = 10 m/s ± 2 %", `${fx(v, 3)} m/s (1 → 3 m in ${fx(peakT(30) - peakT(10), 4)} s)`)
	check(r.last("rope", "reflection") === -1, "W6 reflected upside down at the tied end", `reading ${r.last("rope", "reflection")}`)
	// (a free or open end on the floor: held up, a ring free to slide on its pole hangs μgL²/(2T) = 0.79 m down and lies on the table)
	const free = run([{ id: "rope", type: "wave-rope", x: 0, y: 0, props: { length: 4, frequency: 6, amplitude: 0.05, shake_at: 0.3, far_end: "ring on a pole", lying: "on the floor" } }], { width: 5, tableX: 2, seconds: 1.6 })
	const open = run([{ id: "rope", type: "wave-rope", x: 0, y: 0, props: { length: 4, frequency: 6, amplitude: 0.05, shake_at: 0.3, far_end: "runs on (no reflection)", lying: "on the floor" } }], { width: 5, tableX: 2, seconds: 1.6 })
	check(free.last("rope", "reflection") === 1 && open.last("rope", "reflection") === 0, "W6 a free end: same way up; an open end: nothing back", `${free.last("rope", "reflection")}, ${open.last("rope", "reflection")}`)
	// the ribbon only moves across: the wave carries energy, not the rope
	const rib = run([{ id: "rope", type: "wave-rope", x: 0, y: 0, props: { length: 4, frequency: 6, amplitude: 0.05, shake_at: 0.3, ribbon: 0.5 } }], { width: 5, tableX: 2, seconds: 1.6 })
	// (out 50 mm and back upside down, a little smaller after a real rope's losses, 1.5/s: ≈ 75 mm in all)
	check(rib.last("rope", "ribbon_across_mm") > 60 && rib.last("rope", "ribbon_along_mm") === 0, "W6 the ribbon moves across, never along", `${fx(rib.last("rope", "ribbon_across_mm"), 1)} mm across, ${fx(rib.last("rope", "ribbon_along_mm"), 1)} mm along`)
	// standing waves: a tied rope driven at f_n = n·v/(2L) shows n loops
	const loops = [1, 2, 3].map((n) => run([{ id: "rope", type: "wave-rope", x: 0, y: 0, props: { length: 4, tension: 10, weight: 0.1, shake: "keep shaking", frequency: (n * 10) / 8, amplitude: 0.01, shake_at: 0.2, damping: 1.0, ribbon: 0 } }], { width: 5, tableX: 2, seconds: 8 }).last("rope", "loops"))
	check(loops[0] === 1 && loops[1] === 2 && loops[2] === 3, "W6 standing waves: n loops at f = n·v/(2L)", loops.join(", "))
}

// ---------------------------------------------------------------- W7, W8: water waves
if (want("W7")) {
	// 2 cm deep, 5 Hz dipper, a duck 30 cm away: it bobs at 5 Hz and stays (linear waves: a surface particle's orbit is closed; the Stokes drift
	// is second order in the wave's height) [LAMB §229-231]
	const r = run([{ id: "t", type: "ripple-tank", x: 1, y: 0, props: { length: 0.6, depth: 0.02, frequency: 5, dipper_at: 0.1, floater: "duck", floater_at: 0.6, start_at: 0.3 } }], { seconds: 10 })
	const ys = r.series("t", "floater_y")
	const ups: number[] = []
	for (let i = 1; i < ys.length; i++) if (r.T[i] > 4 && ys[i - 1] < 0 && ys[i] >= 0) ups.push(r.T[i - 1] + ((r.T[i] - r.T[i - 1]) * -ys[i - 1]) / (ys[i] - ys[i - 1]))
	const period = (ups[ups.length - 1] - ups[0]) / (ups.length - 1)
	// (± 2 %: the side walls' reflections keep arriving for seconds, each easing in, which nudges the zero crossings)
	check(within(1 / period, 5, 0.02), "W7 the duck bobs at the dipper's 5 Hz ± 2 %", `${fx(1 / period, 3)} Hz`)
	const drift = Math.max(...r.series("t", "floater_drift").map(Math.abs))
	check(drift < 0.01, "W7 its net drift < 1 cm over 10 s", `largest mean offset ${fx(drift * 1000, 2)} mm`)
	const ww = waterWave(5, 0.02)
	check(within(r.last("t", "speed"), ww.c, 1e-4), "W7 the waves run at the dispersion relation's speed", `${fx(r.last("t", "speed"), 4)} m/s (√(g·h) = ${fx(Math.sqrt(9.81 * 0.02), 3)} m/s only in the shallow limit; here kh = ${fx(ww.k * 0.02, 2)})`)
}
if (want("W8")) {
	const a = run([{ id: "t", type: "ripple-tank", x: 1, y: 0, props: { depth: 0.02, frequency: 5 } }], { seconds: 1 })
	const b = run([{ id: "t", type: "ripple-tank", x: 1, y: 0, props: { depth: 0.02, frequency: 10 } }], { seconds: 1 })
	const la = a.last("t", "wavelength")
	const lb = b.last("t", "wavelength")
	check(lb < la, "W8 shorter waves at 10 Hz than at 5 Hz", `${fx(la * 100, 2)} cm → ${fx(lb * 100, 2)} cm`)
	const ok = [[a, 5, la], [b, 10, lb]].every(([r, f, l]) => within((f as number) * (l as number), waterWave(f as number, 0.02).c, 0.02))
	check(ok, "W8 f·λ = the dispersion relation's phase speed ± 2 %", `${fx(5 * la, 4)}, ${fx(10 * lb, 4)} m/s`)
}

// ---------------------------------------------------------------- W9: collisions make sounds (the export's impact audio)
if (want("W9")) {
	const r = run(
		[
			{ id: "a", type: "billiard-ball", x: 0.6, y: 0.03, props: {} },
			{ id: "b", type: "billiard-ball", x: 1.2, y: 0.03, props: {} },
			{ id: "blk", type: "wooden-block", x: 2.0, y: 0.6, props: {} },
			{ id: "ramp", type: "plank", x: 0.3, y: 0.15, angle: -20, props: { length: 0.6 } },
			{ id: "c", type: "billiard-ball", x: 0.1, y: 0.3, held: true }
		],
		{ seconds: 3, release: 0.3 }
	)
	const out = renderImpacts(r.track.impacts, r.doc, { duration: 3, track: r.track, sampleRate: 48000 }) as { events: { t: number; a: string; b: string; peak?: number; amp?: number; speed?: number }[] }
	const ev = out.events ?? []
	const frame = 1 / 120
	const matched = r.track.impacts.filter((h) => ev.some((e) => Math.abs(e.t - h.t) <= frame))
	check(r.track.impacts.length > 0 && matched.length === r.track.impacts.length, "W9 every impact makes an audio event at its time ± 1 frame", `${matched.length} of ${r.track.impacts.length} impacts, ${ev.length} events`)
	const lv = ev.map((e) => ({ v: (e as { speed?: number }).speed ?? 0, a: (e as { amp?: number; peak?: number }).amp ?? (e as { peak?: number }).peak ?? 0 })).filter((x) => x.v > 0 && x.a > 0)
	const sorted = [...lv].sort((p, q) => p.v - q.v)
	check(sorted.length < 2 || sorted[sorted.length - 1].a >= sorted[0].a, "W9 a faster impact is louder", sorted.length ? `${fx(sorted[0].v, 2)} m/s → ${fx(sorted[sorted.length - 1].v, 2)} m/s` : "levels not reported")
}

// ---------------------------------------------------------------- W10: no sound in a vacuum
if (want("W10")) {
	const r = run([{ id: "jar", type: "bell-jar", x: 0.5, y: 0, props: { pump_at: 1, pump_for: 4, air_left: 0 } }, { id: "m", type: "sound-meter", x: 1.5, y: 0, props: { room: 0, weighting: "dB(Z)" } }], { seconds: 6 })
	const lv = r.series("m", "level")
	const at = (t: number) => lv[r.T.findIndex((x) => x >= t)]
	const drop = at(0.9) - at(5.9)
	check(drop >= 30, "W10 pumped empty, the meter outside falls ≥ 30 dB (to what the plate carries)", `${fx(at(0.9), 1)} → ${fx(at(5.9), 1)} dB: −${fx(drop, 1)} dB`)
	// and a whole room in a vacuum (settings.air false) carries nothing through the air: the meter reads its room level
	const v = run([{ id: "f", type: "tuning-fork", x: 0.5, y: 0 }, { id: "m", type: "sound-meter", x: 1.5, y: 0, props: { room: 20 } }], { settings: { air: false } })
	check(Math.max(...v.series("m", "level")) === 20, "W10 in a vacuum (air off) the meter hears nothing", `${fx(Math.max(...v.series("m", "level")), 2)} dB`)
}

// ---------------------------------------------------------------- W11: xylophone bars
if (want("W11")) {
	// f₁ = 4.730²/(2π)·(t/L²)·√(E/(12ρ)) [FLETCHER §2.13]: aluminium (69 GPa, 2700) 6 mm × 20 cm → 779 Hz; length ÷ √2 → twice the pitch
	const a = run([{ id: "b", type: "xylophone-bar", x: 1, y: 0, props: { length: 0.2, thickness: 6 } }])
	const b = run([{ id: "b", type: "xylophone-bar", x: 1, y: 0, props: { length: 0.141, thickness: 6 } }])
	check(within(a.last("b", "pitch"), 779, 0.01), "W11 aluminium 6 mm × 20 cm: 779 Hz ± 1 %", `${fx(a.last("b", "pitch"), 1)} Hz`)
	check(within(b.last("b", "pitch"), 1558, 0.01), "W11 14.1 cm: ≈ 1558 Hz ± 1 %", `${fx(b.last("b", "pitch"), 1)} Hz`)
}

// ---------------------------------------------------------------- extras: warm air, sound through steel, a Slinky, a pendulum, audio events
if (want("extra")) {
	// sound is faster in warm air: c = 331.3·√(1 + T/273.15) [KIN §5.6]: at 40 °C 355.0 m/s; 3 m arrives 0.30 ms sooner than at 20 °C
	// (a fork on its box sounds 19.07 cm over its base; the meter 3 m along with its microphone at that height)
	const cold = run([{ id: "f", type: "tuning-fork", x: -0.3, y: 0 }, { id: "m", type: "sound-meter", x: 2.7, y: 0, props: { height: 0.19072 + 0.011 } }], { settings: { room_temp: 0 } })
	const warm = run([{ id: "f", type: "tuning-fork", x: -0.3, y: 0 }, { id: "m", type: "sound-meter", x: 2.7, y: 0, props: { height: 0.19072 + 0.011 } }], { settings: { room_temp: 40 } })
	const dc = cold.last("m", "at:f") - 0.5
	const dw = warm.last("m", "at:f") - 0.5
	check(within(3 / dc, 331.3, 0.002) && within(3 / dw, airSpeed(40), 0.002), "extra the speed of sound follows the room's temperature", `0 °C ${fx(3 / dc, 1)} m/s, 40 °C ${fx(3 / dw, 1)} m/s`)
	// sound through a steel rod reaches a meter pressed to it first: 1 m of steel in 1/5050 s [KIN Appendix A10]
	const rod = run(
		[
			{ id: "rod", type: "steel-rod", x: 1, y: 0.004, angle: 0, props: { length: 1.2 } },
			{ id: "f", type: "tuning-fork", x: 0.5, y: 0.008, props: { box: false, strike_at: 0.5 } },
			{ id: "m", type: "sound-meter", x: 1.5, y: 0.008, props: { listen: "touching" } }
		],
		{ seconds: 1 }
	)
	const tRod = rod.last("m", "at:f") - 0.5
	// (along the rod from the fork's sound point over x 0.5 to the meter's over x 1.5: 1.0 m of steel)
	check(Math.abs(tRod - 1.0 / 5050) < 6e-6, "extra a meter pressed to a steel rod hears the fork through it first: 1 m in 0.198 ms (5050 m/s; the track keeps 0.01 ms)", `${fx(tRod * 1000, 4)} ms (air: ${fx((1 / airSpeed(20)) * 1000, 3)} ms)`)
	// sound through water: a hydrophone under the water of a tank hears a fork struck in the same water at 1481 m/s [KIN A10]; out of the water, a
	// meter in the air hears it only through the air (the fork's sound in the water crossing the surface is not modelled the other way)
	if (sim.catalog().types.some((t: { key: string }) => t.key === "water-tank")) {
		const w = run(
			[
				{ id: "tank", type: "water-tank", x: 1.0, y: 0 },
				{ id: "fork", type: "tuning-fork", x: 1.05, y: 0.01, props: { box: false, strike_at: 0.5 } },
				{ id: "h", type: "hydrophone", x: 0.4, y: 0, props: { reach: 0.45, probe_height: 0.08 } }
			],
			{ seconds: 1 }
		)
		const d = Math.hypot(1.05 - 0.85, 0.01 + 0.14072 - 0.08)
		const tw = w.last("h", "at:fork") - 0.5
		check(Math.abs(tw - d / 1481) < 6e-6, "extra a hydrophone hears a fork in the same water at 1481 m/s", `${fx(tw * 1000, 4)} ms over ${fx(d, 4)} m (water ${fx((d / 1481) * 1000, 4)} ms, air ${fx((d / airSpeed(20)) * 1000, 3)} ms)`)
	}
	// an oscilloscope: its microphone hears as a sound meter (flat dB(Z), fast) with its microphone at the same point does; its screen's numbers:
	// waves across = f × 10 squares × the time a square (440 Hz at 1 ms a square: 4.4), height = √2 · 20 µPa · 10^(L/20) ÷ the pressure a
	// square [KIN: p_rms = p_ref · 10^(L/20), p_ref 20 µPa; a sine's peak √2 × its rms]; 70 dB at 1 m heard 0.5 m away: +6.0 dB (spreading)
	{
		const speaker = { id: "sp", type: "speaker", x: 0.5, y: 0, props: { pitch: 440, level: 70, on_at: 0.3, on_for: 1 } }
		const so = run([speaker, { id: "o", type: "oscilloscope", x: 0.79, y: 0 }], { seconds: 1.5 })
		const sm = run([speaker, { id: "m", type: "sound-meter", x: 1.0, y: 0, props: { height: 0.211, weighting: "dB(Z)", response: "fast" } }], { seconds: 1.5 })
		const lo = so.series("o", "level")
		const lm = sm.series("m", "level")
		const same = lo.length === lm.length && lo.every((v, i) => Math.abs(v - lm[i]) < 1e-9)
		const heardHz = Math.max(...so.series("o", "pitch"))
		check(same && heardHz === 440, "extra an oscilloscope's microphone reads as a dB(Z) fast meter at the same point, pitch 440 Hz", `peak ${fx(Math.max(...lo), 3)} vs ${fx(Math.max(...lm), 3)} dB, pitch ${heardHz} Hz`)
		const src = so.doc.processes.find((p: { item: string; role: string }) => p.item === "sp" && p.role === "source")
		const box = so.doc.solids.find((s: { id: string }) => s.id === src.solid)
		const r = Math.hypot(1.0 - (box.at.x + src.at.x), 0.2 - (box.at.y + src.at.y))
		const L = 70 - 20 * Math.log10(r)
		const peakPa = Math.SQRT2 * 2e-5 * Math.pow(10, Math.max(...lo) / 20)
		const theoryPa = Math.SQRT2 * 2e-5 * Math.pow(10, L / 20)
		check(within(peakPa, theoryPa, 0.02) && within(440 * 10 * 0.001, 4.4, 1e-12), "extra its screen: 4.4 waves across at 1 ms a square; the wave's peak pressure √2·p_ref·10^(L/20) ± 2 %", `${fx(peakPa, 4)} Pa (${fx(peakPa / 0.1, 2)} squares at 0.1 Pa a square) vs ${fx(theoryPa, 4)} Pa at ${fx(r, 3)} m (${fx(L, 2)} dB)`)
	}
	// bottles: tapped, more water = lower; blown, more water = higher (a 750 ml bottle blown empty ≈ 104 Hz: wine bottles are measured near 110 Hz)
	const tap = [0.1, 0.4, 0.7].map((fill) => run([{ id: "b", type: "glass-bottle", x: 1, y: 0, props: { fill } }]).last("b", "pitch"))
	const blow = [0.0, 0.4, 0.7].map((fill) => run([{ id: "b", type: "glass-bottle", x: 1, y: 0, props: { fill, play: "blow", size: "750 ml" } }]).last("b", "pitch"))
	check(tap[0] > tap[1] && tap[1] > tap[2] && blow[0] < blow[1] && blow[1] < blow[2] && within(blow[0], 104.3, 0.08), "extra a bottle: tapped, more water lower; blown, more water higher (750 ml blown empty ≈ 104 Hz)", `tap ${tap.map((v) => fx(v, 0)).join(" > ")} Hz; blow ${blow.map((v) => fx(v, 1)).join(" < ")} Hz`)
	// a Slinky's push runs at L·√(k/m) (3 m, 1 N/m, 0.2 kg: 6.71 m/s) [spec]
	const sl = run([{ id: "s", type: "slinky", x: 0, y: 0, props: { length: 3, stiffness: 1, spring_mass: 0.2 } }], { width: 4, tableX: 1.5 })
	check(within(sl.last("s", "speed"), 3 * Math.sqrt(5), 1e-6), "extra a Slinky's speed L·√(k/m)", `${fx(sl.last("s", "speed"), 3)} m/s`)
	// a pendulum's period 2π√(L/g)·(1 + θ²/16): the period goal measures the run
	const p = run([{ id: "p", type: "pendulum", x: 1, y: 1.2, props: { length: 1.0, start_angle: 10 } }], { seconds: 8 })
	const meta = sim.finish(p.scene, p.doc, sim.layout(p.scene).resolved, p.track)
	void meta
	const g = sim.finish({ ...p.scene, goals: [{ kind: "period", item: "p" }] }, p.doc, sim.layout(p.scene).resolved, p.track).summary.goals[0]
	const Lp = 1.0
	const theory = 2 * Math.PI * Math.sqrt(Lp / 9.81) * (1 + ((10 * Math.PI) / 180) ** 2 / 16)
	check(g && within(g.period, theory, 0.03), "extra a 1 m pendulum swings once every 2π√(L/g) (± 3 %: its bob and rod are not a point on a thread)", `${fx(g?.period, 4)} s vs ${fx(theory, 4)} s`)
	// the audio: every strike of every source is one tone event at its time, at its pitch
	const s = run([{ id: "x", type: "xylophone-bar", x: 1, y: 0, props: { hits: 3, every: 0.5, strike_at: 0.4 } }])
	const ev = soundsOf(s.doc, s.track)
	check(ev.length === 3 && ev.every((e: { t: number; hz: number }, i: number) => Math.abs(e.t - (0.4 + 0.5 * i)) < 1e-9 && within(e.hz, 779.45, 0.001)), "extra three strikes → three tones at their times and pitch", ev.map((e: { t: number; hz: number }) => `${fx(e.t, 3)} s ${fx(e.hz, 1)} Hz`).join(", "))
}

// ---------------------------------------------------------------- R: no energy from nothing, realistic limits (the 20 Oct repair)
if (want("R")) {
	const ballY = (r: ReturnType<typeof run>, sid: string) => r.track.frames.map((f) => ({ t: f.t, y: f.placements[sid]?.y })).filter((p): p is { t: number; y: number } => p.y !== undefined)
	/** The tops of a dropped ball's bounces (local highs after its first fall). */
	const bounceTops = (ys: { t: number; y: number }[]) => {
		const out: number[] = []
		let fell = false
		for (let i = 1; i < ys.length - 1; i++) {
			const a = ys[i - 1] as { y: number }
			const b = ys[i] as { y: number }
			const c = ys[i + 1] as { y: number }
			if (b.y < a.y) fell = true
			if (fell && b.y > a.y && b.y >= c.y) out.push(b.y)
		}
		return out
	}
	// a ball dropped on a drum never bounces back higher than it fell from, and each bounce is lower (the drum is never struck: its own
	// strike after the run; a ball landing on the head sounds it but never throws itself back up)
	for (const [label, ball, drum, y0] of [
		["a 7.26 kg bowling ball 0.6 m onto the default drum", "bowling-ball", {}, 0.6],
		["a golf ball 0.5 m onto a tight 20 cm drum (5000 N/m)", "golf-ball", { tension: 5000, diameter: 0.2 }, 0.5],
		["a steel ball 0.6 m onto the default drum", "steel-ball", {}, 0.6]
	] as const) {
		const r = run([{ id: "d", type: "drum", x: 1.0, y: 0, props: { ...drum, strike_at: 20 } }, { id: "b", type: ball, x: 1.0, y: y0 }], { seconds: 4 })
		const tops = bounceTops(ballY(r, "b/ball"))
		const ok = tops.length > 0 && tops.every((y, i) => y < y0 && (i === 0 || y < (tops[i - 1] as number) + 1e-4))
		check(ok, `R ${label}: never bounces above its drop height, each bounce lower`, `tops ${tops.slice(0, 6).map((y) => fx(y, 3)).join(", ")} m (dropped from ${y0} m)`)
	}
	// a 1 kg weight resting on a struck drum barely stirs: the head's 5 g (modal mass) shares its momentum with it
	for (const [label, drum] of [["the default drum struck once", {}], ["a tight 20 cm drum struck at strength 2", { strength: 2, tension: 5000, diameter: 0.2, strike_where: "middle" }]] as const) {
		const r = run([{ id: "d", type: "drum", x: 1.0, y: 0, props: { strike_at: 1.0, ...drum } }, { id: "b", type: "steel-weight-1kg", x: 1.0, y: 0.16 }], { seconds: 2.5 })
		const ys = r.track.frames.map((f) => ({ t: f.t, y: f.placements["b/weight"]?.y })).filter((p): p is { t: number; y: number } => p.y !== undefined)
		const before = ys.filter((p) => p.t >= 0.8 && p.t < 1.0).map((p) => p.y)
		const after = ys.filter((p) => p.t >= 1.0).map((p) => p.y)
		const rise = Math.max(...after) - Math.max(...before)
		check(before.length > 0 && rise < 0.001, `R a 1 kg weight on ${label} rises under 1 mm`, `${fx(rise * 1000, 3)} mm (struck ${r.last("d", "struck")} time${r.last("d", "struck") === 1 ? "" : "s"})`)
	}
	// rice hops the same on a loose and a tight head at the same strength (the stick's impulse sets the head's speed, not its tension), and
	// rice laid on a drum struck at the very moment the scene lets things go still jumps
	const hop = (props: Record<string, unknown>, release = 0.2) => {
		const r = run([{ id: "d", type: "drum", x: 1.0, y: 0, props }, { id: "rice", type: "rice", x: 1.0, y: 0.16, props: { count: 1, spread: 0 } }], { seconds: 1.6, release })
		const ys = ballY(r, "rice/grain1")
		const settle = ys.filter((p) => p.t > release + 0.05 && p.t < (Number(props.strike_at) || 0.5) - 0.01).map((p) => p.y)
		const base = settle.length ? Math.min(...settle) : (ys[0] as { y: number }).y
		return Math.max(...ys.filter((p) => p.t >= (Number(props.strike_at) || 0.5) - 0.01).map((p) => p.y)) - base
	}
	const loose = hop({ tension: 400 })
	const tight = hop({ tension: 3000 })
	check(loose > 0.008 && within(loose, tight, 0.05), "R rice jumps alike on a loose (400 N/m, 99 Hz) and a tight (3000 N/m, 272 Hz) head", `${fx(loose * 1000, 2)} mm, ${fx(tight * 1000, 2)} mm`)
	const atRelease = hop({ strike_at: 0.5 }, 0.5)
	check(atRelease > 0.008, "R rice on a drum struck the moment the scene lets go (release 0.5 s, strike 0.5 s) still jumps", `${fx(atRelease * 1000, 2)} mm`)
	// a rope shaken at its 2nd standing wave with the default 8 cm drive and a real rope's losses (1.5/s): the pattern settles, never grows
	// on; with no losses at all the air's drag and its own slant keep it bounded; it never goes through the table it hangs over
	const wide = { width: 5, tableX: 1.7 }
	for (const [label, damping, cap] of [["a real rope's losses (1.5/s)", 1.5, 0.35], ["no losses (damping 0)", 0, 0.8]] as const) {
		const r = run([{ id: "r", type: "wave-rope", x: -0.4, y: 0, props: { shake: "keep shaking", frequency: 2.5, damping } }], { ...wide, seconds: 20 })
		const st = r.track.state?.r ?? {}
		const keys = Object.keys(st).filter((k) => /^d\d+$/.test(k))
		const n = (st.d0 ?? []).length
		const most = (from: number, to: number) => Math.max(...keys.map((k) => Math.max(...(st[k] ?? []).slice(from, to).map((v) => Math.abs(v)))))
		const early = most(Math.floor(n / 4), Math.floor(n / 2))
		const late = most(Math.floor((3 * n) / 4), n)
		// the rope's lowest point over the run, from the shape (offsets from its sag) and the view's own sag
		const rec = r.doc.processes.find((p: { kind: string }) => p.kind === "wave-line")
		const L = Math.hypot(rec.b.x - rec.a.x, rec.b.y - rec.a.y)
		const sag = (x: number) => (-(rec.mass / L) * 9.81 * x * (L - x)) / (2 * rec.tension)
		let low = Infinity
		keys.forEach((k, j) => {
			const x = (j / (keys.length - 1)) * L
			for (const v of st[k] ?? []) low = Math.min(low, rec.a.y + sag(x) + v)
		})
		check(late <= Math.max(early * 1.1, 0.05) && late < cap && low >= rec.floor - 1e-6, `R a rope shaken at its 2nd harmonic (8 cm drive), ${label}: bounded and above the table`, `largest offset ${fx(early, 3)} m at 5-10 s, ${fx(late, 3)} m at 15-20 s (< ${cap}); lowest point ${fx(low, 3)} m (table + rope ${fx(rec.floor, 3)} m)`)
	}
	// a Slinky pushed at its 2nd standing wave: its coils clash at its closed length instead of passing through each other
	{
		const r = run([{ id: "s", type: "slinky", x: -0.4, y: 0, props: { shake: "keep shaking", frequency: 2.236 } }], { ...wide, seconds: 20 })
		const st = r.track.state?.s ?? {}
		const keys = Object.keys(st).filter((k) => /^d\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
		const rec = r.doc.processes.find((p: { kind: string }) => p.kind === "wave-line")
		const L = Math.hypot(rec.b.x - rec.a.x, rec.b.y - rec.a.y)
		const gapKept = (L / (keys.length - 1)) * (1 - rec.closed / L)
		let worst = Infinity
		let most = 0
		const n = (st.d0 ?? []).length
		for (let f = 0; f < n; f++)
			for (let j = 0; j + 1 < keys.length; j++) {
				const a = (st[keys[j] as string] as number[])[f] as number
				const b = (st[keys[j + 1] as string] as number[])[f] as number
				worst = Math.min(worst, b - a + gapKept)
				most = Math.max(most, Math.abs(a))
			}
		check(worst >= -1e-4 && most < 0.5, "R a Slinky pushed at its 2nd harmonic: its coils never pass through each other, its motion stays bounded", `closest kept coils ${fx(worst * 1000, 2)} mm from touching; largest offset ${fx(most, 3)} m`)
	}
	// standing waves with the default losses and a small shake (1.5 cm): n loops at n·v/(2L), settled within the run
	const loops = [1, 2, 3].map((k) => run([{ id: "r", type: "wave-rope", x: -0.4, y: 0, props: { shake: "keep shaking", frequency: (k * 10) / 8, amplitude: 0.015 } }], { ...wide, seconds: 6 }).last("r", "loops"))
	check(loops.join() === "1,2,3", "R standing waves with a real rope's losses (1.5/s) and a 1.5 cm shake: 1, 2, 3 loops at n·v/(2L)", loops.join(", "))
	// waves shorter than the rope's 2.5 cm segments carry: a slow heavy rope (1 m/s) shaken at 20 Hz (5 cm waves) gets 10 segments a wave
	{
		const r = run([{ id: "r", type: "wave-rope", x: -0.4, y: 0, props: { length: 2, tension: 1, weight: 1, lying: "on the floor", shake: "keep shaking", frequency: 20, amplitude: 0.005, damping: 0.3 } }], { ...wide, seconds: 2.8 })
		const n = r.doc.processes.find((p: { kind: string }) => p.kind === "wave-line").n
		const arr = r.last("r", "arrive")
		check(n >= 400 && arr > 0.5 + 1.7 && arr < 0.5 + 2.0, "R a 5 cm wave on a slow rope travels (its segments follow its wavelength)", `${n} segments over 2 m, reached the far end at ${fx(arr, 2)} s (1.8 m at 1 m/s after the shake at 0.5 s: ≈ 2.3 s)`)
	}
	// a heavy slack rope that would sag below the table lies on it; the wave's readings ignore its settling there (a pulse still arrives in time)
	{
		const r = run([{ id: "r", type: "wave-rope", x: -0.4, y: 0, props: { length: 4, tension: 4, weight: 1, height: 0.5, amplitude: 0.1, frequency: 2 } }], { ...wide, seconds: 3.5 })
		const arr = r.last("r", "arrive")
		// (lifting a rope off a table against gravity, the pulse may die on the way: then it never arrives; it must never be said to before it could)
		check(arr === -1 || arr > 0.5 + 1.6, "R a slack rope partly lying on the table: its pulse is never said to arrive before it could get there", `arrive ${fx(arr, 2)} s (3.6 m at 2 m/s after 0.5 s: ≈ 2.3 s at the soonest; −1: it died on the way)`)
	}
	// water waves follow the scene's gravity: on the Moon the same 5 Hz, 2 cm-deep ripples are shorter (ω² = (g·k + σk³/ρ)·tanh kh)
	{
		const lam = (gravity: string) => run([{ id: "t", type: "ripple-tank", x: 1, y: 0, props: { depth: 0.02, frequency: 5 } }], { seconds: 1, settings: { gravity } }).last("t", "wavelength")
		const e = lam("earth")
		const m = lam("moon")
		const z = lam("none")
		// (the readings keep 5 decimals)
		const near = (v: number, ref: number) => Math.abs(v - ref) <= 6e-6
		check(near(e, waterWave(5, 0.02).lambda) && near(m, waterWave(5, 0.02, 1.62).lambda) && m < e && z < m && near(z, waterWave(5, 0.02, 0).lambda), "R ripples follow the scene's gravity (Earth > Moon > none: capillary waves)", `${fx(e * 100, 2)} / ${fx(m * 100, 2)} / ${fx(z * 100, 2)} cm`)
	}
	// a turned ripple tank keeps itself level (water stays level): it runs at any angle
	{
		const a = [90, 150, -120, 180].map((angle) => {
			try {
				const r = run([{ id: "t", type: "ripple-tank", x: 1, y: 0, angle }], { seconds: 1 })
				return isFinite(r.last("t", "wavelength")) ? "ok" : "no reading"
			} catch (e) {
				return String((e as Error).message).slice(0, 80)
			}
		})
		check(a.every((v) => v === "ok"), "R a ripple tank turned 90°, 150°, −120° or 180° stays level and runs", a.join(", "))
	}
	// a rubber band can't pull more than it holds: a 1 mm band asked for 30 N is taken at its breaking pull (≈ 2.4 N, neo-Hookean G 0.5 MPa,
	// λ 6); at the same pull a wider band is stretched less, so heavier per length: lower
	{
		const f = (props: Record<string, unknown>) => run([{ id: "b", type: "rubber-band", x: 1, y: 0, props }], { seconds: 1 }).last("b", "pitch")
		const thin30 = f({ width: 1, tension: 30 })
		const thinMax = f({ width: 1, tension: 2.3888 })
		const w3 = f({ width: 3, tension: 2 })
		const w6 = f({ width: 6, tension: 2 })
		check(within(thin30, thinMax, 0.001) && w6 < w3, "R a rubber band pulls at most what it holds; at the same pull a wider band is lower", `1 mm at 30 N ${fx(thin30, 1)} Hz = at its 2.39 N ${fx(thinMax, 1)} Hz; 3 mm ${fx(w3, 1)} Hz > 6 mm ${fx(w6, 1)} Hz at 2 N`)
	}
	// the edit digest's word for a drum's loudness matches a sound meter 1 m away (dB(A), fast)
	{
		const { meterReading1m } = await import(pathToFileURL(join(PG, "web/sim/modules/waves.js")).href)
		const r = run([{ id: "d", type: "drum", x: 0.5, y: 0, props: { strength: 1.9 } }, { id: "m", type: "sound-meter", x: 1.5, y: 0, props: { height: 0.161 } }], { seconds: 2 })
		const rec = r.doc.processes.find((p: { item: string; role: string }) => p.item === "d" && p.role === "source")
		const head = r.doc.solids.find((s: { id: string }) => s.id === rec.solid)
		const est = meterReading1m(rec, 1.9)
		const meter = r.last("m", "peak:d")
		const mrec = r.doc.processes.find((p: { item: string; role: string }) => p.item === "m" && p.role === "meter")
		const body = r.doc.solids.find((s: { id: string }) => s.id === mrec.solid)
		const dist = Math.hypot(body.at.x + mrec.at.x - (head.at.x + rec.at.x), body.at.y + mrec.at.y - (head.at.y + rec.at.y))
		check(Math.abs(est - 20 * Math.log10(dist) - meter) < 1.0, "R a drum's 'a sound-meter 1 m away reads about' words match a meter there (± 1 dB)", `words ${fx(est, 1)} dB at 1 m; the meter ${fx(dist, 3)} m away reads ${fx(meter, 1)} dB (its 'sounding' reading ${fx(Math.max(...r.series("d", "sounding")), 1)} dB is unweighted, at the strike's instant)`)
	}
	// what happens on a rope and in a tank is said (the AI's card: "In the run: …")
	{
		const r = run([{ id: "r", type: "wave-rope", x: -0.4, y: 0, props: { ribbon: 0.5 } }], { ...wide, seconds: 2 })
		const texts = (r.track as { events?: { text: string }[] }).events?.map((e) => e.text) ?? []
		check(texts.some((t) => /reaches its far end/.test(t)) && texts.some((t) => /comes back upside down/.test(t)) && texts.some((t) => /ribbon on r bobs/.test(t)), "R a rope's run says what happened: the pulse reaches the far end, comes back upside down, the ribbon bobs", texts.join(" | "))
	}
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
