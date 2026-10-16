import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentName, agentOffline, agentRunsOn, visibleAgent } from './agentPresentation.ts'
import { boxAgents } from './boxPresentation.ts'

import type { RuntimeInstance } from '../../types/runtime.ts'

function local(id: string, deviceId: string, signedIn: boolean | null): RuntimeInstance {
  return {
    id,
    kind: 'local',
    provider: 'codex',
    label: id,
    status: 'active',
    createdAt: '',
    local: {
      deviceId,
      deviceLabel: deviceId === 'mac' ? 'MacBook Pro' : `Box ${deviceId}`,
      ownerUserId: 'owner',
      signedIn,
    },
  }
}

const teamAgent = (kind: 'managed' | 'external' | 'development'): RuntimeInstance => ({
  id: kind,
  kind,
  provider: 'codex',
  label: kind,
  status: 'active',
  createdAt: '',
})

test('Box cards and usage share signed-in local agents, retaining every team runtime', () => {
  const catalog = [
    local('box2-codex', '2', true),
    local('box2-claude', '2', false),
    local('box3-codex', '3', null),
    local('box3-claude', '3', false),
    local('mac-claude', 'mac', true),
    local('mac-codex', 'mac', true),
    teamAgent('managed'),
    { ...teamAgent('external'), status: 'disabled' as const },
    teamAgent('development'),
    { ...teamAgent('managed'), id: 'missing-local', kind: 'local' as const },
  ]
  const visible = catalog.filter(visibleAgent)
  const cards = ['2', '3', 'mac'].flatMap((device) =>
    boxAgents(device, catalog).filter(visibleAgent),
  )

  assert.deepEqual(
    cards.map((agent) => agent.id),
    ['box2-codex', 'mac-claude', 'mac-codex'],
  )
  assert.deepEqual(
    visible.filter((agent) => agent.kind === 'local'),
    cards,
  )
  assert.deepEqual(
    visible.filter((agent) => agent.kind !== 'local').map((agent) => agent.id),
    ['managed', 'external', 'development'],
  )
  assert.equal(visible.filter((agent) => agent.label.includes('box3')).length, 0)
  assert.equal(
    visible.find((agent) => agent.id === 'box2-claude'),
    undefined,
  )
  assert.equal(visible.find((agent) => agent.id === 'box2-codex')?.id, 'box2-codex')
  assert.equal(catalog.length, 10, 'presentation never removes catalog / history data')
})

test('Runs on uses the actual current device, labels remote Boxes, and handles missing identity', () => {
  const box = local('codex', '2', true)
  const mac = local('claude', 'mac', true)

  assert.ok(box.local)
  assert.equal(agentRunsOn(box, 'mac'), 'Box 2')
  assert.equal(agentRunsOn(mac, 'mac'), 'This computer')
  assert.equal(agentRunsOn(mac), 'MacBook Pro')
  assert.equal(agentRunsOn({ ...box, status: 'disabled' }, 'mac'), 'Box 2 · Disabled')
  assert.equal(agentRunsOn({ ...box, local: undefined }), 'Computer')
  assert.equal(agentRunsOn({ ...box, local: { ...box.local, deviceLabel: '' } }, 'mac'), 'Computer')
  assert.equal(agentRunsOn(teamAgent('managed'), 'mac'), 'Cloud')
  assert.equal(agentRunsOn(teamAgent('external'), 'mac'), 'Self-hosted')
  assert.equal(agentRunsOn(teamAgent('development'), 'mac'), 'Development')
})

test('a computer agent is named by its provider; team runtimes keep their own names', () => {
  const local = {
    kind: 'local',
    provider: 'claude-code',
    label: 'Claude Code in Mac',
  } as RuntimeInstance
  const managed = { kind: 'managed', provider: 'codex', label: 'Prod Codex' } as RuntimeInstance

  assert.equal(agentName(local), 'Claude Code')
  assert.equal(agentName(managed), 'Prod Codex')
})

test("an away computer's signed-in agent stays visible and reads Offline", () => {
  const away = {
    id: 'a',
    kind: 'local',
    provider: 'codex',
    status: 'active',
    label: 'Codex',
    local: {
      deviceId: 'box',
      deviceLabel: 'Box 1',
      ownerUserId: 'u',
      signedIn: true,
      online: false,
    },
  } as RuntimeInstance
  const back = { ...away, local: { ...away.local!, online: true } } as RuntimeInstance

  assert.equal(visibleAgent(away), true)
  assert.equal(agentOffline(away), true)
  assert.equal(agentRunsOn(away), 'Box 1 · Offline')
  assert.equal(agentOffline(back), false)
  assert.equal(agentRunsOn(back), 'Box 1')
})

test("a computer's agent goes by the name given to it, else its provider's", () => {
  const agent = local('a', 'mac', true)

  assert.equal(agentName(agent), 'Codex')
  assert.equal(agentName({ ...agent, local: { ...agent.local!, agentLabel: 'Review' } }), 'Review')
})
