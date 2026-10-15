import type { Part } from "#part.ts"
import type { SpriteRecord } from "#sim/document.ts"
import { cycleNames, type Layer, type SimScene } from "#sim/part.ts"

/**
 * How each part of a scene is drawn from the sprites its document records: pure, so the vector
 * tooling and a browser editor draw from one definition. `href` says where a record's image is
 * found (a data URI here, a served file in an editor). A tiled part's recorded unit is cropped to
 * its drawing, so its size is the unit's.
 */

type Fit = Pick<SpriteRecord, "kx" | "ky" | "ox" | "oy" | "width" | "height">

/** A sprite as an SVG element in its part's frame (meters, Y up), flipped back upright. */
export const spriteDrawing = (name: string, fit: Fit, href: string): Part => ({
	id: `${name}-placed`,
	tag: "g",
	attrs: { transform: `translate(${fit.ox} ${fit.oy}) scale(${fit.kx} ${-fit.ky})` },
	children: [{ id: `${name}-sprite`, tag: "image", attrs: { width: fit.width, height: fit.height, href } }]
})

/**
 * A tiled part: a repeat unit (`unit` its pixel size, cropped to its drawing) scaled to the slab's
 * height and laid end to end across its width, the last tile trimmed to the width that is left by
 * slicing its image, so the part is exactly as long as its body.
 */
export const tiledDrawing = (
	name: string,
	unit: { readonly width: number; readonly height: number },
	href: string,
	width: number,
	height: number
): Part => {
	const k = height / unit.height
	const tileW = unit.width * k
	const count = Math.ceil(width / tileW - 1e-9)
	return {
		id: `${name}-tiles`,
		tag: "g",
		children: Array.from({ length: count }, (_, i) => ({
			id: `${name}-tile-${i}`,
			tag: "image" as const,
			attrs: {
				href,
				width: Math.min(unit.width, (width - i * tileW) / k),
				height: unit.height,
				preserveAspectRatio: "xMinYMin slice",
				transform: `translate(${-width / 2 + i * tileW} ${height / 2}) scale(${k} ${-k})`
			}
		}))
	}
}

/** A clip layer's frame `href` at its place, its lower-left corner at the origin of its frame. */
export const layerDrawing = (layer: Layer, href: string): Part => {
	const k = layer.width / layer.pixels.width
	return {
		id: `${layer.id}-layer`,
		tag: "g",
		attrs: { transform: `translate(0 ${layer.pixels.height * k}) scale(${k} ${-k})` },
		children: [{ id: `${layer.id}-frame`, tag: "image", attrs: { width: layer.pixels.width, height: layer.pixels.height, href } }]
	}
}

/** A plain prism drawn in the style: its flat fill, one darker tone along its lower part, a contour. */
export const proceduralSlab = (name: string, width: number, height: number, fill: string, shade: string): Part => ({
	id: `${name}-drawn`,
	tag: "g",
	children: [
		{ id: `${name}-fill`, tag: "rect", attrs: { x: -width / 2, y: -height / 2, width, height, fill } },
		{
			id: `${name}-tone`,
			tag: "rect",
			attrs: { x: -width / 2, y: -height / 2, width, height: height * 0.55, fill: shade }
		},
		{
			id: `${name}-edge`,
			tag: "rect",
			attrs: {
				x: -width / 2,
				y: -height / 2,
				width,
				height,
				fill: "none",
				stroke: "#2b2b2b",
				"stroke-width": 3,
				"vector-effect": "non-scaling-stroke"
			}
		}
	]
})

/** Every part's drawing from the recorded sprites, keyed as `frame` looks them up. */
export const recordedDrawings = <L extends string>(
	scene: SimScene<L>,
	sprites: Readonly<Record<string, SpriteRecord>>,
	href: (record: SpriteRecord) => string
): Map<string, Part> => {
	const drawn = new Map<string, Part>()
	for (const [key, record] of Object.entries(sprites)) {
		const tiled = scene.solids.find((s) => s.sprite === key && s.render.kind === "tiled")
		drawn.set(
			key,
			tiled !== undefined && tiled.body.kind === "slab"
				? tiledDrawing(key, record, href(record), tiled.body.width, tiled.body.height)
				: spriteDrawing(key, record, href(record))
		)
	}
	for (const part of scene.animated) {
		const record = sprites[part.sprite]
		if (record !== undefined) drawn.set(part.id, spriteDrawing(part.sprite, record, href(record)))
		const names = part.cycle === undefined ? [] : cycleNames(part.cycle)
		for (const name of names) {
			const record = sprites[name(part.sprite)]
			if (record !== undefined) drawn.set(name(part.id), spriteDrawing(name(part.sprite), record, href(record)))
		}
	}
	for (const part of scene.solids) {
		const record = sprites[part.sprite]
		if (part.sprite !== part.id && record !== undefined) drawn.set(part.id, spriteDrawing(part.sprite, record, href(record)))
		if (part.render.kind === "procedural" && part.body.kind === "slab") {
			drawn.set(part.id, proceduralSlab(part.id, part.body.width, part.body.height, part.placeholder.fill, part.render.shade))
		}
	}
	return drawn
}
