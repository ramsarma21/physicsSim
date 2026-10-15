// The account functions, with no network and no keys: the token verifier against a test RSA key and JWKS, the scenes function against a
// real Postgres in this process (PGlite), and the AI gate. npm run test:accounts. Contract: docs/ACCOUNTS.md §10.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, beforeEach, describe, test } from "node:test"
import { createPublicKey, generateKeyPairSync } from "node:crypto"
import { call, clearJwks, dataUrl, JPEG_HEAD, PNG_1x1, testClerk, testDatabase, WEBP_HEAD } from "./helpers.mjs"
import { parsePublishableKey, verifySessionToken } from "../../../api/_lib/auth.mjs"
import { handle, publicConfig } from "../../../api/scenes/index.mjs"
import { aiGate, emailAllowed } from "../../../api/_lib/ai-gate.mjs"
import { normName, parseThumb } from "../../../api/_lib/scenes.mjs"
import { scrubSecrets } from "../../../api/_lib/http.mjs"

const STARTER = JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url), "utf8"))
const SK = ["sk", "test", "TESTSECRETKEY0123456789abcdef"].join("_") // fake; built at runtime so secret scanners do not flag it
const DBURL = ["postgres://owner", "sup3rs3cretpw@ep-test-123.us-east-1.aws.neon.tech/neondb?sslmode=require"].join(":") // fake
const clerk = testClerk()
const ENV = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.pk, CLERK_SECRET_KEY: SK, DATABASE_URL: DBURL }
const ORIGIN = "http://localhost:4173"
const answers = [] // every answer's text, checked for secrets at the end

let db
const realFetch = globalThis.fetch
before(async () => {
	globalThis.fetch = async (url) => { throw new Error(`a test reached for the network: ${url}`) } // (every call here goes to the test instance's own fetch)
	db = await testDatabase()
	clerk.users.set("user_a", { email: "ana@example.com", first: "Ana", last: "Lima" })
	clerk.users.set("user_b", { email: "bo@example.com", first: "Bo" })
})
after(async () => {
	globalThis.fetch = realFetch
	await db.close()
	for (const t of answers) {
		for (const secret of [SK, DBURL, "sup3rs3cretpw", "postgres://"]) assert.ok(!t.includes(secret), `an answer holds a secret: ${t.slice(0, 120)}`)
	}
})
beforeEach(() => clearJwks())

/** One request to the scenes function as `sub` (null: no token). */
async function api(method, url, { sub = "user_a", body, headers = {}, env = ENV, token, inst = clerk } = {}) {
	const auth = token !== undefined ? token : sub ? inst.token({ sub, azp: ORIGIN }) : null
	const r = await call((req, res) => handle(req, res, { env, fetch: inst.fetch }), {
		method,
		url,
		body,
		headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(method !== "GET" ? { origin: ORIGIN } : {}), ...headers },
	})
	answers.push(r.text)
	return r
}
const scene = (name = "Ramp test", extra = {}) => ({ ...structuredClone(STARTER), name, ...extra })

// ---------------------------------------------------------------- the token
describe("session token verification", () => {
	const v = (tok, env = ENV, now) => verifySessionToken(tok, { env, fetch: clerk.fetch, now })
	test("the publishable key names the instance", () => {
		assert.deepEqual(parsePublishableKey(clerk.pk), { host: "clerk.example.test", instance: "test" })
		assert.equal(parsePublishableKey("pk_test_" + Buffer.from("no-dollar").toString("base64")), null)
		assert.equal(parsePublishableKey("sk_test_abc"), null)
		assert.equal(parsePublishableKey("pk_test_" + Buffer.from("evil host/x$").toString("base64")), null)
	})
	test("a good token: {iss, sub, sid}", async () => {
		assert.deepEqual(await v(clerk.token({ azp: ORIGIN })), { iss: clerk.iss, sub: "user_a", sid: "sess_1" })
		assert.deepEqual(await v(clerk.token({ azp: undefined })), { iss: clerk.iss, sub: "user_a", sid: "sess_1" }) // (no azp: skipped, as Clerk says)
	})
	test("refused: alg none, HS256, a bad signature, another key, a broken token", async () => {
		const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
		for (const tok of [clerk.token({}, { alg: "none" }), clerk.token({}, { alg: "HS256" }), clerk.token({}).slice(0, -6) + "AAAAAA", clerk.token({}, { key: other }), "a.b", "x.y.z"])
			await assert.rejects(v(tok), (e) => e.status === 401 && e.code === "sign_in" && e.extra.expired === false)
	})
	test("refused: expired (expired: true), not yet valid, another issuer, a foreign azp, a pending session", async () => {
		await assert.rejects(v(clerk.token({ exp: Math.floor(Date.now() / 1000) - 30 })), (e) => e.status === 401 && e.extra.expired === true)
		assert.ok(await v(clerk.token({ exp: Math.floor(Date.now() / 1000) - 2 }))) // (5 s of leeway)
		await assert.rejects(v(clerk.token({ nbf: Math.floor(Date.now() / 1000) + 60 })), (e) => e.reason === "not yet valid")
		await assert.rejects(v(clerk.token({ iss: "https://evil.example" })), (e) => e.reason === "issuer")
		await assert.rejects(v(clerk.token({ azp: "https://evil.example" })), (e) => e.reason === "authorized party")
		await assert.rejects(v(clerk.token({ sts: "pending" })), (e) => e.reason === "session status")
		assert.ok(await v(clerk.token({ sts: "active" })))
		// on Vercel only this deployment's own origins
		const vercel = { ...ENV, VERCEL: "1", VERCEL_URL: "app-abc.vercel.app" }
		await assert.rejects(v(clerk.token({ azp: ORIGIN }), vercel), (e) => e.reason === "authorized party")
		assert.ok(await v(clerk.token({ azp: "https://app-abc.vercel.app" }), vercel))
	})
	test("an unknown kid refetches the JWKS, at most once a minute; a rotated key is found", async () => {
		const t0 = Date.now()
		const n0 = clerk.calls.jwks
		await v(clerk.token({}, { now: t0 }), ENV, t0)
		assert.equal(clerk.calls.jwks, n0 + 1)
		await v(clerk.token({}, { now: t0 }), ENV, t0 + 1000)
		assert.equal(clerk.calls.jwks, n0 + 1, "cached")
		const fresh = (dt) => clerk.token({}, { headerKid: "kid-new", now: t0 + dt })
		await assert.rejects(v(fresh(2000), ENV, t0 + 2000), (e) => e.reason === "unknown kid")
		assert.equal(clerk.calls.jwks, n0 + 1, "not within a minute of the last fetch")
		await assert.rejects(v(fresh(61_000), ENV, t0 + 61_000), (e) => e.reason === "unknown kid")
		assert.equal(clerk.calls.jwks, n0 + 2, "refetched once for the unknown kid")
		await assert.rejects(v(fresh(62_000), ENV, t0 + 62_000), (e) => e.reason === "unknown kid")
		assert.equal(clerk.calls.jwks, n0 + 2, "and not again within the minute")
		clerk.rotate([clerk.jwk, { ...clerk.jwk, kid: "kid-new" }])
		assert.ok(await v(fresh(125_000), ENV, t0 + 125_000), "a minute later the rotated key is fetched and found")
		assert.equal(clerk.calls.jwks, n0 + 3)
		clerk.rotate([clerk.jwk])
	})
	test("CLERK_JWT_KEY verifies with no network", async () => {
		const publicKey = createPublicKey(clerk.privateKey)
		const env = { ...ENV, CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }) }
		const n0 = clerk.calls.jwks
		assert.ok(await verifySessionToken(clerk.token(), { env, fetch: clerk.fetch }))
		assert.equal(clerk.calls.jwks, n0)
	})
	test("the JWKS unreachable: 503, not a sign-in problem", async () => {
		await assert.rejects(verifySessionToken(clerk.token(), { env: ENV, fetch: async () => { throw new TypeError("fetch failed") } }), (e) => e.status === 503 && e.code === "unavailable")
	})
})

// ---------------------------------------------------------------- the scenes function
describe("scenes", () => {
	test("GET /api/scenes/me without a token: what the page needs (nothing configured: accounts null, storage false)", async () => {
		const none = await api("GET", "/api/scenes/me", { sub: null, env: {} })
		assert.equal(none.status, 200)
		assert.deepEqual(none.json, { ok: true, accounts: null, storage: false, ai: { signInRequired: false } })
		const on = await api("GET", "/api/scenes/me", { sub: null })
		assert.deepEqual(on.json, { ok: true, accounts: { provider: "clerk", publishableKey: clerk.pk }, storage: true, ai: { signInRequired: true } })
		assert.equal(on.headers["cache-control"], "no-store")
		assert.deepEqual(publicConfig({ ...ENV, ACCOUNTS: "off" }).accounts, null)
		const off = await api("GET", "/api/scenes", { env: { ...ENV, ACCOUNTS: "off" } })
		assert.equal(off.status, 503)
		assert.equal(off.json.code, "not_configured")
	})
	test("no token or a bad one: 401 sign_in", async () => {
		assert.equal((await api("GET", "/api/scenes", { sub: null })).json.code, "sign_in")
		const exp = await api("GET", "/api/scenes", { token: clerk.token({ exp: 1000 }) })
		assert.equal(exp.status, 401)
		assert.equal(exp.json.expired, true)
	})
	test("the first call makes the account (name and email from Clerk); /me has usage and today's AI", async () => {
		const me = await api("GET", "/api/scenes/me")
		assert.equal(me.status, 200)
		assert.match(me.json.user.id, /^u_[a-z2-7]{16}$/)
		assert.equal(me.json.user.name, "Ana Lima")
		assert.equal(me.json.user.email, "ana@example.com")
		assert.equal(me.json.user.isNew, true)
		assert.deepEqual(me.json.usage, { scenes: 0, bytes: 0, maxScenes: 500, maxBytes: 50 << 20 })
		assert.equal(me.json.aiToday.steps, 0)
		assert.equal(me.json.aiToday.maxUsd, 3)
		const again = await api("GET", "/api/scenes/me")
		assert.equal(again.json.user.id, me.json.user.id)
		assert.equal(again.json.user.isNew, false)
	})
	test("create, list, get, rename, update with If-Match, 412 when stale, picture, delete, restore", async () => {
		const png = dataUrl("image/png", PNG_1x1)
		const c = await api("POST", "/api/scenes", { body: { name: "Ramp test!!", scene: scene("ignored"), thumb: png } })
		assert.equal(c.status, 201, c.text)
		const meta = c.json.scene
		assert.match(meta.id, /^s_[a-z2-7]{16}$/)
		assert.equal(meta.name, "Ramp test") // (normalised as the in-page save does)
		assert.equal(meta.items, STARTER.items.length)
		assert.equal(meta.version, 1)
		assert.match(meta.thumb, new RegExp(`^/api/scenes/${meta.id}/thumb\\?v=[0-9a-f]{16}$`))
		assert.equal(c.headers.location, `/api/scenes/${meta.id}`)

		const list = await api("GET", "/api/scenes")
		assert.equal(list.json.scenes[0].id, meta.id)

		const got = await api("GET", `/api/scenes/${meta.id}`)
		assert.equal(got.status, 200)
		assert.equal(got.headers.etag, '"v1"')
		assert.equal(got.json.data.id, meta.id)
		assert.equal(got.json.data.name, "Ramp test")
		assert.equal(got.json.data.items.length, STARTER.items.length)

		// the rewrite's form: /api/scenes?id=..&part=..
		const viaQuery = await api("GET", `/api/scenes?id=${meta.id}`)
		assert.equal(viaQuery.json.scene.id, meta.id)

		const pic = await api("GET", meta.thumb)
		assert.equal(pic.status, 200)
		assert.equal(pic.headers["content-type"], "image/png")
		assert.ok(pic.body.equals(PNG_1x1))
		assert.equal(pic.headers["cache-control"], "private, max-age=31536000, immutable")
		assert.match(pic.headers["content-security-policy"], /default-src 'none'/)
		assert.equal(pic.headers["x-content-type-options"], "nosniff")
		const picQ = await api("GET", `/api/scenes?id=${meta.id}&part=thumb`)
		assert.equal(picQ.status, 200)

		// a picture alone: neither version nor updatedAt changes
		const jpg = await api("PUT", `/api/scenes/${meta.id}`, { body: { thumb: dataUrl("image/jpeg", JPEG_HEAD) } })
		assert.equal(jpg.status, 200, jpg.text)
		assert.equal(jpg.json.scene.version, 1)
		assert.equal(jpg.json.scene.updatedAt, meta.updatedAt)
		assert.notEqual(jpg.json.scene.thumb, meta.thumb)

		const ren = await api("PUT", `/api/scenes/${meta.id}`, { body: { name: "Ramp two" }, headers: { "if-match": '"v1"' } })
		assert.equal(ren.status, 200, ren.text)
		assert.equal(ren.json.scene.version, 2)
		assert.equal((await api("GET", `/api/scenes/${meta.id}`)).json.data.name, "Ramp two") // (the stored scene carries its name)
		const stale = await api("PUT", `/api/scenes/${meta.id}`, { body: { scene: scene("x") }, headers: { "if-match": '"v1"' } })
		assert.equal(stale.status, 412)
		assert.equal(stale.json.code, "conflict")
		assert.equal(stale.json.current.version, 2)
		const upd = await api("PUT", `/api/scenes/${meta.id}`, { body: { scene: scene("whatever", { seconds: 6 }) }, headers: { "if-match": '"v2"' } })
		assert.equal(upd.json.scene.version, 3)
		assert.equal(upd.json.scene.name, "Ramp two")
		assert.equal((await api("GET", `/api/scenes/${meta.id}`)).json.data.seconds, 6)
		const noPic = await api("PUT", `/api/scenes/${meta.id}`, { body: { thumb: null } })
		assert.equal(noPic.json.scene.thumb, null)
		assert.equal((await api("GET", `/api/scenes/${meta.id}/thumb`)).status, 404)

		const del = await api("DELETE", `/api/scenes/${meta.id}`)
		assert.equal(del.status, 200)
		assert.equal(del.json.deleted, meta.id)
		assert.ok(Date.parse(del.json.restoreUntil) > Date.now() + 29 * 86400_000)
		assert.equal((await api("GET", `/api/scenes/${meta.id}`)).status, 404)
		assert.ok(!(await api("GET", "/api/scenes")).json.scenes.some((s) => s.id === meta.id))
		const back = await api("POST", `/api/scenes/${meta.id}/restore`)
		assert.equal(back.status, 200, back.text)
		assert.equal(back.json.scene.id, meta.id)
		assert.equal((await api("GET", `/api/scenes/${meta.id}`)).status, 200)
	})
	test("another person's scene, a made-up id, a deleted one: 404, never 403", async () => {
		const mine = (await api("POST", "/api/scenes", { body: { name: "Private", scene: scene() } })).json.scene
		for (const [m, u, body] of [["GET", `/api/scenes/${mine.id}`], ["PUT", `/api/scenes/${mine.id}`, { name: "x" }], ["DELETE", `/api/scenes/${mine.id}`], ["POST", `/api/scenes/${mine.id}/restore`], ["GET", `/api/scenes/${mine.id}/thumb`]]) {
			const r = await api(m, u, { sub: "user_b", body })
			assert.equal(r.status, 404, `${m} ${u}: ${r.text}`)
			assert.equal(r.json.code, "not_found")
		}
		assert.ok(!(await api("GET", "/api/scenes", { sub: "user_b" })).json.scenes.some((s) => s.id === mine.id))
		assert.equal((await api("GET", "/api/scenes/s_aaaaaaaaaaaaaaaa")).status, 404)
		assert.equal((await api("GET", "/api/scenes/..%2F..%2Fetc")).status, 404)
		assert.equal((await api("GET", "/api/scenes/' or 1=1 --")).status, 404)
		assert.equal((await api("GET", `/api/scenes/${mine.id}`)).status, 200, "still there for its owner")
	})
	test("bad input: clean()'s message, unknown fields, not JSON, wrong methods, foreign origins", async () => {
		const bad = await api("POST", "/api/scenes", { body: { name: "x", scene: { items: "nope" } } })
		assert.equal(bad.status, 400)
		assert.match(bad.json.error, /items must be a list/)
		assert.equal((await api("POST", "/api/scenes", { body: { name: "x", scene: scene(), extra: 1 } })).status, 400)
		assert.equal((await api("POST", "/api/scenes", { body: { name: "x" } })).status, 400)
		assert.equal((await api("POST", "/api/scenes", { body: "[1,2]" })).status, 400)
		assert.equal((await api("POST", "/api/scenes", { body: "{nope" })).status, 400)
		const text = await api("POST", "/api/scenes", { body: JSON.stringify({ scene: scene() }), headers: { "content-type": "text/plain" } })
		assert.equal(text.status, 415)
		const m = await api("PATCH", "/api/scenes")
		assert.equal(m.status, 405)
		assert.equal(m.headers.allow, "GET, POST")
		assert.equal((await api("GET", "/api/scenes/me/thumb")).status, 404)
		const vercel = { ...ENV, VERCEL: "1", VERCEL_URL: "app-abc.vercel.app" }
		const foreign = await api("POST", "/api/scenes", { env: vercel, body: { scene: scene() }, headers: { origin: "https://evil.example" } })
		assert.equal(foreign.status, 403)
		assert.equal(foreign.json.code, "forbidden")
		const noOrigin = await api("POST", "/api/scenes", { env: vercel, body: { scene: scene() }, headers: { origin: undefined } })
		assert.equal(noOrigin.status, 403)
		const crossSite = await api("DELETE", "/api/scenes/s_aaaaaaaaaaaaaaaa", { env: vercel, headers: { origin: "https://app-abc.vercel.app", "sec-fetch-site": "cross-site" } })
		assert.equal(crossSite.status, 403)
		const own = await api("POST", "/api/scenes", { env: vercel, token: clerk.token({ azp: "https://app-abc.vercel.app" }), body: { scene: scene("Own origin") }, headers: { origin: "https://app-abc.vercel.app", "sec-fetch-site": "same-origin" } })
		assert.equal(own.status, 201, own.text)
	})
	test("names are normalised like the in-page save; an empty one becomes Scene HHMMSS", async () => {
		assert.equal(normName("  <b>Hi</b> there's a ramp/2  "), "bHib there's a ramp2")
		assert.equal(normName("x".repeat(80)).length, 60)
		assert.match(normName("!!!"), /^Scene \d{6}$/)
		const r = await api("POST", "/api/scenes", { body: { name: "<img src=x onerror=alert(1)>", scene: scene() } })
		assert.equal(r.json.scene.name, "img srcx onerroralert1")
	})
	test("pictures: only real WebP / JPEG / PNG, at most 150 KB; SVG or HTML refused", async () => {
		assert.equal(parseThumb(dataUrl("image/webp", WEBP_HEAD)).type, "image/webp")
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
		for (const [type, bytes, status] of [["image/svg+xml", svg, 400], ["image/png", svg, 400], ["image/png", Buffer.from("<html><script>x</script>"), 400], ["image/jpeg", PNG_1x1, 400], ["image/png", Buffer.concat([PNG_1x1, Buffer.alloc(160 * 1024)]), 413]]) {
			const r = await api("POST", "/api/scenes", { body: { scene: scene(), thumb: dataUrl(type, bytes) } })
			assert.equal(r.status, status, `${type}: ${r.text}`)
		}
		assert.equal((await api("POST", "/api/scenes", { body: { scene: scene(), thumb: "https://evil.example/x.png" } })).status, 400)
	})
	test("limits: the body, the scene, scenes per account, bytes per account, writes per hour", async () => {
		const huge = { ...scene(), pad: "x".repeat(1.6 * 1048576) }
		assert.equal((await api("POST", "/api/scenes", { body: { scene: huge } })).status, 413)
		const bigProps = Object.fromEntries(Array.from({ length: 22000 }, (_, i) => [`p${i}`, "y".repeat(40)]))
		const fat = scene("Fat", { items: [{ ...STARTER.items[0], props: bigProps }] })
		const tooBig = await api("POST", "/api/scenes", { body: { scene: fat } })
		assert.equal(tooBig.status, 413, tooBig.text)
		assert.match(tooBig.json.error, /scene is too large/)
		const env3 = { ...ENV, SCENES_MAX_PER_USER: "2" }
		for (let i = 0; i < 2; i++) assert.equal((await api("POST", "/api/scenes", { sub: "user_c", env: env3, body: { scene: scene(`c${i}`) } })).status, 201)
		const full = await api("POST", "/api/scenes", { sub: "user_c", env: env3, body: { scene: scene("c3") } })
		assert.equal(full.status, 403)
		assert.equal(full.json.code, "quota")
		assert.match(full.json.error, /2 saved scenes/)
		const envB = { ...ENV, SCENES_MAX_BYTES_PER_USER: String(1 << 20) }
		const pic = dataUrl("image/png", Buffer.concat([PNG_1x1, Buffer.alloc(140 * 1024)]))
		let last
		for (let i = 0; i < 9; i++) last = await api("POST", "/api/scenes", { sub: "user_d", env: envB, body: { scene: scene(`d${i}`), thumb: pic } })
		assert.equal(last.status, 403, last.text)
		assert.match(last.json.error, /1 MB/)
		const envW = { ...ENV, SCENES_WRITES_PER_HOUR: "3" }
		const codes = []
		for (let i = 0; i < 4; i++) codes.push((await api("POST", "/api/scenes", { sub: "user_e", env: envW, body: { scene: scene(`e${i}`) } })).status)
		assert.deepEqual(codes, [201, 201, 201, 429])
		const r = await api("DELETE", "/api/scenes/s_aaaaaaaaaaaaaaaa", { sub: "user_e", env: envW })
		assert.equal(r.status, 429)
		assert.ok(Number(r.headers["retry-after"]) > 0)
		assert.equal(r.json.retryable, true)
	})
	test("the same verified email on another Clerk instance (production) links to the same account and its scenes", async () => {
		const prod = testClerk("clerk.physics-sandbox.example", { kid: "prod-1" })
		prod.users.set("user_prod_a", { email: "ana@example.com", first: "Ana" })
		const envProd = { ...ENV, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: prod.pk }
		const dev = (await api("GET", "/api/scenes/me")).json.user
		const p = await api("GET", "/api/scenes/me", { inst: prod, sub: "user_prod_a", env: envProd, token: prod.token({ sub: "user_prod_a", azp: ORIGIN }) })
		assert.equal(p.json.user.id, dev.id)
		const ours = (await api("GET", "/api/scenes")).json.scenes.map((s) => s.id)
		const theirs = (await api("GET", "/api/scenes", { inst: prod, env: envProd, token: prod.token({ sub: "user_prod_a", azp: ORIGIN }) })).json.scenes.map((s) => s.id)
		assert.deepEqual(theirs, ours)
		// an unverified email never links
		prod.users.set("user_prod_x", { email: "bo@example.com", verified: false })
		const x = await api("GET", "/api/scenes/me", { inst: prod, env: envProd, token: prod.token({ sub: "user_prod_x", azp: ORIGIN }) })
		const bo = (await api("GET", "/api/scenes/me", { sub: "user_b" })).json.user
		assert.notEqual(x.json.user.id, bo.id)
	})
	test("Clerk's Backend API unreachable: the account is made without an email (and filled in later)", async () => {
		const offline = { ...clerk, fetch: async (u, i) => (String(u).startsWith("https://api.clerk.com") ? Promise.reject(new TypeError("fetch failed")) : clerk.fetch(u, i)) }
		clerk.users.set("user_f", { email: "fay@example.com", first: "Fay" })
		const r = await api("GET", "/api/scenes/me", { sub: "user_f", inst: offline, token: clerk.token({ sub: "user_f", azp: ORIGIN }) })
		assert.equal(r.status, 200)
		assert.equal(r.json.user.email, null)
		const later = await api("GET", "/api/scenes/me", { sub: "user_f" })
		assert.equal(later.json.user.email, "fay@example.com")
	})
	test("deleting the account removes its scenes and the Clerk user; the next sign-in starts fresh", async () => {
		clerk.users.set("user_g", { email: "gus@example.com" })
		const s = (await api("POST", "/api/scenes", { sub: "user_g", body: { scene: scene("Gus") } })).json.scene
		const id0 = (await api("GET", "/api/scenes/me", { sub: "user_g" })).json.user.id
		assert.equal((await api("DELETE", "/api/scenes/me", { sub: "user_g", body: { confirm: "yes" } })).status, 400)
		const n0 = clerk.calls.deletes
		const del = await api("DELETE", "/api/scenes/me", { sub: "user_g", body: { confirm: "delete my account" } })
		assert.equal(del.status, 200, del.text)
		assert.equal(del.json.signInDeleted, true)
		assert.equal(clerk.calls.deletes, n0 + 1)
		const rows = await db.pg.query("select count(*)::int as n from scenes where id = $1", [s.id])
		assert.equal(rows.rows[0].n, 0)
		clerk.users.set("user_g", { email: "gus@example.com" })
		assert.notEqual((await api("GET", "/api/scenes/me", { sub: "user_g" })).json.user.id, id0)
	})
	test("database errors are scrubbed: no host, no connection string, no password", async () => {
		assert.equal(scrubSecrets(`connect to ${DBURL} failed`, ENV), "connect to [redacted] failed")
		assert.equal(scrubSecrets("postgresql://a:b@h/db x"), "[database] x")
		assert.equal(scrubSecrets(`key ${SK}`), "key [redacted]")
	})
})

// ---------------------------------------------------------------- the AI gate
describe("the AI gate", () => {
	const req = (headers = {}) => ({ method: "POST", url: "/api/ai/plan", headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) })
	const denyAll = () => [401, "unauthorized", "this page has no access to the AI (open the invite link again)"]
	const allowAll = () => null
	const gate = (headers, env = ENV, accessProblem = denyAll, now) => aiGate(req(headers), "plan", { accessProblem, env, fetch: clerk.fetch, ...(now ? { now } : {}) })
	const bearer = (sub = "user_a") => ({ authorization: `Bearer ${clerk.token({ sub, azp: ORIGIN })}` })

	test("without accounts configured it is the function's own access check, unchanged", async () => {
		const g = await gate({}, {}, denyAll)
		assert.deepEqual([g.ok, g.status, g.code], [false, 401, "unauthorized"])
		const ok = await gate({}, {}, allowAll)
		assert.equal(ok.ok, true)
		assert.equal(await ok.charge(), null)
		const tokenIgnored = await gate(bearer(), {}, denyAll)
		assert.equal(tokenIgnored.code, "unauthorized")
	})
	test("accounts on: anonymous -> 401 sign_in; a signed-in person passes; a bad token -> 401 (expired says so)", async () => {
		const anon = await gate({})
		assert.deepEqual([anon.status, anon.code, anon.error], [401, "sign_in", "Sign in with Google to use Build with AI"])
		const g = await gate(bearer())
		assert.equal(g.ok, true)
		assert.match(g.who.key, /^u_/)
		const exp = await gate({ authorization: `Bearer ${clerk.token({ exp: 100 })}` })
		assert.deepEqual([exp.status, exp.code, exp.extra.expired], [401, "sign_in", true])
		const noReq = await gate({}, { ...ENV, AI_REQUIRE_SIGN_IN: "0" })
		assert.equal(noReq.code, "unauthorized", "AI_REQUIRE_SIGN_IN=0: the old answer")
	})
	test("the invite cookie and the preview token still work, each counted as its own caller", async () => {
		const nonce = "0123456789abcdef"
		const cookie = `ai_session=${Buffer.from(JSON.stringify({ exp: 9e9, n: nonce })).toString("base64url")}.mac`
		const inv = await gate({ cookie }, ENV, allowAll)
		assert.equal(inv.who.key, `inv_${nonce}`)
		const tok = await gate({ "x-ai-access": "x".repeat(20) }, ENV, allowAll)
		assert.equal(tok.who.key, "tok")
	})
	test("hourly steps: the step over the limit is refused with 403 quota (not 429) and is not counted", async () => {
		const env = { ...ENV, AI_USER_STEPS_PER_HOUR: "2" }
		const now = () => new Date("2026-10-15T13:20:00Z")
		const codes = []
		for (let i = 0; i < 3; i++) {
			const g = await gate(bearer("user_h"), env, denyAll, now)
			const over = await g.charge()
			codes.push(over ? `${over.status} ${over.code}` : "ok")
		}
		assert.deepEqual(codes, ["ok", "ok", "403 quota"])
		const acct = (await api("GET", "/api/scenes/me", { sub: "user_h" })).json.user.id
		const row = (await db.pg.query("select n from counters where key = $1 and bucket = 'ai:h:2026-10-15T13'", [acct])).rows[0]
		assert.equal(row.n, 2)
		const nextHour = await (await gate(bearer("user_h"), env, denyAll, () => new Date("2026-10-15T14:01:00Z"))).charge()
		assert.equal(nextHour, null)
	})
	test("dollars: each step's cost is recorded (answer or error); the person's and the site's daily caps refuse with their own codes", async () => {
		const env = { ...ENV, AI_USER_USD_PER_DAY: "1", AI_SITE_USD_PER_DAY: "2.5" }
		const now = () => new Date("2026-10-16T09:00:00Z")
		const g1 = await gate(bearer("user_i"), env, denyAll, now)
		assert.equal(await g1.charge(), null)
		const out = await g1.run(async () => ({ result: 1, usage: { costInUSD: 0.6 } }))
		assert.equal(out.result, 1)
		const g2 = await gate(bearer("user_i"), env, denyAll, now)
		assert.equal(await g2.charge(), null)
		await assert.rejects(g2.run(async () => { throw Object.assign(new Error("model failed"), { usage: { costInUSD: 0.5 } }) }), /model failed/)
		const g3 = await gate(bearer("user_i"), env, denyAll, now)
		const over = await g3.charge()
		assert.equal(over.code, "quota")
		assert.equal(over.status, 403)
		assert.equal(over.extra.resetsAt, "2026-10-17T00:00:00.000Z")
		// another person: fine until the site's cap
		const g4 = await gate(bearer("user_j"), env, denyAll, now)
		assert.equal(await g4.charge(), null)
		await g4.run(async () => ({ usage: { costInUSD: 1.5 } }))
		const g5 = await gate(bearer("user_k"), env, denyAll, now)
		const site = await g5.charge()
		assert.equal(site.code, "site_quota")
		const acct = (await api("GET", "/api/scenes/me", { sub: "user_i" })).json.user.id
		const row = (await db.pg.query("select n, usd::float8 as usd from counters where key = $1 and bucket = 'ai:d:2026-10-16'", [acct])).rows[0]
		assert.deepEqual(row, { n: 2, usd: 1.1 }, "two steps ran (the refused third is not counted), $0.60 + $0.50")
	})
	test("AI_ALLOWED_EMAILS: invite-only Build with AI", async () => {
		assert.equal(emailAllowed("a@x.com", { AI_ALLOWED_EMAILS: "@x.com" }), true)
		assert.equal(emailAllowed("a@y.com", { AI_ALLOWED_EMAILS: "b@y.com, @x.com" }), false)
		assert.equal(emailAllowed(null, { AI_ALLOWED_EMAILS: "@x.com" }), false)
		const g = await gate(bearer("user_b"), { ...ENV, AI_ALLOWED_EMAILS: "ana@example.com" })
		assert.deepEqual([g.status, g.code], [403, "not_allowed"])
		assert.equal((await gate(bearer("user_a"), { ...ENV, AI_ALLOWED_EMAILS: "ana@example.com" })).ok, true)
	})
	test("on Vercel a signed-in caller without a database is refused (fails closed)", async () => {
		const g = await gate(bearer(), { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.pk, CLERK_SECRET_KEY: SK, VERCEL: "1", ALLOWED_ORIGINS: ORIGIN })
		assert.deepEqual([g.status, g.code], [503, "not_configured"])
	})
})
