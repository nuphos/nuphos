import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown } from 'streamdown'

import { messageRehypePlugins } from './messageRehypePlugins.ts'

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      rehypePlugins: messageRehypePlugins,
      components: { a: ({ href, children }) => createElement('a', { href }, children) },
      children: markdown,
    }),
  )

test('relative file links keep their href as written', () => {
  const html = render('[a](src/a.ts) [b](./docs/b.md:3) [c](/workspace/c.md)')

  assert.match(html, /href="src\/a\.ts"/)
  assert.match(html, /href="\.\/docs\/b\.md:3"/)
  assert.match(html, /href="\/workspace\/c\.md"/)
})

test('unsafe protocols and event handlers are still stripped', () => {
  const html = render(
    '[x](javascript:alert(1)) [y](data:text/html,x) <img src="data:image/png;base64,AAAA" onerror="alert(1)">',
  )

  assert.doesNotMatch(html, /javascript:|data:|onerror/)
})
