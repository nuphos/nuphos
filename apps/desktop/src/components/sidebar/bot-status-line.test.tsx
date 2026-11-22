import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BotStatusLine } from './bot-status-line'

import type { Activity } from './bot-activity'

const render = (activity: Activity) =>
  renderToStaticMarkup(createElement(BotStatusLine, { activity }))

test("a question adds no preview line: the row keeps the chat's newest post", () => {
  assert.equal(render({ kind: 'asking' }), '')
})

test('an error says only that it failed; the chat explains why', () => {
  assert.ok(render({ kind: 'error' }).includes('>Failed<'))
})
