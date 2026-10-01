import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { decideEndOfStream as Decide, emptyEndDecision as Empty } from './endEventDecision.ts'
import type { Tab } from './model'

let decide: typeof Decide
let empty: typeof Empty

before(async () => {
  mock.module('./clientTools.ts', { namedExports: { findPendingClientSideLocalTools: () => [] } })
  mock.module('./streamText.ts', { namedExports: { foldTextDeltaIntoTab: (tab: Tab) => tab } })
  const module = await import('./endEventDecision.ts')

  decide = module.decideEndOfStream
  empty = module.emptyEndDecision
})

function run(overrides: Record<string, unknown> = {}, tabOverrides: Partial<Tab> = {}) {
  const decision = empty()
  const tab = {
    id: 'tab',
    sessionId: 'session',
    title: 'Review',
    streamId: 'stream',
    messages: [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'All done.' }] }],
    runtimeState: { schemaVersion: 2, state: 'idle' },
    ...tabOverrides,
  } as Tab

  decide(
    {} as Parameters<typeof Decide>[0],
    {
      streamId: 'stream',
      pendingText: '',
      sawTurnComplete: false,
      sawTurnPaused: undefined,
      ...overrides,
      decision,
    },
    [tab],
  )

  return decision.stopNotification
}

test('confirmed runtime turn completion produces a native notification', () => {
  assert.deepEqual(run({ sawTurnComplete: true }), {
    title: 'Nuphos',
    body: 'Agent finished. Open Nuphos to view the response.',
    sessionId: 'session',
  })
})
test('a failure notifies, while transport EOF and explicit user stop stay silent', () => {
  assert.equal(
    run({}, { error: 'Provider failed: secret-token' })?.body,
    'Agent stopped before finishing. Open Nuphos for details.',
  )
  assert.equal(run(), null)
  assert.equal(run({ sawTurnComplete: true, stopRequested: true }), null)
  assert.equal(run({ sawTurnPaused: { reason: 'shutdown' } }), null)
})
test('approval completion tells the user what it is waiting for', () => {
  const notification = run(
    { sawTurnComplete: true },
    {
      messages: [
        {
          id: 'a',
          role: 'assistant',
          parts: [{ type: 'tool', toolName: 'delete_file', state: 'approval-requested' }],
        },
      ] as Tab['messages'],
    },
  )

  assert.deepEqual(notification, {
    title: 'Nuphos',
    body: 'Agent needs your approval.',
    sessionId: 'session',
  })
})
