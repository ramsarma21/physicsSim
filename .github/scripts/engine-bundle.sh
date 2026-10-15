#!/usr/bin/env bash
# The engine bundle (web/sim/engine-worker.js, web/sim/engine-math.js) is a build output (git-ignored) that `npm run build:engine` makes
# from tooling/src/sim and tools/*.ts. Its deterministic pow (tools/fdlibm.ts) imports tools/apple-pow-tables.ts, Apple-libm constants
# that are deliberately NOT in this public repository, until an open-source correctly-rounded pow replaces them. Whether CI can build the
# real bundle is decided by trying: the build either works (the tables are there, or nothing imports them any more), or it fails ONLY
# because "./apple-pow-tables.ts" cannot be resolved (not buildable here yet), or it fails for any other reason (the job fails).
#   engine-bundle.sh build [what is skipped]   the real bundle, else a notice naming what is skipped      -> built=true|false, bundle=real|none
#   engine-bundle.sh build-or-stub             the real bundle, else the stub-pow bundle (stub-pow.sh)     -> built=true,       bundle=real|stub
# Outputs go to $GITHUB_OUTPUT; the build's log to ci-logs/build-engine.log.
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-build}"
what="${2:-the steps that load web/sim}"
out="${GITHUB_OUTPUT:-/dev/null}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
mkdir -p ci-logs
log=ci-logs/build-engine.log

case "$mode" in
build | build-or-stub) ;;
*)
	echo "usage: engine-bundle.sh build [what is skipped] | build-or-stub" >&2
	exit 2
	;;
esac

set +e
npm run build:engine 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e
if [ "$rc" -eq 0 ]; then
	echo "engine bundle: built from this commit's sources (the real bundle)"
	{ echo "built=true"; echo "bundle=real"; } >>"$out"
	exit 0
fi

# esbuild's error lines: "✘ [ERROR] ..." and, in the thrown error, "<file>:<line>:<col>: ERROR: ..."
errors="$(grep -E '\[ERROR\]|: ERROR: ' "$log" || true)"
other="$(printf '%s\n' "$errors" | grep -vF 'Could not resolve "./apple-pow-tables.ts"' | grep -v '^$' || true)"
if [ -z "$errors" ] || [ -n "$other" ]; then
	echo "::error title=Engine bundle build failed::npm run build:engine failed (exit $rc) for a reason other than the missing tools/apple-pow-tables.ts: see ci-logs/build-engine.log"
	exit 1
fi
why="tools/fdlibm.ts imports tools/apple-pow-tables.ts, which is not in this repository (the build fails only on that import)"
echo "engine bundle: not buildable here: $why"

if [ "$mode" = build ]; then
	echo "::notice title=Engine bundle not built::$why. Skipped in this job: $what. They run in the macOS job on a stub-pow bundle, and here by themselves once the open-source pow lands."
	{
		echo "### Engine bundle not built"
		echo "$why. Skipped in this job: $what. They run in the macOS job on a stub-pow bundle, and here by themselves once the open-source pow lands."
	} >>"$summary"
	{ echo "built=false"; echo "bundle=none"; } >>"$out"
	exit 0
fi

.github/scripts/stub-pow.sh
npm run build:engine 2>&1 | tee -a "$log"
echo "::notice title=Stub-pow engine bundle::$why, so this job built the bundle with pow = Math.pow (.github/scripts/stub-pow.sh). On macOS that gives the same bits as the Apple tables; the real tables themselves are not tested here."
{
	echo "### Stub-pow engine bundle"
	echo "$why, so this job built the bundle with \`pow = Math.pow\` (\`.github/scripts/stub-pow.sh\`): on macOS the same bits as the Apple tables; the real tables themselves are not tested here. This bundle is never deployed."
} >>"$summary"
{ echo "built=true"; echo "bundle=stub"; } >>"$out"
