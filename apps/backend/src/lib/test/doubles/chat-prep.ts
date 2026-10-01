import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-prep'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-prep', actual)

await mock.module('@/routes/agent/chat-prep', () => double)

export const useChatPrep = makeInstaller<typeof actual>('@/routes/agent/chat-prep')
