// Creating a Box: the row first, then the machine, its install and its join, in
// the background. The machine lives on the deployment's instabox account, or on
// one the team bound (`accountId`), which instabox bills instead.

import { randomUUID } from 'node:crypto'

import { Sandbox } from '@insforge/instabox-sdk'

import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { boxConnection, findInstaboxAccount } from './box-instabox-account'
import {
  AGENT_COMMAND,
  BOX_INSTALL_COMMAND,
  BOX_MOUNTS_COMMAND,
  BOX_TEMPLATE,
  CREATE_TIMEOUT_MS,
  INSTALL_TIMEOUT_MS,
  QUICK_TIMEOUT_MS,
  downloadEnv,
  killBoxMachine,
  requireBackendUrl,
} from './box-instabox-client'
import { boxSize } from './box-instabox-limit'
import { startBox } from './box-instabox-start'
import { noteBoxUsage } from './box-usage-history'
import { deleteDeviceJoinTokens, issueDeviceJoinToken } from './join-tokens'
import { waitForPresence } from './presence'
import { deleteAgentDevice, insertBoxAgentDevice, setAgentDeviceBoxSandbox } from './store'

import type { BoxAccountRef, BoxSize } from './box-instabox-account'
import type { AgentDevice, AgentDeviceBox } from './store'

/** The machine joins within this; a token left unused expires with it. */
const JOIN_TOKEN_TTL_SEC = 60 * 60
/** How long a fresh machine may take to join after its host was started. */
const JOIN_TIMEOUT_MS = 3 * 60_000

type Registration = { deviceId: string; label: string; box: AgentDeviceBox }

/**
 * Registers the device row at once and returns; ordering, installing and
 * joining run in the background. The row shows `creating` until the host joins.
 * If any step fails, the machine, the row and its token are removed again.
 * `shared` is whom it is shared with besides its creator, already limited to the team's members.
 */
export async function createBox(
  userId: string,
  teamId: string,
  label: string,
  {
    vcpus,
    shared,
    accountId,
  }: { vcpus?: number; shared?: { everyone: boolean; userIds: string[] }; accountId?: string } = {},
): Promise<AgentDevice> {
  const url = requireBackendUrl()

  if (accountId && !(await findInstaboxAccount(teamId, accountId)))
    throw new AppError(404, 'instabox_account_not_bound', 'No such instabox account in this team')
  const account: BoxAccountRef = { teamId, ...(accountId ? { accountId } : {}) }
  const size = await boxSize(vcpus, account)
  const deviceId = randomUUID()
  // vCPUs are recorded only where they count against the team's limit.
  const registration = {
    deviceId,
    label,
    platform: 'linux',
    allowLocalExec: true,
    box: {
      provider: 'instabox' as const,
      ...account,
      createdBy: userId,
      ...(accountId ? {} : { vcpus: size.vcpus }),
    },
  }

  const created = await startBox(account, { vcpus: size.vcpus }, () =>
    insertBoxAgentDevice(userId, registration, shared),
  )

  void order(userId, url, registration, size)

  return created
}

async function order(
  userId: string,
  url: string,
  { deviceId, label, box }: Registration,
  size: BoxSize,
): Promise<void> {
  let sandbox: Sandbox | undefined

  try {
    sandbox = await Sandbox.create(BOX_TEMPLATE, {
      ...(await boxConnection(box, CREATE_TIMEOUT_MS)),
      name: `nuphos-${deviceId.slice(0, 8)}`,
      metadata: { teamId: box.teamId, deviceId, createdBy: userId },
      vault: false,
      autoSuspendMs: 0, // stays on until paused; instabox's default pauses after 30 idle minutes
      ...size,
    })
    // Deleted while it was being ordered: the machine must not outlive the row.
    if (!(await setAgentDeviceBoxSandbox(userId, deviceId, sandbox.sandboxId)))
      throw new Error('The Box was deleted while it was being created')
    const { token } = await issueDeviceJoinToken(userId, {
      label,
      deviceId,
      expiresInSec: JOIN_TOKEN_TTL_SEC,
    })

    // The template comes from instabox's warm pool, so the install is the longest step.
    // It is one long exec request, so it runs on a connection without the per-request
    // cap: the exec request then waits as long as the command may run.
    await (
      await Sandbox.connect(sandbox.sandboxId, {
        ...(await boxConnection(box, INSTALL_TIMEOUT_MS)),
        requestTimeoutMs: undefined,
        resume: false,
      })
    ).commands.run(BOX_INSTALL_COMMAND, { envs: downloadEnv(), timeoutMs: INSTALL_TIMEOUT_MS })
    await sandbox.commands.run(AGENT_COMMAND, {
      envs: { ...downloadEnv(), NUPHOS_JOIN_TOKEN: token, NUPHOS_API_URL: url },
      background: true,
    })
    await sandbox.commands.run(BOX_MOUNTS_COMMAND, { background: true })
    // Setup is done when the machine is actually here, not when its commands returned.
    if (!(await waitForPresence(userId, deviceId, JOIN_TIMEOUT_MS)))
      throw new Error('The machine did not join within the time allowed')
    logEvent('info', 'agent.box.provisioned', { user_id: userId, device_id: deviceId })
  } catch (error) {
    logError('agent.box.provision_failed', error, { user_id: userId, device_id: deviceId })
    // Nothing half-made stays: no machine to bill, no row to confuse, no token to find.
    // A create that timed out on our side may still have produced a machine: it is
    // found by the device id in its metadata.
    await boxConnection(box, QUICK_TIMEOUT_MS)
      .then((conn) => killBoxMachine(conn, sandbox?.sandboxId, deviceId))
      .catch(() => {})
    await deleteDeviceJoinTokens(deviceId).catch(() => {})
    await deleteAgentDevice(userId, deviceId).catch(() => {})
    noteBoxUsage(box.teamId)
  }
}
