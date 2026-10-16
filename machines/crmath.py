"""The builders' platform-free math: the same bits as the engine's pow (tools/crpow.ts, web/sim/engine-math.js) and as web/sim/pymath.js's
sin and cos, on any machine.

Python's `x ** y` is the platform libm's pow (Apple's on macOS, glibc's on Linux), and neither is correctly rounded: Apple's gives the
neighbour of the right double for about 1 cube in 750, glibc's now and then too, each differently. The browser cannot copy either, so a
number the builders print unrounded (a steel weight's side, (mass / density) ** (1/3); a wheel's cube) would differ between the server
and the page, and between a Mac and Linux. These functions compute the correctly rounded value instead, which tools/crpow.ts also does,
so both sides agree everywhere:
  sq(x)        x ** 2   (x * x: one IEEE product is correctly rounded)
  cube(x)      x ** 3   exactly with integers, then one correctly rounded division
  cr_pow(x, y) x ** y   for x > 0 finite and any finite y (the cube roots): Ziv's loop on decimal.Decimal, whose ln and exp are correctly
                        rounded, with the exact and halfway cases settled by integer arithmetic first
  sin(x), cos(x)        math.sin / math.cos, except at the multiples of 30 degrees (x == d * (pi / 180), d = +-30 ... +-3600), where they
                        are web/sim/trig.js's values, the table pymath.js's sin and cos read: there an offset with five decimals turned by
                        the angle lands on a rounding tie, and the last bit (which libms and JavaScript engines round differently) decides it
web/sim keeps these names: cube from engine-math.js, pow(x, 1 / 3) from engine-math.js, x * x, and sin, cos from pymath.js.
Only these are platform-free. The builders' other libm calls (math.tan, atan2, acos, asin, sinh/cosh/asinh, log10, and sin/cos at other
angles) are still the platform's here and V8's in web/sim: they can differ in the last bit, which shows in a document only where a printed
number lands exactly on a rounding tie (the hanging chain's documented case: tools/parity/mechanisms.mjs --groups chainties).
"""
import math
import os
import re
from decimal import Decimal, localcontext
from functools import lru_cache


def sq(x):
    """x ** 2 correctly rounded: x * x."""
    return x * x


def _ratio_pow(x, n):
    """x ** n for a float x != 0 and an int n, correctly rounded (int / int true division is, in CPython)."""
    num, den = x.as_integer_ratio()
    if n < 0:
        num, den, n = den, num, -n
    if den < 0:
        num, den = -num, -den
    return (num ** n) / (den ** n)


def cube(x):
    """x ** 3 correctly rounded (+-inf past the largest double, as JavaScript gives; Python's own x ** 3 raises there)."""
    if x == 0 or not math.isfinite(x):
        return x * x * x
    try:
        return _ratio_pow(x, 3)
    except OverflowError:
        return math.copysign(math.inf, x)


def _decompose(x):
    """x (finite, > 0) = m * 2 ** e with m an odd int."""
    num, den = x.as_integer_ratio()  # den is a power of two
    e = -(den.bit_length() - 1)
    tz = (num & -num).bit_length() - 1
    return num >> tz, e + tz


def _div(num, den):
    """num / den for ints, correctly rounded (CPython's int true division), inf past the largest double."""
    try:
        return num / den
    except OverflowError:
        return math.inf


def _exact(x, y):
    """x ** y when it is a dyadic rational of manageable size (the exact and halfway cases): correctly rounded; else None (then it is
    irrational, or a rational that is not dyadic, or a dyadic too long to be a double or a halfway point: never a rounding boundary)."""
    mx, ex = _decompose(x)
    my, ey = _decompose(abs(y))
    if ey >= 0:
        n = my << ey
        base, e2 = mx, ex * n
    else:
        # y = my / 2^k: a rational power only if mx is a perfect 2^k-th power and ex * my a multiple of 2^k
        k = -ey
        if (ex * my) % (1 << k):
            return None
        w = mx
        if mx != 1:
            if k > 5:  # 3 ** 64 > 2 ** 53: no odd mx > 1 is a 2^6-th power
                return None
            for _ in range(k):
                s = math.isqrt(w)
                if s * s != w:
                    return None
                w = s
        n, base, e2 = my, w, (ex * my) >> k
    if y < 0:
        e2 = -e2
    if base == 1:
        if e2 > 2000:
            return math.inf
        if e2 < -2000:
            return 0.0
        return _div(1 << e2, 1) if e2 >= 0 else _div(1, 1 << -e2)
    if base.bit_length() * n > 4096:
        return None
    p = base ** n
    if y > 0:
        return _div(p << e2, 1) if e2 >= 0 else _div(p, 1 << -e2)
    return _div(1 << e2, p) if e2 >= 0 else _div(1, p << -e2)


@lru_cache(maxsize=65536)
def cr_pow(x, y):
    """x ** y correctly rounded, for x > 0 finite and y finite (what tools/crpow.ts gives); any other x is Python's own x ** y."""
    if not (x > 0 and math.isfinite(x) and math.isfinite(y)):
        return x ** y
    if y == 0 or x == 1:
        return 1.0
    if y == 2:
        return x * x
    if y == 1:
        return x
    if y == 0.5:
        return math.sqrt(x)
    if y == -1:
        return 1 / x
    exact = _exact(x, y)
    if exact is not None:
        return exact
    # far past the overflow or underflow threshold (2^1024, 2^-1075; y log2 x is good to a few units in its last place): settled here, so
    # that below |y ln x| < 763, Decimal's exp cannot overflow and eps stays far under 1 (v * (1 - eps) > 0)
    est = y * math.log2(x)
    if est > 1100:
        return math.inf
    if est < -1100:
        return 0.0
    # Ziv: v = exp(y ln x) at `prec` digits is within eps * v of x ** y (ln, the product and exp each round once, to within half a unit
    # in the last digit: a relative 5e-prec, the product's error multiplied by |y ln x| on the way through exp); the bounds of that interval
    # are converted to floats (correctly rounded); equal, they are the answer.
    for prec in (40, 80, 160, 320, 640):
        with localcontext() as ctx:
            ctx.prec = prec
            ctx.Emax, ctx.Emin = 999999, -999999
            t = Decimal(y) * Decimal(x).ln()
            v = t.exp()
            u = Decimal(5) * Decimal(10) ** -prec
            eps = u * (3 + 3 * abs(t))
            ctx.prec = prec + 20
            lo, hi = float(v * (1 - eps)), float(v * (1 + eps))
        if lo == hi:
            return lo
    raise ArithmeticError(f"cr_pow({x!r}, {y!r}): no rounding")


# ---------------------------------------------------------------- sin and cos: pymath.js's, with its table of the multiples of 30 degrees
_D2R = math.pi / 180


def _trig30():
    """web/sim/trig.js (tools/parity/gen_trig.py wrote it): TRIG30_RANGE and the two tables, index = degrees / 30 + TRIG30_RANGE / 30."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "sim", "trig.js")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    rng = int(re.search(r"export const TRIG30_RANGE = (\d+)\n", src).group(1))
    tables = []
    for name in ("TRIG30_SIN", "TRIG30_COS"):
        body = re.search(r"export const %s = \[([^\]]*)\]" % name, src).group(1)
        tables.append(tuple(float(t) for t in body.split(",") if t.strip()))  # repr()'s digits: the same double JavaScript reads
    if rng % 30 or any(len(t) != 2 * rng // 30 + 1 for t in tables):
        raise ValueError(f"{path}: not a table of the multiples of 30 degrees in +-{rng}")
    return rng, tables[0], tables[1]


_TRIG30_RANGE, _TRIG30_SIN, _TRIG30_COS = _trig30()


def _thirty_degrees(x):
    """The table's index when x is d * (pi / 180) for a multiple d of 30 degrees, 0 < |d| <= TRIG30_RANGE; else -1 (pymath.js thirtyDegrees)."""
    if not -63.0 < x < 63.0:  # 3600 degrees is 62.83 radians (and inf, nan and huge x never match)
        return -1
    d = round(x / _D2R)
    return d // 30 + _TRIG30_RANGE // 30 if d != 0 and d % 30 == 0 and -_TRIG30_RANGE <= d <= _TRIG30_RANGE and d * _D2R == x else -1


def sin(x):
    """math.sin(x), or the table's value at a multiple of 30 degrees (the same bits as web/sim/pymath.js sin on any machine)."""
    i = _thirty_degrees(x)
    return math.sin(x) if i < 0 else _TRIG30_SIN[i]


def cos(x):
    """math.cos(x), or the table's value at a multiple of 30 degrees (the same bits as web/sim/pymath.js cos on any machine)."""
    i = _thirty_degrees(x)
    return math.cos(x) if i < 0 else _TRIG30_COS[i]
