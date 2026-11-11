import { mock } from 'bun:test'

import * as actual from '@/lib/agent/trigger-executor'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/trigger-executor', actual)

await mock.module('@/lib/agent/trigger-executor', () => double)

export const useTriggerExecutor = makeInstaller<typeof actual>('@/lib/agent/trigger-executor')
