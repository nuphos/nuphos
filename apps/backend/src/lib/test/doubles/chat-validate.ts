import { mock } from 'bun:test'

import * as actual from '@/routes/agent/chat-validate'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/routes/agent/chat-validate', actual)

await mock.module('@/routes/agent/chat-validate', () => double)

export const useChatValidate = makeInstaller<typeof actual>('@/routes/agent/chat-validate')
