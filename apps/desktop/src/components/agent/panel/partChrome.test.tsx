import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { CollapsedWorkView } from './partChrome'

import type { Part, ToolPart } from './parts'

const upload = (toolCallId: string, output: unknown): ToolPart => ({
  type: 'tool',
  toolCallId,
  toolName: 'local_upload',
  state: 'output-available',
  output,
})
// The fold as it renders closed: its line and its calls' anchors.
const closedLine = (work: Part[]) =>
  renderToStaticMarkup(createElement(CollapsedWorkView, { seconds: 1, work, children: () => null }))

test('a finished turn says on its closed line how many of its calls failed', () => {
  const html = closedLine([
    upload('a', { groupId: 'g', fileName: 'a.txt', size: 1 }),
    { type: 'text', text: 'Next, the report.', phase: 'commentary' },
    upload('b', { error: 'file_not_found' }),
    upload('c', [{ type: 'text', text: '{"error":"file_transfer_rate_limited"}' }]),
    { ...upload('d', undefined), state: 'output-error', errorText: 'boom' },
  ])

  assert.match(
    html,
    /Worked for 1s<span[^>]*data-tool-run-failed[^>]*>· <span class="text-error">3 failed<\/span>/,
  )
  for (const id of ['a', 'b', 'c', 'd']) assert.ok(html.includes(`data-tool-call-id="${id}"`), id)
})

test('a turn with no failed call says nothing more on its closed line', () => {
  for (const work of [
    [upload('a', { groupId: 'g', fileName: 'a.txt', size: 1 })],
    [{ type: 'tool', toolCallId: 'p', toolName: 'plan', state: 'output-error' } as ToolPart],
    [],
  ]) {
    const html = closedLine(work)

    assert.ok(html.includes('Worked for 1s'), html)
    assert.ok(!html.includes('failed'), html)
  }
})
