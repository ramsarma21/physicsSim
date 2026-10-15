#!/usr/bin/env bash
# Makes a CI checkout look like the development machine's checkout for the scripts that assume it (run from any folder):
#  - research/*.ts and research/poc/dense_track.ts (which machines/test_*.py and research/rw-validate-p3.ts run) import the engine by the
#    absolute path of the development checkout (/Users/<you>/.../blender-playground): every such path named in research/ or machines/ is
#    linked to this checkout (sudo, which hosted runners allow without a password);
#  - research/rw-validate-p2.ts and -p3.ts import planck from tooling/node_modules, a separate install on the development machine: it is
#    linked to the root node_modules (`npm ci`), which holds the same planck and effect versions (package-lock.json).
# Nothing here changes a tracked file.
set -euo pipefail
cd "$(dirname "$0")/../.."
here="$(pwd -P)"

paths="$(git grep -hoE '/Users/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/blender-playground' -- research machines tools/parity | sort -u || true)"
for dev in $paths; do
	if [ "$(cd "$dev" 2>/dev/null && pwd -P)" = "$here" ]; then
		echo "ci-paths: $dev is already this checkout"
		continue
	fi
	if [ -e "$dev" ] || [ -L "$dev" ]; then
		echo "::error::ci-paths: $dev exists and is not this checkout ($here)"
		exit 1
	fi
	sudo mkdir -p "$(dirname "$dev")"
	sudo ln -s "$here" "$dev"
	echo "ci-paths: linked $dev -> $here"
done

if [ ! -e tooling/node_modules ]; then
	ln -s ../node_modules tooling/node_modules
	echo "ci-paths: linked tooling/node_modules -> ../node_modules"
fi
