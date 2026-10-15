// MP4 export: encodes frames (and an optional sound track) into an H.264 + AAC .mp4 in the browser. Plain ES module; nothing loads until used.
//
//   encodeMp4({frames, frameCount?, fps, width, height, bitrate?, audio?, title?, keyframeSeconds?, fallback?, signal?, onProgress?}) → Blob
//   checkSupport({width, height, fps, bitrate?, audio?, audioCodec?}) → {ok, video, audio, audioReason, fallback, reason}
//   videoBitrate(width, height, fps), avcLevel(width, height, fps, bitrate), extensionFor(mimeType)
//
// The path: WebCodecs VideoEncoder (H.264 High profile, the level chosen for the size and rate, hardware preferred, a key frame every 2 s) and
// AudioEncoder (AAC-LC 48 kHz stereo 192 kbps; Opus when the browser has no AAC encoder), muxed by mediabunny into one MP4 with the index (moov)
// before the media (mdat), so it plays as soon as it starts loading: QuickTime, Safari, Chrome, Firefox, VLC, Windows' players, phones.
// Without WebCodecs (an old browser: no VideoEncoder at all) it records the frames in real time with MediaRecorder instead (WebM or MP4, whatever
// the browser makes; see recordRealtime); `fallback: false` turns that off and throws the reason instead. A browser that has a VideoEncoder which
// can't make this size or rate is not sent there (it would record a slowed-down video): it throws the encoder's reason ("unsupported").
//
// Timing is exact: frame i is at round(i·10⁶/fps) µs and the muxer snaps the track to a timescale of fps ticks per second (60 fps: one tick a
// frame), so there is no drift over any length. Sound is exact to the sample: an encoder delays its output (AAC's "priming": 2112 samples,
// 44 ms, on macOS, measured once per codec by encoding and decoding three clicks, measureCodecDelay; Opus' pre-skip: read from its header), the
// sound packets are timed that much earlier so the muxer writes an edit list that trims it, and the sound track gets the "roll" sample group
// that tells a decoder each packet needs the one before it (mp4boxes.js; without it QuickTime and Safari trim the delay a second time and play
// the sound 44 ms early). As ffmpeg writes them; checked with ffmpeg, AVFoundation (QuickTime, Safari) and Chrome: 0 samples off, every impact
// heard on the frame it happens. The sound track ends at or before the last frame (faded over 10 ms), so the file lasts exactly the video.
//
// The muxer: mediabunny (pinned in package.json, vendored by tools/vendor-media.mjs into web/vendor/mediabunny/mediabunny.js; the importmap
// maps "mediabunny" to it) rather than mp4-muxer 5.2.2. Both are by the same author and write the same core boxes, and mp4-muxer is smaller
// (69 KB vs 244 KB for the parts used here, 14 vs 48 KB gzipped, loaded only when an export starts), but mp4-muxer is deprecated ("superseded
// by Mediabunny": npm warns on every install, no fixes since 2025) and cannot write an edit list, so its AAC plays 44 ms late in ffmpeg-based
// players (Chrome, VLC) with no way to trim the priming. mediabunny writes the edit list from a negative first timestamp, snaps the video's
// timestamps to the frame rate, and is maintained; the bundle holds only the six names used, tree-shaken by esbuild.
//
// frames: either a function (i) → source (or a promise of one), called for i = 0 … frameCount − 1 in order, or an (async) iterable of sources.
//   A source is a canvas (HTMLCanvasElement or OffscreenCanvas, 2D or WebGL), an ImageBitmap, an <img>, a <video>, an ImageData or a
//   VideoFrame. A VideoFrame or ImageBitmap handed over is the encoder's: it closes it once copied (a canvas or image stays the caller's).
//   One of another size is scaled to width × height (stretched: give the export's own size). A WebGL canvas made without
//   preserveDrawingBuffer must be handed over in the same task that drew it (return it right after renderer.render; an `await` of a
//   resolved promise in between is fine, a setTimeout or requestAnimationFrame is not: the browser clears it after presenting).
// frameCount: required with a function; with an iterable, the most frames taken (and what the progress counts to).
// fps: frames per second (30 or 60 in the app; any rate from 1 to 240). width, height: even whole numbers (H.264 4:2:0), up to 8192 × 4320.
// bitrate: bits per second; default videoBitrate(): 12 Mbps at 1080p60, 8 Mbps at 1080p30 (YouTube's recommended rates, scaled by size).
// audio: an AudioBuffer (web/export/audio.js synthesizeImpacts makes one); any rate and channel count (made 48 kHz stereo here). It is laid
//   from t = 0 and cut at the video's end (padded with silence when shorter). A buffer that does not start from silence (a part cut out of a longer
//   run, in the middle of a ringing hit) is faded in over 4 ms: a step from silence would click in every player.
// signal: an AbortSignal; aborting stops at the next frame and rejects with signal.reason (an AbortError by default).
// onProgress({phase, frame, frames, fraction}): phase "prepare" | "audio" | "video" | "finalize" | "done"; fraction 0…1 of the whole job.
// title: written into the file's metadata (the scene's name).
// keyframeSeconds: a key frame every this many seconds (default 2). audioCodec: "auto" (AAC, else Opus) or "opus" (Opus first; for tests).
//
// The Blob's type is "video/mp4" (or the recorder's type on the fallback path: use extensionFor(blob.type) for the file name) and it carries
// `blob.info`: {path: "webcodecs"|"mediarecorder", mimeType, width, height, fps, frames, duration, video: {codec, profile, level,
// hardwareAcceleration, bitrate}, audio: {codec ("aac"|"opus"), mimeCodec, sampleRate, channels, bitrate, delaySamples (the encoder delay the
// edit list trims), calibrated (it was measured), preroll (the roll group was written), packets} | null, warnings: [text: show them], ms};
// on the real-time path also droppedFrames (skipped to keep the video in time) and lateFrames (shown more than half a frame late).
// A failure rejects with an Error whose `code` is "unsupported" (with the reason), "aborted", "encoder" or "input".

import { addAudioPreroll } from "./mp4boxes.js"

const AUDIO_RATE = 48000
const AUDIO_CHANNELS = 2
const AAC_BITRATE = 192000
const OPUS_BITRATE = 160000 // Opus is transparent at 160 kbps stereo (AAC-LC needs ~192)
const QUEUE = 3 // frames waiting inside the VideoEncoder before we wait for it (backpressure: frames hold GPU memory)
const FADE_S = 0.01 // the sound's fade-out before the cut at the end
const FADE_IN_S = 0.004 // the fade-in of a sound that starts mid-way through a hit
const AAC_PRIMING = 2112 // samples an AAC encoder delays its output (Apple's, Chrome's, ffmpeg's); a MediaRecorder MP4 has no edit list to trim it

// ---------- sizes, rates, levels ----------

/** H.264 levels (ITU-T H.264 Table A-1): max macroblocks per second, max frame size in macroblocks, max bitrate in kbit/s (Baseline/Main; High
 *  allows 1.25×), and level_idc. */
const LEVELS = [
	["1", 1485, 99, 64, 10], ["1.1", 3000, 396, 192, 11], ["1.2", 6000, 396, 384, 12], ["1.3", 11880, 396, 768, 13],
	["2", 11880, 396, 2000, 20], ["2.1", 19800, 792, 4000, 21], ["2.2", 20250, 1620, 4000, 22],
	["3", 40500, 1620, 10000, 30], ["3.1", 108000, 3600, 14000, 31], ["3.2", 216000, 5120, 20000, 32],
	["4", 245760, 8192, 20000, 40], ["4.1", 245760, 8192, 50000, 41], ["4.2", 522240, 8704, 50000, 42],
	["5", 589824, 22080, 135000, 50], ["5.1", 983040, 36864, 240000, 51], ["5.2", 2073600, 36864, 240000, 52],
	["6", 4177920, 139264, 240000, 60], ["6.1", 8355840, 139264, 480000, 61], ["6.2", 16711680, 139264, 800000, 62],
]

/** The lowest H.264 level that holds this size, frame rate and bitrate in the High profile: {level, idc, maxBitrate (bps, High)}, or null. */
export function avcLevel(width, height, fps, bitrate = 0) {
	const mbw = Math.ceil(width / 16), mbh = Math.ceil(height / 16)
	const fs = mbw * mbh
	for (const [level, mbps, maxFs, maxBr, idc] of LEVELS) {
		const side = Math.sqrt(8 * maxFs) // each side may be at most sqrt(8·MaxFS) macroblocks
		if (fs <= maxFs && mbw <= side && mbh <= side && fs * fps <= mbps && bitrate <= maxBr * 1250) return { level, idc, maxBitrate: maxBr * 1250 }
	}
	return null
}

/** The default video bitrate (bps): YouTube's recommended upload rates (720p 5/7.5, 1080p 8/12, 1440p 16/24, 2160p 40/60 Mbps at 30/60 fps),
 *  interpolated by pixel count on a log-log scale, times (fps/30)^0.585 (1.5× at 60), rounded to 0.1 Mbps. */
export function videoBitrate(width, height, fps) {
	const pts = [[1280 * 720, 5e6], [1920 * 1080, 8e6], [2560 * 1440, 16e6], [3840 * 2160, 40e6]]
	const px = Math.max(1, width * height)
	let i = 0
	while (i < pts.length - 2 && px > pts[i + 1][0]) i++
	const [p0, b0] = pts[i], [p1, b1] = pts[i + 1]
	const at30 = Math.exp(Math.log(b0) + (Math.log(b1) - Math.log(b0)) * (Math.log(px) - Math.log(p0)) / (Math.log(p1) - Math.log(p0)))
	const bps = at30 * Math.pow(Math.max(1, fps) / 30, 0.585)
	return Math.max(200000, Math.round(bps / 1e5) * 1e5)
}

/** The file extension for a recorded type: "mp4" or "webm". */
export const extensionFor = (mimeType) => (/webm/i.test(mimeType ?? "") ? "webm" : "mp4")

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0")
const PROFILES = [ // [name, profile_idc + constraint flags]
	["High", "6400"],
	["Main", "4D40"],
	["Constrained Baseline", "42E0"],
]

function inputError(message) { return Object.assign(new RangeError(message), { code: "input" }) }
function unsupported(message) { return Object.assign(new Error(message), { code: "unsupported" }) }

function checkSize(width, height, fps) {
	if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) return `the size must be whole pixels (got ${width} × ${height})`
	if (width % 2 || height % 2) return `the width and height must be even for H.264 (got ${width} × ${height})`
	if (!(Number.isFinite(fps) && fps >= 1 && fps <= 240)) return `the frame rate must be 1 to 240 frames per second (got ${fps})`
	if (!avcLevel(width, height, fps)) return `${width} × ${height} at ${fps} fps is beyond H.264's largest level (6.2: up to 8192 × 4320 at 120 fps)`
	return null
}

// ---------- support ----------

const haveVideoEncoder = () => typeof VideoEncoder === "function" && typeof VideoFrame === "function" && typeof VideoEncoder.isConfigSupported === "function"
const haveAudioEncoder = () => typeof AudioEncoder === "function" && typeof AudioData === "function" && typeof AudioEncoder.isConfigSupported === "function"

/** The H.264 configs to try, best first: High, Main, then Constrained Baseline, each with hardware preferred, then any encoder. */
function videoCandidates(width, height, fps, bitrate) {
	const lv = avcLevel(width, height, fps, bitrate) ?? avcLevel(width, height, fps)
	const out = []
	for (const [profile, pc] of PROFILES) {
		for (const hardwareAcceleration of ["prefer-hardware", "no-preference"]) {
			out.push({
				profile, level: lv.level,
				config: {
					codec: `avc1.${pc}${hex2(lv.idc)}`, width, height, displayWidth: width, displayHeight: height, framerate: fps,
					bitrate: Math.min(bitrate, lv.maxBitrate), bitrateMode: "variable", latencyMode: "quality", hardwareAcceleration,
					avc: { format: "avc" }, // length-prefixed NAL units + an avcC description: what MP4 stores
				},
			})
		}
	}
	return out
}

function audioCandidates(prefer = "auto") {
	const list = [
		{ codec: "aac", mimeCodec: "mp4a.40.2", config: { codec: "mp4a.40.2", sampleRate: AUDIO_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: AAC_BITRATE, bitrateMode: "variable", aac: { format: "aac" } } },
		{ codec: "opus", mimeCodec: "opus", config: { codec: "opus", sampleRate: AUDIO_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: OPUS_BITRATE, bitrateMode: "variable" } },
	]
	return prefer === "opus" ? list.reverse() : list
}

async function supported(Kind, config) {
	try {
		const r = await Kind.isConfigSupported(config)
		return !!r?.supported
	} catch {
		return false
	}
}

/** What this browser can do for an export of this size (nothing is encoded). `ok`: the WebCodecs MP4 path works (video: the H.264 config
 *  chosen; audio: the sound codec, or null with `audioReason` when sound was asked for and cannot be encoded). When it does not, `reason`
 *  says why in plain words and `fallback` is {kind: "mediarecorder", mimeType} when real-time recording can stand in: only where the browser has
 *  no VideoEncoder at all (one that can't make this size says so, and a smaller size may work; recording it in real time would slow it down). */
export async function checkSupport({ width, height, fps, bitrate, audio = false, audioCodec = "auto" } = {}) {
	const bad = checkSize(width, height, fps)
	if (bad) return { ok: false, video: null, audio: null, audioReason: null, fallback: null, reason: `Can't export: ${bad}.` }
	const bps = bitrate ?? videoBitrate(width, height, fps)
	let video = null
	let reason = null
	if (!haveVideoEncoder()) reason = "This browser has no WebCodecs video encoder (it needs Chrome or Edge 94+, Safari 16.4+ or Firefox 130+)."
	else {
		for (const c of videoCandidates(width, height, fps, bps)) {
			if (await supported(VideoEncoder, c.config)) { video = c; break }
		}
		if (!video) reason = `This browser can't encode H.264 video at ${width} × ${height}, ${fps} fps${height > 1080 ? "; a smaller size may work" : ""}.`
	}
	let aud = null
	let audioReason = null
	if (audio && video) {
		if (!haveAudioEncoder()) audioReason = "This browser has no WebCodecs audio encoder, so the video will have no sound."
		else {
			for (const c of audioCandidates(audioCodec)) {
				if (await supported(AudioEncoder, c.config)) { aud = c; break }
			}
			if (!aud) audioReason = "This browser can encode neither AAC nor Opus sound, so the video will have no sound."
		}
	}
	const fallback = video || haveVideoEncoder() ? null : realtimeFallback(!!audio)
	return { ok: !!video, video, audio: aud, audioReason, fallback, reason }
}

// ---------- the sound track ----------

const delays = new Map() // config key -> {lag, frame, preSkip, calibrated, note}

/** Opus' pre-skip (samples a decoder drops at the start) from an OpusHead description, or null. */
function opusPreSkip(description) {
	if (!description) return null
	const b = description instanceof ArrayBuffer ? new Uint8Array(description) : new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
	if (b.length < 12 || String.fromCharCode(...b.subarray(0, 8)) !== "OpusHead") return null
	return b[10] | (b[11] << 8)
}

/** The encoder's delay in samples (what this browser's AudioDecoder outputs before the first input sample: AAC has no field for it, 2112 on
 *  macOS) and its packet length, measured by encoding three band-limited clicks and decoding them again; plus Opus' pre-skip from its header. */
async function measureCodecDelay(config) {
	const key = JSON.stringify(config)
	if (delays.has(key)) return delays.get(key)
	const sr = config.sampleRate
	const SEARCH = 8192 // the largest delay looked for (170 ms at 48 kHz); the clicks are farther apart than that
	const n = Math.round(sr * 1.4)
	const at = [Math.round(sr * 0.1), Math.round(sr * 0.5) + 371, Math.round(sr * 0.9) + 803] // off the packet grid on purpose
	const pcm = new Float32Array(n * config.numberOfChannels)
	for (const p of at) {
		for (let k = -12; k <= 12; k++) { // a click band-limited to 0.8 of Nyquist (sinc), Hann-windowed: its peak is exactly at p
			const x = 0.8 * Math.PI * k
			const v = 0.5 * (k === 0 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * k / 13))
			for (let c = 0; c < config.numberOfChannels; c++) pcm[c * n + p + k] = v
		}
	}
	let result
	try {
		const chunks = []
		let decoderConfig = null
		let failure = null
		const enc = new AudioEncoder({ output: (c, m) => { chunks.push(c); if (m?.decoderConfig && !decoderConfig) decoderConfig = m.decoderConfig }, error: (e) => { failure = e } })
		enc.configure(config)
		const data = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: config.numberOfChannels, timestamp: 0, data: pcm })
		enc.encode(data)
		data.close()
		await enc.flush()
		enc.close()
		if (failure) throw failure
		if (!decoderConfig || !chunks.length) throw new Error("the encoder gave no output")
		const frames = new Map()
		for (const c of chunks) { const f = Math.round(c.duration * sr / 1e6); frames.set(f, (frames.get(f) ?? 0) + 1) }
		const frame = [...frames].sort((a, b) => b[1] - a[1])[0][0]
		const parts = []
		const dec = new AudioDecoder({ output: (a) => { const f = new Float32Array(a.numberOfFrames); a.copyTo(f, { planeIndex: 0, format: "f32-planar" }); parts.push(f); a.close() }, error: (e) => { failure = e } })
		dec.configure(decoderConfig)
		for (const c of chunks) dec.decode(c)
		await dec.flush()
		dec.close()
		if (failure) throw failure
		const out = new Float32Array(parts.reduce((s, f) => s + f.length, 0))
		let o = 0
		for (const f of parts) { out.set(f, o); o += f.length }
		const lags = at.map((p) => {
			let best = -1, bv = 0
			for (let i = p; i < Math.min(out.length, p + SEARCH); i++) if (Math.abs(out[i]) > bv) { bv = Math.abs(out[i]); best = i }
			return bv > 0.1 ? best - p : NaN
		})
		const ok = lags.every((l) => Number.isFinite(l) && l >= 0 && Math.abs(l - lags[0]) <= 1)
		if (!ok) throw new Error(`the clicks came back inconsistent (${lags.join(", ")} samples)`)
		result = { lag: [...lags].sort((a, b) => a - b)[1], frame: frame > 0 ? frame : 1024, preSkip: opusPreSkip(decoderConfig.description), calibrated: true, note: null }
	} catch (e) {
		result = { lag: 0, frame: config.codec === "opus" ? 960 : 1024, preSkip: null, calibrated: false, note: `The sound's codec delay could not be measured (${e?.message ?? e}); it may be up to 50 ms late.` }
	}
	delays.set(key, result)
	return result
}

/** A 4 ms raised-cosine fade-in, in place, on planar samples (`length` a channel) that do not start from silence (a part cut out of a run in the
 *  middle of a ringing hit): sample 0 would otherwise be a step from silence, a click in every player. Silence at the start is left as it is. */
export function fadeIn(pcm, length, channels, sr) {
	let first = 0
	for (let c = 0; c < channels; c++) first = Math.max(first, Math.abs(pcm[c * length]))
	if (!(first > 1e-6)) return false
	const nf = Math.min(length, Math.round(FADE_IN_S * sr))
	for (let c = 0; c < channels; c++) for (let i = 0; i < nf; i++) pcm[c * length + i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / nf)
	return true
}

/** The buffer as 48 kHz stereo planar samples, exactly `length` long (cut, or padded with silence). */
async function toPlanar(buffer, length) {
	let b = buffer
	if (b.sampleRate !== AUDIO_RATE || b.numberOfChannels !== AUDIO_CHANNELS) {
		const ctx = new OfflineAudioContext(AUDIO_CHANNELS, Math.max(1, Math.ceil(b.duration * AUDIO_RATE)), AUDIO_RATE)
		const src = ctx.createBufferSource()
		src.buffer = b
		src.connect(ctx.destination) // mono is spread to both sides; more channels are mixed down by the Web Audio rules
		src.start()
		b = await ctx.startRendering()
	}
	const out = new Float32Array(length * AUDIO_CHANNELS)
	for (let c = 0; c < AUDIO_CHANNELS; c++) out.set(b.getChannelData(c).subarray(0, length), c * length)
	return out
}

/** Encodes the sound for a video of `seconds`: [{packet (EncodedPacket), meta?}], timed so the first sample plays at 0 and none after the end,
 *  with {delay, preroll} for the file: the encoder's delay (the muxer's edit list trims it: the first packets get negative times) and the roll
 *  sample group the sound track needs (mp4boxes.js addAudioPreroll), as ffmpeg writes them both:
 *    AAC: delay = the measured one (2112 on macOS), each packet needs the one before (roll −1);
 *    Opus: delay = its pre-skip (from its header, 312), each packet needs 80 ms before it (roll −4 for 20 ms packets, from the 5th on). */
async function encodeSound(mb, buffer, choice, seconds, signal, warnings) {
	const cal = await measureCodecDelay(choice.config)
	if (cal.note) warnings.push(cal.note)
	const opus = choice.codec === "opus"
	const delay = opus ? cal.preSkip ?? cal.lag : cal.lag
	const rollBack = opus ? Math.ceil(3840 / cal.frame) : 1
	const preroll = { rollDistance: -rollBack, skipFirst: opus ? rollBack : 0 }
	const sr = AUDIO_RATE
	const n = Math.round(seconds * sr)
	// The last packet that ends at or before the video's end: the sound stops there (the codec's packets can't be cut).
	const cut = Math.floor((n + delay) / cal.frame) * cal.frame - delay
	if (cut <= cal.frame) return []
	const pcm = await toPlanar(buffer, n)
	fadeIn(pcm, n, AUDIO_CHANNELS, sr)
	const fadeEnd = cut // the sound fades out to silence at the cut (a 10 ms half cosine): no click where the packets end
	const fadeLen = Math.round(FADE_S * sr)
	for (let c = 0; c < AUDIO_CHANNELS; c++) {
		const ch = pcm.subarray(c * n, (c + 1) * n)
		for (let i = Math.max(0, fadeEnd - fadeLen); i < n; i++) ch[i] *= i >= fadeEnd ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (i - (fadeEnd - fadeLen)) / fadeLen)
	}
	const chunks = []
	let meta = null
	let failure = null
	const enc = new AudioEncoder({ output: (c, m) => { chunks.push(c); if (m?.decoderConfig && !meta) meta = m }, error: (e) => { failure = e } })
	enc.configure(choice.config)
	const block = 8192
	for (let i = 0; i < n; i += block) {
		signal?.throwIfAborted()
		const len = Math.min(block, n - i)
		const data = new Float32Array(len * AUDIO_CHANNELS)
		for (let c = 0; c < AUDIO_CHANNELS; c++) data.set(pcm.subarray(c * n + i, c * n + i + len), c * len)
		const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: len, numberOfChannels: AUDIO_CHANNELS, timestamp: Math.round(i * 1e6 / sr), data })
		enc.encode(ad)
		ad.close()
		if (failure) break
	}
	if (!failure) await enc.flush().catch((e) => { failure ??= e })
	if (enc.state !== "closed") enc.close()
	if (failure) throw failure
	if (!meta?.decoderConfig) throw new Error("the sound encoder gave no stream description")
	const packets = []
	for (const c of chunks) {
		const start = Math.round(c.timestamp * sr / 1e6) - delay // in samples; the first is negative: the muxer's edit list trims it
		const dur = Math.round((c.duration ?? cal.frame * 1e6 / sr) * sr / 1e6)
		if (start + dur > cut) continue
		const data = new Uint8Array(c.byteLength)
		c.copyTo(data)
		packets.push({ packet: new mb.EncodedPacket(data, "key", start / sr, dur / sr), meta: packets.length ? undefined : meta })
	}
	return Object.assign(packets, { delay, preroll, calibrated: cal.calibrated, end: cut / sr })
}

// ---------- frames ----------

function sourceSize(s) {
	if (typeof VideoFrame === "function" && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight]
	if (typeof HTMLVideoElement === "function" && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight]
	if (typeof HTMLImageElement === "function" && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight]
	return [s?.width, s?.height]
}

/** Closes a VideoFrame or an ImageBitmap the caller handed over (they are the encoder's once given); a canvas or image stays the caller's. */
function release(src) {
	try {
		if (typeof VideoFrame === "function" && src instanceof VideoFrame) src.close()
		else if (typeof ImageBitmap === "function" && src instanceof ImageBitmap) src.close()
	} catch {}
}

/** A frame source (see the top) as a VideoFrame of exactly width × height at this time (the source is released: see release()). */
function toVideoFrame(src, width, height, timestamp, duration, scratch) {
	try {
		const isFrame = typeof VideoFrame === "function" && src instanceof VideoFrame
		const isData = typeof ImageData === "function" && src instanceof ImageData
		const [w, h] = sourceSize(src)
		if (!(w > 0 && h > 0)) throw inputError("a frame source has no size (an image not loaded yet, or a 0 × 0 canvas)")
		if (w === width && h === height) {
			if (isFrame) return new VideoFrame(src, { timestamp, duration })
			if (isData) return new VideoFrame(src.data, { format: "RGBA", codedWidth: w, codedHeight: h, timestamp, duration, colorSpace: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true } })
			return new VideoFrame(src, { timestamp, duration, alpha: "discard" })
		}
		// Another size: scale it into a canvas of the export's size.
		const ctx = scratch.get()
		drawScaled(ctx, src, w, h, width, height)
		return new VideoFrame(ctx.canvas, { timestamp, duration, alpha: "discard" })
	} finally {
		release(src)
	}
}

const newCanvas = (w, h) => (typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }))

/** Draws a source of w × h over the whole of ctx's width × height canvas (an ImageData through a canvas of its own size). */
function drawScaled(ctx, src, w, h, width, height) {
	ctx.fillStyle = "#000"
	ctx.fillRect(0, 0, width, height)
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = "high"
	if (typeof ImageData === "function" && src instanceof ImageData) {
		if (w === width && h === height) { ctx.putImageData(src, 0, 0); return }
		const c = newCanvas(w, h)
		c.getContext("2d").putImageData(src, 0, 0)
		src = c
	}
	ctx.drawImage(src, 0, 0, width, height)
}

function scratchCanvas(width, height) {
	let ctx = null
	return {
		get() {
			if (!ctx) ctx = newCanvas(width, height).getContext("2d", { alpha: false })
			return ctx
		},
	}
}

const END = Symbol("no more frames")

/** frames (a function or an iterable, see the top) as {count, next(i) → source | END, close()}. A function or iterable that gives nothing
 *  (undefined or null) for a frame is an input error, not the end. */
function frameReader(frames, frameCount) {
	const got = (v, i) => {
		if (v === undefined || v === null) throw inputError(`frame ${i}: the frame source gave nothing (return a canvas, an image, an ImageData or a VideoFrame)`)
		return v
	}
	if (typeof frames === "function") {
		if (!(Number.isInteger(frameCount) && frameCount > 0)) throw inputError("frameCount (a whole number above 0) is required when frames is a function")
		return { count: frameCount, next: async (i) => (i < frameCount ? got(await frames(i), i) : END), close() {} }
	}
	const it = frames?.[Symbol.asyncIterator]?.() ?? frames?.[Symbol.iterator]?.()
	if (!it) throw inputError("frames must be a function (i) => source or an iterable of sources")
	const count = Number.isInteger(frameCount) && frameCount > 0 ? frameCount : null
	let done = false
	return {
		count,
		async next(i) {
			if (done || (count !== null && i >= count)) return END
			const r = await it.next()
			if (r.done) { done = true; return END }
			return got(r.value, i)
		},
		close() { if (!done) { done = true; try { it.return?.() } catch {} } },
	}
}

// ---------- the WebCodecs path ----------

/** e with an own `code` (a DOMException's inherited `code` is a read-only number, so it is defined, not assigned). */
function withCode(e, code) {
	try { Object.defineProperty(e, "code", { value: code, configurable: true, writable: true, enumerable: false }) } catch {}
	return e
}
const OUR_CODES = ["aborted", "input", "unsupported", "encoder"]
const ours = (e) => OUR_CODES.includes(e?.code)

/** The rejection for an aborted export: the signal's own reason when it is an Error of the caller's (with code "aborted" added unless it has
 *  one of ours), else an AbortError "The export was cancelled." */
function abortError(signal) {
	const r = signal?.reason
	if (ours(r)) return r
	if (r instanceof Error && !(typeof DOMException === "function" && r instanceof DOMException && r.name === "AbortError")) return withCode(r, "aborted")
	return withCode(new DOMException("The export was cancelled.", "AbortError"), "aborted")
}

function encoderError(e, stage) {
	if (ours(e)) return e
	const name = e?.name ?? ""
	const why = name === "QuotaExceededError"
		? "the browser took the video encoder back (this happens when the tab is in the background or the computer is short of memory); keep this tab in front while exporting"
		: e?.message || String(e)
	return Object.assign(new Error(`The ${stage} failed: ${why}`), { code: "encoder", cause: e })
}

/** Encodes one black frame with this config: catches an encoder that says it is supported but fails to start (a busy hardware encoder). */
async function probeVideo(config) {
	let failure = null
	let got = false
	const enc = new VideoEncoder({ output: () => { got = true }, error: (e) => { failure = e } })
	try {
		enc.configure(config)
		const c = newCanvas(config.width, config.height)
		const ctx = c.getContext("2d", { alpha: false })
		ctx.fillStyle = "#000"
		ctx.fillRect(0, 0, config.width, config.height)
		const f = new VideoFrame(c, { timestamp: 0, alpha: "discard" })
		enc.encode(f, { keyFrame: true })
		f.close()
		await enc.flush()
	} catch (e) {
		failure ??= e
	} finally {
		if (enc.state !== "closed") enc.close()
	}
	return failure ? (failure.message || String(failure)) : got ? null : "it gave no output"
}

/**
 * Encodes frames (and audio) into an MP4. See the top of this file for every option.
 * @returns {Promise<Blob & {info: object}>}
 */
export async function encodeMp4(opts = {}) {
	const t0 = performance.now()
	const { frames, frameCount, fps, width, height, audio = null, signal, onProgress, title, keyframeSeconds = 2, fallback = true, audioCodec = "auto" } = opts
	const bad = checkSize(width, height, fps)
	if (bad) throw inputError(`Can't export: ${bad}.`)
	if (audio !== null && !(typeof AudioBuffer === "function" && audio instanceof AudioBuffer)) throw inputError("audio must be an AudioBuffer (or null)")
	if (signal?.aborted) throw abortError(signal)
	const bitrate = Math.round(opts.bitrate ?? videoBitrate(width, height, fps))
	if (!(bitrate >= 1e4)) throw inputError(`bitrate must be at least 10 kbit/s (got ${opts.bitrate})`)
	const progress = (p) => { try { onProgress?.(p) } catch {} }
	progress({ phase: "prepare", frame: 0, frames: frameCount ?? null, fraction: 0 })

	const support = await checkSupport({ width, height, fps, bitrate, audio: !!audio, audioCodec })
	const warnings = []
	if (!support.ok) {
		if (fallback && support.fallback && !haveVideoEncoder()) return recordRealtime({ ...opts, bitrate, warnings, t0 })
		throw unsupported(support.reason + (!haveVideoEncoder() && !support.fallback && !/^Can't export/.test(support.reason) ? " It can't record video in real time either." : ""))
	}

	// The video config: the first candidate that really starts (a hardware encoder can be listed and still be busy).
	let chosen = null
	const tried = []
	for (const c of videoCandidates(width, height, fps, bitrate)) {
		if (!(await supported(VideoEncoder, c.config))) continue
		const err = await probeVideo(c.config)
		if (!err) { chosen = c; break }
		tried.push(`${c.profile} ${c.config.hardwareAcceleration}: ${err}`)
	}
	if (!chosen) throw unsupported(`The video encoder would not start (${tried.join("; ")}).`)
	if (support.audioReason) warnings.push(support.audioReason)
	if (signal?.aborted) throw abortError(signal)

	const mb = await loadMuxer()
	const { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } = mb

	const reader = frameReader(frames, frameCount)
	const expected = reader.count // null: an iterable of unknown length
	const total = expected ?? null
	const gop = Math.max(1, Math.round(keyframeSeconds * fps))
	const ts = (i) => Math.round(i * 1e6 / fps)

	// Sound first (seconds of work at most): a failure here costs nothing, and the video then interleaves with it.
	let sound = []
	let soundInfo = null
	if (audio && support.audio) {
		progress({ phase: "audio", frame: 0, frames: total, fraction: 0.01 })
		const seconds = expected !== null ? expected / fps : audio.duration
		try {
			sound = await encodeSound(mb, audio, support.audio, seconds, signal, warnings)
			soundInfo = { codec: support.audio.codec, mimeCodec: support.audio.mimeCodec, sampleRate: AUDIO_RATE, channels: AUDIO_CHANNELS, bitrate: support.audio.config.bitrate, delaySamples: sound.delay ?? 0, calibrated: !!sound.calibrated, preroll: false }
			if (support.audio.codec === "opus") warnings.push("The sound is Opus (this browser has no AAC encoder): Chrome, Firefox, Edge, VLC, ffmpeg and current macOS (QuickTime, Safari) play it; some older players and devices play the picture without sound.")
		} catch (e) {
			if (signal?.aborted) throw abortError(signal)
			warnings.push(`The sound could not be encoded (${e?.message ?? e}), so the video has none.`)
			sound = []
		}
	}

	const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() })
	const videoSource = new EncodedVideoPacketSource("avc")
	output.addVideoTrack(videoSource, { frameRate: fps })
	const audioSource = sound.length ? new EncodedAudioPacketSource(support.audio.codec) : null
	if (audioSource) output.addAudioTrack(audioSource)
	if (title) { try { output.setMetadataTags({ title: String(title).slice(0, 200) }) } catch {} }
	await output.start()

	let failure = null
	let muxing = Promise.resolve()
	let firstMeta = null
	let sent = 0 // audio packets handed to the muxer
	let encoded = 0 // video chunks out of the encoder
	const addSoundUpTo = async (t) => { // keeps the two tracks interleaved in time
		while (sent < sound.length && sound[sent].packet.timestamp <= t) { const s = sound[sent++]; await audioSource.add(s.packet, s.meta) }
	}
	const encoder = new VideoEncoder({
		output: (chunk, meta) => {
			encoded++
			const data = new Uint8Array(chunk.byteLength)
			chunk.copyTo(data)
			const packet = new EncodedPacket(data, chunk.type, chunk.timestamp / 1e6, (chunk.duration ?? Math.round(1e6 / fps)) / 1e6)
			let m
			if (!firstMeta && meta?.decoderConfig) { firstMeta = meta; m = meta }
			muxing = muxing.then(async () => {
				if (failure) return
				await addSoundUpTo(packet.timestamp)
				await videoSource.add(packet, m)
			}).catch((e) => { failure ??= encoderError(e, "MP4 muxer") })
		},
		error: (e) => { failure ??= encoderError(e, "video encoder") },
	})
	const scratch = scratchCanvas(width, height)
	let frame = null
	let n = 0
	try {
		encoder.configure(chosen.config)
		for (;; n++) {
			if (signal?.aborted) throw abortError(signal)
			if (failure) throw failure
			const src = await reader.next(n)
			if (src === END) break
			if (signal?.aborted) { release(src); throw abortError(signal) }
			frame = toVideoFrame(src, width, height, ts(n), ts(n + 1) - ts(n), scratch)
			encoder.encode(frame, { keyFrame: n % gop === 0 })
			frame.close()
			frame = null
			while (encoder.encodeQueueSize > QUEUE && !failure) await dequeued(encoder)
			if (n % 8 === 7) await muxing // the muxer keeps up (it only copies bytes)
			progress({ phase: "video", frame: n + 1, frames: total, fraction: total ? 0.02 + 0.96 * (n + 1) / total : null })
		}
		reader.close()
		if (n === 0) throw inputError("no frames to encode")
		await encoder.flush()
		await muxing
		if (failure) throw failure
		if (encoded !== n) throw encoderError(new Error(`${n} frames went in and ${encoded} came out`), "video encoder")
		progress({ phase: "finalize", frame: n, frames: total ?? n, fraction: 0.99 })
		const end = n / fps
		while (sent < sound.length && sound[sent].packet.timestamp + sound[sent].packet.duration <= end + 1e-9) { const s = sound[sent++]; await audioSource.add(s.packet, s.meta) }
		videoSource.close()
		audioSource?.close()
		await output.finalize()
	} catch (e) {
		frame?.close()
		reader.close()
		try { if (encoder.state !== "closed") encoder.close() } catch {}
		try { await output.cancel() } catch {}
		if (signal?.aborted) throw abortError(signal)
		throw ours(e) ? e : encoderError(e, "export")
	}
	if (encoder.state !== "closed") encoder.close()
	let bytes = output.target.buffer
	if (sent) { // the sound track's roll group: without it Apple's players play AAC 44 ms early (see mp4boxes.js)
		const r = addAudioPreroll(bytes, sound.preroll)
		if (r.changed) { bytes = r.buffer; soundInfo.preroll = true } else warnings.push(`The sound's pre-roll could not be marked (${r.reason}); QuickTime and Safari may play it up to 44 ms early.`)
	}
	const blob = new Blob([bytes], { type: "video/mp4" })
	blob.info = {
		path: "webcodecs", mimeType: "video/mp4", width, height, fps, frames: n, duration: n / fps,
		video: { codec: chosen.config.codec, profile: chosen.profile, level: chosen.level, hardwareAcceleration: chosen.config.hardwareAcceleration, bitrate: chosen.config.bitrate },
		audio: sent ? { ...soundInfo, packets: sent } : null,
		warnings, ms: Math.round(performance.now() - t0),
	}
	progress({ phase: "done", frame: n, frames: n, fraction: 1 })
	return blob
}

/** The muxer's classes (the names here are what tools/vendor-media.mjs bundles: keep this one destructuring import). */
async function loadMuxer() {
	try {
		const { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } = await import("mediabunny")
		return { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket }
	} catch (e) {
		throw Object.assign(new Error(`The MP4 muxer did not load (${e?.message ?? e}); the page's importmap needs "mediabunny": "./vendor/mediabunny/mediabunny.js".`), { code: "unsupported", cause: e })
	}
}

/** Resolves when the encoder takes a frame off its queue (the "dequeue" event; a short timer where a browser lacks it). */
function dequeued(encoder) {
	return new Promise((resolve) => {
		const done = () => { clearTimeout(timer); encoder.removeEventListener?.("dequeue", done); resolve() }
		const timer = setTimeout(done, 20)
		encoder.addEventListener?.("dequeue", done)
	})
}

// ---------- the real-time fallback (MediaRecorder) ----------

const RECORDER_TYPES = [
	"video/mp4;codecs=avc1.640028,mp4a.40.2", // Safari 14.1+, Chrome 126+: MP4 straight away
	"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
	"video/mp4",
	"video/webm;codecs=vp9,opus", // Firefox, older Chrome: WebM (plays in Chrome, Firefox, Edge, VLC; not QuickTime)
	"video/webm;codecs=vp8,opus",
	"video/webm",
]

function realtimeFallback(withAudio) {
	if (typeof MediaRecorder !== "function" || typeof HTMLCanvasElement !== "function" || !HTMLCanvasElement.prototype.captureStream) return null
	const types = withAudio ? RECORDER_TYPES : RECORDER_TYPES.map((t) => t.replace(/,(mp4a\.40\.2|opus)/, ""))
	const mimeType = types.find((t) => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } })
	return mimeType ? { kind: "mediarecorder", mimeType } : null
}

/** A timer a background tab does not slow down: a small Worker's setTimeout (Chrome holds a hidden page's own timers to about one a second, which
 *  would stretch a real-time recording; a dedicated worker's are not held back), else the page's own. sleep(ms) → Promise; close(). */
function wallTimer() {
	let worker = null
	let url = null
	let seq = 0
	const waiting = new Map()
	const giveUp = () => { // (a worker that can't start: the page's timers, and whoever waits is let go)
		worker?.terminate()
		worker = null
		for (const r of waiting.values()) r()
		waiting.clear()
	}
	try {
		url = URL.createObjectURL(new Blob(["onmessage = (e) => setTimeout(() => postMessage(e.data[0]), e.data[1])"], { type: "text/javascript" }))
		worker = new Worker(url)
		worker.onmessage = (e) => { const r = waiting.get(e.data); waiting.delete(e.data); r?.() }
		worker.onerror = giveUp
	} catch {
		worker = null
	}
	return {
		sleep(ms) {
			if (!(ms > 0.5)) return Promise.resolve()
			if (!worker) return new Promise((r) => setTimeout(r, ms))
			return new Promise((r) => { const id = ++seq; waiting.set(id, r); worker.postMessage([id, ms]) })
		},
		close() { giveUp(); if (url) URL.revokeObjectURL(url) },
	}
}

/** Records the frames with MediaRecorder at real speed (the browser has no VideoEncoder). The recording is timed by the wall clock, so it keeps to the
 *  timeline: frame i is shown at start + i/fps, and each pass draws the frame that will be due once it is made (the time a frame takes is learned as it
 *  goes), so a scene that draws slower than real time skips frames (counted in info.droppedFrames) instead of showing every frame late, which would
 *  stretch the video and leave its sound behind. The recorder stops exactly at start + frameCount/fps. The sound plays alongside, started early by what
 *  the recorder's encoder will add before it (AAC's priming in an MP4, which a recorder writes no edit list for, and the audio graph's own latency). */
async function recordRealtime(opts) {
	const { frames, frameCount, fps, width, height, audio = null, signal, onProgress, bitrate, warnings, t0 } = opts
	const progress = (p) => { try { onProgress?.(p) } catch {} }
	const fb = realtimeFallback(!!audio)
	if (!fb) throw unsupported("This browser can't record video.")
	const reader = frameReader(frames, frameCount)
	const total = reader.count // null: an iterable of unknown length
	const canSkip = typeof frames === "function" // (an iterable's frames come one after another: they can be shown late, not skipped)
	const canvas = Object.assign(document.createElement("canvas"), { width, height })
	const ctx = canvas.getContext("2d", { alpha: false })
	// Captured on request (requestFrame) where the browser can, else whenever the canvas changes, at most fps times a second.
	let stream = canvas.captureStream(0)
	let track = stream.getVideoTracks()[0]
	if (typeof track?.requestFrame !== "function") {
		for (const t of stream.getTracks()) t.stop()
		stream = canvas.captureStream(fps)
		track = stream.getVideoTracks()[0]
	}
	// Each frame is copied into `hold` the moment it arrives (a WebGL canvas is cleared once the browser presents it) and shown at its time.
	const hold = scratchCanvas(width, height)
	let ac = null
	let player = null
	if (audio) {
		ac = new AudioContext({ sampleRate: audio.sampleRate })
		const dest = ac.createMediaStreamDestination()
		// What the file will put before the sound: an AAC encoder's priming (2112 samples) in an MP4 (a WebM's Opus carries its own pre-skip, which
		// players honour), plus the audio graph's base latency (256 samples here). The sound starts that much into the buffer, faded in from there.
		const ahead = (/mp4/i.test(fb.mimeType) && !/opus/i.test(fb.mimeType) ? AAC_PRIMING / audio.sampleRate : 0) + (Number(ac.baseLatency) || 0)
		const skip = Math.min(audio.length - 1, Math.max(0, Math.round(ahead * audio.sampleRate)))
		const buf = new AudioBuffer({ length: audio.length - skip, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate })
		const pcm = new Float32Array(buf.length * buf.numberOfChannels)
		for (let c = 0; c < buf.numberOfChannels; c++) pcm.set(audio.getChannelData(c).subarray(skip), c * buf.length)
		fadeIn(pcm, buf.length, buf.numberOfChannels, buf.sampleRate)
		for (let c = 0; c < buf.numberOfChannels; c++) buf.copyToChannel(pcm.subarray(c * buf.length, (c + 1) * buf.length), c)
		player = ac.createBufferSource()
		player.buffer = buf
		player.connect(dest)
		for (const t of dest.stream.getAudioTracks()) stream.addTrack(t)
		await ac.resume().catch(() => {})
	}
	const chunks = []
	let recorder
	try {
		recorder = new MediaRecorder(stream, { mimeType: fb.mimeType, videoBitsPerSecond: bitrate, ...(audio ? { audioBitsPerSecond: AAC_BITRATE } : {}) })
	} catch (e) {
		ac?.close().catch(() => {})
		for (const t of stream.getTracks()) t.stop()
		throw encoderError(e, "recorder")
	}
	const timer = wallTimer()
	recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
	const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = (e) => reject(e.error ?? e) })
	const keep = (src) => {
		try {
			const [w, h] = sourceSize(src)
			if (!(w > 0 && h > 0)) throw inputError("a frame source has no size (an image not loaded yet, or a 0 × 0 canvas)")
			drawScaled(hold.get(), src, w, h, width, height)
		} finally {
			release(src)
		}
	}
	const show = () => {
		ctx.drawImage(hold.get().canvas, 0, 0)
		track.requestFrame?.()
	}
	// The browser captures the canvas when it next paints, and stamps the frame then: nothing that blocks the page (the next frame's drawing) may start
	// before that paint, or the frame is stamped late (measured: up to 130 ms with a source that blocks 70 ms, and frame 0 lost). So a frame is shown in
	// the animation frame nearest its time (the paint follows at once) and the next one is begun in a task after that paint. A hidden tab paints
	// nothing: there the timer stands in (25 ms at most).
	const afterPaint = (f) => new Promise((resolve) => {
		let done = false
		const go = () => {
			if (done) return
			done = true
			f?.()
			const c = new MessageChannel()
			c.port1.onmessage = () => resolve()
			c.port2.postMessage(0)
		}
		requestAnimationFrame(go)
		timer.sleep(25).then(go)
	})
	const showAt = async (due) => {
		await timer.sleep(due - performance.now() - 8) // (half a 60 Hz frame early: the animation frame that follows is the one nearest `due`)
		await afterPaint(show)
	}
	const frameMs = 1000 / fps
	let n = 0 // the next frame that may be drawn
	let shown = 0
	let dropped = 0
	let late = 0
	let start = 0
	try {
		// Frame 0 first, so the recording starts on a picture; the clock and the sound start with it.
		const first = await reader.next(0)
		if (first === END) throw inputError("no frames to encode")
		keep(first)
		show()
		recorder.start(1000)
		start = performance.now()
		player?.start()
		await afterPaint() // (frame 0 is captured before anything blocks: else a slow frame 1 loses it and the recording starts late)
		n = 1
		shown = 1
		let cost = frameMs / 2 // ms a frame takes to make: the slowest recent one at once, easing back by 30 % a frame
		for (;;) {
			if (signal?.aborted) throw abortError(signal)
			const i = canSkip ? Math.max(n, Math.ceil((performance.now() + cost - start) / frameMs)) : n
			if (total !== null && i >= total) break
			const began = performance.now()
			const src = await reader.next(i)
			if (src === END) break
			keep(src)
			const took = performance.now() - began
			cost = took > cost ? took : cost * 0.7 + took * 0.3
			dropped += i - n
			const due = start + i * frameMs
			if (performance.now() > due + frameMs / 2) late++
			await showAt(due)
			shown++
			n = i + 1
			progress({ phase: "video", frame: n, frames: total, fraction: total ? n / total : null })
		}
		if (total !== null && n < total) {
			dropped += total - n
			// the last frames were skipped: the picture made last is shown again at the last frame's time, so the recording lasts to its end (a recorder
			// times the last frame it is given as one frame long)
			await showAt(start + (total - 1) * frameMs)
		}
		await timer.sleep(start + (total ?? n) * frameMs - performance.now()) // (the last frame holds until the video's end: exactly its length)
		recorder.stop()
		await stopped
	} catch (e) {
		reader.close()
		timer.close()
		try { if (recorder.state !== "inactive") recorder.stop() } catch {}
		try { player?.stop() } catch {}
		ac?.close().catch(() => {})
		for (const t of stream.getTracks()) t.stop()
		if (signal?.aborted) throw abortError(signal)
		throw ours(e) ? e : encoderError(e, "recorder")
	}
	reader.close()
	timer.close()
	try { player?.stop() } catch {}
	ac?.close().catch(() => {})
	for (const t of stream.getTracks()) t.stop()
	const type = (recorder.mimeType || fb.mimeType).split(";")[0]
	const blob = new Blob(chunks, { type })
	const count = total ?? n
	warnings.push("Made in real time: this browser has no fast video encoder. Frames in a real-time recording can be a few milliseconds off their time" +
		(/mp4/i.test(type) ? ", and QuickTime and Safari may show its colours a little lighter." : "; QuickTime and Safari can't play this WebM file (Chrome, Firefox, Edge and VLC can)."))
	if (dropped) warnings.push(`${dropped} of ${count} frames were skipped to keep the video in time. For a smooth video pick a smaller size, 30 fps or no motion blur.`)
	else if (late) warnings.push(`${late} of ${count} frames were shown late. For a smooth video pick a smaller size, 30 fps or no motion blur.`)
	blob.info = {
		path: "mediarecorder", mimeType: recorder.mimeType || fb.mimeType, width, height, fps, frames: count, duration: count / fps,
		video: { codec: recorder.mimeType || fb.mimeType, profile: null, level: null, hardwareAcceleration: null, bitrate },
		audio: audio ? { codec: /opus/.test(recorder.mimeType || fb.mimeType) ? "opus" : "aac", mimeCodec: null, sampleRate: audio.sampleRate, channels: audio.numberOfChannels, bitrate: AAC_BITRATE, delaySamples: null, calibrated: false, preroll: false } : null,
		droppedFrames: dropped, lateFrames: late, shownFrames: shown, warnings, ms: Math.round(performance.now() - t0),
	}
	progress({ phase: "done", frame: count, frames: count, fraction: 1 })
	return blob
}
