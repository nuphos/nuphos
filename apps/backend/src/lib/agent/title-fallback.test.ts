import { describe, expect, test } from 'bun:test'

import { fallbackTitle } from './title-fallback'

describe('fallbackTitle', () => {
  test('keeps a short message intact', () => {
    expect(fallbackTitle('  Archive this chat\n')).toBe('Archive this chat')
  })

  test('collapses newlines and runs of whitespace', () => {
    expect(fallbackTitle('line one\n\nline   two')).toBe('line one line two')
  })

  test('truncates on a word boundary', () => {
    const title = fallbackTitle(
      'Grafana alert delivery for rule "claimed sandbox pod lost mid-turn"',
    )

    expect(title).toBe('Grafana alert delivery for rule "claimed sandbox...')
    expect(title.endsWith(' ...')).toBe(false)
  })

  test('falls back to a hard cut when there is no usable word boundary', () => {
    expect(fallbackTitle('a'.repeat(80))).toBe(`${'a'.repeat(50)}...`)
  })
})
