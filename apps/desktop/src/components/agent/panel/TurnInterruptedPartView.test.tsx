import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const installed: string[] = []

const real = await import('../../../api')

mock.module('../../../api', () => ({
  ...real,
  api: {
    ...real.api,
    localRuntimeInstallAgent: async (provider: string) => {
      installed.push(provider)

      return { agents: { [provider]: { cli: { installed: true } } } }
    },
  },
}))
mock.module('../../ui/toast', () => ({
  toast: { success: () => undefined, error: () => undefined, apiError: () => undefined },
}))

const { TurnInterruptedPartView } = await import('./TurnInterruptedPartView')
const { TurnSwitchAgentContext } = await import('./turnFailureActions')
const { normalizeTurnInterruptedPart } = await import('./turnInterrupted')

test('a broken Codex on this computer offers its installer on the failed turn', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  // As the transcript stores it, so a reloaded conversation shows the same line.
  const part = normalizeTurnInterruptedPart({
    type: 'turn-interrupted',
    id: 'r1:interrupted',
    reason: 'error',
    message:
      "The agent's CLI couldn't start on this computer. Reinstall it with the Install button, then resend your message.",
    createdAt: '2026-11-18T08:00:00Z',
    cause: 'cli',
  })!
  const render = (reinstall?: 'codex') =>
    act(() =>
      root.render(
        createElement(
          TurnSwitchAgentContext.Provider,
          { value: { partId: part.id, switchAgent: () => undefined, reinstall } },
          createElement(TurnInterruptedPartView, { part }),
        ),
      ),
    )
  const install = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Install Codex')

  await render('codex')
  assert.ok(install(), 'Install Codex leads the line')
  await act(async () => {
    install()!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true }) as unknown as Event)
  })
  assert.deepEqual(installed, ['codex'])

  // Another computer's agent: this computer's installer cannot repair it.
  await render()
  assert.equal(install(), undefined)
  act(() => root.unmount())
})
