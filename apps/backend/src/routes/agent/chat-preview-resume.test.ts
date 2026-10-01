import { beforeEach, describe, expect, test } from 'bun:test'

import type { AgentChatBody } from './types'

import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

useRedis({ redisEnabled: () => false, withRedis: async () => null })

const { awaitPreviewDecision, registerPreviewWait, resetLocalPreviewWaits } =
  await import('@/lib/claude-code-preview/decision-waiter')
const { resolvePreviewWaitFromChat } = await import('./chat-preview-resume')

function body(messages: AgentChatBody['messages'], extra: Partial<AgentChatBody> = {}) {
  return { id: 'conv-1', messages, ...extra }
}

beforeEach(() => resetLocalPreviewWaits())

describe('resolvePreviewWaitFromChat', () => {
  test('returns null when nothing is parked', async () => {
    expect(
      await resolvePreviewWaitFromChat({
        userId: 'u1',
        sessionId: 'conv-1',
        streamId: 'st-1',
        body: body([]),
      }),
    ).toBeNull()
  })

  test('a named client-tool continuation hands the tool output and new stream to the waiter', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'client-tool',
      ref: 'local_exec',
    })
    const resolved = await resolvePreviewWaitFromChat({
      userId: 'u1',
      sessionId: 'conv-1',
      streamId: 'st-2',
      body: body(
        [
          { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'list my files' }] },
          {
            id: 'm2',
            role: 'assistant',
            parts: [
              {
                type: 'tool-local_exec',
                toolCallId: wait.waitId,
                toolName: 'local_exec',
                state: 'output-available',
                output: { stdout: 'a\nb' },
              } as never,
            ],
          },
        ],
        { resumeReason: 'client-tool' },
      ),
    })

    expect(resolved?.waitId).toBe(wait.waitId)
    expect(
      await awaitPreviewDecision({ userId: 'u1', sessionId: 'conv-1', waitId: wait.waitId }),
    ).toMatchObject({
      decision: {
        streamId: 'st-2',
        payload: { resumeReason: 'client-tool', output: { stdout: 'a\nb' } },
      },
    })
  })

  test('a dynamic client-tool continuation hands its output to the matching waiter', async () => {
    const older = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'client-tool',
      ref: 'older_tool',
    })

    await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'client-tool',
      ref: 'newer_tool',
    })

    const resolved = await resolvePreviewWaitFromChat({
      userId: 'u1',
      sessionId: 'conv-1',
      streamId: 'st-dynamic',
      body: body(
        [
          {
            id: 'm2',
            role: 'assistant',
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: older.waitId,
                toolName: 'older_tool',
                state: 'output-available',
                output: { ok: true },
              } as never,
            ],
          },
        ],
        { resumeReason: 'client-tool' },
      ),
    })

    expect(resolved?.waitId).toBe(older.waitId)
    expect(
      await awaitPreviewDecision({ userId: 'u1', sessionId: 'conv-1', waitId: older.waitId }),
    ).toMatchObject({ decision: { payload: { output: { ok: true } } } })
  })

  test('an approval-responded card resolves to approved/rejected', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'permission-grant',
    })

    await resolvePreviewWaitFromChat({
      userId: 'u1',
      sessionId: 'conv-1',
      streamId: 'st-3',
      body: body(
        [
          {
            id: 'm2',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolCallId: wait.waitId,
                toolName: 'plan_create',
                state: 'approval-responded',
                approval: { approved: false },
              } as never,
            ],
          },
        ],
        { resumeReason: 'approval-decision' },
      ),
    })
    expect(
      await awaitPreviewDecision({ userId: 'u1', sessionId: 'conv-1', waitId: wait.waitId }),
    ).toMatchObject({ decision: { payload: { decision: 'rejected' } } })
  })

  test('an OpenAB approval card resumes the parked provider request', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'agent-permission',
      ref: 'tool-dangerous',
    })

    await resolvePreviewWaitFromChat({
      userId: 'u1',
      sessionId: 'conv-1',
      streamId: 'st-openab',
      body: body(
        [
          {
            id: 'm2',
            role: 'assistant',
            parts: [
              {
                type: 'tool',
                toolCallId: 'tool-dangerous',
                toolName: 'Patch MongoDBCommunity',
                state: 'approval-responded',
                approval: { id: `openab:${wait.waitId}`, approved: true, source: 'openab' },
              } as never,
            ],
          },
        ],
        { resumeReason: 'approval-decision' },
      ),
    })

    expect(
      await awaitPreviewDecision({ userId: 'u1', sessionId: 'conv-1', waitId: wait.waitId }),
    ).toMatchObject({
      decision: {
        payload: { decision: 'approved', resumeReason: 'approval-decision' },
        streamId: 'st-openab',
      },
    })
  })

  test('a plain user reply resolves the newest wait with its text', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'authorization-rule',
    })

    await resolvePreviewWaitFromChat({
      userId: 'u1',
      sessionId: 'conv-1',
      streamId: 'st-4',
      body: body([{ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'ap-south 就好' }] }]),
    })
    expect(
      await awaitPreviewDecision({ userId: 'u1', sessionId: 'conv-1', waitId: wait.waitId }),
    ).toMatchObject({ decision: { payload: { userMessage: 'ap-south 就好' }, streamId: 'st-4' } })
  })
})

useFakeRuntimeRequests()
