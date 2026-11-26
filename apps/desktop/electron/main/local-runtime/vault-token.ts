import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

/** The vault item a computer's Claude Code signs in with (nuphos/nuphos#5187). */
export const CLAUDE_TOKEN_ITEM = 'claude-code-oauth-token'

/**
 * Hands the Claude Code adapter the setup token its owner shared with this computer, read
 * afresh for each session, so unsharing it stops new ones. The vault key stays with this
 * host; the adapter reaches this one item only, over a socket in a 0700 directory (on
 * Windows a pipe with a random name), and only with the key in its environment.
 */
export function serveVaultToken(read: () => Promise<string | null>): Record<string, string> {
  const key = randomBytes(32).toString('hex')
  const dir =
    process.platform === 'win32' ? null : mkdtempSync(path.join(os.tmpdir(), 'nuphos-vault-'))
  const pipe = dir
    ? path.join(dir, 'token.sock')
    : `\\\\.\\pipe\\nuphos-vault-${randomBytes(16).toString('hex')}`
  const server = net.createServer((socket) => {
    socket.on('error', () => socket.destroy())
    socket.setTimeout(10_000, () => socket.destroy())
    socket.once('data', (chunk: Buffer) => {
      if (chunk.length !== key.length || !timingSafeEqual(chunk, Buffer.from(key))) {
        socket.destroy()

        return
      }
      void read()
        .catch(() => null)
        .then((token) => socket.end(token ?? ''))
    })
  })

  server.on('error', () => {
    /* Without it the adapter finds no token, as before. */
  })
  server.listen(pipe)
  server.unref()
  if (dir) process.once('exit', () => rmSync(dir, { recursive: true, force: true }))

  return { NUPHOS_VAULT_SOCKET: pipe, NUPHOS_VAULT_KEY: key }
}

/** A computer `nuphos agent` runs opens the item with its own key, through its CLI. */
export const cliVaultToken = (cli: string) => async () =>
  (
    await promisify(execFile)(cli, ['vault', 'get', CLAUDE_TOKEN_ITEM, '--computer'], {
      encoding: 'utf8',
      timeout: 5000,
    })
  ).stdout.trim() || null

/** `nuphos agent`'s environment for its agents: its own, and where to ask for the token. */
export function agentHostEnv(): () => Promise<NodeJS.ProcessEnv> {
  const vault = serveVaultToken(cliVaultToken(process.env.NUPHOS_CLI_EXE ?? 'nuphos'))

  return () => Promise.resolve({ ...process.env, ...vault })
}
