import { mock } from 'bun:test'

import * as actual from '@/lib/claude-code-preview/credential-listing'

import { buildDouble, makeInstaller } from '../double-registry'

/** The real exports, snapshotted before the registration below. */
export const real = { ...actual }

const double = buildDouble('@/lib/claude-code-preview/credential-listing', actual)

await mock.module('@/lib/claude-code-preview/credential-listing', () => double)

export const useCredentialListing = makeInstaller<typeof actual>(
  '@/lib/claude-code-preview/credential-listing',
)
