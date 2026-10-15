// The scenes function: a signed-in person's saved scenes, with their pictures, on any device. One function for the whole group of routes
// (vercel.json rewrites /api/scenes/:id and /api/scenes/:id/:part here; Vercel recommends one function per group, so a warm instance serves
// them all). Contract: docs/ACCOUNTS.md §4.
//   GET    /api/scenes/me            {ok, accounts: {provider, publishableKey} | null, storage, ai: {signInRequired}} (+ user, usage, aiToday with a token)
//   DELETE /api/scenes/me            {confirm: "delete my account"} -> removes the account, its scenes and the Clerk user
//   GET    /api/scenes               {ok, scenes: [meta]} newest first
//   POST   /api/scenes               {name, scene, thumb?, savedAs?, copy?} -> 201 {ok, scene: meta}   (copy: "copy this browser's scenes", its own daily count)
//   GET    /api/scenes/:id           {ok, scene: meta, data} (ETag "v<version>")
//   PUT    /api/scenes/:id           any of {name, scene, thumb, savedAs} (If-Match: "v<version>") -> {ok, scene: meta}; stale: 412 {code: "conflict", current}
//   DELETE /api/scenes/:id           {ok, deleted, restoreUntil}
//   POST   /api/scenes/:id/restore   {ok, scene: meta}
//   GET    /api/scenes/:id/thumb     the picture (private, immutable with ?v=<etag>; CSP default-src 'none')
// Who: a Clerk session token in Authorization: Bearer (api/_lib/auth.mjs); writes also need this app's Origin (api/_lib/origin.mjs). Every
// query is scoped by the caller's account; a scene that isn't theirs is 404. Errors: {ok: false, error, code, retryable} (docs/ACCOUNTS.md §4.3).
import { HttpError, fail, failWith, logLine, readJson, send, urlOf } from "../_lib/http.mjs"
import { bearerToken, clerkSettings, verifySessionToken, AuthError } from "../_lib/auth.mjs"
import { writeOriginProblem } from "../_lib/origin.mjs"
import { dbConfigured, getDb } from "../_lib/db.mjs"
import { accountFor, deleteClerkUser, newId } from "../_lib/accounts.mjs"
import { ID_RE, MAX_SCENE_BYTES, countWrite, createScene, deleteAccount, deleteScene, getScene, getThumb, limits, listScenes, normName, normSavedAs, parseThumb, restoreScene, updateScene, usageOf } from "../_lib/scenes.mjs"
import { aiLimits, signInRequired } from "../_lib/ai-gate.mjs"

export const config = { maxDuration: 30 }
const MAX_BODY = 1.5 * 1048576

/** Accounts are on for this deployment: a valid publishable key AND a database (sign-in without anywhere to keep scenes would only break
 *  My scenes and Build with AI: the page stays local until both are connected), and not switched off (ACCOUNTS=off). */
export const accountsOn = (env = process.env) => !!clerkSettings(env) && dbConfigured(env) && (env.ACCOUNTS ?? "").toLowerCase() !== "off"
/** What the page needs to know before anyone signs in. */
export function publicConfig(env = process.env) {
	const s = accountsOn(env) ? clerkSettings(env) : null
	return { accounts: s ? { provider: "clerk", publishableKey: s.publishableKey } : null, storage: dbConfigured(env), ai: { signInRequired: signInRequired(env) } }
}

// ---------------------------------------------------------------- the scene in a request
/** The scene's top-level keys the app reads (web/CONTRACT.md "Scene"); anything else is dropped before it is stored, so a scene can't be
 *  padded with keys nobody reads. */
const SCENE_KEYS = ["version", "id", "name", "seconds", "release", "stage", "items", "goals"]
let sim = null // web/sim (clean()), loaded on the first write that carries a scene
async function cleaned(scene) {
	if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw new HttpError(400, "bad_input", "scene must be an object")
	const kept = {}
	for (const k of SCENE_KEYS) if (Object.hasOwn(scene, k)) kept[k] = scene[k]
	sim ??= await import("../../web/sim/index.js")
	try {
		return sim.clean(kept)
	} catch (e) {
		if (e instanceof sim.BadScene || e?.name === "BadScene" || e?.name === "ValueError") throw new HttpError(400, "bad_input", `can't use this scene: ${String(e.message).slice(0, 300)}`)
		throw new HttpError(400, "bad_input", "this scene can't be read")
	}
}
/** {text, items} of a cleaned scene with this id and name; 413 over the size limit. */
function sceneText(s, id, name) {
	s.id = id
	s.name = name
	const text = JSON.stringify(s)
	if (Buffer.byteLength(text) > MAX_SCENE_BYTES) throw new HttpError(413, "too_large", `the scene is too large (at most ${MAX_SCENE_BYTES >> 10} KB)`)
	return { text, items: Array.isArray(s.items) ? s.items.length : 0 }
}
function onlyKeys(body, keys) {
	const extra = Object.keys(body).filter((k) => !keys.includes(k))
	if (extra.length) throw new HttpError(400, "bad_input", `unknown field${extra.length > 1 ? "s" : ""}: ${extra.slice(0, 3).join(", ").slice(0, 80)} (allowed: ${keys.join(", ")})`)
}
const ifMatchOf = (req) => {
	const v = req.headers?.["if-match"]
	if (v === undefined) return null
	const m = String(Array.isArray(v) ? v[0] : v).match(/^\s*(?:W\/)?"v(\d{1,9})"\s*$/)
	if (!m) throw new HttpError(400, "bad_input", 'If-Match must be "v<version>"')
	return Number(m[1])
}

// ---------------------------------------------------------------- routing
/** {id, part} from /api/scenes[/:id[/:part]], or from the rewrite's query (?id=&part=). */
function route(req) {
	const { pathname, query } = urlOf(req)
	const m = pathname.match(/^\/api\/scenes(?:\/([^/]+))?(?:\/([^/]+))?\/?$/)
	const decode = (x) => {
		try {
			return decodeURIComponent(x)
		} catch {
			return "\u0000" // (not percent-encoding: no scene's id, so a 404)
		}
	}
	let id = m?.[1] ? decode(m[1]) : null
	let part = m?.[2] ? decode(m[2]) : null
	if (!id && query.id) id = query.id
	if (!part && query.part) part = query.part
	return { id, part, query, unknown: !m }
}
function allow(res, methods) {
	res.setHeader("Allow", methods.join(", "))
	return fail(res, 405, "bad_input", `use ${methods.join(" or ")}`)
}

async function whoIsCalling(req, env, deps) {
	const token = bearerToken(req)
	if (!token) throw new AuthError("no token")
	const who = await verifySessionToken(token, deps)
	const db = await getDb(env)
	const account = await accountFor(db, who, deps)
	if (account.disabled) throw new HttpError(403, "forbidden", "This account is switched off")
	return { db, who, account }
}

async function aiToday(db, account, env) {
	const lim = aiLimits(env)
	const now = new Date()
	const r = (await db.query("select n, usd::float8 as usd from counters where key = $1 and bucket = $2", [account.id, `ai:d:${now.toISOString().slice(0, 10)}`]))[0]
	return {
		steps: r?.n ?? 0,
		usd: Math.round((r?.usd ?? 0) * 100) / 100,
		maxSteps: lim.stepsPerDay,
		maxUsd: account.aiUsdPerDay ?? lim.userUsdPerDay,
		resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(),
	}
}

/** (req, res) as Vercel's Node runtime calls it. deps: {env, fetch} for tests. */
export async function handle(req, res, deps = {}) {
	const env = deps.env ?? process.env
	const d = { env, ...(deps.fetch ? { fetch: deps.fetch } : {}) }
	const t0 = Date.now()
	const method = String(req.method ?? "GET").toUpperCase()
	const r = route(req)
	let who = null
	const done = (status) => logLine({ route: `${method} /api/scenes${r.id ? (r.id === "me" ? "/me" : "/:id") : ""}${r.part ? `/${r.part}` : ""}`, status, ms: Date.now() - t0, account: who ? who.slice(0, 6) : undefined })
	try {
		if (r.unknown || (r.part && r.part !== "thumb" && r.part !== "restore") || (r.part && r.id === "me")) throw new HttpError(404, "not_found", "no such route")
		const me = r.id === "me"
		if (me && method === "GET" && !bearerToken(req)) {
			send(res, 200, { ok: true, ...publicConfig(env) })
			return done(200)
		}
		if (!accountsOn(env)) throw new HttpError(503, "not_configured", "Accounts are not switched on for this deployment")
		const write = method !== "GET" && method !== "HEAD"
		// the methods each route takes (before anything else is looked at)
		const methods = me ? ["GET", "DELETE"] : !r.id ? ["GET", "POST"] : r.part === "thumb" ? ["GET"] : r.part === "restore" ? ["POST"] : ["GET", "PUT", "DELETE"]
		if (!methods.includes(method)) {
			allow(res, methods)
			return done(405)
		}
		if (write) {
			const bad = writeOriginProblem(req, env)
			if (bad) throw new HttpError(403, "forbidden", bad)
		}
		if (r.id && !me && !ID_RE.test(r.id)) {
			// (an id the server never makes: nobody's scene; still only answered to a signed-in caller)
			await whoIsCalling(req, env, d)
			throw new HttpError(404, "not_found", "No such scene in your account")
		}
		const ctx = await whoIsCalling(req, env, d)
		const { db, account } = ctx
		who = account.id
		const lim = limits(env)

		// ---- /api/scenes/me
		if (me) {
			if (method === "GET") {
				const u = await usageOf(db, account.id)
				send(res, 200, {
					ok: true,
					...publicConfig(env),
					user: { id: account.id, name: account.name, email: account.email, isNew: account.isNew },
					usage: { scenes: u.scenes, bytes: u.bytes, maxScenes: lim.maxScenes, maxBytes: lim.maxBytes },
					aiToday: await aiToday(db, account, env),
				})
				return done(200)
			}
			const body = await readJson(req, 4096)
			onlyKeys(body, ["confirm"])
			if (body.confirm !== "delete my account") throw new HttpError(400, "bad_input", 'to delete the account, send {confirm: "delete my account"}')
			const clerk = await deleteClerkUser(ctx.who.sub, d)
			await deleteAccount(db, account.id)
			logLine({ event: "account_deleted", account: account.id.slice(0, 6), clerk })
			send(res, 200, { ok: true, deleted: true, signInDeleted: clerk })
			return done(200)
		}

		// ---- /api/scenes
		if (!r.id) {
			if (method === "GET") {
				send(res, 200, { ok: true, scenes: await listScenes(db, account.id, lim.maxScenes) })
				return done(200)
			}
			const body = await readJson(req, MAX_BODY)
			onlyKeys(body, ["name", "scene", "thumb", "savedAs", "copy"])
			if (body.scene === undefined) throw new HttpError(400, "bad_input", "scene is missing")
			if (body.copy !== undefined && typeof body.copy !== "boolean") throw new HttpError(400, "bad_input", "copy must be true or false")
			const s = await cleaned(body.scene)
			const id = newId("s")
			const name = normName(body.name ?? s.name)
			const { text, items } = sceneText(s, id, name)
			const thumb = body.thumb == null ? null : parseThumb(body.thumb)
			const savedAs = body.savedAs === undefined ? null : normSavedAs(body.savedAs)
			await countWrite(db, account.id, lim, new Date(), { copy: body.copy === true })
			const meta = await createScene(db, account.id, { id, name, text, items, thumb, savedAs }, lim)
			send(res, 201, { ok: true, scene: meta }, { Location: `/api/scenes/${meta.id}` })
			return done(201)
		}

		// ---- /api/scenes/:id/thumb
		if (r.part === "thumb") {
			const t = await getThumb(db, account.id, r.id)
			if (!t) throw new HttpError(404, "not_found", "This scene has no picture")
			res.statusCode = 200
			res.setHeader("Content-Type", t.type)
			res.setHeader("Content-Length", String(t.bytes.length))
			res.setHeader("Cache-Control", r.query.v && r.query.v === t.etag ? "private, max-age=31536000, immutable" : "private, no-cache")
			res.setHeader("ETag", `"${t.etag}"`)
			res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
			res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
			res.setHeader("X-Content-Type-Options", "nosniff")
			res.setHeader("Content-Disposition", "inline")
			res.end(t.bytes)
			return done(200)
		}

		// ---- /api/scenes/:id/restore
		if (r.part === "restore") {
			await countWrite(db, account.id, lim)
			const meta = await restoreScene(db, account.id, r.id, lim)
			if (!meta) throw new HttpError(404, "not_found", "That scene can't be brought back any more (deleted more than 30 days ago, or removed to make room)")
			send(res, 200, { ok: true, scene: meta })
			return done(200)
		}

		// ---- /api/scenes/:id
		if (method === "GET") {
			const got = await getScene(db, account.id, r.id)
			if (!got) throw new HttpError(404, "not_found", "No such scene in your account")
			send(res, 200, { ok: true, scene: got.meta, data: JSON.parse(got.text) }, { ETag: `"v${got.meta.version}"` })
			return done(200)
		}
		if (method === "DELETE") {
			await countWrite(db, account.id, lim)
			const until = await deleteScene(db, account.id, r.id)
			if (!until) throw new HttpError(404, "not_found", "No such scene in your account")
			send(res, 200, { ok: true, deleted: r.id, restoreUntil: until })
			return done(200)
		}
		// PUT
		const body = await readJson(req, MAX_BODY)
		onlyKeys(body, ["name", "scene", "thumb", "savedAs"])
		if (body.name === undefined && body.scene === undefined && body.thumb === undefined && body.savedAs === undefined) throw new HttpError(400, "bad_input", "nothing to change (name, scene, thumb or savedAs)")
		const ifMatch = ifMatchOf(req)
		const cur = await getScene(db, account.id, r.id)
		if (!cur) throw new HttpError(404, "not_found", "No such scene in your account")
		if (ifMatch !== null && ifMatch !== cur.meta.version) throw new HttpError(412, "conflict", "This scene was changed somewhere else since it was opened", { current: cur.meta })
		const patch = {}
		if (body.name !== undefined || body.scene !== undefined) {
			const name = body.name !== undefined ? normName(body.name) : cur.meta.name
			const s = body.scene !== undefined ? await cleaned(body.scene) : JSON.parse(cur.text)
			const { text, items } = sceneText(s, r.id, name)
			Object.assign(patch, { name, text, items })
		}
		if (body.thumb !== undefined) patch.thumb = body.thumb === null ? null : parseThumb(body.thumb)
		if (body.savedAs !== undefined) patch.savedAs = normSavedAs(body.savedAs)
		await countWrite(db, account.id, lim)
		const meta = await updateScene(db, account.id, r.id, patch, ifMatch, lim, cur)
		if (!meta) throw new HttpError(404, "not_found", "No such scene in your account")
		send(res, 200, { ok: true, scene: meta })
		return done(200)
	} catch (e) {
		const h = e instanceof HttpError ? e : null
		if (!h) logLine({ event: "error", error: String(e?.message ?? e).slice(0, 160) })
		const err = h ?? new HttpError(500, "internal", "Something went wrong with your scenes. Try again.", { retryable: true })
		if (!res.writableEnded) failWith(res, err)
		return done(err.status)
	}
}

export default function handler(req, res) {
	return handle(req, res)
}
