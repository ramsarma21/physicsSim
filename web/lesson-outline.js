// The lesson look's OUTLINES (web/lesson-look.js; web/view3d.js runs this): a thin darker line just inside every thing's silhouette, as the flat
// lesson pictures draw one, so a thing reads against what is behind it whatever their colours (a silver clip on a pale table, a white ball on a
// white wall). Render only, and only a picture's look: the line is the thing's own colour, darker (its pixels are darkened, nothing is drawn over it),
// on the inside of its outline, so no shape grows or moves.
//   1. an ID pass: the scene drawn again into a target `ss` times the picture's size each way, every mesh in one flat colour that encodes its
//      thing (its item: the parts of one item are one thing, a held thing's holder is part of it; the table, a floor and the room are 0, the
//      background). See-through things (glass, water, panes, a liquid; anything alpha-blended or transmissive), contact shades, labels, and
//      parts whose shape is made in their own vertex shader (springs, ropes) are left out of it: what is inside a glass tank gets its line.
//   2. a composite pass: each pixel of the picture, darkened by `dark` x the share of its ss x ss sub-pixels that lie within `width` px (at the
//      picture's size) of another thing, its own thing not the background: an anti-aliased line of that width.
// Export frames draw it after the main pass of each (sub-)frame (draw); the canvas draws its picture into a target of its own and outlines it the
// same way, with one sub-pixel (present).
import * as THREE from "three"

export const OUTLINE = { width: 1 / 400, minWidth: 1, dark: 0.55, ss: 2 } // width: of the picture's height (2.7 px at 1080p), at least minWidth px

const VS = "precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }"
const FS = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D tColor;
uniform sampler2D tId;
uniform float uR;
uniform int uS;
uniform float uDark;
out vec4 outColor;
int idAt(ivec2 p, ivec2 size) {
	vec4 c = texelFetch(tId, clamp(p, ivec2(0), size - 1), 0);
	return int(c.r * 255.0 + 0.5) + 256 * int(c.g * 255.0 + 0.5) + 65536 * int(c.b * 255.0 + 0.5);
}
const vec2 DIRS[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071), vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
void main() {
	ivec2 P = ivec2(gl_FragCoord.xy);
	vec4 col = texelFetch(tColor, P, 0);
	ivec2 size = textureSize(tId, 0);
	float r = uR * float(uS);
	float e = 0.0;
	for (int sy = 0; sy < uS; sy++) {
		for (int sx = 0; sx < uS; sx++) {
			ivec2 q = P * uS + ivec2(sx, sy);
			int me = idAt(q, size);
			if (me == 0) continue;
			for (int k = 0; k < 8; k++) {
				if (idAt(q + ivec2(round(DIRS[k] * r)), size) != me) {
					e += 1.0;
					break;
				}
			}
		}
	}
	e /= float(uS * uS);
	outColor = vec4(col.rgb * (1.0 - uDark * e), 1.0);
}`

/** One outliner per view (its targets, its materials). renderer: the view's. */
export function makeOutliner(renderer) {
	const idMat = new THREE.ShaderMaterial({
		uniforms: { uId: { value: new THREE.Color(0, 0, 0) } },
		vertexShader: `#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
void main() {
#include <batching_vertex>
#include <skinbase_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
}`,
		fragmentShader: "uniform vec3 uId;\nvoid main() { gl_FragColor = vec4(uId, 1.0); }",
		side: THREE.DoubleSide,
		toneMapped: false,
	})
	let ids = new Map() // item -> its number (1 ...)
	let groundIds = new Set() // solid ids drawn as the background (the table, a floor)
	let itemOf = null
	const col = new THREE.Color()
	idMat.onBeforeRender = (_r, _s, _c, _g, object) => {
		const sid = object.userData?.solidId
		let n = 0
		if (sid && !groundIds.has(sid)) {
			// (a holder, a stand: a thing of its own beside the thing it holds)
			const item = (object.userData.stand ? "stand|" : object.userData.mount ? "mount|" : "") + (itemOf?.get(sid) ?? sid)
			n = ids.get(item)
			if (n === undefined) {
				n = ids.size + 1
				ids.set(item, n)
			}
		}
		col.setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255, THREE.LinearSRGBColorSpace)
		idMat.uniforms.uId.value.copy(col)
		idMat.uniformsNeedUpdate = true
	}
	const comp = new THREE.RawShaderMaterial({
		glslVersion: THREE.GLSL3,
		vertexShader: VS,
		fragmentShader: FS,
		uniforms: { tColor: { value: null }, tId: { value: null }, uR: { value: 2 }, uS: { value: OUTLINE.ss }, uDark: { value: OUTLINE.dark } },
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	})
	const quadGeo = new THREE.BufferGeometry()
	quadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
	const quad = new THREE.Mesh(quadGeo, comp)
	quad.frustumCulled = false
	const quadScene = new THREE.Scene()
	quadScene.add(quad)
	const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	let idRT = null
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
	const sizeTo = (W, H, ss) => {
		if (!idRT || idRT.width !== W * ss || idRT.height !== H * ss) {
			idRT?.dispose()
			idRT = new THREE.WebGLRenderTarget(W * ss, H * ss, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false })
		}
		if (!outRT || outRT.width !== W || outRT.height !== H) {
			outRT?.dispose()
			outRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false })
			outRT.texture.internalFormat = "RGBA8"
		}
	}
	const hidden = []
	/** Is this mesh drawn in the ID pass? (see the header) */
	const drawn = (o) => {
		if (o.userData?.blob || o.isSprite || o.isLine || o.isPoints) return false
		const m = o.material
		if (!m) return false
		for (const x of Array.isArray(m) ? m : [m]) {
			if (x.transparent || (x.transmission ?? 0) > 0 || x.opacity < 1 || x.isSpriteMaterial) return false
			const key = typeof x.customProgramCacheKey === "function" ? x.customProgramCacheKey() : ""
			if (key === "coil" || key === "rope") return false // (their shape is made in their vertex shader)
		}
		return true
	}
	return {
		/** Darken the outlines into a picture: `color` (the frame, W x H, sRGB bytes) drawn by `camera` from `scene` (its run's `group`), into a
		 *  target of its own, which it returns (the caller reads it as it read `color`). run: {itemOf (solid id -> item), groundIds}. */
		draw(scene, camera, color, W, H, run, { ss = OUTLINE.ss, width = null } = {}) {
			sizeTo(W, H, ss)
			ids = new Map()
			itemOf = run.itemOf
			groundIds = run.groundIds ?? new Set()
			// the ID pass: see-through and left-out things hidden, every other mesh in its thing's colour, the room's background none
			hidden.length = 0
			run.group.traverse((o) => {
				if ((o.isMesh || o.isSprite || o.isLine || o.isPoints) && o.visible && !drawn(o)) {
					o.visible = false
					hidden.push(o)
				}
			})
			const bg = scene.background
			const ov = scene.overrideMaterial
			const autoClear = renderer.autoClear
			const prevRt = renderer.getRenderTarget()
			const clear = renderer.getClearColor(new THREE.Color())
			const alpha = renderer.getClearAlpha()
			const shadowUpdate = renderer.shadowMap.needsUpdate
			const mask = camera.layers.mask
			try {
				scene.background = null
				scene.overrideMaterial = idMat
				renderer.shadowMap.needsUpdate = false
				camera.layers.disable(3) // (labels and panes: not things)
				renderer.setClearColor(0x000000, 1)
				renderer.autoClear = true
				renderer.setRenderTarget(idRT)
				renderer.render(scene, camera)
			} finally {
				camera.layers.mask = mask
				scene.overrideMaterial = ov
				scene.background = bg
				renderer.setClearColor(clear, alpha)
				renderer.shadowMap.needsUpdate = shadowUpdate
				for (const o of hidden) o.visible = true
				hidden.length = 0
			}
			// the composite
			comp.uniforms.tColor.value = color
			comp.uniforms.tId.value = idRT.texture
			comp.uniforms.uS.value = ss
			comp.uniforms.uR.value = width ?? Math.max(OUTLINE.minWidth, OUTLINE.width * H)
			renderer.autoClear = false
			renderer.setRenderTarget(outRT)
			renderer.render(quadScene, quadCam)
			renderer.autoClear = autoClear
			renderer.setRenderTarget(prevRt)
			return outRT
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
			idRT?.dispose()
			outRT?.dispose()
			mainRT?.dispose()
			blit.dispose()
			idRT = outRT = mainRT = null
			idMat.dispose()
			comp.dispose()
			quadGeo.dispose()
		},
	}
}
