import assert from 'node:assert/strict'
import test from 'node:test'

import {
  githubAccountKind,
  githubConnectedSummary,
  githubInstallationSettingsUrl,
  githubRepoAccessLabel,
  visibleGithubInstallations,
} from './github-installation-display.ts'

import type { GithubInstallation } from '../../types'

const personal: GithubInstallation = {
  id: 'a',
  installationId: 101,
  accountLogin: 'seraph27',
  accountType: 'User',
  accountId: 1,
  targetType: 'all',
}
const org: GithubInstallation = {
  id: 'b',
  installationId: 202,
  accountLogin: 'nuphos',
  accountType: 'Organization',
  accountId: 2,
  targetType: 'selected',
}

test('account kind distinguishes personal accounts from organizations', () => {
  assert.equal(githubAccountKind(personal), 'personal')
  assert.equal(githubAccountKind(org), 'organization')
})

test('repo access follows the installation target type', () => {
  assert.equal(githubRepoAccessLabel(personal), 'All repositories')
  assert.equal(githubRepoAccessLabel(org), 'Selected repositories')
})

test('summary names a single account and counts several', () => {
  assert.equal(githubConnectedSummary([personal]), 'seraph27 (personal)')
  assert.equal(githubConnectedSummary([personal, org]), '2 accounts')
})

test('settings URL links organizations only', () => {
  assert.equal(githubInstallationSettingsUrl(personal), null)
  assert.equal(
    githubInstallationSettingsUrl(org),
    'https://github.com/organizations/nuphos/settings/installations/202',
  )
})

test('only installations with a live connector row are shown', () => {
  assert.deepEqual(visibleGithubInstallations([personal, org], ['github:202', 'gitlab:x']), [org])
})
