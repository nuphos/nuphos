// What the backend logged, one JSON line per entry, for the run to check.
import { readFileSync } from 'node:fs'

import { logPath } from './processes.ts'

// The sign-in page asks which social providers exist; this stack configures none.
const EXPECTED_FAILURE = /"path":"\/auth\/social\/login"|Social sign-in is not configured/

/** The lines the backend logged since `from` lines in. */
export function backendLog(from = 0): string[] {
  return readFileSync(logPath('backend'), 'utf8').split('\n').slice(from)
}

export const backendLines = () => backendLog().length

/** The backend's refused or failed requests and logged errors since `from` lines in, but those `expected` of the scenario asking. */
export function backendFailures(from: number, expected?: RegExp): string[] {
  return backendLog(from).filter(
    (line) =>
      /"level":"error"|"status":[45]\d\d/.test(line) &&
      !EXPECTED_FAILURE.test(line) &&
      !expected?.test(line),
  )
}
