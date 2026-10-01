import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AgentRun } from './types'
import type { OpenAbPermissionOutcome } from '@/lib/claude-code-preview/openab-acp-session'

import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

useRedis({ redisEnabled: () => false, withRedis: async () => null })
const runtime = useFakeRuntimeRequests()

const { awaitPreviewDecision, registerPreviewWait, resetLocalPreviewWaits } =
  await import('@/lib/claude-code-preview/decision-waiter')
const { handleOpenAbPermissionRequest, PERMISSION_TIMED_OUT_TEXT } =
  await import('@/lib/claude-code-preview/openab-permission-bridge')
const { createPreviewRunState, createPreviewToolLog } = await import('./chat-preview-run')
const { resolvePreviewWaitFromChat } = await import('./chat-preview-resume')
const { handlePreviewToolUpdate } = await import('./chat-preview-tool-update')
const { agentRunKey, agentRuns, createAgentRun, registerAgentRun } = await import('./run-registry')
const { streamAgentRunResponse } = await import('./run-stream')

const request = {
  sessionId: 'openab-session',
  toolCall: { toolCallId: 'tool-1', title: 'kubectl delete pod', rawInput: { command: 'x' } },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ],
}

type Frame = Record<string, unknown> & { type?: string }

function frames(run: AgentRun): Frame[] {
  return run.frames
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Frame)
}

function startTurn(timeoutMs = 60_000) {
  const streamId = `st-${crypto.randomUUID()}`
  const run = createAgentRun('u1', 'conv-1', streamId, {
    requestId: `req-${streamId}`,
    userId: 'u1',
    sessionId: 'conv-1',
    streamId,
    route: '/agent/chat',
    method: 'POST',
  })

  registerAgentRun(run)
  const state = createPreviewRunState({ run, userId: 'u1', sessionId: 'conv-1' })
  const log = createPreviewToolLog()
  const handleTool = (update: Parameters<typeof handlePreviewToolUpdate>[2]) => {
    handlePreviewToolUpdate(state.emit, log, update)
  }
  const outcome: Promise<OpenAbPermissionOutcome> = handleOpenAbPermissionRequest(
    {
      userId: 'u1',
      conversationId: 'conv-1',
      request,
      emit: state.emit,
      handleTool,
      signal: state.signal,
      onDecision: (decision) => state.onResume(decision),
    },
    {
      getSessionBypass: async () => false,
      registerWait: registerPreviewWait,
      awaitDecision: (args) => awaitPreviewDecision({ ...args, timeoutMs, pollMs: 5 }),
      hasPendingMessages: async () => false,
    },
  )

  return { run, state, handleTool, outcome }
}

async function pendingWait() {
  for (;;) {
    const record = [...runtime.records.values()].find((r) => r.wait.kind === 'agent-permission')

    if (record) return record.wait
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

async function until(check: () => boolean) {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 2))
}

function decideFromClient(approved: boolean, waitId: string, streamId: string) {
  return resolvePreviewWaitFromChat({
    userId: 'u1',
    sessionId: 'conv-1',
    streamId,
    body: {
      id: 'conv-1',
      resumeReason: 'approval-decision',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'tool-1',
              state: 'approval-responded',
              approval: { id: `openab:${waitId}`, approved },
            } as never,
          ],
        },
      ],
    },
  })
}

beforeEach(() => resetLocalPreviewWaits())

describe('an OpenAB permission request on a live preview turn', () => {
  test('keeps the run open with the approval card while the decision is pending', async () => {
    const { run, state, outcome } = startTurn()

    await pendingWait()
    await until(() => frames(run).some((f) => f.type === 'tool-approval-request'))

    expect(run.done).toBe(false)
    run.abortController.abort()
    await outcome
    state.finish()
  })

  test('an approval moves the continuation onto the decider stream before the agent resumes', async () => {
    const { run, state, handleTool, outcome } = startTurn()
    const wait = await pendingWait()

    expect(await decideFromClient(true, wait.waitId, 'st-approved')).not.toBeNull()
    expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })

    const next = state.current()

    expect(next.streamId).toBe('st-approved')
    expect(agentRuns.get(agentRunKey('u1', 'st-approved'))).toBe(next)
    expect(run.done).toBe(true)
    expect(frames(run).at(-1)?.type).toBe('atlas-stream-done')

    handleTool({
      kind: 'tool',
      toolCallId: 'tool-1',
      title: '',
      status: 'completed',
      rawOutput: 'ok',
    })
    expect(frames(next).at(-1)).toMatchObject({ type: 'tool-output-available', output: 'ok' })
    state.finish()
  })

  test('a deny answers the agent and marks the card on the decider stream', async () => {
    const { state, outcome } = startTurn()
    const wait = await pendingWait()

    await decideFromClient(false, wait.waitId, 'st-denied')

    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(state.current().streamId).toBe('st-denied')
    expect(frames(state.current()).at(-1)).toMatchObject({
      type: 'tool-output-error',
      toolCallId: 'tool-1',
      errorText: 'Permission denied',
    })
    state.finish()
  })

  test('a timeout answers the agent, says so on the same stream, and the turn still settles', async () => {
    const { run, state, handleTool, outcome } = startTurn(30)

    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(runtime.records.size).toBe(0)
    expect(state.current()).toBe(run)
    expect(run.done).toBe(false)

    // The agent's own echo of the aborted tool must not hide why it was aborted.
    handleTool({
      kind: 'tool',
      toolCallId: 'tool-1',
      title: '',
      status: 'failed',
      contentText: 'Tool use aborted',
    })
    state.emit({ type: 'text-delta', delta: 'I could not run that without approval.' })
    state.finish()

    const errors = frames(run).filter((f) => f.type === 'tool-output-error')

    expect(errors.map((f) => f.errorText)).toEqual([
      PERMISSION_TIMED_OUT_TEXT,
      PERMISSION_TIMED_OUT_TEXT,
    ])
    expect(frames(run).some((f) => f.type === 'text-delta')).toBe(true)
    expect(
      frames(run)
        .map((f) => f.type)
        .slice(-2),
    ).toEqual(['atlas-turn-complete', 'atlas-stream-done'])
  })

  test('stopping the turn while the request is pending cancels it for the agent', async () => {
    const { run, state, outcome } = startTurn()

    await pendingWait()
    run.abortController.abort()

    expect(await outcome).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(runtime.records.size).toBe(0)
    state.finish()
  })

  test('a reconnecting client replays the pending approval and can still answer it', async () => {
    const { run, state, outcome } = startTurn()
    const wait = await pendingWait()

    await until(() => frames(run).some((f) => f.type === 'tool-approval-request'))
    const reader = streamAgentRunResponse(run, 0).body!.getReader()
    let replayed = ''

    while (!replayed.includes('tool-approval-request')) {
      const chunk = await reader.read()

      if (chunk.done) break
      replayed += new TextDecoder().decode(chunk.value)
    }
    await reader.cancel()

    expect(replayed).toContain(`"approvalId":"openab:${wait.waitId}"`)
    await decideFromClient(true, wait.waitId, 'st-reconnected')
    expect(await outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    expect(state.current().streamId).toBe('st-reconnected')
    state.finish()
  })
})
