import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/provisioner-kube'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/provisioner-kube', actual)

await mock.module('@/lib/claude-code-preview/provisioner-kube', () => double)
export const useProvisionerKube = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/provisioner-kube',
)
