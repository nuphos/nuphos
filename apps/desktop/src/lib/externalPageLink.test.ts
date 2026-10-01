import assert from 'node:assert/strict'
import { test } from 'node:test'

import { externalPageLink } from './externalPageLink.ts'

import type { GithubInstallation, GithubRepository } from '../types'

const installation = { installationId: 7, accountLogin: 'zeabur' } as GithubInstallation
const repo = {
  name: 'nuphos',
  fullName: 'zeabur/nuphos',
  htmlUrl: 'https://github.com/zeabur/nuphos',
} as GithubRepository

function repositoryTab(githubNav: Parameters<typeof externalPageLink>[0]['githubNav']) {
  return { active: 'team.repository', repoProvider: 'github' as const, githubNav }
}

test('a pull request page links to the PR on github.com', () => {
  const tab = repositoryTab({
    view: 'pull',
    installation,
    repo,
    prNumber: 1152,
    prTitle: 'x',
    prState: 'open',
  })

  assert.deepEqual(externalPageLink(tab), {
    url: 'https://github.com/zeabur/nuphos/pull/1152',
    provider: 'github',
  })
})

test('a repository page links to the tab it shows', () => {
  const base = { view: 'repo' as const, installation, repo, prState: 'open' as const }

  assert.equal(
    externalPageLink(repositoryTab({ ...base, tab: 'prs' }))?.url,
    'https://github.com/zeabur/nuphos/pulls',
  )
  assert.equal(
    externalPageLink(repositoryTab({ ...base, tab: 'actions' }))?.url,
    'https://github.com/zeabur/nuphos/actions',
  )
})

test('the repository list links to the installation account when it is known', () => {
  assert.equal(
    externalPageLink(repositoryTab({ view: 'repos', installation }))?.url,
    'https://github.com/zeabur',
  )
  assert.equal(
    externalPageLink(
      repositoryTab({ view: 'repos', installation: { ...installation, accountLogin: '' } }),
    ),
    null,
  )
})

test('pages without a GitHub counterpart have no external link', () => {
  assert.equal(externalPageLink(repositoryTab({ view: 'installations' })), null)
  assert.equal(
    externalPageLink({ ...repositoryTab({ view: 'repos', installation }), repoProvider: 'gitlab' }),
    null,
  )
  assert.equal(
    externalPageLink({ ...repositoryTab({ view: 'repos', installation }), active: 'team.agent' }),
    null,
  )
})

function linearTab(linearNav: Parameters<typeof externalPageLink>[0]['linearNav']) {
  return {
    active: 'team.linear',
    repoProvider: 'github' as const,
    githubNav: { view: 'installations' as const },
    linearNav,
  }
}

test('a Linear issue links to its linear.app page once loaded', () => {
  const issue = { view: 'issue' as const, bindingId: 'b1', identifier: 'NUPS-7' }

  assert.equal(externalPageLink(linearTab(issue)), null)
  assert.deepEqual(
    externalPageLink(linearTab({ ...issue, url: 'https://linear.app/zeabur/issue/NUPS-7/fix' })),
    { url: 'https://linear.app/zeabur/issue/NUPS-7/fix', provider: 'linear' },
  )
})

test('a Linear team task list links to the team when its URL is known', () => {
  const team = { id: 'team-uuid', key: 'NUPS', name: 'Nuphos' }

  assert.deepEqual(
    externalPageLink(
      linearTab({
        view: 'team',
        bindingId: 'b1',
        team: { ...team, url: 'https://linear.app/zeabur/team/NUPS' },
      }),
    ),
    { url: 'https://linear.app/zeabur/team/NUPS', provider: 'linear' },
  )
  assert.equal(externalPageLink(linearTab({ view: 'team', bindingId: 'b1', team })), null)
  assert.equal(externalPageLink(linearTab({ view: 'teams' })), null)
})
