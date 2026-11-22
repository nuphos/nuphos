import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { BOX_CLEAR_CACHES_COMMAND } from '@/lib/agent/devices/box-instabox-client'
import { AppError } from '@/lib/errors'

import { requestBoxCacheClear } from './box-clear-caches'

import type { BoxCacheClearDeps } from './box-clear-caches'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/box-clear-caches.test.ts

const status = { agents: { 'claude-code': {} } } as unknown as LocalRuntimeStatus

// Keep the old busy probe as a regression tripwire: a confirmed clear must not consult it.
function deps(overrides: Partial<BoxCacheClearDeps & { busy: () => Promise<boolean> }> = {}) {
  const calls = { cleared: [] as string[], asked: [] as string[] }
  const value = {
    device: async (actorId: string) => {
      if (actorId !== 'admin')
        throw new AppError(404, 'device_not_found', 'Device is not available')

      return { userId: 'u1', deviceId: 'box-1', box: true }
    },
    status: async () => status,
    busy: async () => {
      calls.asked.push('busy')

      return false
    },
    clear: async ({ userId, deviceId }: { userId: string; deviceId: string }) => {
      calls.cleared.push(`${userId}:${deviceId}`)
    },
    ...overrides,
  }

  return { value, calls }
}

const code = (error: unknown) => (error instanceof AppError ? error.code : String(error))
const byName = (a = '', b = '') => a.localeCompare(b)
const refusal = (run: Promise<unknown>) => run.then(() => 'cleared', code)

describe('Box cache clear', () => {
  test('a manager clears an idle Box, on its owner’s machine', async () => {
    const idle = deps()

    expect(await requestBoxCacheClear('t1', 'box-1', 'admin', idle.value)).toEqual({ ok: true })
    expect(idle.calls.cleared).toEqual(['u1:box-1'])
    expect(idle.calls.asked).toEqual([])
  })

  test('nobody else can, and nothing is cleared', async () => {
    const other = deps()

    expect(await refusal(requestBoxCacheClear('t1', 'box-1', 'member', other.value))).toBe(
      'device_not_found',
    )
    expect(other.calls.cleared).toEqual([])
  })

  test('a person’s own computer is never cleared from afar', async () => {
    const laptop = deps({ device: async () => ({ userId: 'u1', deviceId: 'box-1', box: false }) })

    expect(await refusal(requestBoxCacheClear('t1', 'box-1', 'admin', laptop.value))).toBe(
      'device_not_found',
    )
    expect(laptop.calls.cleared).toEqual([])
  })

  test('a Box that is away is not started for it', async () => {
    const away = deps({ status: async () => undefined })

    expect(await refusal(requestBoxCacheClear('t1', 'box-1', 'admin', away.value))).toBe(
      'runtime_offline',
    )
    expect(away.calls.cleared).toEqual([])
  })

  test('a confirmed clear starts even while an agent is replying', async () => {
    const replying = deps({ busy: async () => true })

    expect(await requestBoxCacheClear('t1', 'box-1', 'admin', replying.value)).toEqual({ ok: true })
    expect(replying.calls.cleared).toEqual(['u1:box-1'])
  })

  test('run on a machine, the command empties the caches and keeps everything else', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'box-caches-'))
    const bin = path.join(home, 'bin')
    const file = (relative: string) => {
      const target = path.join(home, relative)

      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, 'x')

      return target
    }
    const caches = [
      '.cache/go-build/ab/cd',
      '.bun/install/cache/pkg/index.js',
      '.cache/pip/wheels/w',
      '.cache/uv/archive/a',
      '.local/share/pnpm/store/v10/files/00/aa',
      'go/pkg/mod/example.com/m@v1.0.0/go.mod',
    ].map(file)
    const kept = [
      '.cache/ms-playwright/browsers/chromium/chrome',
      '.nuphos/session-homes/abc/workspace/main.go',
      '.claude/.credentials.json',
      'go/bin/tool',
    ].map(file)

    // Go leaves its module cache read-only, directories included.
    chmodSync(caches[5] ?? '', 0o444)
    chmodSync(path.dirname(caches[5] ?? ''), 0o555)
    // No Docker here: the stand-in records what it was asked, and nothing else runs as root.
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\necho "$@" >> "$HOME/sudo.log"\n', {
      mode: 0o755,
    })
    execFileSync('/bin/sh', ['-c', BOX_CLEAR_CACHES_COMMAND], {
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    })

    expect(caches.filter(existsSync)).toEqual([])
    expect(kept.filter(existsSync)).toEqual(kept)
    expect(readFileSync(path.join(home, 'sudo.log'), 'utf8')).toBe('docker builder prune -f\n')
  })

  test('the command removes rebuildable caches only', () => {
    // Every path it deletes is one the runtime shares as a cache (session-home.mjs).
    const removed = [...BOX_CLEAR_CACHES_COMMAND.matchAll(/"\$HOME\/([^"]+)"/gu)].map((m) => m[1])

    expect(removed.toSorted(byName)).toEqual(
      [
        '.bun/install/cache',
        '.cache/go-build',
        '.cache/pip',
        '.cache/uv',
        '.local/share/pnpm/store',
        'go/pkg/mod',
        'go/pkg/mod',
      ].toSorted(byName),
    )
    // Docker gives up its build cache, never an image, a container or a volume.
    expect(BOX_CLEAR_CACHES_COMMAND).toContain('docker builder prune -f')
    expect(BOX_CLEAR_CACHES_COMMAND).not.toMatch(/system prune|image prune|volume|--all|-a\b/u)
  })
})
