import { describe, expect, test } from 'bun:test'

import {
  closeCallsCutOffBySteer,
  handlePreviewToolUpdate,
  oneLineTitle,
  openToolCalls,
} from './chat-preview-tool-update'
import { parseToolUpdate } from '@/lib/claude-code-preview/preview-agent-update'
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
  test('a Codex nuphos-tools call is recorded as the classic tool with its own input', () => {
    const frames: Record<string, unknown>[] = []
    const recorded = new Map<string, unknown>()
    const log = toolLog()

    log.record = (toolCallId, name, input) => {
      recorded.set(toolCallId, { name, input })
    }
    const args = {
      category: 'integration',
      providers: ['cloudflare'],
      question: 'Can you connect the Cloudflare account?',
      label: 'Enabling Cloudflare access',
    }

    const rawInput = { server: 'nuphos-tools', tool: 'request_user_decision', arguments: args }
    // codex-acp starts an MCP call as `mcp.<server>.<tool>` with its arguments
    // wrapped, then completes it with the wrapped input again but no title.
    const updates = [
      { title: 'mcp.nuphos-tools.request_user_decision', status: 'in_progress', rawInput },
      { status: 'completed', rawInput, rawOutput: { result: { content: [] }, error: null } },
    ]

    for (const payload of updates) {
      const update = parseToolUpdate('call_1', payload)

      if (update.kind === 'tool') handlePreviewToolUpdate((f) => frames.push(f), log, update)
    }
    expect([...recorded]).toEqual([['call_1', { name: 'request_user_decision', input: args }]])
    expect(frames).toEqual([])
  })
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
  function steppedLog(steps: { id: string; input?: unknown; output?: unknown }[]): ToolLog {
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
    const log = steppedLog([{ id: 'cut' }])

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
      { id: 'no-args', input: {} },
      { id: 'done', output: 'ok' },
    ])

    closeCallsCutOffBySteer((frame) => frames.push(frame), log, ['background', 'no-args', 'done'])
    expect(frames).toEqual([])
    expect(openToolCalls(log)).toEqual(['background', 'no-args'])
  })
  test('ignores calls opened after the steer', () => {
    const frames: Record<string, unknown>[] = []
    const log = steppedLog([{ id: 'new' }])

    closeCallsCutOffBySteer((frame) => frames.push(frame), log, [])
    expect(frames).toEqual([])
  })
})

describe('oneLineTitle', () => {
  test('a multi-line command title keeps its first line; the input holds the rest', () => {
    expect(oneLineTitle("python3 - <<'EOF'\nprint(1)\nEOF")).toBe("python3 - <<'EOF'")
  })

  test('a long line is cut with an ellipsis', () => {
    const title = oneLineTitle(`echo ${'x'.repeat(500)}`)

    expect(title).toHaveLength(120)
    expect(title.endsWith('…')).toBe(true)
  })

  test('a short title is unchanged', () => {
    expect(oneLineTitle('Run kubectl get pods')).toBe('Run kubectl get pods')
  })
})
