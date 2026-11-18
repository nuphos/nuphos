import { mock } from 'bun:test'

import * as actual from '@/routes/agent/run-cancel'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/routes/agent/run-cancel', actual)

await mock.module('@/routes/agent/run-cancel', () => double)

export const useRunCancel = makeInstaller<typeof actual>('@/routes/agent/run-cancel')
