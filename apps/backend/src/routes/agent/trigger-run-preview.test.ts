// Headless entry points (triggers, channel bridges, MCP nuphos_ask) fork to the
// Claude Code runtime through runAgentForTrigger: the caller-supplied frame
// sink still mirrors the run, and the outcome keeps the classic shape.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentTranscript } from '@/lib/test/doubles/agent-transcript'
import { useChatPreviewTurn } from '@/lib/test/doubles/chat-preview-turn'
import { useClaudeCodePreviewRuntime } from '@/lib/test/doubles/claude-code-preview-runtime'
import { useDb } from '@/lib/test/doubles/db'
import { usePosthog } from '@/lib/test/doubles/posthog'

import type { UIMessage } from 'ai'

const ENDPOINT = { url: 'ws://openab-team-t1.openab-runtimes.svc:8080/acp', authKey: 'k' }
const seen = { previewArgs: [] as Record<string, unknown>[], sinkFrames: [] as string[], done: 0 }
const captured: { event: string; properties?: Record<string, unknown> }[] = []
const capturedExceptions: { error: unknown; source: string }[] = []
let previewError: Error | null = null

const initializedModes: unknown[] = []

useDb({
  db: () => ({
    collection: (collection: string) => ({
      updateOne: async (filter: unknown, update: unknown) => {
        if (collection === 'auto_mode_authorizations') initializedModes.push({ filter, update })
      },
      findOne: async () => null,
    }),
  }),
})

useAgentDb({ getConversationBySessionId: () => Promise.resolve(null) })
useAgentTranscript({
  persistAcceptedConversationTurn: () => Promise.resolve({ isNew: true }),
})
useClaudeCodePreviewRuntime({
  resolveConversationChatRuntime: () =>
    Promise.resolve({ runtime: 'claude-code', endpoint: ENDPOINT }),
})
usePosthog({
  capture: (event, options) => {
    captured.push({
      event,
      properties: options?.properties,
    })
  },
  captureException: (error, options) => {
    capturedExceptions.push({ error, source: options.source })
  },
})

const { appendAgentRunFrame } = await import('./run-frames')

useChatPreviewTurn({
  runClaudeCodePreviewChatTurn: (args) => {
    seen.previewArgs.push(args)
    if (previewError) return Promise.reject(previewError)
    appendAgentRunFrame(args.run, 'data: {"type":"text-delta","delta":"pong"}\n\n')
    appendAgentRunFrame(args.run, 'data: {"type":"atlas-stream-done"}\n\n')
    args.run.done = true

    return Promise.resolve()
  },
})

const { runAgentForTrigger } = await import('./trigger-run')

describe('runAgentForTrigger on the Claude Code runtime', () => {
  test('runs the turn on the OpenAB runtime and keeps the outcome shape', async () => {
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'ping' }] },
    ] as UIMessage[]
    const outcome = await runAgentForTrigger({
      userId: 'actor-1',
      conversationOwnerUserId: 'owner-1',
      nuphosToken: 'tok',
      teamId: 'team-1',
      sessionId: 'conv-1',
      messages,
      firstMessage: 'ping',
      source: 'slack.mention',
      frameSink: {
        frame: (raw) => {
          seen.sinkFrames.push(raw)
        },
        done: () => {
          seen.done++
        },
      },
    })

    expect(outcome).toEqual({ status: 'completed', finishReason: 'stop' })
    expect(seen.previewArgs[0]).toMatchObject({
      sessionId: 'conv-1',
      teamId: 'team-1',
      userId: 'owner-1',
      actorUserId: 'actor-1',
      endpoint: ENDPOINT,
      run: {
        trace: {
          userId: 'actor-1',
          sessionId: 'conv-1',
          teamId: 'team-1',
          route: 'slack.mention',
          method: 'TRIGGER',
        },
      },
    })
    expect(seen.sinkFrames.some((raw) => raw.includes('pong'))).toBe(true)
  })

  test('Discord and Slack initialize Full Access for the acting user before running', async () => {
    for (const source of ['discord.agent', 'slack.agent']) {
      initializedModes.length = 0
      await runAgentForTrigger({
        userId: 'actor',
        conversationOwnerUserId: 'owner',
        nuphosToken: 'token',
        teamId: 'team-1',
        sessionId: 'channel-session',
        source,
        firstMessage: 'hi',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      })
      expect(initializedModes[0]).toMatchObject({
        filter: { conversationId: 'channel-session', userId: 'actor' },
        update: { $setOnInsert: { bypass: true } },
      })
    }
  })

  test('unattended sessions initialize Full Access for the execution principal', async () => {
    for (const origin of ['trigger'] as const) {
      initializedModes.length = 0
      await runAgentForTrigger({
        userId: 'principal',
        nuphosToken: 'token',
        teamId: 'team-1',
        sessionId: `${origin}-session`,
        origin,
        firstMessage: 'check',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'check' }] }],
      })
      expect(initializedModes[0]).toMatchObject({
        filter: { conversationId: `${origin}-session`, userId: 'principal' },
        update: { $setOnInsert: { bypass: true } },
      })
    }
  })

  test('resource webhook wakeups never initialize Full Access', async () => {
    initializedModes.length = 0
    await runAgentForTrigger({
      userId: 'principal',
      nuphosToken: 'token',
      teamId: 'team-1',
      sessionId: 'resource-session',
      origin: 'trigger',
      source: 'agent.resource',
      firstMessage: 'continue',
      messages: [
        { id: 'resource-event', role: 'user', parts: [{ type: 'text', text: 'PR reviewed' }] },
      ],
    })
    expect(initializedModes).toEqual([])
  })

  test('user-origin sessions keep their existing permission mode', async () => {
    initializedModes.length = 0
    await runAgentForTrigger({
      userId: 'principal',
      nuphosToken: 'token',
      teamId: 'team-1',
      sessionId: 'user-session',
      origin: 'user',
      firstMessage: 'hi',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    expect(initializedModes).toEqual([])
  })

  test('records a terminal preview failure in PostHog lifecycle and error tracking', async () => {
    captured.length = 0
    capturedExceptions.length = 0
    previewError = new Error('Timed out waiting for agent backend')
    const messages = [
      { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'cost' }] },
    ] as UIMessage[]

    try {
      await expect(
        runAgentForTrigger({
          userId: 'actor-1',
          nuphosToken: 'tok',
          teamId: 'team-1',
          sessionId: 'conv-failure',
          messages,
          firstMessage: 'cost',
          source: 'slack.agent',
        }),
      ).rejects.toThrow('Timed out waiting for agent backend')
    } finally {
      previewError = null
    }

    expect(captured).toContainEqual({
      event: 'agent_lifecycle',
      properties: expect.objectContaining({
        phase: 'agent.trigger.request.error',
        session_id: 'conv-failure',
        route: 'slack.agent',
        error_message: 'Timed out waiting for agent backend',
      }),
    })
    expect(capturedExceptions).toContainEqual({
      error: expect.any(Error),
      source: 'agent.trigger.request',
    })
  })
})
