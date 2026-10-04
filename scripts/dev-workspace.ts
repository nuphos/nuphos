// Where this worktree keeps everything the dev launcher touches. `ROOT` is the
// worktree the command was run from, so parallel worktrees each get their own
// apps, log files and badge.
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const ROOT = process.cwd()
export const BACKEND_DIR = join(ROOT, 'apps/backend')
export const DESKTOP_DIR = join(ROOT, 'apps/desktop')
// Desktop's sign-in for the local stack, apart from the installed app's cli.yaml.
export const DEV_CLI_CONFIG = join(homedir(), '.config/nuphos/cli.dev.yaml')
export const WT_ID = basename(ROOT)
// Start at 3718 so ports line up with the named-tunnel hostnames (3718→api-dev-example-1
// … 3722→api-dev-example-5); worktrees beyond those fall back to a quick tunnel.
export const BASE_BACKEND_PORT = 3718
export const LOG_DIR = join(tmpdir(), 'nuphos-dev-logs')
