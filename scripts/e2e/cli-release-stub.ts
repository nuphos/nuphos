// The newest CLI release, fixed: GitHub's unauthenticated API is rate-limited per address, so
// a Box card's "Update to v…" must not depend on reaching it (computer-update-scenarios.ts).
import { resolve } from 'node:path'

import { mock } from 'bun:test'

const modulePath = resolve(
  import.meta.dirname,
  '../../apps/backend/src/lib/claude-code-preview/runtime-release.ts',
)
const release = await import(modulePath)

/** Newer than any CLI a host reports in the scenarios. */
const E2E_LATEST_CLI = '99.0.0'

mock.module(modulePath, () => ({
  ...release,
  latestCliRelease: () =>
    Promise.resolve({
      version: E2E_LATEST_CLI,
      url: `${String(release.RUNTIME_RELEASES_URL)}/tag/cli-v${E2E_LATEST_CLI}`,
      body: '',
    }),
}))
