// The preview fork of an accepted /agent/chat turn on a Slack-bound
// conversation: the Slack mirror sink is attached before the runtime streams,
// sees every frame, and the claim release + finalize run exactly as for the
// model loop.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { queuedRefusal, refusal } from '@/lib/claude-code-preview/runtime-refusal'
import { useAgentTranscript } from '@/lib/test/doubles/agent-transcript'
import { useChatPreviewTurn } from '@/lib/test/doubles/chat-preview-turn'
import { useChatSlackBound } from '@/lib/test/doubles/chat-slack-bound'
import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { SlackBoundTurnDelivery } from './chat-slack-bound'
import type { InternalChatCtx } from './types'
import type { SlackAgentThread } from '@/lib/slack/agent-bot'
import type { UIMessage } from 'ai'

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

const installDb = useDb({})
const installModels = useRuntimeModels({})
const { appendAgentRunFrame } = await import('./run-frames')

const installPreviewTurn = useChatPreviewTurn({
  runClaudeCodePreviewChatTurn: (args) => {
    seen.previewArgs.push(args)
    appendAgentRunFrame(args.run, 'data: {"type":"text-delta","delta":"hi"}\n\n')

    return Promise.resolve()
  },
})

const { launchAcceptedChatTurn } = await import('./chat-post-run')
const { createAgentRun } = await import('./run-registry')

const chatEvents = (calls: unknown[][]) =>
  calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((entry) => String(entry.event).startsWith('agent.chat.'))

/** Runs a turn that ends with `error` and returns what it logged, by level. */
async function logsOfTurnEndingWith(id: string, error: Error) {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const fail = spyOn(console, 'error').mockImplementation(() => {})

  installPreviewTurn({ runClaudeCodePreviewChatTurn: () => Promise.reject(error) })
  const run = createAgentRun('user-1', id, `stream-${id}`)
  const messages = [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
  ] as UIMessage[]

  try {
    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'user-1',
        nuphosToken: 'tok',
        requestId: 'r',
        streamId: `stream-${id}`,
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      body: { id, messages },
      teamId: 'team-1',
      messages,
      firstMessage: 'hello',
      locale: 'en',
      credentialAccess: undefined,
      credentialAccessRequested: false,
      chatRuntime: { runtime: 'claude-code', endpoint: ENDPOINT },
      releaseClaim: () => {},
      slack: null,
      storedTurn: { isNew: false },
    })
    await settled(() => run.done)

    return { run, info: chatEvents(log.mock.calls), errors: chatEvents(fail.mock.calls) }
  } finally {
    log.mockRestore()
    fail.mockRestore()
  }
}

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

  test('a turn the route already stored is not stored again', async () => {
    const run = createAgentRun('user-1', 'conv-stored', 'stream-stored')
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ] as UIMessage[]

    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'user-1',
        nuphosToken: 'tok',
        requestId: 'r-stored',
        streamId: 'stream-stored',
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      body: { id: 'conv-stored', messages },
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
      storedTurn: { isNew: true },
    })

    await settled(() => seen.previewArgs.length === 1)
    expect(seen.persistedOwners).toEqual([])
    expect(seen.previewArgs[0]).toMatchObject({ sessionId: 'conv-stored', teamId: 'team-1' })
  })

  test('a message left waiting in the queue is logged as queued, not as a failed request', async () => {
    const queued = queuedRefusal(refusal('Responding…'), { id: 'queued' }) as Error
    const { run, info, errors } = await logsOfTurnEndingWith('conv-queued', queued)

    expect(errors).toEqual([])
    expect(info).toContainEqual(
      expect.objectContaining({
        level: 'info',
        event: 'agent.chat.request.queued',
        error_status: 409,
        provider_error_code: 'message_queued',
      }),
    )
    // The client still hears the same answer.
    expect(run.frames.some((frame) => frame.includes('message_queued'))).toBe(true)
  })

  test('a refusal with nothing queued is still logged as a failed request', async () => {
    const { errors } = await logsOfTurnEndingWith('conv-refused', refusal('Responding…'))

    expect(errors.map((entry) => entry.event)).toEqual([
      'agent.chat.request.error',
      'agent.chat.run.error_frame_appended',
    ])
    expect(errors[0]).toMatchObject({ level: 'error', error_status: 409 })
  })

  test('an explicit reply reaches the turn naming its question, for resolving at admission', async () => {
    const run = createAgentRun('user-1', 'conv-reply', 'stream-reply')
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'blue' }] },
    ] as UIMessage[]

    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'user-1',
        nuphosToken: 'tok',
        requestId: 'r',
        streamId: 'stream-reply',
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      body: {
        id: 'conv-reply',
        messages,
        decisionReplyTo: 'nuphos-q1',
      },
      teamId: 'team-1',
      messages,
      firstMessage: 'blue',
      locale: 'en',
      credentialAccess: undefined,
      credentialAccessRequested: false,
      chatRuntime: { runtime: 'claude-code', endpoint: ENDPOINT },
      releaseClaim: () => {},
      slack: null,
    })

    await settled(() => seen.previewArgs.length === 1)
    expect(seen.previewArgs[0]).toMatchObject({ decisionReplyTo: 'nuphos-q1' })
  })

  test('a new chat’s first-turn pick is recorded as the person’s, from the app that sent it', async () => {
    const memory = portabilityDb()

    memory
      .rows('agent_conversations')
      .push({ sessionId: 'conv-first', teamId: 'team-1', userId: 'user-1' })
    installDb({ db: () => memory })
    installModels({
      runtimeModelCatalog: async () => ({
        models: [{ id: 'opus', name: 'Opus' }],
        controls: { modelId: 'opus', effort: [], fast: [] },
      }),
    })
    const run = createAgentRun('user-1', 'conv-first', 'stream-first')
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ] as UIMessage[]

    launchAcceptedChatTurn({
      run,
      chatCtx: {
        userId: 'user-1',
        nuphosToken: 'tok',
        requestId: 'r',
        streamId: 'stream-first',
        client: 'ios',
      } as InternalChatCtx,
      chatSpan: { end: () => {} } as never,
      body: { id: 'conv-first', messages, initialSessionConfig: { model: 'opus' } },
      teamId: 'team-1',
      messages,
      firstMessage: 'hello',
      locale: 'en',
      credentialAccess: undefined,
      credentialAccessRequested: false,
      chatRuntime: { runtime: 'claude-code', runtimeId: 'rt-1', endpoint: ENDPOINT },
      releaseClaim: () => {},
      slack: null,
      storedTurn: { isNew: true },
    })

    await settled(() => seen.previewArgs.length === 1)
    expect(memory.rows('agent_conversations')[0]?.settingsHistory).toMatchObject([
      { actorId: 'user-1', via: 'new_chat', client: 'ios', model: { to: { value: 'opus' } } },
    ])
  })
})
