// The bake worker: builds catalog models (web/models3d.js and web/models/*.js, the very same code) off the page's main thread and sends back what their
// textures took longest to work out, so the page's own build of the same model finds it done (models3d.js prebake / bakeOnce / tex). Nothing it builds
// is shown: only the pixel buffers come back, keyed as the model code itself keys them, and the page's build uses them only for those keys.
// Module workers have no import map, so every module is fetched, its bare imports (three.js and its addons) pointed at the page's own
// files and its relative ones at their rewritten copies, and imported from a blob: URL. Canvases are OffscreenCanvases.
// Messages in:  {type: "init", models: url of models3d.js, importmap: {imports}}  →  {type: "ready"} | {type: "failed", error}
//               {type: "bake", id, solid, props, look}                          →  {type: "baked", id, records: [[key, value]...], ms, held, error?}
// `held`: the bytes of pixels its canvases hold now (they stay in its caches: the page retires a worker that holds too much, see models3d.js).
self.__BAKE_WORKER__ = true
const canvases = [] // WeakRefs of every canvas made here
self.document ??= {
	createElement(tag) {
		if (String(tag).toLowerCase() === "canvas") {
			const c = new OffscreenCanvas(300, 150)
			canvases.push(new WeakRef(c))
			return c
		}
		throw new Error(`bake worker: no <${tag}> here`)
	},
}
function heldBytes() {
	let n = 0
	for (let i = canvases.length - 1; i >= 0; i--) {
		const c = canvases[i].deref()
		if (!c) canvases.splice(i, 1)
		else n += c.width * c.height * 4
	}
	return n
}

// Text is drawn with the fonts this worker has loaded so far, which can be a fallback for the first words it draws: a canvas with text on it is never sent
// (the page draws it itself, as before).
for (const P of [self.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean)) {
	for (const k of ["fillText", "strokeText"]) {
		const f = P[k]
		P[k] = function (...a) {
			this.canvas.__text = true
			return f.apply(this, a)
		}
	}
}

let imports = {}
const blobs = new Map() // module url -> Promise<blob url>
function resolve(spec, base) {
	if (imports[spec]) return new URL(imports[spec], location.href).href
	for (const [k, v] of Object.entries(imports)) if (k.endsWith("/") && spec.startsWith(k)) return new URL(v + spec.slice(k.length), location.href).href
	return new URL(spec, base).href
}
const STATIC = /((?:^|[;\n}])\s*(?:import|export)\s[^'"`;]*?\bfrom\s*)(['"])([^'"\n]+)\2/g
/** A blob: URL of this module with every import pointed at a loadable copy (three.module.js itself has none and is imported as it is). */
function load(url) {
	let p = blobs.get(url)
	if (p) return p
	p = (async () => {
		const res = await fetch(url)
		if (!res.ok) throw new Error(`bake worker: ${url} answered ${res.status}`)
		let src = await res.text()
		if (!STATIC.test(src) && !/\bimport\(/.test(src)) return url // (nothing to point anywhere else: import it as it is)
		STATIC.lastIndex = 0
		const deps = new Map()
		for (const m of src.matchAll(STATIC)) {
			const abs = resolve(m[3], url)
			if (!deps.has(abs)) deps.set(abs, load(abs))
		}
		const done = new Map()
		for (const [abs, q] of deps) done.set(abs, await q)
		src = src.replace(STATIC, (all, head, q, spec) => `${head}${q}${done.get(resolve(spec, url))}${q}`)
		// a dynamic import (models3d.js loads the model groups so) goes through the same loader, relative to the module's own url
		src = src.replace(/(^|[^\w$.])import\(/g, `$1self.__bakeImport(${JSON.stringify(url)}, `)
		return URL.createObjectURL(new Blob([src], { type: "text/javascript" }))
	})()
	blobs.set(url, p)
	return p
}
self.__bakeImport = async (base, spec) => import(await load(resolve(spec, base)))

let models = null
let ready = null
function init(msg) {
	imports = msg.importmap?.imports ?? {}
	ready ??= (async () => {
		models = await import(await load(msg.models))
		if (typeof models.recordBakes !== "function") throw new Error("bake worker: models3d.js has no recordBakes")
	})()
	ready.then(() => postMessage({ type: "ready" }), (e) => postMessage({ type: "failed", error: String(e?.stack ?? e) }))
}

/** Every typed array buffer in a record value, for the transfer list (each buffer once). */
function buffersOf(v, out = new Set()) {
	if (!v || typeof v !== "object") return out
	if (ArrayBuffer.isView(v)) out.add(v.buffer)
	else if (v instanceof ImageData) out.add(v.data.buffer)
	else if (Array.isArray(v)) for (const x of v) buffersOf(x, out)
	else for (const k in v) buffersOf(v[k], out)
	return out
}

async function bake(msg) {
	const t0 = performance.now()
	let records = []
	let error = null
	try {
		await ready
		records = models.recordBakes(() => models.buildModel(msg.solid, { props: msg.props, look: msg.look }))
	} catch (e) {
		error = String(e?.message ?? e)
	}
	const transfer = new Set()
	for (const [, v] of records) buffersOf(v, transfer)
	postMessage({ type: "baked", id: msg.id, records, ms: performance.now() - t0, held: heldBytes(), error }, [...transfer])
}

self.onmessage = (e) => {
	const msg = e.data
	if (msg?.type === "init") init(msg)
	else if (msg?.type === "bake") bake(msg)
}
