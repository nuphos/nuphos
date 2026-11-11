// The one secret scanner in the backend. Detection is secretlint: its
// recommended preset for provider keys, plus our own rule (nuphos-rule.ts) for
// what the preset leaves out. Redaction replaces the ranges secretlint reports.

import { lintSource } from '@secretlint/core'
import { rules as recommendedRules } from '@secretlint/secretlint-rule-preset-recommend'

import { NUPHOS_RULE_ID, nuphosSecretRule } from './nuphos-rule'

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

function scanConfig(options: NuphosRuleOptions): SecretLintCoreConfig {
  const preset = (recommendedRules as SecretLintRuleCreator[])
    .filter((rule) => !SKIPPED_PRESET_RULES.has(rule.meta.id))
    .map((rule) => ({ id: rule.meta.id, rule }))

  return {
    rules: [...preset, { id: NUPHOS_RULE_ID, rule: nuphosSecretRule, options }],
  }
}

const CONFIGS = {
  tokenShapes: scanConfig({}),
  storedContent: scanConfig({ pemHeaders: true }),
  everything: scanConfig({ contextual: true, pemHeaders: true }),
}

type ScanProfile = keyof typeof CONFIGS

function kindOf(message: { ruleId: string; data?: unknown }): string {
  if (message.ruleId === NUPHOS_RULE_ID) {
    const kind = (message.data as { kind?: unknown } | undefined)?.kind

    return typeof kind === 'string' ? kind : 'secret'
  }
  const name = message.ruleId.replace(PRESET_RULE_PREFIX, '')

  return PRESET_KINDS[name] ?? name
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
  const result = await lintSource({
    source: { content: text, filePath: 'input.txt', ext: '.txt', contentType: 'text' },
    options: {
      config: CONFIGS[profile],
      noPhysicFilePath: true,
    },
  })
  const findings = result.messages
    .map((message) => ({ kind: kindOf(message), range: message.range }))
    .sort((a, b) => a.range[0] - b.range[0])
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
