#!/usr/bin/env bash
# CI only (called by engine-bundle.sh build-or-stub): makes `npm run build:engine` work without the Apple tables, by writing a
# tools/apple-pow-tables.ts of zeros and making tools/fdlibm.ts's pow the platform's own Math.pow. On macOS, V8's Math.pow is the libm
# routine the tables reproduce, so in node and Chromium on a Mac this bundle gives the same bits as the real one (the parity suite found
# 0 mismatches with it); it is NOT the real bundle anywhere else, and it is never deployed. It changes tools/fdlibm.ts in the CI checkout,
# so it refuses to run outside GitHub Actions or where the real tables are present.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "${GITHUB_ACTIONS:-}" != true ]; then
	echo "stub-pow: CI only (it rewrites tools/fdlibm.ts); not running" >&2
	exit 2
fi
if [ -e tools/apple-pow-tables.ts ]; then
	echo "stub-pow: tools/apple-pow-tables.ts exists; not replacing it" >&2
	exit 2
fi
z16=0000000000000000
z32=$z16$z16
{
	echo "export const LOG_COEF = \"$(printf "$z16 %.0s" $(seq 11) | sed 's/ $//')\""
	echo "export const EXP_COEF = \"$(printf "$z16 %.0s" $(seq 5) | sed 's/ $//')\""
	echo "export const LOG_TAB = \"$(printf "$z32 %.0s" $(seq 129) | sed 's/ $//')\""
	echo "export const EXP_TAB = \"$(printf "$z32 %.0s" $(seq 128) | sed 's/ $//')\""
} >tools/apple-pow-tables.ts
node -e '
const fs = require("fs")
const f = "tools/fdlibm.ts"
let s = fs.readFileSync(f, "utf8")
const head = "export const pow = (x: number, y: number): number => {"
if (!s.includes(head)) throw new Error("fdlibm.ts: no pow to stub")
s = s.replace(head, "export const pow = (x: number, y: number): number => nativePow(x, y)\nexport const applePowUnused = (x: number, y: number): number => {")
fs.writeFileSync(f, s)
'
echo "stub-pow: tools/apple-pow-tables.ts (zeros) written; tools/fdlibm.ts pow = Math.pow"
