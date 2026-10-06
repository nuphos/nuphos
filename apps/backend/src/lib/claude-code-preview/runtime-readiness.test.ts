import { expect, test } from 'bun:test'

import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { withRuntimeReadiness } from './runtime-catalog'

import type { RuntimeInstance } from './runtime-instances'

useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: async (_teamId: string, _kube: unknown, provider = 'claude-code') =>
    provider === 'claude-code'
      ? [{ runtimeId: 'ready', url: 'wss://ready/acp', authKey: 'k' }]
      : [],
})

const agent = (
  id: string,
  kind: RuntimeInstance['kind'],
  status: RuntimeInstance['status'] = 'active',
) => ({ id, kind, status, provider: 'claude-code', label: id, createdAt: '' }) as RuntimeInstance

test('only an enabled registered agent without a reachable endpoint is flagged', async () => {
  const flagged = await withRuntimeReadiness('team', [
    agent('ready', 'managed'),
    agent('starting', 'managed'),
    agent('elsewhere', 'external'),
    agent('off', 'managed', 'disabled'),
    agent('local:me', 'local'),
  ])

  expect(flagged.filter((instance) => instance.notReady).map((instance) => instance.id)).toEqual([
    'starting',
    'elsewhere',
  ])
})
