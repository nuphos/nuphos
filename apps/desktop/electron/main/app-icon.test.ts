import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

const icons: string[] = []
let applyAppIcon: (icon: string) => void

before(async () => {
  mock.module('electron', {
    namedExports: {
      app: {
        getAppPath: () => '/Applications/Nuphos.app/Contents/Resources/app.asar',
        isPackaged: true,
        dock: { setIcon: (icon: string) => icons.push(icon) },
      },
    },
  })
  ;({ applyAppIcon } = await import('./app-icon.ts'))
})

// main.js is an ES module: a bare __dirname here threw at startup and no window opened.
test('sets the Dock icon from the packaged renderer files', () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  applyAppIcon('A')
  assert.deepEqual(icons, [
    '/Applications/Nuphos.app/Contents/Resources/app.asar/dist/app-icons/A.png',
  ])
})
