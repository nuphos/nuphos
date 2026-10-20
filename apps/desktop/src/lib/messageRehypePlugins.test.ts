import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown, defaultRehypePlugins } from 'streamdown'

import { messageRehypePlugins } from './messageRehypePlugins.ts'

const render = (markdown: string, rehypePlugins = messageRehypePlugins) =>
  renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      rehypePlugins,
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

test('bare paths in prose and path-only inline code become file links', () => {
  const html = render('檔案在 /data/workspace/a.mp4。\n\n`/data/workspace/b.md` `npm i`')

  assert.match(html, /<a href="\/data\/workspace\/a\.mp4">\/data\/workspace\/a\.mp4<\/a>。/)
  assert.match(
    html,
    /<a href="\/data\/workspace\/b\.md"><code[^>]*>\/data\/workspace\/b\.md<\/code><\/a>/,
  )
  assert.doesNotMatch(html, /<a[^>]*><code[^>]*>npm i/)
})

test('code blocks render exactly as without file links, even when they hold only paths', () => {
  for (const markdown of [
    '```\n/data/workspace/c.md\n/data/workspace/d.md:12\n```',
    '```bash\necho /data/workspace/x.md\n```',
  ]) {
    const html = render(markdown)

    assert.equal(
      html,
      render(markdown, [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize]),
      markdown,
    )
    assert.doesNotMatch(html, /href="\/data\//)
  }
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

test('the path part of a URL is left alone', () => {
  const html = render('see https://x.dev/data/c')

  assert.doesNotMatch(html, /href="\/data\//)
})

test('markdown, HTML and linked images all reach the img override with their size', () => {
  const html = renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      rehypePlugins: messageRehypePlugins,
      components: {
        a: ({ href, children }) => createElement('a', { href }, children),
        img: ({ src, width }) => createElement('button', { 'data-src': src, 'data-width': width }),
      },
      children: [
        '![shot](https://example.com/a.png)',
        '<img width="320" alt="b" src="https://github.com/user-attachments/assets/b">',
        '[![c](https://example.com/c.gif)](https://example.com/c.gif)',
        '<a href="https://example.com/d.webp"><img src="https://example.com/d.webp"></a>',
      ].join('\n\n'),
    }),
  )

  assert.equal(html.match(/<button /g)?.length, 4)
  assert.match(
    html,
    /data-src="https:\/\/github\.com\/user-attachments\/assets\/b" data-width="320"/,
  )
  assert.match(html, /<a href="https:\/\/example\.com\/c\.gif"><button data-src/)
})
