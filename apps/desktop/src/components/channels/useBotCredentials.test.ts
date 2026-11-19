import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { AgentCredentialSelection } from '../../api'

const saved: { sessionId: string; teamId?: string; credentialAccess: AgentCredentialSelection }[] =
  []
let refreshes = 0
let options: unknown = {}
let conversation: unknown = { credentialAccess: {} }
const slots: unknown[] = []
let cursor = 0

mock.module('../../api.ts', {
  namedExports: {
    api: {
      agentGetCredentialOptions: async () => options,
      agentGetConversation: async () => conversation,
      agentUpdateConversationCredentials: async (args: (typeof saved)[number]) => {
        saved.push(args)

        return { options: {}, credentialAccess: args.credentialAccess }
      },
    },
  },
})
mock.module('../../lib/inputRequestRefresh.ts', {
  namedExports: {
    refreshInputRequests: () => {
      refreshes += 1
    },
  },
})
// Nothing is listed or kept from an earlier chat: the hook starts empty and loads.
mock.module('../../lib/query/client.ts', {
  namedExports: { queryClient: { getQueryData: () => undefined, setQueryData: () => {} } },
})
mock.module('../ui/toast.ts', { namedExports: { toast: { apiError: () => {} } } })
mock.module('../../i18n/index.ts', { namedExports: { t: (text: string) => text } })
mock.module('react', {
  namedExports: {
    useState: (initial: unknown) => {
      const index = cursor++

      if (!(index in slots)) slots[index] = initial

      return [
        slots[index],
        (next: unknown) => {
          slots[index] =
            typeof next === 'function' ? (next as (v: unknown) => unknown)(slots[index]) : next
        },
      ]
    },
    useRef: (initial: unknown) => {
      const index = cursor++

      slots[index] ??= { current: initial }

      return slots[index]
    },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void) => {
      effect()
    },
  },
})

const { useBotCredentials } = await import('./useBotCredentials.ts')
const { emptyCredentialAccess } = await import('../agent/panel/credentialAccess.ts')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function render(botId = 'asking-session') {
  cursor = 0

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness drives the hook's lifecycle.
  return useBotCredentials('team', botId)
}

test("choosing a credential saves the asking conversation's selection and reloads its questions", async () => {
  render()
  await settle()
  const control = render()

  assert.ok(control)
  const next = { ...emptyCredentialAccess(), personalCredentialIds: ['github' as const] }

  control.onChange(next)
  await settle()
  assert.deepEqual(
    saved.map(({ sessionId, teamId }) => ({ sessionId, teamId })),
    [{ sessionId: 'asking-session', teamId: 'team' }],
  )
  assert.deepEqual(saved[0]?.credentialAccess.personalCredentialIds, ['github'])
  // The server answers the question this selection satisfies; the card leaves on that reload.
  assert.equal(refreshes, 1)
})

// #3259: a Bot made with "+" stored nothing, and its picker showed every computer
// selected while the Bot ran with none.
test('a Bot with nothing stored shows no computers selected, and is asked to choose', async () => {
  options = {
    devices: [{ deviceId: 'mac-mini', label: 'Mac mini', platform: 'darwin', available: true }],
  }
  conversation = { credentialAccess: null }
  render('bot-with-nothing-stored')
  await settle()
  const control = render('bot-with-nothing-stored')

  assert.deepEqual(control?.value.deviceIds, [])
  assert.equal(control?.unset, true)
})
