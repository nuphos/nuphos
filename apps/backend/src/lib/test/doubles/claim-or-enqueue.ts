import { mock } from 'bun:test'

import * as actual from '@/routes/agent/claim-or-enqueue'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/routes/agent/claim-or-enqueue', actual)

await mock.module('@/routes/agent/claim-or-enqueue', () => double)

export const useClaimOrEnqueue = makeInstaller<typeof actual>('@/routes/agent/claim-or-enqueue')
