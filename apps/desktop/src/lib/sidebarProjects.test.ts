import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyProjectChange,
  MAX_PROJECTS,
  nextProjectName,
  projectChangeRefusal,
  projectForSession,
} from './sidebar-projects/model.ts'
import {
  readSidebarProjects,
  syncSidebarProjects,
  updateSidebarProjects,
} from './sidebarProjects.ts'

import type { SidebarProject } from './sidebar-projects/model.ts'

type Snapshot = { projects: SidebarProject[]; revision: number; updatedAt: string | null }

const values = new Map<string, string>()
let remote: Snapshot = { projects: [], revision: 0, updatedAt: null }
let failNextPut = false

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: Object.assign(new EventTarget(), {
    api: {
      atlasGetSidebarProjects: async () => structuredClone(remote),
      atlasPutSidebarProjects: async (
        _teamId: string,
        projects: SidebarProject[],
        expectedRevision: number,
      ) => {
        if (failNextPut) {
          failNextPut = false
          throw new Error('offline')
        }
        if (expectedRevision !== remote.revision) {
          throw new Error(
            `__ATLAS_API_ERROR__${JSON.stringify({ message: 'changed', code: 'sidebar_projects_changed' })}`,
          )
        }
        remote = {
          projects: structuredClone(projects),
          revision: remote.revision + 1,
          updatedAt: '',
        }

        return structuredClone(remote)
      },
    },
  }),
})

const infra: SidebarProject = { id: 'infra', name: 'Infra', sessionIds: ['a'] }

test('moving a chat files it in exactly one project', () => {
  const two = applyProjectChange([infra], { kind: 'create', id: 'web', name: ' Web ' })
  const moved = applyProjectChange(two, { kind: 'move', sessionId: 'a', projectId: 'web' })

  assert.deepEqual(moved, [
    { id: 'infra', name: 'Infra', sessionIds: [] },
    { id: 'web', name: 'Web', sessionIds: ['a'] },
  ])
  assert.equal(projectForSession(moved, 'a')?.id, 'web')
  assert.deepEqual(
    applyProjectChange(moved, { kind: 'move', sessionId: 'a', projectId: null })[1]?.sessionIds,
    [],
  )
})

test('changes aimed at a project that is gone do nothing', () => {
  assert.deepEqual(applyProjectChange([infra], { kind: 'move', sessionId: 'a', projectId: 'x' }), [
    infra,
  ])
  assert.deepEqual(applyProjectChange([infra], { kind: 'rename', id: 'infra', name: '  ' }), [
    infra,
  ])
})

test('deleting a project keeps its chats; they just leave the project', () => {
  assert.deepEqual(applyProjectChange([infra], { kind: 'delete', id: 'infra' }), [])
})

test('new projects get distinct default names', () => {
  assert.equal(nextProjectName([]), 'New project')
  assert.equal(nextProjectName([{ id: '1', name: 'New project', sessionIds: [] }]), 'New project 2')
})

test('a conflicting save replays the change onto the newer server list', async () => {
  remote = { projects: [infra], revision: 3, updatedAt: '' }
  updateSidebarProjects('u', 't', { kind: 'create', id: 'web', name: 'Web', sessionId: 'b' })
  await syncSidebarProjects('u', 't')

  assert.equal(remote.revision, 4)
  assert.deepEqual(
    remote.projects.map((project) => project.id),
    ['infra', 'web'],
  )
  assert.deepEqual(readSidebarProjects('u', 't'), remote.projects)
})

test('a failed save keeps the edit and saves it on the next try', async () => {
  failNextPut = true
  updateSidebarProjects('u', 't', { kind: 'delete', id: 'infra' })
  await syncSidebarProjects('u', 't')
  // Offline: the edit stays on screen instead of being thrown away.
  assert.deepEqual(
    readSidebarProjects('u', 't').map((project) => project.id),
    ['web'],
  )
  assert.deepEqual(
    remote.projects.map((project) => project.id),
    ['infra', 'web'],
  )
  await syncSidebarProjects('u', 't')
  assert.deepEqual(
    remote.projects.map((project) => project.id),
    ['web'],
  )
})

test('changes past the limits are refused, and gone chats can be forgotten', () => {
  const full = Array.from({ length: MAX_PROJECTS }, (_, i) => ({
    id: String(i),
    name: 'P',
    sessionIds: [],
  }))

  assert.ok(projectChangeRefusal(full, { kind: 'create', id: 'x', name: 'X' }))
  assert.equal(applyProjectChange(full, { kind: 'create', id: 'x', name: 'X' }), full)
  assert.deepEqual(
    applyProjectChange([{ ...infra, sessionIds: ['a', 'b'] }], {
      kind: 'forget',
      sessionIds: ['a'],
    }),
    [{ ...infra, sessionIds: ['b'] }],
  )
})
