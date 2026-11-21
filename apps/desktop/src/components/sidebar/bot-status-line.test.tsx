import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BotStatusLine } from './bot-status-line'

import type { Activity } from './bot-activity'

const render = (activity: Activity) =>
  renderToStaticMarkup(createElement(BotStatusLine, { activity }))

test('a question keeps its description', () => {
  assert.ok(render({ kind: 'asking', question: 'Choose a project' }).includes('Choose a project'))
})

test('an error says only that it failed; the chat explains why', () => {
  assert.ok(render({ kind: 'error' }).includes('>Failed<'))
})
