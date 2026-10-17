// What the agent CLIs looked like at the last probe, per user: a head start for
// the next launch, shared by the app and the `nuphos agent` host.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { AgentCliStatus, LocalAgentProvider } from './agent-cli.ts'

type CliCache = Partial<Record<LocalAgentProvider, AgentCliStatus>>

const cacheFile = (dataDir: string, userId: string) =>
  path.join(dataDir, 'users', userId, 'cli.json')

export function readCliCache(dataDir: string, userId: string): CliCache {
  try {
    return JSON.parse(readFileSync(cacheFile(dataDir, userId), 'utf8')) as CliCache
  } catch {
    return {}
  }
}

export function writeCliCache(dataDir: string, userId: string, cli: CliCache): void {
  try {
    mkdirSync(path.dirname(cacheFile(dataDir, userId)), { recursive: true })
    writeFileSync(cacheFile(dataDir, userId), JSON.stringify(cli), { mode: 0o600 })
  } catch {
    // Only a head start for the next launch.
  }
}
