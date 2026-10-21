// The lesson look's OUTLINES (web/lesson-look.js; web/view3d.js runs this): lines as the flat lesson pictures draw them, so a thing reads against
// what is behind it whatever their colours (a silver clip on a pale table, a white ball on a white wall), a glass vessel shows its shape, and the
// water its surface. Render only, and only a picture's look: a line darkens or tints pixels that are already there, on the inside of a silhouette,
// so no shape grows or moves.
//   1. ID passes: the scene drawn again into targets `ss` times the picture's size each way, every mesh in one flat colour that encodes its thing
//      (its item: the parts of one item are one thing; a holder or a stand is a thing of its own; the table, a floor and the room are 0, the
//      background). Pass A draws the opaque things only (glass, water and anything alpha-blended or transmissive left out: what is inside a glass
//      tank gets its line). Pass B draws them and the see-through vessels (glass, panes, ice), flagged; pass C them and the liquids, flagged (each
//      only when the run has such things; apart, as a tank's front pane would hide its water's surface). Contact shades, labels, streams and drops,
//      glows, shadow-only proxies (no colour written), instanced clouds (grains, drops, a chain's links: no line round each) and parts shaped in their
//      own vertex shader (springs, ropes) are in none.
//   2. a composite pass: each pixel darkened by `dark` x the share of its ss x ss sub-pixels that lie within `width` px (at the picture's size) of
//      another thing in pass A (on the thing's side: the background gets no line), then tinted toward `glass` where a see-through vessel meets
//      anything else in pass B (the vessel's side: its outline), and toward `water` on a liquid's side in pass C where its front meets its surface
//      (the waterline across the vessel; pass C tells a liquid's up-looking faces apart) and where it covers part of a thing (pass A has that thing
//      behind it: the waterline round a floating thing), but not round its own outline: anti-aliased lines of that width.
// Export frames draw it after the main pass of each (sub-)frame (draw); the canvas draws its picture into a target of its own and outlines it the
// same way, with one sub-pixel (present).
import * as THREE from "three"

/** width: of the picture's height (2.7 px at 1080p), at least minWidth px; dark: how much a thing's line darkens it; glass / water: the colours
 *  the see-through vessels' and the liquids' lines tint toward, and how far (glassK, waterK); a vessel's line is glassWidth x as wide (a faint jar
 *  needs it). */
export const OUTLINE = { width: 1 / 400, minWidth: 1, dark: 0.55, ss: 2, glass: "#3d6584", glassK: 0.85, glassWidth: 1.6, water: "#2c6ea8", waterK: 0.65 }
const GLASS = 1 << 22 // (passes B's and C's flags on a thing's number)
const LIQUID = 1 << 23
const TOP = 1 << 21 // (pass C: a liquid's face that looks up, its surface)

const VS = "precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }"
const FS = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D tColor;
uniform sampler2D tId;
uniform sampler2D tGlass;
uniform sampler2D tLiquid;
uniform bool uGlassOn;
uniform bool uLiquidOn;
uniform float uR;
uniform float uRg;
uniform int uS;
uniform float uDark;
uniform vec3 uGlass;
uniform vec3 uWater;
uniform float uGlassK;
uniform float uWaterK;
uniform vec4 uRect;
out vec4 outColor;
// (uRect: the sub-pixels a line may look at, x0 y0 x1 y1: the whole picture, or one band of a directed camera's picture, so no line is drawn along
// a band's edge where another band's things are)
int idAt(sampler2D t, ivec2 p, ivec2 size) {
	vec4 c = texelFetch(t, clamp(p, ivec2(uRect.xy), ivec2(uRect.zw) - 1), 0);
	return int(c.r * 255.0 + 0.5) + 256 * int(c.g * 255.0 + 0.5) + 65536 * int(c.b * 255.0 + 0.5);
}
const vec2 DIRS[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071), vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
const int GLASS = ${GLASS};
const int LIQUID = ${LIQUID};
const int TOP = ${TOP};
void main() {
	ivec2 P = ivec2(gl_FragCoord.xy);
	vec4 col = texelFetch(tColor, P, 0);
	ivec2 size = textureSize(tId, 0);
	float r = uR * float(uS);
	float e = 0.0;
	float eg = 0.0;
	float ew = 0.0;
	for (int sy = 0; sy < uS; sy++) {
		for (int sx = 0; sx < uS; sx++) {
			ivec2 q = P * uS + ivec2(sx, sy);
			int me = idAt(tId, q, size);
			if (me != 0) {
				for (int k = 0; k < 8; k++) {
					if (idAt(tId, q + ivec2(round(DIRS[k] * r)), size) != me) {
						e += 1.0;
						break;
					}
				}
			}
			if (uGlassOn) {
				int g = idAt(tGlass, q, size);
				if ((g & GLASS) != 0) {
					float rg = uRg * float(uS);
					for (int k = 0; k < 8; k++) {
						if (idAt(tGlass, q + ivec2(round(DIRS[k] * rg)), size) != g) {
							eg += 1.0;
							break;
						}
					}
				}
			}
			if (uLiquidOn) {
				// a liquid's lines, on its side: where its front meets its surface (the waterline across its vessel), and where it covers part of a thing
				// (pass A has the same thing behind it there: the waterline round a floating thing); none round its own outline against what is behind
				int w = idAt(tLiquid, q, size);
				if ((w & LIQUID) != 0) {
					int behind = idAt(tId, q, size);
					for (int k = 0; k < 8; k++) {
						int o = idAt(tLiquid, q + ivec2(round(DIRS[k] * r)), size);
						if (o == w || o == 0) continue;
						if ((o & LIQUID) != 0) {
							if ((w & TOP) == 0 && o == (w | TOP)) {
								ew += 1.0;
								break;
							}
							continue;
						}
						if (behind == o) {
							ew += 1.0;
							break;
						}
					}
				}
			}
		}
	}
	float n = float(uS * uS);
	vec3 c = col.rgb * (1.0 - uDark * e / n);
	c = mix(c, uGlass, uGlassK * eg / n);
	c = mix(c, uWater, uWaterK * ew / n);
	outColor = vec4(c, 1.0);
}`

/** One outliner per view (its targets, its materials). renderer: the view's. */
export function makeOutliner(renderer) {
	// (its number as a float, exact below 2^24, written as three bytes; with uTop set, a face that looks up adds it: a liquid's surface in pass C)
	const idMat = new THREE.ShaderMaterial({
		uniforms: { uId: { value: 0 }, uTop: { value: 0 } },
		vertexShader: `#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying float vUp;
void main() {
#include <beginnormal_vertex>
#include <morphnormal_vertex>
#include <batching_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
	vec3 wn = mat3(modelMatrix) * objectNormal;
#ifdef USE_INSTANCING
	wn = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#endif
	vUp = normalize(wn).y;
}`,
		fragmentShader: `uniform float uId;
uniform float uTop;
varying float vUp;
void main() {
	float n = uId + (vUp > 0.7 ? uTop : 0.0);
	gl_FragColor = vec4(mod(n, 256.0), mod(floor(n / 256.0), 256.0), floor(n / 65536.0), 255.0) / 255.0;
}`,
		side: THREE.DoubleSide,
		toneMapped: false,
	})
	const code = new Map() // mesh -> its number in the pass being drawn
	const tops = new Set() // the meshes whose up-looking faces are told apart in the pass being drawn (the liquids, in pass C)
	idMat.onBeforeRender = (_r, _s, _c, _g, object) => {
		idMat.uniforms.uId.value = code.get(object) ?? 0
		idMat.uniforms.uTop.value = tops.has(object) ? TOP : 0
		idMat.uniformsNeedUpdate = true
	}
	const comp = new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: VS,
		fragmentShader: FS,
		uniforms: {
			tColor: { value: null }, tId: { value: null }, tGlass: { value: null }, tLiquid: { value: null }, uGlassOn: { value: false }, uLiquidOn: { value: false },
			uR: { value: 2 }, uRg: { value: 3 }, uS: { value: OUTLINE.ss }, uDark: { value: OUTLINE.dark },
			uGlass: { value: new THREE.Color(OUTLINE.glass) }, uWater: { value: new THREE.Color(OUTLINE.water) }, uGlassK: { value: OUTLINE.glassK }, uWaterK: { value: OUTLINE.waterK },
			uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
		},
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	})
	// (the line colours are sRGB bytes mixed with sRGB bytes: the picture's own; THREE.Color holds linear, so its sRGB is put in as plain numbers)
	for (const [u, hex] of [["uGlass", OUTLINE.glass], ["uWater", OUTLINE.water]]) {
		const c = new THREE.Color(hex)
		const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
		comp.uniforms[u].value = new THREE.Vector3(s.r, s.g, s.b)
	}
	const quadGeo = new THREE.BufferGeometry()
	quadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
	const quad = new THREE.Mesh(quadGeo, comp)
	quad.frustumCulled = false
	const quadScene = new THREE.Scene()
	quadScene.add(quad)
	const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	let idRT = null
	let glassRT = null
	let liquidRT = null
	let outRT = null
	let mainRT = null // (the canvas's own picture, for present)
	const _size = new THREE.Vector2()
	const blit = new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: VS,
		fragmentShader: "precision highp float;\nprecision highp sampler2D;\nuniform sampler2D tSrc;\nout vec4 outColor;\nvoid main() { outColor = vec4(texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }",
		uniforms: { tSrc: { value: null } },
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	})
	const idTarget = (rt, W, H) => {
		if (rt && rt.width === W && rt.height === H) return rt
		rt?.dispose()
		return new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false })
	}
	const sizeTo = (W, H, ss, glass, liquid) => {
		idRT = idTarget(idRT, W * ss, H * ss)
		if (glass) glassRT = idTarget(glassRT, W * ss, H * ss)
		if (liquid) liquidRT = idTarget(liquidRT, W * ss, H * ss)
		if (!outRT || outRT.width !== W || outRT.height !== H) {
			outRT?.dispose()
			outRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false })
			outRT.texture.internalFormat = "RGBA8"
		}
	}
	const LIQ_KEY = /(^|\|)(fl-liquid|flow-liquid)/ // (web/lesson-look.js: the liquids' kit material keys)
	const STREAM_KEY = /(^|\|)(flow-stream|flow-drops|flow-wet)/ // (a pouring stream, its drops, a puddle: no line of their own)
	/** What a mesh is to the ID passes: "skip" (in none), "thing" (opaque), "glass" (a see-through vessel, ice), "liquid". */
	const kindOf = (o) => {
		if (o.userData?.blob || o.isSprite || o.isLine || o.isPoints || o.isInstancedMesh) return "skip" // (a cloud of grains or drops, a row of links: no line round each)
		if (o.userData?.waterSurface) return "skip" // (a clear liquid's rippled top sheet: its body, a liquid, has the surface)
		const m = o.material
		if (!m) return "skip"
		let see = false
		let liquid = o.userData?.liquid === true
		for (const x of Array.isArray(m) ? m : [m]) {
			if (x.isSpriteMaterial || !(x.isMeshStandardMaterial || x.isMeshPhysicalMaterial || x.isMeshBasicMaterial || x.isMeshLambertMaterial || x.isMeshPhongMaterial)) return "skip"
			if (x.colorWrite === false || x.visible === false) return "skip" // (a shadow-only proxy: a glass tank's faint shadow is a box round the whole tank)
			const key = typeof x.customProgramCacheKey === "function" ? x.customProgramCacheKey() : ""
			if (key === "coil" || key === "rope") return "skip" // (their shape is made in their vertex shader)
			if (x.transparent || (x.transmission ?? 0) > 0 || x.opacity < 1) {
				// (a glow, a beam, a board; a stream. A mesh marked a liquid is one whatever it is drawn with: clear water's body only tints, unlit)
				if ((x.isMeshBasicMaterial && !liquid) || STREAM_KEY.test(x.userData?.kitKey ?? "")) return "skip"
				see = true
				if (x.userData?.liquid === true || x.userData?.lessonAlpha || LIQ_KEY.test(x.userData?.kitKey ?? "")) liquid = true
			}
		}
		if (!see) return "thing"
		return liquid ? "liquid" : "glass"
	}
	const thingNo = new Map() // the pass's thing names -> numbers (1 ...)
	const numberOf = (o, run) => {
		const sid = o.userData?.solidId
		if (!sid || run.groundIds?.has(sid)) return 0
		const name = (o.userData.stand ? "stand|" : o.userData.mount ? "mount|" : "") + (run.itemOf?.get(sid) ?? sid) // (a holder, a stand: a thing of its own)
		let n = thingNo.get(name)
		if (n === undefined) {
			n = thingNo.size + 1
			thingNo.set(name, n)
		}
		return n
	}
	const drawPass = (scene, camera, rt, run, list, want, surfaces = false) => {
		// the meshes of `list` ([mesh, kind]) that this pass leaves out are hidden while it draws; the rest wear their numbers
		const hide = []
		code.clear()
		tops.clear()
		for (const [o, kind] of list) {
			if (!want(kind)) {
				if (o.visible) {
					o.visible = false
					hide.push(o)
				}
				continue
			}
			const n = numberOf(o, run)
			code.set(o, kind === "liquid" ? n | LIQUID : kind === "glass" ? n | GLASS : n)
			if (surfaces && kind === "liquid") tops.add(o)
		}
		try {
			renderer.setRenderTarget(rt)
			renderer.render(scene, camera)
		} finally {
			for (const o of hide) o.visible = true
		}
	}
	/** The meshes of the run's group as the ID passes see them ([mesh, kind], the visible ones) and whether any is a see-through vessel or a liquid. */
	const collect = (run) => {
		const list = []
		let glass = false
		let liquid = false
		run.group.traverse((o) => {
			if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints) || !o.visible) return
			const kind = kindOf(o)
			list.push([o, kind])
			if (kind === "glass") glass = true
			else if (kind === "liquid") liquid = true
		})
		return { list, glass, liquid }
	}
	/** The ID passes of what `camera` sees, into the whole of each target, or into `rect` [x, y, w, h] of it (sub-pixels from the bottom left: one
	 *  band of a picture; the rest of each target is left as it is). */
	const idPasses = (scene, camera, run, L, rect = null) => {
		const targets = [idRT, L.glass ? glassRT : null, L.liquid ? liquidRT : null].filter(Boolean)
		const bg = scene.background
		const ov = scene.overrideMaterial
		const clear = renderer.getClearColor(new THREE.Color())
		const alpha = renderer.getClearAlpha()
		const shadowUpdate = renderer.shadowMap.needsUpdate
		const mask = camera.layers.mask
		try {
			if (rect)
				for (const rt of targets) {
					rt.viewport.set(rect[0], rect[1], rect[2], rect[3])
					rt.scissor.set(rect[0], rect[1], rect[2], rect[3])
					rt.scissorTest = true
				}
			scene.background = null
			scene.overrideMaterial = idMat
			renderer.shadowMap.needsUpdate = false
			camera.layers.disable(3) // (labels and panes: not things)
			renderer.setClearColor(0x000000, 1)
			renderer.autoClear = true
			drawPass(scene, camera, idRT, run, L.list, (k) => k === "thing")
			// (each kind of see-through thing in its own pass with the opaque things: a tank's front pane would hide its water's surface)
			if (L.glass) drawPass(scene, camera, glassRT, run, L.list, (k) => k === "thing" || k === "glass")
			if (L.liquid) drawPass(scene, camera, liquidRT, run, L.list, (k) => k === "thing" || k === "liquid", true)
		} finally {
			if (rect)
				for (const rt of targets) {
					rt.viewport.set(0, 0, rt.width, rt.height)
					rt.scissor.set(0, 0, rt.width, rt.height)
					rt.scissorTest = false
				}
			camera.layers.mask = mask
			scene.overrideMaterial = ov
			scene.background = bg
			renderer.setClearColor(clear, alpha)
			renderer.shadowMap.needsUpdate = shadowUpdate
			code.clear()
			tops.clear()
		}
	}
	/** The composite into outRT: over the whole picture, or over `rect` [x, y, w, h] of it (pixels from the bottom left), its lines looking at the ID
	 *  passes inside that rectangle only. */
	const composite = (color, L, W, H, ss, width, rect = null) => {
		const U = comp.uniforms
		U.tColor.value = color
		U.tId.value = idRT.texture
		U.tGlass.value = L.glass ? glassRT.texture : idRT.texture
		U.tLiquid.value = L.liquid ? liquidRT.texture : idRT.texture
		U.uGlassOn.value = L.glass
		U.uLiquidOn.value = L.liquid
		U.uS.value = ss
		U.uR.value = width ?? Math.max(OUTLINE.minWidth, OUTLINE.width * H)
		U.uRg.value = U.uR.value * OUTLINE.glassWidth
		const [x, y, w, h] = rect ?? [0, 0, W, H]
		U.uRect.value.set(x * ss, y * ss, (x + w) * ss, (y + h) * ss)
		if (rect) {
			outRT.viewport.set(x, y, w, h)
			outRT.scissor.set(x, y, w, h)
			outRT.scissorTest = true
		}
		renderer.autoClear = false
		renderer.setRenderTarget(outRT)
		renderer.render(quadScene, quadCam)
		if (rect) {
			outRT.viewport.set(0, 0, W, H)
			outRT.scissor.set(0, 0, W, H)
			outRT.scissorTest = false
		}
	}
	/** `color` copied into outRT as it is (the picture's parts no band outlines). */
	const copyIn = (color) => {
		blit.uniforms.tSrc.value = color
		quad.material = blit
		renderer.autoClear = false
		renderer.setRenderTarget(outRT)
		renderer.render(quadScene, quadCam)
		quad.material = comp
	}
	return {
		/** The outlines on a picture: `color` (the frame, W x H, sRGB bytes) drawn by `camera` from `scene` (its run's `group`), into a target of
		 *  its own, which it returns (the caller reads it as it read `color`). run: {group, itemOf (solid id -> item), groundIds}. */
		draw(scene, camera, color, W, H, run, { ss = OUTLINE.ss, width = null } = {}) {
			const L = collect(run)
			sizeTo(W, H, ss, L.glass, L.liquid)
			thingNo.clear()
			const autoClear = renderer.autoClear
			const prevRt = renderer.getRenderTarget()
			idPasses(scene, camera, run, L)
			composite(color, L, W, H, ss, width)
			renderer.autoClear = autoClear
			renderer.setRenderTarget(prevRt)
			return outRT
		},
		/** The outlines of a picture drawn band by band (a directed camera's frame, web/view3d.js exportDrawPlan; each band its own camera and
		 *  rectangle): `begin(W, H)` once a (sub-)frame, then `job.band(scene, camera, color, rect, run)` right after each band's main pass, while
		 *  its things are hidden as that band hides them (rect [x, y, w, h] px from the top left, as the film's bands). Each band is outlined inside
		 *  its own rectangle as a whole picture is (no line along its edge where the next band's things are). `job.target`: the outlined picture
		 *  (null until a band is drawn; the first band copies `color` in whole, so a band this view does not draw stays as the main pass left it). */
		begin(W, H, { ss = OUTLINE.ss, width = null } = {}) {
			thingNo.clear()
			const job = {
				target: null,
				band(scene, camera, color, rect, run) {
					const L = collect(run)
					sizeTo(W, H, ss, L.glass, L.liquid)
					const autoClear = renderer.autoClear
					const prevRt = renderer.getRenderTarget()
					const [x, y, w, h] = rect
					const gy = H - y - h // (from the bottom left, as GL counts)
					try {
						idPasses(scene, camera, run, L, [x * ss, gy * ss, w * ss, h * ss])
						if (!job.target) copyIn(color)
						composite(color, L, W, H, ss, width, [x, gy, w, h])
					} finally {
						renderer.autoClear = autoClear
						renderer.setRenderTarget(prevRt)
					}
					job.target = outRT
				},
			}
			return job
		},
		/** The canvas's picture with its outlines: the scene drawn as for the canvas (tone mapping and sRGB in the shaders: an XR-type target, as
		 *  the export's main pass) into a 4 x MSAA target of the drawing buffer's size, outlined (one sub-pixel: the canvas is drawn at every
		 *  frame), then copied to the canvas. */
		present(scene, camera, run) {
			const size = renderer.getDrawingBufferSize(_size)
			const W = Math.max(1, size.x)
			const H = Math.max(1, size.y)
			if (!mainRT || mainRT.width !== W || mainRT.height !== H) {
				mainRT?.dispose()
				mainRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false, samples: Math.min(4, renderer.capabilities.maxSamples ?? 4) })
				mainRT.texture.internalFormat = "RGBA8"
				mainRT.isXRRenderTarget = true
			}
			const prevRt = renderer.getRenderTarget()
			renderer.setRenderTarget(mainRT)
			renderer.render(scene, camera)
			const out = this.draw(scene, camera, mainRT.texture, W, H, run, { ss: 1 })
			blit.uniforms.tSrc.value = out.texture
			quad.material = blit
			const autoClear = renderer.autoClear
			renderer.autoClear = false
			renderer.setRenderTarget(null)
			renderer.render(quadScene, quadCam)
			renderer.autoClear = autoClear
			quad.material = comp
			renderer.setRenderTarget(prevRt)
		},
		dispose() {
			for (const rt of [idRT, glassRT, liquidRT, outRT, mainRT]) rt?.dispose()
			idRT = glassRT = liquidRT = outRT = mainRT = null
			blit.dispose()
			idMat.dispose()
			comp.dispose()
			quadGeo.dispose()
		},
	}
}
