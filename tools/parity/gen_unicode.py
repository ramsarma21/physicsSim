"""Writes web/sim/unicode.js: the pieces of CPython's Unicode data that scene text can reach, as plain tables.

Why: Python 3.13 knows Unicode 15.1; node 26 and Chromium know 17.0, and Safari and Firefox each their own. Three things the server did with
text depend on the version, and a table made here makes them the same in every browser:
  repr(str)        which code points it escapes (not str.isprintable()): the 400 messages quote ids and values with it
  float(str)       which non-ASCII characters are decimal digits (Unicode category Nd, `unicodedata.decimal`), and what each digit is
  str.lower()      the lower-case mapping of every non-ASCII character, and Final_Sigma: U+03A3 lower-cases to U+03C2 at the end of a word
                   and to U+03C3 elsewhere, which needs the Cased and Case_Ignorable properties (read here from how lower() treats them)
The script checks every table against Python itself, for every code point, before it writes the file.
usage: python3 tools/parity/gen_unicode.py
"""
import bisect
import json
import os
import sys
import unicodedata

PG = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
N = 0x110000
SIGMA = "Σ"


def ranges_where(pred, lo=0, hi=N):
    """[(first, last)] of the maximal runs of code points in [lo, hi) with pred(cp) true."""
    out = []
    start = None
    for cp in range(lo, hi):
        if pred(cp):
            if start is None:
                start = cp
        elif start is not None:
            out.append((start, cp - 1))
            start = None
    if start is not None:
        out.append((start, hi - 1))
    return out


def nonprintable():
    return ranges_where(lambda cp: not chr(cp).isprintable(), 0x80)


def decimal_zeros():
    zeros = [cp for cp in range(N) if unicodedata.decimal(chr(cp), None) == 0]
    for z in zeros:  # every digit set is ten code points in a row: the value of one is its distance from the zero before it
        assert all(unicodedata.decimal(chr(z + k), None) == k for k in range(10)), hex(z)
    assert 10 * len(zeros) == sum(1 for cp in range(N) if unicodedata.decimal(chr(cp), None) is not None)
    return zeros


def lower_tables():
    """(runs [(first, last, stride, delta)], multi [(cp, text)]) for the non-ASCII characters whose lower() is another character; U+03A3 is
    context-dependent and left to the sigma rule."""
    single = {}
    multi = []
    for cp in range(0x80, N):
        c = chr(cp)
        low = c.lower()
        if low == c or cp == 0x3A3:
            continue
        if len(low) == 1:
            single[cp] = ord(low) - cp
        else:
            multi.append((cp, low))
    cps = sorted(single)
    runs = []
    i = 0
    while i < len(cps):
        best = (i, 1)
        for stride in (1, 2):  # a run: the same delta at every code point, or at every second one (Ā ā Ă ă ...)
            j = i
            while j + 1 < len(cps) and cps[j + 1] == cps[j] + stride and single[cps[j + 1]] == single[cps[i]]:
                j += 1
            if j > best[0]:
                best = (j, stride)
        j, stride = best
        runs.append((cps[i], cps[j], stride, single[cps[i]]))
        i = j + 1
    return runs, multi


def sigma_classes():
    """[(first, last, class)]: 1 = case-ignorable (skipped when Final_Sigma looks for a neighbour), 2 = cased (and not case-ignorable).
    Read from lower() itself: c + SIGMA ends in the final sigma exactly when c is cased and not ignorable; "a" + c + SIGMA when c is ignorable
    or cased."""
    def cls(cp):
        c = chr(cp)
        if ("" + c + SIGMA).lower()[-1] == "ς":
            return 2
        if ("a" + c + SIGMA).lower()[-1] == "ς":
            return 1
        return 0
    out = []
    start = prev = kind = None
    for cp in range(N):
        k = cls(cp)
        if k and start is not None and k == kind and cp == prev + 1:
            prev = cp
            continue
        if start is not None:
            out.append((start, prev, kind))
        start, prev, kind = (cp, cp, k) if k else (None, None, None)
    if start is not None:
        out.append((start, prev, kind))
    return out


# ---- the same lookups the JavaScript does, checked against Python
class Lookup:
    """What web/sim/pymath.js does with the tables, step for step (binary search over the flat [first, last, ...] arrays)."""

    def __init__(self, nonprint, zeros, low_runs, multi, sig):
        self.np_first = [r[0] for r in nonprint]
        self.np = nonprint
        self.zeros = zeros
        self.low_first = [r[0] for r in low_runs]
        self.low = low_runs
        self.multi = dict(multi)
        self.sig_first = [r[0] for r in sig]
        self.sig = sig

    def nonprintable(self, cp):
        i = bisect.bisect_right(self.np_first, cp) - 1
        return i >= 0 and cp <= self.np[i][1]

    def decimal(self, cp):
        i = bisect.bisect_right(self.zeros, cp) - 1
        return cp - self.zeros[i] if i >= 0 and cp - self.zeros[i] < 10 else -1

    def lower_char(self, cp):
        i = bisect.bisect_right(self.low_first, cp) - 1
        if i >= 0:
            first, last, stride, delta = self.low[i]
            if cp <= last and (cp - first) % stride == 0:
                return chr(cp + delta)
        return self.multi.get(cp, chr(cp))

    def cls(self, cp):
        i = bisect.bisect_right(self.sig_first, cp) - 1
        return self.sig[i][2] if i >= 0 and cp <= self.sig[i][1] else 0

    def lower(self, s):
        cps = [ord(c) for c in s]
        out = []
        for i, cp in enumerate(cps):
            if cp < 0x80:
                out.append(chr(cp + 32) if 65 <= cp <= 90 else chr(cp))
            elif cp == 0x3A3:
                j = i - 1
                while j >= 0 and self.cls(cps[j]) == 1:
                    j -= 1
                final = j >= 0 and self.cls(cps[j]) == 2
                if final:
                    j = i + 1
                    while j < len(cps) and self.cls(cps[j]) == 1:
                        j += 1
                    final = j == len(cps) or self.cls(cps[j]) != 2
                out.append("\u03c2" if final else "\u03c3")
            else:
                out.append(self.lower_char(cp))
        return "".join(out)


def check(nonprint, zeros, low_runs, multi, sig):
    t = Lookup(nonprint, zeros, low_runs, multi, sig)
    classes = {cp for first, last, _ in sig for cp in range(first, last + 1)}
    for cp in range(N):
        c = chr(cp)
        if cp >= 0x80:
            assert t.nonprintable(cp) == (not c.isprintable()), hex(cp)
        assert (t.decimal(cp) >= 0) == (unicodedata.decimal(c, None) is not None), hex(cp)
        if t.decimal(cp) >= 0:
            assert t.decimal(cp) == unicodedata.decimal(c), hex(cp)
        assert t.lower(c) == c.lower(), hex(cp)
        if cp in classes or cp % 7 == 0 or cp < 0x3000:  # (the Final_Sigma contexts: every character that has a class, and a good share of the rest)
            for s in (c + SIGMA, "a" + c + SIGMA, "a" + SIGMA + c, c + SIGMA + "a", "a" + c + SIGMA + c + "a", SIGMA + c + SIGMA):
                assert t.lower(s) == s.lower(), (hex(cp), s)


def fmt(name, values, per_line, comment):
    lines = [f"// {comment}", f"export const {name} = ["]
    for i in range(0, len(values), per_line):
        chunk = values[i:i + per_line]
        lines.append("\t" + ", ".join(str(v) for v in chunk) + ("," if i + per_line < len(values) else ""))
    lines.append("]")
    return "\n".join(lines)


def main():
    nonprint = nonprintable()
    zeros = decimal_zeros()
    low_runs, multi = lower_tables()
    sig = sigma_classes()
    print("checking every table against Python for every code point ...", file=sys.stderr)
    check(nonprint, zeros, low_runs, multi, sig)
    out = os.path.join(PG, "web", "sim", "unicode.js")
    parts = [
        f"// Generated by tools/parity/gen_unicode.py from CPython {sys.version.split()[0]}'s Unicode {unicodedata.unidata_version} data. Do not edit; see the script for why.",
        "// What a browser's own Unicode tables would answer differently (its version is newer, or just not the same) is read from these instead:",
        "// pymath.js uses them for repr(str), float(str) and str.lower().",
        f'export const UNICODE_VERSION = "{unicodedata.unidata_version}"',
        fmt("NONPRINTABLE", [v for r in nonprint for v in r], 12, "[first, last, ...]: the code points from U+0080 up that repr() escapes (not str.isprintable())"),
        fmt("DECIMAL_ZEROS", zeros, 12, "the code points whose Unicode decimal value is 0: each starts a run of ten digits (value = distance from it)"),
        fmt("LOWER_RUNS", [v for r in low_runs for v in r], 12, "[first, last, stride, delta, ...]: non-ASCII str.lower(): code point + delta, at every stride-th code point from first to last"),
        "// the lower() of the characters that lower-case to more than one: [code point, text]",
        "export const LOWER_MULTI = [" + ", ".join(f"[{cp}, {json.dumps(low)}]" for cp, low in multi) + "]",
        fmt("SIGMA_CLASS", [v for r in sig for v in r], 12, "[first, last, class, ...]: 1 = case-ignorable (Final_Sigma skips it), 2 = cased and not case-ignorable; every other code point is neither"),
    ]
    with open(out, "w") as f:
        f.write("\n".join(parts) + "\n")
    print(out, f"{len(nonprint)} non-printable ranges, {len(zeros)} digit sets, {len(low_runs)} lower runs + {len(multi)} multi, {len(sig)} sigma ranges, {os.path.getsize(out)} bytes")


main()
