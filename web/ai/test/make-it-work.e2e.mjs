// "Looking for a fix…" on the real app, as a person uses it (headless Chromium against a running local server; it never starts or stops one):
// the user's breakfast edit with the edit step's answer stood in for by request routing (no model call; the physics, the fix search and the
// stage-by-stage search are the real ones, on the page's fix workers). ai/DESIGN.md §16.
//   1. what it is doing shows and changes while it looks ("· 42 physics runs");
//   2. its Stop stops it: "I stopped looking for a fix." with the button, and no unhandled rejection;
//   3. the card's Undo while it looks: the search stops, "You undid this change, so I stopped looking for a fix.", no offer for the gone scene;
//   4. the checked fix offered, clicked: the fix card lists each change (the closed laptop); its Undo puts the edit back and the edit card is the
//      live one again (its checked chip shows, the fix card offers Restore), and "yes" puts the fix back;
//   5. a double click on the checked fix applies it once; 6. no "Check it" beside a checked fix; 7. both undone: every card stale, "yes" asks
//      nothing (ai/DESIGN.md §16.2); 8–13 the paid button once, Undo while the AI works, a rename by hand, Look again; 14. a rework stopped
//      by its Cancel and asked again: no "Run again", no second paid button; 15. a search stopped by an Undo, its scene back by Redo: "Look
//      again" and the button, and "yes" spends nothing (§16.3); 16. a question after the checked offer: the card stays live with its
//      chip, the answer shows it too, and "yes" / "make it work" apply it with no AI call; "make it work" on a scene that works, or right
//      after a failed rework, asks nothing; a "yes" after a stopped search puts the fix on when found (§16.5); 17. "make it work without
//      touching the box" never moves the box; 18. a question that asks for another way, then "yes": the table never changes, and "yes" goes to
//      the AI as what the answer proposed; 19. a question while it looks never stops the search; 20. a question back with choices, then "yes":
//      "Which one?", nothing spent; 21. a question that keeps the box, then "yes": "make it work" with the box kept; 22. "could I fix it by
//      tilting the seesaw more instead?", then "yes": that way asked for (§16.6).
//   node web/ai/test/make-it-work.e2e.mjs [--base http://localhost:8790] [outDir]
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const EXE = "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const bi = process.argv.indexOf("--base")
const BASE = bi > 0 ? process.argv[bi + 1] : "http://localhost:8790"
const OUT = path.resolve(process.argv.filter((a, i) => i > 1 && a !== "--base" && process.argv[i - 1] !== "--base")[0] ?? path.join(os.tmpdir(), "ai-make-it-work-e2e"))
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
const checks = []
const ok = (name, cond, detail = "") => (checks.push({ name, ok: !!cond, detail }), console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`))

/** The edit step's answer to the user's request (a recorded live answer: six standing soda cans where the dominoes stood, full). */
const BREAKFAST = {
	kind: "change",
	mode: "patch",
	why: "They asked to swap, replace and add items on screen.",
	reply: "I swapped the red ball for an orange and the yellow ball for an egg, replaced the dominoes with six standing soda cans, and put a rubber duck in the box.",
	targets: [{ says: "the red ball", ids: ["ball1"] }, { says: "the yellow ball", ids: ["ball2"] }, { says: "the dominoes", ids: ["dominoes"] }, { says: "the box", ids: ["box"] }],
	patches: [
		{ op: "replace_type", id: "ball1", type: "orange", props: {} },
		{ op: "set_item", id: "ball1", name: "Orange" },
		{ op: "replace_type", id: "ball2", type: "egg", props: {} },
		{ op: "set_item", id: "ball2", name: "Egg" },
		{ op: "remove", id: "dominoes" },
		...Array.from({ length: 6 }, (_, k) => ({ op: "add", item: { id: `can${k + 1}`, type: "soda-can", name: `Soda can ${k + 1}`, props: {}, place: { on: "table", x: Math.round((1.86 + 0.1 * k) * 100) / 100 } } })),
		{ op: "add", item: { id: "duck", type: "rubber-duck", name: "Rubber duck", props: {}, place: { on: "box", inside: "box" } } },
		{ op: "set_scene", title: "Breakfast-table disaster" }
	],
	missing: [],
	suggestions: [{ label: "Add a falling cereal box", prompt: "Add a cereal box after the soda cans that topples onto the seesaw" }]
}
const USER = "Turn this into a breakfast-table disaster: swap the red ball for an orange and the yellow ball for an egg, replace the dominoes with a row of standing soda cans, and put a rubber duck in the box waiting for its egg."

async function page() {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
	const edits = []
	// (the edit step answers at once; any other AI step (a background rework) is refused, so nothing is spent)
	await p.route("**/api/ai/edit", async (r) => {
		let body = {}
		try {
			body = JSON.parse(r.request().postData() ?? "{}")
		} catch {}
		edits.push(String(body.payload?.text ?? ""))
		const first = edits.length === 1 || body.payload?.text === USER
		return r.fulfill(first ? { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: BREAKFAST, model: "mock/edit", ms: 5 }) } : { status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", error: "no AI in this test", retryable: false }) })
	})
	const profile = `mw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
	await p.goto(`${BASE}/?profile=${profile}`, { waitUntil: "domcontentloaded" })
	await p.waitForFunction(() => !document.querySelector("#new")?.disabled && window.sandbox?.scene && window.sandbox?.sim, null, { timeout: 90000 })
	await p.waitForTimeout(1500)
	await p.click("#ai")
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 30000 })
	await p.evaluate(() => {
		window.__fixline = []
		new MutationObserver(() => {
			const t = document.querySelector(".ai-fixline")?.textContent?.replace(/\s+/g, " ").trim()
			if (t && window.__fixline.at(-1) !== t) window.__fixline.push(t)
		}).observe(document.querySelector(".ai-thread"), { subtree: true, childList: true, characterData: true })
	})
	return { p, ctx, errors, edits }
}
const send = async (p, text) => (await p.fill(".ai-input", text), await p.press(".ai-input", "Enter"))
const searching = (p) => p.waitForFunction(() => !!document.querySelector("li.ai-bot:last-of-type .ai-fixline"), null, { timeout: 60000 })
const lastLead = (p) => p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].at(-1)?.querySelector(".ai-lead, .ai-reply > p")?.textContent.replace(/\s+/g, " ").trim() ?? null)
const shot = (p, name) => p.locator(".ai-thread").screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {})

// ---- 1 and 2: the line says what it does, and its Stop stops it
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => (window.__fixline ?? []).some((t) => /physics runs/.test(t)), null, { timeout: 20000 }).catch(() => {})
	const lines = await p.evaluate(() => window.__fixline)
	ok("1. 'Looking for a fix…' says what it is doing, and it changes", lines.some((t) => /· \d+ physics runs/.test(t)) && new Set(lines).size >= 2, lines.slice(0, 4).join(" | "))
	ok("2. the line has a Stop", await p.locator("li.ai-bot").last().locator(".ai-fixstop").isVisible())
	await p.locator("li.ai-bot").last().locator(".ai-fixstop").click()
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 5000 }).catch(() => {})
	const lead = await lastLead(p)
	ok("2. stopped: said so, with the button that asks the AI", /I stopped looking for a fix\./.test(lead ?? "") && (await p.locator("li.ai-bot").last().locator(".ai-offer-btn").first().isVisible()), lead)
	await p.waitForTimeout(1500)
	ok("2. no page errors (no unhandled 'Cancelled')", !errors.length, errors.join(" | "))
	await shot(p, "2-stopped")
	await ctx.close()
}
// ---- 3: the card's Undo while it looks
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.locator("li.ai-bot").last().locator(".ai-undo").click()
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 3000 }).catch(() => {})
	const gone = await p.evaluate(() => !document.querySelector(".ai-fixline"))
	const lead = await lastLead(p)
	ok("3. undo while it looks: the search stops at once", gone)
	ok("3. said so, with nothing offered for the undone scene", /You undid this change, so I stopped looking for a fix\./.test(lead ?? "") && !(await p.locator("li.ai-bot").last().locator(".ai-chips button.go, .ai-offer-btn").count()), lead)
	ok("3. the starter is back on the table", await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row")))
	ok("3. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "3-undone")
	await ctx.close()
}
// ---- 4: the fix, its card, its Undo, and "yes"
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const editScene = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	ok("4. a checked fix is offered", (await go.count()) === 1, await lastLead(p))
	if ((await go.count()) === 1) {
		await go.click()
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 1, { timeout: 30000 })
		await p.waitForTimeout(1500)
		const delta = await p.evaluate(() => [...[...document.querySelectorAll("li.ai-bot")].at(-1).querySelectorAll(".ai-delta li")].map((li) => li.textContent.trim()))
		ok("4. the fix card lists each change (what it added among them)", delta.length >= 1 && delta.some((d) => /^Added|^Stood|laptop|cutting board/i.test(d)), delta.join(" | "))
		await p.locator("li.ai-bot").last().locator(".ai-undo").click()
		await p.waitForTimeout(1200)
		const back = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
		ok("4. the fix card's Undo puts the edit's scene back", back === editScene)
		const st = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].map((li) => ({ stale: li.classList.contains("ai-stale"), go: !!li.querySelector(".ai-chips button.go"), restore: !!li.querySelector(".ai-restore:not([hidden])"), undo: !!li.querySelector(".ai-undo:not([hidden])") })))
		ok("4. the edit card is the live one again, its checked chip there", st.length === 2 && !st[0].stale && st[0].go, JSON.stringify(st))
		ok("4. the fix card is stale and offers Restore; the edit card offers no Restore", st[1]?.stale && st[1]?.restore && !st[0].restore, JSON.stringify(st))
		await send(p, "yes")
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 2, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		ok("4. 'yes' puts the checked fix back", /^Done — I /.test(lead ?? "") && (await p.evaluate(() => window.sandbox.scene.items.some((i) => /^standin/.test(i.id)))), lead)
	}
	ok("4. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "4-fix-undo-yes")
	await ctx.close()
}
// ---- 5: a double click on the checked fix puts it on the table once (the second click never lands on the Restore that slid under the pointer)
// ---- 6: "Check it" is not offered beside a checked fix
{
	const { p, ctx, errors, edits } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const editScene = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
	const foot = await p.evaluate(() => [...[...document.querySelectorAll("li.ai-bot")].at(-1).querySelectorAll(".ai-foot button")].filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.textContent.trim()))
	ok("6. no 'Check it' beside a checked fix (V8817 s6: it threw the fix away)", !foot.some((t) => /Check/.test(t)), foot.join(" | "))
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	if ((await go.count()) === 1) {
		await go.dblclick()
		await p.waitForTimeout(3000)
		const st = await p.evaluate(() => ({ bots: [...document.querySelectorAll("li.ai-bot")].map((li) => li.classList.contains("ai-stale")), standin: window.sandbox.scene.items.some((i) => /^standin/.test(i.id)) }))
		const now = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
		ok("5. a double click applies the fix once and keeps it (V8817 s5b)", st.standin && now !== editScene && st.bots.length === 2 && st.bots[1] === false, JSON.stringify(st))
		// ---- 7: the edit undone (the top bar's Undo twice: the fix, then the edit): no card is live, nothing offered, and "yes" asks nothing
		await p.click("#undo")
		await p.waitForTimeout(800)
		await p.click("#undo")
		await p.waitForTimeout(1500)
		const back = await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row"))
		const cards = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].map((li) => ({ stale: li.classList.contains("ai-stale"), goVisible: [...li.querySelectorAll(".ai-chips button")].some((b) => getComputedStyle(b).display !== "none" && b.getClientRects().length > 0) })))
		ok("7. back to the starter: every card is stale, no chip or offer shows for a scene that is gone (V8817 s3e / s1)", back && cards.every((c) => c.stale && !c.goVisible), JSON.stringify(cards))
		await send(p, "yes")
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		ok("7. 'yes' then asks nothing and changes nothing", /nothing to say yes to/i.test(lead ?? "") && (await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row"))), lead)
		// (and "make it work" on the starter, which works: said, no AI call (V8837 z5))
		const n7 = edits.length
		await send(p, "make it work again")
		await p.waitForTimeout(1500)
		const lead7 = await lastLead(p)
		ok("7. 'make it work' on a scene that already works: said, no AI call", /^It already works: .+ ✓$/.test(lead7 ?? "") && edits.length === n7, `${lead7} / ${n7} → ${edits.length}`)
	} else ok("5. a checked fix is offered to double-click", false, await lastLead(p))
	ok("5–7. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "5-double-click")
	await ctx.close()
}
const p14 = { again: false }
// ---- 8–14 (the review of §16.2, r2-problems): the paid button once, Undo while the AI works, a rename by hand, Look again, the one-line search
/** A page whose edit step answers from `answer(payload, n)` (n: the edit call's number from 1; null: refused as "no AI in this test"); each
 *  call's start, whether it was stopped, and its words are kept. */
async function pageWith(answer, { delayMs = () => 0 } = {}) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
	const calls = []
	await p.route("**/api/ai/edit", async (r) => {
		let body = {}
		try {
			body = JSON.parse(r.request().postData() ?? "{}")
		} catch {}
		const c = { n: calls.length + 1, at: Date.now(), text: String(body.payload?.text ?? ""), feedback: !!body.payload?.feedback }
		calls.push(c)
		const wait = delayMs(body.payload ?? {}, c.n)
		if (wait) await new Promise((res) => setTimeout(res, wait))
		const a = answer(body.payload ?? {}, c.n)
		return r.fulfill(a ? { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: a, model: "mock/edit", ms: 5, usage: { costInUSD: 0 } }) } : { status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", error: "no AI in this test", retryable: false }) }).catch(() => {})
	})
	p.on("requestfailed", (req) => {
		if (!/\/api\/ai\/edit/.test(req.url())) return
		const c = [...calls].reverse().find((x) => !x.failed)
		if (c) c.failed = req.failure()?.errorText ?? "failed"
	})
	const profile = `mw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
	await p.goto(`${BASE}/?profile=${profile}`, { waitUntil: "domcontentloaded" })
	await p.waitForFunction(() => !document.querySelector("#new")?.disabled && window.sandbox?.scene && window.sandbox?.sim, null, { timeout: 90000 })
	await p.waitForTimeout(1500)
	await p.click("#ai")
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 30000 })
	return { p, ctx, errors, calls }
}
const cardsNow = (p) =>
	p.evaluate(() =>
		[...document.querySelectorAll("li.ai-bot")].map((li) => {
			const vis = (el) => !!el && !el.closest("[hidden]") && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none"
			return { stale: li.classList.contains("ai-stale"), lead: (li.querySelector(".ai-lead") ?? li.querySelector(".ai-reply > p"))?.textContent.replace(/\s+/g, " ").trim() ?? "", btn: [...li.querySelectorAll(".ai-offer-btn, .ai-again-btn")].filter(vis).map((b) => b.textContent.trim()), chips: [...li.querySelectorAll(".ai-chips button")].filter(vis).map((b) => b.textContent.trim()) }
		})
	)
const doneAfter = (p, n0, ms = 240000) => p.waitForFunction((n0) => { const lis = [...document.querySelectorAll("li.ai-bot")]; if (lis.length <= n0) return false; const li = lis.at(-1); return !!li.querySelector(".ai-card:not(.ai-progress)") && !li.querySelector(".ai-fixline") }, n0, { timeout: ms, polling: 250 })
/** "make the box twice as wide", as the edit step answered it live (VERIFY box-wider-answer.json): the box 52 cm wide, Ball 2 no longer lands. */
const WIDER = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", why: "They asked to resize one item.", reply: "I made the box twice as wide (26 cm → 52 cm).", patches: [{ op: "set_props", id: "box", props: { width: 0.52 } }], missing: [], suggestions: [{ label: "Swap in a bouncier ball", prompt: "Swap the yellow ball on the seesaw for a superball" }, { label: "Add more dominoes", prompt: "Add 3 more dominoes to the domino row" }] }
/** A rework that doesn't work (the box 9.7 cm right: Ball 2 still misses). */
const MISS = { kind: "fix", mode: "patch", targets: [{ says: "the box", ids: ["box"] }], why: "make it work", reply: "I moved the box 9.7 cm right.", patches: [{ op: "move", id: "box", dx: 0.097 }], missing: [], suggestions: [] }
// ---- 8: "Ask the AI to rework it" pressed once: it fails, and the older card shows no button or chips any more (VERIFY regress-r2: a second paid
// rework, two "didn't work either" cards)
{
	let open = false // (the background reworks are refused; the button's own calls get the rework that misses)
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null))
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = p.locator("li.ai-bot").last().locator(".ai-offer-btn")
	ok("8. the edit card offers the rework button", (await btn.count()) === 1, await lastLead(p))
	if ((await btn.count()) === 1) {
		open = true
		await btn.click()
		await doneAfter(p, 1)
		await p.waitForTimeout(1500)
		const cards = await cardsNow(p)
		const either = cards.filter((c) => /didn’t work either|didn't work either|still doesn’t work/.test(c.lead))
		ok("8. after the rework fails, no earlier card shows a button or chips", cards.slice(0, -1).every((c) => !c.btn.length && !c.chips.length) && cards[0].stale, JSON.stringify(cards))
		ok("8. one 'didn't work either' card, and it offers no paid button again", either.length === 1 && !cards.at(-1).btn.includes("Ask the AI to rework it"), JSON.stringify(cards.map((c) => [c.lead.slice(0, 80), c.btn])))
		const n = calls.length
		await p.locator("li.ai-bot").first().locator(".ai-offer-btn").click({ force: true, timeout: 2000 }).catch(() => {})
		await p.waitForTimeout(1500)
		ok("8. the older card's button can't send another rework", calls.length === n, `${n} → ${calls.length}`)
		// (a typed "make it work again" right after that rework failed on this scene: said again, no AI call (V8837 z7 / y5 / y20))
		await send(p, "make it work again")
		await p.waitForTimeout(1500)
		const lead8 = await lastLead(p)
		ok("8. 'make it work again' right after the failed rework: said, no AI call", /^The AI already tried to rework this, and it didn’t work/.test(lead8 ?? "") && calls.length === n, `${lead8} / ${n} → ${calls.length}`)
	}
	ok("8. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "8-rework-once")
	await ctx.close()
}
// ---- 9: the top bar's Undo while an edit is being worked on: it stops, and its result never puts the undone change back (V8820 x13)
{
	const MOVE = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "I moved the box 5 cm left.", patches: [{ op: "move", id: "box", dx: -0.05 }], missing: [], suggestions: [] }
	const WIDE2 = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "I made the box 2 cm wider.", patches: [{ op: "set_props", id: "box", props: { width: 0.28 } }], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? MOVE : n === 2 ? WIDE2 : null), { delayMs: (pl, n) => (n === 2 ? 4000 : 0) })
	const box0 = await p.evaluate(() => window.sandbox.scene.items.find((i) => i.id === "box").x)
	await send(p, "Move the box 5 cm left.")
	await doneAfter(p, 0, 60000)
	await p.waitForTimeout(1200)
	// (a change that works folds the drawer to its chip: opened again, as a person would)
	if (!(await p.locator(".ai-input").isVisible())) await p.locator(".ai-mini .ai-primary").click().catch(() => p.click("#ai"))
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 10000 })
	await send(p, "Make the box 2 cm wider.")
	await p.waitForTimeout(1500)
	await p.click("#undo")
	await p.waitForTimeout(6000)
	const st = await p.evaluate(() => ({ box: window.sandbox.scene.items.find((i) => i.id === "box"), n: document.querySelectorAll("li.ai-bot").length }))
	const lead = await lastLead(p)
	ok("9. Undo while the AI works: it stops, and says so", /You undid the change while I worked, so I stopped/.test(lead ?? ""), lead)
	ok("9. nothing it made goes on the table: the box is back where it started, its width as it was", Math.abs(st.box.x - box0) < 1e-6 && !(st.box.props?.width > 0.27), JSON.stringify(st.box))
	ok("9. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "9-undo-while-working")
	await ctx.close()
}
// ---- 10: a rename by hand keeps the checked offer, and "yes" applies it, keeping the new name (V8820 x10)
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	if ((await go.count()) === 1) {
		await p.evaluate(() => window.sandboxApp.rename("Breakfast disaster"))
		await p.waitForTimeout(1500)
		const st = await cardsNow(p)
		ok("10. renamed by hand: the edit card is still the live one, its checked chip there", !st[0].stale && st[0].chips.length >= 1, JSON.stringify(st))
		await send(p, "yes")
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 1, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		const sc = await p.evaluate(() => ({ name: window.sandbox.scene.name, standin: window.sandbox.scene.items.some((i) => /^standin/.test(i.id)) }))
		ok("10. 'yes' applies the checked fix, and the name given by hand stays", /^Done — I /.test(lead ?? "") && sc.standin && sc.name === "Breakfast disaster", `${lead} / ${JSON.stringify(sc)}`)
	} else ok("10. a checked fix is offered", false, await lastLead(p))
	ok("10. no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
// ---- 11: the card's Undo while "Ask the AI to rework it" is being worked on: stopped, no second call, no "Try:" for the undone scene (V8820 x12)
{
	let open = false
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null), { delayMs: () => (open ? 5000 : 0) })
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = p.locator("li.ai-bot").last().locator(".ai-offer-btn")
	if ((await btn.count()) === 1) {
		open = true
		await btn.click()
		await p.waitForTimeout(1500)
		await p.click("#undo")
		await p.waitForTimeout(1500)
		const nAt = calls.length
		await p.waitForTimeout(8000)
		const cards = await cardsNow(p)
		const lead = cards.at(-1)?.lead ?? ""
		ok("11. Undo during the rework: stopped and said so", /undid the change while I worked/.test(lead), lead)
		ok("11. no call after the Undo, and nothing offered for the undone scene", calls.length === nAt && cards.every((c) => !c.chips.some((x) => /^Try:/.test(x))), `${nAt} → ${calls.length} / ${JSON.stringify(cards)}`)
		ok("11. the table is the starter's", await p.evaluate(() => Math.abs(window.sandbox.scene.items.find((i) => i.id === "box").props?.width ?? 0.26) < 0.3))
	} else ok("11. the edit card offers the rework button", false, await lastLead(p))
	ok("11. no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
// ---- 12 and 13: after its Stop, "Look again" runs the physics search again (no AI) and finds the fix; the line is one row in the drawer
{
	const { p, ctx, errors, edits } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForTimeout(1500)
	const h = await p.evaluate(() => {
		const el = document.querySelector(".ai-fixline")
		const t = el?.querySelector(".ai-fixline-t")
		return { h: el?.getBoundingClientRect().height ?? 0, lh: parseFloat(getComputedStyle(el).lineHeight) || 20, stopTop: el?.querySelector(".ai-fixstop")?.getBoundingClientRect().top ?? 0, top: t?.getBoundingClientRect().top ?? 0, w: el?.getBoundingClientRect().width ?? 0 }
	})
	ok("13. 'Looking for a fix…' is one row, its Stop on it (V8820: three cramped columns)", h.h > 0 && h.h <= 2 * h.lh && Math.abs(h.stopTop - h.top) < 12, JSON.stringify(h))
	await p.locator("li.ai-bot").last().locator(".ai-fixstop").click()
	await p.waitForTimeout(800)
	const again = p.locator("li.ai-bot").last().locator(".ai-again-btn")
	ok("12. after its Stop, the card offers 'Look again'", (await again.count()) === 1, await lastLead(p))
	if ((await again.count()) === 1) {
		const n = edits.length
		await again.click()
		await searching(p).catch(() => {})
		await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
		const go = await p.locator("li.ai-bot").last().locator(".ai-chips button.go").count()
		ok("12. 'Look again' finds the checked fix with the physics, no AI call", go === 1 && edits.length === n, `${await lastLead(p)} / calls ${n} → ${edits.length}`)
	}
	ok("12. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "12-look-again")
	await ctx.close()
}
// ---- 14: "Ask the AI to rework it", stopped by its Cancel, then asked again from the card and failing: no card offers "Run again" or the paid
// button after it (V8832 y14 / y15: the cancelled card's "Run again" sent a third rework after the second failed, $0.13 more)
{
	let open = false
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null), { delayMs: () => (open && !p14.again ? 6000 : 0) })
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = () => p.locator("li.ai-bot").first().locator(".ai-offer-btn")
	if ((await btn().count()) === 1) {
		open = true
		await btn().click()
		await p.waitForTimeout(2500)
		await p.locator("li.ai-bot").last().locator(".ai-chip-btn", { hasText: "Cancel" }).click()
		await p.waitForTimeout(1500)
		const runAgain = await p.locator("li.ai-bot button", { hasText: "Run again" }).count()
		ok("14. a stopped rework offers no 'Run again' of its own; the edit card's button is back", runAgain === 0 && (await btn().isVisible()), `${runAgain} / ${JSON.stringify(await cardsNow(p))}`)
		p14.again = true
		const n0 = await p.locator("li.ai-bot").count()
		await btn().click()
		await doneAfter(p, n0)
		await p.waitForTimeout(1500)
		const cards = await cardsNow(p)
		const visRun = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot button")].filter((b) => /Run again|Try again|Ask the AI to rework it/.test(b.textContent) && b.getClientRects().length > 0 && getComputedStyle(b).display !== "none" && !b.closest("[hidden]")).map((b) => b.textContent.trim()))
		ok("14. after the second rework fails, no card shows 'Run again' or the paid button", !visRun.length && /didn’t work either|didn't work either/.test(cards.at(-1)?.lead ?? ""), `${JSON.stringify(visRun)} / ${cards.at(-1)?.lead}`)
		const n = calls.length
		await p.locator("li.ai-bot button", { hasText: "Run again" }).first().click({ force: true, timeout: 2000 }).catch(() => {})
		await p.waitForTimeout(1500)
		ok("14. a hidden 'Run again' sends nothing", calls.length === n, `${n} → ${calls.length}`)
	} else ok("14. the edit card offers the rework button", false, await lastLead(p))
	ok("14. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "14-cancel-then-again")
	await ctx.close()
}
// ---- 15: the search stopped because another scene was opened, then the top bar's Undo back to the edit: its card offers "Look again" and
// the button again, and a "yes" spends nothing (V8832 y7: a dead end, and "yes" sent a paid rework)
{
	const { p, ctx, errors, edits } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForTimeout(1200)
	// (the edit undone by the top bar while it looks, then redone: the scene it was for is back)
	await p.click("#undo")
	await p.waitForTimeout(1500)
	await p.click("#redo")
	await p.waitForTimeout(1500)
	const c = (await cardsNow(p))[0]
	ok("15. back on the table: the card says it stopped, with 'Look again' and the button", !c.stale && c.btn.includes("Look again") && c.btn.includes("Ask the AI to rework it"), JSON.stringify(c))
	const n = edits.length
	await send(p, "yes")
	await p.waitForTimeout(1500)
	ok("15. 'yes' then looks again with the physics, no AI call", edits.length === n && (await p.evaluate(() => !!document.querySelector(".ai-fixline"))), `${n} → ${edits.length}`)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
	await p.waitForTimeout(1500)
	// (the "yes" was a yes to the fix: it goes on the table when found, no second "yes" (V8837 x9 / z2 / y7))
	const lead15 = await lastLead(p)
	ok("15. the fix it finds goes on the table, no second 'yes' needed", /^Done — I /.test(lead15 ?? "") && (await p.evaluate(() => window.sandbox.scene.items.some((i) => /^standin/.test(i.id)))) && edits.length === n, lead15)
	ok("15. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "15-undo-redo-look-again")
	await ctx.close()
}
// ---- 16: a question after the checked offer (V8838 Q: the card went stale with its chip, the answer had none, "yes" said there was nothing to
// say yes to, and "make it work" went to the AI)
{
	const Q = "why does the egg never land in the box?"
	const ANSWER = { kind: "answer", mode: "patch", targets: [], why: "a question", reply: "The orange only shoves the first soda can, so the egg never moves.", patches: [], missing: [], suggestions: [{ label: "Make the box wider", prompt: "Make the box wider" }] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === USER && !pl.feedback ? BREAKFAST : pl.text === Q ? ANSWER : null))
	const replied = (n0) => p.waitForFunction((n0) => { const lis = [...document.querySelectorAll("li.ai-bot")]; if (lis.length <= n0) return false; const li = lis.at(-1); return !!li.querySelector(".ai-card:not(.ai-progress), .ai-reply") && !li.querySelector(".ai-fixline") && !li.classList.contains("ai-s-running") }, n0, { timeout: 120000, polling: 250 })
	const standin = () => p.evaluate(() => window.sandbox.scene.items.some((i) => /^standin/.test(i.id)))
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const go0 = await p.locator("li.ai-bot").last().locator(".ai-chips button.go").count()
	ok("16. a checked fix is offered", go0 === 1, await lastLead(p))
	if (go0 === 1) {
		await send(p, Q)
		await replied(1)
		await p.waitForTimeout(1200)
		const cards = await cardsNow(p)
		// (the chip shows once, on the newest live card: the answer; the edit card stays live, its offer in words: V8842)
		ok("16. after the question the edit card is still live, and the answer shows its checked chip (once, not twice)", cards.length === 2 && !cards[0].stale && cards[1].chips.length >= 1 && !cards[0].chips.includes(cards[1].chips[0]) && /Want me to/.test(cards[0].lead), JSON.stringify(cards))
		const n = calls.length
		await send(p, "yes")
		await p.waitForFunction(() => /^Done — I /.test([...document.querySelectorAll("li.ai-bot")].at(-1)?.querySelector(".ai-lead")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1200)
		const lead = await lastLead(p)
		ok("16. 'yes' after the question puts the checked fix on the table, no AI call", /^Done — I /.test(lead ?? "") && (await standin()) && calls.length === n, `${lead} / ${n} → ${calls.length}`)
		// (the fix card's Undo, the question again, then "make it work")
		await p.locator("li.ai-bot").last().locator(".ai-undo").click()
		await p.waitForTimeout(1500)
		const nb = await p.locator("li.ai-bot").count()
		await send(p, Q)
		await replied(nb)
		await p.waitForTimeout(1200)
		const m = calls.length
		await send(p, "make it work")
		await p.waitForFunction(() => /^Done — I /.test([...document.querySelectorAll("li.ai-bot")].at(-1)?.querySelector(".ai-lead")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1200)
		const lead2 = await lastLead(p)
		ok("16. 'make it work' after a question puts the checked fix on the table, no AI call", /^Done — I /.test(lead2 ?? "") && (await standin()) && calls.length === m, `${lead2} / ${m} → ${calls.length}`)
	}
	ok("16. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "16-question-then-yes")
	await ctx.close()
}
// ---- 17–20 (V8842 / V8843, ai/DESIGN.md §16.6): what the person said to keep is kept; a "yes" is to the latest reply's own offer
/** The starter's swap as the edit step answered it live (V8842 QB): the tennis ball then hits the side of the box; lowering it 5 cm works. */
const SWAP_T = "replace the yellow ball with a tennis ball and the red ball with a basketball"
const SWAP = { kind: "change", mode: "patch", why: "They asked to swap two balls.", reply: "I swapped the yellow ball on the seesaw for a tennis ball and the red ball at the top for a basketball.", targets: [{ says: "the yellow ball", ids: ["ball2"] }, { says: "the red ball", ids: ["ball1"] }], patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball", props: {} }, { op: "set_item", id: "ball2", name: "Tennis ball" }, { op: "replace_type", id: "ball1", type: "basketball", props: {} }, { op: "set_item", id: "ball1", name: "Basketball" }], missing: [], suggestions: [] }
const boxAt = (p) => p.evaluate(() => { const b = window.sandbox.scene.items.find((i) => i.id === "box"); return { x: b.x, y: b.y, props: JSON.stringify(b.props ?? {}) } })
const replied = (p, n0, ms = 150000) => p.waitForFunction((n0) => { const lis = [...document.querySelectorAll("li.ai-bot")]; if (lis.length <= n0) return false; const li = lis.at(-1); return !!li.querySelector(".ai-card:not(.ai-progress), .ai-reply") && !li.querySelector(".ai-fixline") && !li.classList.contains("ai-s-running") }, n0, { timeout: ms, polling: 250 })
// ---- 17: "make it work without touching the box" after the swap: the box stays where it is (the AI's answer lowers it anyway: refused)
{
	const KEEP = "make it work without touching the box"
	const LOWER = { kind: "fix", mode: "patch", why: "make it work", reply: "I lowered the box 5 cm.", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "move", id: "box", dy: -0.05 }], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === SWAP_T && !pl.feedback ? SWAP : pl.text === KEEP && !pl.feedback ? LOWER : null))
	await send(p, SWAP_T)
	await replied(p, 0)
	const box0 = await boxAt(p)
	const n0 = await p.locator("li.ai-bot").count()
	await send(p, KEEP)
	await replied(p, n0, 150000)
	await p.waitForTimeout(1500)
	const box1 = await boxAt(p)
	const lead = await lastLead(p)
	ok("17. 'make it work without touching the box': the box stays where it is, its size too", box1.x === box0.x && box1.y === box0.y && box1.props === box0.props, `${JSON.stringify(box0)} → ${JSON.stringify(box1)} · ${lead}`)
	ok("17. the card never says it moved or lowered the box", !/(moved|lowered|raised) the box/i.test(lead ?? "") && !(await p.locator("li.ai-bot").last().locator(".ai-delta li", { hasText: /the box/i }).count()), lead)
	ok("17. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "17-keep-the-box")
	await ctx.close()
}
// ---- 18: a question that asks for another way, then "yes": the checked fix that moves the box is not applied; "yes" goes to the AI as what
// the answer proposed
{
	const Q = "could I fix it by tilting the seesaw more instead?"
	const ANS = { kind: "answer", mode: "patch", why: "a question", reply: "Possibly. The tennis ball now hits the box's right wall, so more tilt (about 12° → 20°) would fling it higher.", targets: [], patches: [], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === SWAP_T && !pl.feedback ? SWAP : pl.text === Q ? ANS : null))
	await send(p, SWAP_T)
	await replied(p, 0)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
	const go0 = await p.locator("li.ai-bot").last().locator(".ai-chips button.go").count()
	ok("18. the swap gets its checked offer", go0 === 1, await lastLead(p))
	const box0 = await boxAt(p)
	const n0 = await p.locator("li.ai-bot").count()
	await send(p, Q)
	await replied(p, n0)
	await p.waitForTimeout(1000)
	const m = calls.length
	const n1 = await p.locator("li.ai-bot").count()
	await send(p, "yes")
	await replied(p, n1, 60000).catch(() => {})
	await p.waitForTimeout(1500)
	const box1 = await boxAt(p)
	const sent = calls.slice(m).map((c) => c.text)
	ok("18. 'yes' after 'instead?' never lowers the box", box1.x === box0.x && box1.y === box0.y, `${JSON.stringify(box0)} → ${JSON.stringify(box1)}`)
	ok("18. 'yes' goes to the AI as the change the answer proposed", sent.length >= 1 && /^Yes, do that: .*more tilt/.test(sent[0]), JSON.stringify(sent))
	ok("18. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "18-instead-then-yes")
	await ctx.close()
}
// ---- 19: a question while the search looks: the search goes on, and its checked fix is offered (V8842 qj: "I stopped looking for a fix")
{
	const Q = "why doesn't the egg move?"
	const ANSWER = { kind: "answer", mode: "patch", targets: [], why: "a question", reply: "The orange only shoves the first soda can, so the egg never moves.", patches: [], missing: [], suggestions: [] }
	const { p, ctx, errors } = await pageWith((pl) => (pl.text === USER && !pl.feedback ? BREAKFAST : pl.text === Q ? ANSWER : null))
	await send(p, USER)
	await searching(p)
	await p.waitForTimeout(800)
	await send(p, Q)
	await replied(p, 1, 60000).catch(() => {})
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 150000 }).catch(() => {})
	await p.waitForTimeout(1500)
	const cards = await cardsNow(p)
	ok("19. a question while it looks never stops the search ('I stopped looking' never said)", !cards.some((c) => /stopped looking/.test(c.lead)), JSON.stringify(cards.map((c) => c.lead.slice(0, 90))))
	ok("19. its checked fix is offered once found, on the newest card", cards.some((c) => !c.stale && c.chips.length >= 1) && /Want me to/.test(cards[0].lead), JSON.stringify(cards))
	ok("19. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "19-question-while-looking")
	await ctx.close()
}
// ---- 20: a question back with choices of its own, then "yes": "Which one?", nothing spent, nothing changed (V8842 qq / qr)
{
	const B = "make it bigger"
	const ASK = { kind: "ask", mode: "patch", targets: [{ says: "it", ids: ["box", "ball2"] }], why: "ambiguous", reply: "Which should I make bigger: the box on the seesaw, or the tennis ball?", patches: [], missing: [], suggestions: [{ label: "Bigger box", prompt: "Make the box on the seesaw bigger" }, { label: "Bigger tennis ball", prompt: "Make the tennis ball bigger" }] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === SWAP_T && !pl.feedback ? SWAP : pl.text === B ? ASK : null))
	await send(p, SWAP_T)
	await replied(p, 0)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
	const box0 = await boxAt(p)
	const n0 = await p.locator("li.ai-bot").count()
	await send(p, B)
	await replied(p, n0)
	const m = calls.length
	await send(p, "yes")
	await p.waitForTimeout(2000)
	const lead = await lastLead(p)
	const box1 = await boxAt(p)
	const chips = (await cardsNow(p)).at(-1)?.chips ?? []
	ok("20. 'yes' to a question back: 'Which one?', its choices again, no AI call, nothing changed", /^Which one\?/.test(lead ?? "") && calls.length === m && box1.y === box0.y && chips.includes("Bigger box"), `${lead} / ${m} → ${calls.length} / ${JSON.stringify(chips)}`)
	ok("20. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "20-ask-then-yes")
	await ctx.close()
}
// ---- 21: "is there a way to fix it without touching the box?", answered, then "yes": a "make it work" with the box kept (V8842 ql / qa)
{
	const Q = "is there a way to fix it without touching the box?"
	const ANS = { kind: "answer", mode: "patch", why: "a question", reply: "Yes. The tennis ball peaks at 34 cm, just over the 32 cm rim, so it clips the wall.", targets: [], patches: [], missing: [], suggestions: [] }
	const LOWER = { kind: "fix", mode: "patch", why: "make it work", reply: "I lowered the box 5 cm.", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "move", id: "box", dy: -0.05 }], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === SWAP_T && !pl.feedback ? SWAP : pl.text === Q ? ANS : /^make it work, without touching the box$/.test(pl.text) && !pl.feedback ? LOWER : null))
	await send(p, SWAP_T)
	await replied(p, 0)
	const box0 = await boxAt(p)
	const n0 = await p.locator("li.ai-bot").count()
	await send(p, Q)
	await replied(p, n0)
	const m = calls.length
	const n1 = await p.locator("li.ai-bot").count()
	await send(p, "yes please")
	await replied(p, n1, 150000).catch(() => {})
	await p.waitForTimeout(1500)
	const box1 = await boxAt(p)
	const sent = calls.slice(m).map((c) => c.text)
	ok("21. 'yes' to 'is there a way … without touching the box?' asks for it to work with the box kept", sent[0] === "make it work, without touching the box", JSON.stringify(sent))
	ok("21. and the box stays where it is", box1.x === box0.x && box1.y === box0.y && box1.props === box0.props, `${JSON.stringify(box0)} → ${JSON.stringify(box1)} · ${await lastLead(p)}`)
	ok("21. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "21-keep-question-then-yes")
	await ctx.close()
}
// ---- 22: "could I fix it by tilting the seesaw more instead?", answered with no proposal, then "yes": that way asked for, the box never lowered
{
	const Q = "could I fix it by tilting the seesaw more instead?"
	const ANS = { kind: "answer", mode: "patch", why: "a question", reply: "Maybe, but it's uncertain. In the last run the tennis ball rose only to 0.34 m against the box rim at 0.32 m and hit the box's side.", targets: [], patches: [], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl) => (pl.text === SWAP_T && !pl.feedback ? SWAP : pl.text === Q ? ANS : null))
	await send(p, SWAP_T)
	await replied(p, 0)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
	const box0 = await boxAt(p)
	const n0 = await p.locator("li.ai-bot").count()
	await send(p, Q)
	await replied(p, n0)
	const m = calls.length
	const n1 = await p.locator("li.ai-bot").count()
	await send(p, "yes")
	await replied(p, n1, 60000).catch(() => {})
	await p.waitForTimeout(1500)
	const box1 = await boxAt(p)
	const sent = calls.slice(m).map((c) => c.text)
	ok("22. 'yes' to 'could I fix it by tilting the seesaw more instead?' asks for that way, and the box is never lowered", sent[0] === "Yes: fix it by tilting the seesaw more instead" && box1.y === box0.y, `${JSON.stringify(sent)} / ${box0.y} → ${box1.y}`)
	ok("22. no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed${failed.length ? `; failed: ${failed.map((c) => c.name).join("; ")}` : ""}`)
process.exit(failed.length ? 1 : 0)
