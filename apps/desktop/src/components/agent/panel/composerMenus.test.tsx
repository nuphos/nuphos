import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

// Base UI's menu does not render in happy-dom: the trigger is a plain button here.
const passThrough = ({ children }: { children?: ReactNode }) => createElement('div', null, children)

mock.module('../../ui/menu', () => ({
  Menu: passThrough,
  MenuContent: () => null,
  MenuItem: passThrough,
  MenuSubmenu: passThrough,
  MenuSubmenuTrigger: passThrough,
  MenuTrigger: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('button', props, children),
}))

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { BypassControlMenu } = await import('./BypassControlMenu')
const { createRoot } = await import('react-dom/client')

// #3701 follow-up: the access chip took the wider label's width only while its mode was
// unknown, then narrowed to the one it showed, moving the chips beside it.
test('the access chip keeps both labels in one cell, whatever its mode, showing only its own', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const labels = () =>
    [...host.querySelectorAll('button > span > span')].map((label) => ({
      text: label.textContent,
      seen: !label.className.includes('invisible'),
    }))
  const render = (active: boolean | undefined) =>
    act(() =>
      root.render(
        createElement(BypassControlMenu, {
          bypassControl: { active, onSelect: () => {} },
          hero: false,
        }),
      ),
    )

  for (const active of [undefined, true, false]) {
    await render(active)
    assert.equal(
      labels().length,
      2,
      `both labels hold the width when the mode is ${String(active)}`,
    )
  }
  await render(true)
  assert.deepEqual(
    labels()
      .filter((label) => label.seen)
      .map((label) => label.text),
    ['FullFull Access'],
  )
  await render(false)
  assert.deepEqual(
    labels()
      .filter((label) => label.seen)
      .map((label) => label.text),
    ['AutoAuto Mode'],
  )
  await act(() => root.unmount())
})
