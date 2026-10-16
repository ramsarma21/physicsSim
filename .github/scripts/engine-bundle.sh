#!/usr/bin/env bash
# The engine bundle (web/sim/engine-worker.js, web/sim/engine-math.js) is committed, and `npm run build:engine` remakes it from
# tooling/src/sim and tools/*.ts. Its deterministic math (tools/fdlibm.ts; pow is tools/crpow.ts, correctly rounded, written for this
# project) needs nothing outside this repository, so the build works from a clean checkout, and the bundle it makes must be byte-identical
# to the committed one (a Vercel deploy rebuilds it and fails otherwise: tools/build-static.mjs --regen; and the parity suites vouch for the
# committed bundle). The job fails when the build fails, when either file is not committed, or when the build makes other bytes.
#   engine-bundle.sh      -> built=true in $GITHUB_OUTPUT (only on success); the build's log goes to ci-logs/build-engine.log
set -euo pipefail
cd "$(dirname "$0")/../.."
[ $# -eq 0 ] || { echo "usage: engine-bundle.sh (no arguments)" >&2; exit 2; }
out="${GITHUB_OUTPUT:-/dev/null}"
mkdir -p ci-logs
log=ci-logs/build-engine.log

set +e
npm run build:engine 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e
if [ "$rc" -ne 0 ]; then
	echo "::error title=Engine bundle build failed::npm run build:engine failed (exit $rc): see ci-logs/build-engine.log"
	exit 1
fi
echo "engine bundle: built from this commit's sources"

bundle=(web/sim/engine-worker.js web/sim/engine-math.js)
for f in "${bundle[@]}"; do
	if [ -z "$(git ls-files -- "$f")" ]; then
		echo "::error title=Engine bundle not committed::$f is not in git: commit web/sim/engine-worker.js and engine-math.js as npm run build:engine makes them (a Vercel deploy rebuilds the bundle and needs the same bytes in its upload)"
		exit 1
	fi
done
if ! git diff --quiet -- "${bundle[@]}"; then
	git diff --stat -- "${bundle[@]}"
	echo "::error title=Engine bundle out of date::npm run build:engine makes a different web/sim/engine-worker.js or engine-math.js than the committed one: run it (and the parity tools) and commit the result; a Vercel deploy would fail on it"
	exit 1
fi
echo "engine bundle: byte-identical to the committed one"
echo "built=true" >>"$out"
