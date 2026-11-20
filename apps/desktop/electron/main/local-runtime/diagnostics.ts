import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { redactSecrets } from '../../../src/lib/secretRedaction.ts'
import { writeZipFile } from '../../zip-file.ts'

import type { LocalRuntimeBundle } from './config.ts'
import type { LocalAgentState, LocalRuntimeState } from './controller-types.ts'

/** How much of each log's end goes in: enough for the last few sessions, small enough to attach. */
export const LOG_TAIL_BYTES = 2 * 1024 * 1024

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]{0,32}m`, 'g')

async function subdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])

  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name))
}

/** Every openab.log under `dataDir`: users/<user>/<agent>/, also inside each added instance. */
export async function findRuntimeLogs(dataDir: string): Promise<string[]> {
  const roots = [dataDir, ...(await subdirs(path.join(dataDir, 'instances')))]
  const found: string[] = []

  for (const root of roots)
    for (const user of await subdirs(path.join(root, 'users')))
      for (const agent of await subdirs(user)) {
        const file = path.join(agent, 'openab.log')
        const stat = await fs.stat(file).catch(() => null)

        if (stat?.isFile()) found.push(file)
      }

  return found
}

/** The last `maxBytes` of a file, starting at a whole line. */
export async function readTail(file: string, maxBytes = LOG_TAIL_BYTES): Promise<string> {
  const handle = await fs.open(file, 'r')

  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - maxBytes)
    const buffer = Buffer.alloc(size - start)

    await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')

    return start === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } finally {
    await handle.close()
  }
}

/** Colour codes split `token=value` apart, so they go before the secrets do. */
export function redactLog(text: string, home: string): string {
  return redactSecrets(text.replace(ANSI, '').replaceAll(home, '~'))
}

function agentSummary(agent: LocalAgentState) {
  const cli = agent.cli?.installed
    ? { installed: true, version: agent.cli.version ?? null, signedIn: agent.cli.loggedIn }
    : { installed: false }

  return {
    available: agent.available,
    online: agent.online,
    cli,
    ...(agent.error ? { error: redactSecrets(agent.error) } : {}),
  }
}

/** Versions and states only: no account names, ids or paths. */
export function diagnosticsSummary(
  appVersion: string,
  bundle: LocalRuntimeBundle | null,
  state: LocalRuntimeState,
) {
  return {
    desktop: { version: appVersion, electron: process.versions.electron },
    os: {
      platform: process.platform,
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
    },
    runtime: {
      openabCommit: bundle?.openabCommit ?? null,
      adapters: Object.fromEntries(
        Object.entries(bundle?.adapters ?? {}).map(([provider, adapter]) => [
          provider,
          adapter.version,
        ]),
      ),
    },
    agents: Object.fromEntries(
      Object.entries(state.agents).map(([provider, agent]) => [provider, agentSummary(agent)]),
    ),
    instances: (state.instances ?? []).map((instance) => ({
      provider: instance.provider,
      ...agentSummary(instance),
    })),
  }
}

/** Saves redacted log tails and `summary` to a zip at `destination`. */
export async function writeDiagnostics(
  destination: string,
  { dataDir, home, summary }: { dataDir: string; home: string; summary: object },
): Promise<void> {
  const logs = await findRuntimeLogs(dataDir)
  const entries = await Promise.all(
    logs.map(async (file) => ({
      name: `logs/${path.relative(dataDir, file).split(path.sep).join('/')}`,
      content: redactLog(await readTail(file), home),
    })),
  )
  const savedAt = new Date().toISOString()

  await writeZipFile(destination, [
    { name: 'summary.json', content: `${JSON.stringify({ savedAt, ...summary }, null, 2)}\n` },
    ...entries,
  ])
}
