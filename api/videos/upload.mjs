// POST /api/videos/upload {job, files: [{name, type, size}]} with x-agent-key: one Blob client token per file of the job, each good for exactly
// videos/<VIDEO_GALLERY_ID>/jobs/<job>/<name> for 15 minutes; the caller PUTs the bytes straight to Blob. api/_lib/videos.mjs, docs/DEPLOY.md.
import { upload } from "../_lib/videos.mjs"

export const config = { maxDuration: 60 }
export default (req, res) => upload(req, res)
