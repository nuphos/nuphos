import { randomUUID } from 'node:crypto'

import { BrowserWindow } from 'electron'

import { localTerminals } from '../local-terminal.ts'
import { LocalExecStream } from '../main/local-runtime/exec-stream.ts'

import type { WebContents } from 'electron'

type OpenRequest = { id: string; teamId: string; sessionId: string }
const pending = new Map<
  string,
  {
    request: OpenRequest
    cwd?: string
    executionId: string
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }
>()

export function acceptDockTerminal(owner: WebContents, id: string): boolean {
  const entry = pending.get(id)

  if (!entry) return false
  pending.delete(id)
  try {
    localTerminals.start(
      owner,
      id,
      80,
      24,
      entry.cwd,
      JSON.stringify([entry.request.teamId, entry.request.sessionId]),
    )
    entry.resolve({ terminalId: id })

    return true
  } catch (error) {
    entry.reject(error instanceof Error ? error : new Error(String(error)))

    return false
  }
}

export function abortDockTerminal(executionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.executionId !== executionId) continue
    pending.delete(id)
    entry.reject(new Error('Terminal request was canceled.'))
  }
}

export async function runDockTerminal(raw: string, options: { sessionId?: string } = {}) {
  try {
    if (!options.sessionId) throw new Error('Missing terminal request identity.')
    const executionId = options.sessionId
    const request = JSON.parse(raw) as {
      action: string
      teamId: string
      sessionId: string
      terminalId?: string
      data?: string
      cwd?: string
    }

    if (!request.teamId || !request.sessionId) throw new Error('Missing terminal conversation.')
    const scope = JSON.stringify([request.teamId, request.sessionId])
    let result: unknown

    if (request.action === 'open') {
      const id = `tab-${randomUUID()}`

      result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(
            new Error(
              'The selected Desktop did not accept the terminal request. Ensure it is open and signed in.',
            ),
          )
        }, 5_000)

        pending.set(id, {
          executionId,
          request: { id, teamId: request.teamId, sessionId: request.sessionId },
          cwd: request.cwd,
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('local-terminal:open-dock', {
            id,
            teamId: request.teamId,
            sessionId: request.sessionId,
          })
        }
      })
    } else {
      if (!request.terminalId) throw new Error('Missing terminalId.')
      if (!['read', 'write', 'interrupt'].includes(request.action))
        throw new Error('Invalid terminal action.')
      if (request.action === 'write' && typeof request.data !== 'string')
        throw new Error('Missing terminal input.')
      result = localTerminals.agentRequest(
        request.terminalId,
        scope,
        request.action === 'interrupt'
          ? '\x03'
          : request.action === 'write'
            ? request.data
            : undefined,
      )
    }

    return { stdout: JSON.stringify(result), stderr: '', exitCode: 0 }
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    }
  }
}

export const createDockTerminalStream = () =>
  new LocalExecStream({
    runLocalCommand: runDockTerminal,
    abortClientTools: abortDockTerminal,
  })
