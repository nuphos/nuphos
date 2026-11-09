import { describe, expect, test } from 'bun:test'

import { uiMessagesToTranscript } from './transcript'

import type { UIMessage } from 'ai'

function transcriptOf(parts: unknown[]) {
  return uiMessagesToTranscript([
    { id: 'assistant-1', role: 'assistant', parts } as unknown as UIMessage,
  ])[0]
}

const tool = (fields: Record<string, unknown>) => ({
  type: 'tool',
  toolCallId: 'call-1',
  toolName: 'Read',
  state: 'output-available',
  input: { path: 'flag.ts' },
  output: 'ok',
  ...fields,
})

describe('the durable transcript and sub-agent attribution', () => {
  test('keeps the spawning call id and the sub-agent marker on the stored part', () => {
    expect(
      transcriptOf([
        tool({ toolCallId: 'task-1', toolName: 'Agent', subagent: true }),
        tool({ toolCallId: 'child-1', parentToolUseId: 'task-1' }),
      ])?.parts,
    ).toEqual([
      expect.objectContaining({ toolCallId: 'task-1', subagent: true }),
      expect.objectContaining({ toolCallId: 'child-1', parentToolUseId: 'task-1' }),
    ])
  })

  test('a transcript written before sub-agent attribution stores exactly as before', () => {
    expect(transcriptOf([tool({})])?.parts).toEqual([
      {
        type: 'tool',
        toolCallId: 'call-1',
        toolName: 'Read',
        state: 'output-available',
        input: { path: 'flag.ts' },
        output: 'ok',
      },
    ])
  })

  test('a deeper nesting chain keeps the immediate parent without inventing depth', () => {
    expect(
      transcriptOf([
        tool({ toolCallId: 'task-1', toolName: 'Agent', subagent: true }),
        tool({ toolCallId: 'child-1', parentToolUseId: 'task-1' }),
        tool({ toolCallId: 'grandchild-1', parentToolUseId: 'child-1' }),
      ])?.parts.map((part) => {
        const value = part as { toolCallId?: string; parentToolUseId?: string }

        return [value.toolCallId, value.parentToolUseId]
      }),
    ).toEqual([
      ['task-1', undefined],
      ['child-1', 'task-1'],
      ['grandchild-1', 'child-1'],
    ])
  })

  test('malformed client-supplied attribution is dropped like any unknown field', () => {
    const parts =
      transcriptOf([
        tool({ toolCallId: 'child-1', parentToolUseId: 42, subagent: 'yes' }),
        tool({ toolCallId: 'child-2', parentToolUseId: '' }),
      ])?.parts ?? []

    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part).not.toHaveProperty('parentToolUseId')
      expect(part).not.toHaveProperty('subagent')
    }
  })
})
