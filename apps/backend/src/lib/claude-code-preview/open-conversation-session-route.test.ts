import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { openConversationSession } from './open-conversation-session'

import type { TeamPreviewClient, TeamRuntimeEndpoint } from './team-openab-runtime'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'

// A hosted runtime keeps its url when it joins as a device or leaves one; only the route changes.
const url = 'ws://openab-claude-pod.openab-runtimes.svc:8080/acp'
const direct: TeamRuntimeEndpoint = { url, authKey: 'key', provider: 'claude-code' }
const tunnel = (deviceId: string) => `nuphos-device://runtime/owner/${deviceId}?team=team`
const viaDevice = (deviceId: string): TeamRuntimeEndpoint => ({
  ...direct,
  tunnelUrl: tunnel(deviceId),
})
const noop = () => {}
const dialed: string[] = []
const released: string[] = []
let acquire: ReturnType<typeof spyOn>

function client(route: string): TeamPreviewClient {
  const listen = () => () => released.push(route)

  return {
    loadSession: async () => ({ alive: true }),
    onSessionUpdate: () => noop,
    onSessionPermission: () => noop,
    onClosed: listen,
    onRetired: listen,
  } as unknown as TeamPreviewClient
}

useAgentDb({
  getConversationPreviewAttachment: async () => ({ openabSessionId: 'session', runtimeUrl: url }),
  markConversationWorkLost: async () => {},
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
beforeEach(() => {
  dialed.length = 0
  released.length = 0
  acquire = spyOn(registry, 'acquire').mockImplementation(async (_team, endpoint) => {
    const route = endpoint.tunnelUrl ?? endpoint.url

    dialed.push(route)

    return client(route)
  })
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.get('team:conversation')?.stopObserving?.()
  sessionsByConversation.delete('team:conversation')
})

const open = (endpoint: TeamRuntimeEndpoint) =>
  openConversationSession('team', 'conversation', 'user', 'en-US', endpoint, [], undefined, {})

test('a conversation follows its runtime when it re-joins as another device', async () => {
  const first = await open(viaDevice('device-a'))

  expect(await open(viaDevice('device-a'))).toBe(first)
  const second = await open(viaDevice('device-b'))

  expect(second).not.toBe(first)
  expect(second.endpoint.tunnelUrl).toBe(tunnel('device-b'))
  expect(dialed).toEqual([tunnel('device-a'), tunnel('device-b')])
  // The replaced session stopped listening to its old transport.
  expect(released).toContain(tunnel('device-a'))
})

test('a conversation follows its runtime when it leaves its device', async () => {
  const joined = await open(viaDevice('device-b'))
  const detached = await open(direct)

  expect(detached).not.toBe(joined)
  expect(detached.endpoint.tunnelUrl).toBeUndefined()
  expect(dialed).toEqual([tunnel('device-b'), url])
  expect(released).toContain(tunnel('device-b'))
})
