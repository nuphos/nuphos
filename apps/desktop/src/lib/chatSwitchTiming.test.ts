import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const sent: { event: string; props: Record<string, unknown> }[] = []

// Runs layout effects and frames at once; analytics records what would be sent.
mock.module('react', { namedExports: { useLayoutEffect: (effect: () => void) => effect() } })
mock.module('./analytics.ts', {
  namedExports: {
    track: (event: string, props: Record<string, unknown>) => sent.push({ event, props }),
  },
})
Object.assign(globalThis, { requestAnimationFrame: (run: () => void) => run() })
const { startChatSwitch } = await import('./chatSwitch.ts')
const { useChatSwitchShown } = await import('./chatSwitchTiming.ts')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a chat shown in the click’s own task is reported as cached, once', () => {
  sent.length = 0
  startChatSwitch('a', 'selectSession')
  useChatSwitchShown('a', 'bot', true)
  useChatSwitchShown('a', 'bot', true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.event, 'chat_switch')
  assert.deepEqual(
    { ...sent[0]?.props, ms: 0 },
    { kind: 'bot', cached: true, source: 'selectSession', ms: 0 },
  )
})

test('a chat shown only after its messages were fetched is not cached', async () => {
  sent.length = 0
  startChatSwitch('b', 'goToSurface')
  useChatSwitchShown('b', 'task', false)
  await tick()
  useChatSwitchShown('a', 'task', true)
  useChatSwitchShown('b', 'task', true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.props.kind, 'task')
  assert.equal(sent[0]?.props.cached, false)
})
