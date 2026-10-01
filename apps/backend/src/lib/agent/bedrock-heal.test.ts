import { convertToModelMessages, modelMessageSchema } from 'ai'
import { describe, expect, test } from 'bun:test'

import {
  appendStatusToLastUserMessage,
  applyTrailingCachePoint,
  BEDROCK_CACHE_POINT,
  VERTEX_CACHE_POINT,
  dropDuplicateToolResults,
  healForBedrock,
  normalizeMessagesForReplay,
  splitAssistantTextAfterToolCalls,
  stripReasoningParts,
} from './bedrock-heal'

import type { HealableMessage } from './bedrock-heal'
import type { UIMessage } from 'ai'

const reasoning = (text: string) => ({
  type: 'reasoning',
  text,
  providerOptions: { bedrock: { signature: 'sig-abc' } },
})
const text = (t: string) => ({ type: 'text', text: t })
const toolCall = (id: string) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'bash',
  input: { command: 'ls' },
})
const toolResult = (id: string) => ({
  type: 'tool-result',
  toolCallId: id,
  toolName: 'bash',
  output: { type: 'text', value: 'ok' },
})
const approvalRequest = (id: string) => ({
  type: 'tool-approval-request',
  approvalId: `appr-${id}`,
  toolCallId: id,
})
// Matches convertToModelMessages output: the response carries ONLY the
// approvalId — no toolCallId (session 81815b12: a fixture with toolCallId
// here kept the tests green while production payloads failed).
const approvalResponse = (id: string) => ({
  type: 'tool-approval-response',
  approvalId: `appr-${id}`,
  approved: true,
})

describe('stripReasoningParts (ZEA-10078)', () => {
  test('removes reasoning from history and drops reasoning-only assistant messages', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('hi')] },
      { role: 'assistant', content: [reasoning('let me think'), text('answer')] },
      { role: 'assistant', content: [reasoning('only thinking')] },
      { role: 'assistant', content: [text('plain')] },
    ]

    stripReasoningParts(messages)
    expect(messages).toHaveLength(3)
    expect(messages[1]!.content).toEqual([text('answer')])
    expect(messages[2]!.content).toEqual([text('plain')])
    expect(JSON.stringify(messages)).not.toContain('reasoning')
  })

  test('leaves user/tool messages untouched', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]
    const before = JSON.stringify(messages)

    stripReasoningParts(messages)
    expect(JSON.stringify(messages)).toBe(before)
  })
})

describe('heal thinking invariants (ZEA-10078)', () => {
  test('a reasoning-led tool turn survives healForBedrock unreordered', () => {
    // The live-loop shape: thinking leads, tool-call last. Heals must not
    // move or split the reasoning part away from the head.
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('do it')] },
      { role: 'assistant', content: [reasoning('plan the call'), toolCall('c1')] },
      { role: 'tool', content: [toolResult('c1')] },
      { role: 'assistant', content: [text('done')] },
    ]

    healForBedrock(messages)
    expect(messages).toHaveLength(4)
    const assistant = messages[1]!.content as any[]

    expect(assistant[0]!.type).toBe('reasoning')
    expect(assistant[0]!.providerOptions.bedrock.signature).toBe('sig-abc')
    expect(assistant[1]!.type).toBe('tool-call')
  })

  test('split keeps reasoning in the head message, never the tail', () => {
    // Historical shape [reasoning, tool-call, text]: the trailing text must
    // split into its own assistant message AFTER the tool result, while the
    // thinking block stays at the head of the original message.
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [reasoning('r'), toolCall('c1'), text('trailing')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]
    const out = splitAssistantTextAfterToolCalls(messages)

    expect(out).toHaveLength(3)
    expect((out[0]!.content as any[]).map((p) => p.type)).toEqual(['reasoning', 'tool-call'])
    expect(out[1]!.role).toBe('tool')
    expect((out[2]!.content as any[]).map((p) => p.type)).toEqual(['text'])
  })

  test('interrupted reasoning-led tool call gets a synthetic result, reasoning intact', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [reasoning('r'), toolCall('dead')] },
      { role: 'user', content: [text('continue')] },
    ]

    healForBedrock(messages)
    expect(messages[1]!.role).toBe('tool')
    const results = messages[1]!.content as any[]

    expect(results[0]!.toolCallId).toBe('dead')
    expect((messages[0]!.content as any[])[0]!.type).toBe('reasoning')
  })
})

describe('appendStatusToLastUserMessage (ADR-0002 / ZEA-10185)', () => {
  test('appends to a string-content user tail as a second text part', () => {
    const messages: HealableMessage[] = [
      { role: 'system', content: 'base' },
      { role: 'user', content: 'do the thing' },
    ]

    expect(appendStatusToLastUserMessage(messages, '## Plan state')).toBe(true)
    expect(messages[1]!.content).toEqual([
      { type: 'text', text: 'do the thing' },
      { type: 'text', text: '## Plan state' },
    ])
  })

  test('appends to an array-content user tail', () => {
    const messages: HealableMessage[] = [{ role: 'user', content: [text('q')] }]

    expect(appendStatusToLastUserMessage(messages, 'block')).toBe(true)
    expect(messages[0]!.content).toEqual([text('q'), { type: 'text', text: 'block' }])
  })

  test('refuses when the tail is not a user message (resume shapes) and mutates nothing', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')] },
      { role: 'assistant', content: [toolCall('c1')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]
    const snapshot = structuredClone(messages)

    expect(appendStatusToLastUserMessage(messages, 'block')).toBe(false)
    expect(messages).toEqual(snapshot)
  })

  test('trailing system messages are skipped, not mistaken for the tail', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'system', content: 'nudge' },
    ]

    expect(appendStatusToLastUserMessage(messages, 'block')).toBe(true)
    expect(messages[0]!.content).toEqual([
      { type: 'text', text: 'q' },
      { type: 'text', text: 'block' },
    ])
  })
})

describe('applyTrailingCachePoint (zeabur/nuphos#407)', () => {
  const cachePoint = { bedrock: { cachePoint: { type: 'default' } } }

  test('marks the last non-system message', () => {
    const messages: HealableMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: [text('q')] },
      { role: 'assistant', content: [toolCall('c1')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[3]!.providerOptions).toEqual(cachePoint)
    expect(messages[1]!.providerOptions).toBeUndefined()
    expect(messages[2]!.providerOptions).toBeUndefined()
  })

  test('moves the checkpoint forward, stripping the previous one', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: [text('a')] },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toBeUndefined()
    expect(messages[1]!.providerOptions).toEqual(cachePoint)
  })

  // Vertex spells a breakpoint `anthropic.cacheControl`, not
  // `bedrock.cachePoint`. The wrong key is DROPPED by the provider rather than
  // rejected, so a mismatch costs every cache read with no error to notice.
  test('marks and moves the Vertex-shaped breakpoint', () => {
    const vertexPoint = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(vertexPoint) },
      { role: 'assistant', content: [text('a')] },
    ]

    applyTrailingCachePoint(messages, VERTEX_CACHE_POINT)
    expect(messages[0]!.providerOptions).toBeUndefined()
    expect(messages[1]!.providerOptions).toEqual(vertexPoint)
  })

  // A Bedrock-shaped breakpoint left in history by an earlier provider is
  // invisible to the Vertex spec — it is neither counted nor stripped, so it
  // rides along as dead weight rather than silently consuming a breakpoint slot.
  test("leaves the other provider's breakpoint alone", () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: [text('a')] },
    ]

    applyTrailingCachePoint(messages, VERTEX_CACHE_POINT)
    expect(messages[0]!.providerOptions).toEqual(cachePoint)
    expect(messages[1]!.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    })
  })

  // ADR-0001 residual: Bedrock's lookup walks back ≤~20 blocks from a
  // checkpoint; a step that appended more must keep the old checkpoint as an
  // intermediate or the whole history silently reprocesses at full price.
  test('keeps an out-of-window previous checkpoint as the intermediate', () => {
    const fanout = Array.from({ length: 20 }, (_, i) => toolResult(`c${String(i)}`))
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: fanout.map((_, i) => toolCall(`c${String(i)}`)) },
      { role: 'tool', content: fanout },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toEqual(cachePoint) // kept: 40 blocks from tail
    expect(messages[2]!.providerOptions).toEqual(cachePoint) // new trailing point
  })

  test('strips an in-window previous checkpoint (original behavior)', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: [toolCall('c1')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toBeUndefined()
    expect(messages[2]!.providerOptions).toEqual(cachePoint)
  })

  test('at most one intermediate survives (checkpoint budget: 2 message-level)', () => {
    const big = () => Array.from({ length: 20 }, (_, i) => text(`t${String(i)}`))
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: big() },
      { role: 'user', content: [text('q2')], providerOptions: structuredClone(cachePoint) },
      { role: 'assistant', content: big() },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toBeUndefined() // older intermediate dropped
    expect(messages[2]!.providerOptions).toEqual(cachePoint) // nearest survives
    expect(messages[3]!.providerOptions).toEqual(cachePoint) // trailing
  })

  test('gap guard is idempotent across repeated calls', () => {
    const fanout = Array.from({ length: 20 }, (_, i) => toolResult(`c${String(i)}`))
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')], providerOptions: structuredClone(cachePoint) },
      { role: 'tool', content: fanout },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    const snapshot = structuredClone(messages)

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages).toEqual(snapshot)
  })

  test('leaves system-message checkpoints alone (owned by the request builder)', () => {
    const messages: HealableMessage[] = [
      { role: 'system', content: 'base', providerOptions: structuredClone(cachePoint) },
      { role: 'user', content: [text('q')] },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toEqual(cachePoint)
    expect(messages[1]!.providerOptions).toEqual(cachePoint)
  })

  test('preserves unrelated providerOptions keys while stripping and marking', () => {
    const messages: HealableMessage[] = [
      {
        role: 'user',
        content: [text('q')],
        providerOptions: { bedrock: { cachePoint: { type: 'default' }, other: 1 }, openai: {} },
      },
      { role: 'assistant', content: [text('a')], providerOptions: { anthropic: { x: 1 } } },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toEqual({ bedrock: { other: 1 }, openai: {} })
    expect(messages[1]!.providerOptions).toEqual({
      anthropic: { x: 1 },
      bedrock: { cachePoint: { type: 'default' } },
    })
  })

  test('no-op when there are no non-system messages', () => {
    const messages: HealableMessage[] = [{ role: 'system', content: 'base' }]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(messages[0]!.providerOptions).toBeUndefined()
  })

  test('idempotent: applying twice equals applying once', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('q')] },
      { role: 'tool', content: [toolResult('c1')] },
    ]

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    const once = JSON.stringify(messages)

    applyTrailingCachePoint(messages, BEDROCK_CACHE_POINT)
    expect(JSON.stringify(messages)).toBe(once)
  })
})

describe('healForBedrock baseline behaviors (moved from routes/agent.ts)', () => {
  test('forced-continuation replay normalizes tool output to ModelMessage JSON', () => {
    const sparse = new Array(2)

    sparse[1] = undefined
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1')] },
      {
        role: 'tool',
        content: [
          {
            ...toolResult('c1'),
            output: {
              type: 'json',
              value: {
                kept: 'yes',
                omitted: undefined,
                nonFinite: Number.NaN,
                sparse,
                createdAt: new Date('2026-07-17T00:00:00.000Z'),
              },
            },
          },
        ],
      },
    ]

    const normalized = normalizeMessagesForReplay(messages)

    expect(normalized).not.toBe(messages)
    expect(normalized.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true)
    const output = ((normalized[1]!.content as any[])[0]!.output as any).value

    expect(output).toEqual({
      kept: 'yes',
      nonFinite: null,
      sparse: [null, null],
      createdAt: '2026-07-17T00:00:00.000Z',
    })
    expect(((messages[1]!.content as any[])[0]!.output as any).value.omitted).toBeUndefined()
  })

  test('history rebuilt from a stored transcript with BSON Dates in tool output normalizes to ModelMessage JSON', async () => {
    // Incident (session fb22bc00): memory_get persisted Date instances inside
    // its output; every server-side rebuild of the transcript (Slack / Lark /
    // rewake) rehydrated them as live Dates and failed standardizePrompt before
    // the model was called, permanently bricking the session. The prompt-build
    // path must normalize AFTER convertToModelMessages, which passes tool
    // outputs through untouched.
    const rehydrated: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'q' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-memory_get',
            toolCallId: 'c1',
            state: 'output-available',
            input: { query: 'slack error' },
            output: {
              ok: true,
              results: [{ text: 'hit', createdAt: new Date('2026-07-22T01:34:00.000Z') }],
            },
          } as never,
          { type: 'text', text: 'answer' },
        ],
      },
    ]
    const converted = await convertToModelMessages(rehydrated)

    expect(converted.every((message) => modelMessageSchema.safeParse(message).success)).toBe(false)
    const normalized = normalizeMessagesForReplay(converted)

    expect(normalized.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true)
    const toolMessage = normalized.find((m) => m.role === 'tool')!
    const output = (toolMessage.content as any[])[0]!.output as any

    expect(output.value.results[0].createdAt).toBe('2026-07-22T01:34:00.000Z')
  })

  test('null tool-call inputs normalize to {}', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [{ ...toolCall('c1'), input: null }] },
      { role: 'tool', content: [toolResult('c1')] },
    ]

    healForBedrock(messages)
    expect((messages[0]!.content as any[])[0]!.input).toEqual({})
  })

  test('orphan tool-results are dropped; empty tool messages removed', () => {
    const messages: HealableMessage[] = [
      { role: 'tool', content: [toolResult('ghost')] },
      { role: 'user', content: [text('hello')] },
    ]

    healForBedrock(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')
  })

  test('duplicate tool-call ids are remapped in call and result pairs', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('dup')] },
      { role: 'tool', content: [toolResult('dup')] },
      { role: 'assistant', content: [toolCall('dup')] },
      { role: 'tool', content: [toolResult('dup')] },
    ]

    healForBedrock(messages)
    const firstCall = (messages[0]!.content as any[])[0]!.toolCallId
    const secondCall = (messages[2]!.content as any[])[0]!.toolCallId

    expect(firstCall).toBe('dup')
    expect(secondCall).not.toBe('dup')
    expect((messages[3]!.content as any[])[0]!.toolCallId).toBe(secondCall)
  })

  test('idempotent: healing twice equals healing once', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [reasoning('r'), toolCall('c1'), text('t')] },
      { role: 'tool', content: [toolResult('c1')] },
      { role: 'assistant', content: [toolCall('open')] },
    ]

    healForBedrock(messages)
    const once = JSON.stringify(messages)

    healForBedrock(messages)
    expect(JSON.stringify(messages)).toBe(once)
  })
})

// A pending approval the user never answered: while it is the live tail the
// client can still approve it, so healing must leave it alone — but once a
// later user message exists no tool-approval-response can ever arrive, and the
// un-resulted tool-call makes the SDK reject the conversation on every retry
// (session 3c2e03db).
describe('stale pending approvals (session 3c2e03db)', () => {
  const syntheticResultsFor = (messages: HealableMessage[], id: string) =>
    messages
      .filter((m) => m.role === 'tool' && Array.isArray(m.content))
      .flatMap((m) => m.content as any[])
      .filter((p) => p.type === 'tool-result' && p.toolCallId === id)

  test('live pending approval at the tail is left for the client to answer', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('fix it')] },
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
    ]

    healForBedrock(messages)
    expect(syntheticResultsFor(messages, 'c1')).toHaveLength(0)
  })

  test('pending approval followed by a user message gets a superseded result', () => {
    const messages: HealableMessage[] = [
      { role: 'user', content: [text('fix it')] },
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
      { role: 'user', content: [text('actually, do something else')] },
    ]

    healForBedrock(messages)
    const injected = syntheticResultsFor(messages, 'c1')

    expect(injected).toHaveLength(1)
    expect(injected[0]!.output.value).toContain('without approving')
    // The invariant the SDK enforces: no un-resulted tool-call may precede a
    // user message. The synthetic result must land before the second user turn.
    const toolIdx = messages.findIndex((m) => m.role === 'tool')
    const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')

    expect(toolIdx).toBeGreaterThan(-1)
    expect(toolIdx).toBeLessThan(lastUserIdx)
  })

  test('answered approval at the live tail is not healed (SDK executes from it)', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
      { role: 'tool', content: [approvalResponse('c1')] },
    ]

    healForBedrock(messages)
    expect(syntheticResultsFor(messages, 'c1')).toHaveLength(0)
  })

  test('answered approval whose execution result was lost gets an interrupted result', () => {
    // The SDK only executes approvals found in the FINAL message; once the
    // conversation moved past it, an un-resulted approved call leaves a bare
    // toolUse block (the provider drops approval-responses) and Bedrock
    // rejects the request. It was approved — the honest healing is
    // "interrupted", not "user continued without approving".
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
      { role: 'tool', content: [approvalResponse('c1')] },
      { role: 'user', content: [text('thanks')] },
    ]

    healForBedrock(messages)
    const injected = syntheticResultsFor(messages, 'c1')

    expect(injected).toHaveLength(1)
    expect(injected[0]!.output.value).toContain('interrupted')
    expect(injected[0]!.output.value).not.toContain('without approving')
  })

  test('idempotent: healing a stale approval twice equals healing once', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
      { role: 'user', content: [text('next request')] },
    ]

    healForBedrock(messages)
    const once = JSON.stringify(messages)

    healForBedrock(messages)
    expect(JSON.stringify(messages)).toBe(once)
  })
})

// A HITL approval that pauses the turn resumes as: assistant [.., tool-call,
// approval-request] / tool [approval-response] / tool [real result] — the SDK
// appends the approved execution's result as a NEW tool message. When the stop
// gate then forces a continuation (user-role nudge at the tail), the old heal
// saw an "unanswered" approval (the response carries no toolCallId, the result
// sits one message too far) and injected a synthetic result beside the real
// one. Consecutive tool messages merge into ONE provider message, so Bedrock
// rejected every such request with "duplicate Ids" — surfacing as "Agent stream
// failed" after every human approval during plan execution (session 81815b12).
describe('HITL approval resume (session 81815b12)', () => {
  const resultsFor = (messages: HealableMessage[], id: string) =>
    messages
      .filter((m) => m.role === 'tool' && Array.isArray(m.content))
      .flatMap((m) => m.content as any[])
      .filter((p) => p.type === 'tool-result' && p.toolCallId === id)

  const prodShape = (): HealableMessage[] => [
    { role: 'user', content: [text('approve and continue')] },
    { role: 'assistant', content: [text('testing'), toolCall('c1'), approvalRequest('c1')] },
    { role: 'tool', content: [approvalResponse('c1')] },
    { role: 'tool', content: [toolResult('c1')] },
    { role: 'assistant', content: [text('summary')] },
    { role: 'user', content: [text('[automatic continuation] keep going')] },
  ]

  test('result in a later tool message is recognized — nothing injected', () => {
    const messages = prodShape()

    healForBedrock(messages)
    const results = resultsFor(messages, 'c1')

    expect(results).toHaveLength(1)
    expect(results[0]!.output.type).not.toBe('error-text')
  })

  test('already-poisoned history (synthetic beside real result) collapses to the real result', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1'), approvalRequest('c1')] },
      {
        role: 'tool',
        content: [
          approvalResponse('c1'),
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'bash',
            output: {
              type: 'error-text',
              value: 'Tool call was not executed: it required approval…',
            },
          },
        ],
      },
      { role: 'tool', content: [toolResult('c1')] },
      { role: 'user', content: [text('next')] },
    ]

    healForBedrock(messages)
    const results = resultsFor(messages, 'c1')

    expect(results).toHaveLength(1)
    expect(results[0]!.output).toEqual({ type: 'text', value: 'ok' })
  })

  test('dropDuplicateToolResults removes an emptied tool message', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1')] },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'bash',
            output: { type: 'error-text', value: 'interrupted' },
          },
        ],
      },
      { role: 'tool', content: [toolResult('c1')] },
    ]

    dropDuplicateToolResults(messages)
    expect(messages).toHaveLength(2)
    expect(resultsFor(messages, 'c1')).toHaveLength(1)
    expect(resultsFor(messages, 'c1')[0]!.output.value).toBe('ok')
  })

  test('two real duplicates keep the first', () => {
    const messages: HealableMessage[] = [
      { role: 'assistant', content: [toolCall('c1')] },
      {
        role: 'tool',
        content: [{ ...toolResult('c1'), output: { type: 'text', value: 'first' } }],
      },
      {
        role: 'tool',
        content: [{ ...toolResult('c1'), output: { type: 'text', value: 'second' } }],
      },
    ]

    dropDuplicateToolResults(messages)
    expect(resultsFor(messages, 'c1')).toHaveLength(1)
    expect(resultsFor(messages, 'c1')[0]!.output.value).toBe('first')
  })

  test('idempotent: healing the resume shape twice equals healing once', () => {
    const messages = prodShape()

    healForBedrock(messages)
    const once = JSON.stringify(messages)

    healForBedrock(messages)
    expect(JSON.stringify(messages)).toBe(once)
  })
})
