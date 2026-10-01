// Redaction for anything that leaves the app as telemetry. Error text often
// echoes backend payloads, and this tool handles tokens, kubeconfigs, and pod
// logs — strip likely-sensitive substrings and cap the length before reporting.
// Telemetry needs the failure shape, not the full payload.
//
// Lives apart from `analytics.ts` so it can be tested without pulling in
// posthog-js and `import.meta.env`. Under-redacting is a privacy bug, so the
// patterns are exercised directly in reportRedaction.test.ts.

/** Upper bound on reported text, applied after redaction. */
export const MAX_REPORT_TEXT_LENGTH = 500

// `sonarjs/super-linear-regex` wants every quantifier bounded, so the email
// pattern spells out the protocol maxima rather than convenience numbers — a
// bound below the real maximum would match an address only partially and leave
// the tail (i.e. the domain) in the report.
//   - local part: RFC 5321 §4.5.3.1.1 caps it at 64 octets.
//   - each label: RFC 1035 §2.3.4 caps it at 63 octets.
//   - label count: a 253-octet name built from 1-octet labels holds at most
//     127 of them, so 1 leading label + up to 127 more covers every legal name.
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){1,127}/gi

const PRIVATE_KEY = /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----[\s\S]{0,65536}/g
const CONNECTION_CREDENTIALS = /\b([a-z][a-z0-9+.-]{1,31}:\/\/)[^/\s:@]{1,256}:[^@\s/]{1,512}@/gi
const SECRET_FIELD_PREFIX = /\b([a-z][a-z0-9_-]{0,63})(["']?\s*[:=]\s*)/gi
const SECRET_FIELDS = new Set([
  'access_token',
  'api_key',
  'apikey',
  'aws_secret_access_key',
  'client_secret',
  'passphrase',
  'passwd',
  'password',
  'private_key',
  'refresh_token',
  'secret_key',
  'token',
])

function redactSecretAssignments(value: string): string {
  let output = ''
  let copiedUntil = 0

  for (const match of value.matchAll(SECRET_FIELD_PREFIX)) {
    const field = match[1]
    const normalizedField = field.toLowerCase().replaceAll('-', '_')

    if (!SECRET_FIELDS.has(normalizedField)) continue

    const valueStart = match.index + match[0].length

    if (valueStart < copiedUntil) continue

    const quote = value[valueStart]
    let valueEnd = valueStart
    let replacement = '[redacted]'

    if (quote === '"' || quote === "'") {
      let escaped = false
      let closed = false

      valueEnd += 1
      while (valueEnd < value.length && value[valueEnd] !== '\n' && value[valueEnd] !== '\r') {
        const character = value[valueEnd]

        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === quote) {
          closed = true
          valueEnd += 1
          break
        }
        valueEnd += 1
      }
      replacement = `${quote}[redacted]${closed ? quote : ''}`
    } else {
      while (valueEnd < value.length && !/[\s"',;&}\]]/.test(value[valueEnd])) valueEnd += 1
      if (valueEnd === valueStart) continue
    }

    output += value.slice(copiedUntil, valueStart) + replacement
    copiedUntil = valueEnd
  }

  return output + value.slice(copiedUntil)
}

export function sanitizeReportText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const specificallyRedacted = value
    .replace(PRIVATE_KEY, '[redacted_private_key]')
    .replace(CONNECTION_CREDENTIALS, '$1[redacted_credentials]@')
    .replace(/\bAuthorization\s*[:=]\s*[^\r\n,;]{1,4096}/gi, 'Authorization: [redacted]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[a-z0-9+/=]{8,}/gi, 'Basic [redacted]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted_aws_access_key]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\b/g,
      '[redacted_jwt]',
    )
    .replace(/\b(?:sk|phc|ghp|gho|glpat|xox[a-z])[-_][A-Za-z0-9_-]{8,}\b/g, '[redacted_key]')

  return redactSecretAssignments(specificallyRedacted)
    .replace(EMAIL, '[redacted_email]')
    .slice(0, MAX_REPORT_TEXT_LENGTH)
}
