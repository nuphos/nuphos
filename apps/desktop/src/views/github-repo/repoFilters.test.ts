import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchesPullFilter, matchesRunFilter } from './repoFilters.ts'

import type { GithubPR, GithubWorkflowRun } from '../../types'

const pull: GithubPR = {
  number: 2528,
  title: 'feat(desktop): improve resource navigation',
  state: 'open',
  draft: false,
  author: 'yuaanlin',
  authorAvatarUrl: '',
  labels: [{ name: 'Desktop', color: '5319e7' }],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  htmlUrl: 'https://github.com/zeabur/nuphos/pull/2528',
  headRef: 'codex/fix-uiux',
  baseRef: 'main',
}

test('pull requests match by number, with or without the leading #', () => {
  assert.equal(matchesPullFilter(pull, '2528'), true)
  assert.equal(matchesPullFilter(pull, '#2528'), true)
  assert.equal(matchesPullFilter(pull, ' 2528 '), true)
  assert.equal(matchesPullFilter(pull, '252'), false)
  assert.equal(matchesPullFilter(pull, '25281'), false)
})

test('pull requests still match by title, author, branch, and label', () => {
  assert.equal(matchesPullFilter(pull, 'Resource Navigation'), true)
  assert.equal(matchesPullFilter(pull, 'YUAANLIN'), true)
  assert.equal(matchesPullFilter(pull, 'fix-uiux'), true)
  assert.equal(matchesPullFilter(pull, 'desktop'), true)
  assert.equal(matchesPullFilter(pull, 'nothing-here'), false)
  assert.equal(matchesPullFilter(pull, ''), true)
})

test('a pull whose author account is gone does not crash the filter', () => {
  const ghost = { ...pull, author: null as unknown as string }

  assert.equal(matchesPullFilter(ghost, 'yuaanlin'), false)
  assert.equal(matchesPullFilter(ghost, '2528'), true)
})

test('workflow runs match by id, name, branch, and event', () => {
  const run: GithubWorkflowRun = {
    id: 9001,
    name: 'build-and-push',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    headBranch: 'main',
    headSha: 'abc',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    htmlUrl: 'https://github.com/zeabur/nuphos/actions/runs/9001',
  }

  assert.equal(matchesRunFilter(run, '9001'), true)
  assert.equal(matchesRunFilter(run, 'Build'), true)
  assert.equal(matchesRunFilter(run, 'main'), true)
  assert.equal(matchesRunFilter(run, 'push'), true)
  assert.equal(matchesRunFilter(run, '900'), false)
})
