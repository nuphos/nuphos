import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { boxJoinToken } from '../atlas/boxes.ts'

import {
  sshBinary,
  sshConfigHosts,
  sshJoinArgs,
  sshJoinDevice,
  sshJoinProblem,
  sshJoinScript,
} from './ssh-join-core.ts'

import type { SshHost, SshJoinResult } from '../../src/api/device-types.ts'
import type { WebContents } from 'electron'
import type { ChildProcess } from 'node:child_process'

const running = new Map<string, ChildProcess>()

/** The user's own ~/.ssh/config hosts. Read here and only shown in the app; never sent anywhere. */
export function sshHosts(): SshHost[] {
  const home = homedir()

  return sshConfigHosts(join(home, '.ssh', 'config'), {
    home,
    read: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },
    list: (dir) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    },
  })
}

/**
 * Sets up a machine as one of the user's computers through their own `ssh`: its config, keys and
 * agent, never a prompt. ssh's output streams to the window as `ssh-join:output`.
 */
export async function sshJoin(
  contents: WebContents,
  id: string,
  target: string,
): Promise<SshJoinResult> {
  const args = sshJoinArgs(target)

  if (!args) throw new TypeError('Expected an SSH host')
  // A fresh one-time token for each try: a failed try may have used its token.
  const script = sshJoinScript(await boxJoinToken())

  return new Promise((resolve) => {
    const child = spawn(sshBinary(process.platform, process.env.SystemRoot), args, {
      windowsHide: true,
    })
    const send = (text: string) => {
      if (!contents.isDestroyed()) contents.send('ssh-join:output', id, text)
    }
    let stdout = ''
    let stderr = ''

    running.set(id, child)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += String(chunk)
      send(String(chunk))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += String(chunk)
      send(String(chunk))
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      running.delete(id)
      resolve({ ok: false, problem: error.code === 'ENOENT' ? 'no-ssh' : 'failed' })
    })
    child.on('close', (code) => {
      running.delete(id)
      resolve(
        code === 0
          ? { ok: true, deviceId: sshJoinDevice(stdout) }
          : { ok: false, problem: sshJoinProblem(code, stderr) },
      )
    })
    // ssh that ends before reading the script closes stdin; its exit says why.
    child.stdin.on('error', () => {
      // ignored: the exit code reports the failure
    })
    child.stdin.end(script)
  })
}

export function sshJoinCancel(id: string) {
  running.get(id)?.kill()
}
