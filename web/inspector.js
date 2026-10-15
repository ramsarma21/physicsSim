// The inspector: scene settings, the list of items, and the selected item's position and props.
// render() updates the controls in place, so a slider being dragged or a box being typed in is never rebuilt or overwritten.
// Plain ES module; the styles are in panels.css.
import { ensurePanelCss, placeholderPreview } from "./catalog-ui.js"

const ICON_W = 40 // list icon size, css px
const ICON_H = 30

const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b)
const decimals = (step) => {
	const s = String(step ?? 1)
	const i = s.indexOf(".")
	return i < 0 ? 0 : Math.min(4, s.length - i - 1)
}
const fmt = (v, dec) => String(+Number(v).toFixed(dec))
const clamp = (v, lo, hi) => Math.min(Number.isFinite(hi) ? hi : Infinity, Math.max(Number.isFinite(lo) ? lo : -Infinity, v))
const setText = (el, s) => {
	if (el.textContent !== s) el.textContent = s
}
const h = (tag, cls, html) => {
	const e = document.createElement(tag)
	if (cls) e.className = cls
	if (html != null) e.innerHTML = html
	return e
}
let uid = 0

/** True while the user has typed into a box and not committed it yet (set() must not overwrite that). */
function trackTyping(input) {
	const t = { on: false }
	input.addEventListener("input", () => (t.on = true))
	input.addEventListener("change", () => (t.on = false))
	input.addEventListener("blur", () => (t.on = false))
	return t
}

/** A number box that commits (wrapped, then clamped) on change, and that set() never overwrites while it is being typed in.
 *  setRange() moves its limits (the scene's own size sets them); onClamp(limit) says when a typed value was cut to them.
 *  It shows `dec` decimals, or whatever format(v) makes (a value that spans many magnitudes, like a ball's weight, needs significant figures). */
function numBox({ min, max, step, dec, format, label, onCommit, wrap, onClamp }) {
	const input = h("input", "num insp-num")
	input.type = "number"
	if (Number.isFinite(min)) input.min = min
	if (Number.isFinite(max)) input.max = max
	if (step) input.step = step
	if (label) input.setAttribute("aria-label", label)
	const typing = trackTyping(input)
	const show = (v) => (format ? format(v) : fmt(v, dec))
	const box = {
		input,
		value: NaN,
		setRange(lo, hi) {
			min = lo // (limits in the code only: the box's own min/max would skew its spin buttons)
			max = hi
		},
		set(v) {
			box.value = v
			if (typing.on) return
			const s = show(v)
			if (input.value !== s) input.value = s
		},
		clear() { // nothing true to show yet (a value that is still being worked out)
			box.value = NaN
			if (!typing.on && input.value !== "") input.value = ""
		},
		}
	input.addEventListener("change", () => {
		const v = parseFloat(input.value)
		if (!Number.isFinite(v)) {
			input.value = Number.isFinite(box.value) ? show(box.value) : "" // back to the last value, in the format set() uses
			return
		}
		const w = wrap ? wrap(v) : v
		const c = clamp(w, min, max)
		if (c !== w) onClamp?.(c, min, max)
		input.value = show(c)
		box.value = c
		onCommit(c)
	})
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") input.blur()
	})
	return box
}

/** The props an auto prop (a ball's weight) is built from: the ones its `auto` lists, else every prop of the type that is not auto itself. */
const followed = (type, p) => (Array.isArray(p.auto) ? p.auto : (type?.props ?? []).filter((q) => !q.auto).map((q) => q.key))

/** The props the builder made of an item, if they are for the item as it is now. After an undo, a reset, a copy or an edit that has not run yet, the app's
 *  resolved is for another state (or even another item of the same id), which shows in four ways: its type is not this item's; the item sets (or does not set)
 *  a value of its own for the auto prop or one it follows where the built item did not (resolved's `_own` lists what the built item set: a weight that was
 *  typed is not automatic, so after a reset it says nothing about the automatic weight); or a prop it follows (the item's own, else the default) is not what was built. */
function builtFor(type, p, keys, it, built) {
	if (!built || built._type !== it.type) return undefined
	const own = built._own ?? []
	for (const k of [p.key, ...keys]) if (own.includes(k) !== (it.props?.[k] !== undefined)) return undefined
	for (const k of keys) {
		const q = type?.props?.find((x) => x.key === k)
		let want = it.props?.[k]
		if (want === undefined) {
			if (!q || q.auto) continue // (an auto prop the item does not set is built from the others)
			want = q.default
		}
		if (typeof want === "number" && q) want = q.kind === "int" ? Math.round(want) : clamp(want, q.min, q.max) // as the server takes it
		if (!same(built[k], want)) return undefined
	}
	return built
}

/** createInspector(host, {catalog, onSelect, onChange, onScene, onDelete, onDuplicate, drawPreview?, onNotice?(text)}) → {render(scene, selectedId, resolved)}
 *  onNotice says when a typed number was cut to what the scene allows. */
export function createInspector(host, { catalog, onSelect, onChange, onScene, onDelete, onDuplicate, drawPreview, onNotice }) {
	ensurePanelCss()
	const types = new Map((catalog.types ?? []).map((t) => [t.key, t]))
	const looks = catalog.looks ?? {}
	const open = { scene: true, items: true, selected: true, about: false } // which sections the user has open (survives rebuilds)
	// A resolved that was on hand when an item's props (or type) changed is for the item as it was: an edit, a slider or handle drag, an undo, a new scene.
	// What it says about a value the builder capped may be another state's, so a cap is shown only from a resolved that came after the change (the run
	// that lands for it). (Moves don't count: a cap depends on the item's own props.)
	const untrusted = new WeakSet()
	let sigs = new Map() // item id → its type and props as last rendered

	// ---- the skeleton: Scene, Items, and a slot for the selected item's sections
	host.classList.add("insp-host")
	host.innerHTML = `
		<details class="group" data-sec="scene"><summary><span>Scene</span><small class="scene-name"></small></summary><div class="group-body"></div></details>
		<details class="group" data-sec="items"><summary><span>Items</span><small class="items-n"></small></summary>
			<div class="group-body"><ul class="insp-list"></ul><p class="insp-hint"></p></div></details>
		<div class="insp-sel"></div>`
	const trackOpen = (details, key) => {
		details.open = open[key]
		details.addEventListener("toggle", () => (open[key] = details.open))
	}
	const [sceneGroup, itemsGroup] = host.querySelectorAll(":scope > details")
	trackOpen(sceneGroup, "scene")
	trackOpen(itemsGroup, "items")
	const selBox = host.querySelector(".insp-sel")
	const list = host.querySelector(".insp-list")
	const hint = host.querySelector(".insp-hint")
	const itemsN = host.querySelector(".items-n")
	const sceneLabel = host.querySelector(".scene-name")

	// ---- Scene
	const sceneBody = sceneGroup.querySelector(".group-body")
	const sceneRow = (label, control, unit) => {
		const row = h("div", "field", `<div class="field-top"><label></label><span class="unit"></span></div>`)
		row.querySelector("label").textContent = label
		row.querySelector(".unit").textContent = unit ?? ""
		row.querySelector(".unit").before(control)
		sceneBody.append(row)
	}
	const sceneName = h("input", "num insp-text")
	sceneName.type = "text"
	sceneName.setAttribute("aria-label", "Scene name")
	sceneName.addEventListener("change", () => {
		const v = sceneName.value.trim()
		if (!v) sceneName.value = sceneName.dataset.was
		else if (v !== sceneName.dataset.was) onScene?.({ name: v }, true)
	})
	sceneName.addEventListener("keydown", (e) => e.key === "Enter" && sceneName.blur())
	const sceneTyping = trackTyping(sceneName)
	const seconds = numBox({ min: 0.5, max: 20, step: 0.1, dec: 2, label: "Run length", onCommit: (v) => onScene?.({ seconds: v }, true) })
	// a held item must let go while the run is still going
	const release = numBox({ min: 0, step: 0.05, dec: 2, label: "Release time", onCommit: (v) => onScene?.({ release: v }, true), onClamp: (c) => onNotice?.(`Release time is at most the run length (${fmt(c, 2)} s)`) })
	let curScene = null // the scene being shown: its stage and run length set the limits of the boxes
	sceneRow("Name", sceneName)
	sceneRow("Run length", seconds.input, "s")
	sceneRow("Release time", release.input, "s")

	// ---- Items: one keyed row per item, with a small preview icon
	const draw = drawPreview ?? placeholderPreview
	const rows = new Map()
	const dpr = Math.min(2, window.devicePixelRatio || 1)
	/** The row's icon is drawn straight into its own canvas: the 3D photo may arrive later (draw() finishes it there), so nothing is copied early.
	 *  Icons are not drawn while the panel or the Items group is collapsed: a row waits in `due` until the list is on screen. */
	function paintIcon(r) {
		const type = types.get(r.typeKey)
		r.canvas.getContext("2d").clearRect(0, 0, r.canvas.width, r.canvas.height)
		if (!type?.preview) return
		try {
			draw(r.canvas, type.preview, looks)
		} catch (err) {
			console.warn("inspector icon failed:", type.key, err)
		}
	}
	const due = new Set()
	let listShown = typeof IntersectionObserver === "undefined" // (no way to tell: draw at once)
	if (!listShown) {
		new IntersectionObserver((entries) => {
			listShown = entries[entries.length - 1].isIntersecting
			if (!listShown) return
			for (const r of due) paintIcon(r)
			due.clear()
		}).observe(list)
	}
	function makeRow(id) {
		const li = h("li", "insp-item")
		const pick = h("button", "insp-pick", `<canvas class="insp-icon"></canvas><span class="insp-nm"></span>`)
		pick.type = "button"
		const x = h("button", "insp-x", "×")
		x.type = "button"
		const canvas = pick.querySelector("canvas")
		canvas.width = Math.round(ICON_W * dpr)
		canvas.height = Math.round(ICON_H * dpr)
		pick.addEventListener("click", () => onSelect?.(id))
		x.addEventListener("click", () => onDelete?.(id))
		li.append(pick, x)
		return { li, pick, x, canvas, nm: pick.querySelector(".insp-nm"), label: null, typeKey: null, sel: null }
	}
	let lastSelected = null
	function renderItems(scene, selectedId) {
		const items = scene.items ?? []
		const ids = new Set(items.map((it) => it.id))
		for (const [id, r] of rows) {
			if (ids.has(id)) continue
			r.li.remove()
			rows.delete(id)
			due.delete(r)
		}
		items.forEach((it, i) => {
			let r = rows.get(it.id)
			if (!r) rows.set(it.id, (r = makeRow(it.id)))
			const type = types.get(it.type)
			const label = it.name || type?.name || it.type
			if (r.label !== label) {
				r.label = label
				r.nm.textContent = label
				r.pick.title = type && type.name !== label ? `${label} · ${type.name}` : label
				r.x.title = `Delete ${label}`
				r.x.setAttribute("aria-label", `Delete ${label}`)
			}
			if (r.typeKey !== it.type) {
				r.typeKey = it.type
				if (listShown) paintIcon(r)
				else due.add(r)
			}
			const ghost = (it.props?.invisible_in_3d ?? type?.defaults?.invisible_in_3d) === true // a safety wall the picture leaves out
			if (r.ghost !== ghost) {
				r.ghost = ghost
				r.li.classList.toggle("see-through", ghost)
			}
			const sel = it.id === selectedId
			if (r.sel !== sel) {
				r.sel = sel
				r.li.classList.toggle("selected", sel)
				r.pick.setAttribute("aria-current", String(sel))
			}
			if (list.children[i] !== r.li) list.insertBefore(r.li, list.children[i] ?? null)
		})
		setText(itemsN, String(items.length))
		hint.hidden = selectedId != null && ids.has(selectedId)
		setText(hint, items.length ? "Pick an item above, or click one in the picture, to edit it." : "Nothing here yet. Add an item from the catalog.")
		if (selectedId !== lastSelected) {
			lastSelected = selectedId
			const li = rows.get(selectedId)?.li // keep the picked row in view inside the list (the panel itself is left where it is)
			if (li && li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop
			else if (li && li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight
		}
	}

	// ---- the selected item: built once per (item, type), then updated in place
	let sel = null // {id, typeKey, nodes, update(item, resolved)}
	let lastResolved
	function buildSelected(item, type) {
		const id = item.id
		let editedAt = null // the resolved props that were current at the user's last edit: they predate it, so they are not shown
		const emit = (patch, commit) => {
			editedAt = lastResolved
			onChange?.(id, patch, commit)
		}
		const updaters = []
		const view = { type, built: undefined } // for the auto props: the item's built props (resolved), which may be for another state of it

		const group = h("details", "group", `<summary><span>Selected: <b class="nm"></b></span><small class="ty"></small></summary><div class="group-body"></div>`)
		trackOpen(group, "selected")
		const body = group.querySelector(".group-body")
		const add = (row, update) => {
			body.append(row)
			if (update) updaters.push(update)
		}

		// name
		const nameRow = h("div", "field", `<div class="field-top"><label>Name</label><input class="num insp-text" type="text"></div>`)
		const name = nameRow.querySelector("input")
		name.placeholder = type?.name ?? item.type
		name.setAttribute("aria-label", "Name")
		name.addEventListener("change", () => {
			const v = name.value.trim()
			if (v === (name.dataset.was ?? "")) return
			if (!v) name.value = name.dataset.was ?? "" // a name can be changed, not removed
			else emit({ name: v }, true)
		})
		name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur())
		const typing = trackTyping(name)
		add(nameRow, (it) => {
			name.dataset.was = it.name ?? ""
			if (!typing.on && name.value !== name.dataset.was) name.value = name.dataset.was
		})

		// X, Y, angle
		const xyRow = h("div", "field")
		const grid = h("div", "insp-xy")
		const wrapAngle = (v) => { const a = ((v % 360) + 360) % 360; return a > 180 ? a - 360 : a } // any turn is one in (-180, 180]
		const pose = [["x", "X (m)", 0.01, 3], ["y", "Y (m)", 0.01, 3], ["angle", "Angle (°)", 1, 2]].map(([key, label, step, dec]) => {
			const box = numBox({
				step, dec, label,
				wrap: key === "angle" ? wrapAngle : undefined,
				onCommit: (v) => emit({ [key]: v }, true),
				onClamp: (c, lo, hi) => onNotice?.(`${label.replace(/ \(.*\)/, "")} stays between ${fmt(lo, 2)} and ${fmt(hi, 2)} m (the edges of the scene)`),
			})
			const lab = h("label")
			lab.append(label, box.input)
			grid.append(lab)
			return [key, box]
		})
		xyRow.append(grid)
		add(xyRow, (it) => pose.forEach(([key, box]) => {
			const st = curScene?.stage // nothing can start outside the scene's edges (it would just fall away)
			if (st && key === "x") box.setRange(st.x0, st.x1)
			else if (st && key === "y") box.setRange(st.y0, st.y1)
			box.set(it[key] ?? 0)
		}))

		// held / fixed (things that move)
		if (type?.dynamic) {
			for (const [key, label] of [["held", "Held until the release"], ["fixed", "Fixed in place"]]) {
				const row = h("div", "field", `<label class="switch"><input type="checkbox"><span></span></label>`)
				const cb = row.querySelector("input")
				row.querySelector("label").append(label)
				cb.addEventListener("change", () => emit({ [key]: cb.checked }, true))
				add(row, (it) => (cb.checked = !!it[key]))
			}
		}

		// every prop of the type
		for (const p of type?.props ?? []) {
			const f = propField(p, (v, commit) => emit({ props: { [p.key]: v } }, commit), view)
			add(f.row, f.update)
		}

		const about = h("details", "group", `<summary><span>About this item</span></summary><div class="group-body insp-about"></div>`)
		trackOpen(about, "about")
		const aboutBody = about.querySelector(".insp-about")
		const note = (cls, label, text) => {
			if (!text) return
			const p = h("p", cls)
			if (label) p.append(Object.assign(h("b"), { textContent: label + " " }))
			p.append(text)
			aboutBody.append(p)
		}
		note("", "", type?.description)
		note("", "Facts", type?.facts)
		note("src", "Source", type?.source)
		if (!aboutBody.children.length) note("", "", "Nothing more to say about this one yet.")

		const actions = h("div", "insp-actions", `<button type="button" class="ghost dup">Duplicate</button><button type="button" class="ghost danger del">Delete</button>`)
		actions.querySelector(".dup").addEventListener("click", () => onDuplicate?.(id))
		actions.querySelector(".del").addEventListener("click", () => onDelete?.(id))

		const nm = group.querySelector(".nm")
		const ty = group.querySelector(".ty")
		return {
			id,
			typeKey: item.type,
			nodes: [group, about, actions],
			update(it, resolved) {
				setText(nm, it.name || type?.name || it.type)
				setText(ty, type?.name ?? it.type)
				const fresh = resolved && resolved !== editedAt ? resolved : undefined
				view.built = resolved?.[it.id]
				view.trusted = !!fresh && typeof fresh === "object" && !untrusted.has(fresh)
				for (const u of updaters) u(it, fresh)
			},
		}
	}

	/** One prop's control: a slider + number box + unit (number), a stepper (int), a switch (bool) or a select (choice). */
	function propField(p, emit, view) {
		const id = `insp-${++uid}`
		const row = h("div", "field")
		const valueOf = (it, resolved) => it.props?.[p.key] ?? resolved?.[it.id]?.[p.key] ?? p.default
		// an auto prop (a ball's weight) has no value of its own until one is set: any value set is a change, even one equal to the default size's
		const changedOf = (it) => it.props?.[p.key] !== undefined && (p.auto || !same(it.props[p.key], p.default))
		const help = () => p.help && row.append(Object.assign(h("p", "help"), { textContent: p.help }))
		const resetBtn = () => {
			const b = h("button", "reset", "↺")
			b.type = "button"
			b.title = p.auto ? "Back to automatic (it follows the size)" : `Back to ${p.default}`
			b.setAttribute("aria-label", `Reset ${p.label}`)
			b.addEventListener("click", () => emit(p.auto ? undefined : p.default, true)) // automatic = the item stores nothing
			return b
		}
		const top = (label, ...controls) => {
			const t = h("div", "field-top", `<label></label>`)
			t.firstChild.textContent = label
			if (p.kind !== "bool") t.firstChild.htmlFor = id
			t.append(...controls)
			row.append(t)
		}
		/** What the builder made of this prop when that is not what the item asks for: a value it caps (an egg set wider than it is long is built as
		 *  wide as it is long; a trampoline's spring as stiff as its mat allows). Only from a resolved made for the item as it is now (view.trusted). */
		const capOf = (it, resolved) => {
			if (p.auto || !view?.trusted || !resolved) return null
			const built = resolved[it.id]?.[p.key]
			let asked = it.props?.[p.key] ?? p.default
			if (typeof built !== "number" || !Number.isFinite(built) || typeof asked !== "number" || !Number.isFinite(asked)) return null
			asked = p.kind === "int" ? Math.round(asked) : clamp(asked, p.min, p.max) // (as the server takes it: its own range is no cap)
			if (Math.abs(built - asked) <= 1e-6 * Math.max(Math.abs(asked), Math.abs(built)) + 1e-12) return null
			return { built, asked, own: it.props?.[p.key] !== undefined }
		}
		let note = null
		/** The small line under a capped value: what it was built as, and what was asked. control: the box it describes (for screen readers). */
		function showCap(cap, show, control) {
			if (!cap) {
				if (note && !note.hidden) {
					note.hidden = true
					control?.removeAttribute("aria-describedby")
				}
				return
			}
			if (!note) {
				note = h("p", "cap-note")
				note.id = `${id}-cap`
				row.insertBefore(note, row.querySelector(".help"))
			}
			const u = (v) => `${show(v)}${p.unit ? (p.unit === "°" ? "°" : ` ${p.unit}`) : ""}`
			const up = cap.built > cap.asked
			setText(note, `Built at ${u(cap.built)}: the ${up ? "least" : "most"} it allows as set up (${cap.own ? "you set" : "default"} ${u(cap.asked)}).`)
			note.hidden = false
			control?.setAttribute("aria-describedby", note.id)
		}

		if (p.kind === "bool") {
			row.innerHTML = `<label class="switch"><input type="checkbox"><span></span></label>`
			const cb = row.querySelector("input")
			row.querySelector("label").append(p.label)
			cb.addEventListener("change", () => emit(cb.checked, true))
			help()
			return {
				row,
				update(it, resolved) {
					cb.checked = !!valueOf(it, resolved)
				},
			}
		}

		if (p.kind === "choice") {
			const select = h("select", "num insp-select")
			select.id = id
			for (const c of p.choices ?? []) {
				const v = typeof c === "object" ? c.value : c
				select.append(Object.assign(h("option"), { value: v, textContent: typeof c === "object" ? c.label ?? v : c }))
			}
			select.addEventListener("change", () => emit(select.value, true))
			const reset = resetBtn()
			top(p.label, select, reset)
			help()
			return {
				row,
				update(it, resolved) {
					row.classList.toggle("changed", changedOf(it))
					select.value = String(valueOf(it, resolved))
				},
			}
		}

		if (p.kind === "int") {
			const step = p.step || 1
			const stepper = h("div", "stepper", `<button type="button">−</button><output aria-live="polite"></output><button type="button">+</button>`)
			const [less, more] = stepper.querySelectorAll("button")
			less.setAttribute("aria-label", `Fewer: ${p.label}`)
			more.setAttribute("aria-label", `More: ${p.label}`)
			const out = stepper.querySelector("output")
			let cur = p.default
			less.addEventListener("click", () => emit(clamp(cur - step, p.min, p.max), true))
			more.addEventListener("click", () => emit(clamp(cur + step, p.min, p.max), true))
			top(p.label, stepper, Object.assign(h("span", "unit"), { textContent: p.unit ?? "" }), resetBtn())
			help()
			return {
				row,
				update(it, resolved) {
					cur = valueOf(it, resolved)
					const cap = capOf(it, resolved)
					if (cap) cur = cap.built // (the steps go from what was built: what the picture shows)
					showCap(cap, String, out)
					row.classList.toggle("changed", changedOf(it))
					setText(out, String(cur))
					less.disabled = cur <= p.min
					more.disabled = cur >= p.max
				},
			}
		}

		// number: slider + number box
		const dec = Math.min(4, decimals(p.step) + 1)
		// an auto prop (weight, wall) spans many magnitudes (a 6 g ball and a 100 kg one), so its box shows 4 significant figures, not fixed decimals
		const format = p.auto ? (v) => String(+Number(v).toPrecision(4)) : undefined
		const box = numBox({ min: p.min, max: p.max, step: p.step, dec, format, label: p.label, onCommit: (v) => (range && (range.value = v), showCap(null, null, box.input), emit(v, true)) })
		const shown = (v) => (format ? format(v) : fmt(v, dec))
		if (p.auto) box.input.style.width = "118px" // room for 0.000003657 (panels.css sizes a box for 0.1025)
		top(p.label, box.input, Object.assign(h("span", "unit"), { textContent: p.unit ?? "" }), resetBtn())
		let range = null
		let dragging = false // the pointer is down on the slider: the app's echoes must not move it
		if (Number.isFinite(p.min) && Number.isFinite(p.max)) {
			range = h("input")
			range.type = "range"
			range.id = id
			range.min = p.min
			range.max = p.slider_max ?? p.max // a typed value may go to max; the slider covers the handy part (a 1 m ball's weight would leave a 6 g ball at its very start)
			if (p.step) range.step = p.step
			const sliderValue = () => (p.auto ? +parseFloat(range.value).toPrecision(3) : parseFloat(range.value)) // an auto prop's slider emits 3 significant figures (its grid is far finer than a person can aim)
			range.addEventListener("pointerdown", () => (dragging = true))
			for (const ev of ["pointerup", "pointercancel", "change", "blur"]) range.addEventListener(ev, () => (dragging = false))
			range.addEventListener("input", () => {
				const v = sliderValue()
				box.set(v)
				showCap(null, null, box.input) // (what was built for the last value says nothing about this one)
				emit(v, false) // still dragging
			})
			range.addEventListener("change", () => emit(sliderValue(), true))
			row.append(range)
		} else box.input.id = id
		help()
		return {
			row,
			update(it, resolved) {
				row.classList.toggle("changed", changedOf(it))
				if (dragging) return
				let v
				if (p.auto && it.props?.[p.key] === undefined) {
					// an automatic prop (a ball's weight) is built from the other props: the default is right only while the item sets none of them.
					// Otherwise show what was built for it as it is now, and until the run says, nothing rather than another state's weight
					// (a copy of a big ball, an undo, a size just changed)
					const keys = followed(view.type, p)
					v = builtFor(view.type, p, keys, it, view.built)?.[p.key] ?? (keys.every((k) => it.props?.[k] === undefined) ? p.default : undefined)
					if (v === undefined) {
						box.clear()
						if (range) range.style.visibility = "hidden"
						return
					}
				} else {
					v = valueOf(it, resolved)
					const cap = capOf(it, resolved)
					if (cap) v = cap.built // the box and the slider show what was built (the picture's size); the note says what was asked
					showCap(cap, shown, box.input)
				}
				if (range) range.style.visibility = ""
				box.set(v)
				if (range) range.value = v
			},
		}
	}

	function renderSelected(scene, selectedId, resolved) {
		const item = selectedId == null ? null : (scene.items ?? []).find((it) => it.id === selectedId)
		if (!item) {
			if (sel) selBox.replaceChildren()
			sel = null
			return
		}
		if (!sel || sel.id !== item.id || sel.typeKey !== item.type) {
			sel = buildSelected(item, types.get(item.type))
			selBox.replaceChildren(...sel.nodes)
		}
		sel.update(item, resolved)
	}

	function render(scene, selectedId, resolved) {
		const next = new Map()
		let changed = false
		for (const it of scene.items ?? []) {
			const s = `${it.type}|${JSON.stringify(it.props ?? {})}`
			next.set(it.id, s)
			if (sigs.has(it.id) && sigs.get(it.id) !== s) changed = true
		}
		sigs = next
		if (changed) for (const r of [lastResolved, resolved]) if (r && typeof r === "object") untrusted.add(r)
		lastResolved = resolved
		curScene = scene
		release.setRange(0, scene.seconds ?? 4.5)
		setText(sceneLabel, scene.name ?? "")
		sceneName.dataset.was = scene.name ?? ""
		if (!sceneTyping.on && sceneName.value !== sceneName.dataset.was) sceneName.value = sceneName.dataset.was
		seconds.set(scene.seconds ?? 4.5)
		release.set(scene.release ?? 0.5)
		renderItems(scene, selectedId)
		renderSelected(scene, selectedId, resolved)
	}

	return { render }
}
