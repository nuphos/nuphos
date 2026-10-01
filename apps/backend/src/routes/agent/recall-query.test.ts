import { describe, expect, test } from 'bun:test'

import { composeRecallQuery, stripStructuredNoise } from './recall-query'

describe('composeRecallQuery', () => {
  test('a substantive latest message passes through unchanged', () => {
    const texts = ['why did the backend pod OOM after the deploy', 'earlier question']

    expect(composeRecallQuery(texts)).toBe('why did the backend pod OOM after the deploy')
  })

  test('a thin CJK follow-up borrows the nearest substantive user message', () => {
    // newest-first: "再深入一點" is the latest, the real question precedes it.
    const texts = ['再深入一點', '為什麼記憶召回都是用純文字搜尋而不是語意檢索']

    expect(composeRecallQuery(texts)).toBe(
      '為什麼記憶召回都是用純文字搜尋而不是語意檢索 再深入一點',
    )
  })

  test('a thin English follow-up borrows too', () => {
    expect(composeRecallQuery(['go on', 'how does the attribution judge decide applied'])).toBe(
      'how does the attribution judge decide applied go on',
    )
  })

  test('a thin first message with no prior stays as-is (nothing to borrow)', () => {
    expect(composeRecallQuery(['繼續'])).toBe('繼續')
  })

  test('thin latest and only thin priors is left alone', () => {
    expect(composeRecallQuery(['對', '好', '嗯'])).toBe('對')
  })

  test('the borrowed context is capped so one long turn cannot dominate', () => {
    const long = 'x'.repeat(500)
    const out = composeRecallQuery(['more', long])

    expect(out.length).toBeLessThanOrEqual(240 + 1 + 'more'.length)
    expect(out.endsWith('more')).toBe(true)
  })

  test('empty input yields an empty query', () => {
    expect(composeRecallQuery([])).toBe('')
    expect(composeRecallQuery([''])).toBe('')
  })
})

describe('stripStructuredNoise', () => {
  test('fenced code blocks vanish, surrounding prose stays', () => {
    expect(
      stripStructuredNoise(
        'check the patrol rules\n```bash\ncurl -H "Auth: x" api\n```\nthen report',
      ),
    ).toBe('check the patrol rules then report')
  })

  test('nested JSON payloads collapse without touching the sentence around them', () => {
    // The webhook shape: one sentence of intent wrapped around a payload
    // whose tokens (header names, ids) out-scored the sentence in prod.
    const turn =
      'A Better Stack incident event was received for the monid project. Payload: {"id":"996","data":{"attributes":{"cause":"Timeout","nested":{"deep":1}}}} STEP 1: triage.'

    expect(stripStructuredNoise(turn)).toBe(
      'A Better Stack incident event was received for the monid project. Payload: STEP 1: triage.',
    )
  })

  test('inline code keeps its content — identifiers are the searchable names', () => {
    expect(stripStructuredNoise('check `server-*` dashboards in `clean-free-cronjob`')).toBe(
      'check server-* dashboards in clean-free-cronjob',
    )
  })

  test('CJK prose with full-width punctuation is untouched', () => {
    const q = '每日巡檢成本稽核儀表板，判斷今天是否有異常（含孤兒機器）'

    expect(stripStructuredNoise(q)).toBe(q)
  })

  test('unbalanced braces do not eat the rest of the message', () => {
    expect(stripStructuredNoise('the pod crashed with { unclosed and then more prose')).toBe(
      'the pod crashed with { unclosed and then more prose',
    )
  })
})

describe('composeRecallQuery on fat turns', () => {
  test('a payload-wrapped turn searches on its intent, not its payload', () => {
    const turn = `Incident for monid. Payload: {"id":"1","attrs":{"x":"y"}} Investigate the endpoint.`

    expect(composeRecallQuery([turn])).toBe(
      'Incident for monid. Payload: Investigate the endpoint.',
    )
  })

  test('the final query is capped', () => {
    const long = 'word '.repeat(400)

    expect(composeRecallQuery([long]).length).toBeLessThanOrEqual(800)
  })

  test('a thin follow-up borrows STRIPPED prior context, not raw payload', () => {
    const prior = 'How do I fix rustfs on lunabill? {"noise":{"a":1,"b":2}}'

    expect(composeRecallQuery(['繼續', prior])).toBe('How do I fix rustfs on lunabill? 繼續')
  })
})
