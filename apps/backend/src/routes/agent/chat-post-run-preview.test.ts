// The preview fork of an accepted /agent/chat turn on a Slack-bound
// conversation: the Slack mirror sink is attached before the runtime streams,
// sees every frame, and the claim release + finalize run exactly as for the
// model loop.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { SlackBoundTurnDelivery } from './chat-slack-bound'
import type { InternalChatCtx } from './types'
import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { UIMessage } from 'ai'

import { useAgentTranscript } from '@/lib/test/doubles/agent-transcript'
import { useChatPreviewTurn } from '@/lib/test/doubles/chat-preview-turn'
import { useChatSlackBound } from '@/lib/test/doubles/chat-slack-bound'

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }

const seen = {
  sinkFrames: [] as string[],
  finalize: [] as unknown[],
  previewArgs: [] as Record<string, unknown>[],
  released: 0,
  persistedOwners: [] as string[],
}

const installTranscript = useAgentTranscript({
  persistAcceptedConversationTurn: (args) => {
    seen.persistedOwners.push(args.userId)

    return Promise.resolve({ isNew: false })
  },
})

useChatSlackBound({
  beginSlackBoundTurnDelivery: (args) => {
    const frameSink = {
      frame: (raw: string) => {
        seen.sinkFrames.push(raw)
      },
      done: () => {},
    }

    args.attach?.(frameSink as never)

    return Promise.resolve({
      frameSink,
      finalize: (outcome: unknown) => {
        seen.finalize.push(outcome)

        return Promise.resolve()
      },
    } as unknown as SlackBoundTurnDelivery)
  },
})

const { appendAgentRunFrame } = await import('./run-frames')

useChatPreviewTurn({
  runClaudeCodePreviewChatTurn: (args) => {
    seen.previewArgs.push(args)
    appendAgentRunFrame(args.run, 'data: {"type":"text-delta","delta":"hi"}\n\n')

    return Promise.resolve()
  },
})

const { launchAcceptedChatTurn } = await import('./chat-post-run')
const { createAgentRun } = await import('./run-registry')

async function settled(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await Bun.sleep(2)
  expect(predicate()).toBe(true)
}

beforeEach(() => {
  seen.sinkFrames = []
  seen.finalize = []
  seen.previewArgs = []
  seen.released = 0
  seen.persistedOwners = []
  installTranscript()
})

describe('launchAcceptedChatTurn on the Claude Code runtime', () => {
  test('a Slack-bound turn mirrors through the run sink, releases its claim, and finalizes', async () => {
    const run = createAgentRun('user-1', 'conv-1', 'stream-1')
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ] as UIMessage[]
    const thread = {
      slackWorkspaceId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: '100.1',
      teamId: 'team-1',
      sessionId: 'conv-1',
    } as SlackAgentThread

    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'teammate',
        nuphosToken: 'tok',
        requestId: 'r',
        streamId: 'stream-1',
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      conversationParent: undefined,
      body: { id: 'conv-1', messages },
      teamId: 'team-1',
      messages,
      firstMessage: 'hello',
      locale: 'en',
      credentialAccess: undefined,
      credentialAccessRequested: false,
      chatRuntime: { runtime: 'claude-code', endpoint: ENDPOINT },
      releaseClaim: () => {
        seen.released++
      },
      slack: {
        thread,
        runOwnerUserId: 'user-1',
        userName: 'Yuan',
        mirror: null,
      },
    })

    await settled(() => seen.finalize.length === 1)

    expect(seen.previewArgs[0]).toMatchObject({
      sessionId: 'conv-1',
      userId: 'user-1',
      actorUserId: 'teammate',
      teamId: 'team-1',
      endpoint: ENDPOINT,
    })
    expect(seen.sinkFrames.some((raw) => raw.includes('text-delta'))).toBe(true)
    expect(seen.persistedOwners).toEqual(['user-1'])
    expect(seen.released).toBe(1)
    expect(seen.finalize[0]).toMatchObject({ stopped: false })
  })

  test('does not prompt ACP when the durable runtime binding cannot be persisted', async () => {
    installTranscript({
      persistAcceptedConversationTurn: () => Promise.reject(new Error('database unavailable')),
    })
    const run = createAgentRun('user-1', 'conv-persist-fail', 'stream-persist-fail')
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ] as UIMessage[]

    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'user-1',
        nuphosToken: 'tok',
        requestId: 'r-fail',
        streamId: 'stream-persist-fail',
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      conversationParent: undefined,
      body: { id: 'conv-persist-fail', messages },
      teamId: 'team-1',
      messages,
      firstMessage: 'hello',
      locale: 'en',
      credentialAccess: undefined,
      credentialAccessRequested: false,
      chatRuntime: { runtime: 'claude-code', endpoint: ENDPOINT },
      releaseClaim: () => {
        seen.released++
      },
      slack: null,
    })

    await settled(() => run.done)
    expect(seen.previewArgs).toHaveLength(0)
    expect(run.frames.some((frame) => frame.includes('database unavailable'))).toBe(true)
    expect(seen.released).toBe(1)
  })
})
