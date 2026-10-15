# MP4 export: how it works, settings, measured numbers, limits

"Export video" (top bar, or the E key) turns the run on screen into an MP4 that plays everywhere: H.264 High + AAC-LC, `moov` before `mdat`,
frame-exact, with impact sounds made from the engine's own collision log. Everything happens in the page; nothing is uploaded.
Measured on 2026-10-15 in the real app, through the real dialog, in headless Chromium 1248 (ANGLE Metal, Apple M5 Pro). Files were checked with
ffprobe/ffmpeg 8.1 and with AVFoundation (what QuickTime and Safari use).

## The parts

| File | Role |
|---|---|
| `web/export/export-ui.js` + `export.css` | The dialog: preview, settings, trim, estimates, progress, Cancel, done screen (player, Download again, Copy, Share), errors. Mounted by an 8-line block in `web/app.js`. |
| `web/view3d.js` | `whenSettled()`, `renderFrame(t, opts)`, `exportInfo()`, `endExport()`: one frame of the run at any size, always at the high tier, without touching the canvas (contract: `web/CONTRACT.md`, "Export"). `exportProject(t, x, y, {camera, width, height})` → −1…1: where a machine-plane point shows across the export's picture (the same shot renderFrame draws; null before the run is settled or behind the camera). |
| `web/export/encoder.js` (+ `mp4boxes.js`) | `encodeMp4()`: WebCodecs H.264 + AAC, muxed by mediabunny 1.61.0 (vendored at `web/vendor/mediabunny/`, mapped as `"mediabunny"` in `web/index.html`'s importmap). MediaRecorder fallback. |
| `web/export/audio.js` | `synthesizeImpacts()`: a physical sound for every impact (the bodies' shapes, sizes, masses and materials, the contact time, the speed), panned to where it shows in the video, mixed in stereo with a small room, its level set by loudness (BS.1770) and a true-peak limiter. |

## What one export does

1. **Settle.** `view.whenSettled()`: every stand-in replaced by its model, mounts, wood grain and chrome balls in. The run's `runId` is noted and passed with every frame.
2. **Sound** (when on and the trim has hits). `synthesizeImpacts(track.impacts, doc, {duration, sampleRate: 48000, track, stage, panAt})` over the whole run, using the engine's own impact times, then the trimmed window is cut out, so a hit just before the start still rings into the video (a cut that starts inside a ring is faded in over 4 ms: no click).
   `panAt(t, x, y)` is `view.exportProject(t, x, y, {camera, width, height})` for the export's own camera and size: every hit is heard where it is seen, also with Follow and Director (the stage's place is only the fallback).
3. **Frames.** `encodeMp4({frames: i → view.renderFrame(start + i/fps, {width, height, camera, motionBlur, fps, runId}), frameCount: round(length·fps), …})`.
   The view draws into its own targets and returns a 2D OffscreenCanvas. The encoder copies it into a `VideoFrame` with timestamp `round(i·10⁶/fps)` µs before the next frame is asked for.
   Backpressure: at most 3 frames queue inside the encoder. The page yields to paint progress and take a Cancel click *before* each frame is drawn, never after.
4. **Mux.** mediabunny writes the MP4 in memory with faststart, a timescale of `fps` ticks/s (exactly 1 tick per frame), an edit list that trims the AAC encoder delay (2112 samples), and the scene name as the title.
   `mp4boxes.js` then adds the audio `roll` sample group, as ffmpeg does; without it, QuickTime and Safari play AAC 44 ms early.
5. **Done.** The file downloads as `<scene-name>.mp4`. The dialog shows its size, length, size in pixels, fps and whether it has sound, with a looping player, plus Copy and Share where the browser supports them.
   The view's export session ends at once, freeing its targets; the canvas redraws exactly what it showed before.

## Settings

| Setting | Choices | Notes |
|---|---|---|
| Resolution | 720p, 1080p, 1440p, 4K | Sizes the GPU (`exportInfo().maxSize`) or the H.264 encoder (`checkSupport`) can't do are disabled, with the encoder's reason as a tooltip (never recorded in real time instead). When no size can be made, Export is disabled and the footer says why. |
| Frame rate | 30, 60 | |
| Camera | Wide, Follow, Orbit, Director | Defaults to the live view's camera. Each is a pure function of t built from the track (see CONTRACT.md for the exact rules). |
| Motion blur | on/off | A centred 180° shutter with at least 6 sub-frames, more where motion would show steps (up to 32), accumulated in linear light. On by default (the view's `exportInfo().recommended.motionBlur`; off on a software renderer) until the person chooses; only a choice they made is remembered. With Follow or Director and blur off, the caption says "Fast camera moves look choppy without it." |
| Impact sounds | on/off | Disabled, with a reason, when the trim has no hits or the browser can't encode audio. |
| Length | two-handle trim, 0.2 s minimum | Event ticks from the run's summary. "Whole run" resets it. |
| Bitrate | automatic | YouTube upload rates: 720p 5/7.5, 1080p 8/12, 1440p 16/24, 4K 40/60 Mbit/s at 30/60 fps, variable bitrate, a key frame every 2 s. The H.264 level is the lowest that fits (3.1 … 5.2). Audio: AAC-LC 48 kHz stereo 192 kbit/s (Opus 160 kbit/s if the browser has no AAC encoder). |

Settings and the learned estimates are remembered per `?profile=` (`sandbox:export`).

**Estimates.** The time estimate scales the measured cost of the dialog's own preview frames, for this scene on this device:
`previewMs × (0.6 + 0.28·Mpx) × blurCost(camera, width, fps)`. With motion blur, Wide costs ×1.9, Orbit ×2.4, Director ×3.1 and Follow ×4.7 at 1920 wide and 30 fps; at other widths multiply by about √(width/1920), and blur costs less at 60 fps.
Each real export then teaches a per-device correction. The size estimate is the bitrate × a per-camera share (VBR: a still Wide shot uses ~16 % of the bitrate, a busy Follow or Orbit up to ~100 %), also learned per camera.

## Measured: the five required exports (final code)

Re-run on 2026-10-15 after the repairs below (the stress row is from the first run; the repairs did not touch its video path). All checks passed for every file: H.264 High at the expected level, exact size, `r_frame_rate` = `avg_frame_rate` = fps, frame count = round(duration × fps), every timestamp exactly i/fps, duration exact, `ftyp moov mdat`, title tag, colour tags. The audio track never runs past the video.

| Scene · settings | Frames | Export time (click → download) | File | PSNR vs `renderFrame` (min / mean, RGB; luma min) | Frame i vs i±1 | Sound: lag, onsets | Peak memory, whole browser (idle → peak; GPU process) |
|---|---|---|---|---|---|---|---|
| Rube Goldberg (starter) · 1080p60 Wide · sound | 270 | 2.4 s (9 ms/frame) | 1.2 MB | 41.6 / 45.6; 44.8 dB | 45.7 vs 42.4 dB | 0 samples; 34 hits, file = reference within 1 sample | 1.42 → 1.68 GB; 1.31 GB |
| Car, ramp and dominoes · 720p30 Follow · sound | 180 | 1.3 s | 1.5 MB | 41.8 / 44.9; 45.1 dB | 44.8 vs 30.1 dB | 0; 8 hits exact | 1.71 → 1.91 GB; 1.50 GB |
| Newton's cradle · 1440p30 Director · motion blur · sound | 135 | 4.2 s (31 ms/frame) | 2.1 MB | 42.0 / 46.1; 45.7 dB | 46.6 vs 34.8 dB | 0; 6 hits exact | 1.43 → 2.10 GB; 1.59 GB |
| Plinko · 4K30 Orbit · sound | 180 | 3.5 s (20 ms/frame) | 10.7 MB | 42.6 / 45.5; 47.0 dB | 46.7 vs 34.5 dB | 0; 27 hits exact | 1.48 → 2.31 GB; 1.82 GB |
| Busy table, 20 s (531 impacts) · 1080p30 Director · sound | 600 | 6.2 s (10 ms/frame) | 18.7 MB | 40.5 / 43.3; 44.3 dB | 44.0 vs 31.0 dB | 0; 127 of 128 hits at lag 0* | 1.66 → 1.95 GB; 1.40 GB |
| Rube Goldberg, trimmed 1.23–3.77 s · 1080p30 Director · sound | 76 | 0.9 s | 1.4 MB | 41.7 / 44.0; 44.6 dB | 44.6 vs 28.4 dB | 0; 22 hits within 1 sample; first sample −0.00001 (faded in) | 1.52 → 1.77 GB; 1.37 GB |
| Rube Goldberg · 1080p30 Follow · motion blur · sound | 135 | 3.5 s (26 ms/frame) | 2.1 MB | 43.8 / 46.6; 47.7 dB | 47.7 vs 26.3 dB | 0; 35 hits within 1 sample | 1.48 → 1.84 GB; 1.41 GB |
| Plinko · 720p30 Follow · sound | 180 | 1.2 s | 2.5 MB | 40.3 / 43.9; 46.7 dB | 44.6 vs 20.9 dB | 0; 27 hits exact | 1.49 → 1.62 GB; 1.17 GB |
| Stress: busy 20 s · 4K60 Follow · motion blur · sound | 1200 | 95 s (79 ms/frame) | 129 MB | 43.3 / 45.8 | 45.6 vs 28.9 dB | 0 | 1.57 → 2.74 GB; GPU 2.16 GB, page 0.63 GB |

How each column was measured:
- **PSNR:** every 30th frame was decoded by ffmpeg (colour tags honoured) and compared with `view.renderFrame` at the same t and settings.
- **Frame i vs i±1:** the decoded middle frame against the references for its own index and its neighbour. Its own is always clearly closer, so there is no off-by-one.
- **Sound:** the file's audio as ffmpeg decodes it (edit list applied), cross-correlated against the same `synthesizeImpacts` buffer (panned through the same shot, the cut faded in the same way). The global lag is 0 samples in every file.
  Onsets were compared hit by hit (25 % of each hit's peak): the file matches the reference to within one sample (0.02 ms), and the median onset is 0.02–0.04 ms after the engine's impact time. Soft contacts rise later by physics: a rubber tyre on wood 4.2 ms, a basketball 8.4 ms (its contact lasts ~9 ms).
- \*The one other hit: a basketball's low thud with four contacts in 15 ms makes the cross-correlation ambiguous. At lag 0 the file matches the reference there at 45 dB SNR.
- **Memory:** `phys_footprint` (top's MEM) of every process in this browser, including GPU memory. The "idle" figure is the same browser with the app loaded.
  The whole file is held in memory until it downloads (BufferTarget), so a 20 s 4K60 export peaks at 0.63 GB in the page process.

**Sound level.** Every builtin scene exported through the dialog (720p30 Wide, sound) and its decoded AAC measured with ffmpeg's `ebur128` (I = integrated loudness, M max = the loudest 400 ms, TP = true peak). "Before" is the previous code's sound track for the same run (within 0.3 dB of the review's measurements of its AAC files):

| Scene | Before: I / M max / TP | Now: I / M max / TP | Held back by |
|---|---|---|---|
| Wrecking ball | −22.4 / −20.0 / −3.0 | −20.6 / −18.2 / −1.7 | |
| Trampoline | −24.7 / −22.2 / −9.9 | −20.9 / −18.0 / −5.6 | |
| Plinko | −25.0 / −20.8 / −6.3 | −22.3 / −18.1 / −3.9 | |
| Ball drop | −25.7 / −21.7 / −3.0 | −22.4 / −19.2 / −2.0 | the limit (6 dB) |
| Rube Goldberg | −31.8 / −25.9 / −3.0 | −25.2 / −18.6 / −2.0 | the limit |
| Conveyor delivery | −29.3 / −25.4 / −3.0 | −25.6 / −21.8 / −1.8 | the limit |
| Pendulum and dominoes | −28.5 / −26.8 / −2.8 | −24.9 / −22.1 / −1.7 | the limit |
| Car, ramp and dominoes | −29.0 / −25.4 / −2.7 | −25.7 / −22.7 / −1.9 | the limit |
| Spring launcher | −34.1 / −31.7 / −6.9 | −26.6 / −24.5 / −2.0 | the +30 dB boost |
| Atwood machine | −28.8 / −27.8 / −3.0 | −27.0 / −25.3 / −2.9 | the limit (3 hits, one sharp) |
| Newton's cradle | −32.0 / −29.4 / −2.8 | −28.0 / −27.0 / −2.1 | the limit (steel clicks) |

The level is set by loudness (`audio.js`): the loudest 400 ms of the run (BS.1770 K-weighted momentary loudness, every window) to −18 LUFS, raised by at most 30 dB; a look-ahead true-peak limiter (4× oversampled, ceiling −2 dBTP) takes the sharp peaks, and the level is raised again by what that took (up to 4 passes), but never so far that the limiter takes more than 6 dB off any peak.
Integrated loudness is now −20.6 to −28.0 LUFS (it was −22.4 to −34.1), the loudest moments −18.0 to −27.0 (were −20.0 to −31.7), and no file decodes above −1.7 dBTP. Before, a click's peak set the level (the loudest hit peaked at −3 dBFS, boost capped at 20 dB), so quiet or clicky scenes came out 10–14 dB too low.
Not every scene reaches −18: where the loudest moment is a train of sharp clicks, its 400 ms hold little energy for its peak, and limiting barely helps. Measured on the Newton's cradle's sound track: 6 dB of limiting gives −26 LUFS, 16 dB gives −25.5. Limiting a click by 10 dB or more takes away most of its attack for half a decibel, so the limiter stops at 6 dB and those scenes stay a little quieter (a click also sounds louder than its 400 ms loudness says).
The −2 dBTP ceiling leaves room for the AAC encoder: Apple's AAC (what Chrome uses on macOS) overshot a −1.5 dBTP mix by up to 0.8 dB on the Rube Goldberg clicks; at −2 dBTP every decoded file stays at or under −1.7 dBTP.
The level is the scene's, not the trim's: a trimmed export cuts its part out of the whole run's sound, so a quiet part stays quiet.

**Stereo.** Each hit is panned to where its moving body shows in the exported picture at that moment (`view.exportProject` through the export's own camera), at most 80 % to a side. Checked by drawing each hit's pan as a line on the export's own frame at that moment: on Rube Goldberg Follow and Plinko Director the line falls on the ball, domino or peg that is hit (`research/export-e2e/repair/out/pan-grid.png`).
In the files, the left/right balance of the 10 ms after each hit follows the pan it was made with (correlation 0.96–0.98 on Wide and Follow, 0.88–0.93 with blur, Orbit or a trim; lower where hits overlap or all sit near the middle: the 531-hit busy table 0.63, Newton's cradle 0.62). Before, the pan came from the place across the stage, which on Follow and Director put many hits on the wrong side.

**Apple players.** AVFoundation reads the files as `ITU_R_709_2` primaries, `IEC_sRGB` transfer, `ITU_R_709_2` matrix, video range. QuickTime therefore colour-matches the sRGB pixels the canvas shows; there is no BT.709 gamma shift.
It reports exact durations, frame rates and frame counts. Its decoded sound is identical to ffmpeg's (max difference 0, lag 0 against the reference).

**Determinism.** The same scene and settings exported in two separate fresh browsers, with different preview histories, give identical decoded video (`framemd5`) and audio (md5), for Follow and for Director with blur.
The file bytes differ only in the creation times in `mvhd`/`tkhd`/`mdhd` and one byte of an SEI note that VideoToolbox writes into the first key frame.

**Other paths checked.**
- **Cancel** mid-way through a 4K60 Follow+blur export returns to the settings in 0.47 s with "Export cancelled. Nothing was saved.", and nothing downloads. The next export works.
- **Scene re-run mid-export:** stops with "The scene changed while the video was being made. Export it again." and nothing downloads.
- **WebGL context lost mid-export** (`WEBGL_lose_context`): stops with "The graphics stopped responding while drawing the frames. Try again, or a smaller size." and nothing downloads.
- **No WebCodecs** (`VideoEncoder` and `AudioEncoder` removed): MediaRecorder records an H.264/AAC MP4 in real time. Rube Goldberg 720p30 Wide with sound: 135 frames, 4.503 s, 0 skipped; the sound lags the reference by 0 samples (it was 2368, 49 ms: the AAC priming nobody trimmed) and the pictures are shown 2.3 ms after their time (median; 10–90 %: 1.4–2.9 ms), so sound and picture agree within 3 ms.
  A source that takes 70 ms a frame at 30 fps: 3.01 s for 90 frames, 58 skipped, the rest at their time (median 0 ms); before, such a run stretched (Rube Goldberg 4K60 Follow + blur came out 14.7 s long for 4.5 s). 1080p60 Wide: 4.52 s, 12 of 270 skipped. The done screen says how many frames were skipped and what to change.
  The dialog offers only what this device can make in real time (here 4K at 60 fps is off: "Too slow to record in real time on this device"; motion blur with Follow at 720p60 is off).
- **An encoder that can't make a size** (`isConfigSupported` false above 1920 wide, `VideoEncoder` present): 1440p and 4K are disabled with "This browser can't encode H.264 video at 2560 × 1440, 60 fps; a smaller size may work."; nothing is recorded in real time.
- **No encoder at all** (`VideoEncoder`, `AudioEncoder` and `MediaRecorder` removed): every size is disabled, Export is disabled, and the footer and the button's tooltip say "This browser has no WebCodecs video encoder (it needs Chrome or Edge 94+, Safari 16.4+ or Firefox 130+)."
- **Encoder taken back** (a `QuotaExceededError` at frame 40): "The browser paused the video encoder (it does this when the tab is in the background or memory is short). Keep this tab in front and try again."
- **Dialog opened while a run is on its way** (`/api/simulate` held back): the preview says "The preview shows once the run lands.", the estimate is blank, the hit count and the trim's event marks are hidden; when the run lands the preview plays (4 different pictures in 0.75 s) and every camera previews.
  **A run that failed** (`/api/simulate` answering 400): "The last change couldn't run · Item "ramp-1" has an angle that isn't a number. Undo or fix it, then export." in the box and as the Export button's tooltip; "Try the run again" brings the preview and the estimate back.
- **Done screen:** reopened for the same scene it shows the file again; reopened while another scene's run is on its way it shows the settings, and stays there when the run lands.
- **Progress:** a new export's first texts are its own ("Getting every model ready…", "270 frames", "Working out the time…"); the time left appears after 10 frames and "Almost done" only past half way.
- **Keyboard and layout:** after Cancel export (Tab, Enter) the focus is on Export; the "Export cancelled" note sits where the estimate was and covers no setting (on a phone, above the buttons); the dialog's top edge stays at 150 px through settings, progress, done and error (1440 × 900); on a phone the progress line wraps instead of being cut off.
- **Playback:** a scene that was playing when the dialog opened plays again when it closes.
- **Done-screen player:** loads every file (readyState 4, right duration and size).
- **View session:** `exportInfo().exporting` is false right after an export and right after the dialog closes.

**Estimates, first guess on a fresh profile** (estimated → actual):
- 1080p60 Wide: 2.5 s → 2.5 s
- 1080p30 Director, 20 s: 5.5 s → 6.2 s
- 4K30 Director + blur: 12 s → 10.9 s
- 1440p60 Orbit + blur, 20 s: 35 s → 24.8 s
- 1440p30 Director + blur: 7.9 s → 4.2 s
- 1080p30 Follow + blur: 7.7 s → 4.3 s

After one export they come within ~10 % (2.4 s for 2.4 s; 3.6 s for 3.8 s at 4K). Before this work the first guesses were 3–12× too long; for example, "about 47 s" for a 4 s export.

## Fixed while wiring

- **Importmap:** `"mediabunny": "./vendor/mediabunny/mediabunny.js"` in `web/index.html`; without it the encoder can't load its muxer.
- **runId:** the dialog now passes `runId` with every frame, as the view's contract asks.
- **endExport:** the dialog now calls `view.endExport()` as soon as an export ends (done, cancelled, failed) and once the dialog closes, instead of waiting 4 s. A 4K session's targets are freed at once, and the canvas comes back at once.
- **Error message:** a scene re-run mid-export used to stop with the view's internal message ("The export failed: renderFrame: no finished run to export (run the scene first)."). It now gives the plain sentence above. Other `renderFrame` errors lose their "renderFrame:" prefix, and a lost GPU context maps to "The graphics stopped responding…".
- **Time estimate:** reworked as above. The old version also learned "ms per megapixel", which would overstate 4K by 2.5× after one 720p export.
- **Determinism across loads (`web/view3d.js`):** the export's shots used `frameOf(run)`, measured when the run was built. On a progressive load that is partly the stand-ins' boxes, and how many models are deferred depends on how busy the page is. A cold browser's first load framed the same run a fraction of a pixel differently (every edge differed).
  The export's shots (wide, orbit, follow, director) now use `exportFrameOf(run)`: measured once the run is settled, at t = 0, with each moving part measured in its own frame. The canvas keeps its own framing, so nothing on screen jumps. Checked: four fresh browsers, four cameras plus blur, two scenes → one result.

## Limits

- **Speed and memory are this machine's.** A slower GPU or encoder takes longer; the estimate learns it. 4K is allowed: the worst case measured (20 s 4K60 Follow + blur) used 1.2 GB more than idle.
  On a device whose GPU can't make 3840-px targets, or whose encoder lacks level 5.1/5.2, 4K is disabled with the reason. If the GPU runs out mid-export, the dialog says so plainly and offers Try again or Change settings.
- **The real-time fallback** (no WebCodecs at all, e.g. an old browser) records at wall-clock speed. It keeps to the timeline: frames that can't be made in time are skipped (counted and reported), never shown late, so the length and the sound stay right.
  Its MP4/WebM is timed by the recorder: frames land within a few ms of their time (each is shown in the animation frame nearest it), its frame rate is variable, and it is tagged BT.709 (QuickTime and Safari show it a little lighter); the done screen says so. Its sound starts early by the AAC priming (2112 samples) and the audio graph's latency, since a recorder writes no edit list. It paces itself with a worker's timer, but a hidden tab paints nothing, so keep the tab in front (not testable headless).
  The fallback only runs in a browser without WebCodecs (Chrome and Edge before 94, Safari before 16.4, Firefox before 130); it was tested in Chromium with WebCodecs removed.
- **Motion blur** averages each sub-frame after its display transform (the paints apply their tone curve per material), not scene radiance. Bright moving highlights streak a little dimmer than a film camera's.
- **Director** holds the wide shot on atwood, ball drop, Newton's cradle and pendulum dominoes. Their action spans the machine, has no impacts, or is over before the opening wide hold ends.
- **Follow** pans reach ~2500 px/s at 1080p on the Rube Goldberg machine. That is inherent in tracking a 1.5 m/s ball closely; the path is smooth, and motion blur handles it.
- **Sound** covers impacts only: no rolling, sliding, breaking or air. It is a physical model tuned by ear, not recordings. The audio track ends on the last whole AAC packet, up to 21 ms before the last frame, with a 10 ms fade.
  Scenes whose loudest moment is a train of sharp clicks stay below −18 LUFS (Newton's cradle −27): see "Sound level".
- **Size estimates** are only good to ~2× before the first export of a camera: VBR file size depends on how much moves.
- **The whole MP4 is built in memory** (not streamed to disk); a 20 s 4K60 file is ~130 MB.

## Repaired after review (2026-10-15)

- **Sound level** (`audio.js`): set by loudness instead of by the loudest click's peak; true-peak limiter (see "Sound level").
- **Trimmed start** (`export-ui.js` soundFor, `encoder.js` encodeSound/fadeIn): a cut that starts inside a ringing hit is faded in over 4 ms. Before, sample 0 stepped from silence to −27 dBFS (a click in every player); now it starts at 0 (the trimmed Rube Goldberg file's first millisecond peaks at 0.004).
- **Motion blur** is on by default (the view's recommendation); with Follow or Director and blur off, the caption warns that fast camera moves look choppy.
- **Stereo** (`audio.js` panAt, `view3d.js` exportProject): each hit is heard where it is seen in the export's picture.
- **Real-time fallback** (`encoder.js` recordRealtime): keeps to the timeline (skips frames rather than stretching the video), stops exactly at the video's length, starts the sound early by the AAC priming, paces with a worker timer, captures frame 0 before anything blocks, and reports skipped frames in plain words. It is used only when the browser has no VideoEncoder at all (`checkSupport` and the dialog); a size the encoder can't make is disabled with its reason, and sizes, rates or blur too slow to record in real time are disabled.
- **Preview** (`export-ui.js`): a run on its way or a failed run no longer freezes the preview; it waits, says why, and plays as soon as the run lands. It never shows a still of the live view while the view can render export frames.
- **Blocked states:** with no way to make a video, Export is disabled and the footer says why; while blocked the estimate is blank; the button's tooltip is one readable sentence.
- **Errors:** an encoder taken back by the browser says to keep the tab in front (it used to say "ran out of memory"); expected stops (the scene changed, can't encode, the encoder taken back, the GPU lost) are console warnings, not errors.
- **Progress:** the previous export's texts are cleared before anything is awaited; the time left waits for 10 frames; "Almost done" only past half way.
- **Layout and focus** (`export.css`): the cancelled note sits in the footer; focus returns to Export after Cancel export; the dialog's top edge no longer jumps between panes; the phone's progress line wraps.
- **Playback** (`app.js` mount: `playing`, `play`): resumes when the dialog closes if it was playing.
- **Done screen:** shown again only for the very scene it was made of, and left for the settings when a new run lands.

## Re-running the checks

`research/export-e2e/` has everything:
- the harness: `lib.mjs`, `job.mjs`, `analyze.py`, `extras.mjs`, `est2.mjs`, `blurcost.mjs`, `determ8.mjs`, `determ9.mjs`, `lost.mjs`, `avcheck.swift`
- the busy 20 s scene: `scenes/busy-20s.json`
- the reports: `reports/*.json`
- the five exported videos: `videos/`

To run: `node job.mjs starter car cradle plinko4k busy rgtrim rgfollow30blur plinkofollow`, then `python3 analyze.py <name>` (it now also reports the decoded sound's loudness, its first samples and how its left/right balance follows each hit's pan). This needs the server on :8790, ffmpeg in /opt/homebrew/bin, and the bundled Chromium 1248; it always runs headless.

The repair checks are in `research/export-e2e/repair/` (run from that folder; results land in `ui/`; `out/` holds the screenshots and results quoted above):
- `node ui-tests.mjs blurdefault stuckprev failed nothing cap4k reclaimed progress layout donestale`: the dialog's states, focus, layout and playback
- `node fb-test.mjs && python3 fb-analyze.py`: the real-time fallback (what is offered, a real export's sync, a slow source); `node fb-slow.mjs && zsh fb-slow-an.sh`, `node fb60.mjs`: its pacing
- `node loud-sweep.mjs`: every builtin scene's decoded loudness (`loud.sh`); `node dump-sims.mjs` then `node run-audio.mjs ../../../web/export/audio.js tag '{}'`: the sound alone, per scene
- `node pan-check.mjs`: each hit's pan drawn on the export's own frame
