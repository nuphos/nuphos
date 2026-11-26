import { describe, expect, spyOn, test } from 'bun:test'

import * as runStore from '@/lib/agent/run-store'
import * as decisions from '@/lib/claude-code-preview/decision-waiter'
import { OpenAbConnectError } from '@/lib/claude-code-preview/openab-acp-connect'
import * as runtime from '@/lib/claude-code-preview/session-execution-state'
import * as recall from '@/lib/meetings/recall'

import { signalAgentRunCancellation, stopConversationTurn } from './run-cancel'

import type { AgentRun } from './types'
import type { AgentConversation } from '@/lib/agent/db'

function createRun(): AgentRun {
  const now = Date.now()

  return {
    key: 'user-1:stream-1',
    streamId: 'stream-1',
    sessionId: 'session-1',
    userId: 'user-1',
    frames: [],
    done: false,
    abortController: new AbortController(),
    subscribers: new Set(),
    createdAt: now,
    lastAccessAt: now,
    lastFrameAt: now,
    releaseOwnership: () => {},
  }
}

describe('signalAgentRunCancellation', () => {
  test('signals the producer without synthesizing terminal state', () => {
    const run = createRun()

    expect(signalAgentRunCancellation(run)).toBe(true)
    expect(run.abortController.signal.aborted).toBe(true)
    expect(run.done).toBe(false)
    expect(run.frames).toEqual([])
    expect(run.lastFinishReason).toBeUndefined()
  })

  test('does not signal an already finished run', () => {
    const run = createRun()

    run.done = true
    expect(signalAgentRunCancellation(run)).toBe(false)
    expect(run.abortController.signal.aborted).toBe(false)
  })
})

describe('stopConversationTurn', () => {
  test('stopping a meeting’s Task takes its bot out of the call', async () => {
    const spies = [
      spyOn(runStore, 'getActiveAgentRunForSession').mockResolvedValue(null as never),
      spyOn(runtime, 'cancelConversationRuntime').mockResolvedValue(undefined as never),
    ]
    const left = spyOn(recall, 'leaveMeeting').mockResolvedValue()
    const task = { userId: 'user-1', sessionId: 'session-1' } as AgentConversation

    try {
      await stopConversationTurn(task)
      expect(left).not.toHaveBeenCalled()
      await stopConversationTurn({
        ...task,
        meeting: { botId: 'recall-bot', botName: 'Ada', url: 'https://meet.example.com/abc' },
      })
      expect(left).toHaveBeenCalledWith('recall-bot')
    } finally {
      for (const spy of [...spies, left]) spy.mockRestore()
    }
  })

  test('a conversation without a runtime session has nothing to stop', async () => {
    const spy = spyOn(runStore, 'getActiveAgentRunForSession').mockResolvedValue(null as never)
    const task = { userId: 'user-1', sessionId: 'session-1', teamId: 'team-1' } as AgentConversation

    try {
      expect(await stopConversationTurn(task)).toBe('requested')
      expect(await stopConversationTurn(task)).toBe('requested')
    } finally {
      spy.mockRestore()
    }
  })

  test('a runtime that does not answer still stops the turn here, with the reason', async () => {
    const cancel = spyOn(runtime, 'cancelConversationRuntime')
    const spies = [
      cancel,
      spyOn(runStore, 'getActiveAgentRunForSession').mockResolvedValue(null as never),
    ]
    const abandoned = spyOn(decisions, 'abandonPendingPreviewWaits').mockResolvedValue(0)
    const task = { userId: 'user-1', sessionId: 'session-1' } as AgentConversation

    try {
      cancel.mockRejectedValue(new OpenAbConnectError('OpenAB ACP connection timed out'))
      expect(await stopConversationTurn(task)).toBe('runtime_unreachable')
      expect(abandoned).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'session-1',
        reason: 'turn_cancelled',
      })
      // Any other failure is still a failure.
      cancel.mockRejectedValue(new Error('Conversation runtime changed'))
      await expect(stopConversationTurn(task)).rejects.toThrow('Conversation runtime changed')
    } finally {
      for (const spy of [...spies, abandoned]) spy.mockRestore()
    }
  })
})
