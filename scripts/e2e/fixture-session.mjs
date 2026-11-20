// How the fixture agent starts, and what a session's system prompt tells it.
import { createHash } from 'node:crypto'
import { existsSync, writeSync } from 'node:fs'

import { botEnv } from './fixture-settings.mjs'

/** What this agent offers when it starts. */
export const INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'e2e-fixture', version: '1' },
  authMethods: [],
}

/** A CLI that dies while starting: signed out, without a key, or on too old a Node. */
export function dieAtStartup() {
  if (!existsSync(`${process.env.E2E_ACP_LOG}.die-at-startup`)) return
  writeSync(2, 'Error: the agent requires Node.js 24.9 or newer (found v20.19.0)\n')
  process.exit(3)
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

/** A session's Bot env, E2E_RULE and a hash per system prompt section, to tell which one changed. */
export const opening = (params) => ({
  env: botEnv(params),
  rule: ruleIn(params),
  sections: promptOf(params._meta)
    .split(/\n(?=## )/)
    .map(
      (section) =>
        `${section.slice(0, 24)}#${createHash('sha1').update(section).digest('hex').slice(0, 8)}`,
    ),
})
