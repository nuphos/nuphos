import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AnsiLogText } from './ansi-log-text'

const render = (message: string) => renderToStaticMarkup(createElement(AnsiLogText, { message }))

test('SGR codes become styled spans', () => {
  const html = render('\x1b[1;31mfailed\x1b[0m done')

  assert.match(html, /<span style="color:rgb\(187, 0, 0\);font-weight:bold">failed<\/span>/)
  assert.match(html, /<span> done<\/span>/)
})

test('log content stays text', () => {
  const html = render('\x1b[32m<img src=x onerror=alert(1)>\x1b[0m')

  assert.ok(!html.includes('<img'))
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('hidden text is shown', () => {
  assert.match(render('\x1b[8msecret\x1b[0m'), /secret/)
})
