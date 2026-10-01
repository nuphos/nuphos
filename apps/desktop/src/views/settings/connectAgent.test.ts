import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  connectAgentTeamChoices,
  formatCountdown,
  secondsUntil,
  selectedConnectAgentTeam,
  submitPairing,
} from './connectAgent.ts'

import type { AtlasTeam } from '../../types/team.ts'

const teams: AtlasTeam[] = [
  { id: 'a', name: 'Alpha', role: 'ADMINISTRATOR' },
  { id: 'b', name: 'Beta', role: 'EDITOR' },
  { id: 'c', name: 'Gamma', role: 'ADMINISTRATOR' },
]

function atlasError(code: string, details?: unknown): Error {
  return new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'x', code, details })}`)
}

test('only administered teams are selectable', () => {
  assert.deepEqual(
    connectAgentTeamChoices(teams).map((choice) => [choice.id, choice.selectable]),
    [
      ['a', true],
      ['b', false],
      ['c', true],
    ],
  )
})

test('preselects the current team only when the user administers it', () => {
  const choices = connectAgentTeamChoices(teams)

  assert.equal(selectedConnectAgentTeam(choices, '', 'c'), 'c')
  assert.equal(selectedConnectAgentTeam(choices, '', 'b'), '')
  assert.equal(selectedConnectAgentTeam(connectAgentTeamChoices(teams.slice(0, 2)), '', 'b'), 'a')
})

test('the selection follows teams that load after the link arrived, and keeps a valid pick', () => {
  assert.equal(selectedConnectAgentTeam([], '', 'c'), '')
  assert.equal(selectedConnectAgentTeam(connectAgentTeamChoices(teams), '', 'c'), 'c')
  assert.equal(selectedConnectAgentTeam(connectAgentTeamChoices(teams), 'a', 'c'), 'a')
  assert.equal(selectedConnectAgentTeam(connectAgentTeamChoices(teams), 'b', 'c'), 'c')
})

test('counts down to the code expiry', () => {
  assert.equal(secondsUntil(undefined, 0), undefined)
  assert.equal(secondsUntil(90_500, 0), 91)
  assert.equal(secondsUntil(1_000, 5_000), 0)
  assert.equal(formatCountdown(125), '2:05')
})

test('a duplicate connection becomes a choice, other failures still throw', async () => {
  const runtime = { id: 'r1', provider: 'claude-code' as const, replaced: false }

  assert.deepEqual(await submitPairing(() => Promise.resolve(runtime)), {
    kind: 'connected',
    runtime,
  })
  assert.deepEqual(
    await submitPairing(() =>
      Promise.reject(atlasError('runtime_already_connected', { runtimeId: 'r0' })),
    ),
    { kind: 'duplicate', runtimeId: 'r0' },
  )
  await assert.rejects(
    submitPairing(() => Promise.reject(atlasError('pairing_code_rejected'))),
    /pairing_code_rejected/u,
  )
})
