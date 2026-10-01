import { mock } from 'bun:test'

import * as actual from '@/models'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/models', actual)

await mock.module('@/models', () => double)

export const useModels = makeInstaller<typeof actual>('@/models')
