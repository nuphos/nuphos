import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, mock, test } from 'node:test'

import { APP_NAME } from './env.ts'

/** A throwaway appData directory holding a profile under each name. */
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-app-paths-'))
const set = { names: [] as string[], paths: {} as Record<string, string> }
const logged: string[] = []
const real = { log: console.log, warn: console.warn }

let userDataDir: string

/** A profile the way Chromium leaves one behind. */
function writeProfile(name: string): void {
  fs.mkdirSync(path.join(appData, name, 'Local Storage', 'leveldb'), { recursive: true })
  fs.writeFileSync(path.join(appData, name, 'Local Storage', 'leveldb', 'CURRENT'), '')
}

before(async () => {
  // This test is the packaged build, whatever the shell running it has set.
  delete process.env.VITE_DEV_SERVER_URL

  // An install that has been running since before the rename, with a profile at each name.
  writeProfile('k8s-gui')
  writeProfile(APP_NAME)

  mock.module('electron', {
    namedExports: {
      app: {
        setName: (name: string) => {
          set.names.push(name)
        },
        setPath: (name: string, value: string) => {
          set.paths[name] = value
        },
        // What every other module sees when it asks, before and after `setPath`.
        getPath: (name: string) => (name === 'appData' ? appData : (set.paths[name] ?? '')),
      },
    },
  })

  console.log = (...args: unknown[]) => {
    logged.push(args.join(' '))
  }
  console.warn = (...args: unknown[]) => {
    logged.push(args.join(' '))
  }

  ;({ userDataDir } = await import('./app-paths.ts'))
})

after(() => {
  console.log = real.log
  console.warn = real.warn
  fs.rmSync(appData, { recursive: true, force: true })
})

test('a packaged build names the app and points userData at the profile it found', () => {
  assert.deepEqual(set.names, [APP_NAME])
  assert.equal(set.paths.userData, path.join(appData, 'k8s-gui'))
  assert.equal(userDataDir, path.join(appData, 'k8s-gui'))
  // What a module reading the path for itself gets.
  assert.equal(set.paths.userData, userDataDir)
})

test('it says which directory it uses, and that it left the other one alone', () => {
  assert.equal(logged.length, 1)
  assert.match(logged[0] ?? '', /using .*k8s-gui/)
  assert.match(logged[0] ?? '', new RegExp(APP_NAME))
})

test('main.ts imports app-paths before any other module', () => {
  // Nothing behavioral can catch this. The modules that read userData do it while they
  // load, before main.ts runs a line of its own, so a reordered import silently hands them
  // Electron's default directory instead of the one chosen here.
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main.ts'), 'utf8')
  const firstImport = main.split('\n').find((line) => line.startsWith('import '))

  assert.match(firstImport ?? '', /from '\.\/main\/app-paths'/)
})
