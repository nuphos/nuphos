// The one place that names the dev stack's compose project and files, for the
// launcher and for `bun run dev:stop | dev:reset | dev:logs | dev:ps | dev:runtime-password`.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CLI_CONFIG_DIR, MAIN_ROOT, ROOT } from './dev-workspace.ts'

export const COMPOSE_DIR = join(ROOT, 'deploy/compose')
// Every checkout runs the one shared stack with these secrets. A checkout
// generating its own would recreate rustfs with a new S3 key under the other
// backends, and sign tokens nobody else accepts.
export const COMPOSE_ENV = join(CLI_CONFIG_DIR, 'dev-stack.env')
export const COMPOSE = [
  'compose',
  '--env-file',
  COMPOSE_ENV,
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.dev.yml',
]

const hex = () => randomBytes(32).toString('hex')

export type S3Keys = { access: string; secret: string }

/** The main checkout's secrets, else fresh ones; a running stack's S3 keys win over both. */
export function stackEnvText(example: string, existing: string | null, running: S3Keys | null) {
  const text =
    existing ??
    example
      .replace(/^NUPHOS_JWT_SECRET=.*$/m, `NUPHOS_JWT_SECRET=${hex()}`)
      .replace(/^S3_SECRET_KEY=.*$/m, `S3_SECRET_KEY=${hex()}`)

  return running
    ? text
        .replace(/^S3_ACCESS_KEY=.*$/m, `S3_ACCESS_KEY=${running.access}`)
        .replace(/^S3_SECRET_KEY=.*$/m, `S3_SECRET_KEY=${running.secret}`)
    : text
}

export function createStackEnv(running: S3Keys | null): void {
  const existing = join(MAIN_ROOT, 'deploy/compose/.env')
  const example = readFileSync(join(COMPOSE_DIR, '.env.example'), 'utf8')
  const text = stackEnvText(
    example,
    existsSync(existing) ? readFileSync(existing, 'utf8') : null,
    running,
  )

  mkdirSync(CLI_CONFIG_DIR, { recursive: true })
  // `wx`: when two launchers race, the first file wins and the other throws.
  writeFileSync(COMPOSE_ENV, text, { mode: 0o600, flag: 'wx' })
}

export const RUNTIME_PASSWORD_ARGS = [
  'exec',
  '-T',
  'runtime',
  'cat',
  '/home/node/.nuphos-runtime/auth-key',
]

export type StackCommand =
  | { kind: 'run'; args: string[] }
  | { kind: 'reset'; confirmed: boolean }
  | { kind: 'instances'; remove: string | null }
  | { kind: 'usage' }

export const STACK_USAGE =
  'usage: bun run dev:stop | dev:reset [--yes] | dev:logs [service] | dev:ps | dev:login | dev:runtime-password | dev:instances [rm <name>]'

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
    case 'instances':
      if (rest.length === 0) return { kind: 'instances', remove: null }

      return rest[0] === 'rm' && rest.length === 2
        ? { kind: 'instances', remove: rest[1]! }
        : { kind: 'usage' }
    default:
      return { kind: 'usage' }
  }
}

export const RESET_ARGS = ['down', '-v']

/** A new JWT secret or a wiped database makes every dev Desktop's stored token useless. */
export function clearDevSignIn(): boolean {
  let names: string[]

  try {
    names = readdirSync(CLI_CONFIG_DIR).filter((name) => /^cli\.dev(\..+)?\.yaml$/.test(name))
  } catch {
    return false
  }
  for (const name of names) rmSync(join(CLI_CONFIG_DIR, name), { force: true })

  return names.length > 0
}
