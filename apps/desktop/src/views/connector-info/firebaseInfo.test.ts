import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { GcpProject } from '../../types/provider-accounts.ts'

let calls = 0
let failure = false

mock.module('../../api.ts', {
  namedExports: {
    api: {
      atlasGetFirebaseProject: async (_team: string, projectId: string, binding: string) => {
        calls++
        assert.equal(binding, 'selected-binding')
        if (failure) throw new Error('Firebase Management API is disabled.')

        return { projectId, projectNumber: '123', state: 'ACTIVE' }
      },
    },
    parseAtlasError: (error: Error) => ({ message: error.message }),
  },
})

const { gcpConnectorInfo } = await import('./infrastructureLoaders.ts')
const project = {
  projectId: 'example-project',
  serviceAccountId: 'selected-binding',
  serviceAccountEmail: 'connector@example.test',
  canUse: true,
} as GcpProject

test('only successful Firebase metadata is presented as an active project', async () => {
  calls = 0
  const info = await gcpConnectorInfo('team', [project], project.projectId)

  assert.equal(
    info?.fields.find((field) => field.label === 'Firebase')?.value,
    'example-project · ACTIVE',
  )
  assert.equal(calls, 1)
})

test('API failures remain visible and do not imply Firebase is enabled', async () => {
  failure = true
  const info = await gcpConnectorInfo('team', [project], project.projectId)

  assert.equal(
    info?.fields.find((field) => field.label === 'Firebase')?.value,
    'Firebase Management API is disabled.',
  )
  failure = false
})

test('multiple bindings or an inaccessible binding are never silently chosen', async () => {
  calls = 0
  await gcpConnectorInfo(
    'team',
    [project, { ...project, serviceAccountId: 'other' }],
    project.projectId,
  )
  await gcpConnectorInfo('team', [{ ...project, canUse: false }], project.projectId)
  await gcpConnectorInfo('team', [{ ...project, purpose: 'permission-admin' }], project.projectId)
  assert.equal(calls, 0)
})
