import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/preview-tool-context-resolve'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/preview-tool-context-resolve', actual)

await mock.module('@/lib/claude-code-preview/preview-tool-context-resolve', () => double)

export const usePreviewToolContextResolve = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/preview-tool-context-resolve',
)
