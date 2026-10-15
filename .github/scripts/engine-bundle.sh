#!/usr/bin/env bash
# The engine bundle (web/sim/engine-worker.js, web/sim/engine-math.js) is a build output (git-ignored) that `npm run build:engine` makes
# from tooling/src/sim and tools/*.ts. Its deterministic pow (tools/fdlibm.ts) imports tools/apple-pow-tables.ts, Apple-libm constants
# that are deliberately NOT in this public repository, until an open-source correctly-rounded pow replaces them. So CI can build the bundle
# only when that file is present, or once no engine source imports it any more (the replacement has landed). Everything that loads web/sim
# (the AI and account tests, the static build, the Python <-> JS parity suite) needs the bundle; those steps are skipped with a notice until
# then, and run by themselves from the first commit that makes the bundle buildable.
#   engine-bundle.sh detect   writes buildable=true|false to $GITHUB_OUTPUT (and prints it)
#   engine-bundle.sh build    builds the bundle when buildable (a failing build then fails the job) and writes built=true|false
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="${1:-build}"
out="${GITHUB_OUTPUT:-/dev/null}"

importers="$(grep -rlE "(from|import)[[:space:]]*\(?[[:space:]]*[\"'][^\"']*apple-pow-tables" tools tooling/src \
	--include='*.ts' --include='*.mjs' --include='*.js' 2>/dev/null || true)"
if [ -f tools/apple-pow-tables.ts ]; then
	buildable=true
	why="tools/apple-pow-tables.ts is present"
elif [ -z "$importers" ]; then
	buildable=true
	why="no engine source imports apple-pow-tables (the open-source pow is in)"
else
	buildable=false
	why="$(echo $importers | tr ' ' ',') imports tools/apple-pow-tables.ts, which is not in this repository"
fi
echo "engine bundle buildable: $buildable ($why)"

note() {
	echo "::notice title=Engine bundle not built::$why. Skipped here: $1. They run automatically once the open-source pow replacement lands."
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		{
			echo "### Engine bundle not built"
			echo "$why, so \`npm run build:engine\` cannot run in CI yet. Skipped in this job: $1."
			echo "They run automatically once the open-source pow replacement lands (or wherever tools/apple-pow-tables.ts is present)."
		} >>"$GITHUB_STEP_SUMMARY"
	fi
}

case "$mode" in
detect)
	echo "buildable=$buildable" >>"$out"
	[ "$buildable" = true ] || note "the Python <-> JS parity suite (macOS job)"
	;;
build)
	if [ "$buildable" = true ]; then
		npm run build:engine
		echo "built=true" >>"$out"
	else
		note "${2:-the steps that load web/sim}"
		echo "built=false" >>"$out"
	fi
	;;
*)
	echo "usage: engine-bundle.sh detect|build [what is skipped]" >&2
	exit 2
	;;
esac
