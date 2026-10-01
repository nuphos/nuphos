export type DevMode = 'desktop' | 'admin'

export type DevOptions = {
  mode: DevMode
  /** Wipe the local stack before starting, like `bun run dev:reset --yes`. */
  reset: boolean
  /** Kube context managed agents run in (`--managed[=<context>]`); null leaves the provisioner off. */
  managed: string | null
}

function managedContext(argv: string[]): string | null {
  const flag = argv.findLast((arg) => arg === '--managed' || arg.startsWith('--managed='))

  if (!flag) return null

  return flag === '--managed' ? 'orbstack' : flag.slice('--managed='.length)
}

export function parseDevOptions(argv: string[]): DevOptions {
  return {
    mode: argv.includes('--admin') ? 'admin' : 'desktop',
    reset: argv.includes('--reset'),
    managed: managedContext(argv),
  }
}

export const DEV_OPTIONS = parseDevOptions(process.argv.slice(2))
