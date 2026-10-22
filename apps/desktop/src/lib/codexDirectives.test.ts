import assert from 'node:assert/strict'
import test from 'node:test'

import { renderCodexDirectives as render } from './codexDirectives.ts'

const DOC = 'https://docs.google.com/document/d/1AbC-dEf_123'
const LINK = `[${DOC}](${DOC})`

test('a file citation becomes a link, as in the report', () => {
  assert.equal(render(`:codex-file-citation{path="${DOC}" purpose="output"}`), LINK)
  assert.equal(
    render(
      'The review of :codex-file-citation{path="/abs/path/book.xlsx" artifact_kind="workbook" purpose="source"} is due Friday.',
    ),
    'The review of [book.xlsx](/abs/path/book.xlsx) is due Friday.',
  )
})

test('a citation wrapped over several lines is rendered too', () => {
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

  assert.equal(
    render(answer),
    ['Done.', '', LINK, '', '[My Report (v2).pdf](</Users/me/My Report (v2).pdf>)'].join('\n'),
  )
})

test('label, then title, is the link text, as in the Codex app', () => {
  assert.equal(
    render(`:codex-file-citation{path="${DOC}" label="Q3 [draft] notes" purpose="output"}`),
    `[Q3 \\[draft\\] notes](${DOC})`,
  )
  assert.equal(
    render(':codex-file-citation{path="/abs/deck.pptx" label=" " title="Launch deck"}'),
    '[Launch deck](/abs/deck.pptx)',
  )
})

test('a follow-up shows its label; its prompt is dropped', () => {
  assert.equal(
    render('Next: :codex-followup[Run the tests]{prompt="Run \\"bun test\\" now"} or stop.'),
    'Next: Run the tests or stop.',
  )
})

test('a review comment line becomes the Codex TUI fallback text', () => {
  assert.equal(
    render(
      'Found one issue.\n\n::code-comment{title="[P2] Fix parsing" body="Line one.\nLine two." file="/repo/src/app.ts" start=10 end=12 priority=2}',
    ),
    'Found one issue.\n\n- [P2] Fix parsing — /repo/src/app.ts:10-12\n\n  Line one.\n  Line two.',
  )
})

test('directives in code, escaped, mid-line comments and malformed ones stay as written', () => {
  const cite = `:codex-file-citation{path="${DOC}"}`

  for (const text of [
    `\`${cite}\``,
    `Use \`example ${cite}\` to cite.`,
    `\`\`\`md\n${cite}\n\`\`\``,
    `~~~\n  ${cite}\n~~~`,
    `\\${cite}`,
    `:${cite}`,
    'Text ::code-comment{title="t" body="b"}',
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path=""}',
    ':codex-file-citation{path="/x" ',
    ':codex-followup[]{prompt="x"}',
    ': note',
    'Note: see https://example.com/a:b',
  ])
    assert.equal(render(text), text)
})

test('a citation after a closed code fence or span is rendered', () => {
  const cite = `:codex-file-citation{path="${DOC}"}`

  assert.equal(render(`\`\`\`\ncode\n\`\`\`\n${cite}`), `\`\`\`\ncode\n\`\`\`\n${LINK}`)
  assert.equal(render(`\`a\` ${cite}`), `\`a\` ${LINK}`)
  assert.equal(render(`a \` b\n\n${cite}`), `a \` b\n\n${LINK}`)
})
