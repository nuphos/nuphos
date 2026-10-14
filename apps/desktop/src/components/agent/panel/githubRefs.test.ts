import assert from 'node:assert/strict'
import { test } from 'node:test'

import { githubRef, isBareGithubLink, turnGithubRefs } from './githubRefs.ts'

import type { Part } from './parts.ts'

test('githubRef reads pull requests and issues, including their tabs', () => {
  assert.deepEqual(githubRef('https://github.com/nuphos/nuphos/pull/349/files#diff-1'), {
    owner: 'nuphos',
    repo: 'nuphos',
    number: 349,
    kind: 'pull',
    url: 'https://github.com/nuphos/nuphos/pull/349',
  })
  assert.equal(githubRef('https://github.com/a/b/issues/7')?.kind, 'issue')
})

test('githubRef rejects other GitHub pages and hosts', () => {
  assert.equal(githubRef('https://github.com/a/b'), null)
  assert.equal(githubRef('https://github.com/a/b/pull/0'), null)
  assert.equal(githubRef('https://github.com/a/b/pulls'), null)
  assert.equal(githubRef('https://github.com/a/b/pull/12abc'), null)
  assert.equal(githubRef('https://gitlab.com/a/b/pull/1'), null)
  assert.equal(githubRef('https://github.com/a/b/compare/main...x'), null)
})

test('isBareGithubLink treats a restated reference as bare', () => {
  const ref = githubRef('https://github.com/a/b/pull/12')!

  assert.equal(isBareGithubLink(ref, 'https://github.com/a/b/pull/12'), true)
  assert.equal(isBareGithubLink(ref, 'https://github.com/a/b/pull/12/files'), true)
  assert.equal(isBareGithubLink(ref, '#12'), true)
  assert.equal(isBareGithubLink(ref, 'a/b#12'), true)
  assert.equal(isBareGithubLink(ref, 'the fix'), false)
})

const tool = (output: unknown): Part => ({
  type: 'tool',
  toolCallId: JSON.stringify(output).slice(0, 40),
  toolName: 'Terminal',
  state: 'output-available',
  output,
})

test('turnGithubRefs keeps what a tool created and skips listings', () => {
  const parts: Part[] = [
    tool('https://github.com/a/b/pull/12\n'),
    tool({
      stdout:
        'https://github.com/a/b/issues/1 https://github.com/a/b/issues/2 https://github.com/a/b/issues/3',
    }),
  ]

  assert.deepEqual(
    turnGithubRefs(parts).map((ref) => ref.url),
    ['https://github.com/a/b/pull/12'],
  )
})

test('turnGithubRefs skips references the answer already links', () => {
  const parts: Part[] = [
    tool('https://github.com/a/b/pull/12'),
    { type: 'text', text: 'Opened https://github.com/a/b/pull/12/files for review.' },
  ]

  assert.deepEqual(turnGithubRefs(parts), [])
})
