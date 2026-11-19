import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ModelControl } from './ModelSelector'
import type {
  SessionConfigOption,
  SessionConfigSelection,
  SessionConfigState,
} from '../../../api/session-config-types'
import type { ReactNode } from 'react'

// Base UI's menu does not render in happy-dom; these keep the props the selector passes.
// From #3270 (carrying #2419), whose header picker the composer's replaced.
mock.module('../../ui/menu', () => ({
  Menu: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  MenuContent: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'menu' }, children),
  MenuGroup: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuGroupLabel: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuItem: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuSeparator: () => null,
}))
mock.module('./ModelMenu', () => ({
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

const { ModelSelector } = await import('./ModelSelector')
const { createRoot } = await import('react-dom/client')

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

test('a locked model picker shows the setting and why, and a pick changes nothing', async () => {
  const selected: SessionConfigSelection[] = []
  const control: ModelControl = {
    data: offering,
    loading: false,
    slow: false,
    saving: false,
    error: null,
    writeError: null,
    queued: undefined,
    open: true,
    setOpen: () => {},
    select: (selection) => selected.push(selection),
    refresh: () => {},
  }
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const item = (name: string) =>
    [...dom.document.querySelectorAll('[role="menuitem"]')].find((element) =>
      element.textContent?.includes(name),
    ) as unknown as HTMLButtonElement | undefined
  const render = (hint?: string) =>
    act(() =>
      root.render(
        createElement(ModelSelector, { control, disabled: Boolean(hint), disabledHint: hint }),
      ),
    )

  // A runtime without effort opens the same card; its model list is one step further.
  const selectModel = () =>
    act(() =>
      (
        dom.document.querySelector('[aria-label="Select model"]') as unknown as HTMLButtonElement
      ).click(),
    )

  await render()
  assert.equal(item('Opus'), undefined, 'no bare model list')
  assert.equal(dom.document.querySelector('input[type="range"]'), null, 'no effort to slide')
  await selectModel()
  // The owner's pick goes through.
  await act(() => item('Opus')?.click())
  assert.deepEqual(selected, [{ configId: 'model', value: 'opus' }])

  // Anyone else sees the same choices, is told why, and a pick changes nothing.
  await render('Only the owner can change model settings.')
  if (!item('Opus')) await selectModel()
  assert.ok(item('Opus'), 'the choices still show')
  assert.match(dom.document.body.textContent ?? '', /Only the owner can change model settings\./)
  assert.equal(item('Opus')?.disabled, true)
  await act(() => item('Opus')?.click())
  assert.equal(selected.length, 1)
  await act(() => root.unmount())
})

// #3427: the chip opened before its settings arrived stayed on the bare model list.
test('a chip opened while its settings load shows the effort card once they arrive', async () => {
  const withEffort: SessionConfigState = {
    status: 'ready',
    options: [
      ...offering.options,
      {
        id: 'effort',
        name: 'Effort',
        kind: 'effort',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    ],
  }
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let open = false
  const render = (data?: SessionConfigState) =>
    act(() =>
      root.render(
        createElement(ModelSelector, {
          control: {
            data,
            loading: !data,
            slow: false,
            saving: false,
            error: null,
            writeError: null,
            queued: undefined,
            open,
            setOpen: (next: boolean) => {
              open = next
            },
            select: () => {},
            refresh: () => {},
          },
          disabled: false,
        }),
      ),
    )

  await render()
  const chip = dom.document.querySelector('[data-model-chip]') as unknown as HTMLButtonElement

  await act(() => chip.click())
  assert.equal(open, true, 'the chip opens while its settings load')
  await render(withEffort)
  assert.equal(dom.document.querySelector('[role="menu"]'), null, 'no bare model list')
  assert.ok(dom.document.querySelector('input[type="range"]'), 'the effort slider shows')
  await act(() => root.unmount())
})
