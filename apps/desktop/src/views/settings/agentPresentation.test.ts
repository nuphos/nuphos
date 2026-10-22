import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentName, agentOffline, agentRunsOn, localRemovalId } from './agentPresentation.ts'
import { boxAgents } from './boxPresentation.ts'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime.ts'

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

test('Box cards keep signed-out agents, so they can sign in again and update', () => {
  const catalog = [
    local('box2-codex', '2', true),
    local('box2-claude', '2', false),
    local('box3-codex', '3', null),
    local('mac-claude', 'mac', true),
    teamAgent('managed'),
  ]

  assert.deepEqual(
    ['2', '3', 'mac'].flatMap((device) => boxAgents(device, catalog)).map((agent) => agent.id),
    ['box2-codex', 'box2-claude', 'box3-codex', 'mac-claude'],
  )
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

  assert.equal(agentOffline(away), true)
  assert.equal(agentRunsOn(away), 'Box 1 · Offline')
  assert.equal(agentOffline(back), false)
  assert.equal(agentRunsOn(back), 'Box 1')
})

test('a self-hosted agent reads offline only when its Usage reading could not reach it', () => {
  const selfHosted = {
    id: 'r',
    kind: 'external',
    provider: 'claude-code',
    status: 'active',
    label: 'localhost',
  } as RuntimeInstance
  const quota = (offline: boolean) =>
    ({
      runtimeId: 'r',
      available: false,
      windows: [],
      ...(offline ? { offline: true } : {}),
    }) as RuntimeQuota

  assert.equal(agentOffline(selfHosted, quota(true)), true)
  assert.equal(agentRunsOn(selfHosted, undefined, quota(true)), 'Self-hosted · Offline')
  assert.equal(agentOffline(selfHosted, quota(false)), false, 'no usage is not offline')
  // Picking it for a conversation follows readiness, not the dot.
  assert.equal(agentOffline({ ...selfHosted, notReady: true }), false)
})

test("a Box's default agent can be removed; a person's computer's default cannot", () => {
  const computer = local('mac-codex', 'mac', true)
  const box = { ...computer, local: { ...computer.local!, box: { state: 'running' } } }

  assert.equal(localRemovalId(computer), undefined)
  assert.equal(localRemovalId(box as RuntimeInstance), 'codex')
  assert.equal(
    localRemovalId({ ...computer, local: { ...computer.local!, instanceId: 'id-1' } }),
    'id-1',
  )
  assert.equal(localRemovalId({ ...computer, kind: 'managed', local: undefined }), undefined)
})

test("a computer's agent goes by the name given to it, else its provider's", () => {
  const agent = local('a', 'mac', true)

  assert.equal(agentName(agent), 'Codex')
  assert.equal(agentName({ ...agent, local: { ...agent.local!, agentLabel: 'Review' } }), 'Review')
})
