import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PATCH_SOURCES = ['adapter-patches.mjs', 'skills-sync.mjs']
export const STAMP_SOURCES = ['prepare.mjs', ...PATCH_SOURCES]

/** A digest of the given files, so a changed pin or patch yields a different value. */
export function digestOf(files, dir = here) {
  const hash = createHash('sha256')

  for (const file of files)
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(join(dir, file)))

  return hash.digest('hex').slice(0, 16)
}

/** What a bundle staged by the current prepare.mjs records in its manifest. */
export function bundleStamp(dir = here) {
  return digestOf(STAMP_SOURCES, dir)
}

/** ready, missing (no usable bundle) or stale (staged by another prepare.mjs). */
export function bundleState(bundleDir, stamp = bundleStamp()) {
  let manifest

  try {
    manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'))
  } catch {
    return 'missing'
  }
  if (!manifest.openab || !existsSync(join(bundleDir, manifest.openab))) return 'missing'
  for (const adapter of Object.keys(manifest.adapters ?? {}))
    if (!existsSync(join(bundleDir, 'adapters', adapter, manifest.adapters[adapter].entry)))
      return 'missing'

  return manifest.stamp === stamp ? 'ready' : 'stale'
}
