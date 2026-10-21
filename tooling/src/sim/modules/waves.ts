/**
 * The waves module's process kinds (the physics is in tooling/src/sim/waves.ts):
 *
 *   "sound"   every record of a document joins ONE sound field per run (the first record's process steps it; the others only bring
 *             their records). Records, made by machines/mod_waves.py (`c.process("sound", part, role=...)`, and its build hook for walls,
 *             carriers and circuits' buzzers); `solid` = the solid the record rides on, points in that solid's own frame, times s:
 *     {role: "source", solid, at {x, y}, f0 (Hz), partials [[ratio, amplitude, τ s]], lp1 (dB SPL 1 m away at strike level 1),
 *      strikes [[t, level]], hold? (s: a blown or electric note sounds steadily this long after each strike), ring? {rate (strikes/s),
 *      from, until} (an electric bell's clapper: a strike every 1/rate s), hit? {solids, momentum (kg·m/s of a level-1 strike), max}
 *      (impacts on these solids sound it, at level = the striking body's momentum / momentum), kick? {solids, dir: "up" | "out",
 *      amp (m: the vibrating surface's amplitude at level 1), shape, size, mass (kg: the vibrating part's modal mass)} (at each of its
 *      scheduled strikes only, never at an impact's: bodies touching the vibrating part are thrown off it at its peak speed amp·level·2π·f0
 *      × the mode's shape there, shared by momentum with the part's modal mass: a 20 mg grain on a drum head leaves at the head's speed, a
 *      1 kg weight hardly moves; a strike made while the bodies are still held, or with none touching yet, waits while the part rings on,
 *      its swing dying as e^(−t/τ), τ its fundamental's), amp (m: the vibrating part's own amplitude at level 1, for the readings), jar? {from, to, t0, t1 (air % and
 *      when the pump runs), glass (dB the jar's walls take off), base (dB the base path is under the bell's own level)}}
 *     {role: "meter", solid, at, weighting "A" | "Z", response (s), floor (dB), listen "air" | "touch"}
 *     {role: "wall", solid, a, b, absorption}   a surface that reflects sound (the segment a–b)
 *     {role: "carrier", solid, a, b, half, speed, gain, material}   a solid that carries sound to a meter that touches it
 *     {role: "telephone", solid, a, b (its cups' mouths), length, diameter, rho, E, eta, tension, pinched, cup: {r, m, f, v}, reach, sag?}   a string telephone
 *       (engine6 crossmod): a source within reach of one cup's mouth is heard by a meter within reach of the other's, along the string
 *       (waves.ts telephoneOf: Ernst's sagging-string modulus, a lumped cup-string-cup two-port at 1 kHz); readings on its item: carries (0/1),
 *       sag_mm, string_ms and, while it carries, loss_db (how much quieter at the ear on the far cup than at the near cup's mouth)
 *     {role: "buzzer", solid, at, f0, lp1, on: [reading keys]}   circuits' buzzer: sounds while one of its readings is above zero
 *   Readings: a source's item: sounding (dB 1 m away now, 0 when silent), pitch (Hz), struck (strikes so far), strike_t (s, −1 before any),
 *   strike_level, amp_mm (its vibrating part's amplitude now, mm); a meter's item: peak (dB), level (dB), pitch (Hz heard most now),
 *   heard (s: first heard 3 dB over the room, −1 before), echo (s: the first echo's delay after the first sound, −1 before), and per
 *   source item S: "peak:S" (dB of S alone at this meter, its time-weighted peak) and "at:S" (s: when S's sound first arrived, −1).
 *
 *   "wave-line"  a rope or Slinky (waves.ts Line): readings speed (m/s), wavelength (m), frequency (Hz), arrive (s, −1), reflection
 *             (−1 upside down, 1 same way up, 0 none, −2 not yet), loops, end_mm (the far end's motion), ribbon_along_mm, ribbon_across_mm
 *             (the ribbon's travel so far), and the shape: d0 … d{K} (each kept point's offset across from its sag, or along for a Slinky
 *             pushed along, m), K + 1 = `keep` + 1 points. Events: the wave reaching the far end, the pulse coming back (and which way up),
 *             a standing wave's loops once they hold for two seconds, at the end the ribbon's travel; a warning when its waves are too short
 *             for its segments to carry.
 *   "ripples" a ripple tank (waves.ts Ripples): readings wavelength (m), speed (m/s), group (m/s), frequency (Hz), floater_x,
 *             floater_y (m: its offset from where it floats at rest, along and up), floater_drift (m: its mean offset over the last
 *             period), floater_bob_mm (its up-and-down range over the last period), reach (s: when the waves first reached the far end, −1).
 *             Events: the ripples reaching the far end; at the end, how far the floater bobbed and drifted.
 * Both use the run's gravity (settings.gravity): sag, and the water waves' dispersion.
 */
import type { Process, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"
import { airSpeed, type Carrier, type FieldMeter, type FieldSource, Line, LINE_MAX_SEGMENTS, type LineRec, log10, Ripples, SoundField, type TankRec, telephoneOf, type Telephone, toSegment, type Wall, type Water } from "#sim/waves.ts"

interface P {
	readonly x: number
	readonly y: number
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const pt = (v: unknown, d: P = { x: 0, y: 0 }): P => {
	const o = v as { x?: unknown; y?: unknown } | null
	return o !== null && typeof o === "object" ? { x: num(o.x, d.x), y: num(o.y, d.y) } : d
}
const finitePt = (v: unknown) => {
	const o = v as { x?: unknown; y?: unknown } | null
	return o !== null && typeof o === "object" && typeof o.x === "number" && Number.isFinite(o.x) && typeof o.y === "number" && Number.isFinite(o.y)
}
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])

/** A record's point in the world now: its solid's pose composed with the point. */
const worldOf = (ctx: ProcessContext, solid: unknown, at: P): P => {
	const h = typeof solid === "string" ? ctx.solid(solid) : undefined
	if (h === undefined) return at
	const p = h.pose()
	const c = Math.cos(p.angle)
	const s = Math.sin(p.angle)
	return { x: p.x + at.x * c - at.y * s, y: p.y + at.x * s + at.y * c }
}

// ---------------------------------------------------------------- the sound field

const ROLES = ["source", "meter", "wall", "carrier", "buzzer", "water", "telephone"] as const
const NEEDS_SOLID = new Set(["source", "meter", "wall", "carrier", "buzzer", "telephone"])

/** One run's sound: its records (in document order) and, once started, the field and what each source and meter needs. */
class SoundWorld {
	started = false
	readonly records: ProcessRecord[] = []
	field: SoundField | undefined
	sources: { rec: ProcessRecord; si: number; strikes: [number, number][]; next: number; ring?: { rate: number; from: number; until: number; nextT: number } }[] = []
	meters: { rec: ProcessRecord; mi: number; peak: number; heard: number; echo: number; perSource: Map<number, { peak: number; at: number }> }[] = []
	buzzers: { rec: ProcessRecord; si: number; on: boolean; keys: readonly string[] }[] = []
	/** Each sounding solid's touching set and each moving solid's velocity the step before (impact strikes). */
	private touchedBefore = new Map<string, Set<string>>()
	private velBefore = new Map<string, P>()
	private hitSolids = new Map<string, number[]>()
	/** Kicks waiting for a force step with something touching: the source, the solids it throws, the speed, the direction rule, the mode's
	 *  shape and size, the vibrating part's modal mass (kg; 0: no limit), when it was struck and how fast its swing dies (τ, s). */
	kicks: { si: number; solids: readonly string[]; speed: number; dir: string; shape: string; size: number; mass: number; t0: number; tau: number; done?: Set<string>; until?: number }[] = []
	/** Each carrier's own solid (a thing never "touches" itself). */
	carrierSolids: string[] = []
	/** The source's latest strike's level and time (its amplitude reading). */
	private last: { t: number; level: number }[] = []

	start(ctx: ProcessContext) {
		this.started = true
		const srcRecs = this.records.filter((r) => r.role === "source" || r.role === "buzzer")
		const fieldSources: FieldSource[] = srcRecs.map((r) => ({
			id: r.id,
			item: String(r.item ?? r.id),
			f0: num(r.f0, 440),
			partials: list(r.partials)
				.map((p) => list(p))
				.filter((p) => p.length >= 3)
				.map((p) => [num(p[0], 1), num(p[1], 1), num(p[2], 1)] as const),
			lp1: num(r.lp1, 60),
			hold: r.role === "buzzer" ? 0.05 : num(r.hold, 0)
		}))
		const meterRecs = this.records.filter((r) => r.role === "meter")
		const fieldMeters: FieldMeter[] = meterRecs.map((r) => ({
			id: r.id,
			item: String(r.item ?? r.id),
			weighting: r.weighting === "Z" ? "Z" : "A",
			response: num(r.response, 0.125),
			floor: num(r.floor, 35),
			listen: r.listen === "touch" ? "touch" : r.listen === "water" ? "water" : "air"
		}))
		const walls: Wall[] = this.records
			.filter((r) => r.role === "wall")
			.map((r) => ({ a: worldOf(ctx, r.solid, pt(r.a)), b: worldOf(ctx, r.solid, pt(r.b)), absorption: Math.max(0, Math.min(1, num(r.absorption, 0.05))), item: String(r.item ?? r.id) }))
		const carrierRecs = this.records.filter((r) => r.role === "carrier")
		this.carrierSolids = carrierRecs.map((r) => String(r.solid ?? ""))
		const carriers: Carrier[] = carrierRecs
			.map((r) => ({
				a: worldOf(ctx, r.solid, pt(r.a)),
				b: worldOf(ctx, r.solid, pt(r.b)),
				half: num(r.half, 0.01),
				speed: num(r.speed, 5050),
				gain: num(r.gain, 0),
				material: String(r.material ?? "solid"),
				item: String(r.item ?? r.id)
			}))
		const speed = ctx.settings.air ? airSpeed(ctx.settings.roomTemperature) : 0
		this.field = new SoundField(fieldSources, fieldMeters, walls, carriers, speed, ctx.step)
		this.field.waters = this.records
			.filter((r) => r.role === "water")
			.map((r): Water => ({ x0: num(r.x0, 0), x1: num(r.x1, 0), floor: num(r.floor, 0), top: num(r.top, 0), speed: num(r.speed, 1481), item: String(r.item ?? r.id) }))
		// string telephones: their strings' carrying (under the run's gravity: a string sags less on the Moon), and what they read
		const phones: Telephone[] = []
		for (const r of this.records) {
			if (r.role !== "telephone") continue
			const cup = (r.cup ?? {}) as { r?: unknown; m?: unknown; f?: unknown; v?: unknown }
			const tl = telephoneOf(
				{
					length: num(r.length, 1),
					diameter: num(r.diameter, 0.001),
					rho: num(r.rho, 764),
					E: num(r.E, 2e9),
					eta: Math.max(0, num(r.eta, 0.08)),
					tension: Math.max(0, num(r.tension, 0)),
					pinched: r.pinched === true,
					cupR: num(cup.r, 0.0265),
					cupM: num(cup.m, 0.00066),
					cupF: Math.max(0, num(cup.f, 0)),
					cupV: num(cup.v, 0.000266),
					...(typeof r.sag === "number" && Number.isFinite(r.sag) && r.sag >= 0 ? { sag: r.sag } : {})
				},
				ctx.settings.gravity
			)
			const item = String(r.item ?? r.id)
			phones.push({ a: worldOf(ctx, r.solid, pt(r.a)), b: worldOf(ctx, r.solid, pt(r.b)), length: num(r.length, 1), speed: tl.speed, ratio: tl.ratio, reach: Math.max(0, num(r.reach, 0.5)), item })
			ctx.set(item, "carries", tl.carries ? 1 : 0)
			ctx.set(item, "sag_mm", tl.sag * 1000)
			ctx.set(item, "string_ms", tl.speed)
			if (tl.carries) ctx.set(item, "loss_db", -20 * log10(tl.ratio))
		}
		this.field.telephones = phones
		this.sources = []
		this.buzzers = []
		srcRecs.forEach((r, si) => {
			this.last.push({ t: -1, level: 0 })
			if (r.role === "buzzer") {
				this.buzzers.push({ rec: r, si, on: false, keys: list(r.on).filter((k): k is string => typeof k === "string") })
				return
			}
			const strikes = list(r.strikes)
				.map((s) => list(s))
				.filter((s) => s.length >= 2 && num(s[1], 0) > 0)
				.map((s) => [num(s[0], 0), num(s[1], 0)] as [number, number])
				.sort((a, b) => a[0] - b[0])
			const ringRec = r.ring as { rate?: unknown; from?: unknown; until?: unknown } | undefined
			const ring = ringRec && num(ringRec.rate, 0) > 0 ? { rate: num(ringRec.rate, 18), from: num(ringRec.from, 0), until: num(ringRec.until, 1e9), nextT: num(ringRec.from, 0) } : undefined
			this.sources.push({ rec: r, si, strikes, next: 0, ...(ring ? { ring } : {}) })
			const hit = r.hit as { solids?: unknown } | undefined
			for (const id of list(hit?.solids)) if (typeof id === "string") this.hitSolids.set(id, [...(this.hitSolids.get(id) ?? []), si])
		})
		this.meters = meterRecs.map((rec, mi) => ({ rec, mi, peak: -1, heard: -1, echo: -1, perSource: new Map() }))
		for (const s of this.sources) {
			const item = String(s.rec.item ?? s.rec.id)
			ctx.set(item, "sounding", 0)
			ctx.set(item, "pitch", fieldSources[s.si]?.f0 ?? 0)
			ctx.set(item, "struck", 0)
			ctx.set(item, "strike_t", -1)
			ctx.set(item, "strike_level", 0)
			ctx.set(item, "amp_mm", 0)
		}
		for (const b of this.buzzers) ctx.set(String(b.rec.item ?? b.rec.id), "sound_db", 0)
		for (const m of this.meters) {
			const item = String(m.rec.item ?? m.rec.id)
			const floor = fieldMeters[m.mi]?.floor ?? 35
			ctx.set(item, "peak", floor)
			ctx.set(item, "level", floor)
			ctx.set(item, "pitch", 0)
			ctx.set(item, "heard", -1)
			ctx.set(item, "echo", -1)
			for (const s of srcRecs) {
				const si = String(s.item ?? s.id)
				ctx.set(item, `peak:${si}`, 0)
				ctx.set(item, `at:${si}`, -1)
			}
		}
	}

	/** `scheduled`: a strike of its own (its strike times, a bell's clapper), not a body hitting it: only those throw what lies on it. */
	private strike(ctx: ProcessContext, si: number, t: number, level: number, scheduled = false) {
		const f = this.field as SoundField
		const rec = (this.sources.find((s) => s.si === si) ?? this.buzzers.find((b) => b.si === si))?.rec
		if (rec === undefined) return
		// the carriers a thing touches: any of its item's solids within the carrier's half-thickness and 1 cm of its line
		const touches = (item: string): number[] => {
			const out: number[] = []
			f.carriers.forEach((cr, ci) => {
				const reach = cr.half + 0.01
				for (const h of ctx.solidsOf(item)) {
					if (h.id === this.carrierSolids[ci]) continue
					const o = h.outline()
					const pts = o.circle ? [{ x: o.circle.x, y: o.circle.y - o.circle.r }, { x: o.circle.x - o.circle.r, y: o.circle.y }, { x: o.circle.x + o.circle.r, y: o.circle.y }] : (o.points ?? [])
					if (pts.some((p) => toSegment(p, cr.a, cr.b) <= reach)) {
						out.push(ci)
						return
					}
				}
			})
			return out
		}
		const mine = f.carriers.length > 0 ? touches(String(rec.item ?? rec.id)) : []
		let gain = level
		const jar = rec.jar as { from?: unknown; to?: unknown; t0?: unknown; t1?: unknown; glass?: unknown; base?: unknown } | undefined
		const at = worldOf(ctx, rec.solid, pt(rec.at))
		const meterAt = (mi: number) => {
			const m = this.meters[mi]?.rec
			return m === undefined ? at : worldOf(ctx, m.solid, pt(m.at))
		}
		if (jar !== undefined) {
			// a bell under a jar: what reaches the room through the air in the jar falls with the air's pressure (the bell drives the
			// air it touches: pressure amplitude ∝ the air's density), then through the glass; and a fixed part through the base it stands on
			const from = num(jar.from, 100)
			const to = num(jar.to, from)
			const t0 = num(jar.t0, 0)
			const t1 = num(jar.t1, t0)
			const u = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : t >= t0 ? 1 : 0
			const pct = Math.max(0, from + (to - from) * u)
			const glass = Math.pow(10, -num(jar.glass, 25) / 20)
			const base = Math.pow(10, -num(jar.base, 45) / 20)
			gain = level * (glass * (pct / 100) + base)
		}
		f.strike(si, t, gain, at, meterAt, (mi) => {
			if (mine.length === 0) return []
			const m = this.meters[mi]?.rec
			const theirs = m === undefined ? [] : touches(String(m.item ?? m.id))
			return mine.filter((ci) => theirs.includes(ci))
		})
		this.last[si] = { t, level }
		const item = String(rec.item ?? rec.id)
		const n = (ctx.get(item, "struck") ?? 0) + 1
		if (rec.role === "source") {
			ctx.set(item, "struck", n)
			ctx.set(item, "strike_t", t)
			ctx.set(item, "strike_level", level)
			if (n === 1) ctx.event(`${item} sounds (${(f.sources[si] as FieldSource).f0.toFixed(1)} Hz)`, [item], "sound")
			// (a body landing on the head sounds it, but its own landing never throws it back up: that would make energy out of nothing)
			const kick = rec.kick as { solids?: unknown; dir?: unknown; amp?: unknown; shape?: unknown; size?: unknown; mass?: unknown } | undefined
			if (kick !== undefined && scheduled) {
				const solids = list(kick.solids).filter((s): s is string => typeof s === "string")
				const speed = num(kick.amp, 0) * level * 2 * Math.PI * num(rec.f0, 0)
				const p0 = list(list(rec.partials)[0])
				const tau = Math.max(0, num(p0[2], 0.2))
				if (solids.length > 0 && speed > 0)
					this.kicks.push({ si, solids, speed, dir: kick.dir === "out" ? "out" : "up", shape: String(kick.shape ?? ""), size: num(kick.size, 0), mass: Math.max(0, num(kick.mass, 0)), t0: t, tau })
			}
		}
	}

	step(ctx: ProcessContext) {
		const f = this.field
		if (f === undefined) return
		const t = ctx.time()
		// scheduled strikes and a bell's clapper
		for (const s of this.sources) {
			while (s.next < s.strikes.length && (s.strikes[s.next] as [number, number])[0] <= t + 1e-12) {
				const [ts, level] = s.strikes[s.next] as [number, number]
				this.strike(ctx, s.si, ts, level, true)
				s.next++
			}
			const ring = s.ring
			if (ring !== undefined)
				while (ring.nextT <= t + 1e-12 && ring.nextT <= ring.until) {
					this.strike(ctx, s.si, ring.nextT, 1, true)
					ring.nextT += 1 / ring.rate
				}
		}
		// impacts: a body that newly touches a sounding solid strikes it with its momentum then
		if (this.hitSolids.size > 0) {
			for (const [solid, sis] of this.hitSolids) {
				const now = new Set(ctx.touching(solid))
				const before = this.touchedBefore.get(solid) ?? new Set<string>()
				for (const other of now) {
					if (before.has(other)) continue
					const h = ctx.solid(other)
					if (h === undefined || !h.dynamic) continue
					const v0 = this.velBefore.get(other) ?? h.velocity()
					const me = ctx.solid(solid)
					const vs = me !== undefined && me.dynamic ? (this.velBefore.get(solid) ?? me.velocity()) : { x: 0, y: 0 }
					const speed = Math.hypot(v0.x - vs.x, v0.y - vs.y)
					const momentum = h.mass() * speed
					for (const si of sis) {
						const rec = this.sources.find((s) => s.si === si)?.rec
						const hit = rec?.hit as { momentum?: unknown; max?: unknown } | undefined
						const level = Math.min(num(hit?.max, 3), momentum / num(hit?.momentum, 0.15))
						// (a touch too soft to hear is not a strike: under a thousandth of a normal strike, −60 dB)
						if (level >= 0.001) this.strike(ctx, si, t, level)
					}
				}
				this.touchedBefore.set(solid, now)
			}
			for (const h of ctx.all()) if (h.dynamic) this.velBefore.set(h.id, h.velocity())
		}
		// circuits' buzzers: sound while powered (any of their "on" readings above zero), a steady note in 50 ms pieces
		for (const b of this.buzzers) {
			const item = String(b.rec.item ?? b.rec.id)
			// (its loudness against full, as the circuit's process reads it: circuits' "sound")
			let level = 0
			for (const k of b.keys) level = Math.max(level, ctx.get(item, k) ?? 0)
			const on = level > 0
			if (on && (!b.on || t - (this.last[b.si] as { t: number }).t >= 0.05 - 1e-9)) this.strike(ctx, b.si, t, Math.min(3, level))
			b.on = on
			ctx.set(item, "sound_db", f.sounding(b.si))
		}
		f.advance(t)
		for (const s of this.sources) {
			const item = String(s.rec.item ?? s.rec.id)
			const db = f.sounding(s.si)
			ctx.set(item, "sounding", db)
			// the vibrating part's amplitude: its latest strike's, dying away with its fundamental
			const last = this.last[s.si] as { t: number; level: number }
			const p0 = f.sources[s.si]?.partials[0]
			const tau = p0 ? p0[2] : 1
			const hold = f.sources[s.si]?.hold ?? 0
			const u = last.t < 0 ? -1 : t - last.t
			const amp = u < 0 ? 0 : num(s.rec.amp, 0) * last.level * (u <= hold ? 1 : Math.exp(-(u - hold) / tau))
			ctx.set(item, "amp_mm", amp * 1000)
		}
		for (const m of this.meters) {
			const item = String(m.rec.item ?? m.rec.id)
			const level = f.level(m.mi)
			const floor = (f.meters[m.mi] as FieldMeter).floor
			ctx.set(item, "level", level)
			if (level > m.peak) m.peak = level
			ctx.set(item, "peak", m.peak)
			ctx.set(item, "pitch", f.pitch(m.mi))
			if (m.heard < 0 && level >= floor + 3) {
				m.heard = t
				ctx.set(item, "heard", t)
			}
			const arr = f.arrivals[m.mi] as { t: number; source: number; via: readonly string[] }[]
			if (m.echo < 0 && arr.length > 0) {
				const first = arr[0] as { t: number }
				const echo = arr.find((a) => a.via.length > 0 && a.t > first.t && f.speed > 0 && a.t <= t)
				if (echo !== undefined && first.t <= t) {
					m.echo = echo.t - first.t
					ctx.set(item, "echo", m.echo)
				}
			}
			for (const a of arr) {
				if (a.t > t) continue
				const src = f.sources[a.source] as FieldSource
				const key = src.item
				const ps = m.perSource.get(a.source) ?? { peak: 0, at: -1 }
				if (ps.at < 0) {
					ps.at = a.t
					m.perSource.set(a.source, ps)
					ctx.set(item, `at:${key}`, a.t)
				}
			}
			for (const [si, ps] of m.perSource) {
				const db = f.levelOf(m.mi, si)
				if (db > ps.peak) {
					ps.peak = db
					ctx.set(item, `peak:${(f.sources[si] as FieldSource).item}`, db)
				}
			}
		}
	}

	force(ctx: ProcessContext, h: number) {
		if (this.kicks.length === 0) return
		const t = ctx.time()
		const waiting: SoundWorld["kicks"] = []
		for (const k of this.kicks) {
			// the part rings on after its strike: a kick made while the bodies were still held, or with none touching yet, waits, its swing dying
			// away as e^(−t/τ); under 5 % of it, it has rung out
			const fade = k.tau > 0 ? Math.exp(-Math.max(0, t - k.t0) / k.tau) : t - k.t0 <= 1e-9 ? 1 : 0
			if (fade < 0.05 || (k.until !== undefined && t > k.until)) continue
			// (once it has thrown something it goes on for 10 ms more for what comes to touch it then: grains let go together settle onto
			// the head a step or two apart; each body is thrown once)
			const done = k.done ?? new Set<string>()
			const hit: { o: SolidHandle; mp: { x: number; y: number; angle: number } }[] = []
			for (const solid of k.solids) {
				const me = ctx.solid(solid)
				if (me === undefined) continue
				const mp = me.pose()
				for (const other of ctx.touching(solid)) {
					if (done.has(other)) continue
					const o = ctx.solid(other)
					if (o === undefined || !o.dynamic) continue
					done.add(other)
					hit.push({ o, mp })
				}
			}
			if (hit.length === 0) {
				waiting.push(k)
				continue
			}
			if (k.until === undefined) {
				k.until = t + 0.01
				k.done = done
			}
			waiting.push(k)
			for (const { o, mp } of hit) {
				let dx = 0
				let dy = 1
				if (k.dir === "up") {
					dx = -Math.sin(mp.angle)
					dy = Math.cos(mp.angle)
				} else {
					const op = o.pose()
					const d = Math.hypot(op.x - mp.x, op.y - mp.y)
					dx = d > 0 ? (op.x - mp.x) / d : 1
					dy = d > 0 ? (op.y - mp.y) / d : 0
				}
				// how far the surface swings where the body touches it: a membrane's (0,1) mode J0(2.405·r/a) (all at the middle, none at
				// the rim); a prong's first bending mode, about (s/L)² from its root (s along it): the tip swings, the root stays
				const op = o.pose()
				const lx = (op.x - mp.x) * Math.cos(mp.angle) + (op.y - mp.y) * Math.sin(mp.angle)
				const ly = -(op.x - mp.x) * Math.sin(mp.angle) + (op.y - mp.y) * Math.cos(mp.angle)
				let share = 1
				if (k.shape === "membrane" && k.size > 0) share = Math.max(0, besselJ0((J0_ZERO * Math.min(1, Math.abs(lx) / k.size)) as number))
				else if (k.shape === "prong" && k.size > 0) {
					const s = Math.max(0, Math.min(1, (ly + k.size / 2) / k.size))
					share = s * s
				}
				// thrown off at the surface's speed there, shared by momentum with the part's own mass where it touches (its modal mass ÷
				// share²: a perfectly inelastic meeting, Δv = v·share·m/(m + M·share²)): a light grain leaves at the surface's speed, a heavy
				// weight barely stirs; an impulse M·Δv over this (sub-)step on its whole body
				const bm = o.body().mass
				const M = bm > 0 ? bm : o.mass()
				const dv = k.speed * fade * share * (k.mass > 0 ? k.mass / (k.mass + M * share * share) : 1)
				const F = (M * dv) / h
				if (F > 0) o.push(F * dx, F * dy)
			}
		}
		this.kicks = waiting
	}
}

/** The first zero of J0, and J0(x) by its series Σ (−1)^k (x²/4)^k / (k!)² (|x| ≤ 2.5: 14 terms reach the last bit). */
const J0_ZERO = 2.404825557695773
const besselJ0 = (x: number) => {
	const q = (x * x) / 4
	let term = 1
	let sum = 1
	for (let k = 1; k < 14; k++) {
		term = (-term * q) / (k * k)
		sum += term
	}
	return sum
}

const WORLDS = new WeakMap<object, SoundWorld>()
const worldFor = (scene: object) => {
	let w = WORLDS.get(scene)
	if (w === undefined || w.started) {
		w = new SoundWorld()
		WORLDS.set(scene, w)
	}
	return w
}

const sound: ProcessKind = {
	kind: "sound",
	check(record: ProcessRecord, solids: ReadonlySet<string>) {
		const role = record.role
		if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return `role must be one of ${ROLES.join(", ")} (it is ${String(role)})`
		if (NEEDS_SOLID.has(role) && record.solid !== undefined && (typeof record.solid !== "string" || !solids.has(record.solid)))
			return `its solid "${String(record.solid)}" is not a solid of the document`
		if ((role === "source" || role === "buzzer") && !(num(record.f0, -1) > 0 && num(record.f0, -1) <= 40000)) return "f0 must be a frequency from 0 to 40000 Hz"
		if (role === "source" && list(record.partials).length === 0) return "a source needs its partials"
		if (role === "wall" && !(finitePt(record.a) && finitePt(record.b))) return "a wall needs its two ends a and b"
		if (role === "carrier" && !(finitePt(record.a) && finitePt(record.b) && num(record.speed, 0) > 0)) return "a carrier needs its ends and its speed"
		if (role === "water" && !(num(record.x1, 0) > num(record.x0, 0) && num(record.top, 0) >= num(record.floor, 0) && num(record.speed, 0) > 0)) return "a body of water needs x0 < x1, floor ≤ top and its speed"
		if (role === "telephone") {
			if (!(finitePt(record.a) && finitePt(record.b))) return "a string telephone needs its two cups' mouths a and b"
			for (const k of ["length", "diameter", "rho", "E"] as const) if (!(num(record[k], 0) > 0)) return `a string telephone's ${k} must be a number above 0`
			if (!(num(record.tension, -1) >= 0) || !(num(record.eta, -1) >= 0)) return "a string telephone's tension and eta must be numbers, 0 or more"
			const cup = record.cup as { r?: unknown; m?: unknown; f?: unknown; v?: unknown } | undefined
			if (typeof cup !== "object" || cup === null || !(num(cup.r, 0) > 0 && num(cup.m, 0) > 0 && num(cup.v, 0) > 0 && num(cup.f, -1) >= 0))
				return "a string telephone's cup needs its bottom's radius r, mass m, resonance f (Hz, 0 or more) and its volume v"
		}
		return undefined
	},
	create(record: ProcessRecord, ctx: ProcessContext): Process {
		const w = worldFor(ctx.scene)
		w.records.push(record)
		if (w.records.length > 1) return {}
		return {
			start: (c) => w.start(c),
			step: (c) => w.step(c),
			force: (c, h) => w.force(c, h)
		}
	}
}

// ---------------------------------------------------------------- waves on a rope or a Slinky

const lineRec = (r: ProcessRecord): LineRec => {
	const d = (r.drive ?? {}) as Record<string, unknown>
	return {
		kind: r.line === "slinky" ? "slinky" : "rope",
		a: pt(r.a),
		b: pt(r.b, { x: 1, y: 0 }),
		n: Math.max(4, Math.min(LINE_MAX_SEGMENTS, Math.round(num(r.n, 100)))),
		mass: Math.max(1e-6, num(r.mass, 0.3)),
		tension: Math.max(0, num(r.tension, 10)),
		stiffness: Math.max(1e-6, num(r.stiffness, 1000)),
		plane: r.plane === "flat" ? "flat" : "vertical",
		damping: Math.max(0, num(r.damping, 0.3)),
		drive: {
			mode: d.mode === "wave" ? "wave" : d.mode === "none" ? "none" : "pulse",
			dir: d.dir === "along" ? "along" : "across",
			amp: num(d.amp, 0.05),
			f: Math.max(0, num(d.f, 2)),
			at: num(d.at, 0.5),
			cycles: Math.max(0, num(d.cycles, 0))
		},
		end: r.end === "free" ? "free" : r.end === "open" ? "open" : "fixed",
		...(typeof r.floor === "number" && Number.isFinite(r.floor) ? { floor: r.floor } : {}),
		...(typeof r.drag === "number" && Number.isFinite(r.drag) && r.drag > 0 ? { drag: r.drag } : {}),
		...(typeof r.closed === "number" && Number.isFinite(r.closed) && r.closed > 0 ? { closed: r.closed } : {})
	}
}

const f2 = (v: number, d = 2) => v.toFixed(d)

const waveLine: ProcessKind = {
	kind: "wave-line",
	check(record: ProcessRecord) {
		if (!finitePt(record.a) || !finitePt(record.b)) return "a wave line needs its two ends a and b"
		const a = pt(record.a)
		const b = pt(record.b)
		if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) return "a wave line must be at least 5 cm long"
		if (!(num(record.mass, 0) > 0)) return "a wave line needs a mass above zero"
		return undefined
	},
	create(record: ProcessRecord, ctx: ProcessContext): Process {
		const rec = lineRec(record)
		const item = String(record.item ?? record.id)
		const keep = Math.max(2, Math.min(80, Math.round(num(record.keep, 40))))
		const ribbon = typeof record.ribbon === "number" && Number.isFinite(record.ribbon) && record.ribbon > 0 && record.ribbon <= 1 ? record.ribbon : undefined
		let line: Line
		const along = rec.kind === "slinky" && rec.drive.dir === "along"
		const thresh = 0.05 * Math.max(1e-9, rec.drive.amp)
		let tip = 0
		let mid = 0
		let arrive = -1
		let outSign = 0
		let backSign = 0
		let passedMid = false
		let reachedEnd = false
		let stride = 1
		let rb = -1
		const rbLo = [Infinity, Infinity]
		const rbHi = [-Infinity, -Infinity]
		let endAmp = 0
		// the shape the readings give (offsets from the sag: the view adds the sag back) and the motion the detectors watch: from where each
		// point started, or, for a line the floor holds partly up at the start (it settles there a little), from a twin of it left undriven
		let twin: Line | undefined
		const disp = (i: number) => (along ? (line.u[i] as number) : (line.v[i] as number) - (line.sag[i] as number))
		const movedAlong = (i: number) => (line.u[i] as number) - (twin === undefined ? 0 : (twin.u[i] as number))
		const movedAcross = (i: number) => (line.v[i] as number) - (twin === undefined ? (line.v0[i] as number) : (twin.v[i] as number))
		const moved = (i: number) => (along ? movedAlong(i) : movedAcross(i))
		const shapeKeys: string[] = []
		let speed = 0
		let envelope: { since: number; max: Float64Array } | undefined
		// a standing wave's loop counts, second by second, and the last one said
		let lastLoops = -1
		let saidLoops = 0
		const what = rec.drive.mode === "pulse" ? "pulse" : "wave"
		/**
		 * Standing loops: the humps of each point's largest offset over each second: its local highs over 30 % of the highest, two of them told
		 * apart only where it dips between them under half the lower one (a node: the neck an eye sees between two loops; a lossy line's nodes
		 * still move a little).
		 */
		const loopsNow = (c: ProcessContext, t: number) => {
			const n = line.n
			if (envelope === undefined) envelope = { since: t, max: new Float64Array(n + 1) }
			const e = envelope
			for (let i = 0; i <= n; i++) e.max[i] = Math.max(e.max[i] as number, Math.abs(moved(i)))
			if (t - e.since < 1) return
			let top = 0
			for (let i = 0; i <= n; i++) top = Math.max(top, e.max[i] as number)
			const humps: number[] = []
			if (top > 0) {
				let low = Infinity
				for (let i = 1; i < n; i++) {
					const v = e.max[i] as number
					low = Math.min(low, v)
					if (v < 0.3 * top || v < (e.max[i - 1] as number) || v < (e.max[i + 1] as number)) continue
					const k = humps.length - 1
					if (k < 0 || low <= 0.5 * Math.min(humps[k] as number, v)) humps.push(v)
					else if (v > (humps[k] as number)) humps[k] = v
					else continue
					low = v
				}
			}
			const loops = humps.length
			c.set(item, "loops", loops)
			// (said once the same count holds for two seconds after the wave has reached the far end, and again only when it settles on another)
			const from = e.since - 1
			if (loops >= 1 && loops === lastLoops && loops !== saidLoops && arrive >= 0 && from >= arrive) {
				saidLoops = loops
				c.event(loops === 1 ? `1 standing loop forms on ${item}` : `${loops} standing loops form on ${item}`, [item], "wave", from)
			}
			lastLoops = loops
			e.since = t
			e.max.fill(0)
		}
		const step = (c: ProcessContext) => {
			const t = c.time()
			line.advanceTo(t)
			twin?.advanceTo(t)
			// the shape (each kept point's offset), every step
			let k = 0
			for (let i = 0; i <= line.n; i += stride) c.set(item, shapeKeys[k++] as string, disp(i))
			if (line.n % stride !== 0) c.set(item, shapeKeys[k] as string, disp(line.n))
			const dTip = moved(tip)
			if (arrive < 0 && Math.abs(dTip) > thresh && t > rec.drive.at) {
				arrive = t
				c.set(item, "arrive", t)
				c.event(`the ${what} on ${item} reaches its far end`, [item], "wave")
			}
			const end = rec.end === "fixed" ? moved(Math.max(1, line.n - 1)) : moved(line.n)
			if (Math.abs(end) * 1000 > endAmp) {
				endAmp = Math.abs(end) * 1000
				c.set(item, "end_mm", endAmp)
			}
			if (rec.drive.mode === "pulse") {
				const dMid = moved(mid)
				if (!passedMid && Math.abs(dMid) > 0.3 * rec.drive.amp) {
					outSign = Math.sign(dMid)
					passedMid = true
				}
				if (passedMid && !reachedEnd && arrive >= 0 && Math.abs(dMid) < 0.05 * rec.drive.amp) reachedEnd = true
				if (reachedEnd && backSign === 0 && Math.abs(dMid) > 0.15 * rec.drive.amp) {
					backSign = Math.sign(dMid)
					c.set(item, "reflection", backSign === outSign ? 1 : -1)
					c.event(`the pulse on ${item} comes back ${backSign === outSign ? "the same way up" : "upside down"}`, [item], "wave")
				}
				// nothing came back to the middle within 1.2 crossings after the pulse reached the end: no reflection
				if (reachedEnd && backSign === 0 && arrive >= 0 && speed > 0 && t - arrive > (1.2 * line.L) / speed) {
					backSign = 2
					c.set(item, "reflection", 0)
					c.event(`nothing comes back from ${item}'s far end`, [item], "wave")
				}
			}
			if (rb >= 0 && t >= rec.drive.at) {
				const a = movedAlong(rb)
				const b = movedAcross(rb)
				rbLo[0] = Math.min(rbLo[0] as number, a)
				rbLo[1] = Math.min(rbLo[1] as number, b)
				rbHi[0] = Math.max(rbHi[0] as number, a)
				rbHi[1] = Math.max(rbHi[1] as number, b)
				c.set(item, "ribbon_along_mm", ((rbHi[0] as number) - (rbLo[0] as number)) * 1000)
				c.set(item, "ribbon_across_mm", ((rbHi[1] as number) - (rbLo[1] as number)) * 1000)
			}
			if (rec.drive.mode === "wave") loopsNow(c, t)
		}
		return {
			start(c) {
				line = new Line(rec, c.step, c.settings.gravity)
				if (line.rests) twin = new Line({ ...rec, drive: { ...rec.drive, mode: "none" } }, c.step, c.settings.gravity)
				tip = Math.max(1, Math.round(line.n * 0.9))
				mid = Math.round(line.n / 2)
				stride = Math.max(1, Math.round(line.n / keep))
				rb = ribbon === undefined ? -1 : Math.max(0, Math.min(line.n, Math.round(ribbon * line.n)))
				for (let i = 0, k = 0; i <= line.n; i += stride, k++) shapeKeys.push(`d${k}`)
				if (line.n % stride !== 0) shapeKeys.push(`d${shapeKeys.length}`)
				speed = along ? line.L * Math.sqrt(rec.stiffness / rec.mass) : Math.sqrt((rec.tension * line.L) / rec.mass)
				c.set(item, "speed", speed)
				c.set(item, "frequency", rec.drive.f)
				c.set(item, "wavelength", rec.drive.f > 0 ? speed / rec.drive.f : 0)
				c.set(item, "arrive", -1)
				c.set(item, "reflection", -2)
				c.set(item, "loops", 0)
				c.set(item, "end_mm", 0)
				if (rb >= 0) {
					c.set(item, "ribbon_along_mm", 0)
					c.set(item, "ribbon_across_mm", 0)
				}
				// (a shake shorter than about 4 segments hardly travels: the line's lattice carries nothing above f = v/(π·dx); said, not hidden)
				if (rec.drive.mode !== "none" && rec.drive.f > 0 && speed > 0 && speed / rec.drive.f < 4 * line.dx)
					c.event(`${item}'s waves (${f2((speed / rec.drive.f) * 100, 1)} cm long) are too short for it to carry: they hardly travel (the shortest it carries well is ${f2(10 * line.dx * 100, 1)} cm, at ${f2(speed / (10 * line.dx), 1)} Hz)`, [item], "warn")
				step(c)
			},
			step,
			end(c) {
				// the ribbon: it bobs (or, on a Slinky pushed along, swings back and forth) where it is tied, and goes nowhere
				if (rb >= 0 && rec.drive.mode !== "none") {
					const acrossMm = ((rbHi[1] as number) - (rbLo[1] as number)) * 1000
					const alongMm = ((rbHi[0] as number) - (rbLo[0] as number)) * 1000
					if (along && alongMm >= 1) c.event(`the ribbon on ${item} swings ${f2(alongMm, 0)} mm back and forth along it and stays where it is tied`, [item], "wave")
					else if (!along && acrossMm >= 1)
						c.event(`the ribbon on ${item} bobs ${f2(acrossMm, 0)} mm ${rec.plane === "flat" ? "side to side" : "up and down"} and moves ${f2(alongMm, 0)} mm along: the wave passes, the ${rec.kind === "slinky" ? "Slinky" : "rope"} stays`, [item], "wave")
				}
			}
		}
	}
}

// ---------------------------------------------------------------- the ripple tank

const tankRec = (r: ProcessRecord): TankRec => ({
	x0: num(r.x0, 0),
	x1: num(r.x1, 0.6),
	width: Math.max(0.02, num(r.width, 0.4)),
	depth: Math.max(0.001, num(r.depth, 0.01)),
	f: Math.max(0.1, num(r.f, 5)),
	amp: Math.max(0, num(r.amp, 0.002)),
	at: num(r.at, 0.5),
	source: r.source === "bar" ? "bar" : "point",
	sx: num(r.sx, 0),
	near: r.near === "wall" ? "wall" : "beach",
	far: r.far === "wall" ? "wall" : "beach"
})

const ripples: ProcessKind = {
	kind: "ripples",
	check(record: ProcessRecord) {
		const x0 = num(record.x0, NaN)
		const x1 = num(record.x1, NaN)
		if (!(x1 - x0 >= 0.05)) return "a ripple tank needs x0 < x1 (at least 5 cm of water)"
		if (!(num(record.depth, 0) > 0)) return "a ripple tank needs a water depth above zero"
		if (!(num(record.f, 0) > 0)) return "a ripple tank's dipper needs a frequency above zero"
		return undefined
	},
	create(record: ProcessRecord, ctx: ProcessContext): Process {
		const rec = tankRec(record)
		const item = String(record.item ?? record.id)
		const floater = typeof record.floater === "number" && Number.isFinite(record.floater) ? record.floater : undefined
		const floaterKind = typeof record.floater_kind === "string" && record.floater_kind ? record.floater_kind : "floater"
		const rip = new Ripples(rec, ctx.settings.gravity)
		const farX = rec.sx <= (rec.x0 + rec.x1) / 2 ? rec.x1 : rec.x0
		const reach = rec.at + Math.abs(farX - rec.sx) / rip.cg
		const period = 1 / rec.f
		// the floater's last period: its offsets, to tell its drift (mean) and its bob (range)
		const win: { t: number; x: number; y: number }[] = []
		let bobMost = 0
		let driftMost = 0
		return {
			start(c) {
				c.set(item, "wavelength", rip.lambda)
				c.set(item, "speed", rip.w / rip.k)
				c.set(item, "group", rip.cg)
				c.set(item, "frequency", rec.f)
				c.set(item, "reach", -1)
				if (floater !== undefined) {
					c.set(item, "floater_x", 0)
					c.set(item, "floater_y", 0)
					c.set(item, "floater_drift", 0)
					c.set(item, "floater_bob_mm", 0)
				}
			},
			step(c) {
				const t = c.time()
				if (t >= reach && (c.get(item, "reach") ?? -1) < 0) {
					c.set(item, "reach", t)
					c.event(`the ripples reach ${item}'s far end`, [item], "wave")
				}
				if (floater === undefined) return
				const s = rip.at(floater, 0, t)
				c.set(item, "floater_x", s.xi)
				c.set(item, "floater_y", s.eta)
				win.push({ t, x: s.xi, y: s.eta })
				while (win.length > 0 && (win[0] as { t: number }).t < t - period) win.shift()
				let sx = 0
				let lo = Infinity
				let hi = -Infinity
				for (const p of win) {
					sx += p.x
					lo = Math.min(lo, p.y)
					hi = Math.max(hi, p.y)
				}
				const drift = sx / win.length
				const bob = (hi - lo) * 1000
				c.set(item, "floater_drift", drift)
				c.set(item, "floater_bob_mm", bob)
				bobMost = Math.max(bobMost, bob)
				driftMost = Math.max(driftMost, Math.abs(drift))
			},
			end(c) {
				if (floater !== undefined && bobMost >= 0.1)
					c.event(`the ${floaterKind} on ${item} bobs ${f2(bobMost, 1)} mm up and down but stays put (it drifts ${f2(driftMost * 1000, 1)} mm at most)`, [item], "wave")
			}
		}
	}
}

export default [sound, waveLine, ripples]
