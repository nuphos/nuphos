// What the backend logged, one JSON line per entry, for the run to check.
import { readFileSync } from 'node:fs'

import { logPath } from './processes.ts'

// The sign-in page asks which social providers exist; this stack configures none.
// The fixture agent refuses one prompt as out of usage on purpose (#3051).
// Refused on purpose: another member's private binding, a computer taken over or unregistered, a typo.
const EXPECTED_FAILURE =
  /"path":"\/auth\/social\/login"|Social sign-in is not configured|Internal error: You’ve hit your usage limit|"error_code":"(gitlab_binding_access_denied|binding_private|sonarqube_integration_access_denied|device_held|device_not_found|invalid_email)"/

/** The lines the backend logged since `from` lines in. */
export function backendLog(from = 0): string[] {
  return readFileSync(logPath('backend'), 'utf8').split('\n').slice(from)
}

export const backendLines = () => backendLog().length

/** Requests the backend refused or failed, and errors it logged, since `from` lines in. */
export function backendFailures(from: number): string[] {
  return backendLog(from).filter(
    (line) => /"level":"error"|"status":[45]\d\d/.test(line) && !EXPECTED_FAILURE.test(line),
  )
}
