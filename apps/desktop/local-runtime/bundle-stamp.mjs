import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PATCH_SOURCES = ['adapter-patches.mjs', 'skills-sync.mjs', 'claude-session-env.mjs']
export const STAMP_SOURCES = ['prepare.mjs', ...PATCH_SOURCES]
/** The runtime image's adapters, staged as the image stages them. */
export const RUNTIME_DIR = join(here, '../../runtime/image')
export const RUNTIME_SOURCES = [
  'runtime-defaults.mjs',
  'mcp-bridge-config.mjs',
  'mcp-http-bridge.mjs',
  'session-home.mjs',
  ...[
    'package.json',
    'package-lock.json',
    'patch-adapter.mjs',
    'turn-completion.mjs',
    'session-state.mjs',
  ].map((file) => `claude-agent-acp/${file}`),
  ...[
    'package.json',
    'package-lock.json',
    'patch-adapter.mjs',
    'session-config.mjs',
    'steering.mjs',
  ].map((file) => `codex-acp/${file}`),
]

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

/** What a bundle staged by the current prepare.mjs and runtime image records in its manifest. */
export function bundleStamp(dir = here, runtimeDir = RUNTIME_DIR) {
  return digestOf(STAMP_SOURCES, dir) + digestOf(RUNTIME_SOURCES, runtimeDir)
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
