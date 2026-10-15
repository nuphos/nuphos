import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { LocalAgentProvider } from './agent-cli.ts'

export type AgentInstance = { instanceId: string; provider: LocalAgentProvider; label: string }
/** Pending until its first sign-in; a record from before this field existed is legacy. */
export type AgentInstanceRecord = AgentInstance & {
  state?: 'pending' | 'ready'
  createdAt?: string
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export function parseInstance(value: unknown): AgentInstance {
  const item = value as Partial<AgentInstance> | null

  if (
    !item ||
    typeof item.instanceId !== 'string' ||
    !UUID.test(item.instanceId) ||
    !['claude-code', 'codex'].includes(item.provider ?? '') ||
    typeof item.label !== 'string' ||
    !item.label.trim() ||
    item.label.length > 100
  )
    throw new Error('Invalid agent instance')

  return { instanceId: item.instanceId, provider: item.provider!, label: item.label.trim() }
}

function parseRecord(value: unknown): AgentInstanceRecord {
  const item = value as Partial<AgentInstanceRecord> | null
  const state = item?.state === 'pending' || item?.state === 'ready' ? item.state : undefined
  const createdAt = typeof item?.createdAt === 'string' ? item.createdAt : undefined

  return {
    ...parseInstance(value),
    ...(state ? { state } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}

export function readInstances(dir: string): AgentInstanceRecord[] {
  try {
    const values: unknown = JSON.parse(readFileSync(path.join(dir, 'instances.json'), 'utf8'))

    if (!Array.isArray(values)) throw new Error('Invalid instance inventory')
    const instances = values.map(parseRecord)

    if (new Set(instances.map((item) => item.instanceId)).size !== instances.length)
      throw new Error('Duplicate agent instance')

    return instances
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function writeInstances(dir: string, instances: AgentInstanceRecord[]): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'instances.json')

  writeFileSync(`${file}.tmp`, JSON.stringify(instances), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}
