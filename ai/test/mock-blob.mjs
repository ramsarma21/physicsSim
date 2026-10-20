// A Vercel Blob API on 127.0.0.1 for the video functions' tests (api/_lib/blob.mjs talks to it through VIDEO_BLOB_API_URL). It answers what
// the real API answered in a probe of the real store on 2026-10-19 (scratch prefix, deleted after): PUT /?pathname= with the read-write token
// or a client token, whose HMAC, pathname, expiry, size cap, content types and overwrite rule it checks itself (not with the code under test),
// with the real API's refusals ("pathname" ... does not match the token payload, Token expired, the file length cannot be greater than N bytes,
// "contentType" X is not allowed, This blob already exists); GET /?url= (head) for the read-write token only.
import { createHmac, createHash, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"

export async function startMockBlob({ rwToken }) {
	const storeId = rwToken.split("_")[3]
	const store = new Map() // pathname -> {body: Buffer, contentType, uploadedAt, etag, cacheControlMaxAge, writes}
	const requests = []
	const urlOf = (pathname) => `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com/${pathname}`
	const answer = (res, status, obj) => {
		res.writeHead(status, { "content-type": "application/json" })
		res.end(JSON.stringify(obj))
	}
	const err = (res, status, code, message) => answer(res, status, { error: { code, message } })
	/** the client token's payload, when its HMAC holds for this store's read-write token */
	function clientPayload(token) {
		const m = /^vercel_blob_client_([A-Za-z0-9]+)_(.+)$/.exec(token)
		if (!m || m[1] !== storeId) return null
		const raw = Buffer.from(m[2], "base64").toString("utf8")
		const dot = raw.indexOf(".")
		if (dot < 0) return null
		const mac = Buffer.from(raw.slice(0, dot))
		const payload = raw.slice(dot + 1)
		const want = Buffer.from(createHmac("sha256", rwToken).update(payload).digest("hex"))
		if (mac.length !== want.length || !timingSafeEqual(mac, want)) return null
		try {
			return JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
		} catch {
			return null
		}
	}
	const server = createServer(async (req, res) => {
		const chunks = []
		for await (const c of req) chunks.push(c)
		const body = Buffer.concat(chunks)
		const u = new URL(req.url, "http://x")
		const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/, "")
		const rec = { method: req.method, path: u.pathname, pathname: u.searchParams.get("pathname"), url: u.searchParams.get("url"), kind: auth === rwToken ? "rw" : auth.startsWith("vercel_blob_client_") ? "client" : "none", bytes: body.length, headers: { ...req.headers } }
		requests.push(rec)
		if (req.headers["x-api-version"] !== "12") return err(res, 400, "bad_request", "unknown API version")
		if (req.method === "PUT" && u.pathname === "/") {
			const pathname = u.searchParams.get("pathname") ?? ""
			let opts
			const type = String(req.headers["x-content-type"] ?? "application/octet-stream")
			if (rec.kind === "rw") {
				opts = { allowOverwrite: req.headers["x-allow-overwrite"] === "1", cacheControlMaxAge: req.headers["x-cache-control-max-age"] ? Number(req.headers["x-cache-control-max-age"]) : 2592000 }
			} else if (rec.kind === "client") {
				const p = clientPayload(auth)
				if (!p) return err(res, 400, "bad_request", "Invalid client token")
				if (p.pathname !== pathname) return err(res, 403, "forbidden", `"pathname" ${pathname} does not match the token payload`)
				if (!(p.validUntil > Date.now())) return err(res, 403, "forbidden", "Token expired")
				if (p.maximumSizeInBytes !== undefined && body.length > p.maximumSizeInBytes) return err(res, 403, "forbidden", `the file length cannot be greater than ${p.maximumSizeInBytes} bytes`)
				if (p.allowedContentTypes?.length && !p.allowedContentTypes.includes(type) && !p.allowedContentTypes.includes(`${type.split("/")[0]}/*`)) return err(res, 403, "forbidden", `"contentType" ${type} is not allowed`)
				opts = { allowOverwrite: p.allowOverwrite === true, cacheControlMaxAge: p.cacheControlMaxAge ?? 2592000 }
			} else return err(res, 403, "forbidden", "Access denied, please provide a valid token for this resource.")
			const old = store.get(pathname)
			if (old && !opts.allowOverwrite) return err(res, 400, "bad_request", "This blob already exists, use `allowOverwrite: true` if you want to overwrite it.")
			const etag = `"${createHash("md5").update(body).digest("hex")}"`
			store.set(pathname, { body, contentType: type, uploadedAt: new Date().toISOString(), etag, cacheControlMaxAge: opts.cacheControlMaxAge, writes: (old?.writes ?? 0) + 1 })
			return answer(res, 200, { url: urlOf(pathname), downloadUrl: `${urlOf(pathname)}?download=1`, pathname, contentType: type, contentDisposition: `inline; filename="${pathname.split("/").pop()}"`, etag })
		}
		if (req.method === "GET" && u.pathname === "/" && u.searchParams.has("url")) {
			if (rec.kind !== "rw") return err(res, 403, "forbidden", "Access denied, please provide a valid token for this resource.")
			let pathname = u.searchParams.get("url")
			if (/^https?:\/\//.test(pathname)) pathname = new URL(pathname).pathname.slice(1)
			const b = store.get(pathname)
			if (!b) return err(res, 404, "not_found", "The requested blob does not exist")
			return answer(res, 200, { url: urlOf(pathname), downloadUrl: `${urlOf(pathname)}?download=1`, pathname, size: b.body.length, contentType: b.contentType, contentDisposition: "inline", cacheControl: `public, max-age=${b.cacheControlMaxAge}`, uploadedAt: b.uploadedAt, etag: b.etag })
		}
		return err(res, 404, "not_found", "no such route")
	})
	await new Promise((r) => server.listen(0, "127.0.0.1", r))
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		store,
		requests,
		urlOf,
		text: (pathname) => store.get(pathname)?.body.toString("utf8") ?? null,
		close: () => new Promise((r) => server.close(r)),
	}
}
