"""The waves module (sound and waves): things that sound when struck, plucked or blown, a sound level meter that hears them, sound panels
that soak sound up (walls reflect it), a rope and a Slinky that carry waves, a ripple tank, a bell in a jar that is pumped empty.
Its engine processes are tooling/src/sim/modules/waves.ts ("sound", "wave-line", "ripples"; the physics in tooling/src/sim/waves.ts),
its exact JavaScript port and AI plug-ins web/sim/modules/waves.js, its 3D models web/models/mod-waves.js.

Every builder writes only + − × ÷ and square roots (the same bits in Python and in web/sim), rounded to 6 decimals where it writes a
number of its own into the document. Sources (keys of coverage.md §7 and spec/modules/waves.md):
  [KIN]      Kinsler, Frey, Coppens, Sanders, Fundamentals of Acoustics, 4th ed., Wiley 2000 (string, bar and membrane modes; sound speed)
  [FLETCHER] Fletcher & Rossing, The Physics of Musical Instruments, 2nd ed., Springer 1998 (cantilever 1.875, free bar 4.730, string
             inharmonicity B = π³Ed⁴/(64TL²): Fletcher, J. Acoust. Soc. Am. 36, 203 (1964))
  [ROSSING]  Rossing, Moore, Wheeler, The Science of Sound, 3rd ed., 2002 (tuning forks: clang mode ≈ 6.25 × the fundamental, decay
             times; membranes; bars)
  [ISO16]    ISO 16:1975, standard tuning A4 = 440 Hz
  [NIOSH]    typical sound levels (conversation ≈ 60 dB at 1 m, busy classroom 65-75 dB)
  [ANSI-S12] ANSI/ASA S12.60-2010: background noise in an unoccupied classroom at most 35 dB(A)
  [EVEREST]  Everest & Pohlmann, Master Handbook of Acoustics, 5th ed., 2009 (absorption coefficients at 500 Hz)
  [CRC]      CRC Handbook of Chemistry and Physics (densities, elastic moduli)
  [TRELOAR]  Treloar, The Physics of Rubber Elasticity, 3rd ed., Oxford 1975 (neo-Hookean rubber: nominal stress G·(λ − 1/λ²); natural rubber
             G ≈ 0.4-0.6 MPa; elongation at break 500-700 %)
  [BLEVINS]  Blevins, Formulas for Natural Frequency and Mode Shape, 1979 (a clamped-free beam's first mode: modal mass m/4 at its tip)
  [HOERNER]  Hoerner, Fluid-Dynamic Drag, 1965 (a cylinder side-on: C_d ≈ 1.2 at Re 10³-10⁵)
  [ERNST]    Ernst, Der Bauingenieur 40, 52-55 (1965): a sagging cable's equivalent modulus E/(1 + (w·L)²·E·A/(12·T³)) (the string telephone)
  [ANSI-S35] ANSI S3.5-1997, Table 3: speech 1 m away, normal 62.35, raised 68.34, loud 74.85, shout 82.30 dB
  [PEARSONS] Pearsons, Bennett & Fidell, Speech levels in various noise environments, EPA-600/1-77-025 (1977): casual speech about 52-56 dB(A) at 1 m
Levels at 1 m and decay times marked "provisional" are typical values chosen to match the cited ranges, not measurements of a
particular object.
"""
import math

from crmath import cr_pow  # (10 ** (L / 20) correctly rounded: the same bits as web/sim's port, engine-math.js pow)

NEEDED = ("register", "ItemType", "Prop", "Link", "Readout", "register_goal_kind", "register_build_hook", "MATERIALS", "props_of",
          "add_look", "TYPES", "CATEGORIES")
CAT = "Sound & waves"

R6 = lambda v: round(v, 6)
TAU = 2 * math.pi
J01 = 2.404825557695773          # first zero of J0 (the membrane's (0,1) mode) [KIN §4.4]
CANTILEVER = 0.5595290968074446  # 1.875104² / (2π): a clamped-free bar's first mode [FLETCHER §2.11]
FREE_BAR = 3.560757626300666     # 4.730041² / (2π): a free-free bar's first mode [FLETCHER §2.11]


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CAT not in CATEGORIES:
        CATEGORIES.append(CAT)
    _materials()
    _sources()
    _listeners()
    _wave_lines()
    _tank()
    _telephone()
    register_build_hook(_build_hook)
    for kind, fn in (("sounds", goal_sounds), ("higher", goal_higher), ("louder", goal_louder), ("hears", goal_hears), ("echo", goal_echo),
                     ("wave_reaches", goal_reaches), ("period", goal_period), ("jumps", goal_jumps), ("reflects", goal_reflects),
                     ("standing", goal_standing), ("wavelength", goal_wavelength), ("wave_speed", goal_wave_speed), ("stays_put", goal_stays_put),
                     ("trace", goal_trace)):
        register_goal_kind(kind, fn)


# ---------------------------------------------------------------- materials (only what the module's own solids need)
def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    MATERIALS[key] = kw


def _materials():
    add_look("rice", fill="#f3ead2", shade="#cfc3a1", roughness=0.55, metalness=0.0, clearcoat=0.1)
    add_look("drum head", fill="#efe9dc", shade="#cfc6b3", roughness=0.6, metalness=0.0, clearcoat=0.0)
    add_look("acrylic", fill="#cfe8f5", shade="#9cc3d8", roughness=0.08, metalness=0.0, clearcoat=0.8, transmission=0.6)
    # rice: a long-grain kernel ≈ 7 × 2.3 mm, 20-25 mg, kernel density ≈ 1.4-1.5 g/cm³ (Mohsenin, Physical Properties of Plant and Animal
    # Materials, 2nd ed., 1986); a grain is built as the ball of the same volume (3.1 mm), which rolls far less than a ball: rolling 0.3
    _mat("rice", density=1450, bounce=0.45, friction=0.5, rolling=0.3, look="rice",
         source="Rice kernel ≈ 1450 kg/m³ (Mohsenin 1986); bounce and rolling provisional (a grain is not a ball).")
    # a drum head: polyester film (Mylar) 0.19 mm, 1390 kg/m³ (DuPont Mylar data sheet); taut, it gives back most of a light grain's fall
    _mat("drum head", density=1390, bounce=0.75, friction=0.4, look="drum head",
         source="Polyester (PET) film 1390 kg/m³ (DuPont Mylar data); bounce provisional.")
    _mat("acrylic", density=1190, bounce=0.6, friction=0.45, look="acrylic",
         source="PMMA (acrylic) 1190 kg/m³, E ≈ 3.2 GPa [CRC].")


# ---------------------------------------------------------------- helpers
def _strikes(P, at_key="strike_at"):
    """The strikes a source's settings ask for: `hits` strikes `every` s apart from its strike time, each at its strength."""
    t0, n, every, level = P[at_key], int(P.get("hits", 1)), P.get("every", 1.0), P["strength"]
    return [[R6(t0 + k * every), R6(level)] for k in range(max(1, n))]


def _source(c, solid, at, f0, partials, lp1, strikes, amp, hold=0.0, hit=None, kick=None, ring=None, jar=None, show=True, part="sound"):
    """The item's sound source (a "sound" process record, role source; tooling/src/sim/modules/waves.ts)."""
    fields = dict(role="source", solid=solid, at={"x": R6(at[0]), "y": R6(at[1])}, f0=R6(f0),
                  partials=[[R6(r), R6(a), R6(t)] for r, a, t in partials], lp1=R6(lp1), strikes=strikes, amp=R6(amp), show=bool(show))
    if hold > 0:
        fields["hold"] = R6(hold)
    if hit is not None:
        fields["hit"] = hit
    if kick is not None:
        fields["kick"] = kick
    if ring is not None:
        fields["ring"] = ring
    if jar is not None:
        fields["jar"] = jar
    return c.process("sound", part, **fields)


STRIKE_PROPS = lambda at=0.5, what="Strike at", hits=True: (
    [Prop("strength", "Strength", 1.0, 0.2, 2.0, 0.05, "×", "How hard it is struck or plucked: twice as hard is twice the vibration, 6 dB louder"),
     Prop("strike_at", what, at, 0.0, 20.0, 0.05, "s", "When it sounds")]
    + ([Prop("hits", "Times", 1, 1, 10, 1, "", "How many times it is struck", kind="int"),
        Prop("every", "Every", 1.0, 0.1, 10.0, 0.05, "s", "Time between strikes")] if hits else [])
    + [Prop("show_waves", "Sound lines", True, kind="bool", help="Faint arcs spreading from it while it sounds (a picture of sound spreading)")])

SOURCE_READOUTS = lambda: [Readout("sounding", "Sound 1 m away", "dB", 1, "Its sound level 1 m away now (0 when silent)"),
                           Readout("pitch", "Pitch", "Hz", 1, "Its note's frequency"),
                           Readout("struck", "Times sounded", "", 0, "How many times it has been struck so far"),
                           Readout("amp_mm", "Vibration", "mm", 2, "How far its vibrating part swings now")]


# ---------------------------------------------------------------- sources
FORK_T = 0.006             # m: a school fork's prong, 6 mm thick in its bending direction (common 5-7 mm)
STEEL_BAR = 5047.5         # m/s: √(E/ρ) for steel, E 200 GPa, ρ 7850 kg/m³ [CRC]: a thin bar's sound speed [KIN Appendix A10: 5050]


def fork_prong(f):
    """A steel fork prong's length (m) for pitch f: a clamped-free bar, f = 1.875²/(2π)·(t/L²)·√(E/(12ρ)) [FLETCHER] (440 Hz: 10.5 cm)."""
    return math.sqrt(CANTILEVER * FORK_T * STEEL_BAR / math.sqrt(12) / f)


def build_fork(c, P):
    f = P["pitch"]
    L = fork_prong(f)
    gap, pw, pd = 0.012, FORK_T, 0.008
    box = bool(P["box"])
    # a quarter-wave resonance box: open at one end, as long as a quarter of the note's wavelength in air (343.2 m/s at 20 °C): 19.5 cm at 440 Hz
    blen = R6(343.2 / (4 * f)) if box else 0.07
    bh = 0.075 if box else 0.025
    bd = 0.10 if box else 0.06
    c.slab("box", blen, bh, bd, 0.0, bh / 2, kind="static", words="the fork's wooden resonance box" if box else "the fork's wooden block",
           material=c.mat(base="varnished hardwood", overrides={}))
    stem = 0.055
    c.slab("stem", 0.008, stem, 0.008, 0.0, bh + stem / 2, kind="static", words="the tuning fork's stem", material=c.mat(base="steel", overrides={}))
    yoke = 2 * pw + gap
    c.slab("yoke", yoke, 0.008, pd, 0.0, bh + stem + 0.004, kind="static", words="the tuning fork's bend", material=c.mat(base="steel", overrides={}))
    base = bh + stem + 0.008
    left = c.slab("prong-left", pw, L, pd, -(gap + pw) / 2, base + L / 2, kind="static", words="a tuning fork prong", material=c.mat(base="steel", overrides={}))
    right = c.slab("prong-right", pw, L, pd, (gap + pw) / 2, base + L / 2, kind="static", words="a tuning fork prong", material=c.mat(base="steel", overrides={}))
    # level and ring time: struck with a rubber mallet, a bare fork is quiet (≈ 55 dB at 30 cm, 45 dB at 1 m) and rings ≈ 6 s; on its box
    # it is ≈ 12 dB louder and rings ≈ 2 s (the box takes the energy out faster) [ROSSING ch. 2]: provisional. The clang mode 6.25 × f
    # dies away within a few tenths of a second [ROSSING].
    lp1 = 55.0 if box else 45.0
    tau = 2.0 if box else 6.0
    partials = [(1.0, 1.0, tau), (6.25, 0.1, tau / 20)]
    # the prongs' tips swing ≈ 0.2 mm at a normal strike (provisional); a body touching a prong is flung off at the tip's speed, shared by
    # momentum with the prong's modal mass: a quarter of the prong's mass at its tip (a clamped-free bar's first mode [BLEVINS]), 10 g at 440 Hz
    amp = 0.0002
    prong_mass = 0.25 * 7850.0 * L * pw * pd
    # (the sound comes from between the prongs, half way up them)
    _source(c, left, (pw / 2 + gap / 2, 0.0), f, partials, lp1, _strikes(P), amp,
            hit={"solids": [left, right], "momentum": 0.045, "max": 3.0},
            kick={"solids": [left, right], "dir": "out", "amp": amp, "shape": "prong", "size": R6(L), "mass": R6(prong_mass)}, show=P["show_waves"])


def build_ruler(c, P):
    L = P["overhang"]
    mat = P["ruler"]
    E, rho, t = RULERS[mat][:3]
    f = CANTILEVER * (t / (L * L)) * math.sqrt(E / (12 * rho))
    total = 0.30
    back = total - L
    side = -1.0 if P["edge"] == "left" else 1.0     # which way it sticks out past the edge
    # it clamps itself to that edge of the scene's table, wherever its own x is (a ruler only buzzes over an edge)
    table = next((it for it in c.sb.scene_items.values() if it.get("type") == "table"), None)
    if table is not None:
        c.ox = table.get("x", 0.0) + side * props_of(table)["width"] / 2
        c.oy = table.get("y", 0.0)
    look = {"plastic": "acrylic", "steel": "steel", "wood": "light wood"}[mat]
    base = {"plastic": "acrylic", "steel": "steel", "wood": "varnished hardwood"}[mat]
    ruler = c.slab("ruler", total, t, 0.03, side * (L - back) / 2, t / 2, kind="static", words=f"a {mat} ruler held at the table's edge", look=look,
                   material=c.mat(base=base, overrides={}))
    # a clamp holds the ruler's table end down (a C-clamp's jaw over it)
    c.slab("clamp", 0.04, 0.03, 0.04, side * (-back + 0.03), t + 0.015, kind="static", words="a clamp holding the ruler down", look="steel",
           material=c.mat(base="steel", overrides={}))
    # a plucked ruler is heard mostly as the slap of its tip on the table edge once a cycle: a buzz at f₁ with many harmonics (amplitudes
    # 1/n); ≈ 70 dB at 1 m for a firm pluck; it rings 0.25 s (plastic), 0.8 s (steel), 0.2 s (wood): provisional
    tau = RULERS[mat][3]
    partials = [(n, 1.0 / n, tau / (1 + 0.2 * (n - 1))) for n in range(1, 13)]
    _source(c, ruler, (side * (total / 2 - 0.005), 0.0), f, partials, 70.0, _strikes(P, "strike_at"), 0.02, show=P["show_waves"])


# E (Pa), ρ (kg/m³), thickness (m), ring time τ (s) of a ruler [spec waves.md, CRC]: acrylic 3.2 GPa 1190 3 mm; spring steel 200 GPa 7850
# 0.5 mm; wood 11 GPa 700 4 mm
RULERS = {"plastic": (3.2e9, 1190.0, 0.003, 0.25), "steel": (200e9, 7850.0, 0.0005, 0.8), "wood": (11e9, 700.0, 0.004, 0.2)}

# A membrane's modes (m, n): frequency ratios j_mn/j_01 [KIN Table 4.4.1] and how much each sounds when struck at the middle, halfway out
# or near the rim: |J_m(j_mn·r/a)| (the mode's shape where it is struck) × how well it radiates (0,1: 1; (0,2): 0.4; m = 1, 2, 3: 0.5,
# 0.3, 0.2: provisional)
DRUM_MODES = {
    "middle": [(1.0, 1.0), (2.2954, 0.4)],
    "halfway": [(1.0, 0.6699), (1.5933, 0.2904), (2.1355, 0.1365), (2.2954, 0.0674), (2.6531, 0.0683), (2.9173, 0.0671)],
    "near the rim": [(1.0, 0.268), (1.5933, 0.1572), (2.1355, 0.1008), (2.2954, 0.1356), (2.6531, 0.0692), (2.9173, 0.1666)],
}
HEAD_SIGMA = 1390 * 0.00019     # kg/m²: a 0.19 mm (7.5 mil) Mylar head, 0.264 kg/m²


def drum_pitch(diameter, tension):
    """f01 = 2.405/(2πa)·√(T/σ) for an ideal membrane of radius a, tension T (N/m), areal density σ [KIN eq. 4.4.10]."""
    return J01 / (TAU * diameter / 2) * math.sqrt(tension / HEAD_SIGMA)


def build_drum(c, P):
    D, H = P["diameter"], P["height"]
    f = drum_pitch(D, P["tension"])
    c.slab("shell", D, H - 0.002, min(D, 0.5), 0.0, (H - 0.002) / 2, kind="static", words="the drum's wooden shell",
           material=c.mat(base="varnished hardwood", overrides={}))
    head = c.slab("head", D, 0.002, min(D, 0.5), 0.0, H - 0.001, kind="static", words="the drum's tight head", look="drum head",
                  material=c.mat(base="drum head", overrides={}))
    # the counterhoop stands 1 cm over the head at each side and keeps grains on it
    for side in (-1, 1):
        c.slab(f"rim-{'left' if side < 0 else 'right'}", 0.012, 0.012, min(D, 0.5), side * (D / 2 - 0.006), H + 0.006 - 0.002, kind="static",
               words="the drum's rim", look="steel", material=c.mat(base="steel", overrides={}))
    # a medium hand-drum hit ≈ 85 dB at 1 m (drums 90-100 dB close by [NIOSH]); the head rings ≈ 0.2 s, higher modes faster. A stick's
    # impulse sets the head's middle moving at J ÷ its modal mass whatever its tension: ≈ 0.49 m/s at a medium hit (provisional), so its
    # swing is that ÷ 2πf, 0.5 mm at the default 157 Hz (0.0785 / f): grains on it leave at ≈ 0.5 m/s (a hop of ≈ 1 cm) on a loose or a
    # tight head alike. The head's (0,1) mode weighs σ·πa²·J1(2.405)² = 0.2695·σ·πa² at its middle (5 g for 30 cm of 0.19 mm Mylar [KIN
    # §4.4]): what it throws shares its momentum with that, so a grain leaves at the head's speed and a 1 kg weight barely stirs
    partials = [(r, a, 0.2 / math.sqrt(r)) for r, a in DRUM_MODES[P["strike_where"]]]
    amp = 0.0785 / f
    head_mass = 0.2695 * HEAD_SIGMA * math.pi * (D / 2) * (D / 2)
    _source(c, head, (0.0, 0.001), f, partials, 85.0, _strikes(P), amp,
            hit={"solids": [head], "momentum": 0.15, "max": 3.0},
            kick={"solids": [head], "dir": "up", "amp": R6(amp), "shape": "membrane", "size": R6(D / 2), "mass": R6(head_mass)},
            show=P["show_waves"])


def build_rice(c, P):
    n = int(P["count"])
    # each grain: a ball of a kernel's volume, Ø 3 mm (20.5 mg at 1450 kg/m³), in a row across `spread` (never closer than 3.2 mm apart)
    w = max(P["spread"], (n - 1) * 0.0032)
    r = 0.0015
    for k in range(n):
        x = 0.0 if n == 1 else -w / 2 + w * k / (n - 1)
        c.ball(f"grain{k + 1}", r, x, r, words="a grain of rice", look="rice", material=c.mat(base="rice", overrides={}))


# A monochord's string: steel (E 200 GPa, ρ 7850) or nylon (E 4 GPa, ρ 1140) [CRC]; ring time τ (provisional: a steel string on a sound box
# rings for seconds, nylon less); plucked in the middle (only odd harmonics) or near a bridge (a fifth along: brighter); amplitude of the
# n-th harmonic ∝ |sin(nπβ)|/n [FLETCHER §2.6]
STRINGS = {"steel": (200e9, 7850.0, 1.5), "nylon": (4e9, 1140.0, 0.8)}
PLUCKS = {"middle": [1.0, 0.0, 0.333333, 0.0, 0.2, 0.0, 0.142857, 0.0], "near a bridge": [0.587785, 0.475528, 0.317019, 0.146946, 0.0, 0.097964, 0.135865, 0.118882]}


def string_pitch(L, T, mu):
    """f = (1/2L)·√(T/μ) [KIN eq. 2.9.6]: L m between the bridges, T N, μ kg/m."""
    return math.sqrt(T / mu) / (2 * L)


def build_monochord(c, P):
    L, T, mu = P["length"], P["tension"], P["gauge"] / 1000
    E, rho, tau = STRINGS[P["string"]]
    f = string_pitch(L, T, mu)
    d = math.sqrt(4 * mu / (math.pi * rho))
    # (powers as products: Python's ** and JavaScript's may round differently)
    B = math.pi * math.pi * math.pi * E * (d * d) * (d * d) / (64 * T * L * L)
    box_l = L + 0.16
    c.slab("box", box_l, 0.08, 0.14, 0.0, 0.04, kind="static", words="the monochord's sound box", material=c.mat(base="varnished hardwood", overrides={}))
    for side in (-1, 1):
        c.poly(f"bridge-{'left' if side < 0 else 'right'}", [(-0.008, 0.0), (0.008, 0.0), (0.0015, 0.02), (-0.0015, 0.02)], 0.06, side * L / 2, 0.08,
               kind="static", words="a bridge under the string", material=c.mat(base="varnished hardwood", overrides={}))
    string = c.slab("string", L, round(max(0.0005, d), 5), 0.002, 0.0, 0.10, kind="static", words=f"a {P['string']} string", look="steel" if P["string"] == "steel" else "plastic",
                    material=c.mat(base="steel", overrides={}))
    amps = PLUCKS[P["pluck_where"]]
    partials = [(n * math.sqrt(1 + B * n * n) / math.sqrt(1 + B), amps[n - 1], tau / (1 + 0.15 * (n - 1))) for n in range(1, 9) if amps[n - 1] > 0]
    _source(c, string, (0.0, 0.0), f, partials, 70.0, _strikes(P), 0.002, show=P["show_waves"])


# natural rubber: shear modulus G (Pa), its stretch at break, density (kg/m³), a band's thickness unstretched (m) [TRELOAR, CRC]
RUBBER_G = 0.5e6
RUBBER_BREAK = 6.0
RUBBER_RHO = 930.0
BAND_H = 0.0008


def band_hold(width_mm):
    """The most a band 0.8 mm × width pulls before it snaps (N): G·A0·(λ − 1/λ²) at its breaking stretch [TRELOAR] (3 mm: 7.2 N; 1 mm: 2.4 N)."""
    A0 = (width_mm / 1000) * BAND_H
    return RUBBER_G * A0 * (RUBBER_BREAK - 1 / (RUBBER_BREAK * RUBBER_BREAK))


def band_stretch(T, width_mm):
    """The stretch λ at which the band pulls T N: neo-Hookean, T = G·A0·(λ − 1/λ²) [TRELOAR] (A0 its unstretched cross-section), solved by 60
    halvings (+ − × ÷ only: the same bits in web/sim); its breaking stretch when T is more than it holds."""
    A0 = (width_mm / 1000) * BAND_H
    want = T / (RUBBER_G * A0)
    lo, hi = 1.0, RUBBER_BREAK
    if hi - 1 / (hi * hi) <= want:
        return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if mid - 1 / (mid * mid) < want:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def band_pitch(L, T, width_mm):
    """A rubber band's note (Hz): f = √(T/μ)/(2L), its tension at most what it holds, its mass per length ρ·A0/λ at the stretch that pull needs
    (a band pulled harder is stretched thinner: its pitch rises faster than √T; at the same pull a wider band is stretched less: lower)."""
    T = min(T, band_hold(width_mm))
    lam = band_stretch(T, width_mm)
    mu = RUBBER_RHO * (width_mm / 1000) * BAND_H / lam
    return string_pitch(L, T, mu)


def build_band(c, P):
    L, T = P["length"], P["tension"]
    # natural rubber [TRELOAR, CRC]: a band 0.8 mm thick, `width` wide, pulled with `tension` (at most what it holds before it snaps), stretched as
    # far as that pull needs (neo-Hookean: 2 N stretches a 3 mm band to ≈ 2 ×, its cross-section A0/λ)
    f = band_pitch(L, T, P["width"])
    c.slab("box", L + 0.06, 0.10, 0.16, 0.0, 0.05, kind="static", words="an open shoebox", look="cardboard", material=c.mat(base="cardboard", overrides={}))
    band = c.slab("band", L + 0.06, 0.002, round(P["width"] / 1000, 5), 0.0, 0.101, kind="static", words="a rubber band stretched over the box", look="rubber",
                  material=c.mat(base="solid rubber", overrides={}))
    # rubber is lossy: a plucked band rings ≈ 0.1 s; ≈ 55 dB at 1 m (provisional)
    partials = [(n, 1.0 / n, 0.12 / n) for n in range(1, 7)]
    _source(c, band, (0.0, 0.0), f, partials, 55.0, _strikes(P), 0.003, show=P["show_waves"])


# xylophone/glockenspiel bars: E, ρ [CRC] (aluminium 69 GPa, 2700; steel 200 GPa, 7850; rosewood ≈ 20 GPa along the grain, 1000:
# provisional), ring time τ (provisional); a free-free bar's overtones 2.756, 5.404, 8.933 × f₁ [FLETCHER §2.13]
BARS = {"aluminium": (69e9, 2700.0, 1.0, "aluminium"), "steel": (200e9, 7850.0, 1.5, "steel"), "rosewood": (20e9, 1000.0, 0.3, "dark wood")}


def bar_pitch(L, t, E, rho):
    """f₁ = 4.730²/(2π)·(t/L²)·√(E/(12ρ)) (a free-free bar of thickness t) [FLETCHER]: aluminium 6 mm × 20 cm → 779 Hz."""
    return FREE_BAR * (t / (L * L)) * math.sqrt(E / (12 * rho))


def build_bar(c, P):
    L, t = P["length"], P["thickness"] / 1000
    E, rho, tau, mat = BARS[P["metal"]]
    f = bar_pitch(L, t, E, rho)
    # two felt-topped rails under the bar's nodes (0.224 L from each end) on a low wooden frame
    c.slab("frame", L + 0.04, 0.03, 0.08, 0.0, 0.015, kind="static", words="a low wooden frame", material=c.mat(base="varnished hardwood", overrides={}))
    for side in (-1, 1):
        c.slab(f"felt-{'left' if side < 0 else 'right'}", 0.012, 0.01, 0.06, side * (0.5 - 0.224) * L, 0.035, kind="static", words="a felt pad",
               look="carpet", material=c.mat(base="carpet", overrides={}))
    bar = c.slab("bar", L, t, 0.03, 0.0, 0.04 + t / 2, kind="static", words=f"a {P['metal']} xylophone bar", look=mat,
                 material=c.mat(base="steel" if P["metal"] == "steel" else ("varnished hardwood" if P["metal"] == "rosewood" else "aluminium"), overrides={}))
    partials = [(1.0, 1.0, tau), (2.756, 0.5, tau / 2), (5.404, 0.25, tau / 4), (8.933, 0.12, tau / 6)]
    _source(c, bar, (0.0, t / 2), f, partials, 75.0, _strikes(P), 0.0001, hit={"solids": [bar], "momentum": 0.03, "max": 3.0}, show=P["show_waves"])


def build_speaker(c, P):
    # a small speaker box playing a steady tone (a tone generator): its level 1 m away is the setting
    W, H = 0.16, 0.24
    box = c.slab("box", W, H, 0.16, 0.0, H / 2, kind="static", words="a small speaker box", look="dark wood", material=c.mat(base="varnished hardwood", overrides={}))
    dur = P["on_for"]
    hold = dur if dur > 0 else 30.0
    # (the cone faces the viewer: the sound comes from the cone's middle)
    _source(c, box, (0.0, H * 0.05), P["pitch"], [(1.0, 1.0, 0.02)], P["level"], [[R6(P["on_at"]), 1.0]], 0.0, hold=hold, show=P["show_waves"])


def build_clapper(c, P):
    # a wooden clapper (slapstick): two hardwood boards that clap shut. A sharp click: the boards' plate modes near 1-4 kHz dying within
    # a few hundredths of a second; ≈ 95 dB at 1 m for a firm clap (provisional; a hand clap peaks ≈ 90-100 dB close by)
    c.slab("handle", 0.03, 0.12, 0.03, 0.0, 0.06, kind="static", words="the clapper's handle", material=c.mat(base="varnished hardwood", overrides={}))
    board = c.slab("boards", 0.05, 0.30, 0.06, 0.0, 0.27, kind="static", words="two wooden boards that clap", material=c.mat(base="varnished hardwood", overrides={}))
    partials = [(1.0, 1.0, 0.015), (1.63, 0.8, 0.012), (2.4, 0.6, 0.01), (3.3, 0.4, 0.008)]
    _source(c, board, (0.0, 0.08), 1200.0, partials, 95.0 * 1.0, _strikes(P), 0.001, show=P["show_waves"])


def build_belljar(c, P):
    # an electric bell inside a glass bell jar on a pump plate. Its clapper strikes the gong 18 times a second; the gong rings ≈ 1.5 kHz
    # with a bell's inharmonic overtones (2.76, 5.40 × provisional); ≈ 90 dB at 1 m in the open (electric bells 85-95 dB: provisional).
    # Inside the jar its sound reaches the room through the jar's glass (20 dB lower: provisional) in proportion to the air's pressure
    # (the gong drives the air it touches; no air, no sound wave), plus a little through the plate it stands on (55 dB under its own level:
    # provisional, so a classroom jar is never quite silent). The pump takes the air from `pump_at` over `pump_for` s down to `air_left` %.
    R = 0.11
    c.slab("plate", 0.32, 0.02, 0.32, 0.0, 0.01, kind="static", words="the vacuum pump's plate", look="steel", material=c.mat(base="steel", overrides={}))
    c.slab("bell-post", 0.01, 0.12, 0.01, 0.0, 0.08, kind="static", words="the bell's post", look="steel", material=c.mat(base="steel", overrides={}))
    gong = c.ball("gong", 0.035, 0.0, 0.16, kind="static", words="the bell's gong", look="steel", material=c.mat(base="steel", overrides={}))
    for side in (-1, 1):
        c.slab(f"glass-{'left' if side < 0 else 'right'}", 0.004, 0.26, 2 * R, side * (R - 0.002), 0.15, kind="static", words="the bell jar's glass",
               look="glass", material=c.mat(base="glass", overrides={}))
    c.slab("glass-top", 2 * R, 0.004, 2 * R, 0.0, 0.282, kind="static", words="the bell jar's glass top", look="glass", material=c.mat(base="glass", overrides={}))
    end = P["pump_at"] + P["pump_for"]
    ring = {"rate": 18.0, "from": R6(P["ring_at"]), "until": 1e9}
    jar = {"from": 100.0, "to": R6(P["air_left"]), "t0": R6(P["pump_at"]), "t1": R6(end), "glass": 20.0, "base": 55.0}
    partials = [(1.0, 1.0, 0.25), (2.76, 0.5, 0.15), (5.40, 0.25, 0.08)]
    _source(c, gong, (0.0, 0.0), P["pitch"], partials, 90.0, [], 0.0001, ring=ring, jar=jar, show=P["show_waves"])


# glass bottles (typical sizes: provisional): nominal volume (m³), body height, outer radius, glass wall, neck bore radius, neck length (m)
BOTTLES = {"330 ml": (0.00033, 0.17, 0.031, 0.0025, 0.0095, 0.06), "500 ml": (0.0005, 0.18, 0.036, 0.0028, 0.0095, 0.07),
           "750 ml": (0.00075, 0.21, 0.038, 0.003, 0.0095, 0.09)}
GLASS = (70e9, 2500.0, 0.22)    # soda-lime glass: E (Pa), ρ (kg/m³), ν [CRC]


def bottle_pitch(size, fill, play, temp=20.0):
    """A glass bottle's note. Tapped: its wall's ring mode n = 2 (Rayleigh's inextensible ring, f = (1/2π)(a/R²)·√(E/(12ρ(1−ν²)))·n(n²−1)/√(n²+1),
    a the wall, R its mean radius [Rossing §2.10]), lowered by the water loading the wall: (f₀/f)² = 1 + (ρ_w·R)/(5ρ_g·a)·(h/H)⁴ (after French,
    Am. J. Phys. 51, 688 (1983), his α taken as 1: provisional): more water, lower. Blown: the air in it is a Helmholtz resonator,
    f = (c/2π)·√(A/(V·L')), A the neck's bore, V the air left, L' the neck plus 1.45 bore radii of end corrections [KIN §10.8]: more water, higher."""
    V, H, R0, a, rn, Ln = BOTTLES[size]
    E, rho, nu = GLASS
    if play == "blow":
        c = 331.3 * math.sqrt(1 + temp / 273.15)
        A = math.pi * rn * rn
        return c / (2 * math.pi) * math.sqrt(A / (V * (1 - fill) * (Ln + 1.45 * rn)))
    R = R0 - a / 2
    ring = (a / (R * R)) * math.sqrt(E / (12 * rho * (1 - nu * nu))) * 6 / math.sqrt(5) / (2 * math.pi)
    h4 = fill * fill * fill * fill
    return ring / math.sqrt(1 + (998.2 * R) / (5 * rho * a) * h4)


def build_bottle(c, P):
    V, H, R0, a, rn, Ln = BOTTLES[P["size"]]
    play = P["play"]
    f = bottle_pitch(P["size"], P["fill"], play, c.settings["room_temp"])
    glass = c.mat(base="glass", overrides={})
    body = c.slab("body", 2 * R0, H, 2 * R0, 0.0, H / 2, kind="static", words="a glass bottle", look="glass", material=glass)
    # the shoulder (a tapered slab) and the neck
    n2 = rn + 0.004
    c.poly("shoulder", [(-R0, -0.02), (R0, -0.02), (n2, 0.02), (-n2, 0.02)], 2 * R0, 0.0, H + 0.02, kind="static", words="the bottle's shoulder", look="glass",
           material=glass)
    neck = c.slab("neck", 2 * (rn + 0.004), Ln, 2 * (rn + 0.004), 0.0, H + 0.04 + Ln / 2, kind="static", words="the bottle's neck", look="glass", material=glass)
    if play == "blow":
        # a steady breath across the neck for `blow_for` s: a pure, breathy note (70 dB at 1 m: provisional)
        _source(c, neck, (0.0, Ln / 2), f, [(1.0, 1.0, 0.06), (2.0, 0.12, 0.04)], 70.0, _strikes(P), 0.0, hold=P["blow_for"], show=P["show_waves"])
    else:
        # tapped with a spoon: a clear ring dying away in ≈ 0.25 s (65 dB at 1 m: provisional)
        _source(c, body, (R0, H * 0.3), f, [(1.0, 1.0, 0.25), (2.83, 0.35, 0.12)], 65.0, _strikes(P), 0.00002,
                hit={"solids": [body], "momentum": 0.02, "max": 3.0}, show=P["show_waves"])


def _sources():
    common = dict(dynamic=False, module="waves", readouts=SOURCE_READOUTS())
    register(ItemType("tuning-fork", "Tuning fork", CAT, build_fork,
                      props=[Prop("pitch", "Pitch", 440.0, 128.0, 2048.0, 0.1, "Hz",
                                  "Its note. School sets: 256 (C), 288 (D), 320 (E), 341.3 (F), 384 (G), 426.7 (A), 480 (B), 512 (C'); A4 = 440 [ISO 16]. Higher pitch = shorter prongs"),
                             Prop("box", "On a resonance box", True, kind="bool", help="Standing on its wooden sound box: louder, rings shorter")] + STRIKE_PROPS(),
                      tags=["sound", "pitch", "vibration", "note", "frequency", "fork", "ring", "hum", "music"],
                      description="A steel tuning fork standing on its wooden resonance box. Struck at its strike time it hums one steady note (its pitch) that slowly dies away; "
                                  "a ball or a ping-pong ball touching a prong is knocked away by the vibration, and one that hits a prong makes it ring.",
                      source="Prongs: a clamped-free bar, f = 1.875²/(2π)·(t/L²)·√(E/(12ρ)), steel, 6 mm prongs (Fletcher & Rossing 1998); clang mode 6.25×, decay times "
                             "(Rossing, Science of Sound); levels provisional.",
                      anchor="the middle of the bottom of its box", facts="440 Hz · 10.5 cm prongs · rings ≈ 2 s on its box", **common))
    register(ItemType("plucked-ruler", "Plucked ruler", CAT, build_ruler,
                      props=[Prop("overhang", "Overhang", 0.15, 0.05, 0.25, 0.005, "m", "How far it sticks out past the table's edge: shorter = higher pitch (pitch ∝ 1/overhang²)"),
                             Prop("ruler", "Ruler", "plastic", kind="choice", choices=["plastic", "steel", "wood"], help="Acrylic 3 mm, spring steel 0.5 mm, or wood 4 mm"),
                             Prop("edge", "Table edge", "right", kind="choice", choices=["right", "left"], help="Which edge of the table it sticks out over")]
                      + STRIKE_PROPS(what="Pluck at"),
                      tags=["sound", "pitch", "vibration", "twang", "ruler", "overhang", "cantilever", "buzz"],
                      description="A 30 cm ruler clamped to the table's right edge (or its left edge: edge left) with part of it sticking out past it; it clamps itself to that edge wherever its x is. Plucked, its free end "
                                  "buzzes up and down; the shorter the part that sticks out, the faster it vibrates and the higher its note.",
                      source="A clamped-free bar: f₁ = 1.875²/(2π)·(t/L²)·√(E/(12ρ)) (Fletcher & Rossing 1998): acrylic 3 mm ≈ 0.795/L² Hz (15 cm → 35 Hz, 10 cm → 79 Hz).",
                      anchor="the table's edge, under the ruler (the overhang sticks out past it: right, or left with edge left)", facts="15 cm over the edge · 35 Hz", **common))
    register(ItemType("drum", "Drum", CAT, build_drum,
                      props=[Prop("diameter", "Diameter", 0.30, 0.20, 0.40, 0.01, "m"), Prop("height", "Height", 0.16, 0.08, 0.40, 0.01, "m", "Its shell's height: where its head is"),
                             Prop("tension", "Head tension", 1000.0, 200.0, 5000.0, 10.0, "N/m", "How tight the head is: tighter = higher pitch (pitch ∝ √tension)"),
                             Prop("strike_where", "Struck at", "halfway", kind="choice", choices=["middle", "halfway", "near the rim"], help="Where the stick hits the head")]
                      + STRIKE_PROPS(),
                      tags=["sound", "drum", "beat", "loud", "louder", "vibration", "rice", "membrane", "percussion", "hit"],
                      description="A hand drum standing on the table. Struck, its head vibrates and booms; rice or light things lying on the head jump up (harder hit, higher "
                                  "jump), and a ball dropped on it sounds it too.",
                      source="Ideal membrane f01 = 2.405/(2πa)·√(T/σ) (Kinsler et al. 2000), 0.19 mm Mylar head (0.264 kg/m²); overtones 1.59, 2.14, 2.30, 2.65, 2.92 ×; level and "
                             "head motion provisional.",
                      anchor="the middle of its bottom", facts="Ø 30 cm · 157 Hz · ≈ 85 dB at 1 m", **common))
    register(ItemType("monochord", "Monochord (guitar string)", CAT, build_monochord,
                      props=[Prop("length", "String length", 0.648, 0.3, 1.0, 0.001, "m", "Between the bridges: half as long = an octave higher"),
                             Prop("tension", "Tension", 73.0, 20.0, 120.0, 0.5, "N", "How hard it is pulled: 4 × the tension = an octave higher"),
                             Prop("gauge", "Weight per length", 0.40, 0.4, 6.0, 0.01, "g/m", "Heavier (thicker) string = lower pitch; 0.40 g/m is a guitar's high E"),
                             Prop("string", "String", "steel", kind="choice", choices=["steel", "nylon"]),
                             Prop("pluck_where", "Plucked", "near a bridge", kind="choice", choices=["middle", "near a bridge"])] + STRIKE_PROPS(what="Pluck at"),
                      tags=["sound", "string", "guitar", "pitch", "octave", "tension", "monochord", "sonometer", "pluck", "music"],
                      description="One string stretched between two bridges over a wooden sound box (a monochord, like one guitar string). Plucked, it sounds a note set by its "
                                  "length, tension and weight: f = √(T/μ)/(2L).",
                      source="f = (1/2L)·√(T/μ) (Kinsler et al. 2000); high-E check 0.648 m, 0.40 g/m, 73 N → 329.6 Hz; stiffness B = π³Ed⁴/(64TL²) (Fletcher 1964).",
                      anchor="the middle of the bottom of its box", facts="329.6 Hz (high E) · 64.8 cm", **common))
    register(ItemType("rubber-band", "Rubber band on a box", CAT, build_band,
                      props=[Prop("width", "Band width", 3.0, 1.0, 10.0, 0.5, "mm", "Wider (thicker) band = heavier = lower pitch (at the same pull)"),
                             Prop("length", "Stretched length", 0.25, 0.1, 0.4, 0.005, "m", "Shorter = higher pitch"),
                             Prop("tension", "Tension", 2.0, 0.2, 20.0, 0.1, "N",
                                  "How hard it pulls: stretched tighter = higher pitch. At most what the band holds before it snaps (about 6 × its length: a 3 mm band ≈ 7 N, 1 mm ≈ 2.4 N)")]
                      + STRIKE_PROPS(what="Pluck at"),
                      tags=["sound", "rubber band", "guitar", "shoebox", "pitch", "thickness", "pluck", "string"],
                      description="A rubber band stretched over an open shoebox (a shoebox guitar). Plucked, it twangs: thicker bands sound lower, tighter or shorter ones higher.",
                      source="f = (1/2L)·√(T/μ); natural rubber 930 kg/m³ (CRC), neo-Hookean G 0.5 MPa, breaks at 6 × its length (Treloar 1975): a band 0.8 mm × "
                             "width stretched as far as its pull needs (μ = ρ·A0/λ); ring time and level provisional.",
                      anchor="the middle of the bottom of its box", facts="3 mm band · 2 N · ≈ 83 Hz", **common))
    register(ItemType("xylophone-bar", "Xylophone bar", CAT, build_bar,
                      props=[Prop("length", "Length", 0.20, 0.08, 0.40, 0.001, "m", "Shorter bar = higher note (pitch ∝ 1/length²)"),
                             Prop("thickness", "Thickness", 6.0, 3.0, 12.0, 0.5, "mm"),
                             Prop("metal", "Material", "aluminium", kind="choice", choices=["aluminium", "steel", "rosewood"])] + STRIKE_PROPS(),
                      tags=["sound", "xylophone", "glockenspiel", "bar", "pitch", "note", "music", "chime"],
                      description="One xylophone (glockenspiel) bar on felt pads. Struck, it rings a clear note; a shorter bar is higher (length ÷ √2 = an octave up). A ball that "
                                  "hits it rings it too.",
                      source="Free-free bar f₁ = 4.730²/(2π)·(t/L²)·√(E/(12ρ)) (Fletcher & Rossing 1998): aluminium 6 mm × 20 cm → 779 Hz.",
                      anchor="the middle of the bottom of its frame", facts="779 Hz (aluminium, 6 mm × 20 cm)", **common))
    register(ItemType("glass-bottle", "Glass bottle with water (a note)", CAT, build_bottle,
                      props=[Prop("size", "Size", "500 ml", kind="choice", choices=list(BOTTLES)),
                             Prop("fill", "Water", 0.3, 0.0, 0.9, 0.01, "of full", "How full of water: tapped, more water = lower; blown, more water = higher"),
                             Prop("play", "Played by", "tap", kind="choice", choices=["tap", "blow"], help="Tapped with a spoon (the glass rings) or blown across the top (the air in it sounds)"),
                             Prop("blow_for", "Blow for", 1.0, 0.1, 10.0, 0.1, "s")] + STRIKE_PROPS(),
                      tags=["bottle", "water", "pitch", "music", "xylophone", "blow", "tap", "glass", "note", "sound"],
                      description="A glass bottle with some water in it, standing on the table (a bottle xylophone's note). Tapped, its glass rings: the more water, "
                                  "the LOWER the note. Blown across the top, the air inside sounds: the more water (the less air), the HIGHER the note.",
                      source="Tapped: Rayleigh's ring mode of the wall lowered by the water (after French, Am. J. Phys. 51, 688 (1983)); blown: a Helmholtz resonator "
                             "(Kinsler et al. 2000 §10.8); bottle sizes and levels provisional.",
                      anchor="the middle of its bottom", facts="500 ml, 30 % full: tapped ≈ 1.56 kHz, blown ≈ 170 Hz", **common))
    register(ItemType("rice", "Rice grains", CAT, build_rice, module="waves", material="rice", materials=["rice"],
                      props=[Prop("count", "Grains", 12, 1, 40, 1, "", kind="int"), Prop("spread", "Spread", 0.12, 0.0, 0.4, 0.005, "m", "How wide the row of grains is")],
                      tags=["rice", "grains", "sand", "vibration", "jump", "drum", "bounce", "seeds"],
                      description="A few grains of rice in a row, to lay on a drum's head (or a speaker): when the drum is struck they jump, showing that sound is vibration.",
                      source="A long-grain kernel ≈ 20-25 mg at ≈ 1450 kg/m³ (Mohsenin 1986), built as a 3 mm ball of the same volume.",
                      anchor="the middle of the row's bottom", facts="12 grains · 20 mg each"))
    register(ItemType("speaker", "Speaker (tone)", CAT, build_speaker,
                      props=[Prop("pitch", "Pitch", 440.0, 20.0, 20000.0, 1.0, "Hz", "The tone it plays (people hear about 20 to 20 000 Hz)"),
                             Prop("level", "Loudness 1 m away", 70.0, 40.0, 110.0, 1.0, "dB", "Conversation ≈ 60 dB, a busy classroom ≈ 70 dB"),
                             Prop("on_at", "Starts at", 0.5, 0.0, 20.0, 0.05, "s"), Prop("on_for", "Plays for", 2.0, 0.0, 20.0, 0.05, "s", "0 = until the end"),
                             Prop("show_waves", "Sound lines", True, kind="bool")],
                      tags=["sound", "speaker", "tone", "pitch", "loudness", "frequency", "generator", "beep", "loudspeaker"],
                      description="A small speaker box playing one steady tone at the pitch and loudness you set (a tone generator).",
                      source="A pure tone; its level 1 m away is the setting (typical levels: conversation 60 dB, a busy classroom 65-75 dB [NIOSH]).",
                      anchor="the middle of its bottom", facts="440 Hz · 70 dB at 1 m", **common))
    register(ItemType("clapper", "Wooden clapper", CAT, build_clapper,
                      props=STRIKE_PROPS(what="Clap at"),
                      tags=["sound", "clap", "echo", "click", "slapstick", "loud", "short"],
                      description="Two wooden boards that clap shut: one short, sharp, loud click (good for hearing an echo off a far wall).",
                      source="Hardwood plate modes near 1-4 kHz dying within ≈ 15 ms; ≈ 95 dB at 1 m (provisional).",
                      anchor="the middle of the bottom of its handle", facts="a sharp click · ≈ 95 dB at 1 m", **common))
    register(ItemType("bell-jar", "Bell in a jar", CAT, build_belljar,
                      props=[Prop("pitch", "Bell pitch", 1500.0, 300.0, 4000.0, 10.0, "Hz"), Prop("ring_at", "Rings from", 0.2, 0.0, 20.0, 0.05, "s"),
                             Prop("pump_at", "Pump starts", 1.0, 0.0, 20.0, 0.1, "s"), Prop("pump_for", "Pumping takes", 4.0, 0.1, 20.0, 0.1, "s"),
                             Prop("air_left", "Air left", 0.0, 0.0, 100.0, 1.0, "%", "How much air the pump leaves in the jar (0 = a vacuum)"),
                             Prop("show_waves", "Sound lines", True, kind="bool")],
                      tags=["vacuum", "bell", "jar", "air", "medium", "no sound", "pump", "sound needs air"],
                      description="An electric bell ringing inside a glass jar on a vacuum pump's plate. As the pump takes the air out, the bell is heard less and less: "
                                  "sound needs air (a medium) to travel. A little still gets out through the plate.",
                      source="Sound radiated into the jar's air ∝ its pressure; jar glass 20 dB, the plate's path 55 dB under the bell (provisional calibrations).",
                      anchor="the middle of the bottom of its plate", facts="rings at 18 strikes/s · pumped empty from 1 s to 5 s", **common))


# ---------------------------------------------------------------- listeners and reflectors
WEIGHTINGS = {"dB(A)": "A", "dB(Z)": "Z"}
RESPONSES = {"fast": 0.125, "slow": 1.0}


def build_meter(c, P):
    h = P["height"]
    # a handheld sound level meter on a small tripod; its microphone (the ball on top) is where it listens
    c.slab("tripod", 0.10, h - 0.12, 0.10, 0.0, (h - 0.12) / 2, kind="static", words="the meter's tripod", look="steel", material=c.mat(base="steel", overrides={}))
    body = c.slab("body", 0.07, 0.10, 0.035, 0.0, h - 0.07, kind="static", words="a sound level meter", look="plastic", material=c.mat(base="ABS plastic", overrides={}))
    c.ball("mic", 0.011, 0.0, h - 0.011, kind="static", words="the meter's microphone", look="steel", material=c.mat(base="steel", overrides={}))
    # (the microphone's middle, in the body's frame: 0.059 m over the body's middle)
    c.process("sound", "meter", role="meter", solid=body, at={"x": 0.0, "y": 0.059}, weighting=WEIGHTINGS[P["weighting"]],
              response=RESPONSES[P["response"]], floor=R6(P["room"]), listen="touch" if P["listen"] == "touching" else "air")


def build_hydrophone(c, P):
    # a hydrophone: an underwater microphone (a small probe on its cable) hung from a lab stand's arm into a tank's water, its reading on a
    # little box at the stand's foot. The arm reaches over a tank's wall; the probe hangs at `probe_height` over what the stand stands on.
    ph, reach = P["probe_height"], P["reach"]
    top = max(ph + 0.12, P["arm_height"])
    c.slab("rod", 0.012, top, 0.012, 0.0, top / 2, kind="static", words="the hydrophone's stand", look="steel", material=c.mat(base="steel", overrides={}))
    c.slab("arm", reach, 0.01, 0.01, reach / 2, top - 0.005, kind="static", words="the stand's arm", look="steel", material=c.mat(base="steel", overrides={}))
    c.slab("display", 0.08, 0.05, 0.06, -0.06, 0.025, kind="static", words="the hydrophone's meter box", look="plastic", material=c.mat(base="ABS plastic", overrides={}))
    probe = c.ball("probe", 0.008, reach, ph, kind="static", words="a hydrophone probe", look="rubber", material=c.mat(base="steel", overrides={}))
    c.process("sound", "meter", role="meter", solid=probe, at={"x": 0.0, "y": 0.0}, weighting=WEIGHTINGS[P["weighting"]], response=RESPONSES[P["response"]],
              floor=R6(P["room"]), listen="water")


# an oscilloscope's screen: 10 squares across, 8 up (a bench scope's graticule); how long one square across lasts, and how much sound
# pressure one square up is
SCOPE_TIME = {"0.5 ms a square": 0.0005, "1 ms a square": 0.001, "2 ms a square": 0.002, "5 ms a square": 0.005, "10 ms a square": 0.01}
SCOPE_SCALE = {"0.01 Pa a square": 0.01, "0.02 Pa a square": 0.02, "0.05 Pa a square": 0.05, "0.1 Pa a square": 0.1, "0.2 Pa a square": 0.2,
               "0.5 Pa a square": 0.5, "1 Pa a square": 1.0}


def build_scope(c, P):
    # a bench oscilloscope with its microphone on a little stand beside it: the screen draws the sound's pressure at the microphone against
    # time. The microphone is a meter (flat, dB(Z), fast); the trace is the view's, from its readings: the wave's height from the level
    # (p = 20 µPa · 10^(L/20) rms, × √2 at a sine's peak), how close the waves are from the pitch (f × the screen's 10 squares of time)
    c.slab("body", 0.30, 0.16, 0.22, 0.0, 0.08, kind="static", words="an oscilloscope", look="plastic", material=c.mat(base="ABS plastic", overrides={}))
    mx = 0.21 if P["mic_side"] == "right" else -0.21
    mh = P["mic_height"]
    c.slab("stand", 0.008, mh - 0.011, 0.008, mx, (mh - 0.011) / 2, kind="static", words="the oscilloscope microphone's stand", look="steel",
           material=c.mat(base="steel", overrides={}))
    mic = c.ball("mic", 0.011, mx, mh, kind="static", words="the oscilloscope's microphone", look="steel", material=c.mat(base="steel", overrides={}))
    c.process("sound", "meter", role="meter", solid=mic, at={"x": 0.0, "y": 0.0}, weighting="Z", response=0.125, floor=R6(P["room"]), listen="air")


def build_panel(c, P):
    H, T = P["height"], P["thickness"]
    look = {"foam": "foam", "curtain": "carpet", "carpet": "carpet", "cork board": "cork"}[P["surface"]]
    base = {"foam": "foam", "curtain": "carpet", "carpet": "carpet", "cork board": "cork"}[P["surface"]]
    sid = c.slab("panel", T, H, 0.6, 0.0, H / 2, kind="static", words=f"a {P['surface']} sound panel", look=look, material=c.mat(base=base, overrides={}))
    c.process("sound", "echo", role="wall", solid=sid, a={"x": 0.0, "y": R6(-H / 2)}, b={"x": 0.0, "y": R6(H / 2)}, absorption=ABSORB[P["surface"]])


# share of the sound energy a surface takes in at 500 Hz [EVEREST]: 50 mm acoustic foam ≈ 0.8 (manufacturers' data: provisional), heavy
# velour curtain 0.49, heavy carpet 0.14 (on concrete), cork board ≈ 0.2 (provisional); the existing wall: solid wood ≈ 0.1 (provisional),
# steel 0.03
ABSORB = {"foam": 0.8, "curtain": 0.49, "carpet": 0.14, "cork board": 0.2}
WALL_ABSORB = {"steel": 0.03, "varnished hardwood": 0.1, "domino wood": 0.1}


def _listeners():
    register(ItemType("sound-meter", "Sound level meter", CAT, build_meter, dynamic=False, module="waves",
                      props=[Prop("height", "Microphone height", 0.30, 0.15, 1.6, 0.01, "m", "Its microphone's height above what it stands on"),
                             Prop("weighting", "Reads", "dB(A)", kind="choice", choices=list(WEIGHTINGS), help="dB(A) weighs sounds as ears hear them; dB(Z) leaves them as they are"),
                             Prop("response", "Response", "fast", kind="choice", choices=list(RESPONSES), help="fast: 0.125 s; slow: 1 s"),
                             Prop("room", "Quiet room level", 35.0, 0.0, 70.0, 1.0, "dB", "What it reads with nothing sounding (an empty classroom ≈ 35 dB [ANSI S12.60])"),
                             Prop("listen", "Listens", "in the air", kind="choice", choices=["in the air", "touching"],
                                  help="touching: pressed to the rod, rail or table it touches, it also hears what that solid carries")],
                      readouts=[Readout("peak", "Loudest", "dB", 1, "The highest reading so far"), Readout("level", "Reading", "dB", 1, "What it reads now"),
                                Readout("pitch", "Pitch heard", "Hz", 1, "The note it hears most now (0: nothing over the room's level)"),
                                Readout("heard", "First heard", "s", 3, "When it first read 3 dB over the quiet room (−1: not yet)"),
                                Readout("echo", "Echo after", "s", 3, "How long after the first sound its first echo arrived (−1: none)")],
                      tags=["sound meter", "decibel", "dB", "loudness", "microphone", "listener", "measure", "noise", "instrument", "ear"],
                      description="A sound level meter on a small tripod: the listener. It reads how loud it is where its microphone is (dB), the loudest so far, the pitch it "
                                  "hears, when a sound first reached it and how long after it an echo came back. Sound gets 6 dB quieter for every doubling of distance.",
                      source="Levels by spherical spreading (−20·log10 r) along every path (Kinsler et al. 2000), A-weighting and fast/slow time weighting (IEC 61672-1); "
                             "speed of sound 331.3·√(1 + T/273.15) m/s in the room's air.",
                      anchor="the middle of the bottom of its tripod", facts="dB(A), fast · quiet room 35 dB"))
    register(ItemType("hydrophone", "Hydrophone (underwater microphone)", CAT, build_hydrophone, dynamic=False, module="waves",
                      props=[Prop("probe_height", "Probe height", 0.08, 0.01, 0.8, 0.005, "m", "How high its probe hangs over what the stand stands on: put it under the water"),
                             Prop("reach", "Arm reach", 0.25, 0.05, 0.6, 0.01, "m", "How far the arm reaches out (to the right) over a tank's wall"),
                             Prop("arm_height", "Arm height", 0.4, 0.1, 1.2, 0.01, "m", "Over the tank's rim"),
                             Prop("weighting", "Reads", "dB(Z)", kind="choice", choices=list(WEIGHTINGS)),
                             Prop("response", "Response", "fast", kind="choice", choices=list(RESPONSES)),
                             Prop("room", "Quiet level", 30.0, 0.0, 70.0, 1.0, "dB", "What it reads with nothing sounding")],
                      readouts=[Readout("peak", "Loudest", "dB", 1), Readout("level", "Reading", "dB", 1), Readout("pitch", "Pitch heard", "Hz", 1),
                                Readout("heard", "First heard", "s", 3, "When it first read 3 dB over its quiet level (−1: not yet)")],
                      tags=["hydrophone", "underwater", "water", "microphone", "sound in water", "listener", "medium"],
                      description="An underwater microphone hung from a lab stand's arm into a water tank (the Liquids module's). Under water it hears a sound "
                                  "made in the same water straight through it, at 1481 m/s (over 4 × faster than in air); a sound from the air reaches it only "
                                  "weakly, across the surface. Put the stand beside the tank and its probe under the water.",
                      source="Sound speed in fresh water 1481 m/s at 20 °C, sea water 1500 (Kinsler et al. 2000, App. A10); air to water: ≈ 0.1 % of the energy "
                             "crosses (−30 dB, provisional).",
                      anchor="the middle of the bottom of its stand", facts="fresh water: 1481 m/s"))
    register(ItemType("oscilloscope", "Oscilloscope (sound wave screen)", CAT, build_scope, dynamic=False, module="waves",
                      props=[Prop("time_base", "Time a square", "1 ms a square", kind="choice", choices=list(SCOPE_TIME),
                                  help="How long one square across the screen lasts (10 squares across): longer shows more waves"),
                             Prop("scale", "Pressure a square", "0.1 Pa a square", kind="choice", choices=list(SCOPE_SCALE),
                                  help="How much sound pressure one square up is: smaller draws the same sound taller"),
                             Prop("mic_height", "Microphone height", 0.2, 0.05, 1.0, 0.01, "m", "Its microphone's height above what the scope stands on"),
                             Prop("mic_side", "Microphone at", "right", kind="choice", choices=["right", "left"],
                                  help="Which side of the scope its microphone stands, 21 cm from the scope's middle"),
                             Prop("room", "Quiet room level", 35.0, 0.0, 70.0, 1.0, "dB", "What its microphone reads with nothing sounding")],
                      readouts=[Readout("peak", "Loudest", "dB", 1, "The highest reading so far (flat, dB(Z))"), Readout("level", "Reading", "dB", 1, "What it reads now"),
                                Readout("pitch", "Pitch heard", "Hz", 1, "The note it hears most now: how close its waves are (0: nothing over the room's level)"),
                                Readout("heard", "First heard", "s", 3, "When it first read 3 dB over the quiet room (−1: not yet)")],
                      tags=["oscilloscope", "scope", "waveform", "sound wave", "amplitude", "frequency", "wavelength", "trace", "graph", "screen", "microphone",
                            "loudness", "pitch", "listener"],
                      description="An oscilloscope with its microphone on a little stand beside it: its screen draws the sound wave the microphone hears, "
                                  "pressure against time. A louder sound draws taller waves (a bigger amplitude); a higher sound draws them closer together "
                                  "(more waves across: a higher frequency). Its microphone also reads like a sound meter (flat dB, fast).",
                      source="Sound pressure p = 20 µPa · 10^(L/20) rms, × √2 at a sine's peak (Kinsler et al. 2000); a bench oscilloscope's graticule of "
                             "10 × 8 squares.",
                      anchor="the middle of the bottom of the scope", facts="1 ms a square · 0.1 Pa a square"))
    register(ItemType("sound-panel", "Sound panel", CAT, build_panel, dynamic=False, module="waves",
                      props=[Prop("height", "Height", 1.2, 0.2, 3.0, 0.01, "m"), Prop("thickness", "Thickness", 0.05, 0.01, 0.2, 0.005, "m"),
                             Prop("surface", "Surface", "foam", kind="choice", choices=list(ABSORB), help="How much sound it soaks up: foam most, then curtain, cork, carpet")],
                      tags=["echo", "absorb", "foam", "curtain", "soundproof", "soft wall", "panel", "reflect"],
                      description="A soft panel that soaks up sound (acoustic foam, a curtain, carpet, cork) standing on the table or floor. A hard wall (the Wall item) "
                                  "reflects sound back as an echo; this panel sends back little.",
                      source="Absorption coefficients at 500 Hz (Everest & Pohlmann 2009): foam ≈ 0.8, curtain 0.49, cork ≈ 0.2, carpet 0.14.",
                      anchor="the middle of its bottom", facts="foam: takes in 80 % of the sound"))


def _build_hook(sb, scene):
    """With any sound in the scene: walls reflect it (role wall), rods, rails, planks and the table carry it to a meter that touches them
    (role carrier), and circuits' buzzers sound (role buzzer). Nothing at all for a scene without sound sources or meters."""
    if not any(p.get("kind") == "sound" for p in sb.processes) and not any(i.get("type") == "buzzer" for i in sb.scene_items.values()):
        return
    type_of = {iid: it.get("type") for iid, it in sb.scene_items.items()}
    touch = any(p.get("kind") == "sound" and p.get("role") == "meter" and p.get("listen") == "touch" for p in sb.processes)
    wet = any(p.get("kind") == "sound" and p.get("role") == "meter" and p.get("listen") == "water" for p in sb.processes)
    added = []
    if wet:
        # (the liquids module's water bodies: a liquid's top is its floor + its layers; fresh water 1481 m/s, salt or sea water 1500 [KIN A10])
        for p in list(sb.processes):
            if p.get("kind") != "liquid" or not p.get("layers"):
                continue
            top = p["floor"]
            for layer in p["layers"]:
                top = top + layer["height"]
            words = " ".join(str(layer.get("words", "")) for layer in p["layers"])
            added.append({"kind": "sound", "id": f"{p['item']}/underwater", "item": p["item"], "role": "water", "x0": p["x0"], "x1": p["x1"],
                          "floor": p["floor"], "top": R6(top), "speed": 1500.0 if ("salt" in words or "sea" in words) else 1481.0})
    for s in sb.solids:
        t = type_of.get(s["item"])
        part = s["id"].split("/", 1)[1] if "/" in s["id"] else s["id"]
        if t == "wall" and part == "wall" and not s.get("hidden_3d"):
            # (a see-through safety wall, hidden in the picture, is not a wall a sound meets: only walls one can see reflect sound)
            h = s["body"]["height"]
            P = props_of(sb.scene_items[s["item"]])
            added.append({"kind": "sound", "id": f"{s['item']}/echo", "item": s["item"], "role": "wall", "solid": s["id"],
                          "a": {"x": 0.0, "y": R6(-h / 2)}, "b": {"x": 0.0, "y": R6(h / 2)}, "absorption": WALL_ABSORB.get(P.get("material"), 0.05)})
        elif touch and s["body"]["kind"] == "slab" and t in CARRIERS and part in CARRIERS[t]:
            w, h = s["body"]["width"], s["body"]["height"]
            P = props_of(sb.scene_items[s["item"]])
            mat = P.get("material", "varnished hardwood")
            speed, label = CARRIER_SPEED.get(mat, (4000.0, "wood"))
            long_x = w >= h
            a = {"x": R6(-w / 2), "y": 0.0} if long_x else {"x": 0.0, "y": R6(-h / 2)}
            b = {"x": R6(w / 2), "y": 0.0} if long_x else {"x": 0.0, "y": R6(h / 2)}
            added.append({"kind": "sound", "id": f"{s['item']}/carry", "item": s["item"], "role": "carrier", "solid": s["id"], "a": a, "b": b,
                          "half": R6((h if long_x else w) / 2), "speed": speed, "gain": 10.0, "material": label})
    for iid, it in sb.scene_items.items():
        if it.get("type") != "buzzer" or "buzzer" not in TYPES:
            continue
        sol = next((s for s in sb.solids if s["item"] == iid), None)
        if sol is None:
            continue
        P = props_of(it)
        f0 = next((P[k] for k in ("tone", "pitch", "frequency", "tone_hz") if isinstance(P.get(k), (int, float)) and not isinstance(P.get(k), bool)), 2700.0)
        # an active piezo buzzer ≈ 85 dB at 10 cm, ≈ 65 dB at 1 m at its rated voltage (manufacturers' data, e.g. 12 mm piezo buzzers: provisional);
        # it sounds while circuits' reading "sound" (its loudness against full) is above zero, that loud
        added.append({"kind": "sound", "id": f"{iid}/buzz", "item": iid, "role": "buzzer", "solid": sol["id"], "at": {"x": 0.0, "y": 0.0}, "f0": R6(float(f0)),
                      "partials": [[1.0, 1.0, 0.02], [2.0, 0.3, 0.02], [3.0, 0.15, 0.02]], "lp1": 65.0, "on": ["sound", "sounding"]})
    sb.processes.extend(added)


# solids that carry sound to a meter pressed against them: rods, rails, planks, the table top; their bar speed [KIN Appendix A10]
CARRIERS = {"steel-rod": ("rod",), "wooden-rod": ("rod",), "steel-beam": ("plank", "beam"), "plank": ("plank",), "table": ("top",)}
CARRIER_SPEED = {"steel": (5050.0, "steel"), "aluminium": (5150.0, "aluminium"), "varnished hardwood": (4000.0, "wood"), "domino wood": (4000.0, "wood"),
                 "dark wood": (4000.0, "wood"), "glass": (5170.0, "glass"), "concrete": (3100.0, "concrete")}


# ---------------------------------------------------------------- waves on a rope and a Slinky
def build_rope(c, P):
    L, h = P["length"], P["height"]
    flat = P["lying"] == "on the floor"
    y = 0.02 if flat else h
    # the wave driver (a shaker on a post: no hand) at the left end, a post with a hook (fixed), a ring on a smooth pole (free), or the
    # rope running on off-stage (open) at the right
    c.slab("driver", 0.08, y + 0.04, 0.08, -0.04, (y + 0.04) / 2, kind="static", words="a wave driver on a post", look="dark wood",
           material=c.mat(base="varnished hardwood", overrides={}))
    c.slab("post", 0.04, y + 0.06, 0.04, L + 0.02, (y + 0.06) / 2, kind="static", words="a post holding the rope's far end", look="dark wood",
           material=c.mat(base="varnished hardwood", overrides={}))
    mass = P["weight"] * L
    # segments: one every 2.5 cm, and at least 10 to a wavelength of its shake (its lattice carries waves of 10 segments within 1 %), up to 800
    v = math.sqrt(P["tension"] / P["weight"])
    n = int(max(min(240, max(40, round(L / 0.025))), min(800, math.ceil(10 * L * P["frequency"] / v))))
    ribbon = P["ribbon"]
    # the rope's diameter from its weight: a braided rope ≈ 1000 kg/m³ of fibres and air (provisional): 1.1 cm at 0.1 kg/m; it lies on the table
    # (or floor) its posts stand on rather than go through it; the air drags it ½·ρ·C_d·d per metre (20 °C air 1.204 kg/m³ [CRC], C_d 1.2 [HOERNER])
    d = math.sqrt(4 * P["weight"] / (math.pi * 1000.0))
    fields = dict(line="rope", a={"x": R6(c.world(0.0, y)[0]), "y": R6(c.world(0.0, y)[1])}, b={"x": R6(c.world(L, y)[0]), "y": R6(c.world(L, y)[1])},
                  n=n, mass=R6(mass), tension=R6(P["tension"]), stiffness=R6(2000.0 * 4.0 / L), plane="flat" if flat else "vertical",
                  damping=R6(P["damping"]), drive={"mode": "wave" if P["shake"] == "keep shaking" else "pulse", "dir": "across", "amp": R6(P["amplitude"]),
                                                   "f": R6(P["frequency"]), "at": R6(P["shake_at"]), "cycles": int(P["cycles"])},
                  end=END[P["far_end"]], keep=40, floor=R6(c.oy + d / 2))
    if c.settings["air"]:
        fields["drag"] = R6(0.5 * 1.204 * 1.2 * d / P["weight"])
    if ribbon > 0:
        fields["ribbon"] = R6(ribbon)
    c.process("wave-line", "wave", **fields)


END = {"tied to the post": "fixed", "ring on a pole": "free", "runs on (no reflection)": "open"}


def build_slinky(c, P):
    L = P["length"]
    flat = P["lying"] == "on the floor"
    y = 0.035 if flat else P["height"]
    c.slab("driver", 0.08, y + 0.04, 0.08, -0.04, (y + 0.04) / 2, kind="static", words="a wave driver holding the Slinky's end", look="dark wood",
           material=c.mat(base="varnished hardwood", overrides={}))
    c.slab("post", 0.04, y + 0.06, 0.04, L + 0.02, (y + 0.06) / 2, kind="static", words="a post holding the Slinky's far end", look="dark wood",
           material=c.mat(base="varnished hardwood", overrides={}))
    # a metal Slinky: 67 mm across, ≈ 80 turns, 0.2 kg, its whole length closed ≈ 6 cm; spring constant of the whole spring ≈ 1 N/m
    # (spec waves.md; a toy Slinky's measured k is of order 1 N/m: provisional); stretched to L it pulls with T = k·(L − 6 cm)
    k, m = P["stiffness"], P["spring_mass"]
    T = k * (L - 0.06)
    along = P["push"] == "push and pull"
    # (its 80 turns are its segments: a real Slinky carries nothing shorter than a few turns either; its coils clash at its closed length,
    # 6 cm; held up, its 67 mm coils lie on the table or floor its posts stand on rather than go through it)
    fields = dict(line="slinky", a={"x": R6(c.world(0.0, y)[0]), "y": R6(c.world(0.0, y)[1])}, b={"x": R6(c.world(L, y)[0]), "y": R6(c.world(L, y)[1])},
                  n=80, mass=R6(m), tension=R6(T), stiffness=R6(k), plane="flat" if flat else "vertical", damping=R6(P["damping"]),
                  drive={"mode": "wave" if P["shake"] == "keep shaking" else "pulse", "dir": "along" if along else "across", "amp": R6(P["amplitude"]),
                         "f": R6(P["frequency"]), "at": R6(P["shake_at"]), "cycles": int(P["cycles"])},
                  end=END[P["far_end"]], keep=40, floor=R6(c.oy + 0.0335), closed=0.06)
    if P["ribbon"] > 0:
        fields["ribbon"] = R6(P["ribbon"])
    c.process("wave-line", "wave", **fields)


LINE_READOUTS = lambda: [Readout("speed", "Wave speed", "m/s", 2, "How fast a wave runs along it"), Readout("wavelength", "Wavelength", "m", 3, "speed ÷ frequency"),
                         Readout("frequency", "Frequency", "Hz", 2, "How many shakes a second"),
                         Readout("arrive", "Reached the far end", "s", 3, "When the wave first got to the far end (−1: not yet)"),
                         Readout("reflection", "Came back", "", 0, "−1 upside down, 1 the same way up, 0 nothing came back, −2 not yet"),
                         Readout("loops", "Standing loops", "", 0, "Loops of a standing wave over the last second (keep shaking)"),
                         Readout("ribbon_across_mm", "Ribbon up-down", "mm", 1, "How far the ribbon moved across (sideways or up and down)"),
                         Readout("ribbon_along_mm", "Ribbon along", "mm", 1, "How far the ribbon moved along the line")]


def _wave_lines():
    shake = [Prop("shake", "Shake", "one pulse", kind="choice", choices=["one pulse", "keep shaking"]),
             Prop("frequency", "Frequency", 3.0, 0.2, 20.0, 0.05, "Hz",
                  "Shakes per second (a pulse lasts one shake). A tied line shows n standing loops at f = n·v/(2L)"),
             Prop("amplitude", "Amplitude", 0.08, 0.005, 0.3, 0.005, "m", "How far the end is moved"),
             Prop("shake_at", "Shake at", 0.5, 0.0, 20.0, 0.05, "s"), Prop("cycles", "Shakes", 0, 0, 100, 1, "", "keep shaking: how many (0 = until the end)", kind="int"),
             Prop("far_end", "Far end", "tied to the post", kind="choice", choices=list(END),
                  help="tied: a pulse comes back upside down; a ring on a pole: the same way up; runs on: nothing comes back (those two on a line lying on the floor: held up, its free end hangs onto the table)"),
             Prop("ribbon", "Ribbon at", 0.5, 0.0, 1.0, 0.01, "", "Where along it a ribbon is tied (0 = no ribbon): watch it move without going anywhere"),
             Prop("damping", "Losses", 1.5, 0.0, 5.0, 0.05, "1/s",
                  "How fast its motion dies away: 1.5 is a real rope's (a standing wave settles in a few seconds, Q ≈ 10); 0 never settles")]
    register(ItemType("wave-rope", "Wave rope", CAT, build_rope, dynamic=False, module="waves",
                      props=[Prop("length", "Length", 4.0, 1.0, 8.0, 0.05, "m"), Prop("tension", "Tension", 10.0, 1.0, 100.0, 0.5, "N", "Pulled tighter = faster waves"),
                             Prop("weight", "Weight per metre", 0.1, 0.02, 1.0, 0.01, "kg/m", "A heavier rope carries slower waves (v = √(T/μ))"),
                             Prop("height", "Height", 0.6, 0.1, 1.5, 0.01, "m", "How high it is held"),
                             Prop("lying", "Lying", "held up", kind="choice", choices=["held up", "on the floor"], help="held up: it waves up and down; on the floor: side to side")] + shake,
                      readouts=LINE_READOUTS(),
                      tags=["wave", "rope", "pulse", "transverse", "standing wave", "reflection", "wavelength", "frequency", "amplitude", "energy"],
                      description="A long rope pulled tight between a wave driver (left) and a post (right). The driver flicks one pulse or keeps shaking; the wave runs along "
                                  "at √(tension ÷ weight per metre), reflects at the far end, and a ribbon tied on it only moves up and down: the wave carries energy, not the rope.",
                      source="v = √(T/μ) (Kinsler et al. 2000); a line of masses on the rope's tension, stepped by the module; standing waves at f_n = n·v/(2L).",
                      anchor="the bottom of the driver's post (the rope runs to the right)", facts="4 m · 10 N · 0.1 kg/m → 10 m/s"))
    register(ItemType("slinky", "Slinky", CAT, build_slinky, dynamic=False, module="waves",
                      props=[Prop("length", "Stretched to", 3.0, 1.0, 6.0, 0.05, "m"), Prop("spring_mass", "Mass", 0.2, 0.05, 0.6, 0.01, "kg", "The whole Slinky's mass"),
                             Prop("stiffness", "Spring constant", 1.0, 0.2, 5.0, 0.05, "N/m", "For the whole spring: stiffer = faster waves"),
                             Prop("push", "Moved", "push and pull", kind="choice", choices=["push and pull", "side to side"],
                                  help="push and pull: squeezes run along it (longitudinal, like sound); side to side: a transverse wave"),
                             Prop("height", "Height", 0.5, 0.1, 1.5, 0.01, "m", "When held up"),
                             Prop("lying", "Lying", "on the floor", kind="choice", choices=["on the floor", "held up"])] + shake,
                      readouts=LINE_READOUTS(),
                      tags=["slinky", "spring", "wave", "longitudinal", "compression", "transverse", "pulse", "sound model"],
                      description="A metal Slinky stretched on the floor between a driver and a post. Pushed and pulled, squeezes (compressions) run along it like sound in "
                                  "air; shaken side to side, a transverse wave runs along. Waves run at L·√(k/m).",
                      source="v = L·√(k/m) for a stretched Slinky (spring constant k of the whole spring, mass m); metal Slinky 0.2 kg, ≈ 80 turns, k ≈ 1 N/m (provisional).",
                      anchor="the bottom of the driver (the Slinky runs to the right)", facts="3 m · 0.2 kg · k 1 N/m → 6.7 m/s"))


# ---------------------------------------------------------------- the ripple tank
def build_tank(c, P):
    # water stays level: the tray is kept level however the item is turned (turned, it would spill), as a pendulum's hanger is
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0
    L, W, d = P["length"], P["width"], P["depth"]
    wall = 0.01
    stand = 0.05
    c.slab("base", L + 2 * wall, 0.006, W + 2 * wall, 0.0, stand + 0.003, kind="static", words="the ripple tank's glass bottom", look="glass",
           material=c.mat(base="glass", overrides={}))
    for side in (-1, 1):
        c.slab(f"end-{'left' if side < 0 else 'right'}", wall, 0.05, W + 2 * wall, side * (L / 2 + wall / 2), stand + 0.006 + 0.025, kind="static",
               words="the tank's end wall", look="plastic", material=c.mat(base="ABS plastic", overrides={}))
        c.slab(f"leg-{'left' if side < 0 else 'right'}", 0.03, stand, W, side * (L / 2 - 0.02), stand / 2, kind="static", words="the tank's leg", look="steel",
               material=c.mat(base="steel", overrides={}))
    x0, y0 = c.world(-L / 2, stand + 0.006 + d)
    x1, _ = c.world(L / 2, stand + 0.006 + d)
    sx = x0 + P["dipper_at"] * (x1 - x0)
    fields = dict(x0=R6(x0), x1=R6(x1), y=R6(y0), width=R6(W), depth=R6(d), f=R6(P["frequency"]), amp=R6(P["amplitude"] / 1000), at=R6(P["start_at"]),
                  source="point" if P["dipper"] == "point" else "bar", sx=R6(sx), near="beach", far="wall" if P["far_end"] == "wall" else "beach")
    if P["floater"] != "none":
        fields["floater"] = R6(x0 + P["floater_at"] * (x1 - x0))
        fields["floater_kind"] = P["floater"]
    c.process("ripples", "water", **fields)


def _tank():
    register(ItemType("ripple-tank", "Ripple tank", CAT, build_tank, dynamic=False, module="waves",
                      props=[Prop("length", "Length", 0.6, 0.3, 1.2, 0.01, "m"), Prop("width", "Width (front to back)", 0.4, 0.2, 0.8, 0.01, "m"),
                             Prop("depth", "Water depth", 0.01, 0.005, 0.03, 0.001, "m", "Deeper water: faster, longer waves"),
                             Prop("frequency", "Dipper frequency", 5.0, 2.0, 20.0, 0.1, "Hz", "Faster dipping = shorter waves (v = f·λ)"),
                             Prop("amplitude", "Dipper amplitude", 1.5, 0.5, 5.0, 0.1, "mm", "How far the dipper bobs: bigger waves carry more energy"),
                             Prop("dipper", "Dipper", "point", kind="choice", choices=["point", "bar"], help="point: circles spread out; bar: straight waves"),
                             Prop("dipper_at", "Dipper at", 0.1, 0.02, 0.98, 0.01, "", "Where along the tank (0 = left end)"),
                             Prop("far_end", "Far end", "beach", kind="choice", choices=["beach", "wall"], help="wall: the waves reflect; beach: soaked up"),
                             Prop("floater", "Floating", "duck", kind="choice", choices=["none", "cork", "duck"], help="A small floating toy that rides the waves"),
                             Prop("floater_at", "Floating at", 0.6, 0.05, 0.95, 0.01, "", "Where along the tank it floats"),
                             Prop("start_at", "Starts at", 0.5, 0.0, 20.0, 0.05, "s")],
                      readouts=[Readout("wavelength", "Wavelength", "m", 4), Readout("speed", "Wave speed", "m/s", 3), Readout("frequency", "Frequency", "Hz", 2),
                                Readout("reach", "Reached the far end", "s", 2, "When the first waves reached the far end (−1: not yet)"),
                                Readout("floater_bob_mm", "Floater bobs", "mm", 2, "How far the floater rises and falls over one wave"),
                                Readout("floater_drift", "Floater drift", "m", 4, "How far the floater has drifted on average (it bobs in place)")],
                      tags=["ripple", "water wave", "wave", "tank", "duck", "cork", "wavelength", "frequency", "energy", "floating"],
                      description="A shallow glass-bottomed tray of water with a motor-driven dipper at one end. The dipper's ripples run across the water; a floating duck or "
                                  "cork bobs up and down where it is while the waves pass (waves carry energy, not the water).",
                      source="Linear water waves ω² = (gk + σk³/ρ)·tanh(kh) (Lamb, Hydrodynamics 1932, §267; σ 0.0728 N/m), viscous decay 2νk²/c_g (Lamb §348); "
                             "a floater follows the water's orbit (A·coth(kh) along, A up).",
                      anchor="the middle of the bottom of its legs", facts="1 cm deep · 5 Hz → λ ≈ 5.6 cm"))


# ---------------------------------------------------------------- string telephone (engine6 crossmod)
# A string telephone: two paper cups whose bottoms a string joins, held level and pulled apart by two children. The engine carries a source at
# one cup's mouth (its own voice, or a speaker or fork put there) to a meter at the other cup's mouth (an ear held to it) along the string
# (tooling/src/sim/waves.ts telephoneOf: Ernst's sagging-string modulus [ERNST], a lumped cup-string-cup model at 1 kHz; provisional), as well
# as through the air; slack (no pull) or pinched, the string carries nothing.
# string -> (diameter m, density kg/m³, Young's modulus Pa, loss factor along it): cotton string (kite string, butcher's twine) 1 mm, 0.6 g/m,
# twisted cotton about 2 GPa and 0.08 (provisional); nylon fishing line 0.5 mm, 1140 kg/m³, 3 GPa [CRC: nylon 6,6 2-4 GPa], 0.03 (provisional);
# steel wire 0.3 mm, 7850 kg/m³, 200 GPa [CRC], 0.001 (provisional)
PHONE_STRINGS = {"cotton string": (0.001, 764.0, 2e9, 0.08), "fishing line": (0.0005, 1140.0, 3e9, 0.03), "wire": (0.0003, 7850.0, 200e9, 0.001)}
# a voice 1 m away (dB): a soft whisper about 40 (provisional), quiet (casual) speech 52 [PEARSONS], normal 62, loud 75, a shout 82 [ANSI-S35]
VOICES = {"none": 0.0, "whisper": 40.0, "quiet": 52.0, "normal": 62.0, "loud": 75.0, "shout": 82.0}
# a 9 oz (266 mL) paper cup: 9 cm tall, 7.6 cm across its mouth; its bottom 5.3 cm across, 0.66 g of 0.35 mm paperboard (about 0.3 kg/m²), its
# first resonance as a clamped plate (Leissa, Vibration of Plates, NASA SP-160 (1969): f = 10.21/(2π·a²)·√(D/(ρ·h)), paperboard E ≈ 4 GPa,
# provisional) about 590 Hz
PHONE_CUP = {"h": 0.09, "mouth": 0.076, "r": 0.0265, "m": 0.00066, "f": 590.0, "v": 0.000266}
# the voice's partials: a whisper is breath noise (most of it 1-4 kHz: as partials of a nominal 1 kHz); a voice a child's or a woman's 220 Hz
# with its harmonics falling about 6 dB an octave over 500 Hz (provisional)
WHISPER_PARTIALS = [(1.0, 1.0, 0.03), (1.5, 0.9, 0.03), (2.0, 0.8, 0.03), (2.5, 0.6, 0.03), (3.0, 0.45, 0.03), (4.0, 0.3, 0.03)]
VOICE_PARTIALS = [(1.0, 1.0, 0.03), (2.0, 1.0, 0.03), (3.0, 0.8, 0.03), (4.0, 0.6, 0.03), (5.0, 0.5, 0.03), (6.0, 0.4, 0.03), (8.0, 0.25, 0.03),
                  (10.0, 0.18, 0.03), (12.0, 0.12, 0.03), (15.0, 0.08, 0.03)]


def build_telephone(c, P):
    c.ca, c.sa, c.a = 1.0, 0.0, 0.0      # (always level: the two children hold it level)
    L, T = P["length"], P["pull"]
    d, rho, E, eta = PHONE_STRINGS[P["string"]]
    w = rho * (math.pi * d * d / 4) * c.settings["gravity"]
    # its sag (a parabola) under the run's gravity, at most 15 % of its length (slack: it hangs loose) and no lower than 5 mm over y = 0 (it would lie
    # on the table there); the cups' bottoms closer than the string is long by what the sag takes up (a parabola's length: chord + 8·sag²/(3·chord))
    sag = min(0.15 * L, max(0.005, c.oy - 0.005))
    if T > 0:
        sag = min(sag, w * L * L / (8 * T))
    D = L - 8 * sag * sag / (3 * L)
    H, M = PHONE_CUP["h"], PHONE_CUP["mouth"]
    ghost = dict(kind="static", material=c.mat(base="hollow plastic", overrides={}), ghost=True, stand="self")
    talk = c.slab("cup-talk", H, M, M, -D / 2 - H / 2, 0.0, look="paper cup", words="a paper cup to talk into", **ghost)
    c.slab("cup-listen", H, M, M, D / 2 + H / 2, 0.0, look="paper cup", words="a paper cup to listen at", **ghost)
    # (its sag rides on the string's solid for the view, which draws it hanging so: render only)
    line = c.slab("string", max(0.01, D), 0.004, 0.004, 0.0, 0.0, look="steel" if P["string"] == "wire" else "string",
                  words=f"a {P['string']} pulled between the cups" if T > 0 else f"a slack {P['string']} between the cups", sag=R6(sag), **ghost)
    lp1 = VOICES[P["voice"]]
    if lp1 > 0:
        whisper = P["voice"] == "whisper"
        _source(c, talk, (-H / 2, 0.0), 1000.0 if whisper else 220.0, WHISPER_PARTIALS if whisper else VOICE_PARTIALS, lp1, [[R6(P["talk_at"]), 1.0]], 0.0,
                hold=P["talk_for"], show=P["show_waves"], part="voice")
    c.process("sound", "line", role="telephone", solid=line, a={"x": R6(-D / 2 - H), "y": 0.0}, b={"x": R6(D / 2 + H), "y": 0.0}, length=R6(L),
              diameter=d, rho=rho, E=E, eta=eta, tension=R6(T), pinched=bool(P["pinched"]),
              cup={"r": PHONE_CUP["r"], "m": PHONE_CUP["m"], "f": PHONE_CUP["f"], "v": PHONE_CUP["v"]}, reach=0.5, sag=R6(sag))


def _telephone():
    add_look("paper cup", fill="#f3efe6", shade="#c9c2b3", roughness=0.75, metalness=0.0, clearcoat=0.0)
    add_look("string", fill="#e9dfc6", shade="#b9ad91", roughness=0.9, metalness=0.0, clearcoat=0.0)
    register(ItemType("string-telephone", "String telephone", CAT, build_telephone, dynamic=False, module="waves",
                      props=[Prop("length", "String length", 3.0, 0.5, 20.0, 0.05, "m", "From one cup's bottom to the other's"),
                             Prop("pull", "Pull on the string", 5.0, 0.0, 30.0, 0.05, "N",
                                  "How hard the two pull the cups apart: 2-10 N keeps it taut; under about 0.2 N it droops and carries little; 0: slack, it hangs loose and carries nothing"),
                             Prop("pinched", "Pinched", False, kind="bool", help="A finger and thumb pinch the string: it cannot vibrate past them, so nothing gets through"),
                             Prop("string", "String", "cotton string", kind="choice", choices=list(PHONE_STRINGS),
                                  help="cotton string 1 mm; nylon fishing line 0.5 mm; steel wire 0.3 mm (carries the most)"),
                             Prop("voice", "Talks", "whisper", kind="choice", choices=list(VOICES),
                                  help="How loud the child talks into the left cup (1 m away: a whisper about 40 dB, quiet 52, normal 62, loud 75, a shout 82); none: no one talks (put a speaker or a fork at the cup)"),
                             Prop("talk_at", "Talks at", 0.5, 0.0, 20.0, 0.05, "s"), Prop("talk_for", "Talks for", 2.0, 0.2, 20.0, 0.05, "s"),
                             Prop("show_waves", "Sound lines", True, kind="bool", help="Faint arcs spreading from the talking cup while the child talks")],
                      readouts=SOURCE_READOUTS() + [Readout("carries", "Carries sound", "", 0, "Whether the string carries sound (taut, not pinched)", words={0: "no", 1: "yes"}),
                                                     Readout("sag_mm", "String sag", "mm", 0, "How far its middle hangs below a straight line"),
                                                     Readout("loss_db", "Lost cup to cup", "dB", 1, "How much quieter it is at an ear held to the far cup than at the talking cup's mouth (at 1 kHz)"),
                                                     Readout("string_ms", "Speed along the string", "m/s", 0, "How fast the sound runs along the string")],
                      tags=["string telephone", "tin can telephone", "cup telephone", "cup phone", "telephone", "string", "sound travels", "vibration",
                            "medium", "solid", "cups", "talk", "whisper", "taut", "slack"],
                      description="A string telephone: two paper cups joined by a string between their bottoms, held level and pulled apart. A child talks "
                                  "(or whispers) into the left cup; pulled taut, the string carries the vibration along it to the right cup, where an ear (a "
                                  "sound meter's microphone put at that cup's mouth) hears it far better than through the air. Slack or pinched, it carries "
                                  "nothing: only the air brings the voice, much fainter.",
                      source="A sagging string's equivalent modulus [ERNST]; a lumped cup-string-cup model at 1 kHz (provisional): 9 oz paper cups (bottom Ø 53 mm, "
                             "0.66 g, its own resonance near 590 Hz), cotton string 1 mm (0.6 g/m, about 2 GPa, loss factor 0.08), nylon fishing line 0.5 mm "
                             "(3 GPa [CRC], 0.03), steel wire 0.3 mm (200 GPa [CRC], 0.001); a voice 1 m away: whisper about 40 dB (provisional), quiet 52 "
                             "[PEARSONS], normal 62, loud 75, shout 82 dB [ANSI-S35].",
                      anchor="the middle of its string, at the cups' height", facts="3 m of cotton string, pulled with 5 N: about 24 dB down cup to cup",
                      edit=[{"kind": "length", "prop": "length"}]))


# ---------------------------------------------------------------- goal kinds (web/sim/modules/waves.js has the same, number for number)
def _last(v):
    return v[-1] if isinstance(v, list) and v else None


def _max(v):
    vals = [x for x in (v or []) if isinstance(x, (int, float))]
    return max(vals) if vals else None


def _src_of(ctx, g):
    for key in ("source", "item", "buzzer"):
        if ctx.known(g.get(key)):
            return g[key]
    return None


def _pitch_of(ctx, iid):
    p = _last(ctx.state(iid, "pitch"))
    return p if isinstance(p, (int, float)) else None


def _sounded(ctx, iid):
    """When it first sounded (s), or None."""
    t = ctx.first_time(iid, "struck", lambda v: v >= 1)
    if t is None:
        t = ctx.first_time(iid, "sound_db", lambda v: v > 0)
    return t


def _trim(v, d=2):
    t = f"{v:.{d}f}"
    return t.rstrip("0").rstrip(".") if "." in t else t


def goal_sounds(ctx, g):
    """{kind: "sounds", source, pitch_hz?, tol_hz?, at_least_db?}: it sounds during the run (at that pitch within tol_hz, default 2 % of it;
    at least that loud 1 m away)."""
    iid = _src_of(ctx, g)
    if iid is None:
        return None
    t = _sounded(ctx, iid)
    pitch = _pitch_of(ctx, iid)
    db = _max(ctx.state(iid, "sounding")) or _max(ctx.state(iid, "sound_db")) or 0.0
    want = ctx.num(g.get("pitch_hz"))
    tol = ctx.num(g.get("tol_hz"))
    least = ctx.num(g.get("at_least_db"))
    ok = t is not None
    if want is not None:
        tol = abs(want) * 0.02 if tol is None else tol
        ok = ok and pitch is not None and abs(pitch - want) <= tol
    if least is not None:
        ok = ok and db >= least
    extra = (f" at {_trim(want, 1)} Hz" if want is not None else "") + (f", at least {_trim(least, 1)} dB 1 m away" if least is not None else "")
    return {"label": g.get("label") or f"{ctx.name(iid)} sounds{extra}", "ok": bool(ok), "kind": "sounds", "item": iid,
            "pitch": None if pitch is None else round(pitch, 1), "db": round(db, 1), "t": None if t is None else round(t, 3)}


def goal_higher(ctx, g):
    """{kind: "higher", a, b}: a's pitch is higher than b's (both must sound)."""
    a, b = g.get("a"), g.get("b")
    if not (ctx.known(a) and ctx.known(b)):
        return None
    pa, pb = _pitch_of(ctx, a), _pitch_of(ctx, b)
    ok = pa is not None and pb is not None and _sounded(ctx, a) is not None and _sounded(ctx, b) is not None and pa > pb
    return {"label": g.get("label") or f"{ctx.name(a)} sounds higher than {ctx.name(b)}", "ok": bool(ok), "kind": "higher", "a": a, "b": b,
            "pitch_a": None if pa is None else round(pa, 1), "pitch_b": None if pb is None else round(pb, 1)}


def _loudness(ctx, x, at):
    """How loud x was: a meter's loudest reading; with a meter `at`, x's own loudest share there; else x's loudest level 1 m away."""
    if ctx.state(x, "peak") is not None and at is None:
        return _max(ctx.state(x, "peak"))
    if at is not None:
        return _max(ctx.state(at, f"peak:{x}"))
    return _max(ctx.state(x, "sounding"))


def goal_louder(ctx, g):
    """{kind: "louder", a, b, at?}: a is louder than b (two meters: their loudest readings; two sources: their own levels 1 m away, or
    their shares at the meter `at`)."""
    a, b = g.get("a"), g.get("b")
    at = g.get("at") if ctx.known(g.get("at")) else None
    if not (ctx.known(a) and ctx.known(b)):
        return None
    la, lb = _loudness(ctx, a, at), _loudness(ctx, b, at)
    ok = la is not None and lb is not None and la > lb
    where = f" at {ctx.name(at)}" if at is not None else ""
    return {"label": g.get("label") or f"{ctx.name(a)} is louder than {ctx.name(b)}{where}", "ok": bool(ok), "kind": "louder", "a": a, "b": b,
            "db_a": None if la is None else round(la, 1), "db_b": None if lb is None else round(lb, 1)}


def goal_hears(ctx, g):
    """{kind: "hears", meter, source, at_least_db?, expect?}: the source's sound reaches the meter at least as loud as the quiet room (so the reading
    rises 3 dB or more), or at least at_least_db; expect false: it does not (a slack string telephone's far cup: engine6 crossmod)."""
    m, s = g.get("meter"), g.get("source")
    if not (ctx.known(m) and ctx.known(s)):
        return None
    peak = _max(ctx.state(m, f"peak:{s}"))
    at = _last(ctx.state(m, f"at:{s}"))
    room = ctx.state(m, "level")
    floor = room[0] if room else 35.0
    least = ctx.num(g.get("at_least_db"))
    need = floor if least is None else least
    ok = peak is not None and at is not None and at >= 0 and peak >= need
    if g.get("expect") is False:
        return {"label": g.get("label") or f"{ctx.name(m)} does not hear {ctx.name(s)}" + (f" at {_trim(least, 1)} dB or more" if least is not None else ""),
                "ok": not ok, "kind": "hears", "meter": m, "source": s, "db": None if peak is None else round(peak, 1),
                "t": None if at is None or at < 0 else round(at, 4)}
    return {"label": g.get("label") or f"{ctx.name(m)} hears {ctx.name(s)}" + (f" at {_trim(least, 1)} dB or more" if least is not None else ""),
            "ok": bool(ok), "kind": "hears", "meter": m, "source": s, "db": None if peak is None else round(peak, 1),
            "t": None if at is None or at < 0 else round(at, 4)}


def goal_echo(ctx, g):
    """{kind: "echo", meter, delay_s?, tol?}: the meter hears an echo (delay_s after the first sound, within tol: default 5 ms)."""
    m = g.get("meter")
    if not ctx.known(m):
        return None
    d = _last(ctx.state(m, "echo"))
    want = ctx.num(g.get("delay_s"))
    tol = ctx.num(g.get("tol"))
    tol = 0.005 if tol is None else tol
    ok = d is not None and d >= 0 and (want is None or abs(d - want) <= tol)
    return {"label": g.get("label") or f"{ctx.name(m)} hears an echo" + (f" {_trim(want, 3)} s after the sound" if want is not None else ""), "ok": bool(ok),
            "kind": "echo", "meter": m, "delay": None if d is None or d < 0 else round(d, 4)}


def goal_reaches(ctx, g):
    """{kind: "wave_reaches", item, x?, before_s?} (thermal's "reaches" is a temperature's): the wave on a rope or Slinky (or a ripple tank's ripples) reaches the far end, or the point x m
    along it (a rope or Slinky: where its kept shape first moves 5 % of the shake's amplitude), by before_s if given."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    x = ctx.num(g.get("x"))
    t = None
    if ctx.state(iid, "arrive") is not None:
        if x is None:
            v = _last(ctx.state(iid, "arrive"))
            t = v if isinstance(v, (int, float)) and v >= 0 else None
        else:
            P = props_of(ctx.items[iid])
            keys = sorted((k for k in (ctx.track.get("state") or {}).get(iid, {}) if k[:1] == "d" and k[1:].isdigit()), key=lambda k: int(k[1:]))
            if keys:
                L = P.get("length", 1.0)
                k = min(len(keys) - 1, max(0, int(round(x / L * (len(keys) - 1)))))
                amp = P.get("amplitude", 0.05)
                base = (ctx.state(iid, keys[k]) or [0.0])[0]
                t = ctx.first_time(iid, keys[k], lambda v: abs(v - base) > 0.05 * amp)
    elif ctx.state(iid, "reach") is not None:
        v = _last(ctx.state(iid, "reach"))
        t = v if isinstance(v, (int, float)) and v >= 0 else None
    by = ctx.num(g.get("before_s"))
    where = f"{_trim(x, 2)} m along" if x is not None else "the far end"
    when = "" if by is None else f" by {_trim(by)} s"
    return {"label": g.get("label") or f"the wave on {ctx.name(iid)} reaches {where}{when}", "ok": t is not None and (by is None or t <= by), "kind": "wave_reaches",
            "item": iid, "t": None if t is None else round(t, 3)}


def swing_period(times, xs):
    """The mean period (s) of a swing from its x positions: the times its x crosses the middle of its range going the same way (linear
    between frames), or None when it crosses fewer than twice."""
    if len(xs) < 3:
        return None
    lo, hi = min(xs), max(xs)
    if hi - lo < 1e-4:
        return None
    mid = (lo + hi) / 2
    ups = []
    for i in range(1, len(xs)):
        a, b = xs[i - 1] - mid, xs[i] - mid
        if a < 0 <= b and b != a:
            ups.append(times[i - 1] + (times[i] - times[i - 1]) * (-a) / (b - a))
    if len(ups) < 2:
        return None
    return (ups[-1] - ups[0]) / (len(ups) - 1)


def goal_period(ctx, g):
    """{kind: "period", item, seconds?, tol?}: the item swings (a pendulum, a swing, a bob on a spring) with that period (default tol 2 %):
    measured from the run, its moving part's x (or y for a bob hanging on a spring) crossing the middle of its range."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    sol = ctx.solids(iid, True)
    per = None
    if sol:
        sid = sol[-1]["id"]
        xs = [f["placements"][sid]["x"] for f in ctx.frames if sid in f["placements"]]
        ys = [f["placements"][sid]["y"] for f in ctx.frames if sid in f["placements"]]
        T = [f["t"] for f in ctx.frames if sid in f["placements"]]
        use = ys if xs and ys and (max(ys) - min(ys)) > (max(xs) - min(xs)) else xs
        per = swing_period(T, use)
    want = ctx.num(g.get("seconds"))
    tol = ctx.num(g.get("tol"))
    ok = per is not None and (want is None or abs(per - want) <= (abs(want) * 0.02 if tol is None else tol))
    return {"label": g.get("label") or f"{ctx.name(iid)} swings" + (f" once every {_trim(want)} s" if want is not None else ""), "ok": bool(ok), "kind": "period",
            "item": iid, "period": None if per is None else round(per, 4), "frequency": None if per is None or per <= 0 else round(1 / per, 4)}


def goal_jumps(ctx, g):
    """{kind: "jumps", item, min_m?}: something of the item (a grain of rice, a ball) rises at least min_m (default 5 mm) above where it
    started, at some moment of the run (rice thrown up by a drum's head, a ball knocked off a fork's prong)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    least = ctx.num(g.get("min_m"))
    least = 0.005 if least is None else least
    best = 0.0
    for s in ctx.solids(iid, True):
        sid = s["id"]
        y0 = None
        for f in ctx.frames:
            p = f["placements"].get(sid)
            if p is None:
                continue
            if y0 is None:
                y0 = p["y"]
            best = max(best, p["y"] - y0)
    return {"label": g.get("label") or f"{ctx.name(iid)} jumps at least {ctx.short_m(least)}", "ok": best >= least, "kind": "jumps", "item": iid,
            "rise_m": round(best, 4)}


REFLECTIONS = {-1: "upside down", 1: "the same way up", 0: "not at all"}


def goal_reflects(ctx, g):
    """{kind: "reflects", item, way?}: a pulse on a wave rope or Slinky comes back from its far end ("upside down", "same way up"; "none": it
    must not come back); without `way`, any reflection."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "reflection") is None:
        return None
    r = _last(ctx.state(iid, "reflection"))
    way = g.get("way") if isinstance(g.get("way"), str) else None
    want = {"upside down": -1, "same way up": 1, "none": 0}.get(way)
    ok = r is not None and r != -2 and (r != 0 if want is None else r == want)
    said = {None: "comes back from its far end", "upside down": "comes back upside down", "same way up": "comes back the same way up",
            "none": "does not come back"}.get(way, "comes back from its far end")
    return {"label": g.get("label") or f"the pulse on {ctx.name(iid)} {said}", "ok": bool(ok), "kind": "reflects", "item": iid,
            "reflection": None if r is None or r == -2 else REFLECTIONS.get(int(r), "not yet")}


def goal_standing(ctx, g):
    """{kind: "standing", item, loops?}: a standing wave holds on a wave rope or Slinky kept shaking: `loops` loops (its loops reading at the run's
    end: the humps of its last full second), any number (at least 1) without loops."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "loops") is None:
        return None
    n = _last(ctx.state(iid, "loops"))
    want = ctx.num(g.get("loops"))
    ok = isinstance(n, (int, float)) and n >= 1 and (want is None or n == want)
    if want is None:
        said = f"a standing wave forms on {ctx.name(iid)}"
    else:
        said = f"a standing wave with {_trim(want, 0)} loop{'' if want == 1 else 's'} on {ctx.name(iid)}"
    return {"label": g.get("label") or said, "ok": bool(ok), "kind": "standing", "item": iid, "loops": None if n is None else int(n)}


def _near(v, want, tol, share=0.05):
    """v within tol of want (default: share × want)."""
    tol = abs(want) * share if tol is None else tol
    return abs(v - want) <= tol


def goal_wavelength(ctx, g):
    """{kind: "wavelength", item, m?, tol?}: the waves on a wave rope, Slinky or ripple tank are m long (its wavelength reading, speed ÷
    frequency; within tol m, default 5 % of m); without m, that it carries waves at all."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "wavelength") is None:
        return None
    lam = _last(ctx.state(iid, "wavelength"))
    want = ctx.num(g.get("m"))
    ok = isinstance(lam, (int, float)) and lam > 0 and (want is None or _near(lam, want, ctx.num(g.get("tol"))))
    said = f"the waves on {ctx.name(iid)} are {ctx.short_m(want)} long" if want is not None else f"{ctx.name(iid)} carries waves"
    return {"label": g.get("label") or said, "ok": bool(ok), "kind": "wavelength", "item": iid,
            "wavelength_m": None if not isinstance(lam, (int, float)) else round(lam, 4)}


def goal_wave_speed(ctx, g):
    """{kind: "wave_speed", item, m_s?, tol?}: the waves on a wave rope, Slinky or ripple tank run at m_s m/s (its speed reading: √(T/μ),
    L·√(k/m), the water's dispersion; within tol m/s, default 5 % of it); without m_s, that they run at all."""
    iid = g.get("item")
    if not ctx.known(iid) or ctx.state(iid, "speed") is None or ctx.state(iid, "wavelength") is None:
        return None
    v = _last(ctx.state(iid, "speed"))
    want = ctx.num(g.get("m_s"))
    ok = isinstance(v, (int, float)) and v > 0 and (want is None or _near(v, want, ctx.num(g.get("tol"))))
    said = f"the waves on {ctx.name(iid)} run at {_trim(want, 2)} m/s" if want is not None else f"waves run along {ctx.name(iid)}"
    return {"label": g.get("label") or said, "ok": bool(ok), "kind": "wave_speed", "item": iid,
            "speed_m_s": None if not isinstance(v, (int, float)) else round(v, 4)}


def _most_abs(v):
    vals = [abs(x) for x in (v or []) if isinstance(x, (int, float))]
    return max(vals) if vals else None


def goal_stays_put(ctx, g):
    """{kind: "stays_put", item, max_drift_m?, min_bob_mm?}: what rides the waves bobs but goes nowhere (waves carry energy, not the water or the
    rope): a ripple tank's floater (duck, cork) bobs at least min_bob_mm (default 0.5 mm) while its drift (its mean offset over a wave) stays
    within max_drift_m (default 1 cm) all run long; a wave rope's or Slinky's ribbon moves at least min_bob_mm across (along, on a Slinky pushed
    along) and no more than max_drift_m along (a rope's points never travel along it)."""
    iid = g.get("item")
    if not ctx.known(iid):
        return None
    least = ctx.num(g.get("min_bob_mm"))
    least = 0.5 if least is None else least
    most = ctx.num(g.get("max_drift_m"))
    most = 0.01 if most is None else most
    if ctx.state(iid, "floater_bob_mm") is not None:
        bob = _max(ctx.state(iid, "floater_bob_mm"))
        drift = _most_abs(ctx.state(iid, "floater_drift"))
        what = props_of(ctx.items[iid]).get("floater", "floater")
    elif ctx.state(iid, "ribbon_across_mm") is not None:
        P = props_of(ctx.items[iid])
        pushed = ctx.items[iid].get("type") == "slinky" and P.get("push") == "push and pull"
        bob = _last(ctx.state(iid, "ribbon_along_mm" if pushed else "ribbon_across_mm"))
        # (a Slinky's coil swings back and forth where it is: the line's points never travel along it)
        drift = 0.0 if pushed else (_last(ctx.state(iid, "ribbon_along_mm")) or 0.0) / 1000
        what = "ribbon"
    else:
        return None
    ok = bob is not None and drift is not None and bob >= least and drift <= most
    return {"label": g.get("label") or f"the {what} on {ctx.name(iid)} bobs but stays put", "ok": bool(ok), "kind": "stays_put", "item": iid,
            "bob_mm": None if bob is None else round(bob, 2), "drift_m": None if drift is None else round(drift, 5)}


def goal_trace(ctx, g):
    """{kind: "trace", oscilloscope | item, waves_across?, squares_high?, tol? (a share, default 0.1)}: an oscilloscope's screen at its loudest
    moment shows that many waves across its 10 squares (the pitch it hears × 10 × its time a square) and waves that many squares high from the
    middle line (√2 × 20 µPa × 10^(L/20) ÷ its pressure a square), each within tol × the number; without numbers, that it shows a wave at all
    (it heard a pitch over the room)."""
    iid = next((g[k] for k in ("oscilloscope", "item") if ctx.known(g.get(k))), None)
    if iid is None or ctx.items[iid].get("type") != "oscilloscope":
        return None
    P = props_of(ctx.items[iid])
    tb = SCOPE_TIME.get(P.get("time_base"), 0.001)
    pa = SCOPE_SCALE.get(P.get("scale"), 0.1)
    lv = ctx.state(iid, "level") or []
    ph = ctx.state(iid, "pitch") or []
    k = -1
    for i, x in enumerate(lv):
        if isinstance(x, (int, float)) and (k < 0 or x > lv[k]):
            k = i
    f0 = ph[k] if 0 <= k < len(ph) and isinstance(ph[k], (int, float)) and ph[k] > 0 else _max(ph)
    waves = tall = None
    if k >= 0 and isinstance(f0, (int, float)) and f0 > 0:
        waves = f0 * 10 * tb
        tall = math.sqrt(2) * 2e-5 * cr_pow(10.0, lv[k] / 20) / pa
    tol = ctx.num(g.get("tol"))
    tol = 0.1 if tol is None else abs(tol)
    wa, sh = ctx.num(g.get("waves_across")), ctx.num(g.get("squares_high"))
    ok = waves is not None and (wa is None or abs(waves - wa) <= tol * abs(wa)) and (sh is None or abs(tall - sh) <= tol * abs(sh))
    parts = ([f"{_trim(wa, 1)} waves across"] if wa is not None else []) + ([f"{_trim(sh, 1)} squares high"] if sh is not None else [])
    said = f"{ctx.name(iid)} shows a wave " + (", ".join(parts) if parts else "on its screen")
    return {"label": g.get("label") or said, "ok": bool(ok), "kind": "trace", "item": iid, "waves_across": None if waves is None else round(waves, 2),
            "squares_high": None if tall is None else round(tall, 2)}
