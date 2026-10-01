import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { protocol } from 'electron'

import { isDev } from './env'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
}

export function registerAppProtocolHandler() {
  if (!isDev) {
    const distRoot = path.join(__dirname, '..', 'dist')

    protocol.handle('app', async (req) => {
      try {
        const url = new URL(req.url)
        const reqPath = url.pathname === '/' ? '/index.html' : url.pathname
        const target = path.normalize(path.join(distRoot, reqPath))

        if (!target.startsWith(distRoot)) {
          return new Response('forbidden', { status: 403 })
        }
        const data = await fs.readFile(target)
        const ext = path.extname(target).toLowerCase()

        return new Response(data, {
          headers: { 'content-type': MIME[ext] || 'application/octet-stream' },
        })
      } catch (e) {
        console.error('[protocol]', req.url, e)

        return new Response(`not found: ${req.url}`, { status: 404 })
      }
    })
  }
}
