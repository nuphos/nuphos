import assert from 'node:assert/strict'
import { test } from 'node:test'

import { navigationFromMentionTarget } from './mentionNavigation.ts'

import type { MentionTarget } from '../lib/atlasLinkMention.ts'

const pullTarget = (
  number: string,
  prState?: 'open' | 'closed' | 'all',
): Extract<MentionTarget, { type: 'github-pr' }> => ({
  type: 'github-pr',
  teamId: 'team1',
  installationId: '123',
  owner: 'Zeabur',
  repo: 'nuphos',
  number,
  ...(prState ? { prState } : {}),
})

test('a PR mention opens the PR page, not the list filtered by its number', () => {
  const navigation = navigationFromMentionTarget(pullTarget('42', 'closed'))

  assert.ok(navigation)
  assert.equal(navigation.active, 'team.repository')
  assert.equal(navigation.filter, undefined)
  assert.deepEqual(navigation.githubNav, {
    view: 'pull',
    installation: {
      id: '123',
      installationId: 123,
      accountLogin: 'Zeabur',
      accountType: 'Organization',
      accountId: 0,
      targetType: 'selected',
    },
    repo: {
      id: 0,
      name: 'nuphos',
      fullName: 'Zeabur/nuphos',
      private: false,
      htmlUrl: 'https://github.com/Zeabur/nuphos',
      description: null,
      defaultBranch: null,
      archived: false,
      visibility: null,
      pushedAt: null,
    },
    prNumber: 42,
    prTitle: 'Pull request',
    prState: 'closed',
  })
})

test('a PR link without a state backs out to the all list, like the route table', () => {
  const navigation = navigationFromMentionTarget(pullTarget('42'))

  assert.ok(navigation)
  assert.equal(navigation.githubNav.view, 'pull')
  assert.equal(navigation.githubNav.view === 'pull' && navigation.githubNav.prState, 'all')
})

test('a non-numeric pull segment is a search over every PR', () => {
  const navigation = navigationFromMentionTarget(pullTarget('feature-x'))

  assert.ok(navigation)
  assert.equal(navigation.filter, 'feature-x')
  assert.equal(navigation.githubNav.view, 'repo')
  assert.equal(navigation.githubNav.view === 'repo' && navigation.githubNav.prState, 'all')
})

test('a repo mention still lands on the open PR list', () => {
  const navigation = navigationFromMentionTarget({
    type: 'github-repo',
    teamId: 'team1',
    installationId: '123',
    owner: 'Zeabur',
    repo: 'nuphos',
  })

  assert.ok(navigation)
  assert.equal(navigation.filter, undefined)
  assert.equal(navigation.githubNav.view, 'repo')
  assert.equal(navigation.githubNav.view === 'repo' && navigation.githubNav.tab, 'prs')
  assert.equal(navigation.githubNav.view === 'repo' && navigation.githubNav.prState, 'open')
})
