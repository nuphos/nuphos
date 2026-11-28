import { afterAll, expect, spyOn, test } from 'bun:test'

import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'

import { controlRegistry } from './agent-chat-registry'
import { OpenAbConnectError } from './openab-acp-connect'
import { OpenAbConnectionLostError } from './openab-acp-errors'
import { probeRuntimeQuota } from './runtime-quota-probe'

import type { OpenAbAcpClient } from './openab-acp-client'
import type { RuntimeInstance } from './runtime-instances'

useRuntimeRegistry({
  resolveTeamRuntimeEndpoints: () =>
    Promise.resolve([{ runtimeId: 'agent', url: 'ws://127.0.0.1:1/acp', authKey: 'k' }]),
})
const runtimeJobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])
const acquire = spyOn(controlRegistry, 'acquire')

// The registry is shared by every test file in the process.
afterAll(() => {
  runtimeJobs.mockRestore()
  acquire.mockRestore()
})
const agent = { id: 'agent', provider: 'claude-code' } as RuntimeInstance
const hangUp = () => Promise.reject(new OpenAbConnectionLostError('Connection ended'))

// #4394: an e2e scenario that restarts the host met a probe in flight, which was logged as an error.
test('a host that hangs up mid-probe, as while it restarts, reads as offline', async () => {
  acquire.mockResolvedValue({ runJob: hangUp } as unknown as OpenAbAcpClient)

  expect(await probeRuntimeQuota('team', agent)).toEqual({
    error: 'Agent is offline',
    offline: true,
  })
})

test('a host that does not take the connection reads as offline', async () => {
  acquire.mockRejectedValue(new OpenAbConnectError('refused'))

  expect(await probeRuntimeQuota('team', agent)).toEqual({
    error: 'Agent is offline',
    offline: true,
  })
})

test('any other failure is still thrown', async () => {
  acquire.mockRejectedValue(new Error('boom'))

  await expect(probeRuntimeQuota('team', agent)).rejects.toThrow('boom')
})
