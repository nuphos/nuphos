import { expect, test } from 'bun:test'

import { isTrackedCodexAsyncTaskToolUpdate, observeCodexAsyncTask } from './codex-async-task-wakeup'

import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { TeamSession } from './team-openab-runtime'

test('a stopped or cancelled background task no longer owns its tool call', () => {
  for (const state of ['stopped', 'cancelled'] as const) {
    const session = {} as TeamSession
    const toolUpdate = {
      kind: 'agent',
      update: { kind: 'tool', toolCallId: 'tool-1' },
    } as OpenAbSessionUpdate

    observeCodexAsyncTask(session, {
      kind: 'async-task',
      asyncTaskId: 'task-1',
      phase: 'spawned',
      toolCallId: 'tool-1',
    })
    expect(isTrackedCodexAsyncTaskToolUpdate(session, toolUpdate)).toBe(true)
    observeCodexAsyncTask(session, {
      kind: 'async-task',
      asyncTaskId: 'task-1',
      phase: 'terminal',
      state,
    })
    expect(isTrackedCodexAsyncTaskToolUpdate(session, toolUpdate)).toBe(false)
  }
})
