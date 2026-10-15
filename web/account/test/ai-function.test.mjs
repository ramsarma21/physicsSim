// api/ai/[step].mjs with accounts switched on, called the way Vercel's Node runtime calls it, against the AI core's mock gateway and a
// Postgres in this process: anonymous callers are asked to sign in, a signed-in person's step runs and its cost is recorded, the hourly
// allowance refuses with 403 quota (not 429), and the invite cookie still works. No network, no keys. docs/ACCOUNTS.md §6.
import assert from "node:assert/strict"
import { createPublicKey } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { FAKE_KEY, startMockGateway, testRouting } from "../../../ai/test/mock-gateway.mjs"
import { call, testClerk, testDatabase } from "./helpers.mjs"

const clerk = testClerk("clerk.ai-test.example")
const ORIGIN = "https://app-xyz.vercel.app"
const ENV = {
	VERCEL: "1",
	VERCEL_ENV: "preview",
	VERCEL_URL: "app-xyz.vercel.app",
	NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.pk,
	CLERK_SECRET_KEY: ["sk", "test", "AIFUNCTIONTEST0123456789"].join("_"), // built at runtime so secret scanners do not flag a fake key
	CLERK_JWT_KEY: createPublicKey(clerk.privateKey).export({ type: "spki", format: "pem" }), // (verification with no network)
	DATABASE_URL: "postgres://u:p@localhost/x", // (the database itself is PGlite, handed in)
	AI_SESSION_SECRET: "s".repeat(40),
}
const EDIT = { payload: { text: "hi", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: "r1" } }
const NOTHING = { content: JSON.stringify({ mode: "patch", reply: "Nothing to change.", patches: [] }), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, costInUSD: 0.25 } }

let gw, handler, twin, dir, db
const realFetch = globalThis.fetch
before(async () => {
	// Clerk's Backend API (a new person's name and email) answered by the test instance: nothing leaves this machine
	globalThis.fetch = (url, init) => (/^https:\/\/(api\.clerk\.com|clerk\.ai-test\.example)\//.test(String(url)) ? clerk.fetch(url, init) : realFetch(url, init))
	clerk.users.set("user_ai_1", { email: "ai1@example.com", first: "Ai" })
	gw = await startMockGateway()
	dir = mkdtempSync(join(tmpdir(), "ai-accounts-"))
	writeFileSync(join(dir, "models.json"), JSON.stringify(testRouting({ timeoutMs: 500, budgetMs: 2000, backoffMs: 10 })))
	Object.assign(process.env, { TRUEFOUNDRY_API_KEY: FAKE_KEY, AI_GATEWAY_URL: gw.url, AI_MODELS: join(dir, "models.json"), ...ENV })
	db = await testDatabase()
	twin = await import("../../../api/ai/[step].mjs")
	handler = twin.default
})
after(async () => {
	globalThis.fetch = realFetch
	for (const k of ["TRUEFOUNDRY_API_KEY", "AI_GATEWAY_URL", "AI_MODELS", "AI_USER_STEPS_PER_HOUR", ...Object.keys(ENV)]) delete process.env[k]
	await gw.close()
	await db.close()
	rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => gw.reset())

const step = (name, headers = {}) => call(handler, { method: "POST", url: `/api/ai/${name}`, query: { step: name }, body: EDIT, headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers } })
const bearer = (sub) => ({ authorization: `Bearer ${clerk.token({ sub, azp: ORIGIN })}` })

test("anonymous on a deploy with accounts: 401 sign_in, and the model is never called", async () => {
	const r = await step("edit")
	assert.equal(r.status, 401)
	assert.equal(r.json.code, "sign_in")
	assert.equal(r.json.error, "Sign in with Google to use Build with AI")
	assert.equal(gw.requests.length, 0)
})

test("signed in: the step runs, and what it cost is on that person's day and the site's", async () => {
	gw.script("m1", [NOTHING])
	const r = await step("edit", bearer("user_ai_1"))
	assert.equal(r.status, 200, r.text)
	assert.equal(r.json.ok, true)
	const acct = (await db.pg.query("select account_id from identities where sub = 'user_ai_1'")).rows[0].account_id
	const day = `ai:d:${new Date().toISOString().slice(0, 10)}`
	const mine = (await db.pg.query("select n, usd::float8 as usd from counters where key = $1 and bucket = $2", [acct, day])).rows[0]
	const site = (await db.pg.query("select usd::float8 as usd from counters where key = '*' and bucket = $1", [day])).rows[0]
	assert.deepEqual(mine, { n: 1, usd: 0.25 })
	assert.ok(site.usd >= 0.25)
	assert.ok(!r.text.includes(ENV.CLERK_SECRET_KEY) && !r.text.includes(FAKE_KEY))
})

test("over the hourly allowance: 403 quota with resetsAt (never 429), the model not called, the slot given back", async () => {
	process.env.AI_USER_STEPS_PER_HOUR = "1"
	try {
		gw.script("m1", [NOTHING, NOTHING])
		assert.equal((await step("edit", bearer("user_ai_2"))).status, 200)
		const before = gw.requests.length
		const r = await step("edit", bearer("user_ai_2"))
		assert.equal(r.status, 403)
		assert.equal(r.json.code, "quota")
		assert.equal(r.json.requestId, "r1")
		assert.ok(Date.parse(r.json.resetsAt) > Date.now())
		assert.equal(gw.requests.length, before)
		assert.equal(twin._queue.busy, 0)
	} finally {
		delete process.env.AI_USER_STEPS_PER_HOUR
	}
})

test("an expired token: 401 with expired: true (the page refreshes it once)", async () => {
	const r = await step("edit", { authorization: `Bearer ${clerk.token({ sub: "user_ai_3", azp: ORIGIN, exp: 1000 })}` })
	assert.equal(r.status, 401)
	assert.equal(r.json.expired, true)
})

test("the invite cookie still lets a page in, counted as its own caller", async () => {
	gw.script("m1", [NOTHING])
	const value = twin.makeSession(ENV.AI_SESSION_SECRET, 1)
	const r = await step("edit", { cookie: `ai_session=${encodeURIComponent(value)}` })
	assert.equal(r.status, 200, r.text)
	const nonce = JSON.parse(Buffer.from(value.split(".")[0], "base64url").toString()).n
	const row = (await db.pg.query("select n from counters where key = $1", [`inv_${nonce}`])).rows
	assert.ok(row.length >= 1)
})
