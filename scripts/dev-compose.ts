// The one place that names the dev stack's compose project and files, for the
// launcher and for `bun run dev:stop | dev:reset | dev:logs | dev:ps | dev:runtime-password`.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { DEV_CLI_CONFIG, ROOT } from './dev-workspace.ts'

export const COMPOSE_DIR = join(ROOT, 'deploy/compose')
export const COMPOSE_ENV = join(COMPOSE_DIR, '.env')
export const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml']

export const RUNTIME_PASSWORD_ARGS = [
  'exec',
  '-T',
  'runtime',
  'cat',
  '/home/node/.nuphos-runtime/auth-key',
]

export type StackCommand =
  { kind: 'run'; args: string[] } | { kind: 'reset'; confirmed: boolean } | { kind: 'usage' }

export const STACK_USAGE =
  'usage: bun run dev:stop | dev:reset [--yes] | dev:logs [service] | dev:ps | dev:login | dev:runtime-password'

export function parseStackCommand(argv: readonly string[]): StackCommand {
  const [command, ...rest] = argv

  switch (command) {
    case 'stop':
      return { kind: 'run', args: ['stop'] }
    case 'ps':
      return { kind: 'run', args: ['ps'] }
    case 'login':
      return { kind: 'run', args: ['exec', 'runtime', 'claude', 'auth', 'login'] }
    case 'logs':
      return { kind: 'run', args: ['logs', '-f', '--tail', '200', ...rest] }
    case 'runtime-password':
      return { kind: 'run', args: RUNTIME_PASSWORD_ARGS }
    case 'reset':
      return { kind: 'reset', confirmed: rest.includes('--yes') || rest.includes('-y') }
    default:
      return { kind: 'usage' }
  }
}

export const RESET_ARGS = ['down', '-v']

/** A new JWT secret or a wiped database makes the dev Desktop's stored token useless. */
export function clearDevSignIn(): boolean {
  try {
    rmSync(DEV_CLI_CONFIG)

    return true
  } catch {
    return false
  }
}
