// The item catalog drawer: search, category chips, a grid of preview cards. Click a card to add it, drag it onto the view to drop it.
// Plain ES module; the styles are in panels.css.

const CSS_ID = "panels-css"
const PW = 96 // preview canvas size, css px
const PH = 72
const ALL = "All"
const reduceMotion = () => {
	try { return matchMedia("(prefers-reduced-motion: reduce)").matches } catch { return false }
}

/** Loads panels.css (next to this file) unless the page already links it. */
export function ensurePanelCss() {
	if (document.getElementById(CSS_ID) || document.querySelector('link[href$="panels.css"]')) return
	const link = document.createElement("link")
	link.id = CSS_ID
	link.rel = "stylesheet"
	link.href = new URL("panels.css", import.meta.url).href
	document.head.append(link)
}

/** A flat stand-in for drawPreview(canvas, preview, looks), shown until a card's 3D photo is ready: every solid as a flat shape, scaled to fit.
 *  A see-through part (`hidden_3d`: a safety wall the picture leaves out) is not drawn, as the 3D view and its photos leave it out; an item that is
 *  nothing but such parts is drawn as faint dashed panes (the way the view shows a selected one), so its card is never blank. */
export function placeholderPreview(canvas, preview, looks = {}) {
	const ctx = canvas.getContext("2d")
	const W = canvas.width
	const H = canvas.height
	ctx.clearRect(0, 0, W, H)
	const all = preview?.solids ?? []
	const byId = new Map(all.map((s) => [s.id, s])) // (a shown part welded to a hidden one is still placed in its frame)
	const seen = all.filter((s) => !s.hidden_3d)
	const panes = !seen.length && all.length > 0
	const solids = panes ? all : seen
	const pose = (s) => {
		const a = s.at ?? { x: 0, y: 0 }
		const parent = s.parent && !s.pivot ? byId.get(s.parent) : null // welded: placed in its parent's frame
		if (!parent) return { x: a.x, y: a.y, th: s.angle ?? 0 }
		const q = pose(parent)
		const c = Math.cos(q.th)
		const n = Math.sin(q.th)
		return { x: q.x + a.x * c - a.y * n, y: q.y + a.x * n + a.y * c, th: q.th + (s.angle ?? 0) }
	}
	const shapes = solids.map((s) => {
		const p = pose(s)
		if (s.body.kind === "ball") return { s, ball: true, x: p.x, y: p.y, r: s.body.radius, pts: [[p.x - s.body.radius, p.y - s.body.radius], [p.x + s.body.radius, p.y + s.body.radius]] }
		const c = Math.cos(p.th)
		const n = Math.sin(p.th)
		if (s.body.kind === "polygon") return { s, pts: s.body.points.map((q) => [p.x + q.x * c - q.y * n, p.y + q.x * n + q.y * c]) } // (no width or height: its own outline)
		const hw = s.body.width / 2
		const hh = s.body.height / 2
		return { s, pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [p.x + x * c - y * n, p.y + x * n + y * c]) }
	})
	const xs = shapes.flatMap((h) => h.pts.map((q) => q[0]))
	const ys = shapes.flatMap((h) => h.pts.map((q) => q[1]))
	if (!xs.length) return
	const x0 = Math.min(...xs)
	const x1 = Math.max(...xs)
	const y0 = Math.min(...ys)
	const y1 = Math.max(...ys)
	const m = 0.12 * Math.min(W, H)
	const k = Math.min((W - 2 * m) / (x1 - x0 || 1), (H - 2 * m) / (y1 - y0 || 1))
	const X = (x) => W / 2 + (x - (x0 + x1) / 2) * k
	const Y = (y) => H / 2 - (y - (y0 + y1) / 2) * k
	ctx.lineWidth = Math.max(1, W / 96)
	ctx.setLineDash(panes ? [3 * ctx.lineWidth, 2 * ctx.lineWidth] : [])
	for (const h of [...shapes].sort((a, b) => (a.s.depth ?? 0) - (b.s.depth ?? 0))) {
		const look = looks[h.s.look] ?? {}
		ctx.fillStyle = panes ? "rgba(140, 190, 230, 0.18)" : h.s.color ?? h.s.placeholder?.fill ?? look.fill ?? "#bbb"
		ctx.strokeStyle = panes ? "rgba(90, 140, 190, 0.7)" : look.shade ?? "rgba(0,0,0,0.35)"
		ctx.beginPath()
		if (h.ball) ctx.arc(X(h.x), Y(h.y), Math.max(1, h.r * k), 0, Math.PI * 2)
		else h.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))))
		if (!h.ball) ctx.closePath()
		ctx.fill()
		ctx.stroke()
	}
	ctx.setLineDash([])
}

/** The card's tile shows a quiet "loading" sweep over its flat stand-in until the real photo is drawn into the canvas (a photo arrives as one
 *  drawImage into it: thumbs3d.js's blit; the flat stand-in is drawn with paths only). It gives up after `ms` (a photo that never comes: the flat
 *  drawing then simply stays). */
function awaitPhoto(canvas, tile, ms = 20000) {
	const g = canvas.getContext("2d")
	if (!g || g.__photoWatch) return
	g.__photoWatch = true
	const drawImage = g.drawImage
	let timer = 0
	const done = () => {
		clearTimeout(timer)
		tile.classList.remove("wait")
		tile.classList.add("shot")
	}
	g.drawImage = function (...a) {
		done()
		return drawImage.apply(this, a)
	}
	tile.classList.add("wait")
	timer = setTimeout(() => tile.classList.remove("wait"), ms)
}

// ---- search: every word must match somewhere; the best place a word matches sets its rank.
// A whole word of the name beats one that merely starts with it, tags beat the middle of a word ("ramp" must not find Trampoline first).
const flat = (s) => s.replace(/-/g, "") // "see-saw" and "seesaw" are one word
const wordsOf = (s) => [...new Set([...s.split(/[^a-z0-9]+/), ...s.split(/\s+/).map(flat)])].filter(Boolean)
function rank(e, t) {
	if (e.words.includes(t)) return 120
	if (e.name.startsWith(t)) return 100
	if (e.words.some((w) => w.startsWith(t))) return 80
	if (e.tagWords.includes(t)) return 75
	if (e.tagWords.some((w) => w.startsWith(t))) return 55
	if (e.name.includes(t)) return 40
	if (e.tags.some((g) => g.includes(t))) return 35
	if (e.cat.includes(t)) return 30
	if (e.desc.includes(t)) return 10
	return 0
}
function best(e, tok) {
	const stem = tok.length > 3 ? tok.replace(/(es|s)$/, "") : tok // "ramps" finds "ramp"
	return Math.max(rank(e, tok), stem === tok ? 0 : rank(e, stem))
}
function score(e, tokens) {
	let total = 0
	for (const tok of tokens) {
		let b = best(e, flat(tok)) // "see-saw" is the word "seesaw"...
		if (tok.includes("-")) { // ...and "golf-ball" is two words
			const parts = tok.split("-").filter(Boolean).map((p) => best(e, p))
			if (parts.length && parts.every(Boolean)) b = Math.max(b, parts.reduce((a, c) => a + c, 0) / parts.length)
		}
		if (!b) return 0
		total += b
	}
	return total
}

/** createCatalog(host, {catalog, drawPreview, onAdd(key), onDrop(key, clientX, clientY), onDragOver(clientX, clientY | null), onShow(canvases)}) → {open, close, toggle, isOpen}
 *  onDragOver follows a card being dragged (null when the drag ends, whatever way). onShow gets the shown cards' canvases, in screen order, whenever
 *  the chips or the search change what is listed (so their photos can be made first). */
export function createCatalog(host, { catalog, drawPreview = placeholderPreview, onAdd, onDrop, onDragOver, onShow }) {
	ensurePanelCss()
	const types = catalog.types ?? []
	const looks = catalog.looks ?? {}
	const have = new Set(types.map((t) => t.category))
	const cats = [...new Set([...(catalog.categories ?? []), ...have])].filter((c) => have.has(c))
	const entries = types.map((t) => {
		const name = flat(t.name.toLowerCase())
		const tags = (t.tags ?? []).map((g) => flat(g.toLowerCase()))
		return {
			t, name, words: wordsOf(t.name.toLowerCase()), tags, tagWords: [...new Set(tags.flatMap(wordsOf))],
			cat: t.category.toLowerCase(), desc: (t.description ?? "").toLowerCase(),
		}
	})

	host.classList.add("cat-host")
	host.hidden = true
	host.setAttribute("role", "region")
	host.setAttribute("aria-label", "Catalog of items")
	host.innerHTML = `
		<div class="cat-top">
			<div class="cat-search">
				<span class="cat-q-wrap"><svg class="cat-q-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg><input class="cat-q" type="search" placeholder="Search ${types.length} items: ball, ramp, spring…" aria-label="Search items" autocomplete="off" spellcheck="false"><button type="button" class="cat-clear" aria-label="Clear search" title="Clear search" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 6.4 12 10.6l4.2-4.2 1.4 1.4-4.2 4.2 4.2 4.2-1.4 1.4-4.2-4.2-4.2 4.2-1.4-1.4 4.2-4.2-4.2-4.2z"/></svg></button></span>
				<button type="button" class="ghost cat-close" aria-label="Close the catalog" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg></button>
			</div>
			<div class="cat-chips" role="group" aria-label="Categories"></div>
		</div>
		<div class="cat-body"></div>
		<div class="cat-info hint" aria-live="polite"></div>`
	const input = host.querySelector(".cat-q")
	const clearBtn = host.querySelector(".cat-clear")
	const chipBox = host.querySelector(".cat-chips")
	const body = host.querySelector(".cat-body")
	const info = host.querySelector(".cat-info")
	const state = { q: "", cat: ALL }

	// ---- chips
	const chips = new Map()
	for (const c of [ALL, ...cats]) {
		const b = document.createElement("button")
		b.type = "button"
		b.className = "cat-chip"
		b.dataset.cat = c
		const label = document.createElement("span")
		label.textContent = c
		b.append(label, document.createElement("b"))
		chipBox.append(b)
		chips.set(c, b)
	}

	// ---- cards (built once, then moved around by every search so their previews are never redrawn)
	const dpr = Math.min(2, window.devicePixelRatio || 1)
	const cards = new Map()
	for (const e of entries) {
		const b = document.createElement("button")
		b.type = "button"
		b.className = "cat-card"
		b.dataset.key = e.t.key
		b.tabIndex = -1
		const tile = document.createElement("span")
		tile.className = "cat-prev"
		const canvas = document.createElement("canvas")
		canvas.width = Math.round(PW * dpr)
		canvas.height = Math.round(PH * dpr)
		canvas.style.width = PW + "px"
		canvas.style.height = PH + "px"
		tile.append(canvas)
		const name = document.createElement("span")
		name.className = "cat-name"
		name.textContent = e.t.name
		const facts = document.createElement("span")
		facts.className = "cat-facts"
		facts.textContent = e.t.facts ?? ""
		b.title = e.t.facts ? `${e.t.name} · ${e.t.facts}` : e.t.name // (the whole name and sizes, where two lines cut them short)
		b.append(tile, name, facts)
		cards.set(e.t.key, b)
	}
	let painted = false
	const photos = drawPreview !== placeholderPreview // (a 3D photo follows the flat stand-in: the tile says it is on its way)
	function paintCard(e) {
		try {
			const canvas = cards.get(e.t.key).querySelector("canvas")
			if (photos) awaitPhoto(canvas, canvas.parentElement)
			drawPreview(canvas, e.t.preview, looks)
		} catch (err) {
			console.warn("catalog preview failed:", e.t.key, err)
		}
	}
	function paintAll() {
		painted = true
		for (const e of entries) paintCard(e)
	}

	// ---- what is shown
	function refresh() {
		const tokens = state.q.toLowerCase().split(/[\s,]+/).filter(Boolean)
		const hits = entries.map((e) => ({ e, s: tokens.length ? score(e, tokens) : 1 })).filter((h) => h.s > 0)
		if (tokens.length) hits.sort((a, b) => b.s - a.s) // best first; ties keep the catalog's order
		const counts = new Map([[ALL, hits.length]])
		for (const h of hits) counts.set(h.e.t.category, (counts.get(h.e.t.category) ?? 0) + 1)
		for (const [c, b] of chips) {
			const n = counts.get(c) ?? 0
			b.lastChild.textContent = n
			b.classList.toggle("empty", n === 0)
			b.setAttribute("aria-pressed", String(c === state.cat))
		}
		const shown = state.cat === ALL ? hits : hits.filter((h) => h.e.t.category === state.cat)
		const grid = (list) => {
			const g = document.createElement("div")
			g.className = "cat-grid"
			g.append(...list.map((h) => cards.get(h.e.t.key)))
			return g
		}
		const out = []
		if (!shown.length) {
			const p = document.createElement("div")
			p.className = "cat-empty"
			const say = document.createElement("p")
			say.textContent = tokens.length
				? `Nothing matches “${state.q.trim()}”${state.cat === ALL ? "" : " in " + state.cat}. Try another word.`
				: "Nothing in this category yet."
			p.append(say)
			if (tokens.length || state.cat !== ALL) {
				const again = document.createElement("button")
				again.type = "button"
				again.className = "ghost cat-reset"
				again.textContent = state.cat !== ALL && hits.length ? `Search all ${hits.length} matches` : "Show everything"
				again.addEventListener("click", () => {
					if (!(state.cat !== ALL && hits.length)) { input.value = state.q = ""; clearBtn.hidden = true }
					state.cat = ALL
					refresh()
					input.focus({ preventScroll: true })
				})
				p.append(again)
			}
			out.push(p)
		} else if (!tokens.length && state.cat === ALL) {
			for (const c of cats) {
				const list = shown.filter((h) => h.e.t.category === c)
				if (!list.length) continue
				const h3 = document.createElement("h3")
				h3.append(c)
				const n = document.createElement("small")
				n.textContent = list.length
				h3.append(n)
				out.push(h3, grid(list))
			}
		} else out.push(grid(shown))
		body.replaceChildren(...out)
		body.scrollTop = 0
		onShow?.([...body.querySelectorAll(".cat-card canvas")])
		if (painted) for (const h of shown) paintCard(h.e) // a photo that finished while its card was hidden is drawn now
		const first = body.querySelector(".cat-card")
		for (const b of cards.values()) b.tabIndex = b === first ? 0 : -1
	}

	input.addEventListener("input", () => {
		state.q = input.value
		clearBtn.hidden = !input.value
		refresh()
	})
	clearBtn.addEventListener("click", () => {
		input.value = state.q = ""
		clearBtn.hidden = true
		refresh()
		input.focus({ preventScroll: true })
	})
	chipBox.addEventListener("click", (e) => {
		const b = e.target.closest(".cat-chip")
		if (!b) return
		state.cat = b.dataset.cat
		refresh()
		b.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: reduceMotion() ? "auto" : "smooth" })
	})
	// the chips are one row that scrolls sideways: a mouse wheel scrolls it too (a trackpad already does), and its ends fade where more chips are
	const syncChipEdges = () => {
		const max = chipBox.scrollWidth - chipBox.clientWidth
		chipBox.classList.toggle("more-l", chipBox.scrollLeft > 2)
		chipBox.classList.toggle("more-r", chipBox.scrollLeft < max - 2)
	}
	chipBox.addEventListener("scroll", syncChipEdges, { passive: true })
	chipBox.addEventListener("wheel", (e) => {
		if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || chipBox.scrollWidth <= chipBox.clientWidth) return
		e.preventDefault()
		chipBox.scrollLeft += e.deltaY
	}, { passive: false })
	if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncChipEdges).observe(chipBox)
	host.querySelector(".cat-close").addEventListener("click", () => close())

	// ---- the strip under the grid shows the hovered (or focused) card's description
	function showInfo(key) {
		const t = key && types.find((x) => x.key === key)
		info.classList.toggle("hint", !t)
		if (!t) {
			info.textContent = "Click an item to add it, or drag it onto the picture."
			return
		}
		const b = document.createElement("b")
		b.textContent = t.name
		info.replaceChildren(b, t.description || t.category)
	}
	const focusedKey = () => document.activeElement?.closest?.(".cat-card")?.dataset.key ?? null
	body.addEventListener("pointerover", (e) => showInfo(e.target.closest(".cat-card")?.dataset.key ?? focusedKey()))
	body.addEventListener("pointerleave", () => showInfo(focusedKey()))
	body.addEventListener("focusin", (e) => {
		const b = e.target.closest(".cat-card")
		if (!b) return
		for (const c of cards.values()) c.tabIndex = c === b ? 0 : -1
		showInfo(b.dataset.key)
	})
	body.addEventListener("focusout", () => showInfo(null))
	showInfo(null)

	// ---- click adds; a drag (more than 5 px) lifts a ghost of the preview and drops it wherever the pointer is released
	let drag = null
	let suppressClick = 0
	body.addEventListener("click", (e) => {
		const b = e.target.closest(".cat-card")
		if (!b || performance.now() < suppressClick) return
		onAdd?.(b.dataset.key)
	})
	body.addEventListener("pointerdown", (e) => {
		const b = e.target.closest(".cat-card")
		if (!b || e.button !== 0 || !e.isPrimary) return
		drag = { card: b, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null, dead: false }
		try { b.setPointerCapture(e.pointerId) } catch {} // the card keeps getting the moves, so the views underneath never see them
	})
	body.addEventListener("pointermove", (e) => {
		if (!drag || drag.dead || e.pointerId !== drag.id) return
		if (!drag.ghost) {
			if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 5) return
			const src = drag.card.querySelector("canvas")
			const ghost = document.createElement("div")
			ghost.className = "cat-ghost"
			const c = document.createElement("canvas")
			c.width = src.width
			c.height = src.height
			c.style.width = PW + "px"
			c.style.height = PH + "px"
			c.getContext("2d").drawImage(src, 0, 0)
			ghost.append(c)
			document.body.append(ghost)
			document.body.classList.add("cat-dragging")
			drag.card.classList.add("dragging")
			drag.ghost = ghost
			window.addEventListener("keydown", dragKey, true)
		}
		drag.ghost.style.transform = `translate(${e.clientX - PW / 2}px, ${e.clientY - PH / 2}px)`
		onDragOver?.(e.clientX, e.clientY)
	})
	function dropGhost(d) {
		if (!d?.ghost) return
		d.ghost.remove()
		d.ghost = null
		onDragOver?.(null, null)
		d.card.classList.remove("dragging")
		document.body.classList.remove("cat-dragging")
		window.removeEventListener("keydown", dragKey, true)
	}
	function dragKey(e) {
		if (e.key !== "Escape") return
		e.preventDefault()
		e.stopPropagation()
		dropGhost(drag)
		drag.dead = true // the release that follows neither drops nor adds
	}
	body.addEventListener("pointerup", (e) => {
		if (!drag || e.pointerId !== drag.id) return
		const d = drag
		drag = null
		const dragged = d.dead || d.ghost
		dropGhost(d)
		if (!dragged) return
		suppressClick = performance.now() + 250 // the click that follows a drag is not an add
		if (!d.dead) onDrop?.(d.card.dataset.key, e.clientX, e.clientY)
	})
	body.addEventListener("pointercancel", (e) => {
		if (!drag || e.pointerId !== drag.id) return
		dropGhost(drag)
		drag = null
	})

	// ---- keyboard: arrows move between the cards, Enter (the button's click) adds, Esc closes
	const cardList = () => [...body.querySelectorAll(".cat-card")]
	function moveFocus(from, key) {
		const all = cardList()
		const i = all.indexOf(from)
		let to = null
		if (key === "ArrowRight") to = all[i + 1]
		else if (key === "ArrowLeft") to = all[i - 1]
		else if (key === "Home") to = all[0]
		else if (key === "End") to = all[all.length - 1]
		else {
			const r = from.getBoundingClientRect()
			const dir = key === "ArrowDown" ? 1 : -1
			const rows = all.map((c) => ({ c, r: c.getBoundingClientRect() })).filter((x) => (x.r.top - r.top) * dir > 4)
			if (rows.length) {
				const near = Math.min(...rows.map((x) => Math.abs(x.r.top - r.top)))
				const row = rows.filter((x) => Math.abs(x.r.top - r.top) - near < 4)
				const cx = r.left + r.width / 2
				to = row.reduce((a, b) => (Math.abs(b.r.left + b.r.width / 2 - cx) < Math.abs(a.r.left + a.r.width / 2 - cx) ? b : a)).c
			} else if (dir < 0) to = input
		}
		to?.focus()
	}
	host.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			close()
			return
		}
		if (e.target === input && e.key === "ArrowDown") {
			e.preventDefault()
			cardList()[0]?.focus()
			return
		}
		const card = e.target.closest?.(".cat-card")
		if (card && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
			e.preventDefault()
			moveFocus(card, e.key)
		}
	})

	// ---- the drawer (it slides in; closing, it is closed at once for everything that asks, and fades out for 140 ms, inert meanwhile)
	let shut = true
	let shutTimer = 0
	const isOpen = () => !shut
	function open() {
		clearTimeout(shutTimer)
		shut = false
		host.inert = false
		host.classList.remove("cat-out")
		host.hidden = false
		if (!painted) paintAll()
		syncChipEdges()
		input.focus({ preventScroll: true })
		input.select()
	}
	function close() {
		if (drag?.ghost) {
			dropGhost(drag)
			drag.dead = true
		}
		if (shut) return
		shut = true
		const back = host.contains(document.activeElement)
		if (back) document.activeElement.blur()
		if (reduceMotion() || host.hidden) {
			host.hidden = true
		} else {
			host.inert = true
			host.classList.add("cat-out")
			shutTimer = setTimeout(() => {
				host.hidden = true
				host.inert = false
				host.classList.remove("cat-out")
			}, 140)
		}
		if (back) document.getElementById("add")?.focus({ preventScroll: true }) // (keyboard users land back on the button that opened it)
	}
	const toggle = () => (isOpen() ? close() : open())

	refresh()
	return { open, close, toggle, isOpen }
}
