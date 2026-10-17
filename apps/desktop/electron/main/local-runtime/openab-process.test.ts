import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { stopStaleOpenab } from './openab-process.ts'

// Stands in for openab: it keeps an agent in its own process group and, like openab,
// reaps that agent on SIGTERM.
const FAKE_OPENAB = `#!/bin/sh
setsid sleep 300 &
echo $! > "$(dirname "$3")/agent.pid"
trap 'kill $(cat "$(dirname "$3")/agent.pid"); exit 0' TERM
while :; do sleep 1; done
`

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000

  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** A host that started openab for `config`, then was killed with SIGKILL. */
async function orphanedOpenab(
  root: string,
  config: string,
): Promise<{ openab: number; agent: number }> {
  const openab = path.join(root, 'openab')
  const host = spawn('/bin/sh', ['-c', `"${openab}" run -c "${config}" & echo $!; wait`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const pid = await new Promise<number>((resolve) =>
    host.stdout.once('data', (d) => resolve(Number(String(d)))),
  )

  await until(() => {
    try {
      return readFileSync(path.join(path.dirname(config), 'agent.pid'), 'utf8').trim() !== ''
    } catch {
      return false
    }
  })
  host.kill('SIGKILL')

  return {
    openab: pid,
    agent: Number(readFileSync(path.join(path.dirname(config), 'agent.pid'), 'utf8')),
  }
}

test(
  'starting openab stops the run a killed host left for the same config, and its agent',
  { skip: process.platform === 'win32' },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'stale-openab-'))
    const mine = path.join(root, 'mine', 'openab.toml')
    const other = path.join(root, 'other', 'openab.toml')

    writeFileSync(path.join(root, 'openab'), FAKE_OPENAB)
    chmodSync(path.join(root, 'openab'), 0o755)
    for (const config of [mine, other]) mkdirSync(path.dirname(config))
    const stale = await orphanedOpenab(root, mine)
    const unrelated = await orphanedOpenab(root, other)

    try {
      assert.ok(alive(stale.openab) && alive(stale.agent))
      await stopStaleOpenab(mine)
      await until(() => !alive(stale.openab) && !alive(stale.agent))
      assert.ok(alive(unrelated.openab), 'another config’s openab is left alone')
    } finally {
      for (const pid of [stale.openab, stale.agent, unrelated.openab, unrelated.agent]) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  },
)
