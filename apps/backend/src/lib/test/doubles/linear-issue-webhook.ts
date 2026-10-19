import { mock } from 'bun:test'

import * as actual from '@/lib/agent/linear-issue-webhook'

import { buildDouble, makeInstaller } from '../double-registry'

/**
 * The real exports, snapshotted before the registration below. A suite that
 * wants to record *and* delegate must call through this — reading them back off
 * the module would land on the stand-in and recurse.
 */
export const real = { ...actual }

const double = buildDouble('@/lib/agent/linear-issue-webhook', actual)

await mock.module('@/lib/agent/linear-issue-webhook', () => double)

export const useLinearIssueWebhook = makeInstaller<typeof actual>(
  '@/lib/agent/linear-issue-webhook',
)
