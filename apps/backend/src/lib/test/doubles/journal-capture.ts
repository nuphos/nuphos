import { mock } from 'bun:test'

import * as actual from '@/lib/agent/journal-capture'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/journal-capture', actual)

await mock.module('@/lib/agent/journal-capture', () => double)

export const useJournalCapture = makeInstaller<typeof actual>('@/lib/agent/journal-capture')
