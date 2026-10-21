// Product-shot thumbnails for the catalog cards: each item's realistic 3D model (web/models3d.js), lit like a
// studio photo from three-quarters, rendered off screen one at a time and cached. Until a card's picture is
// ready it keeps the flat drawing it was given. The app opts in (setVisibleOnly, setPause) to photograph only the cards and
// icons that are on screen, the ones that scrolled in first, and to wait while something is moving. Without that (the dev
// sheets) every canvas that asks is photographed, in order.
//
// Each photo is OPAQUE, taken over the card's own background colour (the page's --view-bg, light or dark theme), so glass, ice and
// water bottles have a real backdrop to refract (a transparent clear colour leaves three's transmission pass nothing to see through,
// which made them milky white discs), and edges are antialiased against the colour they sit on. It is rendered at 2x and filtered down, then
// kept with a small mip chain so a 40 px icon does not alias. When the theme changes the photos are taken again in the new colour.
// Shadows are a soft contact shadow under the item that fades with height (a bar high above the floor leaves none); the framing includes where that shadow lies,
// so the card's edge never cuts it off (the faint shade of a part higher up, which the framing leaves out, fades before the edge). On a light card thin glass gets
// a dark line where its surface turns edge-on and the glass ball's additive reflection shell is left out (it would clip to white); a clear item (glass, ice, water)
// is photographed there in a studio of its own (a tonal floor its glass refracts, a dark surround, a studio to reflect: see glassStudio); a dark card is
// photographed as the models are.
// A pulley item is photographed whole, its wheels, brackets and rope laid out as view3d.js lays them out (one wheel spanning both runs for an Atwood machine), its loads
// hung 3 heights below the wheels with plumb ropes; a conveyor belt is drawn as view3d.js draws it.
import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { buildModel, modelFor, prebake, thumbFor } from "./models3d.js"
import { startPoses } from "./editor.js"

const W = 384 // the stored photo
const H = 288
const SS = 2 // supersampling: rendered at SS x, filtered down to W x H
const CS = 256 // contact-shadow texture
const D2R = Math.PI / 180
const SHADE_SOLID = 0.55 // the contact shadow's darkest, under a solid part touching the floor
const SHADE_CLEAR = 0.1 // ... and under clear glass or ice
const MARGIN = 0.18 // empty border round the framed item, as a fraction of its half size
const SHADE_EDGE = 0.08 // the contact shadow fades out over this outer fraction of the picture's half size (gone by its last quarter): the faint shade of a part higher up that the framing leaves
// out (the peg's dowel, 30 mm up and out in front of its board: 5 %) never reaches the card's edge, which stays the card colour (a shadow the framing keeps is never there)
const CAM_AZ = -32 // the camera: three-quarters from the front left (degrees round from +z toward +x) ...
const CAM_EL = 22 // ... a little above
let renderer = null
let scene = null
let camera = null
let key = null
let floor = null
const cs = {} // contact-shadow resources
const shots = new WeakMap() // preview -> {canvas, key (the background it was taken over), levels (halved copies, made when a small canvas asks)}
const typeOf = new WeakMap() // preview -> catalog type
const waiting = new Map() // preview -> [canvas]
const previewOf = new WeakMap() // canvas -> the preview it is waiting for
const drawnOf = new WeakMap() // canvas -> the preview it was last asked to show (to repaint after a theme change)
const drawnRefs = new Set() // WeakRef(canvas) of every canvas asked, pruned as they die
const visible = new Set() // waiting canvases that are on screen right now (an IntersectionObserver keeps this)
const failed = new WeakSet() // previews that could not be photographed (not retried on every search)
const themeStale = new WeakSet() // previews whose photo is in the old theme's colour and is being retaken: that retake does not wait for playback to pause (a stuck light card on a dark page is worse than one stutter)
const queue = [] // previews waiting for a photo, next first
let looks = {}
let busy = false
let pauseCheck = null
let gated = false
let retry = 0
let io = null

// ---------------------------------------------------------------- the card's colour (light or dark theme)
let bgCache = null // {css: "#rrggbb", color: THREE.Color}
let themeWatched = false
function readCardColor() {
	let css = ""
	try {
		css = getComputedStyle(document.documentElement).getPropertyValue("--view-bg").trim()
	} catch {}
	if (!css) {
		let dark = false
		try {
			const t = document.documentElement.dataset.theme
			dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
		} catch {}
		css = dark ? "#232220" : "#f4f4f2" // (style.css's --view-bg, for a page that does not define it)
	}
	try { // let the browser parse whatever the CSS holds (hex, rgb(), color-mix()) into plain 8-bit sRGB
		const c = document.createElement("canvas")
		c.width = c.height = 1
		const g = c.getContext("2d", { willReadFrequently: true })
		g.fillStyle = "#f4f4f2"
		g.fillStyle = css
		g.fillRect(0, 0, 1, 1)
		const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
		const hex = "#" + [r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join("")
		return { css: hex, color: new THREE.Color(hex) }
	} catch {
		return { css: "#f4f4f2", color: new THREE.Color("#f4f4f2") }
	}
}
const cardColor = () => (bgCache ??= readCardColor())
const bgKey = () => cardColor().css
function watchTheme() {
	if (themeWatched) return
	themeWatched = true
	let timer = 0
	const run = () => {
		const before = bgCache?.css
		bgCache = null
		if (cardColor().css === before) return
		for (const ref of [...drawnRefs]) { // every card and icon now shows the old colour: ask again (the new photos come progressively, the old ones stay until then)
			const c = ref.deref()
			if (!c) drawnRefs.delete(ref)
			else if (c.isConnected && drawnOf.has(c)) {
				themeStale.add(drawnOf.get(c))
				drawPreview3D(c, drawnOf.get(c), looks, null)
			}
		}
	}
	const changed = () => {
		clearTimeout(timer)
		timer = setTimeout(run, 100)
	}
	try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", changed) } catch {}
	try { new MutationObserver(changed).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] }) } catch {}
}

/** fn() → true while something is moving that a render (100 ms to 1.5 s of main thread) would stutter: the queue waits and looks again. */
export function setPause(fn) {
	pauseCheck = fn
}
/** on: only previews with a canvas on screen are photographed (the app's catalog and inspector); off (default): all of them, in order. */
export function setVisibleOnly(on) {
	gated = !!on
}
/** Whether this preview has a photo taken over the card colour of the current theme. */
export const hasShot = (preview) => shots.get(preview)?.key === bgKey()
/** These canvases (screen order) are what the person is looking at now: their previews go to the front of the queue. */
export function prioritize(canvases) {
	const front = []
	for (const c of canvases) {
		const p = previewOf.get(c)
		if (p && waiting.has(p) && !front.includes(p)) front.push(p)
	}
	if (!front.length) return
	const set = new Set(front)
	queue.splice(0, queue.length, ...front, ...queue.filter((p) => !set.has(p)))
	pump()
}
function watch(canvas) {
	if (!gated) return
	if (typeof IntersectionObserver === "undefined") return visible.add(canvas) // (no observer: everything counts as on screen)
	io ??= new IntersectionObserver((entries) => {
		const last = new Map(entries.map((e) => [e.target, e])) // (one callback may carry a target twice)
		const shown = []
		for (const e of last.values()) {
			if (!e.isIntersecting) visible.delete(e.target)
			else if (!visible.has(e.target)) { visible.add(e.target); shown.push(e) }
		}
		if (shown.length) { // newly on screen: first in line, top left first
			shown.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
			prioritize(shown.map((e) => e.target))
		}
		pump()
	})
	io.observe(canvas)
}
function unwatch(canvas) {
	io?.unobserve(canvas)
	visible.delete(canvas)
}

export function setCatalog(catalog) {
	looks = catalog.looks ?? {}
	for (const t of catalog.types) typeOf.set(t.preview, t)
}

/** Draw this preview's 3D shot into canvas, now if it's ready, else after it renders (the fallback draws meanwhile). */
export function drawPreview3D(canvas, preview, lk, fallback) {
	watchTheme()
	if (!drawnOf.has(canvas)) {
		if (drawnRefs.size > 400) for (const ref of drawnRefs) if (!ref.deref()) drawnRefs.delete(ref) // (canvases that are gone)
		drawnRefs.add(new WeakRef(canvas))
	}
	drawnOf.set(canvas, preview)
	const shot = shots.get(preview)
	if (shot && shot.key === bgKey()) return blit(shot, canvas)
	if (failed.has(preview)) return
	fallback?.(canvas, preview, lk)
	if (shot) blit(shot, canvas) // a photo in the old theme's colour stays until the new one arrives (not a flat drawing in between)
	if (fallback && !modelled(preview)) return // with a flat drawing to show, wait for the real model; without one, photograph the stand-in
	if (!waiting.has(preview)) {
		waiting.set(preview, [])
		if (!queue.includes(preview)) queue.push(preview)
	}
	const list = waiting.get(preview)
	if (!list.includes(canvas)) {
		const old = waiting.get(previewOf.get(canvas)) // a canvas reused for another item (an inspector row whose item changed) stops waiting for the old photo
		if (old?.includes(canvas)) old.splice(old.indexOf(canvas), 1)
		previewOf.set(canvas, preview)
		list.push(canvas)
		watch(canvas)
	}
	pump()
}

/** Whether every visible part of this item has its realistic model (or is a part another part's model covers), or the item has a model of
 *  its whole for the photo (models3d.js addThumb: a type a view plug-in draws in a scene). */
function modelled(preview) {
	const solids = (preview.solids ?? []).filter((s) => !s.hidden_3d)
	return (solids.length > 0 && solids.every((s) => modelFor(s) !== undefined)) || thumbFor(typeOf.get(preview)?.key) !== undefined
}
/** The props a photo's models are built with: the type's defaults, with its automatic props at their listed defaults too (the catalog's
 *  `defaults` leave those out, as an item that does not set them resolves them; a water tank's model needs its length, height, depth and
 *  fill, which its style sets: without them it came out NaN, "nothing to photograph", and its card kept the flat drawing). */
function propsOf(t) {
	const out = {}
	for (const p of t?.props ?? []) if (p && typeof p.key === "string" && p.default !== undefined) out[p.key] = p.default
	return { ...out, ...(t?.defaults ?? {}) }
}

/** The next preview to photograph (with a canvas on screen, when gated), or null. */
const nextVisible = () => (gated ? queue.find((p) => (waiting.get(p) ?? []).some((c) => visible.has(c))) : queue[0]) ?? null

function pump() {
	if (busy) return
	clearTimeout(retry)
	retry = 0
	const first = nextVisible()
	if (!first) return // nothing on screen waits for a photo (the observer calls pump again when a card scrolls in)
	if (pauseCheck?.() && !themeStale.has(first)) { // something is moving: look again shortly
		retry = setTimeout(pump, 300)
		return
	}
	busy = true
	const next = async () => {
		const preview = nextVisible()
		if (!preview || (pauseCheck?.() && !themeStale.has(preview))) { // it scrolled away, or the app started moving, while this waited for an idle moment
			busy = false
			pump()
			return
		}
		queue.splice(queue.indexOf(preview), 1)
		prebakeAhead(preview)
		try {
			const shot = await render(preview)
			if (shot.key !== bgKey()) { // the theme changed while this rendered: its canvases are asking again for the new colour
				queue.push(preview)
			} else {
				shots.set(preview, shot)
				themeStale.delete(preview)
				for (const c of waiting.get(preview) ?? []) blit(shot, c) // every card that asked (also while this rendered), on screen or not
				for (const c of waiting.get(preview) ?? []) unwatch(c)
				waiting.delete(preview)
			}
		} catch (e) {
			failed.add(preview)
			themeStale.delete(preview)
			console.warn("thumbnail failed:", e)
			for (const c of waiting.get(preview) ?? []) unwatch(c)
			waiting.delete(preview)
		}
		busy = false
		if (nextVisible()) setTimeout(pump, 0)
		else releaseLater()
	}
	;(window.requestIdleCallback ?? ((f) => setTimeout(f, 16)))(next, { timeout: 200 })
}

// The bake workers (models3d.js prebake) work out a photo's model textures off the main thread: the one being taken and the next few on screen are put at the
// front of their queue, and a photo waits for its own (at most PREBAKE_WAIT_MS) before building its models, which then only make their geometry.
const PREBAKE_WAIT_MS = 6000
const AHEAD = 3
function prebakeJobs(preview, list) {
	const props = propsOf(typeOf.get(preview))
	for (const s of preview.solids ?? []) if (!s.hidden_3d) list.push({ solid: s, props, look: looks[s.look] ?? {} })
	return list
}
function prebakeAhead(preview) {
	const list = prebakeJobs(preview, [])
	let n = 0
	for (const p of queue) {
		if (n >= AHEAD) break
		if (p === preview || (gated && !(waiting.get(p) ?? []).some((c) => visible.has(c)))) continue
		prebakeJobs(p, list)
		n++
	}
	prebake(list, { front: true })
}
async function prebaked(preview) {
	const jobs = prebake(prebakeJobs(preview, [])).filter(Boolean)
	if (!jobs.length) return
	let timer = 0
	await Promise.race([Promise.all(jobs.map((j) => j.promise)), new Promise((r) => (timer = setTimeout(r, PREBAKE_WAIT_MS)))])
	clearTimeout(timer)
}

/** The photo's copy at about this width: the stored picture halved as often as it stays at least that wide (a 40 px icon is not sampled from 384 px). */
function levelFor(shot, width) {
	let level = shot.canvas
	shot.levels ??= [shot.canvas]
	for (let i = 1; ; i++) {
		const w = Math.round(W / 2 ** i)
		if (w < width || w < 24) break
		let c = shot.levels[i]
		if (!c) {
			c = document.createElement("canvas")
			c.width = w
			c.height = Math.round(H / 2 ** i)
			const g = c.getContext("2d")
			g.imageSmoothingQuality = "high"
			g.drawImage(shot.levels[i - 1], 0, 0, c.width, c.height)
			shot.levels[i] = c
		}
		level = c
	}
	return level
}

function blit(shot, canvas) {
	const dpr = window.devicePixelRatio || 1
	const cw = canvas.clientWidth || parseFloat(canvas.style.width) || canvas.width / dpr // (a card hidden by a search has no layout size)
	const ch = canvas.clientHeight || parseFloat(canvas.style.height) || canvas.height / dpr
	if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr)
	if (canvas.height !== Math.round(ch * dpr)) canvas.height = Math.round(ch * dpr)
	const g = canvas.getContext("2d")
	g.setTransform(1, 0, 0, 1, 0, 0)
	g.clearRect(0, 0, canvas.width, canvas.height)
	const k = Math.min(canvas.width / W, canvas.height / H)
	g.imageSmoothingEnabled = true
	g.imageSmoothingQuality = "high"
	g.drawImage(levelFor(shot, W * k), (canvas.width - W * k) / 2, (canvas.height - H * k) / 2, W * k, H * k)
}

// ---------------------------------------------------------------- the studio
// The studio's GPU side (its own WebGL context: render targets, the room's and the studio's light, and every photographed model's textures uploaded once more:
// a few hundred MB once the catalog has been browsed) is let go once nothing on screen has waited for a photo for RELEASE_MS; the photos are kept (2D canvases)
// and the studio is set up again when the next one is wanted.
const RELEASE_MS = 8000
let releaseTimer = 0
function releaseLater() {
	clearTimeout(releaseTimer)
	releaseTimer = setTimeout(release, RELEASE_MS)
}
function release() {
	if (!renderer) return
	if (busy || nextVisible()) return releaseLater()
	renderer.dispose()
	renderer.forceContextLoss()
	renderer = scene = camera = key = floor = null
	for (const k of Object.keys(cs)) delete cs[k]
	studioEnvTexture = null
}

function init() {
	clearTimeout(releaseTimer)
	if (renderer) return
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
	renderer.setPixelRatio(1)
	renderer.setSize(W * SS, H * SS, false)
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.AgXToneMapping
	renderer.toneMappingExposure = 1.05
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.shadowMap.autoUpdate = false // (updated on purpose, for the main picture only)
	scene = new THREE.Scene()
	const pmrem = new THREE.PMREMGenerator(renderer)
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
	scene.environmentIntensity = 0.75
	camera = new THREE.PerspectiveCamera(30, W / H, 0.001, 50)
	scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 0.6))
	key = new THREE.DirectionalLight(0xfff4e6, 2.4)
	key.castShadow = true
	key.shadow.mapSize.set(1024, 1024)
	key.shadow.radius = 4
	key.shadow.bias = -0.0004
	scene.add(key, key.target)

	// The soft contact shadow on the floor: the item seen from under the floor through an orthographic camera, drawn as black whose
	// opacity falls from full at the floor to nothing at height cs.fade, then blurred, and laid on the floor as a plane. The lowest surface
	// wins (depth test), parts above cs.fade leave none, and a slant shifts a part's shadow with its height like a light from the front left would.
	const mk = (glass) => {
		const m = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, transparent: glass, depthWrite: !glass })
		const u = { darkness: { value: 0.5 }, slant: cs.slant ??= { value: new THREE.Vector2() } }
		m.onBeforeCompile = (sh) => {
			sh.uniforms.darkness = u.darkness
			sh.uniforms.slant = u.slant
			sh.vertexShader = "uniform vec2 slant;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n\tmvPosition.xy += slant * -mvPosition.z;\n\tgl_Position = projectionMatrix * mvPosition;")
			sh.fragmentShader = "uniform float darkness;\n" + sh.fragmentShader.replace(/\}\s*$/, "\tgl_FragColor = vec4( 0.0, 0.0, 0.0, ( 1.0 - fragCoordZ ) * darkness );\n}")
		}
		m.customProgramCacheKey = () => (glass ? "thumb-contact-glass" : "thumb-contact")
		m.userData.u = u
		return m
	}
	cs.solid = mk(false)
	cs.glass = mk(true)
	cs.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	cs.camera.rotation.x = Math.PI / 2 // looks straight up from the floor; its picture's right is +x, its top is +z
	cs.a = new THREE.WebGLRenderTarget(CS, CS)
	cs.b = new THREE.WebGLRenderTarget(CS, CS)
	for (const t of [cs.a, cs.b]) t.texture.generateMipmaps = false
	cs.blur = new THREE.ShaderMaterial({ // a 9-tap Gaussian along `dir` (in uv), on all four channels
		uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
		vertexShader: "varying vec2 vUv;\nvoid main() {\n\tvUv = uv;\n\tgl_Position = vec4( position.xy, 0.0, 1.0 );\n}",
		fragmentShader: "uniform sampler2D tDiffuse;\nuniform vec2 dir;\nvarying vec2 vUv;\nvoid main() {\n\tvec4 sum = texture2D( tDiffuse, vUv ) * 0.1633;\n\tsum += ( texture2D( tDiffuse, vUv - dir ) + texture2D( tDiffuse, vUv + dir ) ) * 0.1531;\n\tsum += ( texture2D( tDiffuse, vUv - 2.0 * dir ) + texture2D( tDiffuse, vUv + 2.0 * dir ) ) * 0.12245;\n\tsum += ( texture2D( tDiffuse, vUv - 3.0 * dir ) + texture2D( tDiffuse, vUv + 3.0 * dir ) ) * 0.0918;\n\tsum += ( texture2D( tDiffuse, vUv - 4.0 * dir ) + texture2D( tDiffuse, vUv + 4.0 * dir ) ) * 0.051;\n\tgl_FragColor = sum;\n}",
		depthTest: false,
	})
	cs.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cs.blur)
	cs.quadScene = new THREE.Scene()
	cs.quadScene.add(cs.quad)
	cs.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	cs.invert = new THREE.ShaderMaterial({ // the shadow as a light map: 1 where the floor is lit, less under the item
		uniforms: { tDiffuse: { value: null } },
		vertexShader: "varying vec2 vUv;\nvoid main() {\n\tvUv = uv;\n\tgl_Position = vec4( position.xy, 0.0, 1.0 );\n}",
		fragmentShader: "uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n\tgl_FragColor = vec4( vec3( 1.0 - texture2D( tDiffuse, vUv ).a ), 1.0 );\n}",
		depthTest: false,
	})
	// The floor: an opaque plane in the card's colour that the whole picture sits on (so the glass has it to refract), shaded only by the contact shadow.
	floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) // (rotated so the picture's top, +v, is +z)
	const fm = floor.material
	fm.userData.u = { uMain: { value: new THREE.Vector3(1, 1, 1) }, uBot: { value: new THREE.Vector3(1, 1, 1) }, uTop: { value: new THREE.Vector3(1, 1, 1) }, uEdge: { value: 1 }, uFlat: { value: 0 }, uRes: { value: new THREE.Vector2(W * SS, H * SS) }, uPool: { value: new THREE.Vector4(0, 1, 1, 0.6) }, uSurround: { value: new THREE.Vector2(1, 0.04) }, uBox: { value: new THREE.Vector4(0, 0, 1, 1) } }
	fm.onBeforeCompile = (sh) => { // two colours: the one the camera sees (tone mapped), and the one the glass refracts (raw, a little darker and graded top to bottom, so clear glass shows)
		Object.assign(sh.uniforms, fm.userData.u)
		// A clear item on a light card (see glassStudio): uPool = the floor's pool, in the picture and in what the glass refracts alike: x = how many stops darker right under the
		// item (whose footprint's centre is the light map's centre), y z = its radii in the light map's uv, w = where (a fraction of the picture's half size from its centre)
		// it starts to give way to the plain card colour, which it is again, exactly, at the picture's edges. uSurround (refraction only): x = what the glass sees of the floor
		// away from the item (outside uBox, the box round the item's outline in the picture, 0..1 from the bottom left), reached y picture heights outside the box.
		sh.fragmentShader = "uniform vec3 uMain;\nuniform vec3 uBot;\nuniform vec3 uTop;\nuniform float uEdge;\nuniform float uFlat;\nuniform vec2 uRes;\nuniform vec4 uPool;\nuniform vec2 uSurround;\nuniform vec4 uBox;\n" + sh.fragmentShader
			.replace("#include <map_fragment>", "") // (the contact shadow, `map`, is applied by hand below)
			.replace("#include <tonemapping_fragment>", `vec2 q = gl_FragCoord.xy / uRes - 0.5;\nfloat shade = mix( 1.0, texture2D( map, vMapUv ).r, 1.0 - smoothstep( ${(1 - SHADE_EDGE).toFixed(3)}, ${(1 - SHADE_EDGE / 4).toFixed(3)}, 2.0 * max( abs( q.x ), abs( q.y ) ) ) );\nfloat pool = 1.0;\nif ( uPool.x > 0.0 ) {\n\tvec2 d = ( vMapUv - 0.5 ) / uPool.yz;\n\tpool = exp2( - uPool.x * exp( - dot( d, d ) ) * ( 1.0 - smoothstep( uPool.w, 1.0, length( q * 2.0 ) ) ) );\n}\nvec3 floorTint = uMain * pool;\n#ifndef TONE_MAPPING\n\t{ float t = clamp( gl_FragCoord.y / uRes.y, 0.0, 1.0 ); float e = smoothstep( 0.15, 0.5, max( abs( q.x ), abs( q.y ) ) ); floorTint = mix( mix( uBot, uTop, t * t ), uMain, uFlat ) * pool * shade * mix( 1.0, uEdge, e ); vec2 o = max( max( uBox.xy - q - 0.5, q + 0.5 - uBox.zw ), 0.0 ) * vec2( uRes.x / uRes.y, 1.0 ); floorTint *= mix( 1.0, uSurround.x, smoothstep( 0.0, uSurround.y, length( o ) ) ); }\n#endif\n\tgl_FragColor.rgb = floorTint;\n#include <tonemapping_fragment>`)
			.replace("#include <colorspace_fragment>", "#include <colorspace_fragment>\n#ifdef TONE_MAPPING\n\tgl_FragColor.rgb *= shade;\n#endif") // (in the picture: black at (1 - shade) opacity over the card colour)
	}
	fm.customProgramCacheKey = () => "thumb-floor"
	scene.add(floor)
}

// ---------------------------------------------------------------- the floor's colour
// The floor must come out of the camera as exactly the card's colour, and the glass must see that same colour through itself. Glass tone-maps what
// it refracts (the transmission pass itself is not tone mapped), so the floor is given the colour that AgX (three's tone mapper, ported here) maps
// to the card colour: the floor is tone mapped in the main picture and raw in the refraction buffer, and both end up the card's colour.
const MAT = {
	toRec2020: [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]],
	inset: [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]],
	outset: [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]],
	toSrgb: [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]],
}
const mul3 = (c, v) => [0, 1, 2].map((i) => c[0][i] * v[0] + c[1][i] * v[1] + c[2][i] * v[2]) // (columns, as GLSL's mat3)
/** three's AgXToneMapping on a linear sRGB colour (arrays of 3). */
function agx(rgb, exposure) {
	let v = mul3(MAT.toRec2020, rgb.map((x) => x * exposure))
	v = mul3(MAT.inset, v).map((x) => Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10)) + 12.47393) / (4.026069 + 12.47393))))
	v = v.map((x) => { const x2 = x * x; const x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232 })
	v = mul3(MAT.outset, v).map((x) => Math.max(0, x) ** 2.2)
	return mul3(MAT.toSrgb, v).map((x) => Math.min(1, Math.max(0, x)))
}
const floorColors = new Map()
/** The linear colour that AgX turns into `target` (a linear sRGB triple). */
function inverseAgx(target, exposure) {
	let c = target.map((x) => x * 1.4)
	for (let i = 0; i < 80; i++) { // each channel scaled by how far its result is from where it should be
		const y = agx(c, exposure)
		c = c.map((x, k) => x * (Math.max(target[k], 1e-6) / Math.max(y[k], 1e-6)) ** 0.8)
	}
	return c
}
// What clear glass shows through itself (not the card colour exactly, or glass would vanish): on a light card a little darker, more so toward
// the top of the picture; on a dark card a little lighter (lit glass), more so toward the top. These tints appear in refraction only.
const CLEAR_BOTTOM = 0.92 // light card: this fraction of the card's brightness at the bottom of the picture ...
const CLEAR_TOP = 0.5 // ... and at the top
const CLEAR_LIFT_BOTTOM = 0.03 // dark card: this much linear brightness added at the bottom ...
const CLEAR_LIFT_TOP = 0.085 // ... and at the top
const GLASS_INK = [0.1, 0.11, 0.125] // light card: the dark line round thin clear glass (display colour) ...
const GLASS_INK_ALPHA = 0.8 // ... its strength at the very edge ...
const GLASS_EDGE_POWER = 2.5 // ... how narrowly it hugs the edge ...
const GLASS_CURVE = 0.05 // ... and how fast the surface normal must turn across a pixel for it to count as an edge (flat faces get none)
const CLEAR_EDGE = 0.02 // light card: toward the picture's edges what glass refracts fades to this fraction (a studio's black surround: a clear ball shows a dark rim instead of glowing white)
function floorTints(bg, exposure) {
	let t = floorColors.get(bg.css)
	if (!t) {
		const rgb = [bg.color.r, bg.color.g, bg.color.b]
		const dark = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 0.3
		const at = (scale, lift) => rgb.map((x) => (dark ? x + lift : x * scale))
		t = { main: inverseAgx(rgb, exposure), bot: inverseAgx(at(CLEAR_BOTTOM, CLEAR_LIFT_BOTTOM), exposure), top: inverseAgx(at(CLEAR_TOP, CLEAR_LIFT_TOP), exposure), dark }
		floorColors.set(bg.css, t)
	}
	return t
}

// Light card, a clear item (one whose physics look is see-through: glass, ice, water: the glass marble, ice cube, ice and glass sheets, water bottles, glass jar). The card
// colour sits so high on AgX's shoulder (linear ~5.4) that glass over it had nothing to show: what it refracted was the card's own near-white, and its tint, its 8 %
// reflection loss and its reflections moved that by a level or two, so it read as milky white. Such an item is photographed in a studio of its own:
// - the floor darkens in a soft pool round and under a standing item (3 stops right under it, wide across, the card colour again, exactly, at the picture's edges and toward
//   the horizon), in the picture AND in what the glass refracts, so the glass shows, true to place, the very floor round it: the pool through its lower part, the pale far
//   floor through its upper part, bent by its thick parts (a pane lying flat gets none: the floor under it would read as a grey pane);
// - the floor the glass refracts from away from the item is dark (the studio round the set: refraction only), so a lens (the marble) gets its dark rim;
// - the clear surfaces reflect a photographic studio of their own (a pale floor in front, dark behind and at the sides, grey walls, soft boxes; radiances in units of the
//   floor's), not the bright room;
// - a smooth transparent film over the glass (a bottle's PET over its water) only reflects: its white diffuse would be a milky veil;
// - thin glass keeps the dark line where it turns edge-on (glassEdgeInk), as thin glass on a light card always has.
// The item's opaque parts (a cap, a label) and every other card are photographed exactly as before; so is every card on a dark card.
const STUDIO_POOL = 3 // the floor right under the item: this many stops darker (the card colour sits high on AgX's shoulder, where 1 stop is only 12 display levels: 3 stops = 40)
const STUDIO_POOL_RX = 3 // the pool's radius across, in the item's larger half size (plus the contact shadow's reach): wide, so the floor seen through thin glass is the floor beside it ...
const STUDIO_POOL_RZ = 1.5 // ... and front to back, in its half depth (plus the reach)
const STUDIO_KEEP = 0.55 // from this fraction of the picture's half size out, the pool gives way to the plain card colour (all of it by the edges and the horizon)
const STUDIO_SURROUND = 0.08 // what the glass refracts from the floor away from the item: this fraction of the floor's brightness (the dark studio round the set) ...
const STUDIO_SURROUND_BAND = 0.1 // ... reached this far (in picture heights) outside ...
const STUDIO_BOX_PAD = 0.02 // ... the box round the item's outline in the picture, padded by this much
const STUDIO_CLEAR = 0.95 // a surface this see-through (transmission) reflects the studio; a tinted one (a pane's green edge, a frosted rim) keeps the room's reflections
const STUDIO_ICE_ATTEN = 0.05 // ice's attenuation distance (m) in its studio: through its front faces the ice refracts the far floor, where the pool has already given way to the pale
// card colour, so at the model's 0.25 m a 30 mm frosted cube tints too little and reads as a white sugar cube; this gives its body the cool blue-grey of clear ice, the cloud showing
let studioEnvTexture = null
/** The studio the clear things reflect on a light card (a PMREM of the same size as the room's, so the glass keeps its compiled programs). */
function glassStudio() {
	if (studioEnvTexture) return studioEnvTexture
	const env = new THREE.Scene()
	const disposables = []
	// Radiances are in units of the floor's own (the card colour's linear brightness, which shoot() gives as the intensity), so it suits any card colour.
	// The room: a sphere graded by elevation and by azimuth: the floor in front as bright as the card's floor, the floor behind dark (a thin wall seen edge-on
	// reflects the floor straight behind it: this darkens it where it turns away), grey walls, a lighter ceiling.
	const room = new THREE.SphereGeometry(20, 96, 48)
	const pos = room.attributes.position
	const col = new Float32Array(pos.count * 3)
	const [floorL, backL, wallL, ceilL] = [1, 0.06, 0.22, 0.45]
	const camAz = CAM_AZ * D2R
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i) / 20
		const s = pos.getY(i) / 20 // sin(elevation)
		const z = pos.getZ(i) / 20
		const front = (x * Math.sin(camAz) + z * Math.cos(camAz)) / Math.max(1e-6, Math.hypot(x, z)) // cos(azimuth from the camera's side)
		const fl = backL + (floorL - backL) * smoothstep(-0.3, 0.4, front)
		const v = s < 0 ? fl + (wallL - fl) * smoothstep(-0.1, 0.02, s) : wallL + (ceilL - wallL) * smoothstep(0.35, 0.95, s)
		col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = v
	}
	room.setAttribute("color", new THREE.BufferAttribute(col, 3))
	const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })
	env.add(new THREE.Mesh(room, roomMat))
	disposables.push(room, roomMat)
	// panels: [azimuth (degrees round from the camera's side, toward its right), elevation, width, height (degrees seen from the centre), radiance]
	const panel = (rel, el, w, h, radiance) => {
		const d = 10
		const az = (CAM_AZ + rel) * D2R
		const geo = new THREE.PlaneGeometry(2 * d * Math.tan((w * D2R) / 2), 2 * d * Math.tan((h * D2R) / 2))
		const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(radiance), side: THREE.DoubleSide })
		const m = new THREE.Mesh(geo, mat)
		m.position.set(Math.sin(az) * Math.cos(el * D2R), Math.sin(el * D2R), Math.cos(az) * Math.cos(el * D2R)).multiplyScalar(d)
		m.lookAt(0, 0, 0)
		env.add(m)
		disposables.push(geo, mat)
	}
	for (const p of [
		[-10, 45, 50, 35, 8], // the key soft box: above the camera, a little to its left (where the key light is)
		[-90, 10, 14, 60, 6], // tall strip lights at the left and right
		[90, 10, 14, 60, 4],
		[0, 88, 60, 40, 3], // a soft overhead
		[-140, 10, 40, 70, 0.01], // black flags behind, at the sides
		[140, 10, 40, 70, 0.01],
		[0, 2, 70, 20, 0.05], // the dark camera side, low in front
	])
		panel(...p)
	const pmrem = new THREE.PMREMGenerator(renderer)
	studioEnvTexture = pmrem.fromScene(env, 0.02).texture
	pmrem.dispose()
	for (const d of disposables) d.dispose()
	return studioEnvTexture
}
/** Whether this item is a clear one (see above): a visible part whose look is see-through. */
const isClear = (solids) => solids.some((s) => !s.hidden_3d && (looks[s.look]?.transmission ?? 0) > 0)

const fallbackMats = new Map()
function fallbackMaterial(s, L) {
	const color = s.color ?? L.fill ?? s.placeholder?.fill ?? "#cccccc"
	const k = `${color}|${L.roughness}|${L.metalness}|${L.transmission ?? 0}`
	let m = fallbackMats.get(k)
	if (!m) {
		m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: L.roughness ?? 0.5, metalness: L.metalness ?? 0, clearcoat: L.clearcoat ?? 0, transmission: L.transmission ?? 0, transparent: !!L.transmission, thickness: 0.01 })
		fallbackMats.set(k, m)
	}
	return m
}
const steelMat = () => fallbackMaterial({ color: looks.steel?.fill ?? "#9aa3ab" }, { roughness: 0.28, metalness: 1 })
const darkMat = () => fallbackMaterial({ color: "#1a1b1e" }, { roughness: 0.42, metalness: 0.8 })
let ropeMaterial = null
const ROPE_PITCH = 0.016 // metres of rope per braid repeat (as web/view3d.js)
function ropeMat() {
	if (ropeMaterial) return ropeMaterial
	const c = document.createElement("canvas")
	c.width = 32
	c.height = 64
	const g = c.getContext("2d")
	g.fillStyle = "#c4a56f"
	g.fillRect(0, 0, 32, 64)
	g.strokeStyle = "#7d6237"
	g.lineWidth = 5
	for (let k = -1; k <= 1; k++) { // two strands twisting round the cord
		g.beginPath()
		g.moveTo(-8, 64 + k * 64)
		g.lineTo(40, 16 + k * 64)
		g.stroke()
		g.beginPath()
		g.moveTo(-8, 32 + k * 64)
		g.lineTo(40, -16 + k * 64)
		g.stroke()
	}
	const map = new THREE.CanvasTexture(c)
	map.colorSpace = THREE.SRGBColorSpace
	map.wrapS = map.wrapT = THREE.RepeatWrapping
	map.anisotropy = 4
	ropeMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map, roughness: 0.85, metalness: 0 })
	return ropeMaterial
}

/** A plain stand-in for a part with no model yet: the outline extruded through its depth. */
function fallbackMesh(s, L, wheel) {
	const b = s.body
	let geo
	if (b.kind === "ball") {
		geo = s.shape === "cylinder" || wheel ? new THREE.CylinderGeometry(b.radius, b.radius, s.depth3d ?? Math.max(0.01, 1.1 * b.radius), 40).rotateX(Math.PI / 2) : new THREE.SphereGeometry(b.radius, 48, 24)
	} else if (b.kind === "polygon") {
		const shape = new THREE.Shape(b.points.map((p) => new THREE.Vector2(p.x, p.y)))
		geo = new THREE.ExtrudeGeometry(shape, { depth: b.depth ?? 0.05, bevelEnabled: false })
		geo.translate(0, 0, -(b.depth ?? 0.05) / 2)
	} else {
		const r = Math.min(0.0015, b.width / 4, b.height / 4, (b.depth ?? 0.1) / 4)
		geo = new RoundedBoxGeometry(b.width, b.height, b.depth ?? 0.1, 2, Math.max(1e-5, r))
	}
	const m = new THREE.Mesh(geo, wheel ? fallbackMaterial({ color: "#222" }, { roughness: 0.85 }) : fallbackMaterial(s, L))
	m.userData.disposeGeometry = true
	return m
}

// ---------------------------------------------------------------- the conveyor belt (ported, unchanged in its drawing, from web/view3d.js: beltCanvas, beltGeometry, rollerMarksGeometry, beltKit)
const BELT_PERIOD = 0.04 // meters of belt per rib
const SKIN = 0.001 // the engine keeps bodies ~1 mm apart; the view grows what it draws by this
function hash(ix, iy, seed) {
	let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= h >>> 16
	return (h >>> 0) / 4294967296
}
/** Value noise that tiles with period (px, py) lattice cells. */
function vnoise(x, y, px, py, seed) {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const sx = fx * fx * (3 - 2 * fx)
	const sy = fy * fy * (3 - 2 * fy)
	const xa = ((x0 % px) + px) % px
	const ya = ((y0 % py) + py) % py
	const xb = (xa + 1) % px
	const yb = (ya + 1) % py
	const a = hash(xa, ya, seed)
	const b = hash(xb, ya, seed)
	const c = hash(xa, yb, seed)
	const d = hash(xb, yb, seed)
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}
let beltMaterials = null
/** Rubber belt: dark, finely mottled, with a raised rib across it once per period (u runs along the belt). Drawn once. */
function beltMats() {
	if (beltMaterials) return beltMaterials
	const w = 128
	const h = 64
	const c = document.createElement("canvas")
	c.width = w
	c.height = h
	const g = c.getContext("2d")
	const img = g.createImageData(w, h)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const u = x / w
			const v = y / h
			const rib = smoothstep(0, 0.03, u) * (1 - smoothstep(0.1, 0.13, u)) * smoothstep(0.02, 0.05, v) * (1 - smoothstep(0.95, 0.98, v))
			const k = 30 + 9 * vnoise(u * 32, v * 16, 32, 16, 92) + 44 * rib
			const i = (y * w + x) * 4
			img.data[i] = k
			img.data[i + 1] = k
			img.data[i + 2] = k * 1.06
			img.data[i + 3] = 255
		}
	g.putImageData(img, 0, 0)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.anisotropy = 4
	const lin = (k) => new THREE.Color().setRGB(k, k, k, THREE.LinearSRGBColorSpace)
	const band = new THREE.MeshPhysicalMaterial({ roughness: 0.88, metalness: 0, color: lin(0.95), map: tex, bumpMap: tex, bumpScale: 1.2 })
	const cap = new THREE.MeshPhysicalMaterial({ roughness: 0.7, metalness: 0, color: new THREE.Color().setRGB(0.02, 0.02, 0.024, THREE.LinearSRGBColorSpace) })
	beltMaterials = [band, cap]
	return beltMaterials
}
/** A conveyor belt as one closed band round a stadium of size w x h, depth `depth` along z. Group 0 is the band (u along the belt,
 *  a whole number of `period`s round it; v across), group 1 the two flat sides. */
function beltGeometry(w, h, depth, period) {
	const r = h / 2
	const hw = Math.max(0, (w - h) / 2)
	const ARC = 14
	const pts = [[-hw, r, 0, 1]]
	for (let k = 0; k <= ARC; k++) {
		const th = Math.PI / 2 - (Math.PI * k) / ARC
		pts.push([hw + r * Math.cos(th), r * Math.sin(th), Math.cos(th), Math.sin(th)])
	}
	for (let k = 0; k <= ARC; k++) {
		const th = -Math.PI / 2 - (Math.PI * k) / ARC
		pts.push([-hw + r * Math.cos(th), r * Math.sin(th), Math.cos(th), Math.sin(th)])
	}
	const n = pts.length
	const sl = new Float64Array(n)
	for (let k = 1; k < n; k++) sl[k] = sl[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
	const perimeter = sl[n - 1]
	const unit = perimeter / Math.max(1, Math.round(perimeter / period))
	const pos = []
	const nor = []
	const uv = []
	const idx = []
	for (let k = 0; k < n; k++)
		for (const z of [-depth / 2, depth / 2]) {
			pos.push(pts[k][0], pts[k][1], z)
			nor.push(pts[k][2], pts[k][3], 0)
			uv.push(sl[k] / unit, z > 0 ? 1 : 0)
		}
	for (let k = 0; k + 1 < n; k++) {
		const a = k * 2
		const b = a + 1
		const c = a + 2
		const d = a + 3
		idx.push(a, b, d, a, d, c)
	}
	const bandCount = idx.length
	for (const z of [depth / 2, -depth / 2]) { // the two flat sides: a fan round the centre
		const centre = pos.length / 3
		pos.push(0, 0, z)
		nor.push(0, 0, Math.sign(z))
		uv.push(0.5, 0.5)
		const ring = pos.length / 3
		for (let k = 0; k < n; k++) {
			pos.push(pts[k][0], pts[k][1], z)
			nor.push(0, 0, Math.sign(z))
			uv.push(0.5, 0.5)
		}
		for (let k = 0; k + 1 < n; k++) {
			if (z > 0) idx.push(centre, ring + k + 1, ring + k)
			else idx.push(centre, ring + k, ring + k + 1)
		}
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3))
	g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
	g.setIndex(idx)
	g.addGroup(0, bandCount, 0)
	g.addGroup(bandCount, idx.length - bandCount, 1)
	return g
}
/** The marks on a belt roller's two ends (a bar across each). */
function rollerMarksGeometry(rr, len) {
	const bar = (z) => new THREE.BoxGeometry(1.5 * rr, 0.28 * rr, 0.0016).translate(0, 0, z)
	return mergeGeometries([bar(len / 2 + 0.0008), bar(-len / 2 - 0.0008)])
}
/** A conveyor (a static slab that has a surfaceSpeed): a rubber band with ribs round a steel roller at each end (as the 3D view draws it). */
const isBelt = (s) => s.surfaceSpeed !== undefined && s.body.kind === "slab"
function beltMesh(s) {
	const body = s.body
	const w = body.width + 2 * SKIN
	const h = body.height + 2 * SKIN
	const D = body.depth ?? 0.1
	const mesh = new THREE.Mesh(beltGeometry(w, h, D, BELT_PERIOD), beltMats())
	mesh.userData.disposeGeometry = true
	const rr = Math.max(0.3 * h, h / 2 - 0.003)
	const len = D + 0.016
	const rollGeo = new THREE.CylinderGeometry(rr, rr, len, 28).rotateX(Math.PI / 2)
	const marks = rollerMarksGeometry(rr, len)
	for (const sx of [-1, 1]) {
		const r = new THREE.Mesh(rollGeo, steelMat())
		r.position.set((sx * Math.max(0, w - h)) / 2, 0, 0)
		r.userData.disposeGeometry = sx === 1 // (one geometry, shared by both rollers: freed once)
		const m = new THREE.Mesh(marks, darkMat())
		m.userData.disposeGeometry = sx === 1
		r.add(m)
		mesh.add(r)
	}
	return mesh
}

// ---------------------------------------------------------------- joints (what view3d.js draws between the parts, here at the starting pose)
const bodyDepth = (s) => (!s ? 0 : s.body.kind === "ball" ? (s.shape === "cylinder" ? s.depth3d ?? 4 * s.body.radius : 2 * s.body.radius) : s.body.depth ?? 0.1)
const CHAIN_INNER_LEN = 3 // a chain link's inner opening, in wire diameters (= the chain's pitch) ...
const CHAIN_INNER_WID = 1.55 // ... and its inner width (as web/view3d.js)

function ropeRun(group, a, b, rho) {
	const len = a.distanceTo(b)
	if (len < 1e-5) return
	const geo = new THREE.CylinderGeometry(rho, rho, len, 10, 1)
	const uv = geo.attributes.uv
	for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / ROPE_PITCH)) // the braid repeats every ROPE_PITCH metres whatever the length
	const m = new THREE.Mesh(geo, ropeMat())
	m.userData.disposeGeometry = true
	m.position.copy(a).addScaledVector(b.clone().sub(a), 0.5)
	m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
	group.add(m)
}
const eyelet = (group, p, r) => {
	const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8), steelMat())
	m.userData.disposeGeometry = true
	m.position.copy(p)
	group.add(m)
}

/** One chain link: a wire of radius rw bent into a stadium (straight sides, round ends) in the x-y plane, its long axis along y (as web/view3d.js). */
function chainLinkGeometry(rw) {
	const d = 2 * rw
	const rho = (CHAIN_INNER_WID * d) / 2 + rw
	const half = (CHAIN_INNER_LEN * d) / 2 + rw
	const st = half - rho
	const side = 2 * st
	const cap = Math.PI * rho
	const total = 2 * side + 2 * cap
	class Stadium extends THREE.Curve {
		getPoint(t, target = new THREE.Vector3()) {
			let s = t * total
			if (s < side) return target.set(rho, -st + s, 0)
			s -= side
			if (s < cap) return target.set(rho * Math.cos(s / rho), st + rho * Math.sin(s / rho), 0)
			s -= cap
			if (s < side) return target.set(-rho, st - s, 0)
			s -= side
			return target.set(rho * Math.cos(Math.PI + s / rho), -st + rho * Math.sin(Math.PI + s / rho), 0)
		}
	}
	return new THREE.TubeGeometry(new Stadium(), 64, rw, 8, true)
}
/** A rope joint with render {style: "chain"}: steel links, alternately face-on and edge-on to the camera, spread evenly between its two ends. */
function chainRun(group, a, b, thickness, minWire) {
	const length = a.distanceTo(b)
	if (length < 1e-4) return
	const d = Math.max(THREE.MathUtils.clamp(1.5 * thickness, 0.004, 0.012), minWire) // wire diameter (never thinner than a visible pixel or two)
	const pitch = CHAIN_INNER_LEN * d
	const n = 2 * Math.max(1, Math.round(length / (2 * pitch))) // an even count: the first link is face-on and the last edge-on
	const geo = chainLinkGeometry(d / 2)
	const mesh = new THREE.InstancedMesh(geo, steelMat(), n)
	mesh.userData.disposeGeometry = true
	const t = b.clone().sub(a).normalize()
	const x = new THREE.Vector3(t.y, -t.x, 0) // across the chain, in the picture plane
	const z = new THREE.Vector3(0, 0, 1)
	const m = new THREE.Matrix4()
	const sy = length / (n * pitch)
	const p = new THREE.Vector3()
	for (let i = 0; i < n; i++) {
		p.copy(a).addScaledVector(t, ((i + 0.5) / n) * length)
		const side = i & 1 ? z : x // odd links stand edge-on to the camera
		const face = i & 1 ? x : z
		m.makeBasis(side, t.clone().multiplyScalar(sy), face.clone().multiplyScalar(i & 1 ? -1 : 1))
		m.setPosition(p)
		mesh.setMatrixAt(i, m)
	}
	mesh.instanceMatrix.needsUpdate = true
	group.add(mesh)
}

// ---- pulleys: the wheels, brackets and rope as web/view3d.js buildPulley lays them out and draws them (at the starting pose, nothing turning)
const PULLEY_RHO = 0.002 // the rope's radius the wheels are made for (the view's rope: a card may draw the rope itself thicker, see pulleyRig)
const isTableSolid = (s) => s.kind === "static" && s.body.kind === "slab" && s.body.depth >= 1.2 && Math.abs(s.at.y + s.body.height / 2) < 0.03 // (as web/view3d.js)

/** A grooved pulley wheel (outer radius Rw, rope radius rho, groove floor Rw - 3 rho) round the z axis: a rim with the groove, a web recessed on both faces, a hub
 *  boss and six raised ribs between hub and rim, as web/view3d.js's pulleyGeometry. userData.half = half the rim's thickness. */
function pulleyGeometry(Rw, rho) {
	const B = 1.3 * rho
	const A = B + 0.00175
	const rg = Rw - 3 * rho
	const e = Math.min(0.0004, 0.02 * Rw)
	const hubR = 0.24 * Rw
	const rimIn = Math.max(hubR + 0.004, Math.min(rg - 0.002, 0.64 * Rw))
	const webZ = 0.5 * A
	const half = [[hubR, A], [hubR, webZ], [rimIn, webZ], [rimIn, A], [Rw - e, A], [Rw, A - e], [Rw, B], [rg, 0.9 * rho]] // (the +z half, from the hub out to the groove floor)
	const P = [[0, -A]] // (the profile runs from the axis at the -z face out over that face, the rim and the groove, and back over the +z face)
	for (const q of half) P.push([q[0], -q[1]])
	for (let i = half.length - 1; i >= 0; i--) P.push(half[i])
	P.push([0, A])
	const parts = [new THREE.LatheGeometry(P.map(([x, y]) => new THREE.Vector2(x, y)), 56).rotateX(Math.PI / 2)]
	const len = rimIn - hubR + 0.002
	const rz = A - webZ - 0.0004 // the ribs stand this far off the recessed web, a little under the rim's face
	for (const side of [-1, 1])
		for (let k = 0; k < 6; k++) {
			const rib = new THREE.BoxGeometry(len, Math.max(0.0015, 0.09 * Rw), rz + 0.0008)
			rib.translate((hubR + rimIn) / 2 - 0.001, 0, 0)
			rib.rotateZ((k / 6) * 2 * Math.PI)
			rib.translate(0, 0, side * (webZ + rz / 2 - 0.0004))
			parts.push(rib)
		}
	const g = mergeGeometries(parts)
	for (const p of parts) p.dispose()
	g.userData.half = A
	return g
}
/** A length of rope laid on a wheel: radius rc round the z axis, from angle a0 counter-clockwise to a1, its braid running along it as on the straight runs (as web/view3d.js's
 *  ropeWrapGeometry, here only the part that is wrapped). */
function ropeWrapGeometry(rc, rho, a0, a1) {
	const n = Math.max(2, Math.ceil((a1 - a0) / 0.0262))
	const curve = new THREE.Curve()
	curve.getPoint = (t, out = new THREE.Vector3()) => out.set(rc * Math.cos(a0 + (a1 - a0) * t), rc * Math.sin(a0 + (a1 - a0) * t), 0)
	curve.getUtoTmapping = (u) => u
	const g = new THREE.TubeGeometry(curve, n, rho, 10, false)
	const uv = g.attributes.uv
	const along = (rc * (a1 - a0)) / ROPE_PITCH
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * along) // (round the rope in u, along it in v: the straight runs' own)
	return g
}
/** The underside (y) of the lowest static slab that stands over the world point x within `reach` above y, or null: what a pulley's bracket hangs from (as web/view3d.js overheadOf). */
function overheadOf(solids, poses, x, y, reach) {
	let best = null
	for (const s of solids) {
		if (s.kind !== "static" || s.body.kind !== "slab" || s.hidden_3d || isTableSolid(s) || !poses[s.id]) continue
		const p = poses[s.id]
		const c = Math.abs(Math.cos(p.angle))
		const sn = Math.abs(Math.sin(p.angle))
		const ex = (c * s.body.width) / 2 + (sn * s.body.height) / 2
		const y0 = p.y - (sn * s.body.width) / 2 - (c * s.body.height) / 2
		if (x < p.x - ex - 0.002 || x > p.x + ex + 0.002 || y0 < y - 0.002 || y0 > y + reach) continue
		if (best === null || y0 < best) best = y0
	}
	return best
}
/** Where a pulley joint's wheels go, by web/view3d.js buildPulley's rule. The engine's rope runs straight down at groundA and groundB (its pulley is a point), so two wheels are
 *  centred at the ground points' height INBOARD of them by the rope's radius on them; where two wheels would touch or stand less than 1 cm apart (an Atwood machine), or the joint says
 *  render.wheel "single", ONE wheel midway spans both runs (its rim 0.5 mm inside the ground points' span); "double" forces two; ground points together give one wheel there. No
 *  wheel is taller than the bar over it leaves room for. -> {mode, swap (groundB is the left one), wheels: [{cx, cy, rc}]} left to right, rc = the rope's centre line round the
 *  wheel (its rim is 2 PULLEY_RHO further out). */
function pulleyLayout(j, solids, poses) {
	const rho = PULLEY_RHO
	const swap = j.groundB.x < j.groundA.x
	const GL = swap ? j.groundB : j.groundA
	const GR = swap ? j.groundA : j.groundB
	const dx = GR.x - GL.x
	const rcw = Math.max(0.004, (j.wheelRadius ?? 0.02) - 2 * rho)
	const kind = j.render?.wheel
	const mode = dx < 1e-3 ? "one" : kind === "single" || (kind !== "double" && dx < 4 * rcw + 4 * rho + 0.01) ? "single" : "two"
	const room = (x, y) => { // the rope's radius a wheel centred at (x, y) can have under the bar over it (the rim keeps 1.5 mm off the bar)
		const bar = overheadOf(solids, poses, x, y, 0.3)
		return bar === null ? Infinity : bar - y - 0.0015 - 2 * rho
	}
	let wheels
	if (mode === "one") wheels = [{ cx: GL.x, cy: GL.y, rc: Math.max(0.004, Math.min(rcw, room(GL.x, GL.y))) }]
	else if (mode === "single") {
		const cx = (GL.x + GR.x) / 2
		const cy = (GL.y + GR.y) / 2
		wheels = [{ cx, cy, rc: Math.max(0.006, Math.min(dx / 2 - 2 * rho - 0.0005, room(cx, cy))) }]
	} else {
		const rc = Math.max(0.004, Math.min(rcw, room(GL.x + rcw, GL.y), room(GR.x - rcw, GR.y)))
		wheels = [{ cx: GL.x + rc, cy: GL.y, rc }, { cx: GR.x - rc, cy: GR.y, rc }]
	}
	return { mode, swap, wheels }
}
/** Where a rope from P touches the circle (C, r) when that circle lies on side s of its travel (1 = right, clockwise). */
function tangentFrom(P, C, r, s) {
	const vx = C.x - P.x
	const vy = C.y - P.y
	const dist = Math.max(Math.hypot(vx, vy), r + 1e-6)
	const th = Math.atan2(vy, vx) + s * Math.asin(r / dist)
	const len = Math.sqrt(dist * dist - r * r)
	return new THREE.Vector3(P.x + len * Math.cos(th), P.y + len * Math.sin(th), 0)
}
/** Where a rope leaves the circle (C, r), still wrapped on side s, on its way to Q. */
function tangentTo(Q, C, r, s) {
	const vx = Q.x - C.x
	const vy = Q.y - C.y
	const dist = Math.max(Math.hypot(vx, vy), r + 1e-6)
	const th = Math.atan2(vy, vx) - s * Math.asin(r / dist)
	const len = Math.sqrt(dist * dist - r * r)
	return new THREE.Vector3(Q.x - len * Math.cos(th), Q.y - len * Math.sin(th), 0)
}
/** A pulley joint as web/view3d.js buildPulley draws it (pulleyLayout's wheels): each grooved wheel on a steel plate behind it, from just under its axle up to the bar over it (or a
 *  hanging eye when nothing is over it), the axle's bolt head in front and its nut behind; the rope up the left run to where it touches the wheel, laid in the groove over the
 *  top (one wheel), or to the top line and along it to the other wheel (two), and down the right run, each run a tangent from its body's anchor. P, Q: the anchors on bodies a
 *  and b. The rope is never thinner than minRope (the wheels keep the size they have for the view's rope). Returns the geometries made, to dispose. */
function pulleyRig(group, j, P, Q, solids, poses, minRope) {
	const rho = PULLEY_RHO
	const rope = Math.max(rho, minRope)
	const { mode, swap, wheels } = pulleyLayout(j, solids, poses)
	const steel = steelMat()
	const geos = []
	const made = (g) => (geos.push(g), g)
	const add = (geo, mat, x, y, z) => {
		const m = new THREE.Mesh(geo, mat)
		m.position.set(x, y, z)
		group.add(m)
		return m
	}
	for (const w of wheels) {
		const Rout = w.rc + 2 * rho
		const wheelGeo = made(pulleyGeometry(Rout, rho))
		const A = wheelGeo.userData.half
		add(wheelGeo, steel, w.cx, w.cy, 0)
		const zp = -(A + 0.0016)
		const bar = overheadOf(solids, poses, w.cx, w.cy, 0.3)
		const top = bar !== null ? bar + 0.0015 : w.cy + 1.7 * Rout
		const bottom = w.cy - 0.55 * Rout
		add(made(new RoundedBoxGeometry(Math.min(1.5 * Rout, 0.08), top - bottom, 0.003, 2, 0.0015)), steel, w.cx, (top + bottom) / 2, zp)
		const bolt = Math.max(0.0016, 0.1 * Rout)
		add(made(new THREE.CylinderGeometry(bolt, bolt, 2 * A + 0.0076, 14).rotateX(Math.PI / 2)), steel, w.cx, w.cy, -0.0008)
		const hex = made(new THREE.CylinderGeometry(1.9 * bolt, 1.9 * bolt, 0.003, 6).rotateX(Math.PI / 2))
		for (const z of [A + 0.0015, zp - 0.003]) add(hex, steel, w.cx, w.cy, z) // (the bolt's head on the front face, its nut behind the plate)
		if (bar === null) add(made(new THREE.TorusGeometry(0.24 * Rout, 0.06 * Rout, 8, 18)), steel, w.cx, top + 0.2 * Rout, zp)
	}
	const w0 = wheels[0]
	const w1 = wheels[wheels.length - 1]
	const C0 = { x: w0.cx, y: w0.cy }
	const C1 = { x: w1.cx, y: w1.cy }
	const L = swap ? Q : P // the anchors on the left and right runs: the rope goes round each wheel clockwise, up the left run, over the top, down the right one
	const R = swap ? P : Q
	const T1 = tangentFrom(L, C0, w0.rc, 1)
	const T4 = tangentTo(R, C1, w1.rc, 1)
	const okL = T1.y > L.y + 1e-4 // (a run that would have to go DOWN to its wheel is a body inside it: not drawn)
	const okR = T4.y > R.y + 1e-4
	const PI = Math.PI
	const REACH = 1.5
	let topA = PI / 2 // the angle of the top line's tangent point on both wheels (two wheels: it leaves both square to it)
	if (mode === "two") {
		const th = Math.atan2(w1.cy - w0.cy, w1.cx - w0.cx)
		topA = th + PI / 2
		const T2 = new THREE.Vector3(w0.cx - Math.sin(th) * w0.rc, w0.cy + Math.cos(th) * w0.rc, 0)
		const T3 = new THREE.Vector3(w1.cx - Math.sin(th) * w1.rc, w1.cy + Math.cos(th) * w1.rc, 0)
		ropeRun(group, T2, T3, rope)
	}
	const unwrap = (a, ref) => a - 2 * PI * Math.floor((a - ref) / (2 * PI)) // a, turned into [ref, ref + 2 pi)
	const aL = Math.min(PI + REACH, unwrap(Math.atan2(T1.y - C0.y, T1.x - C0.x), mode === "two" ? topA : -REACH))
	const aR = Math.max(-REACH, unwrap(Math.atan2(T4.y - C1.y, T4.x - C1.x), (mode === "two" ? topA : PI + REACH) - 2 * PI))
	const wrap = (w, from, to) => { // the rope laid in wheel w's groove from angle `from` counter-clockwise to `to`
		if (to - from > 1e-3) add(made(ropeWrapGeometry(w.rc, rope, from, to)), ropeMat(), w.cx, w.cy, 0)
	}
	if (mode === "two") {
		wrap(w0, topA, okL ? aL : PI)
		wrap(w1, okR ? aR : 0, topA)
	} else wrap(w0, okR ? aR : 0, okL ? aL : PI) // (a run that is not drawn: the wrap stops at that side's own point)
	if (okL) {
		ropeRun(group, L, T1, rope)
		eyelet(group, L, 1.25 * rope)
	}
	if (okR) {
		ropeRun(group, T4, R, rope)
		eyelet(group, R, 1.25 * rope)
	}
	return geos
}

/** A motorised hinge: a steel shaft through the part and the motor's can on its front, as web/view3d.js draws it. */
function motorRig(group, at, depth, turn, still) {
	const D = depth > 0 ? depth : 0.04
	const r = 0.004
	const extra = 0.0435
	const holder = new THREE.Group()
	holder.position.set(at.x, at.y, 0)
	group.add(holder)
	const part = (geo, mat, z, parent) => {
		const m = new THREE.Mesh(geo, mat)
		m.userData.disposeGeometry = true
		m.position.z = z
		parent.add(m)
		return m
	}
	part(new THREE.CylinderGeometry(r, r, D + 0.004 + extra, 16).rotateX(Math.PI / 2), steelMat(), extra / 2, holder)
	const turning = new THREE.Group()
	turning.rotation.z = turn
	holder.add(turning)
	const head = new THREE.CylinderGeometry(1.8 * r, 1.8 * r, 0.003, 6).rotateX(Math.PI / 2)
	part(head, steelMat(), D / 2 + 0.003 + 0.04 + 0.0015, turning)
	part(head, steelMat(), -(D / 2 + 0.0035), turning)
	const stator = new THREE.Group()
	stator.rotation.z = still
	holder.add(stator)
	part(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 28).rotateX(Math.PI / 2), darkMat(), D / 2 + 0.003 + 0.02, stator)
	part(new THREE.CylinderGeometry(0.0195, 0.0195, 0.004, 28).rotateX(Math.PI / 2), steelMat(), D / 2 + 0.003 + 0.002, stator)
	part(new RoundedBoxGeometry(0.014, 0.012, 0.02, 2, 0.002), darkMat(), D / 2 + 0.003 + 0.026, stator).position.y = 0.019
}

// ---------------------------------------------------------------- photographing
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
/** The world-space points of everything drawn under `root`: min and max exactly, and a thinned cloud (xyz triples) for fitting the camera. */
function collect(root, into = null) {
	root.updateMatrixWorld(true)
	const out = into ?? { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), pts: [] }
	const add = (v, keep) => {
		out.min.min(v)
		out.max.max(v)
		if (keep) out.pts.push(v.x, v.y, v.z)
	}
	root.traverse((o) => {
		if (!o.isMesh || !o.geometry?.attributes?.position) return
		if (o.isInstancedMesh) {
			o.geometry.computeBoundingBox()
			const bb = o.geometry.boundingBox
			for (let i = 0; i < o.count; i++) {
				o.getMatrixAt(i, _m)
				_m.premultiply(o.matrixWorld)
				for (let k = 0; k < 8; k++) add(_v.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(_m), true)
			}
			return
		}
		const pos = o.geometry.attributes.position
		const stride = Math.max(1, Math.floor(pos.count / 1500))
		for (let i = 0; i < pos.count; i++) add(_v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld), i % stride === 0)
	})
	return out
}

/** Place `camera` on the ray `dir` (unit, from the target toward the camera) so the cloud `pts` fills the picture to within `margin` of each edge, centred. */
function fitCamera(pts, c0, dir, margin) {
	const f = dir.clone().negate()
	const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize()
	const up = new THREE.Vector3().crossVectors(right, f).normalize()
	const tv = Math.tan((camera.fov * D2R) / 2)
	const th = tv * camera.aspect
	const c = c0.clone()
	let dist = 1
	for (let it = 0; it < 10; it++) {
		let need = 0
		for (let i = 0; i < pts.length; i += 3) {
			const dx = pts[i] - c.x
			const dy = pts[i + 1] - c.y
			const dz = pts[i + 2] - c.z
			const X = dx * right.x + dy * right.y + dz * right.z
			const Y = dx * up.x + dy * up.y + dz * up.z
			const Z = dx * dir.x + dy * dir.y + dz * dir.z // toward the camera
			need = Math.max(need, Math.abs(X) / ((1 - margin) * th) + Z, Math.abs(Y) / ((1 - margin) * tv) + Z)
		}
		dist = Math.max(need, 1e-4)
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (let i = 0; i < pts.length; i += 3) {
			const dx = pts[i] - c.x
			const dy = pts[i + 1] - c.y
			const dz = pts[i + 2] - c.z
			const Z = dx * dir.x + dy * dir.y + dz * dir.z
			const dep = Math.max(1e-6, dist - Z)
			const nx = (dx * right.x + dy * right.y + dz * right.z) / (dep * th)
			const ny = (dx * up.x + dy * up.y + dz * up.z) / (dep * tv)
			x0 = Math.min(x0, nx)
			x1 = Math.max(x1, nx)
			y0 = Math.min(y0, ny)
			y1 = Math.max(y1, ny)
		}
		const sx = ((x0 + x1) / 2) * th * dist
		const sy = ((y0 + y1) / 2) * tv * dist
		if (Math.abs(sx) + Math.abs(sy) < 1e-7 * dist) break
		c.addScaledVector(right, sx).addScaledVector(up, sy)
	}
	camera.position.copy(c).addScaledVector(dir, dist)
	camera.lookAt(c)
	camera.near = dist * 0.05
	camera.far = dist * 20
	camera.updateProjectionMatrix()
	return { dist, c }
}

/** A pulley's loads hang far below its wheels at the start (the whole 0.5 m drop would make the wheels a dot): for the card, lift every moving part until the
 *  loads hang 3 times their own height below the wheels, so the wheels, the bar and the ropes between them and the loads are all there to see; and slide each load
 *  sideways until the rope hangs plumb from the point where it leaves its wheel (the engine hangs a load under its ground point: under two wheels that is where the rope
 *  leaves them, but the one wheel of an Atwood machine is a little narrower than the ground points' span, so the view's runs lean in to it). Card only: the scene itself
 *  is not touched. */
function hangLoads(preview, solids, poses) {
	const pj = (preview.joints ?? []).filter((j) => j.kind === "pulley")
	if (!pj.length) return
	const layouts = pj.map((j) => pulleyLayout(j, solids, poses)) // (the wheels hang from the static bar: lifting the loads does not move them)
	const wheelBottom = Math.min(...layouts.flatMap((l) => l.wheels.map((w) => w.cy - w.rc - 2 * PULLEY_RHO)))
	let top = -Infinity
	let bot = Infinity
	for (const s of solids) {
		if (s.kind !== "dynamic" || !poses[s.id]) continue
		const p = poses[s.id]
		const b = s.body
		const c = Math.cos(p.angle)
		const sn = Math.sin(p.angle)
		const ys = b.kind === "ball" ? [-b.radius, b.radius] : b.kind === "polygon" ? b.points.map((q) => q.x * sn + q.y * c) : [-1, 1].flatMap((u) => [-1, 1].map((v) => ((u * b.width) / 2) * sn + ((v * b.height) / 2) * c))
		top = Math.max(top, p.y + Math.max(...ys))
		bot = Math.min(bot, p.y + Math.min(...ys))
	}
	const dy = wheelBottom - 3 * (top - bot) - top
	const rootOf = (s) => { // the part a welded one hangs from (a pail's walls and bail belong to its floor)
		for (let i = 0; i < 16 && s.parent; i++) s = solids.find((q) => q.id === s.parent) ?? s
		return s.id
	}
	const dx = {} // root id -> how far its group slides sideways
	const slide = (id, a, x) => { // how far body id's group slides to bring its anchor a to x: {root, d}, or null (a world end, or a part that is not there, stays)
		const p = poses[id]
		const s = solids.find((q) => q.id === id)
		if (!p || !s || s.kind !== "dynamic") return null
		return { root: rootOf(s), d: x - (p.x + a.x * Math.cos(p.angle) - a.y * Math.sin(p.angle)) }
	}
	const span = (root, d) => { // the x range of a load (its welded group), slid by d
		let x0 = Infinity
		let x1 = -Infinity
		for (const s of solids) {
			if (s.kind !== "dynamic" || !poses[s.id] || rootOf(s) !== root) continue
			const p = poses[s.id]
			const b = s.body
			const c = Math.cos(p.angle)
			const sn = Math.sin(p.angle)
			const xs = b.kind === "ball" ? [-b.radius, b.radius] : b.kind === "polygon" ? b.points.map((q) => q.x * c - q.y * sn) : [-1, 1].flatMap((u) => [-1, 1].map((v) => ((u * b.width) / 2) * c - ((v * b.height) / 2) * sn))
			x0 = Math.min(x0, p.x + d + Math.min(...xs))
			x1 = Math.max(x1, p.x + d + Math.max(...xs))
		}
		return [x0, x1]
	}
	const apart = (L, R, dl, dr) => { // the two loads do not overlap side by side (2 mm between them)
		const a = span(L, dl)
		const b = span(R, dr)
		return a[1] + 0.002 <= b[0] || b[1] + 0.002 <= a[0]
	}
	pj.forEach((j, k) => {
		const { swap, wheels } = layouts[k]
		const w0 = wheels[0]
		const w1 = wheels[wheels.length - 1]
		// the left run hangs from the left side of the (left) wheel, the right run from the right side of the (right) one, as pulleyRig draws them
		const L = slide(swap ? j.b : j.a, swap ? j.anchorB : j.anchorA, w0.cx - w0.rc)
		const R = slide(swap ? j.a : j.b, swap ? j.anchorA : j.anchorB, w1.cx + w1.rc)
		// ... unless that would push two loads hung apart into each other (one wheel under a bar too low for it to span them): then their runs lean in to it, as in the view
		if (L && R && L.root !== R.root && apart(L.root, R.root, 0, 0) && !apart(L.root, R.root, L.d, R.d)) return
		for (const m of [L, R]) if (m) dx[m.root] = m.d
	})
	for (const s of solids) {
		if (s.kind !== "dynamic" || !poses[s.id]) continue
		if (dy > 0) poses[s.id].y += dy
		poses[s.id].x += dx[rootOf(s)] ?? 0
	}
}

async function render(preview) {
	await prebaked(preview)
	init()
	const bg = cardColor()
	const group = new THREE.Group()
	const solids = preview.solids ?? []
	const poses = startPoses({ solids })
	hangLoads(preview, solids, poses)
	const t = typeOf.get(preview)
	const props = propsOf(t)
	const wheels = new Set((preview.joints ?? []).filter((j) => j.kind === "wheel").map((j) => j.wheel))
	const movers = [] // the parts that move (a pulley's loads hang from a bar above the floor: their size sets how far the contact shadow reaches)
	const belts = solids.filter((s) => !s.hidden_3d && modelFor(s) === undefined && isBelt(s))
	const place = (obj, s) => {
		const p = poses[s.id]
		const holder = new THREE.Group()
		holder.add(obj)
		holder.position.set(p.x, p.y, 0)
		holder.rotation.z = p.angle
		group.add(holder)
		if (s.kind === "dynamic") movers.push(holder)
	}
	for (const s of solids) {
		if (s.hidden_3d) continue
		const L = looks[s.look] ?? {}
		let obj = buildModel(s, { props, look: L })
		if (obj === null) continue
		if (obj === undefined) {
			if (s.body.kind === "ball" && s.shape === "cylinder" && belts.some((b) => b.item === s.item && Math.abs(poses[b.id].y - poses[s.id].y) < 1e-6)) continue // a belt's roller: the belt draws its own, through the band's ends
			obj = isBelt(s) ? beltMesh(s) : fallbackMesh(s, L, wheels.has(s.id))
		}
		place(obj, s)
	}
	if (!group.children.length) {
		// none of its parts draws anything (a scene's view plug-in draws the item: a wire between two terminals, the circuit board, a coaster's
		// rail, a motion trail, the sun's light): its whole-item model for the photo (models3d.js addThumb), else its parts' plain stand-ins
		const thumb = thumbFor(t?.key)
		let obj = null
		if (thumb) {
			try {
				obj = thumb({ props, preview, looks, THREE }) ?? null
			} catch (e) {
				console.warn(`thumbnail model ${t?.key} failed:`, e)
			}
		}
		if (obj) group.add(obj)
		else for (const s of solids) if (!s.hidden_3d && poses[s.id]) place(fallbackMesh(s, looks[s.look] ?? {}, wheels.has(s.id)), s)
	}
	const anchor = (id, a) => {
		if (!id) return new THREE.Vector3(a.x, a.y, 0)
		const p = poses[id]
		if (!p) return null
		const c = Math.cos(p.angle)
		const sn = Math.sin(p.angle)
		return new THREE.Vector3(p.x + a.x * c - a.y * sn, p.y + a.x * sn + a.y * c, 0)
	}
	// a rope or chain is never drawn thinner than about a pixel and a half of the picture (a 2 mm cord on a 1 m item would vanish)
	const sizeOf = collect(group)
	const sphere0 = sizeOf.min.distanceTo(sizeOf.max) / 2
	const minWire = Math.max(0.0015, (1.6 * 2 * sphere0) / W)
	const pulleyGeos = []
	let pulleys = false
	for (const j of preview.joints ?? []) {
		if (j.kind === "pulley") {
			const P = anchor(j.a, j.anchorA)
			const Q = anchor(j.b, j.anchorB)
			if (P && Q) {
				pulleys = true
				pulleyGeos.push(...pulleyRig(group, j, P, Q, solids, poses, minWire / 2))
			}
			continue
		}
		if (j.kind !== "spring" && j.kind !== "rope") continue
		const A = anchor(j.a, j.anchorA)
		const B = anchor(j.b, j.anchorB)
		if (!A || !B) continue
		const len = A.distanceTo(B)
		if (len < 1e-4) continue
		if (j.kind === "rope" && j.render?.style === "chain") {
			chainRun(group, A, B, j.thickness ?? 0.004, minWire)
			continue
		}
		let geo
		if (j.kind === "spring") {
			const turns = j.coils ?? 8
			const R = j.coilRadius ?? 0.01
			const pts = []
			for (let i = 0; i <= turns * 24; i++) {
				const u = i / (turns * 24)
				pts.push(new THREE.Vector3(R * Math.cos(u * turns * 2 * Math.PI), u * len, R * Math.sin(u * turns * 2 * Math.PI)))
			}
			geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, Math.max(0.0008, R * 0.12), 8)
		} else {
			ropeRun(group, A, B, Math.max(0.0015, minWire / 2))
			continue
		}
		// a mat held by springs along its whole edge (a trampoline: render.rows) has one per row, spread evenly across the depth (as mechanisms-tramp.js's hooks are)
		const rows = Math.max(1, Math.round(j.render?.rows ?? 1))
		const d = bodyDepth(solids.find((sd) => sd.id === j.b)) || bodyDepth(solids.find((sd) => sd.id === j.a))
		for (let k = 0; k < rows; k++) {
			const m = new THREE.Mesh(geo, fallbackMaterial({ color: "#b8bec6" }, { roughness: 0.3, metalness: 1 }))
			m.userData.disposeGeometry = k === 0 // (one geometry for all the rows)
			m.position.copy(A).setZ(rows > 1 ? -d / 2 + ((k + 0.5) * d) / rows : 0)
			m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
			group.add(m)
		}
	}
	for (const s of solids) { // a motorised hinge: the motor's can and shaft
		if (s.hidden_3d || !s.pivot || !s.motor || !poses[s.id]) continue
		const p = poses[s.id]
		const c = Math.cos(p.angle)
		const sn = Math.sin(p.angle)
		const at = { x: p.x + s.pivot.x * c - s.pivot.y * sn, y: p.y + s.pivot.x * sn + s.pivot.y * c }
		motorRig(group, at, bodyDepth(s), p.angle, s.parent ? poses[s.parent]?.angle ?? 0 : 0)
	}
	group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
	scene.add(group)
	try {
		const canvas = await shoot(group, bg, pulleys ? movers : null, isClear(solids)) // loads hung from a bar: their size, not the whole item's, sets the contact shadow
		return { canvas, key: bg.css, levels: null }
	} finally {
		scene.remove(group)
		group.traverse((o) => { if (o.isMesh && o.userData.disposeGeometry) o.geometry.dispose() })
		for (const g of pulleyGeos) g.dispose?.()
	}
}

/** How much shade this mesh puts on the floor (before the height fade): a solid part's full share, clear glass and ice and thin translucent layers a faint one. */
function shadeOf(o) {
	let w = 0
	for (const m of [].concat(o.material)) {
		if (!m) continue
		if (m.transmission > 0) w = Math.max(w, SHADE_CLEAR)
		else if (m.transparent && m.opacity < 0.98) w = Math.max(w, SHADE_CLEAR * m.opacity)
		else w = SHADE_SOLID
	}
	return w
}

/** Photograph the group into a new canvas, over the card colour. `movers`: the holders of the parts that move, when the item hangs them above the floor (their size, not the whole item's, sets how high the contact shadow reaches).
 *  `clear`: a clear item (glass, ice, water), which a light card photographs in its own studio (see glassStudio). */
async function shoot(group, bg, movers, clear) {
	const all = collect(group)
	if (!isFinite(all.min.x)) throw new Error("nothing to photograph")
	const center = all.min.clone().add(all.max).multiplyScalar(0.5)
	const R = Math.max(0.005, all.min.distanceTo(all.max) / 2)
	// frame it: three-quarters from the front left, a little above, filled to the edges
	const az = CAM_AZ * D2R
	const el = CAM_EL * D2R
	const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
	let fitPts = all.pts
	const fitCentre = center
	let shadeR = R // the size the contact shadow's fade height follows (a load hung high above the floor leaves none)
	if (movers?.length) {
		const f = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), pts: [] }
		for (const h of movers) collect(h, f)
		if (isFinite(f.min.x)) shadeR = Math.max(0.005, f.min.distanceTo(f.max) / 2)
	}
	{ // the contact shadow reaches past the item's outline toward the camera (a ball's, about 0.3 r below its outline plus the blur): frame where it lies on the floor, so the card's edge does not cut it off
		const size = all.max.clone().sub(all.min)
		const fade = Math.max(0.5 * shadeR, 0.01) // (as contactShadow)
		const span = 2 * (0.5 * Math.max(size.x, size.z) + 0.18 * shadeR + fade * Math.hypot(0.2, 0.28))
		const lowY = all.min.y + 0.35 * fade
		const ahead = 0.03 * span
		const extra = []
		for (let i = 0; i < fitPts.length; i += 3) if (fitPts[i + 1] < lowY) extra.push(fitPts[i], all.min.y, fitPts[i + 2] + ahead)
		if (extra.length) fitPts = fitPts.concat(extra)
	}
	const fit = fitCamera(fitPts, fitCentre, dir, MARGIN)
	const dist = (R / Math.sin((camera.fov * D2R) / 2)) * 1.02
	key.position.copy(center).add(new THREE.Vector3(-0.6 * dist, 1.4 * dist, 0.9 * dist))
	key.target.position.copy(center)
	const sc = key.shadow.camera
	sc.left = sc.bottom = -1.5 * R
	sc.right = sc.top = 1.5 * R
	sc.near = 0.01 * dist
	sc.far = 4 * dist
	sc.updateProjectionMatrix()
	const floorY = all.min.y - 0.0004
	const tints = floorTints(bg, renderer.toneMappingExposure)
	const fu = floor.material.userData.u
	fu.uMain.value.fromArray(tints.main)
	fu.uBot.value.fromArray(tints.bot)
	fu.uTop.value.fromArray(tints.top)
	fu.uEdge.value = tints.dark ? 1 : CLEAR_EDGE
	const span = contactShadow(group, all, floorY, shadeR, fit.dist)
	const studio = clear && !tints.dark
	if (studio) { // the floor's pool, in the picture and in the refraction alike (uFlat), and the dark round the set away from the item (refraction only)
		const size = all.max.clone().sub(all.min)
		const reach = Math.max(0.5 * shadeR, 0.01) * Math.hypot(0.2, 0.28) // (the contact shadow's fade height x its slant, as contactShadow)
		const half = 0.5 * Math.max(size.x, size.z) + reach
		const standing = smoothstep(0.1, 0.5, size.y / Math.max(size.x, size.z, 1e-6)) // (a pane lying flat: 0)
		fu.uPool.value.set(STUDIO_POOL * standing, (STUDIO_POOL_RX * half) / span, (STUDIO_POOL_RZ * (0.5 * size.z + reach)) / span, STUDIO_KEEP)
		fu.uFlat.value = 1
		fu.uEdge.value = 1
		fu.uSurround.value.set(STUDIO_SURROUND, STUDIO_SURROUND_BAND)
		camera.updateMatrixWorld()
		const box = [1, 1, 0, 0]
		for (let i = 0; i < all.pts.length; i += 3) {
			_v.set(all.pts[i], all.pts[i + 1], all.pts[i + 2]).project(camera)
			box[0] = Math.min(box[0], 0.5 + 0.5 * _v.x)
			box[1] = Math.min(box[1], 0.5 + 0.5 * _v.y)
			box[2] = Math.max(box[2], 0.5 + 0.5 * _v.x)
			box[3] = Math.max(box[3], 0.5 + 0.5 * _v.y)
		}
		const pad = STUDIO_BOX_PAD
		fu.uBox.value.set(box[0] - (pad * H) / W, box[1] - pad, box[2] + (pad * H) / W, box[3] + pad)
		glassStudio() // (made once, before the shaders are linked)
	} else {
		fu.uPool.value.x = 0
		fu.uFlat.value = 0
		fu.uSurround.value.x = 1
	}
	renderer.setClearColor(bg.color, 1)
	try {
		await renderer.compileAsync(scene, camera) // link the shaders without blocking the page (the render below then finds them ready)
	} catch {}
	renderer.shadowMap.needsUpdate = true
	// On a light card the reflection a glass ball adds on top (an additive layer, tone mapped on its own, so even a faint one is 40+ display levels brighter than the card and
	// clips to white) is left out, and the glass's own reflection, which is added before tone mapping, is switched on instead. A dark card takes the additive layer well.
	// (The materials are shared with the 3D view: this render is synchronous and puts them back before anything else draws.)
	const undo = []
	if (!tints.dark) {
		let shell = false // (a glass ball with its own reflection shell gets its dark rim from the refraction already)
		const glass = []
		group.traverse((o) => {
			if (!o.isMesh || !o.visible) return
			for (const m of [].concat(o.material)) {
				if (m?.blending === THREE.AdditiveBlending) {
					shell = true
					o.visible = false
					undo.push(() => (o.visible = true))
				} else if (m?.transmission > 0) {
					glass.push(o)
					if (m.specularIntensity === 0) {
						m.specularIntensity = 1
						undo.push(() => (m.specularIntensity = 0))
					}
				}
			}
		})
		if (!shell && glass.length) {
			// Thin clear glass reads as clear on a light card by its edges: where the surface turns away from the camera it gets the dark line a studio's black surround
			// gives it. On an item that is not itself clear (a car's windows, a clear ruler) the body shows the card itself (a flat backdrop); a clear item's floor is
			// already the same in the picture and in the refraction (its studio, above).
			if (!studio) {
				fu.uFlat.value = 1
				undo.push(() => (fu.uFlat.value = 0))
			}
			for (const o of glass) {
				const ink = new THREE.Mesh(o.geometry, glassEdgeInk())
				ink.renderOrder = 10
				o.add(ink)
				undo.push(() => o.remove(ink))
			}
		}
		if (studio) { // a clear item: films only reflect, and the clear surfaces reflect the studio (its radiances in units of the floor's; a PMREM of the room's size: nothing is relinked)
			const env = glassStudio()
			const floorLum = 0.2126 * tints.main[0] + 0.7152 * tints.main[1] + 0.0722 * tints.main[2]
			const seen = new Set()
			group.traverse((o) => {
				if (!o.isMesh || !o.visible) return
				for (const m of [].concat(o.material)) {
					if (!m?.isMeshStandardMaterial || seen.has(m) || m.blending === THREE.AdditiveBlending) continue
					seen.add(m)
					if (!o.isInstancedMesh && !(m.transmission > 0) && m.transparent && m.opacity < 1 && m.roughness <= 0.1 && !m.map && !m.alphaMap) { // a smooth film (not a frost, a crack or a cloud, which are mapped or rough, nor the ice sheet's instanced air bubbles, which are little white volumes, not films)
						const c = m.color.clone()
						m.color.setRGB(0, 0, 0)
						undo.push(() => m.color.copy(c))
					} else if (m.transmission >= STUDIO_CLEAR && !m.userData?.gradedOpts?.env) { // (web/models/blocks.js's graded materials with env re-point their envMap to scene.environment on every draw, the ice cube's shell: they keep the room's reflections at the room's level)
						const before = [m.envMap, m.envMapIntensity]
						if (m.envMap) m.envMapIntensity *= floorLum // (a material with its own environment, the marble's glass, keeps it: brought to the floor's brightness as well)
						else {
							m.envMap = env
							m.envMapIntensity = floorLum
						}
						undo.push(() => ([m.envMap, m.envMapIntensity] = before))
					}
					if (m.transmission > 0 && m.roughnessMap && m.ior < 1.4 && m.attenuationDistance > STUDIO_ICE_ATTEN) { // ice (ior 1.31, a frosted skin): see STUDIO_ICE_ATTEN (a uniform only: no new shader)
						const ad = m.attenuationDistance
						m.attenuationDistance = STUDIO_ICE_ATTEN
						undo.push(() => (m.attenuationDistance = ad))
					}
				}
			})
		}
	}
	try {
		renderer.render(scene, camera)
	} finally {
		for (const u of undo) u()
	}
	const out = document.createElement("canvas")
	out.width = W
	out.height = H
	const g = out.getContext("2d")
	g.imageSmoothingQuality = "high"
	g.drawImage(renderer.domElement, 0, 0, W, H)
	return out
}

let glassInkMaterial = null
/** What gives thin clear glass its edge on a light card: a dark line where a curved surface turns edge-on to the camera. Drawn over each glass mesh for the photo
 *  only (it uses the mesh's own geometry and is taken off again); flat faces (a pane's top) get none, as the strength follows how fast the normal turns across the
 *  pixel. The colour is final display colour: nothing tone maps it. */
function glassEdgeInk() {
	return (glassInkMaterial ??= new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { uInk: { value: new THREE.Vector3(...GLASS_INK) } },
		vertexShader: "varying vec3 vN;\nvarying vec3 vV;\nvoid main() {\n\tvec4 mv = modelViewMatrix * vec4( position, 1.0 );\n\tvN = normalize( normalMatrix * normal );\n\tvV = normalize( -mv.xyz );\n\tgl_Position = projectionMatrix * mv;\n}",
		fragmentShader: `uniform vec3 uInk;\nvarying vec3 vN;\nvarying vec3 vV;\nvoid main() {\n\tvec3 n = normalize( vN );\n\tfloat curve = smoothstep( 0.0, ${GLASS_CURVE.toFixed(3)}, length( fwidth( n ) ) );\n\tfloat edge = pow( 1.0 - clamp( abs( dot( n, normalize( vV ) ) ), 0.0, 1.0 ), ${GLASS_EDGE_POWER.toFixed(2)} );\n\tgl_FragColor = vec4( uInk, ${GLASS_INK_ALPHA.toFixed(2)} * edge * curve );\n}`,
	}))
}

/** The soft contact shadow under the item, into the texture the floor plane shows. */
function contactShadow(group, all, floorY, R, viewDist) {
	const size = all.max.clone().sub(all.min)
	const fade = Math.max(0.5 * R, 0.01) // height at which a part's shadow has faded out
	const slant = new THREE.Vector2(0.2, -0.28) // picture right = +x, picture up = +z: the shadow leans back and to the right, as the key light is front left
	const reach = fade * Math.hypot(slant.x, slant.y)
	const span = 2 * (0.5 * Math.max(size.x, size.z) + 0.18 * R + reach)
	const cx = (all.min.x + all.max.x) / 2
	const cz = (all.min.z + all.max.z) / 2
	cs.slant.value.copy(slant)
	cs.camera.left = -span / 2
	cs.camera.right = span / 2
	cs.camera.top = span / 2
	cs.camera.bottom = -span / 2
	cs.camera.near = 0
	cs.camera.far = fade
	cs.camera.position.set(cx, floorY, cz)
	cs.camera.updateProjectionMatrix()
	cs.camera.updateMatrixWorld(true)
	const solid = []
	const veil = []
	group.traverse((o) => {
		if (!o.isMesh || !o.visible) return
		o.userData.shade = shadeOf(o)
		;(o.userData.shade >= SHADE_SOLID ? solid : veil).push(o)
	})
	const prev = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), auto: renderer.autoClear, color: renderer.getClearColor(new THREE.Color()) }
	floor.visible = false
	scene.overrideMaterial = cs.solid
	cs.solid.userData.u.darkness.value = SHADE_SOLID
	renderer.shadowMap.autoUpdate = false
	renderer.setRenderTarget(cs.a)
	renderer.setClearColor(0x000000, 0)
	renderer.clear()
	renderer.autoClear = false
	for (const o of veil) o.visible = false
	renderer.render(scene, cs.camera)
	if (veil.length) { // the translucent parts, each as dark as its own material lets light through, adding up
		for (const o of veil) {
			o.visible = true
			o.userData.ownBefore = Object.hasOwn(o, "onBeforeRender") ? o.onBeforeRender : null
			o.onBeforeRender = () => {
				cs.glass.userData.u.darkness.value = o.userData.shade
				cs.glass.uniformsNeedUpdate = true
			}
		}
		for (const o of solid) o.visible = false
		scene.overrideMaterial = cs.glass
		renderer.render(scene, cs.camera)
		for (const o of solid) o.visible = true
		for (const o of veil) {
			if (o.userData.ownBefore) o.onBeforeRender = o.userData.ownBefore
			else delete o.onBeforeRender
			delete o.userData.ownBefore
		}
	}
	scene.overrideMaterial = null
	// blur it, twice (wide then narrow), horizontally then vertically
	const blur = (amount) => {
		for (const [from, to, dx, dy] of [[cs.a, cs.b, amount / CS, 0], [cs.b, cs.a, 0, amount / CS]]) {
			cs.blur.uniforms.tDiffuse.value = from.texture
			cs.blur.uniforms.dir.value.set(dx, dy)
			cs.quad.material = cs.blur
			renderer.setRenderTarget(to)
			renderer.clear()
			renderer.render(cs.quadScene, cs.quadCamera)
		}
	}
	blur(1.6)
	blur(0.7)
	cs.invert.uniforms.tDiffuse.value = cs.a.texture // (the blur ended in cs.a)
	cs.quad.material = cs.invert
	renderer.setRenderTarget(cs.b)
	renderer.clear()
	renderer.render(cs.quadScene, cs.quadCamera)
	renderer.setRenderTarget(prev.target)
	renderer.autoClear = prev.auto
	renderer.setClearColor(prev.color, prev.alpha)
	// the floor reaches far past the picture; the light map covers the middle of it and is 1 (unshaded) at its edges
	const side = 40 * Math.max(viewDist, span)
	const tex = cs.b.texture
	const k = side / span // (the floor's uv 0.5 ± span/side/2 is the light map's 0..1)
	tex.repeat.set(k, k)
	tex.offset.set(0.5 - 0.5 * k, 0.5 - 0.5 * k)
	floor.visible = true
	floor.material.map = tex
	floor.material.needsUpdate = floor.material.userData.mapped !== true
	floor.material.userData.mapped = true
	floor.scale.set(side, 1, side)
	floor.position.set(cx, floorY, cz)
	return span
}

/** For tests: whether the studio's GPU side is set up now (it is let go when idle: see release). */
export const _debug = { get live() { return !!renderer } }
