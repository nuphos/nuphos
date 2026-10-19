import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { stopStaleOpenab } from './openab-process.ts'

// Stands in for openab (`node <root>/openab run -c <config>`): like openab it starts
// its agent in a process group of its own and reaps that agent on SIGTERM.
const FAKE_OPENAB = `
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
writeFileSync(path.join(path.dirname(process.argv[4]), 'agent.pid'), String(agent.pid))
process.on('SIGTERM', () => { process.kill(-agent.pid, 'SIGKILL'); process.exit(0) })
setInterval(() => {}, 1000)
`

// Stands in for the host: starts openab as a plain child and reports its pid.
const FAKE_HOST = `
const { spawn } = require('node:child_process')
const openab = spawn(process.execPath, process.argv.slice(1), { stdio: 'ignore' })
process.stdout.write(String(openab.pid))
setInterval(() => {}, 1000)
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

function readPid(file: string): number {
  try {
    return Number(readFileSync(file, 'utf8')) || 0
  } catch {
    return 0
  }
}

/** A host that started openab for `config`, then was killed with SIGKILL. */
async function orphanedOpenab(root: string, config: string, pids: number[]) {
  const host = spawn(
    process.execPath,
    ['-e', FAKE_HOST, path.join(root, 'openab'), 'run', '-c', config],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  let openab = 0

  pids.push(host.pid ?? 0)
  host.stdout.on('data', (data) => {
    openab = Number(String(data))
  })
  await until(() => openab > 0)
  pids.push(openab)
  const agentFile = path.join(path.dirname(config), 'agent.pid')

  await until(() => readPid(agentFile) > 0)
  const agent = readPid(agentFile)

  pids.push(agent)
  host.kill('SIGKILL')
  await until(() => !alive(host.pid ?? 0))

  return { openab, agent }
}

test(
  'starting openab stops the run a killed host left for the same config, and its agent',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'stale-openab-'))
    const mine = path.join(root, 'mine', 'openab.toml')
    const other = path.join(root, 'other', 'openab.toml')
    const pids: number[] = []

    try {
      writeFileSync(path.join(root, 'openab'), FAKE_OPENAB)
      for (const config of [mine, other]) mkdirSync(path.dirname(config))
      const stale = await orphanedOpenab(root, mine, pids)
      const unrelated = await orphanedOpenab(root, other, pids)

      assert.ok(alive(stale.openab) && alive(stale.agent))
      await stopStaleOpenab(mine)
      await until(() => !alive(stale.openab) && !alive(stale.agent))
      assert.ok(alive(unrelated.openab), 'another config’s openab is left alone')
    } finally {
      for (const pid of pids) {
        try {
          if (pid > 0) process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  },
)
