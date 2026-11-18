// Loads viewer.html with the frames file, prints its RESULT, saves a screenshot.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs'); const path = require('path')
const [frames, shot] = process.argv.slice(-2)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1000, height: 700, webPreferences: { sandbox: false, preload: path.join(__dirname, 'preload.cjs'), additionalArguments: ['--frames=' + frames] } })
  win.webContents.on('console-message', (e) => console.log('[console]', e.level ?? '', e.message))
  ipcMain.on('done', async (_e, result) => {
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
    console.log('RESULT ' + JSON.stringify(result)); app.exit(result.painted ? 0 : 3)
  })
  setTimeout(() => { console.log('RESULT timeout'); app.exit(4) }, 30000)
  console.log('electron', process.versions.electron, 'chrome', process.versions.chrome, process.platform, process.arch)
  await win.loadFile(path.join(__dirname, 'viewer.html'))
})
