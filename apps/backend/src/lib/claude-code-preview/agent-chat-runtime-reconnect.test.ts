import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'
import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'
import { OpenAbTimeoutError, RuntimeStateProbeError, turnDiagnostics } from './turn-diagnostics'

import type { TeamPreviewClient } from './team-openab-runtime'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'transport-fixture',
  provider: 'claude-code' as const,
}
const attachment = { openabSessionId: 'session', runtimeUrl: endpoint.url }
const calls: string[] = []
let sendAllowed = true
let phase: string | undefined
let phaseAfterLoad: string | undefined
let loaded = false
let loadedPrompt: string | undefined
let prompted: string | undefined
let promptError: Error | undefined
let probeError: Error | undefined
const noop = () => {}
const replacement = {
  getSessionExecutionState: () => {
    throw new Error('Session is not attached to this connection')
  },
  loadSession: async (_id: string, _cwd: string, _servers: unknown, prompt?: string) => {
    loadedPrompt = prompt
    calls.push('load')
    loaded = true

    return { alive: true }
  },
  prompt: async (_session: string, text: string, ...rest: unknown[]) => {
    expect(loaded).toBe(true)
    calls.push('prompt')
    if (promptError) throw promptError
    prompted = [rest[6], text].filter(Boolean).join('\n\n')

    return { stopReason: 'end_turn' }
  },
  onSessionUpdate: () => noop,
  onSessionPermission: () => noop,
  onClosed: () => noop,
  onRetired: () => noop,
} as unknown as TeamPreviewClient
let acquire: ReturnType<typeof spyOn>

let workLost: string | null = null

useAgentDb({
  getConversationPreviewAttachment: async () => attachment,
  markConversationWorkLost: async (_id: string, _team: string, reason: string) => {
    workLost = reason
  },
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => {
    const pending = workLost

    workLost = null

    return pending
  },
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  probeExecutionState: async (conversation) => {
    expect(conversation.claudeCodePreview).toEqual(attachment)
    calls.push('observe-control')
    if (probeError) throw probeError

    return {
      schemaVersion: 2,
      phase: loaded ? phaseAfterLoad : phase,
      actions: { send: sendAllowed },
      label: 'Running tools…',
    }
  },
})
beforeEach(() => {
  calls.length = 0
  loaded = false
  prompted = undefined
  promptError = undefined
  probeError = undefined
  sendAllowed = true
  phase = undefined
  phaseAfterLoad = undefined
  workLost = null
  sessionsByConversation.set('team:conversation', {
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    openabSessionId: 'session',
    endpoint,
    client: {} as TeamPreviewClient,
    mcpServers: [],
  })
  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.delete('team:conversation')
})
const run = (systemPrompt?: string) =>
  runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: '',
    text: 'Continue',
    systemPrompt,
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: noop,
  })

const runFresh = () =>
  runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: '',
    text: 'Continue',
    freshSessionMessage: (uncertain?: boolean) =>
      `${uncertain ? 'contact was lost' : 'your background work is gone'}\n\nContinue`,
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: noop,
  })

test('observes through control before attaching a replacement prompt socket', async () => {
  expect(await run()).toEqual({ stopReason: 'end_turn' })
  expect(calls).toEqual(['observe-control', 'load', 'prompt'])
})

test('a busy runtime is rejected without loading or prompting a replacement socket', async () => {
  sendAllowed = false
  // Another turn took the runtime after route admission: refused like admission
  // refuses, so the client keeps the message and sends it again.
  await expect(run()).rejects.toMatchObject({
    status: 409,
    code: 'runtime_not_accepting_message',
    message: 'Running tools…',
  })
  expect(calls).toEqual(['observe-control'])
})

test('the runtime refusing the prompt because another turn won the race is the same refusal', async () => {
  promptError = new OpenAbRpcError('Session busy: a prompt is already in progress', -32001)
  await expect(run()).rejects.toMatchObject({ status: 409, code: 'runtime_not_accepting_message' })
})

test('re-attaches a continuation parked on a lost output connection instead of leaving it stuck', async () => {
  sendAllowed = false
  phase = 'resume_disconnected'
  // Refused like any busy runtime, so the client parks the message instead of failing the turn.
  await expect(run()).rejects.toMatchObject({
    status: 409,
    code: 'runtime_not_accepting_message',
    message: expect.stringContaining('continuing after a background task'),
  })
  expect(calls).toEqual(['observe-control', 'load', 'observe-control'])
  expect(sessionsByConversation.get('team:conversation')?.client).toBe(replacement)
})

test('a reattach that leaves the continuation parked fails the turn instead of inviting another', async () => {
  // A 409 here would have the client prompt again on its next probe, forever.
  sendAllowed = false
  phase = 'resume_disconnected'
  phaseAfterLoad = 'resume_disconnected'
  await expect(run()).rejects.toThrow('could not be reattached')
  expect(calls).toEqual(['observe-control', 'load', 'observe-control'])
})

test('a reattach that lost the inner agent reports it on the very next prompt', async () => {
  // Nothing else carries the loss forward: the background reattach happens
  // between turns, so without this the armed monitor dies unannounced.
  const session = sessionsByConversation.get('team:conversation')

  session!.innerSessionLost = true

  expect(await runFresh()).toEqual({ stopReason: 'end_turn' })
  expect(prompted).toContain('your background work is gone')
  expect(session!.innerSessionLost).toBe(false)
})

test('an ordinary turn prompts the message itself', async () => {
  expect(await run()).toEqual({ stopReason: 'end_turn' })
  expect(prompted).toBe('Continue')
})

test('a turn the runtime refuses keeps the loss pending for the turn that lands', async () => {
  const session = sessionsByConversation.get('team:conversation')

  session!.innerSessionLost = true
  sendAllowed = false
  await expect(run()).rejects.toThrow('Running tools…')
  expect(session!.innerSessionLost).toBe(true)

  sendAllowed = true
  expect(await runFresh()).toEqual({ stopReason: 'end_turn' })
  expect(prompted).toContain('your background work is gone')
})

test('a loss recorded on another replica still reports on this one', async () => {
  // The replica that watched the runtime die is not the one the user's next
  // message lands on, and its session object never travels. Only the durable
  // mark does.
  workLost = 'session_lost'
  expect(sessionsByConversation.get('team:conversation')?.innerSessionLost).toBeUndefined()

  expect(await runFresh()).toEqual({ stopReason: 'end_turn' })
  expect(prompted).toContain('your background work is gone')
  expect(workLost).toBeNull()
})

test('lost contact is reported as lost contact, not as certain death', async () => {
  workLost = 'unreachable'

  expect(await runFresh()).toEqual({ stopReason: 'end_turn' })
  expect(prompted).toContain('contact was lost')
})

test('a refused turn leaves the durable mark for the turn that lands', async () => {
  workLost = 'session_lost'
  sendAllowed = false
  await expect(run()).rejects.toThrow('Running tools…')
  expect(workLost).toBe('session_lost')
})

test('changed identity instructions reload an already attached session before prompting', async () => {
  const session = sessionsByConversation.get('team:conversation')!

  session.client = replacement
  session.contextDeliveredAt = Date.now()
  session.systemPrompt = 'old identity instructions'
  expect(await run('new identity instructions')).toEqual({ stopReason: 'end_turn' })
  expect(calls).toEqual(['observe-control', 'load', 'prompt'])
  expect(loadedPrompt).toBe('new identity instructions')
})

for (const [name, error, diagnostics] of [
  [
    'timeout',
    new OpenAbTimeoutError('OpenAB ACP _openab/session/state timed out', 'call-deadline', 3000),
    { source: 'backend', timeoutKind: 'call-deadline', timeoutMs: 3000 },
  ],
  ['invalid snapshot', new Error('Invalid runtime execution snapshot'), { source: 'unknown' }],
  [
    'unsupported RPC',
    new OpenAbRpcError('Method not found', -32601),
    { source: 'runtime', errorCode: -32601 },
  ],
] as const) {
  test(`the ${name} probe failure reaches the transcript and diagnostics without sending a prompt`, async () => {
    probeError = error
    const failure = await run().catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(RuntimeStateProbeError)
    expect((failure as Error).cause).toBe(error)
    expect(classifyPreviewInterruption(failure, false)).toEqual({
      reason: name === 'timeout' ? 'timeout' : 'error',
      message: `Could not check the agent's state: ${error.message}`,
    })
    expect(
      turnDiagnostics({ streamId: 'run', startedAt: 1000, error: failure, toolSteps: [] }),
    ).toMatchObject({
      ...diagnostics,
      error: error.message,
    })
    expect(calls).toEqual(['observe-control'])
  })
}

test('a probe failure is redacted before display and cancellation still takes precedence', async () => {
  probeError = new Error('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')
  const failure = await run().catch((cause: unknown) => cause)

  expect(classifyPreviewInterruption(failure, false).message).not.toContain(
    'abcdefghijklmnopqrstuvwxyz',
  )
  expect(classifyPreviewInterruption(failure, true).reason).toBe('cancelled')
})
