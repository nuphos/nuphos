import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BotStatusLine } from './bot-status-line'

import type { Activity, Run } from './bot-activity'

const run = {
  conversation: { lastMessage: { text: 'Stale unrelated Task output' } },
} as Run
const render = (activity: Activity) =>
  renderToStaticMarkup(createElement(BotStatusLine, { activity }))

test('working rows show dots without stale Task text or redundant thinking text', () => {
  const html = render({ kind: 'working', run })

  assert.ok(html.includes('t-typing-dot'))
  assert.ok(!html.includes('Stale unrelated'))
  assert.ok(!html.includes('>Thinking'))
  assert.ok(html.includes('aria-label="Thinking…"'))
})

test('background rows keep their meaning without masquerading as typing', () => {
  const html = render({ kind: 'background', run })

  assert.ok(!html.includes('t-typing-dot'))
  assert.ok(html.includes('Working in the background'))
  assert.ok(!html.includes('Stale unrelated'))
})

test('questions and errors still keep their actionable descriptions', () => {
  assert.ok(render({ kind: 'asking', question: 'Choose a project' }).includes('Choose a project'))
  assert.ok(render({ kind: 'error', label: 'Runtime offline' }).includes('Runtime offline'))
})
