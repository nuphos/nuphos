// How the fixture agent starts, and what a session's system prompt tells it.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

import { botEnv } from './fixture-settings.mjs'

/** What this agent offers when it starts. */
const INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'e2e-fixture', version: '1' },
  authMethods: [],
}

/** The E2E_RULE:<name> the system prompt a session is loaded with names (#4083). */
export const ruleIn = (params) =>
  /E2E_RULE:([a-z]+)/.exec(JSON.stringify(params._meta ?? {}))?.[1] ?? 'none'

// The E2E_RULE a turn's instructions update names, read from the lead before the user's
// words (always the last part) or Codex `_meta`, never from what the user typed.
export function updatedRule(parts, meta) {
  const lead = parts
    .slice(0, -1)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
  const update = /<nuphos_instructions_update>[\s\S]*?<\/nuphos_instructions_update>/.exec(
    [...lead, meta?.['ai.nuphos/instructionsUpdate'] ?? ''].join('\n'),
  )?.[0]

  return update && (/E2E_RULE:([a-z]+)/.exec(update)?.[1] ?? 'none')
}

/** The system prompt a session opens or loads with, in any of the backend's _meta shapes. */
const promptOf = (meta = {}) =>
  meta.systemPrompt?.append ??
  meta['ai.nuphos/codex']?.developerInstructions ??
  meta['ai.nuphos/session']?.systemPrompt ??
  ''

/** A session's Bot env, E2E_RULE, whether it is told to delegate (#4156), and a hash per system prompt section. */
export const opening = (params) => ({
  env: botEnv(params),
  rule: ruleIn(params),
  delegates: promptOf(params._meta).includes('Delegate work by default'),
  sections: promptOf(params._meta)
    .split(/\n(?=## )/)
    .map(
      (section) =>
        `${section.slice(0, 24)}#${createHash('sha1').update(section).digest('hex').slice(0, 8)}`,
    ),
})

/** The model probe names itself in `initialize`, so a fixture can answer turns
 *  and still fail discovery. */
let probing = false

export function initialize(params) {
  probing = params?.clientInfo?.name === 'nuphos-model-discovery'

  return INITIALIZE
}

/** Whether this session/new is a model probe that fails, as a CLI that cannot list
 *  its models does (#4261). Every attempt is logged, probe or not. */
export function discoveryFails(log) {
  if (!probing) return false
  const failing = existsSync(process.env.E2E_MODEL_PROBE_FAILS ?? '')

  log({ event: 'discovery', failed: failing })

  return failing
}
