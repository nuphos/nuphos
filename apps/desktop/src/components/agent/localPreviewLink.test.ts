import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'

import { standaloneLocalLink } from './localPreviewLink.ts'

const link = (href = 'http://localhost:5173/preview') =>
  createElement('a', { href }, 'Open the preview')

test('standalone local links promote without leaving terminal punctuation', () => {
  assert.deepEqual(standaloneLocalLink([link(), '.']), {
    href: 'http://localhost:5173/preview',
    children: 'Open the preview',
  })
})

test('words before or after a local link remain inline', () => {
  assert.equal(standaloneLocalLink(['Open ', link(), ' to continue.']), null)
  assert.equal(standaloneLocalLink([link(), ': all checks pass.']), null)
})

test('remote links, credentials and multiple links never become local preview cards', () => {
  assert.equal(standaloneLocalLink(link('https://example.com')), null)
  assert.equal(standaloneLocalLink(link('http://user:password@localhost:5173')), null)
  assert.equal(standaloneLocalLink([link(), link()]), null)
})

test('formatted link text is preserved by promotion', () => {
  const label = createElement('strong', {}, 'Review preview')

  assert.equal(
    standaloneLocalLink(createElement('a', { href: 'http://localhost:5173' }, label))?.children,
    label,
  )
})
