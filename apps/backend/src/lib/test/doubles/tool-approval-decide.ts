import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/tool-approval-decide'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/lib/claude-code-preview/tool-approval-decide', actual)

await mock.module('@/lib/claude-code-preview/tool-approval-decide', () => double)

export const useToolApprovalDecide = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/tool-approval-decide',
)
