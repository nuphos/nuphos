import assert from 'node:assert/strict'
import test from 'node:test'

import {
  artifactFileName,
  artifactKindLabel,
  collectArtifacts,
  fencedSource,
  parseArtifactPayload,
} from './artifactPayload.ts'

const call = (toolCallId: string, input: Record<string, unknown>, state = 'output-available') => ({
  type: 'tool',
  toolCallId,
  toolName: 'render_artifact',
  state,
  input: { label: 'Showing it', ...input },
})

test('reads a call the backend validated, and nothing it would have refused', () => {
  assert.deepEqual(
    parseArtifactPayload({
      artifactId: 'notes',
      title: ' Notes ',
      kind: 'markdown',
      content: '# N',
    }),
    { artifactId: 'notes', title: 'Notes', kind: 'markdown', content: '# N' },
  )
  assert.equal(
    parseArtifactPayload({ artifactId: 'Notes', title: 'N', kind: 'markdown', content: 'x' }),
    null,
  )
  assert.equal(
    parseArtifactPayload({ artifactId: 'n', title: 'N', kind: 'react', content: 'x' }),
    null,
  )
  assert.equal(
    parseArtifactPayload({ artifactId: 'n', title: 'N', kind: 'html', content: '' }),
    null,
  )
  assert.equal(parseArtifactPayload(null), null)
})

test('keeps a language only on code', () => {
  assert.equal(
    parseArtifactPayload({
      artifactId: 'p',
      title: 'P',
      kind: 'html',
      language: 'js',
      content: 'x',
    })?.language,
    undefined,
  )
  assert.equal(
    parseArtifactPayload({
      artifactId: 'p',
      title: 'P',
      kind: 'code',
      language: 'Python',
      content: 'x',
    })?.language,
    'python',
  )
})

test('numbers each artifact’s versions in chat order and skips calls that failed', () => {
  const lines = collectArtifacts([
    {
      parts: [
        { type: 'text' },
        call('a1', { artifactId: 'page', title: 'Page', kind: 'html', content: 'v1' }),
      ],
    },
    {
      parts: [
        call('b1', { artifactId: 'doc', title: 'Doc', kind: 'markdown', content: '# d' }),
        call(
          'a-bad',
          { artifactId: 'page', title: 'Page', kind: 'html', content: 'x' },
          'output-error',
        ),
        call('a2', { artifactId: 'page', title: 'Page v2', kind: 'html', content: 'v2' }),
        {
          type: 'tool',
          toolCallId: 'c',
          toolName: 'render_chart',
          state: 'output-available',
          input: {},
        },
      ],
    },
  ])

  assert.deepEqual([...lines.keys()], ['page', 'doc'])
  assert.deepEqual(
    lines.get('page')?.map((v) => [v.toolCallId, v.version, v.title]),
    [
      ['a1', 1, 'Page'],
      ['a2', 2, 'Page v2'],
    ],
  )
  assert.equal(lines.get('doc')?.[0]?.version, 1)
})

test('names downloads after the title with the kind’s extension', () => {
  assert.equal(
    artifactFileName({ title: 'Q3 Cost Report!', kind: 'markdown' }),
    'q3-cost-report.md',
  )
  assert.equal(artifactFileName({ title: 'Launch page', kind: 'html' }), 'launch-page.html')
  assert.equal(artifactFileName({ title: 'Deploy', kind: 'code', language: 'python' }), 'deploy.py')
  assert.equal(
    artifactFileName({ title: 'Build', kind: 'code', language: 'dockerfile' }),
    'Dockerfile',
  )
  assert.equal(artifactFileName({ title: '報告', kind: 'svg' }), 'artifact.svg')
})

test('labels kinds the way the card reads them', () => {
  assert.equal(artifactKindLabel({ kind: 'html' }), 'Page')
  assert.equal(artifactKindLabel({ kind: 'code', language: 'yaml' }), 'Yaml')
  assert.equal(artifactKindLabel({ kind: 'code', language: 'sql' }), 'SQL')
  assert.equal(artifactKindLabel({ kind: 'code' }), 'Code')
})

test('a source fence outlasts every backtick run inside it', () => {
  assert.equal(fencedSource('a', 'html'), '```html\na\n```')
  assert.equal(fencedSource('x ```` y', 'markdown'), '`````markdown\nx ```` y\n`````')
})
