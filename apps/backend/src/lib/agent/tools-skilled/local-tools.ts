import { z } from 'zod'

import { recordDeviceExecAudit } from '../devices/audit'
import { dispatchLocalExec } from '../devices/dispatch'
import { isActiveTeamMember } from '../devices/store'

import { clientToolWithLabel, withLabel } from './labeling'

import type { DeviceExecAuditInput } from '../devices/audit'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'

export type LocalExecDevice = { deviceId: string; label: string }

export type LocalExecTurn = {
  /** The acting user; devices are looked up under this user, so it is also the device owner. */
  userId: string
  conversationOwnerUserId?: string
  teamId: string
  sessionId: string
  origin: AgentSessionOrigin
}

export type LocalExecToolResult =
  { stdout: string; stderr: string; exitCode: number; ranOn?: string } | { error: string }

/**
 * Client tools that still run in the Electron renderer via the classic
 * client-tool/decision-wait flow: port-forwards and attachment transfer.
 * `local_exec` is no longer one of these — see createLocalExecTool below.
 */
export function createLocalTools(localToolsEnabled: boolean): Record<string, unknown> {
  const localTools: Record<string, unknown> = {}

  if (!localToolsEnabled) return localTools

  // Port-forward bridge: routes to the desktop's typed @kubernetes/client-node
  // port-forward implementation (apps/desktop/electron/k8s.ts), so the forward
  // appears in the bottom-bar UI, runs on the user's machine (not the sandbox
  // pod), and is reachable as http://localhost:<localPort>.
  const portForwardTargetSchema = z.object({
    kind: z.enum(['service', 'pod']).describe('Resource kind to forward'),
    name: z.string().describe('Resource name'),
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .describe('Service port or pod containerPort to forward'),
  })

  localTools.port_forward_start = clientToolWithLabel(
    "Forward a Kubernetes service/pod port to a port on the user's local machine via the Nuphos desktop port-forwarder. " +
      'ALWAYS prefer this over `kubectl port-forward` (either via `bash` in the sandbox, or via `local_exec`). Reasons: ' +
      '(1) the forward appears in the desktop UI so the user can see / stop it; ' +
      "(2) a forward opened inside the sandbox pod is unreachable from the user's machine — only this tool runs on their machine; " +
      '(3) on failure you get a structured error, not a kubectl stderr to parse. ' +
      'Returns { ok: true, info: { id, context, namespace, podName, targetPort, localPort, startedAt } }. ' +
      'Tell the user `http://localhost:<localPort>` and mention they can stop it from the bottom bar.',
    {
      context: z
        .string()
        .describe(
          "kubeconfig context name. If you don't know which context, the current conversation is bound to one — ask the user or look at the conversation context.",
        ),
      namespace: z.string().describe('Kubernetes namespace'),
      target: portForwardTargetSchema,
      localPort: z
        .number()
        .int()
        .min(0)
        .max(65535)
        .optional()
        .describe(
          'Preferred local port. Omit or pass 0 to let the OS pick a free port (recommended).',
        ),
    },
  )

  localTools.port_forward_stop = clientToolWithLabel(
    'Stop a port-forward previously opened by port_forward_start (or a forward the user opened from the UI). ' +
      "Pass the `id` from port_forward_start's `info.id` or from port_forward_list. " +
      "No re-approval prompt — uses the session's already-granted local-action permission.",
    {
      id: z
        .string()
        .describe('The port-forward id returned by port_forward_start / port_forward_list'),
    },
  )

  localTools.upload_attachment = clientToolWithLabel(
    'Transfer a file the user attached to the conversation into the Nuphos file-transfer store so you can pull it into the sandbox. ' +
      'Attached images are shown to you as vision (you can see them), but their bytes are NOT in the sandbox. ' +
      'When the user wants the actual file moved or saved — e.g. `kubectl cp` an attached image into a pod, or write it to disk — call this with the `attachmentId` from the "[Attached image …]" note in the message to get a transfer groupId, then pull it: ' +
      'bash skills/file-transfer/scripts/transfer-pull.sh "$TEAM" <groupId> ./uploads. ' +
      'Returns { ok: true, groupId, fileName }. No re-approval prompt — the user already attached the file, so transferring it is implied consent.',
    {
      attachmentId: z
        .string()
        .describe('The attachmentId from the "[Attached image …]" note in the user message'),
    },
  )

  localTools.port_forward_list = clientToolWithLabel(
    "List active port-forwards on the user's machine. Returns every forward the desktop is currently running, " +
      'whether opened by you (via port_forward_start) or by the user from the UI. ' +
      'Useful before opening a new one (avoid duplicates) or when the user asks you to stop "the one you just made".',
    {},
  )

  return localTools
}

/** The requested device when available, else the only available one. */
function pickDevice(devices: LocalExecDevice[], requested: string | undefined): string | undefined {
  if (requested && devices.some((d) => d.deviceId === requested)) return requested

  return devices.length === 1 ? devices[0]?.deviceId : undefined
}

function describeDevices(devices: LocalExecDevice[]): string {
  return devices.map((d) => `${d.deviceId} (${d.label})`).join(', ')
}

/**
 * `local_exec` runs on the backend: it dispatches the command to a Desktop
 * device over its existing WebSocket tunnel and receives the result on that
 * same stream, rather than blocking the whole turn on a client-tool
 * decision wait. `devices` is the set already selected for this conversation
 * AND currently online AND opted in — resolved fresh per turn by the caller.
 */
export function createLocalExecTool(
  devices: LocalExecDevice[],
  turn: LocalExecTurn,
  purpose: 'exec' | 'terminal' = 'exec',
): unknown {
  const audit = (
    deviceId: string,
    command: string,
    requestedAt: Date,
    rest: Pick<DeviceExecAuditInput, 'outcome' | 'dispatchedAt' | 'exitCode' | 'reason'>,
  ) =>
    recordDeviceExecAudit({
      ownerUserId: turn.userId,
      deviceId,
      actorUserId: turn.userId,
      conversationOwnerUserId: turn.conversationOwnerUserId ?? turn.userId,
      origin: turn.origin,
      teamId: turn.teamId,
      sessionId: turn.sessionId,
      command,
      requestedAt,
      finishedAt: new Date(),
      ...rest,
    })

  return withLabel(
    {
      description:
        "Execute a shell command on one of the user's local devices (their own Desktop machines that allow local exec and are currently online; only in their own conversations). " +
        "You CAN operate on the user's local files and apps with this — listing, reading, moving, or deleting their files when asked. Never claim you cannot touch the local machine while this tool is available. " +
        'Default to this for isolated local commands with a result and exit code: npm, docker, git, make, cargo, gcloud, aws, etc. Use local_terminal when an interactive or persistent shell, shared input, or a visible terminal is needed. ' +
        "For cloud operations, use sandbox bash when Nuphos-managed credentials work; use local_exec when the fix requires the user's locally authenticated cloud CLI, including scoped connector permission changes on a device already signed in to the matching CLI with administration access. Verify the local cloud account and identity first. " +
        "IMPORTANT: do NOT use this to run `kubectl port-forward`. Use the typed `port_forward_start` tool instead — `kubectl port-forward` via shell leaves no UI state, the user can't see or stop the forward, and a forward opened inside the sandbox is unreachable from the user's machine.",
      execute: async ({
        command,
        device,
      }: {
        command: string
        device?: string
      }): Promise<LocalExecToolResult> => {
        const requestedAt = new Date()

        if (turn.conversationOwnerUserId && turn.conversationOwnerUserId !== turn.userId) {
          const target = device ?? devices[0]?.deviceId

          if (target)
            await audit(target, command, requestedAt, {
              outcome: 'rejected',
              reason: 'not_own_conversation',
            })

          return { error: 'Local exec only runs in your own conversations.' }
        }
        if (devices.length === 0) {
          return {
            error:
              "No local devices are available for this conversation. Ask the user to select their device in this conversation's credential selector (the shield button in the composer); they must have Nuphos Desktop open and signed in on that device.",
          }
        }
        const deviceId =
          purpose === 'terminal' && device && !devices.some((d) => d.deviceId === device)
            ? undefined
            : pickDevice(devices, device)

        if (!deviceId) {
          const choices = `pass device=<deviceId>, one of: ${describeDevices(devices)}.`

          if (!device) return { error: `Multiple devices are available; ${choices}` }
          await audit(device, command, requestedAt, {
            outcome: 'rejected',
            reason: 'device_unavailable',
          })

          return { error: `Device ${device} is not available; ${choices}` }
        }
        if (!(await isActiveTeamMember(turn.userId, turn.teamId))) {
          await audit(deviceId, command, requestedAt, {
            outcome: 'rejected',
            reason: 'not_team_member',
          })

          return { error: 'You are no longer a member of this team.' }
        }
        const dispatchedAt = new Date()
        let outcome: Awaited<ReturnType<typeof dispatchLocalExec>>

        try {
          outcome = await dispatchLocalExec(turn.userId, deviceId, command, {
            teamId: turn.teamId,
            ...(purpose === 'terminal' ? { purpose } : {}),
          })
        } catch (err) {
          await audit(deviceId, command, requestedAt, {
            outcome: 'error',
            dispatchedAt,
            reason: 'dispatch_failed',
          })
          throw err
        }

        if (outcome.status === 'ok') {
          await audit(deviceId, command, requestedAt, {
            outcome: 'ok',
            dispatchedAt,
            exitCode: outcome.result.exitCode,
          })

          return device && device !== deviceId
            ? { ...outcome.result, ranOn: describeDevices(devices) }
            : outcome.result
        }
        if (outcome.status === 'device_disconnected') {
          await audit(deviceId, command, requestedAt, { outcome: 'device_offline', dispatchedAt })

          return { error: 'Device disconnected while the command was running.' }
        }
        await audit(deviceId, command, requestedAt, { outcome: 'timeout', dispatchedAt })

        return { error: 'Timed out waiting for the device to run the command.' }
      },
    },
    {
      command: z.string().describe('Shell command to run on the local device'),
      device: z
        .string()
        .optional()
        .describe(
          'deviceId to run on. Omit it when only one device is available; otherwise the error lists the current device ids.',
        ),
    },
  )
}
