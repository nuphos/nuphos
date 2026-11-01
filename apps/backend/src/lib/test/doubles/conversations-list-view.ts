import { mock } from 'bun:test'

import * as actual from '@/routes/agent/conversations-list-view'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/routes/agent/conversations-list-view', actual)

await mock.module('@/routes/agent/conversations-list-view', () => double)
export const useConversationsListView = makeInstaller<typeof actual>(
  '@/routes/agent/conversations-list-view',
)
