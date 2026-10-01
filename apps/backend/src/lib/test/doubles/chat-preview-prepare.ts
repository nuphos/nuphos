import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-preview-prepare'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-preview-prepare', actual)

await mock.module('@/routes/agent/chat-preview-prepare', () => double)

export const useChatPreviewPrepare = makeInstaller<typeof actual>(
  '@/routes/agent/chat-preview-prepare',
)
