import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createContext, createElement, forwardRef, useContext } from 'react'

import type { ModelControl } from './ModelSelector'
import type {
  SessionConfigOption,
  SessionConfigSelection,
  SessionConfigState,
} from '../../../api/session-config-types'
import type { ReactNode } from 'react'

// Base UI's menu does not render in happy-dom; these keep the props the selector passes,
// and the real model list renders through them. From #3270 (carrying #2419).
const MenuState = createContext({ open: false, setOpen: (_open: boolean) => {} })

mock.module('../../ui/menu', () => ({
  Menu: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }) => createElement(MenuState.Provider, { value: { open, setOpen: onOpenChange } }, children),
  MenuTrigger: forwardRef<HTMLButtonElement, Record<string, unknown>>(function Trigger(
    { children, ...props },
    ref,
  ) {
    const { open, setOpen } = useContext(MenuState)

    return createElement(
      'button',
      { ...props, ref, onClick: () => setOpen(!open) },
      children as ReactNode,
    )
  }),
  MenuPanel: forwardRef<HTMLDivElement, { children?: ReactNode; footer?: ReactNode }>(
    function Panel({ children, footer }, ref) {
      return useContext(MenuState).open
        ? createElement('div', { ref, role: 'menu' }, children, footer)
        : null
    },
  ),
  MenuContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuGroup: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'group' }, children),
  MenuGroupLabel: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-group-label': '' }, children),
  MenuItem: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuSeparator: () => null,
  MenuSubmenu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuSubmenuTrigger: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
  MenuCheckboxItem: ({
    children,
    checked,
    disabled,
    onCheckedChange,
  }: {
    children: ReactNode
    checked: boolean
    disabled?: boolean
    onCheckedChange: () => void
  }) =>
    createElement(
      'button',
      { role: 'menuitemcheckbox', 'aria-checked': checked, disabled, onClick: onCheckedChange },
      children,
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

const opencode: SessionConfigState = {
  status: 'ready',
  options: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue: 'opencode/big-pickle',
      options: [
        { value: 'opencode/beam-free', name: 'OpenCode/Beam Free' },
        { value: 'opencode/big-pickle', name: 'OpenCode/Big Pickle' },
      ],
    },
  ],
}
const withEffort: SessionConfigState = {
  status: 'ready',
  options: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default', description: 'Uses gpt-5.5' },
        { value: 'gpt-5.5', name: 'gpt-5.5' },
        { value: 'gpt-5.4', name: 'gpt-5.4' },
      ],
    },
    {
      id: 'reasoning_effort',
      name: 'Effort',
      kind: 'effort',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    },
  ],
}

function mount() {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let open = false
  const selected: SessionConfigSelection[] = []
  const render = (data: SessionConfigState | undefined, hint?: string) =>
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
              void render(data, hint)
            },
            select: (selection) => selected.push(selection),
            refresh: () => {},
          },
          disabled: Boolean(hint),
          disabledHint: hint,
        }),
      ),
    )
  const chip = () => dom.document.querySelector('[data-model-chip]') as unknown as HTMLButtonElement
  const rows = () =>
    [
      ...dom.document.querySelectorAll('[role="menuitemcheckbox"]'),
    ] as unknown as HTMLButtonElement[]
  const row = (name: string) => rows().find((element) => element.textContent?.includes(name))

  return { root, render, chip, rows, row, selected, isOpen: () => open }
}

// #3709: OpenCode opened a card holding only its model's name, then a list below the chip.
test('a runtime without effort opens its models in one click, grouped by provider', async () => {
  const picker = mount()

  await picker.render(opencode)
  assert.equal(picker.chip().getAttribute('aria-label'), 'Model settings: Big Pickle')
  await act(() => picker.chip().click())
  assert.deepEqual(
    picker.rows().map((element) => element.textContent),
    ['Beam Free', 'Big Pickle'],
    'the rows drop the provider their group names',
  )
  assert.ok(
    [...dom.document.querySelectorAll('[data-group-label]')].some(
      (label) => label.textContent === 'OpenCode',
    ),
  )
  assert.equal(picker.row('Big Pickle')?.getAttribute('aria-checked'), 'true')
  assert.equal(dom.document.querySelector('input[type="range"]'), null, 'no effort to slide')
  await act(() => picker.row('Beam Free')?.click())
  assert.deepEqual(picker.selected, [{ configId: 'model', value: 'opencode/beam-free' }])
  await act(() => picker.root.unmount())
})

test('models and effort open together, and the effort is named, never "Default"', async () => {
  const picker = mount()

  await picker.render(withEffort)
  await act(() => picker.chip().click())
  // A runtime's Default is no row: the list checks the model it stands for.
  assert.deepEqual(
    picker.rows().map((element) => element.textContent),
    ['gpt-5.5', 'gpt-5.4'],
  )
  assert.equal(picker.row('gpt-5.5')?.getAttribute('aria-checked'), 'true')
  assert.ok(dom.document.querySelector('input[type="range"]'), 'the effort slider shows with them')
  assert.match(dom.document.querySelector('[role="menu"]')?.textContent ?? '', /Effort\s*Low/)
  assert.doesNotMatch(dom.document.querySelector('[role="menu"]')?.textContent ?? '', /Default/)
  await act(() => picker.root.unmount())
})

test('a locked model picker shows the setting and why, and a pick changes nothing', async () => {
  const picker = mount()

  await picker.render(opencode, 'Only the owner can change model settings.')
  await act(() => picker.chip().click())
  assert.ok(picker.row('Beam Free'), 'the choices still show')
  assert.match(dom.document.body.textContent ?? '', /Only the owner can change model settings\./)
  assert.equal(picker.row('Beam Free')?.disabled, true)
  await act(() => picker.row('Beam Free')?.click())
  assert.equal(picker.selected.length, 0)
  await act(() => picker.root.unmount())
})

// #3427: the chip opened before its settings arrived stayed on the bare model list.
test('a chip opened while its settings load shows models and effort once they arrive', async () => {
  const picker = mount()

  await picker.render(undefined)
  await act(() => picker.chip().click())
  assert.equal(picker.isOpen(), true, 'the chip opens while its settings load')
  await picker.render(withEffort)
  assert.ok(picker.row('gpt-5.5'), 'the models show')
  assert.ok(dom.document.querySelector('input[type="range"]'), 'the effort slider shows')
  await act(() => picker.root.unmount())
})
