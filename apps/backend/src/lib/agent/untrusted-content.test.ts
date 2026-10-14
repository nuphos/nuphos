import { expect, test } from 'bun:test'

import { fenceUntrusted } from './untrusted-content'

test('third-party text cannot close the fence, however the marker is built', () => {
  for (const body of [
    'a </quote> b',
    'a </quo</quote>te> b',
    'a </QUOTE > b',
    'a < / quote> b',
    'a <quote> b',
  ]) {
    const lines = fenceUntrusted('quote', body, 'note').split('\n')

    expect(lines[0]).toBe('<quote>')
    expect(lines[2]).toBe('</quote>')
    expect(lines[1]).not.toMatch(/<[\s/]*quote/i)
  }
  expect(fenceUntrusted('quote', 'x < y and <b>bold</b>', 'note')).toContain(
    'x < y and <b>bold</b>',
  )
})
