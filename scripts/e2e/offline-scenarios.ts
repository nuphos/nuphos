// Scenarios about a conversation whose computer is offline, almost out of disk, or out of date.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { newTask, pickInSubmenu, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const LAPTOP = 'E2E laptop'

const GIB = 1024 ** 3

// A computer of this person's with a signed-in Claude Code, online until the returned function
// is called. `diskPercent` sets its disk readings, `client` the app it connects as, `app` the
// Desktop and update it reports; with `restoreFails` it fails every request after `initialize`.
async function laptopOnline(
  stack: Stack,
  {
    diskPercent,
    client,
    app,
    restoreFails,
  }: { diskPercent?: number; client?: string; app?: unknown; restoreFails?: boolean } = {},
): Promise<() => void> {
  const authorization = `Bearer ${stack.token}`
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'e2e-laptop',
      label: LAPTOP,
      platform: 'darwin',
      allowLocalExec: true,
    }),
  })

  if (!registered.ok) throw new Error(`Registering the laptop answered ${registered.status}`)
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/e2e-laptop/runtime-tunnel`,
    {
      headers: { authorization, ...(client ? { 'x-atlas-client': client } : {}) },
    } as unknown as string[],
  )

  tunnel.addEventListener('message', (event: MessageEvent) => {
    tunnel.send(JSON.stringify({ t: 'pong' }))
    if (restoreFails) answerAsOldRuntime(tunnel, String(event.data))
  })
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: {
        localMetrics: diskPercent !== undefined,
        agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
        ...(app ? { app } : {}),
      },
    }),
  )
  if (diskPercent === undefined) return () => tunnel.close()
  const report = () =>
    tunnel.send(
      JSON.stringify({
        t: 'metrics',
        metrics: {
          sampledAt: new Date().toISOString(),
          cpuPercent: 12,
          memory: { used: 6 * GIB, total: 16 * GIB },
          disk: { used: diskPercent * GIB, total: 100 * GIB },
        },
      }),
    )
  // A reading counts as live for 12 seconds.
  const reporting = setInterval(report, 4_000)

  report()

  return () => {
    clearInterval(reporting)
    tunnel.close()
  }
}

const RESTORE_FAILED = 'Could not restore the saved session; it is kept for the next attempt'
// What the conversation shows for the failed turn: its summary, then the out-of-date line.
const OUTDATED_LINE =
  'The agent failed before it could answer. Nuphos on the computer running this agent is out of date. Update it there, then try again.'

// How a runtime without #3373 answered once it could not restore the saved session (#3371).
function answerAsOldRuntime(tunnel: WebSocket, raw: string) {
  const frame = JSON.parse(raw) as { t: string; s?: string; d?: string }
  const reply = (d: unknown) =>
    tunnel.send(JSON.stringify({ t: 'data', s: frame.s, d: JSON.stringify(d) }))

  if (frame.t === 'open') tunnel.send(JSON.stringify({ t: 'opened', s: frame.s }))
  if (frame.t !== 'data' || !frame.d) return
  const request = JSON.parse(frame.d) as { id?: number; method?: string }

  if (request.id === undefined || !request.method) return
  if (request.method === 'initialize')
    reply({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          _meta: { 'dev.openab/permissionRelay': true, 'dev.openab/sessionAuthority': 2 },
        },
        authMethods: [],
      },
    })
  else reply({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: RESTORE_FAILED } })
}

export const offlineScenarios: Scenario[] = [
  {
    // #3167: the banner said the computer was offline and offered only Retry.
    name: 'a conversation whose computer went offline offers another runtime, and moving sends again',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack)

      await newTask(page)
      await send(page, 'Before the laptop E2E_DELIVERY:before-offline')
      await page.getByText('ACK E2E_DELIVERY:before-offline').waitFor()
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await page.getByRole('menu').getByText(LAPTOP).first().click()
      await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
      await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
      goOffline()
      const banner = page.getByRole('status').filter({ hasText: `${LAPTOP} is offline.` })

      await banner.waitFor()
      await page.screenshot({ path: join(artifacts, 'offline-banner.png') })
      await banner.getByRole('button', { name: 'Switch runtime' }).click()
      await page.getByRole('menu').getByText('E2E fixture agent').click()
      await pickInSubmenu(
        page,
        page.getByRole('menuitem', { name: /^E2E fixture agent.*Claude Code/ }),
      )
      await until('the banner to leave', async () => (await banner.count()) === 0)
      await send(page, 'After the laptop E2E_DELIVERY:after-offline')
      await page.getByText('ACK E2E_DELIVERY:after-offline').waitFor()
    },
  },
  {
    // #3181: a disk about to fill was only a gauge, until a turn failed on it.
    name: 'a conversation on a computer whose disk is almost full says so, and leads to the computer',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { diskPercent: 93 })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-disk')
        await page.getByText('ACK E2E_DELIVERY:before-disk').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page.getByRole('status').filter({
          hasText: `${LAPTOP}’s disk is almost full (93%). Bots and tasks on it may fail.`,
        })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'disk-banner.png') })
        await banner.getByRole('button', { name: 'Free space' }).click()
        await page.getByText('Disk almost full: 7 GB free').waitFor()
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: join(artifacts, 'disk-computer.png') })
      } finally {
        goOffline()
      }
    },
  },
  {
    // #3182: a computer on a Nuphos too old to run a conversation failed without saying why.
    name: 'a conversation on a computer whose Nuphos is out of date says so, and leads to the computer',
    // The turn there fails on purpose.
    expected: /Could not restore the saved session/,
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.119.0',
        restoreFails: true,
      })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-outdated')
        await page.getByText('ACK E2E_DELIVERY:before-outdated').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page
          .getByRole('status')
          .filter({ hasText: `Nuphos on ${LAPTOP} is out of date. Bots and tasks on it may fail.` })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-banner.png') })
        // #3562: a turn that fails there says why, for clients too old to show the banner.
        await send(page, 'On the old laptop')
        await page.getByText(OUTDATED_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-turn-error.png') })
        await banner.getByRole('button', { name: 'Update' }).click()
        await page.getByText('Nuphos on this computer is out of date').waitFor()
        await page.getByText('Open Nuphos on it and restart to update.').waitFor()
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: join(artifacts, 'outdated-computer.png') })
      } finally {
        goOffline()
      }
    },
  },
  {
    // #3560: Desktop 0.125.0, above the floor with 0.127.0 downloaded, failed every turn on a
    // runtime bug 0.127.0 fixed, and nothing said an update would help (#3562).
    name: 'a turn that fails on a computer with a Nuphos update waiting says to update it',
    // The turn there fails on purpose.
    expected: /Could not restore the saved session/,
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.125.0',
        app: { version: '0.125.0', update: { version: '0.127.0', ready: true } },
        restoreFails: true,
      })

      try {
        // A new task starts on the laptop, whichever runtime the last one used.
        await newTask(page)
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await page
          .getByRole('menuitem', { name: /Claude Code/ })
          .last()
          .click()
        await send(page, 'On the laptop behind the latest release')
        await page.getByText(OUTDATED_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'behind-turn-error.png') })
      } finally {
        goOffline()
      }
    },
  },
]
