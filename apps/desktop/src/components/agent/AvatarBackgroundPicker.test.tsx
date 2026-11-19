import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const { AvatarBackgroundPicker } = await import('./AvatarBackgroundPicker')

test('Background is one radio group: None first, then each tint by name', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const picked: string[] = []
  const render = (value: string) =>
    act(() =>
      root.render(
        createElement(AvatarBackgroundPicker, { value, onChange: (name) => picked.push(name) }),
      ),
    )

  await render('none')
  const group = container.querySelector('[role="radiogroup"]')

  assert.equal(group?.getAttribute('aria-label'), 'Background')
  const radios = [...container.querySelectorAll('[role="radio"]')]

  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('aria-label')),
    ['None', 'Sand', 'Peach', 'Rose', 'Lilac', 'Sky', 'Mint', 'Sage', 'Slate'],
  )
  assert.equal(radios[0]?.getAttribute('aria-checked'), 'true')
  // None is a dashed circle; a tint is its token.
  assert.match(radios[0]?.innerHTML ?? '', /border-dashed/)
  assert.match(radios[5]?.innerHTML ?? '', /--color-avatar-sky/)

  await act(() => (radios[5] as unknown as HTMLElement).click())
  assert.deepEqual(picked, ['sky'])
  await render('sky')
  assert.equal(container.querySelector('[aria-checked="true"]')?.getAttribute('aria-label'), 'Sky')
  // Arrow keys move the pick, as in the character grid.
  await act(() => {
    container
      .querySelector('[aria-checked="true"]')
      ?.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert.deepEqual(picked, ['sky', 'mint'])
  await act(() => root.unmount())
})
