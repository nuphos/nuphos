import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, expect, test } from 'bun:test'

import { managedRuntimeImage } from './runtime-image'
import {
  publishedRuntimeImage,
  publishRuntimeRelease,
  refreshRuntimeRelease,
  restoreRuntimeReleases,
  runtimeFeedRequests,
} from './runtime-release-testing'

const COMPOSE_DIR = join(import.meta.dir, '../../../../../deploy/compose')

afterAll(restoreRuntimeReleases)

test('managed agents run the latest published release, by digest', async () => {
  await publishRuntimeRelease({ version: '0.2.3' })

  expect(await managedRuntimeImage('claude-code')).toBe(
    publishedRuntimeImage('0.2.3', 'claude-code'),
  )
  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.2.3', 'codex'))
  // The readable tag is kept alongside the digest; the digest is what gets pulled.
  expect(await managedRuntimeImage('codex')).toMatch(
    /^ghcr\.io\/nuphos\/runtime:0\.2\.3-codex@sha256:[0-9a-f]{64}$/,
  )
})

test('a pinned version is deployed as asked, even once the fleet default moves past it', async () => {
  await publishRuntimeRelease({ version: '0.2.3', published: ['0.2.3', '0.1.4'] })

  expect(await managedRuntimeImage('codex', '0.1.4')).toBe(publishedRuntimeImage('0.1.4', 'codex'))
  // A mutable tag is not a version, so it resolves to the latest release instead.
  expect(await managedRuntimeImage('codex', 'latest')).toBe(publishedRuntimeImage('0.2.3', 'codex'))
})

test('a release naming an image the registry never published is not deployed', async () => {
  await publishRuntimeRelease({ version: '9.9.9', published: [] })

  expect(await managedRuntimeImage('codex')).toBeUndefined()
  expect(await managedRuntimeImage('codex', '9.9.9')).toBeUndefined()
})

test('an unreachable feed keeps serving the release and digest already resolved', async () => {
  await publishRuntimeRelease({ version: '0.2.3' })
  await managedRuntimeImage('codex')
  await refreshRuntimeRelease({})

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.2.3', 'codex'))
})

test('a release that moves the fleet backwards is not followed', async () => {
  await publishRuntimeRelease({ version: '0.2.3' })
  await managedRuntimeImage('codex')
  await refreshRuntimeRelease({ version: '0.1.9' })

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.2.3', 'codex'))
})

test('a newer release that stops advertising a provider leaves that fleet where it was', async () => {
  await publishRuntimeRelease({ version: '0.2.3', published: ['0.2.3', '0.2.4'] })
  // Each provider's fleet is only held once that provider has asked, which its own
  // reconcile loop does; nothing is held for a provider that has no runtimes.
  await managedRuntimeImage('codex')
  await refreshRuntimeRelease({
    version: '0.2.4',
    published: ['0.2.3', '0.2.4'],
    advertises: ['claude-code'],
  })

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.2.3', 'codex'))
  expect(await managedRuntimeImage('claude-code')).toBe(
    publishedRuntimeImage('0.2.4', 'claude-code'),
  )

  // The same version, with the image line put back: visible without a higher release or a
  // restart, so fixing release notes in place is enough to recover.
  await refreshRuntimeRelease({ version: '0.2.4', published: ['0.2.3', '0.2.4'] })

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.2.4', 'codex'))
})

test('one unresolvable tag costs one lookup, not one per runtime in the tick', async () => {
  await publishRuntimeRelease({ version: '9.9.9', published: [] })
  await managedRuntimeImage('codex')
  const served = runtimeFeedRequests()

  expect(await managedRuntimeImage('codex')).toBeUndefined()
  expect(runtimeFeedRequests()).toBe(served)
})

test('no release at all leaves the default unresolved, while a pin still resolves', async () => {
  await publishRuntimeRelease({ published: ['0.1.4'] })

  expect(await managedRuntimeImage('codex')).toBeUndefined()
  expect(await managedRuntimeImage('codex', '0.1.4')).toBe(publishedRuntimeImage('0.1.4', 'codex'))
})

test('self-hosted compose pins one published release across its own files', () => {
  const compose = readFileSync(join(COMPOSE_DIR, 'docker-compose.yml'), 'utf8')
  const tag = /nuphos-runtime:\$\{RUNTIME_TAG:-(\d+\.\d+\.\d+-claude-code)\}/.exec(compose)?.[1]

  // Compose cannot ask a registry anything at template time, so it names a release
  // literally. Its two files must at least agree on which.
  expect(tag).toMatch(/^\d+\.\d+\.\d+-claude-code$/)
  expect(readFileSync(join(COMPOSE_DIR, '.env.example'), 'utf8')).toContain(`RUNTIME_TAG=${tag}\n`)
})

test('pre-cutover release discovery still resolves legacy images', async () => {
  await publishRuntimeRelease({
    version: '0.1.11',
    legacy: true,
    published: [],
    legacyPublished: ['0.1.11'],
  })

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.1.11', 'codex', true))
  await refreshRuntimeRelease({ version: '0.1.12' })

  expect(await managedRuntimeImage('codex')).toBe(publishedRuntimeImage('0.1.12', 'codex'))
})

test('historical version pins survive the registry cutover and use separate digest caches', async () => {
  await publishRuntimeRelease({ version: '0.1.12', legacyPublished: ['0.1.11'] })

  expect(await managedRuntimeImage('codex', '0.1.11')).toBe(
    publishedRuntimeImage('0.1.11', 'codex', true),
  )
  const served = runtimeFeedRequests()

  expect(await managedRuntimeImage('codex', '0.1.11')).toBe(
    publishedRuntimeImage('0.1.11', 'codex', true),
  )
  expect(runtimeFeedRequests()).toBe(served)
})

test('a missing monorepo release image never silently resolves to the legacy registry', async () => {
  await publishRuntimeRelease({ version: '0.1.12', published: [], legacyPublished: ['0.1.12'] })

  expect(await managedRuntimeImage('codex')).toBeUndefined()
})
