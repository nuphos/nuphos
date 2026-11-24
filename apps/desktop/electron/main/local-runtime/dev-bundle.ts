import { unwatchFile, watchFile } from 'node:fs'
import path from 'node:path'

import type { Stats } from 'node:fs'

/** Polls rather than fs.watch: the bundle directory is replaced wholesale, and may not exist yet. */
export function watchDevBundle(root: string, onBundle: () => void): () => void {
  const manifest = path.join(root, 'manifest.json')
  const listener = (current: Stats) => {
    if (current.mtimeMs) onBundle()
  }

  watchFile(manifest, { interval: 2_000 }, listener)

  return () => unwatchFile(manifest, listener)
}
