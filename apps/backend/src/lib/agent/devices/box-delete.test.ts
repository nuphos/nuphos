import { afterEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstabox } from '@/lib/test/doubles/box-instabox'

import { deleteBox } from './box-delete'

import type { AgentDevice } from './store'

const savedFetch = globalThis.fetch
const steps: string[] = []

useBoxInstabox({
  destroyBox: () => {
    steps.push('kill')

    return Promise.resolve(true)
  },
})
const installStore = useAgentDeviceStore({
  revokeAgentDeviceCredential: () => Promise.resolve(false),
  deleteAgentDevice: () => {
    steps.push('delete row')

    return Promise.resolve(true)
  },
})

afterEach(() => {
  steps.length = 0
  globalThis.fetch = savedFetch
  delete config.box.openRouterManagementKey
})

function box(openRouterKeyHash?: string) {
  installStore({
    getAgentDevice: () =>
      Promise.resolve({
        box: {
          provider: 'instabox',
          teamId: 't1',
          ...(openRouterKeyHash ? { openRouterKeyHash } : {}),
        },
      } as AgentDevice),
  })
  config.box.openRouterManagementKey = 'mgmt'
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      steps.push(
        `${String(init?.method)} ${input instanceof Request ? input.url : input.toString()}`,
      )

      return Promise.resolve(new Response(null, { status: 200 }))
    },
    { preconnect: savedFetch.preconnect },
  )
}

test('a deleted Box takes the OpenRouter key Nuphos gave it along', async () => {
  box('h1')
  expect(await deleteBox('u1', 'd1')).toBe(true)
  expect(steps).toEqual(['kill', 'delete row', 'DELETE https://openrouter.ai/api/v1/keys/h1'])
})

test('a Box given no key revokes none', async () => {
  box()
  await deleteBox('u1', 'd1')
  expect(steps).toEqual(['kill', 'delete row'])
})
