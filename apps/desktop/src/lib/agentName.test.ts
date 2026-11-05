import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentName,
  agentTier,
  defaultAgent,
  groupAgentsByTier,
  listedAgents,
  newChatAgent,
  unavailable,
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

test('a new conversation starts on the nearest usable agent, quota breaking ties', () => {
  const cloud = { ...managed, status: 'active' as const }
  const local = { ...here, status: 'active' as const }
  const remote = { ...studio, status: 'active' as const }
  const used = new Map([
    ['rt-1', 80],
    ['local_u1_mac', 40],
  ])

  // This computer comes first, however much quota the others have left.
  assert.equal(defaultAgent([cloud, remote, local], me)?.id, 'local_u1_mac')
  assert.equal(
    defaultAgent([cloud, remote, local], me, (agent) => used.get(agent.id))?.id,
    'local_u1_mac',
  )
  // Among the rest, the most quota left.
  assert.equal(
    defaultAgent([cloud, remote], me, (agent) => used.get(agent.id))?.id,
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

  // Signed out is listed, greyed out; disabled and not-ready are not listed at all.
  assert.deepEqual(listedAgents([ready, starting, disabled, signedIn, signedOut]), [
    ready,
    signedIn,
    signedOut,
  ])
  assert.deepEqual(listedAgents([starting, disabled]), [])
  assert.equal(unavailable(signedOut), 'Signed out')
  assert.equal(usable(signedOut), false)
  // A not-ready agent is never the default, however much quota it has left.
  assert.equal(defaultAgent([starting, ready], me, (agent) => (agent.id === 'b' ? 0 : 90))?.id, 'a')
  assert.equal(usable(starting), false)
})

test('an offline computer is never the default, though its unread quota looks emptiest', () => {
  // A fresh sign-in leaves the old device record of the same computer listed, offline.
  const offline = {
    ...here,
    id: 'local_u1_old',
    status: 'active' as const,
    local: { ...here.local, deviceId: 'old', online: false },
  }
  const online = { ...here, status: 'active' as const, local: { ...here.local, online: true } }

  assert.equal(usable(offline), false)
  assert.equal(unavailable(offline), 'Offline')
  // Listed, so the picker can show it greyed out.
  assert.deepEqual(listedAgents([offline]), [offline])
  assert.equal(
    defaultAgent([offline, online], me, (agent) => (agent.id === online.id ? 40 : undefined))?.id,
    online.id,
  )
})

test('new chats pick: last used, then Claude Code here, other agents here, any other', () => {
  const claude = { ...here, provider: 'claude-code', status: 'active' as const }
  const codex = { ...hereCodex, provider: 'codex', status: 'active' as const }
  const remote = { ...studio, provider: 'claude-code', status: 'active' as const }
  const cloud = { ...managed, provider: 'claude-code', status: 'active' as const }
  const all = [cloud, remote, codex, claude]

  assert.equal(newChatAgent(all, 'rt-1', me)?.id, 'rt-1')
  assert.equal(newChatAgent(all, undefined, me)?.id, 'local_u1_mac')
  assert.equal(newChatAgent([cloud, remote, codex], undefined, me)?.id, 'local_u1_mac_codex')
  // Any other: quota decides, then list order.
  assert.equal(newChatAgent([cloud, remote], undefined, me)?.id, 'rt-1')
  // The last pick stands only while it can run: offline, disabled or gone, it is passed over.
  const disabled = { ...cloud, id: 'rt-9', status: 'disabled' as const }
  const offline = { ...remote, local: { ...remote.local, online: false } }

  assert.equal(newChatAgent([disabled, ...all], 'rt-9', me)?.id, 'local_u1_mac')
  assert.equal(newChatAgent([offline, cloud], 'local_u1_studio', me)?.id, 'rt-1')
  assert.equal(newChatAgent(all, 'deleted-id', me)?.id, 'local_u1_mac')
  assert.equal(newChatAgent([], 'rt-1', me), undefined)
})

test('the agent connected from the home composer is picked as soon as it lists', () => {
  // Before setup: nothing to run. Setup signs in Claude Code here, and this
  // computer's agent lists (first as the desktop's own pending entry).
  const connected = { ...here, provider: 'claude-code', status: 'active' as const, starting: true }
  const signedOut = { ...connected, local: { ...here.local, signedIn: false } }

  assert.equal(newChatAgent([], undefined, me), undefined)
  assert.equal(newChatAgent([signedOut], undefined, me), undefined)
  assert.equal(newChatAgent([connected], undefined, me)?.id, 'local_u1_mac')
})
