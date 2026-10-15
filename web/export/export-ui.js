// Export video: the dialog that turns the scene's run into an MP4 file.
//   settings (a live preview of the chosen camera, resolution, frame rate, camera, motion blur, impact sounds, trim, size and time estimates)
//   → progress (frames done of total, time left, the frame just made, Cancel) → done (the file: name, size, length, a player, Download again,
//   Copy where the browser can put a video on the clipboard, Share where it can share files).
// app.js mounts it (mountExportUI) with a few getters; nothing else in the page knows about it.
// The parts it drives are found by feature detection, so the dialog opens, previews and explains itself while one is missing:
//   the view (view3d.js)  renderFrame(t, {width, height, camera, motionBlur, fps, runId}) → a canvas / ImageBitmap / VideoFrame of that moment
//                         (view3d.js: a 2D OffscreenCanvas it reuses, so the encoder copies it before the next frame is asked for)
//                         whenSettled() → a promise that resolves once every model and texture of the run on screen is built
//                         exportInfo() → optional facts: {runId (passed with every frame), cameras, maxSize | maxWidth/maxHeight, motionBlur, ...}
//                         endExport() → the view's export session ends now (after an export, and once the dialog closes)
//                         exportProject(t, x, y, {camera, width, height}) → −1 … 1: where a point of the machine shows across the export's picture
//                         (the impact sounds are panned by it, so a hit is heard where it is seen)
//   the encoder (web/export/encoder.js)  encodeMp4({frames: (i) → source, frameCount, fps, width, height, audio, title, signal, onProgress})
//                         → Blob (blob.info: path, duration, warnings…); checkSupport({width, height, fps, audio}); videoBitrate(w, h, fps);
//                         extensionFor(mimeType)
//   the sound (web/export/audio.js)  synthesizeImpacts(impacts, doc, {duration, sampleRate, track, stage, panAt}) → AudioBuffer
// See encodeOptions() and soundFor() below for exactly what is passed.

const ENCODER_MODULES = ["./encoder.js"] // the first that exports encodeMp4 is used
const AUDIO_MODULES = ["./audio.js"] // only looked at when the encoder module has no synthesizeImpacts

const RES = [
	{ id: "720p", label: "720p", w: 1280, h: 720, name: "HD" },
	{ id: "1080p", label: "1080p", w: 1920, h: 1080, name: "Full HD" },
	{ id: "1440p", label: "1440p", w: 2560, h: 1440, name: "Quad HD" },
	{ id: "4k", label: "4K", w: 3840, h: 2160, name: "Ultra HD" },
]
const FPS = [30, 60]
const CAMERAS = [
	{ id: "wide", label: "Wide", hint: "The whole machine in one steady shot." },
	{ id: "follow", label: "Follow", hint: "Stays with whatever is moving." },
	{ id: "orbit", label: "Orbit", hint: "A slow turn around the machine." },
	{ id: "director", label: "Director", hint: "Picks the shot for each moment, close in on the hits." },
]
// H.264 at the bitrates YouTube recommends for uploads (Mbit/s at 30 and 60 fps), when the encoder can't say (its videoBitrate());
// the size estimate also learns from real exports (calib.bytes)
const MBPS = { "720p": [5, 7.5], "1080p": [8, 12], "1440p": [16, 24], "4k": [40, 60] }
const AUDIO_KBPS = 192 // the encoder's AAC
// What part of that bitrate a file of these scenes really takes (the encoder is VBR: a still shot costs little, a moving camera much more).
// Measured with the real encoder on three scenes at 720p30, 1080p60 and 4K30 (Wide 0.04–0.28, Follow 0.48–0.57); each camera then learns
// from this device's own exports (calib.bytes[camera]). Bigger frames compress better (fewer bits per pixel for the same picture).
const SIZE_PRIOR = { wide: 0.16, follow: 0.55, orbit: 0.6, director: 0.5 }
const SIZE_RES = { "720p": 1, "1080p": 1, "1440p": 0.85, "4k": 0.7 }
const PREVIEW = { w: 640, h: 360, fps: 15, hold: 0.7 } // the settings preview: its size, how often it draws, how long it waits at the end
const PREVIEW_MS_PRIOR = 8 // ms a preview frame takes before any is timed (Apple M5 Pro: 6.3, 10.8 with five chrome balls; a slower device shows its own)
const PREVIEW_MS_SOFT = 400 // ... on a device that draws without a graphics chip (a software renderer: 1080p30 of the starter took 62 s there, a busy table 258 s;
// with the M5's 8 ms the first estimate said "about 1.9 s")
// How many times a sharp frame a motion-blurred one costs at 1920 wide and 30 fps, per camera: the view takes more sub-frames where the picture moves
// more (measured on 3 scenes: Wide 1.7–2.1, Orbit 2.3–2.4, Director 2.8–3.3, Follow 3.9–5.6); about √(width / 1920) more at other widths
// (4K: Wide 2.7–3.6, Follow 5.2–6.8), and fewer at 60 fps (a shutter half as long).
const BLUR_COST = { wide: 1.9, orbit: 2.4, director: 3.1, follow: 4.7 }
const MIN_LEN = 0.2 // s: the shortest trim
// What this device has room for: a 1440p or 4K export holds big frame targets on the GPU (4K at its worst about 1.2 GB more than idle, 1440p about 0.7 GB:
// ai/EXPORT.md) besides the page and the whole file in memory. navigator.deviceMemory (Chrome, Edge, Opera; GB, rounded down, at most 8) of 2 or less offers
// up to 1080p, of 4 or less up to 1440p; a device that draws without a graphics chip (a software renderer: every frame is drawn by the CPU) up to 1080p.
// A browser that does not say (Safari, Firefox) is not held back here: the GPU's and the encoder's own limits still apply.
const MEM_CAPS = [[2, 1080], [4, 1440]] // [deviceMemory at most (GB), tallest picture offered]
const SOFT_CAP = 1080
const STORE_KEY = "sandbox:export"

const FILM = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2.5v2h1.8v-2zm12.2 0v2H19v-2zM5 9.5v2h1.8v-2zm12.2 0v2H19v-2zM5 13.5v2h1.8v-2zm12.2 0v2H19v-2zM5 17.5v1.5h1.8v-1.5zm12.2 0v1.5H19v-1.5zM8.6 5v14h6.8V5z"/></svg>`
const ICON = {
	film: FILM,
	close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>`,
	play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
	pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`,
	download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg>`,
	copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H6a2 2 0 0 0-2 2v13h2V3h10zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16h-9V7h9z"/></svg>`,
	share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4zM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-3v2h1v8H7v-8h1v-2z"/></svg>`,
	warn: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z"/></svg>`,
	check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg>`,
	back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>`,
}

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const isFn = (f) => typeof f === "function"
const abortError = () => new DOMException("The export was cancelled", "AbortError")
const isAbort = (e) => e?.name === "AbortError"
export const fileNameFor = (name) => ((name || "").replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().replace(/\s+/g, "-").toLowerCase() || "scene") + ".mp4"
export function fmtBytes(n) {
	if (!(n > 0)) return "0 KB"
	if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
	if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`
	return `${Math.max(1, Math.round(n / 1e3))} KB`
}
/** "4.5 s", "12 s", "1 min 20 s" (seconds of video or of waiting). */
export function fmtSpan(s) {
	if (!(s >= 0)) return "—"
	if (s < 10) return `${(Math.round(s * 10) / 10).toFixed(1)} s`
	if (s < 60) return `${Math.round(s)} s`
	const m = Math.floor(s / 60)
	const r = Math.round(s - m * 60)
	return r === 60 ? `${m + 1} min` : r ? `${m} min ${r} s` : `${m} min`
}
const fmtT = (t) => `${t.toFixed(2)} s`
/** A message as a sentence: a capital first, one full stop last ("item “ramp-1” has an angle that isn’t a number" → "Item “ramp-1” has an angle that isn’t a number."). */
const sentence = (m) => { const t = String(m).trim().replace(/[.!?…\s]+$/, ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) + "." : "" }
/** Let the page paint and take input during a long export. A MessageChannel hop is not throttled in a background tab, unlike setTimeout. */
const hop = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))])
const raceAbort = (p, signal) => new Promise((res, rej) => {
	if (signal.aborted) return rej(abortError())
	const on = () => rej(abortError())
	signal.addEventListener("abort", on, { once: true })
	Promise.resolve(p).then((v) => { signal.removeEventListener("abort", on); res(v) }, (e) => { signal.removeEventListener("abort", on); rej(e) })
})

/** The H.264 profile-High codec string for a size and rate (the lowest level that holds it), as WebCodecs wants it. */
export function avcCodec(w, h, fps) {
	const fs = Math.ceil(w / 16) * Math.ceil(h / 16)
	const rate = fs * fps
	const levels = [[0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600], [0x3c, 139264, 4177920]]
	const lv = levels.find(([, f, r]) => fs <= f && rate <= r)?.[0] ?? 0x3c
	return "avc1.6400" + lv.toString(16).padStart(2, "0")
}

/** Is a frame source something drawImage takes? */
const drawable = (s) => !!s && (s instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== "undefined" && s instanceof OffscreenCanvas) || (typeof ImageBitmap !== "undefined" && s instanceof ImageBitmap) || (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) || s instanceof HTMLImageElement || s instanceof HTMLVideoElement)
const sourceOf = (r) => (drawable(r) ? r : drawable(r?.canvas) ? r.canvas : drawable(r?.frame) ? r.frame : drawable(r?.image) ? r.image : drawable(r?.bitmap) ? r.bitmap : null)
/** Draw a frame source over the whole of a 2D canvas, letterboxed if its shape differs. */
function blit(ctx, src) {
	const s = sourceOf(src)
	if (!s) return false
	const cw = ctx.canvas.width
	const ch = ctx.canvas.height
	const sw = s.displayWidth ?? s.videoWidth ?? s.width
	const sh = s.displayHeight ?? s.videoHeight ?? s.height
	if (!(sw > 0 && sh > 0)) return false
	const k = Math.min(cw / sw, ch / sh)
	const dw = sw * k
	const dh = sh * k
	if (Math.abs(dw - cw) > 1 || Math.abs(dh - ch) > 1) ctx.clearRect(0, 0, cw, ch)
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(s, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
	return true
}

// ---------- the dialog ----------
/**
 * o = {
 *   button: the top-bar "Export video" button,
 *   store: {get(k), set(k, v)} (the app's, already kept per ?profile=),
 *   toast(text),
 *   get(): {scene, sim, view, layout, editing, cam, t, playing} (the app's state now),
 *   pause(): stop playback, play(): start it again (the dialog pauses the scene while it is open and plays it again when it closes, if it was playing),
 *   rerun(): run the scene now,
 *   viewEl: the element holding the 3D view's canvas (a fallback preview reads it),
 *   statusEl, errorEl: the top bar's run status and the view's error line (when a run lands, fails or starts),
 * }
 * Returns {open, close, isOpen, sync}.
 */
export function mountExportUI(o) {
	const { button, store, get } = o
	const toast = o.toast ?? (() => {})
	const statusEl = o.statusEl ?? document.getElementById("status")
	const errorEl = o.errorEl ?? document.getElementById("error")
	let cssLink = document.querySelector('link[href$="export/export.css"]')
	if (!cssLink) { // (index.html links it; a page that mounts this without the link still gets the look)
		cssLink = document.createElement("link")
		cssLink.rel = "stylesheet"
		cssLink.href = new URL("./export.css", import.meta.url).href
		document.head.append(cssLink)
	}

	// ----- remembered settings (per profile: the app's store keeps ?profile= apart) -----
	const saved = (() => { try { return store?.get(STORE_KEY) || {} } catch { return {} } })()
	const set = {
		res: RES.some((r) => r.id === saved.res) ? saved.res : "1080p",
		fps: FPS.includes(saved.fps) ? saved.fps : 60,
		camera: CAMERAS.some((c) => c.id === saved.camera) ? saved.camera : null, // null: the live view's camera when first opened
		blur: saved.blurChosen === true && typeof saved.blur === "boolean" ? saved.blur : null, // null: the view's recommendation (exportInfo().recommended.motionBlur)
		blurChosen: saved.blurChosen === true, // (only a choice the person made is remembered: the recommendation can change with the device)
		sound: saved.sound !== false,
	}
	const calib = { // learned from real exports on this device: real ÷ estimated time per frame (plain / blur), file size ÷ the bitrate's (per camera)
		k: saved.calib?.k && typeof saved.calib.k === "object" ? saved.calib.k : {},
		bytes: saved.calib?.bytes && typeof saved.calib.bytes === "object" ? saved.calib.bytes : {},
	}
	const remember = () => { try { store?.set(STORE_KEY, { res: set.res, fps: set.fps, camera: set.camera, ...(set.blurChosen ? { blur: set.blur, blurChosen: true } : {}), sound: set.sound, calib }) } catch {} }

	// ----- which run the export is of: the run that landed for the scene as it is now -----
	// A run's answer lands with the status saying "ok" (synchronously after S.sim is set): the scene at that moment is the scene of that run.
	let runSim = null
	let runScene = null
	const stamp = () => {
		const s = get()
		if (s.sim && !s.layout && !s.editing) { runSim = s.sim; runScene = JSON.stringify(s.scene) }
	}
	if (statusEl?.dataset.state === "ok") stamp() // (mounted after the first run landed)
	/** fresh: the run on screen is of this exact scene. none: no run yet. Otherwise why not, and what to do. */
	function freshness() {
		const s = get()
		if (!s.sim) return { state: "none" }
		if (s.editing) return { state: "editing" }
		const changed = !!s.layout || s.sim !== runSim || JSON.stringify(s.scene) !== runScene
		if (!changed) return { state: "fresh" }
		const st = statusEl?.dataset.state
		if (st === "busy") return { state: "running" }
		if (st === "error") return { state: "failed", reason: errorEl && !errorEl.hidden ? errorEl.textContent : "" }
		return { state: "stale" }
	}

	// ----- the DOM -----
	const dlg = document.createElement("dialog")
	dlg.className = "xv"
	dlg.setAttribute("aria-labelledby", "xv-title")
	dlg.innerHTML = `
<div class="xv-sheet" tabindex="-1">
	<div class="xv-grab" aria-hidden="true"></div>
	<header class="xv-head">
		<span class="xv-head-ic" aria-hidden="true">${FILM}</span>
		<div class="xv-head-t"><h2 id="xv-title">Export video</h2><p class="xv-sub" id="xv-sub"></p></div>
		<button type="button" class="xv-x" data-act="close" aria-label="Close">${ICON.close}</button>
	</header>

	<div class="xv-body">
		<section class="xv-pane xv-settings" data-pane="settings">
			<div class="xv-col xv-col-l">
				<div class="xv-prev" id="xv-prev">
					<canvas width="${PREVIEW.w}" height="${PREVIEW.h}" aria-label="Preview of the chosen camera" role="img"></canvas>
					<div class="xv-prev-msg" hidden></div>
					<span class="xv-chip"><i></i><b id="xv-prev-cam">Wide</b></span>
					<button type="button" class="xv-pp" data-act="preview" aria-label="Pause the preview">${ICON.play}${ICON.pause}</button>
					<span class="xv-prev-t" id="xv-prev-t">0.00 s</span>
				</div>
				<div class="xv-len">
					<div class="xv-len-top">
						<span class="xv-lbl">Length</span>
						<span class="xv-len-v" id="xv-len-v"></span>
						<button type="button" class="xv-link" data-act="full" hidden>Whole run</button>
					</div>
					<div class="xv-trim" id="xv-trim">
						<div class="xv-trim-track"><div class="xv-trim-fill"></div><div class="xv-trim-marks"></div><div class="xv-trim-head"></div></div>
						<input type="range" class="xv-trim-a" min="0" max="1" step="0.01" value="0" aria-label="Start of the video">
						<input type="range" class="xv-trim-b" min="0" max="1" step="0.01" value="1" aria-label="End of the video">
					</div>
					<div class="xv-trim-ends"><span>Start <b id="xv-trim-a">0.00 s</b></span><span>End <b id="xv-trim-b">0.00 s</b></span></div>
				</div>
			</div>
			<div class="xv-col xv-col-r">
				<div class="xv-warn" id="xv-warn" hidden role="status"></div>
				<div class="xv-row">
					<div class="xv-row-top"><span class="xv-lbl" id="xv-l-res">Resolution</span><span class="xv-cap" id="xv-res-cap"></span></div>
					<div class="xv-seg" role="radiogroup" aria-labelledby="xv-l-res" data-k="res">${RES.map((r) => `<button type="button" role="radio" data-v="${r.id}">${r.label}</button>`).join("")}</div>
				</div>
				<div class="xv-row">
					<div class="xv-row-top"><span class="xv-lbl" id="xv-l-fps">Frame rate</span><span class="xv-cap" id="xv-fps-cap"></span></div>
					<div class="xv-seg" role="radiogroup" aria-labelledby="xv-l-fps" data-k="fps">${FPS.map((f) => `<button type="button" role="radio" data-v="${f}">${f} fps</button>`).join("")}</div>
				</div>
				<div class="xv-row">
					<div class="xv-row-top"><span class="xv-lbl" id="xv-l-cam">Camera</span></div>
					<div class="xv-seg" role="radiogroup" aria-labelledby="xv-l-cam" data-k="camera">${CAMERAS.map((c) => `<button type="button" role="radio" data-v="${c.id}">${c.label}</button>`).join("")}</div>
					<p class="xv-hint" id="xv-cam-hint"></p>
				</div>
				<label class="xv-tog">
					<span class="xv-tog-t"><b>Motion blur</b><small id="xv-blur-cap">Soft streaks on fast parts, like a real camera. Slower to make.</small></span>
					<input type="checkbox" data-k="blur"><span class="xv-sw" aria-hidden="true"></span>
				</label>
				<label class="xv-tog">
					<span class="xv-tog-t"><b>Impact sounds</b><small id="xv-sound-cap"></small></span>
					<input type="checkbox" data-k="sound"><span class="xv-sw" aria-hidden="true"></span>
				</label>
			</div>
		</section>

		<section class="xv-pane xv-progress" data-pane="progress" hidden>
			<div class="xv-live"><canvas width="960" height="540" role="img" aria-label="The frame just made"></canvas><span class="xv-live-badge"><i></i>Rendering</span></div>
			<div class="xv-bar" role="progressbar" aria-labelledby="xv-p-phase" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
			<div class="xv-pstats">
				<div><b id="xv-p-phase">Getting ready…</b><span id="xv-p-frames"></span></div>
				<div class="xv-pstats-r"><b id="xv-p-eta"></b><span id="xv-p-el"></span></div>
			</div>
			<p class="xv-p-note" id="xv-p-note"></p>
		</section>

		<section class="xv-pane xv-done" data-pane="done" hidden>
			<div class="xv-player"><video playsinline loop controls preload="metadata"></video></div>
			<div class="xv-file">
				<span class="xv-file-ic" aria-hidden="true">${ICON.check}</span>
				<div class="xv-file-t"><b id="xv-f-name"></b><span id="xv-f-meta"></span></div>
			</div>
			<p class="xv-d-note" id="xv-d-note" hidden></p>
		</section>

		<section class="xv-pane xv-error" data-pane="error" hidden>
			<div class="xv-err-ic" aria-hidden="true">${ICON.warn}</div>
			<h3>The export stopped</h3>
			<p id="xv-err"></p>
		</section>
	</div>

	<footer class="xv-foot">
		<div class="xv-foot-pane" data-foot="settings">
			<div class="xv-est" id="xv-est" aria-live="polite"></div>
			<div class="xv-btns">
				<button type="button" class="xv-btn" data-act="close">Cancel</button>
				<button type="button" class="xv-btn xv-primary" data-act="export" id="xv-go">${FILM}<span>Export</span></button>
			</div>
		</div>
		<div class="xv-foot-pane" data-foot="progress" hidden>
			<div class="xv-est" id="xv-p-what"></div>
			<div class="xv-btns"><button type="button" class="xv-btn" data-act="cancel">Cancel export</button></div>
		</div>
		<div class="xv-foot-pane" data-foot="done" hidden>
			<div class="xv-btns xv-btns-l"><button type="button" class="xv-btn xv-quiet" data-act="again">${ICON.back}<span>Change settings</span></button></div>
			<div class="xv-btns">
				<button type="button" class="xv-btn" data-act="share" hidden>${ICON.share}<span>Share</span></button>
				<button type="button" class="xv-btn" data-act="copy" hidden>${ICON.copy}<span>Copy</span></button>
				<button type="button" class="xv-btn xv-primary" data-act="download">${ICON.download}<span>Download again</span></button>
			</div>
		</div>
		<div class="xv-foot-pane" data-foot="error" hidden>
			<div class="xv-btns xv-btns-l"><button type="button" class="xv-btn xv-quiet" data-act="again">${ICON.back}<span>Change settings</span></button></div>
			<div class="xv-btns"><button type="button" class="xv-btn xv-primary" data-act="export">Try again</button></div>
		</div>
	</footer>
	<div class="xv-flash" role="status" hidden></div>
	<div class="xv-sr" role="status" aria-live="polite"></div>
</div>`
	document.body.append(dlg)
	const $ = (s) => dlg.querySelector(s)
	const $$ = (s) => [...dlg.querySelectorAll(s)]
	const pvCanvas = $(".xv-prev canvas")
	const pvCtx = pvCanvas.getContext("2d")
	const liveCanvas = $(".xv-live canvas")
	const liveCtx = liveCanvas.getContext("2d")
	const video = $(".xv-player video")
	const trimA = $(".xv-trim-a")
	const trimB = $(".xv-trim-b")

	// ----- state -----
	let mode = "settings" // settings | progress | done | error
	let flashTimer = 0
	let job = null // the export running: {ctl, ...}
	let result = null // the last file made: {blob, url, name, size, seconds, w, h, fps, sim}
	const trim = { start: 0, end: 0, seconds: 0, sim: null, touched: false }
	const caps = { encoder: null, loading: null, render: false, cameras: null, maxW: Infinity, maxH: Infinity, blur: true, recommendedBlur: null, vsupport: new Map(), whyNot: new Map(), audio: null, soft: false }
	let lastFocus = null

	// ----- feature detection -----
	let encTry = 0
	async function importFirst(paths, name) {
		for (const p of paths) {
			try {
				const url = new URL(p, import.meta.url)
				if (encTry > 1) url.searchParams.set("retry", String(encTry)) // (a failed module fetch is remembered by the page: ask again under another name)
				const m = await import(url.href)
				if (isFn(m[name])) return { m, error: null }
			} catch (e) {
				if (!/Failed to fetch|Importing a module script failed|error loading dynamically imported module|404/i.test(String(e?.message))) return { m: null, error: e }
			}
		}
		return { m: null, error: null }
	}
	function loadEncoder() {
		if (caps.encoder?.encodeMp4) return Promise.resolve(caps.encoder)
		return (caps.loading ??= (async () => {
			encTry++
			const enc = { encodeMp4: null, synthesizeImpacts: null, mod: null, error: null }
			const r = await importFirst(ENCODER_MODULES, "encodeMp4")
			if (r.m) { enc.mod = r.m; enc.encodeMp4 = r.m.encodeMp4; if (isFn(r.m.synthesizeImpacts)) enc.synthesizeImpacts = r.m.synthesizeImpacts }
			enc.error = r.error
			if (!enc.synthesizeImpacts) {
				const a = await importFirst(AUDIO_MODULES, "synthesizeImpacts")
				if (a.m) enc.synthesizeImpacts = a.m.synthesizeImpacts
			}
			caps.encoder = enc
			caps.loading = null // (a part that is missing now is looked for again the next time the dialog opens)
			if (enc.mod) { caps.vsupport.clear(); caps.whyNot.clear() } // (asked again, of the encoder itself)
			return enc
		})())
	}
	/** Can this browser's H.264 encoder make this size at this rate? (cached; true when it cannot tell) */
	function videoSupport(r, fps) {
		const k = `${r.id}@${fps}`
		if (caps.vsupport.has(k)) return caps.vsupport.get(k)
		caps.vsupport.set(k, null) // (being asked)
		const mod = caps.encoder?.mod
		let p
		// "realtime": recorded as it plays (MediaRecorder), only where the browser has no VideoEncoder at all; an encoder that can't make this size rules it out
		// (recording it in real time instead would make a slowed-down video), with its own reason
		if (isFn(mod?.checkSupport)) p = Promise.resolve().then(() => mod.checkSupport({ width: r.w, height: r.h, fps })).then((x) => (x?.ok ? true : x?.fallback && typeof VideoEncoder !== "function" ? "realtime" : (caps.whyNot.set(k, x?.reason || ""), false)))
		else if (typeof VideoEncoder !== "undefined" && isFn(VideoEncoder.isConfigSupported)) {
			const base = { codec: avcCodec(r.w, r.h, fps), width: r.w, height: r.h, framerate: fps, bitrate: MBPS[r.id][fps === 60 ? 1 : 0] * 1e6, avc: { format: "avc" } }
			p = VideoEncoder.isConfigSupported(base).then((x) => x.supported || VideoEncoder.isConfigSupported({ ...base, hardwareAcceleration: "prefer-software" }).then((y) => !!y.supported))
		} else p = Promise.resolve("realtime") // (the encoder records in real time where there is no WebCodecs)
		p.catch(() => true).then((ok) => { caps.vsupport.set(k, ok === "realtime" ? ok : ok !== false); if (isOpen()) render() })
		return null
	}
	async function audioSupport() {
		if (caps.audio && caps.audio.enc === caps.encoder) return caps.audio
		const mod = caps.encoder?.mod
		let ok = true
		let why = ""
		if (caps.encoder && !isFn(caps.encoder.synthesizeImpacts)) { ok = false; why = "Impact sounds aren’t in this build yet." }
		else if (typeof OfflineAudioContext === "undefined") { ok = false; why = "This browser can’t make sound offline." }
		else if (isFn(mod?.checkSupport)) {
			try {
				const x = await mod.checkSupport({ width: 1280, height: 720, fps: 30, audio: true })
				if (x?.ok && !x.audio) { ok = false; why = x.audioReason || "This browser can’t add sound to the file." }
			} catch {}
		}
		else if (typeof VideoEncoder !== "undefined") { // WebCodecs: the sound goes in as AAC
			try { ok = typeof AudioEncoder !== "undefined" && !!(await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: AUDIO_KBPS * 1000 })).supported } catch { ok = false }
			if (!ok) why = "This browser can’t add sound to the file."
		}
		return (caps.audio = { ok, why, enc: caps.encoder })
	}
	async function viewFacts() {
		const view = get().view
		caps.render = isFn(view?.renderFrame)
		let info = null
		try { info = isFn(view?.exportInfo) ? await view.exportInfo({ width: resNow().w, height: resNow().h, fps: set.fps, camera: set.camera, motionBlur: set.blur }) : view?.exportInfo ?? null } catch {}
		if (info && typeof info === "object") {
			const cams = Array.isArray(info.cameras) ? info.cameras.map((c) => (typeof c === "string" ? c : c?.id)).filter(Boolean) : null
			caps.cameras = cams?.length ? cams : null
			caps.camInfo = Array.isArray(info.cameras) ? Object.fromEntries(info.cameras.filter((c) => c && typeof c === "object" && c.id).map((c) => [c.id, c])) : {}
			const mx = Number(info.maxWidth ?? info.maxSize?.width ?? info.maxSize ?? info.maxTextureSize ?? info.maxRenderbufferSize)
			const my = Number(info.maxHeight ?? info.maxSize?.height ?? info.maxSize ?? info.maxTextureSize ?? info.maxRenderbufferSize)
			if (mx > 0) caps.maxW = mx
			if (my > 0) caps.maxH = my
			if (info.motionBlur === false) caps.blur = false
			caps.soft = info.softwareGL === true
			if (info.recommended && typeof info.recommended === "object") caps.recommendedBlur = Number(info.recommended.motionBlur) > 0
		}
	}

	// ----- settings helpers -----
	const resNow = () => RES.find((r) => r.id === set.res) ?? RES[1]
	const camList = () => CAMERAS.filter((c) => !caps.cameras || caps.cameras.includes(c.id))
	const camNow = () => (camList().some((c) => c.id === set.camera) ? set.camera : camList()[0]?.id ?? "wide")
	/** Recorded as it plays (no VideoEncoder in this browser): every frame must be made in real time. A size, rate or motion blur whose frames take more than
	 *  0.8 of a frame's time here (the estimate's own cost) is not offered; the smallest size at 30 fps always is (it skips frames rather than slowing down). */
	const realtimeAt = (r, fps) => videoSupport(r, fps) === "realtime"
	const fitsRealtime = (r, fps, blur) => frameCost(r, fps, blur).ms <= (0.8 * 1000) / fps
	/** The tallest picture this device has the memory for (MEM_CAPS, SOFT_CAP), and why: {h, why}. */
	function roomCap() {
		let mem = 0
		try { mem = Number(navigator.deviceMemory) || 0 } catch {}
		const m = mem > 0 ? MEM_CAPS.find(([gb]) => mem <= gb) : null
		if (m && (!caps.soft || m[1] <= SOFT_CAP)) return { h: m[1], why: `Needs more memory than this device has (${mem} GB)` }
		if (caps.soft) return { h: SOFT_CAP, why: "Too big for this device: it draws without a graphics chip" }
		return { h: Infinity, why: "" }
	}
	const resAllowed = (r) => r.w <= caps.maxW && r.h <= caps.maxH && r.h <= roomCap().h && videoSupport(r, set.fps) !== false && (!realtimeAt(r, set.fps) || r === RES[0] || fitsRealtime(r, set.fps, false))
	const fpsAllowed = (f) => videoSupport(resNow(), f) !== false && (!realtimeAt(resNow(), f) || f === FPS[0] || fitsRealtime(resNow(), f, false))
	const blurAllowed = () => caps.blur && (!realtimeAt(resNow(), set.fps) || fitsRealtime(resNow(), set.fps, true))
	/** Motion blur as it will be made: the person's choice, else the view's recommendation (on wherever the view can blur well). */
	const blurNow = () => (set.blur ?? !!caps.recommendedBlur) && blurAllowed()
	const frameCount = () => Math.max(1, Math.round((trim.end - trim.start) * set.fps))
	/** bits per second the encoder will use for this size and rate */
	const bitrateFor = (r, fps) => { try { const b = caps.encoder?.mod?.videoBitrate?.(r.w, r.h, fps); if (b > 0) return b } catch {} return MBPS[r.id][fps === 60 ? 1 : 0] * 1e6 }
	function syncTrim() {
		const sim = get().sim
		if (!sim) return
		const T = Number(sim.doc?.seconds) || 0
		if (trim.sim !== sim) {
			if (!trim.touched || Math.abs(T - trim.seconds) > 1e-9) { trim.start = 0; trim.end = T; trim.touched = false } // a run of another length: the whole of it
			trim.sim = sim
			trim.seconds = T
			trim.start = clamp(trim.start, 0, Math.max(0, T - MIN_LEN))
			trim.end = clamp(trim.end, Math.min(T, trim.start + MIN_LEN), T)
			drawMarks()
		}
	}
	/** Sound for this trim: the impacts inside it, in video time. */
	const impactsIn = (sim) => (sim?.track?.impacts ?? []).filter((m) => m.t >= trim.start && m.t < trim.end)

	// ----- estimates -----
	/** ms one export frame takes to make here: {base (before this device's own correction), ms}.
	 *  An export frame costs about what a preview frame of this scene costs on this device (the shadow map, the mirror and the chrome balls are made afresh
	 *  for every frame at any size), times (0.6 + 0.28 per megapixel) for the bigger picture and its encoding (measured on 5 scenes from 720p to 4K: within
	 *  ~25 %), times BLUR_COST with motion blur; then times what this device's own exports showed (calib.k). */
	function frameCost(r, fps, blur, cam = camNow()) {
		const mpx = (r.w * r.h) / 1e6
		const blurK = blur ? 1 + ((BLUR_COST[cam] ?? 3) * Math.sqrt(r.w / 1920) - 1) * (fps >= 60 ? 0.8 : 1) : 1
		const base = (previewMs() ?? (caps.soft ? PREVIEW_MS_SOFT : PREVIEW_MS_PRIOR)) * (0.6 + 0.28 * mpx) * blurK
		return { base, ms: base * (calib.k[blur ? "blur" : "plain"] || 1) }
	}
	function estimate() {
		const r = resNow()
		const secs = trim.end - trim.start
		const fps = set.fps
		const audio = set.sound && caps.audio?.ok !== false && impactsIn(get().sim).length ? AUDIO_KBPS * 1000 : 0
		const cam = camNow()
		const share = calib.bytes[cam] > 0 ? calib.bytes[cam] * SIZE_RES[r.id] : (SIZE_PRIOR[cam] ?? 0.5) * SIZE_RES[r.id]
		const bytes = ((bitrateFor(r, fps) * share + audio) / 8) * secs + 40e3
		const { base, ms: msFrame } = frameCost(r, fps, blurNow(), cam)
		const frames = frameCount()
		const realtime = videoSupport(r, fps) === "realtime" // (recorded as it plays: never faster than the video's own length)
		const overhead = 400 + (audio ? 150 + 15 * secs : 0) // ms: the models settled, the encoder started, the sound made and encoded
		const ms = Math.max(overhead + frames * msFrame, realtime ? secs * 1000 + 1500 : 0)
		return { bytes, ms, frames, secs, realtime, base, overhead }
	}

	// ----- rendering the dialog -----
	const isOpen = () => dlg.open
	function setPane(m) {
		if (m !== mode) { $(".xv-flash").hidden = true; clearTimeout(flashTimer) }
		mode = m
		dlg.dataset.mode = m
		for (const p of $$("[data-pane]")) p.hidden = p.dataset.pane !== m
		for (const p of $$("[data-foot]")) p.hidden = p.dataset.foot !== m
		$(".xv-x").hidden = m === "progress"
	}
	function setSeg(k, v, allowed) {
		const g = $(`.xv-seg[data-k="${k}"]`)
		for (const b of g.querySelectorAll("button")) {
			const on = b.dataset.v === String(v)
			b.setAttribute("aria-checked", String(on))
			b.tabIndex = on ? 0 : -1
			const ok = allowed ? allowed(b.dataset.v) : true
			b.disabled = !ok
		}
	}
	function render() {
		if (!isOpen()) return
		const s = get()
		syncTrim()
		$("#xv-sub").textContent = `${s.scene?.name || "Untitled scene"} · MP4`
		// what the export would be of
		const fr = freshness()
		const warn = $("#xv-warn")
		const msg = {
			none: ["No run yet", "Run the scene first: the video is made from its physics.", null],
			editing: ["Still editing", "Finish the change first.", null],
			running: ["Running the physics…", "Export unlocks as soon as this run lands.", null],
			stale: ["The scene changed since its last run", "Run it again so the video shows the scene as it is now.", "Run it now"],
			failed: ["The last change couldn’t run", (fr.reason ? sentence(fr.reason.replace(/^Couldn’t run it: /, "")) + " " : "") + "Undo or fix it, then export.", "Try the run again"],
		}[fr.state]
		warn.hidden = !msg
		warn.dataset.state = fr.state
		if (msg) {
			const key = msg.join("|")
			if (warn.dataset.key !== key) {
				warn.dataset.key = key
				warn.innerHTML = `<span class="xv-warn-ic">${fr.state === "running" ? '<i class="xv-spin"></i>' : ICON.warn}</span><span class="xv-warn-t"><b>${esc(msg[0])}</b><small>${esc(msg[1])}</small></span>${msg[2] ? `<button type="button" class="xv-btn xv-small" data-act="rerun">${esc(msg[2])}</button>` : ""}`
			}
		} else warn.dataset.key = ""
		// resolution / rate / camera
		const fresh = fr.state === "fresh"
		const r = resNow()
		if (!resAllowed(r)) { const best = [...RES].reverse().find((x) => resAllowed(x)); if (best) set.res = best.id }
		if (!fpsAllowed(set.fps) && fpsAllowed(FPS[0])) set.fps = FPS[0]
		const anyRes = RES.some(resAllowed)
		const why = anyRes ? "" : caps.whyNot.get(`${resNow().id}@${set.fps}`) || "This browser can’t make videos."
		const slow = "Too slow to record in real time on this device"
		setSeg("res", set.res, (v) => resAllowed(RES.find((x) => x.id === v)))
		for (const b of $$('.xv-seg[data-k="res"] button')) {
			const x = RES.find((q) => q.id === b.dataset.v)
			b.title = resAllowed(x) ? `${x.w} × ${x.h}` : x.w > caps.maxW || x.h > caps.maxH ? `This device’s graphics can’t draw ${x.w} × ${x.h}` : x.h > roomCap().h ? roomCap().why : realtimeAt(x, set.fps) ? slow : caps.whyNot.get(`${x.id}@${set.fps}`) || `This browser can’t encode ${x.w} × ${x.h} at ${set.fps} fps`
		}
		$("#xv-res-cap").textContent = `${resNow().w} × ${resNow().h} · ${resNow().name}`
		setSeg("fps", set.fps, (v) => fpsAllowed(Number(v)))
		for (const b of $$('.xv-seg[data-k="fps"] button')) b.title = fpsAllowed(Number(b.dataset.v)) ? "" : realtimeAt(resNow(), Number(b.dataset.v)) ? slow : caps.whyNot.get(`${resNow().id}@${b.dataset.v}`) || ""
		$("#xv-fps-cap").textContent = set.fps === 60 ? "Smoothest motion" : "Smaller file"
		for (const b of $$('.xv-seg[data-k="camera"] button')) b.hidden = !camList().some((c) => c.id === b.dataset.v)
		const cam = camNow()
		setSeg("camera", cam)
		const cdef = CAMERAS.find((c) => c.id === cam)
		$("#xv-cam-hint").textContent = caps.camInfo?.[cam]?.hint ?? caps.camInfo?.[cam]?.description ?? cdef?.hint ?? ""
		$("#xv-prev-cam").textContent = cdef?.label ?? cam
		// toggles
		const blur = $('input[data-k="blur"]')
		const blurOk = blurAllowed()
		blur.checked = blurNow()
		blur.disabled = !blurOk
		const choppy = blurOk && !blur.checked && (cam === "follow" || cam === "director") // (these cameras pan fast: up to ~1900 px/s at 1080p; sharp frames strobe)
		const blurCap = $("#xv-blur-cap")
		blurCap.textContent = !caps.blur ? "Not available with this renderer." : !blurOk ? `${slow}.` : choppy ? "Fast camera moves look choppy without it." : "Soft streaks on fast parts, like a real camera. Slower to make."
		blurCap.classList.toggle("xv-cap-warn", choppy)
		const snd = $('input[data-k="sound"]')
		const nHits = impactsIn(s.sim).length
		const audioOk = caps.audio?.ok !== false
		snd.checked = set.sound && audioOk && (!fresh || nHits > 0)
		snd.disabled = !audioOk || (fresh && !nHits)
		// (until the run of the scene as it is now lands, the hits counted would be the last run's)
		$("#xv-sound-cap").textContent = !audioOk ? caps.audio.why : !s.sim || !fresh ? "Made from the run’s collisions." : nHits ? `${nHits} ${nHits === 1 ? "hit" : "hits"}, each sounding like its materials and speed.` : "Nothing hits anything in this part of the run."
		$(".xv-trim-marks").style.visibility = fresh ? "" : "hidden"
		// length
		const T = trim.seconds || 0
		for (const inp of [trimA, trimB]) { inp.max = String(T); inp.disabled = !T }
		trimA.value = String(trim.start)
		trimB.value = String(trim.end)
		$("#xv-len-v").innerHTML = T ? `<b>${fmtSpan(trim.end - trim.start)}</b>${trim.start > 0 || trim.end < T ? ` of ${fmtSpan(T)}` : " · the whole run"}` : "—"
		$('[data-act="full"]').hidden = !(trim.start > 0 || trim.end < T)
		$("#xv-trim-a").textContent = fmtT(trim.start)
		$("#xv-trim-b").textContent = fmtT(trim.end)
		const fill = $(".xv-trim-fill")
		fill.style.left = `${T ? (trim.start / T) * 100 : 0}%`
		fill.style.right = `${T ? 100 - (trim.end / T) * 100 : 0}%`
		// the estimate and the Export button
		const go = $("#xv-go")
		const e = estimate()
		const est = $("#xv-est")
		const missing = !caps.render ? "This build can’t render export frames yet." : caps.encoder && !caps.encoder.encodeMp4 ? (caps.encoder.error ? `The video encoder didn’t load: ${caps.encoder.error.message}` : "This build has no video encoder yet.") : ""
		const blocked = !fresh || !!missing || !!why || !caps.encoder || job
		go.disabled = !!blocked
		go.querySelector("span").textContent = caps.loading ? "Preparing…" : "Export"
		const bad = missing || why
		if (bad) est.innerHTML = `<span class="xv-est-bad">${esc(bad)}</span>`
		else if (!s.sim || !T || !fresh) est.textContent = "" // (an estimate of an export that can't run yet, of the last run's frames, would mislead)
		else est.innerHTML = `<span class="xv-est-main">≈ ${fmtBytes(e.bytes)}<i>·</i>about ${fmtSpan(e.ms / 1000)} to make</span><span class="xv-est-sub">${e.realtime ? "Recorded as it plays (this browser has no fast video encoder)" : `${esc(fileNameFor(s.scene?.name))} · ${e.frames.toLocaleString()} frames`}</span>`
		go.title = !blocked ? "" : bad || (msg ? `${msg[0]}${/[.…!?]$/.test(msg[0]) ? "" : "."} ${msg[1]}` : "")
		syncButton()
	}

	// ----- the trim's event ticks (what happened, at the moments it did) -----
	function drawMarks() {
		const box = $(".xv-trim-marks")
		box.innerHTML = ""
		const sim = get().sim
		const T = Number(sim?.doc?.seconds) || 0
		if (!T) return
		const evs = sim.summary?.events ?? []
		for (const ev of evs) {
			const i = document.createElement("i")
			i.style.left = `${(ev.t / T) * 100}%`
			box.append(i)
		}
	}

	// ----- the live preview: the chosen camera through the trimmed run, small -----
	const pv = { playing: !reducedMotion(), t: 0, t0: 0, raf: 0, busy: null, last: 0, shown: null, scrub: null, failed: false, stillAt: null, forSim: null, times: [], timesSim: null, lastMs: null }
	/** The median time of the preview's recent frames (this scene, this device, the export's own renderer); before three of this run are timed, the last
	 *  run's (a scene just edited costs about what it did), else null. */
	function previewMs() {
		if (pv.timesSim !== get().sim || pv.times.length < 3) return pv.lastMs
		const a = [...pv.times].sort((x, y) => x - y)
		return a[a.length >> 1]
	}
	function previewMsg(text) {
		const m = $(".xv-prev-msg")
		m.hidden = !text
		m.textContent = text || ""
	}
	function previewTime(now) {
		if (pv.scrub != null) return pv.scrub
		if (!pv.playing) return pv.t
		const len = Math.max(0, trim.end - trim.start)
		const u = ((now - pv.t0) / 1000) % (len + PREVIEW.hold)
		return trim.start + Math.min(len, u)
	}
	function previewLoop(now) {
		pv.raf = requestAnimationFrame(previewLoop)
		if (!isOpen() || mode !== "settings" || pv.busy || document.hidden) return
		if (!get().sim) return
		if (pv.forSim !== get().sim) { // (a new run landed: whatever stopped the last one's preview is tried again)
			pv.forSim = get().sim
			pv.failed = false
			pv.stillAt = null
			pv.shown = null
		}
		if (now - pv.last < 1000 / PREVIEW.fps) return
		const t = previewTime(now)
		if (pv.shown && pv.shown.t === t && pv.shown.cam === camNow() && pv.shown.sim === get().sim) return
		pv.last = now
		pv.busy = drawPreview(t).finally(() => (pv.busy = null))
	}
	async function drawPreview(t) {
		const s = get()
		const view = s.view
		const cam = camNow()
		const canRender = isFn(view?.renderFrame)
		dlg.classList.toggle("xv-still", !canRender)
		if (canRender) {
			if (pv.failed) return // (it says why; a new run, or opening the dialog again, tries again)
			$("#xv-prev-t").textContent = fmtT(t)
			$(".xv-trim-head").style.left = `${trim.seconds ? (t / trim.seconds) * 100 : 0}%`
			try {
				const began = performance.now()
				const src = await view.renderFrame(t, { width: PREVIEW.w, height: PREVIEW.h, camera: cam, motionBlur: false, preview: true })
				const took = performance.now() - began
				if (pv.timesSim !== s.sim) { pv.lastMs = previewMs() ?? pv.lastMs; pv.times = []; pv.timesSim = s.sim }
				if (took < 250) { pv.times.push(took); if (pv.times.length > 12) pv.times.shift() } // (not a session's first frame: it compiles)
				if (!isOpen() || mode !== "settings") return
				if (blit(pvCtx, src)) { pv.shown = { t, cam, sim: s.sim }; previewMsg("") }
				if (src instanceof ImageBitmap) src.close?.()
				else if (typeof VideoFrame !== "undefined" && src instanceof VideoFrame) src.close()
			} catch (e) {
				// The view refuses a frame while there is no finished run of the scene shown (an edit's run on its way, a run that failed, the scene
				// changing): the preview waits for the run, and shows nothing of the last one meanwhile. Anything else is a real failure.
				const state = freshness().state
				const transient = /no finished run|scene changed/i.test(e?.message) || state !== "fresh"
				if (!transient) { pv.failed = true; console.warn("Export preview:", e) }
				pv.shown = { t, cam, sim: s.sim } // (not asked again until the run, the moment or the camera changes)
				pvCtx.clearRect(0, 0, pvCanvas.width, pvCanvas.height)
				previewMsg(!transient ? "The preview couldn’t be drawn." : state === "running" ? "The preview shows once the run lands." : "The preview shows once the scene has run.")
			}
			return
		}
		// (no renderFrame yet: one still of the live view as it is, the moment it shows; it can't show another camera)
		if (pv.stillAt === s.sim && pv.shown) { if (pv.shown.cam !== cam) { pv.shown.cam = cam; previewMsg(cam !== s.cam ? "A still of the live view. The chosen camera shows in the video." : "") } return }
		const c = (o.viewEl ?? document.getElementById("view-3d"))?.querySelector("canvas")
		if (c && isFn(view?.render)) {
			view.render((s.t ?? 0) + 1e-7) // (a moment the view hasn't just drawn makes it draw now, so the canvas holds a picture while this reads it)
			blit(pvCtx, c)
			pv.stillAt = s.sim
			pv.shown = { t, cam, sim: s.sim }
			$("#xv-prev-t").textContent = fmtT(s.t ?? 0)
			previewMsg(cam !== s.cam ? "A still of the live view. The chosen camera shows in the video." : "")
		}
	}
	function setPreviewPlaying(on) {
		pv.playing = on
		const b = $('[data-act="preview"]')
		b.classList.toggle("playing", on)
		b.setAttribute("aria-label", on ? "Pause the preview" : "Play the preview")
		if (on) pv.t0 = performance.now() - (pv.t - trim.start) * 1000
		else pv.t = pv.shown?.t ?? trim.start
	}
	const redrawPreview = () => { pv.shown = null }

	// ----- the top-bar button -----
	function syncButton() {
		const has = !!get().sim
		button.disabled = !has
		button.setAttribute("aria-label", "Export video") // (narrow windows show the icon alone)
		button.title = has ? "Export this scene as an MP4 video (E)" : "Export video: available once the scene has run"
	}

	// ----- opening and closing -----
	let wasPlaying = false // (the scene played when the dialog opened: it plays again when the dialog closes)
	/** The last file made is of the scene as it is now (its run, the same scene, nothing changed since). */
	const resultIsCurrent = () => !!result && result.sim === get().sim && result.sceneJSON === JSON.stringify(get().scene) && freshness().state === "fresh"
	async function open() {
		if (isOpen()) return
		if (!get().sim) return toast("Run the scene first: the video is made from its physics")
		lastFocus = document.activeElement
		wasPlaying = !!get().playing
		o.pause?.()
		if (!set.camera) set.camera = CAMERAS.some((c) => c.id === get().cam) ? get().cam : "wide"
		caps.render = isFn(get().view?.renderFrame)
		try { const rec = get().view?.exportInfo?.()?.recommended; if (rec && typeof rec === "object") caps.recommendedBlur = Number(rec.motionBlur) > 0 } catch {} // (before the first render: the toggle must not flick)
		pv.failed = false
		pv.shown = null
		pv.stillAt = null
		if (!job) setPane(mode === "done" && resultIsCurrent() ? "done" : "settings")
		dlg.showModal()
		dlg.classList.remove("xv-in")
		void dlg.offsetWidth
		dlg.classList.add("xv-in")
		setPreviewPlaying(pv.playing)
		pv.t0 = performance.now()
		render()
		;(mode === "done" ? $('[data-act="download"]') : $(".xv-sheet")).focus({ preventScroll: true })
		cancelAnimationFrame(pv.raf)
		pv.raf = requestAnimationFrame(previewLoop)
		caps.loading || loadEncoder().then(() => isOpen() && render())
		await Promise.all([viewFacts(), loadEncoder().then(audioSupport)]).catch(() => {})
		if (isOpen()) { render(); redrawPreview() }
	}
	/** The view's export session ends now (its targets freed, the canvas drawn again with what was asked of it meanwhile) rather than 4 s after the last frame. */
	function endSession(view = get().view) { try { view?.endExport?.() } catch {} }
	function close() {
		if (!isOpen() || job) return
		cancelAnimationFrame(pv.raf)
		video.pause()
		dlg.close()
	}
	dlg.addEventListener("close", () => {
		cancelAnimationFrame(pv.raf)
		video.pause()
		if (job) { dlg.showModal(); return } // (an export keeps its dialog: Cancel export is the way out)
		Promise.resolve(pv.busy).catch(() => {}).finally(() => { if (!isOpen() && !job) endSession() }) // (the preview's session: once its last frame is in)
		if (lastFocus?.isConnected) lastFocus.focus?.({ preventScroll: true })
		if (wasPlaying && !get().playing) o.play?.() // (it was playing when the dialog opened)
		wasPlaying = false
		syncButton()
	})
	// the page under the dialog must not see its keys (Space would play, ⌘Z undo, ⌫ delete…); Escape closes, except while exporting
	dlg.addEventListener("keydown", (e) => {
		e.stopPropagation()
		if (e.key === "Escape" && job) e.preventDefault()
		const g = e.target.closest?.(".xv-seg")
		if (g && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { // a radio group: the arrows pick the next one that can be picked
			e.preventDefault()
			const bs = [...g.querySelectorAll("button")].filter((b) => !b.hidden && !b.disabled)
			const i = bs.indexOf(e.target)
			const n = bs[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + bs.length) % bs.length]
			if (n) { n.click(); n.focus() }
		}
	})
	window.addEventListener("keydown", (e) => { if (isOpen() && !dlg.contains(e.target)) { e.stopImmediatePropagation(); if (e.key === "Escape" && job) e.preventDefault() } }, true)
	// a click on the backdrop closes it (a press that began on the backdrop: a trim drag let go out there is not a click on it)
	let downOnBackdrop = false
	dlg.addEventListener("pointerdown", (e) => (downOnBackdrop = e.target === dlg))
	dlg.addEventListener("click", (e) => {
		if (e.target === dlg && downOnBackdrop && !job) close()
		downOnBackdrop = false
	})
	/** Tell a screen reader what just happened (the panes change under it). */
	const say = (text) => { const a = $(".xv-sr"); a.textContent = ""; setTimeout(() => (a.textContent = text), 30) }
	/** A short note inside the dialog (the page's toast sits under a modal dialog). */
	function flash(text) {
		const f = $(".xv-flash")
		f.textContent = text
		f.hidden = false
		f.classList.remove("xv-flash-in")
		void f.offsetWidth
		f.classList.add("xv-flash-in")
		clearTimeout(flashTimer)
		flashTimer = setTimeout(() => (f.hidden = true), 3200)
	}

	// ----- the controls -----
	dlg.addEventListener("click", (e) => {
		const b = e.target.closest("button")
		if (!b || b.disabled || !dlg.contains(b)) return
		const seg = b.closest(".xv-seg")
		if (seg) {
			const k = seg.dataset.k
			const v = b.dataset.v
			if (k === "fps") set.fps = Number(v)
			else set[k] = v
			if (k === "camera") redrawPreview()
			remember()
			render()
			return
		}
		const act = b.dataset.act
		if (act === "close") close()
		else if (act === "export") startExport()
		else if (act === "cancel") job?.ctl.abort()
		else if (act === "again") { setPane("settings"); video.pause(); render(); redrawPreview(); $("#xv-go").focus({ preventScroll: true }) }
		else if (act === "download") { if (result) { download(result); flash(`Downloading ${result.name}`) } }
		else if (act === "copy") copyResult()
		else if (act === "share") shareResult()
		else if (act === "rerun") { o.rerun?.(); render() }
		else if (act === "full") { trim.start = 0; trim.end = trim.seconds; trim.touched = false; render(); redrawPreview() }
		else if (act === "preview") setPreviewPlaying(!pv.playing)
	})
	for (const k of ["blur", "sound"]) {
		$(`input[data-k="${k}"]`).addEventListener("change", (e) => {
			set[k] = e.target.checked
			if (k === "blur") set.blurChosen = true
			remember()
			render()
		})
	}
	// trim: two handles. The keyboard works the two range inputs; a pointer anywhere on the strip moves the nearer handle (the inputs lie
	// over each other, so the page picks the handle, not the browser). While a handle moves, the preview shows that moment.
	const setTrim = (which, v) => {
		const T = trim.seconds
		v = Math.round(v * 100) / 100
		if (which === "a") trim.start = clamp(v, 0, Math.max(0, trim.end - MIN_LEN))
		else trim.end = clamp(v, Math.min(T, trim.start + MIN_LEN), T)
		trim.touched = true
		pv.scrub = which === "a" ? trim.start : trim.end
		render()
	}
	const endScrub = () => {
		if (pv.scrub == null) return
		pv.t = pv.playing ? trim.start : clamp(pv.scrub, trim.start, trim.end) // (paused: it stays on the moment the handle was let go at)
		pv.scrub = null
		pv.t0 = performance.now()
	}
	trimA.addEventListener("input", (e) => setTrim("a", Number(e.target.value)))
	trimB.addEventListener("input", (e) => setTrim("b", Number(e.target.value)))
	for (const inp of [trimA, trimB]) {
		inp.addEventListener("change", endScrub)
		inp.addEventListener("blur", endScrub)
		inp.addEventListener("keyup", endScrub)
	}
	const trimBox = $("#xv-trim")
	const THUMB = 18 // px: the handles' width (export.css), whose centres run from THUMB/2 to width - THUMB/2
	const valueAt = (x) => {
		const r = trimBox.getBoundingClientRect()
		return clamp((x - r.left - THUMB / 2) / Math.max(1, r.width - THUMB), 0, 1) * trim.seconds
	}
	let dragging = null
	trimBox.addEventListener("pointerdown", (e) => {
		if (!trim.seconds || e.button > 0 || trimA.disabled) return
		const v = valueAt(e.clientX)
		const dA = Math.abs(v - trim.start)
		const dB = Math.abs(v - trim.end)
		dragging = dA < dB || (dA === dB && v <= trim.start) ? "a" : "b"
		e.preventDefault()
		trimBox.setPointerCapture(e.pointerId)
		;(dragging === "a" ? trimA : trimB).focus({ preventScroll: true })
		trimBox.classList.add("xv-dragging")
		setTrim(dragging, v)
	})
	trimBox.addEventListener("pointermove", (e) => { if (dragging) setTrim(dragging, valueAt(e.clientX)) })
	const dragEnd = () => {
		if (!dragging) return
		dragging = null
		trimBox.classList.remove("xv-dragging")
		endScrub()
	}
	trimBox.addEventListener("pointerup", dragEnd)
	trimBox.addEventListener("pointercancel", dragEnd)
	trimBox.addEventListener("lostpointercapture", dragEnd)

	// ----- exporting -----
	/** What encodeMp4 (web/export/encoder.js) is given: its own contract, nothing more (the bitrate is its default, videoBitrate()). */
	function encodeOptions(p) {
		return {
			frames: p.frame, // (i) → the frame source of frame i (t = start + i / fps), handed over in the task that drew it
			frameCount: p.total,
			fps: p.fps,
			width: p.w,
			height: p.h,
			audio: p.audio, // an AudioBuffer (or null): the impact sounds, t = 0 at the first frame
			title: p.title,
			signal: p.signal,
			onProgress: p.onProgress,
		}
	}
	/** The impact sounds of the trimmed part as one AudioBuffer (video time: 0 is the first frame). audio.js (synthesizeImpacts(impacts, doc,
	 *  {duration, sampleRate, track, stage, panAt})) reads each impact's time both for when it sounds and for where it is (from the track), so the
	 *  whole run is made with the engine's own times and the trimmed window is cut out of it: a hit just before the start still rings into the video
	 *  (faded in over 4 ms: a cut in the middle of a ring would click). Every hit is panned to where it shows in the video: the view's
	 *  exportProject(t, x, y, {camera, width, height}) through the export's own shot (Follow and Director move; the stage's place is the fallback). */
	async function soundFor(sim, scene, start, end, seconds, signal, shot) {
		const synth = caps.encoder?.synthesizeImpacts
		if (!isFn(synth)) throw new Error("this build has no sound maker yet")
		const rate = 48000
		const view = get().view
		const panAt = shot && isFn(view?.exportProject) ? (t, x, y) => view.exportProject(t, x, y, shot) : undefined
		const whole = await raceAbort(synth(sim.track?.impacts ?? [], sim.doc, { duration: Math.max(end, Number(sim.doc?.seconds) || end), sampleRate: rate, track: sim.track, stage: scene?.stage, panAt }), signal)
		if (!(typeof AudioBuffer !== "undefined" && whole instanceof AudioBuffer)) throw new Error("the sound maker gave back no sound")
		const sr = whole.sampleRate
		const from = Math.round(start * sr)
		const length = Math.max(1, Math.round(seconds * sr))
		if (from === 0 && length === whole.length) return whole
		const out = new AudioBuffer({ length, numberOfChannels: whole.numberOfChannels, sampleRate: sr })
		for (let c = 0; c < whole.numberOfChannels; c++) out.copyToChannel(whole.getChannelData(c).subarray(from, Math.min(whole.length, from + length)), c)
		if (from > 0) { // a 4 ms raised-cosine fade-in: sample 0 may be in the middle of a ringing hit
			const nf = Math.min(length, Math.round(0.004 * sr))
			for (let c = 0; c < out.numberOfChannels; c++) {
				const d = out.getChannelData(c)
				for (let i = 0; i < nf; i++) d[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nf)
			}
		}
		return out
	}
	const toBlob = (r) => {
		if (r instanceof Blob) return r.type ? r : new Blob([r], { type: "video/mp4" })
		const x = r?.blob ?? r?.file ?? r?.data ?? r?.buffer ?? r
		if (x instanceof Blob) return x
		if (x instanceof ArrayBuffer || ArrayBuffer.isView(x)) return new Blob([x], { type: "video/mp4" })
		throw new Error("the encoder gave back no file")
	}

	let starting = false
	async function startExport() {
		if (job || starting) return
		const fr = freshness()
		if (fr.state !== "fresh") return render()
		starting = true
		const enc = await loadEncoder().finally(() => (starting = false))
		const s = get()
		const view = s.view
		if (!isFn(view?.renderFrame) || !isFn(enc.encodeMp4)) return render()
		const sim = s.sim
		const r = resNow()
		const fps = set.fps
		const start = trim.start
		const end = trim.end
		const total = Math.max(1, Math.round((end - start) * fps))
		const camera = camNow()
		const blur = blurNow()
		const wantSound = set.sound && caps.audio?.ok !== false && impactsIn(sim).length > 0
		const sceneJSON = JSON.stringify(s.scene) // (the done pane is shown again only for this very scene)
		const name = fileNameFor(s.scene?.name)
		const ctl = new AbortController()
		const est0 = estimate() // (what the dialog said it would take: the real time teaches the next estimate)
		const t0 = performance.now()
		const title = document.title
		job = { ctl, total, done: 0, t0, times: [], phase: "", encPhase: null, lastLive: 0, lastPaint: 0, finishing: false }
		const phase = (text) => { job.phase = text; job.encPhase = null; paintProgress(true) }
		o.pause?.()
		cancelAnimationFrame(pv.raf)
		await pv.busy
		setPane("progress")
		say(`Exporting ${total} frames`)
		liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height)
		if (pvCanvas.width) blit(liveCtx, pvCanvas) // (the preview's last picture until the first real frame)
		$("#xv-p-what").textContent = `${name} · ${r.w} × ${r.h} · ${fps} fps${blur ? " · motion blur" : ""}${wantSound ? " · sound" : ""}`
		$("#xv-p-note").textContent = ""
		$(".xv-sheet").focus({ preventScroll: true }) // (not the Cancel button: a stray Space or Enter must not end a long export)
		phase("Getting every model ready…") // (the bar, the frame count and the time left start afresh, before anything is awaited)
		syncButton()
		const unload = (e) => { e.preventDefault(); e.returnValue = "" }
		window.addEventListener("beforeunload", unload)
		let lock = null
		try { lock = await navigator.wakeLock?.request("screen") } catch {}
		let soundNote = ""
		let cancelled = false
		try {
			if (isFn(view.whenSettled)) await raceAbort(withTimeout(view.whenSettled(), 30000), ctl.signal)
			// the run every frame must be of (the view refuses a frame of another: the scene was edited and re-run mid-export)
			let runId
			try { runId = isFn(view.exportInfo) ? view.exportInfo()?.runId : undefined } catch {}
			let audio = null
			if (wantSound) {
				phase("Making the impact sounds…")
				try { audio = await soundFor(sim, s.scene, start, end, total / fps, ctl.signal, { camera, width: r.w, height: r.h }) } catch (e) {
					if (isAbort(e)) throw e
					console.warn("Export sound:", e)
					soundNote = `The sound couldn’t be made (${e.message}), so this video is silent.`
				}
			}
			phase(`Rendering ${r.w} × ${r.h}`)
			let lastHop = 0
			/** Is the run on screen still the one being exported? (an edit shows a layout preview first, then its run lands with another runId) */
			const sceneMoved = () => {
				const now = get()
				let rid = runId
				try { if (runId !== undefined) rid = view.exportInfo()?.runId } catch {}
				return now.sim !== sim || !!now.layout || rid !== runId
			}
			const sceneChanged = () => Object.assign(new Error("The scene changed while the video was being made. Export it again."), { code: "input" })
			const frame = async (i) => {
				// the page paints the progress and takes the Cancel click here, BEFORE the frame is drawn: a WebGL canvas must reach the encoder
				// in the task that drew it (the browser clears it once it presents), so nothing after renderFrame may yield to the event loop
				if (performance.now() - lastHop > 50) { await hop(); lastHop = performance.now() }
				if (ctl.signal.aborted) throw abortError()
				if (sceneMoved()) throw sceneChanged()
				const t = Math.min(end, start + i / fps)
				let src
				try {
					src = await view.renderFrame(t, { width: r.w, height: r.h, camera, motionBlur: blur, fps, runId, quality: "high", start, end, index: i, frames: total })
				} catch (e) {
					if (ctl.signal.aborted) throw abortError()
					// the view's own words are for developers: say what happened ("renderFrame: no finished run…" is the scene being changed)
					if (sceneMoved() || /scene changed|no finished run/i.test(e?.message)) throw sceneChanged()
					throw Object.assign(new Error(String(e?.message || e).replace(/^renderFrame: /, "")), { code: /context was lost/i.test(e?.message) ? "encoder" : "input", cause: e })
				}
				if (!sourceOf(src) && !(typeof ImageData !== "undefined" && src instanceof ImageData)) throw Object.assign(new Error(`Frame ${i + 1} came back empty from the renderer.`), { code: "input" })
				const now = performance.now()
				job.times.push(now)
				job.done = Math.max(job.done, i + 1)
				if (now - job.lastLive > 120 || i + 1 === total) { job.lastLive = now; blit(liveCtx, src) } // (before the encoder takes it: it closes a VideoFrame)
				paintProgress()
				return src
			}
			const onProgress = (q) => { // encodeMp4's {phase, frame, frames, fraction}
				if (!q || typeof q !== "object") return
				job.encPhase = q.phase === "prepare" ? "Starting the video encoder…" : q.phase === "audio" ? "Encoding the sound…" : null
				if (q.phase === "finalize" || q.phase === "done") job.finishing = true
				paintProgress(true)
			}
			const out = await raceAbort(enc.encodeMp4(encodeOptions({ w: r.w, h: r.h, fps, total, audio, title: s.scene?.name || "Physics Sandbox", frame, signal: ctl.signal, onProgress })), ctl.signal)
			const blob = toBlob(out)
			if (!blob.size) throw new Error("the file came out empty")
			const info = out?.info ?? blob.info ?? {}
			const ext = isFn(enc.mod?.extensionFor) ? enc.mod.extensionFor(blob.type) : /webm/i.test(blob.type) ? "webm" : "mp4"
			const fileName = name.replace(/\.mp4$/, "." + ext)
			if (get().sim !== sim) throw new Error("The scene changed while the video was being made. Export it again.")
			// what this device managed, for the next estimate
			const ms = performance.now() - t0
			if (info.path !== "mediarecorder") { // (a real-time recording says nothing about this device's speed or the encoder's sizes)
				const k = blur ? "blur" : "plain"
				if (est0.base > 0 && total >= 10) {
					const ratio = clamp((ms - est0.overhead) / total / est0.base, 0.2, 5)
					calib.k[k] = calib.k[k] > 0 ? calib.k[k] * 0.5 + ratio * 0.5 : ratio
				}
				const videoBytes = Math.max(0, blob.size - 40e3 - (info.audio ? ((info.audio.bitrate || AUDIO_KBPS * 1000) / 8) * (total / fps) : 0))
				const share = clamp(videoBytes / ((bitrateFor(r, fps) / 8) * (total / fps)) / SIZE_RES[r.id], 0.005, 2)
				calib.bytes[camera] = calib.bytes[camera] > 0 ? calib.bytes[camera] * 0.4 + share * 0.6 : share
			}
			remember()
			const notes = [soundNote, ...(Array.isArray(info.warnings) ? info.warnings : [])].filter(Boolean)
			finish({ blob, name: fileName, w: r.w, h: r.h, fps, seconds: Number(info.duration) > 0 ? info.duration : total / fps, sim, sceneJSON, sound: !!info.audio || (!!audio && !info.path), note: notes.join(" "), ms })
		} catch (e) {
			if (isAbort(e) || ctl.signal.aborted) {
				cancelled = true
				setPane("settings")
				render()
				redrawPreview()
				flash("Export cancelled. Nothing was saved.")
				say("Export cancelled")
			} else {
				// what a person can run into (the scene changed, this browser can't make it, the tab was in the background, the GPU gave up) is reported
				// in the dialog in plain words; only the unexpected is an error in the console
				const expected = ["input", "unsupported"].includes(e?.code) || isReclaimed(e) || /context (was )?lost|CONTEXT_LOST/i.test(String(e?.message))
				;(expected ? console.warn : console.error)(expected ? "Export stopped:" : "Export failed:", e)
				$("#xv-err").textContent = plainError(e, r, fps)
				setPane("error")
				say("The export stopped. " + $("#xv-err").textContent)
				$('[data-foot="error"] [data-act="export"]').focus({ preventScroll: true })
			}
		} finally {
			ctl.abort() // (anything still running for this job stops)
			endSession(view)
			job = null
			window.removeEventListener("beforeunload", unload)
			try { await lock?.release() } catch {}
			document.title = title
			syncButton()
			if (isOpen() && mode === "settings") { render(); cancelAnimationFrame(pv.raf); pv.raf = requestAnimationFrame(previewLoop) }
			if (cancelled && isOpen() && mode === "settings") { const go = $("#xv-go"); (go.disabled ? $(".xv-sheet") : go).focus({ preventScroll: true }) } // (focus stays in the dialog)
		}
	}
	/** The browser took the video encoder back (a QuotaExceededError: "Codec reclaimed due to inactivity", most often a tab in the background). */
	const isReclaimed = (e) => e?.name === "QuotaExceededError" || e?.cause?.name === "QuotaExceededError" || /took the video encoder back|reclaimed/i.test(String(e?.message))
	function plainError(e, r, fps) {
		const m = String(e?.message || e || "unknown error")
		if (isReclaimed(e)) return "The browser paused the video encoder (it does this when the tab is in the background or memory is short). Keep this tab in front and try again."
		if (e?.code === "unsupported") return m + (/can.t encode|would not start/i.test(m) && !/smaller size/.test(m) && (r.h > 720 || fps > 30) ? " A smaller size or 30 fps may work." : "") // (the encoder's own words)
		if (e?.name === "NotSupportedError" || /not supported|unsupported/i.test(m)) return `This browser can’t encode ${r.w} × ${r.h} at ${fps} fps (${m}). Try a smaller size or 30 fps.`
		if (/context (was )?lost|CONTEXT_LOST/i.test(m)) return "The graphics stopped responding while drawing the frames. Try again, or a smaller size."
		if (/out of memory|memory|allocation/i.test(m)) return `This device ran out of memory for a video this big. Try a smaller size or a shorter part of the run.`
		return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".")
	}
	function paintProgress(force) {
		if (!job) return
		const now = performance.now()
		if (!force && now - job.lastPaint < 80) return
		job.lastPaint = now
		const { done, total, t0 } = job
		const frac = clamp(done / total, 0, 1)
		const pct = Math.floor(frac * 100)
		const bar = $(".xv-bar")
		bar.style.setProperty("--p", String(frac))
		bar.setAttribute("aria-valuenow", String(pct))
		const finishing = job.finishing || done >= total
		$("#xv-p-phase").textContent = finishing ? "Finishing the file…" : job.encPhase ?? job.phase
		$("#xv-p-frames").textContent = done ? `Frame ${done.toLocaleString()} of ${total.toLocaleString()} · ${pct}%` : `${total.toLocaleString()} frames`
		const el = (now - t0) / 1000
		$("#xv-p-el").textContent = `${fmtSpan(el)} so far`
		// time left: the pace of the last 40 frames
		let eta = ""
		const ts = job.times
		if (finishing) eta = "Almost done"
		else if (ts.length >= 10) { // (the first frames are quicker than the rest: the pace of a few would promise too much)
			const n = Math.min(40, ts.length - 1)
			const per = (ts[ts.length - 1] - ts[ts.length - 1 - n]) / n
			const left = ((total - done) * per + 400) / 1000
			eta = left < 2 && frac > 0.5 ? "Almost done" : `About ${fmtSpan(left)} left`
		} else eta = "Working out the time…"
		$("#xv-p-eta").textContent = eta
		$(".xv-live-badge").lastChild.textContent = finishing ? "Finishing" : done ? "Rendering" : "Preparing"
		document.title = `${pct}% · Exporting video`
	}

	// ----- the finished file -----
	function finish(res) {
		if (result?.url) URL.revokeObjectURL(result.url)
		result = { ...res, url: URL.createObjectURL(res.blob), size: res.blob.size }
		download(result)
		setPane("done")
		video.muted = true
		video.src = result.url
		if (!reducedMotion()) video.play().catch(() => {})
		$("#xv-f-name").textContent = result.name
		$("#xv-f-meta").textContent = `${fmtBytes(result.size)} · ${fmtSpan(result.seconds)} · ${result.w} × ${result.h} · ${result.fps} fps${result.sound ? " · with sound" : ""}`
		video.onloadedmetadata = () => { if (Number.isFinite(video.duration) && video.duration > 0) $("#xv-f-meta").textContent = `${fmtBytes(result.size)} · ${fmtSpan(video.duration)} · ${result.w} × ${result.h} · ${result.fps} fps${result.sound ? " · with sound" : ""}` }
		const note = $("#xv-d-note")
		note.hidden = !res.note
		note.textContent = res.note || ""
		const file = new File([result.blob], result.name, { type: result.blob.type || "video/mp4" })
		let canCopy = false
		try { canCopy = !!(window.ClipboardItem && isFn(ClipboardItem.supports) && ClipboardItem.supports(file.type) && navigator.clipboard?.write) } catch {}
		let canShare = false
		try { canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) } catch {}
		$('[data-act="copy"]').hidden = !canCopy
		$('[data-act="share"]').hidden = !canShare
		result.file = file
		say(`Export finished: ${result.name}, ${fmtBytes(result.size)}. Downloading.`)
		if (!isOpen()) dlg.showModal()
		$('[data-act="download"]').focus({ preventScroll: true })
	}
	function download(res) {
		const a = document.createElement("a")
		a.href = res.url
		a.download = res.name
		a.hidden = true
		dlg.append(a) // (inside the dialog: a modal dialog makes everything else inert)
		a.click()
		a.remove()
	}
	async function copyResult() {
		if (!result) return
		try {
			await navigator.clipboard.write([new ClipboardItem({ [result.file.type]: result.blob })])
			flash("Copied: paste it into a message or a document")
		} catch (e) { flash("Couldn’t copy it: " + (e?.message || e)) }
	}
	async function shareResult() {
		if (!result) return
		try { await navigator.share({ files: [result.file], title: result.name }) } catch (e) { if (!isAbort(e)) flash("Couldn’t share it: " + (e?.message || e)) }
	}

	// ----- keeping up with the page -----
	function sync() {
		syncButton()
		if (isOpen() && !job && mode === "done" && result && get().sim !== result.sim) { setPane("settings"); video.pause() } // (a new run: the file shown is of the last scene)
		if (isOpen() && mode === "settings") {
			const sim = get().sim
			if (trim.sim !== sim) { pv.failed = false; pv.stillAt = null; redrawPreview() }
			render()
		}
	}
	if (statusEl) {
		new MutationObserver(() => {
			if (statusEl.dataset.state === "ok") stamp() // (a run just landed: this is the scene it ran)
			sync()
		}).observe(statusEl, { attributes: true, attributeFilter: ["data-state"], childList: true, subtree: true, characterData: true })
	}
	setInterval(() => { syncButton(); if (isOpen() && mode === "settings") render() }, 1000) // (an edit that changes no status: a drag, an undo that waits for its run)

	button.addEventListener("click", () => (isOpen() ? close() : open()))
	const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"])
	window.addEventListener("keydown", (e) => {
		if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "e") return
		const el = e.target
		const tag = el?.tagName
		if (el && (el.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !NOT_TEXT.has((el.type || "").toLowerCase())))) return
		if (el?.closest?.("#catalog, .ai-drawer, dialog, [role=dialog]")) return
		const cat = document.getElementById("catalog")
		if (cat && !cat.hidden) return
		const s = get()
		if (s.editing || button.disabled || isOpen()) return
		e.preventDefault()
		open()
	})
	syncButton()
	return { open, close, isOpen, sync, get result() { return result }, get settings() { return { ...set, start: trim.start, end: trim.end } } }
}
