// Managed-only features must report "not available" on a backend with no
// Kubernetes connection, never crash or leave the UI waiting.
import { expect, test } from 'bun:test'

import { runtimeServiceName } from './runtime-service-name'

import { config } from '@/config'

test('no Deployment is looked up for an external runtime URL', () => {
  const namespace = config.claudeCodeRuntimeProvisioner.namespace

  expect(runtimeServiceName('wss://external.example/acp', namespace)).toBeNull()
  expect(runtimeServiceName(`ws://openab-team-1.${namespace}.svc:8080/acp`, namespace)).toBe(
    'openab-team-1',
  )
})
