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

  test('drops image tokens so the name starts with words', () => {
    expect(fallbackTitle('[Image #1] [Image #2] why does this card overflow?')).toBe(
      'why does this card overflow?',
    )
    expect(fallbackTitle('compare [Image #1] with the design')).toBe('compare with the design')
  })

  test('drops links before the first words', () => {
    expect(
      fallbackTitle('https://github.com/nuphos/nuphos/issues/1891 make task names readable'),
    ).toBe('make task names readable')
  })

  test('shrinks a link after the first words to its host', () => {
    expect(fallbackTitle('summarize https://www.example.com/blog/2026/11/long-post for me')).toBe(
      'summarize example.com for me',
    )
  })

  test('names a message that is only a link after its host', () => {
    expect(fallbackTitle('[Image #1] https://github.com/nuphos/nuphos/pull/2088')).toBe(
      'github.com',
    )
  })

  test('keeps a message that is only an image token as it is', () => {
    expect(fallbackTitle('[Image #1]')).toBe('[Image #1]')
  })
})
