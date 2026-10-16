import { z } from 'zod'

import { withLabel } from './labeling'
import { createLocalExecTool } from './local-tools'

import type { LocalExecDevice, LocalExecTurn, LocalExecToolResult } from './local-tools'

/** write always submits: any trailing line ending, real or escaped, becomes exactly one Enter. */
const lineEnding = /(?:[\r\n]|\\[rn])$/

function submitted(data: string): string {
  let input = data

  while (lineEnding.test(input)) input = input.replace(lineEnding, '')

  return `${input}\r`
}

/** Shares local_exec's device selection, ownership, membership and audit boundary. */
export function createLocalTerminalTool(devices: LocalExecDevice[], turn: LocalExecTurn): unknown {
  const exec = createLocalExecTool(devices, turn, 'terminal') as {
    execute: (input: {
      label: string
      command: string
      device?: string
    }) => Promise<LocalExecToolResult>
  }

  return withLabel(
    {
      description:
        'Open and operate a shared local terminal in the Desktop conversation dock. ' +
        'The user and agent can both send input to the same shell; human input does not disable agent input. The selected Desktop must be online; the conversation can be in the background. ' +
        'Use action=open, then the returned terminalId for read, write or interrupt. ' +
        'write types data and presses Enter once, so send the command alone. read returns bounded recent output, not proof a command completed. ' +
        'The shell persists between calls until the tab closes. Output may contain ANSI codes. ' +
        'Only agent-created terminals in this conversation are accessible. ' +
        'A request to open a terminal and run a command belongs here: NEVER emulate it by using local_exec to launch or drive an external terminal app. Follow the same local command authorization rules.',
      execute: async (input: {
        action: string
        terminalId?: string
        data?: string
        cwd?: string
        device?: string
      }) => {
        const { device, ...request } = input

        if (request.data !== undefined) request.data = submitted(request.data)
        const result = await exec.execute({
          label: 'Desktop terminal',
          device,
          command: JSON.stringify({ ...request, teamId: turn.teamId, sessionId: turn.sessionId }),
        })

        if ('error' in result) return result
        if (result.exitCode !== 0) return { error: result.stderr }

        return JSON.parse(result.stdout) as unknown
      },
    },
    {
      action: z.enum(['open', 'read', 'write', 'interrupt']),
      terminalId: z.string().min(1).max(200).optional(),
      data: z.string().max(65536).optional(),
      cwd: z.string().min(1).max(4096).optional(),
      device: z.string().optional(),
    },
  )
}
