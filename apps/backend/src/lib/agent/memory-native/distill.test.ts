import { describe, expect, test } from 'bun:test'

import {
  ALREADY_KNOWN_LIMIT,
  DURABLE_KINDS,
  DURABLE_KNOWLEDGE_WORDING,
  VOLATILE_KINDS,
  buildDistillPrompt,
  distillFailureName,
  distillTurnMemory,
  isVolatileKind,
  mergeAlreadyKnown,
  trimToBudget,
  turnSubstanceChars,
  unwrapDistillEnvelope,
} from './distill'

const memory = (text: string) => ({ title: 't', text, type: 'fact', categories: [] }) as const

describe('distillFailureName', () => {
  test('returns the error class name (the failure mode)', () => {
    expect(distillFailureName(new TypeError('x'))).toBe('TypeError')
    const e = new Error('y')

    e.name = 'AI_NoObjectGeneratedError'
    expect(distillFailureName(e)).toBe('AI_NoObjectGeneratedError')
  })

  test('falls back to "unknown" for non-errors or nameless errors', () => {
    expect(distillFailureName('nope')).toBe('unknown')
    expect(distillFailureName(null)).toBe('unknown')
    const e = new Error('z')

    e.name = ''
    expect(distillFailureName(e)).toBe('unknown')
  })
})

describe('unwrapDistillEnvelope', () => {
  test('unwraps a stray single-key envelope around the learn object (NUPS-641)', () => {
    expect(unwrapDistillEnvelope('{"rst":{"learn":true,"memory":{"title":"t"}}}')).toBe(
      '{"learn":true,"memory":{"title":"t"}}',
    )
  })

  test('unwraps tool-shaped wrapper keys (the #711 toolActivity echo)', () => {
    expect(unwrapDistillEnvelope('{"arguments":{"learn":false}}')).toBe('{"learn":false}')
  })

  test('leaves the correct shape alone — nothing to repair', () => {
    expect(unwrapDistillEnvelope('{"learn":true,"memory":{}}')).toBeNull()
  })

  test('refuses to guess when there is more than one top-level key', () => {
    expect(unwrapDistillEnvelope('{"a":{"learn":true},"b":1}')).toBeNull()
  })

  test('refuses when the inner value has no learn field', () => {
    expect(unwrapDistillEnvelope('{"wrap":{"foo":1}}')).toBeNull()
  })

  test('null on non-object, array, or invalid JSON', () => {
    expect(unwrapDistillEnvelope('not json')).toBeNull()
    expect(unwrapDistillEnvelope('[{"learn":true}]')).toBeNull()
    expect(unwrapDistillEnvelope('"a string"')).toBeNull()
  })
})

describe('buildDistillPrompt', () => {
  test('JSON payload with data-not-instruction wording and the volatility rule', () => {
    // CJK fixtures are load-bearing: real turns are frequently Chinese, and
    // the payload must round-trip them intact through JSON encoding.
    const p = buildDistillPrompt('台北有幾個服務?', '目前是 34 個', ['GKE 刪除 playbook'])

    expect(p).toContain('DATA')
    // The anti-volatile rule now lives in the kind classification the model
    // must commit to, not in a clause it can read past (NUPS-659 B).
    expect(p).toContain('memory.kind')
    expect(p).toContain("it is 'status'")
    expect(p).toContain('alreadyKnown')
    const payload = JSON.parse(p.slice(p.indexOf('{')))

    expect(payload.userMessage).toBe('台北有幾個服務?')
    expect(payload.alreadyKnown[0]).toBe('GKE 刪除 playbook')
  })

  test('the shared durability wording rides the prompt verbatim (write paths stay aligned)', () => {
    // save_memory's tool description composes from the same const, so this one
    // assertion pins both writers to a single standard.
    expect(buildDistillPrompt('q', 'a', [])).toContain(
      `Set learn=true ONLY for ${DURABLE_KNOWLEDGE_WORDING}.`,
    )
  })

  test('caps payload field lengths', () => {
    const p = buildDistillPrompt('q'.repeat(5000), 'a'.repeat(9000), ['k'.repeat(500)])
    const payload = JSON.parse(p.slice(p.indexOf('{')))

    expect(payload.userMessage.length).toBeLessThanOrEqual(2000)
    expect(payload.assistantAnswer.length).toBeLessThanOrEqual(4000)
    expect(payload.alreadyKnown[0].length).toBeLessThanOrEqual(140)
  })

  // NUPS-607
  test('omits toolActivity entirely on a tool-free turn', () => {
    const payload = JSON.parse(
      buildDistillPrompt('q', 'a', []).slice(buildDistillPrompt('q', 'a', []).indexOf('{')),
    )

    expect('toolActivity' in payload).toBe(false)
  })

  test('carries tool activity and tells the model what is durable about it', () => {
    const p = buildDistillPrompt(
      '哪個 cluster?',
      'zeabur-prod-gke',
      [],
      [{ name: 'kubectl', arguments: '{"ns":"user-charge"}', output: 'clickhouse-shard0' }],
    )
    const payload = JSON.parse(p.slice(p.indexOf('{')))

    expect(payload.toolActivity).toEqual([
      { name: 'kubectl', arguments: '{"ns":"user-charge"}', output: 'clickhouse-shard0' },
    ])
    expect(p).toContain('what the agent actually ran and saw')
    // The anti-volatile stance must still apply to tool readings.
    expect(p).toContain('not the numbers it returned')
  })

  test('caps the number of tool calls in the payload', () => {
    const activity = Array.from({ length: 40 }, (_, i) => ({
      name: `t${i}`,
      arguments: '{}',
      output: '',
    }))
    const p = buildDistillPrompt('q', 'a', [], activity)
    const payload = JSON.parse(p.slice(p.indexOf('{')))

    expect(payload.toolActivity).toHaveLength(24)
  })
})

// NUPS-607: an over-budget body used to fail schema validation, which threw
// the whole learning away as 'failed'. Trimming keeps it.
describe('trimToBudget', () => {
  test('leaves a within-budget memory untouched', () => {
    const m = memory('short enough')

    expect(trimToBudget({ ...m, categories: [...m.categories] })).toEqual({
      title: 't',
      text: 'short enough',
      type: 'fact',
      categories: [],
    })
  })

  test('trims to 600 chars at the last sentence boundary', () => {
    const body = '這是一段句子。'.repeat(200)
    const trimmed = trimToBudget({ ...memory(body), categories: [] })

    expect(trimmed.text.length).toBeLessThanOrEqual(600)
    expect(trimmed.text.endsWith('。')).toBe(true)
  })

  test('falls back to a hard cut when there is no late boundary', () => {
    const trimmed = trimToBudget({ ...memory('x'.repeat(2000)), categories: [] })

    expect(trimmed.text).toHaveLength(600)
  })

  test('preserves title, type and categories', () => {
    const trimmed = trimToBudget({
      title: 'keep me',
      text: 'y'.repeat(900),
      type: 'episode',
      categories: ['a', 'b'],
    })

    expect(trimmed.title).toBe('keep me')
    expect(trimmed.type).toBe('episode')
    expect(trimmed.categories).toEqual(['a', 'b'])
  })
})

describe('distillTurnMemory', () => {
  test('trivial turns short-circuit to skipped_short without a model call', async () => {
    // No bedrock mock needed: the length gate returns before any client is built.
    // Gate is COMBINED query+answer length — a knowledge-rich user message with
    // a two-word acknowledgement must NOT short-circuit (that is the teach
    // pattern), so only genuinely tiny turns skip.
    expect(await distillTurnMemory({ query: 'ok?', answer: 'ok', alreadyKnown: [] })).toEqual({
      outcome: 'skipped_short',
    })
  })

  // NUPS-607: the investigation shape — a short question, a terse answer, and
  // all the substance in the tools. Pre-607 this was dropped as "short".
  test('tool work counts as substance, so a terse investigation clears the gate', () => {
    const terse = { query: 'ok?', answer: 'ok' }

    expect(turnSubstanceChars(terse)).toBeLessThan(40)
    expect(
      turnSubstanceChars({
        ...terse,
        toolActivity: [
          { name: 'kubectl', arguments: '{"ns":"user-charge"}', output: 'x'.repeat(200) },
        ],
      }),
    ).toBeGreaterThanOrEqual(40)
  })
})

describe('durability kinds (NUPS-659 B)', () => {
  test('the volatile kinds are exactly the ones that go stale', () => {
    // 17% of the live prod pool was plan-status snapshots while the prompt
    // already said not to learn them. The taxonomy is the enforcement point,
    // so its membership is a contract, not a detail.
    expect([...DURABLE_KINDS]).toEqual(['procedure', 'coordinate', 'decision', 'cause'])
    expect([...VOLATILE_KINDS]).toEqual(['status', 'observation'])
  })

  test('classification decides, and the two sets do not overlap', () => {
    for (const k of VOLATILE_KINDS) expect(isVolatileKind(k)).toBe(true)
    for (const k of DURABLE_KINDS) expect(isVolatileKind(k)).toBe(false)
  })

  test('an unknown kind is treated as durable, never silently dropped', () => {
    // Fail-open matches the rest of the distiller: if the taxonomy grows and
    // this code has not caught up, the cost is a memory that should have been
    // filtered — not a turn's learning discarded on a label we cannot read.
    expect(isVolatileKind('procedure-ish')).toBe(false)
    expect(isVolatileKind('')).toBe(false)
  })
})

describe('mergeAlreadyKnown (NUPS-659 C)', () => {
  test('conversation history takes the slots when the cap bites', () => {
    // The real shape: a long investigation has already saved many memories,
    // and recall returns five unrelated ones. Before this, the distiller saw
    // only the recall labels and re-learned what the conversation had already
    // written down — 18 records from one conversation, in prod.
    const saved = Array.from({ length: 12 }, (_, i) => `saved-${String(i)}`)
    const recalled = ['recall-a', 'recall-b']
    const prompt = buildDistillPrompt('q', 'a', mergeAlreadyKnown(saved, recalled))
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))

    expect(payload.alreadyKnown).toHaveLength(ALREADY_KNOWN_LIMIT)
    expect(payload.alreadyKnown).toEqual(saved)
    expect(payload.alreadyKnown).not.toContain('recall-a')
  })

  test('recall labels still ride along when there is room', () => {
    expect(mergeAlreadyKnown(['saved'], ['recalled'])).toEqual(['saved', 'recalled'])
  })

  test('a label present in both is listed once, keeping its earlier position', () => {
    expect(mergeAlreadyKnown(['shared', 'saved'], ['recalled', 'shared'])).toEqual([
      'shared',
      'saved',
      'recalled',
    ])
  })

  test('an empty conversation history leaves the old behaviour untouched', () => {
    expect(mergeAlreadyKnown([], ['a', 'b'])).toEqual(['a', 'b'])
  })
})
