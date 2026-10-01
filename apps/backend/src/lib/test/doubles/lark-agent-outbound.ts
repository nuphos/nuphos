import { mock } from 'bun:test'

import * as actual from '@/lib/lark/agent-outbound'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/lark/agent-outbound', actual)

await mock.module('@/lib/lark/agent-outbound', () => double)

export const useLarkAgentOutbound = makeInstaller<typeof actual>('@/lib/lark/agent-outbound')
