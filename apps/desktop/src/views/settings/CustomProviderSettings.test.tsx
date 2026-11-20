import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/CustomProviderSettings.test.tsx

const errors: unknown[][] = []

mock.module('../../components/ui/toast', () => ({
  toast: { error: (...args: unknown[]) => errors.push(args), success: () => null },
}))

const { CustomProviderSettings } = await import('./CustomProviderSettings')

test('a refused save shows the reason the main process gave, without the IPC wrapper', async () => {
  const dom = new Window()
  const reason =
    'This provider doesn’t serve the OpenAI Responses API that Codex needs at https://api.example.com/v1/responses.'

  Object.assign(dom, {
    api: {
      localRuntimeSetCustomProvider: () =>
        Promise.reject(
          new Error(
            `Error invoking remote method 'localRuntime:setCustomProvider': Error: ${reason}`,
          ),
        ),
    },
  })
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(CustomProviderSettings, {
        provider: 'codex',
        name: 'Codex',
        saved: { baseUrl: 'https://api.example.com/v1', models: [] },
        onSaved: () => null,
      }),
    ),
  )
  const edit = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit')

  await act(async () => edit?.click())
  await act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
  })

  assert.deepEqual(errors, [['Could not save the custom provider', reason]])
  await act(() => root.unmount())
})
