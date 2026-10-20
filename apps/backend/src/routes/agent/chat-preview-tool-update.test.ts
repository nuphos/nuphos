import { describe, expect, test } from 'bun:test'

import {
  closeCallsCutOffBySteer,
  handlePreviewToolUpdate,
  openToolCalls,
} from './chat-preview-tool-update'
import { INTERRUPTED_TOOL_ERROR } from '@/lib/claude-code-preview/preview-transcript'

import type { createPreviewToolLog } from './chat-preview-run'

type ToolLog = ReturnType<typeof createPreviewToolLog>

// chat-preview-run sits in the routes/agent import cycle; a hand-rolled log
// keeps this unit test out of it.
function toolLog(): ToolLog {
  const states: ToolLog['states'] = new Map()

  return {
    states,
    record: () => {},
    complete: () => {},
    fail: (_id, error) => error,
    list: () => [],
  }
}

describe('handlePreviewToolUpdate', () => {
  test('retains disk-full details when the adapter only sends rawOutput', () => {
    const frames: Record<string, unknown>[] = []
    const failures: string[] = []
    const log = toolLog()

    log.fail = (_id, error) => {
      failures.push(error)

      return error
    }

    handlePreviewToolUpdate((frame) => frames.push(frame), log, {
      kind: 'tool',
      toolCallId: 'write-1',
      title: 'Write file',
      status: 'failed',
      rawOutput: 'ENOSPC: no space left on device',
    })
    expect(failures).toEqual(['ENOSPC: no space left on device'])
    expect(frames.at(-1)).toEqual({
      type: 'tool-output-error',
      toolCallId: 'write-1',
      errorText: failures[0],
    })
  })
  test('a revealed permission request surfaces a hidden nuphos-tools card', () => {
    const frames: Record<string, unknown>[] = []
    const log = toolLog()
    const emit = (frame: Record<string, unknown>) => frames.push(frame)

    handlePreviewToolUpdate(emit, log, {
      kind: 'tool',
      toolCallId: 'toolu_1',
      title: 'memory_get',
      mcpToolId: 'mcp__nuphos-tools__memory_get',
      status: 'pending',
      rawInput: { memoryId: 'abc' },
    })
    expect(frames).toEqual([])

    handlePreviewToolUpdate(emit, log, {
      kind: 'tool',
      toolCallId: 'toolu_1',
      title: 'memory_get',
      status: 'pending',
      revealed: true,
    })
    expect(frames).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'toolu_1',
        toolName: 'memory_get',
        input: { memoryId: 'abc' },
      },
    ])

    handlePreviewToolUpdate(emit, log, {
      kind: 'tool',
      toolCallId: 'toolu_1',
      title: 'memory_get',
      status: 'completed',
      rawOutput: { ok: true },
    })
    expect(frames.at(-1)).toEqual({
      type: 'tool-output-available',
      toolCallId: 'toolu_1',
      output: { ok: true },
    })
  })
})

describe('closeCallsCutOffBySteer', () => {
  function steppedLog(steps: { id: string; input: unknown; output?: unknown }[]): ToolLog {
    const log = toolLog()
    const failed = new Map<string, string>()

    for (const step of steps) {
      log.states.set(step.id, {
        name: 'Terminal',
        toolName: 'Terminal',
        input: step.input,
        hidden: false,
      })
    }
    log.fail = (id, error) => {
      failed.set(id, error)

      return error
    }
    log.list = () =>
      steps.map((step) => ({
        toolCallId: step.id,
        toolName: 'Terminal',
        input: step.input,
        ...(step.output === undefined ? {} : { output: step.output }),
        ...(failed.has(step.id) ? { errorText: failed.get(step.id) } : {}),
      }))

    return log
  }

  test('closes a call the steer cut off before its input arrived', () => {
    const frames: Record<string, unknown>[] = []
    const log = steppedLog([{ id: 'cut', input: {} }])

    closeCallsCutOffBySteer((frame) => frames.push(frame), log, openToolCalls(log))
    expect(frames).toEqual([
      { type: 'tool-output-error', toolCallId: 'cut', errorText: INTERRUPTED_TOOL_ERROR },
    ])
    expect(openToolCalls(log)).toEqual([])
  })
  test('leaves calls that have input or already finished', () => {
    const frames: Record<string, unknown>[] = []
    const log = steppedLog([
      { id: 'background', input: { command: 'sleep 600' } },
      { id: 'done', input: {}, output: 'ok' },
    ])

    closeCallsCutOffBySteer((frame) => frames.push(frame), log, ['background', 'done'])
    expect(frames).toEqual([])
    expect(openToolCalls(log)).toEqual(['background'])
  })
  test('ignores calls opened after the steer', () => {
    const frames: Record<string, unknown>[] = []
    const log = steppedLog([{ id: 'new', input: {} }])

    closeCallsCutOffBySteer((frame) => frames.push(frame), log, [])
    expect(frames).toEqual([])
  })
})
