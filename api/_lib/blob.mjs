// Vercel Blob for the video functions (api/videos/*), spoken over its HTTP API directly (x-api-version 12, what @vercel/blob 2.8 speaks), so
// the functions carry no SDK and its 30 dependencies. The read-write token (BLOB_READ_WRITE_TOKEN, which the Blob integration sets) never
// leaves the server: callers get a CLIENT token per file, an HMAC of one exact pathname, a size cap, a content type and an expiry signed with
// the read-write token (the same format as @vercel/blob/client's generateClientTokenFromReadWriteToken), which the Blob API checks before it
// stores anything. Every failure becomes a plain 503 with no token, URL or answer text in it. docs/DEPLOY.md "Video gallery".
// Reads go to the store's public URLs (readPublicBlob: only that origin).
//   VIDEO_BLOB_API_URL (tests: a mock Blob API on 127.0.0.1) replaces https://vercel.com/api/blob.
import { createHmac } from "node:crypto"
import { HttpError, logLine } from "./http.mjs"

export const BLOB_API_VERSION = "12"
const DEFAULT_API = "https://vercel.com/api/blob"
const TIMEOUT_MS = 15000
const RW_RE = /^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9]+$/

/** The read-write token, or null when the store is not connected (or the value is not one). */
export function rwToken(env = process.env) {
	const t = String(env.BLOB_READ_WRITE_TOKEN ?? "").trim()
	return RW_RE.test(t) ? t : null
}
export const blobConfigured = (env = process.env) => !!rwToken(env)
/** The store's id (part of every public URL; not a secret). */
export const storeIdOf = (token) => RW_RE.exec(token)?.[1] ?? null
export const apiUrl = (env = process.env) => String(env.VIDEO_BLOB_API_URL || DEFAULT_API).replace(/\/+$/, "")
/** Where a public blob is served: https://<store>.public.blob.vercel-storage.com/<pathname> */
export function publicUrl(pathname, env = process.env) {
	const id = storeIdOf(rwToken(env) ?? "")
	if (!id) throw new HttpError(503, "not_configured", "the video store is not connected to this deployment")
	return `https://${id.toLowerCase()}.public.blob.vercel-storage.com/${pathname}`
}

/**
 * A client token for exactly one pathname: {pathname, maximumSizeInBytes, allowedContentTypes, validUntil (ms), addRandomSuffix, allowOverwrite,
 * cacheControlMaxAge?}. Format: vercel_blob_client_<store>_<base64("<hex HMAC-SHA256(rw, payload)>.<payload>")>, payload = base64(JSON).
 */
export function clientToken(opts, env = process.env) {
	const rw = rwToken(env)
	if (!rw) throw new HttpError(503, "not_configured", "the video store is not connected to this deployment")
	const payload = Buffer.from(JSON.stringify(opts)).toString("base64")
	const mac = createHmac("sha256", rw).update(payload).digest("hex")
	return `vercel_blob_client_${storeIdOf(rw)}_${Buffer.from(`${mac}.${payload}`).toString("base64")}`
}
/** (tests) the payload of a client token, after checking its HMAC against this read-write token; null when it does not verify. */
export function clientTokenPayload(token, rw) {
	const m = /^vercel_blob_client_([A-Za-z0-9]+)_(.+)$/.exec(String(token ?? ""))
	if (!m || m[1] !== storeIdOf(rw)) return null
	const [mac, payload] = Buffer.from(m[2], "base64").toString("utf8").split(".")
	if (!mac || !payload || createHmac("sha256", rw).update(payload).digest("hex") !== mac) return null
	try {
		return JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
	} catch {
		return null
	}
}

/** How a caller uploads one file with its client token: a single PUT of the bytes, no SDK needed (what @vercel/blob/client's put() sends). */
export function uploadRequest(pathname, token, contentType, env = process.env) {
	return {
		method: "PUT",
		url: `${apiUrl(env)}/?${new URLSearchParams({ pathname })}`,
		headers: { authorization: `Bearer ${token}`, "x-api-version": BLOB_API_VERSION, "x-vercel-blob-access": "public", "x-content-type": contentType },
	}
}

const unavailable = () => new HttpError(503, "unavailable", "The video store can't be reached right now. Try again in a moment.", { retryable: true }, { "Retry-After": "2" })

async function request(pathAndQuery, init, env) {
	const rw = rwToken(env)
	if (!rw) throw new HttpError(503, "not_configured", "the video store is not connected to this deployment")
	let r
	try {
		r = await fetch(`${apiUrl(env)}${pathAndQuery}`, {
			...init,
			headers: { authorization: `Bearer ${rw}`, "x-api-version": BLOB_API_VERSION, "x-vercel-blob-store-id": storeIdOf(rw), ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
	} catch (e) {
		logLine({ event: "blob_fetch", error: String(e?.name ?? "error") })
		throw unavailable()
	}
	return r
}
async function errorCode(r) {
	try {
		return (await r.json())?.error?.code ?? "unknown_error"
	} catch {
		return "unknown_error"
	}
}

/** {url, pathname, size, contentType, uploadedAt, etag} of a stored blob, or null when there is none. */
export async function headBlob(pathname, env = process.env) {
	const r = await request(`/?${new URLSearchParams({ url: pathname })}`, { method: "GET" }, env)
	if (r.status === 404) return null
	if (!r.ok) {
		const code = await errorCode(r)
		if (code === "not_found") return null
		logLine({ event: "blob_head", status: r.status, code })
		throw unavailable()
	}
	const j = await r.json()
	return { url: String(j.url ?? ""), pathname: String(j.pathname ?? pathname), size: Number(j.size) || 0, contentType: String(j.contentType ?? ""), uploadedAt: j.uploadedAt ? String(j.uploadedAt) : null, etag: j.etag ? String(j.etag) : null }
}

/**
 * The bytes of a public blob of this store, read from its public URL (the gallery serves a job's report and captions from them, since Blob
 * hands HTML out as a download). Only this store's public origin is fetched; more than maxBytes, or any failure: a plain 503.
 * -> {body: Buffer, contentType}, or null when the store has no such blob.
 */
export async function readPublicBlob(url, { maxBytes }, env = process.env) {
	const origin = new URL(publicUrl("x", env)).origin
	let u
	try {
		u = new URL(String(url))
	} catch {
		throw unavailable()
	}
	if (u.origin !== origin || u.username || u.password) throw unavailable()
	let r
	try {
		r = await fetch(u.href, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" })
	} catch (e) {
		logLine({ event: "blob_read", error: String(e?.name ?? "error") })
		throw unavailable()
	}
	if (r.status === 404) return null
	const len = Number(r.headers.get("content-length"))
	if (!r.ok || (Number.isFinite(len) && len > maxBytes)) {
		logLine({ event: "blob_read", status: r.status, big: len > maxBytes })
		await r.body?.cancel().catch(() => {})
		throw unavailable()
	}
	const chunks = []
	let n = 0
	for await (const c of r.body ?? []) {
		n += c.length
		if (n > maxBytes) {
			logLine({ event: "blob_read", big: true })
			throw unavailable()
		}
		chunks.push(Buffer.from(c))
	}
	return { body: Buffer.concat(chunks), contentType: String(r.headers.get("content-type") ?? "") }
}

/** Stores (and overwrites) a public blob at exactly this pathname. -> {url, pathname, contentType, etag} */
export async function putBlob(pathname, body, { contentType, cacheControlMaxAge } = {}, env = process.env) {
	const headers = { "x-vercel-blob-access": "public", "x-add-random-suffix": "0", "x-allow-overwrite": "1" }
	if (contentType) headers["x-content-type"] = contentType
	if (cacheControlMaxAge !== undefined) headers["x-cache-control-max-age"] = String(cacheControlMaxAge)
	const r = await request(`/?${new URLSearchParams({ pathname })}`, { method: "PUT", body, headers }, env)
	if (!r.ok) {
		logLine({ event: "blob_put", status: r.status, code: await errorCode(r) })
		throw unavailable()
	}
	const j = await r.json()
	return { url: String(j.url ?? ""), pathname: String(j.pathname ?? pathname), contentType: String(j.contentType ?? contentType ?? ""), etag: j.etag ? String(j.etag) : null }
}
