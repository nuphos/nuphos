import { expect, test } from 'bun:test'

import { newerRuntimeVersion, stableRuntimeVersion } from './runtime-release'

type FetchInput = string | URL | Request

test('release comparisons use numeric semver and never offer downgrades or prereleases', () => {
  expect(newerRuntimeVersion('0.1.10', '0.1.9')).toBe(true)
  expect(newerRuntimeVersion('0.2.0', '0.1.99')).toBe(true)
  expect(newerRuntimeVersion('0.1.3', '0.1.3')).toBe(false)
  expect(newerRuntimeVersion('0.1.3', '0.1.4')).toBe(false)
  expect(newerRuntimeVersion('0.1.5-beta.1', '0.1.4')).toBe(false)
  expect(stableRuntimeVersion('latest')).toBe(false)
  expect(stableRuntimeVersion(undefined)).toBe(false)
})

test('runtime discovery skips other components, follows pages and preserves the pre-cutover fallback', async () => {
  const { latestRuntimeRelease, resetRuntimeReleaseCache } = await import('./runtime-release')

  resetRuntimeReleaseCache()
  const originalFetch = globalThis.fetch
  const image = (version: string, provider = 'codex') =>
    `ghcr.io/nuphos/runtime:${version}-${provider}`
  const requests: string[] = []
  let responses: Response[] = []

  globalThis.fetch = (async (url: FetchInput) => {
    requests.push(url instanceof Request ? url.url : String(url))
    const response = responses.shift()

    if (!response) throw new Error('Unexpected request')

    return response
  }) as typeof fetch

  try {
    responses = [
      Response.json(
        [
          { tag_name: 'desktop-v99.0.0' },
          { tag_name: 'v88.0.0' },
          { tag_name: 'runtime-v9.0.0', draft: true },
          { tag_name: 'runtime-v8.0.0', prerelease: true },
          { tag_name: 'runtime-v7.0.0-beta.1' },
        ],
        {
          headers: {
            link: '<https://api.github.com/repos/nuphos/nuphos/releases?page=2>; rel="next"',
          },
        },
      ),
      Response.json([{ tag_name: 'runtime-v0.1.10', body: image('0.1.10') }]),
    ]
    expect(await latestRuntimeRelease('codex', true)).toEqual({
      version: '0.1.10',
      url: 'https://github.com/nuphos/nuphos/releases/tag/runtime-v0.1.10',
      body: image('0.1.10'),
    })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('page=2')
    expect(await latestRuntimeRelease('claude-code')).toBeNull()
    expect(requests).toHaveLength(2)

    resetRuntimeReleaseCache()
    responses = [
      Response.json([]),
      Response.json({
        tag_name: 'v0.1.9',
        body: image('0.1.9').replace('nuphos/runtime', 'zeabur/nuphos-runtime'),
      }),
    ]
    expect((await latestRuntimeRelease('codex', true))?.url).toBe(
      'https://github.com/zeabur/nuphos-runtime/releases/tag/v0.1.9',
    )
    expect(requests.at(-1)).toBe(
      'https://api.github.com/repos/zeabur/nuphos-runtime/releases/latest',
    )

    resetRuntimeReleaseCache()
    responses = [new Response('', { status: 403 })]
    expect(await latestRuntimeRelease('codex', true)).toBeNull()
    responses = [Response.json({ unexpected: true })]
    expect(await latestRuntimeRelease('codex', true)).toBeNull()
    resetRuntimeReleaseCache()
    responses = [Response.json([]), Response.json({ tag_name: 'v0.1.11', prerelease: true })]
    expect(await latestRuntimeRelease('codex', true)).toBeNull()
  } finally {
    globalThis.fetch = originalFetch
    resetRuntimeReleaseCache()
  }
})

test('each provider follows the newest release that published it', async () => {
  const { latestRuntimeRelease, resetRuntimeReleaseCache } = await import('./runtime-release')

  resetRuntimeReleaseCache()
  const originalFetch = globalThis.fetch
  const image = (version: string, provider: string) =>
    `ghcr.io/nuphos/runtime:${version}-${provider}`
  const all = ['claude-code', 'codex', 'grok', 'antigravity', 'opencode']

  globalThis.fetch = (async (_url: FetchInput) =>
    Response.json([
      { tag_name: 'runtime-v0.2.1', body: image('0.2.1', 'claude-code') },
      {
        tag_name: 'runtime-v0.2.0',
        body: all.map((provider) => image('0.2.0', provider)).join('\n'),
      },
    ])) as typeof fetch

  try {
    // A Claude-only release must not hide the others after a restart.
    expect((await latestRuntimeRelease('claude-code', true))?.version).toBe('0.2.1')
    expect((await latestRuntimeRelease('grok'))?.version).toBe('0.2.0')
    expect((await latestRuntimeRelease('antigravity'))?.version).toBe('0.2.0')
    expect((await latestRuntimeRelease('opencode'))?.version).toBe('0.2.0')
  } finally {
    globalThis.fetch = originalFetch
    resetRuntimeReleaseCache()
  }
})

test('in-flight update links resolve the target release across the publishing cutover', async () => {
  const { runtimeReleaseUrl, RUNTIME_RELEASES_URL } = await import('./runtime-release')
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  let response = new Response(null, { status: 200 })

  globalThis.fetch = (async (url: FetchInput) => {
    requests.push(url instanceof Request ? url.url : String(url))

    return response
  }) as typeof fetch

  try {
    for (const url of [
      'https://github.com/nuphos/nuphos/releases/tag/runtime-v0.2.0',
      'https://github.com/zeabur/nuphos-runtime/releases/tag/v0.2.0',
    ]) {
      expect(await runtimeReleaseUrl('0.2.0', { version: '0.2.0', url, body: '' })).toBe(url)
    }
    expect(requests).toHaveLength(0)
    expect(await runtimeReleaseUrl('0.1.11', null)).toBe(
      'https://github.com/nuphos/nuphos/releases/tag/runtime-v0.1.11',
    )
    expect(requests.at(-1)).toEndWith('/releases/tags/runtime-v0.1.11')
    await runtimeReleaseUrl('0.1.11', null)
    expect(requests).toHaveLength(1)

    response = new Response(null, { status: 404 })
    expect(
      await runtimeReleaseUrl('0.1.9', {
        version: '0.2.0',
        url: 'https://github.com/nuphos/nuphos/releases/tag/runtime-v0.2.0',
        body: '',
      }),
    ).toBe('https://github.com/zeabur/nuphos-runtime/releases/tag/v0.1.9')

    response = new Response(null, { status: 403 })
    expect(await runtimeReleaseUrl('0.1.8', null)).toBe(RUNTIME_RELEASES_URL)
    expect(await runtimeReleaseUrl('invalid', null)).toBe(RUNTIME_RELEASES_URL)
    expect(RUNTIME_RELEASES_URL).not.toContain('?')
  } finally {
    globalThis.fetch = originalFetch
  }
})
