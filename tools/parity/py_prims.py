"""The Python side of tools/parity/prims.mjs: computes what CPython does for the numbers and strings web/sim/pymath.js reproduces.

usage: python3 tools/parity/py_prims.py in.json out.json      in.json = {"op": name, "cases": [...]}; out.json = {"results": [...]}
Doubles travel as 16 hex digits of their IEEE bits (so the sign of zero and subnormals survive); an error is "ERR:<ExceptionName>".
"""
import hashlib
import json
import math
import os
import struct
import sys


def d(h):
    return struct.unpack(">d", bytes.fromhex(h))[0]


def h(x):
    return struct.pack(">d", x).hex()


def crmath():
    """machines/crmath.py (the builders' correctly rounded powers, and their sin and cos with web/sim's table at multiples of 30 degrees)."""
    if "crmath" not in sys.modules:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "machines"))
    import crmath
    return crmath


def run(op, c):
    if op == "round":
        return h(round(d(c[0]), c[1]))
    if op == "roundint":
        return str(round(d(c)))
    if op == "repr":
        return repr(d(c))
    if op == "fmtf":
        return format(d(c[0]), f".{c[1]}f")
    if op == "fmtg":
        return format(d(c[0]), f".{c[1]}g")
    if op == "hypot":
        return h(math.hypot(d(c[0]), d(c[1])))
    if op == "hypot3":
        return h(math.hypot(d(c[0]), d(c[1]), d(c[2])))
    if op == "sum":
        return h(sum(d(x) for x in c))
    if op == "sum1":
        return h(sum(d(x) for x in c))
    if op == "cube":
        return h(d(c) ** 3)
    if op == "crcube":
        return h(crmath().cube(d(c)))
    if op == "crcbrt":
        return h(crmath().cr_pow(d(c), 1 / 3))
    if op == "sin":
        return h(math.sin(d(c)))
    if op == "cos":
        return h(math.cos(d(c)))
    if op == "crsin":
        return h(crmath().sin(d(c)))
    if op == "crcos":
        return h(crmath().cos(d(c)))
    if op == "atan2":
        return h(math.atan2(d(c[0]), d(c[1])))
    if op == "floorlog10":
        return str(math.floor(math.log10(d(c))))
    if op == "pyfloat":
        return h(float(c))
    if op == "pyrepr":
        return repr(json.loads(c))
    if op == "dumps":
        return json.dumps(json.loads(c), sort_keys=True)
    if op == "sha1":
        return hashlib.sha1(c.encode()).hexdigest()
    if op == "strrepr":
        return repr(chr(c))
    if op == "strip":
        return json.dumps(json.loads(c).strip(), ensure_ascii=False)
    if op == "strlen":
        return str(len(json.loads(c)))
    if op == "lower_all":     # c is a template number: that template around every code point (but the surrogates), lower()ed
        return [LOWER_TEMPLATES[c](chr(cp)).lower() for cp in range(0x110000) if not 0xD800 <= cp <= 0xDFFF]
    if op == "float_all":     # float() of that template around every code point: only the ones that work, as "code point:bits"
        out = []
        for cp in range(0x110000):
            if 0xD800 <= cp <= 0xDFFF:
                continue
            try:
                out.append(f"{cp}:{h(float(FLOAT_TEMPLATES[c](chr(cp))))}")
            except ValueError:
                pass
        return out
    if op == "float_one":     # (template, code point) -> "code point:bits", or None when float() refuses it
        try:
            return f"{c[1]}:{h(float(FLOAT_TEMPLATES[c[0]](chr(c[1]))))}"
        except ValueError:
            return None
    raise ValueError(op)


LOWER_TEMPLATES = [lambda c: c, lambda c: c + "\u03a3", lambda c: "a" + c + "\u03a3", lambda c: "a\u03a3" + c, lambda c: c + "\u03a3a", lambda c: "a" + c + "\u03a3" + c + "a"]
FLOAT_TEMPLATES = [lambda c: c, lambda c: "1" + c, lambda c: c + "1", lambda c: "1" + c + "2"]


def worldfuzz(n, seed, outfile):
    """n random item placements (x, y, angle, a local offset) through Ctx.world's formula (crmath's sin and cos) and round(.., 5), written as 8 doubles each:
    ox, oy, angle_deg, lx, ly, x, y, ulps (1 if sin or cos of the angle differs from the other side's in the last bit; filled in by the JS side)."""
    import random
    r = random.Random(seed)
    D2R = math.pi / 180
    buf = bytearray()
    for _ in range(n):
        dp = r.choice([0, 1, 2, 3, 4, 5, 6, 6, 6])
        nice = lambda lo, hi: round(r.uniform(lo, hi), dp)
        ox, oy, lx, ly = nice(-3, 3), nice(-1, 3), nice(-0.6, 0.6), nice(-0.6, 0.6)
        if r.random() < 0.25:
            lx = r.choice([0, 0.00001, 0.000005, 0.000015, -0.00001, 0.00003, 0.5, 0.25, 0.1]) * r.choice([1, 1, 1, 3, 5, 7])
        if r.random() < 0.25:
            ly = r.choice([0, 0.00001, 0.000005, 0.000015, -0.00001, 0.00003, 0.5, 0.25, 0.1]) * r.choice([1, 1, 1, 3, 5, 7])
        deg = r.choice([r.randint(-720, 720), r.randint(-720, 720) * 0.25, round(r.uniform(-100000, 100000), 3), r.choice([30, 45, 60, 90, 120, 135, 150, 180, 240, 270, 300, 360, -30, -45, -60, -90, -120])])
        a = deg * D2R
        ca, sa = crmath().cos(a), crmath().sin(a)  # as items.py's Ctx.world does
        x = round(ox + lx * ca - ly * sa, 5)
        y = round(oy + lx * sa + ly * ca, 5)
        buf += struct.pack(">8d", ox, oy, deg, lx, ly, x, y, 0.0)
    open(outfile, "wb").write(buf)


def digests(outfile):
    """SHA-1 of what CPython gives for text at every code point (but the surrogates): repr(), lower() in the Final_Sigma contexts, float().
    tools/parity/browser.mjs computes the same in the page and compares, so the whole check runs in a real browser without shipping the answers."""
    sep = "\U0010ffff"
    cps = [cp for cp in range(0x110000) if not 0xD800 <= cp <= 0xDFFF]

    def dig(parts):
        return hashlib.sha1(sep.join(parts).encode("utf-8")).hexdigest()

    out = {"repr": dig([repr(chr(cp)) for cp in cps])}
    for k in (0, 2, 3, 5):
        out[f"lower{k}"] = dig([LOWER_TEMPLATES[k](chr(cp)).lower() for cp in cps])
    for k in (0, 1):
        out[f"float{k}"] = dig([r for r in (run("float_one", (k, cp)) for cp in cps) if r is not None])
    json.dump(out, open(outfile, "w"))


def main():
    if sys.argv[1] == "digests":
        return digests(sys.argv[2])
    if sys.argv[1] == "worldfuzz":
        return worldfuzz(int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
    req = json.load(open(sys.argv[1]))
    out = []
    for c in req["cases"]:
        try:
            out.append(run(req["op"], c))
        except Exception as e:  # noqa: BLE001
            out.append("ERR:" + type(e).__name__)
    json.dump({"results": out}, open(sys.argv[2], "w"))


main()
