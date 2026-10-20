// The space module's 3D models (machines/mod_space.py's types) and its view plug-in (web/view-plugins.js):
//   sun          a glowing sphere (its granulation baked on the sphere) with a soft corona; it casts no shadow (its light comes from inside it)
//   planet/moon  spheres of exactly their physics radius wearing a texture baked per body on the sphere (no seams, no pinched poles):
//                Earth's oceans, land, ice and clouds; the Moon's maria and craters; Mars; Jupiter's bands and Red Spot; Saturn and its rings
//                (drawn, not solid); Venus, Mercury, Uranus, Neptune, Pluto; Io, Europa, Ganymede, Callisto, Titan, Phobos, Deimos.
//                The machine plane is the plane of the orbits, seen from above: each globe's pole leans 25° toward the camera so its face shows,
//                and it turns on its axis at its real rate at the scene's scale when that is slow enough to see (≤ 0.3 turns a second)
//   satellite    a satellite (gold foil, two solar wings, a dish), a space station (truss, four wings, modules), an iron cannonball, a probe
//   rock-hammer  a geologist's hammer: a steel head (square face, pick) on a steel handle with a rubber grip
//   globe        a classroom globe: a round base, a chrome post, a brass half meridian, the Earth's map on a ball turning on its tilted axis
//                (from the run's `turns`: the town's pin rises into the light and sets out of it), its night half darkened from where the light
//                is (the model's terminator: the lit cap of a near lamp, half the ball in parallel light)
//   moon-ball    a white foam ball on a wooden dowel, drawn where it is carried (round the globe's middle, its tilted circle), its night half dark
//   (orbit mode) a tilted Moon is drawn lifted off the plane by its height above it (× the factor the bodies are drawn larger than true, so
//                its drawn shadows fall as the real ones), red-brown in a total lunar eclipse; a planet with seasons leans its real axis
// Plug-in "space:sky" (a run with a space body): leaves out the room and the table top (the table still collides: keep orbits above it),
// shows a starry sky, dims the room's light to starlight, lights the scene from each sun (a point light at a pulling Sun, parallel light
// from a far one: shadows, so eclipses show), draws each launched body's path as it goes, and beside a moon's planet an inset of the
// Moon's phase as the planet sees it ("Seen from Earth: waxing gibbous, 78 % lit"), from the engine's readings.
export default function register({ addModel, addViewPlugin, addFrameHook, ownMaterial, kit, THREE }) {
	const TAU = Math.PI * 2
	const PI = Math.PI
	const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
	const smooth = (a, b, x) => {
		const t = clamp((x - a) / (b - a))
		return t * t * (3 - 2 * t)
	}
	const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
	const rgb = (s) => {
		const c = String(s).replace("#", "")
		return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
	}
	const cache = new Map()
	const memo = (k, f) => {
		let v = cache.get(k)
		if (v === undefined) {
			v = kit.bakeScope ? kit.bakeScope(`space|${k}`, f) : f()
			cache.set(k, v)
		}
		return v
	}
	function rng(seed) {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6d2b79f5) >>> 0
			let t = a
			t = Math.imul(t ^ (t >>> 15), t | 1)
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	// ---------------------------------------------------------------- 3D gradient noise (seamless on a sphere)
	const PERM = new Uint8Array(512)
	{
		const r = rng(20261019)
		const p = Array.from({ length: 256 }, (_, i) => i)
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(r() * (i + 1))
			;[p[i], p[j]] = [p[j], p[i]]
		}
		for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
	}
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
	const lerp = (t, a, b) => a + t * (b - a)
	function grad(h, x, y, z) {
		h &= 15
		const u = h < 8 ? x : y
		const v = h < 4 ? y : h === 12 || h === 14 ? x : z
		return (h & 1 ? -u : u) + (h & 2 ? -v : v)
	}
	function noise3(x, y, z) {
		let X = Math.floor(x)
		let Y = Math.floor(y)
		let Z = Math.floor(z)
		x -= X
		y -= Y
		z -= Z
		X &= 255
		Y &= 255
		Z &= 255
		const u = fade(x)
		const v = fade(y)
		const w = fade(z)
		const A = PERM[X] + Y
		const AA = PERM[A] + Z
		const AB = PERM[A + 1] + Z
		const B = PERM[X + 1] + Y
		const BA = PERM[B] + Z
		const BB = PERM[B + 1] + Z
		return lerp(w,
			lerp(v, lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)), lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z))),
			lerp(v, lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)), lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1))))
	}
	function fbm(x, y, z, oct = 5) {
		let s = 0
		let a = 0.5
		let f = 1
		for (let i = 0; i < oct; i++) {
			s += a * noise3(x * f, y * f, z * f)
			f *= 2.03
			a *= 0.5
		}
		return s * 1.8
	}

	// ---------------------------------------------------------------- equirect baking: fn(d = [x, y, z] the pixel's direction, lat) -> [r, g, b, a?]
	function bake(W, H, fn) {
		const out = new Uint8ClampedArray(W * H * 4)
		const d = [0, 0, 0]
		for (let y = 0; y < H; y++) {
			const th = ((y + 0.5) / H) * PI
			const st = Math.sin(th)
			const ct = Math.cos(th)
			const lat = PI / 2 - th
			for (let x = 0; x < W; x++) {
				const ph = ((x + 0.5) / W) * TAU
				d[0] = -Math.cos(ph) * st
				d[1] = ct
				d[2] = Math.sin(ph) * st
				const c = fn(d, lat, ph)
				const i = (y * W + x) * 4
				out[i] = c[0]
				out[i + 1] = c[1]
				out[i + 2] = c[2]
				out[i + 3] = c.length > 3 ? c[3] : 255
			}
		}
		return out
	}
	function texture(data, W, H, { wrapT = THREE.ClampToEdgeWrapping, srgb = true } = {}) {
		const c = document.createElement("canvas")
		c.width = W
		c.height = H
		c.getContext("2d").putImageData(new ImageData(data, W, H), 0, 0)
		const t = new THREE.CanvasTexture(c)
		if (srgb) t.colorSpace = THREE.SRGBColorSpace
		t.wrapS = THREE.RepeatWrapping
		t.wrapT = wrapT
		t.anisotropy = 8
		return t
	}
	/** Craters: n rim-and-floor rings at seeded places on the sphere; returns f(d) -> {floor: 0..1, rim: 0..1}. */
	function craters(seed, n, rmin, rmax) {
		const r = rng(seed)
		const list = []
		for (let i = 0; i < n; i++) {
			const z = r() * 2 - 1
			const a = r() * TAU
			const s = Math.sqrt(1 - z * z)
			const size = rmin * Math.pow(rmax / rmin, r() ** 2.2)
			list.push([s * Math.cos(a), z, s * Math.sin(a), size, Math.cos(size * 1.4)])
		}
		return (d) => {
			let floor = 0
			let rim = 0
			for (const [cx, cy, cz, size, cosr] of list) {
				const dot = d[0] * cx + d[1] * cy + d[2] * cz
				if (dot < cosr) continue
				const ang = Math.acos(clamp(dot, -1, 1)) / size
				if (ang < 1) floor = Math.max(floor, 1 - ang * ang * 0.6)
				rim = Math.max(rim, Math.exp(-((ang - 1) * (ang - 1)) / 0.02))
			}
			return { floor, rim }
		}
	}

	// ---------------------------------------------------------------- the bodies' surfaces
	const W = 512
	const H = 256
	const SURF = {
		sun: (d) => {
			const g = fbm(d[0] * 18, d[1] * 18, d[2] * 18, 3)
			const b = fbm(d[0] * 3, d[1] * 3, d[2] * 3, 3)
			const c = mix3([255, 236, 160], [255, 176, 52], clamp(0.45 + g * 0.6 + b * 0.25))
			return c
		},
		earth: (d, lat) => {
			const n = fbm(d[0] * 2.1 + 3.1, d[1] * 2.1, d[2] * 2.1 - 1.7, 6) + 0.12 * Math.cos(lat * 3)
			const ice = Math.abs(lat) > 1.2 + 0.08 * fbm(d[0] * 5, d[1] * 5, d[2] * 5, 3)
			if (ice) return [236, 242, 246]
			if (n < 0.05) {
				const deep = smooth(-0.6, 0.05, n)
				return mix3([12, 42, 98], [34, 92, 160], deep)
			}
			const dry = smooth(0.15, 0.55, fbm(d[0] * 3 - 5, d[1] * 3, d[2] * 3, 4) + 0.9 * (1 - Math.abs(Math.abs(lat) - 0.42) * 3))
			const hi = smooth(0.35, 0.8, n)
			return mix3(mix3([58, 104, 44], [158, 132, 84], dry), [118, 108, 92], hi * 0.5)
		},
		clouds: (d) => {
			const n = fbm(d[0] * 3.3 + 9, d[1] * 6.2, d[2] * 3.3, 6)
			const a = smooth(0.08, 0.6, n)
			return [255, 255, 255, Math.round(a * 230)]
		},
		moon: (d) => {
			const mare = smooth(0.1, 0.45, fbm(d[0] * 1.6 + 2, d[1] * 1.6, d[2] * 1.6 + 1, 4) + (d[2] > 0 ? 0.15 : -0.1))
			const cr = MOON_CRATERS(d)
			const g = 150 - 62 * mare + 14 * fbm(d[0] * 22, d[1] * 22, d[2] * 22, 3) - 30 * cr.floor * 0.4 + 40 * cr.rim
			return [g, g * 0.985, g * 0.95]
		},
		mercury: (d) => {
			const cr = MERCURY_CRATERS(d)
			const g = 128 + 18 * fbm(d[0] * 6, d[1] * 6, d[2] * 6, 4) - 22 * cr.floor * 0.5 + 45 * cr.rim
			return [g * 1.05, g * 0.98, g * 0.9]
		},
		venus: (d) => {
			const s = fbm(d[0] * 2 + fbm(d[0] * 4, d[1] * 4, d[2] * 4, 3), d[1] * 7, d[2] * 2, 5)
			return mix3([214, 176, 108], [244, 222, 166], clamp(0.5 + s * 0.7))
		},
		mars: (d, lat) => {
			if (Math.abs(lat) > 1.33 + 0.05 * fbm(d[0] * 6, d[1] * 6, d[2] * 6, 3)) return [238, 234, 228]
			const n = fbm(d[0] * 2.4 + 7, d[1] * 2.4, d[2] * 2.4, 6)
			const dark = smooth(0.05, 0.45, n)
			return mix3(mix3([206, 112, 62], [170, 82, 46], clamp(0.5 + fbm(d[0] * 9, d[1] * 9, d[2] * 9, 3))), [104, 60, 40], dark * 0.7)
		},
		jupiter: (d, lat, ph) => {
			const turb = fbm(d[0] * 3, d[1] * 9, d[2] * 3, 5) * 0.18
			const band = Math.sin((lat + turb) * 15)
			const pal = band > 0.3 ? [232, 214, 186] : band > -0.3 ? [196, 154, 108] : [158, 108, 74]
			let c = mix3(pal, [240, 228, 210], clamp(0.25 + fbm(d[0] * 14, d[1] * 30, d[2] * 14, 3) * 0.4))
			// the Great Red Spot, 22° south
			const dl = (lat + 0.384) / 0.075
			const dp = (((ph - 2.2 + PI) % TAU) + TAU) % TAU - PI
			const e = dl * dl + (dp / 0.16) ** 2
			if (e < 1) c = mix3(c, [186, 92, 60], smooth(1, 0.35, e))
			return c
		},
		saturn: (d, lat) => {
			const band = Math.sin((lat + fbm(d[0] * 3, d[1] * 8, d[2] * 3, 4) * 0.06) * 13)
			return mix3([228, 206, 152], [196, 166, 110], clamp(0.5 + band * 0.35))
		},
		uranus: (d, lat) => mix3([166, 216, 222], [190, 230, 232], clamp(0.5 + Math.sin(lat * 6) * 0.15 + fbm(d[0] * 4, d[1] * 4, d[2] * 4, 3) * 0.08)),
		neptune: (d, lat) => {
			const band = Math.sin(lat * 9 + fbm(d[0] * 3, d[1] * 6, d[2] * 3, 4) * 0.4)
			return mix3([46, 78, 196], [92, 132, 230], clamp(0.5 + band * 0.3))
		},
		pluto: (d) => {
			// Sputnik Planitia, the bright "heart", on the side that faces the camera; a dark belt at the equator
			const heart = smooth(0.62, 0.8, d[2] * 0.8 - d[1] * 0.25 + 0.15 * fbm(d[0] * 4, d[1] * 4, d[2] * 4, 3))
			const dark = smooth(0.25, 0.0, Math.abs(d[1] + 0.1)) * smooth(0.0, 0.4, -d[0])
			const base = mix3([196, 170, 140], [150, 120, 96], clamp(0.5 + fbm(d[0] * 5, d[1] * 5, d[2] * 5, 4)))
			return mix3(mix3(base, [98, 66, 52], dark * 0.8), [240, 230, 214], heart)
		},
		io: (d) => {
			const s = fbm(d[0] * 5, d[1] * 5, d[2] * 5, 5)
			const spot = smooth(0.45, 0.65, fbm(d[0] * 9 + 4, d[1] * 9, d[2] * 9, 3))
			return mix3(mix3([226, 204, 84], [200, 140, 60], clamp(0.5 + s)), [40, 30, 26], spot * 0.8)
		},
		europa: (d) => {
			const line = Math.abs(fbm(d[0] * 4, d[1] * 4, d[2] * 4, 5))
			const l = smooth(0.06, 0.0, line)
			return mix3(mix3([222, 214, 196], [206, 190, 166], clamp(0.5 + fbm(d[0] * 8, d[1] * 8, d[2] * 8, 3))), [150, 96, 66], l * 0.8)
		},
		ganymede: (d) => mix3([150, 138, 122], [96, 86, 76], smooth(0.0, 0.4, fbm(d[0] * 3, d[1] * 3, d[2] * 3, 5))),
		callisto: (d) => {
			const cr = CALLISTO_CRATERS(d)
			const g = 84 + 14 * fbm(d[0] * 8, d[1] * 8, d[2] * 8, 4) + 120 * cr.rim
			return [g, g * 0.92, g * 0.82]
		},
		titan: (d, lat) => mix3([214, 158, 76], [180, 124, 58], clamp(0.5 + Math.sin(lat * 3) * 0.2 + fbm(d[0] * 3, d[1] * 3, d[2] * 3, 3) * 0.15)),
		phobos: (d) => {
			const cr = MERCURY_CRATERS(d)
			const g = 98 + 16 * fbm(d[0] * 7, d[1] * 7, d[2] * 7, 4) + 34 * cr.rim
			return [g, g * 0.93, g * 0.86]
		}
	}
	SURF.deimos = SURF.phobos
	const MOON_CRATERS = craters(11, 160, 0.03, 0.28)
	const MERCURY_CRATERS = craters(23, 220, 0.025, 0.24)
	const CALLISTO_CRATERS = craters(37, 260, 0.015, 0.09)
	// real rotation periods (sidereal, hours; negative: retrograde) [NASA-PFS]; moons turn once an orbit (tidally locked)
	const SPIN_H = { sun: 609.12, mercury: 1407.6, venus: -5832.5, earth: 23.9345, moon: 655.72, mars: 24.6229, jupiter: 9.925, saturn: 10.656, uranus: -17.24, neptune: 16.11, pluto: -153.29, io: 42.46, europa: 85.23, ganymede: 171.71, callisto: 400.54, titan: 382.68, phobos: 7.66, deimos: 30.35 }
	const surfaceTex = (key) => {
		const k = SURF[key] ? key : "moon"
		const data = memo(`surf|${k}`, () => bake(W, H, SURF[k]))
		return texCache(`surf|${k}`, () => texture(data, W, H))
	}
	const texes = new Map()
	const texCache = (k, make) => {
		let t = texes.get(k)
		if (!t) {
			t = make()
			texes.set(k, t)
		}
		return t
	}
	const mats = new Map()
	const matCache = (k, make) => {
		let m = mats.get(k)
		if (!m) {
			m = make()
			mats.set(k, m)
		}
		return m
	}

	// ---------------------------------------------------------------- the Sun
	const glowTex = () =>
		texCache("glow", () => {
			const c = document.createElement("canvas")
			c.width = c.height = 256
			const g = c.getContext("2d")
			const grd = g.createRadialGradient(128, 128, 24, 128, 128, 128)
			grd.addColorStop(0, "rgba(255,214,120,0.9)")
			grd.addColorStop(0.3, "rgba(255,170,60,0.42)")
			grd.addColorStop(0.6, "rgba(255,130,30,0.12)")
			grd.addColorStop(1, "rgba(255,110,20,0)")
			g.fillStyle = grd
			g.fillRect(0, 0, 256, 256)
			const t = new THREE.CanvasTexture(c)
			t.colorSpace = THREE.SRGBColorSpace
			return t
		})
	addModel("sun", "body", (ctx) => {
		const r = ctx.r
		const mat = matCache("sun", () => {
			// its own light: not tone-mapped (a vivid yellow-orange), darker toward the limb as the real Sun's is (limb darkening)
			const m = new THREE.MeshBasicMaterial({ map: surfaceTex("sun"), toneMapped: false })
			m.onBeforeCompile = (sh) => {
				sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vLimb;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLimb = normalize( normalMatrix * normal ).z;")
				sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vLimb;").replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= 0.5 + 0.5 * sqrt( max( vLimb, 0.0 ) );")
			}
			m.customProgramCacheKey = () => "space-sun-limb"
			return m
		})
		const ball = new THREE.Mesh(kit.geo(`sphere|${r.toFixed(5)}`, () => new THREE.SphereGeometry(r, 96, 48)), mat)
		ball.castShadow = false
		ball.receiveShadow = false
		// (its corona is the view plug-in's: a sprite here would show in the catalog's photos as a streak)
		const g = kit.group(ball)
		g.userData.spinBody = ball
		const sps = ctx.props?.s_per_s
		const rps = sps ? sps / (SPIN_H.sun * 3600) : 0
		if (rps > 0.002 && rps < 0.3) ball.userData.spin = { axis: "y", rps }
		return g
	})

	// ---------------------------------------------------------------- planets and moons
	const TILT = (25 * PI) / 180 // the pole leans toward the camera: the globe's face shows in a view from above the orbits
	const ringTex = () =>
		texCache("rings", () => {
			const c = document.createElement("canvas")
			c.width = 512
			c.height = 4
			const g = c.getContext("2d")
			for (let x = 0; x < 512; x++) {
				const u = x / 511 // inner (1.24 R) to outer (2.27 R)
				const R = 1.24 + u * 1.03
				let a = 0.55 + 0.35 * Math.sin(R * 60) * Math.sin(R * 13)
				if (R > 1.95 && R < 2.02) a = 0.05 // the Cassini division
				if (R < 1.52) a *= 0.35 // the faint C ring
				const k = 0.8 + 0.2 * Math.sin(R * 31)
				g.fillStyle = `rgba(${Math.round(218 * k)},${Math.round(196 * k)},${Math.round(150 * k)},${clamp(a).toFixed(3)})`
				g.fillRect(x, 0, 1, 4)
			}
			const t = new THREE.CanvasTexture(c)
			t.colorSpace = THREE.SRGBColorSpace
			return t
		})
	function globe(ctx, key) {
		const r = ctx.r
		const mat = matCache(`globe|${key}`, () => new THREE.MeshStandardMaterial({ map: surfaceTex(key), roughness: 0.92, metalness: 0 }))
		const ball = new THREE.Mesh(kit.geo(`sphere|${r.toFixed(5)}`, () => new THREE.SphereGeometry(r, 96, 48)), mat)
		const tilt = new THREE.Group()
		const ax = ctx.props?.season_axis
		if (Array.isArray(ax) && ax.length === 3 && ax.every(Number.isFinite)) {
			// (seasons: its real axis, fixed in space, from the start date and the Sun's side: the machine plane is the orbit's plane, z its pole)
			tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax[0], ax[1], ax[2]).normalize())
		} else tilt.rotation.x = TILT
		tilt.add(ball)
		// a tilted moon: lifted off the plane by its height (real km × the drawn-larger factor); red-brown in a total lunar eclipse (the Earth's
		// air bends the red of sunlight into its shadow) and dimmed in a partial one
		const lift = ctx.props?.lift_per_km
		if (Number.isFinite(lift) && lift > 0) {
			tilt.userData.frame = { hook: "space:lift", lift, scaled: false }
			ball.userData.frame = { hook: "space:eclipse-tint", scaled: false }
		}
		const sps = ctx.props?.s_per_s
		const hours = SPIN_H[key]
		const rps = sps && hours ? sps / (hours * 3600) : 0
		if (Math.abs(rps) > 0.002 && Math.abs(rps) < 0.3) ball.userData.spin = { axis: "y", rps }
		if (key === "earth") {
			const cloudMat = matCache("clouds", () => {
				const data = memo("surf|clouds", () => bake(W, H, SURF.clouds))
				return new THREE.MeshStandardMaterial({ map: texCache("clouds", () => texture(data, W, H)), transparent: true, depthWrite: false, roughness: 1 })
			})
			const clouds = new THREE.Mesh(kit.geo(`sphere|${(r * 1.012).toFixed(5)}`, () => new THREE.SphereGeometry(r * 1.012, 96, 48)), cloudMat)
			clouds.castShadow = false
			ball.add(clouds)
		}
		if (key === "saturn") {
			const ring = new THREE.Mesh(
				kit.geo(`rings|${r.toFixed(5)}`, () => {
					const g = new THREE.RingGeometry(r * 1.24, r * 2.27, 128, 1)
					// (u along the radius: the texture's x runs inner to outer)
					const p = g.attributes.position
					const uv = g.attributes.uv
					for (let i = 0; i < p.count; i++) {
						const rr = Math.hypot(p.getX(i), p.getY(i))
						uv.setXY(i, (rr / r - 1.24) / 1.03, 0.5)
					}
					return g.rotateX(-PI / 2)
				}),
				matCache("ringmat", () => new THREE.MeshStandardMaterial({ map: ringTex(), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9 }))
			)
			ring.rotation.z = (26.7 - 25) * (PI / 180) // (Saturn's own tilt, nearly the same as the view's lean)
			tilt.add(ring)
		}
		return kit.group(tilt)
	}
	addModel("planet", "body", (ctx) => globe(ctx, ctx.props?.body ?? "earth"))
	addModel("moon", "body", (ctx) => globe(ctx, ctx.props?.body ?? "moon"))

	// ---------------------------------------------------------------- satellites
	const foilTex = () =>
		texCache("foil", () => {
			const data = memo("foil", () => {
				const w = 128
				const out = new Uint8ClampedArray(w * w * 4)
				for (let y = 0; y < w; y++)
					for (let x = 0; x < w; x++) {
						const n = fbm(x * 0.09, y * 0.09, 3.3, 4)
						const i = (y * w + x) * 4
						const k = 0.75 + 0.35 * n
						out[i] = 236 * k
						out[i + 1] = 182 * k
						out[i + 2] = 72 * k
						out[i + 3] = 255
					}
				return out
			})
			return texture(data, 128, 128, { wrapT: THREE.RepeatWrapping })
		})
	const cellTex = () =>
		texCache("cells", () => {
			const c = document.createElement("canvas")
			c.width = 256
			c.height = 128
			const g = c.getContext("2d")
			g.fillStyle = "#0d1b3d"
			g.fillRect(0, 0, 256, 128)
			for (let i = 0; i < 16; i++)
				for (let j = 0; j < 8; j++) {
					g.fillStyle = (i + j) % 2 ? "#1d3b7a" : "#1a356d"
					g.fillRect(i * 16 + 1, j * 16 + 1, 14, 14)
				}
			g.strokeStyle = "#c7ccd4"
			g.lineWidth = 2
			g.strokeRect(1, 1, 254, 126)
			const t = new THREE.CanvasTexture(c)
			t.colorSpace = THREE.SRGBColorSpace
			return t
		})
	const foil = () => matCache("foilmat", () => new THREE.MeshStandardMaterial({ map: foilTex(), metalness: 0.85, roughness: 0.32 }))
	const panel = () => matCache("panelmat", () => new THREE.MeshStandardMaterial({ map: cellTex(), metalness: 0.3, roughness: 0.35 }))
	const white = () => kit.mat("space-white", { color: "#e9ebee", roughness: 0.5, metalness: 0.1 })
	const steel = () => kit.mat("space-steel", { color: "#a9b0b8", roughness: 0.3, metalness: 0.9 })
	addModel("satellite", "body", (ctx) => {
		const kind = ctx.props?.kind ?? "satellite"
		if (kind === "cannonball") {
			const m = kit.mat("cast-iron", { color: "#2e2f31", roughness: 0.62, metalness: 0.75 })
			return kit.mesh(kit.geo(`sphere|${ctx.r.toFixed(5)}`, () => new THREE.SphereGeometry(ctx.r, 48, 24)), m)
		}
		const w = ctx.w
		const h = ctx.h
		const d = ctx.d
		const g = kit.group()
		if (kind === "space-station") {
			g.add(kit.mesh(kit.box(w, h * 0.12, d * 0.12, 0.0004), steel())) // the truss
			for (const sx of [-1, 1])
				for (const sy of [-1, 1]) {
					const p = kit.mesh(kit.box(w * 0.2, h * 0.42, d * 0.03, 0.0002), panel())
					p.position.set(sx * w * 0.36, sy * h * 0.28, 0)
					g.add(p)
				}
			const mod = kit.mesh(kit.cylinderY(h * 0.16, w * 0.42, 24), white())
			mod.rotation.z = PI / 2
			g.add(mod)
			const node = kit.mesh(kit.cylinderY(h * 0.2, h * 0.3, 24), white())
			g.add(node)
			return g
		}
		const bw = kind === "probe" ? w * 0.5 : w * 0.32
		const bus = kit.mesh(kit.box(bw, h * 0.92, d * 0.9, 0.0006), foil())
		g.add(bus)
		if (kind === "probe") {
			const dish = kit.mesh(kit.lathe([[0, 0], [w * 0.22, h * 0.12], [w * 0.25, h * 0.14]], 32, `dish|${w.toFixed(4)}|${h.toFixed(4)}`), white())
			dish.position.y = h * 0.36
			dish.scale.set(1, 1, Math.min(1, (d * 0.48) / (w * 0.25)))
			g.add(dish)
			const boom = kit.mesh(kit.box(w * 0.46, h * 0.05, d * 0.05, 0.0002), steel())
			boom.position.x = -w * 0.25
			g.add(boom)
			return g
		}
		for (const sx of [-1, 1]) {
			const wing = kit.mesh(kit.box((w - bw) / 2 - w * 0.03, h * 0.9, d * 0.06, 0.0002), panel())
			wing.position.x = sx * (bw / 2 + w * 0.03 + ((w - bw) / 2 - w * 0.03) / 2)
			g.add(wing)
			const arm = kit.mesh(kit.box(w * 0.04, h * 0.08, d * 0.08, 0.0002), steel())
			arm.position.x = sx * (bw / 2 + w * 0.015)
			g.add(arm)
		}
		const dish = kit.mesh(kit.lathe([[0, 0], [bw * 0.38, h * 0.06], [bw * 0.42, h * 0.07]], 32, `sdish|${bw.toFixed(4)}|${h.toFixed(4)}`), white())
		dish.rotation.x = PI / 2
		dish.position.z = d * 0.45
		dish.scale.set(1, 1, 1)
		g.add(dish)
		return g
	})

	// ---------------------------------------------------------------- the hammer
	addModel("rock-hammer", "handle", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const d = ctx.d
		const shaft = kit.mesh(kit.box(w, h * 0.72, d * 0.78, h * 0.2), steel())
		const grip = kit.mesh(kit.box(w * 0.48, h, d, h * 0.45), kit.mat("hammer-grip", { color: "#1f4fa3", roughness: 0.75, metalness: 0 }))
		grip.position.x = -w * 0.26
		return kit.group(shaft, grip)
	})
	addModel("rock-hammer", "head", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const d = ctx.d
		// side profile: the square striking face on top, the pick tapering to a point below
		const pts = [[-w / 2, h * 0.5], [w / 2, h * 0.5], [w / 2, h * 0.18], [w * 0.34, -h * 0.05], [w * 0.06, -h * 0.5], [-w * 0.06, -h * 0.5], [-w * 0.34, -h * 0.05], [-w / 2, h * 0.18]]
		return kit.mesh(kit.extrude(pts, d, { bevel: Math.min(0.0015, w * 0.05), key: `hammerhead|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}` }), kit.mat("hammer-steel", { color: "#8d949b", roughness: 0.38, metalness: 0.92 }))
	})

	// ---------------------------------------------------------------- the shadow stick: a dowel, its shadow drawn where the real Sun puts it
	// (the room's lamp would throw its own shadow of the stick: the stick casts none, and its true shadow is drawn on the ground from the run's
	// readings: shadow_m and shadow_dir, the bearing from north; the machine plane runs east-west, east to the right, north into the picture)
	const compassTex = () =>
		texCache("compass", () => {
			const c = document.createElement("canvas")
			c.width = c.height = 512
			const g = c.getContext("2d")
			g.clearRect(0, 0, 512, 512)
			g.strokeStyle = "rgba(40,40,40,0.55)"
			g.lineWidth = 4
			g.beginPath()
			g.arc(256, 256, 236, 0, TAU)
			g.stroke()
			g.fillStyle = "rgba(30,30,30,0.75)"
			g.font = "700 64px system-ui, sans-serif"
			g.textAlign = "center"
			g.textBaseline = "middle"
			// (seen from above: north up the canvas maps to −z, into the picture; east to +x)
			g.fillText("N", 256, 54)
			g.fillText("S", 256, 458)
			g.fillText("E", 458, 256)
			g.fillText("W", 54, 256)
			const t = new THREE.CanvasTexture(c)
			t.colorSpace = THREE.SRGBColorSpace
			return t
		})
	addFrameHook("space:shadow", (obj, f) => {
		const L = f.state?.shadow_m ?? 0
		const dir = f.state?.shadow_dir ?? 0
		obj.visible = L > 0.001
		if (!obj.visible) return
		obj.scale.set(1, 1, Math.max(0.001, L))
		obj.rotation.y = PI - (dir * PI) / 180
	})
	addFrameHook("space:sun-marker", (obj, f, args) => {
		const e = ((f.state?.sun_elevation ?? -1) * PI) / 180
		const a = ((f.state?.sun_azimuth ?? 0) * PI) / 180
		obj.visible = e > 0
		if (!obj.visible) return
		const R = args.reach
		obj.position.set(Math.sin(a) * Math.cos(e) * R, args.foot + Math.sin(e) * R, -Math.cos(a) * Math.cos(e) * R)
	})
	addModel("gnomon", "stick", (ctx) => {
		const w = ctx.w
		const h = ctx.h
		const wood = kit.mat("gnomon-wood", { color: "#c9a26b", roughness: 0.55, metalness: 0 })
		const stick = kit.mesh(kit.cylinderY(w / 2, h, 24), wood, { cast: false })
		stick.castShadow = false
		const tip = kit.mesh(kit.geo(`gtip|${w.toFixed(5)}`, () => new THREE.SphereGeometry(w * 0.55, 16, 8)), kit.mat("gnomon-tip", { color: "#c0392b", roughness: 0.4, metalness: 0 }), { cast: false })
		tip.position.y = h / 2
		tip.castShadow = false
		const foot = -h / 2 + 0.0012
		// the compass on the ground round its foot
		const rose = new THREE.Mesh(kit.geo(`rose|${h.toFixed(4)}`, () => new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2)), matCache("rose", () => new THREE.MeshBasicMaterial({ map: compassTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })))
		const rr = Math.max(0.12, Math.min(0.6, h * 0.35))
		rose.scale.set(rr * 2, 1, rr * 2)
		rose.position.y = foot
		rose.castShadow = false
		rose.receiveShadow = false
		// the Sun's shadow: a dark strip from the foot, unit length along +z, stretched and turned every frame
		const sg = kit.geo(`gshadow|${w.toFixed(5)}`, () => {
			const g = new THREE.PlaneGeometry(w * 1.15, 1, 1, 1).rotateX(-PI / 2)
			g.translate(0, 0, 0.5)
			return g
		})
		const shadow = new THREE.Mesh(sg, matCache("gshadowmat", () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })))
		shadow.position.y = foot + 0.0004
		shadow.castShadow = false
		shadow.receiveShadow = false
		shadow.userData.frame = { hook: "space:shadow", scaled: false }
		shadow.visible = false // (shown by its hook, from the run's readings; never in a catalog photo)
		// the Sun itself, small, in its direction from the stick's foot (it rises in the east, on the right, and sets in the west)
		const sun = new THREE.Sprite(matCache("gsun", () => new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })))
		const reach = Math.max(0.5, h * 1.4)
		sun.scale.set(reach * 0.13, reach * 0.13, 1)
		sun.userData.frame = { hook: "space:sun-marker", reach, foot: -h / 2, scaled: false }
		sun.visible = false
		const disc = new THREE.Mesh(kit.geo(`gsund|${reach.toFixed(3)}`, () => new THREE.SphereGeometry(reach * 0.035, 20, 10)), matCache("gsundisc", () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.4), toneMapped: false })))
		disc.castShadow = false
		sun.add(disc)
		return kit.group(stick, tip, rose, shadow, sun)
	})

	addFrameHook("space:lift", (obj, f, a) => {
		const h = f.state?.height_km
		obj.position.z = Number.isFinite(h) ? h * a.lift : 0
	})
	addFrameHook("space:eclipse-tint", (obj, f) => {
		const L = f.state?.lunar_eclipse ?? 0
		if (!(L >= 2) && !obj.userData._tinted) return
		const m = ownMaterial(obj)
		if (!m) return
		obj.userData._tinted = true
		// (in the umbra the Sun's direct light is gone: what reaches the Moon is sunlight bent through the Earth's air, red, a few
		// thousandths as bright: a faint copper glow of its own, so it stays visible against the sky)
		if (L >= 3) {
			m.color.setRGB(0.62, 0.26, 0.16)
			m.emissive?.setRGB(0.16, 0.045, 0.02)
		} else if (L >= 2) {
			m.color.setRGB(0.75, 0.62, 0.58)
			m.emissive?.setRGB(0.05, 0.015, 0.008)
		} else {
			m.color.setRGB(1, 1, 1)
			m.emissive?.setRGB(0, 0, 0)
		}
		if (m.emissiveMap === null && m.map) m.emissiveMap = m.map
	})

	// ---------------------------------------------------------------- classroom models: a globe under a lamp, a moon ball on a stick
	const V = (x, y, z) => new THREE.Vector3(x, y, z)
	const D2R = PI / 180
	/** A material whose night half (seen from where the light is) is dark: uniforms uS (the unit vector toward the light, world), uCap (cos of
	 *  the lit cap's edge: R/D for a near point light, 0 in parallel light), uDark (what the night keeps of the room's light). Its own copy. */
	function nightMaterial(base) {
		const m = base.clone()
		const u = { uS: { value: V(-1, 0, 0) }, uCap: { value: 0 }, uDark: { value: 0.22 } }
		m.userData.night = u
		m.onBeforeCompile = (sh) => {
			Object.assign(sh.uniforms, u)
			sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vNightN;").replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvNightN = normalize( mat3( modelMatrix ) * objectNormal );")
			sh.fragmentShader = sh.fragmentShader
				.replace("#include <common>", "#include <common>\nvarying vec3 vNightN;\nuniform vec3 uS;\nuniform float uCap;\nuniform float uDark;")
				.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n{ float d = dot( normalize( vNightN ), uS ) - uCap; gl_FragColor.rgb *= mix( uDark, 1.0, smoothstep( -0.035, 0.05, d ) ); }")
		}
		m.customProgramCacheKey = () => "space-night"
		return m
	}
	/** The night shading of a mesh (made its own on first use): light toward s from the centre c, a point light at distance d (or parallel). */
	function setNight(mesh, s, cap) {
		if (!mesh.userData._night) {
			mesh.material = nightMaterial(mesh.material)
			mesh.userData._night = true
		}
		const u = mesh.material.userData.night
		u.uS.value.copy(s)
		u.uCap.value = cap
	}
	/** Where the light is from c: {s (unit), d (m, Infinity parallel)} from a resolved props' `light` ({x, y} or {dx, dy, parallel}). */
	const lightFrom = (light, c) => {
		if (!light) return { s: V(-1, 0, 0), d: Infinity }
		if (light.parallel) return { s: V(light.dx, light.dy, 0).normalize(), d: Infinity }
		const v = V(light.x - c.x, light.y - c.y, -c.z)
		const d = v.length()
		return { s: d > 0 ? v.divideScalar(d) : V(-1, 0, 0), d }
	}
	const LEAN = { right: [1, 0], left: [-1, 0], "toward the camera": [0, 1], "away from the camera": [0, -1] }
	/** A globe's axis and reference meridian at the start (tooling/src/sim/space.ts globeAxis, globeMeridian: the engine's own, here in plain floats). */
	function globeFrame(props, c) {
		const { s } = lightFrom(props?.light, c)
		const lean = props?.lean ?? "toward the camera"
		let h = LEAN[lean] ?? [0, 1]
		if (lean === "toward the light" || lean === "away from the light") {
			const l = Math.hypot(s.x, s.z)
			const sg = lean === "toward the light" ? 1 : -1
			h = l > 1e-9 ? [(sg * s.x) / l, (sg * s.z) / l] : [0, 1]
		}
		const t = (props?.tilt_deg ?? 23.44) * D2R
		const a = V(Math.sin(t) * h[0], Math.cos(t), Math.sin(t) * h[1])
		const k = a.dot(s)
		let e1 = s.clone().addScaledVector(a, -k)
		if (e1.length() < 1e-9) e1 = V(1, 0, 0).cross(a).cross(a)
		e1.normalize()
		return { a, e1 }
	}
	const woodTex = () =>
		texCache("dowel", () => {
			const data = memo("dowel", () => {
				const w = 64
				const out = new Uint8ClampedArray(w * 256 * 4)
				for (let y = 0; y < 256; y++)
					for (let x = 0; x < w; x++) {
						const g = 0.82 + 0.12 * Math.sin(y * 0.21 + 3 * fbm(x * 0.05, y * 0.01, 1.7, 3)) + 0.06 * fbm(x * 0.2, y * 0.2, 4.1, 2)
						const i = (y * w + x) * 4
						out[i] = 214 * g
						out[i + 1] = 172 * g
						out[i + 2] = 118 * g
						out[i + 3] = 255
					}
				return out
			})
			return texture(data, 64, 256, { wrapT: THREE.RepeatWrapping })
		})
	const brass = () => kit.mat("globe-brass", { color: "#c9a14a", roughness: 0.28, metalness: 0.95 })
	const chrome = () => kit.mat("globe-chrome", { color: "#d8dde2", roughness: 0.18, metalness: 1.0 })
	addModel("globe", "base", (ctx) => {
		// a round weighted base (walnut-dark, a felt underside): Ø 18 cm, its height the base slab's
		const h = ctx.h
		const g = kit.group()
		const disc = kit.mesh(kit.lathe([[0, -h / 2], [0.088, -h / 2], [0.09, -h / 2 + 0.004], [0.086, h / 2 - 0.004], [0.07, h / 2], [0, h / 2]], 64, `globebase|${h.toFixed(4)}`), kit.mat("globe-base", { color: "#2e2219", roughness: 0.42, metalness: 0.05 }))
		g.add(disc)
		const collar = kit.mesh(kit.cylinderY(0.016, 0.012, 32), chrome())
		collar.position.y = h / 2 + 0.006
		g.add(collar)
		return g
	})
	addModel("globe", "ball", (ctx) => {
		const R = ctx.r
		const P = ctx.props ?? {}
		const sh = P.stand_height ?? 0.25
		const c = { x: ctx.solid?.at?.x ?? 0, y: ctx.solid?.at?.y ?? 0, z: 0 }
		const { a, e1 } = globeFrame(P, c)
		const root = kit.group()
		// the post, from the base's collar up to a cradle under the ball (it does not turn)
		const post = kit.mesh(kit.cylinderY(0.0055, Math.max(0.005, sh - 0.03), 20), chrome())
		post.position.y = -R - sh + 0.025 + 0.012 + Math.max(0.005, sh - 0.03) / 2
		root.add(post)
		// the half meridian, a brass arc round the far side of the ball, holding its axis pins; turned with the axis (not with the spin)
		const hold = new THREE.Group()
		hold.quaternion.setFromUnitVectors(V(0, 1, 0), a)
		const arc = new THREE.Mesh(kit.geo(`meridian|${R.toFixed(4)}`, () => new THREE.TorusGeometry(R * 1.07, Math.max(0.0025, R * 0.016), 10, 96, PI)), brass())
		arc.rotation.z = -PI / 2 // (from the north pin round the far side to the south pin)
		arc.rotation.y = PI / 2
		hold.add(arc)
		for (const sy of [-1, 1]) {
			const pin = kit.mesh(kit.cylinderY(R * 0.025, R * 0.12, 12), brass())
			pin.position.y = sy * R * 1.03
			hold.add(pin)
		}
		root.add(hold)
		// the ball: the Earth's map (oceans, land, ice: a physical globe's), varnished, turning about the axis; the town's red pin on it
		const map = matCache("globe|map", () => new THREE.MeshStandardMaterial({ map: surfaceTex("earth"), roughness: 0.38, metalness: 0 }))
		const spin = new THREE.Group()
		const ball = new THREE.Mesh(kit.geo(`sphere|${R.toFixed(5)}`, () => new THREE.SphereGeometry(R, 96, 48)), map)
		ball.userData.globeBall = true
		spin.add(ball)
		const lat = (P.town_lat ?? 30.27) * D2R
		const pin = new THREE.Group()
		const stalk = kit.mesh(kit.cylinderY(R * 0.012, R * 0.12, 10), kit.mat("globe-pin-steel", { color: "#b9bec4", roughness: 0.3, metalness: 0.9 }))
		stalk.position.y = R * 0.06
		const head = kit.mesh(kit.geo(`pinhead|${R.toFixed(4)}`, () => new THREE.SphereGeometry(R * 0.05, 18, 10)), kit.mat("globe-pin", { color: "#d62a2a", roughness: 0.35, metalness: 0 }))
		head.position.y = R * 0.13
		pin.add(stalk, head)
		pin.position.set(Math.cos(lat) * R, Math.sin(lat) * R, 0)
		pin.quaternion.setFromUnitVectors(V(0, 1, 0), V(Math.cos(lat), Math.sin(lat), 0))
		spin.add(pin)
		const psi0 = ((P.start_hour ?? 12) - 12) * 15
		spin.userData.frame = { hook: "space:globe", ax: a.x, ay: a.y, az: a.z, ex: e1.x, ey: e1.y, ez: e1.z, psi0, cx: c.x, cy: c.y, R, light: P.light ?? null, scaled: false }
		// (at rest, as the catalog shows it: turned to the town's start time)
		poseGlobe(spin, spin.userData.frame, 0)
		root.add(spin)
		return root
	})
	/** Turns a globe's ball: its local +y on the axis a, local +x on the town's meridian ψ east of the reference one. */
	function poseGlobe(spin, f, turns) {
		const a = V(f.ax, f.ay, f.az)
		const e1 = V(f.ex, f.ey, f.ez)
		const e2 = a.clone().cross(e1)
		const psi = (f.psi0 + 360 * turns) * D2R
		const m = e1.clone().multiplyScalar(Math.cos(psi)).addScaledVector(e2, Math.sin(psi))
		const z = m.clone().cross(a)
		spin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(m, a, z))
	}
	addFrameHook("space:globe", (obj, f, a) => {
		poseGlobe(obj, a, f.state?.turns ?? 0)
		const ball = obj.children.find((o) => o.userData.globeBall)
		if (!ball) return
		const { s, d } = lightFrom(a.light, { x: a.cx, y: a.cy, z: 0 })
		setNight(ball, s, Number.isFinite(d) && d > a.R ? a.R / d : 0)
	})
	/** Where a carried ball is (tooling/src/sim/space.ts carriedAt, in plain floats). */
	function carried(c, h, R, u, tilt, node) {
		const k = V(h.z, 0, -h.x)
		const O = node * D2R
		const n = h.clone().multiplyScalar(Math.cos(O)).addScaledVector(k, Math.sin(O))
		const w = h.clone().multiplyScalar(-Math.sin(O)).addScaledVector(k, Math.cos(O))
		const t = tilt * D2R
		const up = V(Math.cos(t) * w.x, Math.sin(t), Math.cos(t) * w.z)
		const q = (u - node) * D2R
		return c.clone().addScaledVector(n, R * Math.cos(q)).addScaledVector(up, R * Math.sin(q))
	}
	addModel("moon-ball", "ball", (ctx) => {
		const r = ctx.r
		const P = ctx.props ?? {}
		const root = kit.group()
		const g = new THREE.Group() // (the carried ball and its stick: its frame hook moves it; the root stays where the solid stands)
		const foam = matCache("moonball|foam", () => {
			const data = memo("foam", () => bake(256, 128, (d) => {
				const n = 236 + 10 * fbm(d[0] * 40, d[1] * 40, d[2] * 40, 2)
				return [n, n * 0.995, n * 0.975]
			}))
			return new THREE.MeshStandardMaterial({ map: texture(data, 256, 128), roughness: 0.96, metalness: 0 })
		})
		const ball = new THREE.Mesh(kit.geo(`sphere|${r.toFixed(5)}`, () => new THREE.SphereGeometry(r, 64, 32)), foam)
		ball.userData.moonBall = true
		g.add(ball)
		// the dowel it is held by, pushed into its underside (30 cm, 6 mm)
		const L = 0.3
		const stick = kit.mesh(kit.cylinderY(0.003, L, 14), matCache("moonball|dowel", () => new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.6, metalness: 0 })))
		stick.position.y = -r * 0.6 - L / 2
		g.add(stick)
		root.add(g)
		// (in a run the build hook gave it its circle's centre: carried there by its frame hook; a catalog photo has none: the ball and its stick
		// where the solid stands)
		if (!P.centre) return root
		const c = P.centre
		const { s } = lightFrom(P.light, { x: c.x, y: c.y, z: 0 })
		const hl = Math.hypot(s.x, s.z)
		const h = hl > 1e-9 ? { x: s.x / hl, z: s.z / hl } : { x: -1, z: 0 }
		g.userData.frame = {
			hook: "space:carry", cx: c.x, cy: c.y, hx: h.x, hz: h.z, R: P.radius ?? 0.6, start: P.start_deg ?? 0, period: P.period_s ?? 12, tilt: P.tilt_deg ?? 30,
			node: P.node_deg ?? 90, ox: ctx.solid?.at?.x ?? 0, oy: ctx.solid?.at?.y ?? 0, light: P.light ?? null, scaled: false
		}
		placeCarried(g, g.userData.frame, 0)
		// the whole circle it is carried round, as an unseen box the wide shot frames (the view frames what stands still where it stands)
		const a = g.userData.frame
		const lo = V(Infinity, Infinity, Infinity)
		const hi = V(-Infinity, -Infinity, -Infinity)
		const turn = a.period > 0 ? 360 : 0
		for (let k = 0; k <= 36; k++) {
			const p = carried(V(a.cx, a.cy, 0), V(a.hx, 0, a.hz), a.R, a.start + (turn * k) / 36, a.tilt, a.node)
			lo.min(V(p.x - r, p.y - r - 0.3, p.z - r))
			hi.max(V(p.x + r, p.y + r, p.z + r))
		}
		const size = hi.clone().sub(lo)
		const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)), matCache("moonball|frame", () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 })))
		box.position.set((lo.x + hi.x) / 2 - a.ox, (lo.y + hi.y) / 2 - a.oy, (lo.z + hi.z) / 2)
		box.castShadow = false
		box.receiveShadow = false
		// (on a layer of its own, 6, which no camera draws and the view's pick ray (layers 0, 2, 3, 4) never meets: a clone keeps its layers, not an
		// own raycast)
		box.layers.set(6)
		box.userData.frameOnly = true
		root.add(box)
		return root
	})
	function placeCarried(obj, a, t) {
		const u = a.start + (a.period > 0 ? (360 * t) / a.period : 0)
		const p = carried(V(a.cx, a.cy, 0), V(a.hx, 0, a.hz), a.R, u, a.tilt, a.node)
		obj.position.set(p.x - a.ox, p.y - a.oy, p.z)
		return p
	}
	addFrameHook("space:carry", (obj, f, a) => {
		const p = placeCarried(obj, a, f.t ?? 0)
		const ball = obj.children.find((o) => o.userData.moonBall)
		if (!ball) return
		const { s, d } = lightFrom(a.light, p)
		setNight(ball, s, 0)
		// (in the globe's shadow: the lamp's own shadow map darkens the lit part; a total eclipse leaves it dark grey)
		const L = f.state?.lunar_eclipse ?? 0
		ball.material.userData.night.uDark.value = 0.22
		if (Number.isFinite(d)) ball.material.color.setScalar(L >= 3 ? 0.35 : L >= 2 ? 0.7 : 1)
	})
	// a darker classroom for the globe and the moon ball, so the lamp's light shows the day and the night halves
	// (and beside it what the globe's middle sees of a moon ball: its phase, and the town's clock by the light, from the run's readings)
	const clockText = (h) => {
		if (!Number.isFinite(h)) return "?"
		const m = Math.round(h * 60) % 1440
		return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
	}
	addViewPlugin({
		name: "space:classroom",
		load(ctx) {
			const globes = ctx.itemsOfType("globe")
			const balls = ctx.itemsOfType("moon-ball")
			if (!globes.length && !balls.length) return null
			if ((ctx.doc.processes ?? []).some((p) => p.kind === "space-body")) return null // (orbit mode has its own sky)
			const { group, track } = ctx
			const frames = track?.frames ?? []
			const disposers = []
			const insets = []
			for (const id of balls) {
				const rec = (ctx.doc.processes ?? []).find((p) => p.kind === "moon-ball" && p.item === id)
				if (!rec || !track?.state?.[id]?.elongation) continue
				const c = ctx.resolved?.[id]?.centre ?? { x: 0, y: 0 }
				// (between the light and the globe, a little above its middle: inside the wide shot, clear of the carried circle's top)
				const inset = phaseInset(0.26)
				inset.sprite.position.set(c.x - (rec.radius ?? 0.6) - 0.12, c.y + 0.2, 0.05)
				group.add(inset.sprite)
				insets.push({ inset, id, who: rec.around ? "the globe" : "the middle" })
				disposers.push(inset.dispose)
			}
			const clocks = []
			for (const id of globes) {
				if (!track?.state?.[id]?.local_time) continue
				const ball = ctx.solidsOf(id).find((q) => q.part === "ball" || q.id === `${id}/ball`)
				if (!ball) continue
				const L = ctx.label({ text: "", height: 0.06 })
				L.sprite.position.set(ball.at.x, ball.at.y + ball.body.radius + 0.12, 0.05)
				group.add(L.sprite)
				const lat = ctx.resolved?.[id]?.town_lat ?? 30.27
				clocks.push({ L, id, lat })
			}
			const frame = (t) => {
				const k = frames.length ? frameIdx(frames, t) : 0
				for (const { inset, id, who } of insets) {
					const el = ctx.stateAt(id, "elongation", t) ?? 0
					const lit = ctx.stateAt(id, "lit", t) ?? 0
					const lu = track.state[id].lunar_eclipse?.[k] ?? 0
					const so = track.state[id].solar_eclipse?.[k] ?? 0
					inset.set(who.replace(/^the /, "the "), lit, el, phaseName(el), lu >= 1 ? `in the globe's shadow (${["", "penumbral", "partial", "total"][lu]})` : so >= 1 ? `its shadow on the globe (${["", "partial", "annular", "total"][so]})` : "")
				}
				for (const { L, id, lat } of clocks) {
					const st = track.state[id]
					const day = (st.day?.[k] ?? 0) >= 0.5
					L.set(`${Math.abs(lat).toFixed(0)}° ${lat >= 0 ? "N" : "S"}: ${clockText(st.local_time?.[k])} ${day ? "day" : "night"}`)
				}
			}
			frame(0)
			return {
				frame,
				dispose() {
					for (const d of disposers) d()
				},
				environment: { key: 1.3, fill: 0.12, envIntensity: 0.16 }
			}
		}
	})

	// ---------------------------------------------------------------- the view plug-in: sky, sunlight, paths, the phase seen from the planet
	const starTex = () =>
		texCache("stars", () => {
			const Wd = 2048
			const Hd = 1024
			const c = document.createElement("canvas")
			c.width = Wd
			c.height = Hd
			const g = c.getContext("2d")
			g.fillStyle = "#020309"
			g.fillRect(0, 0, Wd, Hd)
			const r = rng(42)
			// a faint band of the Milky Way across the sky
			for (let i = 0; i < 9000; i++) {
				const x = r() * Wd
				const y = Hd * 0.5 + Math.sin((x / Wd) * TAU) * Hd * 0.16 + (r() + r() + r() - 1.5) * Hd * 0.09
				g.fillStyle = `rgba(160,170,210,${(0.025 + r() * 0.05).toFixed(3)})`
				g.fillRect(x, y, 2, 2)
			}
			for (let i = 0; i < 3800; i++) {
				const x = r() * Wd
				const y = r() * Hd
				const m = r() ** 6
				const a = 0.25 + 0.75 * m
				const tint = r()
				g.fillStyle = tint < 0.15 ? `rgba(255,214,170,${a})` : tint < 0.3 ? `rgba(180,200,255,${a})` : `rgba(255,255,255,${a})`
				const s = m > 0.6 ? 2.4 : m > 0.25 ? 1.6 : 1.1
				g.beginPath()
				g.arc(x, y, s / 2, 0, TAU)
				g.fill()
			}
			const t = new THREE.CanvasTexture(c)
			t.colorSpace = THREE.SRGBColorSpace
			t.mapping = THREE.EquirectangularReflectionMapping
			return t
		})
	/** A canvas sprite showing the Moon's phase as its planet sees it (northern view: waxing lit on the right) and its name. */
	function phaseInset(height) {
		const CW = 512
		const CH = 640
		const c = document.createElement("canvas")
		c.width = CW
		c.height = CH
		const tex = new THREE.CanvasTexture(c)
		tex.colorSpace = THREE.SRGBColorSpace
		const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false })
		const sprite = new THREE.Sprite(mat)
		sprite.renderOrder = 10
		sprite.scale.set(height * (CW / CH), height, 1)
		let shown = ""
		const set = (who, lit, el, name, eclipse = "") => {
			const key = `${who}|${Math.round(lit * 200)}|${el < 180 ? 1 : 0}|${name}|${eclipse}`
			if (key === shown) return
			shown = key
			const g = c.getContext("2d")
			g.clearRect(0, 0, CW, CH)
			g.fillStyle = "rgba(8,10,22,0.86)"
			g.beginPath()
			g.roundRect ? g.roundRect(6, 6, CW - 12, CH - 12, 44) : g.rect(6, 6, CW - 12, CH - 12)
			g.fill()
			g.strokeStyle = "rgba(255,255,255,0.25)"
			g.lineWidth = 3
			g.stroke()
			const cx = CW / 2
			const cy = 250
			const R = 180
			g.fillStyle = "#24252a"
			g.beginPath()
			g.arc(cx, cy, R, 0, TAU)
			g.fill()
			// the lit part: a half disc on the lit side (waxing: the right, as seen from the northern hemisphere), closed by the terminator, an
			// ellipse of half-width R·|1 − 2·lit| that takes from it (a crescent) or adds to it (gibbous)
			const right = el < 180
			const k = 1 - 2 * lit
			g.fillStyle = /total lunar/.test(eclipse) ? "#9a4a2c" : "#ece8dc"
			g.beginPath()
			g.ellipse(cx, cy, R, R, 0, -PI / 2, PI / 2, !right)
			g.ellipse(cx, cy, Math.max(0.5, Math.abs(k) * R), R, 0, PI / 2, -PI / 2, (k > 0) === right)
			g.closePath()
			g.fill()
			g.fillStyle = "#ffffff"
			g.textAlign = "center"
			g.font = "600 46px system-ui, -apple-system, sans-serif"
			g.fillText(`Seen from ${who}`, cx, 510, CW - 40)
			g.font = "500 40px system-ui, -apple-system, sans-serif"
			g.fillStyle = "#d9def0"
			g.fillText(eclipse ? eclipse : `${name}, ${Math.round(lit * 100)} % lit`, cx, 576, CW - 40)
			tex.needsUpdate = true
		}
		return { sprite, set, dispose: () => (tex.dispose(), mat.dispose()) }
	}
	const PHASES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"]
	const phaseName = (e) => {
		let x = e % 360
		if (x < 0) x += 360
		let k = 0
		for (const edge of [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]) if (x >= edge) k++
		return PHASES[k % 8]
	}
	const NAMES = { sun: "the Sun", mercury: "Mercury", venus: "Venus", earth: "Earth", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune", pluto: "Pluto", moon: "the Moon", io: "Io", europa: "Europa", ganymede: "Ganymede", callisto: "Callisto", titan: "Titan", phobos: "Phobos", deimos: "Deimos" }
	const PATH_COLOR = { moon: "#d9d6cc", satellite: "#ffb23f", planet: null }
	// (web/sim/modules/space.js ZODIAC: the constellations along the ecliptic, J2000 longitudes)
	const ZODIAC_VIEW = [["Pisces", 351.6, 29.1], ["Aries", 29.1, 53.5], ["Taurus", 53.5, 90.4], ["Gemini", 90.4, 118.3], ["Cancer", 118.3, 138.2], ["Leo", 138.2, 174.2], ["Virgo", 174.2, 218.0],
		["Libra", 218.0, 241.0], ["Scorpius", 241.0, 247.7], ["Ophiuchus", 247.7, 266.3], ["Sagittarius", 266.3, 299.7], ["Capricornus", 299.7, 327.7], ["Aquarius", 327.7, 351.6]]

	addViewPlugin({
		name: "space:sky",
		load(ctx) {
			const recs = (ctx.doc.processes ?? []).filter((p) => p.kind === "space-body")
			if (!recs.length) return null
			const { THREE: T, group, track, doc } = ctx
			const typeOf = new Map(doc.solids.map((s) => [s.item, s.itemType]))
			const bodyOf = (item) => ctx.resolved?.[item]?.body ?? (typeOf.get(item) === "sun" ? "sun" : null)
			const disposers = []
			// sunlight: a point light inside each pulling sun; parallel light from a far one; starlight when there is none
			const suns = recs.filter((r) => r.star)
			const lights = []
			const coronas = []
			for (const s of suns) {
				const p0 = ctx.placementAt(s.solid, 0) ?? { x: 0, y: 0 }
				// the Sun's corona: a soft glow round it, facing the camera
				const glow = new T.Sprite(matCache("sunglow", () => new T.SpriteMaterial({ map: glowTex(), blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })))
				const R = (s.radius || 0.15) * 4.2
				glow.scale.set(R, R, 1)
				glow.position.set(p0.x, p0.y, 0)
				glow.castShadow = false
				group.add(glow)
				coronas.push({ glow, s })
				if (s.far) {
					const L = new T.DirectionalLight(0xfff4e0, 3.2)
					L.castShadow = true
					L.shadow.mapSize.set(2048, 2048)
					L.shadow.camera.left = L.shadow.camera.bottom = -4
					L.shadow.camera.right = L.shadow.camera.top = 4
					L.shadow.camera.near = 0.1
					L.shadow.camera.far = 40
					L.shadow.bias = -0.0004
					group.add(L, L.target)
					lights.push({ L, s, far: true })
				} else {
					const L = new T.PointLight(0xfff2dc, 3.4, 0, 0)
					L.castShadow = true
					L.shadow.mapSize.set(1024, 1024)
					L.shadow.camera.near = Math.max(0.01, (s.radius ?? 0.1) * 1.05)
					L.shadow.camera.far = 30
					L.shadow.bias = -0.0008
					L.position.set(p0.x, p0.y, 0)
					group.add(L)
					lights.push({ L, s, far: false })
				}
			}
			if (!suns.length) {
				const L = new T.DirectionalLight(0xe8eeff, 2.2)
				L.position.set(-3, 3, 4)
				group.add(L, L.target)
			}
			// the paths of the bodies that move round something
			const paths = []
			const frames = track?.frames ?? []
			for (const r of recs) {
				if (r.star || frames.length < 2) continue
				const kind = typeOf.get(r.item)
				const col = PATH_COLOR[kind] ?? doc.solids.find((s) => s.id === r.solid)?.color ?? "#9fb7ff"
				const pts = frames.map((f) => f.placements[r.solid] ?? frames[0].placements[r.solid]).filter(Boolean)
				if (pts.length < 2) continue
				// (a tilted moon is drawn lifted off the plane: its path too)
				const liftK = ctx.resolved?.[r.item]?.lift_per_km
				const hk = Number.isFinite(liftK) ? track?.state?.[r.item]?.height_km : null
				const n = pts.length
				// (a path wide enough to read in a wide shot: 0.4 % of its own span, 4 to 14 mm)
				let x0 = Infinity
				let x1 = -Infinity
				let y0 = Infinity
				let y1 = -Infinity
				for (const p of pts) {
					x0 = Math.min(x0, p.x)
					x1 = Math.max(x1, p.x)
					y0 = Math.min(y0, p.y)
					y1 = Math.max(y1, p.y)
				}
				const width = Math.min(0.014, Math.max(0.004, Math.max(x1 - x0, y1 - y0) * 0.004))
				const pos = new Float32Array(n * 2 * 3)
				for (let k = 0; k < n; k++) {
					const a = pts[Math.max(0, k - 1)]
					const b = pts[Math.min(n - 1, k + 1)]
					let tx = b.x - a.x
					let ty = b.y - a.y
					const l = Math.hypot(tx, ty) || 1
					tx /= l
					ty /= l
					const nx = -ty * (width / 2)
					const ny = tx * (width / 2)
					const z = hk ? (hk[k] ?? 0) * liftK - 0.003 : -0.003
					pos.set([pts[k].x + nx, pts[k].y + ny, z, pts[k].x - nx, pts[k].y - ny, z], k * 6)
				}
				const idx = []
				for (let k = 0; k < n - 1; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2)
				const geo = new T.BufferGeometry()
				geo.setAttribute("position", new T.BufferAttribute(pos, 3))
				geo.setIndex(idx)
				const mat = new T.MeshBasicMaterial({ color: new T.Color(col), transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide })
				const mesh = new T.Mesh(geo, mat)
				mesh.castShadow = false
				mesh.receiveShadow = false
				mesh.frustumCulled = false
				group.add(mesh)
				paths.push({ mesh, geo })
				disposers.push(() => (geo.dispose(), mat.dispose()))
			}
			// the phase as each moon's planet sees it
			const insets = []
			for (const r of recs) {
				if (!r.phase || !suns.length || !track?.state?.[r.item]?.elongation) continue
				const prim = r.primary ? recs.find((q) => q.solid === r.primary) : null
				if (!prim) continue
				const who = NAMES[bodyOf(prim.item)] ?? prim.item
				const inset = phaseInset(0.62)
				group.add(inset.sprite)
				insets.push({ inset, r, prim, who: who.replace(/^the /, "") })
				disposers.push(inset.dispose)
			}
			// a planet with seasons: its town's noon Sun and day length as it goes round (from the run's readings)
			const seasonLabels = []
			for (const r of recs) {
				if (!r.seasons || !track?.state?.[r.item]?.noon_elevation) continue
				const L = ctx.label({ text: "", height: 0.16 })
				group.add(L.sprite)
				seasonLabels.push({ L, r })
			}
			const frame = (t) => {
				for (const { glow, s } of coronas) {
					const p = ctx.placementAt(s.solid, t)
					if (p) glow.position.set(p.x, p.y, 0)
				}
				for (const { L, s, far } of lights) {
					const p = ctx.placementAt(s.solid, t)
					if (!p) continue
					if (far) {
						// parallel light from the far Sun's side, aimed at the middle of the bodies
						const tgt = recs.filter((q) => !q.star).map((q) => ctx.placementAt(q.solid, t)).filter(Boolean)
						const cx = tgt.length ? tgt.reduce((a, q) => a + q.x, 0) / tgt.length : 1.3
						const cy = tgt.length ? tgt.reduce((a, q) => a + q.y, 0) / tgt.length : 1.2
						L.position.set(p.x, p.y, 0)
						L.target.position.set(cx, cy, 0)
						L.target.updateMatrixWorld()
					} else L.position.set(p.x, p.y, 0)
				}
				const k = frames.length ? Math.max(1, frameIdx(frames, t)) : 0
				for (const { geo } of paths) geo.setDrawRange(0, 6 * k)
				for (const { L, r } of seasonLabels) {
					const st = track.state[r.item]
					const k = frameIdx(frames, t)
					const dec = st.sun_lat?.[k] ?? 0
					const tilt = r.seasons.tilt ?? 23.44
					const name = Math.abs(dec - tilt) < 0.6 ? "June solstice" : Math.abs(dec + tilt) < 0.6 ? "December solstice" : Math.abs(dec) < 0.6 ? "equinox" : ""
					const lat = r.seasons.lat ?? 0
					// (and what the midnight sky shows: the constellation opposite the Sun along the ecliptic, Orion from 70 to 100°)
					const nl = st.night_lon?.[k]
					const sky = Number.isFinite(nl) ? (nl >= 70 && nl < 100 ? "Orion" : ZODIAC_VIEW.find(([, a, b]) => (a < b ? nl >= a && nl < b : nl >= a || nl < b))?.[0]) : null
					L.set(`${name ? `${name}: ` : ""}${Math.abs(lat).toFixed(0)}° ${lat >= 0 ? "N" : "S"} noon Sun ${(st.noon_elevation?.[k] ?? 0).toFixed(0)}° up, ${(st.day_length_h?.[k] ?? 0).toFixed(1)} h of day${sky ? `, ${sky} at midnight` : ""}`)
					// (fixed just above the Sun, inside the orbit: always in the wide shot)
					const sp = suns.length ? ctx.placementAt(suns[0].solid, t) : null
					const p = sp ?? ctx.placementAt(r.solid, t)
					if (p) L.sprite.position.set(p.x, p.y + (suns[0]?.radius ?? 0.1) + 0.12, 0.05)
				}
				for (const { inset, r, prim, who } of insets) {
					const lit = ctx.stateAt(r.item, "lit", t) ?? 0
					const el = ctx.stateAt(r.item, "elongation", t) ?? 0
					const k = frameIdx(frames, t)
					const lu = track?.state?.[r.item]?.lunar_eclipse?.[k] ?? 0
					const so = track?.state?.[r.item]?.solar_eclipse?.[k] ?? 0
					const ecl = lu >= 1 ? `a ${["", "penumbral", "partial", "total"][lu]} lunar eclipse` : so >= 1 ? `the Moon's shadow on ${who}: ${["", "partial", "annular", "total"][so]}` : ""
					inset.set(who, lit, el, phaseName(el), ecl)
					const p = ctx.placementAt(prim.solid, t)
					if (p) inset.sprite.position.set(p.x - (prim.radius ?? 0.03) - 0.32, p.y + (prim.radius ?? 0.03) + 0.42, 0.05)
				}
			}
			frame(0)
			return {
				frame,
				dispose: () => {
					for (const d of disposers) d()
				},
				environment: { room: false, table: false, background: starTex(), key: 0, fill: 0.025, envIntensity: 0.03 }
			}
		}
	})
	/** The frame index at time t (the last frame at or before t). */
	function frameIdx(frames, t) {
		if (t <= frames[0].t) return 0
		if (t >= frames[frames.length - 1].t) return frames.length - 1
		let lo = 0
		let hi = frames.length - 1
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1
			if (frames[mid].t <= t) lo = mid
			else hi = mid
		}
		return lo
	}
}
