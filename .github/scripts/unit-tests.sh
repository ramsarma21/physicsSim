#!/usr/bin/env bash
# The node:test suites: every tracked *.test.mjs (ai/test: the AI core and its Vercel twin; web/ai/test: the AI panel's orchestrator and
# solver; web/account/test: accounts and saved scenes; ai/experiments/**: the experiments' own checks), so a new test file runs without a
# change here. Almost all of them load web/sim, which needs the engine bundle (.github/scripts/engine-bundle.sh); without it only the files
# listed in NO_BUNDLE run, and the rest are named in a notice.
#   unit-tests.sh true|false      (whether an engine bundle, real or stub, was built)
# A JUnit report goes to ci-logs/unit-tests-node<major>.xml.
set -euo pipefail
cd "$(dirname "$0")/../.."
built="${1:?usage: unit-tests.sh true|false}"

# Test files that never load web/sim (checked from a clean checkout without the bundle): they run in every build.
# (ai/test/schemas.test.mjs is NOT one: it reads the catalog from web/sim, and without the bundle it could only fall back to a server or
# to the committed ai/.cache digest, which the two lines below rule out.)
NO_BUNDLE=(ai/test/core.test.mjs)

# The AI catalog digest must come from web/sim as it is in this commit: never from a stale digest on disk (ai/.cache is committed) and
# never from a server that happens to answer on the default port.
AI_CACHE_DIR="$(mktemp -d)"
export AI_CACHE_DIR
export AI_CATALOG_URL=http://127.0.0.1:9/none

all=()
while IFS= read -r f; do all+=("$f"); done < <(git ls-files -- '*.test.mjs')
[ "${#all[@]}" -gt 0 ] || { echo "::error::no *.test.mjs files are tracked"; exit 1; }
if [ "$built" = true ]; then
	run=("${all[@]}")
else
	run=()
	skipped=()
	for f in "${all[@]}"; do
		if [[ " ${NO_BUNDLE[*]} " == *" $f "* ]]; then run+=("$f"); else skipped+=("$f"); fi
	done
	if [ "${#skipped[@]}" -gt 0 ]; then
		echo "::notice title=Unit tests skipped here (no engine bundle)::${skipped[*]} (they run in the macOS job)"
		[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "Unit test files skipped in this job without the engine bundle (they run in the macOS job): \`${skipped[*]}\`" >>"$GITHUB_STEP_SUMMARY"
	fi
fi

mkdir -p ci-logs
major="$(node -p 'process.versions.node.split(".")[0]')"
echo "unit-tests: Node $(node --version), ${#run[@]} of ${#all[@]} files: ${run[*]}"
node --test \
	--test-reporter=spec --test-reporter-destination=stdout \
	--test-reporter=junit --test-reporter-destination="ci-logs/unit-tests-node$major.xml" \
	"${run[@]}"
