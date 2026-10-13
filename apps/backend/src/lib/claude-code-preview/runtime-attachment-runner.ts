import { readFileSync } from 'node:fs'

/** The panel job's runner text; Desktop runs the same file as its `attachments` job. */
export const ATTACHMENT_RUNNER = readFileSync(
  new URL('./attachment-job.mjs', import.meta.url),
  'utf8',
)
