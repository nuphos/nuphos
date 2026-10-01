import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentName, agentTier, defaultAgent, groupAgentsByTier } from './agentName.ts'

const me = { userId: 'u1', deviceId: 'mac' }
const here = {
  id: 'local_u1_mac',
  label: 'MacBook · Claude Code',
  local: { ownerUserId: 'u1', deviceId: 'mac', deviceLabel: 'MacBook', signedIn: true },
}
const hereCodex = { ...here, id: 'local_u1_mac_codex', label: 'MacBook · Codex' }
const studio = {
  id: 'local_u1_studio',
  label: 'Studio · Claude Code',
  local: { ownerUserId: 'u1', deviceId: 'studio', deviceLabel: 'Studio', signedIn: true },
}
const managed = { id: 'rt-1', label: 'Team Claude' }
const external = { id: 'rt-2', label: 'Self-hosted' }

test('this computer is Local, my other computers are Remote, team agents are Cloud', () => {
  assert.equal(agentTier(here, me), 'local')
  assert.equal(agentTier(studio, me), 'remote')
  assert.equal(agentTier(managed, me), 'cloud')
  assert.equal(agentTier(here, null), 'remote')
})

test('a local agent is named for its computer', () => {
  assert.equal(agentName(here, me), 'Local')
  assert.equal(agentName(studio, me), 'Studio')
  assert.equal(agentName(managed, me), 'Team Claude')
})

test('a conversation stamped with only an id and label still reads by its computer', () => {
  assert.equal(agentName({ id: 'local_u1_mac', label: 'MacBook · Claude Code' }, me), 'Local')
  assert.equal(agentName({ id: 'local_u1_studio_codex', label: 'Studio · Codex' }, me), 'Studio')
})

test('the picker groups agents Local, Remote, Cloud and leaves out empty sections', () => {
  const groups = groupAgentsByTier([managed, studio, here, external, hereCodex], me)

  assert.deepEqual(
    groups.map((group) => [group.title, group.agents.map((agent) => agent.id)]),
    [
      ['This computer', ['local_u1_mac', 'local_u1_mac_codex']],
      ['My computers', ['local_u1_studio']],
      ['Cloud', ['rt-1', 'rt-2']],
    ],
  )
  assert.deepEqual(
    groupAgentsByTier([managed], me).map((group) => group.tier),
    ['cloud'],
  )
  assert.deepEqual(groupAgentsByTier([], me), [])
})

test('a new conversation defaults to this computer when its agent is ready', () => {
  const cloud = { ...managed, status: 'active' as const }
  const local = { ...here, status: 'active' as const }
  const remote = { ...studio, status: 'active' as const }

  assert.equal(defaultAgent([cloud, remote, local], me)?.id, 'local_u1_mac')
  assert.equal(
    defaultAgent([cloud, { ...local, local: { ...local.local, signedIn: false } }], me)?.id,
    'rt-1',
  )
  assert.equal(defaultAgent([remote], me), undefined)
  assert.equal(defaultAgent([{ ...cloud, status: 'disabled' as const }], me), undefined)
})
