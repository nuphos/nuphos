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

test('bare paths in prose, inline code and path-only blocks become file links', () => {
  const html = render(
    '檔案在 /data/workspace/a.mp4。\n\n`/data/workspace/b.md` `npm i`\n\n```\n/data/workspace/c.md\n/data/workspace/d.md:12\n```',
  )

  assert.match(html, /<a href="\/data\/workspace\/a\.mp4">\/data\/workspace\/a\.mp4<\/a>。/)
  assert.match(
    html,
    /<a href="\/data\/workspace\/b\.md"><code[^>]*>\/data\/workspace\/b\.md<\/code><\/a>/,
  )
  assert.doesNotMatch(html, /<a[^>]*><code[^>]*>npm i/)
  assert.match(html, /<a href="\/data\/workspace\/c\.md"><code[^>]*>/)
  assert.match(html, /<a href="\/data\/workspace\/d\.md:12"><code[^>]*>/)
})

test('a long session-home path is linked whole', () => {
  const path =
    '/data/home/.nuphos/session-homes/c52e824a551bef793e621d580b4cc7f90ce0d2602468470e80922629b979d609/recordings/box1-20261017-021652.mp4'
  const html = render(`錄好了：${path}`)

  assert.ok(html.includes(`<a href="${path}">${path}</a>`))
})

test('a path that labels an explicit link keeps that link, with no nested anchor', () => {
  const html = render(
    '[`/data/workspace/report.md`](https://example.com/report) [/data/workspace/x.md](https://example.com/x)',
  )

  assert.equal(html.match(/<a /g)?.length, 2)
  assert.match(
    html,
    /<a href="https:\/\/example\.com\/report"><code[^>]*>\/data\/workspace\/report\.md<\/code><\/a>/,
  )
  assert.match(html, /<a href="https:\/\/example\.com\/x">\/data\/workspace\/x\.md<\/a>/)
})

test('code that is not only paths is left alone', () => {
  const html = render('```bash\necho /data/workspace/x.md\n```\n\nsee https://x.dev/data/c')

  assert.doesNotMatch(html, /href="\/data\//)
})
