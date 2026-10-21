import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cjk } from '@streamdown/cjk'
import { Streamdown } from 'streamdown'

import { standaloneLocalLink } from './localPreviewLink.ts'

const link = (href = 'http://localhost:5173/preview') =>
  createElement('a', { href }, 'Open the preview')

test('standalone local links promote without leaving terminal punctuation', () => {
  assert.deepEqual(standaloneLocalLink([link(), '.']), {
    href: 'http://localhost:5173/preview',
    children: 'Open the preview',
  })
})

test('words before or after a local link remain inline', () => {
  assert.equal(standaloneLocalLink(['Open ', link(), ' to continue.']), null)
  assert.equal(standaloneLocalLink([link(), ': all checks pass.']), null)
  assert.equal(standaloneLocalLink([link(), '。繼續查看']), null)
  assert.equal(standaloneLocalLink(['查看 ', link(), '。']), null)
})

test('CJK sentence endings promote a standalone local link', () => {
  for (const punctuation of ['。', '！', '？', '｡', '．', '！？', '。\n']) {
    assert.equal(standaloneLocalLink([link(), punctuation])?.href, 'http://localhost:5173/preview')
  }
})

test('Markdown with CJK endings reaches promotion through the real parser', () => {
  const render = (markdown: string) =>
    renderToStaticMarkup(
      createElement(Streamdown, {
        mode: 'static',
        plugins: { cjk },
        components: {
          p: ({ children }) =>
            createElement(
              'p',
              {
                'data-preview': Boolean(standaloneLocalLink(children)),
              },
              children,
            ),
        },
        children: markdown,
      }),
    )

  for (const markdown of ['http://localhost:5173。', '[Preview](http://localhost:5173)。'])
    assert.match(render(markdown), /data-preview="true"/)
  for (const markdown of [
    '查看 [Preview](http://localhost:5173)。',
    '[Preview](http://localhost:5173)。繼續查看',
  ])
    assert.match(render(markdown), /data-preview="false"/)
})

test('remote links, credentials and multiple links never become local preview cards', () => {
  assert.equal(standaloneLocalLink(link('https://example.com')), null)
  assert.equal(standaloneLocalLink(link('http://user:password@localhost:5173')), null)
  assert.equal(standaloneLocalLink([link(), link()]), null)
})

test('formatted link text is preserved by promotion', () => {
  const label = createElement('strong', {}, 'Review preview')

  assert.equal(
    standaloneLocalLink(createElement('a', { href: 'http://localhost:5173' }, label))?.children,
    label,
  )
})
