import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentName,
  agentTier,
  defaultAgent,
  groupAgentsByTier,
  listedAgents,
  usable,
} from './agentName.ts'

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
  // Known by id alone, before the catalog says whose computer it is.
  for (const provider of ['codex', 'grok', 'opencode'])
    assert.equal(agentTier({ id: `local_u1_mac_${provider}`, label: '' }, me), 'local')
})

test('every agent goes by its own label', () => {
  assert.equal(agentName(here, me), 'MacBook · Claude Code')
  assert.equal(agentName(studio, me), 'Studio · Claude Code')
  assert.equal(agentName(managed, me), 'Team Claude')
  assert.equal(
    agentName({ id: 'local_u1_studio_codex', label: 'Studio · Codex' }, me),
    'Studio · Codex',
  )
})

test('the picker lists every agent in one untitled group', () => {
  const groups = groupAgentsByTier([managed, studio, here, external, hereCodex], me)

  assert.deepEqual(
    groups.map((group) => [group.title, group.agents.map((agent) => agent.id)]),
    [['', ['rt-1', 'local_u1_studio', 'local_u1_mac', 'rt-2', 'local_u1_mac_codex']]],
  )
  assert.deepEqual(groupAgentsByTier([], me), [])
})

test('a new conversation starts on the usable agent with the most quota left', () => {
  const cloud = { ...managed, status: 'active' as const }
  const local = { ...here, status: 'active' as const }
  const remote = { ...studio, status: 'active' as const }
  const used = new Map([
    ['rt-1', 80],
    ['local_u1_mac', 40],
  ])

  assert.equal(defaultAgent([cloud, remote, local], me)?.id, 'rt-1')
  assert.equal(defaultAgent([cloud, local], me, (agent) => used.get(agent.id))?.id, 'local_u1_mac')
  assert.equal(
    defaultAgent([cloud, remote, local], me, (agent) => used.get(agent.id))?.id,
    'local_u1_studio',
  )
  assert.equal(
    defaultAgent([{ ...local, local: { ...local.local, signedIn: false } }], me),
    undefined,
  )
  assert.equal(defaultAgent([{ ...cloud, status: 'disabled' as const }], me), undefined)
})

test('one rule decides what the picker lists and what a new conversation starts on', () => {
  const ready = { id: 'a', label: 'Ready', status: 'active' as const }
  const starting = { ...ready, id: 'b', notReady: true }
  const disabled = { ...ready, id: 'c', status: 'disabled' as const }
  const signedIn = { ...here, status: 'active' as const }
  const signedOut = { ...signedIn, id: 'd', local: { ...here.local, signedIn: false } }

  assert.deepEqual(listedAgents([ready, starting, disabled, signedIn, signedOut]), [
    ready,
    signedIn,
  ])
  assert.deepEqual(listedAgents([starting, disabled, signedOut]), [])
  // A not-ready agent is never the default, however much quota it has left.
  assert.equal(defaultAgent([starting, ready], me, (agent) => (agent.id === 'b' ? 0 : 90))?.id, 'a')
  assert.equal(usable(starting), false)
})
