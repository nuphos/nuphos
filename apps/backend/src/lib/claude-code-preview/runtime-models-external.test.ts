import { afterAll, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { RuntimeInstance } from './runtime-instances'

const instance: RuntimeInstance = {
  id: 'external-1',
  provider: 'claude-code',
  label: 'External',
  status: 'active',
  kind: 'external',
  createdAt: '2026-11-15T00:00:00.000Z',
}
const choice = (value: string) => ({ value, name: value })
const settings = (model: string) => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: [choice('fixture'), choice('other')],
  },
  {
    id: 'fast',
    name: 'Fast',
    type: 'select',
    currentValue: 'off',
    options: [choice('off'), choice('on')],
  },
]
// An OpenAB runtime that has never run a conversation: no session exists to ask.
const server = Bun.serve({
  port: 0,
  fetch: (request, bun) => (bun.upgrade(request) ? undefined : new Response(null, { status: 400 })),
  websocket: {
    message(socket, data) {
      const { id, method, params } = JSON.parse(String(data)) as {
        id: number
        method: string
        params: { model?: string }
      }
      const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }))

      if (method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: {} })
      else if (method === '_openab/agent/config_options')
        reply({ configOptions: settings(params.model ?? 'fixture') })
      else
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: 'Method not found' },
          }),
        )
    },
  },
})

afterAll(() => server.stop(true))
// The team has no conversations stored.
useDb({ db: () => portabilityDb() })
useRuntimeRegistry({
  // No operator key, so nothing answers on the control channel.
  resolveTeamRuntimeEndpoints: (_teamId, _provider, purpose) =>
    Promise.resolve(
      purpose === 'control'
        ? []
        : [
            {
              url: `ws://127.0.0.1:${String(server.port)}/acp`,
              authKey: 'key',
              runtimeId: 'external-1',
            },
          ],
    ),
})

const { discoverModels } = await import('./runtime-models')

test('an external runtime reports its models before its first conversation', async () => {
  const catalog = await discoverModels('team-a', instance)

  expect(catalog.models.map((model) => model.id)).toEqual(['fixture', 'other'])
  expect(catalog.controls).toMatchObject({
    modelId: 'fixture',
    fast: [choice('off'), choice('on')],
  })
})

test("an external runtime reports a chosen model's settings", async () => {
  const catalog = await discoverModels('team-a', instance, 'other')

  expect(catalog.controls?.modelId).toBe('other')
})
