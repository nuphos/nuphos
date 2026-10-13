// Where this dev instance keeps everything the launcher touches. `INSTANCE` is
// the one key every per-instance value derives from, so parallel instances
// never share a port, a Desktop profile, a sign-in file or a log.
import { execSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const ROOT = process.cwd()
export const BACKEND_DIR = join(ROOT, 'apps/backend')
export const DESKTOP_DIR = join(ROOT, 'apps/desktop')

/** `NUPHOS_DEV_INSTANCE`, else the worktree's directory name. */
export function instanceKey(explicit: string | undefined, root: string): string {
  return (explicit || basename(root)).replace(/[^\w.-]/g, '-')
}
export const INSTANCE = instanceKey(process.env.NUPHOS_DEV_INSTANCE, ROOT)
// Desktop's sign-in for this instance, apart from the installed app's cli.yaml.
export const CLI_CONFIG_DIR = join(homedir(), '.config/nuphos')
export const DEV_CLI_CONFIG = join(CLI_CONFIG_DIR, `cli.dev.${INSTANCE}.yaml`)
// Electron's profile and single-instance lock: `Nuphos Dev (<suffix>)`. " local"
// keeps it apart from a Desktop that once ran against another backend.
export const DESKTOP_SUFFIX = `${INSTANCE} local`
// Start at 3718 so ports line up with the named-tunnel hostnames (3718→api-dev-example-1
// … 3722→api-dev-example-5); worktrees beyond those fall back to a quick tunnel.
export const BASE_BACKEND_PORT = 3718
export const LOG_ROOT = join(tmpdir(), 'nuphos-dev-logs')
export const LOG_DIR = join(LOG_ROOT, INSTANCE)

/** The main checkout: linked worktrees share its .env files and compose secrets. */
export function mainRoot(root: string): string {
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()

    return dirname(common)
  } catch {
    return root // not a git checkout
  }
}
export const MAIN_ROOT = mainRoot(ROOT)
