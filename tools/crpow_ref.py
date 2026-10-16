"""The reference for tools/test-crpow.mjs: x ** y correctly rounded by MPFR (gmpy2), in binary64 with subnormals.

usage: python3 -I tools/crpow_ref.py pairs.bin out.bin [workers]
  pairs.bin: little-endian float64 pairs (x, y); out.bin: one float64 per pair, MPFR's pow in round-to-nearest-even. Only finite x, y
  with a finite or overflowing result are meaningful (the special values follow C's pow there, not ECMAScript's: the test does not ask).
  --err parts.bin: rows of six float64 (x, y, Rh, Rl, e, Lh) -> the worst relative error of (Rh + Rl) 2^e against |x| ** y, overall and
  divided by (1 + |Lh|), printed as JSON.
Needs gmpy2 (pip install gmpy2) and numpy.
"""
import json
import math
import os
import sys
from multiprocessing import Pool

import gmpy2
import numpy as np
from gmpy2 import mpfr


def _pow(rows):
    gmpy2.set_context(gmpy2.ieee(64))
    out = np.empty(len(rows))
    for i, (x, y) in enumerate(rows.tolist()):
        try:
            out[i] = float(mpfr(x) ** mpfr(y))
        except (ValueError, ArithmeticError):
            out[i] = math.nan
    return out


def _err(rows):
    ctx = gmpy2.get_context()
    ctx.precision, ctx.emin, ctx.emax = 320, -1000000, 1000000
    worst, worst_l, at = 0.0, 0.0, None
    for x, y, rh, rl, e, lh in rows.tolist():
        if rh != rh:
            continue
        true = abs(mpfr(x)) ** mpfr(y)
        rel = float(abs(((mpfr(rh) + mpfr(rl)) * gmpy2.exp2(int(e)) - true) / true))
        worst = max(worst, rel)
        if rel / (1 + abs(lh)) > worst_l:
            worst_l, at = rel / (1 + abs(lh)), (x, y)
    return worst, worst_l, at


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    workers = int(args[2]) if len(args) > 2 else (os.cpu_count() or 1)
    if "--err" in sys.argv:
        a = np.fromfile(args[0], dtype="<f8").reshape(-1, 6)
        with Pool(workers) as p:
            res = p.map(_err, np.array_split(a, workers * 4))
        w = max(r[0] for r in res)
        wl = max(res, key=lambda r: r[1])
        print(json.dumps({"rows": len(a), "worst": math.log2(w) if w else None, "worstPerL": math.log2(wl[1]) if wl[1] else None, "at": wl[2]}))
        return
    a = np.fromfile(args[0], dtype="<f8").reshape(-1, 2)
    with Pool(workers) as p:
        res = p.map(_pow, np.array_split(a, max(1, min(len(a), workers * 16))))
    np.concatenate(res).astype("<f8").tofile(args[1])


if __name__ == "__main__":
    main()
