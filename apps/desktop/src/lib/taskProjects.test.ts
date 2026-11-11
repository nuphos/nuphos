import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  nextTaskProject,
  pickNextTaskAgent,
  startNextTaskIn,
  takeNextTaskWorkspace,
} from './taskProjects.ts'

const folder = '/Users/me/project-alpha'
const computerAgent = { kind: 'local' }

test("an agent picked on this computer keeps the next task's project and its folder", () => {
  startNextTaskIn('team-1', folder)
  pickNextTaskAgent('team-1', true)

  assert.equal(nextTaskProject('team-1'), folder)
  assert.deepEqual(takeNextTaskWorkspace('team-1', computerAgent), { kind: 'folder', path: folder })
})

test('an agent picked on another computer starts a plain task; the folder never reaches it', () => {
  startNextTaskIn('team-1', folder)
  pickNextTaskAgent('team-1', false)

  assert.equal(nextTaskProject('team-1'), null)
  // That computer's agent is a computer agent too: with the project still set it would get
  // this computer's folder path.
  assert.equal(takeNextTaskWorkspace('team-1', computerAgent), undefined)
})

test('without a project, or in another team, a pick changes nothing', () => {
  startNextTaskIn('team-1', null)
  pickNextTaskAgent('team-1', false)
  pickNextTaskAgent('team-1', true)
  assert.equal(nextTaskProject('team-1'), null)

  startNextTaskIn('team-1', folder)
  pickNextTaskAgent('team-2', false)
  pickNextTaskAgent(undefined, false)
  assert.equal(nextTaskProject('team-1'), folder)
})
