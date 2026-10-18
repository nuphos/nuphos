import { mock } from 'bun:test'

import * as actual from '@/lib/agent/retract-marks'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/agent/retract-marks', actual)

await mock.module('@/lib/agent/retract-marks', () => double)

export const useRetractMarks = makeInstaller<typeof actual>('@/lib/agent/retract-marks')
