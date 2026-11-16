import { mock } from 'bun:test'

import * as actual from '@/lib/agent/decision-answer'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/decision-answer', actual)

await mock.module('@/lib/agent/decision-answer', () => double)

export const useDecisionAnswer = makeInstaller<typeof actual>('@/lib/agent/decision-answer')
