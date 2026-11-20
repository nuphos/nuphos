// How the fixture agent starts, and what a session's system prompt tells it.
import { createHash } from 'node:crypto'

import { botEnv } from './fixture-settings.mjs'

/** What this agent offers when it starts. */
export const INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'e2e-fixture', version: '1' },
  authMethods: [],
}

/** The E2E_RULE:<name> the system prompt a session is loaded with names (#4083). */
export const ruleIn = (params) =>
  /E2E_RULE:([a-z]+)/.exec(JSON.stringify(params._meta ?? {}))?.[1] ?? 'none'

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
