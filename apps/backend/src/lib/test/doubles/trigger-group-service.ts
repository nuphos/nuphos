import { mock } from 'bun:test'

import * as actual from '@/lib/agent/trigger-group-service'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/trigger-group-service', actual)

await mock.module('@/lib/agent/trigger-group-service', () => double)

export const useTriggerGroupService = makeInstaller<typeof actual>(
  '@/lib/agent/trigger-group-service',
)
