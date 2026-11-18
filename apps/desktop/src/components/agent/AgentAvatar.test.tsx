import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('./BotAvatarImage', () => ({
  BotAvatarImage: ({ file }: { file: string }) => createElement('img', { src: file }),
}))
const { AgentAvatar } = await import('./AgentAvatar')

const render = (props: Partial<Parameters<typeof AgentAvatar>[0]>) =>
  renderToStaticMarkup(createElement(AgentAvatar, { agentId: 'bot-1', avatar: '07-ada', ...props }))

test("a Bot's character sits on a full-size disc in its tint, under the runtime badge", () => {
  const html = render({ avatarBackground: 'sky', size: 16 })
  const disc = html.indexOf('data-avatar-background="sky"')

  assert.ok(disc > 0, html)
  // A theme token, never a color written into the component.
  assert.match(html, /background:rgb\(var\(--color-avatar-sky\)\)/)
  assert.match(html.slice(disc), /^[^>]*width:16px;height:16px/)
  // Drawn first: the character and the badge paint over it.
  assert.ok(disc < html.indexOf('<img'), html)
})

test('None, or a tint this build does not know, looks exactly as before', () => {
  const plain = render({})

  assert.doesNotMatch(plain, /data-avatar-background/)
  assert.equal(render({ avatarBackground: 'none' }), plain)
  assert.equal(render({ avatarBackground: 'teal' }), plain)
})

test('an uploaded photo is not given a background', () => {
  assert.doesNotMatch(
    render({ avatar: 'https://lh3.googleusercontent.com/a/photo', avatarBackground: 'sky' }),
    /data-avatar-background/,
  )
})
