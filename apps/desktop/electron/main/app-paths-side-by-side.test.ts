import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, mock, test } from 'node:test'

/** An appData where the installed product has been running with its legacy profile. */
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-app-paths-side-'))
const set = { names: [] as string[], paths: {} as Record<string, string> }

before(async () => {
  delete process.env.VITE_DEV_SERVER_URL
  fs.mkdirSync(path.join(appData, 'k8s-gui', 'Local Storage'), { recursive: true })

  mock.module('electron', {
    namedExports: {
      app: {
        // Packaged with `--config.extraMetadata.productName='Nuphos Preview'`.
        getName: () => 'Nuphos Preview',
        setName: (name: string) => {
          set.names.push(name)
        },
        setPath: (name: string, value: string) => {
          set.paths[name] = value
        },
        getPath: (name: string) => (name === 'appData' ? appData : (set.paths[name] ?? '')),
      },
    },
  })

  await import('./app-paths.ts')
})

after(() => {
  fs.rmSync(appData, { recursive: true, force: true })
})

test('a build packaged under another name runs as it, on a profile of its own', () => {
  assert.deepEqual(set.names, ['Nuphos Preview'])
  assert.equal(set.paths.userData, path.join(appData, 'Nuphos Preview'))
})
