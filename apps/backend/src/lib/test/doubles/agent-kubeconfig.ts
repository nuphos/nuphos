import { mock } from 'bun:test'

import * as actual from '@/lib/byos/agent-kubeconfig'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/byos/agent-kubeconfig', actual)

await mock.module('@/lib/byos/agent-kubeconfig', () => double)

export const useAgentKubeconfig = makeInstaller<typeof actual>('@/lib/byos/agent-kubeconfig')
