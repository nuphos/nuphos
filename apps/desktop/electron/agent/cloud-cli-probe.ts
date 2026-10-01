import { randomUUID } from 'node:crypto'

import { isCloudCliProvider } from '../../src/lib/cloudCli.ts'
import { resolveShellEnv } from '../shell-env.ts'

import { findCloudCli } from './cloud-cli-probe-core.ts'
import { readCloudCliVersion } from './cloud-cli-version.ts'

const detectedClis = new Map<
  string,
  {
    provider: string
    path: string
    env: NodeJS.ProcessEnv
    expiresAt: number
  }
>()

export async function probeCloudCli(provider: string) {
  if (typeof provider !== 'string' || !isCloudCliProvider(provider))
    throw new Error('Unsupported cloud CLI provider')
  const env = { ...process.env, ...((await resolveShellEnv()) ?? {}) }

  if (process.platform !== 'win32') {
    env.PATH = `${env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
  }

  const probe = await findCloudCli(provider, env)

  if (!probe.path) return probe
  const now = Date.now()

  for (const [id, detected] of detectedClis) {
    if (detected.expiresAt < now) detectedClis.delete(id)
  }
  const oldestId = detectedClis.keys().next().value

  if (detectedClis.size >= 100 && oldestId) detectedClis.delete(oldestId)
  const probeId = randomUUID()

  detectedClis.set(probeId, { provider, path: probe.path, env, expiresAt: now + 30 * 60_000 })

  return { ...probe, probeId }
}

export async function probeCloudCliVersion(provider: string, probeId?: string) {
  const detected = probeId ? detectedClis.get(probeId) : null

  if (
    !isCloudCliProvider(provider) ||
    detected?.provider !== provider ||
    detected.expiresAt < Date.now()
  )
    return null

  return readCloudCliVersion(provider, detected.path, detected.env)
}
