import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BotStatusLine } from './bot-status-line'

import type { Activity } from './bot-activity'

const render = (activity: Activity) =>
  renderToStaticMarkup(createElement(BotStatusLine, { activity }))

test('questions and errors still keep their actionable descriptions', () => {
  assert.ok(render({ kind: 'asking', question: 'Choose a project' }).includes('Choose a project'))
  assert.ok(render({ kind: 'error', label: 'Runtime offline' }).includes('Runtime offline'))
})
