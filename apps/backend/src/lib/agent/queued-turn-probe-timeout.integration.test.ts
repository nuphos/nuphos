import { afterAll, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useBoxWake } from '@/lib/test/doubles/box-wake'
import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'

import { registry, sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { runClaudeCodePreviewPrompt } from '@/lib/claude-code-preview/agent-chat-runtime'
import { OpenAbAcpClient } from '@/lib/claude-code-preview/openab-acp-client'

import { buildPendingUserMessage, enqueuePendingUserMessage } from './pending-messages'
import { listPendingUserMessages } from './pending-queue'
import { startQueuedTurn } from './queued-turn'
import { installQueuedTurnStarter } from './session-released'
import { installTurnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { AcpSocket } from '@/lib/claude-code-preview/openab-acp-session'

type Frame = { id?: number; method?: string; params?: Record<string, unknown> }

/**
 * A runtime over a real WebSocket whose state RPC answers the calls `slow` picks
 * only after the backend's 3 s call deadline. A queued turn makes two: the
 * queue's status read, then the admission check before the prompt.
 */
const stateCalls: number[] = []
let slow: (call: number) => boolean = (call) => call === 2
const prompted: string[] = []
const gateway = Bun.serve({
  port: 0,
  fetch: (req, server) => (server.upgrade(req) ? undefined : new Response(null, { status: 400 })),
  websocket: {
    async message(ws, raw) {
      const frame = JSON.parse(String(raw)) as Frame
      const reply = (body: Record<string, unknown>) => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...body }))
      }

      if (typeof frame.id !== 'number') return
      if (frame.method === 'initialize')
        return reply({ result: { protocolVersion: 1, agentCapabilities: {} } })
      if (frame.method === '_openab/session/state') {
        stateCalls.push(Date.now())
        if (slow(stateCalls.length)) await Bun.sleep(3_500)

        return reply({
          result: {
            schemaVersion: 2,
            epoch: 'runtime',
            revision: stateCalls.length,
            state: 'idle',
            phase: 'idle',
            label: 'Ready',
            tools: [],
            actions: { send: true, cancel: false, steer: false },
          },
        })
      }
      if (frame.method === 'session/resume') return reply({ result: {} })
      if (frame.method === 'session/prompt') {
        const prompt = frame.params?.prompt as { type: string; text?: string }[] | undefined

        prompted.push(prompt?.map((block) => block.text ?? '').join('') ?? '')

        return reply({ result: { stopReason: 'end_turn' } })
      }
      reply({ error: { code: -32601, message: 'Method not found' } })
    },
  },
})

afterAll(() => gateway.stop(true))

const OWNER = 'owner'
const SESSION = 'probe-timeout-session'
const endpoint = {
  url: `ws://127.0.0.1:${String(gateway.port)}/acp`,
  authKey: 'fixture',
  provider: 'opencode' as const,
}
const attachment = { openabSessionId: 'sess_1', runtimeUrl: endpoint.url }
const conversation = {
  sessionId: SESSION,
  userId: OWNER,
  teamId: 'team',
  firstMessage: 'Start',
  claudeCodePreview: attachment,
} as AgentConversation

useRedis({ withRedis: (async () => null) as never, claimRun: async () => true })
useIdentity({ signNuphosToken: () => 'test-token' })
useBoxWake({ wakeOfflineBox: async () => false })
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useConversationChatRoute({
  resolveConversationChatRuntime: async () => ({ endpoint }) as never,
})
useAgentDb({
  agentMessages: () => ({ findOne: async () => null }),
  getConversationBySessionId: async () => conversation,
  getConversationWithMessages: async () => ({ conversation, messages: [] }),
  getConversationPreviewAttachment: async () => attachment,
  setConversationPreviewAttachment: async () => {},
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => null,
  markConversationWorkLost: async () => {},
})

const client = await OpenAbAcpClient.connect({
  ...endpoint,
  socketFactory: () => new WebSocket(endpoint.url, ['acp.v1']) as unknown as AcpSocket,
})

spyOn(registry, 'acquire').mockResolvedValue(client)
afterAll(() => {
  client.close()
  sessionsByConversation.delete(`team:${SESSION}`)
})

let runs = 0
const notices: string[] = []

installQueuedTurnStarter(startQueuedTurn)
installTurnRunner({
  hasActiveAgentRunForSession: async () => false,
  claimAgentRunForSession: async () => () => {},
  // The notice to a sender whose message did not run.
  claimAgentRunOrEnqueue: async ({ message }) => {
    notices.push(message.renderedText)

    return { mode: 'queued' }
  },
  // The trigger run's prompt step; its failures reach runTurn unchanged.
  runAgentForTrigger: async (args) => {
    runs++
    const last = args.messages.at(-1)?.parts[0]

    await runClaudeCodePreviewPrompt({
      teamId: args.teamId ?? 'team',
      conversationId: args.sessionId,
      userId: args.userId,
      locale: 'en-US',
      message: '',
      text: last?.type === 'text' ? last.text : '',
      endpoint,
      signal: new AbortController().signal,
      onTextDelta: () => {},
      ...(args.clientResendsRefusal ? { clientResendsRefusal: true } : {}),
    })

    return { status: 'completed', finishReason: 'stop' }
  },
})

test('a queued message whose state check times out once is sent again and delivered once', async () => {
  const message = buildPendingUserMessage({
    renderedText: 'CI passed',
    source: 'agent.thread',
    actorUserId: OWNER,
  })

  await enqueuePendingUserMessage(OWNER, SESSION, message)
  await startQueuedTurn(OWNER, SESSION)

  // The check timed out: the message is back at the head, waiting out the grace an
  // agent host away gets, and nothing was prompted.
  const [waiting] = await listPendingUserMessages(OWNER, SESSION)

  expect(waiting?.id).toBe(message.id)
  expect(waiting?.offlineSince).toBeString()
  expect(prompted).toEqual([])

  // The queue's own retry, 2 s later, delivers it.
  const deadline = Date.now() + 8_000

  while (prompted.length === 0 && Date.now() < deadline) await Bun.sleep(100)
  expect(prompted).toHaveLength(1)
  expect(prompted[0]).toContain('CI passed')
  expect(runs).toBe(2)
  expect(await listPendingUserMessages(OWNER, SESSION)).toEqual([])
}, 20_000)

test('a state check still timing out after the grace: the message is dropped and its sender told why', async () => {
  // Every admission check is slow; the queue's own status reads answer.
  slow = (call) => call % 2 === 0
  stateCalls.length = 0
  prompted.length = 0
  const message = buildPendingUserMessage({
    renderedText: 'deploy finished',
    source: 'agent.thread',
    actorUserId: OWNER,
    metadata: { sourceSessionId: 'sender-session' } as never,
  })

  await enqueuePendingUserMessage(OWNER, SESSION, {
    ...message,
    offlineSince: new Date(Date.now() - 61_000).toISOString(),
  })
  await expect(startQueuedTurn(OWNER, SESSION)).rejects.toThrow('did not report its state in time')

  expect(prompted).toEqual([])
  expect(await listPendingUserMessages(OWNER, SESSION)).toEqual([])
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('did not report its state in time')
}, 20_000)
