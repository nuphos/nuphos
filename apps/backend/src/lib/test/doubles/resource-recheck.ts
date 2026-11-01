import { mock } from 'bun:test'

import * as actual from '@/lib/agent/resource-recheck'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/resource-recheck', actual)

await mock.module('@/lib/agent/resource-recheck', () => double)
export const useResourceRecheck = makeInstaller<typeof actual>('@/lib/agent/resource-recheck')
