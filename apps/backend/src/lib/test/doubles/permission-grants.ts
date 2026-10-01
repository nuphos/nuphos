import { mock } from 'bun:test'

import * as actual from '@/lib/agent/permission-grants'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/permission-grants', actual)

await mock.module('@/lib/agent/permission-grants', () => double)

export const usePermissionGrants = makeInstaller<typeof actual>('@/lib/agent/permission-grants')
