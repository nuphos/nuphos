import { expect, mock, test } from 'bun:test'

let moveCalls = 0
let checks = 0
let notice: string | undefined
const slots: unknown[] = []
let cursor = 0
const runtime = {
  id: 'next',
  label: 'Next runtime',
  provider: 'codex',
  kind: 'local',
  status: 'active',
}
const managed = { ...runtime, id: 'managed', kind: 'managed' }

mock.module('react', () => ({
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => {
    const i = cursor++

    slots[i] ??= { current: value }

    return slots[i]
  },
  useState: (value: unknown) => {
    const i = cursor++

    if (!(i in slots)) slots[i] = value

    return [
      slots[i],
      (next: unknown) => {
        slots[i] = next
      },
    ]
  },
}))
mock.module('../../../api', () => ({
  api: {
    agentMoveConversationRuntime: async () => {
      moveCalls++

      return { runtimeId: 'next', runtimeLabel: 'Next runtime', agentRuntime: 'codex' }
    },
    agentGetConversation: async () => ({}),
    agentCheckConversationMove: async () => {
      checks++

      return {}
    },
  },
}))
mock.module('../../../api/errors', () => ({ decideErrorToast: () => ({ action: 'show' }) }))
mock.module('../../../i18n/index.ts', () => ({ t: (text: string) => text }))
mock.module('../../../lib/localAgentSharing', () => ({
  localAgentMoveWarning: () => {},
  moveNotice: () => notice,
}))
mock.module('../../ui/toast', () => ({ toast: { error: () => {}, apiError: () => {} } }))

const { useSessionRuntimeControl } = await import('./conversationRuntimeControl')
const patches: unknown[] = []
const base = {
  teamId: 'team',
  currentUser: { id: 'owner' },
  isTeamAdmin: false,
  runtimeInstances: [runtime, managed],
  runtimeInstancesLoading: false,
  runtimeInstancesError: null,
  runtimeQuotas: new Map(),
  refreshHistory: async () => {},
  update: (patch: unknown) => patches.push(patch),
  activeTab: {
    id: 'bot-task',
    sessionId: 'bot-task',
    runtimeId: 'old',
    agentRuntime: 'codex',
    foreign: false,
  },
}

function render(overrides = {}) {
  cursor = 0

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Minimal hook harness preserves state between renders.
  return useSessionRuntimeControl({ ...base, ...overrides } as never)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('Bot and Task runtime controls preserve access, confirmation, and move deduplication', async () => {
  globalThis.window = new EventTarget() as never
  expect(render({ activeTab: null })).toBeUndefined()
  expect(render({ activeTab: { ...base.activeTab, readOnly: true } })).toBeUndefined()
  expect(render({ activeTab: { ...base.activeTab, streaming: true } })?.selectDisabled).toBe(true)
  expect(
    render({ activeTab: { ...base.activeTab, foreign: true, canManage: false } })?.onSelect,
  ).toBeUndefined()
  expect(
    render({ activeTab: { ...base.activeTab, foreign: true, canManage: true } })?.options?.map(
      (r) => r.id,
    ),
  ).toEqual(['managed'])

  notice = 'This moves the task to another computer'
  render()?.onSelect?.('next')
  await settle()
  expect(checks).toBe(1)
  expect(moveCalls).toBe(0)
  const confirmation = render()?.confirm

  expect(confirmation?.description).toBe(notice)
  confirmation?.onConfirm()
  confirmation?.onConfirm()
  await settle()
  expect(moveCalls).toBe(1)
  expect(patches).toContainEqual(
    expect.objectContaining({ runtimeId: 'next', agentRuntime: 'codex' }),
  )
})
