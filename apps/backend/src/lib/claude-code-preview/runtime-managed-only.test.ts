// Managed-only features must report "not available" on a backend with no
// Kubernetes connection, never crash or leave the UI waiting.
import { expect, test } from 'bun:test'

import { runtimeServiceName } from './runtime-service-name'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

const store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })

const { managedWorkspacePlacement } = await import('./runtime-workspace')

test('workspace transfer reports itself unavailable with no Kubernetes connection', async () => {
  await expect(
    managedWorkspacePlacement('team-1', 'claude-code', 'wss://external.example/acp'),
  ).rejects.toMatchObject({ status: 409, code: 'workspace_unavailable' })
})

test('no Deployment is looked up for an external runtime URL', () => {
  const namespace = config.claudeCodeRuntimeProvisioner.namespace

  expect(runtimeServiceName('wss://external.example/acp', namespace)).toBeNull()
  expect(runtimeServiceName(`ws://openab-team-1.${namespace}.svc:8080/acp`, namespace)).toBe(
    'openab-team-1',
  )
})
