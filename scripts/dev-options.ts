export type DevOptions = {
  /** Wipe the local stack before starting, like `bun run dev:reset --yes`. */
  reset: boolean
}

export function parseDevOptions(argv: string[]): DevOptions {
  return { reset: argv.includes('--reset') }
}

export const DEV_OPTIONS = parseDevOptions(process.argv.slice(2))
