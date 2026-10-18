import { mock } from 'bun:test'

import * as actual from '@/lib/agent/live-turn'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/live-turn', actual)

await mock.module('@/lib/agent/live-turn', () => double)

export const useLiveTurn = makeInstaller<typeof actual>('@/lib/agent/live-turn')
