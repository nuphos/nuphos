import { z } from 'zod'

import { withLabel } from './labeling'
import { createLocalExecTool } from './local-tools'

import type { LocalExecDevice, LocalExecTurn, LocalExecToolResult } from './local-tools'

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
        'The user sees the same shell and can take over. The selected Desktop must be online; the conversation can be in the background. ' +
        'Use action=open, then the returned terminalId for read, write or interrupt. ' +
        'write sends literal terminal input; append "\\r" to submit a command. read returns bounded recent output, not proof a command completed. ' +
        'The shell persists between calls until the tab closes. Output may contain ANSI codes. ' +
        'Only agent-created terminals in this conversation are accessible. If the user takes over, open a new terminal. ' +
        'Default to local_exec for isolated commands needing a reliable exit code. Use local_terminal when an interactive or persistent shell, human takeover, or a visible terminal is needed. Follow the same local command authorization rules.',
      execute: async (input: {
        action: string
        terminalId?: string
        data?: string
        cwd?: string
        device?: string
      }) => {
        const { device, ...request } = input
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
