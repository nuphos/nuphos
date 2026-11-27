import { execFile } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type { AgentInstanceRecord } from './agent-instances.ts'

/** The vault item a computer's Claude Code signs in with (nuphos/nuphos#5187). */
export const CLAUDE_TOKEN_ITEM = 'claude-code-oauth-token'

/**
 * Hands the Claude Code adapter the setup token an owner shared with this computer, read
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

/** One owner's Claude Code token shared with this computer: who they are, and how to read it now. */
export type VaultToken = { owner: string; name: string; read: () => Promise<string | null> }

/** The added agent a shared token backs: one per owner, with the same id on every start. */
export function vaultInstance({ owner, name }: VaultToken): AgentInstanceRecord {
  const hex = createHash('sha256').update(`${CLAUDE_TOKEN_ITEM}:${owner}`).digest('hex')
  const instanceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`

  return {
    instanceId,
    provider: 'claude-code',
    label: name ? `Claude Code (${name.slice(0, 64)}'s token)` : 'Claude Code (Vault token)',
    state: 'ready',
  }
}

/** A computer `nuphos agent` runs opens an owner's item with the key it keeps for them. */
export const cliVaultToken = (cli: string, owner: string) => async () =>
  (
    await promisify(execFile)(
      cli,
      ['vault', 'get', CLAUDE_TOKEN_ITEM, '--computer', '--user', owner],
      { encoding: 'utf8', timeout: 5000 },
    )
  ).stdout.trim() || null

/** `nuphos agent`'s deps for its agents: its own environment, and the tokens shared with it. */
export function agentHostDeps(computer: { apiUrl: string; credential: string } | null) {
  const cli = process.env.NUPHOS_CLI_EXE ?? 'nuphos'

  return {
    userEnv: () => Promise.resolve(process.env),
    vaultTokens: computer ? computerVaultTokens(computer, cli) : undefined,
  }
}

/** Everyone who shares the token with this computer; null when the backend could not say. */
export const computerVaultTokens =
  (computer: { apiUrl: string; credential: string }, cli: string) =>
  async (): Promise<VaultToken[] | null> => {
    const response = await fetch(
      `${computer.apiUrl}/vault/computer/items?name=${CLAUDE_TOKEN_ITEM}`,
      {
        headers: { authorization: `Bearer ${computer.credential}` },
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null)

    if (!response?.ok) return null
    const { owners } = (await response.json()) as { owners: { userId: string; name: string }[] }

    return owners.map(({ userId, name }) => ({
      owner: userId,
      name,
      read: cliVaultToken(cli, userId),
    }))
  }
