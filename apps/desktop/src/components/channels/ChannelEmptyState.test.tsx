import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The chat's faces read live avatar state, which a static render has none of.
mock.module('./channelParts', () => ({ ChatIcon: () => null }))

const { ChannelEmptyState } = await import('./ChannelEmptyState')

const view = (onOpenEarlier?: () => void) =>
  renderToStaticMarkup(
    createElement(ChannelEmptyState, {
      faces: [{ id: 'bot', name: 'Ada', agent: {} }],
      title: 'Ada',
      bot: true,
      firstReplyFailed: false,
      onOpenEarlier,
    }),
  )

test("an older Bot's empty chat links to the messages it had before (#5061)", () => {
  assert.match(
    view(() => {}),
    /<button[^>]*>See earlier messages with Ada<\/button>/,
  )
})

test('a Bot with nothing earlier shows only the intro', () => {
  assert.doesNotMatch(view(), /See earlier messages/)
})
