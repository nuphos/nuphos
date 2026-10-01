import { mock } from 'bun:test'

import * as actual from '@/lib/agent/permission-grant-approve'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/agent/permission-grant-approve', actual)

await mock.module('@/lib/agent/permission-grant-approve', () => double)

export const usePermissionGrantApprove = makeInstaller<typeof actual>(
  '@/lib/agent/permission-grant-approve',
)
