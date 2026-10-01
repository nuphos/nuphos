#!/usr/bin/env bun

// `bun run dev:stop | dev:reset | dev:logs [service] | dev:ps | dev:login | dev:runtime-password` for the dev stack.
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
import { otherLaunchers } from './dev-launchers.ts'
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
