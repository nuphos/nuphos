import { expect, test } from 'bun:test'

import { CodexTurnFailedError } from './codex-turn-failure'
import { lastTextChunkTracker, settledCodexStopReason } from './codex-turn-settle'

import type { SessionExecutionState } from './runtime-execution-snapshot'
import type { TeamSession } from './team-openab-runtime'

import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const NOTICE =
  'This request was blocked by our safety systems. Reason: Potentially unintended activity.\n\n'

let observed: SessionExecutionState = { state: 'idle' }
let queries = 0

useSessionExecutionState({
  conversationExecutionState: async () => {
    queries++

    return observed
  },
})

function session(provider: 'codex' | 'claude-code'): TeamSession {
  return {
    teamId: 'team',
    conversationId: 'conversation',
    openabSessionId: 'sess',
    endpoint: { url: 'ws://runtime.invalid/acp', authKey: 'key', provider },
  } as TeamSession
}

function interrupted(): SessionExecutionState {
  return {
    state: 'interrupted',
    schemaVersion: 2,
    phase: 'interrupted',
    label: 'Session interrupted',
    providerState: 'systemError',
    epoch: 'epoch',
    revision: 3,
    actions: { send: true, cancel: false, steer: false },
    tools: [],
  }
}

test('a Codex end_turn over a systemError thread is the provider failing the turn', async () => {
  observed = interrupted()

  const failure = await settledCodexStopReason(session('codex'), { stopReason: 'end_turn' }, NOTICE)
    .then(() => null)
    .catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(CodexTurnFailedError)
  expect((failure as CodexTurnFailedError).notice).toBe(NOTICE)
  expect((failure as CodexTurnFailedError).userMessage).toBe(
    'The model provider stopped this turn: This request was blocked by our safety systems. Reason: Potentially unintended activity.',
  )
})

test('prose that is not the adapter notice is never claimed as the failure message', async () => {
  observed = interrupted()

  const failure = (await settledCodexStopReason(
    session('codex'),
    { stopReason: 'end_turn' },
    '目前',
  ).catch((error: unknown) => error)) as CodexTurnFailedError

  expect(failure.notice).toBe('')
  expect(failure.userMessage).toBe('The model provider ended this turn with an error.')
})

test('healthy, cancelled and Claude Code turns keep their stop reason', async () => {
  observed = { ...interrupted(), state: 'idle', phase: 'idle', providerState: 'idle' }
  queries = 0

  expect(await settledCodexStopReason(session('codex'), { stopReason: 'end_turn' }, NOTICE)).toBe(
    'end_turn',
  )
  expect(queries).toBe(1)

  observed = interrupted()
  expect(await settledCodexStopReason(session('codex'), { stopReason: 'cancelled' }, NOTICE)).toBe(
    'cancelled',
  )
  expect(await settledCodexStopReason(session('claude-code'), {}, NOTICE)).toBe('end_turn')
  expect(queries).toBe(1)
})

test('the tracker forwards every chunk and remembers only the last one', () => {
  const seen: string[] = []
  const tracker = lastTextChunkTracker((text) => seen.push(text))

  tracker.onTextDelta('我查一下')
  tracker.onTextDelta(NOTICE)

  expect(seen).toEqual(['我查一下', NOTICE])
  expect(tracker.last()).toBe(NOTICE)
})
