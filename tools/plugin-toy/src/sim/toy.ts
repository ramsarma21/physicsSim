/**
 * The toy module's engine processes (a test of tooling/src/sim/plugins.ts; never in the engine's index):
 *   toy-melt  {solid, heater (a solid id or null), power (W), mass (kg), start, melt (°C), heat (J/(kg·K)), latent (J/kg)}: a slow process
 *             (10 Hz, time-lapse scaled). While the cube touches its heater the heater's power warms it, dT = P·dt/(m·c), up to its melting
 *             point; then melts it, dm = P·dt/L; it shrinks with what is left (scale = left^(1/3), by the engine's pow) and is gone when all has melted (an event).
 *             Readings: temperature (°C), melted (0..1).
 *   toy-lift  {solid, share}: a steady upward force, share × its weight now, every (sub-)step after the release (a force hook).
 */
import type { ProcessKind } from "#sim/plugins.ts"

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)

const melt: ProcessKind = {
	kind: "toy-melt",
	check: (r, solids) => (typeof r.solid === "string" && solids.has(r.solid) ? undefined : "its solid is not in the document"),
	create(r) {
		const solid = r.solid as string
		const heater = typeof r.heater === "string" ? r.heater : null
		const power = num(r.power, 0)
		const mass = num(r.mass, 0.0243)
		const melting = num(r.melt, 58)
		const c = num(r.heat, 2500)
		const L = num(r.latent, 210000)
		const item = r.item as string
		let T = num(r.start, 20)
		let melted = 0
		let said = false
		return {
			coarse: 48,
			start(ctx) {
				ctx.set(item, "temperature", T)
				ctx.set(item, "melted", 0)
			},
			slow(ctx, dt) {
				if (melted >= 1 || heater === null || power <= 0) return
				if (!ctx.touching(solid).includes(heater)) return
				let q = power * dt
				if (T < melting) {
					const warm = Math.min(q, (melting - T) * mass * c)
					T += warm / (mass * c)
					q -= warm
				}
				if (q > 0 && T >= melting) melted = Math.min(1, melted + q / (mass * L))
				ctx.set(item, "temperature", T)
				ctx.set(item, "melted", melted)
				ctx.solid(solid)?.resize(Math.pow(1 - melted, 1 / 3))
				if (melted >= 1 && !said) {
					said = true
					ctx.event(`${item} melted completely`, [item], "melted")
				}
			}
		}
	}
}

const lift: ProcessKind = {
	kind: "toy-lift",
	check: (r, solids) => (typeof r.solid === "string" && solids.has(r.solid) ? undefined : "its solid is not in the document"),
	create(r) {
		const solid = r.solid as string
		const share = num(r.share, 0)
		return {
			force(ctx) {
				const h = ctx.solid(solid)
				if (h === undefined || !h.dynamic) return
				h.push(0, share * h.mass() * ctx.settings.gravity)
			}
		}
	}
}

export default [melt, lift]
