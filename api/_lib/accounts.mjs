// Who a verified token belongs to: identities (a Clerk user in one Clerk instance: iss + sub) point at our own accounts. A new person gets an
// account the first time they call (their name and verified email come from Clerk's Backend API once); a person who already has an account
// under the same Google-verified email (signed in on the development instance, now on production) is linked to it, so their scenes follow
// them. docs/ACCOUNTS.md §3.1.
import { randomBytes } from "node:crypto"
import { HttpError, logLine } from "./http.mjs"
import { clerkSettings } from "./auth.mjs"

const API = "https://api.clerk.com/v1"
const API_TIMEOUT_MS = 3000
const SEEN_EVERY_MS = 3600_000
const EMAIL_RETRY_MS = 10 * 60_000

const B32 = "abcdefghijklmnopqrstuvwxyz234567"
/** prefix + 16 base32 characters (80 random bits) */
export function newId(prefix) {
	const b = randomBytes(10)
	let bits = 0
	let value = 0
	let out = ""
	for (const byte of b) {
		value = (value << 8) | byte
		bits += 8
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31]
			bits -= 5
		}
	}
	return `${prefix}_${out}`
}

const ACCOUNT_COLS = "a.id, a.email, a.email_verified, a.name, a.disabled, a.ai_usd_per_day::float8 as ai_usd_per_day, (extract(epoch from a.last_seen_at) * 1000)::float8 as last_seen_ms, (extract(epoch from a.created_at) * 1000)::float8 as created_ms"

/** {email, emailVerified, name} of a Clerk user from the Backend API, or null when it can't be had (no secret key, no answer). */
export async function clerkUser(sub, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
	const s = clerkSettings(env)
	if (!s?.secretKey) return null
	try {
		const r = await fetchImpl(`${API}/users/${encodeURIComponent(sub)}`, { headers: { Authorization: `Bearer ${s.secretKey}`, accept: "application/json" }, signal: AbortSignal.timeout(API_TIMEOUT_MS) })
		if (!r.ok) {
			logLine({ event: "clerk_user", status: r.status })
			return null
		}
		const u = await r.json()
		const primary = (u.email_addresses ?? []).find((e) => e.id === u.primary_email_address_id) ?? (u.email_addresses ?? [])[0]
		const email = typeof primary?.email_address === "string" ? primary.email_address.trim().toLowerCase().slice(0, 254) : null
		const name = [u.first_name, u.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim().slice(0, 80) || null
		return { email, emailVerified: !!email && primary?.verification?.status === "verified", name }
	} catch {
		logLine({ event: "clerk_user", status: "no answer" })
		return null
	}
}

/** Deletes the Clerk user (account deletion). true when Clerk says it's gone (or it was already). */
export async function deleteClerkUser(sub, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
	const s = clerkSettings(env)
	if (!s?.secretKey) return false
	try {
		const r = await fetchImpl(`${API}/users/${encodeURIComponent(sub)}`, { method: "DELETE", headers: { Authorization: `Bearer ${s.secretKey}` }, signal: AbortSignal.timeout(API_TIMEOUT_MS) })
		return r.ok || r.status === 404
	} catch {
		return false
	}
}

const emailTried = new Map() // account id -> when this instance last asked Clerk for a missing email

/** The account of a verified token ({iss, sub}), made on the first call. -> {id, email, emailVerified, name, disabled, aiUsdPerDay, isNew} */
export async function accountFor(db, who, deps = {}) {
	const byIdentity = async () => (await db.query(`select ${ACCOUNT_COLS} from identities i join accounts a on a.id = i.account_id where i.iss = $1 and i.sub = $2`, [who.iss, who.sub]))[0] ?? null
	let row = await byIdentity()
	let isNew = false
	if (row) {
		const now = Date.now()
		if (now - row.last_seen_ms > SEEN_EVERY_MS) await db.query("update accounts set last_seen_at = now() where id = $1", [row.id])
		if (!row.email && now - (emailTried.get(row.id) ?? 0) > EMAIL_RETRY_MS) {
			emailTried.set(row.id, now)
			const u = await clerkUser(who.sub, deps)
			if (u?.email) {
				// (a verified email another account already holds stays unverified here: linking happens only for new identities)
				await db.query(
					"update accounts set email = $2, email_verified = $3 and not exists (select 1 from accounts b where b.email = $2 and b.email_verified and b.id <> $1), name = coalesce(name, $4) where id = $1 and email is null",
					[row.id, u.email, u.emailVerified, u.name]
				)
				row = await byIdentity()
			}
		}
	} else {
		const u = await clerkUser(who.sub, deps)
		let accountId = null
		if (u?.email && u.emailVerified) accountId = (await db.query("select id from accounts where email = $1 and email_verified", [u.email]))[0]?.id ?? null
		let made = null
		if (!accountId) {
			made = newId("u")
			const ins = await db.query("insert into accounts (id, email, email_verified, name) values ($1, $2, $3, $4) on conflict do nothing returning id", [made, u?.email ?? null, !!u?.emailVerified, u?.name ?? null])
			if (ins.length) accountId = made
			else {
				made = null // (the same verified email was just taken by a sign-in at the same moment: link to that account)
				accountId = (await db.query("select id from accounts where email = $1 and email_verified", [u?.email ?? ""]))[0]?.id ?? null
				if (!accountId) throw new HttpError(503, "unavailable", "Your account couldn't be set up just now. Try again.", { retryable: true })
			}
		}
		await db.query("insert into identities (iss, sub, account_id) values ($1, $2, $3) on conflict do nothing", [who.iss, who.sub, accountId])
		row = await byIdentity()
		if (made && row?.id !== made) await db.query("delete from accounts a where a.id = $1 and not exists (select 1 from identities i where i.account_id = a.id)", [made]) // (lost a race to a twin first call)
		if (!row) throw new HttpError(503, "unavailable", "Your account couldn't be set up just now. Try again.", { retryable: true })
		isNew = row.id === made
		logLine({ event: isNew ? "account_new" : "identity_linked", account: row.id.slice(0, 6) })
	}
	return { id: row.id, email: row.email, emailVerified: !!row.email_verified, name: row.name, disabled: !!row.disabled, aiUsdPerDay: row.ai_usd_per_day, createdMs: row.created_ms, isNew }
}
