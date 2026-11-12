import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Node-API is ABI stable across Node and Electron; no V8/Electron headers needed.
export function buildSidebarGestures() {
  if (process.platform !== 'darwin') return
  const root = fileURLToPath(new URL('../', import.meta.url))
  const source = path.join(root, 'native/sidebar-gestures.mm')
  const output = path.join(root, 'build/native/sidebar-gestures.node')
  const manifest = createRequire(import.meta.url).resolve('node-api-headers/package.json')
  const headers = path.join(path.dirname(manifest), 'include')

  if (
    existsSync(output) &&
    statSync(output).mtimeMs >=
      Math.max(
        statSync(source).mtimeMs,
        statSync(fileURLToPath(import.meta.url)).mtimeMs,
        statSync(manifest).mtimeMs,
      )
  )
    return
  mkdirSync(path.dirname(output), { recursive: true })
  const temporary = mkdtempSync(path.join(path.dirname(output), 'sidebar-gestures-'))
  const compiled = path.join(temporary, 'sidebar-gestures.node')

  try {
    execFileSync(
      '/usr/bin/xcrun',
      [
        'clang++',
        '-std=c++17',
        '-mmacosx-version-min=12.0',
        '-arch',
        'arm64',
        '-arch',
        'x86_64',
        '-bundle',
        '-undefined',
        'dynamic_lookup',
        '-fobjc-arc',
        '-fblocks',
        '-framework',
        'AppKit',
        '-I',
        headers,
        source,
        '-o',
        compiled,
      ],
      { stdio: 'inherit' },
    )
    renameSync(compiled, output)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildSidebarGestures()
