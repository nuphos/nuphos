// Secret redaction for journal payloads.
//
// Journal segments end up in WORM storage where nothing can ever be deleted,
// so secrets must never reach the journal in the first place. Redaction runs
// BEFORE canonicalization/hashing; the journal stores the redacted text plus
// an HMAC fingerprint of the original (see hashing.ts for why HMAC, not
// sha256).
//
// Bias: over-redact. A false positive costs a little readability; a false
// negative welds a live credential into storage we cannot purge.

export type RedactionMatch = { kind: string; count: number }

export type RedactionResult = {
  redacted: string
  matches: RedactionMatch[]
  redactedCount: number
}

type Rule = {
  kind: string
  pattern: RegExp
  /** Replacement builder; defaults to the full match → placeholder. */
  replace?: (groups: string[]) => string
}

function placeholder(kind: string): string {
  return `[REDACTED:${kind}]`
}

// Order matters: structural blocks first (PEM), then well-known token shapes,
// then contextual assignments/flags, then the generic entropy sweep.
const RULES: Rule[] = [
  {
    kind: 'pem-private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    kind: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  },
  {
    kind: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    kind: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    // scheme://user:password@host → keep user, drop password. The lookahead
    // keeps the rule idempotent: without it the placeholder itself re-matches
    // as a password, so already-redacted text keeps counting as a hit. It is
    // anchored to the FULL placeholder token ending at the @ — a password
    // merely prefixed with "[REDACTED" still redacts (bypass otherwise).
    kind: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):(?!\[REDACTED:[a-z0-9-]+\]@)([^\s@/]+)@/gi,
    replace: (groups) => `${String(groups[1])}:${placeholder('url-credentials')}@`,
  },
  {
    // Authorization: Bearer <token>. Must run BEFORE secret-assignment:
    // otherwise "Authorization:" matches as an assignment whose value is the
    // literal word "Bearer" — redacting the keyword and LEAKING the token.
    kind: 'bearer-token',
    pattern: /(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})/g,
    replace: (groups) => `${String(groups[1])}${placeholder('bearer-token')}`,
  },
  {
    // Authorization: Basic <base64(user:password)>. Same ordering constraint
    // as Bearer; the payload is often ~20 chars, below the entropy sweep's
    // floor, so it needs an explicit rule.
    kind: 'basic-auth',
    pattern: /(\bBasic\s+)([A-Za-z0-9+/=]{8,})/g,
    replace: (groups) => `${String(groups[1])}${placeholder('basic-auth')}`,
  },
  {
    // KEY=value / key: value assignments whose name smells like a secret.
    // The optional quote after the key name covers JSON-serialized objects
    // ({"password":"..."}) — without it the closing quote sits between the
    // key and the colon and the rule never fires (PR #711 review F1).
    // `auth(?!ors?(?![\w-]))` exempts "author"/"authors" when that is the
    // WHOLE key — git and gh output is full of them, and a quoted JSON value
    // may contain spaces where the bare form could not, so without this every
    // commit author became [REDACTED] once tool output started flowing
    // through here (PR #711 review F6). The inner `(?![\w-])` is what makes
    // it the whole key: a plain `\b` also fires on a hyphen, which let
    // `author-key=...` escape the rule entirely (review F7). So
    // "authorization"/"authorized_keys"/"author-key" all keep matching, and
    // the entropy sweep still covers an actual credential regardless of what
    // its key is called.
    // Negative lookahead skips auth-scheme keywords so header forms like
    // "Authorization: Basic <creds>" fall through to their dedicated rules.
    kind: 'secret-assignment',
    pattern:
      // eslint-disable-next-line sonarjs/regex-complexity -- every way under the threshold drops key names or value forms this rule must cover, and a missed assignment welds a live credential into WORM storage
      /((?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth(?!ors?(?![\w-])))[\w-]*["']?\s*[=:]\s*)(?!Bearer\b|Basic\b|\[REDACTED)("[^"]{6,}"|'[^']{6,}'|[^\s"']{6,})/gi,
    replace: (groups) => `${String(groups[1])}${placeholder('secret-assignment')}`,
  },
  {
    // --token xxx / --password=xxx style CLI flags. Same idempotency
    // lookahead as url-credentials: skip only a value that IS the whole
    // placeholder token, never one merely prefixed with it.
    kind: 'secret-flag',
    pattern:
      // eslint-disable-next-line sonarjs/regex-complexity -- the exact-placeholder idempotency lookahead pushes past the threshold; dropping flag names or value forms to get under it would leak real credentials
      /(--(?:token|password|passwd|secret|api-key|client-secret|access-key|private-key)[= ])(?!\[REDACTED:[a-z0-9-]+\](?!\S))("[^"]+"|'[^']+'|[^\s"']+)/gi,
    replace: (groups) => `${String(groups[1])}${placeholder('secret-flag')}`,
  },
]

/** Shannon entropy in bits per character. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0
  const freq = new Map<string, number>()

  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let entropy = 0

  for (const count of freq.values()) {
    const p = count / text.length

    entropy -= p * Math.log2(p)
  }

  return entropy
}

// Final sweep: long, high-entropy, secret-shaped tokens that no explicit rule
// caught. Threshold tuned to skip prose, paths and hex ids of low variety.
const ENTROPY_CANDIDATE = /\b[A-Za-z0-9+/=_-]{32,}\b/g
const ENTROPY_THRESHOLD_BITS = 4.5

function entropySweep(text: string, matches: RedactionMatch[]): string {
  let count = 0
  const result = text.replace(ENTROPY_CANDIDATE, (candidate) => {
    // sha256/uuid-like lowercase hex is metadata we WANT readable (digests,
    // volume handles); it also sits below the mixed-charset threshold anyway.
    if (/^[a-f0-9-]+$/.test(candidate)) return candidate
    if (shannonEntropy(candidate) < ENTROPY_THRESHOLD_BITS) return candidate
    count += 1

    return placeholder('high-entropy')
  })

  if (count > 0) matches.push({ kind: 'high-entropy', count })

  return result
}

export function redactSecrets(text: string): RedactionResult {
  let redacted = text
  const matches: RedactionMatch[] = []

  for (const rule of RULES) {
    let count = 0

    redacted = redacted.replace(rule.pattern, (...args) => {
      count += 1
      if (rule.replace) {
        // args = [fullMatch, ...captureGroups, offset, source]
        const groups = args.slice(0, -2).map(String)

        return rule.replace(groups)
      }

      return placeholder(rule.kind)
    })
    if (count > 0) matches.push({ kind: rule.kind, count })
  }

  redacted = entropySweep(redacted, matches)

  return {
    redacted,
    matches,
    redactedCount: matches.reduce((sum, m) => sum + m.count, 0),
  }
}
