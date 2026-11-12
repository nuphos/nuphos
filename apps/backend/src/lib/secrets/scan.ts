// The one secret scanner in the backend. Detection is secretlint: its
// recommended preset for provider keys, plus our own rule (nuphos-rule.ts) for
// what the preset leaves out, whose scan we call directly (see findSecrets). Redaction replaces the ranges secretlint reports.

import { lintSource } from '@secretlint/core'
import { rules as recommendedRules } from '@secretlint/secretlint-rule-preset-recommend'

import { findNuphosSecrets } from './nuphos-rule'

import type { NuphosRuleOptions } from './nuphos-rule'
import type { SecretLintCoreConfig, SecretLintRuleCreator } from '@secretlint/types'

export { shannonEntropy } from './nuphos-rule'

export type SecretFinding = { kind: string; range: readonly [number, number] }

export type RedactionMatch = { kind: string; count: number }

export type RedactionResult = {
  redacted: string
  matches: RedactionMatch[]
  redactedCount: number
}

const PRESET_RULE_PREFIX = '@secretlint/secretlint-rule-'

// filter-comments would let "secretlint-disable" in agent output switch the
// scan off. The two URL rules report the whole URL; our url-credentials rule
// covers every scheme and redacts only the password, keeping user and host.
const SKIPPED_PRESET_RULES = new Set(
  ['filter-comments', 'basicauth', 'database-connection-string'].map(
    (name) => `${PRESET_RULE_PREFIX}${name}`,
  ),
)

// Stable kind names for the rules our stored redaction counts already use.
const PRESET_KINDS: Record<string, string> = {
  privatekey: 'pem-private-key',
  github: 'github-token',
  slack: 'slack-token',
}

// When findings overlap, the merged range is labelled with the earliest kind.
const KIND_ORDER = [
  'pem-private-key',
  'aws-access-key-id',
  'jwt',
  'nuphos-token',
  'github-token',
  'slack-token',
  'api-key',
  'url-credentials',
  'bearer-token',
  'basic-auth',
  'secret-assignment',
  'secret-flag',
]

function kindRank(kind: string): number {
  if (kind === 'high-entropy') return KIND_ORDER.length + 1
  const rank = KIND_ORDER.indexOf(kind)

  return rank === -1 ? KIND_ORDER.length : rank
}

const PRESET_CONFIG: SecretLintCoreConfig = {
  rules: (recommendedRules as SecretLintRuleCreator[])
    .filter((rule) => !SKIPPED_PRESET_RULES.has(rule.meta.id))
    .map((rule) => ({ id: rule.meta.id, rule })),
}

const PROFILES = {
  tokenShapes: {},
  storedContent: { pemHeaders: true },
  everything: { contextual: true, pemHeaders: true },
} satisfies Record<string, NuphosRuleOptions>

type ScanProfile = keyof typeof PROFILES

function kindOf(message: { ruleId: string }): string {
  const name = message.ruleId.replace(PRESET_RULE_PREFIX, '')

  return PRESET_KINDS[name] ?? name
}

// secretlint drops duplicate messages by comparing every pair, so one lint of
// a large input full of findings is quadratic and blocks the event loop. The
// Nuphos rule, whose matches have no length bound, therefore scans the whole
// text in one linear pass outside lintSource. The preset matches bounded token
// shapes, so for it large inputs are linted in chunks of about 32 KB, cut at a newline when one
// is near and mid-line otherwise (compact JSON has none); a PEM block is never
// split. Each chunk also re-reads the 2 KB before its cut, so a token cut in
// half is seen whole; the merge below folds the findings the overlap reports twice.
const CHUNK_CHARS = 32_000
const NEWLINE_SEARCH_CHARS = 4_000
const OVERLAP_CHARS = 2_000
const PEM_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[^-]|-(?!----BEGIN )){0,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g

type Bounds = readonly [number, number]

function cutAfter(text: string, start: number, pemBlocks: Bounds[]): number {
  const target = start + CHUNK_CHARS
  const newline = text.indexOf('\n', target)
  const cut = newline !== -1 && newline < target + NEWLINE_SEARCH_CHARS ? newline + 1 : target
  const block = pemBlocks.find(([from, to]) => from < cut && cut < to)

  return block ? block[1] : cut
}

function chunkBounds(text: string): Bounds[] {
  if (text.length <= CHUNK_CHARS) return [[0, text.length]]
  const pemBlocks = [...text.matchAll(PEM_BLOCK)].map((m): Bounds => [
    m.index,
    m.index + m[0].length,
  ])
  const bounds: Bounds[] = []
  let start = 0

  while (text.length - start > CHUNK_CHARS) {
    const cut = cutAfter(text, start, pemBlocks)

    bounds.push([start, cut])
    start = cut
  }

  return [...bounds, [start, text.length]]
}

/** Where to start linting a chunk: a fixed overlap, even mid-line. */
function lintStart(start: number): number {
  return Math.max(0, start - OVERLAP_CHARS)
}

/**
 * Every secret in `text`, overlapping findings merged. `tokenShapes` keeps to
 * unambiguous key shapes; `storedContent` adds a lone PEM BEGIN line.
 */
export async function findSecrets(
  text: string,
  profile: ScanProfile = 'everything',
): Promise<SecretFinding[]> {
  if (text.length === 0) return []
  const findings: SecretFinding[] = findNuphosSecrets(text, PROFILES[profile])

  for (const [chunk, [chunkStart, end]] of chunkBounds(text).entries()) {
    // Let other requests run between the synchronous parts of each lint.
    if (chunk > 0) await new Promise((resolve) => setImmediate(resolve))
    const start = lintStart(chunkStart)
    const result = await lintSource({
      source: {
        content: text.slice(start, end),
        filePath: 'input.txt',
        ext: '.txt',
        contentType: 'text',
      },
      options: { config: PRESET_CONFIG, noPhysicFilePath: true },
    })

    for (const message of result.messages) {
      findings.push({
        kind: kindOf(message),
        range: [message.range[0] + start, message.range[1] + start],
      })
    }
  }
  findings.sort((a, b) => a.range[0] - b.range[0])
  const merged: SecretFinding[] = []

  for (const finding of findings) {
    const last = merged.at(-1)

    if (!last || finding.range[0] >= last.range[1]) {
      merged.push(finding)
      continue
    }
    merged[merged.length - 1] = {
      kind: kindRank(finding.kind) < kindRank(last.kind) ? finding.kind : last.kind,
      range: [last.range[0], Math.max(last.range[1], finding.range[1])],
    }
  }

  return merged
}

function placeholder(kind: string): string {
  return `[REDACTED:${kind}]`
}

function replaceFindings(text: string, findings: SecretFinding[]): string {
  let out = ''
  let copiedUntil = 0

  for (const { kind, range } of findings) {
    out += text.slice(copiedUntil, range[0]) + placeholder(kind)
    copiedUntil = range[1]
  }

  return out + text.slice(copiedUntil)
}

/** Replaces every secret with `[REDACTED:<kind>]`. Bias: over-redact. */
export async function redactSecrets(text: string): Promise<RedactionResult> {
  const findings = await findSecrets(text)
  const counts = new Map<string, number>()

  for (const { kind } of findings) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  const matches = [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind))

  return {
    redacted: replaceFindings(text, findings),
    matches,
    redactedCount: findings.length,
  }
}

/** Replaces only well-known token shapes; leaves everything else readable. */
export async function redactTokenShapes(text: string): Promise<string> {
  return replaceFindings(text, await findSecrets(text, 'tokenShapes'))
}

const EMBEDDED_SECRET_LABELS: Record<string, string> = {
  'aws-access-key-id': 'an AWS access key id',
  'api-key': 'a secret API key',
  openai: 'a secret API key',
  anthropic: 'a secret API key',
  'pem-private-key': 'a private key',
}

/** Why `text` must not be stored as shared content, or null when it holds no key. */
export async function findEmbeddedSecret(text: string): Promise<string | null> {
  const [finding] = await findSecrets(text, 'storedContent')

  if (!finding) return null
  const label = EMBEDDED_SECRET_LABELS[finding.kind] ?? `a secret (${finding.kind})`

  return `content appears to contain ${label}`
}
