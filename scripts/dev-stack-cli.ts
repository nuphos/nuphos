#!/usr/bin/env bun

// `bun run dev:stop | dev:reset | dev:logs [service] | dev:ps | dev:login | dev:runtime-password`
// for the shared dev stack, and `dev:instances [rm <name>]` for the launchers running on it.
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

import {
  COMPOSE,
  COMPOSE_DIR,
  RESET_ARGS,
  STACK_USAGE,
  clearDevSignIn,
  parseStackCommand,
} from './dev-compose.ts'
import {
  formatKb,
  instanceDiskKb,
  otherLaunchers,
  processIsAlive,
  readInstances,
  removeInstance,
} from './dev-instance.ts'
import { cleanupManagedAgents } from './dev-managed-cleanup.ts'
import { acquireResetLock, resetMessage, runReset } from './dev-reset.ts'

function compose(args: string[]): number {
  return (
    spawnSync('docker', [...COMPOSE, ...args], { cwd: COMPOSE_DIR, stdio: 'inherit' }).status ?? 1
  )
}

async function confirmReset(): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    const answer = await rl.question(
      'Delete the local dev database, buckets, runtime data and local managed agents? [y/N] ',
    )

    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

const command = parseStackCommand(process.argv.slice(2))

if (command.kind === 'usage') {
  process.stderr.write(`${STACK_USAGE}\n`)
  process.exit(2)
}
const print = (line: string) => process.stdout.write(`${line}\n`)

if (command.kind === 'instances') {
  if (command.remove) {
    try {
      await removeInstance(command.remove, print)
      process.exit(0)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }
  }
  const rows = readInstances().map((r) => [
    r.key,
    r.pid && processIsAlive(r.pid) ? `running ${String(r.pid)}` : 'stopped',
    String(r.backend ?? '-'),
    String(r.vite ?? '-'),
    String(r.cdp ?? '-'),
    formatKb(instanceDiskKb(r)),
    r.root,
  ])
  const table = [['NAME', 'STATE', 'BACKEND', 'VITE', 'CDP', 'DISK', 'WORKTREE'], ...rows]
  const widths = table[0]!.map((_, i) => Math.max(...table.map((row) => row[i]!.length)))

  for (const row of table)
    print(
      row
        .map((cell, i) => cell.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    )
  process.exit(0)
}

if (command.kind === 'run') {
  const code = compose(command.args)

  if (command.args[0] === 'stop') await cleanupManagedAgents('stop', print)
  process.exit(code)
}
const result = await runReset({
  confirm: () => (command.confirmed ? Promise.resolve(true) : confirmReset()),
  acquire: () => acquireResetLock(),
  otherLaunchers,
  wipe: async () => {
    const wiped = compose(RESET_ARGS) === 0

    await cleanupManagedAgents('down', print)

    return wiped
  },
})

if (result.outcome === 'wiped' && clearDevSignIn())
  process.stdout.write('Cleared the dev Desktop sign-in.\n')
process.stdout.write(`${resetMessage(result)}\n`)
process.exit(result.outcome === 'wiped' ? 0 : 1)
