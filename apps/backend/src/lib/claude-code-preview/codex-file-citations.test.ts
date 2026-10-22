import { expect, test } from 'bun:test'

import { codexFileCitationScanner } from './codex-file-citations'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { PreviewTextMetadata } from './preview-agent-update'

const DOC = 'https://docs.google.com/document/d/1AbC-dEf_123'
const LINK = `[${DOC}](${DOC})`

/** Streams `chunks` the way a runtime does and returns each emitted text part. */
function stream(chunks: (string | [string, PreviewTextMetadata])[]): string[] {
  const seen: string[] = []
  const live = redactStreamedUpdates((update) => {
    if (update.kind === 'text') seen.push(update.text)
  })

  for (const chunk of chunks) {
    const [text, metadata] = typeof chunk === 'string' ? [chunk] : chunk

    live.deliver({ kind: 'text', text, ...metadata })
  }
  live.deliver({ kind: 'complete' })

  return seen
}

const whole = (text: string) => stream([text]).join('')
// Every split point at once: one character per chunk.
const byChar = (text: string) => stream(text.split('')).join('')

test('a citation becomes a Markdown link to its path', () => {
  expect(whole(`:codex-file-citation{path="${DOC}" purpose="output"}`)).toBe(LINK)
  expect(
    whole(
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
  const expected = [
    'Done.',
    '',
    LINK,
    '',
    '[My Report (v2).pdf](</Users/me/My Report (v2).pdf>)',
  ].join('\n')

  expect(whole(answer)).toBe(expected)
  expect(byChar(answer)).toBe(expected)
})

test('a citation split across streamed chunks is emitted only as a link', () => {
  const directive = `:codex-file-citation{path="${DOC}"\npurpose="output"}`
  const seen = stream(['Saved it here:\n\n', ...directive.match(/.{1,7}/gs)!, '\n\nAnything else?'])

  expect(seen.join('')).toBe(`Saved it here:\n\n${LINK}\n\nAnything else?`)
  for (const text of seen) expect(text).not.toContain('codex-file-citation')
})

test('code, escaped, and pathless directives stay as written, whole or split', () => {
  const citation = `:codex-file-citation{path="${DOC}"}`

  for (const text of [
    `\`${citation}\``,
    `Use \`example ${citation}\` to cite.`,
    `\`\`${citation} with \` inside\`\``,
    `\`\`\`md\n${citation}\n\`\`\``,
    `~~~\nFirst line\n  ${citation}\n~~~`,
    `\\${citation}`,
    `:${citation}`,
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path=""}',
  ]) {
    expect(whole(text)).toBe(text)
    expect(byChar(text)).toBe(text)
  }
})

test('a citation after a closed code fence or span is rewritten', () => {
  const citation = `:codex-file-citation{path="${DOC}"}`

  expect(byChar(`\`\`\`\ncode\n\`\`\`\n${citation}`)).toBe(`\`\`\`\ncode\n\`\`\`\n${LINK}`)
  expect(byChar(`\`a\` ${citation}`)).toBe(`\`a\` ${LINK}`)
  // An unclosed span ends with its paragraph.
  expect(byChar(`a \` b\n\n${citation}`)).toBe(`a \` b\n\n${LINK}`)
})

test('colons that start no citation stream through, at any position', () => {
  for (const text of [': note', ':', '::', 'Note: see https://example.com/a:b', ':codex-file']) {
    expect(whole(text)).toBe(text)
    expect(byChar(text)).toBe(text)
  }
})

test('an unclosed directive is released when the turn ends', () => {
  expect(stream(['Broken :codex-file-citation{path="/x" ', 'and nothing more']).join('')).toBe(
    'Broken :codex-file-citation{path="/x" and nothing more',
  )
})

test('each source message is scanned on its own', () => {
  const seen = stream([
    ['Open span ` here :codex-file-ci', { messageId: 'a' }],
    [`:codex-file-citation{path="${DOC}"}`, { messageId: 'b' }],
  ])

  expect(seen).toEqual(['Open span ` here :codex-file-ci', LINK])
})

test('the scanner returns at once for a leading non-citation colon', () => {
  const scan = codexFileCitationScanner()

  expect(scan(': note')).toBe(': note')
})
