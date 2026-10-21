// execFileSync for the tests and tools that hand a child process (python3 and the builders, mostly) its input on stdin.
//
// node's own execFileSync(file, args, {input}) writes the input into a socket to the child. On macOS it now and then never finishes: the
// child (python3, still importing machines/items.py when the write starts) waits in read() for the rest of its input, node waits in its
// sync loop for the child, and both wait for ever. Measured on 2026-10-21 on the development Mac: tools/parity/module.mjs --module optics
// hung in 9 of 102 runs (its 67,727-byte input to tools/parity/py_module.py, which imports the builders before it reads); the same input to
// a python3 that only sleeps before reading never hung (0 of about 700 runs). On GitHub's macOS runners the same hang held a unit-test file
// (web/ai/test/flow-plugin.test.mjs) and that parity step until the job's 60 min timeout.
//
// So this execFileSync takes the same arguments and gives the same answers and errors as node's, but writes `input` to a temporary file
// and opens that file as the child's stdin (nothing is written into a socket): with it the step never hung (0 of 60 runs). Without `input`
// it is node's own.
import * as cp from "node:child_process"
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export function execFileSync(file, args, options) {
	if (args != null && !Array.isArray(args)) {
		options = args
		args = []
	}
	args = args ?? []
	if (options == null || options.input === undefined) return cp.execFileSync(file, args, options)
	const { input, ...rest } = options
	const dir = mkdtempSync(join(tmpdir(), "child-sync-"))
	const path = join(dir, "stdin")
	writeFileSync(path, input)
	const fd = openSync(path, "r")
	try {
		// as node's execFileSync: without a stdio option stdout and stderr are piped and stderr is also copied to this process's stderr
		const inheritStderr = !rest.stdio
		const stdio = rest.stdio == null ? [fd, "pipe", "pipe"] : typeof rest.stdio === "string" ? [fd, rest.stdio, rest.stdio] : [fd, ...rest.stdio.slice(1)]
		const ret = cp.spawnSync(file, args, { ...rest, stdio })
		if (inheritStderr && ret.stderr) process.stderr.write(ret.stderr)
		if (ret.error) throw Object.assign(ret.error, ret)
		if (ret.status !== 0) {
			let msg = `Command failed: ${[rest.argv0 || file, ...args].join(" ")}`
			if (ret.stderr && ret.stderr.length > 0) msg += `\n${ret.stderr.toString()}`
			throw Object.assign(new Error(msg), ret)
		}
		return ret.stdout
	} finally {
		closeSync(fd)
		rmSync(dir, { recursive: true, force: true })
	}
}
