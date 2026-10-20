import { Hono } from 'hono'

import { latestCliRelease } from '@/lib/claude-code-preview/runtime-release'

type Deps = { latest: typeof latestCliRelease }

/**
 * The newest CLI version as plain text, for `install.sh` and `nuphos update`.
 * Public: both run before sign-in. They used to ask the GitHub API directly,
 * which rate-limits unauthenticated callers per IP, so shared cloud IPs often
 * got 403 and no version. This answers from the backend's cached release feed.
 */
export function createCliRoutes(deps: Deps = { latest: latestCliRelease }) {
  return new Hono().get('/latest', async (c) => {
    const release = await deps.latest()

    if (!release) return c.text('The newest CLI release could not be read from GitHub.\n', 503)

    c.header('Cache-Control', 'public, max-age=300')

    return c.text(`${release.version}\n`)
  })
}

export const cliRoutes = createCliRoutes()
