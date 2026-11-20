// Redaction for anything that leaves the app as telemetry. Error text often
// echoes backend payloads, and this tool handles tokens, kubeconfigs, and pod
// logs — strip likely-sensitive substrings and cap the length before reporting.
// Telemetry needs the failure shape, not the full payload.
//
// Lives apart from `analytics.ts` so it can be tested without pulling in
// posthog-js and `import.meta.env`. Under-redacting is a privacy bug, so the
// patterns are exercised directly in reportRedaction.test.ts.

import { sourceText } from '../i18n/index.ts'

import { redactSecrets } from './secretRedaction.ts'

/** Upper bound on reported text, applied after redaction. */
export const MAX_REPORT_TEXT_LENGTH = 500

export function sanitizeReportText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  // Report the English key, not the user's translation, so one failure stays
  // one group in every locale.
  return redactSecrets(sourceText(value)).slice(0, MAX_REPORT_TEXT_LENGTH)
}
