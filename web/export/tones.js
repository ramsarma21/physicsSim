// The waves module's tones for the MP4 export's sound track (web/export/audio.js renderImpacts mixes them with the impact sounds): every strike
// of a tuning fork, drum, ruler, string, bar, speaker, clapper or bell, and a circuits buzzer while it sounds, as the scene's listener hears it
// (web/sim/modules/waves.js toneEvents: delayed by distance ÷ c and weaker by −20·log10(distance) to the first sound meter, else as heard 1 m
// away; nothing through a vacuum). Each tone is its partials (Hz, amplitude, decay time τ) as sinusoids: a 4 ms raised-cosine attack, held
// for its hold (a blown or electric note), then each partial dying away as e^(−t/τ). Deterministic: no randomness, the same samples every time
// (each partial starts at sine phase 0, so its attack never clicks).
// Level: 100 dB SPL at the listener is a sine of 0.7 peak (the impacts' calibration: a bowling ball dropped 1 m onto the table peaks near
// −3 dBFS); audio.js then sets the whole track's loudness (its loudest 400 ms at −18 LUFS), so a quiet fork alone is still heard and a fork
// beside a falling bowling ball stays as much quieter as it really is.
import { toneEvents } from "../sim/modules/waves.js"

const TAU = Math.PI * 2
const FLOOR = 1e-5 // a partial is stopped once its amplitude falls under this (−100 dBFS)

/** Adds the run's tones into left/right (Float32Arrays at sr). pan(t, x, y) → −1 … 1. Returns the events it made [{t, item, kind: "tone", hz, db}]. */
export function addTones(doc, track, left, right, sr, pan) {
	const events = []
	let list = []
	try {
		list = toneEvents(doc, track)
	} catch {
		return events
	}
	const length = left.length
	for (const e of list) {
		const t0 = e.t + (e.delay ?? 0)
		if (!(t0 >= 0) || t0 * sr >= length) continue
		const rms = 0.5 * 10 ** ((e.heard_db - 100) / 20)
		let norm = 0
		for (const [, a] of e.partials) norm += a * a
		norm = norm > 0 ? Math.sqrt(norm) : 1
		const p = Math.max(-0.8, Math.min(0.8, pan(e.t, e.x, e.y)))
		const gl = Math.cos(((p + 1) * Math.PI) / 4)
		const gr = Math.sin(((p + 1) * Math.PI) / 4)
		const hold = Math.max(0, e.dur_s ?? 0)
		const start = Math.floor(t0 * sr)
		const frac = t0 * sr - start
		const attack = Math.max(1, Math.round(0.004 * sr))
		for (const [f, a, tau] of e.partials) {
			if (!(f > 20 && f < sr / 2) || !(tau > 0)) continue
			const peak = Math.SQRT2 * rms * (a / norm)
			if (peak < FLOOR) continue
			// a rotating phasor: (c, s) turns by 2πf/sr a sample; after the hold its length shrinks by e^(−1/(τ·sr)) a sample
			const w = (TAU * f) / sr
			const cw = Math.cos(w)
			const sw = Math.sin(w)
			let c = Math.cos(-w * frac)
			let s = Math.sin(-w * frac)
			const decay = Math.exp(-1 / (tau * sr))
			const holdN = Math.round(hold * sr)
			const tail = Math.ceil(Math.min(8, tau * Math.log(peak / FLOOR)) * sr)
			const n = Math.min(length - start, holdN + tail)
			let g = peak
			for (let i = 0; i < n; i++) {
				const env = i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1
				const v = g * env * s
				left[start + i] += v * gl
				right[start + i] += v * gr
				const c2 = c * cw - s * sw
				s = s * cw + c * sw
				c = c2
				if (i >= holdN) g *= decay
				// (renormalise the phasor now and then: its length drifts by rounding over millions of turns)
				if ((i & 4095) === 4095) {
					const k = 1 / Math.sqrt(c * c + s * s)
					c *= k
					s *= k
				}
			}
		}
		events.push({ t: t0, item: e.item, kind: "tone", hz: e.hz, db: Math.round(e.heard_db * 10) / 10 })
	}
	return events
}
