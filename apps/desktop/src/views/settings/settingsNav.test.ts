import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withRenamedPage } from '../../app/workspacePersistence.ts'
import { emptyNavigation } from '../../lib/appRoutes.ts'

import { settingsNavGroups, settingsSectionForPage } from './settingsNav.ts'

const team = { kind: 'team', teamId: 'aaaaaaaaaaaaaaaaaaaaaaaa' } as const

test('Skills, Memories and Triggers open their Team Settings sections', () => {
  const keys = settingsNavGroups('team').flatMap((group) => group.items.map((item) => item.key))

  for (const [page, section] of [
    ['team.agent-skills', 'workspace.skills'],
    ['team.agent-memories', 'workspace.memories'],
    ['team.triggers', 'workspace.triggers'],
    ['team.schedule', 'workspace.triggers'],
  ]) {
    assert.equal(settingsSectionForPage(page), section)
    assert.ok(keys.includes(section))
  }
  assert.equal(settingsSectionForPage('team.inbox'), undefined)
})

test('a tab saved on a page that moved into Settings reopens as Inbox', () => {
  assert.equal(withRenamedPage(emptyNavigation(team, 'team.triggers')).active, 'team.inbox')
  assert.equal(withRenamedPage(emptyNavigation(team, 'team.plans')).active, 'team.plans')
})
