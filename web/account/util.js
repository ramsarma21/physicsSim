// Small shared pieces of web/account/ ("My scenes" and the account chip): the page's ?profile, the app's localStorage key scheme, a DOM
// builder, icons, dates in words, ids, and the scene file download. Nothing here touches the app's state.

export const PARAMS = new URLSearchParams(location.search)
/** ?profile=<name> keeps a tab's state apart (the app's own rule, web/app.js): My scenes keeps a separate library per profile too. */
export const PROFILE = PARAMS.get("profile") || null
/** The app's key scheme: nsKey("project") → "sandbox:project", or "sandbox@<profile>:project". */
export const nsKey = (k) => (PROFILE ? `sandbox@${PROFILE}:${k}` : `sandbox:${k}`)
export const prefs = {
	get(k) {
		try {
			return JSON.parse(localStorage.getItem(nsKey(k)))
		} catch {
			return null
		}
	},
	set(k, v) {
		try {
			localStorage.setItem(nsKey(k), JSON.stringify(v))
		} catch {}
	},
	del(k) {
		try {
			localStorage.removeItem(nsKey(k))
		} catch {}
	}
}
/** This machine (the local Python server, or the static preview): no accounts are ever looked for here. */
export const LOCAL_HOST = /^((.+\.)?localhost|127(\.\d+){3}|\[::1\])$/i.test(location.hostname)
export const MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "")

export const reduceMotion = () => {
	try {
		return matchMedia("(prefers-reduced-motion: reduce)").matches
	} catch {
		return false
	}
}
export const coarse = () => {
	try {
		return matchMedia("(hover: none)").matches
	} catch {
		return false
	}
}

/** h("div", {class, text, html, on: {click}, ...attributes}, ...children) */
export function h(tag, attrs = {}, ...kids) {
	const e = document.createElement(tag)
	for (const [k, v] of Object.entries(attrs ?? {})) {
		if (v == null || v === false) continue
		if (k === "class") e.className = v
		else if (k === "text") e.textContent = v
		else if (k === "html") e.innerHTML = v
		else if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f)
		else e.setAttribute(k, v === true ? "" : v)
	}
	for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)))
	return e
}
export const icon = (name, cls = "") => h("span", { class: cls ? `acct-ic ${cls}` : "acct-ic", "aria-hidden": "true", html: ICONS[name] })

export const ICONS = {
	scenes: `<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2 0v4h4V5zm8 0a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zm2 0v4h2V5zM4 15a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2 0v4h2v-4zm8 0a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zm2 0v4h2v-4z"/></svg>`,
	close: `<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>`,
	search: `<svg viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>`,
	more: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
	open: `<svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>`,
	edit: `<svg viewBox="0 0 24 24"><path d="M4 16.5V20h3.5L18 9.5 14.5 6zM20.7 6.8a1 1 0 0 0 0-1.4l-2.1-2.1a1 1 0 0 0-1.4 0l-1.6 1.6 3.5 3.5z"/></svg>`,
	copy: `<svg viewBox="0 0 24 24"><path d="M16 1H6a2 2 0 0 0-2 2v13h2V3h10zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16h-9V7h9z"/></svg>`,
	down: `<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>`,
	trash: `<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zm4 2v8h1.5v-8zm2.5 0v8H14v-8z"/></svg>`,
	plus: `<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`,
	check: `<svg viewBox="0 0 24 24"><path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>`,
	cloud: `<svg viewBox="0 0 24 24"><path d="M6.5 19A5.5 5.5 0 0 1 5.6 8.07 7 7 0 0 1 19 9.5a4.75 4.75 0 0 1-.5 9.5zm0-2h12a2.75 2.75 0 0 0 .2-5.49L17 11.4l-.05-1.7a5 5 0 0 0-9.63-1.53l-.33.83-.88.1A3.5 3.5 0 0 0 6.5 17z"/></svg>`,
	device: `<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5v2h4v2H7v-2h4v-2H6a2 2 0 0 1-2-2zm2 0v10h12V5z"/></svg>`,
	signout: `<svg viewBox="0 0 24 24"><path d="M5 3h8v2H5v14h8v2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm11.6 4.6L21 12l-4.4 4.4-1.4-1.4 2-2H9v-2h8.2l-2-2z"/></svg>`,
	warn: `<svg viewBox="0 0 24 24"><path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z"/></svg>`,
	upload: `<svg viewBox="0 0 24 24"><path d="M6.5 20A5.5 5.5 0 0 1 5.6 9.07 7 7 0 0 1 19 10.5a4.75 4.75 0 0 1-.5 9.5H13v-5.17l1.6 1.58L16 15l-4-4-4 4 1.4 1.4 1.6-1.57V20z"/></svg>`,
	ai: `<svg viewBox="0 0 24 24"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".75"/></svg>`,
	google: `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"/></svg>`
}

// ---------------------------------------------------------------- words
const MIN = 60e3
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** "just now", "4 min ago", "3 h ago", "yesterday", "Monday", "3 Oct", "3 Oct 2025" */
export function ago(ms, now = Date.now()) {
	if (!Number.isFinite(ms)) return ""
	const d = now - ms
	if (d < 45e3) return "just now"
	if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} min ago`
	const then = new Date(ms)
	const today = new Date(now)
	today.setHours(0, 0, 0, 0)
	if (ms >= today.getTime()) return `${Math.round(d / HOUR) || 1} h ago`
	if (ms >= today.getTime() - DAY) return "yesterday"
	if (ms >= today.getTime() - 6 * DAY) return then.toLocaleDateString(undefined, { weekday: "long" })
	const sameYear = then.getFullYear() === new Date(now).getFullYear()
	return then.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })
}
/** the full date and time, for a tooltip */
export const when = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "")
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The things on the table: every item but the table itself and the invisible walls (the app's own rule for "has something on it"). */
export const thingsIn = (scene) => (Array.isArray(scene?.items) ? scene.items.filter((i) => i && i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d)).length : 0)
/** A scene's name as a library card shows it: the app's "Empty table" (what Blank and Clear call the scene) is not a name for a scene with things on it. */
export function nameFor(scene) {
	const n = String(scene?.name ?? "").trim()
	return !n || (n === "Empty table" && thingsIn(scene) > 0) ? "Untitled scene" : n.slice(0, 80)
}
/** The name rule of My scenes, the same as the server's (api/_lib/scenes.mjs normName): letters, digits, spaces and ordinary punctuation
 *  (_ - ' ’ . , : ; ( ) & ! ? + #); spaces collapsed, trimmed, 60 characters at most; no letter or digit at all is no name (""). Names are
 *  only ever shown as text. */
const NAME_DROP = /[^\p{L}\p{N}_\-'\u2019.,:;()&!?+# ]/gu
export const cleanName = (s) => {
	const t = [...String(s ?? "").replace(/\s+/g, " ").replace(NAME_DROP, "").replace(/ {2,}/g, " ").trim()].slice(0, 60).join("").trim()
	return /[\p{L}\p{N}]/u.test(t) ? t : ""
}
/** For search: lower case, no accents. */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/** "l_" + 16 base32 letters (80 random bits) */
export function newId(prefix = "l_") {
	const a = "abcdefghijklmnopqrstuvwxyz234567"
	const b = new Uint8Array(16)
	crypto.getRandomValues(b)
	return prefix + [...b].map((x) => a[x & 31]).join("")
}

/** Download a scene as <name>.json, exactly as the app's Export does (web/app.js exportScene). */
export function downloadScene(scene, name = scene?.name) {
	const file = (String(name || "").replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().replace(/\s+/g, "-").toLowerCase() || "scene") + ".json"
	const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(scene, null, 1)], { type: "application/json" })), download: file })
	document.body.append(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(a.href), 10000)
	return file
}

/** A textual element owns the keyboard (the app's rule): shortcuts stay out of its way. */
const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"])
export function isTextual(el) {
	const tag = el?.tagName
	return !!el && (el.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !NOT_TEXT.has((el.type || "").toLowerCase())))
}
