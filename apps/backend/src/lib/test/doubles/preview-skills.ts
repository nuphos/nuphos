import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/preview-tools/skills'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/claude-code-preview/preview-tools/skills', actual)

await mock.module('@/lib/claude-code-preview/preview-tools/skills', () => double)

export const usePreviewSkills = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/preview-tools/skills',
)
