import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarPageTabs } from './SidebarPageTabs'

test('Bots and Tasks each expose their own count, with no zero badge', () => {
  const view = (botCount: number) =>
    renderToStaticMarkup(
      createElement(SidebarPageTabs, {
        page: 0,
        onPage: () => {},
        count: 3,
        botCount,
      }),
    )

  assert.match(view(2), /aria-label="Bots · 2"/)
  assert.match(view(2), /aria-label="Tasks · 3"/)
  assert.match(view(0), /aria-label="Bots"/)
  assert.doesNotMatch(view(0), /Bots · 0/)
})
