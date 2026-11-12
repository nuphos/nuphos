import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  defaultUpdateSelection,
  editedSelected,
  originUrl,
  reviewedCommits,
} from './githubSkillUpdates.ts'

import type { GithubSkillUpdate } from '../../api/plan-types.ts'

const update = (name: string, over: Partial<GithubSkillUpdate> = {}): GithubSkillUpdate => ({
  name,
  repo: 'o/r',
  ref: null,
  path: `skills/${name}`,
  installedCommit: 'a'.repeat(40),
  latestCommit: 'b'.repeat(40),
  status: 'update_available',
  edited: false,
  changes: { added: [], changed: ['SKILL.md'], removed: [] },
  problem: null,
  ...over,
})
const updates = [
  update('pdf'),
  update('docx', { edited: true }),
  update('xlsx', { status: 'up_to_date' }),
  update('leaky', { problem: { code: 'secret', message: 'secret' } }),
]

test('update all skips edited, current and blocked skills', () => {
  assert.deepEqual(defaultUpdateSelection(updates), ['pdf'])
})

test('lists the edited skills a selection would overwrite', () => {
  assert.deepEqual(editedSelected(updates, ['pdf', 'docx']), ['docx'])
  assert.deepEqual(editedSelected(updates, ['pdf']), [])
})

test('sends the reviewed commit of each picked skill', () => {
  assert.deepEqual(reviewedCommits(updates, ['pdf']), { pdf: 'b'.repeat(40) })
})

test('links the installed folder at its commit', () => {
  const commitSha = 'c'.repeat(40)

  assert.equal(
    originUrl({ repo: 'o/r', path: 'skills/pdf', commitSha }),
    `https://github.com/o/r/tree/${commitSha}/skills/pdf`,
  )
  assert.equal(
    originUrl({ repo: 'o/r', path: '', commitSha }),
    `https://github.com/o/r/tree/${commitSha}`,
  )
})
