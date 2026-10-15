import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { admitDocument, type SceneDocument, type SpriteRecord } from "#sim/document.ts"
import type { SimScene } from "#sim/part.ts"

/** A document read from disk: the record itself, the scene it describes, and its folder. */
export interface Admitted {
	readonly path: string
	readonly folder: string
	readonly document: SceneDocument
	readonly scene: SimScene<string>
}

export const readDocument = async (path: string): Promise<Admitted> => ({
	path,
	folder: dirname(path),
	...admitDocument(JSON.parse(await readFile(path, "utf8")))
})

export const sha256Of = async (file: string): Promise<string> =>
	createHash("sha256").update(await readFile(file)).digest("hex")

/** A sprite record's file, resolved against its document's folder. */
export const spriteFile = (admitted: Admitted, record: SpriteRecord): string => join(admitted.folder, record.file)
