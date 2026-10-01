import { describe, expect, test } from 'bun:test'

import {
  dedupeTrustWording,
  formatPersonalIndex,
  formatTeamIndex,
  TRUST_WORDING,
} from './context-format'

const countTrust = (s: string) => s.split('\n').filter((l) => l === TRUST_WORDING).length

describe('dedupeTrustWording', () => {
  test('a joined team+personal message carries the trust caveat exactly once', () => {
    const joined = [
      formatTeamIndex([{ memoryId: 't1', title: 'Drain nodes first', triggerSignals: ['OOM'] }]),
      formatPersonalIndex([{ memoryId: 'p1', label: 'Prefers kubectl' }]),
    ].join('\n\n')

    expect(countTrust(joined)).toBe(2)
    const deduped = dedupeTrustWording(joined)

    expect(countTrust(deduped)).toBe(1)
    // Both sections and their entries survive — only the repeated caveat goes.
    expect(deduped).toContain('## Team experience index')
    expect(deduped).toContain('## Saved memories (this user)')
    expect(deduped).toContain('- t1 — Drain nodes first')
    expect(deduped).toContain('- p1 — Prefers kubectl')
  })

  test('a standalone single-block render is left untouched', () => {
    const block = formatPersonalIndex([{ memoryId: 'p1', label: 'x' }])!

    expect(dedupeTrustWording(block)).toBe(block)
  })

  test('a message with no trust wording passes through verbatim', () => {
    expect(dedupeTrustWording('plain\ntext')).toBe('plain\ntext')
  })
})
