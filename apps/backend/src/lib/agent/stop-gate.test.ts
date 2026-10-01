import { describe, expect, test } from 'bun:test'

import {
  MAX_STOP_GATE_CONTINUATIONS,
  RUNAWAY_FAILURE_THRESHOLD,
  detectRunawayToolFailures,
  evaluateStopGate,
  finalAssistantProse,
  judgeResultToVerdict,
  latestRealUserText,
  planProgress,
  renderActivePlanStatusBlock,
  runawayWrapUpText,
} from './stop-gate'

import type { Plan } from './plans'

function makePlan(
  status: Plan['status'],
  commandStatuses: ('pending' | 'running' | 'done' | 'failed')[] = ['pending'],
): Plan {
  return {
    createdBy: 'user-1',
    number: 7,
    title: 'Rotate database credentials',
    status,
    steps: [
      {
        title: 'Step one',
        jobs: [
          {
            title: 'Job one',
            commands: commandStatuses.map((s) => ({
              command: 'kubectl get pods',
              status: s,
            })),
          },
        ],
      },
    ],
    createdAt: new Date('2026-07-04T00:00:00Z'),
    updatedAt: new Date('2026-07-04T00:00:00Z'),
  }
}

const baseInput = {
  finalProse: 'All done. The deployment is healthy again.',
  activePlans: [] as Plan[],
  toolResultErrors: [],
  priorContinuations: 0,
}

describe('finalAssistantProse', () => {
  test('returns text of the last assistant message', () => {
    const prose = finalAssistantProse([
      { role: 'assistant', content: [{ type: 'text', text: 'earlier' }] },
      { role: 'tool', content: [] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'Final answer.' },
        ],
      },
    ])

    expect(prose).toBe('Final answer.')
  })

  test('string content is accepted', () => {
    expect(finalAssistantProse([{ role: 'assistant', content: 'plain string' }])).toBe(
      'plain string',
    )
  })

  test('tool-call-only final message counts as silent', () => {
    const prose = finalAssistantProse([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'x', toolName: 'bash', input: {} }],
      },
    ])

    expect(prose).toBe('')
  })

  test('non-array input counts as silent', () => {
    expect(finalAssistantProse(undefined)).toBe('')
    expect(finalAssistantProse('nope')).toBe('')
  })
})

describe('evaluateStopGate', () => {
  test('allows a normal turn with prose and no gated plans', () => {
    expect(evaluateStopGate(baseInput)).toEqual({ behavior: 'allow' })
  })

  test('vetoes when a plan is executing with unfinished commands', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      activePlans: [makePlan('executing', ['done', 'pending'])],
    })

    expect(verdict.behavior).toBe('continue')
    if (verdict.behavior === 'continue') {
      expect(verdict.reason).toBe('plan-execution-incomplete')
      expect(verdict.nudge).toContain('Plan #7')
      expect(verdict.nudge).toContain('1 unfinished')
    }
  })

  test('vetoes when an executing plan finished all commands but the status was never reconciled', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      activePlans: [makePlan('executing', ['done', 'done'])],
    })

    expect(verdict.behavior).toBe('continue')
  })

  test('vetoes when an approved plan was never started', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      activePlans: [makePlan('approved')],
    })

    expect(verdict.behavior).toBe('continue')
  })

  test('a proposed plan awaiting approval is a correct stop', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      activePlans: [makePlan('proposed')],
    })

    expect(verdict).toEqual({ behavior: 'allow' })
  })

  test('a structured user-only decision is a correct stop even with executing work', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      awaitingUserDecision: true,
      activePlans: [makePlan('executing', ['done', 'pending'])],
      finalProse: '临时 Tunnel 可以继续使用，还是等永久地址？',
    })

    expect(verdict).toEqual({ behavior: 'allow' })
  })

  test('decision signal still rejects a silent turn', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      awaitingUserDecision: true,
      finalProse: '',
    })

    expect(verdict.behavior).toBe('continue')
    if (verdict.behavior === 'continue') expect(verdict.reason).toBe('silent-turn-end')
  })

  test('vetoes a silent turn end and cites tool errors in the nudge', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      finalProse: '',
      toolResultErrors: [{ toolName: 'bash', message: 'command timed out' }],
    })

    expect(verdict.behavior).toBe('continue')
    if (verdict.behavior === 'continue') {
      expect(verdict.reason).toBe('silent-turn-end')
      expect(verdict.nudge).toContain('command timed out')
    }
  })

  test('plan rule takes precedence over silent-end rule', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      finalProse: '',
      activePlans: [makePlan('executing')],
    })

    if (verdict.behavior === 'continue') expect(verdict.reason).toBe('plan-execution-incomplete')
    else throw new Error('expected continue')
  })

  test('fuse: allows the stop once the continuation ceiling is reached', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      finalProse: '',
      activePlans: [makePlan('executing')],
      priorContinuations: MAX_STOP_GATE_CONTINUATIONS,
    })

    expect(verdict).toEqual({ behavior: 'allow' })
  })

  test('nudge states the attempt number', () => {
    const verdict = evaluateStopGate({
      ...baseInput,
      finalProse: '',
      priorContinuations: 1,
    })

    if (verdict.behavior !== 'continue') throw new Error('expected continue')
    expect(verdict.nudge).toContain(
      `continuation 2 of at most ${String(MAX_STOP_GATE_CONTINUATIONS)}`,
    )
  })
})

describe('judgeResultToVerdict', () => {
  test('null judge result (fail-open) keeps the deterministic verdict', () => {
    expect(judgeResultToVerdict(null, 0)).toBeNull()
  })

  test('passing judgement returns null', () => {
    expect(judgeResultToVerdict({ punt: false, reason: '' }, 0)).toBeNull()
  })

  test('a punt vetoes with the judge reason in the nudge', () => {
    const verdict = judgeResultToVerdict({ punt: true, reason: 'asked for namespace' }, 1)

    expect(verdict?.behavior).toBe('continue')
    if (verdict?.behavior === 'continue') {
      expect(verdict.reason).toBe('asked-answerable-question')
      expect(verdict.nudge).toContain('asked for namespace')
    }
  })

  test('fuse applies to judge verdicts too', () => {
    expect(
      judgeResultToVerdict({ punt: true, reason: 'r' }, MAX_STOP_GATE_CONTINUATIONS),
    ).toBeNull()
  })
})

describe('latestRealUserText', () => {
  test('returns the latest real user message, skipping synthetic continuations', () => {
    const text = latestRealUserText([
      { role: 'user', content: '幫我查 checkout-api 為什麼變慢' },
      { role: 'assistant', content: [{ type: 'text', text: 'working…' }] },
      {
        role: 'user',
        content:
          '[automatic continuation — not typed by the user] The previous assistant turn was interrupted…',
      },
    ])

    expect(text).toBe('幫我查 checkout-api 為什麼變慢')
  })

  test('reads text parts from array content', () => {
    const text = latestRealUserText([
      { role: 'user', content: [{ type: 'text', text: 'deploy it' }, { type: 'file' }] },
    ])

    expect(text).toBe('deploy it')
  })

  test('empty when there is no real user message', () => {
    expect(latestRealUserText([{ role: 'assistant', content: 'hi' }])).toBe('')
    expect(latestRealUserText(undefined)).toBe('')
  })
})

type MsgPart = Record<string, unknown>

function toolCallMsg(toolCallId: string, toolName: string, input: unknown): MsgPart {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName, input }],
  }
}

function toolResultMsg(toolCallId: string, exitCode: number): MsgPart {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        output: { type: 'json', value: { stdout: '', stderr: 'boom', exitCode } },
      },
    ],
  }
}

function failingSequence(
  n: number,
  input: unknown = { command: 'kubectl get pods -n x' },
  idPrefix = 'c',
) {
  const messages: MsgPart[] = []

  for (let i = 0; i < n; i++) {
    messages.push(
      toolCallMsg(`${idPrefix}${String(i)}`, 'bash', input),
      toolResultMsg(`${idPrefix}${String(i)}`, 1),
    )
  }

  return messages
}

describe('detectRunawayToolFailures', () => {
  test('detects the threshold of identical consecutive failures', () => {
    const detection = detectRunawayToolFailures(failingSequence(RUNAWAY_FAILURE_THRESHOLD))

    expect(detection).toEqual({ toolName: 'bash', count: RUNAWAY_FAILURE_THRESHOLD })
  })

  test('below threshold returns null', () => {
    expect(detectRunawayToolFailures(failingSequence(RUNAWAY_FAILURE_THRESHOLD - 1))).toBeNull()
  })

  test('a trailing success resets the streak', () => {
    const messages = [
      ...failingSequence(RUNAWAY_FAILURE_THRESHOLD),
      toolCallMsg('ok', 'bash', { command: 'kubectl get pods -n x' }),
      toolResultMsg('ok', 0),
    ]

    expect(detectRunawayToolFailures(messages)).toBeNull()
  })

  test('changed input breaks the streak — retrying with tweaks is healthy', () => {
    const messages = [
      ...failingSequence(2, { command: 'kubectl get pods -n a' }, 'a'),
      ...failingSequence(2, { command: 'kubectl get pods -n b' }, 'b'),
    ]

    expect(detectRunawayToolFailures(messages)).toBeNull()
  })

  test('error-text outputs count as failures', () => {
    const messages: MsgPart[] = []

    for (let i = 0; i < RUNAWAY_FAILURE_THRESHOLD; i++) {
      messages.push(toolCallMsg(`e${String(i)}`, 'web_fetch', { url: 'https://x' }), {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `e${String(i)}`,
            output: { type: 'error-text', value: 'nope' },
          },
        ],
      })
    }
    expect(detectRunawayToolFailures(messages)?.toolName).toBe('web_fetch')
  })

  test('assistant prose between retries does not break the streak', () => {
    const messages = [
      toolCallMsg('a', 'bash', { command: 'x' }),
      toolResultMsg('a', 1),
      { role: 'assistant', content: [{ type: 'text', text: 'let me try again' }] },
      toolCallMsg('b', 'bash', { command: 'x' }),
      toolResultMsg('b', 1),
      toolCallMsg('c', 'bash', { command: 'x' }),
      toolResultMsg('c', 1),
    ]

    expect(detectRunawayToolFailures(messages)?.count).toBe(3)
  })

  test('non-array input returns null', () => {
    expect(detectRunawayToolFailures(undefined)).toBeNull()
  })

  test('varying per-call labels do NOT split the streak — label is presentation metadata', () => {
    const messages: MsgPart[] = []
    const labels = ['Checking pods', 'Retrying pod list', 'Looking at pods again']

    for (let i = 0; i < RUNAWAY_FAILURE_THRESHOLD; i++) {
      messages.push(
        toolCallMsg(`l${String(i)}`, 'bash', {
          label: labels[i],
          command: 'kubectl get pods -n x',
        }),
        toolResultMsg(`l${String(i)}`, 1),
      )
    }
    expect(detectRunawayToolFailures(messages)).toEqual({
      toolName: 'bash',
      count: RUNAWAY_FAILURE_THRESHOLD,
    })
  })

  test('key order variance does not split the streak', () => {
    const messages: MsgPart[] = [
      toolCallMsg('k0', 'bash', { command: 'x', timeout: 5 }),
      toolResultMsg('k0', 1),
      toolCallMsg('k1', 'bash', { timeout: 5, command: 'x' }),
      toolResultMsg('k1', 1),
      toolCallMsg('k2', 'bash', { command: 'x', timeout: 5 }),
      toolResultMsg('k2', 1),
    ]

    expect(detectRunawayToolFailures(messages)?.count).toBe(3)
  })

  test('an orphan tool-result (healed-away call) is skipped, not streak-terminating', () => {
    const messages = [
      ...failingSequence(RUNAWAY_FAILURE_THRESHOLD, { command: 'x' }, 'real'),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'orphan-no-call',
            output: { type: 'json', value: { exitCode: 0 } },
          },
        ],
      },
    ]

    expect(detectRunawayToolFailures(messages)?.count).toBe(RUNAWAY_FAILURE_THRESHOLD)
  })

  test('a real user message terminates the scan — prior-turn failures are stale', () => {
    const messages = [
      ...failingSequence(RUNAWAY_FAILURE_THRESHOLD, { command: 'kubectl get pods' }, 'old'),
      { role: 'user', content: 'I fixed the credentials, try again' },
      toolCallMsg('fresh', 'bash', { command: 'kubectl get pods' }),
      toolResultMsg('fresh', 1),
    ]

    expect(detectRunawayToolFailures(messages)).toBeNull()
  })

  test('synthetic continuation user turns do NOT terminate the scan', () => {
    const messages = [
      ...failingSequence(RUNAWAY_FAILURE_THRESHOLD - 1, { command: 'x' }, 'a'),
      {
        role: 'user',
        content: '[automatic continuation — not typed by the user] resume where you left off',
      },
      toolCallMsg('b0', 'bash', { command: 'x' }),
      toolResultMsg('b0', 1),
    ]

    expect(detectRunawayToolFailures(messages)?.count).toBe(RUNAWAY_FAILURE_THRESHOLD)
  })
})

describe('runawayWrapUpText', () => {
  test('names the tool and the count and forbids the same retry', () => {
    const text = runawayWrapUpText({ toolName: 'bash', count: 4 })

    expect(text).toContain('`bash`')
    expect(text).toContain('4 times')
    expect(text).toContain('Stop retrying')
  })
})

describe('planProgress', () => {
  test('counts command statuses across steps and jobs', () => {
    const progress = planProgress(makePlan('executing', ['done', 'failed', 'running', 'pending']))

    expect(progress).toEqual({
      totalCommands: 4,
      doneCommands: 1,
      failedCommands: 1,
      unfinishedCommands: 2,
    })
  })
})

describe('renderActivePlanStatusBlock', () => {
  test('returns null with no plans', () => {
    expect(renderActivePlanStatusBlock([])).toBeNull()
  })

  test('renders lifecycle status and per-step command progress', () => {
    const block = renderActivePlanStatusBlock([makePlan('executing', ['done', 'pending'])])

    expect(block).toContain('Plan #7 "Rotate database credentials" [executing]')
    expect(block).toContain('1. Step one (1/2 commands done)')
    expect(block).toContain('Before ending your turn')
  })

  test('surfaces commands left marked running so the model can reconcile them', () => {
    const block = renderActivePlanStatusBlock([makePlan('executing', ['done', 'running'])])

    expect(block).toContain('1. Step one (1/2 commands done, 1 still marked running)')
  })

  test('the step line stays clean when no command claims to be running', () => {
    const block = renderActivePlanStatusBlock([makePlan('executing', ['done', 'pending'])])

    expect(block).toContain('1. Step one (1/2 commands done)')
    expect(block).not.toContain('commands done, 1 still marked running')
  })
})
