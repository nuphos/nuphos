import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

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

const dialogs: { teamId: string; onBoxCreated?: () => void }[] = []

mock.module('../../../components/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))
mock.module('./LocalAgentsStep', () => ({
  LocalAgentSetupCards: () => createElement('div', null, 'Local agents'),
}))
mock.module('../../settings/AddAgentDialog', () => ({
  AddAgentDialog: (props: { teamId: string; onBoxCreated?: () => void }) => {
    dialogs.push(props)

    return createElement('div', null, `Add computer for ${props.teamId}`)
  },
}))

const { AgentSetupHost } = await import('./AgentSetupHost')
const { agentSetup, openAgentSetup } = await import('./agentSetupStore')
const { createRoot } = await import('react-dom/client')

async function render() {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() => root.render(createElement(AgentSetupHost)))

  return { container, root }
}

const cloudChoice = (container: { querySelectorAll: (s: string) => Iterable<unknown> }) =>
  [...container.querySelectorAll('button')].find((button) =>
    (button as HTMLElement).textContent?.startsWith('Nuphos cloud computer'),
  ) as HTMLElement | undefined

test('a new user who may make a cloud computer is offered one, and it opens on its create step', async () => {
  const { container, root } = await render()
  let created = 0

  try {
    const onBoxCreated = () => {
      created += 1
    }

    await act(() => openAgentSetup({ teamId: 'team-1', onBoxCreated }))
    const choice = cloudChoice(container)

    assert.ok(choice, 'the setup offers a Nuphos cloud computer')
    assert.doesNotMatch(choice.textContent ?? '', /with Claude Code and Codex\./)
    await act(() => choice.click())
    assert.match(container.textContent ?? '', /Add computer for team-1/)
    dialogs.at(-1)?.onBoxCreated?.()
    assert.equal(created, 1, 'a made computer hands off to where its runtimes are added')
  } finally {
    await act(() => agentSetup.close())
    await act(() => root.unmount())
  }
})

test('without a cloud computer to offer, the setup shows only this computer’s agents', async () => {
  const { container, root } = await render()

  try {
    await act(() => openAgentSetup())
    assert.match(container.textContent ?? '', /Local agents/)
    assert.equal(cloudChoice(container), undefined)
  } finally {
    await act(() => agentSetup.close())
    await act(() => root.unmount())
  }
})
