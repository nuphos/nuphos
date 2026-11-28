import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/BoxAgentSetup.test.tsx

mock.module('../../components/Modal', () => ({
  Modal: (props: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement(
      'div',
      { role: 'dialog', 'aria-label': props.title },
      props.children,
      props.footer,
    ),
}))

mock.module('../../hooks/useThisComputer', () => ({
  useThisComputer: () => ({ userId: 'u1', deviceId: 'd1' }),
}))

// A native select stands in for the app's, which happy-dom cannot open.
mock.module('../../components/ui/select', () => ({
  AppSelect: (props: {
    ariaLabel: string
    value: string
    options: { value: string; label: string }[]
    onValueChange: (value: string) => void
  }) =>
    createElement(
      'select',
      {
        'aria-label': props.ariaLabel,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onValueChange(event.target.value),
      },
      props.options.map((option) =>
        createElement('option', { key: option.value, value: option.value }, option.label),
      ),
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
browser.Event = dom.Event
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
const calls: { saved: unknown[][]; removed: string[]; logins: number } = {
  saved: [],
  removed: [],
  logins: 0,
}
let saveError: Error | null = null

Object.assign(dom, {
  api: {
    localRuntimeSetCustomProvider: async (...args: unknown[]) => {
      calls.saved.push(args)
      if (saveError) throw saveError

      return {}
    },
    boxRemoveAgent: async (_deviceId: string, _teamId: string, instanceId: string) => {
      calls.removed.push(instanceId)
    },
    boxCreateAgent: async () => ({
      runtimeId: 'rt1',
      instanceId: 'i1',
      provider: 'cursor',
      label: 'Cursor',
    }),
    // OpenCode's free models, or a runtime already signed in, finish with no prompt.
    atlasStartRuntimeLogin: async () => {
      calls.logins += 1

      return { attemptId: 'a', state: 'connected' }
    },
  },
})

const { BoxAgentSetup } = await import('./BoxAgentSetup')
const { createRoot } = await import('react-dom/client')

test('a runtime that is set up says it is ready until Done', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const done: (string | null)[] = []

  try {
    await act(() =>
      root.render(
        createElement(BoxAgentSetup, {
          teamId: 't1',
          device: { deviceId: 'd1', label: 'Atlas Studio' },
          provider: 'cursor',
          agents: [],
          onDone: (runtimeId: string | null) => done.push(runtimeId),
        } as unknown as Parameters<typeof BoxAgentSetup>[0]),
      ),
    )
    const form = container.querySelector('form')

    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const text = container.textContent ?? ''

    assert.equal(
      container.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
      'Cursor runtime added',
    )
    assert.match(text, /Cursor is ready on Atlas Studio/)
    assert.match(text, /Bots and tasks can now run on it\./)
    assert.deepEqual(done, [])

    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Done')

    assert.ok(button)
    await act(() => button.click())
    assert.deepEqual(done, ['rt1'])
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})

/** Types into a controlled field as a person would, so React sees the change. */
function type(field: Element, value: string) {
  const proto = Object.getPrototypeOf(field) as object
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

  setter?.call(field, value)
  field.dispatchEvent(
    new dom.Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
  )
}

async function addOpenCode(container: HTMLElement, provider = 'opencode') {
  const root = createRoot(container)

  await act(() =>
    root.render(
      createElement(BoxAgentSetup, {
        teamId: 't1',
        device: { deviceId: 'd1', ownerUserId: 'u1', label: 'Atlas Studio' },
        provider,
        agents: [],
        onDone: () => {},
      } as unknown as Parameters<typeof BoxAgentSetup>[0]),
    ),
  )
  await act(() => type(container.querySelector('select[aria-label="Provider"]')!, 'openai'))
  await act(() => type(container.querySelector('input[type="url"]')!, 'http://127.0.0.1:4000/v1'))
  await act(() => type(container.querySelector('textarea')!, 'llama3\nqwen3'))
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  return root
}

test('an OpenCode here with its own provider saves it and skips the sign-in', async () => {
  const container = dom.document.createElement('div') as unknown as HTMLElement

  dom.document.body.append(container as never)
  calls.saved = []
  calls.removed = []
  calls.logins = 0
  saveError = null
  const root = await addOpenCode(container)

  try {
    assert.deepEqual(calls.saved, [
      ['opencode', { baseUrl: 'http://127.0.0.1:4000/v1', models: ['llama3', 'qwen3'] }, 'i1'],
    ])
    assert.equal(calls.logins, 0)
    assert.match(container.textContent ?? '', /OpenCode is ready on Atlas Studio/)
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})

test('a provider that is not saved removes the runtime and says why', async () => {
  const container = dom.document.createElement('div') as unknown as HTMLElement

  dom.document.body.append(container as never)
  calls.saved = []
  calls.removed = []
  saveError = new Error('No secure credential store')
  const root = await addOpenCode(container)

  try {
    assert.equal(calls.saved.length, 1)
    assert.deepEqual(calls.removed, ['i1'])
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /credential store/)
    assert.ok(container.querySelector('form'))
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})

test('a Codex or Claude Code here saves its own provider too; Azure is not one of Claude Code’s', async () => {
  for (const provider of ['codex', 'claude-code']) {
    const container = dom.document.createElement('div') as unknown as HTMLElement

    dom.document.body.append(container as never)
    calls.saved = []
    calls.logins = 0
    saveError = null
    const root = await addOpenCode(container, provider)

    try {
      assert.deepEqual(calls.saved, [
        [provider, { baseUrl: 'http://127.0.0.1:4000/v1', models: ['llama3', 'qwen3'] }, 'i1'],
      ])
      assert.equal(calls.logins, 0)
    } finally {
      await act(() => root.unmount())
      container.remove()
    }
  }
  const container = dom.document.createElement('div') as unknown as HTMLElement
  const root = createRoot(container)

  dom.document.body.append(container as never)
  await act(() =>
    root.render(
      createElement(BoxAgentSetup, {
        teamId: 't1',
        device: { deviceId: 'd1', ownerUserId: 'u1', label: 'Atlas Studio' },
        provider: 'claude-code',
        agents: [],
        onDone: () => {},
      } as unknown as Parameters<typeof BoxAgentSetup>[0]),
    ),
  )
  const options = [...container.querySelectorAll('select[aria-label="Provider"] option')].map(
    (option) => (option as HTMLOptionElement).value,
  )

  assert.ok(options.includes('openai'))
  assert.ok(!options.includes('azure'))
  await act(() => root.unmount())
  container.remove()
})
