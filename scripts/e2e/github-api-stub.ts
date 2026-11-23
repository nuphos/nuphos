// The backend's GitHub API calls go to E2E_GITHUB_API, a stub the scenario serves, instead
// of api.github.com. Loads the CLI release stub too, which every backend in the stack uses.
import { resolve } from 'node:path'

import { mock } from 'bun:test'

import './cli-release-stub.ts'

const modulePath = resolve(import.meta.dirname, '../../apps/backend/src/lib/byos/github-http.ts')
const http = await import(modulePath)
// mock.module patches this namespace in place, so keep the real function first.
const { githubFetch } = http

mock.module(modulePath, () => ({
  ...http,
  githubFetch: (url: string, init: RequestInit) =>
    githubFetch(url.replace(http.GITHUB_API, process.env.E2E_GITHUB_API), init),
}))
