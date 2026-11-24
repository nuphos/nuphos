import assert from 'node:assert/strict'
import childProcess, { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  AGENT_SLICE,
  OpenabProcess,
  agentScope,
  openabCommand,
  stopStaleOpenab,
} from './openab-process.ts'

import type { OpenabProcessOptions } from './openab-process.ts'

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

test(
  'openab starts, and the host keeps running, when its log cannot be written',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'openab-log-'))
    const openab = path.join(root, 'openab')
    const runtime = new OpenabProcess()

    try {
      // Writes more than a pipe holds, then listens where the host asks, like openab's gateway.
      writeFileSync(
        openab,
        `#!${process.execPath}\nconst [host, port] = process.env.GATEWAY_LISTEN.split(':')\nprocess.stdout.write('x'.repeat(4 << 20), () => require('node:http').createServer((_, res) => res.end()).listen(Number(port), host))\n`,
      )
      chmodSync(openab, 0o755)
      // A directory where the log file goes fails every write, as a full disk does.
      mkdirSync(path.join(root, 'log', 'openab.log'), { recursive: true })
      const options = {
        provider: 'codex',
        bundle: { root, openab },
        adapter: { entry: path.join(root, 'adapter.js'), version: 'test' },
        nodeExecPath: process.execPath,
        cliPath: process.execPath,
        agentHome: path.join(root, 'agent-home'),
        workspace: path.join(root, 'workspace'),
        openabHome: path.join(root, 'openab-home'),
        env: { PATH: process.env.PATH },
        logDir: path.join(root, 'log'),
      } as unknown as OpenabProcessOptions

      const running = await runtime.start(options)

      assert.ok(runtime.running())
      assert.equal((await fetch(`http://127.0.0.1:${String(running.port)}/`)).status, 200)
    } finally {
      await runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test("a Box runs openab in the memory-capped agents cgroup, keeping openab's own args", () => {
  assert.deepEqual(openabCommand('/b/openab', '/l/openab.toml', false), [
    '/b/openab',
    ['run', '-c', '/l/openab.toml'],
  ])
  const [command, args] = openabCommand('/b/openab', '/l/openab.toml', true)

  assert.equal(command, '/usr/bin/systemd-run')
  assert.ok(args.includes(`--slice=${AGENT_SLICE}`))
  // One tool's OOM kill must not stop the scope, and with it openab and every session.
  assert.ok(args.includes('--property=OOMPolicy=continue'))
  // A fixed scope per config, which the host stops to reap what openab's tools daemonized.
  assert.ok(args.includes(`--unit=${agentScope('/l/openab.toml')}`))
  assert.equal(agentScope('/l/openab.toml'), agentScope('/l/openab.toml'))
  assert.notEqual(agentScope('/l/openab.toml'), agentScope('/m/openab.toml'))
  // stopStaleOpenab finds a stale run by this suffix; `--scope` execs openab in place.
  assert.ok(args.join(' ').endsWith('openab run -c /l/openab.toml'))
})

// #5019: a stuck process made `ps` take seconds; the host sent no frames meanwhile and the
// backend closed its tunnel. This `ps` is the real one, started 2 s late.
const slowPs = (file: string, args: readonly string[]): [string, string[]] =>
  file === '/bin/ps'
    ? ['/bin/sh', ['-c', 'sleep 2; exec /bin/ps "$@"', 'sh', ...args]]
    : [file, [...args]]

test(
  'a slow ps does not stall the host while it looks for a stale openab',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (t) => {
    const { execFile, execFileSync } = childProcess

    t.mock.method(childProcess, 'execFile', (file: string, args: string[], ...rest: unknown[]) =>
      Reflect.apply(execFile, childProcess, [...slowPs(file, args), ...rest]),
    )
    t.mock.method(
      childProcess,
      'execFileSync',
      (file: string, args: string[], ...rest: unknown[]) =>
        Reflect.apply(execFileSync, childProcess, [...slowPs(file, args), ...rest]),
    )
    syncBuiltinESMExports()
    t.after(() => {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    })
    const startedAt = Date.now()
    // Stands in for the tunnel's heartbeat, which must keep its time while ps runs.
    const beat = new Promise<number>((resolve) =>
      setTimeout(() => {
        resolve(Date.now() - startedAt)
      }, 100),
    )

    await stopStaleOpenab(path.join(tmpdir(), 'no-such-openab', 'openab.toml'))
    assert.ok(Date.now() - startedAt >= 2_000, 'it waited for the slow ps')
    const beatAfter = await beat

    assert.ok(beatAfter < 1_000, `a 100 ms timer fired after ${String(beatAfter)} ms`)
  },
)
