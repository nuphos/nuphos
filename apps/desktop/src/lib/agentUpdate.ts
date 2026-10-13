import type { AgentCliStatus } from '../api/device-types.ts'

/** True when `latest` is a newer x.y.z than `current`. */
export function newerVersion(latest: string, current: string): boolean {
  const parts = (version: string) => version.split(/[.+-]/u, 3).map(Number)
  const [next, now] = [parts(latest), parts(current)]

  for (let i = 0; i < 3; i++) if (next[i] !== now[i]) return (next[i] ?? 0) > (now[i] ?? 0)

  return false
}

/** The newer version this computer's CLI can update to; a CLI bundled in an app updates with it. */
export function localUpdateVersion(
  cli: AgentCliStatus | null | undefined,
  latest: string | undefined,
): string | undefined {
  if (!cli?.installed || !cli.version || !latest || cli.bundled) return

  return newerVersion(latest, cli.version) ? latest : undefined
}
