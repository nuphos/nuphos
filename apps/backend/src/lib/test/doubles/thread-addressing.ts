import { mock } from 'bun:test'

import * as actual from '@/lib/agent/thread-addressing'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/thread-addressing', actual)

await mock.module('@/lib/agent/thread-addressing', () => double)

export const useThreadAddressing = makeInstaller<typeof actual>('@/lib/agent/thread-addressing')
