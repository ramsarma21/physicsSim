// The database: Neon Postgres over HTTP (@neondatabase/serverless, exact pin in package.json), created on first use (never at import, so a
// deployment without DATABASE_URL loads fine), with the schema made by the function itself the first time (idempotent DDL guarded by
// schema_version: the owner never runs SQL). Every query is parameterized; every error is replaced by a plain 503 before it is answered or
// logged, so a connection string or a query never leaves. Tests hand in any {query(text, params) -> rows, batch(texts)} (PGlite: an in-process
// Postgres). docs/ACCOUNTS.md §3.
import { HttpError, logLine, scrubSecrets } from "./http.mjs"

export const SCHEMA_VERSION = 2 // 2: scenes.saved_as (the app's Save links a scene to its scenario), the deleted-scenes index
const QUERY_TIMEOUT_MS = 10000 // (a database asleep after 5 idle minutes wakes in about a second)

export const DDL = [
	`create table if not exists accounts (
		id text primary key,
		email text,
		email_verified boolean not null default false,
		name text,
		created_at timestamptz not null default now(),
		last_seen_at timestamptz not null default now(),
		ai_usd_per_day numeric(8,2),
		disabled boolean not null default false
	)`,
	`create unique index if not exists accounts_email on accounts (email) where email_verified`,
	`create table if not exists identities (
		iss text not null,
		sub text not null,
		account_id text not null references accounts(id) on delete cascade,
		created_at timestamptz not null default now(),
		primary key (iss, sub)
	)`,
	`create index if not exists identities_account on identities (account_id)`,
	`create table if not exists scenes (
		id text primary key,
		owner_id text not null references accounts(id) on delete cascade,
		name text not null,
		scene json not null,
		scene_bytes integer not null,
		item_count integer not null,
		thumb bytea,
		thumb_type text check (thumb_type in ('image/webp', 'image/jpeg', 'image/png')),
		thumb_etag text,
		version integer not null default 1,
		created_at timestamptz not null default now(),
		updated_at timestamptz not null default now(),
		deleted_at timestamptz
	)`,
	`create index if not exists scenes_owner_recent on scenes (owner_id, updated_at desc) where deleted_at is null`,
	`alter table scenes add column if not exists saved_as text`,
	`create index if not exists scenes_owner_deleted on scenes (owner_id, deleted_at) where deleted_at is not null`,
	`create table if not exists counters (
		key text not null,
		bucket text not null,
		n integer not null default 0,
		usd numeric(10,4) not null default 0,
		primary key (key, bucket)
	)`,
	`create table if not exists schema_version (v integer primary key)`,
	`insert into schema_version (v) values (${SCHEMA_VERSION}) on conflict do nothing`,
]

/** 503: the database could not be reached or refused (the words never name a host, a query or a connection string). */
export class DbUnavailable extends HttpError {
	constructor() {
		super(503, "unavailable", "Your scenes can't be reached right now. Try again in a moment.", { retryable: true }, { "Retry-After": "2" })
	}
}

export const databaseUrl = (env = process.env) => (env.DATABASE_URL || env.POSTGRES_URL || "").trim() || null
export const dbConfigured = (env = process.env) => !!databaseUrl(env)

let injected = null // (tests) an adapter used instead of Neon
let client = null // {url, adapter}
let ready = null // the schema check, once per instance

/** (tests) use this {query, batch} instead of Neon; null goes back to Neon. */
export function setDatabase(adapter) {
	injected = adapter
	client = null
	ready = null
}

async function neonAdapter(url) {
	const { neon } = await import("@neondatabase/serverless")
	const sql = neon(url)
	return {
		query: (text, params = []) => sql.query(text, params, { fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) } }),
		batch: (texts) => sql.transaction(texts.map((t) => sql.query(t, [])), { fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS * 2) } }),
	}
}

/** What a database error is called in the log: its SQLSTATE and a scrubbed first line (never the query's values). */
const described = (e) => ({ sqlstate: typeof e?.code === "string" ? e.code : undefined, error: scrubSecrets(String(e?.message ?? e).split("\n")[0]).slice(0, 160) })

async function ensureSchema(a) {
	const version = async () => {
		try {
			const rows = await a.query("select coalesce(max(v), 0)::int as v from schema_version", [])
			return rows[0]?.v ?? 0
		} catch (e) {
			if (e?.code === "42P01") return 0 // (no schema_version yet: a new database)
			throw e
		}
	}
	if ((await version()) >= SCHEMA_VERSION) return
	try {
		await a.batch(DDL)
	} catch (e) {
		// two cold instances making the tables at once: one of them loses a race in the catalog; the other's tables are there a moment later
		await new Promise((r) => setTimeout(r, 300))
		if ((await version()) < SCHEMA_VERSION) throw e
	}
	logLine({ event: "schema", version: SCHEMA_VERSION })
}

/** The database ({query(text, params) -> rows}), with its schema in place. Throws HttpError 503 (not_configured / unavailable). */
export async function getDb(env = process.env) {
	let a = injected
	if (!a) {
		const url = databaseUrl(env)
		if (!url) throw new HttpError(503, "not_configured", "Saving to an account is not switched on for this deployment (no database)")
		if (!client || client.url !== url) {
			try {
				client = { url, adapter: await neonAdapter(url) }
			} catch (e) {
				logLine({ event: "db_client", ...described(e) })
				throw new DbUnavailable()
			}
			ready = null
		}
		a = client.adapter
	}
	ready ??= ensureSchema(a).catch((e) => {
		ready = null
		logLine({ event: "db_schema", ...described(e) })
		throw new DbUnavailable()
	})
	await ready
	return {
		async query(text, params = []) {
			try {
				return await a.query(text, params)
			} catch (e) {
				logLine({ event: "db_query", ...described(e) })
				throw new DbUnavailable()
			}
		},
	}
}
