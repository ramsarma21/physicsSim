#!/usr/bin/env bash
# The node:test suites: ai/test (the AI core and its Vercel twin), web/ai/test (the AI panel's orchestrator and solver) and
# web/account/test (accounts and saved scenes). Almost all of them load web/sim, which needs the engine bundle
# (.github/scripts/engine-bundle.sh); without it only the files listed in NO_BUNDLE run, and the rest are named in a notice.
#   unit-tests.sh true|false      (whether the engine bundle was built)
# A JUnit report goes to ci-logs/unit-tests.xml.
set -euo pipefail
cd "$(dirname "$0")/../.."
built="${1:?usage: unit-tests.sh true|false}"

# test files that never load web/sim (checked from a clean checkout without the bundle): they run in every build
NO_BUNDLE=(ai/test/core.test.mjs ai/test/schemas.test.mjs)

shopt -s nullglob
all=(ai/test/*.test.mjs web/ai/test/*.test.mjs web/account/test/*.test.mjs)
if [ "$built" = true ]; then
	run=("${all[@]}")
else
	run=()
	skipped=()
	for f in "${all[@]}"; do
		if [[ " ${NO_BUNDLE[*]} " == *" $f "* ]]; then run+=("$f"); else skipped+=("$f"); fi
	done
	if [ "${#skipped[@]}" -gt 0 ]; then
		echo "::notice title=Unit tests skipped (no engine bundle)::${skipped[*]}"
		[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "Unit test files skipped without the engine bundle: \`${skipped[*]}\`" >>"$GITHUB_STEP_SUMMARY"
	fi
fi

mkdir -p ci-logs
echo "unit-tests: ${run[*]}"
node --test \
	--test-reporter=spec --test-reporter-destination=stdout \
	--test-reporter=junit --test-reporter-destination=ci-logs/unit-tests.xml \
	"${run[@]}"
