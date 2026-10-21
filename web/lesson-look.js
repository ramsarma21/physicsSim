// The LESSON LOOK: how web/view3d.js draws a run when the scene asks for it (settings.style = "lesson" -> doc.view.style, machines/mod_staging.py)
// or the view is told to (setOptions({style: "lesson"})). Meant to read like the flat lesson pictures (a plain wall, a plain floor band, the
// subject in strong colour) while staying the real 3D run: the bodies, their paths and their timing are the engine's, untouched.
//   - a plain BACKDROP in place of the room (the scene's background colour: no wall, no window light, no corners, nothing a shadow lands on),
//     chosen to make the subject pop (pickBackdrop: a pale one, or a mid blue-grey behind pale things) unless the scene names one;
//   - a plain TABLE: one matte colour, no wood grain, no varnish, no mirror;
//   - soft, short, light SHADOWS: the key light high and in front, its shadow map coarser (softer edges) and lighter, a brighter fill;
//   - CLEAR WATER: a liquid drawn in two layers, its far side tinted as before and its near side faint, so what is in it shows in its own colours
//     while the water still reads as water against the backdrop (lessonLiquid);
//   - no MACHINERY: model parts marked `userData.machinery` (a funnel's ring stand) are not drawn;
//   - holders: mid-air supports (the view's retort stands and wall brackets) are a slim rod from above, and a held thing's pull pin and post
//     go away at the release, or a holder from above lifts away (web/release-stand.js).
// Everything here is render only. Plain ES module; three.js through the importmap.
import * as THREE from "three"

/** The palettes: a pale backdrop and a light table for most subjects, a mid blue-grey and a mid tan behind pale (white, cream) ones. */
export const LESSON_PALETTE = {
	pale: { backdrop: "#eef2f5", table: "#d9caae" },
	mid: { backdrop: "#7d93a7", table: "#a48d6c" },
}
/** The light: key from the front, high (60 degrees up: a shadow is half as long as its thing is high, behind and below it, never on a wall); a
 *  coarser shadow map (soft edges); shadows at `shadow` of their full darkness (the contact shades under things stay as they are); a stronger,
 *  neutral fill; more of the studio light. (The real look: key 4.0 at (-1.9, 2.7, 1.7)
 *  from the table's middle, fill 0.3, environment 0.5, shadows full.) */
export const LESSON_LIGHT = { key: 3.1, keyAt: [-0.6, 3.8, 1.9], shadow: 0.4, shadowMap: 1024, fill: 1.05, fillSky: 0xffffff, envIntensity: 0.75 }
/** How a see-through liquid is drawn: its far side at least `back`, its near side `front` x its usual opacity (at least `frontMin`), its colour
 *  kept as the liquid's (tone-mapped by its brightest channel, as the paints are: AgX washed the lit water to grey) with a softer gloss: a thing
 *  in it keeps its colours, tinted just enough that its waterline shows (how deep it floats is often the lesson); a
 *  liquid as opaque as `opaque` or more (honey, oil, a dyed or a milky one) is drawn as it is. Glass panes (a tank's, a jar's faint pane) are
 *  drawn `pane` x as strong and less glossy: the room's light in them was a haze over the water. */
export const LESSON_LIQUID = { back: 0.6, front: 0.45, frontMin: 0.12, opaque: 0.75, clearcoat: 0.3, env: 0.5, pane: 0.6 }
export const STYLE_NAMES = ["lesson", "real"]
export const RELEASE_STANDS = ["post", "hidden", "hanger", "auto"]
const HEX = /^#[0-9a-f]{6}$/i

const srgbLum = (hex) => {
	const c = new THREE.Color(hex) // (linear working colour)
	return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** The area a solid covers in the side view (m²). */
function sideArea(s) {
	const b = s.body
	if (b.kind === "ball") return Math.PI * b.radius * b.radius
	if (b.kind === "slab") return (b.width ?? 0) * (b.height ?? 0)
	if (b.kind === "polygon") {
		let a = 0
		const p = b.points
		for (let i = 0; i < p.length; i++) {
			const q = p[(i + 1) % p.length]
			a += p[i].x * q.y - q.x * p[i].y
		}
		return Math.abs(a) / 2
	}
	return 0
}

/** The backdrop and table colours for a run's subject: the moving things (dynamic solids that are not see-through), weighted by the area they
 *  cover; when most of that area is pale (luminance over 0.55, as white, cream or pale yellow things are) the mid palette, else the pale one.
 *  {backdrop, table, why}. Liquids and grains of a module are not solids and do not count: a scene of white milk or sugar names its backdrop. */
export function pickBackdrop(doc, looks = {}) {
	let pale = 0
	let all = 0
	for (const s of doc?.solids ?? []) {
		if (s.kind !== "dynamic" || s.hidden_3d) continue
		const L = looks[s.look] ?? {}
		if ((L.transmission ?? 0) > 0.3 || (L.opacity ?? 1) < 0.6) continue // (glass, ice, water: the backdrop shows through them)
		const hex = typeof s.color === "string" && HEX.test(s.color) ? s.color : typeof L.fill === "string" ? L.fill : s.placeholder?.fill
		if (typeof hex !== "string" || !HEX.test(hex)) continue
		const a = sideArea(s)
		if (!(a > 0)) continue
		all += a
		if (srgbLum(hex) > 0.55 && (L.metalness ?? 0) < 0.5) pale += a // (a metal shows what is round it, dark edges and all: never pale)
	}
	const mid = all > 0 && pale / all > 0.5
	const P = mid ? LESSON_PALETTE.mid : LESSON_PALETTE.pale
	return { backdrop: P.backdrop, table: P.table, why: all > 0 ? `${Math.round((100 * pale) / all)} % of the moving things' area is pale` : "nothing moves: the pale backdrop" }
}

/** The style a run is drawn in, from its document (doc.view: style, backdrop, release_stand) and the view's own overrides (setOptions):
 *  {lesson: bool, name, backdrop: "#rrggbb" | null, table: "#rrggbb" | null, releaseStand: "post" | "hidden" | "hanger" | "auto", outline, why}. */
export function styleOf(doc, looks, over = {}) {
	const v = doc?.view ?? {}
	const name = over.style === "lesson" || over.style === "real" ? over.style : v.style === "lesson" ? "lesson" : "real"
	const lesson = name === "lesson"
	const rsOver = RELEASE_STANDS.includes(over.releaseStand) ? over.releaseStand : null
	const rsDoc = RELEASE_STANDS.includes(v.release_stand) ? v.release_stand : null
	const releaseStand = rsOver ?? rsDoc ?? (lesson ? "auto" : "post")
	if (!lesson) return { lesson: false, name, backdrop: null, table: null, releaseStand, outline: false, why: "" }
	const outline = over.outline !== false // (the lesson look's outlines: web/lesson-outline.js; the view may turn them off)
	const want = typeof over.backdrop === "string" ? over.backdrop : typeof v.backdrop === "string" ? v.backdrop : "auto"
	const picked = pickBackdrop(doc, looks)
	if (HEX.test(want)) {
		// a named backdrop: the table's colour is the palette's that suits it (a dark or mid backdrop gets the mid table)
		const P = srgbLum(want) > 0.45 ? LESSON_PALETTE.pale : LESSON_PALETTE.mid
		return { lesson, name, backdrop: want.toLowerCase(), table: P.table, releaseStand, outline, why: "the scene names its backdrop" }
	}
	return { lesson, name, backdrop: picked.backdrop, table: picked.table, releaseStand, outline, why: picked.why }
}

/** A key that says the same style twice (a change of it rebuilds the run). */
export const styleKey = (st) => (st.lesson ? `lesson|${st.backdrop}|${st.table}|${st.releaseStand}|${st.outline}` : `real|${st.releaseStand}`)

// ---------------------------------------------------------------- liquids: their far side tinted, their near side faint
const liquidCopies = new WeakSet() // the lesson copies made here (a copy of one, made by a frame hook, is not: it lost the shader)
const liquidCache = new WeakMap() // a liquid material -> its lesson copy (or itself when it is drawn as it is)
const LIQ_KEY = /(^|\|)(fl-liquid|flow-liquid\|body)/ // web/models/mod-fluids.js and mod-flow.js liquid materials (models3d.js kit.mat keys)
const PANE_KEY = /(^|\|)(fl-pane|flow-pane|fl-glass-edge)\|?/ // and their vessels' faint glass panes
const STREAM_KEY = /(^|\|)(flow-stream|flow-drops|flow-liquid\|(solid|drop))(\||$)/ // the pouring module's streams, drops and the liquid drawn solid in a glass jar
const glossCopies = new WeakSet()
const glossCache = new WeakMap()

/** Is this mesh a pouring stream, its drops, or a liquid drawn solid behind real glass (they keep their opacity in the lesson look)? */
export function isStream(o) {
	const m = o.material
	if (!m || Array.isArray(m) || glossCopies.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return false
	return STREAM_KEY.test(m.userData?.kitKey ?? "")
}
/** Its lesson copy: its colour kept (the paints' tone mapping: a dyed stream stays orange, not beige) and a softer gloss. */
export function lessonStream(m, grade = null) {
	let c = glossCache.get(m)
	if (c) return c
	c = m.clone()
	c.clearcoat = Math.min(m.clearcoat ?? 0, LESSON_LIQUID.clearcoat)
	c.envMapIntensity = Math.min(m.envMapIntensity ?? 1, LESSON_LIQUID.env)
	c.onBeforeCompile = (shader) => grade?.(shader, true)
	c.customProgramCacheKey = () => "lesson-stream"
	glossCopies.add(c)
	glossCache.set(m, c)
	return c
}
const paneCopies = new WeakSet()
const paneCache = new WeakMap()

/** Is this mesh one of the liquids' vessels' faint glass panes (alpha-blended, no depth write)? */
export function isPane(o) {
	const m = o.material
	if (!m || Array.isArray(m) || paneCopies.has(m) || !m.transparent || m.depthWrite) return false
	return o.userData?.pane === true || PANE_KEY.test(m.userData?.kitKey ?? "")
}
/** The lesson copy of a glass pane: fainter, less glossy (LESSON_LIQUID.pane). */
export function lessonPane(m) {
	let c = paneCache.get(m)
	if (c) return c
	c = m.clone()
	c.onBeforeCompile = m.onBeforeCompile
	c.customProgramCacheKey = m.customProgramCacheKey
	c.opacity = m.opacity * LESSON_LIQUID.pane
	c.clearcoat = Math.min(m.clearcoat ?? 0, LESSON_LIQUID.clearcoat)
	c.envMapIntensity = Math.min(m.envMapIntensity ?? 1, LESSON_LIQUID.env)
	paneCopies.add(c)
	paneCache.set(m, c)
	return c
}

/** Is this mesh a see-through liquid body (a lit, alpha-blended volume that writes no depth)? A model marks one `userData.liquid = true` (on the
 *  mesh or its material), or its material comes from the liquids' and pouring modules' liquid materials (kit.mat's key, `userData.kitKey`). */
export function isLiquid(o) {
	const m = o.material
	if (!m || Array.isArray(m) || liquidCopies.has(m)) return false
	if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || !m.transparent || m.depthWrite) return false
	return o.userData?.liquid === true || m.userData?.liquid === true || LIQ_KEY.test(m.userData?.kitKey ?? "")
}

/** The lesson copy of a liquid material: drawn both sides (three.js draws a two-sided see-through material back faces first, then front faces),
 *  the far side at max(opacity, back) and the near side at opacity x front, so a thing in the water is seen in its own colours through a
 *  faint near surface while the water's far side and floor still tint what is behind it. A liquid that is opaque already is drawn as it is. */
export function lessonLiquid(m, grade = null) {
	const hit = liquidCache.get(m)
	if (hit) return hit
	const base = m.userData?.lessonAlpha // (a frame hook's copy of a lesson copy keeps the alphas the first one worked out)
	const op = base ? base.op : m.opacity
	if (op >= LESSON_LIQUID.opaque) {
		liquidCache.set(m, m)
		return m
	}
	const back = base ? base.back : Math.min(0.9, Math.max(op, LESSON_LIQUID.back))
	const front = base ? base.front : Math.max(LESSON_LIQUID.frontMin, op * LESSON_LIQUID.front)
	const c = m.clone()
	c.side = THREE.DoubleSide
	c.forceSinglePass = false
	c.opacity = back // (what it shows if a hook's copy of it loses the shader below: the far side's strength all over)
	c.clearcoat = Math.min(m.clearcoat ?? 0, LESSON_LIQUID.clearcoat)
	c.envMapIntensity = Math.min(m.envMapIntensity ?? 1, LESSON_LIQUID.env)
	c.userData = { ...c.userData, lessonAlpha: { op, back, front } }
	const uFront = { value: front }
	const uBack = { value: back }
	c.onBeforeCompile = (shader) => {
		grade?.(shader, true) // (models3d.js gradeShader: its brightest channel through AgX's grey curve, the water stays its blue)
		shader.uniforms.uLessonFront = uFront
		shader.uniforms.uLessonBack = uBack
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nuniform float uLessonFront;\nuniform float uLessonBack;")
			// (three.js draws it as BackSide, then FrontSide: the back pass is the FLIP_SIDED program, where gl_FrontFacing is true, as the winding is flipped)
			.replace("#include <opaque_fragment>", "#ifdef FLIP_SIDED\n\tdiffuseColor.a = uLessonBack;\n#else\n\tdiffuseColor.a = uLessonFront;\n#endif\n#include <opaque_fragment>")
	}
	c.customProgramCacheKey = () => "lesson-liquid"
	liquidCopies.add(c)
	liquidCache.set(m, c)
	return c
}

/** Put the lesson look on what is drawn under `root`: liquids, streams and glass panes get their lesson copies, machinery is hidden. Cheap (a traversal and a WeakMap
 *  look-up a mesh), so the view runs it on a run's group whenever models have come in and on its plug-ins' groups at every draw (a module makes
 *  its liquid's meshes as it pours). grade: web/models3d.js gradeShader (the paints' tone mapping). Returns how many materials it swapped. */
export function lessonPass(root, grade = null) {
	let n = 0
	root.traverse((o) => {
		if (o.userData?.machinery === true) {
			o.visible = false
			return
		}
		if (!o.isMesh) return
		const c = isLiquid(o) ? lessonLiquid(o.material, grade) : isPane(o) ? lessonPane(o.material) : isStream(o) ? lessonStream(o.material, grade) : null
		if (c && c !== o.material) {
			o.material = c
			n++
		}
	})
	return n
}

/** Is the view's tabletop solid a table to repaint in the lesson look (a catalog table, or a floor of grained wood), or a floor whose stuff the
 *  lesson shows (grass, carpet, ice, concrete: kept as it is)? */
export const repaintsTable = (s, looks = {}) => s.itemType === "table" || (looks[s.look]?.grain ?? false) === true
/** The lesson table: one matte colour (the table's geometry darkens its edge faces through its vertex colours), cached per colour. */
const tables = new Map()
export function lessonTableMaterial(hex) {
	let m = tables.get(hex)
	if (!m) {
		m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.93, metalness: 0, vertexColors: true, envMapIntensity: 0.4 })
		m.userData.lessonTable = true
		tables.set(hex, m)
	}
	return m
}
