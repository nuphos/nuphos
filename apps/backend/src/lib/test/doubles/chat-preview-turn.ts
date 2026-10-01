import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-preview-turn'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-preview-turn', actual)

await mock.module('@/routes/agent/chat-preview-turn', () => double)

export const useChatPreviewTurn = makeInstaller<typeof actual>('@/routes/agent/chat-preview-turn')
