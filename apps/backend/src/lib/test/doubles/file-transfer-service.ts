import { mock } from 'bun:test'

import * as actual from '@/lib/file-transfer/service'

import { buildDouble, makeInstaller } from '../double-registry'

export const real = { ...actual }

const double = buildDouble('@/lib/file-transfer/service', actual)

await mock.module('@/lib/file-transfer/service', () => double)

export const useFileTransferService = makeInstaller<typeof actual>('@/lib/file-transfer/service')
