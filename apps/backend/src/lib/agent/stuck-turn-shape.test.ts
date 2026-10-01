import { describe, expect, test } from 'bun:test'

import { probeWindow, strandedToolCalls, turnHasText } from '@/lib/agent/stuck-turn-shape'

const tool = (over: Record<string, unknown> = {}) => ({
  type: 'tool',
  toolName: 'local_exec',
  state: 'input-available',
  ...over,
})

describe('strandedToolCalls', () => {
  test('reports a tool call left unanswered', () => {
    expect(strandedToolCalls([{ type: 'step-start' }, tool()])).toEqual(['local_exec'])
  })

  test('says nothing about a call that produced output', () => {
    expect(strandedToolCalls([tool({ state: 'output-available' })])).toEqual([])
    expect(strandedToolCalls([tool({ state: 'output-error' })])).toEqual([])
  })

  // The one shape that looks identical in the transcript but is healthy: the
  // turn is parked on a human decision. Paging on these would make the signal
  // useless, because every approval prompt would trip it.
  test('leaves a call awaiting the user decision alone', () => {
    expect(strandedToolCalls([tool({ state: 'approval-requested' })])).toEqual([])
    expect(strandedToolCalls([tool({ approval: { id: 'a1' } })])).toEqual([])
    expect(strandedToolCalls([tool({ approval: { id: 'a1', approved: false } })])).toEqual([])
  })

  test('an approved call that then went unanswered is still stranded', () => {
    expect(strandedToolCalls([tool({ approval: { id: 'a1', approved: true } })])).toEqual([
      'local_exec',
    ])
  })

  test('reports every stranded call, server-side ones included', () => {
    expect(strandedToolCalls([tool(), tool({ toolName: 'bash' })])).toEqual(['local_exec', 'bash'])
  })

  test('survives junk parts without throwing', () => {
    expect(strandedToolCalls([null, undefined, 'text', 42, tool({ toolName: 7 })])).toEqual([])
  })
})

describe('probeWindow', () => {
  // Consecutive runs must tile the timeline exactly: a gap drops turns on the
  // floor, an overlap reports the same turn twice and inflates the metric.
  test('tiles with the previous run, without gap or overlap', () => {
    const now = 1_800_000_000_000
    const interval = 10 * 60_000
    const current = probeWindow(now)
    const previous = probeWindow(now - interval)

    expect(previous.to.getTime()).toBe(current.from.getTime())
  })

  test('only looks at turns already past the stranded grace period', () => {
    const now = 1_800_000_000_000

    expect(now - probeWindow(now).to.getTime()).toBe(10 * 60_000)
  })
})

describe('turnHasText', () => {
  // Distinguishes "cut off mid-work" from "spoke, then stranded a follow-up
  // call" — the two shapes have had different causes, so the alert carries it.
  test('a turn that only made tool calls has no text', () => {
    expect(turnHasText([{ type: 'step-start' }, { type: 'tool', toolName: 'bash' }])).toBe(false)
  })

  test('whitespace is not speech', () => {
    expect(turnHasText([{ type: 'text', text: '   \n' }])).toBe(false)
  })

  test('real text counts', () => {
    expect(turnHasText([{ type: 'text', text: 'checking the cluster' }])).toBe(true)
  })
})
