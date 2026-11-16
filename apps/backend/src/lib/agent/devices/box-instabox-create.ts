// Creating a Box: the row first, then the machine's order, then its boot, install and
// join in the background. The machine lives on the deployment's instabox account, or on
// one the team bound (`accountId`), which instabox bills instead.

import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

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
  orderRefused,
  requireBackendUrl,
} from './box-instabox-client'
import { boxSize } from './box-instabox-limit'
import { startBox } from './box-instabox-start'
import { noteBoxUsage } from './box-usage-history'
import { deleteDeviceJoinTokens, issueDeviceJoinToken } from './join-tokens'
import { waitForPresence } from './presence'
import { deleteAgentDevice, insertBoxAgentDevice, setAgentDeviceBoxSandbox } from './store'

import type { BoxAccountRef } from './box-instabox-account'
import type { AgentDevice, AgentDeviceBox } from './store'

/** The machine joins within this; a token left unused expires with it. */
const JOIN_TOKEN_TTL_SEC = 60 * 60
/** How long a fresh machine may take to join after its host was started. */
const JOIN_TIMEOUT_MS = 3 * 60_000
/** The longest a create waits for instabox to accept or refuse the order; well under every client's and proxy's timeout. */
const ANSWER_WAIT_MS = 10_000

type Registration = { deviceId: string; label: string; box: AgentDeviceBox }

/**
 * Registers the device row and orders the machine. instabox answers an order at once:
 * refused (the account's limit, a key it no longer takes), which fails this call with the
 * reason, or accepted. Only that answer is awaited, and at most ANSWER_WAIT_MS, so every
 * client and proxy gets a reply before its timeout and never retries into a second Box.
 * Booting, installing and joining run in the background; the row shows `creating` until
 * the host joins. If any step fails, the machine, the row and its token are removed again.
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

  const connection = await boxConnection(account, CREATE_TIMEOUT_MS)
  const created = await startBox(account, { vcpus: size.vcpus }, () =>
    insertBoxAgentDevice(userId, registration, shared),
  )
  let accept = () => {}
  const accepted = new Promise<void>((resolve) => {
    accept = resolve
  })
  const orderedAt = Date.now()
  const ordering = Sandbox.create(BOX_TEMPLATE, {
    ...connection,
    // The order's only POST: a 2xx means instabox accepted it.
    fetch: Object.assign(
      async (...[input, init]: Parameters<typeof fetch>) => {
        const response = await fetch(input, init)

        if (init?.method === 'POST' && response.ok) accept()

        return response
      },
      { preconnect: fetch.preconnect },
    ),
    name: `nuphos-${deviceId.slice(0, 8)}`,
    metadata: { teamId, deviceId, createdBy: userId },
    vault: false,
    ...size,
  })
  const settingUp = setUp(userId, url, registration, ordering, orderedAt)
  const refused = await Promise.race([
    accepted,
    ordering,
    sleep(ANSWER_WAIT_MS, undefined, { ref: false }),
  ]).then(
    () => null,
    (error: unknown) => ({ error }),
  )

  if (refused) {
    await settingUp // its cleanup: no row stays behind the error
    throw orderRefused(refused.error, Boolean(accountId))
  }

  return created
}

async function setUp(
  userId: string,
  url: string,
  registration: Registration,
  ordering: Promise<Sandbox>,
  orderedAt: number,
): Promise<void> {
  const { deviceId, label, box } = registration
  let sandbox: Sandbox | undefined
  let issued = false

  try {
    sandbox = await ordering
    logEvent('info', 'agent.box.ordered', {
      user_id: userId,
      device_id: deviceId,
      duration_ms: Date.now() - orderedAt,
    })
    // Deleted while it was being ordered: the machine must not outlive the row.
    if (!(await setAgentDeviceBoxSandbox(userId, deviceId, sandbox.sandboxId)))
      throw new AppError(409, 'box_gone', 'The Box was deleted while it was being created')
    await keepOn(userId, deviceId, sandbox)
    const { token } = await issueDeviceJoinToken(userId, {
      label,
      deviceId,
      expiresInSec: JOIN_TOKEN_TTL_SEC,
    })

    issued = true
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
    if (issued) await deleteDeviceJoinTokens(deviceId).catch(() => {})
    await discard(userId, registration, sandbox?.sandboxId, error)
  }
}

/**
 * Turns off instabox's idle pause (30 minutes by default), so the Box stays on until it is
 * paused. A plan that keeps the pause, as the free one does, refuses: the Box keeps it, and
 * a turn or a command wakes it again. Not part of making the Box, so a refusal only logs.
 */
async function keepOn(userId: string, deviceId: string, sandbox: Sandbox): Promise<void> {
  await sandbox.setAutoSuspend(0).catch((error: unknown) => {
    logError('agent.box.idle_pause_kept', error, { user_id: userId, device_id: deviceId })
  })
}

/** Nothing half-made stays: no machine to bill and no row to confuse. */
async function discard(
  userId: string,
  { deviceId, box }: Registration,
  sandboxId: string | undefined,
  error: unknown,
): Promise<void> {
  logError('agent.box.provision_failed', error, { user_id: userId, device_id: deviceId })
  // A create that timed out on our side may still have produced a machine: it is
  // found by the device id in its metadata.
  await boxConnection(box, QUICK_TIMEOUT_MS)
    .then((conn) => killBoxMachine(conn, sandboxId, deviceId))
    .catch(() => {})
  await deleteAgentDevice(userId, deviceId).catch(() => {})
  noteBoxUsage(box.teamId)
}
