"""The softbody module: things that change shape when they are pushed, and spring back (elastic) or stay changed (plastic).

items.py imports this file (machines/mod_<name>.py) after the catalog files and calls register_all(globals()); web/sim/modules/softbody.js is
its exact JavaScript port (the same documents, number for number). The engine side is tooling/src/sim/modules/softbody.ts (the process
"softbody") with the physics in tooling/src/sim/softbody.ts.

Items (category "Soft & bendy"):
  soft-clay        a ball of modelling clay that squashes on every hit and under a weight, and KEEPS its dents (plastic)
  playground-ball  an inflated rubber playground ball: it flattens where it presses and springs back round (elastic, the gas pushes back)
  exercise-ball    a big, soft inflated exercise ball (it visibly squashes under a weight or on landing)
  foam-ball        a squishy foam stress ball (solid elastic foam: Hertz contact)
  flex-ruler       a ruler clamped to a wooden block, sticking out over its edge: it bends under a load on its end (deflection ∝ load ∝ length³)
  springboard      a board fixed on a stand at one end (a diving board): its free end bends under a load and springs back
  flex-plank       a plank, card strip or metal strip that rests on what is under it: across two supports it sags in the middle (a bridge)
  band-launcher    a rubber-band launcher: a band between two posts pulled back with a pouch; let go, it flings what sits in the pouch
  coil-spring      a coil spring standing on a base with a platform: weights on it squash it by F/k (Hooke's law)
  + every toy-car, cart and truck gets `band_turns` / `band_size`: a rubber band wound on its rear axle that drives it (a rubber-band car).

Sources:
  [SOFUOGLU] Sofuoglu & Rasty, Tribology International 33, 523 (2000): plasticine's flow stress 0.08-0.175 MPa (items.py's modelling clay).
  [TABOR] Tabor, The Hardness of Metals (1951): a fully plastic dent's mean pressure is about 3 × the flow stress (physics.ts DENT_PRESSURE).
  [CROSS] Cross, "The bounce of a ball", Am. J. Phys. 67, 222 (1999): an inflated ball's contact force ≈ the gas's over-pressure × the flat's area.
  [FIBA] FIBA Official Basketball Rules, equipment: size 7, 567-650 g, inflated so that it rebounds 1.2-1.4 m from 1.8 m (e ≈ 0.77-0.83).
  [BOUNCE] An inflated ball bounces higher the harder it is pumped, levelling off (its skin bends less as the gas carries more of the push, and
        the skin's bending is where it loses its energy; drop tests of sports balls show it): e(p) = e_flat + (e_top − e_flat)·p/(p + p_half), a
        smooth fit through the maker's pressure and bounce (14 kPa, e 0.75 for the playground ball), a hard-pumped ball's (about 0.85, [FIBA])
        and a flat ball's thud (about 0.3); approximate.
  [ISO2533] the standard atmosphere, 101 325 Pa (the gas inside an inflated ball is compressed from it plus the gauge pressure).
  [JOHNSON] Johnson, Contact Mechanics (1985), §4.2: Hertz, F = (4/3)·E*·√R·δ^1.5.
  [GIBSON] Gibson & Ashby, Cellular Solids, 2nd ed. (1997): flexible polyurethane foams of 50-150 kg/m³ have E ≈ 0.05-0.5 MPa.
  [D3574] ASTM D3574 test H (ball rebound resilience: a steel ball dropped on the foam): conventional flexible polyurethane foam rebounds about
        35-50 %, viscoelastic ("memory", slow-recovery) foam under 10 %; a foam ball's own bounce off a hard floor loses its energy in the same
        foam, so e ≈ √(rebound share): e 0.55 a springy stress ball (30 %), e 0.2 slow foam (4 %; approximate).
  [FPL] USDA Forest Products Laboratory, Wood Handbook FPL-GTR-190 (2010), table 5-3a: sugar maple E 12.6 GPa, MOR 109 MPa; beech 11.9 GPa,
        103 MPa; eastern white pine 8.5 GPa, 59 MPa; ponderosa pine 8.9 GPa, 65 MPa.
  [PMMA] Acrylic (PMMA) sheet data (Plexiglas G): E 3.1-3.3 GPa, flexural strength about 110 MPa, density 1190 kg/m³.
  [ASM] ASM Handbook vol. 2 / MatWeb: aluminium 6061-T6 E 68.9 GPa, yield 276 MPa (6063-T6: 214); stainless 301/304 E 193-200 GPa.
  [TRELOAR] Treloar, The Physics of Rubber Elasticity, 3rd ed. (1975): natural rubber's shear modulus about 0.4-0.6 MPa (E = 3G ≈ 1.5 MPa);
        neo-Hookean uniaxial force A0·G·(λ − 1/λ²). [GENT] Gent, Rubber Chem. Technol. 69, 59 (1996): finite extensibility, J_m 30-100.
  [ALLIANCE] Alliance Rubber Co. band sizes: #19 3.5" × 1/16" (1.6 mm), #64 3.5" × 1/4" (6.35 mm), #84 3.5" × 1/2" (12.7 mm), all 1/32" (0.79 mm)
        thick (flat length 89 mm).
  [RAYLEIGH] Rayleigh / Euler-Bernoulli beam: cantilever tip deflection F·L³/(3EI), first mode 1.8751²·√(EI/(ρA·L⁴)); simply supported
        centre deflection F·L³/(48EI), first mode π²·√(EI/(ρA·L⁴)) (Timoshenko & Gere, Mechanics of Materials).
"""
import math

from crmath import cos, sin  # noqa: F401  (the same bits as web/sim's port on any machine)

NEEDED = ("register", "ItemType", "Prop", "Readout", "register_goal_kind", "register_build_hook", "register_common_prop", "MATERIALS", "add_look",
          "CATEGORIES", "TYPES", "props_of", "GOAL_KINDS")

MODULE = "softbody"
CATEGORY = "Soft & bendy"
G = 9.81

# ---------------------------------------------------------------- the beam materials: E (Pa), strength (Pa), ductile, damping ratio, ruler thickness (m)
# strength: a ductile beam's yield stress (past the moment that first yields it, σ·b·t²/6, it keeps a permanent bend), a brittle one's modulus of
# rupture (σ·b·t²/6 snaps it)
BEAM = {
    "varnished hardwood": (12.0e9, 100.0e6, False, 0.02, 0.0035,
                           "Hardwood along the grain (maple, beech): E 11.9-12.6 GPa, modulus of rupture 103-109 MPa [FPL]; wood's damping ratio about 0.01-0.02."),
    "pine": (8.9e9, 62.0e6, False, 0.02, 0.018,
             "Pine along the grain: E 8.5-8.9 GPa, modulus of rupture 59-65 MPa [FPL]; damping ratio about 0.02."),
    "acrylic": (3.2e9, 110.0e6, False, 0.025, 0.003,
                "Acrylic (PMMA): E 3.1-3.3 GPa, flexural strength about 110 MPa [PMMA]; loss factor about 0.05 (damping ratio 0.025, approximate)."),
    "steel": (200.0e9, 500.0e6, True, 0.002, 0.0005,
              "Stainless rule steel: E 193-200 GPa [ASM]; yield 500 MPa used (cold-rolled 301/304 strip is 500-1300 MPa); damping ratio about 0.002."),
    "aluminium": (69.0e9, 240.0e6, True, 0.003, 0.0015,
                  "Aluminium 6061/6063-T6: E 69 GPa, yield 214-276 MPa (240 used) [ASM]; damping ratio about 0.003."),
    "card": (3.5e9, 25.0e6, True, 0.04, 0.001,
             "Paperboard: E about 3-5 GPa along the machine direction, strength about 20-40 MPa (approximate); it creases (a permanent bend) rather than snaps."),
}
RULER_MATERIALS = ["varnished hardwood", "acrylic", "steel", "aluminium"]
PLANK_MATERIALS = ["pine", "varnished hardwood", "aluminium", "steel", "acrylic", "card"]
BEAM_DENSITY = {"pine": 500.0, "card": 700.0}

# ---------------------------------------------------------------- rubber bands [ALLIANCE] [TRELOAR] [GENT]
BAND_SIZES = {"thin": 1.6e-3 * 0.79e-3, "medium": 6.35e-3 * 0.79e-3, "thick": 12.7e-3 * 0.79e-3}   # one strand's cross-section, m²
RUBBER_E = 1.5e6          # Pa: natural rubber, E = 3G with G ≈ 0.5 MPa [TRELOAR]
RUBBER_LOCK = 40.0        # Gent's J_m: the strand's stretch stiffens toward λ ≈ 6.5 (a band breaks about there) [GENT]
RESILIENCE = 0.8          # the share of its pull a shortening band gives back (natural rubber's rebound resilience, about 0.75-0.85)
# λ at which a band snaps: natural-rubber gum stretches 700-800 % in a tensile test (Mark, Erman & Roland, The Science and Technology of Rubber,
# 4th ed., 2013, ch. 1); an office band, cut from tube with nicked edges, breaks sooner, at about 500 % (6 × its length; approximate). On the
# Gent curve (J_m 40) that is about 18 MPa: a #64 strand (6.35 × 0.79 mm) then pulls about 90 N.
BAND_SNAP = 6.0
BAND_CARS = ("toy-car", "cart", "truck")
AXLE_R = 0.0015           # m: a band car's axle, a 3 mm bamboo skewer (the usual school build), the band winds onto

# ---------------------------------------------------------------- clay [SOFUOGLU] [TABOR]
CLAY_FLOW = {"firm": 175000.0, "normal": 120000.0, "soft": 80000.0}   # Pa: plasticine's flow stress, cold, at room temperature, warm
CLAY_DENSITY = 1570.0     # kg/m³: Van Aken plasticine (Eckerson et al. 2008), as items.py's modelling clay
DENT = 3.0                # the flow pressure over the flow stress (Tabor's ≈ 3: physics.ts DENT_PRESSURE)
CLAY_STIFF = 50.0         # the clay's elastic part: this many times its flow resistance 2π·R·p (it springs back about 2 % of a dent)

# ---------------------------------------------------------------- the inflated and foam balls
# key: (name, diameter m, mass kg, wall m, gauge Pa, (e_flat, e_top, p_half kPa) [BOUNCE], most kPa, material, look, description, source)
BALLS = {
    "playground-ball": ("Playground ball", 0.216, 0.40, 0.0025, 14000.0, (0.30, 0.85, 3.1), 35.0, "playground rubber", "playground",
                        "A red rubber playground ball (8.5 inch). It flattens where it lands or is pressed and springs back round; pumped up harder it "
                        "bounces higher.",
                        "8.5 in (21.6 cm) rubber playground ball, about 0.4 kg, inflated to about 2 psi (14 kPa; makers say 1.5-2.5 psi; 35 kPa, 5 psi, "
                        "the most here: past it the skin overstretches). Contact force = over-pressure × the flat's area [CROSS], the gas compressed as it "
                        "flattens [ISO2533]; bounce e 0.75 at 14 kPa, rising with the pressure [BOUNCE]."),
    "exercise-ball": ("Exercise ball", 0.65, 1.1, 0.002, 4000.0, (0.25, 0.80, 1.5), 10.0, "exercise PVC", "exercise",
                      "A big, soft inflated exercise ball (65 cm). It squashes a lot under a weight or when it lands, and springs back.",
                      "65 cm PVC exercise (Swiss) ball, about 1.1 kg, at about 4 kPa over the air (0.6 psi; a 70 kg person sitting on it presses it about 10 cm, "
                      "approximate; 10 kPa the most here) [CROSS] [ISO2533]; bounce e 0.65 at 4 kPa, rising with the pressure [BOUNCE]."),
}


def bounce_e(fit, kpa):
    """[BOUNCE] An inflated ball's coefficient of restitution at a gauge pressure (kPa): e_flat + (e_top − e_flat)·p/(p + p_half)."""
    e_flat, e_top, half = fit
    p = max(0.0, kpa)
    return e_flat + (e_top - e_flat) * p / (p + half)
# the foams a foam ball can be, and the share of its landing speed it leaves the floor with [D3574] (approximate)
FOAMS = {"stress ball": 0.55, "slow foam": 0.2}
FOAM = ("Foam ball", 0.07, 0.022, 100000.0, 0.3, 0.55,
        "A squishy foam stress ball (7 cm). Squeeze it and it springs back.",
        "Flexible polyurethane foam ball, 7 cm, about 22 g (≈ 120 kg/m³): E about 0.1 MPa, ν 0.3 [GIBSON]; Hertz contact [JOHNSON]; bounce e ≈ 0.55 (approximate).")


def register_all(g):
    globals().update({k: g[k] for k in NEEDED})
    if CATEGORY not in CATEGORIES:
        CATEGORIES.append(CATEGORY)
    _looks()
    _materials()
    _clay()
    _balls()
    _rulers()
    _band_launcher()
    _coil_spring()
    _band_cars()
    _goals()


def _looks():
    add_look("playground", fill="#d6342b", shade="#a3231c", roughness=0.62, metalness=0.0, clearcoat=0.1)
    add_look("exercise", fill="#3a7bd5", shade="#285aa0", roughness=0.45, metalness=0.0, clearcoat=0.2)
    add_look("foam ball", fill="#f5c433", shade="#c99a1c", roughness=0.95, metalness=0.0, clearcoat=0.0)
    add_look("acrylic", fill="#e8f1f6", shade="#b9c9d3", roughness=0.08, metalness=0.0, clearcoat=0.6, transmission=0.55)
    add_look("rubber band", fill="#c98a5a", shade="#9a6239", roughness=0.7, metalness=0.0, clearcoat=0.0)


def _mat(key, **kw):
    kw.setdefault("rolling", 0.0)
    kw.setdefault("side", 0.0)
    if key not in MATERIALS:
        MATERIALS[key] = kw


def _materials():
    _mat("soft clay", density=CLAY_DENSITY, bounce=0.05, friction=0.9, rolling=0.3, look="clay",
         source="Plasticine 1570 kg/m³ (Eckerson et al. 2008); its flow stress 0.08-0.175 MPa [SOFUOGLU]: it squashes on every hit and keeps the dent "
                "(tooling/src/sim/softbody.ts, law clay). Friction 0.9 and rolling 0.3 as items.py's modelling clay (provisional).")
    _mat("playground rubber", density=1100.0, bounce=0.75, friction=0.7, rolling=0.02, look="playground",
         source="A rubber playground ball's skin (about 1100 kg/m³); its weight is set per item. Its bounce comes from its soft contact (softbody law pressure).")
    _mat("exercise PVC", density=1300.0, bounce=0.65, friction=0.6, rolling=0.02, look="exercise",
         source="PVC film about 1300 kg/m³; the ball's weight is set per item. Its bounce comes from its soft contact (softbody law pressure).")
    _mat("polyurethane foam", density=120.0, bounce=0.55, friction=0.8, rolling=0.03, look="foam ball",
         source="Flexible polyurethane foam about 120 kg/m³ [GIBSON]; its bounce comes from its soft contact (softbody law hertz).")
    _mat("acrylic", density=1190.0, bounce=0.6, friction=0.4, rolling=0.0, look="acrylic", source="Acrylic (PMMA) 1190 kg/m³ [PMMA]; friction and bounce provisional.")
    _mat("pine", density=500.0, bounce=0.6, friction=0.45, rolling=0.0, look="light wood", source="Pine about 450-550 kg/m³ [FPL]; friction as wood on wood (provisional).")
    _mat("card", density=700.0, bounce=0.3, friction=0.45, rolling=0.0, look="cardboard",
         source="Solid paperboard (card) about 700 kg/m³ (approximate); friction and bounce provisional.")
    _mat("rubber band", density=1100.0, bounce=0.3, friction=0.8, rolling=0.0, look="rubber band",
         source="Natural rubber about 920-1100 kg/m³; a leather or rubber pouch grips (friction 0.8 provisional).")


# ---------------------------------------------------------------- clay
def _clay():
    def build(c, P):
        R = P["diameter"] / 2
        sigma = CLAY_FLOW[P["softness"]]
        p = DENT * sigma
        sid = c.ball("clay", R, material=c.mat(density=CLAY_DENSITY), look="clay", words="a ball of modelling clay")
        c.process("softbody", "soft", role="ball", solid=sid, law="clay", R=round(R, 5), flow=round(p, 1),
                  kc=round(CLAY_STIFF * 2 * math.pi * R * p, 3), e=0.05, hard=round(0.3 * R, 5))
    register(ItemType("soft-clay", "Squashy clay ball", CATEGORY, build, material="soft clay", materials=["soft clay"], module=MODULE,
                      props=[Prop("diameter", "Diameter", 0.06, 0.02, 0.2, 0.002, "m"),
                             Prop("softness", "Softness", "normal", kind="choice", choices=list(CLAY_FLOW),
                                  help="firm: cold clay (flows at 0.175 MPa); normal: room temperature (0.12 MPa); soft: warmed in the hands (0.08 MPa)")],
                      readouts=[Readout("dent_mm", "Dent (stays)", "mm", 1, "How deep its deepest flat spot is: the squash it keeps"),
                                Readout("squash_mm", "Squash now", "mm", 1, "How flat it is pressed where it touches, now"),
                                Readout("force_n", "Pushing force", "N", 2, "What presses on it where it touches")],
                      tags=["clay", "plasticine", "play-doh", "squash", "squish", "dent", "flatten", "plastic", "deform", "keeps its shape", "mould"],
                      description="A ball of modelling clay that SQUASHES: it flattens where it lands, is hit or pressed, and keeps the dent (it does not "
                                  "spring back or bounce). A heavy weight on it flattens it a little; a hard throw flattens it a lot.",
                      source="Plasticine 1570 kg/m³; flow stress 0.08-0.175 MPa [SOFUOGLU], dent pressure 3 × that [TABOR]: dropped 1 m, a 6 cm ball flattens "
                             "about 7 mm (½mv² = p·π·R·δ²). tooling/src/sim/softbody.ts law clay.",
                      anchor="its middle", facts="6 cm · 177 g · keeps its dents", edit=[{"kind": "radius", "prop": "diameter"}]))


# ---------------------------------------------------------------- inflated and foam balls
def _shell_density(R, wall, mass):
    inner = R - wall
    return mass / ((4.0 / 3.0) * math.pi * (R * R * R - inner * inner * inner))


def _balls():
    def inflated(key):
        name, d0, m0, wall, gauge0, fit, most, material, look, description, source = BALLS[key]

        def build(c, P):
            R = P["diameter"] / 2
            mass = P["mass"]
            gauge = P["pressure"] * 1000.0
            w = min(wall, R / 4)
            sid = c.ball("ball", R, material=c.mat(density=round(_shell_density(R, w, mass), 4)), wall=w, look=look, words=f"a {name.lower()}")
            # (its bounce from its pressure [BOUNCE]; the gas stiffens it smoothly as it flattens, so planck's rigid stop is kept for 0.85 R)
            c.process("softbody", "soft", role="ball", solid=sid, law="pressure", R=round(R, 5), gauge=round(gauge, 1), e=round(bounce_e(fit, P["pressure"]), 4),
                      hard=round(0.85 * R, 5))
        register(ItemType(key, name, CATEGORY, build, material=material, materials=[material], module=MODULE,
                          props=[Prop("diameter", "Diameter", d0, round(d0 / 3, 3), round(d0 * 2, 3), 0.005, "m"),
                                 Prop("mass", "Weight", m0, round(m0 / 4, 3), round(m0 * 4, 3), 0.01, "kg"),
                                 Prop("pressure", "Air pressure", round(gauge0 / 1000.0, 1), 0.5, most, 0.5, "kPa",
                                      "How hard it is pumped up (over the air outside): pumped harder it squashes less and bounces higher (it leaves the floor "
                                      f"at {round(bounce_e(fit, 2.0), 2)} of the speed it lands with at 2 kPa, {round(bounce_e(fit, gauge0 / 1000.0), 2)} at "
                                      f"{round(gauge0 / 1000.0, 1)}, {round(bounce_e(fit, most), 2)} at {most} kPa)")],
                          readouts=[Readout("squash_mm", "Squash", "mm", 1, "How flat it is pressed where it touches, now"),
                                    Readout("force_n", "Pushing force", "N", 2, "What presses on it where it touches"),
                                    Readout("energy_j", "Stored energy", "J", 3, "The energy its squash holds (it gives it back as it springs round)")],
                          tags=["ball", "bouncy", "bounce", "squash", "squishy", "elastic", "springs back", "inflated", "pumped up", "flat ball", "air pressure", "rubber",
                                "deform", "soft"],
                          description=description, source=source + " tooling/src/sim/softbody.ts law pressure.",
                          anchor="its middle", facts=f"{round(d0 * 100, 1)} cm · {m0} kg · {round(gauge0 / 1000.0, 1)} kPa",
                          edit=[{"kind": "radius", "prop": "diameter"}]))
    for key in BALLS:
        inflated(key)

    name, d0, m0, E, nu, e, description, source = FOAM

    def build_foam(c, P):
        R = P["diameter"] / 2
        vol = (4.0 / 3.0) * math.pi * R * R * R
        slow = P["foam"] == "slow foam"
        sid = c.ball("ball", R, material=c.mat(density=round(P["mass"] / vol, 3)), look="foam ball", words="a slow-foam ball" if slow else "a foam stress ball")
        c.process("softbody", "soft", role="ball", solid=sid, law="hertz", R=round(R, 5), E=round(P["stiffness"] * 1000.0, 1), nu=nu, e=FOAMS[P["foam"]], hard=round(0.6 * R, 5))
    register(ItemType("foam-ball", name, CATEGORY, build_foam, material="polyurethane foam", materials=["polyurethane foam"], module=MODULE,
                      props=[Prop("diameter", "Diameter", d0, 0.03, 0.2, 0.002, "m"),
                             Prop("mass", "Weight", m0, 0.005, 0.2, 0.001, "kg"),
                             Prop("stiffness", "Foam stiffness", round(E / 1000.0, 1), 20.0, 1000.0, 5.0, "kPa", "Its foam's Young's modulus: softer squashes more"),
                             Prop("foam", "Foam", "stress ball", kind="choice", choices=list(FOAMS),
                                  help="stress ball: springy polyurethane foam, it leaves the floor at 0.55 of the speed it lands with; slow foam: "
                                       "memory foam that barely bounces (0.2: a soft ball that lands and stays)")],
                      readouts=[Readout("squash_mm", "Squash", "mm", 1, "How flat it is pressed where it touches, now"),
                                Readout("force_n", "Pushing force", "N", 2, "What presses on it where it touches"),
                                Readout("energy_j", "Stored energy", "J", 4, "The energy its squash holds")],
                      tags=["stress ball", "foam", "squishy", "squeeze", "elastic", "springs back", "soft", "sponge ball", "deform", "soft ball", "memory foam"],
                      description=description + " Slow foam (memory foam) barely bounces: a soft ball that lands and stays.",
                      source=source + " Slow foam e ≈ 0.2 [D3574]. tooling/src/sim/softbody.ts law hertz.",
                      anchor="its middle", facts="7 cm · 22 g · soft foam", edit=[{"kind": "radius", "prop": "diameter"}]))


# ---------------------------------------------------------------- bending beams
def _beam(c, P, *, mat, L, t, b, s, y, x0, clamp, N):
    """N segments of a beam from x0 (item frame, along s = +1 right or -1 left), their bottom at height y, and the softbody record that joins
    and bends them (each joint: where one segment ends and the next begins). `clamp`: the static part they leave (its end at x0) and its
    length, or None (a free beam)."""
    E, strength, ductile, zeta = BEAM[mat][:4]
    rho = BEAM_DENSITY.get(mat, MATERIALS[mat]["density"])
    tc = max(t, 0.002)
    seg = L / N
    I = b * t * t * t / 12.0
    EI = E * I
    # its first mode: a clamped beam's (1.8751²), a free one's resting on its ends (π²) [RAYLEIGH]
    shape = 1.8751 * 1.8751 if clamp else math.pi * math.pi
    omega = shape * math.sqrt(EI / (rho * b * t * L * L * L * L))
    material = c.mat(base=mat, density=round(rho * t / tc, 3))
    sids = []
    for i in range(N):
        sids.append(c.slab(f"seg{i + 1}", seg, tc, b, s * (x0 + (i + 0.5) * seg), y + tc / 2, material=material, kind="dynamic", words="a bending beam"))
    joints = []
    prev = clamp[0] if clamp else None
    for i in range(N):
        part = f"seg{i + 1}"
        if prev is not None:
            # (the pin and the bend are the engine's softbody beam joint: no document pin, so nothing draws an axle there)
            # (at a clamp the spring stands for half a segment: 2·EI/ℓ, made a little stiffer, EI/(ℓ·(1/2 − 1/(6N))), so an end load bends the N pieces
            # exactly as F·L³/(3EI) (the plain rigid-segment method gives 1 + 1/(2N²) of it))
            k = (1.0 / (0.5 - 1.0 / (6.0 * N)) if (clamp and i == 0) else 1.0) * EI / seg
            j = {"a": c.sid(prev), "b": c.sid(part), "k": round(k, 6), "c": round(2 * zeta * k / omega, 9)}
            if ductile:
                j["my"] = round(strength * b * t * t / 6.0, 6)
            else:
                j["mu"] = round(strength * b * t * t / 6.0, 6)
            joints.append(j)
        prev = part
    rec = {"role": "beam", "solids": sids, "joints": joints, "tip": {"x": round(s * seg / 2, 6), "y": 0.0}, "ductile": ductile, "segment": round(seg, 6)}
    if clamp:
        rec.update(clamp=c.sid(clamp[0]), base={"x": round(s * clamp[1] / 2, 6), "y": 0.0}, axis={"x": float(s), "y": 0.0})
    c.process("softbody", "beam", **rec)
    return sids


EDGE = 0.004     # m: a clamped beam's block or stand ends this far short of where it starts to bend


def _thickness(P, mat):
    t = P["thickness_mm"] / 1000.0
    return t if t > 0 else BEAM[mat][4]


def _segments(L, size):
    return max(6, min(16, int(round(L / size))))


def _rulers():
    def build_ruler(c, P):
        mat = P["material"]
        L = P["length"]
        ov = min(P["overhang"], L - 0.04)
        t = _thickness(P, mat)
        b = P["width"]
        s = 1 if P["facing"] == "right" else -1
        BW, BH = 0.10, 0.05
        wood = c.mat(base="varnished hardwood", overrides={})
        # (the block's edge 4 mm short of the bend's root, and the clamped part a ghost: the bending ruler's first piece touches neither as it bends)
        c.slab("block", BW, BH, 0.08, s * (-BW / 2 - EDGE), BH / 2, kind="static", material=wood, look="wood", words="a wooden block")
        held = L - ov
        tc = max(t, 0.002)
        c.slab("held", held, tc, b, s * (-held / 2), BH + tc / 2, kind="static", material=c.mat(base=mat, overrides={}), words="the clamped end of the ruler", ghost=True)
        c.slab("clamp", 0.03, 0.012, b + 0.012, s * -0.02, BH + tc + 0.006, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="a clamp")
        _beam(c, P, mat=mat, L=ov, t=t, b=b, s=s, y=BH, x0=0.0, clamp=("held", held), N=_segments(ov, 0.025))
    beam_readouts = [Readout("bend_mm", "Bend", "mm", 1, "How far its end is below the straight line it had (a free plank: how far its middle sags)"),
                     Readout("energy_j", "Stored energy", "J", 4, "The energy its bend holds (it gives it back as it springs straight)"),
                     Readout("set_deg", "Permanent bend", "°", 1, "A metal or card beam bent too far keeps this much bend"),
                     Readout("broken", "Broken", "", 0, "1 once it has snapped (wood, acrylic) or creased 10° or more (card, metal): the fracture module's breaks goal reads it")]
    register(ItemType("flex-ruler", "Bending ruler", CATEGORY, build_ruler, material="varnished hardwood", materials=RULER_MATERIALS, module=MODULE,
                      props=[Prop("overhang", "Overhang", 0.2, 0.05, 0.6, 0.005, "m", "How far it sticks out past the block's edge: the part that bends"),
                             Prop("length", "Ruler length", 0.3, 0.15, 1.0, 0.01, "m", "The whole ruler (15 cm, 30 cm, a metre stick); 4 cm at least stay clamped"),
                             Prop("thickness_mm", "Gauge", 0.0, 0.0, 10.0, 0.1, "mm", "Its thickness; 0: the material's usual ruler (wood 3.5, acrylic 3, steel 0.5, aluminium 1.5 mm)"),
                             Prop("width", "Width", 0.03, 0.01, 0.08, 0.001, "m", "Front to back"),
                             Prop("facing", "Sticks out to", "right", kind="choice", choices=["right", "left"])],
                      readouts=beam_readouts,
                      tags=["ruler", "bend", "bending", "cantilever", "flex", "springy", "deflection", "hooke", "elastic", "diving board", "beam", "stiffness"],
                      description="A ruler clamped to a wooden block, sticking out over the block's edge. A load on its end bends it down (twice the load, twice the "
                                  "bend; twice as long, 8 times the bend), and it springs back straight when the load is gone. Wood and acrylic snap if bent too far; "
                                  "steel and aluminium keep a permanent bend.",
                      source="Euler-Bernoulli cantilever: tip deflection F·L³/(3·E·I), I = b·t³/12 [RAYLEIGH]; E and strength from [FPL] [PMMA] [ASM]. Built of 4-14 "
                             "rigid segments with bending springs E·I/ℓ (tooling/src/sim/softbody.ts role beam: within 1 % of F·L³/(3EI)).",
                      anchor="the floor under the block's edge, where the ruler leaves the block", facts="30 cm wooden ruler · 20 cm over the edge",
                      edit=[{"kind": "length", "prop": "overhang"}]))

    def build_board(c, P):
        mat = P["material"]
        L = P["length"]
        t = P["thickness_mm"] / 1000.0
        b = P["width"]
        s = 1 if P["facing"] == "right" else -1
        H = P["stand_height"]
        SW = 0.15
        tc = max(t, 0.002)
        c.slab("stand", SW, H, max(0.1, b), s * (-SW / 2 - EDGE), H / 2, kind="static", material=c.mat(base="varnished hardwood", overrides={}), look="dark wood",
               words="the board's stand")
        held = 0.2
        c.slab("held", held, tc, b, s * (-held / 2), H + tc / 2, kind="static", material=c.mat(base=mat, overrides={}), words="the board's fixed end", ghost=True)
        c.slab("clamp", 0.05, 0.02, b + 0.02, s * -0.03, H + tc + 0.01, kind="static", material=c.mat(base="steel", overrides={}), look="steel", words="the board's bolted clamp")
        _beam(c, P, mat=mat, L=L, t=t, b=b, s=s, y=H, x0=0.0, clamp=("held", held), N=_segments(L, 0.08))
    register(ItemType("springboard", "Diving board", CATEGORY, build_board, material="pine", materials=PLANK_MATERIALS, module=MODULE,
                      props=[Prop("length", "Length", 1.0, 0.2, 5.0, 0.01, "m", "The part past its stand: the part that bends"),
                             Prop("thickness_mm", "Gauge", 18.0, 1.0, 80.0, 0.5, "mm", "Its thickness: the bend falls as the thickness cubed (twice as thick, 8 times less bend)"),
                             Prop("width", "Width", 0.25, 0.03, 0.6, 0.005, "m", "Front to back"),
                             Prop("stand_height", "Stand height", 0.3, 0.05, 1.5, 0.01, "m"),
                             Prop("facing", "Sticks out to", "right", kind="choice", choices=["right", "left"])],
                      readouts=beam_readouts,
                      tags=["diving board", "springboard", "board", "plank", "bend", "spring", "cantilever", "bounce", "elastic", "launch"],
                      description="A board bolted on a stand at one end, its far end free (a diving board). A weight on the end bends it down; it springs "
                                  "back and can throw what lands on it.",
                      source="Euler-Bernoulli cantilever F·L³/(3EI) [RAYLEIGH]; pine E 8.9 GPa [FPL], aluminium 69 GPa [ASM] (a pool's springboard is a 4.9 m "
                             "aluminium board). tooling/src/sim/softbody.ts role beam.",
                      anchor="the floor under the stand's edge, where the board leaves the stand", facts="1 m pine board · 18 mm · on a 30 cm stand",
                      edit=[{"kind": "length", "prop": "length"}]))

    def build_plank(c, P):
        mat = P["material"]
        L = P["length"]
        t = P["thickness_mm"] / 1000.0
        b = P["width"]
        _beam(c, P, mat=mat, L=L, t=t, b=b, s=1, y=0.0, x0=-L / 2, clamp=None, N=_segments(L, 0.035))
    register(ItemType("flex-plank", "Bendy plank", CATEGORY, build_plank, material="pine", materials=PLANK_MATERIALS, module=MODULE,
                      props=[Prop("length", "Length", 0.6, 0.1, 5.0, 0.01, "m"),
                             Prop("thickness_mm", "Gauge", 6.0, 0.3, 60.0, 0.1, "mm", "Its thickness: a card strip is about 1 mm, a thin plank 6 mm, a shelf board 18 mm"),
                             Prop("width", "Width", 0.1, 0.01, 0.6, 0.005, "m", "Front to back")],
                      readouts=beam_readouts,
                      tags=["bridge", "plank", "beam", "board", "card", "strip", "sag", "bend", "span", "load", "paper bridge", "elastic"],
                      description="A plank (or a card or metal strip) that rests on whatever is under it. Laid across two supports it is a bridge: it sags in "
                                  "the middle under a load (centre load: F·L³/(48EI)), springs back when unloaded; card creases and wood snaps when overloaded.",
                      source="Euler-Bernoulli beam on two supports: centre deflection F·L³/(48·E·I) [RAYLEIGH]; materials [FPL] [PMMA] [ASM]. tooling/src/sim/softbody.ts role beam.",
                      anchor="the middle of its underside", facts="60 cm pine · 6 mm thick · 10 cm wide", edit=[{"kind": "length", "prop": "length"}]))


# ---------------------------------------------------------------- the rubber-band launcher
BOARD = (0.35, 0.30, 0.012, 0.08)   # m: the launch board reaches 35 cm behind the posts and 30 cm past them; 12 mm thick, 8 cm wide


def _band_launcher():
    def build(c, P):
        H = P["height"]
        d = P["draw"]
        spread = max(P["spread"], BOARD[3] + 0.01)
        n = int(P["bands"])
        back_len, front_len, bt, bw = BOARD
        # the launch board: a car or a block sits on it in front of the pouch and rolls off its front end; the two posts the band is hooked on stand
        # at x = 0 beside it (front and back of the launch line: what is launched passes between them; the 3D view draws them and the band)
        c.slab("board", back_len + front_len, bt, bw, (front_len - back_len) / 2, bt / 2, kind="static", material=c.mat(base="varnished hardwood", overrides={}),
               look="wood", words="the launcher's board")
        y = bt + H
        # the pouch: a shallow V (two light rubber flaps welded at its back), its open side toward +x, its tips at x = -draw
        pouch = c.mat(base="rubber band", density=round(0.002 / (0.016 * 0.003 * 0.03 * 2), 3))
        arm, th, ang = 0.016, 0.003, 25.0
        rad = ang * math.pi / 180.0
        back = -d - arm * cos(rad)
        sid = c.slab("pouch", th, 0.004, 0.03, back, y, material=pouch, kind="dynamic", words="the launcher's pouch", angularDamping=40.0)
        for k, sgn in ((1, 1), (2, -1)):
            # (each flap welded to the pouch's back: its middle in the pouch's frame, turned ±25° so its tip reaches x = -draw)
            c.slab(f"flap{k}", arm, th, 0.03, 0.0, 0.0, material=pouch, kind="dynamic", words="the launcher's pouch")
            s = c.sb.solids[-1]
            s["parent"] = sid
            s["at"] = {"x": round(arm / 2 * cos(rad), 5), "y": round(sgn * arm / 2 * sin(rad), 5)}
            s["angle"] = round(sgn * rad, 6)
        ax, ay = c.world(0.0, y)
        c.process("softbody", "band", role="band", pad=sid, anchor={"x": round(ax, 6), "y": round(ay, 6)}, spread=round(spread, 5),
                  l0=round(spread / 2 / 1.05, 6), area=BAND_SIZES[P["band"]], E=RUBBER_E, n=n, resilience=RESILIENCE, lock=RUBBER_LOCK, snap=BAND_SNAP)
    register(ItemType("band-launcher", "Rubber-band launcher", CATEGORY, build, module=MODULE,
                      props=[Prop("draw", "Pulled back", 0.1, 0.0, 0.2, 0.005, "m",
                                  "How far the pouch is pulled back behind the posts (more: more stretch, more energy). 20 cm at most: the band is then about 5 times "
                                  "its length; at 6 times a rubber band snaps"),
                             Prop("bands", "Bands", 1, 1, 4, 1, "", "Rubber bands each side, side by side (more: stiffer)", kind="int"),
                             Prop("band", "Rubber band", "medium", kind="choice", choices=list(BAND_SIZES),
                                  help="thin (#19, 1.6 mm wide), medium (#64, 6.35 mm), thick (#84, 12.7 mm): a wider band pulls harder"),
                             Prop("spread", "Post spread", 0.1, 0.09, 0.3, 0.005, "m", "How far apart the two posts are (front to back), either side of the board"),
                             Prop("height", "Band height", 0.03, 0.005, 0.3, 0.001, "m",
                                  "The band's height above the board: the middle of a toy car's flat back (about 3 cm), a ball's middle (its radius)")],
                      readouts=[Readout("stretch_cm", "Band stretch", "cm", 1, "How much longer each band is than unstretched"),
                                Readout("tension_n", "Pull", "N", 2, "How hard the bands pull the pouch toward the posts"),
                                Readout("energy_j", "Stored energy", "J", 3, "The elastic energy in the stretched bands"),
                                Readout("broken", "Snapped", "", 0, "1 once its band has snapped (stretched to 6 times its length)")],
                      tags=["rubber band", "launcher", "slingshot", "catapult", "elastic", "stretch", "energy", "fling", "shoot", "launch", "potential energy"],
                      description="A launch board with a rubber band stretched between two posts at its front, its pouch pulled back. Put a toy car, a block or "
                                  "a ball on the board just in front of the pouch: when the scene lets go the band snaps forward and flings it off the board's "
                                  "front end (tilt the launcher to shoot up). Pulled farther, it stores more energy.",
                      source="Rubber strands: F = A0·(E/3)·(λ − 1/λ²) [TRELOAR], E 1.5 MPa, Gent-stiffened (J_m 40) [GENT]; band sizes [ALLIANCE]; it gives back "
                             "about 80 % of its pull as it shortens (rebound resilience); it snaps at 6 × its length (BAND_SNAP). tooling/src/sim/softbody.ts role band.",
                      anchor="the board's bottom under the posts", facts="#64 band · pulled 10 cm · ≈ 0.6 J",
                      edit=[{"kind": "rotate"}]))


# ---------------------------------------------------------------- the coil spring
def _coil_spring():
    def build(c, P):
        k, rest, W, damp = P["stiffness"], P["rest_length"], P["width"], P["damping"]
        th = 0.008
        wood = c.mat(base="varnished hardwood", overrides={})
        c.slab("base", W + 0.04, 0.02, 0.1, 0.0, 0.01, kind="static", material=wood, look="wood", words="the spring's base")
        mp = 700.0 * W * th * 0.08
        comp = min(mp * G / k, rest * 0.8)
        ply = c.mat(base="varnished hardwood", overrides={})
        sid = c.slab("platform", W, th, 0.08, 0.0, 0.02 + rest - comp + th / 2, material=ply, kind="dynamic", words="the spring's platform")
        cr = min(0.025, W / 3)
        c.joint("spring", "spring", a="base", b="platform", anchorA=(0.0, 0.01), anchorB=(0.0, -th / 2), rest=rest, stiffness=k, damping=damp,
                coils=max(6, int(round(rest / 0.01))), coilRadius=round(cr, 4))
        ux, uy = c.world(0.0, 1.0)
        ox, oy = c.world(0.0, 0.0)
        c.process("softbody", "guide", role="guide", solid=sid, axis={"x": round(ux - ox, 6), "y": round(uy - oy, 6)})
        # (its readings zeroed with the empty platform resting on it, as a lab zeroes its scale: `tare`, the platform's own squash)
        c.process("softbody", "readings", role="spring", a=c.sid("base"), b=sid, anchorA={"x": 0.0, "y": 0.01}, anchorB={"x": 0.0, "y": round(-th / 2, 5)},
                  rest=rest, k=k, tare=round(comp, 6))
    register(ItemType("coil-spring", "Coil spring", CATEGORY, build, module=MODULE,
                      props=[Prop("stiffness", "Stiffness", 200.0, 10.0, 5000.0, 5.0, "N/m", "How many newtons squash it by a metre: a stiffer spring squashes less"),
                             Prop("rest_length", "Length", 0.12, 0.03, 0.4, 0.005, "m", "Its length with nothing on it"),
                             Prop("width", "Platform width", 0.1, 0.04, 0.3, 0.005, "m"),
                             Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m", "Friction that settles its bouncing")],
                      readouts=[Readout("compression_mm", "Squashed by", "mm", 1,
                                        "How much what is on it squashes it: zeroed with the empty platform resting on it, as a lab zeroes its scale (each 100 g: 981 ÷ k mm)"),
                                Readout("force_n", "Spring force", "N", 2, "How hard it pushes back on what is on it (k × that squash: the load's weight once still)"),
                                Readout("energy_j", "Stored energy", "J", 4, "½·k·x² of that squash")],
                      tags=["spring", "coil", "hooke", "compress", "squash", "elastic", "springs back", "weigh", "force", "stiffness", "potential energy"],
                      description="A coil spring standing on a base with a platform on top, kept upright by a guide. Weights on the platform squash it by "
                                  "weight ÷ stiffness (Hooke's law: twice the weight, twice the squash); it springs back when they are taken off.",
                      source="Hooke's law F = k·x; stored energy ½·k·x² (textbook). The coil is the engine's spring joint; the guide is a straight slide.",
                      anchor="the middle of its base's bottom", facts="200 N/m · 12 cm", edit=[]))


# ---------------------------------------------------------------- rubber-band cars (common props of toy cars, carts and trucks)
def _band_cars():
    applies = lambda t: t.key in BAND_CARS          # noqa: E731
    register_common_prop(Prop("band_turns", "Rubber-band turns", 0.0, 0.0, 30.0, 0.5, "turns",
                              "A rubber band wound this many turns on its rear axle (0: none): it drives the car forward when the scene lets go"), applies)
    register_common_prop(Prop("band_size", "Rubber band", "medium", kind="choice", choices=list(BAND_SIZES),
                              help="The band wound on its axle: thin, medium (#64) or thick: a thicker band pushes harder"), applies)
    register_build_hook(_band_hook)


def _band_hook(sb, scene):
    ids = {s["id"] for s in sb.solids}
    for item in scene.get("items") or []:
        if item.get("type") not in BAND_CARS:
            continue
        props = item.get("props") or {}
        turns = props.get("band_turns")
        if not isinstance(turns, (int, float)) or isinstance(turns, bool) or not (turns > 0):
            continue
        size = props.get("band_size") if props.get("band_size") in BAND_SIZES else "medium"
        iid = item["id"]
        wheel, chassis = f"{iid}/rear", f"{iid}/chassis"
        if wheel not in ids or chassis not in ids:
            continue
        P = props_of(item)
        rec = {"kind": "softbody", "id": f"{iid}/band", "item": iid, "role": "motor", "wheel": wheel, "chassis": chassis}
        if f"{iid}/front" in ids:
            rec["front"] = f"{iid}/front"
        rec.update({"turns": round(min(30.0, float(turns)), 3), "r": AXLE_R, "l0": round(0.6 * P["length"], 5), "area": BAND_SIZES[size],
                    "E": RUBBER_E, "n": 2, "resilience": RESILIENCE, "lock": RUBBER_LOCK, "sense": -1})
        sb.processes.append(rec)


# ---------------------------------------------------------------- goals (web/sim/modules/softbody.js reports the same, number for number)
DEFORM_KEYS = ("bend_mm", "dent_mm", "squash_mm", "compression_mm", "stretch_cm", "band_stretch_cm")
BEAM_TYPES = ("flex-ruler", "springboard", "flex-plank")
PEAK_KEYS = ("squash_mm", "stretch_cm", "band_stretch_cm")


def _series(ctx, iid, key):
    v = ctx.state(iid, key)
    return [x for x in v if isinstance(x, (int, float)) and not isinstance(x, bool)] if v else None


def deformation(ctx, iid):
    """(how much the item is deformed in mm, at the end and at its most, the reading used) by its own reading: a beam's bend, clay's dent, a ball's
    squash, a spring's compression, a band's stretch (cm become mm); None when it has none."""
    for key in DEFORM_KEYS:
        v = _series(ctx, iid, key)
        if v:
            k = 10.0 if key.endswith("_cm") else 1.0
            return v[-1] * k, max(abs(x) for x in v) * k, key
    return None


def _peak_energy(ctx, iid):
    best = None
    for key in ("energy_j", "band_energy_j"):
        v = _series(ctx, iid, key)
        if v:
            m = max(v)
            best = m if best is None else max(best, m)
    return best


def _snapped(ctx, iid):
    v = _series(ctx, iid, "broken")
    return bool(v) and v[-1] >= 1


def bounce_height(ctx, iid):
    """(how high the item rises after its first landing, m, the time it landed) by its frames: the highest its centre gets before it comes down
    again, less where its centre was as it touched (its lowest point plus its squash there: the bottom of a ball's rise over what it landed on);
    None when it never falls 1 cm and turns back up. The mean of its moving parts for a thing of several."""
    sols = [x["id"] for x in ctx.solids(iid, True)]
    if not sols:
        return None
    ys = []
    for f in ctx.frames:
        pl = f["placements"]
        y = 0.0
        for sid in sols:
            if sid not in pl:
                return None
            y += pl[sid]["y"]
        ys.append(y / len(sols))
    top = ys[0]
    k1 = None
    for k in range(1, len(ys) - 1):
        top = max(top, ys[k])
        if top - ys[k] >= 0.01 and ys[k] <= ys[k - 1] and ys[k] < ys[k + 1]:
            k1 = k
            break
    if k1 is None:
        return None
    sq = ctx.state(iid, "squash_mm")
    squash = sq[k1] if sq is not None and k1 < len(sq) and isinstance(sq[k1], (int, float)) and not isinstance(sq[k1], bool) else 0.0
    touch = ys[k1] + squash / 1000.0
    apex = ys[k1]
    for j in range(k1 + 1, len(ys)):
        apex = max(apex, ys[j])
        if j + 1 < len(ys) and ys[j] <= ys[j - 1] and ys[j] < ys[j + 1]:
            break
    return max(0.0, apex - touch), ctx.times[k1]


def _fmt(v):
    t = f"{v:.2f}"
    return t.rstrip("0").rstrip(".") if "." in t else t   # (web/sim: py.fmtF, Python's own rounding)


def _goals():
    def squashes(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("at_least_mm"))
        least = 1.0 if least is None else least
        v = _series(ctx, g["item"], "dent_mm")
        dent = v[-1] if v else None
        ok = dent is not None and dent >= least - 1e-9
        return {"label": g.get("label") or f"{ctx.name(g['item'])} squashes and stays squashed", "ok": ok, "kind": "squashes", "item": g["item"],
                "dent_mm": None if dent is None else round(dent, 2)}

    def springs_back(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        d = deformation(ctx, g["item"])
        dent = _series(ctx, g["item"], "dent_mm")
        set_deg = _series(ctx, g["item"], "set_deg")
        kept = (dent[-1] if dent else 0.0) >= 0.5 or (set_deg[-1] if set_deg else 0.0) >= 0.5 or _snapped(ctx, g["item"])
        peak = None if d is None else d[1]
        ok = peak is not None and peak >= 2.0 - 1e-9 and not kept
        return {"label": g.get("label") or f"{ctx.name(g['item'])} springs back", "ok": ok, "kind": "springs_back", "item": g["item"],
                "peak_mm": None if peak is None else round(peak, 2)}

    # (another module's "bends", registered before this one: the heat module's bimetal strip. A thing that is not one of these beams is judged
    # by it, so both modules' items keep their own rule under the one kind)
    other_bends = GOAL_KINDS.get("bends")

    def bends(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        if other_bends is not None and ctx.items[g["item"]].get("type") not in BEAM_TYPES:
            return other_bends(ctx, g)
        lo, hi = ctx.num(g.get("at_least_mm")), ctx.num(g.get("at_most_mm"))
        lo = 1.0 if lo is None and hi is None else lo
        v = _series(ctx, g["item"], "bend_mm")
        end = v[-1] if v else None
        ok = end is not None and (lo is None or end >= lo - 1e-9) and (hi is None or end <= hi + 1e-9)
        bounds = (f" at least {_fmt(lo)} mm" if lo is not None else "") + (f" at most {_fmt(hi)} mm" if hi is not None else "")
        return {"label": g.get("label") or f"{ctx.name(g['item'])} bends{bounds}", "ok": ok, "kind": "bends", "item": g["item"],
                "bend_mm": None if end is None else round(end, 2)}

    def deforms_more(ctx, g):
        if not ctx.known(g.get("a")) or not ctx.known(g.get("b")):
            return None
        da, db = deformation(ctx, g["a"]), deformation(ctx, g["b"])
        # (a squash or a band's stretch is judged at its most, a bend, a dent or a spring's compression where it ends)
        va = None if da is None else (da[1] if da[2] in PEAK_KEYS else da[0])
        vb = None if db is None else (db[1] if db[2] in PEAK_KEYS else db[0])
        # (by 5 % and 0.2 mm; bends under 1 mm, a stiff ruler's, by a quarter and 0.02 mm)
        ok = va is not None and vb is not None and (va > vb * 1.05 + 0.2 or (va < 1.0 and va >= vb * 1.25 + 0.02))
        out = {"label": g.get("label") or f"{ctx.name(g['a'])} bends or squashes more than {ctx.name(g['b'])}", "ok": ok, "kind": "deforms_more",
               "a": g["a"], "b": g["b"], "a_mm": None if va is None else round(va, 2), "b_mm": None if vb is None else round(vb, 2)}
        if va is not None and vb is not None and abs(va) < 1.0 and abs(vb) < 1.0:
            out["small"] = True
        return out

    def stores(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        least = ctx.num(g.get("at_least_j"))
        least = 0.01 if least is None else least
        e = _peak_energy(ctx, g["item"])
        ok = e is not None and e >= least - 1e-12
        return {"label": g.get("label") or f"{ctx.name(g['item'])} stores at least {_fmt(least)} J", "ok": ok, "kind": "stores", "item": g["item"],
                "energy_j": None if e is None else round(e, 4)}

    def bounces(ctx, g):
        if not ctx.known(g.get("item")):
            return None
        lo, hi = ctx.num(g.get("at_least_m")), ctx.num(g.get("at_most_m"))
        bounds = (f" at least {_fmt(lo)} m" if lo is not None else "") + (f" at most {_fmt(hi)} m" if hi is not None else "")
        lo = 0.02 if lo is None and hi is None else lo
        b = bounce_height(ctx, g["item"])
        h = None if b is None else b[0]
        ok = h is not None and (lo is None or h >= lo - 1e-9) and (hi is None or h <= hi + 1e-9)
        return {"label": g.get("label") or f"{ctx.name(g['item'])} bounces{bounds}{' high' if bounds else ''}", "ok": ok, "kind": "bounces", "item": g["item"],
                "bounce_m": None if h is None else round(h, 3)}

    def bounces_more(ctx, g):
        if not ctx.known(g.get("a")) or not ctx.known(g.get("b")):
            return None
        ba, bb = bounce_height(ctx, g["a"]), bounce_height(ctx, g["b"])
        ha, hb = None if ba is None else ba[0], None if bb is None else bb[0]
        ok = ha is not None and hb is not None and ha > hb * 1.05 + 0.01
        return {"label": g.get("label") or f"{ctx.name(g['a'])} bounces higher than {ctx.name(g['b'])}", "ok": ok, "kind": "bounces_more",
                "a": g["a"], "b": g["b"], "a_m": None if ha is None else round(ha, 3), "b_m": None if hb is None else round(hb, 3)}

    register_goal_kind("squashes", squashes)
    register_goal_kind("springs_back", springs_back)
    register_goal_kind("bends", bends)
    register_goal_kind("deforms_more", deforms_more)
    register_goal_kind("stores", stores)
    register_goal_kind("bounces", bounces)
    register_goal_kind("bounces_more", bounces_more)
