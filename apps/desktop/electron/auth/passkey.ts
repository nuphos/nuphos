import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { shell } from 'electron'

import { WEB_BASE_URL } from '../web-base-url.ts'

import { listenOnLoopback, LOGIN_TIMEOUT_MS, onCallback } from './callback-server.ts'
import { PASSKEY_DONE_HTML } from './pages.ts'

/**
 * Runs a passkey ceremony in the system browser. Passkeys belong to nuphos.ai,
 * which this app cannot claim as its relying party, so nuphos.ai/passkey runs
 * `navigator.credentials` with the backend's options and sends the answer back
 * to a loopback listener here. The answer is only good for the challenge in
 * `options`, on this app's own request to the backend.
 */
export async function runPasskeyCeremony(
  mode: 'get' | 'create',
  options: unknown,
): Promise<unknown> {
  const server = createServer()
  const port = await listenOnLoopback(server)
  const state = randomBytes(16).toString('base64url')

  try {
    const answer = new Promise<unknown>((resolve, reject) => {
      onCallback(server, state, (hit) => {
        const credential = hit.params.get('credential')

        hit.respond(200, PASSKEY_DONE_HTML)
        if (!credential) {
          reject(new Error('The passkey request was cancelled.'))

          return
        }
        try {
          resolve(JSON.parse(Buffer.from(credential, 'base64url').toString('utf8')))
        } catch {
          reject(new Error('The passkey answer could not be read.'))
        }
      })
    })
    const page = new URL('/passkey', WEB_BASE_URL)

    page.hash = new URLSearchParams({
      mode,
      options: Buffer.from(JSON.stringify(options)).toString('base64url'),
      redirect: `http://127.0.0.1:${String(port)}/callback`,
      state,
    }).toString()
    await shell.openExternal(page.toString())

    return await Promise.race([
      answer,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('The passkey request timed out.')),
          LOGIN_TIMEOUT_MS,
        ).unref(),
      ),
    ])
  } finally {
    server.close()
  }
}
