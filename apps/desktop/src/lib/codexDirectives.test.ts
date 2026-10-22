import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cjk } from '@streamdown/cjk'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'

import { remarkCodexDirectives } from './codexDirectives.ts'

const defaults = Object.values(defaultRemarkPlugins)

// The same Streamdown setup as MessageResponse, minus its React components.
const render = (markdown: string, remarkPlugins = [...defaults, remarkCodexDirectives]) =>
  renderToStaticMarkup(
    createElement(Streamdown, {
      mode: 'static',
      plugins: { cjk },
      remarkPlugins,
      components: { a: ({ href, children }) => createElement('a', { href }, children) },
      children: markdown,
    }),
  )
const plain = (markdown: string) => render(markdown, defaults)

const DOC = 'https://docs.google.com/document/d/1AbC-dEf_123'
const LINK = `<a href="${DOC}">${DOC}</a>`

test('a file citation becomes a link, as in the report', () => {
  const html = render(`:codex-file-citation{path="${DOC}" purpose="output"}`)

  assert.equal(html.match(/<p[^>]*>(.*)<\/p>/s)?.[1], LINK)
  assert.match(
    render(
      'The review of :codex-file-citation{path="/abs/path/book.xlsx" purpose="source"} is due.',
    ),
    /The review of <a href="\/abs\/path\/book\.xlsx">book\.xlsx<\/a> is due\./,
  )
})

test('a citation wrapped over several lines is rendered too', () => {
  const html = render(
    [
      'Done.',
      '',
      `:codex-file-citation{path="${DOC}"`,
      'purpose="output"}',
      '',
      ':codex-file-citation{',
      '  path="/Users/me/My Report (v2).pdf"',
      '  purpose="source"',
      '}',
    ].join('\n'),
  )

  assert.ok(html.includes(LINK), html)
  assert.match(html, />My Report \(v2\)\.pdf<\/a>/)
  assert.doesNotMatch(html, /codex-file-citation/)
})

test('label, then title, is the link text, as in the Codex app', () => {
  assert.ok(
    render(
      `參考：:codex-file-citation{path="${DOC}" label="客戶 SLA 報告" purpose="source"}，完。`,
    ).includes(`參考：<a href="${DOC}">客戶 SLA 報告</a>，完。`),
  )
  assert.match(
    render(':codex-file-citation{path="/abs/deck.pptx" label=" " title="Launch deck"}'),
    /<a href="\/abs\/deck\.pptx">Launch deck<\/a>/,
  )
})

test('a follow-up shows its label; its prompt is dropped', () => {
  assert.match(
    render('Next: :codex-followup[Run the tests]{prompt="Run \\"bun test\\" now"} or stop.'),
    /Next: Run the tests or stop\./,
  )
})

test('a review comment line becomes the Codex TUI fallback text', () => {
  const html = render(
    'Found one issue.\n\n::code-comment{title="[P2] Fix parsing" body="Keep it." file="/repo/src/app.ts" start=10 end=12 priority=2}',
  )

  assert.match(html, />\[P2\] Fix parsing<\/span> — \/repo\/src\/app\.ts:10-12<br\/?>\s*Keep it\./)
})

test('directives in fenced, indented, tab-indented and inline code stay as written', () => {
  const cite = `:codex-file-citation{path="${DOC}"}`

  for (const markdown of [
    `\`\`\`md\n${cite}\n\`\`\``,
    `~~~\n${cite}\n~~~`,
    `    ${cite}`,
    `\t${cite}`,
    `Example:\n\n    const a = 1\n    ${cite}`,
    `Use \`example ${cite}\` to cite.`,
  ])
    assert.equal(render(markdown), plain(markdown), markdown)
})

test('escaped, double-colon, mid-line comment and malformed directives stay as written', () => {
  for (const markdown of [
    `\\:codex-file-citation{path="${DOC}"}`,
    `::codex-file-citation{path="${DOC}"}`,
    'Text ::code-comment{title="t" body="b"}',
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path=""}',
    ':codex-file-citation{path="/x" ',
    ':codex-followup[]{prompt="x"}',
    ': note',
    'Note: see https://example.com/a:b',
  ])
    assert.equal(render(markdown), plain(markdown), markdown)
})
