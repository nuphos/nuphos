// A secretlint rule for what the recommended preset does not cover: Nuphos
// tokens, the loose key shapes we redact even when the preset's checksum or
// parse validation would let a fake-looking one through, and (in contextual
// mode) assignments, auth headers, CLI flags and the high-entropy sweep.
//
// Bias: over-redact. A false positive costs a little readability; a false
// negative welds a live credential into storage we cannot purge.
//
// The backend runs this over whole inputs, so every pattern must stay linear:
// a part that can restart at each position of a long run (a key-name suffix,
// a URL scheme) is bounded, and the values, which only consume, are not.

import type { SecretLintRuleCreator, SecretLintSourceCode } from '@secretlint/types'

export const NUPHOS_RULE_ID = '@nuphos/secretlint-rule-nuphos'

export type NuphosRuleOptions = {
  /** Also report context-dependent secrets: assignments, headers, flags, entropy. */
  contextual?: boolean
  /** Also report a lone PEM BEGIN line, as key material that was cut off. */
  pemHeaders?: boolean
}

type Shape = {
  kind: string
  pattern: RegExp
  /** Capture group holding the secret; the rest of the match stays readable. */
  group?: number
}

const messages = {
  SECRET: {
    en: (props: { kind: string }) => `found a secret (${props.kind})`,
  },
}

// Unambiguous token shapes: safe to apply to any text without hiding prose,
// ids or commit hashes the way the contextual rules and entropy sweep can.
const TOKEN_SHAPES: Shape[] = [
  {
    kind: 'pem-private-key',
    // The body stops at the next BEGIN line and is capped well above an
    // 8192-bit RSA key, so many unclosed BEGIN lines stay cheap.
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[^-]|-(?!----BEGIN )){0,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/dg,
  },
  { kind: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg },
  // An unbounded header starts only at the head of a token run: from every
  // `eyJ` inside one (as in `eyJ-eyJ-...`) the scan would re-read the run,
  // which is quadratic. After a hyphen (`session-<jwt>`) the header is capped
  // instead, well above a real one, so each restart reads a bounded span.
  {
    kind: 'jwt',
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/dg,
  },
  {
    kind: 'jwt',
    pattern: /(?<=-)eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/dg,
  },
  // Nuphos sign-in sessions (nus_) and CLI tokens (nup_).
  { kind: 'nuphos-token', pattern: /\bnu[ps]_[A-Za-z0-9_-]{20,}/dg },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/dg },
  { kind: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/dg },
  // OpenAI-compatible keys without the marker the preset's openai rule requires.
  // Trailing -/_ segments belong to the key; stopping at the first one would
  // leave a suffix too short for the entropy sweep to catch.
  { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9]{20,}(?:[-_][A-Za-z0-9]+)*/dg },
]

const PEM_HEADER: Shape = {
  kind: 'pem-private-key',
  pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/dg,
}

const CONTEXTUAL: Shape[] = [
  {
    // scheme://user:password@host keeps the user. The lookahead skips a value
    // that IS a whole placeholder, so redacted text stays at zero matches; a
    // password merely prefixed with "[REDACTED" still matches.
    kind: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/]+:(?!\[REDACTED:[a-z0-9-]+\]@)([^\s@/]+)@/dgi,
    group: 1,
  },
  { kind: 'bearer-token', pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{12,})/dg, group: 1 },
  // Basic payloads are often ~20 chars, below the entropy sweep's floor.
  { kind: 'basic-auth', pattern: /\bBasic\s+([A-Za-z0-9+/=]{8,})/dg, group: 1 },
  {
    // KEY=value / key: value / {"key":"value"} whose name smells like a secret.
    // `auth(?!ors?(?![\w-]))` exempts "author"/"authors" only as the WHOLE key
    // (git and gh output is full of them), so "author-key" still matches.
    kind: 'secret-assignment',
    pattern:
      // eslint-disable-next-line sonarjs/regex-complexity -- every way under the threshold drops key names or value forms this rule must cover, and a missed assignment welds a live credential into WORM storage
      /(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth(?!ors?(?![\w-])))[\w-]{0,64}["']?\s*[=:]\s*(?!Bearer\b|Basic\b|\[REDACTED)("[^"]{6,}"|'[^']{6,}'|[^\s"']{6,})/dgi,
    group: 1,
  },
  {
    // --token xxx / --password=xxx. Same whole-placeholder lookahead as above.
    kind: 'secret-flag',
    pattern:
      // eslint-disable-next-line sonarjs/regex-complexity -- the exact-placeholder idempotency lookahead pushes past the threshold; dropping flag names or value forms to get under it would leak real credentials
      /--(?:token|password|passwd|secret|api-key|client-secret|access-key|private-key)[= ](?!\[REDACTED:[a-z0-9-]+\](?!\S))("[^"]+"|'[^']+'|[^\s"']+)/dgi,
    group: 1,
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

// Secretlint has no generic detector, and a provider the preset does not know
// still issues long random tokens. Tuned to skip prose, paths and hex ids.
const ENTROPY_CANDIDATE = /\b[A-Za-z0-9+/=_-]{32,}\b/g
const ENTROPY_THRESHOLD_BITS = 4.5

type Range = readonly [number, number]

function shapeRanges(text: string, shape: Shape): Range[] {
  return [...text.matchAll(shape.pattern)].flatMap((match) => {
    const range = match.indices?.[shape.group ?? 0]

    return range ? [[range[0], range[1]] as const] : []
  })
}

// One pass over sorted ranges, so a dense input stays linear in its length.
function maskRanges(text: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  let out = ''
  let copiedUntil = 0

  for (const [start, end] of sorted) {
    if (end <= copiedUntil) continue
    const from = Math.max(start, copiedUntil)

    out += text.slice(copiedUntil, from) + ' '.repeat(end - from)
    copiedUntil = end
  }

  return out + text.slice(copiedUntil)
}

// Entropy runs over the text with every earlier finding blanked out, so a
// candidate cannot swallow the key name in front of an assignment's value.
function entropyRanges(text: string, found: Range[]): Range[] {
  const masked = maskRanges(text, found)

  return [...masked.matchAll(ENTROPY_CANDIDATE)].flatMap((match) => {
    const candidate = match[0]

    // sha256/uuid-like lowercase hex is metadata we WANT readable.
    if (/^[a-f0-9-]+$/.test(candidate)) return []
    if (shannonEntropy(candidate) < ENTROPY_THRESHOLD_BITS) return []

    return [[match.index, match.index + candidate.length] as const]
  })
}

export type NuphosFinding = { kind: string; range: Range }

/**
 * Everything the rule reports, in one linear pass. The backend calls this
 * directly on whole inputs: secretlint drops duplicate messages by comparing
 * every pair, which a dense input would make quadratic.
 */
export function findNuphosSecrets(text: string, options: NuphosRuleOptions): NuphosFinding[] {
  const shapes = [
    ...TOKEN_SHAPES,
    ...(options.pemHeaders ? [PEM_HEADER] : []),
    ...(options.contextual ? CONTEXTUAL : []),
  ]
  const findings = shapes.flatMap((shape) =>
    shapeRanges(text, shape).map((range) => ({ kind: shape.kind, range })),
  )

  if (!options.contextual) return findings
  const entropy = entropyRanges(
    text,
    findings.map((finding) => finding.range),
  ).map((range) => ({ kind: 'high-entropy', range }))

  return [...findings, ...entropy]
}

export const nuphosSecretRule: SecretLintRuleCreator<NuphosRuleOptions> = {
  messages,
  meta: {
    id: NUPHOS_RULE_ID,
    recommended: false,
    type: 'scanner',
    supportedContentTypes: ['text'],
  },
  create(context, options) {
    const t = context.createTranslator(messages)

    return {
      file(source: SecretLintSourceCode) {
        for (const { kind, range } of findNuphosSecrets(source.content, options)) {
          context.report({ message: t('SECRET', { kind }), range, data: { kind } })
        }
      },
    }
  },
}
