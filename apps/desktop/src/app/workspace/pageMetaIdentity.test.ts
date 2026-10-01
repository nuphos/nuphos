import assert from 'node:assert/strict'
import test from 'node:test'

import { pageMetaIdentityMatches } from './pageMetaIdentity.ts'

import type { WorkspacePageMeta } from '../workspaceTabState'

const current: WorkspacePageMeta = {
  key: 'team.agent',
  title: 'Agent conversation',
  icon: null,
  iconKey: 'agent',
  location: { href: '/teams/team-1/agent/session-1' },
}

test('treats a changed icon identity as changed page metadata', () => {
  assert.equal(
    pageMetaIdentityMatches(current, {
      pageKey: current.key,
      title: current.title,
      iconKey: 'claude-code',
      locationHref: current.location.href,
    }),
    false,
  )
})

test('matches stable page metadata without comparing React node identity', () => {
  assert.equal(
    pageMetaIdentityMatches(current, {
      pageKey: current.key,
      title: current.title,
      iconKey: current.iconKey,
      locationHref: current.location.href,
    }),
    true,
  )
})
