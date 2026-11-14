import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type GuardLaunch = { bundle: { root: string }; openabHome: string }
type GuardEnv = { BASH_ENV: string; SHLVL: string; ZDOTDIR: string }

/**
 * The conversation token in the spawn-time env expires after a day. Every shell an
 * agent runs re-reads the current one from OPENAB_CREDENTIALS_DIR through the
 * runtime image's guard: bash through BASH_ENV, zsh (Codex on macOS) through
 * $ZDOTDIR/.zshenv. Claude Code gives its shell a socket for stdin, and a top-level
 * bash with one is a "remote shell" that skips BASH_ENV; SHLVL makes it nested, as
 * in a terminal. An app launched from the Dock or a service starts without it.
 */
export function shellGuardEnv(launch: GuardLaunch): GuardEnv {
  return {
    BASH_ENV: path.join(launch.bundle.root, 'runtime-guard.sh'),
    SHLVL: '1',
    ZDOTDIR: path.join(launch.openabHome, 'zsh'),
  }
}

/** Written at every start, not bundled: the packaged app drops dotfiles. */
export function writeZshenv(launch: GuardLaunch): void {
  const { BASH_ENV, ZDOTDIR } = shellGuardEnv(launch)

  mkdirSync(ZDOTDIR, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(ZDOTDIR, '.zshenv'), `. '${BASH_ENV.replaceAll("'", "'\\''")}'\n`, {
    mode: 0o600,
  })
}
