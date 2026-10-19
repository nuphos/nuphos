import os from 'node:os'
import path from 'node:path'

/** `bun run dev` points this at a dev-only file, so signing in to a local backend never replaces the installed app's session. */
export const CLI_CONFIG_PATH =
  process.env.NUPHOS_CLI_CONFIG || path.join(os.homedir(), '.config', 'nuphos', 'cli.yaml')

/** A file beside the CLI's sign-in: `cli.yaml` → `desktop.yaml`, `cli.dev.yaml` → `desktop.dev.yaml` (as `apps/cli/src/config.rs`). */
export function siblingConfig(cliPath: string, name: string): string {
  const base = path.basename(cliPath)
  const file = base.startsWith('cli')
    ? `${name}${base.slice(3)}`
    : `${base.replace(/\.ya?ml$/, '')}.${name}.yaml`

  return path.join(path.dirname(cliPath), file)
}

/**
 * This app's own sign-in. The CLI keeps its own in cli.yaml, so each reads
 * only the keychain item it created and macOS never asks; `nuphos login`
 * starts from this one.
 */
export const DESKTOP_CONFIG_PATH = siblingConfig(CLI_CONFIG_PATH, 'desktop')
