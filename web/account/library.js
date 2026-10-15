// "My scenes": every scene this person made, as cards with their pictures. Search, sort, open, rename, duplicate, download and delete (with
// undo); an empty state that says how scenes get here; and, where accounts exist, sign-in and "copy this browser's scenes to my account".
//   const lib = createLibrary({ store, autosave, auth, toast, newScene })
//   lib.open()   lib.close()   lib.isOpen()
//   lib.renderRecent(el, done)   fills the New dialog's row: the 3 latest scenes and a way to all of them (done() closes New)
// Styles: ./account.css (.lib-*), on ui.css's dialog card (.ui-dialog, .ui-card, .ui-x) so it looks like the intro, help and New.
// Keyboard: arrows move between cards, Enter opens, F2 renames, Delete deletes (Undo in the bar that follows), / searches, Esc closes.
import { ago, cleanName, coarse, downloadScene, fold, h, icon, ICONS, plural, prefs, reduceMotion, when } from "./util.js"

const SORTS = [
	{ id: "recent", label: "Last edited", by: (a, b) => b.updatedAt - a.updatedAt },
	{ id: "name", label: "Name", by: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || b.updatedAt - a.updatedAt },
	{ id: "created", label: "Date created", by: (a, b) => b.createdAt - a.createdAt }
]
const SNACK_MS = 8000
const SKELETON_AFTER_MS = 140

export function createLibrary({ store, autosave, auth = null, toast = () => {}, newScene = () => {} }) {
	const S = {
		list: null, // metas, as last listed
		query: "",
		sort: SORTS.some((s) => s.id === prefs.get("library-sort")) ? prefs.get("library-sort") : "recent",
		loading: false,
		error: null,
		urls: new Map(), // "id:etag" -> object URL of the picture (released when the dialog closes)
		menu: null,
		renaming: null,
		flash: null, // an id to highlight once (a duplicate that just arrived)
		copying: null
	}
	let dlg = null
	let els = {}
	let io = null
	let cards = new Map() // id -> {sig, li}: the cards drawn, reused while their scene is unchanged
	let refreshTimer = 0

	// ---------------------------------------------------------------- the dialog
	function build() {
		dlg = h("dialog", { class: "ui-dialog lib-dialog", "aria-labelledby": "lib-title", "aria-describedby": "lib-where" })
		dlg.addEventListener("cancel", (e) => {
			e.preventDefault()
			if (S.menu) return closeMenu(true)
			if (S.renaming) return S.renaming.cancel()
			close()
		})
		dlg.addEventListener("click", (e) => e.target === dlg && close())
		// the page under the dialog must not see its keys (Space would play, ⌫ delete the selected part, / open the catalog)
		dlg.addEventListener("keydown", (e) => {
			e.stopPropagation()
			onKey(e)
		})
		const search = h("input", { type: "search", class: "lib-q", placeholder: "Search your scenes", "aria-label": "Search your scenes", autocomplete: "off", spellcheck: "false", enterkeyhint: "search" })
		search.addEventListener("input", () => {
			S.query = search.value
			render()
		})
		search.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown") {
				e.preventDefault()
				focusCard(0)
			} else if (e.key === "Enter") {
				e.preventDefault()
				focusCard(0)
			} else if (e.key === "Escape" && search.value) {
				e.preventDefault()
				e.stopPropagation()
				search.value = ""
				S.query = ""
				render()
			}
		})
		const sort = h("select", { class: "lib-sort", "aria-label": "Sort by", title: "Sort by" }, SORTS.map((s) => h("option", { value: s.id, text: s.label })))
		sort.value = S.sort
		sort.addEventListener("change", () => {
			S.sort = sort.value
			prefs.set("library-sort", S.sort)
			render()
		})
		const where = h("p", { class: "lib-where", id: "lib-where" })
		const grid = h("ul", { class: "lib-grid", role: "list", "aria-label": "Your scenes" })
		const empty = h("div", { class: "lib-empty", hidden: true })
		const banner = h("div", { class: "lib-banner", hidden: true })
		const foot = h("p", { class: "lib-foot", hidden: true })
		const snack = h("div", { class: "lib-snack", role: "status", "aria-live": "polite", hidden: true })
		const body = h("div", { class: "lib-body" }, banner, grid, empty, foot)
		const card = h(
			"div",
			{ class: "ui-card lib-card", tabindex: "-1" },
			h("button", { type: "button", class: "ui-x", "aria-label": "Close My scenes", title: "Close (Esc)", html: ICONS.close, on: { click: () => close() } }),
			h(
				"header",
				{ class: "lib-head" },
				h("div", { class: "lib-titles" }, h("span", { class: "lib-logo", html: ICONS.scenes, "aria-hidden": "true" }), h("div", {}, h("h2", { id: "lib-title", text: "My scenes" }), where)),
				h(
					"div",
					{ class: "lib-tools" },
					h("label", { class: "lib-search" }, icon("search", "lib-search-ic"), search),
					h("span", { class: "lib-sort-w" }, sort),
					h("button", { type: "button", class: "primary lib-new", title: "Start a new scene", on: { click: () => (close(), setTimeout(newScene, reduceMotion() ? 0 : 160)) } }, icon("plus"), h("span", { text: "New scene" }))
				)
			),
			body,
			snack
		)
		dlg.append(card)
		document.body.append(dlg)
		els = { card, search, sort, where, grid, empty, banner, foot, snack, body }
		io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) if (e.isIntersecting) loadThumb(e.target)
			},
			{ root: body, rootMargin: "240px 0px" }
		)
		store.onChange(() => {
			if (!dlg?.open) return
			clearTimeout(refreshTimer)
			refreshTimer = setTimeout(() => reload(), 150)
		})
		auth?.onChange(() => {
			S.list = null // (signed in or out: another library; skeleton cards until it is here)
			if (dlg?.open) reload({ skeleton: true })
		})
	}

	async function open() {
		if (!dlg) build()
		closeMenu()
		if (!dlg.open) {
			dlg.classList.remove("ui-closing")
			dlg.showModal()
		}
		els.search.value = S.query
		els.search.placeholder = matchMedia("(max-width: 640px)").matches ? "Search" : "Search your scenes"
		els.card.focus({ preventScroll: true })
		await reload({ skeleton: true })
		// the search, ready to type in (the empty library has none: its New scene button); on touch screens nothing, so no keyboard pops up
		if (!coarse() && dlg.open && (document.activeElement === els.card || document.activeElement === document.body)) (els.card.classList.contains("lib-none") ? els.empty.querySelector("button") : els.search)?.focus({ preventScroll: true })
	}
	function close() {
		if (!dlg?.open || dlg.classList.contains("ui-closing")) return
		closeMenu()
		S.renaming?.commit()
		hideSnack(true)
		const done = () => {
			dlg.classList.remove("ui-closing")
			dlg.close()
			for (const u of S.urls.values()) URL.revokeObjectURL(u)
			S.urls.clear()
			cards = new Map()
			io.disconnect()
			els.grid.replaceChildren()
			S.query = "" // (the next visit starts with every scene showing)
		}
		if (reduceMotion()) return done()
		dlg.classList.add("ui-closing")
		setTimeout(done, 150)
	}

	// ---------------------------------------------------------------- data
	async function reload({ skeleton = false } = {}) {
		S.loading = true
		S.error = null
		const t = skeleton && !S.list ? setTimeout(() => S.loading && renderSkeleton(), SKELETON_AFTER_MS) : 0
		try {
			await autosave.flush({ now: true }) // (the scene on the table, as it is now)
			S.list = await store.list()
		} catch (e) {
			S.error = e
		} finally {
			S.loading = false
			clearTimeout(t)
		}
		render()
	}
	const visible = () => {
		const q = fold(S.query.trim())
		const list = (S.list ?? []).filter((m) => !q || fold(m.name).includes(q))
		return list.sort(SORTS.find((s) => s.id === S.sort)?.by ?? SORTS[0].by)
	}

	// ---------------------------------------------------------------- drawing
	function renderSkeleton() {
		cards = new Map()
		els.grid.replaceChildren()
		els.grid.setAttribute("aria-busy", "true")
		for (let i = 0; i < 6; i++) els.grid.append(h("li", { class: "lib-item lib-skel", "aria-hidden": "true" }, h("div", { class: "lib-thumb" }), h("div", { class: "lib-skel-l" }), h("div", { class: "lib-skel-l short" })))
	}
	function render() {
		if (!dlg?.open) return
		if (S.renaming) return void (S.renderLater = true) // (not under a name being typed: once it is done)
		const focusedId = document.activeElement?.closest?.(".lib-item")?.dataset.id
		const scroll = els.body.scrollTop
		renderWhere()
		renderBanner()
		els.grid.removeAttribute("aria-busy")
		const all = S.list ?? []
		const list = visible()
		els.empty.hidden = true
		// (no search or sort over nothing; a dialog that fits its content until there are cards)
		els.card.classList.toggle("lib-none", !all.length)
		if (S.error && !S.list) return (els.grid.replaceChildren(), renderEmpty("error"))
		if (!all.length) return (els.grid.replaceChildren(), renderEmpty("none"))
		if (!list.length) return (els.grid.replaceChildren(), renderEmpty("search"))
		// a card that hasn't changed is kept as it is (its picture stays put: nothing flickers when another card changes)
		const now = Date.now()
		const keep = new Map()
		const lis = list.map((m) => {
			const sig = JSON.stringify([m.name, m.updatedAt, m.createdAt, m.items, m.thumb?.etag ?? m.thumb?.url ?? null, autosave.currentId === m.id])
			let c = cards.get(m.id)
			if (!c || c.sig !== sig) c = { sig, li: cardFor(m, now) }
			else c.li.querySelector("time").textContent = `Edited ${ago(m.updatedAt, now)}` // (the words for the time move on)
			keep.set(m.id, c)
			return c.li
		})
		cards = keep
		els.grid.replaceChildren(...lis)
		els.body.scrollTop = scroll
		if (focusedId) els.grid.querySelector(`.lib-item[data-id="${CSS.escape(focusedId)}"] .lib-open`)?.focus({ preventScroll: true })
		if (S.flash) {
			const el = els.grid.querySelector(`.lib-item[data-id="${CSS.escape(S.flash)}"]`)
			S.flash = null
			if (el) {
				el.classList.add("lib-flash")
				el.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" })
				setTimeout(() => el.classList.remove("lib-flash"), 1600)
			}
		}
	}
	function renderWhere() {
		const n = S.list?.length
		const cloud = store.kind === "cloud"
		const count = n == null ? "Loading…" : plural(n, "scene")
		const place = cloud ? `In your account${auth?.user?.email ? ` (${auth.user.email})` : ""}` : store.label
		els.where.replaceChildren(icon(cloud ? "cloud" : "device", "lib-where-ic"), h("span", { text: `${count} · ${place}` }))
		els.where.title = cloud ? "Kept in your account: open them on any device you sign in on" : store.persistent ? "Kept in this browser on this device" : "This browser isn’t keeping them: they last until this tab closes"
	}
	function renderEmpty(kind) {
		const e = els.empty
		e.hidden = false
		e.replaceChildren()
		if (kind === "search") {
			e.className = "lib-empty lib-empty-q"
			e.append(h("p", { class: "lib-empty-t", text: `No scenes match “${S.query.trim()}”` }), h("button", { type: "button", class: "ghost", text: "Clear search", on: { click: () => ((els.search.value = ""), (S.query = ""), render(), els.search.focus()) } }))
			return
		}
		if (kind === "error") {
			e.className = "lib-empty"
			e.append(h("span", { class: "lib-empty-art warn", html: ICONS.warn, "aria-hidden": "true" }), h("h3", { text: "Your scenes can’t be reached right now" }), h("p", { text: S.error?.message ?? "Try again in a moment." }), h("button", { type: "button", class: "ghost", text: "Try again", on: { click: () => reload({ skeleton: true }) } }))
			return
		}
		e.className = "lib-empty"
		e.append(
			h("div", { class: "lib-empty-art", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
			h("h3", { text: "No scenes yet" }),
			h("p", { text: "Everything you make is kept here as you work: no need to save. Build one with AI, start from an example, or start with an empty table." }),
			h("div", { class: "lib-empty-acts" }, h("button", { type: "button", class: "primary", on: { click: () => (close(), setTimeout(newScene, reduceMotion() ? 0 : 160)) } }, icon("plus"), "New scene"))
		)
	}
	let bannerSeq = 0
	function renderBanner() {
		if (S.copying) return // (the copy's progress stays on show until it is done)
		const b = els.banner
		bannerSeq++
		b.hidden = true
		b.replaceChildren()
		els.foot.hidden = true
		els.foot.replaceChildren()
		b.className = "lib-banner"
		if (store.kind === "local" && !store.persistent) {
			b.hidden = false
			b.classList.add("warn")
			b.append(icon("warn", "lib-banner-ic"), h("p", { text: "This browser isn’t keeping scenes (a private window?), so these last until this tab closes. Download the ones you want to keep." }))
			return
		}
		if (auth?.state === "signed-out") {
			b.hidden = false
			b.append(icon("cloud", "lib-banner-ic"), h("p", { text: "Sign in to keep your scenes in your account and open them on any device." }), googleButton("Sign in with Google"))
			return
		}
		if (store.kind === "cloud") offerCopy(b)
	}
	function googleButton(label) {
		return h("button", { type: "button", class: "acct-google", on: { click: () => signIn() } }, h("span", { class: "acct-g", html: ICONS.google, "aria-hidden": "true" }), h("span", { text: label }))
	}
	async function signIn() {
		try {
			await auth.signIn()
		} catch (e) {
			showSnack(`Couldn’t sign in: ${e.message}`)
		}
	}

	/** Signed in: this browser's scenes, offered once into the account (each copied scene is remembered, so it is never offered twice). */
	async function offerCopy(b) {
		const owner = store.owner
		const seq = bannerSeq
		const done = new Set(prefs.get(`copied@${owner}`) ?? [])
		let locals = []
		try {
			locals = (await store.local.list()).filter((m) => !done.has(m.id))
		} catch {}
		if (seq !== bannerSeq || S.copying) return // (drawn again meanwhile, or a copy is under way)
		if (!locals.length || store.owner !== owner) return
		if (prefs.get(`copy-dismissed@${owner}`)) {
			// "Not now" was chosen: a quiet line under the cards keeps the way back while scenes remain in this browser only
			const again = () => {
				prefs.del(`copy-dismissed@${owner}`)
				renderBanner()
				els.body.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" })
				setTimeout(() => els.banner.querySelector(".lib-copy")?.focus({ preventScroll: true }), 120)
			}
			els.foot.hidden = false
			els.foot.append(icon("device", "lib-foot-ic"), h("span", { text: `${plural(locals.length, "scene")} in this browser ${locals.length === 1 ? "isn’t" : "aren’t"} in your account yet.` }), h("button", { type: "button", class: "ui-link lib-foot-go", text: `Copy ${locals.length === 1 ? "it" : "them"} to my account`, on: { click: again } }))
			return
		}
		b.hidden = false
		const text = h("p", { text: `${plural(locals.length, "scene is", "scenes are")} saved in this browser. Copy ${locals.length === 1 ? "it" : "them"} to your account to open ${locals.length === 1 ? "it" : "them"} anywhere.` })
		const go = h("button", { type: "button", class: "primary lib-copy", on: { click: () => copyIn(locals, text, go) } }, icon("upload"), "Copy to my account")
		const no = h("button", { type: "button", class: "ui-link", text: "Not now", on: { click: () => (prefs.set(`copy-dismissed@${owner}`, true), renderBanner()) } })
		b.append(icon("device", "lib-banner-ic"), text, h("span", { class: "lib-banner-acts" }, no, go))
	}
	async function copyIn(locals, text, btn) {
		if (S.copying) return
		const owner = store.owner
		const done = new Set(prefs.get(`copied@${owner}`) ?? [])
		S.copying = true
		btn.disabled = true
		let n = 0
		try {
			for (const m of locals) {
				text.textContent = `Copying ${n + 1} of ${locals.length}…`
				const { scene } = await store.local.get(m.id)
				const thumb = await store.local.thumb(m)
				const meta = await store.backend().create({ name: m.name, scene: { ...scene, name: m.name }, thumb, savedAs: m.savedAs ?? null, copy: true }) // (copy: its own daily count, never the hour's writes the autosave needs)
				autosave.link(m.id, meta)
				done.add(m.id)
				prefs.set(`copied@${owner}`, [...done])
				n++
			}
			showSnack(`Copied ${plural(n, "scene")} to your account`)
		} catch (e) {
			showSnack(`Copied ${n} of ${locals.length}. ${e.message}`) // (the rest stay offered: each copied scene is remembered)
		} finally {
			S.copying = null
			reload()
		}
	}

	function cardFor(m, now) {
		const current = autosave.currentId === m.id
		const name = m.name || "Untitled scene"
		const edited = `Edited ${ago(m.updatedAt, now)}`
		const things = plural(m.items ?? 0, "object")
		const thumb = h("span", { class: "lib-thumb" })
		placeholder(thumb, m)
		const openBtn = h(
			"button",
			{ type: "button", class: "lib-open", "aria-label": `${current ? "Back to" : "Open"} “${name}”, ${edited.toLowerCase()}, ${things}${current ? ", on the table now" : ""}`, title: `${name}\n${edited} (${when(m.updatedAt)})\nMade ${when(m.createdAt)}`, on: { click: () => openScene(m) } },
			thumb,
			h("span", { class: "lib-info" }, h("span", { class: "lib-name", text: name }), h("span", { class: "lib-meta" }, h("time", { datetime: new Date(m.updatedAt).toISOString(), text: edited }), h("span", { class: "lib-dot", "aria-hidden": "true", text: "·" }), h("span", { text: things })))
		)
		const more = h("button", { type: "button", class: "lib-more", "aria-label": `More for “${name}”`, title: "More", "aria-haspopup": "menu", "aria-expanded": "false", html: ICONS.more, on: { click: (e) => (e.stopPropagation(), toggleMenu(m, more)) } })
		const li = h("li", { class: `lib-item${current ? " is-current" : ""}`, "data-id": m.id }, openBtn, current ? h("span", { class: "lib-now", text: "On the table" }) : null, more)
		li.addEventListener("contextmenu", (e) => {
			e.preventDefault()
			toggleMenu(m, more, { x: e.clientX, y: e.clientY })
		})
		thumb._meta = m
		io.observe(thumb)
		return li
	}
	/** a card before (or without) its picture: the studio's wall and tabletop, and the scene's first letter */
	function placeholder(el, m) {
		const letter = (m.name || "?").trim().match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "?"
		el.classList.add("lib-ph")
		el.replaceChildren(h("span", { class: "lib-ph-l", text: letter, "aria-hidden": "true" }))
	}
	async function loadThumb(el) {
		io.unobserve(el)
		const m = el._meta
		if (!m?.thumb) return
		const key = `${m.id}:${m.thumb.etag ?? m.thumb.url ?? ""}`
		let url = S.urls.get(key)
		const fresh = !url
		if (!url) {
			const blob = await store.thumb(m).catch(() => null)
			if (!blob || !dlg?.open) return
			url = URL.createObjectURL(blob)
			S.urls.set(key, url)
		}
		const img = h("img", { alt: "", decoding: "async", draggable: "false" })
		img.src = url
		try {
			await img.decode()
		} catch {
			return
		}
		el.classList.remove("lib-ph")
		el.replaceChildren(img)
		if (fresh && !reduceMotion()) img.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" })
	}

	// ---------------------------------------------------------------- actions
	async function openScene(m) {
		if (S.renaming) return
		try {
			const r = await autosave.open(m.id)
			close()
			toast(r.already ? `“${m.name}” is on the table` : `Opened “${m.name}” (⌘Z goes back)`)
		} catch (e) {
			showSnack(`Couldn’t open it: ${e.message}`)
		}
	}
	function startRename(m) {
		const li = els.grid.querySelector(`.lib-item[data-id="${CSS.escape(m.id)}"]`)
		if (!li || S.renaming) return
		closeMenu()
		const nameEl = li.querySelector(".lib-name")
		const input = h("input", { type: "text", class: "lib-rename", value: m.name, maxlength: "60", "aria-label": `New name for “${m.name}”`, spellcheck: "false", autocomplete: "off", enterkeyhint: "done" })
		li.classList.add("renaming")
		li.append(input)
		input.focus()
		input.select()
		let over = false
		const finish = async (save) => {
			if (over) return
			over = true
			S.renaming = null
			const name = cleanName(input.value)
			input.remove()
			li.classList.remove("renaming")
			li.querySelector(".lib-open")?.focus({ preventScroll: true })
			if (S.renderLater) {
				S.renderLater = false
				render()
			}
			if (save && !name && input.value.trim()) return showSnack("A name needs at least one letter or digit")
			if (!save || !name || name === m.name) return
			nameEl.textContent = name // (at once; put back if the rename fails)
			try {
				const meta = await store.update(m.id, { name })
				autosave.renamed(m.id, name, meta)
				const left = [...new Set([...input.value].filter((ch) => !/[\p{L}\p{N}_\-'\u2019.,:;()&!?+#\s]/u.test(ch)))]
				showSnack(left.length ? `Renamed to “${name}” (names can’t have ${left.slice(0, 6).join(" ")})` : `Renamed to “${name}”`)
			} catch (e) {
				nameEl.textContent = m.name
				showSnack(`Couldn’t rename it: ${e.message}`)
			}
		}
		S.renaming = { commit: () => finish(true), cancel: () => finish(false) }
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault()
				finish(true)
			} else if (e.key === "Escape") {
				e.preventDefault()
				e.stopPropagation()
				finish(false)
			}
		})
		input.addEventListener("blur", () => finish(true))
	}
	async function duplicate(m) {
		try {
			const { scene } = await store.get(m.id)
			const name = copyName(m.name)
			const thumb = await store.thumb(m).catch(() => null)
			const meta = await store.create({ name, scene: { ...scene, name }, thumb: thumb ?? undefined })
			S.flash = meta.id
			S.list = [meta, ...(S.list ?? [])]
			render()
			showSnack(`Duplicated as “${name}”`)
		} catch (e) {
			showSnack(`Couldn’t duplicate it: ${e.message}`)
		}
	}
	function copyName(base) {
		// (names keep to the save rules: letters, digits, spaces, _ - ' — so "Ramp copy", "Ramp copy 2")
		const stem = cleanName(base).replace(/\s+copy(?: \d+)?$/, "").slice(0, 52) || "Untitled scene"
		const used = new Set((S.list ?? []).map((m) => m.name))
		let n = `${stem} copy`
		for (let i = 2; used.has(n); i++) n = `${stem} copy ${i}`
		return n
	}
	async function download(m) {
		try {
			const { scene } = await store.get(m.id)
			const file = downloadScene({ ...scene, name: m.name }, m.name)
			showSnack(`Downloaded ${file}`)
		} catch (e) {
			showSnack(`Couldn’t download it: ${e.message}`)
		}
	}
	async function remove(m) {
		const li = els.grid.querySelector(`.lib-item[data-id="${CSS.escape(m.id)}"]`)
		const items = [...els.grid.querySelectorAll(".lib-item")]
		const next = items[items.indexOf(li) + 1] ?? items[items.indexOf(li) - 1]
		try {
			await store.remove(m.id)
		} catch (e) {
			return showSnack(`Couldn’t delete it: ${e.message}`)
		}
		const onTable = autosave.deleted(m.id)
		S.list = (S.list ?? []).filter((x) => x.id !== m.id)
		const nextId = next?.dataset.id
		const gone = () => {
			render()
			if (nextId) els.grid.querySelector(`.lib-item[data-id="${CSS.escape(nextId)}"] .lib-open`)?.focus({ preventScroll: true })
			else els.search.focus({ preventScroll: true })
		}
		if (li && !reduceMotion()) {
			li.classList.add("lib-going")
			setTimeout(gone, 170)
		} else gone()
		// (the scene on the table stays on the table: say what happens to it, so a new card after its next change is no surprise)
		showSnack(onTable ? `Deleted “${m.name}”. It’s still on the table: your next change there keeps it as a new scene.` : `Deleted “${m.name}”`, {
			label: "Undo",
			act: async () => {
				try {
					const meta = await store.restore(m.id)
					autosave.restored(meta)
					S.flash = meta.id
					S.list = [...(S.list ?? []).filter((x) => x.id !== meta.id), meta]
					render()
					showSnack(`“${meta.name}” is back`)
				} catch (e) {
					showSnack(`Couldn’t bring it back: ${e.message}`)
				}
			}
		})
	}

	// ---------------------------------------------------------------- the ⋯ menu
	function toggleMenu(m, btn, at = null) {
		if (S.menu?.id === m.id) return closeMenu(true)
		closeMenu()
		const item = (ic, label, act, cls = "") => h("button", { type: "button", role: "menuitem", tabindex: "-1", class: cls, on: { click: () => (closeMenu(), act()) } }, icon(ic), h("span", { text: label }))
		const cur = autosave.currentId === m.id
		const menu = h(
			"div",
			{ class: "lib-menu", role: "menu", "aria-label": `“${m.name}”` },
			item("open", cur ? "Back to it" : "Open", () => openScene(m)),
			item("edit", "Rename", () => startRename(m)),
			item("copy", "Duplicate", () => duplicate(m)),
			item("down", "Download .json", () => download(m)),
			h("hr", { "aria-hidden": "true" }),
			item("trash", "Delete", () => remove(m), "danger")
		)
		dlg.append(menu)
		const r = btn.getBoundingClientRect()
		const mw = menu.offsetWidth
		const mh = menu.offsetHeight
		let x = at ? at.x : r.right - mw
		let y = at ? at.y : r.bottom + 6
		x = Math.max(8, Math.min(innerWidth - mw - 8, x))
		if (y + mh > innerHeight - 8) y = Math.max(8, (at ? at.y : r.top - 6) - mh)
		menu.style.left = `${Math.round(x)}px`
		menu.style.top = `${Math.round(y)}px`
		btn.setAttribute("aria-expanded", "true")
		S.menu = { id: m.id, el: menu, btn }
		menu.querySelector("button")?.focus()
		menu.addEventListener("keydown", (e) => {
			const items = [...menu.querySelectorAll("button")]
			const i = items.indexOf(document.activeElement)
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault()
				items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
			} else if (e.key === "Home" || e.key === "End") {
				e.preventDefault()
				items[e.key === "Home" ? 0 : items.length - 1]?.focus()
			} else if (e.key === "Tab") {
				e.preventDefault()
				closeMenu(true)
			}
		})
		setTimeout(() => document.addEventListener("pointerdown", outside, true), 0)
	}
	function outside(e) {
		if (S.menu && !S.menu.el.contains(e.target) && !S.menu.btn.contains(e.target)) closeMenu()
	}
	function closeMenu(refocus = false) {
		if (!S.menu) return
		const { el, btn } = S.menu
		S.menu = null
		el.remove()
		btn.setAttribute("aria-expanded", "false")
		document.removeEventListener("pointerdown", outside, true)
		if (refocus && btn.isConnected) btn.focus({ preventScroll: true })
	}

	// ---------------------------------------------------------------- the bar at the bottom: what just happened (and Undo)
	let snackTimer = 0
	let snackAct = null
	function showSnack(text, action = null) {
		const s = els.snack
		if (!s) return toast(text)
		clearTimeout(snackTimer)
		snackAct = action
		s.replaceChildren(h("span", { text }), action ? h("button", { type: "button", class: "lib-snack-act", text: action.label, on: { click: () => (hideSnack(), action.act()) } }) : null)
		s.hidden = false
		s.classList.remove("out")
		snackTimer = setTimeout(() => hideSnack(), action ? SNACK_MS : 3200)
	}
	function hideSnack(now = false) {
		const s = els.snack
		if (!s || s.hidden) return
		clearTimeout(snackTimer)
		snackAct = null
		if (now || reduceMotion()) return void (s.hidden = true)
		s.classList.add("out")
		snackTimer = setTimeout(() => ((s.hidden = true), s.classList.remove("out")), 160)
	}

	// ---------------------------------------------------------------- keys
	function cardButtons() {
		return [...els.grid.querySelectorAll(".lib-item:not(.lib-skel) .lib-open")]
	}
	function focusCard(i) {
		const all = cardButtons()
		all[Math.max(0, Math.min(all.length - 1, i))]?.focus()
	}
	function columns() {
		const items = [...els.grid.querySelectorAll(".lib-item")]
		if (items.length < 2) return 1
		const top = items[0].offsetTop
		const n = items.findIndex((el) => el.offsetTop !== top)
		return n === -1 ? items.length : n
	}
	function onKey(e) {
		if (e.defaultPrevented || S.menu || S.renaming) return
		const el = document.activeElement
		const inSearch = el === els.search
		if (e.key === "/" && !inSearch && el?.tagName !== "INPUT") {
			e.preventDefault()
			els.search.focus()
			els.search.select()
			return
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
			e.preventDefault()
			els.search.focus()
			els.search.select()
			return
		}
		if (e.key === "z" && (e.metaKey || e.ctrlKey) && snackAct && !inSearch) {
			e.preventDefault()
			const a = snackAct
			hideSnack()
			a.act()
			return
		}
		const all = cardButtons()
		const i = all.indexOf(el)
		if (i === -1) return
		const m = (S.list ?? []).find((x) => x.id === el.closest(".lib-item")?.dataset.id)
		const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key]
		if (step) {
			e.preventDefault()
			if (e.key === "ArrowUp" && i < columns()) return els.search.focus()
			return focusCard(i + step)
		}
		if (e.key === "Home" || e.key === "End") {
			e.preventDefault()
			return focusCard(e.key === "Home" ? 0 : all.length - 1)
		}
		if (!m) return
		if (e.key === "F2") {
			e.preventDefault()
			return startRename(m)
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault()
			return remove(m)
		}
		if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			return duplicate(m)
		}
		if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
			e.preventDefault()
			return toggleMenu(m, el.parentElement.querySelector(".lib-more"))
		}
	}

	// ---------------------------------------------------------------- the New dialog's row
	/** The 3 latest scenes as small cards and a way to all of them, in `el` (the New dialog's row); hidden when there are none. */
	async function renderRecent(el, done = () => {}) {
		el.hidden = true
		let list = []
		try {
			await autosave.flush({ now: true })
			list = (await store.list()).filter((m) => m.id !== autosave.currentId).slice(0, 3)
		} catch {
			return
		}
		const all = h("button", { type: "button", class: "lib-r-all", on: { click: () => (done(), setTimeout(open, reduceMotion() ? 0 : 170)) } }, icon("scenes"), h("span", { text: "All my scenes" }))
		el.replaceChildren(h("div", { class: "lib-r-head" }, h("p", { class: "lib-r-t", text: list.length ? "Or carry on with one of yours" : "Your scenes" }), all))
		if (list.length) {
			const row = h("div", { class: "lib-r-row", role: "list", "aria-label": "Your latest scenes" })
			for (const m of list) {
				const th = h("span", { class: "lib-thumb" })
				placeholder(th, m)
				const b = h("button", { type: "button", class: "lib-r-card", title: `${m.name}: edited ${ago(m.updatedAt)}`, "aria-label": `Open “${m.name}”, edited ${ago(m.updatedAt)}`, on: { click: async () => {
					done()
					try {
						await autosave.open(m.id)
						toast(`Opened “${m.name}” (⌘Z goes back)`)
					} catch (e) {
						toast(`Couldn’t open it: ${e.message}`)
					}
				} } }, th, h("span", { class: "lib-r-name", text: m.name }), h("span", { class: "lib-r-meta", text: ago(m.updatedAt) }))
				row.append(h("div", { role: "listitem", class: "lib-r-li" }, b))
				if (m.thumb) store.thumb(m).then((blob) => {
					if (!blob || !b.isConnected) return
					const u = URL.createObjectURL(blob)
					const img = h("img", { alt: "", src: u, decoding: "async" })
					img.onload = img.onerror = () => setTimeout(() => URL.revokeObjectURL(u), 1000)
					th.classList.remove("lib-ph")
					th.replaceChildren(img)
				}, () => {})
			}
			el.append(row)
		} else el.append(h("p", { class: "lib-r-none", text: "Everything you make is kept in My scenes as you work." }))
		el.hidden = false
	}

	return { open, close, isOpen: () => !!dlg?.open, renderRecent, reload, _el: () => dlg }
}
