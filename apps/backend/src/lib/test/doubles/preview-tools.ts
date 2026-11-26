import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/preview-tools'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/preview-tools', actual)

await mock.module('@/lib/claude-code-preview/preview-tools', () => double)

export const usePreviewTools = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/preview-tools',
)
