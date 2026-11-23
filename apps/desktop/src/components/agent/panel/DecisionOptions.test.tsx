import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import postcss from 'postcss'
import { act, createElement } from 'react'
import tailwindcss from 'tailwindcss'

import tailwindConfig from '../../../../tailwind.config.js'

const { DecisionOptions } = await import('./DecisionOptions')

const LONG =
  "A private GitHub repo, as a simple markdown or CSV file (recommended: you already have GitHub, it's free and has full history)"

/** The stylesheet the app builds for exactly these classes, so the cascade decides as it does there. */
async function stylesFor(html: string) {
  const content = [{ raw: html, extension: 'html' }]
  const { css } = await postcss([tailwindcss({ ...tailwindConfig, content })]).process(
    '@tailwind utilities;',
    { from: undefined },
  )

  return css
}

test('a long option wraps inside its pill, left-aligned, in the stylesheet the app builds', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const originals = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() =>
      root.render(
        createElement(DecisionOptions, {
          questions: [
            {
              question: 'Where should I keep the weekly expense log?',
              options: [
                LONG,
                'Notion database',
                'Google Sheet',
                'Inside Nuphos only (memory and a dashboard)',
              ],
              multiSelect: false,
            },
          ],
          disabled: false,
          typeable: true,
          onSubmit: () => null,
        }),
      ),
    )
    const style = dom.document.createElement('style')

    style.textContent = await stylesFor(container.innerHTML)
    dom.document.head.append(style)
    const pills = [...container.querySelectorAll('button')]

    assert.deepEqual(
      pills.map((pill) => pill.textContent),
      [
        LONG,
        'Notion database',
        'Google Sheet',
        'Inside Nuphos only (memory and a dashboard)',
        'Other…',
      ],
    )
    // Button's own `whitespace-nowrap` comes later in the stylesheet than the pill's
    // `whitespace-normal`, so the pill once kept a long option on one line past the card.
    for (const pill of pills) {
      const label = pill.querySelector('span')

      assert.ok(label, `${pill.textContent} has its label`)
      assert.equal(dom.getComputedStyle(pill).whiteSpace, 'normal', pill.textContent)
      assert.equal(dom.getComputedStyle(label).whiteSpace, 'normal', pill.textContent)
      assert.equal(dom.getComputedStyle(label).textAlign, 'left', pill.textContent)
    }
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
