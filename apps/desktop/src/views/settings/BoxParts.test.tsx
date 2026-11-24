import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import type { AgentDevice } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'
import type { ReactNode } from 'react'

mock.module('../../components/ui/menu', () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuTrigger: ({ children }: { children: ReactNode }) => createElement('button', null, children),
  MenuContent: ({ children }: { children: ReactNode }) => createElement('ul', null, children),
  MenuItem: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) =>
    createElement('li', { 'aria-disabled': disabled ? 'true' : undefined }, children),
}))

const { NewAgentMenu } = await import('./BoxParts')

const agent = (provider: RuntimeInstance['provider'], signedIn: boolean) =>
  ({ id: provider, provider, local: { signedIn } }) as RuntimeInstance

function items(agents: RuntimeInstance[]) {
  const html = renderToStaticMarkup(
    createElement(NewAgentMenu, {
      device: { label: 'Studio' } as AgentDevice,
      agents,
      busy: false,
      onAdd: () => {},
    }),
  )

  return [...html.matchAll(/<li( aria-disabled="true")?>(.*?)<\/li>/g)].map(
    ([, disabled, row]) => ({
      text: row!.replace(/<[^>]+>/g, ''),
      disabled: Boolean(disabled),
    }),
  )
}

test('a computer without Antigravity does not list it', () => {
  const rows = items([agent('codex', true)])

  assert.ok(rows.some((row) => row.text === 'Codex'))
  assert.equal(
    rows.find((row) => row.text.includes('Antigravity')),
    undefined,
  )
  assert.equal(rows.filter((row) => row.disabled).length, 0)
})

test('a signed-in Antigravity is already on the card, so the menu leaves it out', () => {
  const rows = items([agent('antigravity', true)])

  assert.equal(
    rows.find((row) => row.text.includes('Antigravity')),
    undefined,
  )
})

test('a signed-out Antigravity is offered to sign in', () => {
  const rows = items([agent('antigravity', false)])

  assert.deepEqual(
    rows.find((row) => row.text.includes('Antigravity')),
    { text: 'Sign in to Antigravity', disabled: false },
  )
})
