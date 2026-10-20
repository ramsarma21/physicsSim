// The team's video gallery as one self-contained HTML page (no script, no other file: inline styles, light and dark), from index entries
// (api/_lib/videos.mjs entryOf). Written to Blob as videos/<gallery>/index.html (and a batch's) next to index.json, and served as a page by
// api/videos/gallery.mjs (/videos/<gallery>), since Blob hands HTML out as a download. Every value from a request is escaped; there is
// nothing secret in it (who published is a key's name, never a key).

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const money = (usd) => (Number.isFinite(usd) ? `$${usd.toFixed(2)}` : "")
function clock(seconds) {
	const s = Math.max(0, Math.round(Number(seconds) || 0))
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
function when(iso) {
	const d = new Date(iso)
	if (!Number.isFinite(d.getTime())) return ""
	return `${d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}, ${d.toISOString().slice(11, 16)} UTC`
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f3;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e3e2dc;--chip:#efeee8;--accent:#2457c5;--ok:#1f7a3f;--bad:#b3261e;--media:#111}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--fg:#ecebe6;--muted:#a3a29b;--line:#33322e;--chip:#2a2a27;--accent:#8fb0ff;--ok:#6fcf8f;--bad:#ff8a80;--media:#000}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1280px;margin:0 auto;padding:28px 16px 48px}
header{margin-bottom:22px}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;font-weight:650;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0}
.sub a,.links a,footer a,.crumb a{color:var(--accent);text-decoration:none}
.sub a:hover,.links a:hover,footer a:hover,.crumb a:hover{text-decoration:underline}
.crumb{font-size:13px;margin:0 0 6px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
video{display:block;width:100%;aspect-ratio:16/9;background:var(--media);object-fit:contain}
.body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
h2{font-size:16px;line-height:1.3;margin:0;font-weight:620;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.chips li{background:var(--chip);border-radius:999px;padding:2px 9px;font-size:12.5px;color:var(--fg);overflow-wrap:anywhere}
.req{margin:0;color:var(--muted);font-size:13.5px;overflow-wrap:anywhere}
.req summary{cursor:pointer;list-style:none}
.req summary::-webkit-details-marker{display:none}
.req p{margin:6px 0 0;white-space:pre-wrap}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:2px 0 0;font-size:13px}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
.ok{color:var(--ok);font-weight:600}
.bad{color:var(--bad);font-weight:600}
.checks summary{cursor:pointer}
.checks ul{margin:6px 0 0;padding-left:18px;color:var(--muted)}
.links{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;margin-top:auto;padding-top:4px}
.empty{border:1px dashed var(--line);border-radius:12px;padding:40px 16px;text-align:center;color:var(--muted)}
footer{margin-top:28px;font-size:12.5px;color:var(--muted)}
`

function card(e, { batchHref }) {
	const chips = []
	if (e.lesson?.id) chips.push(`<li>${esc(e.lesson.id)}</li>`)
	if (e.lesson?.grade !== undefined && e.lesson?.grade !== null && e.lesson?.grade !== "") chips.push(`<li>Grade ${esc(e.lesson.grade)}</li>`)
	if (e.lesson?.concept) chips.push(`<li>${esc(e.lesson.concept)}</li>`)
	if (e.batch) chips.push(`<li><a href="${esc(batchHref(e.batch))}" style="color:inherit">Batch ${esc(e.batch)}</a></li>`)
	const req = String(e.request ?? "")
	const reqHtml = req.length > 160 ? `<details class="req"><summary>&ldquo;${esc(req.slice(0, 150).trimEnd())}&hellip;&rdquo;</summary><p>${esc(req)}</p></details>` : req ? `<p class="req">&ldquo;${esc(req)}&rdquo;</p>` : ""
	const c = e.checks ?? { passed: 0, total: 0, items: [] }
	const allOk = c.total > 0 && c.passed === c.total
	const checkLine = `<span class="${allOk ? "ok" : "bad"}">${c.passed}/${c.total} passed</span>`
	const checks = c.items?.length ? `<details class="checks"><summary>${checkLine}</summary><ul>${c.items.map((i) => `<li>${i.ok ? "&#10003;" : "&#10007;"} ${esc(i.name || "check")}</li>`).join("")}</ul></details>` : checkLine
	const f = e.files ?? {}
	const links = [
		f["video.mp4"] && `<a href="${esc(f["video.mp4"])}">MP4</a>`,
		e.report_url && `<a href="${esc(e.report_url)}">Report</a>`, // (the report page on the site: Blob hands report.html out as a download)
		f["audit.json"] && `<a href="${esc(f["audit.json"])}">Audit</a>`,
		f["scene.json"] && `<a href="${esc(f["scene.json"])}">Scene</a>`,
		f["concept.jpg"] && `<a href="${esc(f["concept.jpg"])}">Concept</a>`,
		f["frames.jpg"] && `<a href="${esc(f["frames.jpg"])}">Frames</a>`,
	].filter(Boolean)
	const track = f["captions.vtt"] ? `<track kind="captions" src="${esc(f["captions.vtt"])}" srclang="en" label="English">` : ""
	return `<article class="card" id="${esc(e.job)}">
<video controls preload="none" playsinline${track ? ' crossorigin="anonymous"' : ""} poster="${esc(f["poster.jpg"] ?? "")}"><source src="${esc(f["video.mp4"] ?? "")}" type="video/mp4">${track}</video>
<div class="body">
<h2>${esc(e.title)}</h2>
${chips.length ? `<ul class="chips">${chips.join("")}</ul>` : ""}
${reqHtml}
<dl><dt>Published</dt><dd>${esc(when(e.published_at))}</dd><dt>Length</dt><dd>${esc(clock(e.seconds))}</dd><dt>Checks</dt><dd>${checks}</dd><dt>Cost</dt><dd>${esc(money(e.cost_usd))}</dd><dt>By</dt><dd>${esc(e.published_by)}</dd></dl>
${links.length ? `<div class="links">${links.join("")}</div>` : ""}
</div>
</article>`
}

/**
 * The page. entries: index entries, newest first. opts: {batch (this page is one batch's), homeHref, batchHref(b), jsonHref, mediaOrigin
 * (for the CSP meta: where posters and videos come from)}.
 */
export function renderGallery(entries, { batch = null, homeHref = "", batchHref = (b) => `batches/${encodeURIComponent(b)}/index.html`, jsonHref = "index.json", mediaOrigin = "" } = {}) {
	const total = entries.reduce((n, e) => n + (Number(e.cost_usd) || 0), 0)
	const latest = entries.reduce((m, e) => (e.published_at > m ? e.published_at : m), "")
	const title = batch ? `Batch ${batch}: physics lesson videos` : "Physics lesson videos"
	const csp = `default-src 'none'; img-src ${mediaOrigin || "https:"}; media-src ${mediaOrigin || "https:"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`
	const n = entries.length
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
${batch && homeHref ? `<p class="crumb"><a href="${esc(homeHref)}">All videos</a></p>` : ""}
<h1>${esc(title)}</h1>
<p class="sub">${n} video${n === 1 ? "" : "s"}${n ? ` &middot; ${esc(money(total))} in all &middot; latest ${esc(when(latest))}` : ""}</p>
</header>
${n ? `<section class="grid">\n${entries.map((e) => card(e, { batchHref })).join("\n")}\n</section>` : `<p class="empty">No videos yet. The video pipeline adds each one here once every check passes.</p>`}
<footer>Made by the physics sandbox video pipeline. Data: <a href="${esc(jsonHref)}">index.json</a></footer>
</main>
</body>
</html>
`
}
