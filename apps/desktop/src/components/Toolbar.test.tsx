import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Toolbar } from './Toolbar'

// #3637: a page with no breadcrumb has its controls on the top row, and the space kept for
// what floats over the header (the dock toggle) went to a header row that was not there.
test('the top row keeps the header class when the page has no breadcrumb', () => {
  const html = renderToStaticMarkup(
    createElement(Toolbar, {
      segments: [],
      filter: '',
      onFilterChange: () => {},
      count: 0,
      onRefresh: () => {},
      hasControls: true,
      headerClassName: 'keep-clear',
    }),
  )
  const top = /<div class="([^"]*)"/.exec(html.replace(/^<div[^>]*>/, ''))?.[1] ?? ''

  assert.match(top, /sheet-titlebar-row/)
  assert.match(top, /keep-clear/)
})
