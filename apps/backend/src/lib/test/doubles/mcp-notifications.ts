import { mock } from 'bun:test'

import * as actual from '@/routes/mcp/notifications'

import { buildDouble, makeInstaller } from '../double-registry'

const double = buildDouble('@/routes/mcp/notifications', actual)

await mock.module('@/routes/mcp/notifications', () => double)

export const useMcpNotifications = makeInstaller<typeof actual>('@/routes/mcp/notifications')
