// Test helpers for the account functions: a test Clerk instance (an RSA key, its JWKS, tokens signed with it, a fake Backend API) and a real
// Postgres in this process (PGlite) handed to api/_lib/db.mjs. Nothing here talks to the network.
import { createHash, generateKeyPairSync, createSign, randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import { PGlite } from "@electric-sql/pglite"
import { setDatabase } from "../../../api/_lib/db.mjs"
import { _jwksCache } from "../../../api/_lib/auth.mjs"

export const pkFor = (host, live = false) => `pk_${live ? "live" : "test"}_${Buffer.from(`${host}$`).toString("base64")}`

/** A Clerk instance for tests: {pk, iss, kid, token(claims, opts), fetch, users, calls}. */
export function testClerk(host = "clerk.example.test", { kid = "kid-1" } = {}) {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
	const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }
	const iss = `https://${host}`
	const users = new Map() // sub -> {email, verified, first, last}
	const calls = { jwks: 0, users: 0, deletes: 0 }
	const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
	function token(claims = {}, { alg = "RS256", headerKid = kid, key = privateKey, now = Date.now() } = {}) {
		const t = Math.floor(now / 1000)
		const head = b64({ alg, kid: headerKid, typ: "JWT" })
		const body = b64({ iss, sub: "user_a", sid: "sess_1", iat: t, nbf: t - 10, exp: t + 60, v: 2, ...claims })
		if (alg === "none") return `${head}.${body}.x`
		if (alg === "HS256") {
			const mac = createHash("sha256").update(`${head}.${body}`).digest("base64url")
			return `${head}.${body}.${mac}`
		}
		const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url")
		return `${head}.${body}.${sig}`
	}
	let keys = [jwk]
	const fetchImpl = async (url, init = {}) => {
		const u = String(url)
		if (u === `${iss}/.well-known/jwks.json`) {
			calls.jwks++
			return Response.json({ keys })
		}
		const m = u.match(/^https:\/\/api\.clerk\.com\/v1\/users\/([^/?]+)$/)
		if (m) {
			const sub = decodeURIComponent(m[1])
			if (!String(init.headers?.Authorization ?? "").startsWith("Bearer sk_test_")) return new Response("{}", { status: 401 })
			if (init.method === "DELETE") {
				calls.deletes++
				users.delete(sub)
				return Response.json({ deleted: true })
			}
			calls.users++
			const p = users.get(sub)
			if (!p) return new Response("{}", { status: 404 })
			return Response.json({ id: sub, first_name: p.first ?? null, last_name: p.last ?? null, primary_email_address_id: "idn_1", email_addresses: [{ id: "idn_1", email_address: p.email, verification: { status: p.verified === false ? "unverified" : "verified" } }] })
		}
		throw new TypeError(`fetch failed (test: no network for ${u})`)
	}
	return { pk: pkFor(host), iss, kid, token, fetch: fetchImpl, users, calls, privateKey, rotate(newKeys) { keys = newKeys }, jwk }
}

/** A Postgres in this process, used by api/_lib/db.mjs until the test ends. */
export async function testDatabase() {
	const pg = new PGlite()
	await pg.waitReady
	setDatabase({
		query: async (text, params = []) => (await pg.query(text, params)).rows,
		batch: async (texts) => pg.transaction(async (tx) => {
			for (const t of texts) await tx.query(t)
		}),
	})
	return { pg, close: async () => { setDatabase(null); await pg.close() } }
}
export const clearJwks = () => _jwksCache.clear()

/** Calls a function handler the way Vercel's Node runtime does: (req, res), a JSON body, headers. -> {status, json, text, body (Buffer), headers} */
export function call(handler, { method = "GET", url = "/api/scenes", body, headers = {}, query } = {}) {
	const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
	const req = Readable.from(raw ? [Buffer.from(raw)] : [])
	const u = new URL(url, "http://x")
	const h = { ...(raw ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)) } : {}), ...headers }
	for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k]
	Object.assign(req, { method, url: u.pathname + u.search, query: { ...Object.fromEntries(u.searchParams), ...(query ?? {}) }, headers: Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])) })
	return new Promise((resolve, reject) => {
		const res = {
			statusCode: 200,
			headers: {},
			writableEnded: false,
			destroyed: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v },
			getHeader(k) { return this.headers[k.toLowerCase()] },
			flushHeaders() {},
			write() { return true },
			end(data) {
				this.writableEnded = true
				const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ""))
				const text = buf.toString("utf8")
				let json = null
				try { json = JSON.parse(text) } catch {}
				resolve({ status: this.statusCode, json, text, body: buf, headers: this.headers })
			},
		}
		Promise.resolve(handler(req, res)).catch(reject)
	})
}

export const randomHex = (n) => randomBytes(n).toString("hex")
/** A tiny real image of each type (for the thumbnail checks). */
export const PNG_1x1 = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000500010d0a2db40000000049454e44ae426082", "hex")
export const JPEG_HEAD = Buffer.concat([Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex"), Buffer.alloc(64, 1), Buffer.from("ffd9", "hex")])
export const WEBP_HEAD = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(22, 0)])
export const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString("base64")}`
