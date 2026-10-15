import { Schema } from "effect"
import type { SceneDocument } from "#sim/document.ts"

/**
 * The values of a scene document an editor may change, in one section per scope (the release, a
 * contact pair, an airflow, a material), so every editor offers the same ones under the same names. Each reads
 * its value from a document and writes it back into one. Where parts start is not listed: every
 * part has a position, edited by dragging in Blender and by a moving part's fields in Remotion.
 */
export interface Tunable {
	readonly section: string
	readonly label: string
	readonly min: number
	readonly max?: number
	readonly read: (d: SceneDocument) => number
	readonly write: (d: SceneDocument, v: number) => SceneDocument
}

/**
 * The increment every editor offers for every value, and the precision a value is shown to.
 * @limitKind judgement
 * @owner lesson-art simulated demonstrations
 * @unit the value's own unit
 * @scope every editable value of a scene document
 * @decision thousandths, the owner's choice (2026-10-12): fine enough for any contact value, a
 * millimeter or a millisecond
 */
export const STEP = 0.001

/** A value rounded to the editors' step. */
export const stepped = (v: number) => Number((Math.round(v / STEP) * STEP).toFixed(3))

export const tunables = (doc: SceneDocument): readonly Tunable[] => {
	const fields: Tunable[] = [
		{
			section: "release",
			label: "time (s)",
			min: 0,
			read: (d) => d.release.at,
			// The mechanism's keys move with the release, so the jaws still open as it happens.
			write: (d, v) => {
				const shift = v - d.release.at
				return {
					...d,
					release: { ...d.release, at: v },
					animated: d.animated.map((a) => ({ ...a, keys: a.keys.map((k) => ({ ...k, t: Number((k.t + shift).toFixed(6)) })) }))
				}
			}
		}
	]
	const holder = doc.release.holder
	holder?.via.forEach((step, i) =>
		fields.push({
			section: "release",
			label: `${holder.id} ${step.pose} lasts (s)`,
			min: STEP,
			read: (d) => d.release.holder?.via[i]?.seconds ?? step.seconds,
			write: (d, v) =>
				d.release.holder === undefined
					? d
					: {
							...d,
							release: {
								...d.release,
								holder: { ...d.release.holder, via: d.release.holder.via.map((s, j) => (j === i ? { ...s, seconds: v } : s)) }
							}
						}
		})
	)
	doc.contacts.forEach((c, i) => {
		for (const [key, label, max] of [
			["restitution", "restitution", 1],
			["friction", "friction", 2],
			["rollingResistance", "rolling resistance", 1],
			["tangentRestitution", "side spring-back", 1]
		] as const) {
			fields.push({
				section: `${c.between[0]} on ${c.between[1]}`,
				label,
				min: 0,
				max,
				read: (d) => d.contacts[i]?.[key] ?? c[key] ?? 0,
				write: (d, v) => ({ ...d, contacts: d.contacts.map((x, j) => (j === i ? { ...x, [key]: v } : x)) })
			})
		}
	})
	for (const part of doc.animated) {
		const flow = part.airflow
		if (flow === undefined) continue
		for (const [key, label] of [
			["speed", "air speed (m/s)"],
			["from", "switched on at (s)"]
		] as const) {
			fields.push({
				section: part.id,
				label,
				min: 0,
				read: (d) => d.animated.find((a) => a.id === part.id)?.airflow?.[key] ?? flow[key],
				write: (d, v) => ({
					...d,
					animated: d.animated.map((a) => (a.id === part.id && a.airflow !== undefined ? { ...a, airflow: { ...a.airflow, [key]: v } } : a))
				})
			})
		}
	}
	for (const [name, m] of Object.entries(doc.materials)) {
		fields.push({
			section: name,
			label: "density (kg/m³)",
			min: 1,
			read: (d) => d.materials[name]?.density ?? m.density,
			write: (d, v) => ({ ...d, materials: { ...d.materials, [name]: { ...(d.materials[name] ?? m), density: v } } })
		})
		if (m.yieldStrength !== undefined) {
			fields.push({
				section: name,
				label: "yield strength (kPa)",
				min: STEP,
				read: (d) => (d.materials[name]?.yieldStrength ?? m.yieldStrength ?? 0) / 1000,
				write: (d, v) => ({ ...d, materials: { ...d.materials, [name]: { ...(d.materials[name] ?? m), yieldStrength: v * 1000 } } })
			})
		}
	}
	return fields
}

/** An editor's values: one record of labeled numbers per section. */
export const Tuning = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Finite))
export type Tuning = typeof Tuning.Type

/** An editor's values admitted once, from a file or an editor's save. */
export const admitTuning = Schema.decodeUnknownSync(Tuning)

/** The document's values, each rounded to the editors' step. */
export const tuningOf = (doc: SceneDocument): Tuning => {
	const tuning: Record<string, Record<string, number>> = {}
	for (const t of tunables(doc)) {
		tuning[t.section] = { ...tuning[t.section], [t.label]: stepped(t.read(doc)) }
	}
	return tuning
}

/**
 * The document with an editor's values written into it, each rounded to the editors' step and held
 * within its bounds, so an editor need not refuse a value; a value the editor leaves out is kept.
 */
export const applyTuning = (doc: SceneDocument, tuning: Tuning): SceneDocument =>
	tunables(doc).reduce((d, t) => {
		const v = tuning[t.section]?.[t.label]
		return v === undefined ? d : t.write(d, Math.min(t.max ?? Number.POSITIVE_INFINITY, Math.max(t.min, stepped(v))))
	}, doc)
