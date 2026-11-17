// What the backend logged, one JSON line per entry, for the run to check.
import { readFileSync } from 'node:fs'

import { logPath } from './processes.ts'

// Refused on purpose: no social sign-in here, the fixture agent's usage-limit prompt (#3051),
// another member's private binding, a computer taken over or unregistered, a typo, someone
// else's personal dashboard, and a dashboard panel this stack's agents cannot run.
const EXPECTED_FAILURE =
  /"path":"\/auth\/social\/login"|Social sign-in is not configured|Internal error: You’ve hit your usage limit|"error_code":"(gitlab_binding_access_denied|binding_private|sonarqube_integration_access_denied|device_held|device_not_found|invalid_email|dashboard_not_found)"|"event":"dashboard\.panel\.exec_failed".*"kind":"runtime_outdated"/

// The fixture agent refuses prompts as too long on purpose too (#3160).
const TOO_LONG = /Internal error: Prompt is too long/

// A turn that finds the agent host stopped on purpose, which the queue retries once it is back
// (#3265), or which a Bot's chat says in a line (#3260).
const HOST_STOPPED =
  /"event":"agent\.(trigger\.request\.error|chat\.run\.error_frame_appended|channel\.turn_failed)".*Failed to connect to OpenAB ACP endpoint/

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
      !TOO_LONG.test(line) &&
      !HOST_STOPPED.test(line) &&
      !expected?.test(line),
  )
}
