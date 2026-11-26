import assert from 'node:assert/strict'

import { spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/RuntimeLoginBody.test.tsx

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

const { RuntimeLoginBody } = await import('./RuntimeLoginBody')
const { createRoot } = await import('react-dom/client')

type Props = Parameters<typeof RuntimeLoginBody>[0]
type Login = Record<string, unknown> | null

const instance = { provider: 'cursor', local: { deviceLabel: 'Atlas Studio' } }
const COUNT = /\d:\d\d/

/** Renders the sign-in as its hook would report `login`, on a clock the test moves. */
async function setup(extra: Record<string, unknown> = {}) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const clock = { now: 1_000_000 }
  const spy = spyOn(Date, 'now').mockImplementation(() => clock.now)
  const show = (login: Login) => {
    const failed = login?.state === 'failed' || login?.state === 'cancelled'

    return act(() =>
      root.render(
        createElement(RuntimeLoginBody, {
          instance,
          ...extra,
          state: {
            login,
            error: null,
            reachable: true,
            awaiting: login?.state === 'awaiting_authorization',
            failed,
            retry: 0,
            submitCode: async () => {},
            ...(extra.state as object | undefined),
          },
        } as unknown as Props),
      ),
    )
  }
  const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
  const text = () => container.textContent ?? ''
  const done = async () => {
    spy.mockRestore()
    await act(() => root.unmount())
    container.remove()
  }

  return { container, clock, show, wait, text, done }
}

const installing = { attemptId: 'a', state: 'starting', installing: true }

test('a fast setup moves through its steps with no bar or count', async () => {
  const view = await setup()

  try {
    await view.show(null)
    assert.match(view.text(), /Starting the runtime on Atlas Studio/)
    assert.equal(view.container.querySelector('.setup-bar'), null)

    view.clock.now += 1_500
    await view.wait(250)
    await view.show(installing)
    // The started step keeps its check before the install shows.
    assert.match(view.text(), /Runtime started on Atlas Studio/)
    assert.doesNotMatch(view.text(), /cursor\.com/)
    await view.wait(700)
    assert.match(view.text(), /Installing Cursor/)
    assert.match(view.text(), /cursor\.com/)
    assert.equal(view.container.querySelector('.setup-bar'), null)

    view.clock.now += 1_500
    await view.wait(250)
    await view.show({ attemptId: 'a', state: 'awaiting_authorization', userCode: 'ABCD-1234' })
    await view.wait(700)
    assert.match(view.text(), /Cursor installed/)
    assert.match(view.text(), /ABCD–1234/)
    assert.doesNotMatch(view.text(), COUNT)
    assert.doesNotMatch(view.text(), /Still going/)
  } finally {
    await view.done()
  }
})

test('a one-time code counts down to its expiry on the sign-in row', async () => {
  const view = await setup()
  const code = (ms: number) => ({
    attemptId: 'a',
    state: 'awaiting_authorization',
    userCode: 'ABCD-1234',
    expiresAt: new Date(view.clock.now + ms).toISOString(),
  })

  try {
    await view.show(code(90_000))
    await view.wait(700)
    assert.match(view.text(), /1:30 left/)
    view.clock.now += 31_000
    await view.wait(250)
    assert.match(view.text(), /0:59 left/)
    view.clock.now += 60_000
    await view.wait(250)
    assert.doesNotMatch(view.text(), / left/)
  } finally {
    await view.done()
  }
})

test('a slow install counts its time from 0:05 and says it is still going after 20s', async () => {
  const view = await setup()

  try {
    await view.show(installing)
    assert.match(view.text(), /Installing Cursor/)
    assert.match(view.text(), /Usually under a minute/)
    assert.doesNotMatch(view.text(), COUNT)

    view.clock.now += 6_000
    await view.wait(300)
    assert.match(view.text(), /0:06/)
    assert.ok(view.container.querySelector('.setup-bar'))
    assert.doesNotMatch(view.text(), /Still going/)

    view.clock.now += 15_000
    await view.wait(300)
    assert.match(view.text(), /0:21/)
    assert.match(view.text(), /Still going\. Cursor downloads from cursor\.com first/)

    view.clock.now += 44_000
    await view.wait(300)
    assert.match(view.text(), /1:05/)
    assert.match(view.text(), /Still going/)
  } finally {
    await view.done()
  }
})

test('a failed install turns its own step red, with the command and the raw error', async () => {
  const view = await setup()
  const error = 'curl: (6) Could not resolve host: cursor.com'

  try {
    await view.show(null)
    view.clock.now += 1_000
    await view.wait(250)
    await view.show(installing)
    await view.wait(700)
    view.clock.now += 9_000
    await view.wait(250)
    await view.show({ attemptId: 'a', state: 'failed', error })

    assert.match(view.text(), /Runtime started on Atlas Studio/)
    assert.match(view.text(), /Cursor’s installer stopped/)
    assert.match(view.text(), /0:09/)
    assert.match(view.text(), /curl -fsSL https:\/\/cursor\.com\/install \| bash/)
    assert.match(view.text(), /Sign in with Cursor/)
    assert.equal(view.container.querySelector('details summary')?.textContent, 'Details')
    assert.equal(view.container.querySelector('details pre')?.textContent, error)
    assert.ok(view.container.querySelector('[aria-label="Copy install command"]'))
    assert.ok(view.container.querySelector('[aria-label="Copy error details"]'))
  } finally {
    await view.done()
  }
})

test('a sign-in that fails after asking keeps the install done', async () => {
  const view = await setup()

  try {
    await view.show(installing)
    await view.show({ attemptId: 'a', state: 'awaiting_authorization', userCode: 'ABCD-1234' })
    await view.show({ attemptId: 'a', state: 'cancelled' })

    assert.match(view.text(), /Cursor installed/)
    assert.match(view.text(), /Sign-in did not finish/)
    assert.match(view.text(), /Sign-in was cancelled\./)
    assert.equal(view.container.querySelector('details'), null)
  } finally {
    await view.done()
  }
})

const claude = {
  provider: 'claude-code',
  label: 'Claude Code',
  local: { deviceLabel: 'Atlas Studio' },
}
const waiting = { attemptId: 'a', state: 'awaiting_authorization', userCode: 'ABCD-1234' }

function click(container: Element, name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === name,
  )

  assert.ok(button, `no ${name} button`)
  act(() => (button as unknown as HTMLElement).click())
}

function type(container: Element, value: string) {
  const input = container.querySelector('input') as unknown as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set

  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
  })
}

test('an API key is entered from the sign-in step, its prefix only a hint', async () => {
  const sent: string[] = []
  const view = await setup({
    instance: claude,
    state: { submitCode: async (code: string) => void sent.push(code) },
  })

  try {
    await view.show(waiting)
    await view.wait(700)
    assert.match(view.text(), /Claude account/)
    assert.match(view.text(), /ABCD–1234/)
    click(view.container, 'API key')
    assert.match(view.text(), /Anthropic API key/)
    assert.match(view.text(), /Get a key in the Anthropic Console/)
    type(view.container, 'not-a-key')
    assert.match(view.text(), /Anthropic keys usually start with sk-ant-/)
    type(view.container, `sk-ant-${'x'.repeat(24)}`)
    assert.match(view.text(), /Looks like an Anthropic key/)
    await act(async () => {
      view.container.querySelector('form')?.requestSubmit()
      await Promise.resolve()
    })
    assert.deepEqual(sent, [`sk-ant-${'x'.repeat(24)}`])
    assert.match(view.text(), /Verifying your sign-in/)
  } finally {
    await view.done()
  }
})

test('a saved key is removed after a confirmation, or swapped for the account', async () => {
  const calls: boolean[] = []
  const view = await setup({
    instance: claude,
    current: 'key',
    onSignOut: async (switching: boolean) => void calls.push(switching),
  })

  try {
    await view.show(waiting)
    await view.wait(700)
    assert.match(view.text(), /Signed inAPI key/)
    click(view.container, 'Remove key')
    assert.match(view.text(), /Remove the API key\?/)
    assert.match(view.text(), /Claude Code signs out/)
    click(view.container, 'Remove key')
    assert.deepEqual(calls, [false])

    click(view.container, 'Claude account')
    assert.match(view.text(), /The key is removed from the runtime first/)
    assert.doesNotMatch(view.text(), /ABCD–1234/)
    click(view.container, 'Continue with Claude')
    assert.deepEqual(calls, [false, true])
  } finally {
    await view.done()
  }
})

test('a key in place of an account says what it signs out of', async () => {
  const view = await setup({ instance: claude, current: 'account' })

  try {
    await view.show(waiting)
    await view.wait(700)
    assert.match(view.text(), /Signed inClaude account/)
    click(view.container, 'API key')
    assert.match(view.text(), /signs Claude Code out of its Claude account/)
    assert.match(view.text(), /Use this key/)
  } finally {
    await view.done()
  }
})

test('answered questions stay above the next one, and Change starts over', async () => {
  let cancels = 0
  let restarts = 0
  const view = await setup({
    instance: { provider: 'hermes', label: 'Hermes Agent', local: { deviceLabel: 'Atlas Studio' } },
    state: {
      cancel: async () => {
        cancels += 1

        return true
      },
      restart: () => {
        restarts += 1
      },
    },
  })
  const choose = {
    kind: 'choose',
    message: 'Which provider should Hermes use?',
    options: [
      { value: 'deepinfra', label: 'DeepInfra', hint: 'API key' },
      { value: 'nous', label: 'Nous Portal', hint: 'Account' },
    ],
  }

  try {
    await view.show({ attemptId: 'a', state: 'awaiting_authorization', step: choose })
    await view.wait(700)
    await act(async () => {
      click(view.container, 'DeepInfraAPI key')
      await Promise.resolve()
    })
    await view.show({
      attemptId: 'a',
      state: 'awaiting_authorization',
      step: { kind: 'input', message: 'DeepInfra API key', secret: true },
    })
    assert.match(view.text(), /Which provider should Hermes use\?DeepInfraChange/)
    click(view.container, 'Change')
    await act(() => Promise.resolve())
    assert.equal(cancels, 1)
    assert.equal(restarts, 1)
  } finally {
    await view.done()
  }
})
