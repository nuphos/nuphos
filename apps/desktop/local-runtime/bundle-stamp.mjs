import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PATCH_SOURCES = [
  'adapter-patches.mjs',
  'box-desktop-mcp.mjs',
  'skills-sync.mjs',
  'claude-session-env.mjs',
  'computer-use-permission.mjs',
]
export const STAMP_SOURCES = [
  'prepare.mjs',
  'computer-use-permission.swift',
  'desktop-session.mjs',
  ...PATCH_SOURCES,
]
/** The backend's fixed attachment program, which the local runtime runs as its own job. */
export const ATTACHMENT_JOB = '../../backend/src/lib/claude-code-preview/attachment-job.mjs'
/** The runtime image's adapters, staged as the image stages them. */
export const RUNTIME_DIR = join(here, '../../runtime/image')
/** The openab source the runtime image and the Local runtime both build. */
export const OPENAB_DIR = join(here, '../../runtime/openab')
export const RUNTIME_SOURCES = [
  'runtime-defaults.mjs',
  'claude-login.mjs',
  'codex-login.mjs',
  'panel-job.mjs',
  'reply-images.mjs',
  'reply-image-stream.mjs',
  'mcp-bridge-config.mjs',
  'mcp-http-bridge.mjs',
  'session-home.mjs',
  ATTACHMENT_JOB,
  ...[
    'package.json',
    'package-lock.json',
    'patch-adapter.mjs',
    'turn-completion.mjs',
    'session-state.mjs',
    'default-effort.mjs',
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

/**
 * The git tree of OPENAB_DIR as it is on disk, uncommitted edits included, so it
 * equals the committed tree the runtime image is tagged with when the checkout is
 * clean. null without git.
 */
export function openabRevision(dir = OPENAB_DIR) {
  const scratch = mkdtempSync(join(tmpdir(), 'openab-index-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

  try {
    git('add', '--all', '.')

    return git('write-tree', `--prefix=${git('rev-parse', '--show-prefix')}`)
  } catch {
    return null
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** What a bundle records as its stamp: the staging sources and the openab it carries. */
export function stagedStamp() {
  return `${bundleStamp()}-${openabRevision()}`
}

/** ready, missing (no usable bundle) or stale (staged from other sources). */
export function bundleState(bundleDir, stamp = stagedStamp()) {
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
