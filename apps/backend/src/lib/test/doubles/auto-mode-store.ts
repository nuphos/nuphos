import { mock } from 'bun:test'

import * as actual from '@/lib/agent/auto-mode/store'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/auto-mode/store', actual)

await mock.module('@/lib/agent/auto-mode/store', () => double)

export const useAutoModeStore = makeInstaller<typeof actual>('@/lib/agent/auto-mode/store')
