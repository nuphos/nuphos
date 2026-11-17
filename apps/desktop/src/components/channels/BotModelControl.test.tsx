import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'

import type {
  SessionConfigOption,
  SessionConfigSelection,
  SessionConfigState,
} from '../../api/session-config-types'
import type { ReactNode } from 'react'

let config: SessionConfigState | null = null
// Opening is Base UI's, so the menu starts open where a test needs it.
let startOpen = false
const asked: unknown[] = []
const selected: SessionConfigSelection[] = []

// The Bot's session config, as the runtime reports it; picks are recorded, not sent.
mock.module('../agent/panel/useSessionConfig', () => ({
  useSessionConfig: (session: unknown) => {
    const [open, setOpen] = useState(startOpen)

    asked.push(session)

    return {
      data: config,
      loading: false,
      slow: false,
      saving: false,
      error: null,
      writeError: null,
      queued: undefined,
      open,
      setOpen,
      select: (selection: SessionConfigSelection) => selected.push(selection),
      refresh: () => {},
    }
  },
}))

// Base UI's menu does not render in happy-dom; these keep the props the selector passes.
mock.module('../ui/menu', () => ({
  Menu: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  MenuContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'menu' }, children),
  MenuGroup: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuGroupLabel: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuItem: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuSeparator: () => null,
}))
mock.module('../agent/panel/ModelMenu', () => ({
  ModelMenu: ({
    model,
    blocked,
    onSelect,
    footer,
  }: {
    model: SessionConfigOption
    blocked: boolean
    onSelect: (value: string) => void
    footer: ReactNode
  }) =>
    createElement(
      'div',
      null,
      ...model.options.map((choice) =>
        createElement(
          'button',
          {
            key: choice.value,
            role: 'menuitem',
            disabled: blocked,
            onClick: () => onSelect(choice.value),
          },
          choice.name,
        ),
      ),
      footer,
    ),
}))

const { BotModelControl } = await import('./BotTaskButton')

const offering: SessionConfigState = {
  status: 'ready',
  options: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue: 'sonnet',
      options: [
        { value: 'sonnet', name: 'Sonnet' },
        { value: 'opus', name: 'Opus' },
      ],
    },
  ],
}

test("the Bot chat header shows the Bot's runtime and model, and only its owner can switch", async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
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
  const render = (owned: boolean) =>
    act(() =>
      root.render(
        createElement(BotModelControl, {
          teamId: 'team',
          botId: 'bot',
          provider: 'claude-code',
          owned,
        }),
      ),
    )
  const chip = () =>
    container.querySelector('button[aria-label^="Model settings"]') as unknown as HTMLElement | null
  const item = (name: string) =>
    [...dom.document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(
      (element) => element.textContent?.includes(name),
    ) as unknown as HTMLElement | undefined
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

  try {
    // A runtime that reports no model controls gets no chip.
    config = { status: 'unsupported', options: [] }
    await render(true)
    assert.equal(chip(), null)

    // The owner sees the runtime and model, and a pick goes to this Bot's session.
    config = offering
    await render(true)
    assert.deepEqual(asked.at(-1), { sessionId: 'bot', teamId: 'team' })
    assert.equal(chip()?.getAttribute('aria-label'), 'Model settings: Claude Code Sonnet')
    await act(() => root.unmount())
    startOpen = true
    const owner = createRoot(container as unknown as HTMLElement)

    await act(() =>
      owner.render(
        createElement(BotModelControl, {
          teamId: 'team',
          botId: 'bot',
          provider: 'claude-code',
          owned: true,
        }),
      ),
    )
    await settle()
    await act(() => item('Opus')?.click())
    assert.deepEqual(selected, [{ configId: 'model', value: 'opus' }])

    // Anyone else sees the same setting, is told why, and a pick changes nothing.
    await act(() => owner.unmount())
    const viewer = createRoot(container as unknown as HTMLElement)

    await act(() =>
      viewer.render(
        createElement(BotModelControl, {
          teamId: 'team',
          botId: 'bot',
          provider: 'claude-code',
          owned: false,
        }),
      ),
    )
    assert.equal(chip()?.getAttribute('aria-label'), 'Model settings: Claude Code Sonnet')
    await settle()
    assert.ok(item('Opus'), 'the viewer sees the choices')
    assert.match(dom.document.body.textContent ?? '', /Only the owner can change model settings\./)
    assert.equal((item('Opus') as unknown as HTMLButtonElement | undefined)?.disabled, true)
    await act(() => item('Opus')?.click())
    assert.equal(selected.length, 1)
    await act(() => viewer.unmount())
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
