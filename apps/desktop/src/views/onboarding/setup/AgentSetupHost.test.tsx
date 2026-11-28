import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  // The window's own events, so it dispatches what the app makes.
  Event: dom.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

type DialogProps = { teamId: string; onBoxCreated?: () => void; onBack?: () => void }

const dialogs: DialogProps[] = []
let devices = { boxAvailable: true, canCreateBox: true, devices: [] }

mock.module('../../../components/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))
mock.module('../../../hooks/useLocalRuntimeState', () => ({ useLocalRuntimeState: () => null }))
mock.module('../../settings/useAgentDevices', () => ({
  useAgentDevices: () => ({ list: devices, error: false, reload: () => {} }),
}))
mock.module('../../settings/AddAgentDialog', () => ({
  AddAgentDialog: (props: DialogProps) => {
    dialogs.push(props)

    return createElement('div', null, `Add computer for ${props.teamId}`)
  },
}))

const { AgentSetupHost } = await import('./AgentSetupHost')
const { OPEN_COMPUTERS, agentSetup, openAddRuntime, openAgentSetup } =
  await import('./agentSetupStore')
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
    (button as HTMLElement).textContent?.startsWith('Rent a computer from Nuphos'),
  ) as HTMLElement | undefined

test('a new user who may make a cloud computer is offered one, and once made it opens Computers', async () => {
  const { container, root } = await render()
  let opened = 0
  const onOpen = () => {
    opened += 1
  }

  window.addEventListener(OPEN_COMPUTERS, onOpen)
  try {
    await act(() => openAgentSetup('team-1'))
    const choice = cloudChoice(container)

    assert.ok(choice, 'the setup offers to rent a computer from Nuphos')
    assert.doesNotMatch(choice.textContent ?? '', /with Claude Code and Codex\./)
    await act(() => choice.click())
    assert.match(container.textContent ?? '', /Add computer for team-1/)
    // Back returns to where it was chosen, then on again.
    await act(() => dialogs.at(-1)?.onBack?.())
    assert.ok(cloudChoice(container), 'Back returns to Connect a runtime')
    await act(() => cloudChoice(container)?.click())
    dialogs.at(-1)?.onBoxCreated?.()
    assert.equal(opened, 1, 'a made computer opens the page where its runtimes are added')
  } finally {
    window.removeEventListener(OPEN_COMPUTERS, onOpen)
    await act(() => agentSetup.close())
    await act(() => root.unmount())
  }
})

test('only a team admin on a deployment with cloud computers is offered one', async () => {
  const { container, root } = await render()

  try {
    await act(() => openAgentSetup())
    assert.equal(cloudChoice(container), undefined, 'no team, no cloud computer')
    devices = { boxAvailable: true, canCreateBox: false, devices: [] }
    await act(() => openAgentSetup('team-1'))
    assert.equal(cloudChoice(container), undefined, 'not an admin')
  } finally {
    devices = { boxAvailable: true, canCreateBox: true, devices: [] }
    await act(() => agentSetup.close())
    await act(() => root.unmount())
  }
})

test('Add new runtime keeps its own flow after a computer is made', async () => {
  const { root } = await render()

  try {
    await act(() => openAddRuntime('team-1'))
    assert.equal(dialogs.at(-1)?.onBoxCreated, undefined)
    assert.equal(dialogs.at(-1)?.onBack, undefined)
  } finally {
    await act(() => agentSetup.close())
    await act(() => root.unmount())
  }
})
