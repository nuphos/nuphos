import type { LocalSetupStatus } from '../../api'

/** `path` with this computer's home folder shown as `~`, as the member knows it. */
export function shortPath(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/** The home folder, from ~/.claude/skills: always the first folder synced. */
export function homeOf(folders: LocalSetupStatus['folders']): string {
  return folders[0]?.path.replace(/[\\/]\.claude[\\/]skills$/u, '') ?? ''
}
