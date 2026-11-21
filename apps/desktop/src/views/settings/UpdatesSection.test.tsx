import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

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

let installs = 0

// `api` calls through to the preload bridge.
Reflect.set(dom, 'api', {
  appGetVersion: () => Promise.resolve('1.0.0'),
  updaterCheck: () => Promise.resolve(),
  updaterGetAutoInstall: () => Promise.resolve({ enabled: true }),
  updaterInstall: () => {
    installs += 1

    return Promise.resolve()
  },
})
mock.module('../../components/useReadyUpdate', () => ({
  useUpdaterState: () => ({ kind: 'ready', version: '2.0.0', installerUrl: null }),
}))

const { UpdatesSection } = await import('./UpdatesSection')
const { createRoot } = await import('react-dom/client')

const click = (element: Element | undefined) =>
  act(async () => {
    element?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }) as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

test('Restart asks first, and only Update in the dialog restarts', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(async () => {
      root.render(createElement(UpdatesSection))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const restart = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restart',
    )

    await click(restart as unknown as Element)
    assert.equal(installs, 0)
    const dialog = dom.document.querySelector('[role="alertdialog"]')

    assert.match(dialog?.textContent ?? '', /Update ready/)
    assert.match(dialog?.textContent ?? '', /Bots and tasks on this computer stop/)
    const update = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Update',
    )

    await click(update as unknown as Element)
    assert.equal(installs, 1)
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})
