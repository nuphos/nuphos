import { mock } from 'bun:test'

import * as actual from '@/lib/slack/agent-outbound'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/slack/agent-outbound', actual)

await mock.module('@/lib/slack/agent-outbound', () => double)

export const useSlackAgentOutbound = makeInstaller<typeof actual>('@/lib/slack/agent-outbound')
