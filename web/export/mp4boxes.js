// Small, exact edits to a finished MP4 (an ArrayBuffer whose moov comes before its mdat, as the export writes it). Plain ES module, no DOM.
//
//   addAudioPreroll(buffer, {rollDistance, skipFirst}) → {buffer, changed, reason}
//
// Why: an AAC or Opus track needs the packets before a packet to decode it fully (AAC: 1, Opus: 80 ms worth), and players learn that from a
// "roll" sample group (ISO/IEC 14496-12 §10.1: sgpd + sbgp with grouping type 'roll'). The muxer (mediabunny) writes the edit list that trims
// the encoder's delay but not this group, and Apple's decoder (QuickTime, Safari, AVFoundation) then trims the delay a second time: the sound
// plays 44 ms (2112 samples) early. With the group, as ffmpeg writes it, QuickTime, Safari, Chrome and ffmpeg all play it to the sample
// (checked: cross-correlation with the source, 0 samples). This adds the two boxes to the sound track's sample table, fixes the sizes of the
// boxes around them and moves every chunk offset by the bytes added. Anything unexpected leaves the file as it was (changed: false, reason).

const u32 = (v, o) => v.getUint32(o)
const type = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

/** The boxes in bytes [start, end): [{type, start, size, header}]. Throws on a box that runs past the end. */
function boxesIn(bytes, view, start, end) {
	const out = []
	let p = start
	while (p + 8 <= end) {
		let size = u32(view, p)
		let header = 8
		if (size === 1) {
			if (p + 16 > end) throw new Error("a box's 64-bit size is cut off")
			const hi = u32(view, p + 8), lo = u32(view, p + 12)
			size = hi * 2 ** 32 + lo
			header = 16
		} else if (size === 0) size = end - p
		if (size < header || p + size > end) throw new Error(`the ${type(bytes, p + 4)} box runs past its parent`)
		out.push({ type: type(bytes, p + 4), start: p, size, header })
		p += size
	}
	if (p !== end) throw new Error("trailing bytes after the last box")
	return out
}

const child = (bytes, view, box, name) => boxesIn(bytes, view, box.start + box.header, box.start + box.size).find((b) => b.type === name)

/**
 * Adds a 'roll' sample group to the sound track: every sample from `skipFirst` on has roll distance `rollDistance` (negative: that many
 * packets back). AAC: {rollDistance: -1, skipFirst: 0}; Opus (20 ms packets): {rollDistance: -4, skipFirst: 4}, as ffmpeg writes them.
 */
export function addAudioPreroll(buffer, { rollDistance, skipFirst = 0 }) {
	const keep = (reason) => ({ buffer, changed: false, reason })
	try {
		const bytes = new Uint8Array(buffer)
		const view = new DataView(buffer)
		const top = boxesIn(bytes, view, 0, bytes.length)
		const moov = top.find((b) => b.type === "moov")
		const mdat = top.find((b) => b.type === "mdat")
		if (!moov || !mdat) return keep("no moov or mdat")
		if (moov.start > mdat.start) return keep("the index is after the media")
		if (moov.header !== 8) return keep("a 64-bit moov")
		let sound = null
		for (const trak of boxesIn(bytes, view, moov.start + 8, moov.start + moov.size).filter((b) => b.type === "trak")) {
			const mdia = child(bytes, view, trak, "mdia")
			const hdlr = mdia && child(bytes, view, mdia, "hdlr")
			if (hdlr && type(bytes, hdlr.start + hdlr.header + 8) === "soun") {
				const minf = child(bytes, view, mdia, "minf")
				const stbl = minf && child(bytes, view, minf, "stbl")
				if (stbl) sound = { path: [trak, mdia, minf, stbl], stbl }
				break
			}
		}
		if (!sound) return keep("no sound track")
		const stblKids = boxesIn(bytes, view, sound.stbl.start + 8, sound.stbl.start + sound.stbl.size)
		if (stblKids.some((b) => b.type === "sgpd" || b.type === "sbgp")) return keep("it already has sample groups")
		const stsz = stblKids.find((b) => b.type === "stsz")
		if (!stsz) return keep("no stsz")
		const count = u32(view, stsz.start + stsz.header + 8) // version/flags, sample_size, sample_count
		if (!(count > skipFirst)) return keep("too few sound packets")
		if (sound.path.some((b) => b.header !== 8)) return keep("a 64-bit box around the sample table")

		// sgpd v1: grouping 'roll', default_length 2, one entry: int16 roll_distance. sbgp v0: (sample_count, group index) runs.
		const runs = skipFirst > 0 ? [[skipFirst, 0], [count - skipFirst, 1]] : [[count, 1]]
		const sgpd = new Uint8Array(26)
		const sv = new DataView(sgpd.buffer)
		sv.setUint32(0, 26); sgpd.set([115, 103, 112, 100], 4); sv.setUint32(8, 0x01000000); sgpd.set([114, 111, 108, 108], 12)
		sv.setUint32(16, 2); sv.setUint32(20, 1); sv.setInt16(24, rollDistance)
		const sbgp = new Uint8Array(20 + 8 * runs.length)
		const bv = new DataView(sbgp.buffer)
		bv.setUint32(0, sbgp.length); sbgp.set([115, 98, 103, 112], 4); bv.setUint32(8, 0); sbgp.set([114, 111, 108, 108], 12)
		bv.setUint32(16, runs.length)
		runs.forEach(([n, g], i) => { bv.setUint32(20 + 8 * i, n); bv.setUint32(24 + 8 * i, g) })
		const add = sgpd.length + sbgp.length

		// The new file: everything up to the end of stbl, the two boxes, the rest.
		const at = sound.stbl.start + sound.stbl.size
		const out = new Uint8Array(bytes.length + add)
		out.set(bytes.subarray(0, at), 0)
		out.set(sgpd, at)
		out.set(sbgp, at + sgpd.length)
		out.set(bytes.subarray(at), at + add)
		const ov = new DataView(out.buffer)
		for (const b of [moov, ...sound.path]) ov.setUint32(b.start, b.size + add) // every box that contains the new ones
		// Chunk offsets point into mdat, which moved by `add`.
		let moved = 0
		const walk = (start, end) => {
			for (const b of boxesIn(out, ov, start, end)) {
				if (b.type === "stco" || b.type === "co64") {
					const n = ov.getUint32(b.start + b.header + 4)
					for (let i = 0; i < n; i++) {
						if (b.type === "stco") {
							const o = b.start + b.header + 8 + 4 * i
							const v = ov.getUint32(o) + add
							if (v > 0xffffffff) throw new Error("a chunk offset overflows 32 bits")
							ov.setUint32(o, v)
						} else {
							const o = b.start + b.header + 8 + 8 * i
							const v = ov.getUint32(o) * 2 ** 32 + ov.getUint32(o + 4) + add
							ov.setUint32(o, Math.floor(v / 2 ** 32))
							ov.setUint32(o + 4, v >>> 0)
						}
						moved++
					}
				} else if (["trak", "mdia", "minf", "stbl"].includes(b.type)) walk(b.start + b.header, b.start + b.size)
			}
		}
		walk(moov.start + 8, moov.start + moov.size + add)
		if (!moved) return keep("no chunk offsets found")
		boxesIn(out, ov, 0, out.length) // the whole file still parses
		return { buffer: out.buffer, changed: true, reason: null }
	} catch (e) {
		return keep(e?.message ?? String(e))
	}
}
