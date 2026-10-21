// Ring waves and entry splashes on a liquid's surface (render only: the engine's levels, buoyancy and tracks are untouched), the liquids module's
// view plug-in "fluids:rings" (web/models/mod-fluids.js registers it). A thing that pierces a liquid's top and moves up or down there pushes
// water aside at the rate A·v (its waterline's area A, its vertical speed v): that rate, every 1/12 s, sends out a ring, a packet of a wave and
// a half of the 4 cm ripples a bobbing thing makes, travelling at their deep-water speed c = √(gλ/2π + 2πσ/(ρλ)) = 0.27 m/s (λ 4 cm, water's
// σ 0.0728 N/m), its height 0.35 × A·v / (2π·r0·c) at the thing's edge r0 (the rest of the push goes into the slow slosh of the whole tank;
// at most 1.5 mm), falling as √(r0/r) as it spreads and dying out over 1.5 s, and mirrored by the container's walls (first reflections, 0.6 back). They are drawn on a sheet over the liquid's top that shades their slopes (lighter where a slope
// faces the camera, darker where it faces away) and is clear where the water is flat. A thing that enters faster than 0.5 m/s throws a crown
// of drops: 16 drops from round its waterline, up at 0.55-0.9 and out at 0.3-0.55 of its entry speed (a sphere's splash crown rises about as
// fast as it enters), falling back under gravity.
// Everything is worked out from the run's track when it loads, so the picture at a time t is always the same (the MP4 export's too).
// Nothing is made for a run in which nothing crosses a liquid's top.

const WAVE = 0.04 // m: the ripples' wavelength
const G = 9.81
const SIGMA = 0.0728 // N/m, water's surface tension at 20 °C
const RHO = 998.2
const C = Math.sqrt((G * WAVE) / (2 * Math.PI) + (2 * Math.PI * SIGMA) / (RHO * WAVE)) // 0.272 m/s
const K = (2 * Math.PI) / WAVE
const TAU_S = 1.5 // s: how long a ring lasts
const EMIT = 1 / 12 // s: a ring every this often while a thing moves through the surface
const SAMPLE = 1 / 120 // s: how finely the track is read
const MIN_RATE = 2e-6 // m³/s: a smaller push makes no ring
const MAX_AMP = 0.0015 // m: the tallest ring drawn (a splashing entry's: a slope of 0.24)
const RIPPLE_SHARE = 0.35 // the share of the pushed water's rate that leaves as these short ripples (the rest as the slow slosh of the whole tank)
const WALL = 0.6 // what a wall gives back of a ring
const MAX_PULSES = 32 // rings a sheet draws at once (the newest)
const SPLASH_V = 0.5 // m/s: an entry faster than this splashes
const DROPS = 16

/** A pseudo-random number 0..1 from integers (the same for the same inputs: a picture never changes between draws). */
const hash = (a, b) => {
	let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0
	h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The outline of a solid's body in its own frame: [[x, y]...] (a ball as a 24-gon) and its depth front to back (a sphere's: none, worked out
 *  from its chord). */
function outlineOf(body) {
	if (body.kind === "ball") {
		const r = body.radius
		return Array.from({ length: 24 }, (_, i) => [r * Math.cos((i * Math.PI) / 12), r * Math.sin((i * Math.PI) / 12)])
	}
	if (body.kind === "slab") {
		const w = body.width / 2
		const h = body.height / 2
		return [[-w, -h], [w, -h], [w, h], [-w, h]]
	}
	if (body.kind === "polygon") return body.points.map((p) => [p.x, p.y])
	return null
}

/** Where a posed outline crosses the line y = Y: [xa, xb], or null. */
function chordAt(pts, pose, Y) {
	const c = Math.cos(pose.angle)
	const s = Math.sin(pose.angle)
	const sc = pose.scale ?? 1
	let lo = Infinity
	let hi = -Infinity
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const [ax, ay] = pts[i]
		const [bx, by] = pts[(i + 1) % n]
		const x1 = pose.x + sc * (ax * c - ay * s)
		const y1 = pose.y + sc * (ax * s + ay * c)
		const x2 = pose.x + sc * (bx * c - by * s)
		const y2 = pose.y + sc * (bx * s + by * c)
		if ((y1 - Y) * (y2 - Y) > 0 || y1 === y2) continue
		const x = x1 + ((Y - y1) / (y2 - y1)) * (x2 - x1)
		lo = Math.min(lo, x)
		hi = Math.max(hi, x)
	}
	return hi > lo ? [lo, hi] : null
}

/** Half the width of a posed outline (world x). */
function halfWidth(pts, pose) {
	const c = Math.cos(pose.angle)
	const s = Math.sin(pose.angle)
	const sc = pose.scale ?? 1
	let lo = Infinity
	let hi = -Infinity
	for (const [x, y] of pts) {
		const wx = sc * (x * c - y * s)
		lo = Math.min(lo, wx)
		hi = Math.max(hi, wx)
	}
	return 0.5 * (hi - lo)
}

/** The lowest point of a posed outline (world y). */
function lowest(pts, pose) {
	const c = Math.cos(pose.angle)
	const s = Math.sin(pose.angle)
	const sc = pose.scale ?? 1
	let lo = Infinity
	for (const [x, y] of pts) lo = Math.min(lo, pose.y + sc * (x * s + y * c))
	return lo
}

const VERT = `
varying vec2 vXZ;
void main() {
	vec4 w = modelMatrix * vec4(position, 1.0);
	vXZ = w.xz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`
const FRAG = `
uniform float uT;
uniform int uN;
uniform vec4 uP[${MAX_PULSES}];
uniform vec4 uBox;
uniform float uRound;
uniform vec3 uCentre;
varying vec2 vXZ;
const float K = ${K.toFixed(6)};
const float C = ${C.toFixed(6)};
const float LEN = ${(1.5 * WAVE).toFixed(6)};
const float TAU = ${TAU_S.toFixed(3)};
const float WALL = ${WALL.toFixed(3)};
// one ring's height and its slope along r at (x, z), from a source at s: a packet a wave and a half long behind its front
vec2 ring(vec2 p, vec2 s, float dt, float a, float r0) {
	float r = max(length(p - s), 1e-4);
	float u = C * dt - r;
	if (u <= 0.0 || u >= LEN) return vec2(0.0);
	float w = 0.5 - 0.5 * cos(6.2831853 * u / LEN);
	float dw = 3.14159265 * sin(6.2831853 * u / LEN) / LEN;
	float amp = a * sqrt(r0 / max(r, r0)) * exp(-dt / TAU);
	// height amp sin(K u) w(u); its slope along r is -d/du of it (u falls as r grows)
	float dh = -amp * (K * cos(K * u) * w + sin(K * u) * dw);
	return vec2(amp * sin(K * u) * w, dh);
}
void main() {
	vec2 p = vXZ;
	if (uRound > 0.5) { if (length(p - uCentre.xz) > 0.5 * (uBox.y - uBox.x)) discard; }
	else if (p.x < uBox.x || p.x > uBox.y || p.y < uBox.z || p.y > uBox.w) discard;
	vec2 grad = vec2(0.0);
	for (int i = 0; i < ${MAX_PULSES}; i++) {
		if (i >= uN) break;
		vec4 q = uP[i];
		float dt = uT - q.z;
		if (dt <= 0.0) continue;
		float a = q.w;
		float r0 = 0.01;
		// the source and its images in the four walls (a round vessel: the source only)
		for (int j = 0; j < 5; j++) {
			vec2 s = q.xy;
			if (j > 0 && uRound > 0.5) break;
			if (j == 1) s.x = 2.0 * uBox.x - s.x;
			if (j == 2) s.x = 2.0 * uBox.y - s.x;
			if (j == 3) s.y = 2.0 * uBox.z - s.y;
			if (j == 4) s.y = 2.0 * uBox.w - s.y;
			vec2 hr = ring(p, s, dt, j > 0 ? a * WALL : a, r0);
			vec2 d = p - s;
			float len = max(length(d), 1e-4);
			grad += hr.y * d / len;
		}
	}
	// a slope that faces the camera (+z: the height falls toward it) mirrors the bright room above; one that faces away, the darker table and water
	float shade = clamp(-grad.y * 1.4 + grad.x * 0.35, -1.0, 1.0);
	float alpha = clamp(abs(shade) * 1.1, 0.0, 0.38);
	if (alpha < 0.004) discard;
	vec3 col = shade > 0.0 ? vec3(1.0, 1.0, 1.0) : vec3(0.22, 0.31, 0.38);
	gl_FragColor = vec4(col, alpha);
}`

/**
 * Registers "fluids:rings" (the view calls its load() with each run). kit and THREE as model files get them.
 */
export function registerRings({ addViewPlugin, THREE }) {
	if (typeof addViewPlugin !== "function") return
	addViewPlugin({
		name: "fluids:rings",
		load(ctx) {
			const T = THREE
			const doc = ctx.doc
			const track = ctx.track
			const liquids = (doc?.processes ?? []).filter((p) => p && p.kind === "liquid" && Array.isArray(p.layers) && p.layers.length > 0)
			if (!liquids.length || !track?.frames?.length) return null
			const t1 = track.frames[track.frames.length - 1].t
			const movers = doc.solids.filter((s) => s.kind === "dynamic" && !s.hidden_3d && outlineOf(s.body))
			if (!movers.length) return null
			const typeOf = (item) => doc.solids.find((s) => s.item === item)?.itemType
			const sheets = []
			const splashes = []
			for (const rec of liquids) {
				const item = rec.item
				const round = ["graduated-cylinder", "beaker", "measuring-jug", "density-column"].includes(typeOf(item))
				if (rec.layers.length > 1) continue // (a density column's layers: no rings between them)
				const x0 = rec.x0
				const x1 = rec.x1
				const D = round ? x1 - x0 : rec.area / Math.max(1e-6, x1 - x0)
				const levelAt = (t) => {
					const v = ctx.stateAt(item, "level_mm", t)
					return typeof v === "number" ? rec.floor + v / 1000 : rec.floor + rec.layers[0].height
				}
				// the pushes: every mover that crosses this liquid's top, sampled finely, gathered into a ring every EMIT s
				const pulses = []
				for (const s of movers) {
					if (s.item === item) continue
					const pts = outlineOf(s.body)
					const zDepth = (chord) => (s.body.kind === "ball" ? (s.shape === "cylinder" ? s.length ?? s.depth3d ?? 2 * s.body.radius : (Math.PI / 4) * chord) : s.body.depth ?? 0.05)
					let acc = 0
					let n = 0
					let accX = 0
					let accW = 0
					let prev = null
					let nextEmit = 0
					for (let t = 0; t <= t1 + 1e-9; t += SAMPLE) {
						const pose = ctx.placementAt(s.id, t)
						if (!pose || pose.x < x0 - 0.05 || pose.x > x1 + 0.05) {
							prev = null
							continue
						}
						const Y = levelAt(t)
						const low = lowest(pts, pose)
						const ch = chordAt(pts, pose, Y)
						if (prev) {
							const vy = (pose.y - prev.y) / SAMPLE
							// an entry: its lowest point passes down through the top, fast
							if (prev.low > prev.Y && low <= Y && vy < -SPLASH_V) splashes.push({ t, x: pose.x, y: Y, half: Math.max(0.006, 0.7 * halfWidth(pts, pose)), v: -vy })
							const chord = ch ? Math.min(ch[1], x1) - Math.max(ch[0], x0) : 0
							if (chord > 0) {
								acc += chord * Math.min(zDepth(chord), D) * Math.abs(vy)
								accX += 0.5 * (Math.max(ch[0], x0) + Math.min(ch[1], x1)) * chord
								accW += chord
								n++
							}
						}
						prev = { y: pose.y, low, Y }
						if (t >= nextEmit) {
							if (n > 0) {
								const rate = acc / n
								if (rate > MIN_RATE) {
									const r0 = Math.max(0.01, accW / n / 2)
									pulses.push([accX / Math.max(1e-9, accW), 0, t, Math.min(MAX_AMP, (RIPPLE_SHARE * rate) / (2 * Math.PI * r0 * C))])
								}
							}
							acc = accX = accW = 0
							n = 0
							nextEmit = t + EMIT
						}
					}
				}
				if (!pulses.length) continue
				pulses.sort((a, b) => a[2] - b[2])
				const w = x1 - x0
				const geo = round ? new T.CircleGeometry(w / 2, 48).rotateX(-Math.PI / 2) : new T.PlaneGeometry(w, D, 1, 1).rotateX(-Math.PI / 2)
				const uP = Array.from({ length: MAX_PULSES }, () => new T.Vector4())
				const mat = new T.ShaderMaterial({
					vertexShader: VERT,
					fragmentShader: FRAG,
					uniforms: { uT: { value: 0 }, uN: { value: 0 }, uP: { value: uP }, uBox: { value: new T.Vector4(x0, x1, -D / 2, D / 2) }, uRound: { value: round ? 1 : 0 }, uCentre: { value: new T.Vector3((x0 + x1) / 2, 0, 0) } },
					transparent: true,
					depthWrite: false,
					side: T.DoubleSide
				})
				const sheet = new T.Mesh(geo, mat)
				sheet.position.set((x0 + x1) / 2, levelAt(0) + 0.0004, 0)
				sheet.renderOrder = 3
				sheet.castShadow = false
				sheet.receiveShadow = false
				sheet.frustumCulled = false
				ctx.group.add(sheet)
				sheets.push({ sheet, mat, uP, pulses, levelAt })
			}
			// the drops of every splash: one instanced mesh, each drop's place worked out from its launch at any time
			let drops = null
			const launches = []
			if (splashes.length) {
				for (const [k, sp] of splashes.entries()) {
					for (let i = 0; i < DROPS; i++) {
						const a = ((i + hash(k, i) * 0.6) / DROPS) * 2 * Math.PI
						const out = (0.3 + 0.25 * hash(i, k + 7)) * sp.v
						const up = (0.55 + 0.35 * hash(k + 3, i)) * sp.v
						launches.push({ t0: sp.t, x: sp.x + sp.half * Math.cos(a), z: sp.half * Math.sin(a) * 0.9, y: sp.y, vx: out * Math.cos(a), vz: out * Math.sin(a) * 0.9, vy: up, r: 0.0015 + 0.0015 * hash(k, i + 31) })
					}
				}
				drops = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), new T.MeshPhysicalMaterial({ color: "#e9f5fb", roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.75, clearcoat: 1, envMapIntensity: 1.4 }), launches.length)
				drops.castShadow = false
				drops.receiveShadow = false
				drops.frustumCulled = false
				drops.renderOrder = 4
				ctx.group.add(drops)
			}
			if (!sheets.length && !drops) return null
			const m4 = new T.Matrix4()
			const hidden = new T.Matrix4().makeScale(0, 0, 0)
			return {
				frame(t) {
					for (const s of sheets) {
						s.sheet.position.y = s.levelAt(t) + 0.0004
						// the newest MAX_PULSES rings born by t and still alive
						let j = 0
						for (let i = s.pulses.length - 1; i >= 0 && j < MAX_PULSES; i--) {
							const p = s.pulses[i]
							if (p[2] > t || t - p[2] > 3 * TAU_S) continue
							s.uP[j++].set(p[0], p[1], p[2], p[3])
						}
						s.mat.uniforms.uN.value = j
						s.mat.uniforms.uT.value = t
						s.sheet.visible = j > 0
					}
					if (drops) {
						launches.forEach((d, i) => {
							const tau = t - d.t0
							const y = d.y + d.vy * tau - 0.5 * G * tau * tau
							if (tau <= 0 || (tau > 0.02 && y < d.y)) drops.setMatrixAt(i, hidden)
							else drops.setMatrixAt(i, m4.makeScale(d.r, d.r, d.r).setPosition(d.x + d.vx * tau, y, d.z + d.vz * tau))
						})
						drops.instanceMatrix.needsUpdate = true
					}
				},
				dispose() {
					for (const s of sheets) {
						s.sheet.geometry.dispose()
						s.mat.dispose()
					}
					if (drops) {
						drops.geometry.dispose()
						drops.material.dispose()
						drops.dispose?.()
					}
				}
			}
		}
	})
}
