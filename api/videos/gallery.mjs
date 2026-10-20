// GET /videos/<gallery>[/batches/<batch>] (vercel.json rewrites it here): the team's video gallery as a page, from the database. Only the
// unguessable VIDEO_GALLERY_ID opens it (anything else is 404). Blob serves the index.html it also writes as a download, so this is the page
// to share. api/_lib/videos.mjs, docs/DEPLOY.md.
import { gallery } from "../_lib/videos.mjs"

export const config = { maxDuration: 60 }
export default (req, res) => gallery(req, res)
