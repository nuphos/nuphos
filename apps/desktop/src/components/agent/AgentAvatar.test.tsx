import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

mock.module('./BotAvatarImage', () => ({
  BotAvatarImage: ({ file }: { file: string }) => createElement('img', { src: file }),
}))
const { AgentAvatar } = await import('./AgentAvatar')

const dom = new Window()

for (const [key, value] of Object.entries({
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Node: dom.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, { configurable: true, value })

async function render(props: Partial<Parameters<typeof AgentAvatar>[0]>) {
  const container = dom.document.createElement('div')
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(createElement(AgentAvatar, { agentId: 'bot-1', avatar: '07-ada', ...props })),
  )
  const html = container.innerHTML

  await act(() => root.unmount())

  return html
}

test("a Bot's character sits on a full-size disc in its tint, under the runtime badge", async () => {
  const html = await render({ avatarBackground: 'sky', size: 16 })
  const disc = html.indexOf('data-avatar-background="sky"')

  assert.ok(disc > 0, html)
  // A theme token, never a color written into the component.
  assert.match(html, /background: rgb\(var\(--color-avatar-sky\)\)/)
  assert.match(html.slice(disc), /^[^>]*width: 16px; height: 16px/)
  // Drawn first: the character and the badge paint over it.
  assert.ok(disc < html.indexOf('<img'), html)
})

test('unset, None or a tint this build does not know sits on a white disc, never transparent', async () => {
  for (const avatarBackground of [undefined, 'none', 'teal'])
    assert.match(
      await render({ avatarBackground }),
      /data-avatar-background[^>]*background: rgb\(var\(--color-avatar-white\)\)/,
      String(avatarBackground),
    )
})

test('an uploaded photo is not given a background', async () => {
  assert.doesNotMatch(
    await render({
      avatar: 'https://lh3.googleusercontent.com/a/photo',
      avatarBackground: 'sky',
    }),
    /data-avatar-background/,
  )
})

/** The runtime badge's width on a face of this size. */
async function badge(size: number) {
  const html = await render({ provider: 'claude', size })

  return /bottom-0 right-0[^>]*style="width: (\d+)px; height: \1px/.exec(html)?.[1]
}

test('the runtime badge keeps to about a third of a large face, and its old sizes below', async () => {
  assert.equal(await badge(24), '9')
  assert.equal(await badge(28), '12')
  assert.equal(await badge(36), '12')
  assert.equal(await badge(56), '19')
  assert.equal(await badge(72), '24')
})
