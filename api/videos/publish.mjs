// POST /api/videos/publish {job, batch?, title, request, lesson, seconds, checks, cost_usd} with x-agent-key: checks the job's files are in
// Blob and every check passed, records who published it, and rewrites the team gallery's index.json + index.html (and the batch's).
// api/_lib/videos.mjs, docs/DEPLOY.md.
import { publish } from "../_lib/videos.mjs"

export const config = { maxDuration: 60 }
export default (req, res) => publish(req, res)
