import { readFileSync, unwatchFile, watchFile } from 'node:fs'
import path from 'node:path'

import type { Stats } from 'node:fs'

export type DevBundleHint =
  { state: 'preparing' } | { state: 'failed'; reason: string } | { state: 'missing' }

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** Written by `bun run dev` while it stages the bundle at `root`. */
export const devStatusFile = (root: string) => `${root}.dev.json`

/** Why an unpackaged app has no bundle; a status left by a launcher that is gone means nothing. */
export function devBundleHint(root: string, isAlive = processAlive): DevBundleHint {
  try {
    const status = JSON.parse(readFileSync(devStatusFile(root), 'utf8')) as {
      pid?: unknown
      state?: unknown
      reason?: unknown
    }

    if (typeof status.pid === 'number' && isAlive(status.pid)) {
      if (status.state === 'preparing') return { state: 'preparing' }
      if (status.state === 'failed' && typeof status.reason === 'string')
        return { state: 'failed', reason: status.reason }
    }
  } catch {
    // No launcher status.
  }

  return { state: 'missing' }
}

/** Polls rather than fs.watch: the bundle directory is replaced wholesale, and may not exist yet. */
export function watchDevBundle(
  root: string,
  on: { bundle: () => void; status: () => void },
): () => void {
  const manifest = path.join(root, 'manifest.json')
  const status = devStatusFile(root)
  const options = { interval: 2_000 }
  const onBundle = (current: Stats) => {
    if (current.mtimeMs) on.bundle()
  }
  const onStatus = () => {
    on.status()
  }

  watchFile(manifest, options, onBundle)
  watchFile(status, options, onStatus)

  return () => {
    unwatchFile(manifest, onBundle)
    unwatchFile(status, onStatus)
  }
}
