import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { QueuedStrip } from './QueuedStrip'

const strip = (items: { id: string; text: string; filePaths: string[] }[]) =>
  renderToStaticMarkup(
    <QueuedStrip
      items={items}
      approval={{ status: 'pending', text: 'Out of usage. These run when usage resets.' }}
      onRemove={() => {}}
      onSteer={() => {}}
    />,
  )

// #5355: a Task whose held turns came from an agent or a Trigger has none of this person's
// messages to list, and still says why it waits.
test('a usage hold shows its status line when none of the held messages are mine', () => {
  const markup = strip([])

  assert.match(markup, /Out of usage\. These run when usage resets\./)
  assert.doesNotMatch(markup, /Queued messages/)
})

test('the strip lists my held messages under its status line', () => {
  const markup = strip([{ id: 'q1', text: 'Check the deploy', filePaths: [] }])

  assert.match(markup, /Queued messages/)
  assert.match(markup, /Out of usage/)
  assert.match(markup, /Check the deploy/)
})

test('nothing renders with no messages and no status', () => {
  assert.equal(
    renderToStaticMarkup(<QueuedStrip items={[]} onRemove={() => {}} onSteer={() => {}} />),
    '',
  )
})
