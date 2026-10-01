import assert from 'node:assert/strict'
import test from 'node:test'

import { applyToolOutputDelta } from './toolOutputDelta.ts'

import type { Part, ToolPart } from './parts.ts'

function tool(parts: Part[]): ToolPart {
  const part = parts.find((candidate): candidate is ToolPart => candidate.type === 'tool')

  assert.ok(part)

  return part
}

test('tool output deltas append stdout and stderr independently', () => {
  let parts: Part[] = [
    {
      type: 'tool',
      toolCallId: 'call-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'long-command' },
    },
  ]

  parts = applyToolOutputDelta(parts, {
    toolCallId: 'call-1',
    stream: 'stdout',
    delta: 'first\n',
  })
  parts = applyToolOutputDelta(parts, {
    toolCallId: 'call-1',
    stream: 'stderr',
    delta: 'warning\n',
  })
  parts = applyToolOutputDelta(parts, {
    toolCallId: 'call-1',
    stream: 'stdout',
    delta: 'last\n',
  })

  assert.deepEqual(tool(parts).liveOutput, {
    stdout: 'first\nlast\n',
    stderr: 'warning\n',
  })
})

test('an early output delta creates a placeholder that preserves its output', () => {
  const parts = applyToolOutputDelta([], {
    toolCallId: 'call-early',
    toolName: 'bash',
    stream: 'stdout',
    delta: 'already running\n',
  })

  assert.equal(tool(parts).toolName, 'bash')
  assert.equal(tool(parts).liveOutput?.stdout, 'already running\n')
})

test('live output retains the newest bounded tail', () => {
  const parts = applyToolOutputDelta([], {
    toolCallId: 'call-large',
    stream: 'stdout',
    delta: `old${'x'.repeat(100_000)}new`,
  })
  const stdout = tool(parts).liveOutput?.stdout ?? ''

  assert.equal(stdout.length, 100_000)
  assert.equal(stdout.startsWith('old'), false)
  assert.equal(stdout.endsWith('new'), true)
})
