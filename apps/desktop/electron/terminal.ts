import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { WebContents } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export type SshAccessDetails = {
  username: string
  ipAddress: string
  privateKey: string
  certKey: string | null
  expiresAt: string | null
}

type SshTerminalEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { id: string; type: 'error'; message: string }

type SshSession = {
  id: string
  child: ChildProcessWithoutNullStreams
  keyDir: string
  events: SshTerminalEvent[]
  cleanupStarted: boolean
}

const sessions = new Map<string, SshSession>()

function normalizePrivateKey(privateKey: string): string {
  return privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`
}

function send(target: WebContents, session: SshSession, payload: SshTerminalEvent) {
  const event = { ...payload }

  session.events.push(event)
  if (session.events.length > 200) session.events.shift()
  if (!target.isDestroyed()) target.send('ssh-terminal:event', event)
}

async function cleanup(session: SshSession) {
  if (session.cleanupStarted) return
  session.cleanupStarted = true
  await fs.rm(session.keyDir, { recursive: true, force: true }).catch(() => undefined)
}

function expireSession(id: string): void {
  setTimeout(() => {
    sessions.delete(id)
  }, 5 * 60_000).unref()
}

function assertTcpReachable(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }

    socket.setTimeout(timeoutMs, () => {
      finish(
        new Error(
          `Cannot reach SSH endpoint ${host}:${String(port)} within ${String(Math.round(timeoutMs / 1000))}s. Check the instance state, security group / firewall rule for port 22, and that sshd is running.`,
        ),
      )
    })
    socket.on('connect', () => finish())
    socket.on('error', (error) => {
      finish(new Error(`Cannot reach SSH endpoint ${host}:${String(port)}: ${error.message}`))
    })
  })
}

export async function startSshSession(
  target: WebContents,
  access: SshAccessDetails,
): Promise<{ id: string }> {
  await assertTcpReachable(access.ipAddress, 22, 8_000)

  const id = randomUUID()
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-ssh-'))

  try {
    const keyPath = path.join(keyDir, 'key.pem')

    await fs.writeFile(keyPath, normalizePrivateKey(access.privateKey), { mode: 0o600 })
    if (access.certKey) {
      await fs.writeFile(`${keyPath}-cert.pub`, normalizePrivateKey(access.certKey), {
        mode: 0o600,
      })
    }

    const knownHostsDir = path.join(os.homedir(), '.config', 'nuphos')

    await fs.mkdir(knownHostsDir, { recursive: true })
    const knownHostsPath = path.join(knownHostsDir, 'atlas_known_hosts')

    const child = spawn(
      '/usr/bin/ssh',
      [
        '-tt',
        '-o',
        'ConnectTimeout=12',
        '-o',
        'ConnectionAttempts=1',
        '-o',
        'BatchMode=yes',
        '-o',
        'NumberOfPasswordPrompts=0',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        `UserKnownHostsFile=${knownHostsPath}`,
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'ServerAliveInterval=30',
        '-i',
        keyPath,
        `${access.username}@${access.ipAddress}`,
      ],
      {
        stdio: 'pipe',
        env: { ...process.env, TERM: 'xterm-256color' },
      },
    )

    const session: SshSession = { id, child, keyDir, events: [], cleanupStarted: false }

    sessions.set(id, session)

    send(target, session, {
      id,
      type: 'data',
      data: `Opening SSH to ${access.username}@${access.ipAddress}:22...\r\n`,
    })
    child.stdout.on('data', (chunk: Buffer) =>
      send(target, session, { id, type: 'data', data: chunk.toString('utf8') }),
    )
    child.stderr.on('data', (chunk: Buffer) =>
      send(target, session, { id, type: 'data', data: chunk.toString('utf8') }),
    )
    child.on('error', (error) => {
      send(target, session, { id, type: 'error', message: error.message })
      void cleanup(session).finally(() => expireSession(id))
    })
    child.on('exit', (code, signal) => {
      send(target, session, { id, type: 'exit', code, signal })
      void cleanup(session).finally(() => expireSession(id))
    })

    return { id }
  } catch (error) {
    await fs.rm(keyDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export function writeSshSession(id: string, data: string): void {
  const session = sessions.get(id)

  if (!session || session.child.stdin.destroyed) return
  session.child.stdin.write(data)
}

export function closeSshSession(id: string): void {
  const session = sessions.get(id)

  if (!session) return
  session.child.kill('SIGTERM')
  setTimeout(() => {
    if (!session.child.killed) session.child.kill('SIGKILL')
  }, 2_000).unref()
  void cleanup(session).finally(() => sessions.delete(id))
}

export function replaySshSession(target: WebContents, id: string): void {
  const session = sessions.get(id)

  if (!session) return
  for (const event of session.events.slice()) {
    if (!target.isDestroyed()) target.send('ssh-terminal:event', { ...event })
  }
}

export function closeAllSshSessions(): void {
  for (const id of sessions.keys()) closeSshSession(id)
}
