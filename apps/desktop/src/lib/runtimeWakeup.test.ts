import assert from 'node:assert/strict'
import test from 'node:test'

import {
  rememberTerminalRuntimeStream,
  shouldResumeRuntimeWakeup,
  wakeupTailLeavesHole,
  wakeupTranscriptTail,
} from './runtimeWakeup.ts'

test('exhausted transport errors stay stopped across repeated wakeup polls', () => {
  for (const event of [
    { type: 'error', error: 'Agent stream received no SSE frame after 4 idle reconnect attempts.' },
    { type: 'sse', data: { type: 'error', errorText: 'ENOSPC' } },
    { type: 'aborted' },
    { type: 'agent-setup-required', reason: 'reauthentication' },
  ]) {
    const stoppedRuns = new Map<string, string>()

    rememberTerminalRuntimeStream(stoppedRuns, 'session-1', 'failed-run', event)
    for (let poll = 0; poll < 9; poll++) {
      assert.equal(
        shouldResumeRuntimeWakeup({ streamId: 'failed-run' }, stoppedRuns.get('session-1')),
        false,
      )
    }
    assert.equal(
      shouldResumeRuntimeWakeup({ streamId: 'new-run' }, stoppedRuns.get('session-1')),
      true,
    )
    assert.equal(stoppedRuns.has('session-2'), false)
  }
})

test('a failed tool does not stop a live agent recovering from that tool error', () => {
  const stoppedRuns = new Map<string, string>()

  rememberTerminalRuntimeStream(stoppedRuns, 'session-1', 'live-run', {
    type: 'sse',
    data: { type: 'tool-output-error', errorText: 'No space left on device' },
  })
  assert.equal(
    shouldResumeRuntimeWakeup({ streamId: 'live-run' }, stoppedRuns.get('session-1')),
    true,
  )
})

test('does not reattach the stream the user just stopped', () => {
  assert.equal(shouldResumeRuntimeWakeup({ streamId: 'stream-1' }, 'stream-1'), false)
})

test('allows a later runtime-owned stream to wake the conversation', () => {
  assert.equal(shouldResumeRuntimeWakeup({ streamId: 'stream-2' }, 'stream-1'), true)
})

test('probe fetches nothing while the stored count matches the client', () => {
  assert.equal(wakeupTranscriptTail(31, 0, 31, 100), 0)
  assert.equal(wakeupTranscriptTail(140, 40, 100, 100), 0)
  assert.equal(wakeupTranscriptTail(30, 0, 31, 100), 0)
})

test('probe fetches the new messages plus the last one the client held', () => {
  assert.equal(wakeupTranscriptTail(32, 0, 31, 100), 2)
  assert.equal(wakeupTranscriptTail(143, 40, 100, 100), 4)
})

test('probe caps the fetch at the tail limit', () => {
  assert.equal(wakeupTranscriptTail(500, 0, 31, 100), 100)
})

test('a tail that overlaps or touches the local end leaves no hole', () => {
  assert.equal(wakeupTailLeavesHole(30, 0, 31), false)
  assert.equal(wakeupTailLeavesHole(31, 0, 31), false)
  assert.equal(wakeupTailLeavesHole(139, 40, 100), false)
})

test('a tail pushed past the local end by concurrent growth leaves a hole', () => {
  assert.equal(wakeupTailLeavesHole(32, 0, 31), true)
  assert.equal(wakeupTailLeavesHole(141, 40, 100), true)
})

test('background results refresh existing cards without another message or active run', () => {
  assert.equal(wakeupTranscriptTail(31, 0, 31, 100, true), 31)
  assert.equal(wakeupTranscriptTail(140, 40, 100, 100, true), 100)
  assert.equal(wakeupTranscriptTail(30, 0, 31, 100, true), 0)
  assert.equal(wakeupTranscriptTail(1200, 0, 1200, 100, true), 1000)
})
