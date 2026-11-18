const { contextBridge, ipcRenderer } = require('electron')
const fs = require('fs')
const file = process.argv.find((a) => a.startsWith('--frames=')).slice(9)
contextBridge.exposeInMainWorld('replay', { prefer: process.env.PREFER || '', frames: () => new Uint8Array(fs.readFileSync(file)), done: (r) => ipcRenderer.send('done', r) })
