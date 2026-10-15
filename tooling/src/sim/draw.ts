import type { AttributeValue, Part } from "#part.ts"
import { layerDrawing } from "#sim/drawing.ts"
import type { Placement } from "#sim/physics.ts"
import {
	bodyVector,
	type Camera,
	compose,
	cycleDrawing,
	type Layer,
	layerFrameAt,
	SETTING,
	stacking,
	worldPose,
	type OrganicPart,
	OUTLINE,
	poseAt,
	type SimScene,
	type Vec
} from "#sim/part.ts"

/** Where a world point lands on the canvas. */
export const toCanvas = (camera: Camera, p: Vec): Vec => ({
	x: camera.pixel.x + (p.x - camera.origin.x) * camera.pixelsPerMeter,
	y: camera.pixel.y - (p.y - camera.origin.y) * camera.pixelsPerMeter
})

/** The one SVG transform that takes world meters (Y up) to canvas pixels (Y down). */
export const projection = (camera: Camera) => {
	const k = camera.pixelsPerMeter
	const origin = toCanvas(camera, { x: 0, y: 0 })
	return `matrix(${k} 0 0 ${-k} ${origin.x} ${origin.y})`
}

const value = (v: AttributeValue) => (typeof v === "number" ? String(Number(v.toPrecision(6))) : v)

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")

export const markup = (part: Part): string => {
	const transform = [
		part.translate ? `translate(${part.translate.map(value).join(" ")})` : "",
		part.rotate ? `rotate(${part.rotate.map(value).join(" ")})` : ""
	]
		.filter((step) => step !== "")
		.join(" ")
	const attrs = Object.entries(part.attrs ?? {})
		.map(([key, v]) => ` ${key}="${escape(value(v))}"`)
		.join("")
	const placed = transform === "" ? "" : ` transform="${transform}"`
	const inner = (part.children ?? []).map(markup).join("") + escape(part.text ?? "")
	return `<${part.tag} id="${part.id}"${attrs}${placed}>${inner}</${part.tag}>`
}

/**
 * An organic part's vector: only where it goes, its grip marked and a dashed line toward where it
 * enters the frame. It is a layout for review, never a shape for a sprite to follow.
 */
export const envelope = (part: OrganicPart<string>): readonly Part[] => [
	{
		id: `${part.id}-reach`,
		tag: "line",
		attrs: {
			x1: 0,
			y1: 0,
			x2: part.reach.x,
			y2: part.reach.y,
			stroke: "#888",
			"stroke-width": 2,
			"stroke-dasharray": "8 6",
			"vector-effect": "non-scaling-stroke"
		}
	},
	{
		id: `${part.id}-grip`,
		tag: "circle",
		attrs: { cx: 0, cy: 0, r: 0.012, fill: "none", stroke: "#888", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }
	}
]

/** A part's vector placed at its position and turned to its angle about its origin. */
export const placed = (id: string, at: Vec, children: readonly Part[], angle = 0): Part => ({
	id: `${id}-at`,
	tag: "g",
	translate: [at.x, at.y],
	...(angle === 0 ? {} : { rotate: [(angle * 180) / Math.PI, 0, 0] as const }),
	children
})

/**
 * A dented body drawn flattened from where it touches down: its height scaled by `squash`, its
 * width widened to keep its volume (1/√squash), about the point `below` meters under its center.
 */
const squashed = (id: string, children: readonly Part[], squash: number, below: number): readonly Part[] => [
	{
		id: `${id}-dent`,
		tag: "g",
		attrs: { transform: `translate(0 ${-below}) scale(${1 / Math.sqrt(squash)} ${squash}) translate(0 ${below})` },
		children
	}
]

/**
 * The scene at time `t`: solid parts at their placements (where specified when absent), animated
 * parts at their keyed angles, the organic holder in its pose. Each part is drawn as `drawing` gives
 * it (its sprite), else as its vector, in draw order, with `over` drawn on top in world meters and
 * `annotations` in canvas pixels. With no sprites it is the mock-up a reviewer checks the layout on.
 */
export const frame = <L extends string>(
	scene: SimScene<L>,
	t: number,
	options: {
		readonly drawing?: (name: string) => Part | undefined
		readonly over?: readonly Part[]
		readonly annotations?: string
		readonly background?: string
		readonly placements?: Readonly<Record<string, Placement>>
		/** Where a layer's frame `k` is found; without it a layer is drawn as its outline. */
		readonly layerFrame?: (layer: Layer, k: number) => string
	} = {}
): string => {
	const drawn = (name: string, vector: readonly Part[]) => {
		const sprite = options.drawing?.(name)
		return sprite === undefined ? vector : [sprite]
	}
	const pose = poseAt(scene.release, t)
	const holder = scene.release.holder
	// A holder's sprite drawn holding the parts already shows them.
	const holding =
		holder !== undefined && pose === holder.from && options.drawing?.(`${holder.id}-${pose}`) !== undefined
	// The setting picture, when there is one, is drawn behind everything.
	const setting = options.drawing?.(SETTING)
	const stack = stacking(scene)
	const depth = (id: string) => stack.get(id) ?? 0
	const parts = [
		...scene.solids
			.filter((s) => !(holding && scene.release.parts.includes(s.id)))
			.map((s) => {
				const placement = options.placements?.[s.id]
				const look = drawn(s.id, bodyVector(s))
				const below = s.body.kind === "ball" ? s.body.radius : s.body.height / 2
				const pose = worldPose(scene, s.id, t, options.placements)
				return {
					depth: depth(s.id),
					part: placed(
						s.id,
						pose.at,
						placement?.squash === undefined ? look : squashed(s.id, look, placement.squash, below),
						pose.angle
					)
				}
			}),
		...scene.animated.map((a) => {
			const playing = a.cycle === undefined ? undefined : cycleDrawing(a.id, a.cycle, a, t)
			const look = playing !== undefined && options.drawing?.(playing) !== undefined ? playing : a.id
			const pose = worldPose(scene, a.id, t, options.placements)
			return { depth: depth(a.id), part: placed(a.id, pose.at, drawn(look, a.vector), pose.angle) }
		}),
		...scene.layers.map((layer) => {
			const pose =
				layer.parent === undefined
					? { at: layer.at, angle: 0 }
					: compose(worldPose(scene, layer.parent, t, options.placements), { at: layer.at, angle: 0 })
			const height = (layer.width * layer.pixels.height) / layer.pixels.width
			const look =
				options.layerFrame === undefined
					? {
							id: `${layer.id}-outline`,
							tag: "rect" as const,
							attrs: { x: 0, y: 0, width: layer.width, height, fill: "none", stroke: "#888", "stroke-width": 2, "stroke-dasharray": "8 6", "vector-effect": "non-scaling-stroke" }
						}
					: layerDrawing(layer, options.layerFrame(layer, layerFrameAt(layer, t)))
			return { depth: depth(layer.id), part: placed(layer.id, pose.at, [look], pose.angle) }
		}),
		...scene.organic.map((o) => {
			const at = worldPose(scene, o.id, t, options.placements)
			return { depth: depth(o.id), part: placed(o.id, at.at, drawn(`${o.id}-${pose ?? ""}`, envelope(o)), at.angle) }
		})
	]
		.sort((a, b) => a.depth - b.depth)
		.map(({ part }) => markup(part))
		.join("")
	const over = (options.over ?? []).map(markup).join("")
	const { width, height } = scene.camera.canvas
	const background =
		options.background === undefined ? "" : `<rect width="${width}" height="${height}" fill="${options.background}"/>`
	// Each mark where its part stood at the start: an ellipse round its body, faint and dashed.
	const marks = scene.marks
		.filter((mark) => t >= mark.from)
		.flatMap((mark) => {
			const part = scene.solids.find((s) => s.id === mark.of)
			if (part === undefined) return []
			const pose = worldPose(scene, mark.of, 0)
			const r = part.body.kind === "ball" ? { x: part.body.radius, y: part.body.radius } : { x: part.body.width / 2, y: part.body.height / 2 }
			return [
				placed(`${mark.of}-mark`, pose.at, [
					{ id: `${mark.of}-mark-outline`, tag: "ellipse", attrs: { cx: 0, cy: 0, rx: r.x, ry: r.y, fill: "none", stroke: "#7a7a7a", "stroke-opacity": 0.7, "stroke-width": 3, "stroke-dasharray": "10 8", "vector-effect": "non-scaling-stroke" } }
				], pose.angle)
			]
		})
		.map(markup)
		.join("")
	const behind = (setting === undefined ? "" : markup(setting)) + marks
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}<g transform="${projection(scene.camera)}">${behind}${parts}${over}</g>${options.annotations ?? ""}</svg>`
}

/** The scene's vectors at time `t`, on white. */
export const mockup = <L extends string>(scene: SimScene<L>, t: number, annotations = ""): string =>
	frame(scene, t, { annotations, background: "#fff" })

/**
 * A dimension line between two world points, labelled in canvas pixels beside it: how a mock-up
 * shows the specification it was drawn from.
 */
export const dimension = (camera: Camera, a: Vec, b: Vec, label: string, side: Vec): string => {
	const p = toCanvas(camera, a)
	const q = toCanvas(camera, b)
	const mid = { x: (p.x + q.x) / 2 + side.x, y: (p.y + q.y) / 2 + side.y }
	return `<g stroke="#666" stroke-width="2" fill="#666" font-family="Helvetica, Arial, sans-serif" font-size="30"><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" marker-start="url(#tick)" marker-end="url(#tick)"/><text x="${mid.x}" y="${mid.y}" stroke="none">${escape(label)}</text></g>`
}

/** The tick a dimension line ends in. */
export const DIMENSION_DEFS = `<defs><marker id="tick" viewBox="-6 -6 12 12" markerWidth="12" markerHeight="12" orient="auto"><path d="M0 -6 V6" stroke="${OUTLINE}" stroke-width="2"/></marker></defs>`
