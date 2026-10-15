// A library card's picture: the scene on the table at its start, the whole machine in the Wide shot, 640 x 360. Taken through the view's export
// interface (web/view3d.js renderFrame: its own targets, never the canvas; web/CONTRACT.md "Export"), so the picture is the same studio, models and
// light as the view, whatever camera or selection the person has on screen. While the frame is drawn the canvas keeps its picture (the view's
// export session): the session is ended at once, so the canvas carries on drawing a few milliseconds later.
//   const blob = await captureThumb(view)   // a WebP Blob (JPEG where the browser can't make WebP), or null when the view can't take one now

export const THUMB_W = 640
export const THUMB_H = 360

/** Can the view take a picture of a finished run now? (not during a video export, a layout preview, or without WebGL) */
export function canCapture(view) {
	if (!view || typeof view.renderFrame !== "function") return false
	try {
		const info = view.exportInfo?.()
		if (info && (!info.ready || info.exporting || info.softwareGL)) return false // (a software renderer: a frame takes seconds of main thread)
	} catch {
		return false
	}
	return true
}

async function encode(canvas, type, quality) {
	if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality })
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function captureThumb(view, { width = THUMB_W, height = THUMB_H } = {}) {
	if (!canCapture(view)) return null
	const runId = view.exportInfo?.()?.runId
	let copy
	try {
		const frame = await view.renderFrame(0, { width, height, camera: "wide", runId, samples: 4 })
		// (the view reuses its canvas for the next frame: copy it now)
		copy = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height })
		const g = copy.getContext("2d")
		if (frame instanceof ImageData) g.putImageData(frame, 0, 0)
		else g.drawImage(frame, 0, 0, width, height)
	} finally {
		try {
			view.endExport?.() // the canvas draws again now (else it would wait 4 s for the session to time out)
		} catch {}
	}
	let blob = await encode(copy, "image/webp", 0.82)
	if (!blob || blob.type !== "image/webp") blob = await encode(copy, "image/jpeg", 0.85) // (Safari makes PNG when asked for WebP: JPEG is smaller)
	return blob && blob.size > 0 ? blob : null
}
