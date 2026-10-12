import { describe, expect, test } from 'bun:test'

import { approveAppForComputerUse } from './local-cua-approval'

import type { AppApprovalDeps } from './local-cua-approval'
import type { PreviewToolContext } from '../preview-tool-context'

const ctx: PreviewToolContext = { userId: 'u1', teamId: 't1', sessionId: 's1', locale: 'en' }
const request = {
  message: 'Allow Computer Use to use "Finder"?',
  meta: { tool_params: { app: 'finder' } },
}

function harness(overrides: Partial<AppApprovalDeps>) {
  const frames: Record<string, unknown>[] = []
  const waits: Record<string, unknown>[] = []
  const deps: AppApprovalDeps = {
    bypass: () => Promise.resolve(false),
    publish: (_ctx, frame) => {
      frames.push(frame)

      return Promise.resolve()
    },
    register: (wait) => {
      waits.push(wait)

      return Promise.resolve({ ...wait, waitId: wait.waitId ?? 'w', createdAt: 0 })
    },
    await: () => Promise.reject(new Error('unexpected wait')),
    timeoutMs: 1_000,
    ...overrides,
  }

  return { deps, frames, waits }
}

const decided = (decision: string) => () =>
  Promise.resolve({
    status: 'decided' as const,
    decision: { payload: { decision }, resolvedAt: 0 },
  })

describe('approveAppForComputerUse', () => {
  test('parks the turn on its own card and returns the answer', async () => {
    const { deps, frames, waits } = harness({ await: decided('approved') })

    expect(await approveAppForComputerUse(ctx, request, deps)).toBe(true)
    const card = frames[0]?.toolCallId

    expect(waits).toEqual([
      { userId: 'u1', sessionId: 's1', waitId: card, kind: 'authorization-rule' },
    ])
    expect(frames.map((frame) => frame.type)).toEqual([
      'tool-input-available',
      'tool-approval-request',
      'tool-output-available',
    ])
    expect(frames[0]).toMatchObject({ input: { approval: request.message } })
    expect(frames[1]).toMatchObject({ toolCallId: card, approvalId: card })
  })

  test('a rejection or an unanswered card is not an approval', async () => {
    const rejected = harness({ await: decided('rejected') })

    expect(await approveAppForComputerUse(ctx, request, rejected.deps)).toBe(false)
    expect(rejected.frames.at(-1)).toMatchObject({ type: 'tool-output-error' })
    const unanswered = harness({
      await: () =>
        Promise.resolve({ status: 'unanswered' as const, payload: {}, cardText: 'timed out' }),
    })

    expect(await approveAppForComputerUse(ctx, request, unanswered.deps)).toBe(false)
  })

  test('Full Access approves without a wait but leaves the decision in the transcript', async () => {
    const { deps, frames, waits } = harness({ bypass: () => Promise.resolve(true) })

    expect(await approveAppForComputerUse(ctx, request, deps)).toBe(true)
    expect(waits).toEqual([])
    expect(frames[1]).toMatchObject({
      type: 'authorization-decision',
      decision: 'allow',
      layer: 'bypass',
    })
  })
})
