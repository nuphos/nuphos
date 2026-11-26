import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { RuntimeInstance } from '../../types/runtime'

// Run with: cd apps/desktop && bun test src/views/settings/CustomProviderSettings.test.tsx

// This Desktop's own state, as the main process broadcasts it after every change.
let local: Record<string, unknown> | null = null
const listeners = new Set<() => void>()

function broadcast(next: Record<string, unknown>) {
  local = next
  for (const listener of listeners) listener()
}

mock.module('../../hooks/useLocalRuntimeState', async () => {
  const { useSyncExternalStore } = await import('react')

  return {
    useLocalRuntimeState: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener)

          return () => listeners.delete(listener)
        },
        () => local,
      ),
  }
})
mock.module('../../components/ui/toast', () => ({
  toast: { success: () => {}, apiError: () => {} },
}))

const { CustomProviderSettings } = await import('./CustomProviderSettings')

// What the main process answers a test or a save with, set per test.
let check: unknown = null
let refusal: Error | null = null

const AGENT = { available: true, online: true, cli: { installed: true, loggedIn: true } }
const HERE = {
  userId: 'u1',
  deviceId: 'd1',
  agents: { 'claude-code': AGENT, codex: AGENT },
}

function codex(local: Partial<NonNullable<RuntimeInstance['local']>>): RuntimeInstance {
  return {
    id: 'local_u1_d1_codex',
    provider: 'codex',
    label: 'Codex',
    kind: 'local',
    local: { ownerUserId: 'u1', deviceId: 'd1', deviceLabel: 'Studio Mac', ...local },
  } as RuntimeInstance
}

async function render(instance: RuntimeInstance) {
  const dom = new Window()
  const calls: unknown[][] = []

  Object.assign(dom, {
    api: {
      localRuntimeCheckCustomProvider: async (provider: string, value: unknown) => {
        calls.push(['check', provider, value])

        return check
      },
      localRuntimeSetCustomProvider: async (provider: string, value: unknown) => {
        calls.push([provider, value])
        if (refusal) throw refusal
        broadcast({
          ...local,
          customProviders: value ? { [provider]: { ...(value as object), apiKey: undefined } } : {},
        })

        return local
      },
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

  await act(() => root.render(createElement(CustomProviderSettings, { instance })))

  return { dom, container, calls, unmount: () => act(() => root.unmount()) }
}

const button = (container: { querySelectorAll: (s: string) => Iterable<unknown> }, name: string) =>
  [...(container.querySelectorAll('button') as Iterable<HTMLButtonElement>)].find(
    (candidate) => candidate.textContent === name,
  )

function type(dom: Window, input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set

  setter?.call(input, value)
  input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
}

test('this computer’s own Codex sets up, shows and removes its custom provider', async () => {
  broadcast(HERE)
  const { dom, container, calls, unmount } = await render(codex({}))

  try {
    assert.ok(container.textContent?.includes('Custom provider'))
    await act(async () => button(container, 'Set up')?.click())
    const [baseUrl, apiKey] = container.querySelectorAll('input') as unknown as HTMLInputElement[]
    const models = container.querySelector('textarea') as unknown as HTMLTextAreaElement

    await act(async () => {
      type(dom, baseUrl!, 'https://gateway.example.com/v1')
      type(dom, apiKey!, 'sk-fictional')
      type(dom, models, 'model-a\nmodel-b')
    })
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as never)
    })
    assert.deepEqual(calls, [
      [
        'codex',
        {
          baseUrl: 'https://gateway.example.com/v1',
          models: ['model-a', 'model-b'],
          apiKey: 'sk-fictional',
        },
      ],
    ])
    // Saved: the row now reads the broadcast state.
    assert.ok(container.textContent?.includes('gateway.example.com · model-a, model-b'))
    await act(async () => button(container, 'Remove')?.click())
    assert.deepEqual(calls[1], ['codex', null])
    assert.ok(button(container, 'Set up'))
  } finally {
    await unmount()
  }
})

test('a saved provider whose key cannot be read says so', async () => {
  broadcast({
    ...HERE,
    agents: {
      ...HERE.agents,
      codex: { ...AGENT, cli: { installed: true, loggedIn: false, customProvider: 'gw.example' } },
    },
    customProviders: { codex: { baseUrl: 'https://gw.example', models: [] } },
  })
  const { container, unmount } = await render(codex({}))

  try {
    assert.ok(container.querySelector('[role="alert"]')?.textContent?.includes('API key'))
  } finally {
    await unmount()
  }
})

test('only this computer’s default Claude Code or Codex has one', async () => {
  broadcast(HERE)
  for (const instance of [
    codex({ deviceId: 'elsewhere' }),
    codex({ ownerUserId: 'someone-else' }),
    codex({ instanceId: 'second' }),
    { ...codex({}), provider: 'opencode' } as RuntimeInstance,
    { ...codex({}), local: undefined, kind: 'managed' } as RuntimeInstance,
  ]) {
    const { container, unmount } = await render(instance)

    assert.equal(container.textContent, '', JSON.stringify(instance.local ?? instance.kind))
    await unmount()
  }
})

test('the form checks the URL as it is typed, tests it, and keeps a refusal in place', async () => {
  broadcast({
    ...HERE,
    customProviders: { codex: { baseUrl: 'https://gw.example/v1', models: [] } },
  })
  const { dom, container, calls, unmount } = await render(codex({}))
  const submit = () =>
    container
      .querySelector('form')
      ?.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as never)

  try {
    await act(async () => button(container, 'Edit')?.click())
    // The saved key is not a field until it is replaced.
    assert.equal(container.querySelectorAll('input').length, 1)
    assert.ok(container.textContent?.includes('•••• saved'))
    const [baseUrl] = container.querySelectorAll('input') as unknown as HTMLInputElement[]

    await act(async () => type(dom, baseUrl!, 'http://gw.example/v1'))
    assert.ok(container.textContent?.includes('The base URL must use https://'))
    assert.equal(button(container, 'Test connection')?.disabled, true)
    await act(async () => type(dom, baseUrl!, 'https://gw.example/v1'))
    check = { host: 'gw.example', reached: false }
    await act(async () => button(container, 'Test connection')?.click())
    assert.deepEqual(calls.at(-1), [
      'check',
      'codex',
      { baseUrl: 'https://gw.example/v1', models: [] },
    ])
    assert.ok(container.textContent?.includes('Couldn’t reach gw.example within 10 s'))
    assert.ok(button(container, 'Save anyway'))
    check = {
      host: 'gw.example',
      reached: true,
      ms: 212,
      failure: { reason: 'api', request: 'POST /responses → 404 Not Found' },
    }
    await act(async () => button(container, 'Test connection')?.click())
    assert.ok(container.textContent?.includes('Reached gw.example in 212 ms'))
    assert.ok(container.querySelector('pre')?.textContent?.includes('404 Not Found'))
    refusal = Object.assign(new Error('No credential store.'), {
      code: 'custom_provider_not_saved',
    })
    await act(async () => submit())
    assert.ok(container.querySelector('[role="alert"]')?.textContent?.includes('credential store'))
  } finally {
    refusal = null
    await unmount()
  }
})
