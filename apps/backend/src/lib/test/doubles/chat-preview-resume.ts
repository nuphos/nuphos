import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-preview-resume'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-preview-resume', actual)

await mock.module('@/routes/agent/chat-preview-resume', () => double)

export const useChatPreviewResume = makeInstaller<typeof actual>(
  '@/routes/agent/chat-preview-resume',
)
