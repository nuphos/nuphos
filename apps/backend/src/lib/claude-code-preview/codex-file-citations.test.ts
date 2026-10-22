import { expect, test } from 'bun:test'

import { rewriteCodexFileCitations } from './codex-file-citations'
import { redactStreamedUpdates } from './streamed-token-redaction'

const DOC = 'https://docs.google.com/document/d/1AbC-dEf_123'
const LINK = `[${DOC}](${DOC})`

function stream(chunks: string[]): string {
  let out = ''
  const live = redactStreamedUpdates((update) => {
    if (update.kind === 'text') out += update.text
  })

  for (const chunk of chunks) live.deliver({ kind: 'text', text: chunk })
  live.flush()

  return out
}

test('a citation becomes a Markdown link to its path', () => {
  expect(rewriteCodexFileCitations(`:codex-file-citation{path="${DOC}" purpose="output"}`)).toBe(
    LINK,
  )
  expect(
    rewriteCodexFileCitations(
      'The review of :codex-file-citation{path="/abs/path/book.xlsx" artifact_kind="workbook" purpose="source"} is due Friday.',
    ),
  ).toBe('The review of [book.xlsx](/abs/path/book.xlsx) is due Friday.')
})

test('a citation wrapped over several lines is rewritten too', () => {
  const answer = [
    'Done.',
    '',
    `:codex-file-citation{path="${DOC}"`,
    'purpose="output"}',
    '',
    ':codex-file-citation{',
    '  path="/Users/me/My Report (v2).pdf"',
    '  purpose="source"',
    '}',
  ].join('\n')

  expect(rewriteCodexFileCitations(answer)).toBe(
    ['Done.', '', LINK, '', '[My Report (v2).pdf](</Users/me/My Report (v2).pdf>)'].join('\n'),
  )
})

test('code, escaped, and pathless directives stay as written', () => {
  for (const text of [
    `\`:codex-file-citation{path="${DOC}"}\``,
    `\\:codex-file-citation{path="${DOC}"}`,
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path=""}',
  ])
    expect(rewriteCodexFileCitations(text)).toBe(text)
})

test('a citation split across streamed chunks is emitted only as a link', () => {
  const directive = `:codex-file-citation{path="${DOC}"\npurpose="output"}`
  const chunks = ['Saved it here:\n\n', ...directive.match(/.{1,7}/gs)!, '\n\nAnything else?']
  const seen: string[] = []
  const live = redactStreamedUpdates((update) => {
    if (update.kind === 'text') seen.push(update.text)
  })

  for (const chunk of chunks) live.deliver({ kind: 'text', text: chunk })
  live.flush()

  expect(seen.join('')).toBe(`Saved it here:\n\n${LINK}\n\nAnything else?`)
  for (const text of seen) expect(text).not.toContain('codex-file-citation')
})

test('ordinary colons stream through and an unclosed directive is released', () => {
  expect(stream(['Note: ', 'see https://example.com/a:b'])).toBe(
    'Note: see https://example.com/a:b',
  )
  expect(stream(['Broken :codex-file-citation{path="/x" ', 'and nothing more'])).toBe(
    'Broken :codex-file-citation{path="/x" and nothing more',
  )
})
