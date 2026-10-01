import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, test } from 'bun:test'

import { buildInsightPrompt, insightResultSchema } from '@/lib/dashboards/insight-service'

const insight = {
  findings: [
    {
      title: 'Savings opportunity',
      detail: 'Reserved instances reduce compute cost.',
      kind: 'insight' as const,
      confidence: 'high' as const,
    },
  ],
  actions: [
    {
      title: 'Review reservations',
      detail: 'Validate current coverage.',
      prompt: 'Investigate coverage, produce a plan, and ask for confirmation before changes.',
      risk: 'low' as const,
    },
  ],
}

function tableSnapshot(cell: string) {
  return {
    params: { period: '2026-07' },
    output: {
      kind: 'table' as const,
      title: 'Monthly cost by service',
      columns: [{ key: 'service' }, { key: 'usd', numeric: true }],
      rows: [{ service: cell, usd: 42 }],
    },
  }
}

function mockModel(text: string, finishReason: 'stop' | 'length') {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: {
        unified: finishReason,
        raw: finishReason === 'length' ? 'max_tokens' : 'end_turn',
      },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  })
}

const insightOutput = () =>
  Output.object({
    schema: insightResultSchema,
    name: 'panel_insight',
    description:
      'Evidence-backed findings and safe plan/confirmation handoffs for one dashboard panel.',
  })

describe('buildInsightPrompt', () => {
  test('embeds complete current and previous snapshot outputs', () => {
    const currentTail = `current-tail-${'x'.repeat(7_000)}`
    const previousTail = `previous-tail-${'y'.repeat(4_000)}`
    const prompt = buildInsightPrompt(
      { title: 'Monthly cost by service', kind: 'table' },
      tableSnapshot(currentTail),
      {
        output: {
          kind: 'table',
          title: 'Previous monthly cost by service',
          columns: [{ key: 'service' }, { key: 'usd', numeric: true }],
          rows: [{ service: previousTail, usd: 21 }],
        },
      },
    )

    expect(prompt).toContain(currentTail)
    expect(prompt).toContain(previousTail)
  })

  test('compacts pathological table output as valid JSON within the request budget', () => {
    // A panel may emit up to the 512 KB stdout cap; embedding it verbatim would
    // fail the model call outright with no usable retry.
    const prompt = buildInsightPrompt(
      { title: 'Monthly cost by service', kind: 'table' },
      tableSnapshot('z'.repeat(400_000)),
      null,
    )
    const embeddedOutput = prompt
      .split('\n')
      .find((line) => line.startsWith('Current snapshot output: '))
      ?.slice('Current snapshot output: '.length)

    expect(prompt.length).toBeLessThan(100_000)
    expect(embeddedOutput).toBeDefined()
    expect(JSON.parse(embeddedOutput!)).toMatchObject({ compacted: true, rowCount: 1 })
  })

  test('retains a final-row anomaly when compacting a long table', () => {
    const sentinel = 'final-row-anomaly-999999'
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      service: `service-${String(index)}`,
      usd: index,
      context: 'x'.repeat(100),
    }))

    rows[rows.length - 1] = { service: sentinel, usd: 9_999_999, context: 'unexpected cost spike' }

    const prompt = buildInsightPrompt(
      { title: 'Monthly cost by service', kind: 'table' },
      {
        params: { period: '2026-07' },
        output: {
          kind: 'table',
          title: 'Monthly cost by service',
          columns: [{ key: 'service' }, { key: 'usd', numeric: true }, { key: 'context' }],
          rows,
        },
      },
      null,
    )
    const embeddedOutput = prompt
      .split('\n')
      .find((line) => line.startsWith('Current snapshot output: '))
      ?.slice('Current snapshot output: '.length)
    const compacted = JSON.parse(embeddedOutput!) as {
      rowCount: number
      representativeRows: { position: string; index: number; row: { service: string } }[]
      topRows: { row: { service: string } }[]
    }

    expect(compacted.rowCount).toBe(1_000)
    expect(compacted.representativeRows).toContainEqual({
      position: 'last',
      index: 999,
      row: rows[999]!,
    })
    expect(compacted.topRows[0]?.row.service).toBe(sentinel)
  })

  test('compacts charts to endpoint samples and per-series statistics', () => {
    const prompt = buildInsightPrompt(
      { title: 'Daily spend', kind: 'chart' },
      {
        params: { period: '2026-07' },
        output: {
          kind: 'chart',
          type: 'line',
          title: 'Daily spend',
          xKey: 'date',
          series: [{ key: 'usd' }],
          data: Array.from({ length: 1_000 }, (_, index) => ({
            date: `day-${String(index)}-${'x'.repeat(80)}`,
            usd: index,
          })),
        },
      },
      null,
    )
    const embeddedOutput = prompt
      .split('\n')
      .find((line) => line.startsWith('Current snapshot output: '))
      ?.slice('Current snapshot output: '.length)
    const compacted = JSON.parse(embeddedOutput!) as {
      dataPointCount: number
      data: { date: string; usd: number }[]
      seriesSummary: {
        latest: number
        min: number
        max: number
        average: number
        delta: number
        observationCount: number
        key: string
      }[]
    }

    expect(compacted.dataPointCount).toBe(1_000)
    expect(compacted.data).toHaveLength(2)
    expect(compacted.data[0]?.usd).toBe(0)
    expect(compacted.data[1]?.usd).toBe(999)
    expect(compacted.seriesSummary).toEqual([
      {
        latest: 999,
        min: 0,
        max: 999,
        average: 499.5,
        delta: 999,
        observationCount: 1_000,
        key: 'usd',
      },
    ])
  })

  test('reports a null final chart value as the latest value after compaction', () => {
    const prompt = buildInsightPrompt(
      { title: 'Daily spend', kind: 'chart' },
      {
        params: { period: '2026-07' },
        output: {
          kind: 'chart',
          type: 'line',
          title: 'Daily spend',
          xKey: 'date',
          series: [{ key: 'usd' }],
          data: Array.from({ length: 1_000 }, (_, index) => ({
            date: `day-${String(index)}-${'x'.repeat(80)}`,
            usd: index === 999 ? null : index,
          })),
        },
      },
      null,
    )
    const embeddedOutput = prompt
      .split('\n')
      .find((line) => line.startsWith('Current snapshot output: '))
      ?.slice('Current snapshot output: '.length)
    const compacted = JSON.parse(embeddedOutput!) as {
      data: { usd: number | null }[]
      seriesSummary: {
        latest: number | null
        delta: number | null
        observationCount: number
      }[]
    }

    expect(compacted.data[1]?.usd).toBeNull()
    expect(compacted.seriesSummary[0]).toMatchObject({
      latest: null,
      delta: null,
      observationCount: 999,
    })
  })

  test('a retry tells the model what to correct instead of repeating itself', () => {
    const snapshot = tableSnapshot('svc')
    const panel = { title: 'Monthly cost by service', kind: 'table' as const }

    expect(buildInsightPrompt(panel, snapshot, null, 'output_truncated')).toContain('cut off')
    expect(buildInsightPrompt(panel, snapshot, null, 'schema_mismatch')).toContain(
      'did not match the required schema',
    )
    expect(buildInsightPrompt(panel, snapshot, null)).not.toContain('previous reply')
  })
})

describe('structured insight generation', () => {
  test('a well-formed response parses into the insight schema', async () => {
    const result = await generateText({
      model: mockModel(JSON.stringify(insight), 'stop'),
      output: insightOutput(),
      prompt: 'x',
    })

    expect(result.finishReason).toBe('stop')
    expect(result.output).toEqual(insight)
  })

  test('a schema-violating response throws NoObjectGeneratedError', async () => {
    // Only reachable on a `stop` finish — this is what classifyFailure keys on.
    let caught: unknown

    try {
      await generateText({
        model: mockModel(JSON.stringify({ findings: [{ title: '' }], actions: [] }), 'stop'),
        output: insightOutput(),
        prompt: 'x',
      })
    } catch (err) {
      caught = err
    }

    expect(NoObjectGeneratedError.isInstance(caught)).toBe(true)
  })

  test('a truncated response surfaces as NoOutputGeneratedError, never NoObjectGeneratedError', () => {
    // The AI SDK only parses structured output when the step finished with
    // `stop`, so truncation must be detected from `finishReason` — reading
    // `result.output` throws an error that carries no finish reason at all.
    const promise = generateText({
      model: mockModel(JSON.stringify(insight).slice(0, 40), 'length'),
      output: insightOutput(),
      prompt: 'x',
    })

    return promise.then((result) => {
      expect(result.finishReason).toBe('length')
      const readOutput = () => result.output

      expect(readOutput).toThrow()
      try {
        readOutput()
      } catch (err) {
        expect(NoOutputGeneratedError.isInstance(err)).toBe(true)
        expect(NoObjectGeneratedError.isInstance(err)).toBe(false)
      }
    })
  })
})
