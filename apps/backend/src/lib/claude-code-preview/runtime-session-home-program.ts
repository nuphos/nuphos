import { readFileSync } from 'node:fs'

/** The panel job's runner text; a computer runs the same file as its `session-homes` job. */
export const RECLAIM_SESSION_HOME_PROGRAM = readFileSync(
  new URL('./session-home-reclaim-job.mjs', import.meta.url),
  'utf8',
)
