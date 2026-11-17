// Run with Electron: electron scripts/browser-downloads-smoke.cjs
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { app, BrowserWindow, session } = require('electron')
const { guardBrowserDownloads } = require(
  process.argv[2] || '../electron/main/browser-downloads.ts',
)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-download-smoke-'))
app.setPath('userData', profile)
const server = http.createServer((request, response) => {
  if (request.url === '/file') {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="plan.docx"',
    })
    response.end('fixture')
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<html><body>fixture</body></html>')
  }
})
let window
const timer = setTimeout(() => {
  console.error('Timed out')
  app.exit(1)
}, 15000)
;(async () => {
  await app.whenReady()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const browserSession = session.fromPartition('download-smoke')
  const track = guardBrowserDownloads(browserSession)
  window = new BrowserWindow({ show: false, webPreferences: { session: browserSession } })
  track?.(window.webContents)
  let complete
  browserSession.on('will-download', (event) => {
    const blocked = event.defaultPrevented
    // Never open a save dialog or write a downloaded file in this test.
    event.preventDefault()
    complete(blocked)
  })
  await window.loadURL(`${base}/page`)
  const download = async (fromPage) => {
    const result = new Promise((resolve) => {
      complete = resolve
    })
    if (fromPage) await window.webContents.executeJavaScript("location.href='/file'")
    else await window.loadURL(`${base}/file`).catch(() => {})
    return result
  }
  assert.equal(await download(false), false, 'first programmatic download asks')
  assert.equal(window.webContents.getURL(), `${base}/page`, 'old page remains committed')
  assert.equal(await download(false), true, 'repeated automatic navigation is blocked')
  assert.equal(await download(true), false, 'page-initiated download is still available')
  assert.equal(await download(true), false, 'another page-initiated download is still available')
  console.log('PASS: automatic repeats blocked; explicit page downloads preserved')
})().then(
  () => finish(0),
  (error) => {
    console.error(error)
    finish(1)
  },
)
function finish(code) {
  clearTimeout(timer)
  window?.destroy()
  server.close()
  app.exit(code)
}
