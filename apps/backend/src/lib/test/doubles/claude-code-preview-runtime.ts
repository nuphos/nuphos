import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/agent-chat-runtime'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/claude-code-preview/agent-chat-runtime', actual)

await mock.module('@/lib/claude-code-preview/agent-chat-runtime', () => double)

export const useClaudeCodePreviewRuntime = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/agent-chat-runtime',
)
