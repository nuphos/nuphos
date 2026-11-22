// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAutoModeStore } from '@/lib/test/doubles/auto-mode-store'
import { useClaimOrEnqueue } from '@/lib/test/doubles/claim-or-enqueue'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useDecisionAnswer } from '@/lib/test/doubles/decision-answer'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useMessageAttribution } from '@/lib/test/doubles/message-attribution'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'
import { useRuntimeModels } from '@/lib/test/doubles/runtime-models'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'
import { useTriggerRunExecute } from '@/lib/test/doubles/trigger-run-execute'

import type { AgentConversation } from '@/lib/agent/db'

const session = (userId = 'a'.repeat(24)) =>
  ({ sessionId: 's1', userId, teamId: 't1', title: 'Fix the importer' }) as AgentConversation

let stored: AgentConversation | null
let participant: boolean
let answered: { requestId: string; answer: unknown; actor: string }[]
let refuse: AppError | undefined
let runs: Record<string, unknown>[]
let finishRun: () => void
let events: { event: string; data?: Record<string, unknown> }[]
let claims: { userId: string; actorUserId?: string }[]
// Full Access as each new session was given it, in order with the runs started.
let steps: string[]
let bots: Record<string, AgentConversation>
// The caller's most recent standalone Task, as the app's next new chat would start from it.
let last: AgentConversation | null
let lastQuery: Record<string, unknown> | undefined

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) as never })
useMessageAttribution({
  createMessageMetadata: async (userId) =>
    ({ version: 1, sender: { type: 'user', id: userId, displayName: 'Ada' } }) as never,
})
// The caller's runtimes: r1 is theirs to use, r2 is disabled; any other is gone.
useRuntimeCatalog({
  requireRuntimeInstance: async (_team, id) => {
    if (id !== 'r1' && id !== 'r2')
      throw new AppError(404, 'runtime_not_found', 'This agent is no longer available to you.')

    return { id, status: id === 'r1' ? 'active' : 'disabled' } as never
  },
})
// What agent r1 offers.
useRuntimeModels({
  runtimeModelCatalog: async () => ({
    models: [
      { id: 'gpt-5', name: 'GPT-5' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini' },
    ],
    controls: {
      effort: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
      fast: [],
    },
  }),
})
useConversationComputer({ canReplyIn: async () => participant })
useDecisionAnswer({
  answerDecision: async ({ requestId, answer, actor }) => {
    if (refuse) throw refuse
    answered.push({ requestId, answer, actor: actor.id })
  },
})
useClaimOrEnqueue({
  claimAgentRunOrEnqueue: async ({ userId, message }) => {
    claims.push({ userId, actorUserId: message.actorUserId })

    return { mode: 'run', release: () => undefined, carried: [] }
  },
})
useAutoModeStore({
  initializeSessionBypass: async (sessionId, userId, enabled) => {
    steps.push(`mode ${sessionId} ${userId} ${enabled}`)
  },
})
const runtimeRequests = useFakeRuntimeRequests()

useTriggerRunExecute({
  executeAgentForTrigger: async (params) => {
    steps.push(`run ${params.sessionId}`)
    runs.push(params as unknown as Record<string, unknown>)
    await new Promise<void>((resolve) => {
      finishRun = resolve
    })

    return { status: 'completed', finishReason: 'stop' } as never
  },
})
useAgentDb({
  agentConversations: (() => ({
    findOne: async (query: Record<string, unknown>) => {
      lastQuery = query

      return last
    },
  })) as never,
  getConversationBySessionId: async (id) => bots[id] ?? stored,
  // Its owner reads it too, as the real lookup lets them.
  getReadableConversation: async (_session, viewer) =>
    participant || stored?.userId === viewer ? stored : null,
  recordAgentEvent: ({ event, data }) => {
    events.push({ event, data })
  },
  getConversationWithMessages: async () =>
    stored && {
      conversation: stored,
      messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'Old.' }] }] as never,
    },
  // The answer is the newest assistant message alone, not a scan of the transcript.
  getLatestAssistantMessage: async () =>
    ({ role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }) as never,
})

const { nuphosAsk } = await import('./ask')
const ME = 'a'.repeat(24)
const ctx = { userId: ME }
const body = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, any>
const answer = { prompt: 'eu', team_id: 't1', session_id: 's1', request_id: 'q1' }

beforeEach(() => {
  stored = session()
  participant = false
  answered = []
  refuse = undefined
  runs = []
  events = []
  claims = []
  steps = []
  bots = {}
  last = null
  lastQuery = undefined
  finishRun = () => undefined
})

describe('nuphos_ask request_id', () => {
  test('answers the open question instead of sending a message', async () => {
    const result = body(await nuphosAsk(answer, ctx))

    expect(result).toMatchObject({ status: 'running', session_id: 's1' })
    expect(answered).toEqual([{ requestId: 'q1', answer: { text: 'eu' }, actor: ME }])
    expect(runs).toEqual([])
    expect(events).toEqual([{ event: 'decision.answered', data: { requestId: 'q1', via: 'mcp' } }])
  })

  test('a question that must be answered in its own card is a tool error', async () => {
    refuse = new AppError(400, 'decision_not_answerable', 'Answer this question in its own card')
    const result = await nuphosAsk(answer, ctx)

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Answer this question in its own card' })
  })
})

describe('nuphos_ask on a teammate’s session', () => {
  test('is not found for someone who cannot reply in it', async () => {
    stored = session('owner')
    const result = await nuphosAsk(answer, ctx)

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Session not found: s1' })
    expect(answered).toEqual([])
  })

  test('a participant may answer, and their turn runs in the owner’s session', async () => {
    stored = session('owner')
    participant = true

    expect(body(await nuphosAsk(answer, ctx)).status).toBe('running')
    expect(answered).toHaveLength(1)

    const sent = nuphosAsk({ prompt: 'Use eu.', team_id: 't1', session_id: 's1', wait: false }, ctx)

    expect(body(await sent)).toMatchObject({ status: 'running', session_id: 's1' })
    // The session's queue is its owner's; the message stays the participant's.
    expect(claims).toEqual([{ userId: 'owner', actorUserId: ME }])
    expect(runs[0]).toMatchObject({
      userId: ME,
      conversationOwnerUserId: 'owner',
      sessionId: 's1',
      source: 'mcp',
    })
    finishRun()
  })

  test('a session in another team is not found', async () => {
    stored = { ...session('owner'), teamId: 't2' } as AgentConversation
    participant = true

    expect((await nuphosAsk(answer, ctx)).isError).toBe(true)
  })
})

describe('nuphos_ask wait', () => {
  test('false returns once the turn is accepted; the default waits for the answer', async () => {
    // A new session is returned only once it is stored, so a check finds it.
    stored = null
    const starting = nuphosAsk({ prompt: 'Go.', team_id: 't1', wait: false }, ctx)
    let returned = false

    void starting.then(() => {
      returned = true
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(returned).toBe(false)
    stored = session()
    expect(body(await starting).status).toBe('running')
    expect(runs).toHaveLength(1)
    finishRun()

    stored = session()
    const waiting = nuphosAsk({ prompt: 'Go.', team_id: 't1', session_id: 's1' }, ctx)

    await new Promise((resolve) => setTimeout(resolve, 20))
    finishRun()
    expect(body(await waiting)).toMatchObject({ status: 'completed', answer: 'Done.' })
  })
})

describe('nuphos_ask runtime_id', () => {
  test('starts a new session on the chosen agent', async () => {
    stored = null
    const starting = nuphosAsk({ prompt: 'Go.', team_id: 't1', runtime_id: 'r1', wait: false }, ctx)

    await new Promise((resolve) => setTimeout(resolve, 20))
    stored = session()
    expect(body(await starting).status).toBe('running')
    expect(runs[0]).toMatchObject({ runtimeId: 'r1' })
    finishRun()
  })

  test('refuses an agent the caller cannot use, or a disabled one, before anything runs', async () => {
    stored = null

    for (const [id, message] of [
      ['r9', 'This agent is no longer available to you.'],
      ['r2', 'This agent is disabled.'],
    ]) {
      const result = await nuphosAsk({ prompt: 'Go.', team_id: 't1', runtime_id: id }, ctx)

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: message })
    }
    expect(claims).toEqual([])
    expect(runs).toEqual([])
  })

  test('an existing session keeps its own agent', async () => {
    const result = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', session_id: 's1', runtime_id: 'r1' },
      ctx,
    )

    expect(result.isError).toBe(true)
    expect(runs).toEqual([])
  })
})

describe('nuphos_ask model and effort', () => {
  test('a new session on a chosen agent starts on the model and effort asked for', async () => {
    stored = null
    const starting = nuphosAsk(
      {
        prompt: 'Go.',
        team_id: 't1',
        runtime_id: 'r1',
        model: 'gpt-5-mini',
        effort: 'high',
        wait: false,
      },
      ctx,
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    stored = session()
    expect(body(await starting).status).toBe('running')
    expect(runs[0]).toMatchObject({
      runtimeId: 'r1',
      initialSessionConfig: { model: 'gpt-5-mini', effort: 'high' },
    })
    finishRun()
  })

  test('a value the agent does not offer is refused with its choices, before anything runs', async () => {
    stored = null
    const result = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', runtime_id: 'r1', model: 'gpt-9' },
      ctx,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: 'model "gpt-9" is not offered by this agent. Choose one of: gpt-5, gpt-5-mini.',
    })
    expect(claims).toEqual([])
    expect(runs).toEqual([])
  })

  test('model and effort need a runtime_id, and only start a new session', async () => {
    stored = null
    const loose = await nuphosAsk({ prompt: 'Go.', team_id: 't1', effort: 'high' }, ctx)

    expect(loose.content[0]).toMatchObject({ text: expect.stringContaining('need a runtime_id') })

    stored = session()
    const later = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', session_id: 's1', model: 'gpt-5' },
      ctx,
    )

    expect(later.content[0]).toMatchObject({
      text: expect.stringContaining('nuphos_update_session'),
    })
    expect(runs).toEqual([])
  })
})

/** Starts a new session without waiting for its turn, as the tests above do. */
async function startNew(args: Record<string, unknown>) {
  stored = null
  const starting = nuphosAsk({ prompt: 'Go.', team_id: 't1', wait: false, ...args }, ctx)

  await new Promise((resolve) => setTimeout(resolve, 20))
  const id = runs.at(-1)?.sessionId

  stored = session()
  const result = await starting

  finishRun()

  return { result, id }
}

describe('nuphos_ask full_access', () => {
  test('a new session starts in the chosen mode before its first turn runs', async () => {
    for (const fullAccess of [true, false]) {
      steps = []
      const { result, id } = await startNew({ full_access: fullAccess })

      expect(body(result).status).toBe('running')
      expect(steps).toEqual([`mode ${String(id)} ${ME} ${fullAccess}`, `run ${String(id)}`])
    }
    expect(events).toEqual([{ event: 'auth.bypass_enabled', data: { via: 'mcp' } }])
  })

  test('omitted, a new session starts with Full Access, as a new Task in the app does', async () => {
    const { id } = await startNew({})

    expect(steps).toEqual([`mode ${String(id)} ${ME} true`, `run ${String(id)}`])
  })

  test('only a new session takes it, so a caller cannot grant it on one they do not own', async () => {
    // Their own session: changed as in the app, with nuphos_update_session.
    const own = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', session_id: 's1', full_access: true },
      ctx,
    )

    expect(own.content[0]).toMatchObject({ text: expect.stringContaining('nuphos_update_session') })

    // A teammate's session they may reply in: only its owner sets its mode.
    stored = session('owner')
    participant = true
    const theirs = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', session_id: 's1', full_access: true },
      ctx,
    )

    expect(theirs.isError).toBe(true)
    expect(steps).toEqual([])
    expect(runs).toEqual([])
  })
})

describe('nuphos_ask request_id on a tool authorization', () => {
  const waiting = (userId: string) =>
    runtimeRequests.records.set('s1:w1', {
      wait: {
        waitId: 'w1',
        userId,
        sessionId: 's1',
        kind: 'agent-permission',
        ref: 'call-1',
        createdAt: 1,
      },
      decision: null,
    })

  test("approve and deny decide it as the app's card does, and run nothing new", async () => {
    for (const [word, decision] of [
      ['approve', 'approved'],
      ['Deny', 'rejected'],
    ]) {
      waiting(ME)
      const result = body(await nuphosAsk({ ...answer, request_id: 'w1', prompt: word }, ctx))

      expect(result).toMatchObject({ status: 'running', session_id: 's1' })
      expect(runtimeRequests.records.get('s1:w1')?.decision?.payload).toEqual({ decision })
      runtimeRequests.records.clear()
    }
    expect(answered).toEqual([])
    expect(runs).toEqual([])
    expect(events.map((e) => e.data?.decision)).toEqual(['approved', 'rejected'])
  })

  test('any answer but approve or deny is refused and leaves it pending', async () => {
    waiting(ME)
    for (const prompt of ['sure, go ahead', 'yes']) {
      const result = await nuphosAsk({ ...answer, request_id: 'w1', prompt }, ctx)

      expect(result.isError).toBe(true)
    }
    expect(runtimeRequests.records.get('s1:w1')?.decision).toBeNull()
  })

  test("a participant cannot decide the owner's tool call: it is not theirs to approve", async () => {
    stored = session('owner')
    participant = true
    waiting('owner')
    await nuphosAsk({ ...answer, request_id: 'w1', prompt: 'approve' }, ctx)

    expect(runtimeRequests.records.get('s1:w1')?.decision).toBeNull()
  })
})

describe('nuphos_ask with no agent, model or effort', () => {
  const recent = (over: Partial<AgentConversation> = {}) =>
    ({
      sessionId: 'recent',
      userId: ME,
      teamId: 't1',
      runtimeId: 'r1',
      initialSessionConfig: { model: 'gpt-5-mini', effort: 'high' },
      ...over,
    }) as AgentConversation

  test("starts on the agent, model and effort of the caller's last standalone Task", async () => {
    last = recent()
    await startNew({})

    expect(runs[0]).toMatchObject({
      runtimeId: 'r1',
      initialSessionConfig: { model: 'gpt-5-mini', effort: 'high' },
    })
    // Only the caller's own standalone Tasks in this team, newest first.
    expect(lastQuery).toMatchObject({
      userId: ME,
      teamId: 't1',
      parentSessionId: { $exists: false },
    })
  })

  test('naming any of them starts from that instead', async () => {
    last = recent()
    await startNew({ runtime_id: 'r1', model: 'gpt-5' })

    expect(runs[0]?.initialSessionConfig).toEqual({ model: 'gpt-5' })
  })

  test('a model no longer offered keeps the agent on its defaults; an agent gone, the default agent', async () => {
    last = recent({ initialSessionConfig: { model: 'gpt-4' } })
    await startNew({})
    expect(runs[0]).toMatchObject({ runtimeId: 'r1' })
    expect(runs[0]?.initialSessionConfig).toBeUndefined()

    runs = []
    last = recent({ runtimeId: 'gone' })
    await startNew({})
    expect(runs[0]?.runtimeId).toBeUndefined()
  })

  test('with no Task yet, the default agent', async () => {
    await startNew({})

    expect(runs[0]?.runtimeId).toBeUndefined()
  })
})

describe('nuphos_ask parent_session_id', () => {
  const bot = (over: Partial<AgentConversation> = {}) =>
    ({
      sessionId: 'bot-1',
      userId: ME,
      teamId: 't1',
      avatar: 'cat',
      runtimeId: 'r1',
      initialSessionConfig: { model: 'gpt-5-mini', effort: 'high' },
      ...over,
    }) as AgentConversation

  test("a new session starts as the Bot's Task, on its agent, model and effort", async () => {
    bots = { 'bot-1': bot() }
    const { result } = await startNew({ parent_session_id: 'bot-1' })

    expect(body(result).status).toBe('running')
    expect(runs[0]).toMatchObject({
      parentSessionId: 'bot-1',
      runtimeId: 'r1',
      initialSessionConfig: { model: 'gpt-5-mini', effort: 'high' },
    })
    // Its mode is the Bot's, so none of its own is set.
    expect(steps.filter((step) => step.startsWith('mode'))).toEqual([])
  })

  test("its own runtime_id and model win over the Bot's", async () => {
    bots = { 'bot-1': bot() }
    await startNew({ parent_session_id: 'bot-1', runtime_id: 'r1', model: 'gpt-5' })

    expect(runs[0]).toMatchObject({
      parentSessionId: 'bot-1',
      initialSessionConfig: { model: 'gpt-5' },
    })
  })

  test("a model the Bot's agent no longer offers leaves the Task on the agent's defaults", async () => {
    bots = { 'bot-1': bot({ initialSessionConfig: { model: 'gpt-4' } }) }
    await startNew({ parent_session_id: 'bot-1' })

    expect(runs[0]).toMatchObject({ parentSessionId: 'bot-1', runtimeId: 'r1' })
    expect(runs[0]?.initialSessionConfig).toBeUndefined()
  })

  test("only the caller's own Bot in the team, and never with full_access", async () => {
    bots = {
      theirs: bot({ sessionId: 'theirs', userId: 'owner' }),
      task: bot({ sessionId: 'task', avatar: undefined }),
      elsewhere: bot({ sessionId: 'elsewhere', teamId: 't2' }),
      'bot-1': bot(),
    }
    stored = null
    for (const id of ['theirs', 'task', 'elsewhere', 'missing']) {
      const result = await nuphosAsk({ prompt: 'Go.', team_id: 't1', parent_session_id: id }, ctx)

      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining('must be one of your Bots'),
      })
    }
    const mode = await nuphosAsk(
      { prompt: 'Go.', team_id: 't1', parent_session_id: 'bot-1', full_access: true },
      ctx,
    )

    expect(mode.content[0]).toMatchObject({
      text: expect.stringContaining('Change Full Access on the Bot'),
    })
    expect(runs).toEqual([])
  })
})
