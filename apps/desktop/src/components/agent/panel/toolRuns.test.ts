import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import { foldedTurnLayout, segmentParts } from './toolRuns.ts'

import type { Part } from './parts.ts'

let applyEvent: (parts: Part[], event: Record<string, unknown>) => Part[]

before(async () => {
  mock.module('./stall.ts', {
    namedExports: { normalizeAgentError: (text: string) => text, uid: () => 'uid' },
  })
  mock.module('./streamText.ts', { namedExports: { appendTextDelta: (parts: Part[]) => parts } })
  ;({ applyEvent } = await import('./applyEvent.ts'))
})

let nextId = 0
const tool = (toolName = 'bash'): Part => ({
  type: 'tool',
  toolCallId: `call-${String(++nextId)}`,
  toolName,
  state: 'output-available',
})
const text = (t: string): Part => ({ type: 'text', text: t })

test('consecutive plain tool calls fold into one run', () => {
  const parts = [text('Checking.'), tool(), tool(), tool(), text('Done.')]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'part', index: 0 },
    { kind: 'toolRun', indices: [1, 2, 3] },
    { kind: 'part', index: 4 },
  ])
})

test('text between tool calls splits the run so each call keeps its place', () => {
  const parts = [tool(), tool(), text('Now the second half.'), tool(), tool()]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'toolRun', indices: [0, 1] },
    { kind: 'part', index: 2 },
    { kind: 'toolRun', indices: [3, 4] },
  ])
})

test('a lone tool call is already a run, so the slot never jumps when the next call lands', () => {
  const parts = [text('Hi'), tool(), text('Bye')]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'part', index: 0 },
    { kind: 'toolRun', indices: [1] },
    { kind: 'part', index: 2 },
  ])
})

test('parts that render nothing neither join nor split a run', () => {
  const parts: Part[] = [tool(), { type: 'step-start' }, tool('skill'), text('   '), tool()]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'part', index: 1 },
    { kind: 'part', index: 2 },
    { kind: 'part', index: 3 },
    { kind: 'toolRun', indices: [0, 4] },
  ])
})

test('card tools split a run while interleaved thinking stays inside it', () => {
  const parts: Part[] = [
    tool(),
    tool(),
    tool('render_chart'),
    tool(),
    { type: 'reasoning', text: 'hmm' },
    tool(),
    tool(),
  ]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'toolRun', indices: [0, 1] },
    { kind: 'part', index: 2 },
    { kind: 'toolRun', indices: [3, 4, 5, 6] },
  ])
})

test('narration between calls splits the run even beside thinking', () => {
  const reasoning: Part = { type: 'reasoning', text: 'inspect the result' }

  for (const process of [
    [reasoning, text('Narrating.')],
    [text('Narrating.'), reasoning],
  ]) {
    const parts = [tool(), ...process, tool()]

    assert.deepEqual(segmentParts(parts, 0, parts.length), [
      { kind: 'toolRun', indices: [0] },
      { kind: 'part', index: 1 },
      { kind: 'part', index: 2 },
      { kind: 'toolRun', indices: [3] },
    ])
  }
})

test('thinking before the first tool remains a standalone disclosure', () => {
  const parts: Part[] = [
    { type: 'reasoning', text: 'choose an approach' },
    tool(),
    { type: 'reasoning', text: 'inspect the first result' },
    tool(),
  ]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'part', index: 0 },
    { kind: 'toolRun', indices: [1, 2, 3] },
  ])
})

test('thinking after the last tool remains a standalone disclosure', () => {
  const parts: Part[] = [tool(), { type: 'reasoning', text: 'prepare the answer' }]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'toolRun', indices: [0] },
    { kind: 'part', index: 1 },
  ])
})

test('thinking between every call keeps the whole sequence in one run', () => {
  const parts: Part[] = [
    { type: 'reasoning', text: 'check the PR' },
    text('Re-checking the PR state.'),
    { ...tool(), state: 'output-error', errorText: 'exit 1' },
    { type: 'reasoning', text: 'retry with the absolute path' },
    tool(),
    { type: 'reasoning', text: 'verify the merge commit' },
    tool(),
    text('It is merged.'),
  ]

  assert.deepEqual(segmentParts(parts, 0, parts.length), [
    { kind: 'part', index: 0 },
    { kind: 'part', index: 1 },
    { kind: 'toolRun', indices: [2, 3, 4, 5, 6] },
    { kind: 'part', index: 7 },
  ])
})

function replay(events: Record<string, unknown>[]): Part[] {
  return events.reduce<Part[]>((parts, event) => applyEvent(parts, event), [])
}

function toolEvents(toolCallId: string): Record<string, unknown>[] {
  return [
    { type: 'tool-input-available', toolCallId, toolName: 'bash', input: { command: 'ls' } },
    { type: 'tool-output-available', toolCallId, output: 'ok' },
  ]
}

const runtimeThinking: Record<string, (text: string) => Record<string, unknown>[]> = {
  'built-in agent': (thought) => [
    { type: 'start-step' },
    { type: 'reasoning-start', id: thought },
    { type: 'reasoning-delta', id: thought, delta: thought.slice(0, 4) },
    { type: 'reasoning-delta', id: thought, delta: thought.slice(4) },
    { type: 'reasoning-end', id: thought },
  ],
  'OpenAB Claude Code / Codex': (thought) => [
    { type: 'reasoning-delta', delta: thought.slice(0, 4) },
    { type: 'reasoning-delta', delta: thought.slice(4) },
  ],
}

function isStepStart(parts: Part[], index: number): boolean {
  return parts[index].type === 'step-start'
}

for (const [runtime, thinking] of Object.entries(runtimeThinking)) {
  test(`${runtime}: tool, thinking, tool, thinking, tool streams into one run`, () => {
    const parts = replay([
      ...toolEvents('a'),
      ...thinking('inspect the first result'),
      ...toolEvents('b'),
      ...thinking('inspect the second result'),
      ...toolEvents('c'),
    ])
    const segments = segmentParts(parts, 0, parts.length)
    const runs = segments.filter((segment) => segment.kind === 'toolRun')

    assert.equal(runs.length, 1)
    assert.deepEqual(
      runs[0].indices.map((index) => parts[index].type),
      ['tool', 'reasoning', 'tool', 'reasoning', 'tool'],
    )
    assert.ok(
      segments.every((segment) => segment.kind === 'toolRun' || isStepStart(parts, segment.index)),
    )
  })
}

test('reloaded transcripts of every runtime keep tool, thinking, tool, thinking, tool in one run', () => {
  const builtIn: Part[] = [
    tool(),
    { type: 'reasoning', text: 'inspect', startedAt: 1, completedAt: 2 },
    tool(),
    { type: 'reasoning', text: 'verify', startedAt: 3, completedAt: 4 },
    tool(),
  ]
  const openAb: Part[] = [
    tool(),
    { type: 'reasoning', text: 'inspect' },
    tool(),
    { type: 'reasoning', text: 'verify' },
    tool(),
  ]

  for (const parts of [builtIn, openAb]) {
    assert.deepEqual(segmentParts(parts, 0, parts.length), [
      { kind: 'toolRun', indices: [0, 1, 2, 3, 4] },
    ])
  }
})

test('the range bounds are respected', () => {
  const parts = [tool(), tool(), tool(), tool()]

  assert.deepEqual(segmentParts(parts, 1, 3), [{ kind: 'toolRun', indices: [1, 2] }])
})

test('a folded turn lifts its plan cards out of the fold, in order', () => {
  const parts: Part[] = [
    { type: 'reasoning', text: 'look around' },
    tool(),
    tool('plan_create'),
    tool('plan_update'),
    tool('database_change_propose'),
    text('Here is the plan.'),
  ]

  assert.deepEqual(foldedTurnLayout(parts, 0, 5), { planIndices: [2, 4], foldHasWork: true })
})

test('a fold that only held a plan has no work left to show', () => {
  const parts: Part[] = [tool('plan_create'), tool('plan_get'), text('Plan ready.')]

  assert.deepEqual(foldedTurnLayout(parts, 0, 2), { planIndices: [0], foldHasWork: false })
})

test('an errored plan call stays in the fold as a tool row', () => {
  const failed: Part = { ...tool('plan_create'), state: 'output-error' } as Part

  assert.deepEqual(foldedTurnLayout([failed, text('Sorry.')], 0, 1), {
    planIndices: [],
    foldHasWork: true,
  })
})
