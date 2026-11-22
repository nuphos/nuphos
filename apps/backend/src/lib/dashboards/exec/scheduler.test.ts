import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { scheduleSnapshot } from './scheduler'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
// The shared double, so the membership set here never leaks into the files after this one.
const membership = useIdentity({ getTeamMembership: async () => null })

const teamId = new ObjectId()
const author = new ObjectId().toHexString()

function seed(): ObjectId {
  const dashboardId = new ObjectId()
  const panelId = new ObjectId()
  const snapshotId = new ObjectId()

  memory.rows('cost_dashboards').push({ _id: dashboardId, teamId })
  memory.rows('cost_panels').push({
    _id: panelId,
    teamId,
    dashboardId,
    createdBy: author,
    versions: [{ version: 1, code: 'x', codeHash: 'h', authoredBy: author }],
  })
  memory.rows('cost_panel_snapshots').push({
    _id: snapshotId,
    teamId,
    dashboardId,
    panelId,
    status: 'running',
    scriptVersion: 1,
    codeHash: 'h',
  })

  return snapshotId
}

const snapshot = (id: ObjectId) =>
  memory.rows('cost_panel_snapshots').find((row) => (row._id as ObjectId).equals(id))

beforeEach(() => {
  memory = portabilityDb()
})

test('a panel whose author left the team says so, and who can take it over', async () => {
  const id = seed()

  await scheduleSnapshot(id)
  expect(snapshot(id)).toMatchObject({ status: 'failed', error: { kind: 'author_unavailable' } })
  const { message } = (snapshot(id) as { error: { message: string } }).error

  expect(message).toContain('no longer a member of this team')
  expect(message).toContain('An Administrator or Editor can take it over')
})

test('a panel whose author is now a Viewer says that instead', async () => {
  membership({ getTeamMembership: async () => ({ role: 'VIEWER' }) })
  const id = seed()

  await scheduleSnapshot(id)
  expect((snapshot(id) as { error: { message: string } }).error.message).toContain(
    'is now a Viewer in this team',
  )
})
