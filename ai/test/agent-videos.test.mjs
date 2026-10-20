// Robot keys and the video functions, with no network and no real keys: api/ai/[step].mjs and api/videos/* called the way Vercel's Node
// runtime calls them, on a deployment that looks like production with accounts on (sign-in required), against the AI core's mock gateway, a
// Postgres in this process (PGlite) and a mock Blob API (mock-blob.mjs). The master key, a per-person key, revoked/wrong/missing keys, the
// agents' caps outside the site cap, the constant-time comparison, upload tokens held to the job's prefix and the allowed names, types and
// sizes, publish (missing files, failed checks, ownership, idempotent indexes, batches), the strict checks gate (no entry skipped, no list
// trimmed), a published job's files final (no upload after publish), each key's daily video caps, the gallery page and a job's report page,
// the owner's keys tool, and no key in any answer, stored file or log line.
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, beforeEach, describe, test } from "node:test"
import { FAKE_KEY, startMockGateway, testRouting } from "./mock-gateway.mjs"
import { startMockBlob } from "./mock-blob.mjs"
import { call, testClerk, testDatabase } from "../../web/account/test/helpers.mjs"

const clerk = testClerk("clerk.agent-test.example")
const MASTER = randomBytes(32).toString("hex")
const RW = ["vercel", "blob", "rw", `Teststore0123AbC_${randomBytes(18).toString("hex")}`].join("_") // (built at run time so no token-shaped literal is committed)
const GALLERY = randomBytes(18).toString("base64url")
const PUBLIC = "https://teststore0123abc.public.blob.vercel-storage.com/"
const ENV = {
	VERCEL: "1",
	VERCEL_ENV: "production",
	VERCEL_PROJECT_PRODUCTION_URL: "sandbox.example.com",
	NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.pk,
	CLERK_SECRET_KEY: ["sk", "test", "AGENTVIDEOSTEST0123456789"].join("_"),
	DATABASE_URL: "postgres://u:p@localhost/x", // (the database itself is PGlite, handed in)
	AI_AGENT_KEY: MASTER,
	BLOB_READ_WRITE_TOKEN: RW,
	VIDEO_GALLERY_ID: GALLERY,
}
const NOTHING = (usd = 0.25) => ({ content: JSON.stringify({ mode: "patch", kind: "answer", targets: [], reply: "Nothing to change.", patches: [] }), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, costInUSD: usd } })
const EDIT = { payload: { text: "hi", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: "r1" } }

let gw, blob, db, dir, stepFn, uploadFn, publishFn, galleryFn, keys, gate, blobLib
const answers = [] // every answer's text
const logs = []
const secrets = () => [MASTER, RW, ...issued]
const issued = [] // per-person keys made in these tests
const realLog = console.log
const realFetch = globalThis.fetch

before(async () => {
	globalThis.fetch = (url, init) => {
		if (/^https:\/\/(api\.clerk\.com|clerk\.agent-test\.example)\//.test(String(url))) return clerk.fetch(url, init)
		// the store's public URLs (what Blob's CDN serves): from the mock store, HTML as a download like the real one
		if (String(url).startsWith(PUBLIC)) {
			const b = blob.store.get(decodeURIComponent(new URL(String(url)).pathname.slice(1)))
			if (!b) return Promise.resolve(new Response("not found", { status: 404 }))
			return Promise.resolve(new Response(b.body, { status: 200, headers: { "content-type": b.contentType, "content-length": String(b.body.length), "content-disposition": "attachment" } }))
		}
		return realFetch(url, init)
	}
	console.log = (...a) => {
		logs.push(a.join(" "))
	}
	gw = await startMockGateway()
	blob = await startMockBlob({ rwToken: RW })
	dir = mkdtempSync(join(tmpdir(), "agent-videos-"))
	writeFileSync(join(dir, "models.json"), JSON.stringify(testRouting({ timeoutMs: 500, budgetMs: 2000, backoffMs: 10 })))
	Object.assign(process.env, { TRUEFOUNDRY_API_KEY: FAKE_KEY, AI_GATEWAY_URL: gw.url, AI_MODELS: join(dir, "models.json"), VIDEO_BLOB_API_URL: blob.url, ...ENV })
	db = await testDatabase()
	stepFn = (await import("../../api/ai/[step].mjs")).default
	uploadFn = (await import("../../api/videos/upload.mjs")).default
	publishFn = (await import("../../api/videos/publish.mjs")).default
	galleryFn = (await import("../../api/videos/gallery.mjs")).default
	keys = await import("../../api/_lib/agent-keys.mjs")
	gate = await import("../../api/_lib/ai-gate.mjs")
	blobLib = await import("../../api/_lib/blob.mjs")
})
after(async () => {
	console.log = realLog
	globalThis.fetch = realFetch
	for (const k of ["TRUEFOUNDRY_API_KEY", "AI_GATEWAY_URL", "AI_MODELS", "VIDEO_BLOB_API_URL", "AI_SITE_USD_PER_DAY", ...Object.keys(ENV)]) delete process.env[k]
	await gw.close()
	await blob.close()
	await db.close()
	rmSync(dir, { recursive: true, force: true })
	// no key, no Blob token, in any answer, any stored file or any log line
	const stored = [...blob.store.values()].map((b) => b.body.toString("utf8"))
	for (const [what, list] of [["answer", answers], ["stored file", stored], ["log line", logs]])
		for (const t of list) for (const s of secrets()) assert.ok(!t.includes(s), `a ${what} holds a key: ${t.slice(0, 160)}`)
})
beforeEach(() => gw.reset())

const remember = (r) => (answers.push(r.text), r)
const step = async (name, headers = {}) => remember(await call(stepFn, { method: "POST", url: `/api/ai/${name}`, query: { step: name }, body: EDIT, headers }))
const agentHeaders = (key) => ({ "x-agent-key": key })
const day = () => `ai:d:${new Date().toISOString().slice(0, 10)}`
const counter = async (key) => (await db.pg.query("select n, usd::float8 as usd from counters where key = $1 and bucket = $2", [key, day()])).rows[0] ?? null
const getDb = async () => (await import("../../api/_lib/db.mjs")).getDb(process.env)
async function issue(name, opts) {
	const k = await keys.issueAgentKey(await getDb(), name, opts)
	issued.push(k)
	return k
}
const post = async (fn, url, body, headers = {}) => remember(await call(fn, { method: "POST", url, body, headers: { host: "sandbox.example.com", ...headers } }))

// ---------------------------------------------------------------- robot keys on the AI steps
describe("robot keys on /api/ai/*", () => {
	test("the master key: a step runs with no Origin and no sign-in, counted as agent:owner and never on the site's row", async () => {
		gw.script("m1", [NOTHING(0.25)])
		const r = await step("edit", agentHeaders(MASTER))
		assert.equal(r.status, 200, r.text)
		assert.equal(r.json.ok, true)
		assert.deepEqual(await counter("agent:owner"), { n: 1, usd: 0.25 })
		assert.equal(await counter("*"), null, "an agent's step is not on the site's daily dollars")
	})

	test("a per-person key: its own name and its own caps (steps per hour)", async () => {
		const k = await issue("ana", { usd: 5, steps: 2 })
		assert.match(k, /^psk_[A-Za-z0-9_-]{43}$/)
		gw.script("m1", [NOTHING(0.01), NOTHING(0.01), NOTHING(0.01)])
		assert.equal((await step("edit", agentHeaders(k))).status, 200)
		assert.equal((await step("edit", agentHeaders(k))).status, 200)
		const r = await step("edit", agentHeaders(k))
		assert.equal(r.status, 403)
		assert.equal(r.json.code, "quota")
		assert.match(r.json.error, /agent key "ana" has used this hour's/)
		assert.ok(Date.parse(r.json.resetsAt) > Date.now())
		assert.equal(gw.requests.length, 2, "the third step never reached the model")
		assert.deepEqual(await counter("agent:ana"), { n: 2, usd: 0.02 })
	})

	test("a per-person key's dollars per day: reserved before the step, settled to the real cost", async () => {
		const k = await issue("cy", { usd: 0.3, steps: 50 })
		gw.script("m1", [NOTHING(0.25), NOTHING(0.25)])
		assert.equal((await step("edit", agentHeaders(k))).status, 200) // (reserves $0.10, settles to $0.25)
		const r = await step("edit", agentHeaders(k)) // $0.25 + $0.10 > $0.30
		assert.equal(r.status, 403)
		assert.equal(r.json.code, "quota")
		assert.match(r.json.error, /today's/)
		assert.deepEqual(await counter("agent:cy"), { n: 1, usd: 0.25 })
	})

	test("wrong, unknown, revoked, empty and oversized keys: 403 forbidden, before any model call", async () => {
		const k = await issue("bo")
		assert.equal(await keys.revokeAgentKey(await getDb(), "bo"), true)
		for (const bad of [k, `${MASTER}x`, MASTER.slice(0, -1), MASTER.toUpperCase(), "", "psk_" + randomBytes(32).toString("base64url"), "x".repeat(300)]) {
			const r = await step("edit", agentHeaders(bad))
			assert.equal(r.status, 403, `${bad.slice(0, 8)}: ${r.text}`)
			assert.equal(r.json.code, "forbidden")
		}
		assert.equal(gw.requests.length, 0)
	})

	test("no header: exactly the old rules (no Origin on Vercel 403; the page's own origin without sign-in 401 sign_in)", async () => {
		assert.equal((await step("edit")).status, 403)
		const r = await step("edit", { origin: "https://sandbox.example.com", "sec-fetch-site": "same-origin" })
		assert.equal(r.status, 401)
		assert.equal(r.json.code, "sign_in")
		assert.equal(gw.requests.length, 0)
	})

	test("the agents' caps are independent of the site cap: with the site's day used up, people are refused and agents still run", async () => {
		process.env.AI_SITE_USD_PER_DAY = "1"
		try {
			await db.pg.query("insert into counters (key, bucket, n, usd) values ('*', $1, 0, 1) on conflict (key, bucket) do update set usd = 1", [day()])
			const person = await gate.aiGate({ headers: { "x-ai-access": "t" } }, "edit", { accessProblem: () => null })
			assert.equal((await person.charge())?.code, "site_quota")
			gw.script("m1", [NOTHING(0.2)])
			assert.equal((await step("edit", agentHeaders(MASTER))).status, 200)
			assert.equal((await counter("*")).usd, 1, "the agent's step left the site's row as it was")
		} finally {
			delete process.env.AI_SITE_USD_PER_DAY
			await db.pg.query("delete from counters where key = '*'")
		}
	})

	test("the comparison is constant-time: sha256 digests through crypto.timingSafeEqual, never the raw key", async () => {
		const src = readFileSync(new URL("../../api/_lib/agent-keys.mjs", import.meta.url), "utf8")
		assert.match(src, /timingSafeEqual\(h, sha256\(/, "the master key is compared as digests")
		assert.match(src, /timingSafeEqual\(Buffer\.from\(row\.key_sha256, "hex"\), h\)/, "a stored key's hash is compared again with timingSafeEqual")
		assert.doesNotMatch(src, /(given|key)\s*===\s*master|master\s*===\s*(given|key)|\.startsWith\(master\)|\.includes\(master\)/)
		// every length and every shared prefix is refused the same way (timingSafeEqual on raw strings would throw on a length mismatch)
		const flip = MASTER.slice(0, 63) + (MASTER.at(-1) === "0" ? "1" : "0")
		for (const k of ["", MASTER[0], MASTER.slice(0, 31), MASTER.slice(0, 63), flip, `${MASTER}0`, MASTER + MASTER]) {
			const v = await keys.verifyAgentKey(k, { env: process.env })
			assert.equal(v.ok, false, `${k.length} characters`)
			assert.equal(v.code, "forbidden")
		}
		assert.equal((await keys.verifyAgentKey(MASTER, { env: process.env })).agent.id, "agent:owner")
		// a master key under 32 characters is not a key at all
		assert.equal((await keys.verifyAgentKey("short", { env: { AI_AGENT_KEY: "short" } })).ok, false)
	})
})

// ---------------------------------------------------------------- uploads
const FILES = (over = {}) => [{ name: "video.mp4", type: "video/mp4", size: 4000 }, { name: "poster.jpg", type: "image/jpeg", size: 300 }, { name: "report.html", type: "text/html", size: 100 }].map((f) => ({ ...f, ...(over[f.name] ?? {}) }))
async function putFile(u, bytes, { type = u.contentType, pathname = u.pathname } = {}) {
	const url = pathname === u.pathname ? u.put.url : `${blob.url}/?${new URLSearchParams({ pathname })}`
	const r = await fetch(url, { method: u.put.method, headers: { ...u.put.headers, "x-content-type": type }, body: bytes })
	return { status: r.status, json: await r.json() }
}

describe("POST /api/videos/upload", () => {
	test("no key 401, a wrong key 403, GET 405; the key is never echoed", async () => {
		const none = await post(uploadFn, "/api/videos/upload", { job: "job-a", files: FILES() })
		assert.equal(none.status, 401)
		assert.equal(none.json.code, "unauthorized")
		const wrong = await post(uploadFn, "/api/videos/upload", { job: "job-a", files: FILES() }, agentHeaders("psk_nope"))
		assert.equal(wrong.status, 403)
		assert.equal(wrong.json.code, "forbidden")
		assert.equal((await call(uploadFn, { method: "GET", url: "/api/videos/upload", headers: agentHeaders(MASTER) })).status, 405)
	})

	test("names, types, sizes and the job's name are checked before anything is made", async () => {
		const bad = async (body, status, re) => {
			const r = await post(uploadFn, "/api/videos/upload", body, agentHeaders(MASTER))
			assert.equal(r.status, status, r.text)
			if (re) assert.match(r.json.error, re)
		}
		for (const job of ["../x", "A-job", "ab", "job/one", "-job", "x".repeat(81), 7]) await bad({ job, files: FILES() }, 400, /job must be/)
		for (const name of ["index.json", "../video.mp4", "jobs/x/video.mp4", "video.mov", "__proto__", "index.html"]) await bad({ job: "job-a", files: [{ name, type: "video/mp4", size: 10 }] }, 400, /must be one of/)
		await bad({ job: "job-a", files: [{ name: "video.mp4", type: "text/html", size: 10 }] }, 400, /must have type video\/mp4/)
		await bad({ job: "job-a", files: [{ name: "video.mp4", type: "video/mp4", size: 200 * 1048576 + 1 }] }, 413, /at most 200 MB/)
		await bad({ job: "job-a", files: [{ name: "poster.jpg", type: "image/jpeg", size: 5 * 1048576 + 1 }] }, 413)
		await bad({ job: "job-a", files: [{ name: "video.mp4", type: "video/mp4", size: 0 }] }, 400)
		await bad({ job: "job-a", files: [{ name: "video.mp4", type: "video/mp4", size: 1.5 }] }, 400)
		await bad({ job: "job-a", files: [{ name: "video.mp4", type: "video/mp4", size: 9 }, { name: "video.mp4", type: "video/mp4", size: 9 }] }, 400, /twice/)
		await bad({ job: "job-a", files: [] }, 400)
		assert.equal((await db.pg.query("select count(*)::int as n from videos")).rows[0].n, 0)
	})

	test("one client token per file, good only for videos/<gallery>/jobs/<job>/<name>, its type, its declared size, for 15 minutes", async () => {
		const t0 = Date.now()
		const r = await post(uploadFn, "/api/videos/upload", { job: "job-a", files: FILES() }, agentHeaders(MASTER))
		assert.equal(r.status, 200, r.text)
		assert.equal(r.json.prefix, `videos/${GALLERY}/jobs/job-a/`)
		assert.equal(r.json.uploads.length, 3)
		for (const u of r.json.uploads) {
			assert.equal(u.pathname, `videos/${GALLERY}/jobs/job-a/${u.name}`)
			const p = blobLib.clientTokenPayload(u.token, RW)
			assert.ok(p, "the token is signed with the store's read-write token")
			assert.equal(p.pathname, u.pathname)
			assert.equal(p.maximumSizeInBytes, FILES().find((f) => f.name === u.name).size)
			assert.deepEqual(p.allowedContentTypes, [u.contentType])
			assert.ok(p.validUntil > t0 && p.validUntil <= Date.now() + 15 * 60000, "short-lived")
			assert.deepEqual([p.addRandomSuffix, p.allowOverwrite], [false, true])
			assert.equal(u.put.method, "PUT")
			assert.equal(u.put.url, `${blob.url}/?${new URLSearchParams({ pathname: u.pathname })}`)
			assert.equal(u.put.headers.authorization, `Bearer ${u.token}`)
			assert.equal(u.url, blob.urlOf(u.pathname))
			assert.ok(!u.token.includes(RW) && !JSON.stringify(p).includes(RW))
		}
		const video = r.json.uploads.find((u) => u.name === "video.mp4")
		assert.equal((await putFile(video, Buffer.alloc(4000, 1))).status, 200)
		// the same token anywhere else, too big, or another type: refused by the store
		const other = await putFile(video, Buffer.alloc(10, 1), { pathname: `videos/${GALLERY}/jobs/job-b/video.mp4` })
		assert.deepEqual([other.status, /does not match the token payload/.test(other.json.error.message)], [403, true])
		for (const p of [`videos/${GALLERY}/index.json`, `videos/${GALLERY}/index.html`, `videos/${GALLERY}/jobs/job-a/poster.jpg`]) assert.equal((await putFile(video, Buffer.alloc(10, 1), { pathname: p })).status, 403)
		assert.equal((await putFile(video, Buffer.alloc(4001, 1))).status, 403)
		assert.equal((await putFile(video, Buffer.alloc(10, 1), { type: "text/html" })).status, 403)
		assert.equal(blob.store.get(video.pathname).body.length, 4000)
	})

	test("the first key to ask owns the job: another key gets 409, the master key may touch any job", async () => {
		const k = await issue("dee")
		const mine = await post(uploadFn, "/api/videos/upload", { job: "dee-1", files: FILES() }, agentHeaders(k))
		assert.equal(mine.status, 200)
		const theirs = await post(uploadFn, "/api/videos/upload", { job: "job-a", files: FILES() }, agentHeaders(k))
		assert.equal(theirs.status, 409)
		assert.equal(theirs.json.code, "conflict")
		assert.equal((await post(uploadFn, "/api/videos/upload", { job: "dee-1", files: FILES() }, agentHeaders(MASTER))).status, 200)
	})

	test("not set up: 503 not_configured naming what is missing (names only)", async () => {
		delete process.env.VIDEO_GALLERY_ID
		try {
			const r = await post(uploadFn, "/api/videos/upload", { job: "job-z", files: FILES() }, agentHeaders(MASTER))
			assert.equal(r.status, 503)
			assert.equal(r.json.code, "not_configured")
			assert.match(r.json.error, /VIDEO_GALLERY_ID/)
		} finally {
			process.env.VIDEO_GALLERY_ID = GALLERY
		}
	})
})

// ---------------------------------------------------------------- publish and the gallery
const META = (over = {}) => ({ job: "job-a", title: "A ball rolls down a ramp", request: "Make a video of a steel ball rolling down a ramp into a cup.", lesson: { id: "G3-U6-L2", grade: 3, concept: "gravity pulls things down" }, seconds: 12.5, checks: [{ name: "goal met", ok: true }, { name: "no clipping", ok: true }], cost_usd: 0.84, ...over })
async function uploadAll(job, key = MASTER, names = ["video.mp4", "poster.jpg", "report.html"]) {
	const r = await post(uploadFn, "/api/videos/upload", { job, files: FILES().filter((f) => names.includes(f.name)) }, agentHeaders(key))
	assert.equal(r.status, 200, r.text)
	for (const u of r.json.uploads) assert.equal((await putFile(u, Buffer.alloc(u.maxBytes, 2))).status, 200)
}
const index = (p = "") => JSON.parse(blob.text(`videos/${GALLERY}/${p}index.json`))

describe("POST /api/videos/publish and the gallery", () => {
	test("a job never uploaded 404; missing files 409 missing_files; failed checks 409 checks_failed; no checks 400", async () => {
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "never" }), agentHeaders(MASTER))).status, 404)
		await uploadAll("job-p", MASTER, ["video.mp4"])
		const miss = await post(publishFn, "/api/videos/publish", META({ job: "job-p" }), agentHeaders(MASTER))
		assert.deepEqual([miss.status, miss.json.code, miss.json.missing], [409, "missing_files", ["poster.jpg"]])
		await uploadAll("job-p", MASTER, ["poster.jpg"])
		const failed = await post(publishFn, "/api/videos/publish", META({ job: "job-p", checks: { "goal met": true, "no clipping": false } }), agentHeaders(MASTER))
		assert.deepEqual([failed.status, failed.json.code, failed.json.failed], [409, "checks_failed", ["no clipping"]])
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-p", checks: {} }), agentHeaders(MASTER))).status, 400)
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-p", seconds: 0 }), agentHeaders(MASTER))).status, 400)
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-p", title: "" }), agentHeaders(MASTER))).status, 400)
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-p" }))).status, 401)
		assert.equal(blob.text(`videos/${GALLERY}/index.json`), null, "nothing was published")
	})

	test("publish: the files are checked in Blob, the publishing key is recorded, the gallery's index.json and index.html are written", async () => {
		await uploadAll("job-a")
		const r = await post(publishFn, "/api/videos/publish", META({ title: 'Ramp <script>alert("x")</script> & cup' }), agentHeaders(MASTER))
		assert.equal(r.status, 200, r.text)
		assert.equal(r.json.video_url, blob.urlOf(`videos/${GALLERY}/jobs/job-a/video.mp4`))
		assert.equal(r.json.poster_url, blob.urlOf(`videos/${GALLERY}/jobs/job-a/poster.jpg`))
		assert.equal(r.json.report_url, `https://sandbox.example.com/videos/${GALLERY}/jobs/job-a/report`, "the report is a page on the site (Blob would download it)")
		assert.equal(r.json.gallery_url, `https://sandbox.example.com/videos/${GALLERY}`)
		assert.equal(r.json.gallery_json_url, blob.urlOf(`videos/${GALLERY}/index.json`))
		assert.equal(r.json.batch_url, null)
		assert.equal(r.json.published_by, "owner")
		assert.deepEqual(r.json.checks, { passed: 2, total: 2 })
		const idx = index()
		assert.equal(idx.count, 1)
		const e = idx.videos[0]
		assert.deepEqual([e.job, e.title, e.published_by, e.seconds, e.cost_usd, e.lesson], ["job-a", 'Ramp <script>alert("x")</script> & cup', "owner", 12.5, 0.84, { id: "G3-U6-L2", grade: "3", concept: "gravity pulls things down" }])
		assert.equal(e.video_url, r.json.video_url)
		assert.equal(e.report_url, r.json.report_url)
		assert.equal(e.files["report.html"], blob.urlOf(`videos/${GALLERY}/jobs/job-a/report.html`))
		const html = blob.text(`videos/${GALLERY}/index.html`)
		assert.ok(html.includes("Ramp &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; cup") && !html.includes("<script>"))
		assert.equal(blob.store.get(`videos/${GALLERY}/index.json`).cacheControlMaxAge, 60)
		assert.match(blob.store.get(`videos/${GALLERY}/index.html`).contentType, /^text\/html/)
	})

	test("publishing again is idempotent: the same indexes, byte for byte, one entry, its first publish time kept", async () => {
		const before = { json: blob.text(`videos/${GALLERY}/index.json`), html: blob.text(`videos/${GALLERY}/index.html`) }
		const r = await post(publishFn, "/api/videos/publish", META({ title: 'Ramp <script>alert("x")</script> & cup' }), agentHeaders(MASTER))
		assert.equal(r.status, 200)
		assert.equal(blob.text(`videos/${GALLERY}/index.json`), before.json)
		assert.equal(blob.text(`videos/${GALLERY}/index.html`), before.html)
		assert.equal(index().count, 1)
		assert.ok(blob.store.get(`videos/${GALLERY}/index.json`).writes >= 2, "it was rewritten")
	})

	test("batches: the batch's own index; a job moved to another batch leaves the old one", async () => {
		await uploadAll("job-b")
		const r = await post(publishFn, "/api/videos/publish", META({ job: "job-b", batch: "unit-6", title: "Pendulum" }), agentHeaders(MASTER))
		assert.equal(r.status, 200, r.text)
		assert.equal(r.json.batch_url, `https://sandbox.example.com/videos/${GALLERY}/batches/unit-6`)
		assert.equal(r.json.batch_json_url, blob.urlOf(`videos/${GALLERY}/batches/unit-6/index.json`))
		assert.deepEqual(index("batches/unit-6/").videos.map((v) => v.job), ["job-b"])
		assert.equal(index().count, 2)
		assert.ok(blob.text(`videos/${GALLERY}/batches/unit-6/index.html`).includes("Batch unit-6"))
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-b", batch: "unit-7", title: "Pendulum" }), agentHeaders(MASTER))).status, 200)
		assert.equal(index("batches/unit-6/").count, 0)
		assert.deepEqual(index("batches/unit-7/").videos.map((v) => v.job), ["job-b"])
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "job-b", batch: "../x" }), agentHeaders(MASTER))).status, 400)
	})

	test("another key can't publish a job it doesn't own (409); a per-person key's name is what the gallery shows", async () => {
		const k = await issue("eve")
		assert.equal((await post(publishFn, "/api/videos/publish", META(), agentHeaders(k))).status, 409)
		await uploadAll("eve-1", k)
		const r = await post(publishFn, "/api/videos/publish", META({ job: "eve-1", title: "Magnets" }), agentHeaders(k))
		assert.equal(r.status, 200, r.text)
		assert.equal(r.json.published_by, "eve")
		assert.equal(index().videos.find((v) => v.job === "eve-1").published_by, "eve")
	})

	test("the gallery page: only the gallery's own id opens it; every entry, escaped; a strict CSP; no-store", async () => {
		const page = (q) => call(galleryFn, { method: "GET", url: `/api/videos/gallery?${q}` })
		const r = await page(`gallery=${GALLERY}`)
		answers.push(r.text)
		assert.equal(r.status, 200)
		assert.match(r.headers["content-type"], /^text\/html/)
		assert.equal(r.headers["cache-control"], "no-store")
		assert.match(r.headers["content-security-policy"], /default-src 'none'; img-src https:\/\/teststore0123abc\.public\.blob\.vercel-storage\.com;/)
		assert.ok(!/<script/i.test(r.text.replace(/&lt;script/g, "")), "no script on the page")
		for (const t of ["Ramp &lt;script&gt;", "Pendulum", "Magnets", "G3-U6-L2", "Grade 3", "gravity pulls things down", "2/2 passed", "$0.84", "0:13", "owner", "eve"]) assert.ok(r.text.includes(t), t)
		assert.ok(r.text.includes(`href="/videos/${GALLERY}/batches/unit-7"`))
		assert.ok(r.text.includes(`<a href="/videos/${GALLERY}/jobs/job-a/report">Report</a>`), "the card's Report link is the report page")
		assert.ok(!r.text.includes(`jobs/job-a/report.html"`), "never the Blob file, which downloads")
		const b = await page(`gallery=${GALLERY}&batch=unit-7`)
		assert.equal(b.status, 200)
		assert.ok(b.text.includes("Pendulum") && !b.text.includes("Magnets"))
		for (const q of [`gallery=${GALLERY.slice(0, -1)}`, "gallery=", `gallery=${GALLERY}x`, `gallery=${GALLERY}&batch=../x`]) assert.equal((await page(q)).status, 404, q)
		assert.equal((await call(galleryFn, { method: "POST", url: `/api/videos/gallery?gallery=${GALLERY}` })).status, 405)
	})
})

// ---------------------------------------------------------------- the checks gate, final jobs, the report page, each key's caps
describe("the checks gate (fails closed)", () => {
	const pub = (job, checks, key = MASTER) => post(publishFn, "/api/videos/publish", META({ job, checks }), agentHeaders(key))
	test("a failure anywhere in a long list is found (no trimming); more than 500 checks is 413", async () => {
		await uploadAll("gate-1")
		const many = Array.from({ length: 250 }, (_, i) => ({ name: `c${i}`, ok: i !== 220 }))
		const r = await pub("gate-1", many)
		assert.deepEqual([r.status, r.json.code, r.json.failed], [409, "checks_failed", ["c220"]], r.text)
		const tooMany = await pub("gate-1", Array.from({ length: 501 }, (_, i) => ({ name: `c${i}`, ok: true })))
		assert.deepEqual([tooMany.status, tooMany.json.code], [413, "too_large"])
		assert.ok(!index().videos.some((v) => v.job === "gate-1"), "nothing was published")
	})

	test("an entry it can't read is 400, never skipped: strings, other result words, no name, no ok, other shapes", async () => {
		const unreadable = [
			{ a: true, b: "false" },
			[{ name: "a", ok: true }, { name: "b", result: "fail" }],
			[{ name: "a", ok: "true" }],
			[{ name: "a", ok: 1 }],
			[{ name: "a", ok: true, status: "failed" }],
			[{ name: "a", ok: true, passed: false }],
			[{ name: "a", pass: true }],
			[{ ok: true }],
			[{ name: "  ", ok: true }],
			[{ name: 7, ok: true }],
			[true],
			[["a", true]],
			{ passed: 40, failed: 2 },
			{ passed: 40, failed: 0 },
			{ a: { ok: true } },
			{ items: [{ name: "a", ok: true }] },
			[],
			{},
			"all passed",
			true,
			null,
		]
		for (const checks of unreadable) {
			const r = await pub("gate-1", checks)
			assert.equal(r.status, 400, `${JSON.stringify(checks)}: ${r.text}`)
			assert.equal(r.json.code, "bad_input")
			assert.match(r.json.error, /\[\{name, ok: true \| false\}/, "the refusal says the format")
		}
		assert.ok(!index().videos.some((v) => v.job === "gate-1"), "nothing was published")
	})

	test("what passes: [{name, ok}], the pipeline's own {id, ok, detail, evidence}, {name: true}; stored as [{name, ok}], all of them", async () => {
		const r = await pub("gate-1", [{ id: "brief.ok", ok: true, detail: "fine", evidence: ["x"] }, { name: "build.goal", ok: true }])
		assert.equal(r.status, 200, r.text)
		assert.deepEqual(r.json.checks, { passed: 2, total: 2 })
		const stored = (await db.pg.query("select checks from videos where job = 'gate-1'")).rows[0].checks
		assert.deepEqual(stored, [{ name: "brief.ok", ok: true }, { name: "build.goal", ok: true }])
		const many = Array.from({ length: 300 }, (_, i) => ({ name: `c${i}`, ok: true }))
		const again = await pub("gate-1", many)
		assert.deepEqual([again.status, again.json.checks], [200, { passed: 300, total: 300 }])
		const e = index().videos.find((v) => v.job === "gate-1")
		assert.deepEqual([e.checks.passed, e.checks.total, e.checks.items.length], [300, 300, 200], "counted over all 300, 200 shown")
		assert.equal((await pub("gate-1", { "goal met": true, "no clipping": true })).status, 200)
	})

	test("readChecks itself: the whole list in order, names trimmed", async () => {
		const { readChecks, MAX_CHECKS } = await import("../../api/_lib/videos.mjs")
		assert.equal(MAX_CHECKS, 500)
		assert.deepEqual(readChecks([{ name: " a ", ok: false }, { id: "b", ok: true }, { check: "c", ok: true }]), [{ name: "a", ok: false }, { name: "b", ok: true }, { name: "c", ok: true }])
		assert.deepEqual(readChecks({ x: false }), [{ name: "x", ok: false }])
		assert.throws(() => readChecks([{ name: "a", ok: null }]), (e) => e.status === 400)
	})
})

describe("a published job is final", () => {
	test("no more upload grants once published (409 already_published), for its owner and the master key; publishing again still works", async () => {
		const k = await issue("hal")
		await uploadAll("hal-1", k)
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "hal-1", title: "Springs" }), agentHeaders(k))).status, 200)
		for (const key of [k, MASTER]) {
			const r = await post(uploadFn, "/api/videos/upload", { job: "hal-1", files: FILES() }, agentHeaders(key))
			assert.deepEqual([r.status, r.json.code], [409, "already_published"], r.text)
			assert.match(r.json.error, /new job name/)
			assert.equal(r.json.uploads, undefined, "no grant")
		}
		const other = await issue("ivy")
		assert.equal((await post(uploadFn, "/api/videos/upload", { job: "hal-1", files: FILES() }, agentHeaders(other))).json.code, "conflict")
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "hal-1", title: "Springs again" }), agentHeaders(k))).status, 200)
		const files = (await db.pg.query("select files from videos where job = 'hal-1'")).rows[0].files
		for (const n of ["video.mp4", "poster.jpg", "report.html"]) assert.match(String(files[n].etag), /^"[0-9a-f]{32}"$/, `${n}: its etag is kept`)
	})
})

describe("a job's report page and files on the site", () => {
	const get = (q, method = "GET") => call(galleryFn, { method, url: `/api/videos/gallery?gallery=${GALLERY}&${q}` })
	test("report: report.html as a page with a strict CSP (Blob would download it); other files redirect to Blob; captions are served", async () => {
		const report = Buffer.from('<!doctype html><title>R</title><video src="video.mp4" poster="poster.jpg"></video><a href="audit.json">a</a>')
		const bytes = { "report.html": report, "captions.vtt": Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n"), "audit.json": Buffer.from("{}") }
		const files = [...FILES().filter((f) => f.name !== "report.html"), ...[["report.html", "text/html"], ["captions.vtt", "text/vtt"], ["audit.json", "application/json"]].map(([name, type]) => ({ name, type, size: bytes[name].length }))]
		const up = await post(uploadFn, "/api/videos/upload", { job: "rep-1", files }, agentHeaders(MASTER))
		assert.equal(up.status, 200, up.text)
		for (const u of up.json.uploads) assert.equal((await putFile(u, bytes[u.name] ?? Buffer.alloc(u.maxBytes, 3))).status, 200)
		assert.equal((await get("job=rep-1&file=report")).status, 404, "not published yet")
		assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "rep-1", title: "Report test" }), agentHeaders(MASTER))).status, 200)

		for (const file of ["report", "report.html"]) {
			const r = await get(`job=rep-1&file=${file}`)
			answers.push(r.text)
			assert.equal(r.status, 200, r.text)
			assert.match(r.headers["content-type"], /^text\/html/)
			assert.equal(r.headers["content-disposition"], undefined, "a page, not a download")
			assert.equal(r.text, report.toString("utf8"))
			const csp = r.headers["content-security-policy"]
			assert.match(csp, /^default-src 'none'; img-src 'self' https:\/\/teststore0123abc\.public\.blob\.vercel-storage\.com; media-src 'self' https:\/\/teststore0123abc\.public\.blob\.vercel-storage\.com;/)
			assert.ok(!/script-src/.test(csp) && /frame-ancestors 'none'/.test(csp) && /form-action 'none'/.test(csp))
			assert.equal(r.headers["x-robots-tag"], "noindex, nofollow")
		}
		const v = await get("job=rep-1&file=video.mp4")
		assert.deepEqual([v.status, v.headers.location], [302, blob.urlOf(`videos/${GALLERY}/jobs/rep-1/video.mp4`)])
		assert.equal((await get("job=rep-1&file=audit.json")).headers.location, blob.urlOf(`videos/${GALLERY}/jobs/rep-1/audit.json`))
		const c = await get("job=rep-1&file=captions.vtt")
		assert.deepEqual([c.status, c.headers["content-type"], c.text.startsWith("WEBVTT")], [200, "text/vtt; charset=utf-8", true])
		assert.equal((await get("job=rep-1&file=report", "HEAD")).status, 200)
		// nothing else: unknown files, jobs, galleries
		for (const q of ["job=rep-1&file=concept.jpg", "job=rep-1&file=index.json", "job=rep-1&file=../index.json", "job=nope-1&file=report", "job=../x&file=report", "job=rep-1&file=__proto__", "job=rep-1&file=", "job=rep-1"]) assert.equal((await get(q)).status, 404, q)
		const wrong = await call(galleryFn, { method: "GET", url: `/api/videos/gallery?gallery=${GALLERY}x&job=rep-1&file=report` })
		assert.equal(wrong.status, 404)
		// the server reads only this store's public URLs, and at most the file's cap
		await assert.rejects(blobLib.readPublicBlob("https://example.com/videos/x", { maxBytes: 100 }), (e) => e.status === 503)
		await assert.rejects(blobLib.readPublicBlob(blob.urlOf(`videos/${GALLERY}/jobs/rep-1/video.mp4`), { maxBytes: 10 }), (e) => e.status === 503)
		assert.equal(await blobLib.readPublicBlob(blob.urlOf(`videos/${GALLERY}/jobs/rep-1/nothing.txt`), { maxBytes: 10 }), null)
		// the gallery's own Report link, and index.json's report_url, are this page
		assert.equal(index().videos.find((x) => x.job === "rep-1").report_url, `https://sandbox.example.com/videos/${GALLERY}/jobs/rep-1/report`)
	})
})

describe("each key's daily video caps", () => {
	const ask = (job, key, files = FILES()) => post(uploadFn, "/api/videos/upload", { job, files }, agentHeaders(key))
	const vid = async (name, what) => (await db.pg.query("select n from counters where key = $1 and bucket = $2", [`vid:${name}`, `${what}:${new Date().toISOString().slice(0, 10)}`])).rows[0]?.n ?? 0
	test("new videos a day and megabytes a day: 403 quota past either, nothing made, nothing counted for a refusal", async () => {
		const k = await issue("quo", { videos: 2, mb: 3 })
		assert.equal((await ask("quo-1", k)).status, 200)
		assert.equal((await ask("quo-2", k)).status, 200)
		const third = await ask("quo-3", k)
		assert.deepEqual([third.status, third.json.code], [403, "quota"], third.text)
		assert.match(third.json.error, /agent key "quo" has used today's 2 new videos/)
		assert.ok(Date.parse(third.json.resetsAt) > Date.now())
		assert.equal((await db.pg.query("select count(*)::int as n from videos where job = 'quo-3'")).rows[0].n, 0, "no job made")
		assert.deepEqual([await vid("quo", "jobs"), await vid("quo", "mb")], [2, 2])
		assert.equal((await ask("quo-1", k)).status, 200, "asking again for its own job: no new video, one more MB")
		const mb = await ask("quo-1", k)
		assert.deepEqual([mb.status, mb.json.code], [403, "quota"])
		assert.match(mb.json.error, /3 MB of uploads/)
		assert.deepEqual([await vid("quo", "jobs"), await vid("quo", "mb")], [2, 3])
		const big = await issue("qbig", { videos: 5, mb: 3 })
		const r = await ask("qbig-1", big, [{ name: "video.mp4", type: "video/mp4", size: 4 * 1048576 }])
		assert.deepEqual([r.status, r.json.code], [403, "quota"])
		assert.deepEqual([await vid("qbig", "jobs"), await vid("qbig", "mb")], [0, 0], "the refused new job is given back")
		const list = (await (await import("../../tools/video-agent/keys.mjs")).run(["list"], { db: await getDb() })).join("\n")
		assert.match(list, /videos\/day\s+MB\/day/)
		assert.match(list, /\nquo\s+active\s+\$25\.00\s+120\s+2\s+3\s+\S+\s+\$0\.00\s+0\s+0\s+2\s+3/)
	})

	test("publishes a day: 3 per video of the cap; a revoked key's next ask is refused", async () => {
		const k = await issue("pubq", { videos: 1, mb: 50 })
		await uploadAll("pubq-1", k)
		for (let i = 0; i < 3; i++) assert.equal((await post(publishFn, "/api/videos/publish", META({ job: "pubq-1" }), agentHeaders(k))).status, 200)
		const r = await post(publishFn, "/api/videos/publish", META({ job: "pubq-1" }), agentHeaders(k))
		assert.deepEqual([r.status, r.json.code], [403, "quota"])
		assert.match(r.json.error, /3 publishes/)
		await keys.revokeAgentKey(await getDb(), "pubq")
		assert.equal((await ask("pubq-2", k)).json.code, "forbidden")
	})

	test("the master key's caps come from the environment (defaults 50 videos and 2000 MB a day)", async () => {
		assert.deepEqual([keys.agentDefaults({}).videosPerDay, keys.agentDefaults({}).uploadMbPerDay], [50, 2000])
		assert.deepEqual([keys.agentDefaults({ AI_AGENT_VIDEOS_PER_DAY: "7", AI_AGENT_UPLOAD_MB_PER_DAY: "90" }).videosPerDay, keys.agentDefaults({ AI_AGENT_VIDEOS_PER_DAY: "7", AI_AGENT_UPLOAD_MB_PER_DAY: "90" }).uploadMbPerDay], [7, 90])
		assert.equal((await keys.verifyAgentKey(MASTER, { env: process.env })).agent.videosPerDay, 50)
	})
})

// ---------------------------------------------------------------- the owner's tool
describe("tools/video-agent/keys.mjs", () => {
	test("issue (once), list, revoke, issue again: the old key stops working at once, the new one works", async () => {
		const { run } = await import("../../tools/video-agent/keys.mjs")
		const d = await getDb()
		const out = await run(["issue", "fay", "--usd", "5", "--steps", "10"], { db: d })
		const key = out.find((l) => l.startsWith("psk_"))
		issued.push(key)
		assert.ok(key)
		assert.equal((await keys.verifyAgentKey(key, { env: process.env })).agent.name, "fay")
		const row = (await db.pg.query("select key_sha256, usd_per_day::float8 as usd, steps_per_hour from agent_keys where name = 'fay'")).rows[0]
		assert.deepEqual([row.key_sha256, row.usd, row.steps_per_hour], [keys.keyHash(key), 5, 10])
		assert.ok(!JSON.stringify((await db.pg.query("select * from agent_keys")).rows).includes(key), "only the hash is stored")
		await assert.rejects(run(["issue", "fay"], { db: d }), /already has an active key/)
		await assert.rejects(run(["issue", "owner"], { db: d }), /master key/)
		await assert.rejects(run(["issue", "Bad Name"], { db: d }), /lowercase/)
		await assert.rejects(run(["issue", "gil", "--usd", "0"], { db: d }), /--usd/)
		const list = (await run(["list"], { db: d })).join("\n")
		assert.match(list, /^name\s+status/)
		assert.match(list, /\nowner\s+master \(AI_AGENT_KEY\)/)
		assert.match(list, /\nfay\s+active\s+\$5\.00\s+10/)
		assert.match(list, /\nbo\s+revoked/)
		assert.ok(!list.includes(key))
		assert.deepEqual(await run(["revoke", "fay"], { db: d }), [`Revoked "fay": its key is refused from the next request on.`])
		assert.equal((await keys.verifyAgentKey(key, { env: process.env })).code, "forbidden")
		let file = null
		const quiet = await run(["issue", "fay", "--out", "fay.key"], { db: d, write: (f, s) => (file = { f, s }) })
		issued.push(file.s.trim())
		assert.ok(!quiet.join("\n").includes(file.s.trim()), "--out prints nothing secret")
		assert.equal((await keys.verifyAgentKey(file.s.trim(), { env: process.env })).agent.name, "fay")
		assert.equal((await keys.verifyAgentKey(key, { env: process.env })).ok, false, "the old key stays dead")
	})
})
