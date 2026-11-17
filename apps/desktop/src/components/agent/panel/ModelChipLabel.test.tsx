import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ModelChipLabel } from './ModelChipLabel'

const label = (inline: boolean, loading = false) =>
  renderToStaticMarkup(
    createElement(ModelChipLabel, {
      name: 'fixture',
      loading,
      level: 'High',
      levels: ['Low', 'High'],
      choosingEffort: false,
      inline,
    }),
  )

/** Each element's classes, outermost first. */
const classLists = (markup: string) =>
  [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]?.split(' ') ?? [])

test('in a narrow titlebar the label gives way, so the Bot name keeps the room', () => {
  for (const markup of [label(true), label(true, true)]) {
    const [outer] = classLists(markup)

    assert.ok(outer?.includes('hidden'), markup)
    assert.ok(
      outer.some((name) => name.startsWith('@[40rem]/titlebar:')),
      `shown only in a wide titlebar: ${markup}`,
    )
  }
})

test('in a composer the label still follows the composer width', () => {
  assert.match(label(false), /@\[320px\]:grid/)
  assert.match(label(false), /@\[440px\]:inline/)
})
