import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const moduleUrl = new URL('./dev-launcher-watchdog.ts', import.meta.url).href
const configUrl = new URL('../config/core.ts', import.meta.url).href

test('a killed launcher stops its backend watcher, including after hot-reload replacement', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nuphos-launcher-watchdog-'))
  const launcher = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
    cwd,
    env: {},
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const backend = Bun.spawn(
    [
      process.execPath,
      '-e',
      `import {watchDevLauncher} from ${JSON.stringify(moduleUrl)};
       import {coreConfig} from ${JSON.stringify(configUrl)};
       watchDevLauncher(coreConfig().devLauncherPid, () => process.exit(2));
       watchDevLauncher(coreConfig().devLauncherPid, () => process.exit(0));
       console.log('ready');
       setInterval(() => {}, 1000);`,
    ],
    {
      cwd,
      env: {
        NODE_ENV: 'development',
        NUPHOS_DEV_LAUNCHER_PID: String(launcher.pid),
        MONGODB_URI: 'mongodb://localhost/watchdog-test',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const timeout = setTimeout(() => backend.kill('SIGKILL'), 5_000)

  try {
    const reader = backend.stdout.getReader()
    const ready = await reader.read()

    expect(new TextDecoder().decode(ready.value)).toContain('ready')
    expect(backend.exitCode).toBeNull()
    launcher.kill('SIGKILL')
    await launcher.exited
    expect(await backend.exited).toBe(0)
    reader.releaseLock()
  } finally {
    clearTimeout(timeout)
    launcher.kill('SIGKILL')
    backend.kill('SIGKILL')
    await Promise.all([launcher.exited, backend.exited])
    await rm(cwd, { recursive: true, force: true })
  }
})

test('standalone and production backends do not follow a development launcher', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nuphos-launcher-disabled-'))

  try {
    await Promise.all(
      [
        { NODE_ENV: 'production', NUPHOS_DEV_LAUNCHER_PID: '999999' },
        { NODE_ENV: 'development', NUPHOS_DEV_LAUNCHER_PID: '' },
        { NODE_ENV: 'development', NUPHOS_DEV_LAUNCHER_PID: '-1' },
      ].map(async (env) => {
        const child = Bun.spawn(
          [
            process.execPath,
            '-e',
            `import {watchDevLauncher} from ${JSON.stringify(moduleUrl)};
             import {coreConfig} from ${JSON.stringify(configUrl)};
             watchDevLauncher(coreConfig().devLauncherPid, () => process.exit(2));
             setTimeout(() => process.exit(0), 1200);`,
          ],
          {
            cwd,
            env: { ...env, MONGODB_URI: 'mongodb://localhost/watchdog-test' },
            stdout: 'ignore',
            stderr: 'pipe',
          },
        )

        expect(await child.exited).toBe(0)
      }),
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
