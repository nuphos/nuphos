import { expect, test } from 'bun:test'

import { config } from '@/config'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import { useRuntimeLoginExec } from '@/lib/test/doubles/runtime-login-exec'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import type { RuntimeInstance } from './runtime-instances'

const instance: RuntimeInstance = {
  id: 'claude-1',
  provider: 'claude-code',
  label: 'Claude',
  status: 'active',
  kind: 'managed',
  createdAt: '2026-10-20T00:00:00.000Z',
}
let status: unknown = null
let execs = 0

useRuntimeLoginExec({
  execRuntimeCommand: () => {
    execs += 1

    return Promise.reject(new Error('nothing may run on a joined pod'))
  },
})
const url = `ws://openab-claude-abc.${config.claudeCodeRuntimeProvisioner.namespace}.svc:8080/acp`

useRuntimeRegistry({
  // The hosted row the old fallback would have found and exec'd into.
  runtimes: () => ({ findOne: () => Promise.resolve({ hostedBy: 'nuphos', url }) }) as never,
  resolveTeamRuntimeEndpoints: () =>
    Promise.resolve([
      {
        url,
        authKey: 'control',
        runtimeId: 'claude-1',
        tunnelUrl: 'nuphos-device://runtime/admin/pod-device?team=team-a',
      },
    ]),
})
useLocalRuntimePresence({
  runtimePresenceStore: () =>
    ({ get: () => Promise.resolve(status && { conn: 'c1', status }) }) as never,
})

const { discoverModels } = await import('./runtime-models')

test('a joined runtime with no reported models never asks its pod', async () => {
  status = null
  expect((await discoverModels('team-a', instance)).models).toEqual([])
  status = { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } }
  expect((await discoverModels('team-a', instance)).models).toEqual([])
  expect(execs).toBe(0)
})

test('a joined runtime lists the models its host reported', async () => {
  status = {
    agents: {
      'claude-code': {
        cli: { installed: true, loggedIn: true },
        models: {
          models: [{ id: 'sonnet', name: 'Sonnet' }],
          defaultModel: 'sonnet',
          controls: {},
        },
      },
    },
  }
  expect((await discoverModels('team-a', instance)).models).toEqual([
    { id: 'sonnet', name: 'Sonnet' },
  ])
  expect(execs).toBe(0)
})
