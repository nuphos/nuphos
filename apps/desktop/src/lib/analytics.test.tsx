// The real posthog-js in a DOM, with every way out of the page recorded: what
// matters is what leaves this computer, not which options were passed.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'

import type * as Analytics from './analytics'
import type { UserInfo } from '../types'
import type { PostHog } from 'posthog-js'

const HOST = 'https://analytics.example.test'
const requests: string[] = []
const dom = new Window({ url: 'https://app.example.test/' })
const sent = (url: unknown) => {
  requests.push(String(url))
}

// Every answer carries what PostHog's remote config says for our project: posthog-js
// starts autocapture only once the config says whether the project opted out.
const body = JSON.stringify({ autocapture_opt_out: false })

Object.assign(dom, {
  fetch: (url: unknown) => {
    sent(url)

    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }))
  },
  XMLHttpRequest: class {
    open(_method: string, url: string) {
      sent(url)
    }
    setRequestHeader() {}
    send() {}
  },
})
// posthog-js sends nothing from a browser it takes for an automated one.
Object.defineProperty(dom.navigator, 'webdriver', { value: false })
Object.assign(dom.navigator, {
  sendBeacon: (url: unknown) => {
    sent(url)

    return true
  },
})

// Whether main says usage data is sent, and the listener it tells about a change.
let usage = false
let changed: (send: boolean) => void = () => {}

Object.assign(dom, {
  api: {
    sendUsageData: () => usage,
    onSendUsageDataChanged: (listener: (send: boolean) => void) => {
      changed = listener
    },
  },
})
for (const [key, value] of Object.entries({
  window: dom,
  self: dom,
  document: dom.document,
  navigator: dom.navigator,
  location: dom.location,
  localStorage: dom.localStorage,
  sessionStorage: dom.sessionStorage,
  Element: dom.Element,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  MouseEvent: dom.MouseEvent,
  fetch: dom.fetch,
  XMLHttpRequest: dom.XMLHttpRequest,
}))
  Object.defineProperty(globalThis, key, { value, configurable: true })
process.env.VITE_POSTHOG_KEY = 'phc_test'
process.env.VITE_POSTHOG_HOST = HOST

const user = {
  id: 'user-1',
  email: 'someone@example.com',
  name: 'Some One',
  username: 'someone',
} as UserInfo
const TITLE = 'Quarterly payroll export'
const button = dom.document.createElement('button')

button.textContent = TITLE
button.setAttribute('title', TITLE)
button.setAttribute('aria-label', TITLE)
// posthog-js reads attributes by index, which happy-dom's attribute map does not offer.
Object.defineProperty(button, 'attributes', { value: [...button.attributes] })
dom.document.body.append(button)

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const use = async (analytics: typeof Analytics) => {
  analytics.identifyUser(user)
  analytics.track('app_ready')
  analytics.trackPageview({ pathname: '/', href: 'https://app.example.test/' })
  button.click()
  await settle()
}

test('usage analytics stays off a self-hosted backend, and clicks carry no text on Cloud', async () => {
  const analytics = await import('./analytics')
  const posthog = (await import('posthog-js')).default as PostHog
  const events: { event: string }[] = []

  // A self-hosted backend: PostHog is never started, whatever the app does.
  analytics.initAnalytics()
  await use(analytics)
  assert.equal(posthog.__loaded, false)
  assert.deepEqual(requests, [])

  // The backend becomes Nuphos Cloud: analytics starts.
  usage = true
  changed(true)
  posthog.on('eventCaptured', (event: { event: string }) => events.push(event))
  await settle()
  await use(analytics)
  const click = events.find((event) => event.event === '$autocapture')

  assert.ok(click, 'the click is recorded')
  assert.ok(requests.length > 0 && requests.every((url) => url.startsWith(HOST)))
  // Nothing of what the button says, as text or as an attribute.
  assert.ok(!JSON.stringify(events).includes(TITLE), JSON.stringify(click))

  // Debugging telemetry skips person processing; product events keep it.
  analytics.track('agent_end_effects_deferred', { stream_id: 'st1' })
  await settle()
  const profile = (name: string) =>
    (events.findLast((event) => event.event === name) as { properties?: Record<string, unknown> })
      ?.properties?.$process_person_profile

  assert.equal(profile('agent_end_effects_deferred'), false)
  assert.equal(profile('app_ready'), true)

  // Back to a self-hosted backend during the same session: nothing more is sent.
  usage = false
  changed(false)
  await settle()
  requests.length = 0
  events.length = 0
  await use(analytics)
  analytics.resetAnalytics()
  await settle()
  assert.deepEqual(events, [])
  assert.deepEqual(requests, [])
})
