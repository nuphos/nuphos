import { expect, test } from 'bun:test'

import { decideToolApproval } from './tool-approval-decide'

import type { PreviewWait } from './decision-waiter'

const wait: PreviewWait = {
  waitId: 'wait-1',
  userId: 'owner',
  sessionId: 'bot',
  kind: 'agent-permission',
  ref: 'tool-1',
} as PreviewWait

function deps(found: PreviewWait | null, resolved = true) {
  const answers: unknown[] = []

  return {
    answers,
    deps: {
      findWait: async () => found,
      resolve: async (args: unknown) => {
        answers.push(args)

        return resolved
      },
    } as unknown as Parameters<typeof decideToolApproval>[1],
  }
}

const ask = (decision: 'allow' | 'reject', userId = 'owner', sessionId = 'bot') => ({
  userId,
  sessionId,
  toolCallId: 'tool-1',
  decision,
})

test('the person a request waits for allows or rejects it', async () => {
  for (const [decision, payload] of [
    ['allow', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    const { answers, deps: d } = deps(wait)

    expect(await decideToolApproval(ask(decision), d)).toBe('decided')
    expect(answers).toEqual([
      { userId: 'owner', sessionId: 'bot', waitId: 'wait-1', payload: { decision: payload } },
    ])
  }
})

test('someone else cannot answer it', async () => {
  const { answers, deps: d } = deps(wait)

  expect(await decideToolApproval(ask('allow', 'teammate'), d)).toBe('forbidden')
  expect(answers).toEqual([])
})

test('a request that is gone, belongs to another conversation or was just decided has expired', async () => {
  expect(await decideToolApproval(ask('allow'), deps(null).deps)).toBe('expired')
  expect(await decideToolApproval(ask('allow', 'owner', 'other'), deps(wait).deps)).toBe('expired')
  expect(await decideToolApproval(ask('allow'), deps(wait, false).deps)).toBe('expired')
})
