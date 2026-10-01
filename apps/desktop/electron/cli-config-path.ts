import os from 'node:os'
import path from 'node:path'

/** `bun run dev` points this at a dev-only file, so signing in to a local backend never replaces the installed app's session. */
export const CLI_CONFIG_PATH =
  process.env.NUPHOS_CLI_CONFIG || path.join(os.homedir(), '.config', 'nuphos', 'cli.yaml')
