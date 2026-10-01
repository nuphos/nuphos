import { mock } from 'bun:test'

import * as actual from '@/lib/db'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/lib/db', actual)

await mock.module('@/lib/db', () => double)

export const useDb = makeInstaller<typeof actual>('@/lib/db')
