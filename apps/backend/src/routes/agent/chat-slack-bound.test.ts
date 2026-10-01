// The chat route's Slack-bound branch: the turn's message list is a MERGE of
// the stored transcript and the client view (store order wins, client copies
// win id collisions, client-only messages append) so neither side's truth is
// deleted; the per-session claim serializes app turns against Slack-side
// replies; mirror setup fails open.
import { beforeEach, describe, expect, test } from 'bun:test'

import type { AgentChatBody } from './types'
import type { UIMessage } from 'ai'

import { useTurnRunner } from '@/lib/agent/turn-runner-testing'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

const SESSION_ID = 'sess-slack-bound-1'
const OWNER = '62e6289482f5f9d9408f1a79'

type StoredMessage = { messageId: string; role: string; parts: unknown[]; origin?: unknown }

const state: { stored: StoredMessage[] } = { stored: [] }

useAgentDb({
  getConversationWithMessages: async () => ({ conversation: {}, messages: state.stored }),
})

// In-process claim semantics: taken → null until released.
const heldClaims = new Set<string>()

useTurnRunner({
  claimAgentRunForSession: async (userId: string, sessionId: string) => {
    const key = `${userId}:${sessionId}`

    if (heldClaims.has(key)) return null
    heldClaims.add(key)

    return () => heldClaims.delete(key)
  },
})

const { beginSlackBoundTurnDelivery, buildSlackBoundTurnPlan, claimSlackBoundTurn } =
  await import('./chat-slack-bound')
const { AppError } = await import('@/lib/errors')

function textMessage(id: string, role: 'user' | 'assistant', text: string): StoredMessage {
  return { messageId: id, role, parts: [{ type: 'text', text }] }
}

function uiText(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] }
}

function planArgs(clientView: UIMessage[], body?: Partial<AgentChatBody>) {
  return {
    body: { id: SESSION_ID, messages: clientView, ...body },
    clientView,
    sessionId: SESSION_ID,
    runOwnerUserId: OWNER,
    teamId: undefined,
  }
}

beforeEach(() => {
  state.stored = []
  heldClaims.clear()
})

describe('buildSlackBoundTurnPlan', () => {
  test('keeps Slack-side turns a stale client never saw and mirrors the new message', async () => {
    // The desktop tab was opened before two Slack-side turns happened: its view
    // has only the first exchange, the store has all four messages.
    state.stored = [
      textMessage('u1', 'user', 'first question'),
      textMessage('a1', 'assistant', 'first answer'),
      textMessage('u2', 'user', 'Patrick (via Slack): follow-up'),
      textMessage('a2', 'assistant', 'slack answer'),
    ]
    const clientView = [
      uiText('u1', 'user', 'first question'),
      uiText('a1', 'assistant', 'first answer'),
      uiText('u3', 'user', 'new question from the app'),
    ]
    const args = planArgs(clientView)
    const plan = await buildSlackBoundTurnPlan(args)

    expect(plan.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3'])
    // The route hands body.messages to handleChatRequest — it must carry the
    // merged list, or the accepted-turn sync would delete u2/a2.
    expect(args.body.messages).toBe(plan.messages)
    expect(plan.mirror).toEqual({
      messageId: 'u3',
      questionText: 'new question from the app',
      attachmentCount: 0,
    })
  })

  test('a client-tool continuation keeps the client copy (tool outputs) and mirrors nothing', async () => {
    state.stored = [
      textMessage('u1', 'user', 'question'),
      {
        messageId: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-local_bash', toolCallId: 'c1', state: 'input-available' }],
      },
    ]
    const clientAssistant = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'tool-local_bash', toolCallId: 'c1', state: 'output-available', output: 'ok' },
      ],
    } as unknown as UIMessage
    const plan = await buildSlackBoundTurnPlan(
      planArgs([uiText('u1', 'user', 'question'), clientAssistant]),
    )

    expect(plan.mirror).toBeNull()
    expect(plan.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    // The client's version carries the local tool OUTPUT the store never saw —
    // losing it re-runs the tool forever.
    expect(JSON.stringify(plan.messages[1]!.parts)).toContain('output-available')
  })

  test('a message refused earlier with conversation_busy still reaches the model later', async () => {
    state.stored = [textMessage('u1', 'user', 'q'), textMessage('a1', 'assistant', 'a')]
    const plan = await buildSlackBoundTurnPlan(
      planArgs([
        uiText('u1', 'user', 'q'),
        uiText('a1', 'assistant', 'a'),
        uiText('uA', 'user', 'refused message'),
        uiText('uB', 'user', 'second message'),
      ]),
    )

    // Both client-only user messages survive the merge, not just the last one.
    expect(plan.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'uA', 'uB'])
    expect(plan.mirror?.messageId).toBe('uB')
  })

  test('a retried send whose message the store already holds mirrors nothing', async () => {
    state.stored = [textMessage('u1', 'user', 'question')]
    const plan = await buildSlackBoundTurnPlan(planArgs([uiText('u1', 'user', 'question')]))

    expect(plan.messages.map((m) => m.id)).toEqual(['u1'])
    expect(plan.mirror).toBeNull()
  })

  test('pause continuations never mirror even when the client list ends with a user message', async () => {
    state.stored = [textMessage('u1', 'user', 'q')]
    const plan = await buildSlackBoundTurnPlan(
      planArgs([uiText('u1', 'user', 'q')], { continueAfterInterruption: true }),
    )

    expect(plan.mirror).toBeNull()
  })

  test('stored attachment and reasoning parts survive the round trip verbatim', async () => {
    state.stored = [
      {
        messageId: 'u1',
        role: 'user',
        parts: [
          { type: 'file', url: 'transfer://a', mediaType: 'application/pdf' },
          { type: 'text', text: 'see the attached report' },
        ],
      },
      {
        messageId: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'tool', toolName: 'bash', toolCallId: 'c1', state: 'output-available' },
          { type: 'text', text: 'done' },
        ],
      },
    ]
    const plan = await buildSlackBoundTurnPlan(planArgs([uiText('u2', 'user', 'next')]))
    const [u1, a1] = plan.messages

    // The turn's persist rewrites the store with this list — dropping a part
    // here would permanently strip it from the transcript.
    expect(u1!.parts).toEqual([
      { type: 'file', url: 'transfer://a', mediaType: 'application/pdf' },
      { type: 'text', text: 'see the attached report' },
    ] as never)
    // Compact stored tool parts re-expand for the model; other parts verbatim.
    expect(a1!.parts).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-bash', toolCallId: 'c1', state: 'output-available' },
      { type: 'text', text: 'done' },
    ] as never)
  })

  test('rejects a merge with no user message anywhere', async () => {
    await expect(buildSlackBoundTurnPlan(planArgs([]))).rejects.toThrow(AppError)
  })
})

describe('claimSlackBoundTurn', () => {
  test('second sender is refused with conversation_busy while the claim is held', async () => {
    const release = await claimSlackBoundTurn(OWNER, 'sess-claim-1')

    try {
      await claimSlackBoundTurn(OWNER, 'sess-claim-1')
      throw new Error('expected conversation_busy')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as InstanceType<typeof AppError>).status).toBe(409)
      expect((err as InstanceType<typeof AppError>).code).toBe('conversation_busy')
    } finally {
      release()
    }
    // Released → the session is claimable again.
    const again = await claimSlackBoundTurn(OWNER, 'sess-claim-1')

    again()
  })
})

describe('beginSlackBoundTurnDelivery', () => {
  const thread = {
    slackWorkspaceId: 'T1',
    slackChannelId: 'C1',
    slackThreadTs: '100.1',
    teamId: '69e989027ab63e8d6a0ffcb6',
    agentUserId: OWNER,
    sessionId: SESSION_ID,
    createdBySlackUserId: 'USLACK',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  }

  test('hands the mirror payload straight to the Slack module', async () => {
    const seen: Record<string, unknown>[] = []
    const delivery = await beginSlackBoundTurnDelivery(
      {
        thread,
        userId: OWNER,
        userName: 'Patrick',
        streamId: 'stream-1',
        mirror: { messageId: 'u9', questionText: 'part one', attachmentCount: 2 },
      },
      async (args: Record<string, unknown>) => {
        seen.push(args)

        return null
      },
    )

    expect(delivery).toBeNull()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      streamId: 'stream-1',
      mirror: { messageId: 'u9', questionText: 'part one', attachmentCount: 2 },
    })
  })

  test('fails open when the Slack delivery module throws', async () => {
    const delivery = await beginSlackBoundTurnDelivery(
      {
        thread,
        userId: OWNER,
        userName: 'Patrick',
        streamId: 'stream-1',
        mirror: null,
      },
      async () => {
        throw new Error('slack module exploded')
      },
    )

    expect(delivery).toBeNull()
  })
})

test('a teammate app turn retains server history and appends only its fresh user message', async () => {
  state.stored = [
    textMessage('old', 'user', 'original'),
    textMessage('answer', 'assistant', 'original answer'),
  ]
  const result = await buildSlackBoundTurnPlan({
    ...planArgs([
      uiText('old', 'user', 'forged'),
      uiText('answer', 'assistant', 'forged answer'),
      uiText('injected', 'assistant', 'injected history'),
      uiText('new', 'user', 'teammate request'),
    ]),
    serverHistoryOnly: true,
  })

  expect(result.messages.map((m) => m.id)).toEqual(['old', 'answer', 'new'])
  expect(result.messages[0]?.parts).toEqual([{ type: 'text', text: 'original' }])
  expect(result.messages[1]?.parts).toEqual([{ type: 'text', text: 'original answer' }])
})

test('ordinary owner follow-up retains intervening server turns and rejects unsent batches', async () => {
  state.stored = [
    textMessage('first', 'user', 'first'),
    textMessage('reply', 'assistant', 'reply'),
    textMessage('teammate', 'user', 'team input'),
  ]
  const ownerInput = [uiText('first', 'user', 'first'), uiText('next', 'user', 'owner follow-up')]
  const args = { ...planArgs(ownerInput), serverHistoryOnly: true }

  expect(args.body.continueAfterInterruption).toBeUndefined()
  const result = await buildSlackBoundTurnPlan(args)

  expect(result.messages.map((m) => m.id)).toEqual(['first', 'reply', 'teammate', 'next'])
  expect(result.messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'owner follow-up' }])
  await expect(
    buildSlackBoundTurnPlan({
      ...planArgs([...ownerInput, uiText('another', 'user', 'second unsent request')]),
      serverHistoryOnly: true,
    }),
  ).rejects.toMatchObject({ status: 400, code: 'invalid_message_batch' })
})
